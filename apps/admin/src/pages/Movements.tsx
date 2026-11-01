import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { MOVEMENT_TYPE_LABELS, MOVEMENT_TYPES } from "@nexo/shared";
import { PageHeader } from "@nexo/ui";
import { useBusiness } from "../lib/business";
import { MovementsTable } from "../components/MovementsTable";

export function MovementsPage() {
  const { locations } = useBusiness();
  const [params, setParams] = useSearchParams();
  const locationId = params.get("ubicacion") ?? "";
  const type = params.get("tipo") ?? "";
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };
  const query = new URLSearchParams({ ...(locationId && { locationId }), ...(type && { type }) }).toString();
  return (
    <>
      <div>
        <Link className="nx-link" to="/inventario" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}><ArrowLeft size={14} aria-hidden="true" />Inventario</Link>
      </div>
      <PageHeader
        title="Movimientos"
        description="El Kardex: cada cambio de existencias con su motivo, saldo y responsable."
        actions={
          <div className="nx-filters">
            <select className="nx-select" aria-label="Ubicación" value={locationId} onChange={(e) => set("ubicacion", e.target.value)}>
              <option value="">Todas las ubicaciones</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <select className="nx-select" aria-label="Tipo" value={type} onChange={(e) => set("tipo", e.target.value)}>
              <option value="">Todos los tipos</option>
              {MOVEMENT_TYPES.map((t) => <option key={t} value={t}>{MOVEMENT_TYPE_LABELS[t]}</option>)}
            </select>
          </div>
        }
      />
      <MovementsTable query={query} />
    </>
  );
}
