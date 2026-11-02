import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Truck } from "lucide-react";
import type { Supplier } from "@nexo/shared";
import { Alert, Badge, Button, Checkbox, EmptyState, Modal, PageHeader, SearchInput, Segmented, TextAreaField, TextField, useDebounced, useToast } from "@nexo/ui";
import { del, get, post, put } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useBusiness } from "../lib/business";
import { useLoad, useSubmit } from "../lib/hooks";
import { dateFmt } from "../components/docs";

type Status = "active" | "inactive" | "all";
const EMPTY = { name: "", contactName: "", email: "", phone: "", taxId: "", address: "", paymentTermsDays: "0", notes: "", active: true };

export function SuppliersPage() {
  const { can } = useAuth();
  const { money } = useBusiness();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [status, setStatus] = useState<Status>("active");
  const [editing, setEditing] = useState<Supplier | "new" | null>(null);
  const query = useDebounced(q);
  const { data, error, reload } = useLoad(() => get<Supplier[]>(`/suppliers?${new URLSearchParams({ status, ...(query && { q: query }) })}`), [status, query]);
  const writable = can("suppliers:write");

  return (
    <>
      <PageHeader
        title="Proveedores"
        description="A quién le compras, sus datos de contacto y días de crédito."
        actions={writable && <Button variant="primary" onClick={() => setEditing("new")}>Nuevo proveedor</Button>}
      />
      {error && <Alert tone="danger">{error.message}</Alert>}
      <div className="nx-table-wrap">
        <div className="nx-table-toolbar">
          <SearchInput label="Buscar proveedor" placeholder="Nombre, contacto, RFC o correo" value={q} onChange={setQ} />
          <Segmented label="Estado" value={status} onChange={setStatus} options={[{ id: "active", label: "Activos" }, { id: "inactive", label: "Inactivos" }, { id: "all", label: "Todos" }]} />
        </div>
        {data && data.length === 0 ? (
          <EmptyState
            icon={<Truck className="nx-icon" />}
            title={q || status !== "active" ? "Ningún proveedor coincide" : "Aún no tienes proveedores"}
            text={q || status !== "active" ? undefined : "Registra a quién le compras para crear órdenes de compra y llevar el historial."}
            actions={writable && !q && <Button variant="primary" onClick={() => setEditing("new")}>Nuevo proveedor</Button>}
          />
        ) : (
          <div className="nx-table-scroll">
            <table className="nx-table">
              <thead>
                <tr><th>Proveedor</th><th>Contacto</th><th className="nx-col-num">Crédito</th><th className="nx-col-num">Órdenes</th><th className="nx-col-num">Comprado</th><th>Última orden</th><th aria-label="Acciones" /></tr>
              </thead>
              <tbody>
                {data?.map((s) => (
                  <tr key={s.id} className={writable ? "nx-clickable" : undefined} onClick={writable ? () => setEditing(s) : undefined}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{s.name} {!s.active && <Badge plain>Inactivo</Badge>}</div>
                      {s.taxId && <div className="nx-mono nx-muted" style={{ fontSize: 12 }}>{s.taxId}</div>}
                    </td>
                    <td className="nx-muted">
                      {s.contactName ?? "—"}
                      {(s.email || s.phone) && <div style={{ fontSize: 12 }}>{[s.email, s.phone].filter(Boolean).join(" · ")}</div>}
                    </td>
                    <td className="nx-col-num nx-muted">{s.paymentTermsDays ? `${s.paymentTermsDays} días` : "Contado"}</td>
                    <td className="nx-col-num">{s.ordersCount ?? 0}{s.openOrdersCount ? <span className="nx-muted"> · {s.openOrdersCount} abiertas</span> : null}</td>
                    <td className="nx-col-num">{money(s.receivedCents ?? 0)}</td>
                    <td className="nx-muted nx-num">{s.lastOrderAt ? dateFmt.format(new Date(s.lastOrderAt)) : "—"}</td>
                    <td style={{ textAlign: "right" }}>
                      {can("purchases:write") && s.active && (
                        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); navigate(`/compras/nueva?proveedor=${s.id}`); }}>Nueva orden</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <SupplierModal supplier={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />
    </>
  );
}

/** Create or edit a supplier. Exported so the purchase form can create one without leaving the page. */
export function SupplierModal({ supplier, onClose, onSaved }: { supplier: Supplier | "new" | null; onClose: () => void; onSaved: (s: Supplier) => void }) {
  const toast = useToast();
  const [form, setForm] = useState(EMPTY);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const existing = supplier && supplier !== "new" ? supplier : null;
  useEffect(() => {
    if (!supplier) return;
    setConfirmDelete(false);
    setForm(
      supplier === "new"
        ? EMPTY
        : {
            name: supplier.name, contactName: supplier.contactName ?? "", email: supplier.email ?? "", phone: supplier.phone ?? "", taxId: supplier.taxId ?? "",
            address: supplier.address ?? "", paymentTermsDays: String(supplier.paymentTermsDays), notes: supplier.notes ?? "", active: supplier.active,
          },
    );
  }, [supplier]);
  const set = (key: keyof typeof EMPTY) => (e: { target: { value: string } }) => { setForm((f) => ({ ...f, [key]: e.target.value })); save.clearFields(key); };
  const save = useSubmit(async () => {
    const body = { ...form, paymentTermsDays: Number(form.paymentTermsDays) || 0 };
    const saved = existing ? await put<Supplier>(`/suppliers/${existing.id}`, body) : await post<Supplier>("/suppliers", body);
    toast(existing ? "Proveedor actualizado" : "Proveedor creado");
    onSaved(saved);
  });
  const remove = useSubmit(async () => {
    await del(`/suppliers/${existing!.id}`);
    toast("Proveedor eliminado");
    onSaved(existing!);
  });
  return (
    <Modal
      open={Boolean(supplier)}
      size="lg"
      title={existing ? existing.name : "Nuevo proveedor"}
      onClose={onClose}
      footer={
        <>
          {existing && (confirmDelete ? (
            <Button variant="danger" loading={remove.pending} onClick={() => void remove.submit()} style={{ marginRight: "auto" }}>Sí, eliminar</Button>
          ) : (
            <Button variant="danger-ghost" onClick={() => setConfirmDelete(true)} style={{ marginRight: "auto" }}>Eliminar</Button>
          ))}
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={save.pending} onClick={() => void save.submit()}>Guardar</Button>
        </>
      }
    >
      <form className="nx-stack" onSubmit={(e) => { e.preventDefault(); void save.submit(); }}>
        {(save.message || remove.message) && <Alert tone="danger">{save.message ?? remove.message}</Alert>}
        {confirmDelete && !remove.message && <Alert tone="warning">Solo se pueden eliminar proveedores sin órdenes. Si ya tiene historial, desactívalo.</Alert>}
        <div className="nx-form-grid">
          <TextField label="Nombre o razón social" value={form.name} onChange={set("name")} error={save.fields.name} autoFocus fieldClassName="nx-span-2" />
          <TextField label="Contacto" optional value={form.contactName} onChange={set("contactName")} />
          <TextField label="RFC" optional value={form.taxId} onChange={set("taxId")} error={save.fields.taxId} />
          <TextField label="Correo" optional type="email" value={form.email} onChange={set("email")} error={save.fields.email} help="Para enviarle las órdenes de compra." />
          <TextField label="Teléfono" optional value={form.phone} onChange={set("phone")} />
          <TextField label="Días de crédito" inputMode="numeric" className="nx-num" value={form.paymentTermsDays} onChange={set("paymentTermsDays")} error={save.fields.paymentTermsDays} help="0 si pagas al recibir." />
          <TextField label="Dirección" optional value={form.address} onChange={set("address")} />
          <TextAreaField label="Notas" optional value={form.notes} onChange={set("notes")} rows={2} fieldClassName="nx-span-2" placeholder="Días de entrega, pedido mínimo, cuenta bancaria…" />
          {existing && <div className="nx-span-2"><Checkbox label="Activo" help="Los proveedores inactivos no aparecen al crear órdenes." checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} /></div>}
        </div>
      </form>
    </Modal>
  );
}
