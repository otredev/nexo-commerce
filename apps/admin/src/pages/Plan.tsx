import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Check } from "lucide-react";
import { formatMoney, LIMIT_LABELS, PLAN_IDS, PLANS, type BillingInfo, type LimitKey, type PlanId } from "@nexo/shared";
import { Alert, Badge, Button, Card, Progress, useToast } from "@nexo/ui";
import { get, post } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLoad, useSubmit } from "../lib/hooks";

const STATUS: Record<BillingInfo["planStatus"], { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  active: { label: "Activo", tone: "success" },
  trialing: { label: "Periodo de prueba", tone: "success" },
  past_due: { label: "Pago pendiente", tone: "warning" },
  canceled: { label: "Cancelado", tone: "neutral" },
};
const RANK: Record<PlanId, number> = { free: 0, pro: 1, business: 2 };
const day = (iso: string) => new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });

export function PlanTab() {
  const { can, refresh } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const { data, error, reload } = useLoad(() => get<BillingInfo>("/billing"));
  const owner = can("billing:write");

  // Back from Stripe Checkout: the webhook updates the plan within seconds.
  useEffect(() => {
    if (params.get("pago") !== "ok") return;
    toast("¡Gracias! Tu plan se actualiza en unos segundos.");
    const next = new URLSearchParams(params);
    next.delete("pago");
    setParams(next, { replace: true });
    const timers = [2500, 7000].map((ms) => setTimeout(() => { void reload(); void refresh(); }, ms));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const go = useSubmit(async (action: { plan: PlanId } | "portal") => {
    const res = action === "portal" ? await post<{ url: string }>("/billing/portal") : await post<{ url: string }>("/billing/checkout", action);
    window.location.assign(res.url);
  });

  if (error) return <Alert tone="danger">{error.message}</Alert>;
  if (!data) return <div className="nx-page-loading"><span className="nx-spinner" aria-label="Cargando" /></div>;
  const current = PLANS[data.plan];
  const status = STATUS[data.planStatus];

  return (
    <div className="nx-stack" style={{ gap: 24 }}>
      {go.message && <Alert tone="danger">{go.message}</Alert>}
      {data.planStatus === "past_due" && (
        <Alert tone="warning" title="No pudimos cobrar tu suscripción">
          Actualiza tu tarjeta para no perder las funciones de tu plan. {owner && data.hasSubscription && <button type="button" className="nx-link" style={{ border: 0, background: "none", padding: 0, font: "inherit", cursor: "pointer" }} onClick={() => void go.submit("portal")}>Actualizar forma de pago</button>}
        </Alert>
      )}
      <Card
        title={<span className="nx-row" style={{ gap: 8 }}>Plan {current.name} <Badge tone={status.tone}>{status.label}</Badge></span>}
        description={data.periodEnd && data.hasSubscription ? `Se renueva el ${day(data.periodEnd)}.` : current.description}
        actions={owner && data.hasSubscription && <Button loading={go.pending} onClick={() => void go.submit("portal")}>Administrar suscripción</Button>}
      >
        <div className="nx-plan-usage">
          {(Object.keys(LIMIT_LABELS) as LimitKey[]).map((key) => {
            const limit = current.limits[key];
            const used = data.usage[key];
            const full = limit !== null && used >= limit;
            return (
              <div key={key} className="nx-stack" style={{ gap: 6 }}>
                <div className="nx-row" style={{ justifyContent: "space-between", fontSize: 13 }}>
                  <span style={{ textTransform: "capitalize" }}>{LIMIT_LABELS[key].many}</span>
                  <span className="nx-num" style={{ color: full ? "var(--danger)" : undefined }}>{used.toLocaleString("es-MX")}{limit === null ? " · sin límite" : ` de ${limit.toLocaleString("es-MX")}`}</span>
                </div>
                <Progress value={limit === null ? 0 : used / limit} label={`${LIMIT_LABELS[key].many} usados`} />
              </div>
            );
          })}
        </div>
      </Card>

      <div className="nx-plan-grid">
        {PLAN_IDS.map((id) => {
          const p = PLANS[id];
          const isCurrent = id === data.plan;
          const upgrade = RANK[id] > RANK[data.plan];
          let action = null;
          if (owner && !isCurrent && id !== "free") {
            action = data.hasSubscription ? (
              <Button block loading={go.pending} onClick={() => void go.submit("portal")}>Cambiar a {p.name}</Button>
            ) : (
              <Button block variant={upgrade ? "primary" : "secondary"} loading={go.pending} disabled={!data.billingAvailable} onClick={() => void go.submit({ plan: id })}>Elegir {p.name}</Button>
            );
          } else if (owner && !isCurrent && id === "free" && data.hasSubscription) {
            action = <Button block variant="ghost" loading={go.pending} onClick={() => void go.submit("portal")}>Cancelar suscripción</Button>;
          }
          return (
            <section key={id} className="nx-plan" data-current={isCurrent} aria-label={`Plan ${p.name}`}>
              <div className="nx-row" style={{ justifyContent: "space-between" }}>
                <h3 className="nx-plan__name">{p.name}</h3>
                {isCurrent && <Badge tone="success">Tu plan</Badge>}
              </div>
              <div className="nx-plan__price">
                <span className="nx-num">{formatMoney(p.priceCents, "MXN", "es-MX")}</span><span className="nx-muted"> / mes</span>
              </div>
              <p className="nx-muted" style={{ margin: 0, fontSize: 13 }}>{p.description}</p>
              <ul className="nx-plan__features">
                {p.features.map((f) => <li key={f}><Check className="nx-icon" aria-hidden="true" />{f}</li>)}
              </ul>
              {action && <div style={{ marginTop: "auto" }}>{action}</div>}
            </section>
          );
        })}
      </div>
      {!data.billingAvailable && owner && <p className="nx-help" style={{ margin: 0 }}>El pago en línea de planes todavía no está habilitado. Escríbenos y cambiamos tu plan manualmente.</p>}
      {!owner && <p className="nx-help" style={{ margin: 0 }}>Solo el propietario puede cambiar el plan.</p>}
      <p className="nx-help" style={{ margin: 0 }}>Precios en pesos mexicanos con IVA incluido. Si bajas de plan conservas todo lo que ya tienes; solo no podrás agregar más de lo que permite el nuevo plan.</p>
    </div>
  );
}
