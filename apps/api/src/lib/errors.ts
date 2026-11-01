import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export class AppError extends Error {
  constructor(
    public status: ContentfulStatusCode,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const notFound = (what = "Recurso") => new AppError(404, "not_found", `${what} no encontrado`);
export const forbidden = () => new AppError(403, "forbidden", "No tienes permiso para esta acción");
export const unauthorized = () => new AppError(401, "unauthorized", "Inicia sesión para continuar");

export function errorResponse(c: Context, err: unknown) {
  if (err instanceof AppError) {
    return c.json({ error: { code: err.code, message: err.message, fields: err.fields } }, err.status);
  }
  if (err instanceof HTTPException) {
    return c.json({ error: { code: "http_error", message: err.message } }, err.status);
  }
  console.error("Unhandled error", err);
  return c.json({ error: { code: "internal", message: "Ocurrió un error inesperado. Intenta de nuevo." } }, 500);
}
