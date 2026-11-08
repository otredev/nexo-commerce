import { useState } from "react";
import { History } from "lucide-react";
import type { AuditEntry } from "@nexo/shared";
import { Alert, Button, EmptyState, PageHeader } from "@nexo/ui";
import { get } from "../lib/api";
import { useLoad } from "../lib/hooks";

const ACTIONS: Record<string, string> = {
  "tenant.create": "Creó el negocio",
  "settings.update": "Actualizó la configuración",
  "tax.create": "Creó un impuesto",
  "tax.update": "Editó un impuesto",
  "location.create": "Creó una ubicación",
  "location.update": "Editó una ubicación",
  "user.create": "Creó un usuario",
  "user.update": "Editó un usuario",
  "support.access": "Soporte de Nexo entró a la cuenta",
  "customer.signup": "Se registró en la tienda en línea",
};

const FIELD_LABELS: Record<string, string> = {
  tradeName: "nombre comercial", legalName: "razón social", taxId: "identificación fiscal", email: "correo", phone: "teléfono",
  address: "dirección", currency: "moneda", timezone: "zona horaria", pricesIncludeTax: "precios con impuestos",
  receiptFooter: "pie de recibo", logoKey: "logotipo", name: "nombre", rateBps: "tasa", isDefault: "predeterminado",
  active: "estado", role: "rol", type: "tipo",
};

const timeFmt = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" });

function summary(entry: AuditEntry) {
  const after = entry.after as Record<string, unknown> | null;
  if (entry.action.endsWith(".update") && after) {
    const keys = Object.keys(after).map((k) => FIELD_LABELS[k] ?? k);
    return keys.length ? `Cambió ${keys.join(", ")}` : "";
  }
  if (after && typeof after.name === "string") return after.name;
  if (entry.action === "support.access" && after && typeof after.reason === "string") return `Motivo: ${after.reason}`;
  return "";
}

export function ActivityPage() {
  const [items, setItems] = useState<AuditEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const { error, loading } = useLoad(async () => {
    const res = await get<{ items: AuditEntry[]; nextCursor: string | null }>("/audit?limit=50");
    setItems(res.items);
    setCursor(res.nextCursor);
    return res;
  });

  const more = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    const res = await get<{ items: AuditEntry[]; nextCursor: string | null }>(`/audit?limit=50&cursor=${cursor}`);
    setItems((all) => [...all, ...res.items]);
    setCursor(res.nextCursor);
    setLoadingMore(false);
  };

  return (
    <>
      <PageHeader title="Actividad" description="Registro de los cambios importantes: quién, qué y cuándo." />
      {error && <Alert tone="danger">{error.message}</Alert>}
      <div className="nx-table-wrap">
        {!loading && items.length === 0 ? (
          <EmptyState icon={<History className="nx-icon" />} title="Sin actividad todavía" />
        ) : (
          <div className="nx-table-scroll">
            <table className="nx-table">
              <thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Detalle</th></tr></thead>
              <tbody>
                {items.map((e) => (
                  <tr key={e.id}>
                    <td className="nx-muted nx-num" style={{ whiteSpace: "nowrap" }}>{timeFmt.format(new Date(e.createdAt))}</td>
                    <td>{e.userName ?? "Sistema"}</td>
                    <td>{ACTIONS[e.action] ?? e.action}</td>
                    <td className="nx-muted">{summary(e)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {cursor && <div className="nx-table-footer"><span>{items.length} registros</span><Button size="sm" loading={loadingMore} onClick={() => void more()}>Cargar más</Button></div>}
      </div>
    </>
  );
}
