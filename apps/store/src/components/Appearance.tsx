/**
 * Store appearance in the app (Phase 9): theme style sheet, announcement bar, banner carousel and the
 * cookie banner for ad pixels. The server already injects the theme CSS (no flash); the app keeps it in
 * sync when the store data changes and covers local development without the Pages middleware.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { hasPixels, POLICY_INFO, resolveTheme, themeCss, type PublicAppearance } from "@nexo/shared";
import { Button } from "@nexo/ui";
import { imageUrl } from "../lib/api";
import { pixelEvent, readConsent, saveConsent, startPixels, type Consent } from "../lib/pixels";
import { useStore } from "../lib/store";

/** Writes the theme into <style id="nx-theme"> and the color-scheme meta. */
export function useThemeStyle(appearance: PublicAppearance | undefined) {
  useEffect(() => {
    if (!appearance) return;
    const css = themeCss(appearance.theme);
    let el = document.getElementById("nx-theme") as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = "nx-theme";
      document.head.appendChild(el);
    }
    if (el.textContent !== css) el.textContent = css;
    const scheme = resolveTheme(appearance.theme).scheme;
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", scheme === "auto" ? "light dark" : scheme);
  }, [appearance]);
}

/** A link from banners or the announcement: inside the store (router) or out (https). */
export function StoreLinkTo({ href, className, children, label }: { href: string; className?: string; children: ReactNode; label?: string }) {
  const { link } = useStore();
  if (href.startsWith("https://")) return <a className={className} href={href} rel="noopener" aria-label={label}>{children}</a>;
  const home = link();
  const to = href.startsWith("?") ? (home === "/" ? `/${href}` : `${home}${href}`) : link(href);
  return <Link className={className} to={to} aria-label={label}>{children}</Link>;
}

const reduceMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/* ---------- Announcement bar ---------- */

export function AnnouncementBar() {
  const { store, slug } = useStore();
  const a = store?.appearance.announcement ?? null;
  const key = `nx-ann:${slug}`;
  const [closed, setClosed] = useState(() => { try { return localStorage.getItem(key); } catch { return null; } });
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = a?.messages.length ?? 0;
  useEffect(() => {
    if (count < 2 || paused || reduceMotion()) return;
    const id = setInterval(() => setI((x) => (x + 1) % count), 5000);
    return () => clearInterval(id);
  }, [count, paused]);
  if (!a || closed === a.id) return null;
  const m = a.messages[i % count]!;
  return (
    <div className="st-ann" data-tone={a.tone} role="region" aria-label="Avisos de la tienda" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      <div className="st-wrap st-ann__row">
        {count > 1 && <button type="button" className="st-ann__nav" aria-label="Aviso anterior" onClick={() => setI((x) => (x - 1 + count) % count)}><ChevronLeft size={16} aria-hidden="true" /></button>}
        <p className="st-ann__text" aria-live={paused ? "polite" : "off"}>
          {m.link ? <StoreLinkTo href={m.link}>{m.text}</StoreLinkTo> : m.text}
        </p>
        {count > 1 && <button type="button" className="st-ann__nav" aria-label="Siguiente aviso" onClick={() => setI((x) => (x + 1) % count)}><ChevronRight size={16} aria-hidden="true" /></button>}
        {a.dismissible && (
          <button type="button" className="st-ann__close" aria-label="Cerrar aviso" onClick={() => { try { localStorage.setItem(key, a.id); } catch { /* ignore */ } setClosed(a.id); }}>
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------- Banners ---------- */

export function BannerCarousel() {
  const { store } = useStore();
  const banners = store?.appearance.banners ?? [];
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const n = banners.length;
  useEffect(() => {
    if (n < 2 || paused || reduceMotion()) return;
    const id = setInterval(() => setI((x) => (x + 1) % n), 6000);
    return () => clearInterval(id);
  }, [n, paused]);
  if (!n) return null;
  const go = (to: number) => setI(((to % n) + n) % n);
  return (
    <section
      className="st-banners"
      aria-roledescription="carrusel"
      aria-label="Promociones"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onKeyDown={(e) => { if (e.key === "ArrowLeft") go(i - 1); if (e.key === "ArrowRight") go(i + 1); }}
    >
      <div className="st-banners__track" style={{ transform: `translateX(-${i * 100}%)` }}>
        {banners.map((b, k) => {
          const content = (
            <>
              <picture>
                {b.imageMobile && <source media="(max-width: 640px)" srcSet={imageUrl(b.imageMobile)!} />}
                <img src={imageUrl(b.image)!} alt="" loading={k === 0 ? "eager" : "lazy"} fetchPriority={k === 0 ? "high" : "auto"} />
              </picture>
              {(b.heading || b.text || b.cta) && (
                <div className="st-banner__copy">
                  {b.heading && <h2 className="st-banner__heading">{b.heading}</h2>}
                  {b.text && <p className="st-banner__text">{b.text}</p>}
                  {b.cta && <span className="st-banner__cta">{b.cta}</span>}
                </div>
              )}
            </>
          );
          return (
            <div key={b.id} className="st-banner" data-text={b.textColor} data-align={b.align} data-mobile={b.imageMobile ? "" : undefined} role="group" aria-roledescription="diapositiva" aria-label={`${k + 1} de ${n}`} aria-hidden={k !== i} inert={k !== i ? true : undefined}>
              {b.link ? <StoreLinkTo href={b.link} className="st-banner__link" label={b.heading ?? b.cta ?? undefined}>{content}</StoreLinkTo> : content}
            </div>
          );
        })}
      </div>
      {n > 1 && (
        <>
          <button type="button" className="st-banners__arrow" data-dir="prev" aria-label="Anterior" onClick={() => go(i - 1)}><ChevronLeft size={20} aria-hidden="true" /></button>
          <button type="button" className="st-banners__arrow" data-dir="next" aria-label="Siguiente" onClick={() => go(i + 1)}><ChevronRight size={20} aria-hidden="true" /></button>
          <div className="st-banners__dots">
            {banners.map((b, k) => <button key={b.id} type="button" aria-label={`Ir a la promoción ${k + 1}`} aria-current={k === i} onClick={() => go(k)} />)}
          </div>
        </>
      )}
    </section>
  );
}

/* ---------- Cookie consent for ad pixels ---------- */

export function useConsent() {
  const { store, slug } = useStore();
  const pixels = store?.appearance.pixels;
  const [consent, setConsent] = useState<Consent>(() => readConsent(slug));
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (store && pixels && hasPixels(pixels) && consent === "granted") {
      startPixels(pixels, store.currency);
      pixelEvent("page_view");
    }
  }, [store, pixels, consent]);
  const decide = (v: Exclude<Consent, null>) => {
    saveConsent(slug, v);
    // Withdrawing consent after the scripts loaded needs a reload to unload them.
    if (v === "denied" && consent === "granted") { window.location.reload(); return; }
    setConsent(v);
    setOpen(false);
  };
  return { needed: Boolean(pixels && hasPixels(pixels)), consent, show: open || consent === null, reopen: () => setOpen(true), decide };
}

export function ConsentBanner({ c }: { c: ReturnType<typeof useConsent> }) {
  const { store, link } = useStore();
  if (!store || !c.needed || !c.show) return null;
  const p = store.appearance.pixels;
  const who = [p.metaPixelId && "Meta", p.googleTagId && "Google", p.tiktokPixelId && "TikTok"].filter(Boolean).join(", ").replace(/, ([^,]*)$/, " y $1");
  const privacy = store.policies.some((x) => x.kind === "privacy");
  return (
    <div className="st-consent" role="dialog" aria-label="Cookies" aria-live="polite">
      <p>
        Usamos cookies de {who} para medir visitas y mostrarte anuncios relevantes. Sin ellas la tienda funciona igual.
        {privacy && <> <Link to={link(`/${POLICY_INFO.privacy.path}`)}>Aviso de privacidad</Link>.</>}
      </p>
      <div className="st-consent__actions">
        <Button onClick={() => c.decide("denied")}>Rechazar</Button>
        <Button variant="primary" onClick={() => c.decide("granted")}>Aceptar</Button>
      </div>
    </div>
  );
}
