/**
 * PUBLIC API of the online store: /api/store/:slug/...
 * No session. Only published products of businesses whose store is enabled.
 */
import { Hono, type Context } from "hono";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { control, controlDb, tenant } from "@nexo/db";
import {
  businessDate,
  effectivePlan,
  planOf,
  couponProblem,
  displayPrice,
  normalizeCode,
  priceCart,
  promotionFor,
  promoUnitPrice,
  formatMoney,
  formatQty,
  fromMilli,
  LOW_STOCK_BADGE,
  normalizeSearch,
  publicAppearance,
  quantityFitsUnit,
  shippingFor,
  storeOrderSchema,
  toMilli,
  unitInfo,
  type StoreInfo,
  type StoreProduct,
  type StoreProductCard,
  type UnitCode,
} from "@nexo/shared";
import type { AppEnv, TenantRef } from "../env";
import { newId, randomToken } from "../lib/crypto";
import { AppError } from "../lib/errors";
import { chunk, isCheckError, isStockCheckError, isUniqueError, movementStatements, toStatement } from "../lib/inventory";
import { cancelStatements, loadOrderRows, notifyOrder, sendOrderEmail, toPublicOrder } from "../lib/orders";
import { couponUseStatement, customerForOrder, findCoupon, livePromotions, toCouponRule } from "../lib/pricing";
import { getTenantDb } from "../lib/tenant";
import { loadAppearance } from "../lib/appearance";
import { createOrderCheckout, markOrderPaid, notifyPaid, type CheckoutSession } from "../lib/cardPayments";
import { stripe, stripeConfigured } from "../lib/stripe";
import { recordStoreEvent, STORE_EVENT_TYPES } from "../lib/events";
import { json } from "../lib/validate";

const { storeSettings, businessSettings, products, variants, taxRates, categories, brands, orders, orderItems, stockLevels, auditLog, storePolicies } = tenant;

/** Published legal pages and their current version. */
async function publishedPolicies(db: Awaited<ReturnType<typeof resolveStore>>["db"], tenantId: string) {
  return db
    .select({ kind: storePolicies.kind, version: storePolicies.version, content: storePolicies.content, updatedAt: storePolicies.updatedAt })
    .from(storePolicies)
    .where(and(eq(storePolicies.tenantId, tenantId), eq(storePolicies.published, true)));
}

/** The store's own domain, when it has an active one. */
async function activeDomain(c: Context<AppEnv>, tenantId: string) {
  const row = await controlDb(c.env.DB_CONTROL)
    .select({ hostname: control.tenantDomains.hostname })
    .from(control.tenantDomains)
    .where(and(eq(control.tenantDomains.tenantId, tenantId), eq(control.tenantDomains.status, "active")))
    .get();
  return row?.hostname ?? null;
}

/**
 * Public base URL of the store for links that leave it (Stripe return pages): the customer's own domain
 * when the request came from an active one, otherwise STORE_URL/slug.
 */
async function storeBase(c: Context<AppEnv>, t: TenantRef) {
  const fallback = `${c.env.STORE_URL.replace(/\/$/, "")}/${t.slug}`;
  const origin = c.req.header("origin") ?? c.req.header("x-nexo-store-origin");
  if (!origin) return fallback;
  let host: string;
  try { host = new URL(origin).hostname.toLowerCase(); } catch { return fallback; }
  const domain = await controlDb(c.env.DB_CONTROL)
    .select({ tenantId: control.tenantDomains.tenantId, status: control.tenantDomains.status })
    .from(control.tenantDomains)
    .where(eq(control.tenantDomains.hostname, host))
    .get();
  return domain?.tenantId === t.id && domain.status === "active" ? `https://${host}` : fallback;
}

const notFound = () => new AppError(404, "store_not_found", "Esta tienda no existe o no está disponible.");

/** Resolves the business behind a store slug, with its settings. 404 when missing or disabled. */
async function resolveStore(c: Context<AppEnv>) {
  const slug = c.req.param("slug")?.toLowerCase() ?? "";
  if (!/^[a-z0-9-]{1,60}$/.test(slug)) throw notFound();
  const t = await controlDb(c.env.DB_CONTROL)
    .select({
      id: control.tenants.id, slug: control.tenants.slug, name: control.tenants.name, dbBinding: control.tenants.dbBinding, status: control.tenants.status,
      plan: control.tenants.plan, planStatus: control.tenants.planStatus, stripeAccountId: control.tenants.stripeAccountId, chargesEnabled: control.tenants.stripeChargesEnabled,
    })
    .from(control.tenants)
    .where(eq(control.tenants.slug, slug))
    .get();
  if (!t || t.status !== "active") throw notFound();
  const ref: TenantRef = { id: t.id, slug: t.slug, name: t.name, dbBinding: t.dbBinding };
  const { db, d1 } = getTenantDb(c.env, ref);
  const [store, biz] = await Promise.all([
    db.select().from(storeSettings).where(eq(storeSettings.tenantId, t.id)).get(),
    db.select().from(businessSettings).where(eq(businessSettings.tenantId, t.id)).get(),
  ]);
  if (!store?.enabled || !store.locationId || !biz) throw notFound();
  const today = businessDate(biz.timezone);
  // Card payments: enabled by the business, allowed by its plan, and its Stripe account can charge.
  const cardAccount =
    store.cardEnabled && t.stripeAccountId && t.chargesEnabled && planOf(effectivePlan(t.plan, t.planStatus)).limits.cardPayments && stripeConfigured(c.env) ? t.stripeAccountId : null;
  return { tenant: ref, db, d1, store: { ...store, locationId: store.locationId }, biz, today, cardAccount };
}

/** Tax rate of each product: its own or the business default. */
async function taxResolver(db: Awaited<ReturnType<typeof resolveStore>>["db"], tenantId: string) {
  const rates = await db.select().from(taxRates).where(eq(taxRates.tenantId, tenantId));
  const def = rates.find((r) => r.isDefault)?.rateBps ?? 0;
  return (taxRateId: string | null) => (taxRateId ? (rates.find((r) => r.id === taxRateId)?.rateBps ?? def) : def);
}

const PUBLISHED = "p.tenant_id = ?1 AND p.online = 1 AND p.status = 'active' AND p.deleted_at IS NULL AND EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND v.active = 1 AND v.deleted_at IS NULL)";

const listQuery = z.object({
  q: z.string().max(100).optional(),
  categoryId: z.string().max(40).optional(),
  sort: z.enum(["featured", "new", "price_asc", "price_desc", "name"]).default("featured"),
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(24),
});

const short = { "Cache-Control": "public, max-age=30" };

const eventSchema = z.object({
  type: z.enum(STORE_EVENT_TYPES).exclude(["order_placed"]),
  path: z.string().max(300),
  referrer: z.string().max(500).nullable().optional(),
  productId: z.string().max(40).nullable().optional(),
  utm: z.object({ source: z.string().max(100).nullable().optional(), medium: z.string().max(100).nullable().optional(), campaign: z.string().max(100).nullable().optional() }).nullable().optional(),
});

export const storeRoutes = new Hono<AppEnv>()
  /* ---------- Store front: name, logo, rules, categories ---------- */
  .get("/:slug", async (c) => {
    const { tenant: t, d1, db, store, biz, today, cardAccount } = await resolveStore(c);
    const { results: cats } = await d1
      .prepare(
        `SELECT c.id, c.name, COUNT(p.id) AS count FROM categories c JOIN products p ON p.category_id = c.id AND ${PUBLISHED.replaceAll("p.tenant_id = ?1", "p.tenant_id = c.tenant_id")}
         WHERE c.tenant_id = ?1 GROUP BY c.id ORDER BY c.name COLLATE NOCASE`,
      )
      .bind(t.id)
      .all<{ id: string; name: string; count: number }>();
    const location = await d1.prepare("SELECT name, address FROM locations WHERE id = ?1").bind(store.locationId).first<{ name: string; address: string | null }>();
    const [promotions, appearance] = await Promise.all([livePromotions(db, t.id, today, "online"), loadAppearance(db, t.id)]);
    const coupon = await d1
      .prepare("SELECT 1 AS ok FROM coupons WHERE tenant_id = ?1 AND active = 1 AND channel IN ('all', 'online') AND (ends_on IS NULL OR ends_on >= ?2) LIMIT 1")
      .bind(t.id, today)
      .first<{ ok: number }>();
    const body: StoreInfo = {
      slug: t.slug,
      name: biz.tradeName,
      tagline: store.tagline,
      about: store.about,
      logo: biz.logoKey,
      currency: biz.currency,
      locale: biz.locale,
      pricesIncludeTax: biz.pricesIncludeTax,
      phone: biz.phone,
      email: biz.email,
      address: biz.address,
      whatsapp: store.whatsapp,
      pickupEnabled: store.pickupEnabled,
      pickupInstructions: store.pickupInstructions,
      pickupAddress: location?.address ?? biz.address,
      deliveryEnabled: store.deliveryEnabled,
      deliveryFeeCents: store.deliveryFeeCents,
      freeDeliveryFromCents: store.freeDeliveryFromCents,
      deliveryArea: store.deliveryArea,
      minOrderCents: store.minOrderCents,
      payOnDelivery: store.payOnDelivery,
      transferEnabled: store.transferEnabled,
      cardEnabled: Boolean(cardAccount),
      categories: cats,
      promotions,
      couponsEnabled: Boolean(coupon),
      faq: store.faq,
      policies: (await publishedPolicies(db, t.id)).map((p) => ({ kind: p.kind, version: p.version })),
      seoTitle: store.seoTitle,
      seoDescription: store.seoDescription,
      indexable: store.indexable,
      domain: await activeDomain(c, t.id),
      appearance: publicAppearance(appearance, today),
    };
    return c.json(body, 200, short);
  })

  /* ---------- Catalog ---------- */
  .get("/:slug/products", async (c) => {
    const query = listQuery.parse(c.req.query());
    const { tenant: t, d1, db, store, biz, today } = await resolveStore(c);
    const promos = await livePromotions(db, t.id, today, "online");
    const params: unknown[] = [t.id];
    const add = (v: unknown) => { params.push(v); return `?${params.length}`; };
    const where = [PUBLISHED];
    if (query.q?.trim()) {
      where.push(`instr(p.search_text, ${add(normalizeSearch(query.q))}) > 0`);
    }
    if (query.categoryId) where.push(`p.category_id = ${add(query.categoryId)}`);
    const minPrice = "(SELECT MIN(price_cents) FROM variants v WHERE v.product_id = p.id AND v.active = 1 AND v.deleted_at IS NULL)";
    const order = {
      featured: "p.updated_at DESC",
      new: "p.created_at DESC",
      price_asc: `${minPrice} ASC`,
      price_desc: `${minPrice} DESC`,
      name: "p.name COLLATE NOCASE",
    }[query.sort];
    const from = `FROM products p WHERE ${where.join(" AND ")}`;
    const [count, rows] = await d1.batch([
      d1.prepare(`SELECT COUNT(*) AS total ${from}`).bind(...params),
      d1.prepare(`SELECT p.id, p.name, p.images, p.category_id, p.tax_rate_id, p.track_inventory ${from} ORDER BY ${order}, p.id LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`).bind(...params),
    ]);
    const list = rows!.results as Array<{ id: string; name: string; images: string; category_id: string | null; tax_rate_id: string | null; track_inventory: number }>;
    const rateOf = await taxResolver(db, t.id);
    const vs: Array<{ productId: string; price: number; qty: number | null }> = [];
    for (const part of chunk(list.map((p) => p.id), 80)) {
      vs.push(
        ...(await db
          .select({ productId: variants.productId, price: variants.priceCents, qty: stockLevels.quantity })
          .from(variants)
          .leftJoin(stockLevels, and(eq(stockLevels.variantId, variants.id), eq(stockLevels.locationId, store.locationId)))
          .where(and(eq(variants.tenantId, t.id), inArray(variants.productId, part), eq(variants.active, true), isNull(variants.deletedAt)))),
      );
    }
    const items: StoreProductCard[] = list.map((p) => {
      const own = vs.filter((v) => v.productId === p.id);
      const rate = rateOf(p.tax_rate_id);
      const promo = promotionFor(promos, p.id, p.category_id);
      const regular = own.map((v) => displayPrice(v.price, rate, biz.pricesIncludeTax));
      const prices = regular.map((v) => promoUnitPrice(v, promo));
      const stock = own.reduce((a, v) => a + Math.max(v.qty ?? 0, 0), 0);
      const tracked = Boolean(p.track_inventory);
      return {
        id: p.id,
        name: p.name,
        image: (JSON.parse(p.images) as string[])[0] ?? null,
        categoryId: p.category_id,
        fromPriceCents: Math.min(...prices),
        compareAtCents: promo ? Math.min(...regular) : null,
        priceVaries: new Set(prices).size > 1,
        soldOut: tracked && stock <= 0,
        lowStock: tracked && stock > 0 && stock <= LOW_STOCK_BADGE * 1000,
      };
    });
    return c.json({ items, total: (count!.results[0] as { total: number }).total, page: query.page, pageSize: query.pageSize }, 200, short);
  })

  .get("/:slug/products/:id", async (c) => {
    const { tenant: t, db, store, biz, today } = await resolveStore(c);
    const p = await db
      .select()
      .from(products)
      .where(and(eq(products.id, c.req.param("id")), eq(products.tenantId, t.id), eq(products.online, true), eq(products.status, "active"), isNull(products.deletedAt)))
      .get();
    if (!p) throw new AppError(404, "not_found", "Este producto ya no está disponible.");
    const [vs, cat, brand, rateOf] = await Promise.all([
      db
        .select({ id: variants.id, options: variants.options, sku: variants.sku, price: variants.priceCents, qty: stockLevels.quantity, position: variants.position })
        .from(variants)
        .leftJoin(stockLevels, and(eq(stockLevels.variantId, variants.id), eq(stockLevels.locationId, store.locationId)))
        .where(and(eq(variants.productId, p.id), eq(variants.active, true), isNull(variants.deletedAt))),
      p.categoryId ? db.select({ name: categories.name }).from(categories).where(eq(categories.id, p.categoryId)).get() : undefined,
      p.brandId ? db.select({ name: brands.name }).from(brands).where(eq(brands.id, p.brandId)).get() : undefined,
      taxResolver(db, t.id),
    ]);
    if (!vs.length) throw new AppError(404, "not_found", "Este producto ya no está disponible.");
    const rate = rateOf(p.taxRateId);
    const promo = promotionFor(await livePromotions(db, t.id, today, "online"), p.id, p.categoryId);
    vs.sort((a, b) => a.position - b.position);
    const body: StoreProduct = {
      id: p.id,
      name: p.name,
      description: p.description,
      images: p.images,
      categoryId: p.categoryId,
      categoryName: cat?.name ?? null,
      brandName: brand?.name ?? null,
      unit: p.unit as UnitCode,
      optionNames: p.optionNames,
      taxRateBps: rate,
      promotion: promo ? { id: promo.id, name: promo.name, percentBps: promo.percentBps } : null,
      seoTitle: p.seoTitle,
      seoDescription: p.seoDescription,
      updatedAt: p.updatedAt,
      variants: vs.map((v) => ({
        id: v.id,
        options: v.options,
        sku: v.sku,
        priceCents: v.price,
        displayPriceCents: displayPrice(v.price, rate, biz.pricesIncludeTax),
        available: p.trackInventory ? fromMilli(Math.max(v.qty ?? 0, 0)) : null,
      })),
    };
    return c.json(body, 200, short);
  })

  /* ---------- Checkout: one atomic batch that reserves the stock ---------- */
  .post("/:slug/orders", json(storeOrderSchema), async (c) => {
    const input = c.req.valid("json");
    const { tenant: t, db, d1, store, biz, today, cardAccount } = await resolveStore(c);
    const ip = c.req.header("cf-connecting-ip") ?? null;

    const existing = await db.select({ token: orders.token, number: orders.number }).from(orders).where(and(eq(orders.tenantId, t.id), eq(orders.clientId, input.clientId))).get();
    if (existing) return c.json(existing, 200);
    if (ip) {
      const recent = await d1
        .prepare("SELECT COUNT(*) AS n FROM orders WHERE tenant_id = ?1 AND ip = ?2 AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour')")
        .bind(t.id, ip)
        .first<{ n: number }>();
      if ((recent?.n ?? 0) >= 10) throw new AppError(429, "too_many_orders", "Hiciste muchos pedidos en poco tiempo. Intenta más tarde o contáctanos.");
    }
    if (input.fulfillment === "pickup" && !store.pickupEnabled) throw new AppError(422, "validation_error", "Revisa los campos marcados", { fulfillment: "Esta tienda no tiene recogida en tienda" });
    if (input.fulfillment === "delivery" && !store.deliveryEnabled) throw new AppError(422, "validation_error", "Revisa los campos marcados", { fulfillment: "Esta tienda no hace envíos" });
    if (input.paymentMethod === "on_delivery" && !store.payOnDelivery) throw new AppError(422, "validation_error", "Revisa los campos marcados", { paymentMethod: "Elige otra forma de pago" });
    if (input.paymentMethod === "transfer" && !store.transferEnabled) throw new AppError(422, "validation_error", "Revisa los campos marcados", { paymentMethod: "Elige otra forma de pago" });
    if (input.paymentMethod === "card" && !cardAccount) throw new AppError(422, "validation_error", "El pago con tarjeta no está disponible ahora. Elige otra forma de pago.", { paymentMethod: "Elige otra forma de pago" });

    // Terms and privacy notice: when the store publishes them, the customer must accept the current versions.
    const legal = (await publishedPolicies(db, t.id)).filter((p) => p.kind !== "returns");
    const termsVersion = legal.find((p) => p.kind === "terms")?.version ?? null;
    const privacyVersion = legal.find((p) => p.kind === "privacy")?.version ?? null;
    if (legal.length) {
      if (!input.acceptLegal) throw new AppError(422, "legal_required", "Acepta los términos y el aviso de privacidad para continuar.", { acceptLegal: "Necesitamos tu aceptación" });
      if (input.legalVersions && (input.legalVersions.terms !== termsVersion || input.legalVersions.privacy !== privacyVersion)) {
        throw new AppError(409, "legal_changed", "La tienda actualizó sus términos o su aviso de privacidad. Revísalos y acepta de nuevo.", { acceptLegal: "Se actualizaron" });
      }
    }

    // Current prices, taxes and costs: the store only says what and how much.
    const ids = [...new Set(input.items.map((i) => i.variantId))];
    if (ids.length !== input.items.length) throw new AppError(422, "validation_error", "Un producto aparece dos veces en el carrito.");
    const rows: Array<{ id: string; productId: string; sku: string; options: string[]; price: number; cost: number; name: string; unit: string; track: boolean; taxRateId: string | null; images: string[]; categoryId: string | null }> = [];
    for (const part of chunk(ids, 80)) {
      rows.push(
        ...(await db
          .select({
            id: variants.id, productId: variants.productId, sku: variants.sku, options: variants.options, price: variants.priceCents, cost: variants.costCents,
            name: products.name, unit: products.unit, track: products.trackInventory, taxRateId: products.taxRateId, images: products.images, categoryId: products.categoryId,
          })
          .from(variants)
          .innerJoin(products, eq(products.id, variants.productId))
          .where(and(
            eq(variants.tenantId, t.id), inArray(variants.id, part), eq(variants.active, true), isNull(variants.deletedAt),
            eq(products.online, true), eq(products.status, "active"), isNull(products.deletedAt),
          ))),
      );
    }
    const byId = new Map(rows.map((r) => [r.id, r]));
    input.items.forEach((item, i) => {
      const v = byId.get(item.variantId);
      if (!v) throw new AppError(409, "unavailable", "Un producto de tu carrito ya no está disponible. Quítalo e intenta de nuevo.", { [`items.${i}`]: "No disponible", variantId: item.variantId });
      if (!quantityFitsUnit(item.quantity, v.unit)) throw new AppError(422, "validation_error", `${v.name}: ${unitInfo(v.unit).decimals ? "máximo 3 decimales" : "usa cantidades enteras"}`);
    });
    const rateOf = await taxResolver(db, t.id);
    const lines = input.items.map((item) => {
      const v = byId.get(item.variantId)!;
      return { unitPriceCents: v.price, quantity: item.quantity, discountCents: 0, taxRateBps: rateOf(v.taxRateId) };
    });
    const money = (v: number) => formatMoney(v, biz.currency, biz.locale);
    const coupon = input.couponCode ? await findCoupon(db, t.id, input.couponCode) : null;
    if (input.couponCode) {
      const problem = coupon ? couponProblem(toCouponRule(coupon), today, "online") : "Este cupón no existe.";
      if (problem) throw new AppError(422, "coupon_invalid", problem, { couponCode: problem });
    }
    const priced = priceCart(
      input.items.map((item, i) => {
        const v = byId.get(item.variantId)!;
        return { productId: v.productId, categoryId: v.categoryId, unitPriceCents: v.price, quantity: item.quantity, taxRateBps: lines[i]!.taxRateBps };
      }),
      { promotions: await livePromotions(db, t.id, today, "online"), coupon: coupon ? toCouponRule(coupon) : null, pricesIncludeTax: biz.pricesIncludeTax, formatMoney: money },
    );
    if (priced.couponError) throw new AppError(422, "coupon_invalid", priced.couponError, { couponCode: priced.couponError });
    const totals = priced.totals;
    if (totals.totalCents < store.minOrderCents) throw new AppError(422, "min_order", `El pedido mínimo es de ${money(store.minOrderCents)}.`);
    const shipping = shippingFor(store, totals.totalCents, input.fulfillment);
    const total = totals.totalCents + shipping;
    if (total !== input.expectedTotalCents) {
      throw new AppError(409, "price_changed", `El total cambió a ${money(total)} porque se actualizaron precios. Revisa tu carrito y confirma de nuevo.`, { expectedTotalCents: String(total) });
    }

    const orderId = newId();
    const token = randomToken(24);
    const now = new Date().toISOString();
    const actor = { tenantId: t.id, userId: null, userName: input.customerName };
    const cost = input.items.reduce((a, item) => a + Math.round((byId.get(item.variantId)!.cost * toMilli(item.quantity)) / 1000), 0);
    const customer = await customerForOrder(d1, db, t.id, { name: input.customerName, email: input.customerEmail, phone: input.customerPhone });
    const statements: D1PreparedStatement[] = [
      d1.prepare("INSERT INTO counters (tenant_id, name, value) VALUES (?1, 'order', 1) ON CONFLICT(tenant_id, name) DO UPDATE SET value = value + 1").bind(t.id),
      d1
        .prepare(
          `INSERT INTO orders (id, tenant_id, number, token, client_id, location_id, status, fulfillment, customer_name, customer_email, customer_phone, address, notes,
             payment_method, payment_status, prices_include_tax, subtotal_cents, tax_cents, shipping_cents, total_cents, cost_cents, ip, created_at, updated_at,
             customer_id, coupon_code, discount_cents, legal_accepted_at, terms_version, privacy_version)
           SELECT ?1, ?2, value, ?3, ?4, ?5, 'pending', ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'pending', ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?20, ?21, ?22, ?23, ?24, ?25, ?26
           FROM counters WHERE tenant_id = ?2 AND name = 'order'`,
        )
        .bind(
          orderId, t.id, token, input.clientId, store.locationId, input.fulfillment, input.customerName, input.customerEmail, input.customerPhone,
          input.fulfillment === "delivery" ? input.address : null, input.notes, input.paymentMethod, biz.pricesIncludeTax ? 1 : 0,
          totals.subtotalCents, totals.taxCents, shipping, total, cost, ip, now, customer.id, coupon?.code ?? null, totals.discountCents,
          legal.length ? now : null, legal.length ? termsVersion : null, legal.length ? privacyVersion : null,
        ),
      ...customer.statements,
      ...(coupon ? [couponUseStatement(d1, coupon.id)] : []),
    ];
    input.items.forEach((item, i) => {
      const v = byId.get(item.variantId)!;
      const l = totals.lines[i]!;
      statements.push(
        toStatement(d1, db.insert(orderItems).values({
          id: newId(), tenantId: t.id, orderId, variantId: v.id, productId: v.productId, name: v.name, options: v.options, sku: v.sku, unit: v.unit,
          image: v.images[0] ?? null, trackInventory: v.track, quantity: toMilli(item.quantity), unitPriceCents: v.price, taxRateBps: lines[i]!.taxRateBps,
          discountCents: l.lineDiscountCents + l.cartDiscountCents, promotionId: priced.lines[i]!.promotionId,
          netCents: l.netCents, taxCents: l.taxCents, totalCents: l.totalCents, unitCostCents: v.cost, position: i,
        })),
      );
      if (v.track) {
        statements.push(...movementStatements(d1, actor, { kind: "out", type: "order", variantId: v.id, locationId: store.locationId, quantityMilli: toMilli(item.quantity), reason: "online_order", reference: orderId }));
      }
    });
    statements.push(
      toStatement(d1, db.insert(auditLog).values({ id: newId(), tenantId: t.id, userId: null, userName: input.customerName, action: "order.create", entity: "order", entityId: orderId, after: { totalCents: total, items: input.items.length }, ip })),
    );
    try {
      await d1.batch(statements);
    } catch (err) {
      if (isCheckError(err, "coupons_uses_le_max")) throw new AppError(409, "coupon_exhausted", "El cupón se agotó justo ahora. Quítalo para continuar.", { couponCode: "Se agotó" });
      if (isUniqueError(err) && String((err as Error).message).includes("client_id")) {
        const again = await db.select({ token: orders.token, number: orders.number }).from(orders).where(and(eq(orders.tenantId, t.id), eq(orders.clientId, input.clientId))).get();
        if (again) return c.json(again, 200);
      }
      if (!isStockCheckError(err)) throw err;
      const levels = await db.select().from(stockLevels).where(and(eq(stockLevels.tenantId, t.id), eq(stockLevels.locationId, store.locationId), inArray(stockLevels.variantId, ids.slice(0, 90))));
      for (const item of input.items) {
        const v = byId.get(item.variantId)!;
        const have = Math.max(levels.find((l) => l.variantId === v.id)?.quantity ?? 0, 0);
        if (v.track && have < toMilli(item.quantity)) {
          const label = v.options.length ? `${v.name} (${v.options.join(" / ")})` : v.name;
          throw new AppError(409, "insufficient_stock", have ? `Solo quedan ${formatQty(fromMilli(have), v.unit)} de ${label}.` : `${label} se agotó.`, { variantId: v.id, available: String(fromMilli(have)) });
        }
      }
      throw new AppError(409, "insufficient_stock", "Algunos productos de tu carrito se agotaron. Revisa las cantidades.");
    }

    const created = await loadOrderRows(db, t.id, { id: orderId });
    if (created) await recordStoreEvent(c, t.id, { type: "order_placed", path: "/pagar", amountCents: total }).catch(() => false);
    let paymentUrl: string | null = null;
    if (created && input.paymentMethod === "card") {
      // Stripe Checkout on the business's account. If Stripe fails, the order is cancelled and the stock returns.
      try {
        const session = await createOrderCheckout(c.env, { tenantId: t.id, account: cardAccount!, order: created.order, storeName: biz.tradeName, currency: biz.currency, base: await storeBase(c, t) });
        await d1.prepare("UPDATE orders SET stripe_session_id = ?1 WHERE id = ?2 AND tenant_id = ?3").bind(session.id, orderId, t.id).run();
        paymentUrl = session.url;
      } catch (err) {
        await d1.batch(cancelStatements(d1, db, { tenantId: t.id, userId: null, userName: "Sistema" }, created.order, created.items, { reason: "No se pudo iniciar el pago con tarjeta", by: "system", from: ["pending"] })).catch(() => {});
        throw err;
      }
      // The emails go out once the payment is confirmed (or not at all if it expires).
      return c.json({ token, number: created.order.number, paymentUrl }, 201);
    }
    if (created) {
      c.executionCtx.waitUntil(
        Promise.all([
          sendOrderEmail(c.env, db, t.id, t.slug, "placed", created.order, created.items),
          sendOrderEmail(c.env, db, t.id, t.slug, "new_order", created.order, created.items),
          notifyOrder(c.env, db, t.id, created.order, "order_new"),
        ]).catch((e) => console.error("[orders] email/push", e)),
      );
    }
    return c.json({ token, number: created?.order.number ?? 0, paymentUrl }, 201);
  })

  /** Checks a coupon code; the store then prices the cart with it (same function as the server). */
  .post("/:slug/coupons/check", json(z.object({ code: z.string().trim().min(1).max(40) })), async (c) => {
    const { code } = c.req.valid("json");
    const { tenant: t, db, today } = await resolveStore(c);
    const coupon = await findCoupon(db, t.id, normalizeCode(code));
    const problem = coupon ? couponProblem(toCouponRule(coupon), today, "online") : "Este cupón no existe.";
    if (problem) throw new AppError(422, "coupon_invalid", problem, { code: problem });
    return c.json(toCouponRule(coupon!));
  })

  /* ---------- Traffic (no cookies; see lib/events.ts) ---------- */
  .post("/:slug/events", json(eventSchema), async (c) => {
    const slug = c.req.param("slug").toLowerCase();
    if (!c.env.STORE_EVENTS || !/^[a-z0-9-]{1,60}$/.test(slug)) return c.body(null, 204);
    const t = await controlDb(c.env.DB_CONTROL)
      .select({ id: control.tenants.id, status: control.tenants.status })
      .from(control.tenants)
      .where(eq(control.tenants.slug, slug))
      .get();
    if (t?.status === "active") {
      const e = c.req.valid("json");
      await recordStoreEvent(c, t.id, { type: e.type, path: e.path, referrer: e.referrer, productId: e.productId, utm: e.utm ?? undefined });
    }
    return c.body(null, 204);
  })

  /**
   * Custom CSS/HTML/JS of the store, for the Pages middleware that injects it into the HTML.
   * Public on purpose: it is exactly what every visitor's browser receives anyway.
   */
  .get("/:slug/custom-code", async (c) => {
    const { tenant: t, db } = await resolveStore(c);
    const a = await loadAppearance(db, t.id);
    return c.json(a.code, 200, short);
  })

  /* ---------- Legal pages and sitemap data ---------- */
  .get("/:slug/policies/:kind", async (c) => {
    const { tenant: t, db } = await resolveStore(c);
    const p = (await publishedPolicies(db, t.id)).find((x) => x.kind === c.req.param("kind"));
    if (!p) throw new AppError(404, "not_found", "Esta página no existe.");
    return c.json({ kind: p.kind, content: p.content, version: p.version, updatedAt: p.updatedAt }, 200, short);
  })

  /** What the store's sitemap lists: published products with their last change, and the legal pages. */
  .get("/:slug/sitemap", async (c) => {
    const { tenant: t, d1, db, store } = await resolveStore(c);
    const { results } = await d1
      .prepare(`SELECT p.id, p.updated_at AS updatedAt FROM products p WHERE ${PUBLISHED} ORDER BY p.updated_at DESC LIMIT 45000`)
      .bind(t.id)
      .all<{ id: string; updatedAt: string }>();
    const policies = (await publishedPolicies(db, t.id)).map((p) => ({ kind: p.kind, updatedAt: p.updatedAt }));
    return c.json({ indexable: store.indexable, updatedAt: store.updatedAt, products: results, policies }, 200, { "Cache-Control": "public, max-age=600" });
  })

  /* ---------- Tracking page ---------- */
  .get("/:slug/orders/:token", async (c) => {
    const { tenant: t, db } = await resolveStore(c);
    const rows = await loadOrderRows(db, t.id, { token: c.req.param("token") });
    if (!rows) throw new AppError(404, "not_found", "No encontramos este pedido. Revisa el enlace.");
    c.header("Cache-Control", "no-store");
    return c.json(await toPublicOrder(db, t.id, rows.order, rows.items));
  })

  /** Link to Stripe Checkout of a card order that is still unpaid (the session lasts 30 minutes). */
  .post("/:slug/orders/:token/pay", async (c) => {
    const { tenant: t, db, cardAccount } = await resolveStore(c);
    const rows = await loadOrderRows(db, t.id, { token: c.req.param("token") });
    if (!rows) throw new AppError(404, "not_found", "No encontramos este pedido.");
    const o = rows.order;
    if (o.paymentMethod !== "card" || o.paymentStatus !== "pending" || o.status !== "pending" || !o.stripeSessionId || !cardAccount) {
      throw new AppError(409, "not_payable", "Este pedido ya no se puede pagar en línea.");
    }
    const session = await stripe<CheckoutSession>(c.env, "GET", `/checkout/sessions/${o.stripeSessionId}`, undefined, { account: cardAccount });
    if (session.status !== "open" || !session.url) throw new AppError(409, "not_payable", "El tiempo para pagar este pedido terminó. Haz un pedido nuevo.");
    return c.json({ url: session.url });
  })

  /** Back from Stripe: asks Stripe directly so the page shows "paid" without waiting for the webhook. */
  .post("/:slug/orders/:token/payment-status", async (c) => {
    const { tenant: t, db, d1, cardAccount } = await resolveStore(c);
    let rows = await loadOrderRows(db, t.id, { token: c.req.param("token") });
    if (!rows) throw new AppError(404, "not_found", "No encontramos este pedido.");
    const o = rows.order;
    if (o.paymentMethod === "card" && o.paymentStatus === "pending" && o.stripeSessionId && cardAccount) {
      const session = await stripe<CheckoutSession>(c.env, "GET", `/checkout/sessions/${o.stripeSessionId}`, undefined, { account: cardAccount });
      if (session.payment_status === "paid" && (await markOrderPaid(db, d1, t.id, o.id, session))) {
        rows = (await loadOrderRows(db, t.id, { id: o.id }))!;
        c.executionCtx.waitUntil(notifyPaid(c.env, db, t, o.id));
      }
    }
    c.header("Cache-Control", "no-store");
    return c.json(await toPublicOrder(db, t.id, rows.order, rows.items));
  })

  /** The customer can cancel while the order is new and unpaid. */
  .post("/:slug/orders/:token/cancel", async (c) => {
    const { tenant: t, db, d1, cardAccount } = await resolveStore(c);
    const rows = await loadOrderRows(db, t.id, { token: c.req.param("token") });
    if (!rows) throw new AppError(404, "not_found", "No encontramos este pedido.");
    if (rows.order.status !== "pending" || rows.order.paymentStatus !== "pending") {
      throw new AppError(409, "not_cancellable", "La tienda ya está preparando tu pedido. Contáctala para cancelarlo.");
    }
    try {
      await d1.batch(cancelStatements(d1, db, { tenantId: t.id, userId: null, userName: rows.order.customerName }, rows.order, rows.items, { reason: "Cancelado por el cliente", by: "customer", from: ["pending"], ip: c.req.header("cf-connecting-ip") ?? null }));
    } catch (err) {
      if (String((err as Error).message).includes("NOT NULL constraint failed")) throw new AppError(409, "not_cancellable", "La tienda ya está preparando tu pedido. Contáctala para cancelarlo.");
      throw err;
    }
    // Close the Stripe page so it cannot be paid after cancelling.
    if (rows.order.stripeSessionId && cardAccount) {
      await stripe(c.env, "POST", `/checkout/sessions/${rows.order.stripeSessionId}/expire`, undefined, { account: cardAccount }).catch(() => {});
    }
    const after = (await loadOrderRows(db, t.id, { id: rows.order.id }))!;
    c.executionCtx.waitUntil(sendOrderEmail(c.env, db, t.id, t.slug, "cancelled", after.order, after.items).catch(() => {}));
    return c.json(await toPublicOrder(db, t.id, after.order, after.items));
  });
