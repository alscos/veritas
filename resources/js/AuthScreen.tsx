import { useState, type FormEvent } from "react";
import { api, ApiError } from "./api";
import { t, useLocale } from "./i18n";
import type { User } from "./types";
import LanguageSwitcher from "./LanguageSwitcher";
import EntryStory from "./EntryStory";
import brandLogoLight from "../brand/InkGroove-logo-tinta-claro.svg";
type AuthMode = "login" | "register";
export default function AuthScreen({ onAuthenticated, notice }: { onAuthenticated: (user: User) => void; notice?: string }) {
  useLocale();
  const [mode, setMode] = useState<AuthMode>("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    try {
      const payload = Object.fromEntries(form.entries());
      const result = await api<{ user: User }>(`/auth/${mode}`, { method: "POST", body: JSON.stringify(payload) });
      onAuthenticated(result.user);
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : t("No se pudo conectar con InkGroove.")); }
    finally { setBusy(false); }
  };
  return <main className="auth-shell">
    <section className="auth-story">
      <header className="auth-story-header"><div className="brand"><img className="brand-logo" src={brandLogoLight} alt="InkGroove" width={1835.51} height={500} /></div><LanguageSwitcher /></header>
      <div>
        <p className="eyebrow">{t("Escritura con memoria")}</p>
        <EntryStory />
      </div>
      <p className="auth-foot">{t("Conserva el proceso de escritura, vuelve sobre tus borradores y comparte las versiones que tú elijas.")}</p>
    </section>
    <section className="auth-panel">
      <div className="auth-card">
        <p className="eyebrow">{mode === "login" ? t("Acceso") : t("Crear una cuenta")}</p>
        <h2>{mode === "login" ? t("Vuelve a tus documentos") : t("Empieza tu archivo personal")}</h2>
        {notice && <p className="auth-notice" role="status">{notice}</p>}
        <form onSubmit={submit}>
          {mode === "register" && <label>{t("Nombre")}<input name="name" autoComplete="name" required /></label>}
          <label>{t("Correo electrónico")}<input name="email" type="email" autoComplete="email" required /></label>
          <label>{t("Contraseña")}<input name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={10} required /></label>
          {mode === "register" && <label>{t("Repite la contraseña")}<input name="password_confirmation" type="password" autoComplete="new-password" minLength={10} required /></label>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary full" disabled={busy}>{busy ? t("Un momento…") : mode === "login" ? t("Entrar") : t("Crear cuenta")}</button>
        </form>
        <button className="text-button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
          {mode === "login" ? t("No tengo cuenta") : t("Ya tengo una cuenta")}
        </button>
      </div>
    </section>
  </main>;
}
