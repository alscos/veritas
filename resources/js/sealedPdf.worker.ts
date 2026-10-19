import pdfMake from 'pdfmake/build/pdfmake';
import { PDF_LAYOUTS } from './pdfLayouts';
import { loadPdfContentFonts } from './pdfContentFonts';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';

// Suppress async library diagnostics that might include private document nodes.
self.onunhandledrejection = event => { event.preventDefault(); self.postMessage({ error: true }); };
self.onmessage = async (event: MessageEvent<TDocumentDefinitions>) => {
  const definition = event.data;
  definition.footer = (page, total) => ({ text: `InkGroove · ${page} / ${total}`, alignment: 'center', fontSize: 8, margin: [0, 10, 0, 0] });
  try {
    const { fonts, vfs } = await loadPdfContentFonts(definition);
    pdfMake.createPdf(definition, PDF_LAYOUTS, fonts, vfs).getBuffer(buffer => {
      const bytes = new Uint8Array(buffer);
      self.postMessage({ bytes: bytes.buffer }, { transfer: [bytes.buffer] });
    });
  } catch { self.postMessage({ error: true }); }
};
