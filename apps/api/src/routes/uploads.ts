import { Hono, type Context } from "hono";
import { z } from "zod";
import { webhookUrlProblem } from "@nexo/shared";
import type { AppEnv } from "../env";
import { newId } from "../lib/crypto";
import { AppError } from "../lib/errors";
import { json } from "../lib/validate";
import { requirePermission } from "../middleware/auth";

const MAX_BYTES = 5 * 1024 * 1024;
/** SVG is excluded on purpose: it can carry scripts. */
const ALLOWED: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

const invalid = (field: string, message: string) => new AppError(422, "validation_error", message, { [field]: message });

/** Saves an image under the tenant's prefix in R2. Files are served publicly by /files/<key>. */
async function storeImage(c: Context<AppEnv>, body: ReadableStream | ArrayBuffer, contentType: string, size: number, originalName: string) {
  const { tenant: t, user } = c.var.auth;
  const key = `t/${t.id}/${new Date().getUTCFullYear()}/${newId()}.${ALLOWED[contentType]}`;
  await c.env.BUCKET.put(key, body, {
    httpMetadata: { contentType, cacheControl: "public, max-age=31536000, immutable" },
    customMetadata: { tenantId: t.id, uploadedBy: user.id, originalName: originalName.slice(0, 200) },
  });
  return c.json({ key, url: `/files/${key}`, size, contentType }, 201);
}

/** The bytes really are a JPG, PNG or WebP (not just the header saying so). */
function sniff(b: Uint8Array): string | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

export const uploadRoutes = new Hono<AppEnv>()
  .post("/", requirePermission("uploads:write"), async (c) => {
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw invalid("file", "Adjunta un archivo");
    if (!ALLOWED[file.type]) throw invalid("file", "Usa una imagen JPG, PNG o WebP");
    if (file.size > MAX_BYTES) throw invalid("file", "La imagen pesa más de 5 MB");
    return storeImage(c, file.stream(), file.type, file.size, file.name);
  })

  /**
   * Downloads an image from a public https address (for API keys and AI assistants, which can't send
   * files). Same rules as uploads; local and private addresses are refused at every redirect.
   */
  .post("/from-url", requirePermission("uploads:write"), json(z.object({ url: z.string().trim().min(1).max(2000) })), async (c) => {
    const allowLocal = c.env.APP_ENV === "development";
    let target = c.req.valid("json").url;
    let res: Response | null = null;
    for (let hop = 0; hop <= 3; hop++) {
      const problem = webhookUrlProblem(target, allowLocal);
      if (problem) throw invalid("url", problem);
      res = await fetch(target, { redirect: "manual", headers: { accept: "image/jpeg,image/png,image/webp", "user-agent": "Nexo/1.0 (importar imagen)" }, signal: AbortSignal.timeout(10_000) }).catch(() => null);
      if (!res) throw invalid("url", "No se pudo descargar la imagen de esa dirección");
      const next = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (!next) break;
      if (hop === 3) throw invalid("url", "Demasiadas redirecciones");
      target = new URL(next, target).href;
    }
    if (!res || !res.ok) throw invalid("url", `La dirección respondió ${res?.status ?? "con un error"}`);
    if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) throw invalid("url", "La imagen pesa más de 5 MB");
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = res.body!.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw invalid("url", "La imagen pesa más de 5 MB"); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const ch of chunks) { bytes.set(ch, at); at += ch.byteLength; }
    const type = sniff(bytes);
    if (!type) throw invalid("url", "No es una imagen JPG, PNG o WebP");
    const name = decodeURIComponent(new URL(target).pathname.split("/").pop() || "imagen");
    return storeImage(c, bytes.buffer, type, size, name);
  });

/** Public read of uploaded files. Keys are unguessable and images are meant for the public store. */
export const fileRoutes = new Hono<AppEnv>().get("/*", async (c) => {
  const key = decodeURIComponent(new URL(c.req.url).pathname.replace(/^\/files\//, ""));
  if (!key.startsWith("t/") || key.includes("..")) return c.notFound();
  const object = await c.env.BUCKET.get(key);
  if (!object) return c.notFound();
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("x-content-type-options", "nosniff");
  return new Response(object.body, { headers });
});
