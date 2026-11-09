import { useEffect, useState } from "react";
import { Shuffle, Tag, Ticket, Trash2, X } from "lucide-react";
import {
  bpsToPercent,
  businessDate,
  type Coupon,
  type CouponInput,
  type CategoryItem, type Named,
  type Paginated,
  type ProductListItem,
  type Promotion,
  type PromotionInput,
} from "@nexo/shared";
import { categoryLabel, categoryTree } from "../lib/categories";
import { Alert, Badge, Button, Checkbox, EmptyState, Modal, PageHeader, SearchInput, Segmented, SelectField, Tabs, TextField, useDebounced, useToast } from "@nexo/ui";
import { del, get, post, put, RequestError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { centsToInput, useBusiness } from "../lib/business";
import { useLoad, useSubmit } from "../lib/hooks";
import { formatDay } from "../components/docs";
import { parseMoney } from "@nexo/shared";

type Rule = { active: boolean; startsOn: string | null; endsOn: string | null };
const CHANNEL = { all: "Caja y tienda", pos: "Solo caja", online: "Solo tienda en línea" } as const;

function StatusBadge({ r, today, exhausted }: { r: Rule; today: string; exhausted?: boolean }) {
  if (!r.active) return <Badge plain>Inactiva</Badge>;
  if (exhausted) return <Badge plain>Agotado</Badge>;
  if (r.endsOn && r.endsOn < today) return <Badge plain>Vencida</Badge>;
  if (r.startsOn && r.startsOn > today) return <Badge tone="info">Programada</Badge>;
  return <Badge tone="success">Vigente</Badge>;
}
const period = (r: Rule) => (r.startsOn || r.endsOn ? `${r.startsOn ? formatDay(r.startsOn) : "Hoy"} – ${r.endsOn ? formatDay(r.endsOn) : "sin fin"}` : "Sin fechas");

export function PromotionsPage() {
  const { can } = useAuth();
  const { money, settings } = useBusiness();
  const [tab, setTab] = useState<"promos" | "coupons">("promos");
  const [editPromo, setEditPromo] = useState<Promotion | "new" | null>(null);
  const [editCoupon, setEditCoupon] = useState<Coupon | "new" | null>(null);
  const { data, error, reload } = useLoad(() => get<{ promotions: Promotion[]; coupons: Coupon[] }>("/promotions"));
  const today = businessDate(settings?.timezone ?? "America/Mexico_City");
  const write = can("promotions:write");

  return (
    <>
      <PageHeader
        title="Promociones"
        description="Descuentos automáticos y cupones. Se aplican igual en la caja y en la tienda en línea."
        actions={write && (tab === "promos" ? <Button variant="primary" onClick={() => setEditPromo("new")}>Nueva promoción</Button> : <Button variant="primary" onClick={() => setEditCoupon("new")}>Nuevo cupón</Button>)}
      />
      <Tabs label="Tipo" value={tab} onChange={setTab} tabs={[{ id: "promos", label: "Descuentos automáticos" }, { id: "coupons", label: "Cupones" }]} />
      {error && <Alert tone="danger">{error.message}</Alert>}
      {tab === "promos" ? (
        <div className="nx-table-wrap">
          {data && data.promotions.length === 0 ? (
            <EmptyState icon={<Tag className="nx-icon" />} title="Sin promociones" text="Un porcentaje de descuento sobre todo, unas categorías o unos productos, por fechas. Se aplica solo, sin que el cajero haga nada." actions={write && <Button variant="primary" onClick={() => setEditPromo("new")}>Nueva promoción</Button>} />
          ) : (
            <div className="nx-table-scroll">
              <table className="nx-table">
                <thead><tr><th>Promoción</th><th>Aplica a</th><th>Dónde</th><th>Vigencia</th><th>Estado</th><th className="nx-col-num">Usos</th><th className="nx-col-num">Descuento dado</th></tr></thead>
                <tbody>
                  {data?.promotions.map((p) => (
                    <tr key={p.id} className={write ? "nx-clickable" : undefined} onClick={write ? () => setEditPromo(p) : undefined}>
                      <td><span style={{ fontWeight: 500 }}>{p.name}</span><div className="nx-muted" style={{ fontSize: 12 }}>−{bpsToPercent(p.percentBps)} %</div></td>
                      <td className="nx-muted" style={{ maxWidth: 260 }}>{p.target === "all" ? "Todos los productos" : p.targetNames.join(", ") || "—"}</td>
                      <td className="nx-muted">{CHANNEL[p.channel]}</td>
                      <td className="nx-muted nx-num" style={{ whiteSpace: "nowrap" }}>{period(p)}</td>
                      <td><StatusBadge r={p} today={today} /></td>
                      <td className="nx-col-num">{p.uses}</td>
                      <td className="nx-col-num">{money(p.discountGivenCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="nx-table-wrap">
          {data && data.coupons.length === 0 ? (
            <EmptyState icon={<Ticket className="nx-icon" />} title="Sin cupones" text="Un código que el cliente da en caja o escribe al pagar en la tienda: porcentaje o importe fijo, con compra mínima y límite de usos." actions={write && <Button variant="primary" onClick={() => setEditCoupon("new")}>Nuevo cupón</Button>} />
          ) : (
            <div className="nx-table-scroll">
              <table className="nx-table">
                <thead><tr><th>Código</th><th>Descuento</th><th>Dónde</th><th>Vigencia</th><th>Estado</th><th className="nx-col-num">Usos</th><th className="nx-col-num">Ventas con el cupón</th></tr></thead>
                <tbody>
                  {data?.coupons.map((c) => (
                    <tr key={c.id} className={write ? "nx-clickable" : undefined} onClick={write ? () => setEditCoupon(c) : undefined}>
                      <td><span className="nx-mono" style={{ fontWeight: 500 }}>{c.code}</span>{c.description && <div className="nx-muted" style={{ fontSize: 12 }}>{c.description}</div>}</td>
                      <td>{c.kind === "percent" ? `${bpsToPercent(c.value)} %` : money(c.value)}{c.minSubtotalCents > 0 && <div className="nx-muted" style={{ fontSize: 12 }}>Compra mínima {money(c.minSubtotalCents)}</div>}</td>
                      <td className="nx-muted">{CHANNEL[c.channel]}</td>
                      <td className="nx-muted nx-num" style={{ whiteSpace: "nowrap" }}>{period(c)}</td>
                      <td><StatusBadge r={c} today={today} exhausted={c.maxUses !== null && c.usesCount >= c.maxUses} /></td>
                      <td className="nx-col-num">{c.usesCount}{c.maxUses !== null && <span className="nx-muted"> / {c.maxUses}</span>}</td>
                      <td className="nx-col-num">{money(c.salesCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      <PromotionModal promo={editPromo} onClose={() => setEditPromo(null)} onSaved={() => { setEditPromo(null); void reload(); }} />
      <CouponModal coupon={editCoupon} onClose={() => setEditCoupon(null)} onSaved={() => { setEditCoupon(null); void reload(); }} />
    </>
  );
}

function PromotionModal({ promo, onClose, onSaved }: { promo: Promotion | "new" | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const editing = promo && promo !== "new" ? promo : null;
  const [form, setForm] = useState({ name: "", percent: "", target: "category" as PromotionInput["target"], channel: "all" as NonNullable<PromotionInput["channel"]>, startsOn: "", endsOn: "", active: true });
  const [targets, setTargets] = useState<Array<{ id: string; name: string }>>([]);
  const [productQ, setProductQ] = useState("");
  const productQuery = useDebounced(productQ);
  const categories = useLoad(() => (promo ? get<CategoryItem[]>("/categories") : Promise.resolve([] as CategoryItem[])), [Boolean(promo)]);
  const products = useLoad(
    () => (promo && form.target === "product" && productQuery ? get<Paginated<ProductListItem>>(`/products?q=${encodeURIComponent(productQuery)}&pageSize=8`) : Promise.resolve(null)),
    [Boolean(promo), form.target, productQuery],
  );
  useEffect(() => {
    if (!promo) return;
    if (promo === "new") {
      setForm({ name: "", percent: "", target: "category", channel: "all", startsOn: "", endsOn: "", active: true });
      setTargets([]);
    } else {
      setForm({ name: promo.name, percent: String(bpsToPercent(promo.percentBps)), target: promo.target, channel: promo.channel, startsOn: promo.startsOn ?? "", endsOn: promo.endsOn ?? "", active: promo.active });
      setTargets(promo.targetIds.map((id, i) => ({ id, name: promo.targetNames[i] ?? id })));
    }
    setProductQ("");
  }, [promo]);
  const toggle = (t: { id: string; name: string }) => setTargets((all) => (all.some((x) => x.id === t.id) ? all.filter((x) => x.id !== t.id) : [...all, t]));
  const save = useSubmit(async () => {
    const pct = Number(form.percent.replace(",", ".").replace("%", ""));
    if (!Number.isFinite(pct) || pct <= 0) throw new RequestError(422, "validation_error", "Revisa", { percentBps: "Escribe el porcentaje" });
    const body: PromotionInput = { name: form.name, percentBps: Math.round(pct * 100), target: form.target, targetIds: targets.map((t) => t.id), channel: form.channel, startsOn: form.startsOn || null, endsOn: form.endsOn || null, active: form.active };
    if (editing) await put(`/promotions/${editing.id}`, body); else await post("/promotions", body);
    toast(editing ? "Promoción guardada" : "Promoción creada");
    onSaved();
  });
  const remove = useSubmit(async () => {
    const r = await del<{ deleted: boolean }>(`/promotions/${editing!.id}`);
    toast(r?.deleted ? "Promoción eliminada" : "Ya se usó en ventas: quedó desactivada para conservar el historial");
    onSaved();
  });
  const f = save.fields;
  return (
    <Modal
      open={Boolean(promo)}
      size="lg"
      title={editing ? editing.name : "Nueva promoción"}
      onClose={onClose}
      footer={<>{editing && <Button variant="danger-ghost" loading={remove.pending} onClick={() => void remove.submit()} style={{ marginRight: "auto" }}><Trash2 className="nx-icon" aria-hidden="true" />Eliminar</Button>}<Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.pending} onClick={() => void save.submit()}>Guardar</Button></>}
    >
      <form className="nx-stack" onSubmit={(e) => { e.preventDefault(); void save.submit(); }}>
        {save.message && <Alert tone="danger">{save.message}</Alert>}
        <div className="nx-form-grid">
          <TextField label="Nombre" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={f.name} placeholder="Buen Fin, 2 × temporada…" autoFocus help="Lo ve el cajero en la línea y el cliente en la tienda." />
          <TextField label="Descuento (%)" inputMode="decimal" className="nx-num" value={form.percent} onChange={(e) => setForm({ ...form, percent: e.target.value })} error={f.percentBps} placeholder="20" />
        </div>
        <div className="nx-field">
          <span className="nx-label">Aplica a</span>
          <Segmented label="Aplica a" value={form.target} onChange={(target) => { setForm({ ...form, target }); setTargets([]); }} options={[{ id: "category", label: "Categorías" }, { id: "product", label: "Productos" }, { id: "all", label: "Todo" }]} />
        </div>
        {form.target === "category" && (
          <div className="nx-field">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {categoryTree(categories.data ?? []).flatMap((c) => [c, ...c.children]).map((c) => {
                const on = targets.some((t) => t.id === c.id);
                const label = categoryLabel(categories.data ?? [], c.id) ?? c.name;
                return <Button key={c.id} size="sm" variant={on ? "primary" : "secondary"} aria-pressed={on} onClick={() => toggle({ ...c, name: label })}>{label}</Button>;
              })}
              {categories.data?.length === 0 && <span className="nx-muted">Aún no tienes categorías.</span>}
            </div>
            {f.targetIds ? <span className="nx-help" style={{ color: "var(--danger)" }}>{f.targetIds}</span> : <span className="nx-help">Una categoría incluye sus subcategorías.</span>}
          </div>
        )}
        {form.target === "product" && (
          <div className="nx-field">
            {targets.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                {targets.map((t) => <Button key={t.id} size="sm" onClick={() => toggle(t)}>{t.name}<X className="nx-icon" aria-label="Quitar" /></Button>)}
              </div>
            )}
            <SearchInput label="Buscar producto" placeholder="Busca productos para agregarlos" value={productQ} onChange={setProductQ} width={9999} />
            {products.data?.items.filter((p) => !targets.some((t) => t.id === p.id)).map((p) => (
              <button key={p.id} type="button" className="nx-nav__item" style={{ border: 0, background: "none", width: "100%", cursor: "pointer" }} onClick={() => toggle({ id: p.id, name: p.name })}>+ {p.name}</button>
            ))}
            {f.targetIds && <span className="nx-help" style={{ color: "var(--danger)" }}>{f.targetIds}</span>}
          </div>
        )}
        <div className="nx-form-grid">
          <SelectField label="Dónde" value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value as typeof form.channel })}>
            {Object.entries(CHANNEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </SelectField>
          <div />
          <TextField label="Desde" optional type="date" value={form.startsOn} onChange={(e) => setForm({ ...form, startsOn: e.target.value })} />
          <TextField label="Hasta" optional type="date" value={form.endsOn} onChange={(e) => setForm({ ...form, endsOn: e.target.value })} error={f.endsOn} help="Incluye ese día." />
        </div>
        <Checkbox label="Activa" help="Si un producto tiene varias promociones, se aplica la de mayor descuento (no se suman)." checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
      </form>
    </Modal>
  );
}

const randomCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");

function CouponModal({ coupon, onClose, onSaved }: { coupon: Coupon | "new" | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const editing = coupon && coupon !== "new" ? coupon : null;
  const [form, setForm] = useState({ code: "", description: "", kind: "percent" as CouponInput["kind"], value: "", min: "", maxUses: "", channel: "all" as NonNullable<CouponInput["channel"]>, startsOn: "", endsOn: "", active: true });
  useEffect(() => {
    if (!coupon) return;
    setForm(
      coupon === "new"
        ? { code: randomCode(), description: "", kind: "percent", value: "", min: "", maxUses: "", channel: "all", startsOn: "", endsOn: "", active: true }
        : {
            code: coupon.code, description: coupon.description ?? "", kind: coupon.kind, value: coupon.kind === "percent" ? String(bpsToPercent(coupon.value)) : centsToInput(coupon.value),
            min: coupon.minSubtotalCents ? centsToInput(coupon.minSubtotalCents) : "", maxUses: coupon.maxUses === null ? "" : String(coupon.maxUses), channel: coupon.channel,
            startsOn: coupon.startsOn ?? "", endsOn: coupon.endsOn ?? "", active: coupon.active,
          },
    );
  }, [coupon]);
  const save = useSubmit(async () => {
    const fields: Record<string, string> = {};
    let value = 0;
    if (form.kind === "percent") {
      const pct = Number(form.value.replace(",", ".").replace("%", ""));
      if (!Number.isFinite(pct) || pct <= 0 || pct > 100) fields.value = "Entre 1 y 100"; else value = Math.round(pct * 100);
    } else {
      const v = parseMoney(form.value);
      if (v === null || v <= 0) fields.value = "Importe no válido"; else value = v;
    }
    const min = form.min.trim() ? parseMoney(form.min) : 0;
    if (min === null || min < 0) fields.minSubtotalCents = "Importe no válido";
    const maxUses = form.maxUses.trim() ? Number(form.maxUses) : null;
    if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1)) fields.maxUses = "Número entero mayor a 0";
    if (Object.keys(fields).length) throw new RequestError(422, "validation_error", "Revisa los campos marcados", fields);
    const body: CouponInput = { code: form.code, description: form.description || null, kind: form.kind, value, minSubtotalCents: min ?? 0, maxUses, channel: form.channel, startsOn: form.startsOn || null, endsOn: form.endsOn || null, active: form.active };
    if (editing) await put(`/promotions/coupons/${editing.id}`, body); else await post("/promotions/coupons", body);
    toast(editing ? "Cupón guardado" : `Cupón ${form.code} creado`);
    onSaved();
  });
  const f = save.fields;
  return (
    <Modal open={Boolean(coupon)} size="lg" title={editing ? `Cupón ${editing.code}` : "Nuevo cupón"} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.pending} onClick={() => void save.submit()}>Guardar</Button></>}>
      <form className="nx-stack" onSubmit={(e) => { e.preventDefault(); void save.submit(); }}>
        {save.message && <Alert tone="danger">{save.message}</Alert>}
        {editing && editing.usesCount > 0 && <Alert tone="info">Se ha usado {editing.usesCount} {editing.usesCount === 1 ? "vez" : "veces"}. Para retirarlo, desactívalo.</Alert>}
        <div className="nx-form-grid">
          <div className="nx-field">
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <div style={{ flex: 1 }}><TextField label="Código" className="nx-mono" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} error={f.code} /></div>
              <Button icon aria-label="Generar código" title="Generar código" onClick={() => setForm({ ...form, code: randomCode() })} style={{ marginBottom: f.code ? 20 : 0 }}><Shuffle className="nx-icon" aria-hidden="true" /></Button>
            </div>
          </div>
          <TextField label="Descripción" optional value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Bienvenida para clientes nuevos" />
        </div>
        <Segmented label="Tipo de descuento" value={form.kind} onChange={(kind) => setForm({ ...form, kind, value: "" })} options={[{ id: "percent", label: "Porcentaje" }, { id: "amount", label: "Importe fijo" }]} />
        <div className="nx-form-grid">
          <TextField label={form.kind === "percent" ? "Descuento (%)" : "Descuento ($)"} inputMode="decimal" className="nx-num" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} error={f.value} />
          <TextField label="Compra mínima" optional inputMode="decimal" className="nx-num" value={form.min} onChange={(e) => setForm({ ...form, min: e.target.value })} error={f.minSubtotalCents} help="Después de promociones." />
          <TextField label="Usos máximos" optional inputMode="numeric" className="nx-num" value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value })} error={f.maxUses} help="Vacío = ilimitado." />
          <SelectField label="Dónde" value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value as typeof form.channel })}>
            {Object.entries(CHANNEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </SelectField>
          <TextField label="Desde" optional type="date" value={form.startsOn} onChange={(e) => setForm({ ...form, startsOn: e.target.value })} />
          <TextField label="Hasta" optional type="date" value={form.endsOn} onChange={(e) => setForm({ ...form, endsOn: e.target.value })} error={f.endsOn} />
        </div>
        <Checkbox label="Activo" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
      </form>
    </Modal>
  );
}
