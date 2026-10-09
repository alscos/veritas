import { setLocale, t, useLocale } from "./i18n";

export default function LanguageSwitcher() {
  const locale = useLocale();
  return <div className="language-switcher" role="group" aria-label={t("Idioma")}>
    <button type="button" lang="es" aria-label="Español" aria-pressed={locale === "es"} onClick={() => setLocale("es")}>ES</button>
    <span aria-hidden="true">/</span>
    <button type="button" lang="en" aria-label="English" aria-pressed={locale === "en"} onClick={() => setLocale("en")}>EN</button>
  </div>;
}
