import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowRight, Trash2, Truck } from "lucide-react";
import { docNumber, formatQty, type LookupVariant, type TransferDetail, type UnitCode } from "@nexo/shared";
import { Alert, Button, Card, EmptyState, PageHeader, SelectField, TextField, useToast } from "@nexo/ui";
import { get, post, put, RequestError } from "../../lib/api";
import { useBusiness } from "../../lib/business";
import { useLoad, useSubmit } from "../../lib/hooks";
import { VariantPicker } from "../../components/VariantPicker";
import { BackLink, parseQty } from "../../components/docs";

interface Line { variantId: string; name: string; options: string[]; sku: string; unit: UnitCode; stock: number; qty: string }

export function TransferFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { locations } = useBusiness();
  const active = locations.filter((l) => l.active);
  const existing = useLoad(() => (id ? get<TransferDetail>(`/transfers/${id}`) : Promise.resolve(null)), [id]);
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [focusId, setFocusId] = useState<string | null>(null);

  useEffect(() => {
    if (fromId || !active.length || id) return;
    const store = active.find((l) => l.isDefault) ?? active[0]!;
    const other = active.find((l) => l.id !== store.id);
    // Typical first use: from the warehouse to the store.
    const warehouse = active.find((l) => l.type === "warehouse");
    setFromId(warehouse?.id ?? store.id);
    setToId(warehouse ? store.id : (other?.id ?? ""));
  }, [active, fromId, id]);
  useEffect(() => {
    const t = existing.data;
    if (!t) return;
    if (t.status !== "draft") { navigate(`/traspasos/${t.id}`, { replace: true }); return; }
    setFromId(t.fromLocationId);
    setToId(t.toLocationId);
    setNote(t.note ?? "");
    setLines(t.items.map((i) => ({ variantId: i.variantId, name: i.name, options: i.options, sku: i.sku, unit: i.unit, stock: i.originStock, qty: String(i.quantity) })));
  }, [existing.data, navigate]);
  useEffect(() => {
    if (!focusId) return;
    const el = document.getElementById(`qty-${focusId}`) as HTMLInputElement | null;
    el?.focus();
    el?.select();
    setFocusId(null);
  }, [focusId, lines]);

  const present = useMemo(() => new Set(lines.map((l) => l.variantId)), [lines]);
  const add = (v: LookupVariant) => {
    if (!present.has(v.variantId)) setLines((all) => [...all, { variantId: v.variantId, name: v.name, options: v.options, sku: v.sku, unit: v.unit, stock: v.stock, qty: "1" }]);
    setFocusId(v.variantId);
  };
  const changeOrigin = (value: string) => {
    if (lines.length && value !== fromId) setLines([]);
    setFromId(value);
    if (value === toId) setToId(active.find((l) => l.id !== value)?.id ?? "");
  };

  const save = useSubmit(async (andSend: boolean) => {
    const fields: Record<string, string> = {};
    const items = lines.map((l, i) => {
      const q = parseQty(l.qty);
      if (q === null || !Number.isFinite(q) || q <= 0) fields[`items.${i}.quantity`] = "Cantidad no válida";
      else if (andSend && q > l.stock) fields[`items.${i}.quantity`] = `Hay ${formatQty(l.stock, l.unit)}`;
      return { variantId: l.variantId, quantity: q ?? 0 };
    });
    if (!lines.length) throw new RequestError(422, "validation_error", "Agrega al menos un producto.");
    if (Object.keys(fields).length) throw new RequestError(422, "validation_error", "Revisa los campos marcados", fields);
    const body = { fromLocationId: fromId, toLocationId: toId, note: note || null, items };
    let t = id ? await put<TransferDetail>(`/transfers/${id}`, body) : await post<TransferDetail>("/transfers", body);
    if (andSend) {
      try {
        t = await post<TransferDetail>(`/transfers/${t.id}/send`);
      } catch (err) {
        // The draft is saved: continue from its page instead of creating it again.
        toast(`Borrador guardado, pero no se envió: ${(err as Error).message}`, "danger");
        navigate(`/traspasos/${t.id}`);
        return;
      }
    }
    toast(andSend ? `Traspaso ${docNumber("transfer", t.number)} enviado` : "Borrador guardado");
    navigate(`/traspasos/${t.id}`);
  });

  if (existing.error) return <Alert tone="danger">{existing.error.message}</Alert>;
  if (id && !existing.data) return <div className="nx-page-loading"><span className="nx-spinner" aria-label="Cargando" /></div>;
  const t = existing.data;
  const short = lines.filter((l) => { const q = parseQty(l.qty); return q !== null && Number.isFinite(q) && q > l.stock; });

  return (
    <>
      <BackLink to={t ? `/traspasos/${t.id}` : "/traspasos"}>{t ? docNumber("transfer", t.number) : "Traspasos"}</BackLink>
      <PageHeader title={t ? `Editar ${docNumber("transfer", t.number)}` : "Nuevo traspaso"} description="Las existencias salen del origen al enviar y entran al destino cuando se confirma la llegada." />
      {save.message && <Alert tone="danger">{save.message}</Alert>}
      <Card>
        <div className="nx-form-grid">
          <SelectField label="Sale de" value={fromId} onChange={(e) => changeOrigin(e.target.value)} error={save.fields.fromLocationId} help={lines.length ? "Cambiar el origen vacía la lista." : undefined}>
            {active.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </SelectField>
          <SelectField label="Llega a" value={toId} onChange={(e) => { setToId(e.target.value); save.clearFields("toLocationId"); }} error={save.fields.toLocationId}>
            <option value="">Elige el destino</option>
            {active.filter((l) => l.id !== fromId).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </SelectField>
          <TextField label="Nota" optional value={note} onChange={(e) => setNote(e.target.value)} placeholder="Quién lo lleva, para qué…" fieldClassName="nx-span-2" />
        </div>
      </Card>
      <div className="nx-table-wrap">
        <div className="nx-table-toolbar">
          <VariantPicker locationId={fromId} onPick={add} exclude={present} />
          {short.length > 0 && <span className="nx-help" style={{ color: "var(--warning)" }}>{short.length === 1 ? "1 producto no alcanza" : `${short.length} productos no alcanzan`} en el origen</span>}
        </div>
        {lines.length === 0 ? (
          <EmptyState icon={<Truck className="nx-icon" />} title="Agrega lo que vas a mover" text="Busca o escanea productos. Verás cuánto hay en el origen." />
        ) : (
          <div className="nx-table-scroll">
            <table className="nx-table nx-table--form">
              <thead><tr><th>Producto</th><th className="nx-col-num">Hay en origen</th><th className="nx-col-num">Enviar</th><th aria-label="Quitar" /></tr></thead>
              <tbody>
                {lines.map((l, i) => {
                  const err = save.fields[`items.${i}.quantity`];
                  return (
                    <tr key={l.variantId}>
                      <td>{l.name}{l.options.length > 0 && <span className="nx-muted"> · {l.options.join(" / ")}</span>}<div className="nx-mono nx-muted" style={{ fontSize: 12 }}>{l.sku}</div></td>
                      <td className="nx-col-num nx-muted">{formatQty(l.stock, l.unit)}</td>
                      <td className="nx-col-num">
                        <input id={`qty-${l.variantId}`} className="nx-input nx-num nx-line-input" inputMode="decimal" aria-label={`Enviar de ${l.name}`} aria-invalid={Boolean(err)} value={l.qty}
                          onChange={(e) => { setLines((all) => all.map((x) => (x.variantId === l.variantId ? { ...x, qty: e.target.value } : x))); save.clearFields(`items.${i}`); }} />
                        {err && <span className="nx-cell-error">{err}</span>}
                      </td>
                      <td style={{ textAlign: "right" }}><Button size="sm" variant="ghost" icon aria-label={`Quitar ${l.name}`} onClick={() => setLines((all) => all.filter((x) => x.variantId !== l.variantId))}><Trash2 className="nx-icon" aria-hidden="true" /></Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="nx-row" style={{ justifyContent: "flex-end" }}>
        <Button variant="ghost" onClick={() => navigate(t ? `/traspasos/${t.id}` : "/traspasos")}>Cancelar</Button>
        <Button loading={save.pending} onClick={() => void save.submit(false)}>Guardar borrador</Button>
        <Button variant="primary" loading={save.pending} onClick={() => void save.submit(true)}>Enviar ahora <ArrowRight className="nx-icon" aria-hidden="true" /></Button>
      </div>
    </>
  );
}
