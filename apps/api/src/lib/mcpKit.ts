/**
 * Shared pieces of the MCP tools: types, JSON-schema helpers and resolvers that turn what a person says
 * ("Aves > Pequeñas", a SKU, "Tienda centro", "16 %") into the ids the REST API expects.
 * Every resolver returns the id, null (when the value is empty and that is allowed) or a Response with the
 * error to show, so tools can `if (r instanceof Response) return r;`.
 */
import type { CategoryItem, InventoryRow, Location, Named, Paginated, Permission, ProductListItem, Supplier, TaxRate } from "@nexo/shared";

export type Call = (method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown) => Promise<Response>;
export type Args = Record<string, unknown>;
export type JsonSchema = Record<string, unknown>;

export interface Tool {
  name: string;
  title: string;
  description: string;
  permission: Permission;
  write?: boolean;
  /** Deletes something or can break what customers see: clients should ask before running it. */
  destructive?: boolean;
  inputSchema: JsonSchema;
  run: (args: Args, call: Call) => Promise<Response>;
}

export const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
export const optStr = (v: unknown) => (v === undefined ? undefined : v === null || v === "" ? null : String(v).trim());
export const qs = (o: Record<string, unknown>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};
export const obj = (properties: Record<string, JsonSchema>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
export const json200 = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
export const fail = (message: string, status = 422) => new Response(JSON.stringify({ error: { message } }), { status, headers: { "content-type": "application/json" } });

export const DATE = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "AAAA-MM-DD" };
export const DATE_OR_NULL = { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "AAAA-MM-DD, o null para quitar la fecha" };
export const LINK = { type: ["string", "null"], description: "Ruta de la tienda (/p/<id>, ?categoria=<id>, ?orden=new) o una dirección https://. null para quitarlo." };
export const COLOR = { type: ["string", "null"], pattern: "^#[0-9a-fA-F]{6}$", description: "#RRGGBB, o null para volver al color del estilo" };
export const CENTS = (description: string) => ({ type: "integer", minimum: 0, description: `${description}, en centavos (149900 = $1,499.00)` });
export const QTY = (description: string) => ({ type: "number", minimum: 0, description });
export const REF = (what: string, extra = "") => ({ type: ["string", "integer"], description: `${what}: su id${extra}` });

/** Reads JSON from the API; a non-2xx answer comes back as the Response to return. */
export async function getJson<T>(call: Call, path: string): Promise<T | Response> {
  const res = await call("GET", path);
  return res.ok ? ((await res.json()) as T) : res;
}
/** Sends JSON and, when it worked, answers `shape(data)` instead of the raw body. */
export async function send<T>(call: Call, method: "POST" | "PUT", path: string, body: unknown, shape?: (data: T) => unknown) {
  const res = await call(method, path, body);
  if (!res.ok || !shape) return res;
  const text = await res.text();
  return json200(shape((text ? JSON.parse(text) : null) as T));
}

/** Server ids are 26-character ULIDs. */
export const isId = (v: string) => /^[0-9A-HJKMNP-TV-Z]{26}$/.test(v);
const norm = (s: string) => s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");
const listOf = (names: string[]) => (names.length ? names.slice(0, 25).join(", ") + (names.length > 25 ? "…" : "") : "ninguna");

/* ---------- Resolvers ---------- */

/** Category by id, name, or "Categoría > Subcategoría". */
export async function resolveCategory(call: Call, v: unknown): Promise<string | null | Response> {
  const raw = str(v);
  if (!raw) return null;
  if (isId(raw)) return raw;
  const all = await getJson<CategoryItem[]>(call, "/api/categories");
  if (all instanceof Response) return all;
  const nameOf = (c: CategoryItem) => (c.parentId ? `${all.find((p) => p.id === c.parentId)?.name ?? "?"} > ${c.name}` : c.name);
  const parts = raw.split(/\s*[>›/]\s*/).filter(Boolean);
  let found: CategoryItem[];
  if (parts.length >= 2) {
    const parent = all.find((c) => !c.parentId && norm(c.name) === norm(parts[0]!));
    found = parent ? all.filter((c) => c.parentId === parent.id && norm(c.name) === norm(parts[1]!)) : [];
  } else {
    found = all.filter((c) => norm(c.name) === norm(raw));
    if (found.length > 1) found = found.filter((c) => !c.parentId).length === 1 ? found.filter((c) => !c.parentId) : found;
  }
  if (found.length === 1) return found[0]!.id;
  if (found.length > 1) return fail(`Hay varias categorías «${raw}»: ${found.map(nameOf).join(", ")}. Usa «Categoría > Subcategoría» o el id.`);
  return fail(`No existe la categoría «${raw}». Créala con crear_categoria. Categorías: ${listOf(all.map(nameOf))}.`, 404);
}

export async function resolveBrand(call: Call, v: unknown): Promise<string | null | Response> {
  const raw = str(v);
  if (!raw) return null;
  if (isId(raw)) return raw;
  const all = await getJson<Named[]>(call, "/api/brands");
  if (all instanceof Response) return all;
  const found = all.find((b) => norm(b.name) === norm(raw));
  return found ? found.id : fail(`No existe la marca «${raw}». Créala con crear_marca. Marcas: ${listOf(all.map((b) => b.name))}.`, 404);
}

/** Tax by id, name or percentage (16, "16%", "16 %"). */
export async function resolveTax(call: Call, v: unknown): Promise<string | null | Response> {
  const raw = str(v);
  if (!raw) return null;
  if (isId(raw)) return raw;
  const all = await getJson<TaxRate[]>(call, "/api/taxes");
  if (all instanceof Response) return all;
  const pct = /^\d+(?:[.,]\d+)?\s*%?$/.test(raw) ? Math.round(Number.parseFloat(raw.replace(",", ".")) * 100) : null;
  const found = all.find((t) => norm(t.name) === norm(raw) || (pct !== null && t.rateBps === pct && t.active));
  return found ? found.id : fail(`No existe el impuesto «${raw}». Impuestos: ${listOf(all.map((t) => `${t.name} (${t.rateBps / 100} %)`))}.`, 404);
}

/** Location by id or name; empty = the default location. */
export async function resolveLocation(call: Call, v: unknown): Promise<string | Response> {
  const raw = str(v);
  if (raw && isId(raw)) return raw;
  const all = await getJson<Location[]>(call, "/api/locations");
  if (all instanceof Response) return all;
  const found = raw ? all.find((l) => norm(l.name) === norm(raw)) : (all.find((l) => l.isDefault) ?? all[0]);
  return found ? found.id : fail(`No existe la ubicación «${raw}». Ubicaciones: ${listOf(all.map((l) => l.name))}.`, 404);
}

export async function resolveSupplier(call: Call, v: unknown): Promise<string | Response> {
  const raw = str(v);
  if (isId(raw)) return raw;
  const all = await getJson<Supplier[]>(call, `/api/suppliers${qs({ q: raw, status: "all" })}`);
  if (all instanceof Response) return all;
  const exact = all.filter((s) => norm(s.name) === norm(raw));
  const found = exact.length === 1 ? exact[0] : all.length === 1 ? all[0] : undefined;
  return found ? found.id : fail(`No encontré al proveedor «${raw}»${all.length ? `. Coincidencias: ${listOf(all.map((s) => s.name))}` : ". Créalo con crear_proveedor"}.`, 404);
}

/** Product by id, exact SKU of one of its variants, or name (when only one matches). */
export async function resolveProduct(call: Call, v: unknown): Promise<string | Response> {
  const raw = str(v);
  if (!raw) return fail("Indica el producto (id, SKU o nombre).");
  if (isId(raw)) return raw;
  const found: ProductListItem[] = [];
  for (const status of ["active", "archived"]) {
    const page = await getJson<Paginated<ProductListItem>>(call, `/api/products${qs({ q: raw, status, pageSize: 20 })}`);
    if (page instanceof Response) return page;
    found.push(...page.items);
  }
  const exact = found.filter((p) => norm(p.name) === norm(raw) || p.sku.toUpperCase() === raw.toUpperCase());
  const pick = exact.length === 1 ? exact[0] : found.length === 1 ? found[0] : undefined;
  if (pick) return pick.id;
  return fail(found.length ? `Varios productos coinciden con «${raw}»: ${found.slice(0, 10).map((p) => `${p.name} (${p.id})`).join(", ")}. Usa el id o el SKU.` : `No encontré el producto «${raw}».`, found.length ? 422 : 404);
}

/** Variant by id, SKU or barcode (or a product name with a single variant). Only products that track inventory. */
export async function resolveVariant(call: Call, v: unknown): Promise<string | Response> {
  const raw = str(v);
  if (!raw) return fail("Indica el producto (id de la variante, SKU o código de barras).");
  if (isId(raw)) return raw;
  const page = await getJson<Paginated<InventoryRow>>(call, `/api/inventory${qs({ q: raw, pageSize: 50 })}`);
  if (page instanceof Response) return page;
  const rows = page.items;
  const code = rows.filter((r) => r.sku.toUpperCase() === raw.toUpperCase() || r.barcode === raw);
  if (code.length === 1) return code[0]!.variantId;
  const label = (r: InventoryRow) => `${r.productName}${r.options.length ? ` (${r.options.join(" / ")})` : ""} [SKU ${r.sku}]`;
  const byName = rows.filter((r) => norm(r.productName) === norm(raw) || norm(label(r)) === norm(raw));
  const pick = byName.length === 1 ? byName[0] : rows.length === 1 ? rows[0] : undefined;
  if (pick) return pick.variantId;
  return fail(rows.length ? `Varios productos coinciden con «${raw}»: ${rows.slice(0, 10).map(label).join(", ")}. Usa el SKU.` : `No encontré «${raw}» en el inventario (¿el producto controla existencias?).`, rows.length ? 422 : 404);
}

/** Runs resolvers over a list ("productos": [{ producto, cantidad }]) and stops at the first error. */
export async function resolveAll<T, R>(items: T[], fn: (item: T, i: number) => Promise<R | Response>): Promise<R[] | Response> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i++) {
    const r = await fn(items[i]!, i);
    if (r instanceof Response) {
      const body = (await r.clone().json().catch(() => null)) as { error?: { message?: string } } | null;
      return body?.error?.message ? fail(`Línea ${i + 1}: ${body.error.message}`, r.status) : r;
    }
    out.push(r);
  }
  return out;
}

export const asArray = (v: unknown): Args[] => (Array.isArray(v) ? v.filter((x): x is Args => typeof x === "object" && x !== null && !Array.isArray(x)) : []);
export const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : undefined);
export const bool = (v: unknown) => (v === undefined ? undefined : Boolean(v));
/** Sets `out[key] = value` only when the value was sent (undefined = keep what there is). */
export function put<T extends object>(out: T, key: keyof T, value: unknown) {
  if (value !== undefined) (out as Record<string, unknown>)[key as string] = value;
}
