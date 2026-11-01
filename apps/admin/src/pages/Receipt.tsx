import { useEffect } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { formatFolio, formatQty, paymentLabel, type SaleDetail } from "@nexo/shared";
import { Button } from "@nexo/ui";
import { get } from "../lib/api";
import { useBusiness } from "../lib/business";
import { useLoad } from "../lib/hooks";

/** Thermal-printer receipt (58 or 80 mm). Opens the print dialog when ?imprimir=1. */
export function ReceiptPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { settings, money } = useBusiness();
  const { data: sale, error } = useLoad(() => get<SaleDetail>(`/sales/${id}`), [id]);
  const width = settings?.receiptWidthMm ?? 80;
  const ready = Boolean(sale && settings);

  useEffect(() => {
    if (!ready || params.get("imprimir") !== "1") return;
    const t = setTimeout(() => window.print(), 300);
    return () => clearTimeout(t);
  }, [ready, params]);

  if (error) return <p style={{ padding: 24 }}>{error.message}</p>;
  if (!sale || !settings) return null;
  const when = new Date(sale.createdAt).toLocaleString(settings.locale, { timeZone: settings.timezone, dateStyle: "short", timeStyle: "short" });

  return (
    <>
      <style>{`
        @page { size: ${width}mm auto; margin: 0; }
        .rc { width: ${width - 8}mm; margin: 16px auto; padding: 4mm; background: #fff; color: #000; font: 11px/1.45 var(--font-sans); font-variant-numeric: tabular-nums; }
        .rc h1 { font: 600 14px/1.3 var(--font-sans); margin: 0; text-align: center; }
        .rc .c { text-align: center; }
        .rc .row { display: flex; justify-content: space-between; gap: 8px; }
        .rc hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
        .rc .total { font-weight: 700; font-size: 14px; }
        .rc .item { margin-bottom: 4px; }
        .rc .muted { color: #333; }
        .rc-actions { display: flex; justify-content: center; gap: 8px; margin: 16px; }
        @media print { body { background: #fff !important; } .rc { margin: 0; box-shadow: none; } .rc-actions { display: none; } }
        @media screen { .rc { box-shadow: var(--shadow-md); } }
      `}</style>
      <div className="rc-actions">
        <Button variant="primary" onClick={() => window.print()}>Imprimir</Button>
        <Button onClick={() => window.close()}>Cerrar</Button>
      </div>
      <div className="rc" role="document" aria-label={`Recibo ${formatFolio(sale.number)}`}>
        {settings.logoKey && <div className="c"><img src={`/files/${settings.logoKey}`} alt="" style={{ maxWidth: "40%", maxHeight: 48, objectFit: "contain", filter: "grayscale(1)" }} /></div>}
        <h1>{settings.tradeName}</h1>
        {settings.legalName && <div className="c">{settings.legalName}</div>}
        {settings.taxId && <div className="c">{settings.taxId}</div>}
        {settings.address && <div className="c">{settings.address}</div>}
        {settings.phone && <div className="c">{settings.phone}</div>}
        <hr />
        <div className="row"><span>Venta {formatFolio(sale.number)}</span><span>{when}</span></div>
        <div className="row"><span>Atendió</span><span>{sale.userName}</span></div>
        {sale.customerName && <div className="row"><span>Cliente</span><span>{sale.customerName}</span></div>}
        {sale.status === "voided" && <div className="c total">*** VENTA ANULADA ***</div>}
        <hr />
        {sale.items.map((i) => (
          <div className="item" key={i.id}>
            <div>{i.name}{i.options.length > 0 && ` (${i.options.join(" / ")})`}</div>
            <div className="row muted">
              <span>{formatQty(i.quantity, i.unit)} × {money(i.unitPriceCents)}{i.discountCents > 0 && ` −${money(i.discountCents)}`}</span>
              <span>{money(i.totalCents)}</span>
            </div>
          </div>
        ))}
        <hr />
        <div className="row"><span>Subtotal</span><span>{money(sale.subtotalCents)}</span></div>
        {sale.discountCents > 0 && <div className="row"><span>{sale.couponCode ? `Descuento (cupón ${sale.couponCode})` : "Descuento"}</span><span>−{money(sale.discountCents)}</span></div>}
        <div className="row"><span>Impuestos{sale.pricesIncludeTax ? " incluidos" : ""}</span><span>{money(sale.taxCents)}</span></div>
        <div className="row total"><span>TOTAL</span><span>{money(sale.totalCents)}</span></div>
        <hr />
        {sale.payments.map((p, i) => <div className="row" key={i}><span>{paymentLabel(p.method)}</span><span>{money(p.amountCents)}</span></div>)}
        {sale.changeCents > 0 && <div className="row"><span>Cambio</span><span>{money(sale.changeCents)}</span></div>}
        {sale.refundedCents > 0 && <div className="row"><span>Devuelto</span><span>−{money(sale.refundedCents)}</span></div>}
        <hr />
        <div className="c">{settings.receiptFooter ?? "¡Gracias por tu compra!"}</div>
        <div className="c muted" style={{ marginTop: 4, fontSize: 9 }}>Este recibo no es un comprobante fiscal.</div>
      </div>
    </>
  );
}
