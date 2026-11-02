/** Store appearance (Phase 9): load with defaults. */
import { eq } from "drizzle-orm";
import { tenant, type TenantDb } from "@nexo/db";
import { DEFAULT_ANNOUNCEMENT, DEFAULT_THEME, NO_PIXELS, type StoreAnnouncement, type StoreAppearance, type StoreBanner, type StorePixels, type StoreTheme } from "@nexo/shared";

const { storeAppearance } = tenant;

export async function loadAppearance(db: TenantDb, tenantId: string): Promise<StoreAppearance & { updatedAt: string | null }> {
  const row = await db.select().from(storeAppearance).where(eq(storeAppearance.tenantId, tenantId)).get();
  if (!row) return { theme: DEFAULT_THEME, announcement: DEFAULT_ANNOUNCEMENT, banners: [], pixels: NO_PIXELS, code: { css: "", headHtml: "", bodyHtml: "", js: "" }, updatedAt: null };
  return {
    theme: { ...DEFAULT_THEME, ...(row.theme as Partial<StoreTheme>) },
    announcement: { ...DEFAULT_ANNOUNCEMENT, ...(row.announcement as Partial<StoreAnnouncement>) },
    banners: row.banners as unknown as StoreBanner[],
    pixels: { ...NO_PIXELS, ...(row.pixels as Partial<StorePixels>) },
    code: { css: row.customCss, headHtml: row.headHtml, bodyHtml: row.bodyHtml, js: row.customJs },
    updatedAt: row.updatedAt,
  };
}
