/**
 * Home page sections ("bloques") of the online store: the editor in Apariencia › Página principal builds
 * the home as an ordered list of blocks; the store renders them in that order.
 *
 * Every field has a default, so `blockSchema.parse({ id, type })` is a valid new block, old rows keep
 * working when a field is added, and the API fills in whatever a client (or the MCP server) leaves out.
 */
import { z } from "zod";
import {
  activeOn, contrast, luminance, resolveTheme, STORE_LINK, THEME_FONT_IDS, THEME_RADIUS_IDS, themeTokens,
  type AnnouncementTone, type ResolvedTheme, type StoreAnnouncement, type StorePixels, type StoreTheme, type ThemeFont, type ThemeRadius,
} from "./appearance";

/* ---------- Catalog of section types ---------- */

export const BLOCK_TYPES = {
  header: { label: "Encabezado y menú", description: "Logo, buscador y enlaces arriba de todas las páginas.", single: true },
  hero: { label: "Portada", description: "Título grande con texto, imagen y botones.", single: false },
  banners: { label: "Banners", description: "Imágenes que pasan solas, con texto y enlace.", single: false },
  catalog: { label: "Catálogo", description: "Todos tus productos con categorías, filtros y orden.", single: true },
  products: { label: "Productos destacados", description: "Una fila de productos: novedades, una categoría o una palabra clave.", single: false },
  text: { label: "Texto", description: "Un título y párrafos, listas o enlaces.", single: false },
  imageText: { label: "Imagen y texto", description: "Una imagen al lado de un texto con botón.", single: false },
  gallery: { label: "Galería", description: "Varias fotos en cuadrícula, mosaico o carrusel.", single: false },
  faq: { label: "Preguntas frecuentes", description: "Preguntas que se abren al tocarlas.", single: false },
  hours: { label: "Horarios", description: "Días y horas de atención, con «Abierto ahora».", single: false },
  map: { label: "Mapa", description: "Tu ubicación en Google Maps con «Cómo llegar».", single: false },
  loyalty: { label: "Tarjeta de lealtad", description: "Tarjeta de sellos para premiar compras frecuentes.", single: false },
  embed: { label: "Video o contenido embebido", description: "YouTube, Vimeo, Spotify, TikTok, Instagram, Google Maps, formularios…", single: false },
  html: { label: "HTML personalizado", description: "Tu propio HTML y JavaScript, aislado en un marco seguro.", single: false },
  divider: { label: "Divisor", description: "Una línea, una forma o un espacio entre secciones.", single: false },
} as const;
export type BlockType = keyof typeof BLOCK_TYPES;
export const BLOCK_TYPE_IDS = Object.keys(BLOCK_TYPES) as BlockType[];

export const BLOCK_LIMITS = { blocks: 40, htmlBlocks: 10, html: 100_000, markdown: 5_000, slides: 8, images: 24, faq: 30, links: 8 } as const;

/* ---------- Field helpers ---------- */

export const IMAGE_KEY = /^t\/[A-Za-z0-9_-]+\/[A-Za-z0-9._/-]+$/;
const HEX = /^#[0-9a-f]{6}$/;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const txt = (max: number, def: string | null = null) =>
  z.string().trim().max(max, `Máximo ${max} caracteres`).nullable().default(def).transform((v) => (v ? v : null));
const req = (max: number, message = "Escribe el texto") => z.string().trim().min(1, message).max(max, `Máximo ${max} caracteres`);
const bool = (def: boolean) => z.boolean().default(def);
const int = (min: number, max: number, def: number) => z.number().int().min(min).max(max).default(def);
const color = z.string().trim().toLowerCase().regex(HEX, "Color no válido (usa #RRGGBB)").nullable().default(null);
const image = z.string().min(1).max(200).regex(IMAGE_KEY, "Imagen no válida");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida").nullable().default(null);
const linkMessage = "Usa una ruta de tu tienda (/p/…, ?categoria=…, #seccion) o una dirección https://";
const link = z.string().trim().max(500).nullable().default(null).transform((v) => (v ? v : null)).refine((v) => v === null || STORE_LINK.test(v), linkMessage);
const requiredLink = z.string().trim().min(1, "Escribe el enlace").max(500).refine((v) => STORE_LINK.test(v), linkMessage);
const button = z.object({ label: req(30), link: requiredLink, variant: z.enum(["primary", "secondary"]).default("primary") });
const fontEnum = z.enum(THEME_FONT_IDS as [ThemeFont, ...ThemeFont[]]);
const radiusEnum = z.enum(THEME_RADIUS_IDS as [ThemeRadius, ...ThemeRadius[]]);

export const PRODUCT_SORTS = { featured: "Destacados", new: "Lo más nuevo", price_asc: "Precio: menor a mayor", price_desc: "Precio: mayor a menor", name: "Nombre" } as const;
export type ProductSort = keyof typeof PRODUCT_SORTS;
const sort = z.enum(Object.keys(PRODUCT_SORTS) as [ProductSort, ...ProductSort[]]);

/* ---------- Style of a section (colors and shapes) ---------- */

export const SPACING = { none: 0, sm: 24, md: 48, lg: 80, xl: 120 } as const;
export const BLOCK_WIDTHS = { narrow: "Angosto", normal: "Normal", wide: "Amplio", full: "Toda la pantalla" } as const;
export const BLOCK_EDGES = { none: "Recto", slant: "Inclinado", curve: "Curva", wave: "Ola", zigzag: "Zigzag" } as const;
export const BLOCK_FRAMES = { none: "Sin marco", card: "Tarjeta", outline: "Contorno" } as const;
type Spacing = keyof typeof SPACING;
const spacing = z.enum(Object.keys(SPACING) as [Spacing, ...Spacing[]]);
const edge = z.enum(Object.keys(BLOCK_EDGES) as [keyof typeof BLOCK_EDGES, ...Array<keyof typeof BLOCK_EDGES>]);

export const blockStyleSchema = z.object({
  /** null = the theme's. */
  background: color,
  text: color,
  /** Buttons, links and highlights. */
  accent: color,
  backgroundImage: image.nullable().default(null),
  /** How much of the background color covers the image, 0–90 %. */
  overlay: int(0, 90, 40),
  font: fontEnum.nullable().default(null),
  radius: radiusEnum.nullable().default(null),
  paddingTop: spacing.default("md"),
  paddingBottom: spacing.default("md"),
  width: z.enum(Object.keys(BLOCK_WIDTHS) as [keyof typeof BLOCK_WIDTHS, ...Array<keyof typeof BLOCK_WIDTHS>]).default("normal"),
  align: z.enum(["left", "center", "right"]).default("left"),
  /** The content sits on a card or inside an outline. */
  frame: z.enum(Object.keys(BLOCK_FRAMES) as [keyof typeof BLOCK_FRAMES, ...Array<keyof typeof BLOCK_FRAMES>]).default("none"),
  /** Shape of the top and bottom edges. */
  edgeTop: edge.default("none"),
  edgeBottom: edge.default("none"),
});
export type BlockStyle = z.infer<typeof blockStyleSchema>;

/* ---------- Content of each section type ---------- */

const slide = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
    enabled: bool(true),
    image,
    /** Optional portrait image for phones. */
    imageMobile: image.nullable().default(null),
    heading: txt(80),
    text: txt(160),
    cta: txt(30),
    link,
    textColor: z.enum(["light", "dark"]).default("light"),
    align: z.enum(["left", "center", "right"]).default("left"),
    startsOn: date,
    endsOn: date,
  })
  .refine((s) => !s.cta || s.link, { message: "El botón necesita un enlace", path: ["link"] })
  .refine((s) => !s.startsOn || !s.endsOn || s.startsOn <= s.endsOn, { message: "La fecha final es antes de la inicial", path: ["endsOn"] });

const timeRange = z.object({ open: z.string().regex(TIME, "Hora no válida"), close: z.string().regex(TIME, "Hora no válida") }).refine((r) => r.open !== r.close, { message: "La hora de cierre es igual a la de apertura", path: ["close"] });
const day = z.object({ closed: bool(false), ranges: z.array(timeRange).min(1).max(2).default([{ open: "09:00", close: "18:00" }]) });
/** Monday first. */
export const WEEK_DAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"] as const;
const DEFAULT_WEEK = [
  ...Array.from({ length: 5 }, () => ({ closed: false, ranges: [{ open: "09:00", close: "18:00" }] })),
  { closed: false, ranges: [{ open: "10:00", close: "14:00" }] },
  { closed: true, ranges: [{ open: "10:00", close: "14:00" }] },
];

export const LOYALTY_ICONS = { star: "Estrella", heart: "Corazón", coffee: "Café", bag: "Bolsa", gift: "Regalo", check: "Palomita" } as const;
export const EMBED_RATIOS = { "16:9": "Horizontal 16:9", "4:3": "4:3", "1:1": "Cuadrado", "9:16": "Vertical 9:16", auto: "Altura fija" } as const;
export const IMAGE_RATIOS = { square: "Cuadrada", portrait: "Vertical", landscape: "Horizontal", original: "Original" } as const;
const ratio = z.enum(Object.keys(IMAGE_RATIOS) as [keyof typeof IMAGE_RATIOS, ...Array<keyof typeof IMAGE_RATIOS>]);
export const DIVIDER_KINDS = { line: "Línea", dashed: "Guiones", dotted: "Puntos", wave: "Ola", zigzag: "Zigzag", space: "Solo espacio" } as const;

const data = {
  header: z.object({
    logo: z.enum(["logo_name", "logo", "name"]).default("logo_name"),
    layout: z.enum(["inline", "centered"]).default("inline"),
    search: bool(true),
    account: bool(true),
    sticky: bool(true),
    links: z.array(z.object({ label: req(30), link: requiredLink })).max(BLOCK_LIMITS.links, `Hasta ${BLOCK_LIMITS.links} enlaces`).default([]),
  }),
  hero: z.object({
    /** null = the store's name. */
    heading: txt(120),
    showHeading: bool(true),
    /** null = the store's tagline. */
    text: txt(300),
    showText: bool(true),
    image: image.nullable().default(null),
    imageMobile: image.nullable().default(null),
    /** The image behind the text, or beside it. */
    layout: z.enum(["background", "split"]).default("background"),
    imageSide: z.enum(["left", "right"]).default("right"),
    height: z.enum(["auto", "sm", "md", "lg", "screen"]).default("auto"),
    buttons: z.array(button).max(2, "Hasta 2 botones").default([]),
    /** Pickup and delivery facts under the text. */
    facts: bool(true),
  }),
  banners: z.object({
    slides: z.array(slide).max(BLOCK_LIMITS.slides, `Hasta ${BLOCK_LIMITS.slides} banners`).default([]),
    /** Seconds per slide; 0 = they don't pass by themselves. */
    interval: int(0, 20, 6),
    height: z.enum(["auto", "sm", "md", "lg"]).default("auto"),
    arrows: bool(true),
    dots: bool(true),
  }),
  catalog: z.object({
    heading: txt(80),
    categories: bool(true),
    keywords: bool(true),
    sort: bool(true),
    defaultSort: sort.default("featured"),
    columns: int(2, 5, 4),
    pageSize: int(8, 60, 24),
  }),
  products: z.object({
    heading: txt(80, "Novedades"),
    text: txt(200),
    sort: sort.default("new"),
    categoryId: z.string().max(40).nullable().default(null).transform((v) => (v ? v : null)),
    keyword: txt(40),
    limit: int(2, 24, 8),
    columns: int(2, 6, 4),
    layout: z.enum(["grid", "row"]).default("grid"),
    moreLink: bool(true),
  }),
  text: z.object({
    heading: txt(120),
    body: z.string().trim().max(BLOCK_LIMITS.markdown, `Máximo ${BLOCK_LIMITS.markdown} caracteres`).default(""),
    size: z.enum(["sm", "md", "lg"]).default("md"),
  }),
  imageText: z.object({
    image: image.nullable().default(null),
    heading: txt(120),
    body: z.string().trim().max(BLOCK_LIMITS.markdown, `Máximo ${BLOCK_LIMITS.markdown} caracteres`).default(""),
    button: button.nullable().default(null),
    imageSide: z.enum(["left", "right"]).default("left"),
    ratio: ratio.default("landscape"),
    fit: z.enum(["cover", "contain"]).default("cover"),
  }),
  gallery: z.object({
    heading: txt(80),
    images: z.array(z.object({ image, caption: txt(120), link })).max(BLOCK_LIMITS.images, `Hasta ${BLOCK_LIMITS.images} fotos`).default([]),
    layout: z.enum(["grid", "masonry", "carousel"]).default("grid"),
    columns: int(2, 6, 3),
    ratio: ratio.default("square"),
    gap: z.enum(["none", "sm", "md"]).default("sm"),
  }),
  faq: z.object({
    heading: txt(80, "Preguntas frecuentes"),
    /** "store" = the questions in Ajustes de la tienda (also used for search engines). */
    source: z.enum(["store", "own"]).default("store"),
    items: z.array(z.object({ q: req(200, "Escribe la pregunta"), a: req(2000, "Escribe la respuesta") })).max(BLOCK_LIMITS.faq, `Hasta ${BLOCK_LIMITS.faq} preguntas`).default([]),
    openFirst: bool(false),
  }),
  hours: z.object({
    heading: txt(80, "Horarios"),
    days: z.array(day).length(7).default(DEFAULT_WEEK),
    note: txt(200),
    /** "Abierto ahora / Cerrado" in the business's time zone. */
    status: bool(true),
  }),
  map: z.object({
    heading: txt(80, "Visítanos"),
    /** null = the business's address. */
    address: txt(300),
    zoom: int(3, 20, 15),
    height: z.enum(["sm", "md", "lg"]).default("md"),
    /** Address card with "Cómo llegar" beside the map. */
    info: bool(true),
  }),
  loyalty: z.object({
    heading: txt(80, "Tarjeta de lealtad"),
    text: txt(300, "Junta sellos con cada compra y llévate un premio."),
    stamps: int(4, 20, 10),
    /** Stamps shown as filled, as an example. */
    sample: int(0, 20, 3),
    reward: txt(80, "¡Tu siguiente compra gratis!"),
    icon: z.enum(Object.keys(LOYALTY_ICONS) as [keyof typeof LOYALTY_ICONS, ...Array<keyof typeof LOYALTY_ICONS>]).default("star"),
    button: button.nullable().default(null),
  }),
  embed: z.object({
    heading: txt(80),
    url: z.string().trim().max(1000).nullable().default(null).transform((v) => (v ? v : null)).refine((v) => v === null || embedSrc(v) !== null, "Pega una dirección https:// (YouTube, Vimeo, Spotify, TikTok, Instagram, Google Maps…)"),
    ratio: z.enum(Object.keys(EMBED_RATIOS) as [keyof typeof EMBED_RATIOS, ...Array<keyof typeof EMBED_RATIOS>]).default("16:9"),
    /** Height in px when the ratio is "auto". */
    height: int(120, 2000, 450),
    caption: txt(200),
  }),
  html: z.object({
    /** Read by screen readers. */
    title: txt(80, "Contenido personalizado"),
    html: z.string().max(BLOCK_LIMITS.html, `Máximo ${BLOCK_LIMITS.html.toLocaleString("es-MX")} caracteres`).default(""),
    /** Starting height in px; with autoHeight the frame then follows its content. */
    height: int(0, 5000, 300),
    autoHeight: bool(true),
    /** Extra sandbox permissions. Never allow-same-origin nor top navigation. */
    forms: bool(false),
    popups: bool(false),
  }),
  divider: z.object({
    kind: z.enum(Object.keys(DIVIDER_KINDS) as [keyof typeof DIVIDER_KINDS, ...Array<keyof typeof DIVIDER_KINDS>]).default("line"),
    thickness: int(1, 8, 1),
    width: z.enum(["short", "medium", "full"]).default("full"),
  }),
} satisfies Record<BlockType, z.ZodObject>;

/* ---------- The block ---------- */

const base = {
  id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, "Id no válido"),
  enabled: bool(true),
  /** Optional name in the editor ("Promo de verano"). */
  name: txt(60),
  device: z.enum(["all", "desktop", "mobile"]).default("all"),
  /** id="…" of the section, for menu links like #horarios. */
  anchor: z.string().trim().toLowerCase().max(40).regex(/^[a-z0-9-]*$/, "Solo letras minúsculas, números y guiones").nullable().default(null).transform((v) => (v ? v : null)),
  startsOn: date,
  endsOn: date,
  style: blockStyleSchema.prefault({}),
};
export const blockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("header"), ...base, data: data.header.prefault({}) }),
  z.object({ type: z.literal("hero"), ...base, data: data.hero.prefault({}) }),
  z.object({ type: z.literal("banners"), ...base, data: data.banners.prefault({}) }),
  z.object({ type: z.literal("catalog"), ...base, data: data.catalog.prefault({}) }),
  z.object({ type: z.literal("products"), ...base, data: data.products.prefault({}) }),
  z.object({ type: z.literal("text"), ...base, data: data.text.prefault({}) }),
  z.object({ type: z.literal("imageText"), ...base, data: data.imageText.prefault({}) }),
  z.object({ type: z.literal("gallery"), ...base, data: data.gallery.prefault({}) }),
  z.object({ type: z.literal("faq"), ...base, data: data.faq.prefault({}) }),
  z.object({ type: z.literal("hours"), ...base, data: data.hours.prefault({}) }),
  z.object({ type: z.literal("map"), ...base, data: data.map.prefault({}) }),
  z.object({ type: z.literal("loyalty"), ...base, data: data.loyalty.prefault({}) }),
  z.object({ type: z.literal("embed"), ...base, data: data.embed.prefault({}) }),
  z.object({ type: z.literal("html"), ...base, data: data.html.prefault({}) }),
  z.object({ type: z.literal("divider"), ...base, data: data.divider.prefault({}) }),
]);
export type StoreBlock = z.infer<typeof blockSchema>;
export type BlockOf<T extends BlockType> = Extract<StoreBlock, { type: T }>;
export type BlockData<T extends BlockType> = BlockOf<T>["data"];
export type BannerSlide = BlockData<"banners">["slides"][number];

export const blockListSchema = z
  .array(blockSchema)
  .max(BLOCK_LIMITS.blocks, `Hasta ${BLOCK_LIMITS.blocks} secciones`)
  .superRefine((blocks, ctx) => {
    const ids = new Set<string>();
    blocks.forEach((b, i) => {
      if (ids.has(b.id)) ctx.addIssue({ code: "custom", message: "Sección repetida", path: [i, "id"] });
      ids.add(b.id);
      if (b.startsOn && b.endsOn && b.startsOn > b.endsOn) ctx.addIssue({ code: "custom", message: "La fecha final es antes de la inicial", path: [i, "endsOn"] });
      if (b.type === "hours") b.data.days.forEach((d, k) => { if (!d.closed && d.ranges.length === 2 && d.ranges[1]!.open < d.ranges[0]!.close) ctx.addIssue({ code: "custom", message: "El segundo horario empieza antes de que termine el primero", path: [i, "data", "days", k, "ranges", 1, "open"] }); });
    });
    for (const t of BLOCK_TYPE_IDS.filter((x) => BLOCK_TYPES[x].single)) {
      const at = blocks.map((b, i) => (b.type === t ? i : -1)).filter((i) => i >= 0);
      if (at.length > 1) ctx.addIssue({ code: "custom", message: `Solo puede haber una sección «${BLOCK_TYPES[t].label}»`, path: [at[1]!, "type"] });
    }
    if (blocks.filter((b) => b.type === "html").length > BLOCK_LIMITS.htmlBlocks) ctx.addIssue({ code: "custom", message: `Hasta ${BLOCK_LIMITS.htmlBlocks} secciones de HTML personalizado` , path: [] });
  });

/** A new block of a type with every default. */
export const newBlock = <T extends BlockType>(type: T, id: string): BlockOf<T> => blockSchema.parse({ id, type }) as BlockOf<T>;

/** What a store shows before the business arranges anything: what the home always had. */
export const DEFAULT_BLOCKS: StoreBlock[] = [newBlock("hero", "portada"), newBlock("catalog", "catalogo"), newBlock("faq", "preguntas")];

/**
 * Blocks read from the database: each one through the schema (defaults for new fields), dropping what
 * no longer fits instead of failing the whole store. `null` (never saved) = the default home.
 */
export function normalizeBlocks(raw: unknown): StoreBlock[] {
  if (raw === null || raw === undefined) return DEFAULT_BLOCKS;
  if (!Array.isArray(raw)) return DEFAULT_BLOCKS;
  const out: StoreBlock[] = [];
  const ids = new Set<string>();
  for (const item of raw) {
    const r = blockSchema.safeParse(item);
    if (!r.success || ids.has(r.data.id)) continue;
    if (BLOCK_TYPES[r.data.type].single && out.some((b) => b.type === r.data.type)) continue;
    ids.add(r.data.id);
    out.push(r.data);
  }
  return out.slice(0, BLOCK_LIMITS.blocks);
}

/** Uploaded images a block uses (the API checks they belong to the business). */
export function blockImages(b: StoreBlock): Array<{ path: string; key: string }> {
  const out: Array<{ path: string; key: string }> = [];
  const add = (path: string, key: string | null | undefined) => { if (key) out.push({ path, key }); };
  add("style.backgroundImage", b.style.backgroundImage);
  if (b.type === "hero") { add("data.image", b.data.image); add("data.imageMobile", b.data.imageMobile); }
  if (b.type === "banners") b.data.slides.forEach((s, i) => { add(`data.slides.${i}.image`, s.image); add(`data.slides.${i}.imageMobile`, s.imageMobile); });
  if (b.type === "imageText") add("data.image", b.data.image);
  if (b.type === "gallery") b.data.images.forEach((g, i) => add(`data.images.${i}.image`, g.image));
  return out;
}

/** Blocks the public sees today: visible, in dates, and with something to show. */
export function publicBlocks(blocks: StoreBlock[], today: string): StoreBlock[] {
  return blocks
    .filter((b) => b.enabled && activeOn(b, today))
    .map((b) => (b.type === "banners" ? { ...b, data: { ...b.data, slides: b.data.slides.filter((s) => s.enabled && activeOn(s, today)) } } : b))
    .filter((b) => {
      if (b.type === "banners") return b.data.slides.length > 0;
      if (b.type === "gallery") return b.data.images.length > 0;
      if (b.type === "embed") return b.data.url !== null;
      if (b.type === "html") return b.data.html.trim() !== "";
      if (b.type === "faq") return b.data.source === "store" || b.data.items.length > 0;
      return true;
    });
}

/** Short description of a block for the editor list and the MCP tools. */
export function blockSummary(b: StoreBlock): string {
  switch (b.type) {
    case "header": return b.data.links.length ? b.data.links.map((l) => l.label).join(" · ") : "Sin enlaces de menú";
    case "hero": return b.data.showHeading ? (b.data.heading ?? "Nombre de la tienda") : "Sin título";
    case "banners": return `${b.data.slides.length} ${b.data.slides.length === 1 ? "imagen" : "imágenes"}`;
    case "catalog": return b.data.heading ?? "Todos los productos";
    case "products": return [b.data.heading, `${b.data.limit} productos`].filter(Boolean).join(" · ");
    case "text": case "imageText": return b.data.heading ?? (b.data.body.slice(0, 60) || "Sin texto");
    case "gallery": return `${b.data.images.length} ${b.data.images.length === 1 ? "foto" : "fotos"}`;
    case "faq": return b.data.source === "store" ? "Preguntas de Ajustes de la tienda" : `${b.data.items.length} preguntas`;
    case "hours": return b.data.heading ?? "Horarios";
    case "map": return b.data.address ?? "Dirección del negocio";
    case "loyalty": return `${b.data.stamps} sellos · ${b.data.reward ?? ""}`.trim();
    case "embed": return b.data.url ? (embedSrc(b.data.url)?.label ?? "Contenido") : "Sin enlace";
    case "html": return `${b.data.html.length.toLocaleString("es-MX")} caracteres`;
    case "divider": return DIVIDER_KINDS[b.data.kind];
  }
}

/* ---------- Section colors: the theme's tokens, recomputed over the section's colors ---------- */

/**
 * CSS custom properties for a section. Colors left empty follow the theme (and its dark mode); a section
 * with its own background gets its own readable text, borders and buttons. `scheme` is the section's
 * color-scheme when it has its own colors.
 */
export function blockStyleVars(theme: StoreTheme, s: Pick<BlockStyle, "background" | "text" | "accent" | "font" | "radius">): { vars: Record<string, string>; scheme: "light" | "dark" | null } {
  const hasColor = Boolean(s.background || s.text || s.accent);
  if (!hasColor && !s.font && !s.radius) return { vars: {}, scheme: null };
  const t = resolveTheme(theme);
  const font = s.font ?? t.font;
  const radius = s.radius ?? t.radius;
  if (!hasColor) {
    const vars = themeTokens({ ...t, font, radius, scheme: "auto" });
    return { vars, scheme: null };
  }
  const bg = s.background ?? t.background;
  const text = s.text ?? (contrast(t.text, bg) >= 4.5 ? t.text : luminance(bg) < 0.2 ? "#f5f5f4" : "#1c1c1a");
  const scheme = luminance(bg) < 0.2 ? "dark" : "light";
  const r: ResolvedTheme = { ...t, background: bg, text, primary: s.accent ?? t.primary, font, radius, scheme, custom: true };
  return { vars: themeTokens(r), scheme };
}

/* ---------- Custom HTML: sandboxed frame and the size messages it may send ---------- */

export const FRAME_MAX = { height: 10_000, width: 4_000 } as const;
const PERCENT = /^(?:100|[1-9]?\d)(?:\.\d{1,2})?%$/;

export interface FrameSize { height?: string; width?: string }

/**
 * The only message the custom HTML frame may send: `{ height?, width? }`, each a number of pixels or a
 * percentage string ("50%"). Anything else (other keys, other types, units, NaN, negative, too big) is
 * rejected whole. Returns CSS lengths: height % = % of the screen height (vh), width % = % of the section.
 * The caller must also check that the message comes from its own iframe (event.source).
 */
export function parseFrameSize(message: unknown): FrameSize | null {
  if (typeof message !== "object" || message === null || Array.isArray(message)) return null;
  if (Object.getPrototypeOf(message) !== Object.prototype) return null;
  const entries = Object.entries(message as Record<string, unknown>);
  if (entries.length === 0 || entries.length > 2) return null;
  const out: FrameSize = {};
  for (const [k, v] of entries) {
    if (k !== "height" && k !== "width") return null;
    let css: string | null = null;
    if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= FRAME_MAX[k]) css = `${Math.round(v)}px`;
    else if (typeof v === "string" && PERCENT.test(v)) css = `${Number.parseFloat(v)}${k === "height" ? "vh" : "%"}`;
    if (css === null) return null;
    out[k] = css;
  }
  return out;
}

/** sandbox="" of the custom HTML frame. Scripts yes; same origin, top navigation and downloads, never. */
export function frameSandbox(d: Pick<BlockData<"html">, "forms" | "popups">) {
  return ["allow-scripts", d.forms && "allow-forms", d.popups && "allow-popups", d.popups && "allow-popups-to-escape-sandbox"].filter(Boolean).join(" ");
}

/** Reports the content height to the store (the only thing the frame says). */
const RESIZE_SCRIPT =
  "(function(){var l=-1;function s(){var h=Math.ceil(document.documentElement.getBoundingClientRect().height);if(h!==l){l=h;parent.postMessage({height:h},'*')}}" +
  "if(window.ResizeObserver)new ResizeObserver(s).observe(document.documentElement);addEventListener('load',s);s()})();";

/**
 * srcdoc of the frame: the owner's HTML plus the section's colors and fonts as CSS variables
 * (--primary, --bg, --ink…), so it can match the store.
 */
export function frameDocument(html: string, opts: { autoHeight: boolean; vars: Record<string, string> }) {
  const vars = Object.entries(opts.vars).filter(([k, v]) => /^--[a-z0-9-]+$/.test(k) && !/[<>{}]/.test(v)).map(([k, v]) => `${k}:${v}`).join(";");
  return (
    '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<style>:root{${vars}}html,body{margin:0;background:transparent}body{color:var(--ink,inherit);font-family:var(--font-sans,system-ui,sans-serif)}</style></head><body>` +
    html +
    (opts.autoHeight ? `<script>${RESIZE_SCRIPT}</script>` : "") +
    "</body></html>"
  );
}

/* ---------- Embeds: known providers and any https page ---------- */

/** WHATWG URL (Workers, browsers and Node have it; this package's TS libs don't declare it). */
interface ParsedUrl { protocol: string; username: string; password: string; hostname: string; pathname: string; href: string; searchParams: { get(k: string): string | null; set(k: string, v: string): void } }
const UrlCtor = (globalThis as unknown as { URL: new (input: string) => ParsedUrl }).URL;

export interface EmbedInfo { provider: "youtube" | "vimeo" | "spotify" | "maps" | "tiktok" | "instagram" | "calendly" | "forms" | "other"; label: string; src: string; sandbox: string; allow: string }

const TRUSTED_SANDBOX = "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation allow-forms";
// Unknown pages run without their own origin's storage either; good enough for widgets, safe for us.
const OTHER_SANDBOX = "allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms";
const ALLOW = "autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write";

/** Turns what the owner pastes (a share link) into the address to embed, or null if it can't be embedded. */
export function embedSrc(raw: string | null | undefined): EmbedInfo | null {
  if (!raw) return null;
  let u: ParsedUrl;
  try { u = new UrlCtor(raw.trim()); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || /[<>"\s]/.test(u.href)) return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, "");
  const trusted = (provider: EmbedInfo["provider"], label: string, src: string): EmbedInfo => ({ provider, label, src, sandbox: TRUSTED_SANDBOX, allow: ALLOW });
  const path = u.pathname;

  if (host === "youtube.com" || host === "youtu.be" || host === "youtube-nocookie.com") {
    const id = host === "youtu.be" ? path.slice(1).split("/")[0] : (u.searchParams.get("v") ?? /^\/(?:embed|shorts|live)\/([^/]+)/.exec(path)?.[1]);
    if (!id || !/^[A-Za-z0-9_-]{6,20}$/.test(id)) return null;
    const start = Number.parseInt((u.searchParams.get("t") ?? u.searchParams.get("start") ?? "").replace(/s$/, ""), 10);
    return trusted("youtube", "YouTube", `https://www.youtube-nocookie.com/embed/${id}${start > 0 ? `?start=${start}` : ""}`);
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = /^\/(?:video\/)?(\d{5,12})/.exec(path)?.[1];
    return id ? trusted("vimeo", "Vimeo", `https://player.vimeo.com/video/${id}`) : null;
  }
  if (host === "open.spotify.com") {
    const m = /^\/(?:intl-[a-z-]+\/)?(?:embed\/)?(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]{10,30})/.exec(path);
    return m ? trusted("spotify", "Spotify", `https://open.spotify.com/embed/${m[1]}/${m[2]}`) : null;
  }
  if ((host === "google.com" || host === "maps.google.com") && path.startsWith("/maps/embed")) return trusted("maps", "Google Maps", u.href);
  if (host === "tiktok.com") {
    const id = /\/video\/(\d{8,25})/.exec(path)?.[1] ?? /^\/embed\/(?:v2\/)?(\d{8,25})/.exec(path)?.[1];
    return id ? trusted("tiktok", "TikTok", `https://www.tiktok.com/embed/v2/${id}`) : null;
  }
  if (host === "instagram.com") {
    const m = /^\/(p|reel|tv)\/([A-Za-z0-9_-]{5,40})/.exec(path);
    return m ? trusted("instagram", "Instagram", `https://www.instagram.com/${m[1]}/${m[2]}/embed`) : null;
  }
  if (host === "calendly.com") return trusted("calendly", "Calendly", u.href);
  if (host === "docs.google.com" && path.startsWith("/forms/")) {
    const f = new UrlCtor(u.href);
    f.searchParams.set("embedded", "true");
    return trusted("forms", "Formulario de Google", f.href);
  }
  return { provider: "other", label: host, src: u.href, sandbox: OTHER_SANDBOX, allow: ALLOW };
}

/** Google Maps without an API key, from an address. */
export const mapSrc = (address: string, zoom: number) => `https://www.google.com/maps?q=${encodeURIComponent(address)}&z=${zoom}&output=embed`;
export const directionsUrl = (address: string) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;

/* ---------- Opening hours ---------- */

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Is it open at this moment in the business's time zone? Ranges that close before they open end the next day. */
export function openNow(days: BlockData<"hours">["days"], timeZone: string, now = new Date()): boolean {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  } catch {
    return false;
  }
  const wd = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.find((p) => p.type === "weekday")?.value ?? "");
  const m = Number(parts.find((p) => p.type === "hour")?.value) * 60 + Number(parts.find((p) => p.type === "minute")?.value);
  if (wd < 0 || Number.isNaN(m)) return false;
  const inDay = (d: number, at: number, carry: boolean) => {
    const day = days[(d + 7) % 7];
    if (!day || day.closed) return false;
    return day.ranges.some((r) => {
      const o = minutes(r.open), c = minutes(r.close);
      if (c > o) return !carry && at >= o && at < c;
      return carry ? at < c : at >= o; // overnight range
    });
  };
  return inDay(wd, m, false) || inDay(wd - 1, m, true);
}

/** Today's index in WEEK_DAYS (Monday = 0) in a time zone. */
export function weekdayIndex(timeZone: string, now = new Date()) {
  try {
    const wd = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(now);
    return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(wd);
  } catch {
    return -1;
  }
}

/* ---------- The whole appearance document ---------- */

export const CODE_LIMITS = { css: 50_000 } as const;
export interface StoreCustomCode { css: string }
export const NO_CODE: StoreCustomCode = { css: "" };

/** Everything the "Apariencia" editor saves. */
export interface StoreAppearance {
  theme: StoreTheme;
  announcement: StoreAnnouncement;
  /** The home page, top to bottom (the header block, if any, is drawn on every page). */
  blocks: StoreBlock[];
  pixels: StorePixels;
  code: StoreCustomCode;
}

export interface StoreAppearanceSettings extends StoreAppearance {
  updatedAt: string | null;
}

/** What the public store gets (only what is active today; the custom CSS is injected by the server, not here). */
export interface PublicAppearance {
  theme: StoreTheme;
  announcement: { id: string; messages: Array<{ text: string; link: string | null }>; tone: AnnouncementTone; dismissible: boolean } | null;
  blocks: StoreBlock[];
  pixels: StorePixels;
}

/** Stable id of an announcement's content, so "close" is remembered until the text changes. */
export function announcementId(a: Pick<StoreAnnouncement, "messages">) {
  let h = 5381;
  for (const ch of JSON.stringify(a.messages)) h = ((h << 5) + h + ch.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
}

export function publicAppearance(a: Pick<StoreAppearance, "theme" | "announcement" | "blocks" | "pixels">, today: string): PublicAppearance {
  const ann = a.announcement;
  const messages = ann.messages.filter((m) => m.text.trim());
  return {
    theme: a.theme,
    announcement: ann.enabled && messages.length && activeOn(ann, today) ? { id: announcementId({ messages }), messages, tone: ann.tone, dismissible: ann.dismissible } : null,
    blocks: publicBlocks(a.blocks, today),
    pixels: a.pixels,
  };
}
