/**
 * MCP tools for the online store beyond the appearance document: images from a link, the store's
 * presentation settings (tagline, about, FAQ, SEO, WhatsApp) and promotions/coupons.
 */
import type { Coupon, Promotion, StoreSettings } from "@nexo/shared";
import { asArray, CENTS, DATE_OR_NULL, fail, getJson, num, obj, optStr, put, resolveAll, resolveCategory, resolveProduct, send, str, type Args, type Tool } from "./mcpKit";

const CHANNEL: Record<string, "all" | "pos" | "online"> = { todos: "all", caja: "pos", en_linea: "online" };
const CHANNEL_OPT = { type: "string", enum: Object.keys(CHANNEL), description: "Dónde aplica: todos, caja o en_linea" };

/** The store settings the PUT accepts (GET adds read-only fields). */
const settingsBody = (s: StoreSettings) => {
  const { slug: _s, url: _u, publishedCount: _p, activeCount: _a, ...rest } = s as StoreSettings & Record<string, unknown>;
  return rest as Record<string, unknown>;
};

export const STORE_TOOLS: Tool[] = [
  {
    name: "subir_imagen", title: "Subir una imagen desde un enlace", permission: "uploads:write", write: true,
    description: "Descarga una imagen pública (https, JPG, PNG o WebP, hasta 5 MB) y la guarda en Nexo. Devuelve su «clave» (t/…) para usarla en productos (imagenes), banners, portada, galerías o fondos de secciones.",
    inputSchema: obj({ url: { type: "string", description: "https://… de la imagen" } }, ["url"]),
    run: (a, call) => send<{ key: string; url: string; size: number }>(call, "POST", "/api/uploads/from-url", { url: str(a.url) }, (r) => ({ clave: r.key, url: r.url, bytes: r.size })),
  },
  {
    name: "ver_ajustes_tienda", title: "Ver los ajustes de la tienda", permission: "settings:read",
    description: "Ajustes de la tienda en línea: si está activa, su dirección, lema, «acerca de», preguntas frecuentes, SEO, WhatsApp, entregas y formas de pago.",
    inputSchema: obj({}),
    run: (_a, call) => call("GET", "/api/store-settings"),
  },
  {
    name: "editar_ajustes_tienda", title: "Editar la presentación de la tienda", permission: "store:write", write: true,
    description: "Cambia cómo se presenta la tienda: lema (lo usa la portada), texto «acerca de», preguntas frecuentes (las usa la sección de preguntas y los buscadores), título y descripción para Google, si aparece en buscadores y el WhatsApp. Solo cambia lo que mandes; «preguntas_frecuentes» reemplaza la lista completa.",
    inputSchema: obj({
      lema: { type: ["string", "null"], maxLength: 140 },
      acerca_de: { type: ["string", "null"], maxLength: 2000 },
      preguntas_frecuentes: { type: "array", maxItems: 20, items: obj({ pregunta: { type: "string", maxLength: 200 }, respuesta: { type: "string", maxLength: 1500 } }, ["pregunta", "respuesta"]) },
      seo_titulo: { type: ["string", "null"], maxLength: 70 },
      seo_descripcion: { type: ["string", "null"], maxLength: 160 },
      en_buscadores: { type: "boolean", description: "false = pide a Google no indexarla" },
      whatsapp: { type: ["string", "null"], maxLength: 20, description: "Número con lada: +52 55 1234 5678" },
    }),
    run: async (a, call) => {
      const cur = await getJson<StoreSettings>(call, "/api/store-settings");
      if (cur instanceof Response) return cur;
      const body = settingsBody(cur);
      put(body, "tagline", optStr(a.lema));
      put(body, "about", optStr(a.acerca_de));
      put(body, "seoTitle", optStr(a.seo_titulo));
      put(body, "seoDescription", optStr(a.seo_descripcion));
      put(body, "indexable", a.en_buscadores === undefined ? undefined : Boolean(a.en_buscadores));
      put(body, "whatsapp", optStr(a.whatsapp));
      if (a.preguntas_frecuentes !== undefined) body.faq = asArray(a.preguntas_frecuentes).map((f) => ({ q: str(f.pregunta), a: str(f.respuesta) }));
      return send<StoreSettings>(call, "PUT", "/api/store-settings", body, (s) => ({ lema: s.tagline, acerca_de: s.about, preguntas_frecuentes: s.faq, seo_titulo: s.seoTitle, seo_descripcion: s.seoDescription, en_buscadores: s.indexable, whatsapp: s.whatsapp, url: s.url }));
    },
  },

  /* ---------- Promotions and coupons ---------- */
  {
    name: "listar_promociones", title: "Promociones y cupones", permission: "promotions:read",
    description: "Promociones (descuento automático por porcentaje) y cupones, con sus fechas, usos y lo descontado.",
    inputSchema: obj({}),
    run: (_a, call) => call("GET", "/api/promotions"),
  },
  {
    name: "guardar_promocion", title: "Crear o editar una promoción", permission: "promotions:write", write: true,
    description: "Crea una promoción de porcentaje de descuento (o cambia una si mandas «promocion»): a todo, a categorías o a productos, en caja, en línea o ambos, con fechas. Categorías y productos se aceptan por nombre/SKU.",
    inputSchema: obj({
      promocion: { type: "string", description: "id o nombre de la promoción a cambiar. Vacío = crear una nueva" },
      nombre: { type: "string", maxLength: 80 },
      porcentaje: { type: "number", minimum: 1, maximum: 90 },
      aplica_a: { type: "string", enum: ["todo", "categorias", "productos"] },
      categorias: { type: "array", items: { type: "string" }, maxItems: 200 },
      productos: { type: "array", items: { type: "string" }, maxItems: 200 },
      canal: CHANNEL_OPT,
      desde: DATE_OR_NULL,
      hasta: DATE_OR_NULL,
      activa: { type: "boolean" },
      solo_clientes: { type: "boolean", description: "Solo para clientes registrados: en caja, cuando la venta tiene cliente (no en línea)" },
    }),
    run: async (a, call) => {
      const list = await getJson<{ promotions: Promotion[] }>(call, "/api/promotions");
      if (list instanceof Response) return list;
      const key = str(a.promocion);
      const cur = key ? list.promotions.find((p) => p.id === key || p.name.toLowerCase() === key.toLowerCase()) : undefined;
      if (key && !cur) return fail(`No existe la promoción «${key}». Promociones: ${list.promotions.map((p) => p.name).join(", ") || "ninguna"}.`, 404);
      const body: Record<string, unknown> = cur
        ? { name: cur.name, percentBps: cur.percentBps, target: cur.target, targetIds: cur.targetIds, channel: cur.channel, membersOnly: cur.membersOnly, startsOn: cur.startsOn, endsOn: cur.endsOn, active: cur.active }
        : { target: "all", targetIds: [], channel: "all", membersOnly: false, startsOn: null, endsOn: null, active: true };
      put(body, "name", a.nombre === undefined ? undefined : str(a.nombre));
      put(body, "percentBps", a.porcentaje === undefined ? undefined : Math.round(Number(a.porcentaje) * 100));
      put(body, "channel", a.canal === undefined ? undefined : CHANNEL[str(a.canal)]);
      put(body, "startsOn", optStr(a.desde));
      put(body, "endsOn", optStr(a.hasta));
      put(body, "active", a.activa === undefined ? undefined : Boolean(a.activa));
      put(body, "membersOnly", a.solo_clientes === undefined ? undefined : Boolean(a.solo_clientes));
      const target = a.aplica_a === undefined ? undefined : ({ todo: "all", categorias: "category", productos: "product" } as Record<string, string>)[str(a.aplica_a)];
      if (target) { body.target = target; body.targetIds = []; }
      if (Array.isArray(a.categorias)) {
        const ids = await resolveAll(a.categorias, async (c) => { const r = await resolveCategory(call, c); return r === null ? fail("categoría vacía") : r; });
        if (ids instanceof Response) return ids;
        Object.assign(body, { target: "category", targetIds: ids });
      }
      if (Array.isArray(a.productos)) {
        const ids = await resolveAll(a.productos, (p) => resolveProduct(call, p));
        if (ids instanceof Response) return ids;
        Object.assign(body, { target: "product", targetIds: ids });
      }
      return call(cur ? "PUT" : "POST", cur ? `/api/promotions/${cur.id}` : "/api/promotions", body);
    },
  },
  {
    name: "eliminar_promocion", title: "Eliminar una promoción", permission: "promotions:write", write: true, destructive: true,
    description: "Elimina una promoción (para pausarla sin borrarla usa guardar_promocion con activa: false). Pide confirmación antes.",
    inputSchema: obj({ promocion: { type: "string", description: "id o nombre" } }, ["promocion"]),
    run: async (a, call) => {
      const list = await getJson<{ promotions: Promotion[] }>(call, "/api/promotions");
      if (list instanceof Response) return list;
      const key = str(a.promocion);
      const cur = list.promotions.find((p) => p.id === key || p.name.toLowerCase() === key.toLowerCase());
      return cur ? call("DELETE", `/api/promotions/${cur.id}`) : fail(`No existe la promoción «${key}».`, 404);
    },
  },
  {
    name: "guardar_cupon", title: "Crear o editar un cupón", permission: "promotions:write", write: true,
    description: "Crea un cupón de descuento (o cambia uno existente si su código ya existe): por porcentaje o por monto fijo, con compra mínima, límite de usos, canal y fechas.",
    inputSchema: obj({
      codigo: { type: "string", maxLength: 30, description: "Letras, números, guion y guion bajo: VERANO10" },
      descripcion: { type: ["string", "null"], maxLength: 200 },
      tipo: { type: "string", enum: ["porcentaje", "monto"] },
      porcentaje: { type: "number", minimum: 0.01, maximum: 100, description: "Para tipo porcentaje" },
      monto_centavos: CENTS("Para tipo monto: descuento fijo"),
      compra_minima_centavos: CENTS("Compra mínima para usarlo"),
      usos_maximos: { type: ["integer", "null"], minimum: 1 },
      canal: CHANNEL_OPT,
      desde: DATE_OR_NULL,
      hasta: DATE_OR_NULL,
      activo: { type: "boolean" },
    }, ["codigo"]),
    run: async (a, call) => {
      const list = await getJson<{ coupons: Coupon[] }>(call, "/api/promotions");
      if (list instanceof Response) return list;
      const code = str(a.codigo).toUpperCase();
      const cur = list.coupons.find((c) => c.code === code);
      const body: Args = cur
        ? { code, description: cur.description, kind: cur.kind, value: cur.value, minSubtotalCents: cur.minSubtotalCents, maxUses: cur.maxUses, channel: cur.channel, startsOn: cur.startsOn, endsOn: cur.endsOn, active: cur.active }
        : { code, description: null, minSubtotalCents: 0, maxUses: null, channel: "all", startsOn: null, endsOn: null, active: true };
      if (a.tipo !== undefined) body.kind = a.tipo === "monto" ? "amount" : "percent";
      if (a.porcentaje !== undefined) { body.kind = "percent"; body.value = Math.round(Number(a.porcentaje) * 100); }
      if (a.monto_centavos !== undefined) { body.kind = "amount"; body.value = num(a.monto_centavos); }
      if (!cur && body.value === undefined) return fail("Indica el descuento: «porcentaje» o «monto_centavos».");
      put(body, "description", optStr(a.descripcion));
      put(body, "minSubtotalCents", num(a.compra_minima_centavos));
      put(body, "maxUses", a.usos_maximos === undefined ? undefined : a.usos_maximos === null ? null : num(a.usos_maximos));
      put(body, "channel", a.canal === undefined ? undefined : CHANNEL[str(a.canal)]);
      put(body, "startsOn", optStr(a.desde));
      put(body, "endsOn", optStr(a.hasta));
      put(body, "active", a.activo === undefined ? undefined : Boolean(a.activo));
      return call(cur ? "PUT" : "POST", cur ? `/api/promotions/coupons/${cur.id}` : "/api/promotions/coupons", body);
    },
  },
];
