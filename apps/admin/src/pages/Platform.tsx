import { useEffect, useState, type ReactElement } from "react";
import { Navigate } from "react-router-dom";
import { Building2 } from "lucide-react";
import { formatMoney, PLANS, type PlanId, type PlatformTenant, type PlatformTenantDetail } from "@nexo/shared";
import { Alert, Badge, Button, EmptyState, Modal, PageHeader, SearchInput, Segmented, SelectField, Stat, TextField, useDebounced, useToast } from "@nexo/ui";
import { get, patch, post } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLoad, useSubmit } from "../lib/hooks";

type StatusFilter = "all" | "active" | "suspended";
const STATUS_BADGE: Record<PlatformTenant["status"], ReactElement> = {
  active: <Badge tone="success">Activo</Badge>,
  suspended: <Badge tone="danger">Suspendido</Badge>,
  migrating: <Badge tone="warning">Moviendo</Badge>,
  provisioning: <Badge plain>Creándose</Badge>,
};
const day = (iso: string) => new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });

export function PlatformPage() {
  const { me } = useAuth();
  if (!me?.platformAdmin) return <Navigate to="/" replace />;
  return <Platform selfId={me.tenant.id} />;
}

function Platform({ selfId }: { selfId: string }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const query = useDebounced(q);
  const search = new URLSearchParams({ status, ...(query.trim() && { q: query.trim() }) });
  const { data, error, loading, reload } = useLoad(
    () => get<{ items: PlatformTenant[]; totals: { total: number; active: number; suspended: number; paying: number } }>(`/platform/tenants?${search}`),
    [search.toString()],
  );
  return (
    <>
      <PageHeader title="Negocios en la plataforma" description="Planes, suspensiones y en qué base de datos vive cada negocio." />
      {error && <Alert tone="danger">{error.message}</Alert>}
      {data && (
        <div className="nx-stat-grid">
          <Stat label="Negocios" value={data.totals.total} />
          <Stat label="Activos" value={data.totals.active} />
          <Stat label="De pago" value={data.totals.paying} />
          <Stat label="Suspendidos" value={data.totals.suspended} />
        </div>
      )}
      <div className="nx-table-wrap">
        <div className="nx-table-toolbar">
          <SearchInput value={q} onChange={setQ} placeholder="Buscar por nombre o dirección" label="Buscar negocio" />
          <Segmented label="Estado" value={status} onChange={setStatus} options={[{ id: "all", label: "Todos" }, { id: "active", label: "Activos" }, { id: "suspended", label: "Suspendidos" }]} />
        </div>
        {data && data.items.length === 0 ? (
          <EmptyState icon={<Building2 className="nx-icon" />} title="Ningún negocio coincide" />
        ) : (
          <div className="nx-table-scroll" aria-busy={loading}>
            <table className="nx-table">
              <thead><tr><th>Negocio</th><th>Propietario</th><th>Plan</th><th>Estado</th><th>Base de datos</th><th>Alta</th></tr></thead>
              <tbody>
                {data?.items.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <button type="button" className="nx-link" style={{ border: 0, background: "none", padding: 0, font: "inherit", fontWeight: 500, cursor: "pointer" }} onClick={() => setOpenId(t.id)}>{t.name}</button>
                      <div className="nx-muted nx-mono" style={{ fontSize: 12 }}>/{t.slug}{t.domains.length ? ` · ${t.domains.join(", ")}` : ""}</div>
                    </td>
                    <td>{t.owner ? <><div>{t.owner.name}</div><div className="nx-muted" style={{ fontSize: 12 }}>{t.owner.email}</div></> : "—"}</td>
                    <td>{PLANS[t.plan].name}{t.planStatus === "past_due" && <> <Badge tone="warning">Pago pendiente</Badge></>}</td>
                    <td>{STATUS_BADGE[t.status]}</td>
                    <td className="nx-mono nx-muted" style={{ fontSize: 12 }}>{t.dbBinding}</td>
                    <td className="nx-muted nx-num" style={{ whiteSpace: "nowrap" }}>{day(t.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <TenantModal id={openId} selfId={selfId} onClose={() => setOpenId(null)} onChanged={() => void reload()} />
    </>
  );
}

function TenantModal({ id, selfId, onClose, onChanged }: { id: string | null; selfId: string; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [t, setT] = useState<PlatformTenantDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [plan, setPlan] = useState<PlanId>("free");
  const [binding, setBinding] = useState("");
  const [confirmMove, setConfirmMove] = useState(false);
  useEffect(() => {
    setT(null);
    setLoadError(null);
    setConfirmMove(false);
    setReason("");
    if (!id) return;
    get<PlatformTenantDetail>(`/platform/tenants/${id}`).then((d) => { setT(d); setPlan(d.plan); setBinding(d.availableBindings.find((b) => b !== d.dbBinding) ?? ""); }, (e: Error) => setLoadError(e.message));
  }, [id]);
  const update = useSubmit(async (body: Record<string, unknown>, message: string) => {
    setT(await patch<PlatformTenantDetail>(`/platform/tenants/${id}`, body));
    toast(message);
    onChanged();
  });
  const move = useSubmit(async () => {
    const res = await post<{ result: { rows: number; tables: number; ms: number }; tenant: PlatformTenantDetail }>(`/platform/tenants/${id}/move`, { binding });
    setT(res.tenant);
    setConfirmMove(false);
    toast(`Negocio movido a ${binding}: ${res.result.rows.toLocaleString("es-MX")} registros en ${(res.result.ms / 1000).toFixed(1)} s`);
    onChanged();
  });
  if (!id) return null;
  const money = (c: number) => formatMoney(c, "MXN", "es-MX");
  const busy = update.pending || move.pending;

  return (
    <Modal open title={t?.name ?? "Negocio"} onClose={onClose} size="lg" footer={<Button onClick={onClose}>Cerrar</Button>}>
      {loadError && <Alert tone="danger">{loadError}</Alert>}
      {!t && !loadError && <div className="nx-page-loading"><span className="nx-spinner" aria-label="Cargando" /></div>}
      {t && (
        <div className="nx-stack" style={{ gap: 20 }}>
          {(update.message || move.message) && <Alert tone="danger">{update.message ?? move.message}</Alert>}
          <dl className="nx-kv">
            <div><dt>Dirección</dt><dd className="nx-mono">/{t.slug}</dd></div>
            <div><dt>Estado</dt><dd>{STATUS_BADGE[t.status]}</dd></div>
            <div><dt>Propietario</dt><dd>{t.owner ? `${t.owner.name} · ${t.owner.email}` : "—"}</dd></div>
            <div><dt>Usuarios · ubicaciones · productos</dt><dd className="nx-num">{t.usage.users} · {t.usage.locations} · {t.usage.products.toLocaleString("es-MX")}</dd></div>
            <div><dt>Ventas de 30 días</dt><dd className="nx-num">{t.usage.sales30d.toLocaleString("es-MX")} · {money(t.usage.sales30dCents)}</dd></div>
            <div><dt>Pedidos en línea de 30 días</dt><dd className="nx-num">{t.usage.orders30d.toLocaleString("es-MX")}</dd></div>
            <div><dt>Stripe</dt><dd className="nx-mono" style={{ fontSize: 12 }}>{[t.stripeCustomerId, t.stripeAccountId].filter(Boolean).join(" · ") || "—"}</dd></div>
          </dl>

          <section className="nx-stack" style={{ gap: 8 }}>
            <h3 className="nx-label" style={{ margin: 0 }}>Plan</h3>
            <div className="nx-row" style={{ gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
              <SelectField label="Plan asignado" value={plan} onChange={(e) => setPlan(e.target.value as PlanId)} fieldClassName="nx-grow">
                {Object.values(PLANS).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </SelectField>
              <Button disabled={plan === t.plan || busy} loading={update.pending} onClick={() => void update.submit({ plan }, `Plan cambiado a ${PLANS[plan].name}`)}>Cambiar plan</Button>
            </div>
            <p className="nx-help" style={{ margin: 0 }}>Para cortesías o acuerdos fuera de Stripe. Si el negocio tiene suscripción, Stripe vuelve a fijar el plan en su próxima renovación.</p>
          </section>

          <section className="nx-stack" style={{ gap: 8 }}>
            <h3 className="nx-label" style={{ margin: 0 }}>Acceso</h3>
            {t.status === "suspended" ? (
              <>
                {t.suspendedReason && <p style={{ margin: 0 }}>Motivo: {t.suspendedReason}</p>}
                <div><Button variant="primary" loading={update.pending} disabled={busy} onClick={() => void update.submit({ status: "active" }, "Negocio reactivado")}>Reactivar</Button></div>
              </>
            ) : (
              <>
                <TextField label="Motivo" optional value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Pago vencido, uso indebido…" help="El negocio lo ve en su pantalla de suspensión." />
                <div><Button variant="danger" loading={update.pending} disabled={busy || t.id === selfId || t.status !== "active"} onClick={() => void update.submit({ status: "suspended", suspendedReason: reason || null }, "Negocio suspendido")}>Suspender</Button></div>
                <p className="nx-help" style={{ margin: 0 }}>Su panel y su tienda en línea quedan en pausa; los datos no se borran.</p>
              </>
            )}
          </section>

          <section className="nx-stack" style={{ gap: 8 }}>
            <h3 className="nx-label" style={{ margin: 0 }}>Base de datos</h3>
            <p style={{ margin: 0 }}>Vive en <span className="nx-mono">{t.dbBinding}</span>.</p>
            {t.availableBindings.length < 2 ? (
              <p className="nx-help" style={{ margin: 0 }}>Este entorno solo tiene una base de datos de negocios. Agrega otra (DB_TENANT_…) en wrangler.jsonc para poder moverlo.</p>
            ) : (
              <>
                <div className="nx-row" style={{ gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                  <SelectField label="Mover a" value={binding} onChange={(e) => { setBinding(e.target.value); setConfirmMove(false); }} fieldClassName="nx-grow">
                    {t.availableBindings.filter((b) => b !== t.dbBinding).map((b) => <option key={b} value={b}>{b}</option>)}
                  </SelectField>
                  {!confirmMove ? (
                    <Button disabled={!binding || busy || t.status === "migrating"} onClick={() => setConfirmMove(true)}>Mover…</Button>
                  ) : (
                    <Button variant="primary" loading={move.pending} onClick={() => void move.submit()}>Confirmar y mover</Button>
                  )}
                </div>
                <p className="nx-help" style={{ margin: 0 }}>Copia todos sus registros, los verifica y cambia la base de datos del negocio. Mientras tanto su panel muestra “Estamos moviendo tus datos”.</p>
              </>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}
