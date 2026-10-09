// Exercise native Chromium composition and React against a controlled API.
// PHP/database integration is tested separately by PHPUnit and the MySQL smoke.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { unzipSync, strFromU8 } from 'fflate';

const { chromium } = await import(process.env.INKGROOVE_PLAYWRIGHT_MODULE || 'playwright');
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const artifacts = process.env.INKGROOVE_BROWSER_ARTIFACTS;
if (artifacts) await mkdir(artifacts, { recursive: true });
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const browser = await chromium.launch({
  headless: true,
  ...(process.env.INKGROOVE_CHROMIUM_PATH ? { executablePath: process.env.INKGROOVE_CHROMIUM_PATH } : {}),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const address = `http://127.0.0.1:${server.httpServer.address().port}`;
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
let signedIn = false;
let document;
let recorded = [];
let contentBeforeLanguageSwitch;
const json = (route, payload, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
await page.route('**/api/**', async route => {
  const request = route.request(), url = new URL(request.url()), body = request.postDataJSON();
  const endpoint = url.pathname, method = request.method();
  if (endpoint === '/api/me') return signedIn ? json(route, { user: { id: 1, name: 'Autor', email: 'author@example.test' } }) : json(route, {}, 401);
  if (endpoint === '/api/auth/login') { signedIn = true; return json(route, { user: { id: 1, name: 'Autor', email: 'author@example.test' } }); }
  if (endpoint === '/api/folders') return json(route, { folders: [] });
  if (endpoint === '/api/documents' && method === 'GET') return json(route, { documents: document ? [document] : [] });
  if (endpoint === '/api/documents' && method === 'POST') {
    document = { id: randomUUID(), owner_id: 1, title: body.title, content_html: '', content_text: '', word_count: 0, status: 'draft', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), versions: [], versions_count: 0, sessions_count: 0 };
    return json(route, { document }, 201);
  }
  if (endpoint.endsWith('/timeline')) return json(route, { events: recorded });
  if (endpoint.endsWith('/events')) { recorded.push(...body.events); return json(route, { accepted: body.events.length }); }
  if (document && endpoint === `/api/documents/${document.id}`) {
    if (method === 'PATCH') document = { ...document, ...body, updated_at: new Date().toISOString() };
    return json(route, { document });
  }
  throw new Error(`Unexpected API request: ${method} ${endpoint}`);
});

try {
  await page.goto(`${address}/?lang=es`);
  await page.getByRole('button', { name: 'Entrar', exact: true }).waitFor();
  assert.deepEqual(await page.locator('.entry-story s').allTextContents(), ['documento', 'texto', 'crecen']);
  assert.match(await page.locator('.entry-story').innerText(), /génesis.*habíamos/s);
  if (artifacts) await page.screenshot({ path: path.join(artifacts, 'entrada-es.png'), fullPage: true });
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  assert.equal(new URL(page.url()).searchParams.get('lang'), 'en');
  assert.deepEqual(await page.locator('.entry-story s').allTextContents(), ['document', 'text', 'grow']);
  if (artifacts) await page.screenshot({ path: path.join(artifacts, 'entrada-en.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  if (artifacts) await page.screenshot({ path: path.join(artifacts, 'entrada-en-movil.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.reload();
  await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
  await page.getByLabel('Email address', { exact: true }).fill('author@example.test');
  await page.getByLabel('Password', { exact: true }).fill('test-password-123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'New document', exact: true }).click();
  await page.getByPlaceholder('For example, Notes for an essay').fill('Mi manuscrito');
  await page.getByRole('button', { name: 'Create and write', exact: true }).click();
  const editor = page.locator('.ProseMirror');
  await editor.click();
  const cdp = await page.context().newCDPSession(page);
  const compose = async (interim, final) => {
    await cdp.send('Input.imeSetComposition', { text: interim, selectionStart: interim.length, selectionEnd: interim.length });
    // Let React, provenance and pagination see the interim DOM mutation.
    await page.waitForTimeout(80);
    await cdp.send('Input.insertText', { text: final });
    await page.waitForTimeout(80);
  };
  await page.keyboard.insertText('g'); await compose('´', 'é'); await page.keyboard.insertText('nesis hab'); await compose('´', 'í'); await page.keyboard.insertText('amos');
  assert.equal(await editor.innerText(), 'génesis habíamos');
  const paste = async text => page.evaluate(text => {
    const data = new DataTransfer(); data.setData('text/plain', text);
    document.querySelector('.ProseMirror').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
  await editor.press('Control+a'); await paste('gnesis');
  await editor.press('Control+Home'); await editor.press('ArrowRight');
  await compose('´', 'é');
  assert.equal(await editor.innerText(), 'génesis');
  assert.deepEqual(await editor.locator('mark[data-origin="paste"]').allTextContents(), ['g', 'nesis']);
  assert.equal(await editor.locator('mark[data-origin="paste-edited"]').innerText(), 'é');
  // Test a whole composing run: replacements must not recolour the pasted suffix.
  await editor.press('Control+End'); await page.keyboard.insertText(' ');
  for (const letter of 'áéíóúÁÉÍÓÚ') await compose('´', letter);
  await page.keyboard.insertText(' üñ ¿Qué? ¡Sí! ge\u0301nesis habi\u0301amos\n\nFinal');
  const unicodeText = await editor.innerText();
  contentBeforeLanguageSwitch = await editor.innerHTML();
  await page.getByRole('button', { name: 'Español', exact: true }).click();
  await page.getByRole('tab', { name: 'Formato', exact: true }).waitFor();
  assert.equal(await editor.innerHTML(), contentBeforeLanguageSwitch);
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.getByRole('tab', { name: 'Format', exact: true }).waitFor();
  assert.equal(await editor.innerHTML(), contentBeforeLanguageSwitch);
  await page.getByRole('button', { name: 'Save now', exact: true }).click();
  await page.getByText('All saved', { exact: true }).waitFor();
  assert.match(document.content_html, /ge\u0301nesis habi\u0301amos/);
  assert.match(document.content_html, /ÁÉÍÓÚ/);
  const savedHtml = document.content_html;
  const mutations = recorded.filter(event => ['insert', 'delete', 'paste', 'paste_edit', 'format'].includes(event.event_type)).length;
  await page.getByRole('button', { name: 'Español', exact: true }).click();
  await page.getByRole('button', { name: 'Guardar ahora', exact: true }).click();
  await page.getByText('Todo guardado', { exact: true }).waitFor();
  assert.equal(recorded.filter(event => ['insert', 'delete', 'paste', 'paste_edit', 'format'].includes(event.event_type)).length, mutations);
  await page.getByRole('tab', { name: 'Archivo', exact: true }).click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: /OpenDocument/ }).click();
  const file = await downloaded;
  const bytes = await readFile(await file.path());
  const exported = strFromU8(unzipSync(bytes)['content.xml']);
  const exportedText = await page.evaluate(xml => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    for (const node of Array.from(doc.getElementsByTagName('text:s'))) node.replaceWith(' '.repeat(Number(node.getAttribute('text:c') || 1)));
    for (const node of Array.from(doc.getElementsByTagName('text:line-break'))) node.replaceWith('\n');
    return Array.from(doc.getElementsByTagName('text:p')).map(node => node.textContent).join('\n');
  }, exported);
  assert.match(exportedText, /ge\u0301nesis habi\u0301amos/);
  assert.match(exportedText, /habi\u0301amos\n\nFinal$/);
  assert.match(exported, /ÁÉÍÓÚ/);
  await page.reload();
  await page.getByRole('button', { name: /^Mi manuscrito/ }).click();
  await page.getByRole('button', { name: 'Ver proceso', exact: true }).waitFor();
  assert.equal(await editor.innerText(), unicodeText);
  assert.equal(document.content_html, savedHtml);
  await page.getByRole('button', { name: 'Ver proceso', exact: true }).click();
  await page.getByRole('button', { name: '← Volver al documento', exact: true }).waitFor();
  await page.locator('.event-list button').first().click();
  await page.locator('.event-list button').last().click();
  await page.getByRole('button', { name: '← Volver al documento', exact: true }).click();
  assert.equal(await editor.innerText(), unicodeText);
  assert.equal(document.content_html, savedHtml);
  assert.deepEqual(errors, []);
  console.log('Browser OK: native accents, pasted range provenance, ES/EN, mobile entry, save/reopen, Unicode ODT and read-only replay.');
} finally {
  await browser.close();
  await server.close();
}
