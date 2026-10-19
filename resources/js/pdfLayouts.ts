import type { CustomTableLayout } from 'pdfmake/interfaces';
/** Callbacks live in the Worker, never in the structured-cloned definition. */
export const PDF_LAYOUTS: Record<string, CustomTableLayout> = {
  contentQuote: { vLineWidth: i => i === 0 ? 2.25 : 0, vLineColor: () => '#b7862e', hLineWidth: () => 0, paddingLeft: () => 13.5, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 },
  contentTable: { hLineWidth: () => .75, vLineWidth: () => .75, hLineColor: () => '#bfcdbf', vLineColor: () => '#bfcdbf', paddingLeft: () => 6, paddingRight: () => 6, paddingTop: () => 6, paddingBottom: () => 6 },
};
