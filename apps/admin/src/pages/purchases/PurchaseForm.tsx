import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Lightbulb, Plus, Trash2 } from "lucide-react";
import {
  bpsToPercent,
  computePurchase,
  docNumber,
  formatQty,
  parseMoney,
  toMilli,
  type LookupVariant,
  type PurchaseOrderDetail,
  type PurchaseSuggestion,
  type Supplier,
  type UnitCode,
} from "@nexo/shared";
import { Alert, Button, Card, EmptyState, PageHeader, SelectField, TextAreaField, TextField, useToast } from "@nexo/ui";
import { get, post, put, RequestError } from "../../lib/api";
import { centsToInput, useBusiness } from "../../lib/business";
import { useLoad, useSubmit } from "../../lib/hooks";
import { VariantPicker } from "../../components/VariantPicker";
import { BackLink, parseQty } from "../../components/docs";
import { SupplierModal } from "../Suppliers";

interface Line {
  variantId: string;
  name: string;
  options: string[];
  sku: string;
  unit: UnitCode;
  stock: number;
  currentCostCents: number | null;
  qty: string;
  cost: string;
  taxRateBps: number;
}

const fromLookup = (v: LookupVariant, qty = ""): Line => ({
  variantId: v.variantId, name: v.name, options: v.options, sku: v.sku, unit: v.unit, stock: v.stock,
  currentCostCents: v.costCents, qty, cost: centsToInput(v.costCents ?? 0), taxRateBps: v.taxRateBps,
});

export function PurchaseFormPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { locations, taxes, money } = useBusiness();
  const suppliers = useLoad(() => get<Supplier[]>("/suppliers?status=active"));
  const existing = useLoad(() => (id ? get<PurchaseOrderDetail>(`/purchases/${id}`) : Promise.resolve(null)), [id]);
  const activeLocations = locations.filter((l) => l.active);

  const [supplierId, setSupplierId] = useState(params.get("proveedor") ?? "");
  const [locationId, setLocationId] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [newSupplier, setNewSupplier] = useState(false);
  const [suggesting, setSuggesting] = useState(false);

  useEffect(() => {
    if (!locationId && activeLocations.length) setLocationId((activeLocations.find((l) => l.isDefault) ?? activeLocations[0])!.id);
  }, [activeLocations, locationId]);
  useEffect(() => {
    const o = existing.data;
    if (!o) return;
    if (o.status !== "draft" && o.status !== "ordered") { navigate(`/compras/${o.id}`, { replace: true }); return; }
    setSupplierId(o.supplierId);
    setLocationId(o.locationId);
    setExpectedDate(o.expectedDate ?? "");
    setNote(o.note ?? "");
    setLines(o.items.map((i) => ({
      variantId: i.variantId, name: i.name, options: i.options, sku: i.sku, unit: i.unit, stock: i.stock, currentCostCents: i.currentCostCents,
      qty: String(i.quantity), cost: centsToInput(i.unitCostCents), taxRateBps: i.taxRateBps,
    })));
  }, [existing.data, navigate]);
  useEffect(() => {
    if (!focusId) return;
    const el = document.getElementById(`qty-${focusId}`) as HTMLInputElement | null;
    el?.focus();
    el?.select();
    setFocusId(null);
  }, [focusId, lines]);

  const parsed = lines.map((l) => ({ qty: parseQty(l.qty), cost: parseMoney(l.cost) }));
  const totals = useMemo(
    () => computePurchase(lines.map((l, i) => ({ quantityMilli: toMilli(Number.isFinite(parsed[i]!.qty) ? (parsed[i]!.qty ?? 0) : 0), unitCostCents: parsed[i]!.cost ?? 0, taxRateBps: l.taxRateBps }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines],
  );
  const taxOptions = useMemo(() => {
    const rates = new Map<number, string>([[0, "Sin impuesto"]]);
    taxes.filter((t) => t.active).forEach((t) => rates.set(t.rateBps, `${t.name}`));
    lines.forEach((l) => { if (!rates.has(l.taxRateBps)) rates.set(l.taxRateBps, `${bpsToPercent(l.taxRateBps)} %`); });
    return [...rates.entries()].sort((a, b) => a[0] - b[0]);
  }, [taxes, lines]);
  const present = useMemo(() => new Set(lines.map((l) => l.variantId)), [lines]);

  const update = (variantId: string, patch: Partial<Line>) => {
    setLines((all) => all.map((l) => (l.variantId === variantId ? { ...l, ...patch } : l)));
    const i = lines.findIndex((l) => l.variantId === variantId);
    save.clearFields(`items.${i}`);
  };
  const add = (v: LookupVariant) => {
    if (present.has(v.variantId)) { setFocusId(v.variantId); return; }
    setLines((all) => [...all, fromLookup(v, "1")]);
    setFocusId(v.variantId);
  };
  const addSuggestions = async () => {
    setSuggesting(true);
    try {
      const list = await get<PurchaseSuggestion[]>(`/purchases/suggestions?locationId=${locationId}`);
      const fresh = list.filter((s) => !present.has(s.variantId));
      setLines((all) => [...all, ...fresh.map((s) => fromLookup(s, String(s.suggestedQuantity)))]);
      toast(fresh.length ? `${fresh.length} ${fresh.length === 1 ? "producto agregado" : "productos agregados"} con stock bajo` : "No hay más productos con stock bajo en esta ubicación");
    } finally {
      setSuggesting(false);
    }
  };

  const build = () => {
    const fields: Record<string, string> = {};
    if (!supplierId) fields.supplierId = "Elige un proveedor";
    const items = lines.map((l, i) => {
      const { qty, cost } = parsed[i]!;
      if (qty === null || !Number.isFinite(qty) || qty <= 0) fields[`items.${i}.quantity`] = "Cantidad no válida";
      if (cost === null || cost < 0) fields[`items.${i}.unitCostCents`] = "Costo no válido";
      return { variantId: l.variantId, quantity: qty ?? 0, unitCostCents: cost ?? 0, taxRateBps: l.taxRateBps };
    });
    if (!lines.length) throw new RequestError(422, "validation_error", "Agrega al menos un producto a la orden.");
    if (Object.keys(fields).length) throw new RequestError(422, "validation_error", "Revisa los campos marcados", fields);
    return { supplierId, locationId, expectedDate: expectedDate || null, note: note || null, items };
  };
  const save = useSubmit(async (andOrder: boolean) => {
    const body = build();
    let order = id ? await put<PurchaseOrderDetail>(`/purchases/${id}`, body) : await post<PurchaseOrderDetail>("/purchases", body);
    if (andOrder) {
      try {
        order = await post<PurchaseOrderDetail>(`/purchases/${order.id}/order`);
      } catch (err) {
        toast(`Borrador guardado, pero no se marcó como pedida: ${(err as Error).message}`, "danger");
        navigate(`/compras/${order.id}`);
        return;
      }
    }
    toast(andOrder ? `Orden ${docNumber("purchase", order.number)} marcada como pedida` : id ? "Cambios guardados" : `Borrador ${docNumber("purchase", order.number)} guardado`);
    navigate(`/compras/${order.id}`, { state: andOrder ? { offerEmail: true } : undefined });
  });

  if (existing.error) return <Alert tone="danger">{existing.error.message}</Alert>;
  if (id && !existing.data) return <div className="nx-page-loading"><span className="nx-spinner" aria-label="Cargando" /></div>;
  const o = existing.data;
  const title = o ? `Editar ${docNumber("purchase", o.number)}` : "Nueva orden de compra";

  return (
    <>
      <BackLink to={o ? `/compras/${o.id}` : "/compras"}>{o ? docNumber("purchase", o.number) : "Compras"}</BackLink>
      <PageHeader title={title} description={o?.status === "ordered" ? "Esta orden ya se pidió: si cambias algo, avísale al proveedor." : "Elige el proveedor, la ubicación que recibe y los productos."} />
      {save.message && <Alert tone="danger">{save.message}</Alert>}
      {suppliers.data && suppliers.data.length === 0 && !supplierId && (
        <Alert tone="info" title="Primero registra un proveedor">Puedes crearlo aquí mismo con el botón junto a la lista de proveedores.</Alert>
      )}
      <Card>
        <div className="nx-form-grid">
          <div className="nx-field">
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <div style={{ flex: 1 }}>
                <SelectField label="Proveedor" value={supplierId} onChange={(e) => { setSupplierId(e.target.value); save.clearFields("supplierId"); }} error={save.fields.supplierId}>
                  <option value="">Elige un proveedor</option>
                  {suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  {o && !suppliers.data?.some((s) => s.id === o.supplierId) && <option value={o.supplierId}>{o.supplier.name}</option>}
                </SelectField>
              </div>
              <Button icon aria-label="Nuevo proveedor" title="Nuevo proveedor" onClick={() => setNewSupplier(true)} style={{ marginBottom: save.fields.supplierId ? 20 : 0 }}><Plus className="nx-icon" aria-hidden="true" /></Button>
            </div>
          </div>
          <SelectField label="Recibe en" value={locationId} onChange={(e) => setLocationId(e.target.value)} error={save.fields.locationId}>
            {activeLocations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </SelectField>
          <TextField label="Fecha esperada" optional type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} error={save.fields.expectedDate} />
          <TextAreaField label="Notas" optional rows={1} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Condiciones, horario de entrega…" />
        </div>
      </Card>

      <div className="nx-table-wrap">
        <div className="nx-table-toolbar">
          <VariantPicker locationId={locationId} onPick={add} exclude={present} showCost />
          <Button onClick={() => void addSuggestions()} loading={suggesting} disabled={!locationId}><Lightbulb className="nx-icon" aria-hidden="true" />Agregar productos con stock bajo</Button>
        </div>
        {lines.length === 0 ? (
          <EmptyState icon={<Lightbulb className="nx-icon" />} title="Agrega productos a la orden" text="Búscalos o escanéalos arriba, o agrega de una vez los que están en su mínimo o por debajo." />
        ) : (
          <div className="nx-table-scroll">
            <table className="nx-table nx-table--form">
              <thead>
                <tr><th>Producto</th><th className="nx-col-num">Existencia</th><th className="nx-col-num">Cantidad</th><th className="nx-col-num">Costo unitario</th><th>Impuesto</th><th className="nx-col-num">Importe</th><th aria-label="Quitar" /></tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const cost = parsed[i]!.cost;
                  const changed = cost !== null && l.currentCostCents !== null && l.currentCostCents > 0 && cost !== l.currentCostCents;
                  return (
                    <tr key={l.variantId}>
                      <td>
                        {l.name}{l.options.length > 0 && <span className="nx-muted"> · {l.options.join(" / ")}</span>}
                        <div className="nx-mono nx-muted" style={{ fontSize: 12 }}>{l.sku}</div>
                      </td>
                      <td className="nx-col-num nx-muted">{formatQty(l.stock, l.unit)}</td>
                      <td className="nx-col-num">
                        <input id={`qty-${l.variantId}`} className="nx-input nx-num nx-line-input" inputMode="decimal" aria-label={`Cantidad de ${l.name}`} aria-invalid={Boolean(save.fields[`items.${i}.quantity`])} value={l.qty} onChange={(e) => update(l.variantId, { qty: e.target.value })} />
                        {save.fields[`items.${i}.quantity`] && <span className="nx-cell-error">{save.fields[`items.${i}.quantity`]}</span>}
                      </td>
                      <td className="nx-col-num">
                        <input className="nx-input nx-num nx-line-input" inputMode="decimal" aria-label={`Costo de ${l.name}`} aria-invalid={Boolean(save.fields[`items.${i}.unitCostCents`])} value={l.cost} onChange={(e) => update(l.variantId, { cost: e.target.value })} />
                        {changed && <span className="nx-help" style={{ display: "block" }}>Promedio {money(l.currentCostCents)}</span>}
                      </td>
                      <td>
                        <select className="nx-select" style={{ height: "var(--control-sm)", fontSize: 13, minWidth: 110 }} aria-label={`Impuesto de ${l.name}`} value={l.taxRateBps} onChange={(e) => update(l.variantId, { taxRateBps: Number(e.target.value) })}>
                          {taxOptions.map(([bps, label]) => <option key={bps} value={bps}>{label}</option>)}
                        </select>
                      </td>
                      <td className="nx-col-num" style={{ fontWeight: 500 }}>{money(totals.lines[i]!.netCents)}</td>
                      <td style={{ textAlign: "right" }}>
                        <Button size="sm" variant="ghost" icon aria-label={`Quitar ${l.name}`} onClick={() => setLines((all) => all.filter((x) => x.variantId !== l.variantId))}><Trash2 className="nx-icon" aria-hidden="true" /></Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {lines.length > 0 && (
          <div style={{ padding: "16px 16px 20px", borderTop: "1px solid var(--border)", display: "flex" }}>
            <dl className="nx-doc-totals" style={{ margin: "0 0 0 auto" }}>
              <div><dt>Subtotal</dt><dd>{money(totals.subtotalCents)}</dd></div>
              <div><dt>Impuestos</dt><dd>{money(totals.taxCents)}</dd></div>
              <div className="nx-doc-totals__grand"><dt>Total</dt><dd>{money(totals.totalCents)}</dd></div>
            </dl>
          </div>
        )}
      </div>
      <div className="nx-row" style={{ justifyContent: "flex-end" }}>
        <Button variant="ghost" onClick={() => navigate(o ? `/compras/${o.id}` : "/compras")}>Cancelar</Button>
        {o?.status === "ordered" ? (
          <Button variant="primary" loading={save.pending} onClick={() => void save.submit(false)}>Guardar cambios</Button>
        ) : (
          <>
            <Button loading={save.pending} onClick={() => void save.submit(false)}>Guardar borrador</Button>
            <Button variant="primary" loading={save.pending} onClick={() => void save.submit(true)}>Guardar y marcar como pedida</Button>
          </>
        )}
      </div>
      <SupplierModal supplier={newSupplier ? "new" : null} onClose={() => setNewSupplier(false)} onSaved={(s) => { setNewSupplier(false); void suppliers.reload().then(() => setSupplierId(s.id)); save.clearFields("supplierId"); }} />
    </>
  );
}
