/**
 * Tienda en línea → Apariencia: the home page sections (block editor), theme, announcement bar, ad pixels
 * and custom CSS, with the real store as a live preview of the unsaved changes.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Plus, Trash2 } from "lucide-react";
import {
  ANNOUNCEMENT_TONES, CODE_LIMITS, resolveTheme, THEME_FONT_IDS, THEME_FONTS, THEME_PRESET_IDS, THEME_PRESETS, THEME_RADII, THEME_RADIUS_IDS,
  themeTokens, themeWarnings,
  type AnnouncementTone, type CategoryItem, type StoreAppearance, type StoreAppearanceSettings, type StoreSettings, type StoreTheme, type ThemeFont, type ThemeRadius,
} from "@nexo/shared";
import { Alert, Badge, Button, Card, Checkbox, PageHeader, Segmented, Switch, Tabs, TextField, useToast } from "@nexo/ui";
import "@nexo/ui/theme-fonts.css";
import { get, put } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLoad, useSubmit } from "../lib/hooks";
import { useBusiness } from "../lib/business";
import { BlocksEditor } from "./appearance/BlocksEditor";
import { CodeArea, ColorField, DateRange } from "./appearance/fields";
import { LivePreview } from "./appearance/LivePreview";

type Tab = "pagina" | "tema" | "avisos" | "pixeles" | "codigo";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "pagina", label: "Página principal" },
  { id: "tema", label: "Tema" },
  { id: "avisos", label: "Barra de avisos" },
  { id: "pixeles", label: "Píxeles" },
  { id: "codigo", label: "CSS" },
];

export function StoreAppearancePage() {
  const { can } = useAuth();
  const { settings: biz } = useBusiness();
  const toast = useToast();
  const writable = can("store:write");
  const load = useLoad(() => Promise.all([get<StoreAppearanceSettings>("/store-settings/appearance"), get<StoreSettings>("/store-settings")]));
  const categories = useLoad(() => (can("catalog:read") ? get<CategoryItem[]>("/categories") : Promise.resolve([] as CategoryItem[])));
  const [form, setForm] = useState<StoreAppearance | null>(null);
  const [tab, setTab] = useState<Tab>("pagina");
  const [selected, setSelected] = useState<string | null>(null);
  const saved = useRef<string>("");

  useEffect(() => {
    if (!load.data) return;
    const { theme, announcement, blocks, pixels, code } = load.data[0];
    const f = { theme, announcement, blocks, pixels, code };
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
  const [, store] = load.data;
  const f = save.fields;
  const set = <K extends keyof StoreAppearance>(k: K, v: StoreAppearance[K]) => { setForm({ ...form, [k]: v }); save.clearFields(k); };
  const errorsIn = (prefix: string) => Object.keys(f).some((k) => k === prefix || k.startsWith(`${prefix}.`));
  const ctx = { theme: form.theme, storeName: biz?.tradeName ?? storeName(store), tagline: store.tagline, address: biz?.address ?? null, categories: categories.data ?? [] };

  return (
    <>
      <PageHeader
        title="Apariencia de la tienda"
        description="Arma tu página principal con secciones y elige colores, letras, avisos y herramientas de anuncios."
        actions={
          <>
            <a className="nx-btn nx-btn--ghost" href={store.url} target="_blank" rel="noreferrer"><ExternalLink className="nx-icon" aria-hidden="true" />Ver tienda</a>
            {writable && dirty && <Button variant="ghost" onClick={() => { setForm(JSON.parse(saved.current) as StoreAppearance); save.clearFields("blocks", "theme", "announcement", "pixels", "code"); }}>Descartar cambios</Button>}
            {writable && <Button variant="primary" loading={save.pending} disabled={!dirty} onClick={() => void save.submit()}>{dirty ? "Guardar cambios" : "Guardado"}</Button>}
          </>
        }
      />
      {!store.enabled && <Alert tone="info">Tu tienda aún no está activa. Puedes prepararla aquí (la vista previa ya funciona) y activarla en <Link className="nx-link" to="/tienda">Ajustes de la tienda</Link>.</Alert>}
      {save.message && <Alert tone="danger">{save.message}</Alert>}
      {Object.keys(f).length > 0 && !save.message && <Alert tone="danger">Revisa los campos marcados{TABS.filter((t) => errorsIn(tabKey(t.id))).map((t) => ` · ${t.label}`).join("")}.</Alert>}
      <Tabs label="Secciones de apariencia" tabs={TABS} value={tab} onChange={setTab} />
      <div className="nx-appearance nx-appearance--live">
        <fieldset className="nx-appearance__editor" disabled={!writable}>
          {tab === "pagina" && <BlocksEditor blocks={form.blocks} onChange={(b) => set("blocks", b)} errors={f} clearErrors={() => save.clearFields("blocks")} ctx={ctx} selected={selected} onSelect={setSelected} />}
          {tab === "tema" && <ThemeEditor theme={form.theme} onChange={(t) => set("theme", t)} errors={f} />}
          {tab === "avisos" && <AnnouncementEditor value={form.announcement} onChange={(a) => set("announcement", a)} errors={f} />}
          {tab === "pixeles" && <PixelsEditor value={form.pixels} onChange={(p) => set("pixels", p)} errors={f} />}
          {tab === "codigo" && <CodeEditor value={form.code} onChange={(c) => set("code", c)} errors={f} />}
        </fieldset>
        <aside className="nx-appearance__preview" aria-label="Vista previa">
          <LivePreview appearance={form} storeUrl={store.url} selected={tab === "pagina" ? selected : null} />
        </aside>
      </div>
    </>
  );
}

const tabKey = (t: Tab) => ({ pagina: "blocks", tema: "theme", avisos: "announcement", pixeles: "pixels", codigo: "code" })[t];
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

/* ---------------- Custom CSS ---------------- */

function CodeEditor({ value: c, onChange, errors }: { value: StoreAppearance["code"]; onChange: (c: StoreAppearance["code"]) => void; errors: Record<string, string> }) {
  return (
    <div className="nx-stack" style={{ gap: 20 }}>
      <Card title="CSS personalizado" description="Ajusta detalles del diseño. Se aplica en todas las páginas de la tienda, después del tema.">
        <CodeArea label="CSS" value={c.css} max={CODE_LIMITS.css} rows={14} onChange={(css) => onChange({ ...c, css })} error={errors["code.css"]} placeholder={".st-card__name {\n  text-transform: uppercase;\n}"} />
        <p className="nx-help" style={{ margin: "8px 0 0" }}>
          Las clases de la tienda empiezan con <code>.st-</code> (cada sección es <code>.st-block</code>, p. ej. <code>.st-block--hero</code>, y con ancla, <code>#tu-ancla</code>) y los colores son variables como <code>--primary</code> o <code>--bg</code>.
        </p>
      </Card>
      <Alert tone="info" title="¿HTML o JavaScript?">
        Ahora van en una sección <strong>HTML personalizado</strong> de la Página principal: corre en un marco aislado, así funciona en cualquier plan y dominio sin poner en riesgo tu tienda ni a tus clientes.
      </Alert>
    </div>
  );
}
