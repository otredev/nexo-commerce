/**
 * MCP tools for inventory beyond single adjustments: movement history, transfers between locations,
 * physical counts, suppliers and purchase orders. Products and places are accepted by SKU/name.
 */
import type { PurchaseOrderDetail, StockCountDetail, Supplier, TransferDetail } from "@nexo/shared";
import {
  asArray, CENTS, DATE, fail, getJson, isId, num, obj, optStr, put, QTY, qs, REF, resolveAll, resolveCategory, resolveLocation, resolveSupplier, resolveVariant, send, str,
  type Args, type Tool,
} from "./mcpKit";

const LINE = (extra: Record<string, unknown> = {}) => ({ type: "array", minItems: 1, maxItems: 300, items: obj({ producto: { type: "string", description: "SKU, código de barras o id de la variante" }, cantidad: QTY("Cantidad"), ...extra }, ["producto", "cantidad"]) });
const LOC = (what: string) => ({ type: "string", description: `${what}: id o nombre. Vacío = la ubicación principal` });
const PAGE = { type: "integer", minimum: 1 };
const enc = encodeURIComponent;

const TRANSFER_STATUS: Record<string, string> = { todos: "all", abiertos: "open", borrador: "draft", enviados: "in_transit", recibidos: "received", cancelados: "cancelled" };
const COUNT_STATUS: Record<string, string> = { todos: "all", abiertos: "in_progress", terminados: "completed", cancelados: "cancelled" };
const PURCHASE_STATUS: Record<string, string> = { todas: "all", abiertas: "open", borrador: "draft", ordenadas: "ordered", parciales: "partial", recibidas: "received", canceladas: "cancelled" };

const SUPPLIER_FIELDS = {
  nombre: { type: "string", maxLength: 120 },
  contacto: { type: ["string", "null"], maxLength: 120 },
  correo: { type: ["string", "null"] },
  telefono: { type: ["string", "null"], maxLength: 32 },
  rfc: { type: ["string", "null"], maxLength: 32, description: "RFC o identificación fiscal" },
  direccion: { type: ["string", "null"], maxLength: 300 },
  dias_de_credito: { type: "integer", minimum: 0, maximum: 365 },
  notas: { type: ["string", "null"], maxLength: 1000 },
  activo: { type: "boolean" },
};
const supplierBody = (a: Args, cur?: Supplier) => {
  const out: Record<string, unknown> = cur
    ? { name: cur.name, contactName: cur.contactName, email: cur.email, phone: cur.phone, taxId: cur.taxId, address: cur.address, paymentTermsDays: cur.paymentTermsDays, notes: cur.notes, active: cur.active }
    : {};
  put(out, "name", a.nombre === undefined ? undefined : str(a.nombre));
  put(out, "contactName", optStr(a.contacto));
  put(out, "email", optStr(a.correo));
  put(out, "phone", optStr(a.telefono));
  put(out, "taxId", optStr(a.rfc));
  put(out, "address", optStr(a.direccion));
  put(out, "paymentTermsDays", num(a.dias_de_credito));
  put(out, "notes", optStr(a.notas));
  put(out, "active", a.activo === undefined ? undefined : Boolean(a.activo));
  return out;
};

const transferSummary = (t: TransferDetail) => ({ ...t, items: t.items.map((i) => ({ linea: i.id, sku: i.sku, producto: i.name, opciones: i.options, cantidad: i.quantity, recibido: i.receivedQuantity, existencia_en_origen: i.originStock })) });
const purchaseSummary = (p: PurchaseOrderDetail) => ({ ...p, items: p.items.map((i) => ({ linea: i.id, sku: i.sku, producto: i.name, opciones: i.options, cantidad: i.quantity, recibido: i.receivedQuantity, costo_unitario_centavos: i.unitCostCents, total_centavos: i.totalCents })) });

/** Finds a line of a transfer/count/purchase by line id, SKU or variant id. */
function lineOf<T extends { id: string; variantId: string; sku: string }>(items: T[], key: unknown): T | undefined {
  const k = str(key);
  return items.find((i) => i.id === k || i.variantId === k || i.sku.toUpperCase() === k.toUpperCase());
}

export const INVENTORY_TOOLS: Tool[] = [
  {
    name: "movimientos_inventario", title: "Historial de movimientos", permission: "inventory:read",
    description: "Entradas, salidas, ventas, traspasos y ajustes de existencias, del más reciente al más viejo. Filtra por producto (SKU) y ubicación. Para la siguiente página manda el «cursor» que devuelve la respuesta.",
    inputSchema: obj({ producto: { type: "string", description: "SKU, código de barras o id de la variante" }, ubicacion: { type: "string", description: "id o nombre" }, cursor: { type: "integer" }, limite: { type: "integer", minimum: 1, maximum: 200 } }),
    run: async (a, call) => {
      const variantId = a.producto === undefined ? undefined : await resolveVariant(call, a.producto);
      if (variantId instanceof Response) return variantId;
      const locationId = a.ubicacion === undefined ? undefined : await resolveLocation(call, a.ubicacion);
      if (locationId instanceof Response) return locationId;
      return call("GET", `/api/inventory/movements${qs({ variantId, locationId, cursor: a.cursor, limit: a.limite ?? 50 })}`);
    },
  },

  /* ---------- Transfers ---------- */
  {
    name: "listar_traspasos", title: "Traspasos entre ubicaciones", permission: "transfers:read",
    description: "Traspasos de mercancía entre ubicaciones (borradores, en camino, recibidos).",
    inputSchema: obj({ estado: { type: "string", enum: Object.keys(TRANSFER_STATUS) }, ubicacion: { type: "string" }, pagina: PAGE }),
    run: async (a, call) => {
      const locationId = a.ubicacion === undefined ? undefined : await resolveLocation(call, a.ubicacion);
      if (locationId instanceof Response) return locationId;
      return call("GET", `/api/transfers${qs({ status: TRANSFER_STATUS[str(a.estado)] ?? "all", locationId, page: a.pagina })}`);
    },
  },
  {
    name: "ver_traspaso", title: "Ver un traspaso", permission: "transfers:read",
    description: "Detalle de un traspaso: productos, cantidades, lo recibido y la existencia en el origen.",
    inputSchema: obj({ traspaso: REF("Traspaso") }, ["traspaso"]),
    run: async (a, call) => { const t = await getJson<TransferDetail>(call, `/api/transfers/${enc(str(a.traspaso))}`); return t instanceof Response ? t : new Response(JSON.stringify(transferSummary(t))); },
  },
  {
    name: "crear_traspaso", title: "Crear un traspaso", permission: "transfers:write", write: true,
    description: "Prepara un traspaso de mercancía de una ubicación a otra. Con enviar: true sale de inmediato (descuenta del origen); si no, queda como borrador. La mercancía entra al destino al recibirlo (recibir_traspaso).",
    inputSchema: obj({ origen: LOC("Ubicación de origen"), destino: { type: "string", description: "Ubicación de destino: id o nombre" }, productos: LINE(), nota: { type: ["string", "null"], maxLength: 500 }, enviar: { type: "boolean" } }, ["destino", "productos"]),
    run: async (a, call) => {
      const from = await resolveLocation(call, a.origen);
      if (from instanceof Response) return from;
      const to = await resolveLocation(call, a.destino);
      if (to instanceof Response) return to;
      const items = await resolveAll(asArray(a.productos), async (l) => { const v = await resolveVariant(call, l.producto); return v instanceof Response ? v : { variantId: v, quantity: num(l.cantidad) }; });
      if (items instanceof Response) return items;
      const res = await call("POST", "/api/transfers", { fromLocationId: from, toLocationId: to, note: optStr(a.nota) ?? null, items });
      if (!res.ok || !a.enviar) return res;
      const created = (await res.json()) as TransferDetail;
      return send<TransferDetail>(call, "POST", `/api/transfers/${created.id}/send`, undefined, transferSummary);
    },
  },
  {
    name: "enviar_traspaso", title: "Enviar un traspaso", permission: "transfers:write", write: true,
    description: "Marca un traspaso en borrador como enviado: la mercancía sale de la ubicación de origen.",
    inputSchema: obj({ traspaso: REF("Traspaso") }, ["traspaso"]),
    run: (a, call) => send<TransferDetail>(call, "POST", `/api/transfers/${enc(str(a.traspaso))}/send`, undefined, transferSummary),
  },
  {
    name: "recibir_traspaso", title: "Recibir un traspaso", permission: "transfers:receive", write: true,
    description: "Registra la llegada de un traspaso enviado: la mercancía entra al destino. Sin «recibido», se recibe todo lo enviado; con «recibido», solo esas cantidades (lo faltante queda como diferencia).",
    inputSchema: obj({ traspaso: REF("Traspaso"), recibido: { type: "array", items: obj({ producto: { type: "string", description: "SKU o id de la línea" }, cantidad: QTY("Cantidad recibida") }, ["producto", "cantidad"]) }, nota: { type: ["string", "null"], maxLength: 500 } }, ["traspaso"]),
    run: async (a, call) => {
      const t = await getJson<TransferDetail>(call, `/api/transfers/${enc(str(a.traspaso))}`);
      if (t instanceof Response) return t;
      const got = asArray(a.recibido);
      const items = got.length
        ? t.items.map((i) => { const g = got.find((x) => lineOf([i], x.producto)); return { itemId: i.id, receivedQuantity: g ? Number(num(g.cantidad) ?? 0) : 0 }; })
        : t.items.map((i) => ({ itemId: i.id, receivedQuantity: i.quantity }));
      const unknown = got.filter((g) => !lineOf(t.items, g.producto));
      if (unknown.length) return fail(`No están en el traspaso: ${unknown.map((u) => str(u.producto)).join(", ")}.`);
      return send<TransferDetail>(call, "POST", `/api/transfers/${t.id}/receive`, { items, note: optStr(a.nota) ?? null }, transferSummary);
    },
  },
  {
    name: "cancelar_traspaso", title: "Cancelar un traspaso", permission: "transfers:write", write: true, destructive: true,
    description: "Cancela un traspaso. Si ya se había enviado, la mercancía regresa al origen. Pide confirmación antes.",
    inputSchema: obj({ traspaso: REF("Traspaso") }, ["traspaso"]),
    run: (a, call) => send<TransferDetail>(call, "POST", `/api/transfers/${enc(str(a.traspaso))}/cancel`, undefined, transferSummary),
  },

  /* ---------- Physical counts ---------- */
  {
    name: "listar_conteos", title: "Conteos físicos", permission: "counts:read",
    description: "Conteos de inventario abiertos y terminados.",
    inputSchema: obj({ estado: { type: "string", enum: Object.keys(COUNT_STATUS) }, ubicacion: { type: "string" }, pagina: PAGE }),
    run: async (a, call) => {
      const locationId = a.ubicacion === undefined ? undefined : await resolveLocation(call, a.ubicacion);
      if (locationId instanceof Response) return locationId;
      return call("GET", `/api/counts${qs({ status: COUNT_STATUS[str(a.estado)] ?? "all", locationId, page: a.pagina })}`);
    },
  },
  {
    name: "ver_conteo", title: "Ver un conteo", permission: "counts:read",
    description: "Detalle de un conteo: lo esperado, lo contado y las diferencias.",
    inputSchema: obj({ conteo: REF("Conteo") }, ["conteo"]),
    run: (a, call) => call("GET", `/api/counts/${enc(str(a.conteo))}`),
  },
  {
    name: "crear_conteo", title: "Iniciar un conteo físico", permission: "counts:write", write: true,
    description: "Empieza un conteo en una ubicación: de todo, de una categoría o solo de los productos que indiques (alcance «manual» con «productos»). Después captura lo contado con capturar_conteo y termínalo con terminar_conteo.",
    inputSchema: obj({
      ubicacion: LOC("Ubicación"),
      alcance: { type: "string", enum: ["todo", "categoria", "manual"] },
      categoria: { type: "string", description: "Para alcance «categoria»: id o nombre" },
      productos: { type: "array", items: { type: "string" }, maxItems: 200, description: "Para alcance «manual»: SKUs o códigos" },
      nota: { type: ["string", "null"], maxLength: 500 },
    }, ["alcance"]),
    run: async (a, call) => {
      const locationId = await resolveLocation(call, a.ubicacion);
      if (locationId instanceof Response) return locationId;
      const scope = ({ todo: "all", categoria: "category", manual: "manual" } as Record<string, string>)[str(a.alcance)];
      if (!scope) return fail("alcance debe ser todo, categoria o manual.");
      const categoryId = scope === "category" ? await resolveCategory(call, a.categoria) : null;
      if (categoryId instanceof Response) return categoryId;
      const variants = scope === "manual" ? await resolveAll(Array.isArray(a.productos) ? a.productos : [], (p) => resolveVariant(call, p)) : [];
      if (variants instanceof Response) return variants;
      if (scope === "manual" && !variants.length) return fail("Para un conteo manual manda los «productos» a contar.");
      const res = await call("POST", "/api/counts", { locationId, scope, categoryId, note: optStr(a.nota) ?? null });
      if (!res.ok || !variants.length) return res;
      const created = (await res.json()) as StockCountDetail;
      return call("POST", `/api/counts/${created.id}/items`, { variantIds: variants });
    },
  },
  {
    name: "capturar_conteo", title: "Capturar cantidades contadas", permission: "counts:count", write: true,
    description: "Registra lo que se contó físicamente de cada producto (por SKU). Puedes llamarla varias veces; cada captura reemplaza la anterior de ese producto. cantidad: null borra la captura.",
    inputSchema: obj({ conteo: REF("Conteo"), conteos: { type: "array", minItems: 1, maxItems: 500, items: obj({ producto: { type: "string", description: "SKU, código de barras o id" }, cantidad: { type: ["number", "null"], minimum: 0 } }, ["producto"]) } }, ["conteo", "conteos"]),
    run: async (a, call) => {
      const count = await getJson<StockCountDetail>(call, `/api/counts/${enc(str(a.conteo))}`);
      if (count instanceof Response) return count;
      const entries: Array<{ itemId: string; countedQuantity: number | null }> = [];
      const missing: string[] = [];
      for (const e of asArray(a.conteos)) {
        let line = lineOf(count.items, e.producto) ?? count.items.find((i) => i.barcode === str(e.producto));
        if (!line && !isId(str(e.producto))) {
          // Not in a manual count yet: add it, then use its new line.
          const v = await resolveVariant(call, e.producto);
          if (v instanceof Response) return v;
          const added = await call("POST", `/api/counts/${count.id}/items`, { variantIds: [v] });
          if (!added.ok) return added;
          line = ((await added.json()) as StockCountDetail).items.find((i) => i.variantId === v);
        }
        if (!line) { missing.push(str(e.producto)); continue; }
        entries.push({ itemId: line.id, countedQuantity: e.cantidad === null ? null : Number(num(e.cantidad) ?? 0) });
      }
      if (missing.length) return fail(`No están en el conteo: ${missing.join(", ")}.`);
      return call("POST", `/api/counts/${count.id}/entries`, { entries });
    },
  },
  {
    name: "terminar_conteo", title: "Terminar un conteo", permission: "counts:write", write: true, destructive: true,
    description: "Cierra el conteo y ajusta las existencias a lo contado. Con poner_en_cero_no_contados: true, lo que nadie contó queda en 0. Revisa las diferencias con ver_conteo y pide confirmación antes.",
    inputSchema: obj({ conteo: REF("Conteo"), poner_en_cero_no_contados: { type: "boolean" } }, ["conteo"]),
    run: (a, call) => call("POST", `/api/counts/${enc(str(a.conteo))}/complete`, { zeroUncounted: Boolean(a.poner_en_cero_no_contados) }),
  },
  {
    name: "cancelar_conteo", title: "Cancelar un conteo", permission: "counts:write", write: true,
    description: "Cancela un conteo abierto sin tocar las existencias.",
    inputSchema: obj({ conteo: REF("Conteo") }, ["conteo"]),
    run: (a, call) => call("POST", `/api/counts/${enc(str(a.conteo))}/cancel`),
  },

  /* ---------- Suppliers ---------- */
  {
    name: "listar_proveedores", title: "Proveedores", permission: "suppliers:read",
    description: "Proveedores con sus datos de contacto, crédito y compras.",
    inputSchema: obj({ texto: { type: "string" }, estado: { type: "string", enum: ["activos", "inactivos", "todos"] } }),
    run: (a, call) => call("GET", `/api/suppliers${qs({ q: str(a.texto), status: ({ activos: "active", inactivos: "inactive", todos: "all" } as Record<string, string>)[str(a.estado)] ?? "active" })}`),
  },
  {
    name: "crear_proveedor", title: "Crear un proveedor", permission: "suppliers:write", write: true,
    description: "Da de alta un proveedor.",
    inputSchema: obj(SUPPLIER_FIELDS, ["nombre"]),
    run: (a, call) => call("POST", "/api/suppliers", supplierBody(a)),
  },
  {
    name: "editar_proveedor", title: "Editar un proveedor", permission: "suppliers:write", write: true,
    description: "Cambia los datos de un proveedor (por id o nombre). Solo cambia lo que mandes; activo: false lo desactiva.",
    inputSchema: obj({ proveedor: { type: "string", description: "id o nombre" }, ...SUPPLIER_FIELDS }, ["proveedor"]),
    run: async (a, call) => {
      const id = await resolveSupplier(call, a.proveedor);
      if (id instanceof Response) return id;
      const cur = await getJson<Supplier>(call, `/api/suppliers/${id}`);
      if (cur instanceof Response) return cur;
      return call("PUT", `/api/suppliers/${id}`, supplierBody(a, cur));
    },
  },

  /* ---------- Purchase orders ---------- */
  {
    name: "listar_compras", title: "Órdenes de compra", permission: "purchases:read",
    description: "Órdenes de compra a proveedores, con su avance de recepción.",
    inputSchema: obj({ estado: { type: "string", enum: Object.keys(PURCHASE_STATUS) }, proveedor: { type: "string" }, texto: { type: "string" }, pagina: PAGE }),
    run: async (a, call) => {
      const supplierId = a.proveedor === undefined ? undefined : await resolveSupplier(call, a.proveedor);
      if (supplierId instanceof Response) return supplierId;
      return call("GET", `/api/purchases${qs({ status: PURCHASE_STATUS[str(a.estado)] ?? "all", supplierId, q: str(a.texto), page: a.pagina })}`);
    },
  },
  {
    name: "ver_compra", title: "Ver una orden de compra", permission: "purchases:read",
    description: "Detalle de una orden de compra: líneas, costos, lo recibido y las recepciones.",
    inputSchema: obj({ compra: REF("Orden de compra") }, ["compra"]),
    run: async (a, call) => { const p = await getJson<PurchaseOrderDetail>(call, `/api/purchases/${enc(str(a.compra))}`); return p instanceof Response ? p : new Response(JSON.stringify(purchaseSummary(p))); },
  },
  {
    name: "sugerir_compra", title: "Qué conviene comprar", permission: "purchases:write",
    description: "Sugerencia de productos a resurtir en una ubicación (los que están en su mínimo o debajo), con cantidades sugeridas.",
    inputSchema: obj({ ubicacion: LOC("Ubicación") }),
    run: async (a, call) => {
      const locationId = await resolveLocation(call, a.ubicacion);
      return locationId instanceof Response ? locationId : call("GET", `/api/purchases/suggestions${qs({ locationId })}`);
    },
  },
  {
    name: "crear_compra", title: "Crear una orden de compra", permission: "purchases:write", write: true,
    description: "Crea una orden de compra a un proveedor (queda en borrador). Con ordenar: true se marca como pedida al proveedor. La mercancía entra al recibirla (recibir_compra).",
    inputSchema: obj({
      proveedor: { type: "string", description: "id o nombre" },
      ubicacion: LOC("Ubicación que recibe"),
      fecha_esperada: DATE,
      nota: { type: ["string", "null"], maxLength: 1000 },
      productos: LINE({ costo_unitario_centavos: CENTS("Costo unitario sin impuestos"), impuesto_porcentaje: { type: "number", minimum: 0, maximum: 100 } }),
      ordenar: { type: "boolean" },
    }, ["proveedor", "productos"]),
    run: async (a, call) => {
      const supplierId = await resolveSupplier(call, a.proveedor);
      if (supplierId instanceof Response) return supplierId;
      const locationId = await resolveLocation(call, a.ubicacion);
      if (locationId instanceof Response) return locationId;
      const items = await resolveAll(asArray(a.productos), async (l) => {
        const v = await resolveVariant(call, l.producto);
        if (v instanceof Response) return v;
        if (l.costo_unitario_centavos === undefined) return fail("falta costo_unitario_centavos");
        return { variantId: v, quantity: num(l.cantidad), unitCostCents: num(l.costo_unitario_centavos), taxRateBps: Math.round(Number(num(l.impuesto_porcentaje) ?? 0) * 100) };
      });
      if (items instanceof Response) return items;
      const res = await call("POST", "/api/purchases", { supplierId, locationId, expectedDate: optStr(a.fecha_esperada) ?? null, note: optStr(a.nota) ?? null, items });
      if (!res.ok || !a.ordenar) return res;
      const created = (await res.json()) as PurchaseOrderDetail;
      return send<PurchaseOrderDetail>(call, "POST", `/api/purchases/${created.id}/order`, undefined, purchaseSummary);
    },
  },
  {
    name: "ordenar_compra", title: "Marcar una compra como pedida", permission: "purchases:write", write: true,
    description: "Pasa una orden de compra en borrador a «pedida» (ya se le pidió al proveedor).",
    inputSchema: obj({ compra: REF("Orden de compra") }, ["compra"]),
    run: (a, call) => send<PurchaseOrderDetail>(call, "POST", `/api/purchases/${enc(str(a.compra))}/order`, undefined, purchaseSummary),
  },
  {
    name: "recibir_compra", title: "Recibir mercancía de una compra", permission: "purchases:receive", write: true,
    description: "Registra la mercancía que llegó de una orden de compra: entra al inventario y actualiza el costo promedio. Sin «recibido», se recibe todo lo pendiente al costo de la orden.",
    inputSchema: obj({
      compra: REF("Orden de compra"),
      recibido: { type: "array", items: obj({ producto: { type: "string", description: "SKU o id de la línea" }, cantidad: QTY("Cantidad que llegó"), costo_unitario_centavos: CENTS("Costo facturado (si cambió)") }, ["producto", "cantidad"]) },
      referencia_proveedor: { type: ["string", "null"], maxLength: 60, description: "Factura o remisión" },
      nota: { type: ["string", "null"], maxLength: 500 },
    }, ["compra"]),
    run: async (a, call) => {
      const p = await getJson<PurchaseOrderDetail>(call, `/api/purchases/${enc(str(a.compra))}`);
      if (p instanceof Response) return p;
      const got = asArray(a.recibido);
      const unknown = got.filter((g) => !lineOf(p.items, g.producto));
      if (unknown.length) return fail(`No están en la orden: ${unknown.map((u) => str(u.producto)).join(", ")}.`);
      const items = (got.length
        ? got.map((g) => { const i = lineOf(p.items, g.producto)!; return { orderItemId: i.id, quantity: Number(num(g.cantidad) ?? 0), unitCostCents: num(g.costo_unitario_centavos) ?? i.unitCostCents }; })
        : p.items.map((i) => ({ orderItemId: i.id, quantity: Math.max(0, i.quantity - i.receivedQuantity), unitCostCents: i.unitCostCents }))
      ).filter((i) => i.quantity > 0);
      if (!items.length) return fail("No hay nada pendiente por recibir en esta orden.");
      return send<PurchaseOrderDetail>(call, "POST", `/api/purchases/${p.id}/receive`, { items, supplierReference: optStr(a.referencia_proveedor) ?? null, note: optStr(a.nota) ?? null }, purchaseSummary);
    },
  },
  {
    name: "cancelar_compra", title: "Cancelar o cerrar una compra", permission: "purchases:write", write: true, destructive: true,
    description: "Cancela una orden sin recepciones, o con cerrar: true cierra una orden parcialmente recibida (lo pendiente ya no llegará). Pide confirmación antes.",
    inputSchema: obj({ compra: REF("Orden de compra"), motivo: { type: "string", maxLength: 300 }, cerrar: { type: "boolean" } }, ["compra", "motivo"]),
    run: (a, call) => send<PurchaseOrderDetail>(call, "POST", `/api/purchases/${enc(str(a.compra))}/${a.cerrar ? "close" : "cancel"}`, { reason: str(a.motivo) }, purchaseSummary),
  },
];
