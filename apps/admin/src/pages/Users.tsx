import { useMemo, useState } from "react";
import { Search, UserPlus } from "lucide-react";
import { ROLE_LABELS, type Member } from "@nexo/shared";
import { Alert, Avatar, Badge, Button, EmptyState, Modal, PageHeader, SelectField, TextField, useToast } from "@nexo/ui";
import { get, patch, post } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLoad, useSubmit } from "../lib/hooks";

const dateFmt = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" });

export function UsersPage() {
  const { me, can } = useAuth();
  const editable = can("users:write");
  const toast = useToast();
  const { data, error, reload } = useLoad(() => get<Member[]>("/users"));
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState<Member | null>(null);
  const [form, setForm] = useState({ name: "", email: "", role: "cashier" as "admin" | "cashier", password: "" });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data ?? []).filter((m) => !q || m.name.toLowerCase().includes(q) || m.email.includes(q));
  }, [data, query]);

  const create = useSubmit(async () => {
    await post("/users", form);
    setCreating(false);
    setForm({ name: "", email: "", role: "cashier", password: "" });
    toast("Usuario creado. Comparte la contraseña temporal en persona.");
    await reload();
  });
  const update = useSubmit(async (m: Member, body: { role?: "admin" | "cashier"; active?: boolean }) => {
    await patch(`/users/${m.userId}`, body);
    toast(body.active === false ? `${m.name} ya no puede entrar` : "Usuario actualizado");
    setConfirm(null);
    await reload();
  });

  return (
    <>
      <PageHeader
        title="Usuarios"
        description="Quién puede entrar a tu negocio y qué puede hacer."
        actions={editable && <Button variant="primary" onClick={() => setCreating(true)}><UserPlus className="nx-icon" aria-hidden="true" />Nuevo usuario</Button>}
      />
      {error && <Alert tone="danger">{error.message}</Alert>}
      {update.message && <Alert tone="danger">{update.message}</Alert>}
      <div className="nx-table-wrap">
        <div className="nx-table-toolbar">
          <div className="nx-input-group" style={{ width: 280, maxWidth: "100%" }}>
            <Search className="nx-icon" aria-hidden="true" />
            <input className="nx-input" style={{ height: "var(--control-sm)" }} placeholder="Buscar por nombre o correo" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar usuarios" />
          </div>
          <span className="nx-muted" style={{ fontSize: 13 }}>Administrador: todo. Cajero: punto de venta y consulta del catálogo.</span>
        </div>
        {data && filtered.length === 0 ? (
          <EmptyState icon={<Search className="nx-icon" />} title={`No encontramos usuarios con "${query}"`} actions={<Button variant="ghost" onClick={() => setQuery("")}>Limpiar búsqueda</Button>} />
        ) : (
          <div className="nx-table-scroll">
            <table className="nx-table">
              <thead><tr><th>Usuario</th><th>Rol</th><th>Estado</th><th>Desde</th><th aria-label="Acciones" /></tr></thead>
              <tbody>
                {filtered.map((m) => {
                  const locked = m.role === "owner" || m.userId === me?.user.id || !editable;
                  return (
                    <tr key={m.userId}>
                      <td>
                        <div className="nx-cell-product">
                          <Avatar name={m.name} />
                          <div><div>{m.name}{m.userId === me?.user.id && <span className="nx-muted"> (tú)</span>}</div><div className="nx-muted" style={{ fontSize: 12 }}>{m.email}</div></div>
                        </div>
                      </td>
                      <td>
                        {locked ? ROLE_LABELS[m.role] : (
                          <select className="nx-select" style={{ height: "var(--control-sm)", width: 160 }} value={m.role} aria-label={`Rol de ${m.name}`} onChange={(e) => void update.submit(m, { role: e.target.value as "admin" | "cashier" })}>
                            <option value="admin">{ROLE_LABELS.admin}</option>
                            <option value="cashier">{ROLE_LABELS.cashier}</option>
                          </select>
                        )}
                      </td>
                      <td>{m.active ? <Badge tone="success">Activo</Badge> : <Badge>Desactivado</Badge>}</td>
                      <td className="nx-muted">{dateFmt.format(new Date(m.createdAt))}</td>
                      <td style={{ textAlign: "right" }}>
                        {!locked && (m.active
                          ? <Button size="sm" variant="danger-ghost" onClick={() => setConfirm(m)}>Desactivar</Button>
                          : <Button size="sm" variant="ghost" onClick={() => void update.submit(m, { active: true })}>Reactivar</Button>)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {data && <div className="nx-table-footer"><span>{filtered.length} de {data.length} usuarios</span></div>}
      </div>

      <Modal
        open={creating}
        title="Nuevo usuario"
        onClose={() => setCreating(false)}
        footer={<><Button variant="ghost" onClick={() => setCreating(false)}>Cancelar</Button><Button variant="primary" loading={create.pending} onClick={() => void create.submit()}>Crear usuario</Button></>}
      >
        <div className="nx-stack">
          {create.message && <Alert tone="danger">{create.message}</Alert>}
          <TextField label="Nombre" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={create.fields.name} />
          <TextField label="Correo" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={create.fields.email} />
          <SelectField label="Rol" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as "admin" | "cashier" })}>
            <option value="cashier">{ROLE_LABELS.cashier} — punto de venta</option>
            <option value="admin">{ROLE_LABELS.admin} — acceso completo</option>
          </SelectField>
          <TextField label="Contraseña temporal" type="text" autoComplete="off" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} error={create.fields.password} help="Al menos 10 caracteres. Pídele que la cambie al entrar." />
        </div>
      </Modal>

      <Modal
        open={confirm !== null}
        title={`¿Desactivar a ${confirm?.name ?? ""}?`}
        onClose={() => setConfirm(null)}
        footer={<><Button variant="ghost" onClick={() => setConfirm(null)}>Cancelar</Button><Button variant="danger" loading={update.pending} onClick={() => confirm && void update.submit(confirm, { active: false })}>Desactivar</Button></>}
      >
        Se cerrará su sesión y ya no podrá entrar a {me?.tenant.name}. Su historial de acciones se conserva. Puedes reactivarlo cuando quieras.
      </Modal>
    </>
  );
}
