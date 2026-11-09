/**
 * MCP tools for the catalog: products and their variants, categories (with subcategories), brands and taxes.
 * Products are edited by reading the full product, changing only what was sent and saving it whole with
 * PUT, so validation, SKU/barcode checks and the audit log are exactly the panel's.
 */
import { UNIT_CODES, UNITS, type CategoryItem, type Named, type ProductDetail, type TaxRate } from "@nexo/shared";
import {
  asArray, bool, CENTS, fail, getJson, json200, num, obj, optStr, put, QTY, qs, REF, resolveBrand, resolveCategory, resolveProduct, resolveTax, send, str,
  type Args, type Call, type Tool,
} from "./mcpKit";

/* ---------- Shapes ---------- */

const VARIANT_FIELDS = {
  sku: { type: "string", maxLength: 64, description: "Vacío = lo genera Nexo" },
  codigo_barras: { type: ["string", "null"], maxLength: 64 },
  opciones: { type: "array", items: { type: "string", maxLength: 40 }, maxItems: 3, description: "Valores en el orden de las opciones del producto: [\"M\", \"Negro\"]" },
  precio_centavos: CENTS("Precio de venta con impuestos incluidos (o sin ellos, según la configuración del negocio)"),
  costo_centavos: CENTS("Costo"),
  existencia_minima: QTY("Avisa cuando queda esta cantidad o menos"),
  activa: { type: "boolean", description: "false = no se vende" },
};
const NEW_VARIANT = obj({ ...VARIANT_FIELDS, existencia_inicial: QTY("Solo al crear: cantidad que entra a la ubicación principal") }, ["precio_centavos"]);

const PRODUCT_FIELDS = {
  nombre: { type: "string", maxLength: 160 },
  descripcion: { type: ["string", "null"], maxLength: 5000 },
  categoria: { type: ["string", "null"], description: "id, nombre o «Categoría > Subcategoría». null = sin categoría" },
  marca: { type: ["string", "null"], description: "id o nombre. null = sin marca" },
  impuesto: { type: ["string", "number", "null"], description: "id, nombre o porcentaje (16). null = el impuesto predeterminado" },
  unidad: { type: "string", enum: [...UNIT_CODES], description: UNITS.map((u) => `${u.code} = ${u.label}`).join(", ") },
  controla_inventario: { type: "boolean", description: "false = siempre disponible (servicios, por ejemplo)" },
  en_linea: { type: "boolean", description: "Publicado en la tienda en línea" },
  seo_titulo: { type: ["string", "null"], maxLength: 70 },
  seo_descripcion: { type: ["string", "null"], maxLength: 160 },
  palabras_clave: { type: "array", items: { type: "string", maxLength: 40 }, maxItems: 20, description: "Etiquetas para filtrar en la tienda (#oferta)" },
  imagenes: { type: "array", items: { type: "string" }, maxItems: 8, description: "Claves de imágenes subidas (subir_imagen devuelve la clave «t/…»). La primera es la principal." },
};

const variantIn = (v: Args) => ({
  sku: str(v.sku), barcode: optStr(v.codigo_barras) ?? null, options: Array.isArray(v.opciones) ? v.opciones.map(String) : [],
  priceCents: num(v.precio_centavos), costCents: num(v.costo_centavos) ?? 0, minStock: num(v.existencia_minima) ?? 0,
  ...(v.existencia_inicial !== undefined && { initialStock: num(v.existencia_inicial) }), active: v.activa === undefined ? true : Boolean(v.activa),
});

/** What the assistant gets back about a product (pesos as cents, like every tool). */
const productSummary = (p: ProductDetail) => ({
  id: p.id, nombre: p.name, estado: p.status === "active" ? "activo" : "archivado", en_linea: p.online, categoriaId: p.categoryId, marcaId: p.brandId,
  unidad: p.unit, controla_inventario: p.trackInventory, opciones: p.optionNames, imagenes: p.images, palabras_clave: p.keywords,
  variantes: p.variants.map((v) => ({ id: v.id, sku: v.sku, codigo_barras: v.barcode, opciones: v.options, precio_centavos: v.priceCents, costo_centavos: v.costCents, existencia: v.stock, existencia_minima: v.minStock, activa: v.active })),
});

/** Lets name-based fields resolve, then fills the API's product input. */
async function productFields(call: Call, a: Args, out: Record<string, unknown>): Promise<Response | null> {
  if (a.categoria !== undefined) { const r = await resolveCategory(call, a.categoria); if (r instanceof Response) return r; out.categoryId = r; }
  if (a.marca !== undefined) { const r = await resolveBrand(call, a.marca); if (r instanceof Response) return r; out.brandId = r; }
  if (a.impuesto !== undefined) { const r = await resolveTax(call, a.impuesto); if (r instanceof Response) return r; out.taxRateId = r; }
  put(out, "name", a.nombre === undefined ? undefined : str(a.nombre));
  put(out, "description", optStr(a.descripcion));
  put(out, "unit", a.unidad);
  put(out, "trackInventory", bool(a.controla_inventario));
  put(out, "online", bool(a.en_linea));
  put(out, "seoTitle", optStr(a.seo_titulo));
  put(out, "seoDescription", optStr(a.seo_descripcion));
  put(out, "keywords", a.palabras_clave);
  put(out, "images", a.imagenes);
  return null;
}

const named = () => (n: Named | CategoryItem) => ({ id: n.id, nombre: n.name, productos: n.productCount, ...("parentId" in n && { dentro_de: n.parentId }) });

/* ---------- Tools ---------- */

export const CATALOG_TOOLS: Tool[] = [
  {
    name: "crear_producto", title: "Crear un producto", permission: "catalog:write", write: true,
    description:
      "Da de alta un producto. Sencillo: manda precio_centavos (y si quieres sku, codigo_barras, costo_centavos, existencia_inicial) sin «variantes». " +
      "Con opciones (talla, color…): manda «opciones» con sus nombres y una variante por combinación. Categoría, marca e impuesto se aceptan por nombre. " +
      "Las imágenes se suben antes con subir_imagen.",
    inputSchema: obj({
      ...PRODUCT_FIELDS,
      opciones: { type: "array", items: { type: "string", maxLength: 30 }, maxItems: 3, description: "Nombres de las opciones: [\"Talla\", \"Color\"]" },
      variantes: { type: "array", items: NEW_VARIANT, minItems: 1, maxItems: 100 },
      sku: VARIANT_FIELDS.sku,
      codigo_barras: VARIANT_FIELDS.codigo_barras,
      precio_centavos: VARIANT_FIELDS.precio_centavos,
      costo_centavos: VARIANT_FIELDS.costo_centavos,
      existencia_minima: VARIANT_FIELDS.existencia_minima,
      existencia_inicial: QTY("Producto sencillo: cantidad inicial en la ubicación principal"),
    }, ["nombre"]),
    run: async (a, call) => {
      const out: Record<string, unknown> = { optionNames: Array.isArray(a.opciones) ? a.opciones.map(String) : [] };
      const problem = await productFields(call, a, out);
      if (problem) return problem;
      const variants = asArray(a.variantes);
      if (variants.length) out.variants = variants.map(variantIn);
      else if (a.precio_centavos === undefined) return fail("Falta el precio: manda precio_centavos (producto sencillo) o «variantes».");
      else out.variants = [{ ...variantIn(a), options: [] }];
      return send<ProductDetail>(call, "POST", "/api/products", out, productSummary);
    },
  },
  {
    name: "editar_producto", title: "Editar un producto", permission: "catalog:write", write: true,
    description:
      "Cambia un producto (por id, SKU o nombre exacto): datos generales, publicación en la tienda, imágenes, palabras clave y sus variantes. Solo cambia lo que mandes. " +
      "«cambiar_variantes» ajusta variantes existentes (por id o SKU). «agregar_variantes» suma combinaciones nuevas. «variantes» reemplaza la lista completa (las que no incluyas, con su id, se eliminan). " +
      "Las existencias no se cambian aquí: usa ajustar_existencias.",
    inputSchema: obj({
      producto: REF("Producto", ", SKU o nombre exacto"),
      ...PRODUCT_FIELDS,
      opciones: { type: "array", items: { type: "string", maxLength: 30 }, maxItems: 3, description: "Nombres de las opciones; si cambias cuántas son, manda también «variantes»" },
      cambiar_variantes: { type: "array", items: obj({ variante: { type: "string", description: "id o SKU" }, ...VARIANT_FIELDS }, ["variante"]), maxItems: 100 },
      agregar_variantes: { type: "array", items: obj(VARIANT_FIELDS, ["precio_centavos"]), maxItems: 100 },
      variantes: { type: "array", items: obj({ id: { type: "string", description: "Para conservar una variante existente" }, ...VARIANT_FIELDS }, ["precio_centavos"]), maxItems: 100 },
    }, ["producto"]),
    run: async (a, call) => {
      const id = await resolveProduct(call, a.producto);
      if (id instanceof Response) return id;
      const p = await getJson<ProductDetail>(call, `/api/products/${encodeURIComponent(id)}`);
      if (p instanceof Response) return p;
      if (p.variants.some((v) => v.costCents === null)) return fail("Esta llave no puede ver costos: no puede editar productos sin borrar sus costos.", 403);
      const out: Record<string, unknown> = {
        name: p.name, description: p.description, categoryId: p.categoryId, brandId: p.brandId, taxRateId: p.taxRateId, unit: p.unit, trackInventory: p.trackInventory,
        online: p.online, seoTitle: p.seoTitle, seoDescription: p.seoDescription, optionNames: p.optionNames, images: p.images, keywords: p.keywords,
      };
      const problem = await productFields(call, a, out);
      if (problem) return problem;
      put(out, "optionNames", Array.isArray(a.opciones) ? a.opciones.map(String) : undefined);
      let variants: Array<Record<string, unknown>> = p.variants.map((v) => ({ id: v.id, sku: v.sku, barcode: v.barcode, options: v.options, priceCents: v.priceCents, costCents: v.costCents ?? 0, minStock: v.minStock, active: v.active }));
      if (a.variantes !== undefined) {
        variants = asArray(a.variantes).map((v) => {
          const keep = typeof v.id === "string" ? variants.find((x) => x.id === v.id) : undefined;
          const { initialStock: _ignored, ...fresh } = variantIn(v);
          return keep ? { ...keep, ...Object.fromEntries(Object.entries(patchOf(v)).filter(([, x]) => x !== undefined)) } : fresh;
        });
      }
      for (const ch of asArray(a.cambiar_variantes)) {
        const key = str(ch.variante).toUpperCase();
        const target = variants.find((v) => v.id === str(ch.variante) || String(v.sku).toUpperCase() === key);
        if (!target) return fail(`El producto no tiene la variante «${str(ch.variante)}». Variantes: ${p.variants.map((v) => `${v.sku}${v.options.length ? ` (${v.options.join(" / ")})` : ""}`).join(", ")}.`, 404);
        Object.assign(target, Object.fromEntries(Object.entries(patchOf(ch)).filter(([, x]) => x !== undefined)));
      }
      for (const nv of asArray(a.agregar_variantes)) { const { initialStock: _ignored, ...fresh } = variantIn(nv); variants.push(fresh); }
      out.variants = variants;
      return send<ProductDetail>(call, "PUT", `/api/products/${encodeURIComponent(id)}`, out, productSummary);
    },
  },
  {
    name: "archivar_producto", title: "Archivar o restaurar un producto", permission: "catalog:write", write: true,
    description: "Archivar oculta el producto de la caja y la tienda sin borrar su historial (ventas, movimientos). restaurar: true lo vuelve a activar.",
    inputSchema: obj({ producto: REF("Producto", ", SKU o nombre exacto"), restaurar: { type: "boolean" } }, ["producto"]),
    run: async (a, call) => {
      const id = await resolveProduct(call, a.producto);
      if (id instanceof Response) return id;
      return call("POST", `/api/products/${encodeURIComponent(id)}/${a.restaurar ? "restore" : "archive"}`);
    },
  },
  {
    name: "eliminar_producto", title: "Eliminar un producto", permission: "catalog:write", write: true, destructive: true,
    description: "Elimina un producto. Si ya tiene ventas o movimientos, conviene archivarlo (archivar_producto). Pide confirmación antes.",
    inputSchema: obj({ producto: REF("Producto", ", SKU o nombre exacto") }, ["producto"]),
    run: async (a, call) => {
      const id = await resolveProduct(call, a.producto);
      if (id instanceof Response) return id;
      return call("DELETE", `/api/products/${encodeURIComponent(id)}`);
    },
  },

  /* ---------- Categories ---------- */
  {
    name: "listar_categorias", title: "Categorías y subcategorías", permission: "catalog:read",
    description: "Todas las categorías con sus subcategorías y cuántos productos tiene cada una.",
    inputSchema: obj({}),
    run: async (_a, call) => {
      const all = await getJson<CategoryItem[]>(call, "/api/categories");
      if (all instanceof Response) return all;
      return json200(all.filter((c) => !c.parentId).map((c) => ({ ...named()(c), subcategorias: all.filter((s) => s.parentId === c.id).map(named()) })));
    },
  },
  {
    name: "crear_categoria", title: "Crear una categoría", permission: "catalog:write", write: true,
    description: "Crea una categoría o, con «dentro_de», una subcategoría (un solo nivel). Para crear varias, llámala una vez por cada una.",
    inputSchema: obj({ nombre: { type: "string", maxLength: 80 }, dentro_de: { type: ["string", "null"], description: "Categoría principal (id o nombre) para crearla como subcategoría" } }, ["nombre"]),
    run: async (a, call) => {
      const parent = await resolveCategory(call, a.dentro_de);
      if (parent instanceof Response) return parent;
      return send<CategoryItem>(call, "POST", "/api/categories", { name: str(a.nombre), parentId: parent }, named());
    },
  },
  {
    name: "editar_categoria", title: "Renombrar o mover una categoría", permission: "catalog:write", write: true,
    description: "Cambia el nombre de una categoría o la mueve: «dentro_de» la vuelve subcategoría de otra; dentro_de: null la vuelve principal.",
    inputSchema: obj({ categoria: { type: "string", description: "id, nombre o «Categoría > Subcategoría»" }, nombre: { type: "string", maxLength: 80 }, dentro_de: { type: ["string", "null"] } }, ["categoria"]),
    run: async (a, call) => {
      const id = await resolveCategory(call, a.categoria);
      if (id instanceof Response) return id;
      if (!id) return fail("Indica la categoría.");
      const all = await getJson<CategoryItem[]>(call, "/api/categories");
      if (all instanceof Response) return all;
      const cur = all.find((c) => c.id === id);
      if (!cur) return fail("No existe esa categoría.", 404);
      let parentId = cur.parentId;
      if (a.dentro_de !== undefined) { const r = await resolveCategory(call, a.dentro_de); if (r instanceof Response) return r; parentId = r; }
      return send<CategoryItem>(call, "PUT", `/api/categories/${id}`, { name: a.nombre === undefined ? cur.name : str(a.nombre), parentId }, (c) => ({ id, nombre: c.name, dentro_de: parentId }));
    },
  },
  {
    name: "eliminar_categoria", title: "Eliminar una categoría", permission: "catalog:write", write: true, destructive: true,
    description: "Elimina una categoría. Sus productos quedan sin categoría (no se borran). Pide confirmación antes.",
    inputSchema: obj({ categoria: { type: "string", description: "id, nombre o «Categoría > Subcategoría»" } }, ["categoria"]),
    run: async (a, call) => {
      const id = await resolveCategory(call, a.categoria);
      if (id instanceof Response) return id;
      return id ? call("DELETE", `/api/categories/${id}`) : fail("Indica la categoría.");
    },
  },

  /* ---------- Brands ---------- */
  {
    name: "listar_marcas", title: "Marcas", permission: "catalog:read",
    description: "Todas las marcas y cuántos productos tiene cada una.",
    inputSchema: obj({}),
    run: async (_a, call) => {
      const all = await getJson<Named[]>(call, "/api/brands");
      return all instanceof Response ? all : json200(all.map(named()));
    },
  },
  {
    name: "crear_marca", title: "Crear una marca", permission: "catalog:write", write: true,
    description: "Da de alta una marca para asignarla a tus productos.",
    inputSchema: obj({ nombre: { type: "string", maxLength: 80 } }, ["nombre"]),
    run: (a, call) => send<Named>(call, "POST", "/api/brands", { name: str(a.nombre) }, named()),
  },
  {
    name: "editar_marca", title: "Renombrar una marca", permission: "catalog:write", write: true,
    description: "Cambia el nombre de una marca (sus productos la conservan).",
    inputSchema: obj({ marca: { type: "string", description: "id o nombre actual" }, nombre: { type: "string", maxLength: 80 } }, ["marca", "nombre"]),
    run: async (a, call) => {
      const id = await resolveBrand(call, a.marca);
      if (id instanceof Response) return id;
      return id ? send<Named>(call, "PUT", `/api/brands/${id}`, { name: str(a.nombre) }, (b) => ({ id, nombre: b.name })) : fail("Indica la marca.");
    },
  },
  {
    name: "eliminar_marca", title: "Eliminar una marca", permission: "catalog:write", write: true, destructive: true,
    description: "Elimina una marca. Sus productos quedan sin marca (no se borran). Pide confirmación antes.",
    inputSchema: obj({ marca: { type: "string", description: "id o nombre" } }, ["marca"]),
    run: async (a, call) => {
      const id = await resolveBrand(call, a.marca);
      if (id instanceof Response) return id;
      return id ? call("DELETE", `/api/brands/${id}`) : fail("Indica la marca.");
    },
  },

  /* ---------- Taxes ---------- */
  {
    name: "listar_impuestos", title: "Impuestos", permission: "catalog:read",
    description: "Los impuestos del negocio (IVA, etc.) con su porcentaje y cuál es el predeterminado.",
    inputSchema: obj({}),
    run: async (_a, call) => {
      const all = await getJson<TaxRate[]>(call, "/api/taxes");
      return all instanceof Response ? all : json200(all.map((t) => ({ id: t.id, nombre: t.name, porcentaje: t.rateBps / 100, predeterminado: t.isDefault, activo: t.active })));
    },
  },
  {
    name: "guardar_impuesto", title: "Crear o editar un impuesto", permission: "taxes:write", write: true,
    description: "Crea un impuesto, o cambia uno existente si mandas «impuesto». Cambiar un porcentaje afecta las ventas futuras de los productos que lo usan.",
    inputSchema: obj({
      impuesto: { type: "string", description: "id o nombre del impuesto a cambiar. Vacío = crear uno nuevo" },
      nombre: { type: "string", maxLength: 60 },
      porcentaje: { type: "number", minimum: 0, maximum: 100 },
      predeterminado: { type: "boolean" },
      activo: { type: "boolean" },
    }),
    run: async (a, call) => {
      const all = await getJson<TaxRate[]>(call, "/api/taxes");
      if (all instanceof Response) return all;
      let cur: TaxRate | undefined;
      if (a.impuesto !== undefined && str(a.impuesto)) {
        const id = await resolveTax(call, a.impuesto);
        if (id instanceof Response) return id;
        cur = all.find((t) => t.id === id);
      }
      const body = {
        name: a.nombre === undefined ? cur?.name : str(a.nombre),
        rateBps: a.porcentaje === undefined ? cur?.rateBps : Math.round(Number(a.porcentaje) * 100),
        isDefault: a.predeterminado === undefined ? (cur?.isDefault ?? false) : Boolean(a.predeterminado),
        active: a.activo === undefined ? (cur?.active ?? true) : Boolean(a.activo),
      };
      if (!body.name || body.rateBps === undefined) return fail("Para crear un impuesto manda nombre y porcentaje.");
      return send<TaxRate>(call, cur ? "PUT" : "POST", cur ? `/api/taxes/${cur.id}` : "/api/taxes", body, (t) => ({ id: t?.id ?? cur?.id, nombre: body.name, porcentaje: body.rateBps! / 100, predeterminado: body.isDefault }));
    },
  },
  {
    name: "palabras_clave", title: "Palabras clave en uso", permission: "catalog:read",
    description: "Las palabras clave (#etiquetas) que ya usan tus productos, con cuántos productos tiene cada una.",
    inputSchema: obj({}),
    run: (_a, call) => call("GET", `/api/products/keywords${qs({})}`),
  },
];

/** A variant patch from the assistant's fields (undefined = keep). */
function patchOf(v: Args) {
  return {
    sku: v.sku === undefined ? undefined : str(v.sku),
    barcode: optStr(v.codigo_barras),
    options: Array.isArray(v.opciones) ? v.opciones.map(String) : undefined,
    priceCents: num(v.precio_centavos),
    costCents: num(v.costo_centavos),
    minStock: num(v.existencia_minima),
    active: bool(v.activa),
  };
}
