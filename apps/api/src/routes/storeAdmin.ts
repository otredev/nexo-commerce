import { Hono, type Context } from "hono";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { tenant } from "@nexo/db";
import {
  blockImages, domainSchema, planOf, POLICY_INFO, storeAppearanceSchema, type StoreAppearance, type StoreAppearanceSettings, POLICY_KINDS, policySchema, policyTemplate, publishProductsSchema, storeSettingsSchema,
  type PolicyKind, type StoreDomain, type StorePolicy, type StoreSettings,
} from "@nexo/shared";
import { control, controlDb } from "@nexo/db";
import { addDomain, domainsConfigured, refreshDomain, removeDomain, toStoreDomain } from "../lib/domains";
import { assertFeature } from "../lib/plan";
import { createPreviewToken, loadAppearance } from "../lib/appearance";
import type { AppEnv } from "../env";
import { auditEntry, diff } from "../lib/audit";
import { AppError } from "../lib/errors";
import { chunk, toStatement } from "../lib/inventory";
import { json } from "../lib/validate";
import { requirePermission } from "../middleware/auth";

const { storeSettings, locations, products, storePolicies, storePolicyVersions, businessSettings, storeAppearance } = tenant;

const kindParam = (c: Context<AppEnv>): PolicyKind => {
  const k = c.req.param("kind") as PolicyKind;
  if (!(POLICY_KINDS as readonly string[]).includes(k)) throw new AppError(404, "not_found", "Página no encontrada");
  return k;
};

async function load(c: Context<AppEnv>): Promise<StoreSettings> {
  const { db, d1, tenant: t } = c.var.auth;
  const [row, counts] = await Promise.all([
    db.select().from(storeSettings).where(eq(storeSettings.tenantId, t.id)).get(),
    d1
      .prepare("SELECT SUM(online = 1) AS published, COUNT(*) AS active FROM products WHERE tenant_id = ?1 AND status = 'active' AND deleted_at IS NULL")
      .bind(t.id)
      .first<{ published: number | null; active: number }>(),
  ]);
  const base = row ?? {
    enabled: false, locationId: null, tagline: null, about: null, pickupEnabled: true, pickupInstructions: null, deliveryEnabled: false, deliveryFeeCents: 0,
    freeDeliveryFromCents: null, deliveryArea: null, minOrderCents: 0, payOnDelivery: true, transferEnabled: false, transferInstructions: null, cardEnabled: false, whatsapp: null,
    notifyEmail: null, holdHours: 48, seoTitle: null, seoDescription: null, indexable: true, faq: [] as Array<{ q: string; a: string }>, accountRequired: true,
  };
  return {
    enabled: base.enabled,
    locationId: base.locationId,
    tagline: base.tagline,
    about: base.about,
    pickupEnabled: base.pickupEnabled,
    pickupInstructions: base.pickupInstructions,
    deliveryEnabled: base.deliveryEnabled,
    deliveryFeeCents: base.deliveryFeeCents,
    freeDeliveryFromCents: base.freeDeliveryFromCents,
    deliveryArea: base.deliveryArea,
    minOrderCents: base.minOrderCents,
    payOnDelivery: base.payOnDelivery,
    transferEnabled: base.transferEnabled,
    transferInstructions: base.transferInstructions,
    cardEnabled: base.cardEnabled,
    whatsapp: base.whatsapp,
    notifyEmail: base.notifyEmail,
    holdHours: base.holdHours,
    seoTitle: base.seoTitle,
    seoDescription: base.seoDescription,
    indexable: base.indexable,
    faq: base.faq,
    accountRequired: base.accountRequired,
    slug: t.slug,
    url: `${c.env.STORE_URL.replace(/\/$/, "")}/${t.slug}`,
    publishedCount: counts?.published ?? 0,
    activeCount: counts?.active ?? 0,
  };
}

async function appearanceSettings(c: Context<AppEnv>): Promise<StoreAppearanceSettings> {
  const { db, tenant: t } = c.var.auth;
  return loadAppearance(db, t.id);
}

/** Audit summary: what changed, without whole HTML sections or images. */
const appearanceSummary = (a: StoreAppearance) => ({
  theme: a.theme,
  announcement: a.announcement.enabled ? a.announcement.messages.map((m) => m.text) : null,
  blocks: a.blocks.map((b) => `${b.type}:${b.id}${b.enabled ? "" : " (oculta)"}`),
  pixels: a.pixels,
  cssChars: a.code.css.length,
});

export const storeAdminRoutes = new Hono<AppEnv>()
  /* ---------- Phase 9: appearance ---------- */
  .get("/appearance", requirePermission("settings:read"), async (c) => c.json(await appearanceSettings(c)))

  .put("/appearance", requirePermission("store:write"), json(storeAppearanceSchema), async (c) => {
    const input = c.req.valid("json");
    const { db, d1, tenant: t } = c.var.auth;
    // Images must be this business's own uploads.
    const own = `t/${t.id}/`;
    const fields: Record<string, string> = {};
    input.blocks.forEach((b, i) => {
      for (const img of blockImages(b)) if (!img.key.startsWith(own)) fields[`blocks.${i}.${img.path}`] = "Sube la imagen desde aquí";
    });
    if (Object.keys(fields).length) throw new AppError(422, "validation_error", "Revisa los campos marcados", fields);

    const before = await loadAppearance(db, t.id);
    const now = new Date().toISOString();
    const values = { theme: input.theme, announcement: input.announcement, blocks: input.blocks, pixels: input.pixels, customCss: input.code.css, updatedAt: now };
    const change = diff(appearanceSummary(before) as Record<string, unknown>, appearanceSummary(input) as Record<string, unknown>);
    await d1.batch([
      toStatement(d1, db.insert(storeAppearance).values({ tenantId: t.id, ...values }).onConflictDoUpdate({ target: storeAppearance.tenantId, set: values })),
      toStatement(d1, auditEntry(c, { action: "store.appearance", entity: "store_appearance", entityId: t.id, before: change.before, after: change.after })),
      // The store's caches and sitemaps key on store_settings.updated_at.
      d1.prepare("UPDATE store_settings SET updated_at = ?2 WHERE tenant_id = ?1").bind(t.id, now),
    ]);
    return c.json(await appearanceSettings(c));
  })

  /** Live preview in the editor: a short-lived token the store sends to its API (works before the store is on). */
  .post("/appearance/preview", requirePermission("settings:read"), async (c) => {
    const { db, tenant: t } = c.var.auth;
    return c.json(await createPreviewToken(db, t.id));
  })

  .get("/", requirePermission("settings:read"), async (c) => c.json(await load(c)))

  .put("/", requirePermission("store:write"), json(storeSettingsSchema), async (c) => {
    const input = c.req.valid("json");
    const { db, d1, tenant: t } = c.var.auth;
    if (input.locationId) {
      const loc = await db.select({ active: locations.active }).from(locations).where(and(eq(locations.id, input.locationId), eq(locations.tenantId, t.id))).get();
      if (!loc?.active) throw new AppError(422, "validation_error", "Revisa los campos marcados", { locationId: "Elige una ubicación activa" });
    }
    if (input.cardEnabled) {
      assertFeature(c, "cardPayments");
      const row = await controlDb(c.env.DB_CONTROL).select({ ok: control.tenants.stripeChargesEnabled }).from(control.tenants).where(eq(control.tenants.id, t.id)).get();
      if (!row?.ok) throw new AppError(422, "validation_error", "Conecta tu cuenta de Stripe antes de activar el pago con tarjeta.", { cardEnabled: "Conecta Stripe primero" });
    }
    const before = await db.select().from(storeSettings).where(eq(storeSettings.tenantId, t.id)).get();
    const change = diff((before ?? {}) as Record<string, unknown>, input);
    const now = new Date().toISOString();
    await d1.batch([
      toStatement(
        d1,
        db.insert(storeSettings).values({ tenantId: t.id, ...input, updatedAt: now }).onConflictDoUpdate({ target: storeSettings.tenantId, set: { ...input, updatedAt: now } }),
      ),
      toStatement(d1, auditEntry(c, { action: "store.update", entity: "store_settings", entityId: t.id, before: change.before, after: change.after })),
    ]);
    return c.json(await load(c));
  })

  /** Publish or hide products in bulk (all active products when productIds is null). */
  .post("/publish", requirePermission("store:write"), json(publishProductsSchema), async (c) => {
    const { productIds, online } = c.req.valid("json");
    const { db, d1, tenant: t } = c.var.auth;
    const now = new Date().toISOString();
    const statements: D1PreparedStatement[] = [];
    if (productIds === null) {
      statements.push(toStatement(d1, db.update(products).set({ online, updatedAt: now }).where(and(eq(products.tenantId, t.id), eq(products.status, "active"), isNull(products.deletedAt), sql`${products.online} <> ${online ? 1 : 0}`))));
    } else {
      for (const part of chunk(productIds, 90)) {
        statements.push(toStatement(d1, db.update(products).set({ online, updatedAt: now }).where(and(eq(products.tenantId, t.id), inArray(products.id, part), isNull(products.deletedAt)))));
      }
    }
    statements.push(toStatement(d1, auditEntry(c, { action: online ? "store.publish" : "store.unpublish", entity: "product", after: { products: productIds?.length ?? "todos" } })));
    await d1.batch(statements);
    return c.json(await load(c));
  })

  /* ---------- Own domain (Cloudflare for SaaS) ---------- */
  .get("/domain", requirePermission("settings:read"), async (c) => {
    const { tenant: t } = c.var.auth;
    let row = await controlDb(c.env.DB_CONTROL).select().from(control.tenantDomains).where(eq(control.tenantDomains.tenantId, t.id)).get();
    if (row && row.status === "pending" && c.req.query("refresh") === "1" && domainsConfigured(c.env)) row = (await refreshDomain(c.env, row.hostname)) ?? row;
    return c.json({
      available: domainsConfigured(c.env),
      planAllows: planOf(t.plan).limits.customDomain,
      domain: row ? toStoreDomain(c.env, row) : null,
    } satisfies { available: boolean; planAllows: boolean; domain: StoreDomain | null });
  })

  .put("/domain", requirePermission("store:write"), json(domainSchema), async (c) => {
    const { hostname } = c.req.valid("json");
    const { tenant: t, db } = c.var.auth;
    assertFeature(c, "customDomain");
    const current = await controlDb(c.env.DB_CONTROL).select().from(control.tenantDomains).where(eq(control.tenantDomains.tenantId, t.id)).get();
    if (current?.hostname === hostname) return c.json(toStoreDomain(c.env, current));
    await addDomain(c.env, t.id, hostname);
    // One domain per store: the new one replaces the previous.
    if (current) await removeDomain(c.env, current.hostname).catch((e) => console.error("[domains] remove previous", e));
    await db.batch([auditEntry(c, { action: "store.domain", entity: "store_settings", entityId: t.id, before: current ? { hostname: current.hostname } : undefined, after: { hostname } })]);
    const row = (await controlDb(c.env.DB_CONTROL).select().from(control.tenantDomains).where(eq(control.tenantDomains.hostname, hostname)).get())!;
    return c.json(toStoreDomain(c.env, row), 201);
  })

  .delete("/domain", requirePermission("store:write"), async (c) => {
    const { tenant: t, db } = c.var.auth;
    const current = await controlDb(c.env.DB_CONTROL).select().from(control.tenantDomains).where(eq(control.tenantDomains.tenantId, t.id)).get();
    if (!current) return c.body(null, 204);
    await removeDomain(c.env, current.hostname);
    await db.batch([auditEntry(c, { action: "store.domain_remove", entity: "store_settings", entityId: t.id, before: { hostname: current.hostname } })]);
    return c.body(null, 204);
  })

  /* ---------- Legal pages: privacy notice, terms, returns ---------- */
  .get("/policies", requirePermission("settings:read"), async (c) => {
    const { db, tenant: t } = c.var.auth;
    const rows = await db.select().from(storePolicies).where(eq(storePolicies.tenantId, t.id));
    const body: Array<StorePolicy | { kind: PolicyKind; content: null; version: 0; published: false; updatedAt: null }> = POLICY_KINDS.map((kind) => {
      const r = rows.find((x) => x.kind === kind);
      return r ? { kind, content: r.content, version: r.version, published: r.published, updatedAt: r.updatedAt } : { kind, content: null, version: 0, published: false, updatedAt: null };
    });
    return c.json(body);
  })

  /** A starting text filled with the business's data (not saved). */
  .get("/policies/:kind/template", requirePermission("settings:read"), async (c) => {
    const kind = kindParam(c);
    const { db, tenant: t } = c.var.auth;
    const biz = await db.select().from(businessSettings).where(eq(businessSettings.tenantId, t.id)).get();
    const content = policyTemplate(kind, {
      name: biz?.tradeName ?? t.name,
      legalName: biz?.legalName ?? null,
      email: biz?.email ?? null,
      phone: biz?.phone ?? null,
      address: biz?.address ?? null,
      storeUrl: `${c.env.STORE_URL.replace(/\/$/, "")}/${t.slug}`,
    });
    return c.json({ kind, content });
  })

  /** Saves a page. A change of text is a new version (kept, so orders can show what was accepted). */
  .put("/policies/:kind", requirePermission("store:write"), json(policySchema), async (c) => {
    const kind = kindParam(c);
    const { content, published } = c.req.valid("json");
    const { db, d1, tenant: t } = c.var.auth;
    const current = await db.select().from(storePolicies).where(and(eq(storePolicies.tenantId, t.id), eq(storePolicies.kind, kind))).get();
    const changed = !current || current.content !== content;
    const version = current ? current.version + (changed ? 1 : 0) : 1;
    const now = new Date().toISOString();
    const statements: D1PreparedStatement[] = [
      toStatement(
        d1,
        db.insert(storePolicies).values({ tenantId: t.id, kind, content, version, published, updatedAt: now })
          .onConflictDoUpdate({ target: [storePolicies.tenantId, storePolicies.kind], set: { content, version, published, updatedAt: now } }),
      ),
    ];
    if (changed) {
      statements.push(toStatement(d1, db.insert(storePolicyVersions).values({ tenantId: t.id, kind, version, content, createdAt: now }).onConflictDoNothing()));
    }
    if (changed || current?.published !== published) {
      statements.push(toStatement(d1, auditEntry(c, { action: "store.policy", entity: "store_policy", entityId: kind, after: { title: POLICY_INFO[kind].title, version, published } })));
    }
    await d1.batch(statements);
    const body: StorePolicy = { kind, content, version, published, updatedAt: now };
    return c.json(body);
  });
