import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Copy, Users as UsersIcon } from "lucide-react";
import { ROLE_LABELS, type PlatformUser, type PlatformUserDetail } from "@nexo/shared";
import { Alert, Badge, Button, Card, EmptyState, Modal, PageHeader, Pagination, SearchInput, Segmented, useDebounced, useToast } from "@nexo/ui";
import { get, patch, post } from "../../lib/api";
import { useLoad, useSubmit } from "../../lib/hooks";
import { ago, fmtDate, fmtDateTime, useOperator } from "../auth";

type StatusFilter = "all" | "disabled" | "locked";

function UserBadges({ u }: { u: PlatformUser }) {
  return (
    <>
      {u.disabledAt && <Badge tone="danger">Desactivado</Badge>}
      {u.locked && <Badge tone="warning">Bloqueado por intentos</Badge>}
    </>
  );
}

export function UsersPage() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const status = (params.get("estado") ?? "all") as StatusFilter;
  const page = Number(params.get("pagina") ?? 1) || 1;
  const query = useDebounced(q);
  const set = (key: string, value: string) => setParams((p) => { const n = new URLSearchParams(p); if (!value || value === "all") n.delete(key); else n.set(key, value); if (key !== "pagina") n.delete("pagina"); return n; }, { replace: true });
  const search = new URLSearchParams({ status, page: String(page), ...(query.trim() && { q: query.trim() }) });
  const { data, error, loading } = useLoad(() => get<{ items: PlatformUser[]; total: number; page: number; pageSize: number }>(`/platform/users?${search}`), [search.toString()]);
  return (
    <>
      <PageHeader title="Usuarios" description="Todas las cuentas de la plataforma: propietarios, administradores y cajeros de cada negocio." />
      {error && <Alert tone="danger">{error.message}</Alert>}
      <div className="nx-table-wrap">
        <div className="nx-table-toolbar">
          <SearchInput value={q} onChange={(v) => { setQ(v); set("q", v); }} placeholder="Nombre, correo o negocio" label="Buscar usuario" width={300} />
          <Segmented label="Estado" value={status} onChange={(v) => set("estado", v)} options={[{ id: "all", label: "Todos" }, { id: "locked", label: "Bloqueados" }, { id: "disabled", label: "Desactivados" }]} />
        </div>
        {data && data.items.length === 0 ? (
          <EmptyState icon={<UsersIcon className="nx-icon" />} title="Ningún usuario coincide" />
        ) : (
          <div className="nx-table-scroll" aria-busy={loading}>
            <table className="nx-table">
              <thead><tr><th>Persona</th><th>Negocios</th><th>Último acceso</th><th>Alta</th></tr></thead>
              <tbody>
                {data?.items.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <Link className="nx-link nx-strong" to={`/usuarios/${u.id}`}>{u.name}</Link> <UserBadges u={u} />
                      <div className="nx-muted" style={{ fontSize: 12 }}>{u.email}</div>
                    </td>
                    <td>
                      {u.memberships.map((m) => (
                        <div key={m.tenantId} style={{ fontSize: 13 }}>
                          <Link className="nx-link" to={`/negocios/${m.tenantId}`}>{m.tenantName}</Link> <span className="nx-muted">· {m.roleName ?? ROLE_LABELS[m.role]}{m.active ? "" : " (sin acceso)"}</span>
                        </div>
                      ))}
                    </td>
                    <td className="nx-muted" style={{ whiteSpace: "nowrap" }}>{ago(u.lastLoginAt)}</td>
                    <td className="nx-muted nx-num" style={{ whiteSpace: "nowrap" }}>{fmtDate(u.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > data.pageSize && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => set("pagina", String(p))} noun="usuarios" />}
      </div>
    </>
  );
}

export function UserDetailPage() {
  const { id = "" } = useParams();
  const toast = useToast();
  const { can } = useOperator();
  const { data: u, error, setData } = useLoad(() => get<PlatformUserDetail>(`/platform/users/${id}`), [id]);
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const act = useSubmit(async (path: string, message: string) => {
    setData(await post<PlatformUserDetail>(`/platform/users/${id}/${path}`));
    toast(message);
  });
  const resetLink = useSubmit(async () => setLink(await post<{ url: string; expiresAt: string }>(`/platform/users/${id}/reset-link`)));
  const membership = useSubmit(async (tenantId: string, body: Record<string, unknown>, message: string) => {
    setData(await patch<PlatformUserDetail>(`/platform/users/${id}/memberships/${tenantId}`, body));
    toast(message);
  });
  const toggle = useSubmit(async (disabled: boolean) => {
    setData(await patch<PlatformUserDetail>(`/platform/users/${id}`, { disabled }));
    setConfirmDisable(false);
    toast(disabled ? "Usuario desactivado: sus sesiones se cerraron" : "Usuario reactivado");
  });
  if (error) return <Alert tone="danger">{error.message}</Alert>;
  if (!u) return <div className="nx-page-loading"><span className="nx-spinner" aria-label="Cargando" /></div>;
  const failure = act.message ?? resetLink.message ?? toggle.message ?? membership.message;

  return (
    <>
      <Link className="nx-backlink" to="/usuarios"><ArrowLeft className="nx-icon" aria-hidden="true" />Usuarios</Link>
      <PageHeader title={u.name} description={<span className="nx-row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}><span>{u.email}</span><UserBadges u={u} /></span>} />
      {failure && <Alert tone="danger">{failure}</Alert>}
      {u.disabledAt && <Alert tone="danger" title="Cuenta desactivada">Desde {fmtDateTime(u.disabledAt)}. No puede iniciar sesión en ningún negocio.</Alert>}
      <div className="nx-grid-2">
        <div className="nx-stack" style={{ gap: 24 }}>
          <Card title="Negocios" description={can("users:roles") ? "Su rol en cada negocio. El propietario no se puede cambiar. Cada cambio queda en la bitácora y en la actividad del negocio." : undefined}>
            <ul className="nx-list">
              {u.memberships.map((m) => (
                <li key={m.tenantId}>
                  <span>
                    <Link className="nx-link" to={`/negocios/${m.tenantId}`}>{m.tenantName}</Link>
                    {m.tenantStatus === "suspended" && <span className="nx-muted"> · negocio suspendido</span>}
                  </span>
                  {can("users:roles") && m.role !== "owner" ? (
                    <span className="nx-row" style={{ gap: 8 }}>
                      <select
                        className="nx-select"
                        style={{ height: "var(--control-sm)", width: 200 }}
                        aria-label={`Rol en ${m.tenantName}`}
                        value={m.roleId ? `role:${m.roleId}` : m.role}
                        disabled={membership.pending}
                        onChange={(e) => void membership.submit(m.tenantId, e.target.value.startsWith("role:") ? { roleId: e.target.value.slice(5) } : { role: e.target.value, roleId: null }, "Rol cambiado")}
                      >
                        <option value="admin">{ROLE_LABELS.admin}</option>
                        <option value="cashier">{ROLE_LABELS.cashier}</option>
                        {(u.tenantRoles[m.tenantId] ?? []).length > 0 && (
                          <optgroup label="Roles del negocio">
                            {u.tenantRoles[m.tenantId]!.map((r) => <option key={r.id} value={`role:${r.id}`}>{r.name}</option>)}
                          </optgroup>
                        )}
                      </select>
                      <Button size="sm" variant="ghost" loading={membership.pending} onClick={() => void membership.submit(m.tenantId, { active: !m.active }, m.active ? "Ya no puede entrar a ese negocio" : "Acceso devuelto")}>
                        {m.active ? "Quitar acceso" : "Dar acceso"}
                      </Button>
                    </span>
                  ) : (
                    <span className="nx-muted">{m.roleName ?? ROLE_LABELS[m.role]}{m.active ? "" : " · sin acceso"}</span>
                  )}
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Inicios de sesión recientes" description="Se guardan 7 días.">
            {u.attempts.length === 0 ? <p className="nx-muted" style={{ margin: 0 }}>Sin intentos recientes.</p> : (
              <ul className="nx-list">
                {u.attempts.map((a, i) => (
                  <li key={i}>
                    <span>{a.success ? <Badge tone="success">Correcto</Badge> : <Badge tone="danger">Fallido</Badge>} <span className="nx-muted nx-mono" style={{ fontSize: 12 }}>{a.ip ?? ""}</span></span>
                    <span className="nx-muted">{fmtDateTime(a.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="nx-stack" style={{ gap: 24 }}>
          <Card title="Cuenta">
            <dl className="nx-kv">
              <div><dt>Alta</dt><dd>{fmtDate(u.createdAt)}</dd></div>
              <div><dt>Último acceso</dt><dd>{ago(u.lastLoginAt)}</dd></div>
              <div><dt>Sesiones abiertas</dt><dd>{u.sessions}</dd></div>
            </dl>
          </Card>
          {can("users:manage") && <Card title="Acciones">
            <div className="nx-stack" style={{ gap: 16 }}>
              <div className="nx-stack" style={{ gap: 4 }}>
                <div><Button onClick={() => void resetLink.submit()} loading={resetLink.pending}>Enlace para cambiar contraseña</Button></div>
                <p className="nx-help" style={{ margin: 0 }}>Vale una hora. Se le envía por correo y también lo puedes copiar para dárselo por otro medio.</p>
              </div>
              {u.locked && (
                <div className="nx-stack" style={{ gap: 4 }}>
                  <div><Button onClick={() => void act.submit("unlock", "Inicio de sesión desbloqueado")} loading={act.pending}>Desbloquear inicio de sesión</Button></div>
                  <p className="nx-help" style={{ margin: 0 }}>Tuvo 5 intentos fallidos en 15 minutos.</p>
                </div>
              )}
              <div className="nx-stack" style={{ gap: 4 }}>
                <div><Button onClick={() => void act.submit("logout-all", "Sesiones cerradas")} loading={act.pending} disabled={!u.sessions}>Cerrar todas sus sesiones</Button></div>
                <p className="nx-help" style={{ margin: 0 }}>Si perdió un dispositivo o alguien más conoce su contraseña.</p>
              </div>
              <div className="nx-stack" style={{ gap: 4 }}>
                {u.disabledAt
                  ? <div><Button variant="primary" onClick={() => void toggle.submit(false)} loading={toggle.pending}>Reactivar cuenta</Button></div>
                  : <div><Button variant="danger" onClick={() => setConfirmDisable(true)}>Desactivar cuenta</Button></div>}
                <p className="nx-help" style={{ margin: 0 }}>Desactivada, no puede entrar a ningún negocio. Sus datos no se borran.</p>
              </div>
            </div>
          </Card>}
        </div>
      </div>
      <Modal
        open={Boolean(link)}
        title="Enlace para cambiar la contraseña"
        onClose={() => setLink(null)}
        footer={<Button variant="primary" onClick={() => setLink(null)}>Listo</Button>}
      >
        {link && (
          <div className="nx-stack">
            <p style={{ margin: 0 }}>También se envió a <strong>{u.email}</strong>. Vence el {fmtDateTime(link.expiresAt)} y sirve una sola vez.</p>
            <div className="nx-copy">
              <code className="nx-copy__value nx-mono">{link.url}</code>
              <Button size="sm" onClick={() => { void navigator.clipboard?.writeText(link.url).then(() => toast("Enlace copiado")); }}><Copy className="nx-icon" aria-hidden="true" />Copiar</Button>
            </div>
            <Alert tone="warning">Compártelo solo con {u.name}: quien lo abra puede entrar a su cuenta.</Alert>
          </div>
        )}
      </Modal>
      <Modal
        open={confirmDisable}
        title={`¿Desactivar a ${u.name}?`}
        onClose={() => setConfirmDisable(false)}
        footer={<><Button onClick={() => setConfirmDisable(false)}>Cancelar</Button><Button variant="danger" loading={toggle.pending} onClick={() => void toggle.submit(true)}>Desactivar</Button></>}
      >
        <p style={{ margin: 0 }}>
          Se cierran sus sesiones y no podrá entrar a {u.memberships.length === 1 ? u.memberships[0]!.tenantName : `sus ${u.memberships.length} negocios`} hasta que la reactives.
          {u.memberships.some((m) => m.role === "owner") && " Es propietario: su negocio sigue funcionando para los demás usuarios."}
        </p>
      </Modal>
    </>
  );
}
