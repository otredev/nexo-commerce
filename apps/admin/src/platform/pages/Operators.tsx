import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { UserPlus } from "lucide-react";
import type { PlatformOperator } from "@nexo/shared";
import { Alert, Badge, Button, Modal, PageHeader, TextField, useToast } from "@nexo/ui";
import { get, patch, post } from "../../lib/api";
import { useLoad, useSubmit } from "../../lib/hooks";
import { ago, fmtDate, useOperator } from "../auth";

export function OperatorsPage() {
  const { me } = useOperator();
  const toast = useToast();
  const { data, error, reload } = useLoad(() => get<{ items: PlatformOperator[] }>("/platform/operators"), []);
  const [creating, setCreating] = useState(false);
  const [passwordFor, setPasswordFor] = useState<PlatformOperator | null>(null);
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
        actions={<Button variant="primary" onClick={() => setCreating(true)}><UserPlus className="nx-icon" aria-hidden="true" />Nuevo operador</Button>}
      />
      {(error || toggle.message) && <Alert tone="danger">{error?.message ?? toggle.message}</Alert>}
      <div className="nx-table-wrap">
        <div className="nx-table-scroll">
          <table className="nx-table">
            <thead><tr><th>Operador</th><th>Estado</th><th>Último acceso</th><th>Alta</th><th><span className="nx-sr-only">Acciones</span></th></tr></thead>
            <tbody>
              {data?.items.map((o) => (
                <tr key={o.id}>
                  <td>
                    <span className="nx-strong">{o.name}</span>{o.id === me?.operator.id && <span className="nx-muted"> (tú)</span>}
                    <div className="nx-muted" style={{ fontSize: 12 }}>{o.email}</div>
                  </td>
                  <td>{o.active ? <Badge tone="success">Activo</Badge> : <Badge plain>Desactivado</Badge>}</td>
                  <td className="nx-muted">{ago(o.lastLoginAt)}</td>
                  <td className="nx-muted nx-num">{fmtDate(o.createdAt)}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <Link className="nx-link" to={`/bitacora?operador=${o.id}`}>Bitácora</Link>
                    {o.id !== me?.operator.id && (
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
    </>
  );
}

function CreateModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const save = useSubmit(async () => {
    const op = await post<PlatformOperator>("/platform/operators", form);
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
    <Modal open={open} title="Nuevo operador" onClose={onClose} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" form="new-operator" loading={save.pending}>Crear</Button></>}>
      <form id="new-operator" className="nx-stack" onSubmit={onSubmit} noValidate>
        <p style={{ margin: 0 }}>Tendrá acceso completo a este panel: negocios, usuarios, soporte y entrar como negocio.</p>
        {save.message && <Alert tone="danger">{save.message}</Alert>}
        <TextField label="Nombre" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={save.fields.name} autoFocus />
        <TextField label="Correo" type="email" autoComplete="off" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={save.fields.email} />
        <TextField label="Contraseña inicial" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} error={save.fields.password} help="Mínimo 10 caracteres. Pídele que la cambie al entrar (Mi contraseña)." />
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
