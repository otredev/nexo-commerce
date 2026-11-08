import { useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { Copy, Pencil, Plus, Search, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { PERMISSION_GROUPS, ROLE_LABELS, rolePermissions, type CustomRole, type Member, type Permission } from "@nexo/shared";
import { Alert, Avatar, Badge, Button, EmptyState, Modal, PageHeader, SelectField, Tabs, TextField, useToast } from "@nexo/ui";
import { PermissionChecklist } from "../components/PermissionChecklist";
import { del, get, patch, post, put } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLoad, useSubmit } from "../lib/hooks";

const dateFmt = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" });
const TOTAL = PERMISSION_GROUPS.reduce((a, g) => a + g.items.length, 0);

/** The role select stores "admin", "cashier" or "role:<id>". */
const roleValue = (m: { role: string; roleId: string | null }) => (m.roleId ? `role:${m.roleId}` : m.role);
const roleBody = (v: string): { role?: "admin" | "cashier"; roleId: string | null } => (v.startsWith("role:") ? { roleId: v.slice(5) } : { role: v as "admin" | "cashier", roleId: null });

export function UsersPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "roles" ? "roles" : "people";
  const roles = useLoad(() => get<{ items: CustomRole[] }>("/users/roles"));
  return (
    <>
      <PageHeader title="Usuarios" description="Quién puede entrar a tu negocio y qué puede hacer." />
      <Tabs label="Usuarios" value={tab} onChange={(t) => setParams(t === "roles" ? { tab: "roles" } : {}, { replace: true })} tabs={[{ id: "people", label: "Personas" }, { id: "roles", label: "Roles y permisos" }]} />
      {tab === "people" ? <People roles={roles.data?.items ?? []} /> : <Roles roles={roles.data?.items ?? null} error={roles.error?.message ?? null} reload={roles.reload} />}
    </>
  );
}

function RoleOptions({ roles }: { roles: CustomRole[] }) {
  return (
    <>
      <option value="admin">{ROLE_LABELS.admin}</option>
      <option value="cashier">{ROLE_LABELS.cashier}</option>
      {roles.length > 0 && (
        <optgroup label="Tus roles">
          {roles.map((r) => <option key={r.id} value={`role:${r.id}`}>{r.name}</option>)}
        </optgroup>
      )}
    </>
  );
}

function People({ roles }: { roles: CustomRole[] }) {
  const { me, can } = useAuth();
  const editable = can("users:write");
  const toast = useToast();
  const { data, error, reload } = useLoad(() => get<Member[]>("/users"));
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState<Member | null>(null);
  const [form, setForm] = useState({ name: "", email: "", role: "cashier", password: "" });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data ?? []).filter((m) => !q || m.name.toLowerCase().includes(q) || m.email.includes(q));
  }, [data, query]);

  const create = useSubmit(async () => {
    const r = roleBody(form.role);
    await post("/users", { name: form.name, email: form.email, password: form.password, role: r.role ?? "cashier", roleId: r.roleId });
    setCreating(false);
    setForm({ name: "", email: "", role: "cashier", password: "" });
    toast("Usuario creado. Comparte la contraseña temporal en persona.");
    await reload();
  });
  const update = useSubmit(async (m: Member, body: Record<string, unknown>) => {
    await patch(`/users/${m.userId}`, body);
    toast(body.active === false ? `${m.name} ya no puede entrar` : "Usuario actualizado");
    setConfirm(null);
    await reload();
  });
  const onCreate = (e: FormEvent) => { e.preventDefault(); void create.submit(); };

  return (
    <>
      {error && <Alert tone="danger">{error.message}</Alert>}
      {update.message && <Alert tone="danger">{update.message}</Alert>}
      <div className="nx-table-wrap">
        <div className="nx-table-toolbar">
          <div className="nx-input-group" style={{ width: 280, maxWidth: "100%" }}>
            <Search className="nx-icon" aria-hidden="true" />
            <input className="nx-input" style={{ height: "var(--control-sm)" }} placeholder="Buscar por nombre o correo" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar usuarios" />
          </div>
          {editable && <Button variant="primary" size="sm" onClick={() => setCreating(true)}><UserPlus className="nx-icon" aria-hidden="true" />Nuevo usuario</Button>}
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
                        {locked ? (m.roleName ?? ROLE_LABELS[m.role]) : (
                          <select className="nx-select" style={{ height: "var(--control-sm)", width: 190 }} value={roleValue(m)} aria-label={`Rol de ${m.name}`} onChange={(e) => void update.submit(m, roleBody(e.target.value))}>
                            <RoleOptions roles={roles} />
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
        {data && <div className="nx-table-footer"><span>{filtered.length} de {data.length} usuarios</span><span>Lo que puede hacer cada rol está en <a className="nx-link" href="?tab=roles">Roles y permisos</a>.</span></div>}
      </div>

      <Modal
        open={creating}
        title="Nuevo usuario"
        onClose={() => setCreating(false)}
        footer={<><Button variant="ghost" onClick={() => setCreating(false)}>Cancelar</Button><Button variant="primary" type="submit" form="new-user" loading={create.pending}>Crear usuario</Button></>}
      >
        <form id="new-user" className="nx-stack" onSubmit={onCreate} noValidate>
          {create.message && <Alert tone="danger">{create.message}</Alert>}
          <TextField label="Nombre" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={create.fields.name} />
          <TextField label="Correo" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={create.fields.email} />
          <SelectField label="Rol" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} error={create.fields.roleId} help="Administrador: todo menos el plan. Cajero: punto de venta y consulta del catálogo. Tus roles: lo que marcaste.">
            <RoleOptions roles={roles} />
          </SelectField>
          <TextField label="Contraseña temporal" type="text" autoComplete="off" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} error={create.fields.password} help="Al menos 10 caracteres. Pídele que la cambie al entrar." />
        </form>
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

const BUILT_IN: Array<{ id: "owner" | "admin" | "cashier"; text: string }> = [
  { id: "owner", text: "Todo, incluido el plan y los pagos. Solo hay uno y no se puede cambiar." },
  { id: "admin", text: "Todo menos el plan y los pagos." },
  { id: "cashier", text: "Vender en la caja, su corte a ciegas, pedidos y consultar el catálogo." },
];

function Roles({ roles, error, reload }: { roles: CustomRole[] | null; error: string | null; reload: () => Promise<void> }) {
  const { can, me } = useAuth();
  const editable = can("users:write");
  const toast = useToast();
  const [editing, setEditing] = useState<CustomRole | "new" | null>(null);
  const [copyFrom, setCopyFrom] = useState<Permission[] | null>(null);
  const [viewing, setViewing] = useState<{ name: string; permissions: Permission[] } | null>(null);
  const [deleting, setDeleting] = useState<CustomRole | null>(null);
  const remove = useSubmit(async (r: CustomRole) => {
    await del(`/users/roles/${r.id}`);
    toast(`Rol «${r.name}» eliminado`);
    setDeleting(null);
    await reload();
  });
  return (
    <>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="nx-roles">
        <section>
          <h2 className="nx-section-title">Roles de Nexo</h2>
          <div className="nx-role-grid">
            {BUILT_IN.map((b) => {
              const perms = rolePermissions(b.id);
              return (
                <div key={b.id} className="nx-role-card">
                  <div className="nx-role-card__head"><ShieldCheck className="nx-icon" aria-hidden="true" /><strong>{ROLE_LABELS[b.id]}</strong><span className="nx-muted nx-num">{b.id === "owner" ? "Todo" : `${perms.filter((p) => p !== "billing:write").length}/${TOTAL}`}</span></div>
                  <p className="nx-muted">{b.text}</p>
                  <div className="nx-row" style={{ gap: 8 }}>
                    <Button size="sm" variant="ghost" onClick={() => setViewing({ name: ROLE_LABELS[b.id], permissions: perms })}>Ver permisos</Button>
                    {editable && b.id !== "owner" && <Button size="sm" variant="ghost" onClick={() => { setCopyFrom(perms.filter((p) => p !== "billing:write")); setEditing("new"); }}><Copy className="nx-icon" aria-hidden="true" />Copiar</Button>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
        <section>
          <div className="nx-row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
            <h2 className="nx-section-title" style={{ margin: 0 }}>Tus roles</h2>
            {editable && <Button size="sm" variant="primary" onClick={() => { setCopyFrom(null); setEditing("new"); }}><Plus className="nx-icon" aria-hidden="true" />Nuevo rol</Button>}
          </div>
          {roles && roles.length === 0 ? (
            <EmptyState
              icon={<ShieldCheck className="nx-icon" />}
              title="Aún no tienes roles propios"
              text="Crea uno para dar justo lo que cada persona necesita: por ejemplo «Encargado de tienda» (caja, pedidos y ver reportes) o «Almacenista» (inventario, compras y traspasos, sin ver ventas)."
              actions={editable && <Button onClick={() => { setCopyFrom(null); setEditing("new"); }}>Crear un rol</Button>}
            />
          ) : (
            <div className="nx-table-wrap">
              <div className="nx-table-scroll">
                <table className="nx-table">
                  <thead><tr><th>Rol</th><th className="nx-col-num">Permisos</th><th className="nx-col-num">Personas</th><th aria-label="Acciones" /></tr></thead>
                  <tbody>
                    {roles?.map((r) => (
                      <tr key={r.id}>
                        <td><div style={{ fontWeight: 500 }}>{r.name}</div>{r.description && <div className="nx-muted" style={{ fontSize: 12 }}>{r.description}</div>}</td>
                        <td className="nx-col-num">{r.permissions.length}/{TOTAL}</td>
                        <td className="nx-col-num">{r.members}</td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          {editable ? (
                            <>
                              <Button size="sm" variant="ghost" onClick={() => setEditing(r)}><Pencil className="nx-icon" aria-hidden="true" />Editar</Button>
                              <Button size="sm" variant="danger-ghost" onClick={() => setDeleting(r)}><Trash2 className="nx-icon" aria-hidden="true" />Eliminar</Button>
                            </>
                          ) : <Button size="sm" variant="ghost" onClick={() => setViewing(r)}>Ver permisos</Button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </div>
      {editing && (
        <RoleEditor
          role={editing === "new" ? null : editing}
          initial={copyFrom}
          allowed={me?.role === "owner" ? undefined : me?.permissions}
          onClose={() => setEditing(null)}
          onSaved={async (r, isNew) => { toast(isNew ? `Rol «${r.name}» creado` : `Rol «${r.name}» guardado. Sus ${r.members} personas ya tienen los permisos nuevos.`); setEditing(null); await reload(); }}
        />
      )}
      <Modal open={Boolean(viewing)} title={viewing ? `Permisos de ${viewing.name}` : ""} size="lg" onClose={() => setViewing(null)} footer={<Button onClick={() => setViewing(null)}>Cerrar</Button>}>
        {viewing && <PermissionChecklist value={viewing.permissions} readOnly />}
      </Modal>
      <Modal
        open={Boolean(deleting)}
        title={`¿Eliminar el rol «${deleting?.name ?? ""}»?`}
        onClose={() => setDeleting(null)}
        footer={<><Button variant="ghost" onClick={() => setDeleting(null)}>Cancelar</Button><Button variant="danger" loading={remove.pending} onClick={() => deleting && void remove.submit(deleting)}>Eliminar</Button></>}
      >
        <div className="nx-stack">
          {remove.message && <Alert tone="danger">{remove.message}</Alert>}
          <p style={{ margin: 0 }}>{deleting?.members ? `Primero cambia de rol a sus ${deleting.members} ${deleting.members === 1 ? "persona" : "personas"}.` : "Nadie lo tiene, así que nadie pierde acceso."}</p>
        </div>
      </Modal>
    </>
  );
}

function RoleEditor({ role, initial, allowed, onClose, onSaved }: {
  role: CustomRole | null;
  initial: Permission[] | null;
  allowed?: readonly Permission[];
  onClose: () => void;
  onSaved: (r: CustomRole, isNew: boolean) => void;
}) {
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [permissions, setPermissions] = useState<Permission[]>(role?.permissions ?? initial ?? []);
  const save = useSubmit(async () => {
    const body = { name, description: description || null, permissions };
    const saved = role ? await put<CustomRole>(`/users/roles/${role.id}`, body) : await post<CustomRole>("/users/roles", body);
    onSaved(saved, !role);
  });
  const onSubmit = (e: FormEvent) => { e.preventDefault(); void save.submit(); };
  return (
    <Modal
      open
      size="lg"
      title={role ? `Editar «${role.name}»` : "Nuevo rol"}
      onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" form="role-editor" loading={save.pending}>{role ? "Guardar" : "Crear rol"}</Button></>}
    >
      <form id="role-editor" className="nx-stack" onSubmit={onSubmit} noValidate>
        {save.message && <Alert tone="danger">{save.message}</Alert>}
        <div className="nx-form-grid">
          <TextField label="Nombre" value={name} onChange={(e) => setName(e.target.value)} error={save.fields.name} placeholder="Encargado de tienda" />
          <TextField label="Descripción" optional value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Abre y cierra la caja, atiende pedidos" />
        </div>
        <div className="nx-row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span className="nx-muted" style={{ fontSize: 13 }}>Empezar desde:</span>
          <Button size="sm" variant="ghost" onClick={() => setPermissions(rolePermissions("cashier").filter((p) => !allowed || allowed.includes(p)))}>Cajero</Button>
          <Button size="sm" variant="ghost" onClick={() => setPermissions(rolePermissions("admin").filter((p) => p !== "billing:write" && (!allowed || allowed.includes(p))))}>Administrador</Button>
          <Button size="sm" variant="ghost" onClick={() => setPermissions([])}>Nada</Button>
          <span className="nx-muted nx-num" style={{ marginLeft: "auto", fontSize: 13 }}>{permissions.length} de {TOTAL} permisos</span>
        </div>
        {save.fields.permissions && <Alert tone="danger">{save.fields.permissions}</Alert>}
        {allowed && <p className="nx-help" style={{ margin: 0 }}>Solo puedes dar los permisos que tú tienes; los demás aparecen apagados.</p>}
        <PermissionChecklist value={permissions} onChange={setPermissions} allowed={allowed} />
        <p className="nx-help" style={{ margin: 0 }}>El plan y los pagos son solo del propietario. Los cambios se aplican al instante a quien tenga este rol.</p>
      </form>
    </Modal>
  );
}
