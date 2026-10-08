import type { PageSettings } from "./types";

export const PAGE_FORMATS = {
  a4: { name: "A4", width: 210, height: 297 },
  a5: { name: "A5", width: 148, height: 210 },
  letter: { name: "Carta", width: 215.9, height: 279.4 },
  legal: { name: "Legal", width: 215.9, height: 355.6 },
} as const;
export const DEFAULT_PAGE: PageSettings = { format: "a4", orientation: "portrait", margin: 25 };
export const MM_TO_PX = 96 / 25.4;
export const PAGE_GAP = 24;
export const pageDimensions = (settings: PageSettings) => {
  const format = PAGE_FORMATS[settings.format] ?? PAGE_FORMATS.a4;
  const [width, height] = settings.orientation === "landscape" ? [format.height, format.width] : [format.width, format.height];
  return { width, height, widthPx: width * MM_TO_PX, heightPx: height * MM_TO_PX, marginPx: settings.margin * MM_TO_PX };
};
export const FONT_FAMILIES: Record<string, { label: string; css: string; export: string }> = {
  serif: { label: "Serif editorial", css: 'Georgia, "Times New Roman", serif', export: "Georgia" },
  sans: { label: "Sans serif", css: 'Arial, Helvetica, sans-serif', export: "Arial" },
  mono: { label: "Monoespaciada", css: '"Courier New", monospace', export: "Courier New" },
  georgia: { label: "Georgia", css: 'Georgia, serif', export: "Georgia" },
  selectric: { label: "Selectric Clean · ES", css: '"InkGroove Type Clean", Georgia, serif', export: "InkGroove Type Clean" },
  times: { label: "Times New Roman", css: '"Times New Roman", Times, serif', export: "Times New Roman" },
  garamond: { label: "Garamond", css: 'Garamond, "EB Garamond", Georgia, serif', export: "Garamond" },
  arial: { label: "Arial", css: 'Arial, Helvetica, sans-serif', export: "Arial" },
  verdana: { label: "Verdana", css: 'Verdana, sans-serif', export: "Verdana" },
  courier: { label: "Courier New", css: '"Courier New", monospace', export: "Courier New" },
};
export const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72];
