/**
 * Store appearance (Phase 9): theme, announcement bar and tracking pixels. Home page sections are in blocks.ts.
 * The theme turns into CSS custom properties over the same tokens the store already uses, so the
 * server (Pages middleware, no flash) and the app produce exactly the same CSS from the same data.
 */

/* ---------- Theme ---------- */

export const THEME_FONTS = {
  editorial: { label: "Editorial", hint: "Títulos con serif elegante", heading: '"Instrument Serif", ui-serif, Georgia, serif', weight: 400, tracking: "-0.015em", body: '"Inter Variable", "Inter", ui-sans-serif, system-ui, sans-serif' },
  clasica: { label: "Clásica", hint: "Serif cálida, para boutique o gourmet", heading: '"Fraunces Variable", "Fraunces", ui-serif, Georgia, serif', weight: 500, tracking: "-0.02em", body: '"Inter Variable", "Inter", ui-sans-serif, system-ui, sans-serif' },
  moderna: { label: "Moderna", hint: "Sans serif firme y limpia", heading: '"Inter Variable", "Inter", ui-sans-serif, system-ui, sans-serif', weight: 650, tracking: "-0.03em", body: '"Inter Variable", "Inter", ui-sans-serif, system-ui, sans-serif' },
  geometrica: { label: "Geométrica", hint: "Con carácter, para marcas jóvenes", heading: '"Space Grotesk Variable", "Space Grotesk", ui-sans-serif, system-ui, sans-serif', weight: 600, tracking: "-0.03em", body: '"Inter Variable", "Inter", ui-sans-serif, system-ui, sans-serif' },
  amigable: { label: "Amigable", hint: "Redondeada, para familias y antojos", heading: '"Nunito Variable", "Nunito", ui-rounded, system-ui, sans-serif', weight: 800, tracking: "-0.015em", body: '"Nunito Variable", "Nunito", ui-rounded, system-ui, sans-serif' },
} as const;
export type ThemeFont = keyof typeof THEME_FONTS;
export const THEME_FONT_IDS = Object.keys(THEME_FONTS) as ThemeFont[];

export const THEME_RADII = {
  recto: { label: "Rectas", sm: 2, md: 3, lg: 4 },
  suave: { label: "Suaves", sm: 4, md: 6, lg: 10 },
  redondo: { label: "Redondas", sm: 8, md: 12, lg: 20 },
} as const;
export type ThemeRadius = keyof typeof THEME_RADII;
export const THEME_RADIUS_IDS = Object.keys(THEME_RADII) as ThemeRadius[];

type Scheme = "auto" | "light" | "dark";
interface Preset { label: string; description: string; scheme: Scheme; background: string; text: string; primary: string; font: ThemeFont; radius: ThemeRadius }

export const THEME_PRESETS = {
  nexo: { label: "Nexo", description: "Claro y sereno. Cambia a oscuro si el cliente usa modo oscuro.", scheme: "auto", background: "#fafaf9", text: "#1c1c1a", primary: "#2f6b4f", font: "editorial", radius: "suave" },
  boutique: { label: "Boutique", description: "Tonos rosados y serif clásica para moda y regalos.", scheme: "light", background: "#fbf7f4", text: "#2b2222", primary: "#9c4a5a", font: "clasica", radius: "suave" },
  fresco: { label: "Fresco", description: "Verde vivo y formas redondas para abarrotes y comida.", scheme: "light", background: "#f5faf6", text: "#13261c", primary: "#1a7a50", font: "amigable", radius: "redondo" },
  minimal: { label: "Minimal", description: "Blanco y negro, esquinas rectas. Que hablen las fotos.", scheme: "light", background: "#ffffff", text: "#111111", primary: "#111111", font: "moderna", radius: "recto" },
  mercado: { label: "Mercado", description: "Cálido y enérgico, con naranja tostado.", scheme: "light", background: "#fff8ec", text: "#2a1d0e", primary: "#b83d0b", font: "geometrica", radius: "redondo" },
  nocturno: { label: "Nocturno", description: "Fondo oscuro con dorado para marcas premium.", scheme: "dark", background: "#111214", text: "#f1efe9", primary: "#e0b25b", font: "clasica", radius: "suave" },
} as const satisfies Record<string, Preset>;
export type ThemePreset = keyof typeof THEME_PRESETS;
export const THEME_PRESET_IDS = Object.keys(THEME_PRESETS) as ThemePreset[];

/** What the business chooses: a preset plus optional overrides (null = the preset's). */
export interface StoreTheme {
  preset: ThemePreset;
  primary: string | null;
  background: string | null;
  text: string | null;
  font: ThemeFont | null;
  radius: ThemeRadius | null;
}
export const DEFAULT_THEME: StoreTheme = { preset: "nexo", primary: null, background: null, text: null, font: null, radius: null };

/* ---------- Color math (sRGB hex) ---------- */

const HEX = /^#[0-9a-f]{6}$/i;
export const isHexColor = (v: unknown): v is string => typeof v === "string" && HEX.test(v);
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const toHex = (c: number[]) => `#${c.map((x) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, "0")).join("")}`;
/** a mixed with `amount` (0–1) of b. */
export const mix = (a: string, b: string, amount: number) => { const x = rgb(a), y = rgb(b); return toHex(x.map((v, i) => v + (y[i]! - v) * amount)); };
export function luminance(hex: string) {
  const [r, g, b] = rgb(hex).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
/** WCAG contrast ratio, 1–21. */
export function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}
/** Moves `color` toward `toward` until it reaches `min` contrast against `bg` (for readable text). */
function readable(color: string, bg: string, toward: string, min = 4.5) {
  let c = color;
  for (let i = 1; i <= 10 && contrast(c, bg) < min; i++) c = mix(color, toward, i / 10);
  return c;
}

export interface ResolvedTheme { scheme: Scheme; background: string; text: string; primary: string; font: ThemeFont; radius: ThemeRadius; custom: boolean }

export function resolveTheme(theme: StoreTheme | null | undefined): ResolvedTheme {
  const t = theme ?? DEFAULT_THEME;
  const p: Preset = THEME_PRESETS[t.preset] ?? THEME_PRESETS.nexo;
  const background = isHexColor(t.background) ? t.background.toLowerCase() : p.background;
  const text = isHexColor(t.text) ? t.text.toLowerCase() : p.text;
  const primary = isHexColor(t.primary) ? t.primary.toLowerCase() : p.primary;
  const custom = background !== p.background || text !== p.text || primary !== p.primary;
  // Custom colors fix the scheme by the background (a light background can't follow dark mode).
  const scheme: Scheme = !custom ? p.scheme : luminance(background) < 0.2 ? "dark" : "light";
  return { scheme, background, text, primary, font: t.font && t.font in THEME_FONTS ? t.font : p.font, radius: t.radius && t.radius in THEME_RADII ? t.radius : p.radius, custom };
}

/** Problems worth telling the business before it saves (texts in Spanish). */
export function themeWarnings(r: ResolvedTheme): string[] {
  const out: string[] = [];
  if (contrast(r.text, r.background) < 4.5) out.push("El texto casi no se distingue del fondo. Elige colores con más contraste.");
  if (contrast(r.primary, r.background) < 1.6) out.push("El color principal se pierde en el fondo: los botones apenas se verán.");
  return out;
}

const LIGHT_STATUS = {
  "--success": "#2e7044", "--success-soft": "#e9f3ec", "--warning": "#8a5a0f", "--warning-soft": "#fbf3e2", "--danger": "#b4382f", "--danger-soft": "#fbecea", "--info": "#365a85", "--info-soft": "#ecf1f7",
  "--overlay": "rgba(20, 20, 18, 0.32)",
};
const DARK_STATUS = {
  "--success": "#7cbf98", "--success-soft": "#18261d", "--warning": "#d9a748", "--warning-soft": "#2b2414", "--danger": "#e0786e", "--danger-soft": "#2e1a18", "--info": "#86a9d4", "--info-soft": "#1a2230",
  "--overlay": "rgba(0, 0, 0, 0.6)",
};

/** CSS custom properties of a theme. Colors are left out for the "auto" preset (the default light/dark tokens apply). */
export function themeTokens(r: ResolvedTheme): Record<string, string> {
  const f = THEME_FONTS[r.font];
  const rad = THEME_RADII[r.radius];
  const vars: Record<string, string> = {
    "--font-sans": f.body,
    "--st-heading": f.heading,
    "--st-heading-weight": String(f.weight),
    "--st-heading-tracking": f.tracking,
    "--radius-sm": `${rad.sm}px`,
    "--radius-md": `${rad.md}px`,
    "--radius-lg": `${rad.lg}px`,
  };
  if (r.scheme === "auto") return vars;
  const dark = r.scheme === "dark";
  const { background: bg, text: ink, primary } = r;
  const primaryInk = contrast(primary, "#ffffff") >= contrast(primary, "#111111") ? "#ffffff" : "#111111";
  return {
    ...vars,
    "--bg": bg,
    "--surface": dark ? mix(bg, "#ffffff", 0.04) : mix(bg, "#ffffff", 0.7),
    "--surface-muted": mix(bg, ink, dark ? 0.07 : 0.04),
    "--border": mix(bg, ink, dark ? 0.14 : 0.1),
    "--border-strong": mix(bg, ink, dark ? 0.22 : 0.17),
    "--border-control": readable(mix(bg, ink, 0.45), bg, ink, 3),
    "--ink": ink,
    "--ink-muted": readable(mix(ink, bg, 0.35), bg, ink),
    "--ink-subtle": readable(mix(ink, bg, 0.5), bg, ink, 3),
    "--primary": primary,
    "--primary-hover": mix(primary, dark ? "#ffffff" : "#000000", 0.12),
    "--primary-ink": primaryInk,
    "--accent-soft": mix(bg, primary, dark ? 0.16 : 0.1),
    "--accent-text": readable(primary, bg, ink),
    "--focus": `${primary}66`,
    ...(dark ? DARK_STATUS : LIGHT_STATUS),
  };
}

/**
 * The theme as a style sheet. `:root:root:root` outranks the default tokens, including the
 * prefers-color-scheme rule, so a fixed light or dark theme stays put. Empty for the untouched default.
 */
export function themeCss(theme: StoreTheme | null | undefined): string {
  const r = resolveTheme(theme);
  if (r.scheme === "auto" && r.font === "editorial" && r.radius === "suave") return "";
  const body = Object.entries(themeTokens(r)).map(([k, v]) => `${k}:${v}`).join(";");
  return `:root:root:root{${r.scheme === "auto" ? "" : `color-scheme:${r.scheme};`}${body}}`;
}

/* ---------- Announcement bar ---------- */

export const ANNOUNCEMENT_TONES = { primary: "Color principal", ink: "Oscuro", accent: "Suave", warning: "Aviso" } as const;
export type AnnouncementTone = keyof typeof ANNOUNCEMENT_TONES;

export interface StoreAnnouncement {
  enabled: boolean;
  /** 1–3 messages; with more than one they rotate. */
  messages: Array<{ text: string; link: string | null }>;
  tone: AnnouncementTone;
  dismissible: boolean;
  startsOn: string | null;
  endsOn: string | null;
}
export const DEFAULT_ANNOUNCEMENT: StoreAnnouncement = { enabled: false, messages: [{ text: "", link: null }], tone: "primary", dismissible: true, startsOn: null, endsOn: null };

/* ---------- Links and schedules ---------- */

/** Dates are YYYY-MM-DD in the business's time zone (inclusive). */
export const activeOn = (item: { startsOn: string | null; endsOn: string | null }, today: string) =>
  (!item.startsOn || item.startsOn <= today) && (!item.endsOn || item.endsOn >= today);

/**
 * Links in sections, menus and the announcement: a path inside the store ("/p/123", "?categoria=…"),
 * a section of the home ("#horarios"), an https address, a phone (tel:) or an email (mailto:).
 * Nothing else (no javascript:, no data:, no protocol-relative //).
 */
export const STORE_LINK = /^(?:\/(?!\/)[^\s<>"]*|\?[^\s<>"]*|#[a-z0-9-]{1,40}|https:\/\/[^\s<>"]+|tel:\+?[\d\s()-]{3,25}|mailto:[^\s<>"@/:]+@[^\s<>"@/:]+)$/;

/* ---------- Tracking pixels ---------- */

export interface StorePixels {
  metaPixelId: string | null;
  /** Google tag: GA4 (G-…), Google Ads (AW-…) or Tag Manager (GTM-…). */
  googleTagId: string | null;
  tiktokPixelId: string | null;
}
export const NO_PIXELS: StorePixels = { metaPixelId: null, googleTagId: null, tiktokPixelId: null };
export const PIXEL_PATTERNS = {
  metaPixelId: /^\d{10,20}$/,
  googleTagId: /^(?:G|AW|GT|GTM)-[A-Z0-9]{4,15}$/,
  tiktokPixelId: /^[A-Z0-9]{15,25}$/,
} as const;
export const hasPixels = (p: StorePixels | null | undefined) => Boolean(p && (p.metaPixelId || p.googleTagId || p.tiktokPixelId));

/** Text safe inside <style>…</style> and <script>…</script>: no sequence can close the element early. */
export const safeStyleText = (css: string) => css.replace(/<\/(style)/gi, "<\\/$1");
export const safeScriptText = (js: string) => js.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");
