import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, LogIn } from "lucide-react";
import {
  formatMoney, PLANS, ROLE_LABELS, SUPPORT_ACCESS_MINUTES, TICKET_STATUS_LABELS_OPERATOR, type PlanId, type PlatformTenantDetail,
} from "@nexo/shared";
import { Alert, Badge, Button, Card, Modal, PageHeader, SelectField, Stat, TextField, useToast } from "@nexo/ui";
import { get, patch, post } from "../../lib/api";
import { useLoad, useSubmit } from "../../lib/hooks";
import { ago, fmtDate } from "../auth";
import { AuditList } from "./Audit";
import { TENANT_STATUS_BADGE } from "./Tenants";
import { TicketStatusBadge } from "./Tickets";

export function TenantDetailPage() {
  const { id = "" } = useParams();
  const toast = useToast();
  const { data: t, error, setData } = useLoad(() => get<PlatformTenantDetail>(`/platform/tenants/${id}`), [id]);
  const [plan, setPlan] = useState<PlanId>("free");
  const [reason, setReason] = useState("");
  const [binding, setBinding] = useState("");
  const [confirmMove, setConfirmMove] = useState(false);
  const [enter, setEnter] = useState(false);
  useEffect(() => {
    if (!t) return;
    setPlan(t.plan);
    setBinding((b) => b || (t.availableBindings.find((x) => x !== t.dbBinding) ?? ""));
  }, [t]);
  const update = useSubmit(async (body: Record<string, unknown>, message: string) => {
    setData(await patch<PlatformTenantDetail>(`/platform/tenants/${id}`, body));
    setReason("");
    toast(message);
  });
  const move = useSubmit(async () => {
    const res = await post<{ result: { rows: number; ms: number }; tenant: PlatformTenantDetail }>(`/platform/tenants/${id}/move`, { binding });
    setData(res.tenant);
    setConfirmMove(false);
    toast(`Negocio movido a ${binding}: ${res.result.rows.toLocaleString("es-MX")} registros en ${(res.result.ms / 1000).toFixed(1)} s`);
  });
  if (error) return <Alert tone="danger">{error.message}</Alert>;
  if (!t) return <div className="nx-page-loading"><span className="nx-spinner" aria-label="Cargando" /></div>;
  const money = (c: number) => formatMoney(c, t.currency);
  const busy = update.pending || move.pending;

  return (
    <>
      <Link className="nx-backlink" to="/negocios"><ArrowLeft className="nx-icon" aria-hidden="true" />Negocios</Link>
      <PageHeader
        title={t.name}
        description={<span className="nx-row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>{TENANT_STATUS_BADGE[t.status]}<Badge plain>{PLANS[t.plan].name}</Badge><span className="nx-mono nx-muted">/{t.slug}</span><span className="nx-muted">· desde {fmtDate(t.createdAt)}</span></span>}
        actions={<Button variant="primary" onClick={() => setEnter(true)} disabled={t.status !== "active"} title={t.status !== "active" ? "Solo con el negocio activo" : undefined}><LogIn className="nx-icon" aria-hidden="true" />Entrar como negocio</Button>}
      />
      {t.status === "suspended" && <Alert tone="danger" title="Negocio suspendido">{t.suspendedReason ? `Motivo: ${t.suspendedReason}` : "Sin motivo registrado."} Su panel y su tienda están en pausa.</Alert>}
      {(update.message || move.message) && <Alert tone="danger">{update.message ?? move.message}</Alert>}

      <div className="nx-stat-grid">
        <Stat label="Usuarios activos" value={t.usage.users} meta={`${t.usage.locations} ${t.usage.locations === 1 ? "ubicación" : "ubicaciones"}`} />
        <Stat label="Productos" value={t.usage.products.toLocaleString("es-MX")} meta={`Límite del plan: ${PLANS[t.plan].limits.products === null ? "sin límite" : PLANS[t.plan].limits.products!.toLocaleString("es-MX")}`} />
        <Stat label="Ventas de 30 días" value={t.usage.sales30d.toLocaleString("es-MX")} meta={money(t.usage.sales30dCents)} />
        <Stat label="Pedidos en línea de 30 días" value={t.usage.orders30d.toLocaleString("es-MX")} />
      </div>

      <div className="nx-grid-2">
        <div className="nx-stack" style={{ gap: 24 }}>
          <Card title="Personas" description="Quién tiene acceso a este negocio.">
            <div className="nx-table-scroll">
              <table className="nx-table nx-table--flush">
                <thead><tr><th>Nombre</th><th>Rol</th><th>Último acceso</th></tr></thead>
                <tbody>
                  {t.people.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <Link className="nx-link nx-strong" to={`/usuarios/${p.id}`}>{p.name}</Link>
                        <div className="nx-muted" style={{ fontSize: 12 }}>{p.email}</div>
                      </td>
                      <td>{ROLE_LABELS[p.role]}{!p.active && <> <Badge plain>Sin acceso</Badge></>}{p.disabled && <> <Badge tone="danger">Desactivado</Badge></>}</td>
                      <td className="nx-muted">{ago(p.lastLoginAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title="Tickets de soporte" actions={<Link className="nx-link" to={`/soporte?negocio=${t.id}`}>Ver todos</Link>}>
            {t.tickets.length === 0 ? <p className="nx-muted" style={{ margin: 0 }}>Este negocio no ha abierto tickets.</p> : (
              <ul className="nx-list">
                {t.tickets.map((k) => (
                  <li key={k.id}>
                    <Link className="nx-link" to={`/soporte/${k.id}`}>#{k.number} · {k.subject}</Link>
                    <span className="nx-row" style={{ gap: 8 }}><TicketStatusBadge status={k.status} /><span className="nx-muted">{ago(k.lastMessageAt)}</span></span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Bitácora del negocio" description="Lo que el equipo de Nexo hizo con este negocio." actions={<Link className="nx-link" to={`/bitacora?negocio=${t.id}`}>Ver todo</Link>}>
            <AuditList items={t.log} empty="Sin movimientos de la plataforma todavía." hideTenant />
          </Card>
        </div>

        <div className="nx-stack" style={{ gap: 24 }}>
          <Card title="Plan">
            <div className="nx-stack" style={{ gap: 8 }}>
              <SelectField label="Plan asignado" value={plan} onChange={(e) => setPlan(e.target.value as PlanId)}>
                {Object.values(PLANS).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </SelectField>
              <div><Button disabled={plan === t.plan || busy} loading={update.pending} onClick={() => void update.submit({ plan }, `Plan cambiado a ${PLANS[plan].name}`)}>Cambiar plan</Button></div>
              <p className="nx-help" style={{ margin: 0 }}>
                {t.planStatus === "past_due" ? "Tiene un pago pendiente en Stripe. " : ""}
                Para cortesías o acuerdos fuera de Stripe. Si tiene suscripción, Stripe vuelve a fijar el plan en su próxima renovación{t.planPeriodEnd ? ` (${fmtDate(t.planPeriodEnd)})` : ""}.
              </p>
            </div>
          </Card>
          <Card title="Acceso">
            {t.status === "suspended" ? (
              <div><Button variant="primary" loading={update.pending} disabled={busy} onClick={() => void update.submit({ status: "active" }, "Negocio reactivado")}>Reactivar</Button></div>
            ) : (
              <div className="nx-stack" style={{ gap: 8 }}>
                <TextField label="Motivo" optional value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Pago vencido, uso indebido…" help="El negocio lo ve en su pantalla de suspensión." />
                <div><Button variant="danger" loading={update.pending} disabled={busy || t.status !== "active"} onClick={() => void update.submit({ status: "suspended", suspendedReason: reason || null }, "Negocio suspendido")}>Suspender</Button></div>
                <p className="nx-help" style={{ margin: 0 }}>Su panel y su tienda en línea quedan en pausa; los datos no se borran.</p>
              </div>
            )}
          </Card>
          <Card title="Base de datos">
            <div className="nx-stack" style={{ gap: 8 }}>
              <p style={{ margin: 0 }}>Vive en <span className="nx-mono">{t.dbBinding}</span>.</p>
              {t.availableBindings.length < 2 ? (
                <p className="nx-help" style={{ margin: 0 }}>Este entorno solo tiene una base de datos de negocios. Agrega otra (DB_TENANT_…) en wrangler.jsonc para poder moverlo.</p>
              ) : (
                <>
                  <SelectField label="Mover a" value={binding} onChange={(e) => { setBinding(e.target.value); setConfirmMove(false); }}>
                    {t.availableBindings.filter((b) => b !== t.dbBinding).map((b) => <option key={b} value={b}>{b}</option>)}
                  </SelectField>
                  <div>
                    {!confirmMove
                      ? <Button disabled={!binding || busy || t.status === "migrating"} onClick={() => setConfirmMove(true)}>Mover…</Button>
                      : <Button variant="primary" loading={move.pending} onClick={() => void move.submit()}>Confirmar y mover</Button>}
                  </div>
                  <p className="nx-help" style={{ margin: 0 }}>Copia todos sus registros, los verifica y cambia la base de datos del negocio. Mientras tanto su panel muestra “Estamos moviendo tus datos”.</p>
                </>
              )}
            </div>
          </Card>
          <Card title="Datos técnicos">
            <dl className="nx-kv">
              <div><dt>ID</dt><dd className="nx-mono" style={{ fontSize: 12 }}>{t.id}</dd></div>
              <div><dt>Dominios</dt><dd>{t.domains.length ? t.domains.join(", ") : "—"}</dd></div>
              <div><dt>Cliente de Stripe</dt><dd className="nx-mono" style={{ fontSize: 12 }}>{t.stripeCustomerId ?? "—"}</dd></div>
              <div><dt>Cuenta Connect</dt><dd className="nx-mono" style={{ fontSize: 12 }}>{t.stripeAccountId ?? "—"}</dd></div>
            </dl>
          </Card>
        </div>
      </div>
      <EnterModal tenant={t} open={enter} onClose={() => setEnter(false)} />
    </>
  );
}

/** "Entrar como negocio": opens the business panel in a new tab, as its owner, for one hour. */
export function EnterModal({ tenant, open, onClose, ticketId = null }: { tenant: Pick<PlatformTenantDetail, "id" | "name" | "tickets">; open: boolean; onClose: () => void; ticketId?: string | null }) {
  const [reason, setReason] = useState("");
  const [ticket, setTicket] = useState<string>(ticketId ?? "");
  useEffect(() => { if (open) { setTicket(ticketId ?? tenant.tickets.find((k) => k.status !== "closed" && k.allowAccess)?.id ?? ""); setReason(""); } }, [open, ticketId, tenant.tickets]);
  const chosen = tenant.tickets.find((k) => k.id === ticket);
  const go = useSubmit(async (tab: Window | null) => {
    try {
      await post(`/platform/tenants/${tenant.id}/support-access`, { reason, ticketId: ticket || null });
    } catch (e) {
      tab?.close();
      throw e;
    }
    if (tab) tab.location.href = "/";
    else window.location.href = "/";
    onClose();
  });
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    // The tab opens on the click (browsers block it after an await) and then goes to the panel.
    const tab = window.open("about:blank", "_blank");
    void go.submit(tab);
  };
  return (
    <Modal
      open={open}
      title={`Entrar a ${tenant.name}`}
      onClose={onClose}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" form="enter-tenant" loading={go.pending}>Entrar</Button></>}
    >
      <form id="enter-tenant" className="nx-stack" onSubmit={onSubmit} noValidate>
        <p style={{ margin: 0 }}>
          Se abre su panel en otra pestaña, como su propietario, durante {SUPPORT_ACCESS_MINUTES} minutos. Todo lo que hagas queda en su actividad con tu nombre.
          No podrás cambiar su plan y pagos, usuarios, llaves de API ni contraseñas.
        </p>
        {go.message && <Alert tone="danger">{go.message}</Alert>}
        {tenant.tickets.length > 0 && (
          <SelectField label="Ticket relacionado" optional value={ticket} onChange={(e) => setTicket(e.target.value)}>
            <option value="">Ninguno</option>
            {tenant.tickets.filter((k) => k.status !== "closed" || k.id === ticketId).map((k) => (
              <option key={k.id} value={k.id}>#{k.number} · {k.subject}{k.allowAccess ? " (dio permiso)" : ""} · {TICKET_STATUS_LABELS_OPERATOR[k.status]}</option>
            ))}
          </SelectField>
        )}
        {chosen?.allowAccess
          ? <Alert tone="success">El negocio dio permiso para entrar en este ticket. Quedará anotado en la conversación.</Alert>
          : <TextField label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} error={go.fields.reason} placeholder="Revisar por qué no cuadra el corte de caja del 3 de noviembre" help="Obligatorio sin un ticket con permiso. El negocio lo verá en su actividad." />}
        <p className="nx-help" style={{ margin: 0 }}>Para salir, usa «Salir del modo soporte» en la franja de arriba del panel.</p>
      </form>
    </Modal>
  );
}
