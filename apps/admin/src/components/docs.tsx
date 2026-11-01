import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { COUNT_STATUS_LABELS, PURCHASE_STATUS_LABELS, TRANSFER_STATUS_LABELS, type CountStatus, type PurchaseStatus, type TransferStatus } from "@nexo/shared";
import { Badge } from "@nexo/ui";

type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "accent";

const PURCHASE_TONE: Record<PurchaseStatus, Tone> = { draft: "neutral", ordered: "info", partial: "warning", received: "success", cancelled: "danger" };
const TRANSFER_TONE: Record<TransferStatus, Tone> = { draft: "neutral", in_transit: "info", received: "success", cancelled: "danger" };
const COUNT_TONE: Record<CountStatus, Tone> = { in_progress: "info", completed: "success", cancelled: "danger" };

export const PurchaseStatusBadge = ({ status }: { status: PurchaseStatus }) => <Badge tone={PURCHASE_TONE[status]}>{PURCHASE_STATUS_LABELS[status]}</Badge>;
export const TransferStatusBadge = ({ status }: { status: TransferStatus }) => <Badge tone={TRANSFER_TONE[status]}>{TRANSFER_STATUS_LABELS[status]}</Badge>;
export const CountStatusBadge = ({ status }: { status: CountStatus }) => <Badge tone={COUNT_TONE[status]}>{COUNT_STATUS_LABELS[status]}</Badge>;

export function BackLink({ to, children }: { to: string; children: string }) {
  return (
    <div>
      <Link className="nx-link" to={to} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
        <ArrowLeft size={14} aria-hidden="true" />{children}
      </Link>
    </div>
  );
}

/** Progress of a document as a row of steps: done, current, upcoming. */
export function Steps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="nx-steps" style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {steps.map((s, i) => (
        <li key={s} className="nx-steps__item" data-state={i < current ? "done" : i === current ? "current" : "next"} aria-current={i === current ? "step" : undefined}>
          {i > 0 && <span className="nx-steps__sep" aria-hidden="true" />}
          <span className="nx-steps__dot" aria-hidden="true" />{s}
        </li>
      ))}
    </ol>
  );
}

/** "1,5" or "1.5" → 1.5; empty → null; invalid → NaN. */
export function parseQty(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : Number.NaN;
}

export const dateFmt = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" });
export const dateTimeFmt = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" });
/** "2026-11-10" (a calendar date, no time zone) → "10 nov 2026". */
export const formatDay = (day: string | null) => (day ? dateFmt.format(new Date(`${day}T12:00:00Z`)) : "—");
