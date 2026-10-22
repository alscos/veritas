// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { sealedDefinition } from './sealedPdf';
const source = {version_id:'synthetic',version_number:1,certificate_code:'VRT-SYNTHETIC',snapshot_html:'<p>á génesis <mark data-origin="paste">pegado</mark></p><p></p>',page_settings:null,issued_at:null,format_version:2 as const,public_url:'https://example.test/verify/VRT-SYNTHETIC',images:{}};
it.each([1,2,3] as const)('keeps full text, exact title and scoped statistics at level %s', level => {
 const input = { ...source, title_at_issue: 'Exacto á é', share: { url: 'https://example.test/process-summary/share#token=' + 'S'.repeat(43), level, expires_at: null }, historical_counts: {state:'limited',source:'sealed_snapshot_html',reason:null,value:{direct:21,pasted:13,edited:8,total:42}} };
 const before = JSON.stringify(input), definition = sealedDefinition(input), json = JSON.stringify(definition);
 expect(json).toContain('Exacto á é');expect(json).toContain('Nunca caduca');expect(json).toContain('INICIO DEL DOCUMENTO');expect(json).toContain('FIN DEL DOCUMENTO');expect(json).toContain('Verificación de InkGroove');expect(json).toContain('pegado');expect(json).not.toContain('"pageBreak":"before"');
 expect(json.includes('Conteos históricos autorizados')).toBe(level === 2);
 expect(json).toContain('<svg');expect(json).toContain('tinta naranja');expect(JSON.stringify(input)).toBe(before);
});
it('does not invent statistics from HTML or accept a current-draft source', () => {
 const input = {...source,share:{url:'https://example.test/process-summary/share#token='+'A'.repeat(43),level:2 as const,expires_at:null},historical_counts:{state:'verified',source:'current_draft',reason:null,value:{direct:1,pasted:0,edited:0,total:1}}};
 expect(JSON.stringify(sealedDefinition(input))).toContain('Dato no disponible');
});

it('places unique export boundaries around the unchanged body before verification', () => {
 const input = {...source,snapshot_html:'<p>Uno á é</p><p></p><p>Último</p>'};
 const d = sealedDefinition(input), content = d.content as unknown[];
 const json = content.map(x=>JSON.stringify(x));
 const start = json.findIndex(x=>x.includes('INICIO DEL DOCUMENTO'));
 const end = json.findIndex(x=>x.includes('FIN DEL DOCUMENTO'));
 expect(json.filter(x=>x.includes('INICIO DEL DOCUMENTO'))).toHaveLength(1);
 expect(json.filter(x=>x.includes('FIN DEL DOCUMENTO'))).toHaveLength(1);
 expect(json.slice(start+1,end).join('')).toContain('Uno á é');
 expect(json.slice(start+1,end).join('')).toContain('Último');
 expect(json.slice(end+1).join('')).toContain('Verificación de InkGroove');
 expect(input.snapshot_html).toBe('<p>Uno á é</p><p></p><p>Último</p>');
});
