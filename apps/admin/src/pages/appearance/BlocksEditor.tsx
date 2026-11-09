/**
 * Apariencia › Página principal: the home as a list of sections. Add, reorder (drag or arrows), duplicate,
 * hide and delete; each section opens its content, design and visibility.
 */
import { useState, type ComponentType } from "react";
import {
  ArrowDown, ArrowUp, Award, CircleHelp, Clock, Code, Copy, Eye, EyeOff, Film, GalleryHorizontal, GripVertical, Image, Images, LayoutGrid, MapPin, Minus, PanelTop,
  Plus, ShoppingBag, Sparkles, Trash2, Type,
} from "lucide-react";
import { BLOCK_LIMITS, BLOCK_TYPE_IDS, BLOCK_TYPES, blockSummary, newBlock, type BlockType, type StoreBlock } from "@nexo/shared";
import { Alert, Badge, Button, Modal, Segmented } from "@nexo/ui";
import { ContentForm, StyleForm, VisibilityForm, type FormContext } from "./blockForms";
import { moveItem, newId, today } from "./fields";

export const BLOCK_ICONS: Record<BlockType, ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>> = {
  header: PanelTop, hero: Sparkles, banners: GalleryHorizontal, catalog: LayoutGrid, products: ShoppingBag, text: Type, imageText: Image, gallery: Images,
  faq: CircleHelp, hours: Clock, map: MapPin, loyalty: Award, embed: Film, html: Code, divider: Minus,
};

/** A new section with friendly starting content. */
function starter(type: BlockType): StoreBlock {
  const id = `${type.toLowerCase()}-${newId().slice(0, 5)}`;
  const b = newBlock(type, id);
  if (b.type === "text") b.data = { ...b.data, heading: "Nuestra historia", body: "Cuéntale a tus clientes quién eres, qué te hace diferente y por qué les va a encantar comprarte." };
  if (b.type === "imageText") b.data = { ...b.data, heading: "Hecho con cuidado", body: "Describe tu producto estrella, tu proceso o tu equipo." };
  if (b.type === "html") b.data = { ...b.data, html: '<div style="padding:24px;text-align:center">\n  <h2 style="margin:0 0 8px">¡Hola!</h2>\n  <p style="margin:0;color:var(--primary)">Escribe aquí tu HTML.</p>\n</div>' };
  if (b.type === "faq") b.data = { ...b.data, source: "own", items: [{ q: "¿Hacen envíos?", a: "Sí, enviamos a toda la ciudad." }] };
  return b;
}

type Tab = "contenido" | "diseno" | "visibilidad";

export function BlocksEditor({ blocks, onChange, errors, clearErrors, ctx, selected, onSelect }: {
  blocks: StoreBlock[];
  onChange: (blocks: StoreBlock[]) => void;
  errors: Record<string, string>;
  clearErrors: () => void;
  ctx: FormContext;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<StoreBlock | null>(null);
  const [tab, setTab] = useState<Tab>("contenido");
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const now = today();

  const header = blocks.find((b) => b.type === "header") ?? null;
  const update = (id: string, fn: (b: StoreBlock) => StoreBlock) => onChange(blocks.map((b) => (b.id === id ? fn(b) : b)));
  const move = (from: number, to: number) => { clearErrors(); onChange(moveItem(blocks, from, to)); };
  const add = (type: BlockType) => {
    const b = starter(type);
    const at = type === "header" ? 0 : selected ? blocks.findIndex((x) => x.id === selected) + 1 : blocks.length;
    const next = [...blocks];
    next.splice(at <= 0 && type !== "header" ? blocks.length : at, 0, b);
    clearErrors();
    onChange(next);
    setAdding(false);
    setTab("contenido");
    onSelect(b.id);
  };
  const duplicate = (b: StoreBlock) => {
    const copy = { ...structuredClone(b), id: `${b.type.toLowerCase()}-${newId().slice(0, 5)}`, name: `${b.name ?? BLOCK_TYPES[b.type].label} (copia)`.slice(0, 60), anchor: null };
    const at = blocks.findIndex((x) => x.id === b.id) + 1;
    clearErrors();
    onChange([...blocks.slice(0, at), copy, ...blocks.slice(at)]);
    onSelect(copy.id);
  };
  const remove = (b: StoreBlock) => {
    clearErrors();
    onChange(blocks.filter((x) => x.id !== b.id));
    if (selected === b.id) onSelect(null);
    setRemoving(null);
  };

  const row = (b: StoreBlock, i: number, pinned = false) => {
    const Icon = BLOCK_ICONS[b.type];
    const open = selected === b.id;
    const prefix = `blocks.${i}.`;
    const errCount = Object.keys(errors).filter((k) => k.startsWith(prefix)).length;
    const err = (path: string) => errors[`${prefix}${path}`];
    const off = (b.startsOn && b.startsOn > now) || (b.endsOn && b.endsOn < now);
    const label = BLOCK_TYPES[b.type].label;
    return (
      <li
        key={b.id}
        className="nx-block-item"
        data-open={open || undefined}
        data-hidden={!b.enabled || undefined}
        data-over={over === i && dragging !== null && dragging !== i ? "" : undefined}
        draggable={!pinned && !open}
        onDragStart={(e) => { setDragging(i); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", b.id); }}
        onDragOver={(e) => { if (dragging === null || pinned) return; e.preventDefault(); setOver(i); }}
        onDragLeave={() => setOver((o) => (o === i ? null : o))}
        onDrop={(e) => { e.preventDefault(); if (dragging !== null && dragging !== i && !pinned) move(dragging, i); setDragging(null); setOver(null); }}
        onDragEnd={() => { setDragging(null); setOver(null); }}
      >
        <div className="nx-block-item__row">
          {!pinned && <span className="nx-block-item__grip" title="Arrastra para mover" aria-hidden="true"><GripVertical className="nx-icon" /></span>}
          <button type="button" className="nx-block-item__main" aria-expanded={open} onClick={() => { onSelect(open ? null : b.id); setTab("contenido"); }}>
            <span className="nx-block-item__icon"><Icon className="nx-icon" aria-hidden="true" /></span>
            <span className="nx-block-item__text">
              <span className="nx-block-item__name">{b.name ?? label}</span>
              <span className="nx-block-item__summary">{b.name ? `${label} · ` : ""}{blockSummary(b)}</span>
            </span>
          </button>
          <span className="nx-block-item__badges">
            {errCount > 0 && <Badge tone="danger">Revisar</Badge>}
            {!b.enabled ? <Badge>Oculta</Badge> : off ? <Badge tone="warning">Fuera de fechas</Badge> : null}
            {b.device !== "all" && <Badge tone="accent">{b.device === "mobile" ? "Celular" : "Computadora"}</Badge>}
          </span>
          <span className="nx-block-item__actions">
            <Button size="sm" variant="ghost" icon aria-label={b.enabled ? `Ocultar ${label}` : `Mostrar ${label}`} title={b.enabled ? "Ocultar" : "Mostrar"} onClick={() => update(b.id, (x) => ({ ...x, enabled: !x.enabled }))}>
              {b.enabled ? <Eye className="nx-icon" aria-hidden="true" /> : <EyeOff className="nx-icon" aria-hidden="true" />}
            </Button>
            {!pinned && (
              <>
                <Button size="sm" variant="ghost" icon disabled={i === 0 || (i === 1 && blocks[0]?.type === "header")} aria-label={`Subir ${label}`} title="Subir" onClick={() => move(i, i - 1)}><ArrowUp className="nx-icon" aria-hidden="true" /></Button>
                <Button size="sm" variant="ghost" icon disabled={i === blocks.length - 1} aria-label={`Bajar ${label}`} title="Bajar" onClick={() => move(i, i + 1)}><ArrowDown className="nx-icon" aria-hidden="true" /></Button>
                {!BLOCK_TYPES[b.type].single && <Button size="sm" variant="ghost" icon disabled={blocks.length >= BLOCK_LIMITS.blocks} aria-label={`Duplicar ${label}`} title="Duplicar" onClick={() => duplicate(b)}><Copy className="nx-icon" aria-hidden="true" /></Button>}
              </>
            )}
            <Button size="sm" variant="ghost" icon aria-label={`Eliminar ${label}`} title="Eliminar" onClick={() => setRemoving(b)}><Trash2 className="nx-icon" aria-hidden="true" /></Button>
          </span>
        </div>
        {open && (
          <div className="nx-block-item__panel">
            <Segmented label="Partes de la sección" value={tab} onChange={setTab} options={[{ id: "contenido", label: "Contenido" }, { id: "diseno", label: "Diseño" }, { id: "visibilidad", label: "Visibilidad" }]} />
            {errCount > 0 && err("type") && <Alert tone="danger">{err("type")}</Alert>}
            {tab === "contenido" && <ContentForm block={b} ctx={ctx} err={err} set={(patch) => update(b.id, (x) => ({ ...x, data: { ...x.data, ...patch } }) as StoreBlock)} />}
            {tab === "diseno" && <StyleForm block={b} theme={ctx.theme} err={err} set={(patch) => update(b.id, (x) => ({ ...x, style: { ...x.style, ...patch } }))} />}
            {tab === "visibilidad" && <VisibilityForm block={b} err={err} set={(patch) => update(b.id, (x) => ({ ...x, ...patch }))} />}
          </div>
        )}
      </li>
    );
  };

  const singleTaken = (t: BlockType) => BLOCK_TYPES[t].single && blocks.some((b) => b.type === t);
  return (
    <div className="nx-stack" style={{ gap: 14 }}>
      <div className="nx-row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <p className="nx-muted" style={{ margin: 0 }}>Tu página principal, de arriba hacia abajo. Toca una sección para editarla; arrástrala para moverla.</p>
        <Button variant="primary" size="sm" disabled={blocks.length >= BLOCK_LIMITS.blocks} onClick={() => setAdding(true)}><Plus className="nx-icon" aria-hidden="true" />Agregar sección</Button>
      </div>
      {errors.blocks && <Alert tone="danger">{errors.blocks}</Alert>}
      <ul className="nx-block-list" aria-label="Secciones de la página principal">
        {header ? row(header, blocks.indexOf(header), true) : (
          <li className="nx-block-item nx-block-item--ghost">
            <div className="nx-block-item__row">
              <span className="nx-block-item__icon"><PanelTop className="nx-icon" aria-hidden="true" /></span>
              <span className="nx-block-item__text"><span className="nx-block-item__name">Encabezado</span><span className="nx-block-item__summary">Logo, buscador, cuenta y carrito (predeterminado)</span></span>
              <Button size="sm" onClick={() => add("header")}>Personalizar y agregar menú</Button>
            </div>
          </li>
        )}
        {blocks.map((b, i) => (b.type === "header" ? null : row(b, i)))}
      </ul>
      {blocks.filter((b) => b.type !== "header").length === 0 && <Alert tone="warning">La página principal está vacía. Agrega al menos el catálogo para que se vean tus productos.</Alert>}
      {!blocks.some((b) => b.type === "catalog") && blocks.some((b) => b.type !== "header") && <p className="nx-help" style={{ margin: 0 }}>Sin sección «Catálogo», tus productos se ven al buscar, al filtrar o desde «Productos destacados».</p>}

      <Modal open={adding} title="Agregar sección" size="lg" onClose={() => setAdding(false)}>
        <div className="nx-block-types">
          {BLOCK_TYPE_IDS.map((t) => {
            const Icon = BLOCK_ICONS[t];
            const taken = singleTaken(t);
            const html = t === "html" && blocks.filter((b) => b.type === "html").length >= BLOCK_LIMITS.htmlBlocks;
            return (
              <button key={t} type="button" className="nx-block-type" disabled={taken || html} onClick={() => add(t)}>
                <span className="nx-block-item__icon"><Icon className="nx-icon" aria-hidden="true" /></span>
                <span className="nx-block-type__name">{BLOCK_TYPES[t].label}</span>
                <span className="nx-block-type__desc">{taken ? "Ya está en tu página." : BLOCK_TYPES[t].description}</span>
              </button>
            );
          })}
        </div>
        {selected && <p className="nx-help" style={{ margin: "12px 0 0" }}>Se agrega debajo de la sección abierta.</p>}
      </Modal>
      <Modal
        open={Boolean(removing)}
        title="¿Eliminar la sección?"
        onClose={() => setRemoving(null)}
        footer={<><Button onClick={() => setRemoving(null)}>Cancelar</Button><Button variant="danger" onClick={() => removing && remove(removing)}>Eliminar</Button></>}
      >
        <p style={{ margin: 0 }}>«{removing ? (removing.name ?? BLOCK_TYPES[removing.type].label) : ""}» se quitará de tu página al guardar. Si solo quieres esconderla un tiempo, usa el ojo para ocultarla.</p>
      </Modal>
    </div>
  );
}
