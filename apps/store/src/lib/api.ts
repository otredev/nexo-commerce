import type { ApiError } from "@nexo/shared";

export class RequestError extends Error {
  constructor(public status: number, public code: string, message: string, public fields: Record<string, string> = {}) {
    super(message);
  }
}

/** Public store API: no cookies, JSON in and out, our error shape. */
export async function api<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/store${path}`, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new RequestError(0, "network", "No hay conexión. Revisa tu internet e intenta de nuevo.");
  }
  const data = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const err = (data as ApiError | null)?.error;
    throw new RequestError(res.status, err?.code ?? "unknown", err?.message ?? "Ocurrió un error inesperado", err?.fields ?? {});
  }
  return data as T;
}

export const imageUrl = (key: string | null | undefined) => (key ? `/files/${key}` : null);
