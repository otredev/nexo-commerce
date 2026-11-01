import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, ImagePlus, Plus, Trash2, X } from "lucide-react";
import {
  bpsToPercent,
  combinations,
  formatQty,
  marginFor,
  parseMoney,
  UNITS,
  unitInfo,
  type Named,
  type ProductDetail,
  type ProductInput,
  type UnitCode,
} from "@nexo/shared";
import { Alert, Badge, Button, Card, Checkbox, Modal, PageHeader, SelectField, Switch, Tabs, TextAreaField, TextField, useToast } from "@nexo/ui";
import { del, get, post, put, RequestError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { centsToInput, useBusiness } from "../lib/business";
import { useLoad, useSubmit } from "../lib/hooks";
import { ProductInventoryTab, ProductMovementsTab } from "./ProductInventory";

interface VariantRow {
  key: string;
  id?: string;
  sku: string;
  barcode: string;
  options: string[];
  price: string;
  cost: string;
  minStock: string;
  initialStock: string;
  active: boolean;
  stock?: number;
}
interface OptionRow { name: string; values: string }
interface Form {
  name: string;
  description: string;
  categoryId: string;
  brandId: string;
  taxRateId: string;
  unit: UnitCode;
  trackInventory: boolean;
  images: string[];
  hasVariants: boolean;
  options: OptionRow[];
  variants: VariantRow[];
}

let keySeq = 0;
const newKey = () => `v${++keySeq}`;
const optionKey = (options: string[]) => options.map((o) => o.trim().toLowerCase()).join("\u0000");
const splitValues = (s: string) => [...new Map(s.split(",").map((v) => v.trim()).filter(Boolean).map((v) => [v.toLowerCase(), v])).values()];
const emptyVariant = (options: string[] = [], base?: Partial<VariantRow>): VariantRow => ({
  key: newKey(), sku: "", barcode: "", options, price: base?.price ?? "", cost: base?.cost ?? "", minStock: base?.minStock ?? "", initialStock: "", active: true,
});

const EMPTY: Form = {
  name: "", description: "", categoryId: "", brandId: "", taxRateId: "", unit: "unit", trackInventory: true, images: [],
  hasVariants: false, options: [{ name: "", values: "" }], variants: [emptyVariant()],
};

function fromProduct(p: ProductDetail): Form {
  return {
    name: p.name,
    description: p.description ?? "",
    categoryId: p.categoryId ?? "",
    brandId: p.brandId ?? "",
    taxRateId: p.taxRateId ?? "",
    unit: p.unit,
    trackInventory: p.trackInventory,
    images: p.images,
    hasVariants: p.optionNames.length > 0,
    options: p.optionNames.length
      ? p.optionNames.map((name, i) => ({ name, values: [...new Set(p.variants.map((v) => v.options[i] ?? ""))].filter(Boolean).join(", ") }))
      : [{ name: "", values: "" }],
    variants: p.variants.map((v) => ({
      key: newKey(), id: v.id, sku: v.sku, barcode: v.barcode ?? "", options: v.options, price: centsToInput(v.priceCents),
      cost: centsToInput(v.costCents), minStock: v.minStock ? String(v.minStock) : "", initialStock: "", active: v.active, stock: v.stock,
    })),
  };
}

/** Rebuilds the variant list from the option values, keeping the data of combinations that already existed. */
function regenerate(form: Form): VariantRow[] {
  const opts = form.options.filter((o) => o.name.trim() && splitValues(o.values).length);
  if (!opts.length) return form.variants.slice(0, 1).map((v) => ({ ...v, options: [] }));
  const combos = combinations(opts.map((o) => splitValues(o.values)));
  const byKey = new Map(form.variants.map((v) => [optionKey(v.options), v]));
  const unmatched = form.variants.filter((v) => !combos.some((c) => optionKey(c) === optionKey(v.options)));
  const base = form.variants[0];
  return combos.map((combo) => {
    const existing = byKey.get(optionKey(combo));
    if (existing) return { ...existing, options: combo };
    // Reuse a variant whose combination disappeared (e.g. a simple product turning into variants) so it keeps its stock.
    const reuse = unmatched.find((v) => v.options.length !== combo.length || v.id);
    if (reuse) {
      unmatched.splice(unmatched.indexOf(reuse), 1);
      return { ...reuse, options: combo };
    }
    return emptyVariant(combo, base);
  });
}

function toInput(form: Form): ProductInput {
  const optionNames = form.hasVariants ? form.options.filter((o) => o.name.trim() && splitValues(o.values).length).map((o) => o.name.trim()) : [];
  const errors: Record<string, string> = {};
  const qty = (s: string) => (s.trim() ? Number(s.replace(",", ".")) : 0);
  const variants = (form.hasVariants ? form.variants : form.variants.slice(0, 1).map((v) => ({ ...v, options: [] }))).map((v, i) => {
    const price = parseMoney(v.price);
    const cost = v.cost.trim() ? parseMoney(v.cost) : 0;
    if (price === null) errors[`variants.${i}.priceCents`] = v.price.trim() ? "Importe no válido" : "Requerido";
    if (cost === null) errors[`variants.${i}.costCents`] = "Importe no válido";
    if (Number.isNaN(qty(v.minStock))) errors[`variants.${i}.minStock`] = "Número no válido";
    if (Number.isNaN(qty(v.initialStock))) errors[`variants.${i}.initialStock`] = "Número no válido";
    return {
      ...(v.id && { id: v.id }),
      sku: v.sku.trim(),
      barcode: v.barcode.trim() || null,
      options: v.options,
      priceCents: price ?? 0,
      costCents: cost ?? 0,
      minStock: qty(v.minStock),
      ...(!v.id && v.initialStock.trim() && { initialStock: qty(v.initialStock) }),
      active: v.active,
    };
  });
  if (form.hasVariants && !optionNames.length) errors.optionNames = "Agrega al menos una opción con valores, o desactiva las variantes";
  if (Object.keys(errors).length) throw new RequestError(422, "validation_error", "Revisa los campos marcados", errors);
  return {
    name: form.name,
    description: form.description || null,
    categoryId: form.categoryId || null,
    brandId: form.brandId || null,
    taxRateId: form.taxRateId || null,
    unit: form.unit,
    trackInventory: form.trackInventory,
    optionNames,
    images: form.images,
    variants,
  };
}

export function ProductFormPage() {
  const { id } = useParams();
  const isNew = !id;
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") ?? "detalles") as "detalles" | "inventario" | "movimientos";
  const { data: product, error: loadError, setData: setProduct } = useLoad(() => (id ? get<ProductDetail>(`/products/${id}`) : Promise.resolve(null)), [id]);

  if (loadError) return <Alert tone="danger">{loadError.status === 404 ? "Este producto no existe o fue eliminado." : loadError.message}</Alert>;
  if (!isNew && !product) return <div className="nx-page-loading"><span className="nx-spinner" aria-label="Cargando" /></div>;

  return (
    <>
      <div>
        <Link className="nx-link" to="/productos" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <ArrowLeft size={14} aria-hidden="true" />Productos
        </Link>
      </div>
      {isNew ? (
        <>
          <PageHeader title="Nuevo producto" />
          <ProductEditor product={null} onSaved={() => {}} />
        </>
      ) : (
        <>
          <ProductHeader product={product!} onChange={(p) => setProduct(p)} />
          {product!.trackInventory && (
            <Tabs
              label="Secciones del producto"
              tabs={[{ id: "detalles", label: "Detalles" }, { id: "inventario", label: "Inventario" }, { id: "movimientos", label: "Movimientos" }]}
              value={tab}
              onChange={(t) => setParams(t === "detalles" ? {} : { tab: t }, { replace: true })}
            />
          )}
          {tab === "detalles" || !product!.trackInventory ? (
            <ProductEditor key={product!.updatedAt} product={product!} onSaved={(p) => setProduct(p)} />
          ) : tab === "inventario" ? (
            <ProductInventoryTab product={product!} onChanged={async () => setProduct(await get<ProductDetail>(`/products/${id}`))} />
          ) : (
            <ProductMovementsTab product={product!} />
          )}
        </>
      )}
    </>
  );
}

function ProductHeader({ product, onChange }: { product: ProductDetail; onChange: (p: ProductDetail) => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const archived = product.status === "archived";
  const total = product.variants.reduce((s, v) => s + v.stock, 0);
  const toggle = useSubmit(async () => {
    await post(`/products/${product.id}/${archived ? "restore" : "archive"}`);
    onChange({ ...product, status: archived ? "active" : "archived" });
    toast(archived ? "Producto restaurado" : "Producto archivado");
  });
  const remove = useSubmit(async () => {
    await del(`/products/${product.id}`);
    toast("Producto eliminado");
    navigate("/productos", { replace: true });
  });
  return (
    <>
      <PageHeader
        title={product.name}
        description={
          <span className="nx-row" style={{ gap: 8 }}>
            {archived ? <Badge>Archivado</Badge> : <Badge tone="success">Activo</Badge>}
            {product.trackInventory && <span className="nx-num">{formatQty(total, product.unit)} en existencia</span>}
            {product.variants.length > 1 && <span>· {product.variants.length} variantes</span>}
          </span>
        }
        actions={can("catalog:write") && (
          <>
            <Button variant="danger-ghost" onClick={() => setConfirmDelete(true)}><Trash2 className="nx-icon" aria-hidden="true" />Eliminar</Button>
            <Button loading={toggle.pending} onClick={() => void toggle.submit()}>{archived ? "Restaurar" : "Archivar"}</Button>
          </>
        )}
      />
      {toggle.message && <Alert tone="danger">{toggle.message}</Alert>}
      <Modal
        open={confirmDelete}
        title={`¿Eliminar ${product.name}?`}
        onClose={() => setConfirmDelete(false)}
        footer={<><Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancelar</Button><Button variant="danger" disabled={total !== 0} loading={remove.pending} onClick={() => void remove.submit()}>Eliminar</Button></>}
      >
        {total !== 0 ? (
          <Alert tone="warning">Este producto tiene {formatQty(total, product.unit)} en existencia. Ajusta el stock a 0 o archívalo para ocultarlo sin perder nada.</Alert>
        ) : (
          <>Dejará de aparecer en el catálogo. Su historial de movimientos se conserva. Si solo quieres ocultarlo temporalmente, archívalo.</>
        )}
        {remove.message && <div style={{ marginTop: 12 }}><Alert tone="danger">{remove.message}</Alert></div>}
      </Modal>
    </>
  );
}

function ProductEditor({ product, onSaved }: { product: ProductDetail | null; onSaved: (p: ProductDetail) => void }) {
  const { can } = useAuth();
  const { taxes, defaultTax, taxFor, settings } = useBusiness();
  const toast = useToast();
  const navigate = useNavigate();
  const editable = can("catalog:write");
  const showCost = can("costs:read");
  const initial = useMemo(() => (product ? fromProduct(product) : EMPTY), [product]);
  const [form, setForm] = useState<Form>(initial);
  const [creating, setCreating] = useState<"category" | "brand" | null>(null);
  const names = useLoad(async () => {
    const [categories, brands] = await Promise.all([get<Named[]>("/categories"), get<Named[]>("/brands")]);
    return { categories, brands };
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = useSubmit(async () => {
    const body = toInput(form);
    const saved = product ? await put<ProductDetail>(`/products/${product.id}`, body) : await post<ProductDetail>("/products", body);
    toast(product ? "Cambios guardados" : "Producto creado");
    if (product) onSaved(saved);
    else navigate(`/productos/${saved.id}`, { replace: true });
  });
  const upload = useSubmit(async (files: File[]) => {
    const keys: string[] = [];
    for (const file of files.slice(0, 8 - form.images.length)) {
      const fd = new FormData();
      fd.append("file", file);
      keys.push((await post<{ key: string }>("/uploads", fd)).key);
    }
    setForm((f) => ({ ...f, images: [...f.images, ...keys].slice(0, 8) }));
  });

  const FIELD: Record<string, string> = { price: "priceCents", cost: "costCents", minStock: "minStock", initialStock: "initialStock", sku: "sku", barcode: "barcode" };
  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    save.clearFields(key === "options" ? "optionNames" : key);
    setForm((f) => ({ ...f, [key]: value }));
  };
  const setVariant = (i: number, patch: Partial<VariantRow>) => {
    save.clearFields(...Object.keys(patch).map((k) => `variants.${i}.${FIELD[k] ?? k}`));
    setForm((f) => ({ ...f, variants: f.variants.map((v, j) => (j === i ? { ...v, ...patch } : v)) }));
  };
  const setOptions = (options: OptionRow[]) => {
    save.clearFields("optionNames", "variants");
    setForm((f) => {
      const next = { ...f, options };
      return { ...next, variants: regenerate(next) };
    });
  };
  const toggleVariants = (on: boolean) => setForm((f) => {
    if (!on) return { ...f, hasVariants: false, variants: [{ ...(f.variants[0] ?? emptyVariant()), options: [] }] };
    return { ...f, hasVariants: true, variants: regenerate({ ...f, hasVariants: true }) };
  });
  const applyToAll = (field: "price" | "cost" | "minStock") => {
    const value = form.variants[0]?.[field] ?? "";
    setForm((f) => ({ ...f, variants: f.variants.map((v) => ({ ...v, [field]: value })) }));
  };

  const tax = taxFor(form.taxRateId || null);
  const unit = unitInfo(form.unit);
  const err = (path: string) => save.fields[path];
  const marginText = (v: VariantRow) => {
    const price = parseMoney(v.price);
    const cost = v.cost.trim() ? parseMoney(v.cost) : 0;
    if (price === null || cost === null || !price) return "—";
    const m = marginFor(price, cost, tax?.rateBps ?? 0, settings?.pricesIncludeTax ?? true);
    return m === null ? "—" : `${(m / 100).toLocaleString("es-MX", { maximumFractionDigits: 1 })} %`;
  };
  const single = form.variants[0]!;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void save.submit();
  };

  return (
    <form onSubmit={onSubmit} className="nx-stack" style={{ gap: 24 }} noValidate>
      {save.message && <Alert tone="danger">{save.message}</Alert>}
      <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} className="nx-stack">
        <div className="nx-grid-2" style={{ gap: 24 }}>
          <div className="nx-stack" style={{ gap: 24 }}>
            <Card title="Información general">
              <div className="nx-stack">
                <TextField label="Nombre" value={form.name} onChange={(e) => set("name", e.target.value)} error={err("name")} placeholder="Camisa de lino" autoFocus={!product} />
                <TextAreaField label="Descripción" optional rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} error={err("description")} help="Se muestra en la tienda online." />
              </div>
            </Card>

            <Card title="Imágenes" description="Hasta 8. La primera es la principal; haz clic en otra para elegirla.">
              <div className="nx-images">
                {form.images.map((key, i) => (
                  <div className="nx-image" key={key}>
                    <img src={`/files/${key}`} alt={`Imagen ${i + 1}`} onClick={() => editable && i > 0 && set("images", [key, ...form.images.filter((k) => k !== key)])} style={{ cursor: i > 0 && editable ? "pointer" : "default" }} />
                    {i === 0 && <span className="nx-image__badge"><Badge tone="accent" plain>Principal</Badge></span>}
                    {editable && (
                      <button type="button" className="nx-image__remove" aria-label={`Quitar imagen ${i + 1}`} onClick={() => set("images", form.images.filter((k) => k !== key))}>
                        <X size={14} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                ))}
                {editable && form.images.length < 8 && (
                  <button type="button" className="nx-image nx-image--add" onClick={() => fileRef.current?.click()} disabled={upload.pending}>
                    {upload.pending ? <span className="nx-spinner" aria-label="Subiendo" /> : <><ImagePlus size={20} strokeWidth={1.5} aria-hidden="true" />Agregar</>}
                  </button>
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => { const fs = [...(e.target.files ?? [])]; if (fs.length) void upload.submit(fs); e.target.value = ""; }} />
              {(upload.message || upload.fields.file) && <div style={{ marginTop: 12 }}><Alert tone="danger">{upload.fields.file ?? upload.message}</Alert></div>}
            </Card>

            {!form.hasVariants && (
              <Card title="Precio e inventario">
                <div className="nx-form-grid">
                  <TextField label="Precio de venta" inputMode="decimal" className="nx-num" value={single.price} onChange={(e) => setVariant(0, { price: e.target.value })} error={err("variants.0.priceCents")} help={settings?.pricesIncludeTax ? "Con impuestos incluidos." : "Sin impuestos."} />
                  {showCost && <TextField label="Costo" optional inputMode="decimal" className="nx-num" value={single.cost} onChange={(e) => setVariant(0, { cost: e.target.value })} error={err("variants.0.costCents")} help={`Margen: ${marginText(single)}`} />}
                  <TextField label="SKU" optional value={single.sku} onChange={(e) => setVariant(0, { sku: e.target.value.toUpperCase() })} error={err("variants.0.sku")} help={single.sku ? undefined : "Se genera solo si lo dejas vacío."} className="nx-mono" />
                  <TextField label="Código de barras" optional value={single.barcode} onChange={(e) => setVariant(0, { barcode: e.target.value })} error={err("variants.0.barcode")} className="nx-mono" />
                  {form.trackInventory && (
                    <>
                      <TextField label={`Stock mínimo (${unit.short})`} optional inputMode="decimal" className="nx-num" value={single.minStock} onChange={(e) => setVariant(0, { minStock: e.target.value })} error={err("variants.0.minStock")} help="Te avisamos cuando llegue a esta cantidad." />
                      {!single.id ? (
                        <TextField label={`Existencia inicial (${unit.short})`} optional inputMode="decimal" className="nx-num" value={single.initialStock} onChange={(e) => setVariant(0, { initialStock: e.target.value })} error={err("variants.0.initialStock")} help="Se carga en tu ubicación principal." />
                      ) : (
                        <div className="nx-field">
                          <span className="nx-label">Existencia</span>
                          <div className="nx-row" style={{ minHeight: 36 }}><span className="nx-num" style={{ fontWeight: 500 }}>{formatQty(single.stock ?? 0, form.unit)}</span></div>
                          <span className="nx-help">Cámbiala desde la pestaña Inventario.</span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </Card>
            )}

            <Card title="Variantes" description="Para productos con talla, color, sabor u otra opción. Cada combinación tiene su propio SKU, precio y existencias.">
              <div className="nx-stack">
                <Switch label="Este producto tiene variantes" checked={form.hasVariants} onChange={toggleVariants} disabled={!editable} />
                {form.hasVariants && (
                  <>
                    {form.options.map((o, i) => (
                      <div className="nx-option-row" key={i}>
                        <TextField label={i === 0 ? "Opción" : `Opción ${i + 1}`} value={o.name} placeholder={["Talla", "Color", "Material"][i]} onChange={(e) => setOptions(form.options.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                        <TextField label="Valores" value={o.values} placeholder={["S, M, L", "Blanco, Negro", "Algodón, Lino"][i]} help="Separados por comas." onChange={(e) => setOptions(form.options.map((x, j) => (j === i ? { ...x, values: e.target.value } : x)))} />
                        <div style={{ paddingTop: 24 }}>
                          <Button variant="ghost" icon aria-label={`Quitar opción ${i + 1}`} disabled={form.options.length === 1} onClick={() => setOptions(form.options.filter((_, j) => j !== i))}>
                            <X className="nx-icon" aria-hidden="true" />
                          </Button>
                        </div>
                      </div>
                    ))}
                    {err("optionNames") && <Alert tone="danger">{err("optionNames")}</Alert>}
                    {form.options.length < 3 && (
                      <div><Button size="sm" variant="ghost" onClick={() => setOptions([...form.options, { name: "", values: "" }])}><Plus className="nx-icon" aria-hidden="true" />Agregar opción</Button></div>
                    )}
                  </>
                )}
              </div>
            </Card>
          </div>

          <div className="nx-stack" style={{ gap: 24 }}>
            <Card title="Organización">
              <div className="nx-stack">
                <SelectField label="Categoría" value={form.categoryId} onChange={(e) => (e.target.value === "__new" ? setCreating("category") : set("categoryId", e.target.value))} error={err("categoryId")}>
                  <option value="">Sin categoría</option>
                  {names.data?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  {editable && <option value="__new">+ Nueva categoría…</option>}
                </SelectField>
                <SelectField label="Marca" value={form.brandId} onChange={(e) => (e.target.value === "__new" ? setCreating("brand") : set("brandId", e.target.value))} error={err("brandId")}>
                  <option value="">Sin marca</option>
                  {names.data?.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  {editable && <option value="__new">+ Nueva marca…</option>}
                </SelectField>
                <SelectField label="Impuesto" value={form.taxRateId} onChange={(e) => set("taxRateId", e.target.value)} error={err("taxRateId")}>
                  <option value="">Predeterminado{defaultTax ? ` (${defaultTax.name})` : ""}</option>
                  {taxes.filter((t) => t.active || t.id === form.taxRateId).map((t) => <option key={t.id} value={t.id}>{t.name} — {bpsToPercent(t.rateBps)} %</option>)}
                </SelectField>
              </div>
            </Card>
            <Card title="Inventario">
              <div className="nx-stack">
                <SelectField label="Unidad de venta" value={form.unit} onChange={(e) => set("unit", e.target.value as UnitCode)} error={err("unit")} help={unit.decimals ? "Permite cantidades con decimales." : undefined}>
                  {UNITS.map((u) => <option key={u.code} value={u.code}>{u.label}</option>)}
                </SelectField>
                <Checkbox
                  label="Controlar inventario"
                  help={form.trackInventory ? "Se descuentan existencias con cada venta." : "Para servicios o productos que no se cuentan."}
                  checked={form.trackInventory}
                  onChange={(e) => set("trackInventory", e.target.checked)}
                />
                {err("trackInventory") && <Alert tone="danger">{err("trackInventory")}</Alert>}
              </div>
            </Card>
          </div>
        </div>

        {form.hasVariants && form.variants.some((v) => v.options.length) && (
          <div className="nx-table-wrap">
            <div className="nx-table-toolbar">
              <span style={{ fontWeight: 600 }}>{form.variants.length} {form.variants.length === 1 ? "variante" : "variantes"}</span>
              {editable && form.variants.length > 1 && (
                <div className="nx-row" style={{ gap: 4 }}>
                  <span className="nx-muted" style={{ fontSize: 12 }}>Copiar de la primera fila:</span>
                  <Button size="sm" variant="ghost" onClick={() => applyToAll("price")}>Precio</Button>
                  {showCost && <Button size="sm" variant="ghost" onClick={() => applyToAll("cost")}>Costo</Button>}
                  {form.trackInventory && <Button size="sm" variant="ghost" onClick={() => applyToAll("minStock")}>Mínimo</Button>}
                </div>
              )}
            </div>
            <div className="nx-table-scroll">
              <table className="nx-table nx-table--form">
                <thead>
                  <tr>
                    <th>Variante</th><th>SKU</th><th>Código de barras</th><th className="nx-col-num">Precio</th>
                    {showCost && <><th className="nx-col-num">Costo</th><th className="nx-col-num">Margen</th></>}
                    {form.trackInventory && <><th className="nx-col-num">Mínimo</th><th className="nx-col-num">Existencia</th></>}
                  </tr>
                </thead>
                <tbody>
                  {form.variants.map((v, i) => (
                    <tr key={v.key}>
                      <td style={{ whiteSpace: "nowrap", fontWeight: 500 }}>{v.options.join(" / ")}{err(`variants.${i}.options`) && <span className="nx-cell-error">{err(`variants.${i}.options`)}</span>}</td>
                      <td><Cell value={v.sku} onChange={(x) => setVariant(i, { sku: x.toUpperCase() })} error={err(`variants.${i}.sku`)} label={`SKU de ${v.options.join(" / ")}`} placeholder="Automático" mono /></td>
                      <td><Cell value={v.barcode} onChange={(x) => setVariant(i, { barcode: x })} error={err(`variants.${i}.barcode`)} label={`Código de ${v.options.join(" / ")}`} mono /></td>
                      <td><Cell value={v.price} onChange={(x) => setVariant(i, { price: x })} error={err(`variants.${i}.priceCents`)} label={`Precio de ${v.options.join(" / ")}`} num /></td>
                      {showCost && (
                        <>
                          <td><Cell value={v.cost} onChange={(x) => setVariant(i, { cost: x })} error={err(`variants.${i}.costCents`)} label={`Costo de ${v.options.join(" / ")}`} num /></td>
                          <td className="nx-col-num nx-muted">{marginText(v)}</td>
                        </>
                      )}
                      {form.trackInventory && (
                        <>
                          <td><Cell value={v.minStock} onChange={(x) => setVariant(i, { minStock: x })} error={err(`variants.${i}.minStock`)} label={`Mínimo de ${v.options.join(" / ")}`} num /></td>
                          <td className="nx-col-num">
                            {v.id ? (
                              <span className="nx-num">{formatQty(v.stock ?? 0, form.unit)}</span>
                            ) : (
                              <Cell value={v.initialStock} onChange={(x) => setVariant(i, { initialStock: x })} error={err(`variants.${i}.initialStock`)} label={`Existencia inicial de ${v.options.join(" / ")}`} placeholder="0" num />
                            )}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="nx-table-footer">
              <span>Precios {settings?.pricesIncludeTax ? "con" : "sin"} impuestos. {product ? "Las variantes nuevas cargan su existencia inicial en la ubicación principal." : "La existencia inicial se carga en tu ubicación principal."}</span>
            </div>
          </div>
        )}
      </fieldset>


      {editable && (
        <div className="nx-sticky-actions">
          {product && <Button variant="ghost" disabled={!dirty || save.pending} onClick={() => setForm(initial)}>Descartar cambios</Button>}
          <Button type="submit" variant="primary" disabled={Boolean(product) && !dirty} loading={save.pending}>
            {save.pending ? "Guardando" : product ? "Guardar cambios" : "Crear producto"}
          </Button>
        </div>
      )}

      <QuickCreate
        kind={creating}
        onClose={() => setCreating(null)}
        onCreated={(kind, item) => {
          void names.reload();
          set(kind === "category" ? "categoryId" : "brandId", item.id);
        }}
      />
    </form>
  );
}

function Cell({ value, onChange, error, label, placeholder, num, mono }: { value: string; onChange: (v: string) => void; error?: string; label: string; placeholder?: string; num?: boolean; mono?: boolean }) {
  return (
    <>
      <input
        className={`nx-input${num ? " nx-num" : ""}${mono ? " nx-mono" : ""}`}
        style={num ? { textAlign: "right", width: 96 } : { width: mono ? 150 : 120 }}
        inputMode={num ? "decimal" : undefined}
        value={value}
        placeholder={placeholder}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && <span className="nx-cell-error">{error}</span>}
    </>
  );
}

function QuickCreate({ kind, onClose, onCreated }: { kind: "category" | "brand" | null; onClose: () => void; onCreated: (kind: "category" | "brand", item: Named) => void }) {
  const [name, setName] = useState("");
  useEffect(() => setName(""), [kind]);
  const save = useSubmit(async () => {
    if (!kind) return;
    const item = await post<Named>(kind === "category" ? "/categories" : "/brands", { name });
    onCreated(kind, item);
    onClose();
  });
  return (
    <Modal
      open={kind !== null}
      title={kind === "category" ? "Nueva categoría" : "Nueva marca"}
      onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.pending} onClick={() => void save.submit()}>Crear</Button></>}
    >
      <form onSubmit={(e) => { e.preventDefault(); void save.submit(); }}>
        <TextField label="Nombre" value={name} onChange={(e) => setName(e.target.value)} error={save.fields.name ?? save.message ?? undefined} />
      </form>
    </Modal>
  );
}
