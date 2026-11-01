/**
 * SaaS plans. Prices are shown here; the real charge is the Stripe price configured per plan
 * (env STRIPE_PRICE_PRO / STRIPE_PRICE_BUSINESS). null = unlimited.
 */
export const PLAN_IDS = ["free", "pro", "business"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export interface PlanLimits {
  users: number | null;
  locations: number | null;
  products: number | null;
  /** Card payments in the online store through Stripe. */
  cardPayments: boolean;
  /** The store on the business's own domain. */
  customDomain: boolean;
}

export interface PlanInfo {
  id: PlanId;
  name: string;
  /** Monthly price in MXN cents, for display. */
  priceCents: number;
  description: string;
  limits: PlanLimits;
  features: string[];
}

export const PLANS: Record<PlanId, PlanInfo> = {
  free: {
    id: "free",
    name: "Gratis",
    priceCents: 0,
    description: "Para empezar a vender.",
    limits: { users: 2, locations: 1, products: 100, cardPayments: false, customDomain: false },
    features: ["Punto de venta y caja", "Inventario y compras", "Tienda en línea en nexo", "Hasta 100 productos y 2 usuarios"],
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceCents: 49900,
    description: "Para el negocio que ya crece.",
    limits: { users: 10, locations: 3, products: 5000, cardPayments: true, customDomain: true },
    features: ["Todo lo del plan Gratis", "Cobro con tarjeta en la tienda", "Tu propio dominio", "Hasta 3 ubicaciones y 10 usuarios"],
  },
  business: {
    id: "business",
    name: "Negocio",
    priceCents: 129900,
    description: "Varias sucursales y mucho catálogo.",
    limits: { users: null, locations: 20, products: null, cardPayments: true, customDomain: true },
    features: ["Todo lo del plan Pro", "Productos y usuarios ilimitados", "Hasta 20 ubicaciones", "Base de datos propia a solicitud"],
  },
};

export const planOf = (id: string | null | undefined): PlanInfo => PLANS[(PLAN_IDS as readonly string[]).includes(id ?? "") ? (id as PlanId) : "free"];

export type LimitKey = "users" | "locations" | "products";
export const LIMIT_LABELS: Record<LimitKey, { one: string; many: string }> = {
  users: { one: "usuario", many: "usuarios" },
  locations: { one: "ubicación", many: "ubicaciones" },
  products: { one: "producto", many: "productos" },
};

/** Can one more be added? */
export const withinLimit = (limit: number | null, current: number, adding = 1) => limit === null || current + adding <= limit;

/** The plan that applies: a canceled subscription drops to free; past_due keeps the plan while Stripe retries. */
export const effectivePlan = (plan: string | null | undefined, status: string | null | undefined): PlanId =>
  status === "canceled" ? "free" : planOf(plan).id;
