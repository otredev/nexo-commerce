/**
 * Home page sections (Apariencia › Página principal). Each block is drawn inside <Section>, which applies
 * its colors (the theme's tokens recomputed over the section's own colors), spacing, width, frame and
 * edge shapes; the renderers only lay out their content.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Check, ChevronLeft, ChevronRight, Clock, Coffee, Gift, Heart, MapPin, Navigation, ShoppingBag, Star, Store, Truck } from "lucide-react";
import {
  blockStyleVars, directionsUrl, embedSrc, frameDocument, frameSandbox, mapSrc, openNow, parseFrameSize, resolveTheme, SPACING, themeTokens, WEEK_DAYS,
  weekdayIndex, type BlockOf, type Paginated, type StoreBlock, type StoreProductCard,
} from "@nexo/shared";
import { api, imageUrl } from "../lib/api";
import { useStore } from "../lib/store";
import { Markdown } from "./Markdown";
import { ProductCard } from "./ProductCard";
import { BannerCarousel, StoreLinkTo } from "./Appearance";
import { CatalogSection } from "./CatalogSection";

/* ---------- The section frame ---------- */

export function Section({ block, children, as = "section", label }: { block: StoreBlock; children: ReactNode; as?: "section" | "div"; label?: string }) {
  const { store, preview } = useStore();
  const ref = useRef<HTMLElement>(null);
  const s = block.style;
  const theme = store!.appearance.theme;
  const { vars, scheme } = useMemo(() => blockStyleVars(theme, s), [theme, s]);
  const selected = preview?.selected === block.id;
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selected]);
  const image = s.backgroundImage ? imageUrl(s.backgroundImage) : null;
  const style = {
    ...vars,
    ...(scheme && { colorScheme: scheme }),
    "--blk-pt": `${SPACING[s.paddingTop]}px`,
    "--blk-pb": `${SPACING[s.paddingBottom]}px`,
    ...(image && { "--blk-img": `url("${image}")`, "--blk-overlay": `${s.overlay}%` }),
  } as CSSProperties;
  const Tag = as;
  return (
    <Tag
      ref={ref as never}
      id={block.anchor ?? undefined}
      className={`st-block st-block--${block.type}`}
      aria-label={label}
      data-paint={"--bg" in vars || image ? "" : undefined}
      data-image={image ? "" : undefined}
      data-width={s.width}
      data-align={s.align}
      data-frame={s.frame}
      data-edge-top={s.edgeTop}
      data-edge-bottom={s.edgeBottom}
      data-device={block.device}
      data-selected={selected || undefined}
      style={style}
    >
      <div className="st-block__inner">
        <div className="st-block__content">{children}</div>
      </div>
    </Tag>
  );
}

function Heading({ text, level = 2 }: { text: string | null; level?: 1 | 2 }) {
  if (!text) return null;
  const H = level === 1 ? "h1" : "h2";
  return <H className="st-block__title">{text}</H>;
}

function Buttons({ buttons }: { buttons: Array<{ label: string; link: string; variant: "primary" | "secondary" }> }) {
  if (!buttons.length) return null;
  return (
    <div className="st-btns">
      {buttons.map((b, i) => <StoreLinkTo key={i} href={b.link} className={`nx-btn nx-btn--${b.variant} nx-btn--lg`}>{b.label}</StoreLinkTo>)}
    </div>
  );
}

/* ---------- Home: every section in order ---------- */

export function HomeBlocks({ blocks }: { blocks: StoreBlock[] }) {
  const { store } = useStore();
  // One h1 per page: the first hero with a visible title; otherwise the store's name, for screen readers.
  const h1 = blocks.find((b): b is BlockOf<"hero"> => b.type === "hero" && b.data.showHeading)?.id ?? null;
  return (
    <>
      {!h1 && <h1 className="nx-sr-only">{store!.name}</h1>}
      {blocks.map((b) => <Block key={b.id} block={b} h1={b.id === h1} />)}
    </>
  );
}

function Block({ block: b, h1 }: { block: StoreBlock; h1: boolean }) {
  switch (b.type) {
    case "header": return null; // drawn by the layout on every page
    case "hero": return <Hero b={b} h1={h1} />;
    case "banners": return <Section block={b} label="Promociones"><BannerCarousel block={b} /></Section>;
    case "catalog": return <Section block={b}><CatalogSection data={b.data} /></Section>;
    case "products": return <Products b={b} />;
    case "text": return <Text b={b} />;
    case "imageText": return <ImageText b={b} />;
    case "gallery": return <Gallery b={b} />;
    case "faq": return <Faq b={b} />;
    case "hours": return <Hours b={b} />;
    case "map": return <MapBlock b={b} />;
    case "loyalty": return <Loyalty b={b} />;
    case "embed": return <Embed b={b} />;
    case "html": return <CustomHtml b={b} />;
    case "divider": return <Divider b={b} />;
  }
}

/* ---------- Portada ---------- */

function Facts() {
  const { store, money } = useStore();
  const s = store!;
  if (!s.pickupEnabled && !s.deliveryEnabled) return null;
  return (
    <div className="st-hero__facts">
      {s.pickupEnabled && <span><Store size={15} strokeWidth={1.6} aria-hidden="true" />Recoge en tienda sin costo</span>}
      {s.deliveryEnabled && (
        <span>
          <Truck size={15} strokeWidth={1.6} aria-hidden="true" />
          {s.freeDeliveryFromCents !== null ? `Envío gratis desde ${money(s.freeDeliveryFromCents)}` : s.deliveryFeeCents ? `Envío a domicilio por ${money(s.deliveryFeeCents)}` : "Envío a domicilio sin costo"}
        </span>
      )}
    </div>
  );
}

function Hero({ b, h1 }: { b: BlockOf<"hero">; h1: boolean }) {
  const { store } = useStore();
  const d = b.data;
  const heading = d.showHeading ? (d.heading ?? store!.name) : null;
  const text = d.showText ? (d.text ?? store!.tagline) : null;
  const layout = d.image ? d.layout : "plain";
  return (
    <Section block={b}>
      <div className="st-hero2" data-layout={layout} data-height={d.height} data-side={d.imageSide} data-own-text={b.style.text ? "" : undefined}>
        {d.image && (
          <picture className="st-hero2__media">
            {d.imageMobile && <source media="(max-width: 640px)" srcSet={imageUrl(d.imageMobile)!} />}
            <img src={imageUrl(d.image)!} alt="" fetchPriority="high" />
          </picture>
        )}
        <div className="st-hero2__copy">
          {heading && (h1 ? <h1 className="st-hero2__title">{heading}</h1> : <h2 className="st-hero2__title">{heading}</h2>)}
          {text && <p className="st-hero2__text">{text}</p>}
          <Buttons buttons={d.buttons} />
          {d.facts && <Facts />}
        </div>
      </div>
    </Section>
  );
}

/* ---------- Productos destacados ---------- */

function Products({ b }: { b: BlockOf<"products"> }) {
  const { slug, link } = useStore();
  const d = b.data;
  const [items, setItems] = useState<StoreProductCard[] | null>(null);
  useEffect(() => {
    const q = new URLSearchParams({ page: "1", pageSize: String(d.limit), sort: d.sort, ...(d.categoryId && { categoryId: d.categoryId }), ...(d.keyword && { keyword: d.keyword }) });
    let live = true;
    api<Paginated<StoreProductCard>>("GET", `/${slug}/products?${q}`).then((r) => { if (live) setItems(r.items); }, () => { if (live) setItems([]); });
    return () => { live = false; };
  }, [slug, d.limit, d.sort, d.categoryId, d.keyword]);
  if (items !== null && items.length === 0) return null;
  // A category or keyword opens the filtered catalog; a sort order jumps to the catalog of the home, sorted.
  const more = d.categoryId ? `?categoria=${encodeURIComponent(d.categoryId)}` : d.keyword ? `?palabra=${encodeURIComponent(d.keyword)}` : `${d.sort !== "featured" ? `?orden=${d.sort}` : ""}#productos`;
  return (
    <Section block={b}>
      {(d.heading || d.text || d.moreLink) && (
        <div className="st-block__head">
          <div>
            <Heading text={d.heading} />
            {d.text && <p className="st-block__lead">{d.text}</p>}
          </div>
          {d.moreLink && <Link className="st-block__more" to={link() === "/" ? `/${more}` : `${link()}${more}`}>Ver todo<ChevronRight size={16} aria-hidden="true" /></Link>}
        </div>
      )}
      <div className="st-grid st-grid--cols" data-layout={d.layout} style={{ "--cols": d.columns } as CSSProperties} aria-busy={items === null}>
        {items === null
          ? Array.from({ length: Math.min(d.limit, d.columns) }, (_, i) => <div key={i}><div className="st-skeleton" style={{ aspectRatio: "4 / 5" }} /></div>)
          : items.map((p) => <ProductCard key={p.id} p={p} />)}
      </div>
    </Section>
  );
}

/* ---------- Texto e imagen ---------- */

function Text({ b }: { b: BlockOf<"text"> }) {
  return (
    <Section block={b}>
      <div className="st-text" data-size={b.data.size}>
        <Heading text={b.data.heading} />
        {b.data.body && <Markdown text={b.data.body} />}
      </div>
    </Section>
  );
}

function ImageText({ b }: { b: BlockOf<"imageText"> }) {
  const d = b.data;
  return (
    <Section block={b}>
      <div className="st-imgtext" data-side={d.imageSide} data-no-image={d.image ? undefined : ""}>
        {d.image && (
          <div className="st-imgtext__media" data-ratio={d.ratio} data-fit={d.fit}>
            <img src={imageUrl(d.image)!} alt="" loading="lazy" />
          </div>
        )}
        <div className="st-imgtext__copy">
          <Heading text={d.heading} />
          {d.body && <Markdown text={d.body} />}
          {d.button && <Buttons buttons={[d.button]} />}
        </div>
      </div>
    </Section>
  );
}

/* ---------- Galería ---------- */

function Gallery({ b }: { b: BlockOf<"gallery"> }) {
  const d = b.data;
  const track = useRef<HTMLDivElement>(null);
  const scroll = (dir: 1 | -1) => track.current?.scrollBy({ left: dir * track.current.clientWidth * 0.8, behavior: "smooth" });
  return (
    <Section block={b}>
      <Heading text={d.heading} />
      <div className="st-gallery-wrap">
        <div ref={track} className="st-gallery" data-layout={d.layout} data-ratio={d.ratio} data-gap={d.gap} style={{ "--cols": d.columns } as CSSProperties}>
          {d.images.map((g, i) => {
            const fig = (
              <figure className="st-gallery__item">
                <img src={imageUrl(g.image)!} alt={g.caption ?? ""} loading="lazy" />
                {g.caption && <figcaption>{g.caption}</figcaption>}
              </figure>
            );
            return g.link ? <StoreLinkTo key={i} href={g.link} className="st-gallery__link">{fig}</StoreLinkTo> : <div key={i} className="st-gallery__link">{fig}</div>;
          })}
        </div>
        {d.layout === "carousel" && d.images.length > 1 && (
          <>
            <button type="button" className="st-banners__arrow" data-dir="prev" aria-label="Anterior" onClick={() => scroll(-1)}><ChevronLeft size={20} aria-hidden="true" /></button>
            <button type="button" className="st-banners__arrow" data-dir="next" aria-label="Siguiente" onClick={() => scroll(1)}><ChevronRight size={20} aria-hidden="true" /></button>
          </>
        )}
      </div>
    </Section>
  );
}

/* ---------- Preguntas frecuentes ---------- */

function Faq({ b }: { b: BlockOf<"faq"> }) {
  const { store } = useStore();
  const items = b.data.source === "store" ? store!.faq : b.data.items;
  if (!items.length) return null;
  return (
    <Section block={b}>
      <div className="st-faq st-faq--block">
        <Heading text={b.data.heading} />
        {items.map((f, i) => (
          <details key={i} open={b.data.openFirst && i === 0}>
            <summary>{f.q}</summary>
            <p>{f.a}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}

/* ---------- Horarios ---------- */

function Hours({ b }: { b: BlockOf<"hours"> }) {
  const { store } = useStore();
  const d = b.data;
  const tz = store!.timezone;
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(id); }, []);
  const today = weekdayIndex(tz, now);
  const open = openNow(d.days, tz, now);
  return (
    <Section block={b}>
      <div className="st-hours">
        <div className="st-block__head">
          <Heading text={d.heading} />
          {d.status && <span className="st-hours__status" data-open={open || undefined}><Clock size={15} aria-hidden="true" />{open ? "Abierto ahora" : "Cerrado ahora"}</span>}
        </div>
        <dl className="st-hours__list">
          {d.days.map((day, i) => (
            <div key={i} className="st-hours__row" data-today={i === today || undefined}>
              <dt>{WEEK_DAYS[i]}{i === today && <span className="nx-sr-only"> (hoy)</span>}</dt>
              <dd>{day.closed ? "Cerrado" : day.ranges.map((r) => `${r.open} – ${r.close}`).join(" · ")}</dd>
            </div>
          ))}
        </dl>
        {d.note && <p className="st-block__lead">{d.note}</p>}
      </div>
    </Section>
  );
}

/* ---------- Mapa ---------- */

function MapBlock({ b }: { b: BlockOf<"map"> }) {
  const { store } = useStore();
  const d = b.data;
  const address = d.address ?? store!.pickupAddress ?? store!.address;
  if (!address) return null;
  return (
    <Section block={b}>
      <Heading text={d.heading} />
      <div className="st-map" data-info={d.info || undefined} data-height={d.height}>
        <iframe
          className="st-map__frame"
          title={`Mapa: ${address}`}
          src={mapSrc(address, d.zoom)}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        />
        {d.info && (
          <div className="st-map__info">
            <p className="st-map__address"><MapPin size={18} aria-hidden="true" />{address}</p>
            {store!.phone && <a className="nx-link" href={`tel:${store!.phone}`}>Tel. {store!.phone}</a>}
            <a className="nx-btn nx-btn--primary" href={directionsUrl(address)} target="_blank" rel="noreferrer"><Navigation size={16} aria-hidden="true" />Cómo llegar</a>
          </div>
        )}
      </div>
    </Section>
  );
}

/* ---------- Tarjeta de lealtad ---------- */

const LOYALTY_ICON = { star: Star, heart: Heart, coffee: Coffee, bag: ShoppingBag, gift: Gift, check: Check } as const;

function Loyalty({ b }: { b: BlockOf<"loyalty"> }) {
  const d = b.data;
  const Icon = LOYALTY_ICON[d.icon];
  const filled = Math.min(d.sample, d.stamps);
  return (
    <Section block={b}>
      <div className="st-loyalty">
        <div className="st-loyalty__copy">
          <Heading text={d.heading} />
          {d.text && <p className="st-block__lead">{d.text}</p>}
          {d.button && <Buttons buttons={[d.button]} />}
        </div>
        <div className="st-loyalty__card" role="img" aria-label={`Tarjeta de ${d.stamps} sellos${d.reward ? `: ${d.reward}` : ""}`}>
          <div className="st-loyalty__stamps" style={{ "--n": Math.min(d.stamps, 5) } as CSSProperties}>
            {Array.from({ length: d.stamps }, (_, i) => (
              <span key={i} className="st-loyalty__stamp" data-on={i < filled || undefined} data-last={i === d.stamps - 1 || undefined}>
                {i === d.stamps - 1 ? <Gift size={20} aria-hidden="true" /> : <Icon size={18} aria-hidden="true" />}
              </span>
            ))}
          </div>
          {d.reward && <p className="st-loyalty__reward">{d.reward}</p>}
        </div>
      </div>
    </Section>
  );
}

/* ---------- Embebidos ---------- */

const RATIO: Record<string, string | undefined> = { "16:9": "16 / 9", "4:3": "4 / 3", "1:1": "1 / 1", "9:16": "9 / 16" };

function Embed({ b }: { b: BlockOf<"embed"> }) {
  const d = b.data;
  const info = embedSrc(d.url);
  if (!info) return null;
  const ratio = RATIO[d.ratio];
  return (
    <Section block={b}>
      <Heading text={d.heading} />
      <figure className="st-embed" data-vertical={d.ratio === "9:16" || undefined}>
        <iframe
          className="st-embed__frame"
          src={info.src}
          title={d.heading ?? d.caption ?? info.label}
          loading="lazy"
          sandbox={info.sandbox}
          allow={info.allow}
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          style={ratio ? { aspectRatio: ratio } : { height: d.height }}
        />
        {d.caption && <figcaption>{d.caption}</figcaption>}
      </figure>
    </Section>
  );
}

/* ---------- HTML personalizado: sandboxed iframe, only size messages ---------- */

function CustomHtml({ b }: { b: BlockOf<"html"> }) {
  const { store } = useStore();
  const d = b.data;
  const ref = useRef<HTMLIFrameElement>(null);
  const [size, setSize] = useState<{ height: string; width: string }>({ height: `${d.height}px`, width: "100%" });
  useEffect(() => { setSize((s) => ({ ...s, height: `${d.height}px` })); }, [d.height]);
  const theme = store!.appearance.theme;
  const doc = useMemo(() => {
    const own = blockStyleVars(theme, b.style).vars;
    const base = themeTokens({ ...resolveTheme(theme), scheme: resolveTheme(theme).scheme === "auto" ? "light" : resolveTheme(theme).scheme });
    return frameDocument(d.html, { autoHeight: d.autoHeight, vars: { ...base, ...own } });
  }, [d.html, d.autoHeight, theme, b.style]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const frame = ref.current;
      // Only this frame's own window, and it has no origin of its own (sandbox without allow-same-origin).
      if (!frame || e.source !== frame.contentWindow || e.origin !== "null") return;
      const next = parseFrameSize(e.data);
      if (!next) return;
      setSize((s) => ({ height: next.height ?? s.height, width: next.width ?? s.width }));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <Section block={b}>
      <iframe
        ref={ref}
        className="st-html"
        title={d.title ?? "Contenido personalizado"}
        sandbox={frameSandbox(d)}
        srcDoc={doc}
        referrerPolicy="no-referrer"
        loading="lazy"
        style={{ height: size.height, width: size.width }}
      />
    </Section>
  );
}

/* ---------- Divisor ---------- */

function Divider({ b }: { b: BlockOf<"divider"> }) {
  const d = b.data;
  const t = d.thickness;
  const shape =
    d.kind === "wave" ? <svg viewBox="0 0 120 12" preserveAspectRatio="none" aria-hidden="true"><path d="M0 6 Q15 0 30 6 T60 6 T90 6 T120 6" fill="none" stroke="currentColor" strokeWidth={t} vectorEffect="non-scaling-stroke" /></svg>
    : d.kind === "zigzag" ? <svg viewBox="0 0 120 12" preserveAspectRatio="none" aria-hidden="true"><path d="M0 9 L10 3 L20 9 L30 3 L40 9 L50 3 L60 9 L70 3 L80 9 L90 3 L100 9 L110 3 L120 9" fill="none" stroke="currentColor" strokeWidth={t} vectorEffect="non-scaling-stroke" strokeLinejoin="round" /></svg>
    : null;
  return (
    <Section block={b} as="div">
      <div className="st-divider" role="separator" data-kind={d.kind} data-width={d.width} data-accent={b.style.accent ? "" : undefined} style={{ "--thick": `${t}px` } as CSSProperties}>
        {shape}
      </div>
    </Section>
  );
}
