/** A support conversation, as the business or as support sees it (shared by the panel and /admin). */
import type { SupportMessage } from "@nexo/shared";

const fmt = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export function SupportThread({ messages, viewer }: { messages: SupportMessage[]; viewer: "business" | "operator" }) {
  const mine = viewer === "business" ? "user" : "operator";
  return (
    <ol className="nx-thread" aria-label="Conversación">
      {messages.map((m) =>
        m.authorType === "system" ? (
          <li key={m.id} className="nx-thread__system">
            <span>{m.body}</span>
            <time dateTime={m.createdAt}>{fmt.format(new Date(m.createdAt))}</time>
          </li>
        ) : (
          <li key={m.id} className="nx-msg" data-mine={m.authorType === mine || undefined} data-internal={m.internal || undefined}>
            <div className="nx-msg__head">
              <strong>{m.authorType === "operator" && viewer === "business" ? `${m.authorName} · Soporte Nexo` : m.authorName}</strong>
              {m.internal && <span className="nx-msg__tag">Nota interna</span>}
              <time dateTime={m.createdAt}>{fmt.format(new Date(m.createdAt))}</time>
            </div>
            <div className="nx-msg__body">{m.body}</div>
          </li>
        ),
      )}
    </ol>
  );
}
