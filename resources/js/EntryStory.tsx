import { useLocale } from "./i18n";

export default function EntryStory() {
  const locale = useLocale();
  return <div className="entry-story" lang={locale}>{locale === "es" ? <>
    <h1>Un <s>documento</s> <s>texto</s> manuscrito debe preservar su memoria y sus cicatrices.</h1>
    <p>Los errores, las dudas y enmiendas son los surcos donde <s>crecen</s> brotan las semillas de un texto. Poder revivir y estudiar su génesis es un privilegio que habíamos olvidado.</p>
    <p className="entry-signoff">InkGroove lo hace posible de nuevo.</p>
  </> : <>
    <h1>A <s>document</s> <s>text</s> manuscript should preserve its memory and its scars.</h1>
    <p>Mistakes, doubts and revisions are the grooves where the seeds of a text <s>grow</s> sprout. To relive and study its genesis is a privilege we had forgotten.</p>
    <p className="entry-signoff">InkGroove makes it possible again.</p>
  </>}</div>;
}
