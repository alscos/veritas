import { t, getLocale } from "./i18n";
let identity: number | null = null;
let generation = 0;
export const identityGeneration = () => generation;
export const authenticatedIdentity = () => identity;
export const resetIdentity = (next: number | null = null) => { generation++; identity = next; };
const csrf = () => document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? "";
const SESSION_EXPIRED_EVENT = "veritas:session-expired";

const notifySessionExpired = (message: string) => {
  resetIdentity();
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: { message } }));
};

const refreshCsrfToken = async (epoch: number): Promise<boolean> => {
  try {
    const response = await fetch("/api/csrf-token", {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return false;
    const payload = await response.json() as { csrf_token?: string };
    if (epoch !== generation || !payload.csrf_token) return false;
    document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.setAttribute("content", payload.csrf_token);
    return true;
  } catch {
    return false;
  }
};

export class ApiError extends Error {
  constructor(message: string, public status: number, public details?: Record<string, string[]>) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit, allowCsrfRetry: boolean): Promise<T> {
  const epoch = generation;
  // Login can be embedded in an issued-PDF flow whose in-memory capability must survive failed credentials.
  const authenticating = path === "/auth/login" || path === "/auth/register";
  const expectedUser = identity;
  const response = await fetch(`/api${path}`, {
    credentials: "same-origin",
    ...options,
    headers: {
      Accept: "application/json",
      ...(expectedUser !== null && !path.startsWith("/auth/") ? { "X-InkGroove-User": String(expectedUser) } : {}),
      "Accept-Language": getLocale(),
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      "X-CSRF-TOKEN": csrf(),
      ...(options.headers ?? {}),
    },
  });
  if (epoch !== generation) throw new ApiError("Identity changed", 0);
  const responseUser = response.headers.get("X-InkGroove-User");
  if (expectedUser !== null && responseUser !== null && responseUser !== String(expectedUser)) {
    notifySessionExpired(t("Debes volver a identificarte para continuar."));
    throw new ApiError("Identity changed", 401);
  }
  if (response.status === 419 && allowCsrfRetry && path !== "/csrf-token") {
    const refreshed = await refreshCsrfToken(epoch);
    if (epoch !== generation) throw new ApiError("Identity changed", 0);
    if (refreshed) return request<T>(path, options, false);
  }
  if (response.status === 419) {
    const message = t("Tu sesión ha caducado. Vuelve a identificarte para continuar.");
    if (!authenticating) notifySessionExpired(message);
    throw new ApiError(message, 419);
  }
  if (response.status === 401) {
    const message = t("Debes volver a identificarte para continuar.");
    if (path !== "/me" && !authenticating) notifySessionExpired(message);
    throw new ApiError(message, 401);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) throw new ApiError(t("La API de InkGroove no está disponible."), response.status);
  const payload = await response.json() as { message?: string; errors?: Record<string, string[]> } & T;
  if (epoch !== generation) throw new ApiError("Identity changed", 0);
  if (!response.ok) throw new ApiError(Object.values(payload.errors ?? {}).flat()[0] ?? payload.message ?? t("No se pudo completar la operación."), response.status, payload.errors);
  return payload;
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  return request<T>(path, options, true);
}

export { SESSION_EXPIRED_EVENT };
