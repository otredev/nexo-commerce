/**
 * Forms of each section type (Contenido), its look (Diseño) and when it shows (Visibilidad).
 * They edit the block in memory; the page saves the whole appearance.
 */
import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import {
  BLOCK_EDGES, BLOCK_FRAMES, BLOCK_LIMITS, BLOCK_WIDTHS, contrast, DIVIDER_KINDS, EMBED_RATIOS, embedSrc, IMAGE_RATIOS, LAYOUT_BLOCKS, LOYALTY_ICONS, PRODUCT_SORTS, resolveTheme, SOCIAL_NETWORKS,
  THEME_FONT_IDS, THEME_FONTS, THEME_RADII, THEME_RADIUS_IDS, WEEK_DAYS,
  type BannerSlide, type BlockData, type BlockOf, type BlockStyle, type BlockType, type CategoryItem, type ProductSort, type SocialNetwork, type StoreBlock, type StoreTheme,
} from "@nexo/shared";
import { Alert, Badge, Button, Checkbox, Segmented, SelectField, Switch, TextAreaField, TextField } from "@nexo/ui";
import { CodeArea, ColorField, DateRange, Group, ImagePick, ItemActions, moveItem, MultiUpload, newId, NumberField, today } from "./fields";

export interface FormContext {
  theme: StoreTheme;
  storeName: string;
  tagline: string | null;
  address: string | null;
  categories: CategoryItem[];
}
type Err = (path: string) => string | undefined;
interface FormProps<T extends BlockType> { block: BlockOf<T>; set: (patch: Partial<BlockData<T>>) => void; err: Err; ctx: FormContext }

const opt = <T extends string>(o: Record<T, string>) => (Object.keys(o) as T[]).map((id) => ({ id, label: o[id] }));
const LINK_HELP = "Una ruta de tu tienda (/p/…, ?categoria=…), una sección (#horarios), https://, tel: o mailto:";
const MD_HELP = "Puedes usar **negritas**, listas con «- » y enlaces [texto](https://…).";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="nx-field"><span className="nx-label">{label}</span>{children}</div>;
}

/* ---------- Content, by type ---------- */

export function ContentForm({ block, set, err, ctx }: { block: StoreBlock; set: (patch: Record<string, unknown>) => void; err: Err; ctx: FormContext }) {
  switch (block.type) {
    case "header": return <HeaderForm block={block} set={set} err={err} ctx={ctx} />;
    case "hero": return <HeroForm block={block} set={set} err={err} ctx={ctx} />;
    case "banners": return <BannersForm block={block} set={set} err={err} ctx={ctx} />;
    case "catalog": return <CatalogForm block={block} set={set} err={err} ctx={ctx} />;
    case "products": return <ProductsForm block={block} set={set} err={err} ctx={ctx} />;
    case "text": return <TextForm block={block} set={set} err={err} ctx={ctx} />;
    case "imageText": return <ImageTextForm block={block} set={set} err={err} ctx={ctx} />;
    case "gallery": return <GalleryForm block={block} set={set} err={err} ctx={ctx} />;
    case "faq": return <FaqForm block={block} set={set} err={err} ctx={ctx} />;
    case "hours": return <HoursForm block={block} set={set} err={err} ctx={ctx} />;
    case "map": return <MapForm block={block} set={set} err={err} ctx={ctx} />;
    case "loyalty": return <LoyaltyForm block={block} set={set} err={err} ctx={ctx} />;
    case "embed": return <EmbedForm block={block} set={set} err={err} ctx={ctx} />;
    case "html": return <HtmlForm block={block} set={set} err={err} ctx={ctx} />;
    case "divider": return <DividerForm block={block} set={set} err={err} ctx={ctx} />;
    case "footer": return <FooterForm block={block} set={set} err={err} ctx={ctx} />;
  }
}

function HeaderForm({ block: { data: d }, set, err }: FormProps<"header">) {
  return (
    <div className="nx-stack" style={{ gap: 16 }}>
      <Alert tone="info">El encabezado aparece arriba de todas las páginas de la tienda. El carrito siempre se muestra.</Alert>
      <div className="nx-grid-2">
        <Field label="Marca"><Segmented label="Marca" value={d.logo} onChange={(v) => set({ logo: v })} options={[{ id: "logo_name", label: "Logo y nombre" }, { id: "logo", label: "Solo logo" }, { id: "name", label: "Solo nombre" }]} /></Field>
        <Field label="Acomodo"><Segmented label="Acomodo" value={d.layout} onChange={(v) => set({ layout: v })} options={[{ id: "inline", label: "A la izquierda" }, { id: "centered", label: "Centrado" }]} /></Field>
      </div>
      <Switch label="Buscador de productos" checked={d.search} onChange={(v) => set({ search: v })} />
      <Switch label="Botón «Entrar / Mi cuenta»" checked={d.account} onChange={(v) => set({ account: v })} />
      <Switch label="Fijo arriba al bajar por la página" checked={d.sticky} onChange={(v) => set({ sticky: v })} />
      <Group
        title={`Menú (${d.links.length}/${BLOCK_LIMITS.links})`}
        actions={d.links.length < BLOCK_LIMITS.links && <Button size="sm" onClick={() => set({ links: [...d.links, { label: "", link: "" }] })}><Plus className="nx-icon" aria-hidden="true" />Agregar enlace</Button>}
      >
        {d.links.length === 0 && <p className="nx-help" style={{ margin: 0 }}>Sin enlaces. Agrega, por ejemplo, «Horarios» → <code>#horarios</code> o «Ofertas» → <code>?palabra=oferta</code>.</p>}
        {d.links.map((l, i) => (
          <div key={i} className="nx-list-item">
            <div className="nx-grid-2" style={{ flex: 1 }}>
              <TextField label="Texto" value={l.label} maxLength={30} onChange={(e) => set({ links: d.links.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) })} error={err(`data.links.${i}.label`)} />
              <TextField label="Enlace" value={l.link} placeholder="#horarios" onChange={(e) => set({ links: d.links.map((x, k) => (k === i ? { ...x, link: e.target.value } : x)) })} error={err(`data.links.${i}.link`)} />
            </div>
            <ItemActions index={i} count={d.links.length} label={`enlace ${i + 1}`} onMove={(a, b) => set({ links: moveItem(d.links, a, b) })} onRemove={() => set({ links: d.links.filter((_, k) => k !== i) })} />
          </div>
        ))}
        {d.links.length > 0 && <p className="nx-help" style={{ margin: 0 }}>{LINK_HELP}.</p>}
      </Group>
    </div>
  );
}

type LinkItem = { label: string; link: string };
function LinksEditor({ value, onChange, err, path }: { value: LinkItem[]; onChange: (v: LinkItem[]) => void; err: Err; path: string }) {
  return (
    <div className="nx-stack" style={{ gap: 8 }}>
      {value.map((l, i) => (
        <div key={i} className="nx-list-item">
          <div className="nx-grid-2" style={{ flex: 1 }}>
            <TextField label="Texto" value={l.label} maxLength={30} onChange={(e) => onChange(value.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))} error={err(`${path}.${i}.label`)} />
            <TextField label="Enlace" value={l.link} placeholder="/envios o https://…" onChange={(e) => onChange(value.map((x, k) => (k === i ? { ...x, link: e.target.value } : x)))} error={err(`${path}.${i}.link`)} />
          </div>
          <ItemActions index={i} count={value.length} label={`enlace ${i + 1}`} onMove={(a, b) => onChange(moveItem(value, a, b))} onRemove={() => onChange(value.filter((_, k) => k !== i))} />
        </div>
      ))}
      {value.length < BLOCK_LIMITS.links && <div><Button size="sm" onClick={() => onChange([...value, { label: "", link: "" }])}><Plus className="nx-icon" aria-hidden="true" />Agregar enlace</Button></div>}
    </div>
  );
}

function FooterForm({ block: { data: d }, set, err, ctx }: FormProps<"footer">) {
  const networks = Object.keys(SOCIAL_NETWORKS) as SocialNetwork[];
  return (
    <div className="nx-stack" style={{ gap: 16 }}>
      <Alert tone="info">El pie aparece abajo de todas las páginas de la tienda. Los datos del negocio salen de Configuración › Negocio (dirección, teléfono, correo) y de Tienda en línea (WhatsApp, entrega, políticas); si un dato está vacío, no se muestra.</Alert>
      <Field label="Marca"><Segmented label="Marca" value={d.logo} onChange={(v) => set({ logo: v })} options={[{ id: "logo_name", label: "Logo y nombre" }, { id: "logo", label: "Solo logo" }, { id: "name", label: "Solo nombre" }, { id: "none", label: "Nada" }]} /></Field>
      <TextAreaField label="Texto" optional rows={2} value={d.text ?? ""} maxLength={300} placeholder={ctx.tagline ?? "Una frase sobre tu negocio"} help="Debajo de la marca. Vacío = sin texto." onChange={(e) => set({ text: e.target.value || null })} error={err("data.text")} />
      <Group title="Datos del negocio">
        <div className="nx-grid-2">
          <Switch label={`Dirección${ctx.address ? "" : " (vacía)"}`} checked={d.address} onChange={(v) => set({ address: v })} />
          <Switch label="Teléfono" checked={d.phone} onChange={(v) => set({ phone: v })} />
          <Switch label="Correo" checked={d.email} onChange={(v) => set({ email: v })} />
          <Switch label="WhatsApp" checked={d.whatsapp} onChange={(v) => set({ whatsapp: v })} />
          <Switch label="Recoge en tienda y envío a domicilio" checked={d.delivery} onChange={(v) => set({ delivery: v })} />
          <Switch label="Políticas (términos, privacidad, devoluciones)" checked={d.policies} onChange={(v) => set({ policies: v })} />
        </div>
      </Group>
      <Group
        title={`Columnas de enlaces (${d.columns.length}/${BLOCK_LIMITS.footerColumns})`}
        actions={d.columns.length < BLOCK_LIMITS.footerColumns && <Button size="sm" onClick={() => set({ columns: [...d.columns, { title: "", links: [] }] })}><Plus className="nx-icon" aria-hidden="true" />Agregar columna</Button>}
      >
        {d.columns.length === 0 && <p className="nx-help" style={{ margin: 0 }}>Sin columnas. Agrega, por ejemplo, «Ayuda» con «Envíos» → <code>#envios</code> y «Contacto» → <code>mailto:hola@tutienda.com</code>.</p>}
        {d.columns.map((c, i) => (
          <div key={i} className="nx-list-item" style={{ alignItems: "flex-start" }}>
            <div className="nx-stack" style={{ gap: 10, flex: 1 }}>
              <TextField label="Título" optional value={c.title ?? ""} maxLength={40} placeholder="Ayuda" onChange={(e) => set({ columns: d.columns.map((x, k) => (k === i ? { ...x, title: e.target.value || null } : x)) })} error={err(`data.columns.${i}.title`)} />
              <LinksEditor value={c.links} onChange={(links) => set({ columns: d.columns.map((x, k) => (k === i ? { ...x, links } : x)) })} err={err} path={`data.columns.${i}.links`} />
            </div>
            <ItemActions index={i} count={d.columns.length} label={`columna ${i + 1}`} onMove={(a, b) => set({ columns: moveItem(d.columns, a, b) })} onRemove={() => set({ columns: d.columns.filter((_, k) => k !== i) })} />
          </div>
        ))}
        {d.columns.length > 0 && <p className="nx-help" style={{ margin: 0 }}>{LINK_HELP}.</p>}
      </Group>
      <Group
        title={`Redes sociales (${d.social.length}/${BLOCK_LIMITS.social})`}
        actions={d.social.length < BLOCK_LIMITS.social && <Button size="sm" onClick={() => set({ social: [...d.social, { network: networks.find((n) => !d.social.some((x) => x.network === n)) ?? "website", url: "" }] })}><Plus className="nx-icon" aria-hidden="true" />Agregar red</Button>}
      >
        {d.social.length === 0 && <p className="nx-help" style={{ margin: 0 }}>Sin redes. Agrega tu Instagram, Facebook, TikTok…</p>}
        {d.social.map((x, i) => (
          <div key={i} className="nx-list-item">
            <div className="nx-grid-2" style={{ flex: 1 }}>
              <SelectField label="Red" value={x.network} onChange={(e) => set({ social: d.social.map((y, k) => (k === i ? { ...y, network: e.target.value as SocialNetwork } : y)) })}>
                {networks.map((n) => <option key={n} value={n}>{SOCIAL_NETWORKS[n]}</option>)}
              </SelectField>
              <TextField label="Dirección" value={x.url} placeholder="https://instagram.com/tutienda" onChange={(e) => set({ social: d.social.map((y, k) => (k === i ? { ...y, url: e.target.value } : y)) })} error={err(`data.social.${i}.url`)} />
            </div>
            <ItemActions index={i} count={d.social.length} label={`red ${i + 1}`} onMove={(a, b) => set({ social: moveItem(d.social, a, b) })} onRemove={() => set({ social: d.social.filter((_, k) => k !== i) })} />
          </div>
        ))}
      </Group>
      <TextField label="Línea final" optional value={d.note ?? ""} maxLength={200} placeholder={`© ${new Date().getFullYear()} ${ctx.storeName}`} help="Por ejemplo, derechos reservados o tu razón social." onChange={(e) => set({ note: e.target.value || null })} error={err("data.note")} />
    </div>
  );
}

type Btn = { label: string; link: string; variant: "primary" | "secondary" };
function ButtonsEditor({ value, max, onChange, err, path }: { value: Btn[]; max: number; onChange: (v: Btn[]) => void; err: Err; path: string }) {
  return (
    <Group title={max === 1 ? "Botón" : `Botones (${value.length}/${max})`} actions={value.length < max && <Button size="sm" onClick={() => onChange([...value, { label: "", link: "", variant: value.length ? "secondary" : "primary" }])}><Plus className="nx-icon" aria-hidden="true" />Agregar botón</Button>}>
      {value.length === 0 && <p className="nx-help" style={{ margin: 0 }}>Sin botón.</p>}
      {value.map((b, i) => (
        <div key={i} className="nx-list-item">
          <div className="nx-stack" style={{ gap: 10, flex: 1 }}>
            <div className="nx-grid-2">
              <TextField label="Texto" value={b.label} maxLength={30} placeholder="Ver productos" onChange={(e) => onChange(value.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))} error={err(`${path}${max === 1 ? "" : `.${i}`}.label`)} />
              <TextField label="Enlace" value={b.link} placeholder="?categoria=… o #catalogo" onChange={(e) => onChange(value.map((x, k) => (k === i ? { ...x, link: e.target.value } : x)))} error={err(`${path}${max === 1 ? "" : `.${i}`}.link`)} help={LINK_HELP} />
            </div>
            <Segmented label="Estilo del botón" value={b.variant} onChange={(v) => onChange(value.map((x, k) => (k === i ? { ...x, variant: v } : x)))} options={[{ id: "primary", label: "Principal" }, { id: "secondary", label: "Secundario" }]} />
          </div>
          <ItemActions index={i} count={value.length} label={`botón ${i + 1}`} onMove={(a, c) => onChange(moveItem(value, a, c))} onRemove={() => onChange(value.filter((_, k) => k !== i))} />
        </div>
      ))}
    </Group>
  );
}

function HeroForm({ block: { data: d }, set, err, ctx }: FormProps<"hero">) {
  return (
    <div className="nx-stack" style={{ gap: 16 }}>
      <TextField label="Título" optional value={d.heading ?? ""} maxLength={120} placeholder={ctx.storeName} help="Vacío = el nombre de tu tienda." onChange={(e) => set({ heading: e.target.value || null })} error={err("data.heading")} />
      <Switch label="Mostrar el título" checked={d.showHeading} onChange={(v) => set({ showHeading: v })} />
      <TextAreaField label="Texto" optional rows={2} value={d.text ?? ""} maxLength={300} placeholder={ctx.tagline ?? "Una frase sobre tu negocio"} help="Vacío = el lema de Ajustes de la tienda." onChange={(e) => set({ text: e.target.value || null })} error={err("data.text")} />
      <Switch label="Mostrar el texto" checked={d.showText} onChange={(v) => set({ showText: v })} />
      <div className="nx-grid-2">
        <ImagePick label="Imagen" value={d.image} onPick={(k) => set({ image: k })} onClear={() => set({ image: null, imageMobile: null })} hint="Opcional · 1600 × 1000 px" error={err("data.image")} />
        {d.image && <ImagePick label="Imagen para celular" value={d.imageMobile} onPick={(k) => set({ imageMobile: k })} onClear={() => set({ imageMobile: null })} hint="Opcional · 1080 × 1350 px" error={err("data.imageMobile")} />}
      </div>
      {d.image && (
        <div className="nx-grid-2">
          <Field label="Imagen"><Segmented label="Acomodo de la imagen" value={d.layout} onChange={(v) => set({ layout: v })} options={[{ id: "background", label: "De fondo" }, { id: "split", label: "Al lado" }]} /></Field>
          {d.layout === "split" && <Field label="Lado"><Segmented label="Lado de la imagen" value={d.imageSide} onChange={(v) => set({ imageSide: v })} options={[{ id: "left", label: "Izquierda" }, { id: "right", label: "Derecha" }]} /></Field>}
        </div>
      )}
      <Field label="Altura"><Segmented label="Altura" value={d.height} onChange={(v) => set({ height: v })} options={[{ id: "auto", label: "Automática" }, { id: "sm", label: "Baja" }, { id: "md", label: "Media" }, { id: "lg", label: "Alta" }, { id: "screen", label: "Pantalla" }]} /></Field>
      <ButtonsEditor value={d.buttons} max={2} onChange={(v) => set({ buttons: v })} err={err} path="data.buttons" />
      <Switch label="Mostrar «Recoge en tienda» y «Envío a domicilio»" checked={d.facts} onChange={(v) => set({ facts: v })} />
    </div>
  );
}

function BannersForm({ block: { data: d }, set, err }: FormProps<"banners">) {
  const patch = (i: number, p: Partial<BannerSlide>) => set({ slides: d.slides.map((s, k) => (k === i ? { ...s, ...p } : s)) });
  const now = today();
  const add = (keys: string[]) => set({ slides: [...d.slides, ...keys.map((image) => ({ id: newId(), enabled: true, image, imageMobile: null, heading: null, text: null, cta: null, link: null, textColor: "light" as const, align: "left" as const, startsOn: null, endsOn: null }))].slice(0, BLOCK_LIMITS.slides) });
  return (
    <div className="nx-stack" style={{ gap: 16 }}>
      <div className="nx-grid-2">
        <NumberField label="Cambiar cada" suffix="segundos" min={0} max={20} value={d.interval} onChange={(v) => set({ interval: v })} help="0 = no pasan solas." />
        <Field label="Altura"><Segmented label="Altura" value={d.height} onChange={(v) => set({ height: v })} options={[{ id: "sm", label: "Baja" }, { id: "auto", label: "Normal" }, { id: "lg", label: "Alta" }]} /></Field>
      </div>
      <div className="nx-row" style={{ gap: 24, flexWrap: "wrap" }}>
        <Switch label="Flechas" checked={d.arrows} onChange={(v) => set({ arrows: v })} />
        <Switch label="Puntos" checked={d.dots} onChange={(v) => set({ dots: v })} />
      </div>
      <MultiUpload label={d.slides.length ? "Agregar imágenes" : "Subir imágenes"} max={BLOCK_LIMITS.slides - d.slides.length} onAdd={add} />
      <p className="nx-help" style={{ margin: 0 }}>Medida recomendada: 2100 × 800 px; para celular, 1080 × 1350 px. JPG, PNG o WebP de hasta 5 MB. Hasta {BLOCK_LIMITS.slides} imágenes.</p>
      {d.slides.map((s, i) => {
        const e = (k: string) => err(`data.slides.${i}.${k}`);
        const off = (s.startsOn && s.startsOn > now) || (s.endsOn && s.endsOn < now);
        return (
          <Group key={s.id} title={`Imagen ${i + 1}`} actions={<div className="nx-row" style={{ gap: 4 }}>{!s.enabled ? <Badge>Oculta</Badge> : off ? <Badge tone="warning">Fuera de fechas</Badge> : null}<ItemActions index={i} count={d.slides.length} label={`imagen ${i + 1}`} onMove={(a, b) => set({ slides: moveItem(d.slides, a, b) })} onRemove={() => set({ slides: d.slides.filter((_, k) => k !== i) })} /></div>}>
            <Switch label="Mostrar" checked={s.enabled} onChange={(v) => patch(i, { enabled: v })} />
            <div className="nx-grid-2">
              <ImagePick label="Imagen" value={s.image} onPick={(k) => patch(i, { image: k })} hint="2100 × 800 px" error={e("image")} />
              <ImagePick label="Imagen para celular" value={s.imageMobile} onPick={(k) => patch(i, { imageMobile: k })} onClear={() => patch(i, { imageMobile: null })} hint="Opcional · 1080 × 1350 px" error={e("imageMobile")} />
            </div>
            <TextField label="Título" optional maxLength={80} value={s.heading ?? ""} onChange={(ev) => patch(i, { heading: ev.target.value || null })} error={e("heading")} placeholder="Nueva colección" />
            <TextAreaField label="Texto" optional maxLength={160} rows={2} value={s.text ?? ""} onChange={(ev) => patch(i, { text: ev.target.value || null })} error={e("text")} />
            <div className="nx-grid-2">
              <TextField label="Botón" optional maxLength={30} value={s.cta ?? ""} onChange={(ev) => patch(i, { cta: ev.target.value || null })} error={e("cta")} placeholder="Ver colección" />
              <TextField label="Enlace" optional value={s.link ?? ""} onChange={(ev) => patch(i, { link: ev.target.value || null })} error={e("link")} placeholder="?categoria=… o /p/…" help={!e("link") ? "Toda la imagen lleva ahí." : undefined} />
            </div>
            <div className="nx-grid-2">
              <Field label="Color del texto"><Segmented label="Color del texto" value={s.textColor} onChange={(v) => patch(i, { textColor: v })} options={[{ id: "light", label: "Claro" }, { id: "dark", label: "Oscuro" }]} /></Field>
              <Field label="Alineación"><Segmented label="Alineación" value={s.align} onChange={(v) => patch(i, { align: v })} options={[{ id: "left", label: "Izquierda" }, { id: "center", label: "Centro" }, { id: "right", label: "Derecha" }]} /></Field>
            </div>
            <DateRange value={s} onChange={(r) => patch(i, r)} error={e("endsOn")} />
          </Group>
        );
      })}
      {err("data.slides") && <Alert tone="danger">{err("data.slides")}</Alert>}
    </div>
  );
}

const sortOptions = (Object.keys(PRODUCT_SORTS) as ProductSort[]).map((k) => <option key={k} value={k}>{PRODUCT_SORTS[k]}</option>);
const cols = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => ({ id: String(from + i), label: String(from + i) }));

function CatalogForm({ block: { data: d }, set, err }: FormProps<"catalog">) {
  return (
    <div className="nx-stack" style={{ gap: 16 }}>
      <TextField label="Título" optional value={d.heading ?? ""} maxLength={80} placeholder="Nuestros productos" onChange={(e) => set({ heading: e.target.value || null })} error={err("data.heading")} />
      <Switch label="Botones de categorías" checked={d.categories} onChange={(v) => set({ categories: v })} />
      <Switch label="Palabras clave (#etiquetas)" checked={d.keywords} onChange={(v) => set({ keywords: v })} />
      <Switch label="Selector de orden" checked={d.sort} onChange={(v) => set({ sort: v })} />
      <div className="nx-grid-2">
        <SelectField label="Orden inicial" value={d.defaultSort} onChange={(e) => set({ defaultSort: e.target.value as ProductSort })}>{sortOptions}</SelectField>
        <SelectField label="Productos por página" value={String(d.pageSize)} onChange={(e) => set({ pageSize: Number(e.target.value) })}>{[12, 16, 24, 36, 48, 60].map((n) => <option key={n} value={n}>{n}</option>)}</SelectField>
      </div>
      <Field label="Columnas en computadora"><Segmented label="Columnas" value={String(d.columns)} onChange={(v) => set({ columns: Number(v) })} options={cols(2, 5)} /></Field>
      <p className="nx-help" style={{ margin: 0 }}>Al buscar o filtrar, la tienda muestra solo el catálogo. En celular siempre van 2 columnas.</p>
    </div>
  );
}

function ProductsForm({ block: { data: d }, set, err, ctx }: FormProps<"products">) {
  return (
    <div className="nx-stack" style={{ gap: 16 }}>
      <TextField label="Título" optional value={d.heading ?? ""} maxLength={80} onChange={(e) => set({ heading: e.target.value || null })} error={err("data.heading")} />
      <TextField label="Texto" optional value={d.text ?? ""} maxLength={200} onChange={(e) => set({ text: e.target.value || null })} error={err("data.text")} />
      <div className="nx-grid-2">
        <SelectField label="Categoría" value={d.categoryId ?? ""} onChange={(e) => set({ categoryId: e.target.value || null })}>
          <option value="">Todas</option>
          {ctx.categories.filter((c) => !c.parentId).map((c) => (
            [<option key={c.id} value={c.id}>{c.name}</option>, ...ctx.categories.filter((s) => s.parentId === c.id).map((s) => <option key={s.id} value={s.id}>{`— ${s.name}`}</option>)]
          ))}
        </SelectField>
        <TextField label="Palabra clave" optional value={d.keyword ?? ""} maxLength={40} placeholder="oferta" onChange={(e) => set({ keyword: e.target.value || null })} error={err("data.keyword")} />
      </div>
      <div className="nx-grid-2">
        <SelectField label="Orden" value={d.sort} onChange={(e) => set({ sort: e.target.value as ProductSort })}>{sortOptions}</SelectField>
        <NumberField label="Cuántos productos" min={2} max={24} value={d.limit} onChange={(v) => set({ limit: v })} />
      </div>
      <div className="nx-grid-2">
        <Field label="Acomodo"><Segmented label="Acomodo" value={d.layout} onChange={(v) => set({ layout: v })} options={[{ id: "grid", label: "Cuadrícula" }, { id: "row", label: "Fila deslizable" }]} /></Field>
        <Field label="Columnas"><Segmented label="Columnas" value={String(d.columns)} onChange={(v) => set({ columns: Number(v) })} options={cols(2, 6)} /></Field>
      </div>
      <Switch label="Enlace «Ver todo»" checked={d.moreLink} onChange={(v) => set({ moreLink: v })} />
    </div>
  );
}

function TextForm({ block: { data: d }, set, err }: FormProps<"text">) {
  return (
    <div className="nx-stack" style={{ gap: 16 }}>
      <TextField label="Título" optional value={d.heading ?? ""} maxLength={120} onChange={(e) => set({ heading: e.target.value || null })} error={err("data.heading")} />
      <TextAreaField label="Texto" rows={7} value={d.body} maxLength={BLOCK_LIMITS.markdown} onChange={(e) => set({ body: e.target.value })} error={err("data.body")} help={`${MD_HELP} ${d.body.length}/${BLOCK_LIMITS.markdown}`} />
      <Field label="Tamaño de letra"><Segmented label="Tamaño de letra" value={d.size} onChange={(v) => set({ size: v })} options={[{ id: "sm", label: "Chica" }, { id: "md", label: "Normal" }, { id: "lg", label: "Grande" }]} /></Field>
    </div>
  );
}

function ImageTextForm({ block: { data: d }, set, err }: FormProps<"imageText">) {
  return (
    <div className="nx-stack" style={{ gap: 16 }}>
      <ImagePick label="Imagen" value={d.image} onPick={(k) => set({ image: k })} onClear={() => set({ image: null })} hint="1200 × 900 px" error={err("data.image")} />
      <div className="nx-grid-2">
        <Field label="Lado de la imagen"><Segmented label="Lado de la imagen" value={d.imageSide} onChange={(v) => set({ imageSide: v })} options={[{ id: "left", label: "Izquierda" }, { id: "right", label: "Derecha" }]} /></Field>
        <Field label="Recorte"><Segmented label="Recorte" value={d.fit} onChange={(v) => set({ fit: v })} options={[{ id: "cover", label: "Llenar" }, { id: "contain", label: "Completa" }]} /></Field>
      </div>
      <Field label="Forma de la imagen"><Segmented label="Forma de la imagen" value={d.ratio} onChange={(v) => set({ ratio: v })} options={opt(IMAGE_RATIOS)} /></Field>
      <TextField label="Título" optional value={d.heading ?? ""} maxLength={120} onChange={(e) => set({ heading: e.target.value || null })} error={err("data.heading")} />
      <TextAreaField label="Texto" rows={5} value={d.body} maxLength={BLOCK_LIMITS.markdown} onChange={(e) => set({ body: e.target.value })} error={err("data.body")} help={MD_HELP} />
      <ButtonsEditor value={d.button ? [d.button] : []} max={1} onChange={(v) => set({ button: v[0] ?? null })} err={err} path="data.button" />
    </div>
  );
}

function GalleryForm({ block: { data: d }, set, err }: FormProps<"gallery">) {
  const patch = (i: number, p: Partial<BlockData<"gallery">["images"][number]>) => set({ images: d.images.map((g, k) => (k === i ? { ...g, ...p } : g)) });
  return (
    <div className="nx-stack" style={{ gap: 16 }}>
      <TextField label="Título" optional value={d.heading ?? ""} maxLength={80} onChange={(e) => set({ heading: e.target.value || null })} error={err("data.heading")} />
      <div className="nx-grid-2">
        <Field label="Acomodo"><Segmented label="Acomodo" value={d.layout} onChange={(v) => set({ layout: v })} options={[{ id: "grid", label: "Cuadrícula" }, { id: "masonry", label: "Mosaico" }, { id: "carousel", label: "Carrusel" }]} /></Field>
        <Field label="Columnas"><Segmented label="Columnas" value={String(d.columns)} onChange={(v) => set({ columns: Number(v) })} options={cols(2, 6)} /></Field>
      </div>
      <div className="nx-grid-2">
        {d.layout !== "masonry" && <Field label="Forma de las fotos"><Segmented label="Forma de las fotos" value={d.ratio} onChange={(v) => set({ ratio: v })} options={opt(IMAGE_RATIOS)} /></Field>}
        <Field label="Separación"><Segmented label="Separación" value={d.gap} onChange={(v) => set({ gap: v })} options={[{ id: "none", label: "Nada" }, { id: "sm", label: "Poca" }, { id: "md", label: "Normal" }]} /></Field>
      </div>
      <MultiUpload label={d.images.length ? "Agregar fotos" : "Subir fotos"} max={BLOCK_LIMITS.images - d.images.length} onAdd={(keys) => set({ images: [...d.images, ...keys.map((image) => ({ image, caption: null, link: null }))].slice(0, BLOCK_LIMITS.images) })} />
      <p className="nx-help" style={{ margin: 0 }}>Hasta {BLOCK_LIMITS.images} fotos. Puedes elegir varias a la vez.</p>
      <div className="nx-gallery-edit">
        {d.images.map((g, i) => (
          <div key={`${g.image}-${i}`} className="nx-gallery-edit__item">
            <img src={`/files/${g.image}`} alt="" />
            <div className="nx-stack" style={{ gap: 8, flex: 1, minWidth: 0 }}>
              <TextField label="Pie de foto" optional value={g.caption ?? ""} maxLength={120} onChange={(e) => patch(i, { caption: e.target.value || null })} error={err(`data.images.${i}.caption`)} />
              <TextField label="Enlace" optional value={g.link ?? ""} placeholder="/p/…" onChange={(e) => patch(i, { link: e.target.value || null })} error={err(`data.images.${i}.link`) ?? err(`data.images.${i}.image`)} />
            </div>
            <ItemActions index={i} count={d.images.length} label={`foto ${i + 1}`} onMove={(a, b) => set({ images: moveItem(d.images, a, b) })} onRemove={() => set({ images: d.images.filter((_, k) => k !== i) })} />
          </div>
        ))}
      </div>
    </div>
  );
}

function FaqForm({ block: { data: d }, set, err }: FormProps<"faq">) {
  return (
    <div className="nx-stack" style={{ gap: 16 }}>
      <TextField label="Título" optional value={d.heading ?? ""} maxLength={80} onChange={(e) => set({ heading: e.target.value || null })} error={err("data.heading")} />
      <Field label="Preguntas"><Segmented label="Origen de las preguntas" value={d.source} onChange={(v) => set({ source: v })} options={[{ id: "store", label: "Las de Ajustes de la tienda" }, { id: "own", label: "Propias de esta sección" }]} /></Field>
      {d.source === "store" ? (
        <p className="nx-help" style={{ margin: 0 }}>Se editan en Ajustes de la tienda; también las leen los buscadores.</p>
      ) : (
        <Group title={`Preguntas (${d.items.length}/${BLOCK_LIMITS.faq})`} actions={d.items.length < BLOCK_LIMITS.faq && <Button size="sm" onClick={() => set({ items: [...d.items, { q: "", a: "" }] })}><Plus className="nx-icon" aria-hidden="true" />Agregar pregunta</Button>}>
          {d.items.map((f, i) => (
            <div key={i} className="nx-list-item">
              <div className="nx-stack" style={{ gap: 8, flex: 1 }}>
                <TextField label="Pregunta" value={f.q} maxLength={200} onChange={(e) => set({ items: d.items.map((x, k) => (k === i ? { ...x, q: e.target.value } : x)) })} error={err(`data.items.${i}.q`)} />
                <TextAreaField label="Respuesta" rows={2} value={f.a} maxLength={2000} onChange={(e) => set({ items: d.items.map((x, k) => (k === i ? { ...x, a: e.target.value } : x)) })} error={err(`data.items.${i}.a`)} />
              </div>
              <ItemActions index={i} count={d.items.length} label={`pregunta ${i + 1}`} onMove={(a, b) => set({ items: moveItem(d.items, a, b) })} onRemove={() => set({ items: d.items.filter((_, k) => k !== i) })} />
            </div>
          ))}
        </Group>
      )}
      <Checkbox label="La primera pregunta aparece abierta" checked={d.openFirst} onChange={(e) => set({ openFirst: e.target.checked })} />
    </div>
  );
}

function HoursForm({ block: { data: d }, set, err }: FormProps<"hours">) {
  type Day = BlockData<"hours">["days"][number];
  const patch = (i: number, p: Partial<Day>) => set({ days: d.days.map((x, k) => (k === i ? { ...x, ...p } : x)) });
  const range = (i: number, r: number, p: Partial<Day["ranges"][number]>) => patch(i, { ranges: d.days[i]!.ranges.map((x, k) => (k === r ? { ...x, ...p } : x)) });
  return (
    <div className="nx-stack" style={{ gap: 16 }}>
      <TextField label="Título" optional value={d.heading ?? ""} maxLength={80} onChange={(e) => set({ heading: e.target.value || null })} error={err("data.heading")} />
      <div className="nx-hours-edit">
        {d.days.map((day, i) => (
          <div key={i} className="nx-hours-edit__row">
            <span className="nx-hours-edit__day">{WEEK_DAYS[i]}</span>
            <Checkbox label="Cerrado" checked={day.closed} onChange={(e) => patch(i, { closed: e.target.checked })} />
            {!day.closed && (
              <div className="nx-hours-edit__ranges">
                {day.ranges.map((r, k) => (
                  <span key={k} className="nx-row" style={{ gap: 4 }}>
                    <input className="nx-input" type="time" aria-label={`${WEEK_DAYS[i]}: abre`} value={r.open} onChange={(e) => range(i, k, { open: e.target.value })} />
                    <span aria-hidden="true">–</span>
                    <input className="nx-input" type="time" aria-label={`${WEEK_DAYS[i]}: cierra`} value={r.close} onChange={(e) => range(i, k, { close: e.target.value })} />
                    {k === 1 && <Button size="sm" variant="ghost" onClick={() => patch(i, { ranges: day.ranges.slice(0, 1) })}>Quitar</Button>}
                  </span>
                ))}
                {day.ranges.length === 1 && <Button size="sm" variant="ghost" onClick={() => patch(i, { ranges: [...day.ranges, { open: "16:00", close: "20:00" }] })}>+ Otro horario</Button>}
              </div>
            )}
            {(err(`data.days.${i}.ranges.0.close`) || err(`data.days.${i}.ranges.1.open`) || err(`data.days.${i}.ranges.1.close`)) && (
              <span className="nx-help" style={{ color: "var(--danger)", gridColumn: "1 / -1" }}>{err(`data.days.${i}.ranges.0.close`) ?? err(`data.days.${i}.ranges.1.open`) ?? err(`data.days.${i}.ranges.1.close`)}</span>
            )}
          </div>
        ))}
      </div>
      <div><Button size="sm" onClick={() => set({ days: d.days.map((x, k) => (k > 0 && k < 5 ? structuredClone(d.days[0]!) : x)) })}>Copiar el lunes de martes a viernes</Button></div>
      <p className="nx-help" style={{ margin: 0 }}>Si cierras después de medianoche, pon la hora de cierre del día siguiente (p. ej. 20:00 – 02:00).</p>
      <TextField label="Nota" optional value={d.note ?? ""} maxLength={200} placeholder="Días festivos: 10:00 a 14:00" onChange={(e) => set({ note: e.target.value || null })} error={err("data.note")} />
      <Switch label="Mostrar «Abierto ahora / Cerrado ahora»" checked={d.status} onChange={(v) => set({ status: v })} />
    </div>
  );
}

function MapForm({ block: { data: d }, set, err, ctx }: FormProps<"map">) {
  return (
    <div className="nx-stack" style={{ gap: 16 }}>
      <TextField label="Título" optional value={d.heading ?? ""} maxLength={80} onChange={(e) => set({ heading: e.target.value || null })} error={err("data.heading")} />
      <TextAreaField label="Dirección" optional rows={2} value={d.address ?? ""} maxLength={300} placeholder={ctx.address ?? "Calle, número, colonia, ciudad"} help="Vacío = la dirección de tu negocio." onChange={(e) => set({ address: e.target.value || null })} error={err("data.address")} />
      {!d.address && !ctx.address && <Alert tone="warning">Tu negocio no tiene dirección: escribe una para que el mapa aparezca.</Alert>}
      <div className="nx-grid-2">
        <NumberField label="Acercamiento" min={3} max={20} value={d.zoom} onChange={(v) => set({ zoom: v })} help="15 = calles; 11 = ciudad." />
        <Field label="Altura"><Segmented label="Altura del mapa" value={d.height} onChange={(v) => set({ height: v })} options={[{ id: "sm", label: "Baja" }, { id: "md", label: "Media" }, { id: "lg", label: "Alta" }]} /></Field>
      </div>
      <Switch label="Tarjeta con dirección, teléfono y «Cómo llegar»" checked={d.info} onChange={(v) => set({ info: v })} />
    </div>
  );
}

function LoyaltyForm({ block: { data: d }, set, err }: FormProps<"loyalty">) {
  return (
    <div className="nx-stack" style={{ gap: 16 }}>
      <Alert tone="info">Es una tarjeta informativa para invitar a tus clientes; los sellos se llevan en tu tienda.</Alert>
      <TextField label="Título" optional value={d.heading ?? ""} maxLength={80} onChange={(e) => set({ heading: e.target.value || null })} error={err("data.heading")} />
      <TextAreaField label="Texto" optional rows={2} value={d.text ?? ""} maxLength={300} onChange={(e) => set({ text: e.target.value || null })} error={err("data.text")} />
      <TextField label="Premio" optional value={d.reward ?? ""} maxLength={80} onChange={(e) => set({ reward: e.target.value || null })} error={err("data.reward")} />
      <div className="nx-grid-2">
        <NumberField label="Sellos" min={4} max={20} value={d.stamps} onChange={(v) => set({ stamps: v, sample: Math.min(d.sample, v) })} />
        <NumberField label="Sellos marcados de ejemplo" min={0} max={d.stamps} value={d.sample} onChange={(v) => set({ sample: v })} />
      </div>
      <Field label="Ícono"><Segmented label="Ícono de los sellos" value={d.icon} onChange={(v) => set({ icon: v })} options={opt(LOYALTY_ICONS)} /></Field>
      <ButtonsEditor value={d.button ? [d.button] : []} max={1} onChange={(v) => set({ button: v[0] ?? null })} err={err} path="data.button" />
    </div>
  );
}

function EmbedForm({ block: { data: d }, set, err }: FormProps<"embed">) {
  const info = embedSrc(d.url);
  return (
    <div className="nx-stack" style={{ gap: 16 }}>
      <TextField label="Título" optional value={d.heading ?? ""} maxLength={80} onChange={(e) => set({ heading: e.target.value || null })} error={err("data.heading")} />
      <TextField
        label="Enlace"
        value={d.url ?? ""}
        placeholder="https://www.youtube.com/watch?v=…"
        onChange={(e) => set({ url: e.target.value.trim() || null })}
        error={err("data.url") ?? (d.url && !info ? "No se puede insertar este enlace. Usa https:// (YouTube, Vimeo, Spotify, TikTok, Instagram, Google Maps…)" : undefined)}
        help={info ? (info.provider === "other" ? `Página externa (${info.label}): se muestra en un marco aislado; algunas páginas no permiten insertarse.` : `${info.label} ✓`) : "Pega el enlace para compartir de YouTube, Vimeo, Spotify, TikTok, Instagram, Google Maps (Compartir › Insertar mapa), Calendly o Formularios de Google."}
      />
      <Field label="Forma"><Segmented label="Forma" value={d.ratio} onChange={(v) => set({ ratio: v })} options={opt(EMBED_RATIOS)} /></Field>
      {d.ratio === "auto" && <NumberField label="Altura" suffix="px" min={120} max={2000} value={d.height} onChange={(v) => set({ height: v })} />}
      <TextField label="Pie" optional value={d.caption ?? ""} maxLength={200} onChange={(e) => set({ caption: e.target.value || null })} error={err("data.caption")} />
    </div>
  );
}

function HtmlForm({ block: { data: d }, set, err }: FormProps<"html">) {
  return (
    <div className="nx-stack" style={{ gap: 16 }}>
      <Alert tone="info" title="Aislado y seguro">
        Tu HTML y JavaScript corren dentro de un marco aislado (<code>sandbox</code> sin acceso a la tienda): no pueden leer datos del cliente, ni cambiar la página, ni navegarla.
        Para cambiar el tamaño del marco, envía solo un número (px) o un porcentaje: <code>{'parent.postMessage({ height: 480 }, "*")'}</code> o <code>{'{ width: "50%" }'}</code>. Cualquier otro mensaje se ignora.
      </Alert>
      <TextField label="Descripción" optional value={d.title ?? ""} maxLength={80} help="La leen los lectores de pantalla." onChange={(e) => set({ title: e.target.value || null })} error={err("data.title")} />
      <CodeArea label="HTML" value={d.html} max={BLOCK_LIMITS.html} rows={14} onChange={(v) => set({ html: v })} error={err("data.html")} placeholder={'<div class="promo">\n  <h2>¡Hola!</h2>\n  <p style="color: var(--primary)">Usa los colores de tu tienda con var(--primary), var(--ink)…</p>\n</div>\n<script>\n  // Tu JavaScript\n</script>'} help="Puedes incluir <style> y <script>. Las variables --primary, --bg, --ink y --font-sans traen los colores y la letra de la sección." />
      <Switch label="Altura automática (sigue al contenido)" checked={d.autoHeight} onChange={(v) => set({ autoHeight: v })} />
      <NumberField label={d.autoHeight ? "Altura inicial" : "Altura"} suffix="px" min={0} max={5000} value={d.height} onChange={(v) => set({ height: v })} />
      <Checkbox label="Permitir formularios" help="Para formularios que se envían a otro sitio." checked={d.forms} onChange={(e) => set({ forms: e.target.checked })} />
      <Checkbox label="Permitir abrir ventanas nuevas" help="Para enlaces con target=&quot;_blank&quot;." checked={d.popups} onChange={(e) => set({ popups: e.target.checked })} />
    </div>
  );
}

function DividerForm({ block: { data: d }, set }: FormProps<"divider">) {
  return (
    <div className="nx-stack" style={{ gap: 16 }}>
      <Field label="Tipo"><Segmented label="Tipo de divisor" value={d.kind} onChange={(v) => set({ kind: v })} options={opt(DIVIDER_KINDS)} /></Field>
      {d.kind !== "space" && (
        <div className="nx-grid-2">
          <NumberField label="Grosor" suffix="px" min={1} max={8} value={d.thickness} onChange={(v) => set({ thickness: v })} />
          <Field label="Largo"><Segmented label="Largo" value={d.width} onChange={(v) => set({ width: v })} options={[{ id: "short", label: "Corto" }, { id: "medium", label: "Medio" }, { id: "full", label: "Completo" }]} /></Field>
        </div>
      )}
      <p className="nx-help" style={{ margin: 0 }}>El espacio arriba y abajo se ajusta en Diseño; el color de la línea es el «Color de acento» de Diseño.</p>
    </div>
  );
}

/* ---------- Design: colors and shapes ---------- */

const SPACING_OPTS = [{ id: "none", label: "Nada" }, { id: "sm", label: "Poco" }, { id: "md", label: "Normal" }, { id: "lg", label: "Mucho" }, { id: "xl", label: "Máximo" }] as const;

export function StyleForm({ block, theme, set, err }: { block: StoreBlock; theme: StoreTheme; set: (patch: Partial<BlockStyle>) => void; err: Err }) {
  const s = block.style;
  const r = resolveTheme(theme);
  const bg = s.background ?? r.background;
  const lowContrast = s.text && contrast(s.text, bg) < 4.5;
  const isHeader = LAYOUT_BLOCKS.has(block.type);
  return (
    <div className="nx-stack" style={{ gap: 18 }}>
      <Group title="Colores">
        <div className="nx-grid-3">
          <ColorField label="Fondo" value={s.background} fallback={r.background} onChange={(v) => set({ background: v })} resetLabel="Volver al del tema" error={err("style.background")} />
          <ColorField label="Texto" value={s.text} fallback={r.text} onChange={(v) => set({ text: v })} resetLabel="Automático" error={err("style.text")} />
          <ColorField label="Acento (botones)" value={s.accent} fallback={r.primary} onChange={(v) => set({ accent: v })} resetLabel="Volver al del tema" error={err("style.accent")} />
        </div>
        {lowContrast && <Alert tone="warning">El texto casi no se distingue del fondo. Elige colores con más contraste.</Alert>}
        <p className="nx-help" style={{ margin: 0 }}>Sin color propio, la sección usa los del tema (y cambia con el modo oscuro si tu estilo lo hace). Con un fondo propio, el texto se ajusta solo para leerse bien.</p>
      </Group>
      {!isHeader && (
        <Group title="Imagen de fondo">
          <ImagePick label="Imagen" value={s.backgroundImage} onPick={(k) => set({ backgroundImage: k })} onClear={() => set({ backgroundImage: null })} hint="Opcional · se recorta para llenar la sección" error={err("style.backgroundImage")} />
          {s.backgroundImage && (
            <div className="nx-field">
              <label className="nx-label" htmlFor={`ov-${block.id}`}>Capa de color sobre la imagen: {s.overlay} %</label>
              <input id={`ov-${block.id}`} type="range" min={0} max={90} step={5} value={s.overlay} onChange={(e) => set({ overlay: Number(e.target.value) })} />
            </div>
          )}
        </Group>
      )}
      <Group title="Letra y esquinas">
        <div className="nx-grid-2">
          <SelectField label="Letra de los títulos" value={s.font ?? ""} onChange={(e) => set({ font: (e.target.value || null) as BlockStyle["font"] })}>
            <option value="">La del tema</option>
            {THEME_FONT_IDS.map((id) => <option key={id} value={id}>{THEME_FONTS[id].label}</option>)}
          </SelectField>
          <SelectField label="Esquinas" value={s.radius ?? ""} onChange={(e) => set({ radius: (e.target.value || null) as BlockStyle["radius"] })}>
            <option value="">Las del tema</option>
            {THEME_RADIUS_IDS.map((id) => <option key={id} value={id}>{THEME_RADII[id].label}</option>)}
          </SelectField>
        </div>
      </Group>
      {!isHeader && (
        <>
          <Group title="Forma y espacio">
            <Field label="Ancho"><Segmented label="Ancho" value={s.width} onChange={(v) => set({ width: v })} options={opt(BLOCK_WIDTHS)} /></Field>
            <Field label="Alineación"><Segmented label="Alineación" value={s.align} onChange={(v) => set({ align: v })} options={[{ id: "left", label: "Izquierda" }, { id: "center", label: "Centro" }, { id: "right", label: "Derecha" }]} /></Field>
            <Field label="Marco del contenido"><Segmented label="Marco" value={s.frame} onChange={(v) => set({ frame: v })} options={opt(BLOCK_FRAMES)} /></Field>
            <div className="nx-grid-2">
              <Field label="Espacio arriba"><Segmented label="Espacio arriba" value={s.paddingTop} onChange={(v) => set({ paddingTop: v })} options={[...SPACING_OPTS]} /></Field>
              <Field label="Espacio abajo"><Segmented label="Espacio abajo" value={s.paddingBottom} onChange={(v) => set({ paddingBottom: v })} options={[...SPACING_OPTS]} /></Field>
            </div>
            <div className="nx-grid-2">
              <SelectField label="Borde de arriba" value={s.edgeTop} onChange={(e) => set({ edgeTop: e.target.value as BlockStyle["edgeTop"] })}>{opt(BLOCK_EDGES).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</SelectField>
              <SelectField label="Borde de abajo" value={s.edgeBottom} onChange={(e) => set({ edgeBottom: e.target.value as BlockStyle["edgeBottom"] })}>{opt(BLOCK_EDGES).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</SelectField>
            </div>
            {(s.edgeTop !== "none" || s.edgeBottom !== "none") && !s.background && !s.backgroundImage && <p className="nx-help" style={{ margin: 0 }}>Las formas de los bordes se notan con un color o imagen de fondo.</p>}
          </Group>
        </>
      )}
    </div>
  );
}

/* ---------- Visibility ---------- */

export function VisibilityForm({ block, set, err }: { block: StoreBlock; set: (patch: Partial<Pick<StoreBlock, "enabled" | "name" | "device" | "anchor" | "startsOn" | "endsOn">>) => void; err: Err }) {
  const isHeader = LAYOUT_BLOCKS.has(block.type);
  return (
    <div className="nx-stack" style={{ gap: 16 }}>
      <Switch label="Mostrar en la tienda" checked={block.enabled} onChange={(v) => set({ enabled: v })} />
      <TextField label="Nombre en el editor" optional value={block.name ?? ""} maxLength={60} placeholder="Promo de verano" onChange={(e) => set({ name: e.target.value || null })} error={err("name")} help="Solo lo ves tú, para ubicarla en la lista." />
      {!isHeader && (
        <>
          <Field label="Dónde se ve"><Segmented label="Dispositivo" value={block.device} onChange={(v) => set({ device: v })} options={[{ id: "all", label: "Siempre" }, { id: "desktop", label: "Solo computadora" }, { id: "mobile", label: "Solo celular" }]} /></Field>
          <TextField
            label="Ancla"
            optional
            value={block.anchor ?? ""}
            maxLength={40}
            placeholder="horarios"
            onChange={(e) => set({ anchor: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") || null })}
            error={err("anchor")}
            help={block.anchor ? `Enlaza aquí desde el menú o un botón con #${block.anchor}` : "Para enlazar a esta sección desde el menú o un botón (#ancla)."}
          />
          <DateRange value={block} onChange={(r) => set(r)} error={err("endsOn")} />
        </>
      )}
    </div>
  );
}
