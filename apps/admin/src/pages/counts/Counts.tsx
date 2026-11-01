import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ClipboardCheck } from "lucide-react";
import { docNumber, type CreateCountInput, type Named, type Paginated, type StockCountDetail, type StockCountListItem } from "@nexo/shared";
import { Alert, Button, EmptyState, Modal, PageHeader, Pagination, Progress, Segmented, SelectField, TextField, useToast } from "@nexo/ui";
import { get, post } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useBusiness } from "../../lib/business";
import { useLoad, useSubmit } from "../../lib/hooks";
import { CountStatusBadge, dateTimeFmt } from "../../components/docs";

type Filter = "in_progress" | "completed" | "all";
const SCOPE_LABEL = { all: "Todo el inventario", category: "Categoría", manual: "Selección manual" } as const;

export function CountsPage() {
  const { can } = useAuth();
  const { money } = useBusiness();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const status = (params.get("estado") ?? "in_progress") as Filter;
  const page = Number(params.get("pagina") ?? 1) || 1;
  const search = new URLSearchParams({ status, page: String(page) });
  const { data, error, loading } = useLoad(() => get<Paginated<StockCountListItem>>(`/counts?${search}`), [search.toString()]);
  const write = can("counts:write");

  return (
    <>
      <PageHeader
        title="Conteos físicos"
        description="Cuenta lo que hay en el anaquel y corrige las existencias del sistema."
        actions={write && <Button variant="primary" onClick={() => setCreating(true)}>Nuevo conteo</Button>}
      />
      {error && <Alert tone="danger">{error.message}</Alert>}
      <div className="nx-table-wrap">
        <div className="nx-table-toolbar">
          <Segmented
            label="Estado"
            value={status}
            onChange={(v) => setParams(v === "in_progress" ? {} : { estado: v }, { replace: true })}
            options={[{ id: "in_progress", label: "En proceso" }, { id: "completed", label: "Aplicados" }, { id: "all", label: "Todos" }]}
          />
        </div>
        {data && data.items.length === 0 ? (
          <EmptyState
            icon={<ClipboardCheck className="nx-icon" />}
            title={status === "in_progress" ? "No hay conteos en proceso" : "Ningún conteo coincide"}
            text={status === "in_progress" ? "Empieza por una categoría o un pasillo: es más rápido y puedes seguir vendiendo mientras cuentas." : undefined}
            actions={write && status === "in_progress" && <Button variant="primary" onClick={() => setCreating(true)}>Nuevo conteo</Button>}
          />
        ) : (
          <div className="nx-table-scroll" aria-busy={loading}>
            <table className="nx-table">
              <thead><tr><th>Folio</th><th>Ubicación</th><th>Alcance</th><th>Estado</th><th>Avance</th>{write && <th className="nx-col-num">Diferencia</th>}<th>Inicio</th></tr></thead>
              <tbody>
                {data?.items.map((c) => (
                  <tr key={c.id} className="nx-clickable" onClick={() => navigate(`/conteos/${c.id}`)}>
                    <td className="nx-mono">{docNumber("count", c.number)}</td>
                    <td>{c.locationName}</td>
                    <td className="nx-muted">{c.scope === "category" ? c.categoryName ?? SCOPE_LABEL.category : SCOPE_LABEL[c.scope]}</td>
                    <td><CountStatusBadge status={c.status} /></td>
                    <td>
                      <div className="nx-progress-cell">
                        <Progress value={c.lines ? c.counted / c.lines : 0} label={`Avance de ${docNumber("count", c.number)}`} />
                        <span className="nx-num nx-muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{c.counted} / {c.lines}</span>
                      </div>
                    </td>
                    {write && (
                      <td className="nx-col-num">
                        {c.summary ? (
                          c.summary.adjusted === 0 ? <span className="nx-muted">Sin diferencias</span> : (
                            <span className={c.summary.valueDeltaCents !== null && c.summary.valueDeltaCents < 0 ? "nx-diff-down" : "nx-diff-up"}>
                              {c.summary.adjusted} {c.summary.adjusted === 1 ? "ajuste" : "ajustes"}{c.summary.valueDeltaCents !== null && ` · ${money(c.summary.valueDeltaCents)}`}
                            </span>
                          )
                        ) : <span className="nx-muted">—</span>}
                      </td>
                    )}
                    <td className="nx-muted nx-num" style={{ whiteSpace: "nowrap" }}>{dateTimeFmt.format(new Date(c.createdAt))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > data.pageSize && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} noun="conteos" onPage={(p) => setParams({ ...(status !== "in_progress" && { estado: status }), pagina: String(p) })} />}
      </div>
      <NewCountModal open={creating} onClose={() => setCreating(false)} onCreated={(c) => navigate(`/conteos/${c.id}`)} />
    </>
  );
}

function NewCountModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (c: StockCountDetail) => void }) {
  const { locations } = useBusiness();
  const toast = useToast();
  const active = locations.filter((l) => l.active);
  const categories = useLoad(() => (open ? get<Named[]>("/categories") : Promise.resolve([] as Named[])), [open]);
  const [form, setForm] = useState<CreateCountInput>({ locationId: "", scope: "category", categoryId: null, note: null });
  useEffect(() => {
    if (open) setForm({ locationId: (active.find((l) => l.isDefault) ?? active[0])?.id ?? "", scope: "category", categoryId: null, note: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const save = useSubmit(async () => {
    const created = await post<StockCountDetail>("/counts", form);
    toast(`Conteo ${docNumber("count", created.number)} iniciado con ${created.lines} productos`);
    onCreated(created);
  });
  return (
    <Modal open={open} title="Nuevo conteo físico" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.pending} onClick={() => void save.submit()}>Empezar conteo</Button></>}>
      <form className="nx-stack" onSubmit={(e) => { e.preventDefault(); void save.submit(); }}>
        {save.message && <Alert tone="danger">{save.message}</Alert>}
        <SelectField label="Ubicación" value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })} error={save.fields.locationId}>
          {active.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </SelectField>
        <div className="nx-field">
          <span className="nx-label">Qué vas a contar</span>
          <Segmented
            label="Alcance"
            value={form.scope}
            onChange={(scope) => { setForm({ ...form, scope }); save.clearFields("categoryId"); }}
            options={[{ id: "category", label: "Una categoría" }, { id: "all", label: "Todo" }, { id: "manual", label: "Productos sueltos" }]}
          />
          <span className="nx-help">
            {form.scope === "all" && "Incluye todos los productos que controlan inventario. Puede tomar varias horas en una tienda grande."}
            {form.scope === "category" && "Ideal para conteos cíclicos: un pasillo o una familia de productos a la vez."}
            {form.scope === "manual" && "Empieza vacío: escanea o agrega solo los productos que quieras revisar."}
          </span>
        </div>
        {form.scope === "category" && (
          <SelectField label="Categoría" value={form.categoryId ?? ""} onChange={(e) => { setForm({ ...form, categoryId: e.target.value || null }); save.clearFields("categoryId"); }} error={save.fields.categoryId}>
            <option value="">Elige una categoría</option>
            {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}{c.productCount !== undefined ? ` (${c.productCount})` : ""}</option>)}
          </SelectField>
        )}
        <TextField label="Nota" optional value={form.note ?? ""} onChange={(e) => setForm({ ...form, note: e.target.value || null })} placeholder="Pasillo 3, conteo de fin de mes…" />
        <p className="nx-help" style={{ margin: 0 }}>Puedes seguir vendiendo durante el conteo: al aplicarlo se respetan las ventas hechas después de contar cada producto.</p>
      </form>
    </Modal>
  );
}
