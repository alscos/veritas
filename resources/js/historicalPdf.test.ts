// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { sealedDefinition, PdfFontUnsupported, PdfUnsupported, HISTORICAL_FONTS, type PdfSource } from './sealedPdf';
const source: PdfSource = {version_id:'v1',version_number:1,snapshot_html:'<p><span data-font="georgia" style="font-family:Georgia, &quot;Times New Roman&quot;, serif"><b>  á génesis</b></span></p><blockquote><p>Cita</p></blockquote><table><tr><td><p>Celda</p></td></tr></table>',page_settings:null,certificate_code:'VRT-OLD1',issued_at:null,format_version:2,public_url:'https://example.test/verify/VRT-OLD1',images:{}};
it('requires explicit historical policy, preserves exact version and records replacements deterministically',()=>{
 const original=JSON.stringify(source); expect(()=>sealedDefinition(source)).toThrow(PdfFontUnsupported);
 const d=JSON.stringify(sealedDefinition(source,false,'historical'));
 expect(d).toContain('PDF histórico · presentación aproximada');expect(d).toContain('georgia → Literata');expect(d).toContain(source.public_url);expect(d).toContain('génesis');expect(JSON.stringify(source)).toBe(original);
 const second={...source,version_number:2,certificate_code:'VRT-OLD2',public_url:'https://example.test/verify/VRT-OLD2'};
 expect(JSON.stringify(sealedDefinition(second,true,'historical'))).toContain('VRT-OLD2');expect(d).not.toContain('VRT-OLD2');
});
it('only permits the proven legacy allowlist and still rejects missing glyphs and structure',()=>{
 for(const id of Object.keys(HISTORICAL_FONTS)) expect(()=>sealedDefinition({...source,snapshot_html:`<p><span data-font="${id}">Test</span></p>`},false,'historical')).not.toThrow();
 for(const html of ['<p><span data-font="hostile">Test</span></p>','<p><span data-font="mono">Ω</span></p>','<table><tr><td colspan="2">lost</td></tr></table>','<p><span data-font="georgia" style="font-family:evil">Test</span></p>']) expect(()=>sealedDefinition({...source,snapshot_html:html},false,'historical')).toThrow(PdfUnsupported);
 expect(()=>sealedDefinition({...source,snapshot_html:'<p data-content-font="literata">Catalog</p>'})).not.toThrow();
});
