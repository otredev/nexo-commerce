import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { UserPlus } from "lucide-react";
import { PLATFORM_PERMISSION_GROUPS, PLATFORM_PERMISSIONS, PLATFORM_PRESETS, type PlatformOperator, type PlatformPermission } from "@nexo/shared";
import { Alert, Badge, Button, Modal, PageHeader, TextField, useToast } from "@nexo/ui";
import { get, patch, post } from "../../lib/api";
import { useLoad, useSubmit } from "../../lib/hooks";
import { ago, fmtDate, useOperator } from "../auth";

/** Name of the preset that matches, or "N permisos". */
export function accessLabel(perms: readonly PlatformPermission[]) {
  const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));
  const preset = Object.values(PLATFORM_PRESETS).find((p) => same(p.permissions, perms));
  return preset?.label ?? `${perms.length} de ${PLATFORM_PERMISSIONS.length} permisos`;
}

/** Operator permissions: presets and the full list. */
function OperatorPermissions({ value, onChange, lockManage }: { value: PlatformPermission[]; onChange: (v: PlatformPermission[]) => void; lockManage?: boolean }) {
  const set = new Set(value);
  return (
    <div className="nx-stack" style={{ gap: 12 }}>
      <div className="nx-row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span className="nx-muted" style={{ fontSize: 13 }}>Preajuste:</span>
        {Object.entries(PLATFORM_PRESETS).map(([id, p]) => (
          <Button key={id} size="sm" variant={accessLabel(value) === p.label ? "secondary" : "ghost"} onClick={() => onChange(lockManage ? [...new Set([...p.permissions, "operators:manage" as const])] : [...p.permissions])}>{p.label}</Button>
        ))}
      </div>
      <div className="nx-perms">
        {PLATFORM_PERMISSION_GROUPS.map((g) => (
          <fieldset key={g.label} className="nx-perms__group">
            <legend className="nx-perms__legend"><span>{g.label}</span></legend>
            {g.items.map((i) => {
              const locked = lockManage && i.id === "operators:manage";
              return (
                <label key={i.id} className="nx-perms__item" data-off={locked || undefined}>
                  <input type="checkbox" checked={set.has(i.id)} disabled={locked} onChange={(e) => onChange(e.target.checked ? [...value, i.id] : value.filter((x) => x !== i.id))} />
                  <span>{i.label}{"help" in i && <span className="nx-help" style={{ display: "block", margin: 0 }}>{i.help}</span>}{locked && <span className="nx-help" style={{ display: "block", margin: 0 }}>No te lo puedes quitar a ti mismo.</span>}</span>
                </label>
              );
            })}
          </fieldset>
        ))}
      </div>
    </div>
  );
}

export function OperatorsPage() {
  const { me, can } = useOperator();
  const manage = can("operators:manage");
  const toast = useToast();
  const { data, error, reload } = useLoad(() => get<{ items: PlatformOperator[] }>("/platform/operators"), []);
  const [creating, setCreating] = useState(false);
  const [passwordFor, setPasswordFor] = useState<PlatformOperator | null>(null);
  const [permsFor, setPermsFor] = useState<PlatformOperator | null>(null);
  const toggle = useSubmit(async (o: PlatformOperator) => {
    await patch(`/platform/operators/${o.id}`, { active: !o.active });
    toast(o.active ? `${o.name} ya no puede entrar` : `${o.name} reactivado`);
    await reload();
  });
  return (
    <>
      <PageHeader
        title="Operadores"
        description="Las personas del equipo de Nexo que entran a este panel. Cada acción queda en la bitácora con su nombre."
        actions={manage && <Button variant="primary" onClick={() => setCreating(true)}><UserPlus className="nx-icon" aria-hidden="true" />Nuevo operador</Button>}
      />
      {(error || toggle.message) && <Alert tone="danger">{error?.message ?? toggle.message}</Alert>}
      <div className="nx-table-wrap">
        <div className="nx-table-scroll">
          <table className="nx-table">
            <thead><tr><th>Operador</th><th>Acceso</th><th>Estado</th><th>Último acceso</th><th>Alta</th><th><span className="nx-sr-only">Acciones</span></th></tr></thead>
            <tbody>
              {data?.items.map((o) => (
                <tr key={o.id}>
                  <td>
                    <span className="nx-strong">{o.name}</span>{o.id === me?.operator.id && <span className="nx-muted"> (tú)</span>}
                    <div className="nx-muted" style={{ fontSize: 12 }}>{o.email}</div>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>{accessLabel(o.permissions)}</td>
                  <td>{o.active ? <Badge tone="success">Activo</Badge> : <Badge plain>Desactivado</Badge>}</td>
                  <td className="nx-muted">{ago(o.lastLoginAt)}</td>
                  <td className="nx-muted nx-num" style={{ whiteSpace: "nowrap" }}>{fmtDate(o.createdAt)}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {can("audit:read") && <Link className="nx-link" to={`/bitacora?operador=${o.id}`}>Bitácora</Link>}
                    {manage && <Button size="sm" variant="ghost" onClick={() => setPermsFor(o)}>Permisos</Button>}
                    {manage && o.id !== me?.operator.id && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => setPasswordFor(o)}>Nueva contraseña</Button>
                        <Button size="sm" variant={o.active ? "ghost" : "secondary"} loading={toggle.pending} onClick={() => void toggle.submit(o)}>{o.active ? "Desactivar" : "Reactivar"}</Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <CreateModal open={creating} onClose={() => setCreating(false)} onCreated={() => void reload()} />
      <PasswordModal operator={passwordFor} onClose={() => setPasswordFor(null)} />
      {permsFor && <PermissionsModal operator={permsFor} self={permsFor.id === me?.operator.id} onClose={() => setPermsFor(null)} onSaved={() => void reload()} />}
    </>
  );
}

function CreateModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [permissions, setPermissions] = useState<PlatformPermission[]>([...PLATFORM_PRESETS.support.permissions]);
  const save = useSubmit(async () => {
    const op = await post<PlatformOperator>("/platform/operators", { ...form, permissions });
    toast(`${op.name} ya puede entrar a /admin`);
    setForm({ name: "", email: "", password: "" });
    onCreated();
    onClose();
  });
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void save.submit();
  };
  return (
    <Modal open={open} title="Nuevo operador" size="lg" onClose={onClose} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" form="new-operator" loading={save.pending}>Crear</Button></>}>
      <form id="new-operator" className="nx-stack" onSubmit={onSubmit} noValidate>
        <p style={{ margin: 0 }}>Elige qué puede hacer en este panel. Lo puedes cambiar cuando quieras.</p>
        {save.message && <Alert tone="danger">{save.message}</Alert>}
        <TextField label="Nombre" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={save.fields.name} autoFocus />
        <TextField label="Correo" type="email" autoComplete="off" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={save.fields.email} />
        <TextField label="Contraseña inicial" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} error={save.fields.password} help="Mínimo 10 caracteres. Pídele que la cambie al entrar (Mi contraseña)." />
        <OperatorPermissions value={permissions} onChange={setPermissions} />
      </form>
    </Modal>
  );
}

function PasswordModal({ operator, onClose }: { operator: PlatformOperator | null; onClose: () => void }) {
  const toast = useToast();
  const [password, setPassword] = useState("");
  const save = useSubmit(async () => {
    await patch(`/platform/operators/${operator!.id}`, { password });
    toast(`Contraseña de ${operator!.name} cambiada: sus sesiones se cerraron`);
    setPassword("");
    onClose();
  });
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void save.submit();
  };
  return (
    <Modal open={Boolean(operator)} title={`Nueva contraseña para ${operator?.name ?? ""}`} onClose={onClose} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" form="op-new-password" loading={save.pending}>Guardar</Button></>}>
      <form id="op-new-password" className="nx-stack" onSubmit={onSubmit} noValidate>
        <p style={{ margin: 0 }}>Para cuando olvida la suya. Se cierran sus sesiones abiertas; dásela por un medio seguro.</p>
        {save.message && <Alert tone="danger">{save.message}</Alert>}
        <TextField label="Contraseña nueva" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={save.fields.password} help="Mínimo 10 caracteres." />
      </form>
    </Modal>
  );
}

function PermissionsModal({ operator, self, onClose, onSaved }: { operator: PlatformOperator; self: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { refresh } = useOperator();
  const [permissions, setPermissions] = useState<PlatformPermission[]>(operator.permissions);
  const save = useSubmit(async () => {
    await patch(`/platform/operators/${operator.id}`, { permissions });
    toast(`Permisos de ${operator.name} guardados`);
    if (self) await refresh();
    onSaved();
    onClose();
  });
  return (
    <Modal open size="lg" title={`Permisos de ${operator.name}`} onClose={onClose} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.pending} onClick={() => void save.submit()}>Guardar</Button></>}>
      <div className="nx-stack">
        {save.message && <Alert tone="danger">{save.message}</Alert>}
        <OperatorPermissions value={permissions} onChange={setPermissions} lockManage={self} />
        <p className="nx-help" style={{ margin: 0 }}>Se aplica en su siguiente clic. Queda en la bitácora.</p>
      </div>
    </Modal>
  );
}
