import type { StockStatus } from "@nexo/shared";
import { Badge } from "@nexo/ui";

export function StockBadge({ status }: { status: StockStatus }) {
  if (status === "untracked") return <Badge plain>Sin inventario</Badge>;
  if (status === "out") return <Badge tone="danger">Agotado</Badge>;
  if (status === "low") return <Badge tone="warning">Stock bajo</Badge>;
  return <Badge tone="success">En stock</Badge>;
}

export function Thumb({ image, alt }: { image: string | null; alt: string }) {
  return image ? <img className="nx-thumb" src={`/files/${image}`} alt={alt} loading="lazy" /> : <div className="nx-thumb" aria-hidden="true" />;
}
