import { useEffect, useState } from "react";
import { UserPlus } from "lucide-react";
import { normalizeCode, type Customer, type CouponRule, type Paginated } from "@nexo/shared";
import { Alert, Button, Modal, SearchInput, TextField, useDebounced } from "@nexo/ui";
import { get, post, RequestError } from "../../lib/api";
import { useBusiness } from "../../lib/business";
import { useSubmit } from "../../lib/hooks";

/** Finds a customer by name, phone or email, or registers a new one without leaving the register. */
export function CustomerPicker({ open, current, onClose, onPick }: { open: boolean; current: { id: string; name: string } | null; onClose: () => void; onPick: (c: Customer | null) => void }) {
  const { money } = useBusiness();
  const [q, setQ] = useState("");
  const query = useDebounced(q, 200);
  const [results, setResults] = useState<Customer[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "" });
  useEffect(() => { if (open) { setQ(""); setCreating(false); setForm({ name: "", phone: "", email: "" }); } }, [open]);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    get<Paginated<Customer>>(`/customers?${new URLSearchParams({ pageSize: "8", sort: query ? "name" : "last", ...(query && { q: query }) })}`)
      .then((r) => alive && setResults(r.items), () => alive && setResults([]));
    return () => { alive = false; };
  }, [open, query]);
  const create = useSubmit(async () => {
    try {
      onPick(await post<Customer>("/customers?origen=pos", { name: form.name, phone: form.phone || null, email: form.email || null }));
    } catch (e) {
      // Already registered: offer that customer instead of a duplicate.
      if (e instanceof RequestError && e.code === "duplicate" && e.fields.existingId) {
        const existing = await get<Customer>(`/customers/${e.fields.existingId}`);
        setResults([existing]);
        setCreating(false);
        throw new RequestError(409, "duplicate", `${e.message} Tócalo en la lista para elegirlo.`);
      }
      throw e;
    }
  });
  return (
    <Modal
      open={open}
      title="Cliente de la venta"
      onClose={onClose}
      footer={
        creating ? (
          <><Button variant="ghost" onClick={() => setCreating(false)}>Volver</Button><Button variant="primary" loading={create.pending} onClick={() => void create.submit()}>Registrar y usar</Button></>
        ) : (
          <>{current && <Button variant="ghost" onClick={() => onPick(null)}>Quitar cliente</Button>}<Button onClick={() => { setCreating(true); setForm({ name: /\d{4}/.test(q) ? "" : q, phone: /\d{4}/.test(q) ? q : "", email: q.includes("@") ? q : "" }); }}><UserPlus className="nx-icon" aria-hidden="true" />Nuevo cliente</Button></>
        )
      }
    >
      {creating ? (
        <form className="nx-stack" onSubmit={(e) => { e.preventDefault(); void create.submit(); }}>
          {create.message && <Alert tone="warning">{create.message}</Alert>}
          <TextField label="Nombre" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={create.fields.name} autoFocus />
          <TextField label="Teléfono" optional inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} error={create.fields.phone} />
          <TextField label="Correo" optional type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={create.fields.email} help="Para enviarle sus recibos." />
          <button type="submit" hidden />
        </form>
      ) : (
        <div className="nx-stack" style={{ gap: 12 }}>
          {create.message && <Alert tone="warning">{create.message}</Alert>}
          <SearchInput label="Buscar cliente" placeholder="Nombre, teléfono o correo" value={q} onChange={setQ} width={9999} autoFocus />
          <div className="nx-stack" style={{ gap: 2 }} role="list">
            {results?.length === 0 && <p className="nx-muted" style={{ margin: "8px 0" }}>{q ? "Nadie coincide. Regístralo como cliente nuevo." : "Aún no hay clientes registrados."}</p>}
            {results?.map((c) => (
              <button
                key={c.id}
                type="button"
                role="listitem"
                className="nx-nav__item"
                style={{ border: 0, width: "100%", textAlign: "left", background: current?.id === c.id ? "var(--accent-soft)" : "none", cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 12px" }}
                onClick={() => onPick(c)}
              >
                <span>
                  <span style={{ color: "var(--ink)", fontWeight: 500 }}>{c.name}</span>
                  <span className="nx-muted" style={{ display: "block", fontSize: 12 }}>{[c.phone, c.email].filter(Boolean).join(" · ") || "Sin contacto"}</span>
                </span>
                <span className="nx-muted nx-num" style={{ fontSize: 12, textAlign: "right" }}>{c.purchases ? `${c.purchases} compras · ${money(c.totalCents)}` : "Sin compras"}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Validates a coupon code with the server; the cart then prices it like the server will. */
export function CouponModal({ open, onClose, onApply }: { open: boolean; onClose: () => void; onApply: (c: CouponRule) => void }) {
  const [code, setCode] = useState("");
  useEffect(() => { if (open) setCode(""); }, [open]);
  const check = useSubmit(async () => {
    if (!code.trim()) throw new RequestError(422, "validation_error", "Revisa", { couponCode: "Escribe el código" });
    onApply(await get<CouponRule>(`/promotions/coupons/check/${encodeURIComponent(normalizeCode(code))}`));
  });
  return (
    <Modal open={open} title="Aplicar cupón" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={check.pending} onClick={() => void check.submit()}>Aplicar</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); void check.submit(); }}>
        <TextField label="Código del cupón" className="nx-mono" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} error={check.fields.couponCode ?? check.message ?? undefined} autoFocus />
      </form>
    </Modal>
  );
}
