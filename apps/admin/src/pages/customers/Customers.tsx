import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Download, UserRound } from "lucide-react";
import type { Customer, CustomerInput, Paginated } from "@nexo/shared";
import { Alert, Badge, Button, Checkbox, EmptyState, Modal, PageHeader, Pagination, SearchInput, Segmented, TextAreaField, TextField, useDebounced, useToast } from "@nexo/ui";
import { get, post, put, RequestError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useBusiness } from "../../lib/business";
import { useLoad, useSubmit } from "../../lib/hooks";
import { dateFmt } from "../../components/docs";

type Sort = "recent" | "total" | "last" | "name";
export const SOURCE_LABEL = { admin: "Panel", pos: "Caja", online: "Tienda en línea" } as const;

export function CustomersPage() {
  const { can } = useAuth();
  const { money } = useBusiness();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [creating, setCreating] = useState(false);
  // From the Ctrl+K search: "Nuevo cliente".
  useEffect(() => {
    if (params.get("nuevo") !== "1") return;
    if (can("customers:write")) setCreating(true);
    const next = new URLSearchParams(params);
    next.delete("nuevo");
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);
  const query = useDebounced(q);
  const sort = (params.get("orden") ?? "recent") as Sort;
  const status = params.get("archivados") ? "archived" : "active";
  const page = Number(params.get("pagina") ?? 1) || 1;
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== "pagina") next.delete("pagina");
    setParams(next, { replace: true });
  };
  const search = new URLSearchParams({ sort, status, page: String(page), ...(query && { q: query }) });
  const { data, error, loading } = useLoad(() => get<Paginated<Customer>>(`/customers?${search}`), [search.toString()]);

  return (
    <>
      <PageHeader
        title="Clientes"
        description="Quién te compra, cuánto y cada cuándo, en caja y en línea."
        actions={
          <>
            <Button onClick={() => window.open("/api/customers/export", "_blank")}><Download className="nx-icon" aria-hidden="true" />Exportar</Button>
            {can("customers:write") && <Button variant="primary" onClick={() => setCreating(true)}>Nuevo cliente</Button>}
          </>
        }
      />
      {error && <Alert tone="danger">{error.message}</Alert>}
      <div className="nx-table-wrap">
        <div className="nx-table-toolbar">
          <SearchInput label="Buscar cliente" placeholder="Nombre, teléfono, correo o RFC" value={q} onChange={(v) => { setQ(v); set("q", v); }} />
          <div className="nx-filters">
            <select className="nx-select" aria-label="Ordenar" value={sort} onChange={(e) => set("orden", e.target.value === "recent" ? "" : e.target.value)}>
              <option value="recent">Más recientes</option>
              <option value="total">Mayor compra</option>
              <option value="last">Última compra</option>
              <option value="name">Nombre</option>
            </select>
            <Segmented label="Estado" value={status} onChange={(v) => set("archivados", v === "archived" ? "1" : "")} options={[{ id: "active", label: "Activos" }, { id: "archived", label: "Archivados" }]} />
          </div>
        </div>
        {data && data.items.length === 0 ? (
          <EmptyState
            icon={<UserRound className="nx-icon" />}
            title={q ? "Ningún cliente coincide" : status === "archived" ? "No hay clientes archivados" : "Aún no tienes clientes registrados"}
            text={q || status === "archived" ? undefined : "Regístralos desde la caja al cobrar, aquí, o llegan solos con cada pedido en línea."}
            actions={!q && status === "active" && can("customers:write") && <Button variant="primary" onClick={() => setCreating(true)}>Nuevo cliente</Button>}
          />
        ) : (
          <div className="nx-table-scroll" aria-busy={loading}>
            <table className="nx-table">
              <thead><tr><th>Cliente</th><th>Contacto</th><th className="nx-col-num">Compras</th><th className="nx-col-num">Total comprado</th><th className="nx-col-num">Ticket promedio</th><th>Última compra</th></tr></thead>
              <tbody>
                {data?.items.map((c) => (
                  <tr key={c.id} className="nx-clickable" onClick={() => navigate(`/clientes/${c.id}`)}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{c.name}{c.accountSince && <> <Badge tone="accent">Cuenta en la tienda</Badge></>}</div>
                      <div className="nx-muted" style={{ fontSize: 12 }}>{SOURCE_LABEL[c.source]}{c.acceptsMarketing && " · acepta promociones"}</div>
                    </td>
                    <td className="nx-muted">{c.phone ?? "—"}{c.email && <div style={{ fontSize: 12 }}>{c.email}</div>}</td>
                    <td className="nx-col-num">{c.purchases}</td>
                    <td className="nx-col-num" style={{ fontWeight: 500 }}>{money(c.totalCents)}</td>
                    <td className="nx-col-num nx-muted">{c.purchases ? money(c.avgTicketCents) : "—"}</td>
                    <td className="nx-muted nx-num">{c.lastPurchaseAt ? dateFmt.format(new Date(c.lastPurchaseAt)) : <Badge plain>Sin compras</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > data.pageSize && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} noun="clientes" onPage={(p) => set("pagina", String(p))} />}
      </div>
      <CustomerModal customer={creating ? "new" : null} onClose={() => setCreating(false)} onSaved={(c) => navigate(`/clientes/${c.id}`)} />
    </>
  );
}

const EMPTY = { name: "", email: "", phone: "", taxId: "", address: "", notes: "", acceptsMarketing: false };

export function CustomerModal({ customer, onClose, onSaved }: { customer: Customer | "new" | null; onClose: () => void; onSaved: (c: Customer) => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [existing, setExisting] = useState<string | null>(null);
  const editing = customer && customer !== "new" ? customer : null;
  useEffect(() => {
    if (!customer) return;
    setExisting(null);
    setForm(customer === "new" ? EMPTY : { name: customer.name, email: customer.email ?? "", phone: customer.phone ?? "", taxId: customer.taxId ?? "", address: customer.address ?? "", notes: customer.notes ?? "", acceptsMarketing: customer.acceptsMarketing });
  }, [customer]);
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => { setForm((f) => ({ ...f, [k]: e.target.value })); save.clearFields(k); };
  const save = useSubmit(async () => {
    const body: CustomerInput = { ...form, email: form.email || null, phone: form.phone || null };
    try {
      const saved = editing ? await put<Customer>(`/customers/${editing.id}`, body) : await post<Customer>("/customers", body);
      toast(editing ? "Cliente actualizado" : "Cliente registrado");
      onSaved(saved);
    } catch (e) {
      if (e instanceof RequestError && e.fields.existingId) setExisting(e.fields.existingId);
      throw e;
    }
  });
  return (
    <Modal open={Boolean(customer)} size="lg" title={editing ? editing.name : "Nuevo cliente"} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.pending} onClick={() => void save.submit()}>Guardar</Button></>}>
      <form className="nx-stack" onSubmit={(e) => { e.preventDefault(); void save.submit(); }}>
        {save.message && (
          <Alert tone="warning">
            {save.message}
            {existing && <> <button type="button" className="nx-link" style={{ border: 0, background: "none", padding: 0, font: "inherit", cursor: "pointer" }} onClick={() => { onClose(); navigate(`/clientes/${existing}`); }}>Ver ese cliente</button></>}
          </Alert>
        )}
        <div className="nx-form-grid">
          <TextField label="Nombre" value={form.name} onChange={set("name")} error={save.fields.name} autoFocus fieldClassName="nx-span-2" />
          <TextField label="Teléfono" optional inputMode="tel" value={form.phone} onChange={set("phone")} error={save.fields.phone} />
          <TextField label="Correo" optional type="email" value={form.email} onChange={set("email")} error={save.fields.email} />
          <TextField label="RFC" optional value={form.taxId} onChange={(e) => setForm((f) => ({ ...f, taxId: e.target.value.toUpperCase() }))} help="Para facturarle." />
          <TextField label="Dirección" optional value={form.address} onChange={set("address")} />
          <TextAreaField label="Notas" optional rows={2} value={form.notes} onChange={set("notes")} fieldClassName="nx-span-2" placeholder="Talla, preferencias, cumpleaños…" />
          <div className="nx-span-2"><Checkbox label="Acepta recibir promociones" checked={form.acceptsMarketing} onChange={(e) => setForm((f) => ({ ...f, acceptsMarketing: e.target.checked }))} /></div>
        </div>
      </form>
    </Modal>
  );
}
