import { createElement, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ImageRead = (id: string, signal: AbortSignal) => Promise<Blob>;
function AuthorizedImage({ id, alt, read }: { id: string; alt: string; read: ImageRead }) {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); let object = '';
    setUrl(''); setFailed(false);
    void read(id, controller.signal).then(blob => {
      if (controller.signal.aborted) return;
      if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(blob.type) || blob.size > 5 * 1024 * 1024) throw Error();
      object = URL.createObjectURL(blob); setUrl(object);
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => { controller.abort(); if (object) URL.revokeObjectURL(object); };
  }, [id, read]);
  return url ? <img src={url} alt={alt} /> : <span role="status">{failed ? 'Imagen no disponible / Image unavailable' : 'Cargando imagen / Loading image'}{alt && ` · ${alt}`}</span>;
}
const tags = new Set('p div br strong b em i u s del sub sup h1 h2 h3 ul ol li blockquote mark span a img hr table tbody thead tr th td'.split(' '));
/** Parse in a template's inert document; recreate an allowlisted tree. No source nodes,
 * attributes, CSS, links or src URLs are attached to the visible document. */
export function readingTree(html: string, read: ImageRead): ReactNode {
  if (new TextEncoder().encode(html).length > 250000) throw Error('Reading unavailable');
  const template = document.createElement('template'); template.innerHTML = html;
  let count = 0;
  const visit = (node: Node, key: string, depth: number): ReactNode => {
    if (++count > 5000 || depth > 64) throw Error('Reading unavailable');
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType === Node.COMMENT_NODE) return null;
    if (!(node instanceof Element)) throw Error('Reading unavailable');
    const tag = node.tagName.toLowerCase();
    if (!tags.has(tag)) throw Error('Reading unavailable');
    if (tag === 'img') {
      const match = /^\/api\/documents\/[a-f0-9-]{36}\/images\/([a-f0-9-]{36})$/.exec(node.getAttribute('src') ?? '');
      if (!match) throw Error('Reading unavailable');
      return <AuthorizedImage key={key} id={match[1]} alt={(node.getAttribute('alt') ?? '').slice(0, 300)} read={read} />;
    }
    const props: Record<string, unknown> = { key };
    const classes: string[] = [];
    const origin = node.getAttribute('data-origin') ?? node.getAttribute('data-provenance');
    if (origin === 'paste' || origin === 'paste-edited') classes.push(`origin-${origin}`);
    const align = (node as HTMLElement).style?.textAlign;
    if (['left', 'right', 'center', 'justify'].includes(align)) classes.push(`align-${align}`);
    const indent = node.getAttribute('data-indent'); if (indent && /^[0-6]$/.test(indent)) classes.push(`indent-${indent}`);
    if (tag === 'div' && node.getAttribute('data-page-break') === 'true') classes.push('sealed-page-break');
    if (classes.length) props.className = classes.join(' ');
    if (tag === 'td' || tag === 'th') for (const [attr, prop] of [['colspan', 'colSpan'], ['rowspan', 'rowSpan']]) {
      const n = Number(node.getAttribute(attr)); if (Number.isInteger(n) && n >= 1 && n <= 20) props[prop] = n;
    }
    if (tag === 'ol') { const n = Number(node.getAttribute('start')); if (Number.isInteger(n) && n > 0 && n <= 10000) props.start = n; }
    // Author links remain literal text without navigation, targets or private URLs.
    const output = tag === 'a' ? 'span' : tag;
    const children = [...node.childNodes].map((n, i) => visit(n, `${key}.${i}`, depth + 1));
    return createElement(output, props, ...children);
  };
  return [...template.content.childNodes].map((n, i) => visit(n, String(i), 0));
}
export default function SealedReading({ html, read }: { html: string; read: ImageRead }) {
  const tree = useMemo(() => { try { return readingTree(html, read); } catch { return null; } }, [html, read]);
  return tree === null ? <p role="alert">Contenido no disponible / Content unavailable</p> : <article className="sealed-reading" aria-label="Versión sellada / Sealed version">{tree}</article>;
}
