/**
 * Tienda en línea → Apariencia (Phase 9): theme, announcement bar, banners, ad pixels and custom code,
 * with a live preview built from the same theme tokens the store uses.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, ExternalLink, ImagePlus, Plus, ShoppingBag, Trash2, X } from "lucide-react";
import {
  ANNOUNCEMENT_TONES, CODE_LIMITS, MAX_BANNERS, resolveTheme, THEME_FONT_IDS, THEME_FONTS, THEME_PRESET_IDS, THEME_PRESETS, THEME_RADII, THEME_RADIUS_IDS,
  themeTokens, themeWarnings,
  type AnnouncementTone, type StoreAppearance, type StoreAppearanceSettings, type StoreBanner, type StoreSettings, type StoreTheme, type ThemeFont, type ThemeRadius,
} from "@nexo/shared";
import { Alert, Badge, Button, Card, Checkbox, PageHeader, Segmented, Switch, Tabs, TextAreaField, TextField, useToast } from "@nexo/ui";
import "@nexo/ui/theme-fonts.css";
import { get, post, put } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLoad, useSubmit } from "../lib/hooks";
import { useBusiness } from "../lib/business";

type Tab = "tema" | "avisos" | "banners" | "pixeles" | "codigo";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "tema", label: "Tema" },
  { id: "avisos", label: "Barra de avisos" },
  { id: "banners", label: "Banners" },
  { id: "pixeles", label: "Píxeles" },
  { id: "codigo", label: "Código" },
];

const newId = () => Math.random().toString(36).slice(2, 10);
const today = () => new Date().toLocaleDateString("en-CA");

export function StoreAppearancePage() {
  const { can } = useAuth();
  const { settings: biz } = useBusiness();
  const toast = useToast();
  const writable = can("store:write");
  const load = useLoad(() => Promise.all([get<StoreAppearanceSettings>("/store-settings/appearance"), get<StoreSettings>("/store-settings")]));
  const [form, setForm] = useState<StoreAppearance | null>(null);
  const [tab, setTab] = useState<Tab>("tema");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const saved = useRef<string>("");

  useEffect(() => {
    if (!load.data) return;
    const { theme, announcement, banners, pixels, code } = load.data[0];
    const f = { theme, announcement, banners, pixels, code };
    saved.current = JSON.stringify(f);
    setForm(f);
  }, [load.data]);

  const save = useSubmit(async () => {
    const res = await put<StoreAppearanceSettings>("/store-settings/appearance", form);
    load.setData([res, load.data![1]]);
    toast("Apariencia guardada. La tienda ya la muestra.");
  });
  const dirty = form !== null && JSON.stringify(form) !== saved.current;

  // Leaving with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const on = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", on);
    return () => window.removeEventListener("beforeunload", on);
  }, [dirty]);

  if (load.error) return <Alert tone="danger">{load.error.message}</Alert>;
  if (!form || !load.data) return <div className="nx-page-loading"><span className="nx-spinner" aria-label="Cargando" /></div>;
  const [settings, store] = load.data;
  const f = save.fields;
  const set = <K extends keyof StoreAppearance>(k: K, v: StoreAppearance[K]) => { setForm({ ...form, [k]: v }); save.clearFields(k); };
  const errorsIn = (prefix: string) => Object.keys(f).some((k) => k === prefix || k.startsWith(`${prefix}.`));

  return (
    <>
      <PageHeader
        title="Apariencia de la tienda"
        description="Colores, letras, avisos, banners y herramientas de anuncios de tu tienda en línea."
        actions={
          <>
            <a className="nx-btn nx-btn--ghost" href={store.url} target="_blank" rel="noreferrer"><ExternalLink className="nx-icon" aria-hidden="true" />Ver tienda</a>
            {writable && <Button variant="primary" loading={save.pending} disabled={!dirty} onClick={() => void save.submit()}>{dirty ? "Guardar cambios" : "Guardado"}</Button>}
          </>
        }
      />
      {!store.enabled && <Alert tone="info">Tu tienda aún no está activa. Puedes prepararla aquí y activarla en <Link className="nx-link" to="/tienda">Ajustes de la tienda</Link>.</Alert>}
      {save.message && <Alert tone="danger">{save.message}</Alert>}
      {Object.keys(f).length > 0 && !save.message && <Alert tone="danger">Revisa los campos marcados{TABS.filter((t) => errorsIn(tabKey(t.id))).map((t) => ` · ${t.label}`).join("")}.</Alert>}
      <Tabs label="Secciones de apariencia" tabs={TABS} value={tab} onChange={setTab} />
      <div className="nx-appearance">
        <fieldset className="nx-appearance__editor" disabled={!writable}>
          {tab === "tema" && <ThemeEditor theme={form.theme} onChange={(t) => set("theme", t)} errors={f} />}
          {tab === "avisos" && <AnnouncementEditor value={form.announcement} onChange={(a) => set("announcement", a)} errors={f} />}
          {tab === "banners" && <BannersEditor value={form.banners} onChange={(b) => set("banners", b)} errors={f} />}
          {tab === "pixeles" && <PixelsEditor value={form.pixels} onChange={(p) => set("pixels", p)} errors={f} />}
          {tab === "codigo" && <CodeEditor value={form.code} onChange={(c) => set("code", c)} errors={f} settings={settings} />}
        </fieldset>
        <aside className="nx-appearance__preview" aria-label="Vista previa">
          <div className="nx-row" style={{ justifyContent: "space-between" }}>
            <span className="nx-label">Vista previa</span>
            <Segmented label="Dispositivo" value={device} onChange={setDevice} options={[{ id: "desktop", label: "Computadora" }, { id: "mobile", label: "Celular" }]} />
          </div>
          <StorePreview appearance={form} name={biz?.tradeName ?? storeName(store)} logo={biz?.logoKey ?? null} tagline={store.tagline} device={device} />
          <p className="nx-help" style={{ margin: 0 }}>Aproximada: los productos son de ejemplo. Guarda y abre <em>Ver tienda</em> para verla real.</p>
        </aside>
      </div>
    </>
  );
}

const tabKey = (t: Tab) => ({ tema: "theme", avisos: "announcement", banners: "banners", pixeles: "pixels", codigo: "code" })[t];
const storeName = (s: StoreSettings) => s.slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/* ---------------- Theme ---------------- */

function ThemeEditor({ theme, onChange, errors }: { theme: StoreTheme; onChange: (t: StoreTheme) => void; errors: Record<string, string> }) {
  const r = resolveTheme(theme);
  const warnings = themeWarnings(r);
  const preset = THEME_PRESETS[theme.preset];
  const pick = (id: StoreTheme["preset"]) => onChange({ preset: id, primary: null, background: null, text: null, font: null, radius: null });
  return (
    <div className="nx-stack" style={{ gap: 20 }}>
      <Card title="Estilo" description="Elige un punto de partida. Después puedes cambiar colores, letras y esquinas.">
        <div className="nx-theme-grid" role="radiogroup" aria-label="Estilo de la tienda">
          {THEME_PRESET_IDS.map((id) => {
            const p = THEME_PRESETS[id];
            const t = themeTokens(resolveTheme({ preset: id, primary: null, background: null, text: null, font: null, radius: null }));
            const selected = theme.preset === id;
            return (
              <button key={id} type="button" role="radio" aria-checked={selected} className="nx-theme-card" onClick={() => pick(id)}>
                <span className="nx-theme-card__swatch" style={{ background: p.background, color: p.text, fontFamily: t["--st-heading"], fontWeight: Number(t["--st-heading-weight"]), borderRadius: t["--radius-md"] }}>
                  <span style={{ fontSize: 22, letterSpacing: t["--st-heading-tracking"] }}>Aa</span>
                  <span className="nx-theme-card__dot" style={{ background: p.primary, borderRadius: t["--radius-sm"] }} />
                </span>
                <span className="nx-theme-card__name">{p.label}{selected && <Badge tone="accent">Actual</Badge>}</span>
                <span className="nx-theme-card__desc">{p.description}</span>
              </button>
            );
          })}
        </div>
      </Card>

      <Card title="Colores" description={preset.scheme === "auto" && !r.custom ? "Este estilo cambia a colores oscuros cuando el cliente usa modo oscuro. Si eliges tus colores, la tienda se verá siempre con ellos." : "Se usan en toda la tienda: fondo, textos, botones y avisos."}>
        <div className="nx-grid-3">
          <ColorField label="Principal (botones)" value={theme.primary} fallback={preset.primary} onChange={(v) => onChange({ ...theme, primary: v })} error={errors["theme.primary"]} />
          <ColorField label="Fondo" value={theme.background} fallback={preset.background} onChange={(v) => onChange({ ...theme, background: v })} error={errors["theme.background"]} />
          <ColorField label="Texto" value={theme.text} fallback={preset.text} onChange={(v) => onChange({ ...theme, text: v })} error={errors["theme.text"]} />
        </div>
        {warnings.map((w) => <div key={w} style={{ marginTop: 12 }}><Alert tone="warning">{w}</Alert></div>)}
      </Card>

      <Card title="Letras" description="Los títulos usan la fuente elegida; el texto se mantiene fácil de leer.">
        <div className="nx-font-grid" role="radiogroup" aria-label="Tipografía">
          {THEME_FONT_IDS.map((id) => {
            const font = THEME_FONTS[id];
            const selected = r.font === id;
            return (
              <button key={id} type="button" role="radio" aria-checked={selected} className="nx-font-card" onClick={() => onChange({ ...theme, font: id === preset.font ? null : (id as ThemeFont) })}>
                <span style={{ fontFamily: font.heading, fontWeight: font.weight, letterSpacing: font.tracking, fontSize: 26, lineHeight: 1 }}>Aa</span>
                <span className="nx-font-card__name">{font.label}</span>
                <span className="nx-font-card__hint">{font.hint}</span>
              </button>
            );
          })}
        </div>
      </Card>

      <Card title="Esquinas" description="Botones, fotos y tarjetas.">
        <Segmented
          label="Esquinas"
          value={r.radius}
          onChange={(id) => onChange({ ...theme, radius: id === preset.radius ? null : (id as ThemeRadius) })}
          options={THEME_RADIUS_IDS.map((id) => ({ id, label: THEME_RADII[id].label }))}
        />
      </Card>
    </div>
  );
}

function ColorField({ label, value, fallback, onChange, error }: { label: string; value: string | null; fallback: string; onChange: (v: string | null) => void; error?: string }) {
  const [text, setText] = useState(value ?? fallback);
  useEffect(() => { setText(value ?? fallback); }, [value, fallback]);
  const id = useMemo(() => `c-${newId()}`, []);
  return (
    <div className="nx-field">
      <label className="nx-label" htmlFor={id}>{label}</label>
      <div className="nx-color">
        <input type="color" aria-label={`${label}: elegir`} value={value ?? fallback} onChange={(e) => onChange(e.target.value)} />
        <input
          id={id}
          className="nx-input nx-mono"
          value={text}
          maxLength={7}
          spellCheck={false}
          onChange={(e) => { setText(e.target.value); if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onChange(e.target.value.toLowerCase()); }}
          onBlur={() => setText(value ?? fallback)}
        />
        {value && <button type="button" className="nx-color__reset" aria-label={`${label}: volver al del estilo`} title="Volver al del estilo" onClick={() => onChange(null)}><X className="nx-icon" aria-hidden="true" /></button>}
      </div>
      {error && <span className="nx-help" style={{ color: "var(--danger)" }}>{error}</span>}
    </div>
  );
}

/* ---------------- Announcement ---------------- */

function AnnouncementEditor({ value: a, onChange, errors }: { value: StoreAppearance["announcement"]; onChange: (a: StoreAppearance["announcement"]) => void; errors: Record<string, string> }) {
  const setMsg = (i: number, patch: Partial<{ text: string; link: string | null }>) => onChange({ ...a, messages: a.messages.map((m, k) => (k === i ? { ...m, ...patch } : m)) });
  return (
    <Card title="Barra de avisos" description="Una franja arriba de la tienda: envío gratis, horarios, promociones o avisos importantes.">
      <div className="nx-stack" style={{ gap: 16 }}>
        <Switch label="Mostrar la barra de avisos" checked={a.enabled} onChange={(v) => onChange({ ...a, enabled: v })} />
        {errors["announcement.messages"] && <Alert tone="danger">{errors["announcement.messages"]}</Alert>}
        {a.messages.map((m, i) => (
          <div key={i} className="nx-ann-msg">
            <TextField
              label={a.messages.length > 1 ? `Mensaje ${i + 1}` : "Mensaje"}
              value={m.text}
              maxLength={140}
              placeholder="Envío gratis en compras desde $599"
              onChange={(e) => setMsg(i, { text: e.target.value })}
              error={errors[`announcement.messages.${i}.text`]}
              help={`${m.text.length}/140`}
            />
            <TextField
              label="Enlace"
              optional
              value={m.link ?? ""}
              placeholder="/p/… o ?categoria=… o https://…"
              onChange={(e) => setMsg(i, { link: e.target.value || null })}
              error={errors[`announcement.messages.${i}.link`]}
            />
            {a.messages.length > 1 && <Button variant="ghost" size="sm" aria-label={`Quitar mensaje ${i + 1}`} onClick={() => onChange({ ...a, messages: a.messages.filter((_, k) => k !== i) })}><Trash2 className="nx-icon" aria-hidden="true" /></Button>}
          </div>
        ))}
        {a.messages.length < 3 && <div><Button size="sm" onClick={() => onChange({ ...a, messages: [...a.messages, { text: "", link: null }] })}><Plus className="nx-icon" aria-hidden="true" />Agregar otro mensaje</Button></div>}
        {a.messages.length > 1 && <p className="nx-help" style={{ margin: 0 }}>Con varios mensajes, la barra los va alternando cada 5 segundos.</p>}
        <div className="nx-field">
          <span className="nx-label">Color</span>
          <Segmented label="Color de la barra" value={a.tone} onChange={(t) => onChange({ ...a, tone: t as AnnouncementTone })} options={(Object.keys(ANNOUNCEMENT_TONES) as AnnouncementTone[]).map((id) => ({ id, label: ANNOUNCEMENT_TONES[id] }))} />
        </div>
        <Checkbox label="El cliente puede cerrarla" help="Vuelve a aparecer si cambias el texto." checked={a.dismissible} onChange={(e) => onChange({ ...a, dismissible: e.target.checked })} />
        <DateRange value={a} onChange={(r) => onChange({ ...a, ...r })} error={errors["announcement.endsOn"]} />
      </div>
    </Card>
  );
}

function DateRange({ value, onChange, error }: { value: { startsOn: string | null; endsOn: string | null }; onChange: (r: { startsOn: string | null; endsOn: string | null }) => void; error?: string }) {
  return (
    <div className="nx-grid-2">
      <TextField label="Desde" optional type="date" value={value.startsOn ?? ""} onChange={(e) => onChange({ ...value, startsOn: e.target.value || null })} />
      <TextField label="Hasta" optional type="date" value={value.endsOn ?? ""} min={value.startsOn ?? undefined} onChange={(e) => onChange({ ...value, endsOn: e.target.value || null })} error={error} help={!error ? "Sin fechas se muestra siempre." : undefined} />
    </div>
  );
}

/* ---------------- Banners ---------------- */

async function uploadImage(file: File) {
  const fd = new FormData();
  fd.append("file", file);
  return (await post<{ key: string }>("/uploads", fd)).key;
}

function ImagePick({ label, value, onPick, onClear, hint }: { label: string; value: string | null; onPick: (key: string) => void; onClear?: () => void; hint: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const up = useSubmit(async (file: File) => onPick(await uploadImage(file)));
  return (
    <div className="nx-field">
      <span className="nx-label">{label}</span>
      <div className="nx-row" style={{ gap: 8 }}>
        <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void up.submit(file); e.target.value = ""; }} />
        <Button size="sm" loading={up.pending} onClick={() => ref.current?.click()}><ImagePlus className="nx-icon" aria-hidden="true" />{value ? "Cambiar" : "Subir"}</Button>
        {value && onClear && <Button size="sm" variant="ghost" onClick={onClear}>Quitar</Button>}
      </div>
      <span className="nx-help">{up.fields.file ?? up.message ?? hint}</span>
    </div>
  );
}

function BannersEditor({ value, onChange, errors }: { value: StoreBanner[]; onChange: (b: StoreBanner[]) => void; errors: Record<string, string> }) {
  const ref = useRef<HTMLInputElement>(null);
  const add = useSubmit(async (file: File) => {
    const image = await uploadImage(file);
    onChange([...value, { id: newId(), enabled: true, image, imageMobile: null, heading: null, text: null, cta: null, link: null, textColor: "light", align: "left", startsOn: null, endsOn: null }]);
  });
  const patch = (i: number, p: Partial<StoreBanner>) => onChange(value.map((b, k) => (k === i ? { ...b, ...p } : b)));
  const move = (i: number, d: -1 | 1) => { const next = [...value]; [next[i], next[i + d]] = [next[i + d]!, next[i]!]; onChange(next); };
  const now = today();
  return (
    <div className="nx-stack" style={{ gap: 16 }}>
      <Card
        title="Banners de la portada"
        description="Imágenes grandes arriba del catálogo, que pasan solas cada 6 segundos. Úsalas para temporadas, lanzamientos o promociones."
        actions={value.length < MAX_BANNERS && (
          <>
            <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void add.submit(file); e.target.value = ""; }} />
            <Button size="sm" loading={add.pending} onClick={() => ref.current?.click()}><Plus className="nx-icon" aria-hidden="true" />Agregar banner</Button>
          </>
        )}
      >
        {(add.fields.file || add.message) && <Alert tone="danger">{add.fields.file ?? add.message}</Alert>}
        {value.length === 0 ? (
          <p className="nx-muted" style={{ margin: 0 }}>Aún no hay banners. Medida recomendada: <strong>2100 × 800 px</strong> (horizontal) y, si quieres, otra de <strong>1080 × 1350 px</strong> para celular. JPG, PNG o WebP de hasta 5 MB.</p>
        ) : (
          <p className="nx-help" style={{ margin: 0 }}>Medida recomendada: 2100 × 800 px; para celular, 1080 × 1350 px. Hasta {MAX_BANNERS} banners.</p>
        )}
      </Card>
      {value.map((b, i) => {
        const e = (k: string) => errors[`banners.${i}.${k}`];
        const scheduled = (b.startsOn && b.startsOn > now) || (b.endsOn && b.endsOn < now);
        return (
          <Card
            key={b.id}
            title={`Banner ${i + 1}`}
            actions={
              <div className="nx-row" style={{ gap: 4 }}>
                {!b.enabled ? <Badge>Oculto</Badge> : scheduled ? <Badge tone="warning">Fuera de fechas</Badge> : <Badge tone="success">Visible</Badge>}
                <Button size="sm" variant="ghost" disabled={i === 0} aria-label="Subir" onClick={() => move(i, -1)}><ArrowUp className="nx-icon" aria-hidden="true" /></Button>
                <Button size="sm" variant="ghost" disabled={i === value.length - 1} aria-label="Bajar" onClick={() => move(i, 1)}><ArrowDown className="nx-icon" aria-hidden="true" /></Button>
                <Button size="sm" variant="ghost" aria-label={`Eliminar banner ${i + 1}`} onClick={() => onChange(value.filter((_, k) => k !== i))}><Trash2 className="nx-icon" aria-hidden="true" /></Button>
              </div>
            }
          >
            <div className="nx-banner-edit">
              <div className="nx-banner-edit__media">
                <img src={`/files/${b.image}`} alt="" />
                {b.imageMobile && <img className="nx-banner-edit__mobile" src={`/files/${b.imageMobile}`} alt="" />}
              </div>
              <div className="nx-stack" style={{ gap: 14 }}>
                <Switch label="Mostrar en la tienda" checked={b.enabled} onChange={(v) => patch(i, { enabled: v })} />
                <div className="nx-grid-2">
                  <ImagePick label="Imagen" value={b.image} onPick={(k) => patch(i, { image: k })} hint={e("image") ?? "2100 × 800 px"} />
                  <ImagePick label="Imagen para celular" value={b.imageMobile} onPick={(k) => patch(i, { imageMobile: k })} onClear={() => patch(i, { imageMobile: null })} hint={e("imageMobile") ?? "Opcional · 1080 × 1350 px"} />
                </div>
                <TextField label="Título" optional maxLength={80} value={b.heading ?? ""} onChange={(ev) => patch(i, { heading: ev.target.value || null })} error={e("heading")} placeholder="Nueva colección de otoño" />
                <TextAreaField label="Texto" optional maxLength={160} rows={2} value={b.text ?? ""} onChange={(ev) => patch(i, { text: ev.target.value || null })} error={e("text")} />
                <div className="nx-grid-2">
                  <TextField label="Botón" optional maxLength={30} value={b.cta ?? ""} onChange={(ev) => patch(i, { cta: ev.target.value || null })} error={e("cta")} placeholder="Ver colección" />
                  <TextField label="Enlace" optional value={b.link ?? ""} onChange={(ev) => patch(i, { link: ev.target.value || null })} error={e("link")} placeholder="?categoria=… o /p/…" help={!e("link") ? "Todo el banner lleva ahí." : undefined} />
                </div>
                <div className="nx-grid-2">
                  <div className="nx-field">
                    <span className="nx-label">Color del texto</span>
                    <Segmented label="Color del texto" value={b.textColor} onChange={(v) => patch(i, { textColor: v as StoreBanner["textColor"] })} options={[{ id: "light", label: "Claro" }, { id: "dark", label: "Oscuro" }]} />
                  </div>
                  <div className="nx-field">
                    <span className="nx-label">Alineación</span>
                    <Segmented label="Alineación" value={b.align} onChange={(v) => patch(i, { align: v as StoreBanner["align"] })} options={[{ id: "left", label: "Izquierda" }, { id: "center", label: "Centro" }]} />
                  </div>
                </div>
                <DateRange value={b} onChange={(r) => patch(i, r)} error={e("endsOn")} />
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/* ---------------- Pixels ---------------- */

function PixelsEditor({ value: p, onChange, errors }: { value: StoreAppearance["pixels"]; onChange: (p: StoreAppearance["pixels"]) => void; errors: Record<string, string> }) {
  return (
    <Card title="Píxeles de anuncios" description="Mide tus campañas de Facebook/Instagram, Google y TikTok. Registramos visitas, productos vistos, agregados al carrito, inicio de pago y compras.">
      <div className="nx-stack" style={{ gap: 16 }}>
        <TextField label="Píxel de Meta (Facebook e Instagram)" optional inputMode="numeric" value={p.metaPixelId ?? ""} placeholder="123456789012345" onChange={(e) => onChange({ ...p, metaPixelId: e.target.value.trim() || null })} error={errors["pixels.metaPixelId"]} help="Administrador de eventos → Orígenes de datos → ID del conjunto de datos." />
        <TextField label="Etiqueta de Google" optional value={p.googleTagId ?? ""} placeholder="G-XXXXXXXXXX" onChange={(e) => onChange({ ...p, googleTagId: e.target.value.trim() || null })} error={errors["pixels.googleTagId"]} help="Google Analytics 4 (G-…), Google Ads (AW-…) o Tag Manager (GTM-…)." />
        <TextField label="Píxel de TikTok" optional value={p.tiktokPixelId ?? ""} placeholder="C1A2B3C4D5E6F7G8H9I0" onChange={(e) => onChange({ ...p, tiktokPixelId: e.target.value.trim() || null })} error={errors["pixels.tiktokPixelId"]} help="TikTok Ads Manager → Herramientas → Eventos → ID del píxel." />
        <Alert tone="info" title="Con permiso del cliente">
          Al configurar un píxel, la tienda muestra un aviso de cookies y solo los activa si el cliente acepta. Menciona estas herramientas en tu aviso de privacidad (<Link className="nx-link" to="/tienda">Ajustes de la tienda → Políticas</Link>).
        </Alert>
      </div>
    </Card>
  );
}

/* ---------------- Custom code ---------------- */

function CodeEditor({ value: c, onChange, errors, settings }: { value: StoreAppearance["code"]; onChange: (c: StoreAppearance["code"]) => void; errors: Record<string, string>; settings: StoreAppearanceSettings }) {
  const counter = (v: string, max: number) => `${v.length.toLocaleString("es-MX")} / ${max.toLocaleString("es-MX")}`;
  const htmlLocked = !settings.codeAllowed && !c.headHtml && !c.bodyHtml && !c.js;
  return (
    <div className="nx-stack" style={{ gap: 20 }}>
      <Card title="CSS personalizado" description="Ajusta detalles del diseño. Se aplica en todas las páginas de la tienda, después del tema.">
        <CodeArea label="CSS" value={c.css} max={CODE_LIMITS.css} onChange={(css) => onChange({ ...c, css })} error={errors["code.css"]} counter={counter(c.css, CODE_LIMITS.css)} placeholder={".st-card__name {\n  text-transform: uppercase;\n}"} />
        <p className="nx-help" style={{ margin: "8px 0 0" }}>Las clases de la tienda empiezan con <code>.st-</code> y los colores son variables como <code>--primary</code> o <code>--bg</code>.</p>
      </Card>
      <Card
        title="HTML y JavaScript"
        description="Para widgets de chat, reseñas, verificación de dominio u otras herramientas que te den un código para pegar."
        actions={!settings.codeAllowed ? <Badge tone="accent">Plan Pro</Badge> : settings.domain ? <Badge tone="success">Activo en {settings.domain}</Badge> : <Badge tone="warning">Falta dominio propio</Badge>}
      >
        <div className="nx-stack" style={{ gap: 16 }}>
          {!settings.codeAllowed ? (
            <Alert tone="info">El HTML y JavaScript propios están disponibles desde el plan Pro, con tu tienda en tu dominio. <Link className="nx-link" to="/configuracion?tab=plan">Ver planes</Link></Alert>
          ) : !settings.domain ? (
            <Alert tone="warning">Por seguridad, este código solo se ejecuta cuando la tienda abre en <strong>tu propio dominio</strong> (en el dominio compartido conviven todas las tiendas). Conéctalo en <Link className="nx-link" to="/tienda">Ajustes de la tienda → Dominio propio</Link>.</Alert>
          ) : (
            <Alert tone="info">Se ejecuta en {settings.domain}, en todas las páginas excepto el pago y el seguimiento del pedido (ahí el cliente escribe sus datos).</Alert>
          )}
          {!htmlLocked && <Alert tone="warning" title="Pega solo código de fuentes en las que confíes">Un script puede cambiar tu tienda o leer lo que el cliente hace en ella. Si algo deja de funcionar, borra el código y guarda.</Alert>}
          {!htmlLocked && <>
          <CodeArea label="Antes de </head>" value={c.headHtml} max={CODE_LIMITS.headHtml} disabled={htmlLocked} onChange={(headHtml) => onChange({ ...c, headHtml })} error={errors["code.headHtml"]} counter={counter(c.headHtml, CODE_LIMITS.headHtml)} placeholder={'<meta name="facebook-domain-verification" content="…" />'} />
          <CodeArea label="Antes de </body>" value={c.bodyHtml} max={CODE_LIMITS.bodyHtml} disabled={htmlLocked} onChange={(bodyHtml) => onChange({ ...c, bodyHtml })} error={errors["code.bodyHtml"]} counter={counter(c.bodyHtml, CODE_LIMITS.bodyHtml)} placeholder={'<script src="https://widget.ejemplo.com/chat.js" async></script>'} />
          <CodeArea label="JavaScript" value={c.js} max={CODE_LIMITS.js} disabled={htmlLocked} onChange={(js) => onChange({ ...c, js })} error={errors["code.js"]} counter={counter(c.js, CODE_LIMITS.js)} placeholder={"// Se ejecuta al final de cada página\nconsole.log('Hola');"} help="Sin las etiquetas <script>." />
          </>}
        </div>
      </Card>
    </div>
  );
}

function CodeArea({ label, value, max, onChange, error, counter, placeholder, disabled, help }: { label: string; value: string; max: number; onChange: (v: string) => void; error?: string; counter: string; placeholder?: string; disabled?: boolean; help?: string }) {
  return (
    <TextAreaField
      label={label}
      value={value}
      maxLength={max}
      rows={8}
      spellCheck={false}
      disabled={disabled}
      className="nx-code"
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        // Tab inserts two spaces instead of leaving the field (Esc then Tab still moves focus).
        if (e.key !== "Tab" || e.shiftKey) return;
        const el = e.currentTarget;
        if (el.dataset.escaped === "1") { el.dataset.escaped = ""; return; }
        e.preventDefault();
        const { selectionStart: s, selectionEnd: t } = el;
        onChange(value.slice(0, s) + "  " + value.slice(t));
        requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 2; });
      }}
      onKeyUp={(e) => { if (e.key === "Escape") e.currentTarget.dataset.escaped = "1"; }}
      error={error}
      help={error ? undefined : [help, counter].filter(Boolean).join(" · ")}
    />
  );
}

/* ---------------- Live preview ---------------- */

const SAMPLE = [
  { name: "Playera de algodón", price: "$349.00", hue: 28 },
  { name: "Taza de barro", price: "$189.00", hue: 150 },
  { name: "Bolsa de mano", price: "$520.00", hue: 340 },
  { name: "Vela aromática", price: "$210.00", hue: 210 },
];

function StorePreview({ appearance: a, name, logo, tagline, device }: { appearance: StoreAppearance; name: string; logo: string | null; tagline: string | null; device: "desktop" | "mobile" }) {
  const r = resolveTheme(a.theme);
  const vars = themeTokens(r) as CSSProperties;
  const now = today();
  const banner = a.banners.find((b) => b.enabled && (!b.startsOn || b.startsOn <= now) && (!b.endsOn || b.endsOn >= now)) ?? null;
  const ann = a.announcement.enabled ? a.announcement.messages.find((m) => m.text.trim()) : null;
  const img = banner ? (device === "mobile" && banner.imageMobile ? banner.imageMobile : banner.image) : null;
  return (
    <div className="nx-sp" data-device={device} data-scheme={r.scheme} style={vars}>
      {ann && <div className="nx-sp__ann" data-tone={a.announcement.tone}>{ann.text}</div>}
      <div className="nx-sp__header">
        <span className="nx-sp__brand">{logo && <img src={`/files/${logo}`} alt="" />}{name}</span>
        {device === "desktop" && <span className="nx-sp__search">Buscar productos</span>}
        <span className="nx-sp__cart"><ShoppingBag size={13} aria-hidden="true" />{device === "desktop" && " Carrito"}</span>
      </div>
      <div className="nx-sp__body">
        {banner && img ? (
          <div className="nx-sp__banner" data-text={banner.textColor} data-align={banner.align} data-mobile={banner.imageMobile ? "" : undefined}>
            <img src={`/files/${img}`} alt="" />
            {(banner.heading || banner.text || banner.cta) && (
              <div className="nx-sp__banner-copy">
                {banner.heading && <strong>{banner.heading}</strong>}
                {banner.text && <span>{banner.text}</span>}
                {banner.cta && <em>{banner.cta}</em>}
              </div>
            )}
          </div>
        ) : (
          <div className="nx-sp__hero">
            <strong>{name}</strong>
            {tagline && <span>{tagline}</span>}
          </div>
        )}
        <div className="nx-sp__chips"><span data-on="true">Todo</span><span>Novedades</span><span>Ofertas</span></div>
        <div className="nx-sp__grid">
          {SAMPLE.map((p) => (
            <div key={p.name} className="nx-sp__card">
              <div className="nx-sp__img" style={{ background: `linear-gradient(135deg, hsl(${p.hue} 35% 82%), hsl(${p.hue + 30} 30% 68%))` }} />
              <div className="nx-sp__name">{p.name}</div>
              <div className="nx-sp__price">{p.price}</div>
            </div>
          ))}
        </div>
        <div className="nx-sp__btn">Agregar al carrito</div>
      </div>
    </div>
  );
}
