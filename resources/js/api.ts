const csrf = () => document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? "";
const SESSION_EXPIRED_EVENT = "veritas:session-expired";

const notifySessionExpired = (message: string) => {
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: { message } }));
};

const refreshCsrfToken = async (): Promise<boolean> => {
  try {
    const response = await fetch("/api/csrf-token", {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return false;
    const payload = await response.json() as { csrf_token?: string };
    if (!payload.csrf_token) return false;
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
  const response = await fetch(`/api${path}`, {
    credentials: "same-origin",
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      "X-CSRF-TOKEN": csrf(),
      ...(options.headers ?? {}),
    },
  });
  if (response.status === 419 && allowCsrfRetry && path !== "/csrf-token" && await refreshCsrfToken()) {
    return request<T>(path, options, false);
  }
  if (response.status === 419) {
    const message = "Tu sesión ha caducado. Vuelve a identificarte para continuar.";
    notifySessionExpired(message);
    throw new ApiError(message, 419);
  }
  if (response.status === 401) {
    const message = "Debes volver a identificarte para continuar.";
    if (path !== "/me") notifySessionExpired(message);
    throw new ApiError(message, 401);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) throw new ApiError("La API de InkGroove no está disponible.", response.status);
  const payload = await response.json() as { message?: string; errors?: Record<string, string[]> } & T;
  if (!response.ok) throw new ApiError(payload.message ?? "No se pudo completar la operación.", response.status, payload.errors);
  return payload;
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  return request<T>(path, options, true);
}

export { SESSION_EXPIRED_EVENT };
