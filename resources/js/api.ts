const csrf = () => document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? "";

export class ApiError extends Error {
  constructor(message: string, public status: number, public details?: Record<string, string[]>) {
    super(message);
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: "same-origin",
    ...options,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-CSRF-TOKEN": csrf(),
      ...(options.headers ?? {}),
    },
  });
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) throw new ApiError("La API de Veritas no está disponible.", response.status);
  const payload = await response.json() as { message?: string; errors?: Record<string, string[]> } & T;
  if (!response.ok) throw new ApiError(payload.message ?? "No se pudo completar la operación.", response.status, payload.errors);
  return payload;
}
