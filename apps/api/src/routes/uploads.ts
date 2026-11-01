import { Hono } from "hono";
import type { AppEnv } from "../env";
import { newId } from "../lib/crypto";
import { AppError } from "../lib/errors";
import { requirePermission } from "../middleware/auth";

const MAX_BYTES = 5 * 1024 * 1024;
/** SVG is excluded on purpose: it can carry scripts. */
const ALLOWED: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** Uploads an image to R2 under the tenant's prefix. Files are served publicly by /files/<key>. */
export const uploadRoutes = new Hono<AppEnv>().post("/", requirePermission("uploads:write"), async (c) => {
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new AppError(422, "validation_error", "Adjunta un archivo", { file: "Adjunta un archivo" });
  const ext = ALLOWED[file.type];
  if (!ext) throw new AppError(422, "validation_error", "Usa una imagen JPG, PNG o WebP", { file: "Usa una imagen JPG, PNG o WebP" });
  if (file.size > MAX_BYTES) throw new AppError(422, "validation_error", "La imagen pesa más de 5 MB", { file: "La imagen pesa más de 5 MB" });

  const { tenant: t, user } = c.var.auth;
  const key = `t/${t.id}/${new Date().getUTCFullYear()}/${newId()}.${ext}`;
  await c.env.BUCKET.put(key, file.stream(), {
    httpMetadata: { contentType: file.type, cacheControl: "public, max-age=31536000, immutable" },
    customMetadata: { tenantId: t.id, uploadedBy: user.id, originalName: file.name.slice(0, 200) },
  });
  return c.json({ key, url: `/files/${key}`, size: file.size, contentType: file.type }, 201);
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
