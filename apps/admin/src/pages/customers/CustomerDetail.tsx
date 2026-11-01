import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Archive, Mail, MessageCircle, Pencil, Phone } from "lucide-react";
import { formatFolio, formatQty, whatsappLink, type CustomerDetail } from "@nexo/shared";
import { Alert, Badge, Button, Card, PageHeader, Stat, useToast } from "@nexo/ui";
import { get, post } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useBusiness } from "../../lib/business";
import { useLoad, useSubmit } from "../../lib/hooks";
import { BackLink, dateFmt, dateTimeFmt } from "../../components/docs";
import { CustomerModal, SOURCE_LABEL } from "./Customers";

const STATUS: Record<string, { label: string; tone: "success" | "danger" | "warning" | "info" | "neutral" }> = {
  completed: { label: "Completada", tone: "success" },
  voided: { label: "Anulada", tone: "danger" },
  pending: { label: "Nuevo", tone: "warning" },
  confirmed: { label: "Aceptado", tone: "info" },
  ready: { label: "Listo", tone: "info" },
  cancelled: { label: "Cancelado", tone: "danger" },
};

export function CustomerDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const { money } = useBusiness();
  const toast = useToast();
  const navigate = useNavigate();
  const { data: c, error, reload } = useLoad(() => get<CustomerDetail>(`/customers/${id}`), [id]);
  const [editing, setEditing] = useState(false);
  const archive = useSubmit(async () => {
    await post(`/customers/${id}/archive`, { archived: !c!.archived });
    toast(c!.archived ? "Cliente restaurado" : "Cliente archivado");
    await reload();
  });
  if (error) return <Alert tone="danger">{error.status === 404 ? "Este cliente no existe." : error.message}</Alert>;
  if (!c) return <div className="nx-page-loading"><span className="nx-spinner" aria-label="Cargando" /></div>;
  const daysSince = c.lastPurchaseAt ? Math.floor((Date.now() - new Date(c.lastPurchaseAt).getTime()) / 86_400_000) : null;

  return (
    <>
      <BackLink to="/clientes">Clientes</BackLink>
      <PageHeader
        title={c.name}
        description={<span className="nx-row" style={{ gap: 8 }}>{c.archived && <Badge>Archivado</Badge>}<span>Cliente desde {dateFmt.format(new Date(c.createdAt))} · {SOURCE_LABEL[c.source]}</span></span>}
        actions={can("customers:write") && (
          <>
            <Button variant="ghost" loading={archive.pending} onClick={() => void archive.submit()}><Archive className="nx-icon" aria-hidden="true" />{c.archived ? "Restaurar" : "Archivar"}</Button>
            <Button onClick={() => setEditing(true)}><Pencil className="nx-icon" aria-hidden="true" />Editar</Button>
          </>
        )}
      />
      <div className="nx-stat-grid">
        <Stat label="Total comprado" value={money(c.totalCents)} meta={`${c.purchases} ${c.purchases === 1 ? "compra" : "compras"}`} />
        <Stat label="Ticket promedio" value={c.purchases ? money(c.avgTicketCents) : "—"} />
        <Stat label="Última compra" value={daysSince === null ? "—" : daysSince === 0 ? "Hoy" : `Hace ${daysSince} ${daysSince === 1 ? "día" : "días"}`} meta={c.lastPurchaseAt ? dateFmt.format(new Date(c.lastPurchaseAt)) : "Sin compras"} />
      </div>
      <div className="nx-grid-doc">
        <div className="nx-table-wrap">
          <div className="nx-table-toolbar"><span style={{ fontWeight: 600 }}>Historial</span></div>
          {c.history.length === 0 ? (
            <p className="nx-muted" style={{ padding: "8px 16px 20px", margin: 0 }}>Aún no tiene compras. Elígelo en la caja al cobrar para registrarlas aquí.</p>
          ) : (
            <div className="nx-table-scroll">
              <table className="nx-table">
                <thead><tr><th>Fecha</th><th>Folio</th><th>Canal</th><th>Estado</th><th className="nx-col-num">Total</th></tr></thead>
                <tbody>
                  {c.history.map((h) => (
                    <tr key={h.id} className="nx-clickable" onClick={() => navigate(h.kind === "sale" ? `/ventas/${h.id}` : `/pedidos/${h.id}`)}>
                      <td className="nx-num nx-muted" style={{ whiteSpace: "nowrap" }}>{dateTimeFmt.format(new Date(h.date))}</td>
                      <td className="nx-mono">{h.kind === "sale" ? formatFolio(h.number) : `#${String(h.number).padStart(6, "0")}`}</td>
                      <td className="nx-muted">{h.channelLabel} · {h.items} {h.items === 1 ? "producto" : "productos"}</td>
                      <td><Badge tone={STATUS[h.status]?.tone ?? "neutral"}>{STATUS[h.status]?.label ?? h.status}</Badge></td>
                      <td className="nx-col-num">{money(h.totalCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="nx-stack" style={{ gap: 24 }}>
          <Card title="Contacto">
            <div className="nx-stack" style={{ gap: 12 }}>
              <dl className="nx-kv">
                <div><dt>Teléfono</dt><dd>{c.phone ?? "—"}</dd></div>
                <div><dt>Correo</dt><dd>{c.email ?? "—"}</dd></div>
                {c.taxId && <div><dt>RFC</dt><dd className="nx-mono">{c.taxId}</dd></div>}
                {c.address && <div><dt>Dirección</dt><dd>{c.address}</dd></div>}
                <div><dt>Promociones</dt><dd>{c.acceptsMarketing ? "Acepta recibirlas" : "No"}</dd></div>
              </dl>
              <div className="nx-row" style={{ gap: 8, flexWrap: "wrap" }}>
                {c.phone && <a className="nx-btn nx-btn--secondary nx-btn--sm" href={whatsappLink(c.phone, `Hola ${c.name.split(" ")[0]}`)} target="_blank" rel="noreferrer"><MessageCircle className="nx-icon" aria-hidden="true" />WhatsApp</a>}
                {c.phone && <a className="nx-btn nx-btn--ghost nx-btn--sm" href={`tel:${c.phone}`}><Phone className="nx-icon" aria-hidden="true" />Llamar</a>}
                {c.email && <a className="nx-btn nx-btn--ghost nx-btn--sm" href={`mailto:${c.email}`}><Mail className="nx-icon" aria-hidden="true" />Correo</a>}
              </div>
              {c.notes && <Alert tone="info">{c.notes}</Alert>}
            </div>
          </Card>
          {c.topProducts.length > 0 && (
            <Card title="Lo que más compra">
              <div className="nx-stack" style={{ gap: 10 }}>
                {c.topProducts.map((p) => (
                  <div key={p.productId} className="nx-row" style={{ justifyContent: "space-between", fontSize: 13 }}>
                    <span><Link to={`/productos/${p.productId}`} style={{ color: "inherit", textDecoration: "none" }}>{p.name}</Link><span className="nx-muted"> · {formatQty(p.quantity, p.unit)}</span></span>
                    <span className="nx-num">{money(p.totalCents)}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
      <CustomerModal customer={editing ? c : null} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void reload(); }} />
    </>
  );
}
