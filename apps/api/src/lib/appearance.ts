/** Store appearance (Phase 9): load with defaults. */
import { and, eq, gt, lt } from "drizzle-orm";
import { tenant, type TenantDb } from "@nexo/db";
import { DEFAULT_ANNOUNCEMENT, DEFAULT_THEME, NO_PIXELS, normalizeBlocks, type StoreAnnouncement, type StoreAppearance, type StorePixels, type StoreTheme } from "@nexo/shared";
import { randomToken, sha256Hex } from "./crypto";

const { storeAppearance, storePreviewTokens } = tenant;

export async function loadAppearance(db: TenantDb, tenantId: string): Promise<StoreAppearance & { updatedAt: string | null }> {
  const row = await db.select().from(storeAppearance).where(eq(storeAppearance.tenantId, tenantId)).get();
  if (!row) return { theme: DEFAULT_THEME, announcement: DEFAULT_ANNOUNCEMENT, blocks: normalizeBlocks(null), pixels: NO_PIXELS, code: { css: "" }, updatedAt: null };
  return {
    theme: { ...DEFAULT_THEME, ...(row.theme as Partial<StoreTheme>) },
    announcement: { ...DEFAULT_ANNOUNCEMENT, ...(row.announcement as Partial<StoreAnnouncement>) },
    blocks: normalizeBlocks(row.blocks),
    pixels: { ...NO_PIXELS, ...(row.pixels as Partial<StorePixels>) },
    code: { css: row.customCss },
    updatedAt: row.updatedAt,
  };
}

/* ---------- Live preview in the editor ---------- */

/** How long the editor's preview may read the store (it asks for a new token before then). */
export const PREVIEW_TTL_MS = 2 * 60 * 60 * 1000;

/** A token that lets the store's API answer this business while it previews (even if the store is off). */
export async function createPreviewToken(db: TenantDb, tenantId: string) {
  const token = `nxp_${randomToken(24)}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PREVIEW_TTL_MS).toISOString();
  await db.delete(storePreviewTokens).where(and(eq(storePreviewTokens.tenantId, tenantId), lt(storePreviewTokens.expiresAt, now.toISOString())));
  await db.insert(storePreviewTokens).values({ id: await sha256Hex(token), tenantId, expiresAt });
  return { token, expiresAt };
}

export async function validPreviewToken(db: TenantDb, tenantId: string, token: string | undefined) {
  if (!token || !/^nxp_[A-Za-z0-9_-]{20,64}$/.test(token)) return false;
  const row = await db
    .select({ id: storePreviewTokens.id })
    .from(storePreviewTokens)
    .where(and(eq(storePreviewTokens.id, await sha256Hex(token)), eq(storePreviewTokens.tenantId, tenantId), gt(storePreviewTokens.expiresAt, new Date().toISOString())))
    .get();
  return Boolean(row);
}
