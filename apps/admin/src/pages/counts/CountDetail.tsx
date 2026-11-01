import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useParams } from "react-router-dom";
import { ScanLine, XCircle } from "lucide-react";
import { docNumber, formatQty, unitInfo, type LookupVariant, type StockCountDetail, type StockCountItem } from "@nexo/shared";
import { Alert, Button, Card, Checkbox, Modal, PageHeader, Progress, Segmented, Stat, useToast } from "@nexo/ui";
import { get, post } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useBusiness } from "../../lib/business";
import { useLoad, useSubmit } from "../../lib/hooks";
import { VariantPicker } from "../../components/VariantPicker";
import { BackLink, CountStatusBadge, dateTimeFmt, parseQty } from "../../components/docs";

type Filter = "all" | "pending" | "counted" | "diff";
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function CountDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const { money } = useBusiness();
  const toast = useToast();
  const { data: count, error, setData } = useLoad(() => get<StockCountDetail>(`/counts/${id}`), [id]);
  /** What the user typed, per line, until it is saved. */
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<Filter>("all");
  const [scan, setScan] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);

  const open = count?.status === "in_progress";
  const write = can("counts:write");

  /** Saves absolute counted quantities. The local draft wins over server echoes while typing. */
  const saveEntries = async (entries: Array<{ itemId: string; countedQuantity: number | null }>) => {
    setSaving((s) => new Set([...s, ...entries.map((e) => e.itemId)]));
    try {
      const updated = await post<StockCountDetail>(`/counts/${id}/entries`, { entries });
      setData(updated);
      setDraft((d) => {
        const next = { ...d };
        for (const e of entries) {
          const server = updated.items.find((i) => i.id === e.itemId)?.countedQuantity ?? null;
          if (parseQty(next[e.itemId] ?? "") === server) delete next[e.itemId];
        }
        return next;
      });
      setFailed((f) => { const next = { ...f }; entries.forEach((e) => delete next[e.itemId]); return next; });
    } catch (err) {
      setFailed((f) => ({ ...f, ...Object.fromEntries(entries.map((e) => [e.itemId, (err as Error).message])) }));
    } finally {
      setSaving((s) => { const next = new Set(s); entries.forEach((e) => next.delete(e.itemId)); return next; });
    }
  };

  const commit = (item: StockCountItem) => {
    const text = draft[item.id];
    if (text === undefined) return;
    const q = parseQty(text);
    if (q !== null && (!Number.isFinite(q) || q < 0)) { setFailed((f) => ({ ...f, [item.id]: "Cantidad no válida" })); return; }
    if (q !== null && !unitInfo(item.unit).decimals && !Number.isInteger(q)) { setFailed((f) => ({ ...f, [item.id]: "Usa números enteros" })); return; }
    if (q === item.countedQuantity) { setDraft((d) => { const n = { ...d }; delete n[item.id]; return n; }); return; }
    void saveEntries([{ itemId: item.id, countedQuantity: q }]);
  };

  const valueOf = (item: StockCountItem) => {
    const text = draft[item.id];
    if (text !== undefined) { const q = parseQty(text); return q !== null && Number.isFinite(q) ? q : null; }
    return item.countedQuantity;
  };

  const focusLine = (itemId: string) => {
    setFlash(itemId);
    setTimeout(() => setFlash((f) => (f === itemId ? null : f)), 1200);
    requestAnimationFrame(() => document.getElementById(`row-${itemId}`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
  };

  /** Scanner: an exact barcode or SKU adds one unit to its line (or focuses it for kg, l…). */
  const onScan = async (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" || !count) return;
    e.preventDefault();
    const code = scan.trim();
    if (!code) return;
    const upper = code.toUpperCase();
    let item = count.items.find((i) => i.barcode === code || i.sku.toUpperCase() === upper);
    if (!item) {
      const found = await get<LookupVariant[]>(`/inventory/lookup?locationId=${count.locationId}&q=${encodeURIComponent(code)}&limit=5`).catch(() => []);
      const exact = found.find((v) => v.exact);
      if (!exact) { toast(`Ningún producto tiene el código ${code}`, "danger"); setScan(""); return; }
      const updated = await post<StockCountDetail>(`/counts/${id}/items`, { variantIds: [exact.variantId] }).catch((err: Error) => { toast(err.message, "danger"); return null; });
      if (!updated) return;
      setData(updated);
      item = updated.items.find((i) => i.variantId === exact.variantId);
      if (!item) return;
      toast(`${exact.name} se agregó al conteo`);
    }
    setScan("");
    setFilter((f) => (f === "all" ? f : "all"));
    focusLine(item.id);
    if (unitInfo(item.unit).decimals) {
      requestAnimationFrame(() => (document.getElementById(`count-${item!.id}`) as HTMLInputElement | null)?.focus());
      return;
    }
    const next = (valueOf(item) ?? 0) + 1;
    setDraft((d) => ({ ...d, [item!.id]: String(next) }));
    void saveEntries([{ itemId: item.id, countedQuantity: next }]);
  };

  const addProduct = async (v: LookupVariant) => {
    const existing = count?.items.find((i) => i.variantId === v.variantId);
    if (existing) { focusLine(existing.id); return; }
    try {
      const updated = await post<StockCountDetail>(`/counts/${id}/items`, { variantIds: [v.variantId] });
      setData(updated);
      const line = updated.items.find((i) => i.variantId === v.variantId);
      if (line) { focusLine(line.id); requestAnimationFrame(() => (document.getElementById(`count-${line.id}`) as HTMLInputElement | null)?.focus()); }
    } catch (err) {
      toast((err as Error).message, "danger");
    }
  };

  const cancel = useSubmit(async () => {
    setData(await post<StockCountDetail>(`/counts/${id}/cancel`));
    setCancelling(false);
    toast("Conteo cancelado");
  });

  const rows = useMemo(() => {
    if (!count) return [];
    return count.items.filter((i) => {
      const v = valueOf(i);
      if (filter === "pending") return v === null;
      if (filter === "counted") return v !== null;
      if (filter === "diff") return count.status === "completed" ? (i.finalDelta ?? 0) !== 0 : v !== null && i.expectedQuantity !== null && round3(v - i.expectedQuantity) !== 0;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, filter, draft]);

  if (error) return <Alert tone="danger">{error.status === 404 ? "Este conteo no existe." : error.message}</Alert>;
  if (!count) return <div className="nx-page-loading"><span className="nx-spinner" aria-label="Cargando" /></div>;

  const counted = count.items.filter((i) => valueOf(i) !== null).length;
  const diffs = count.items.filter((i) => { const v = valueOf(i); return v !== null && i.expectedQuantity !== null && round3(v - i.expectedQuantity) !== 0; });
  const preview = diffs.reduce((a, i) => a + Math.round((valueOf(i)! - i.expectedQuantity!) * (i.unitCostCents ?? 0)), 0);
  const scope = count.scope === "category" ? `Categoría ${count.categoryName ?? ""}` : count.scope === "all" ? "Todo el inventario" : "Selección manual";
  const s = count.summary;

  return (
    <>
      <BackLink to="/conteos">Conteos físicos</BackLink>
      <PageHeader
        title={`Conteo ${docNumber("count", count.number)}`}
        description={<span className="nx-row" style={{ gap: 8 }}><CountStatusBadge status={count.status} /><span>{count.locationName} · {scope} · {dateTimeFmt.format(new Date(count.createdAt))}</span></span>}
        actions={
          open && write && (
            <>
              <Button variant="danger-ghost" onClick={() => setCancelling(true)}><XCircle className="nx-icon" aria-hidden="true" />Cancelar</Button>
              <Button variant="primary" onClick={() => setCompleting(true)} disabled={saving.size > 0}>Aplicar conteo</Button>
            </>
          )
        }
      />
      {count.note && <Alert tone="info">{count.note}</Alert>}
      {open && !count.showExpected && <Alert tone="info">Escanea o escribe lo que hay en el anaquel. Un administrador revisará las diferencias y aplicará el conteo.</Alert>}
      {count.status === "cancelled" && <Alert tone="danger">Este conteo se canceló. No cambió ninguna existencia.</Alert>}
      {count.status === "completed" && s && (
        <Alert tone={s.adjusted ? "warning" : "success"} title={s.adjusted ? (s.adjusted === 1 ? "Se ajustó 1 producto" : `Se ajustaron ${s.adjusted} productos`) : "Todo coincidió"}>
          Aplicado por {count.completedByName} · {count.completedAt && dateTimeFmt.format(new Date(count.completedAt))}
          {s.adjusted > 0 && <div>Los ajustes aparecen en Movimientos con el folio {docNumber("count", count.number)}.</div>}
        </Alert>
      )}

      <div className="nx-stat-grid">
        <Stat label="Contados" value={`${count.status === "completed" && s ? s.counted : counted} de ${count.lines}`} meta={<span style={{ display: "block", width: "100%", marginTop: 6 }}><Progress value={count.lines ? counted / count.lines : 0} label="Avance del conteo" /></span>} />
        {count.showExpected && (count.status === "completed" && s ? (
          <>
            <Stat label="Sobrantes" value={formatNum(s.unitsOver)} meta="unidades agregadas" />
            <Stat label="Faltantes" value={formatNum(s.unitsShort)} meta="unidades descontadas" />
            {s.valueDeltaCents !== null && <Stat label="Valor del ajuste" value={money(s.valueDeltaCents)} meta="A costo promedio" />}
          </>
        ) : (
          <>
            <Stat label="Con diferencia" value={diffs.length} meta={<button type="button" className="nx-link" style={{ border: 0, background: "none", padding: 0, cursor: "pointer", font: "inherit" }} onClick={() => setFilter("diff")}>Ver solo esos</button>} />
            {diffs.some((i) => i.unitCostCents !== null) && <Stat label="Valor de la diferencia" value={money(preview)} meta="Estimado a costo promedio" />}
          </>
        ))}
      </div>

      <div className="nx-table-wrap">
        <div className="nx-table-toolbar">
          {open ? (
            <div className="nx-row" style={{ gap: 12, flex: 1, flexWrap: "wrap", alignItems: "center" }}>
              <div className="nx-input-group" style={{ flex: "0 1 260px", minWidth: 200 }}>
                <ScanLine className="nx-icon" aria-hidden="true" />
                <input ref={scanRef} className="nx-input" style={{ height: "var(--control-md)" }} aria-label="Escanear código" placeholder="Escanea un código y Enter" value={scan} onChange={(e) => setScan(e.target.value)} onKeyDown={(e) => void onScan(e)} autoFocus />
              </div>
              <div style={{ flex: "1 1 240px", maxWidth: 340 }}>
                <VariantPicker locationId={count.locationId} onPick={(v) => void addProduct(v)} placeholder="Buscar o agregar producto" label="Buscar o agregar producto" />
              </div>
            </div>
          ) : <span />}
          <Segmented
            label="Mostrar"
            value={filter}
            onChange={setFilter}
            options={[
              { id: "all", label: "Todos" },
              { id: "pending", label: "Por contar" },
              { id: "counted", label: "Contados" },
              ...(count.showExpected ? [{ id: "diff" as const, label: "Con diferencia" }] : []),
            ]}
          />
        </div>
        {rows.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center" }} className="nx-muted">
            {count.items.length === 0 ? "Escanea o busca productos para agregarlos al conteo." : "Ningún producto en esta vista."}
          </div>
        ) : (
          <div className="nx-table-scroll">
            <table className="nx-table nx-table--form">
              <thead>
                <tr>
                  <th>Producto</th>
                  {count.showExpected && <th className="nx-col-num">{count.status === "completed" ? "Sistema" : "Sistema"}</th>}
                  <th className="nx-col-num">Contado</th>
                  {count.showExpected && <th className="nx-col-num">{count.status === "completed" ? "Ajuste" : "Diferencia"}</th>}
                  <th>Contó</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => {
                  const v = valueOf(i);
                  const diff = count.status === "completed" ? i.finalDelta : v !== null && i.expectedQuantity !== null ? round3(v - i.expectedQuantity) : null;
                  const err = failed[i.id];
                  return (
                    <tr key={i.id} id={`row-${i.id}`} style={flash === i.id ? { background: "var(--accent-soft)", transition: "background .3s" } : { transition: "background .6s" }}>
                      <td>
                        {i.name}{i.options.length > 0 && <span className="nx-muted"> · {i.options.join(" / ")}</span>}
                        <div className="nx-mono nx-muted" style={{ fontSize: 12 }}>{i.sku}{i.barcode && ` · ${i.barcode}`}</div>
                      </td>
                      {count.showExpected && <td className="nx-col-num nx-muted">{i.expectedQuantity === null ? "—" : formatQty(i.expectedQuantity, i.unit)}</td>}
                      <td className="nx-col-num">
                        {open ? (
                          <>
                            <input
                              id={`count-${i.id}`}
                              className="nx-input nx-num nx-line-input"
                              inputMode="decimal"
                              placeholder="—"
                              aria-label={`Contado de ${i.name}`}
                              aria-invalid={Boolean(err)}
                              value={draft[i.id] ?? (i.countedQuantity === null ? "" : String(i.countedQuantity))}
                              onChange={(e) => { setDraft((d) => ({ ...d, [i.id]: e.target.value })); setFailed((f) => { const n = { ...f }; delete n[i.id]; return n; }); }}
                              onBlur={() => commit(i)}
                              onKeyDown={(e) => {
                                if (e.key !== "Enter") return;
                                e.preventDefault();
                                commit(i);
                                // Move to the next line, like a spreadsheet.
                                const idx = rows.findIndex((r) => r.id === i.id);
                                const nextRow = rows[idx + 1];
                                if (nextRow) (document.getElementById(`count-${nextRow.id}`) as HTMLInputElement | null)?.focus();
                                else scanRef.current?.focus();
                              }}
                            />
                            {err && <span className="nx-cell-error">{err}</span>}
                          </>
                        ) : (
                          v === null ? <span className="nx-muted">—</span> : formatQty(v, i.unit)
                        )}
                      </td>
                      {count.showExpected && (
                        <td className={`nx-col-num ${diff ? (diff > 0 ? "nx-diff-up" : "nx-diff-down") : "nx-muted"}`}>
                          {diff === null ? "—" : diff === 0 ? "0" : `${diff > 0 ? "+" : "−"}${formatQty(Math.abs(diff), i.unit)}`}
                        </td>
                      )}
                      <td className="nx-muted" style={{ fontSize: 12 }}>{saving.has(i.id) ? "Guardando…" : i.countedByName ?? ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <CompleteModal open={completing} count={count} counted={counted} diffs={diffs.length} preview={preview} onClose={() => setCompleting(false)} onDone={(c) => { setData(c); setDraft({}); setCompleting(false); toast("Conteo aplicado al inventario"); }} />
      <Modal
        open={cancelling}
        title={`¿Cancelar ${docNumber("count", count.number)}?`}
        onClose={() => setCancelling(false)}
        footer={<><Button variant="ghost" onClick={() => setCancelling(false)}>Volver</Button><Button variant="danger" loading={cancel.pending} onClick={() => void cancel.submit()}>Cancelar conteo</Button></>}
      >
        <div className="nx-stack">
          {cancel.message && <Alert tone="danger">{cancel.message}</Alert>}
          <p style={{ margin: 0 }}>Lo capturado se descarta y las existencias no cambian.</p>
        </div>
      </Modal>
    </>
  );
}

const formatNum = (n: number) => n.toLocaleString("es-MX", { maximumFractionDigits: 3 });

function CompleteModal({ open, count, counted, diffs, preview, onClose, onDone }: {
  open: boolean; count: StockCountDetail; counted: number; diffs: number; preview: number; onClose: () => void; onDone: (c: StockCountDetail) => void;
}) {
  const { money } = useBusiness();
  const [zero, setZero] = useState(false);
  const uncounted = count.lines - counted;
  const save = useSubmit(async () => onDone(await post<StockCountDetail>(`/counts/${count.id}/complete`, { zeroUncounted: zero })));
  return (
    <Modal
      open={open}
      title="Aplicar conteo"
      onClose={onClose}
      dismissable={!save.pending}
      footer={<><Button variant="ghost" onClick={onClose}>Seguir contando</Button><Button variant="primary" loading={save.pending} onClick={() => void save.submit()}>Aplicar al inventario</Button></>}
    >
      <div className="nx-stack">
        {save.message && <Alert tone="danger">{save.message}</Alert>}
        <Card flat>
          <dl className="nx-kv">
            <div><dt>Productos contados</dt><dd>{counted} de {count.lines}</dd></div>
            <div><dt>Con diferencia</dt><dd>{diffs}</dd></div>
            {count.items.some((i) => i.unitCostCents !== null) && <div><dt>Valor estimado del ajuste</dt><dd className={preview < 0 ? "nx-diff-down" : preview > 0 ? "nx-diff-up" : ""}>{money(preview)}</dd></div>}
          </dl>
        </Card>
        <p style={{ margin: 0 }}>
          Las existencias de <strong>{count.locationName}</strong> se corrigen según lo contado. Las ventas y recepciones hechas después de contar cada producto se respetan.
        </p>
        {uncounted > 0 && (
          <Checkbox
            label={`Poner en cero los ${uncounted} productos sin contar`}
            help="Márcalo solo si revisaste todo y lo que no contaste realmente no está. Si no, se quedan como están."
            checked={zero}
            onChange={(e) => setZero(e.target.checked)}
          />
        )}
        <p className="nx-help" style={{ margin: 0 }}>No se puede deshacer; cada ajuste queda en Movimientos con el folio {docNumber("count", count.number)}.</p>
      </div>
    </Modal>
  );
}
