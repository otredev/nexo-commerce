import { useEffect, useState } from "react";
import { POLICY_INFO, type PolicyKind, type StorePolicy } from "@nexo/shared";
import { Markdown } from "../components/Markdown";
import { Link, useSearchParams } from "react-router-dom";
import { Copy, CreditCard, ExternalLink } from "lucide-react";
import type { StoreDomain, StripeConnectStatus } from "@nexo/shared";
import { Alert, Badge, Button, Card, Checkbox, Modal, Segmented, TextAreaField, TextField, useToast } from "@nexo/ui";
import { del, get, post, put } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLoad, useSubmit } from "../lib/hooks";

const upgradeLink = <Link className="nx-link" to="/configuracion?tab=plan">Ver planes</Link>;

/** Card payments through the business's own Stripe account (Connect). */
export function CardPayments({ checked, onChange, writable, error }: { checked: boolean; onChange: (v: boolean) => void; writable: boolean; error?: string }) {
  const { can } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const back = params.get("stripe");
  const { data } = useLoad(() => get<StripeConnectStatus>(`/billing/connect${back === "listo" ? "?refresh=1" : ""}`));
  useEffect(() => {
    if (!back || !data) return;
    if (back === "listo") toast(data.chargesEnabled ? "Stripe quedó conectado. Ya puedes activar el pago con tarjeta." : "Stripe aún revisa tu cuenta. Te avisaremos aquí cuando esté lista.");
    const next = new URLSearchParams(params);
    next.delete("stripe");
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  const connect = useSubmit(async () => {
    const res = await post<{ url: string }>("/billing/connect");
    window.location.assign(res.url);
  });
  if (!data) return null;

  let body;
  if (!data.planAllows) {
    body = <p className="nx-help" style={{ margin: 0 }}>Cobra con tarjeta en línea desde el plan Pro. {upgradeLink}</p>;
  } else if (!data.available) {
    body = <p className="nx-help" style={{ margin: 0 }}>El pago con tarjeta todavía no está habilitado en la plataforma.</p>;
  } else if (!data.chargesEnabled) {
    body = (
      <div className="nx-stack" style={{ gap: 8 }}>
        <p className="nx-help" style={{ margin: 0 }}>
          {data.accountId ? "Tu cuenta de Stripe aún no puede recibir pagos: termina de llenar tus datos." : "Conecta una cuenta de Stripe para recibir pagos con tarjeta. El dinero llega directo a tu cuenta."}
        </p>
        {connect.message && <Alert tone="danger">{connect.message}</Alert>}
        {can("billing:write") ? (
          <div><Button size="sm" loading={connect.pending} onClick={() => void connect.submit()}><CreditCard className="nx-icon" aria-hidden="true" />{data.accountId ? "Continuar en Stripe" : "Conectar con Stripe"}</Button></div>
        ) : (
          <p className="nx-help" style={{ margin: 0 }}>Pide al propietario que conecte Stripe.</p>
        )}
      </div>
    );
  } else {
    body = (
      <Checkbox
        label={<span className="nx-row" style={{ gap: 6 }}>Tarjeta en línea <Badge tone="success">Stripe conectado</Badge></span>}
        help="El cliente paga al confirmar y el pedido llega pagado. Si no paga en 30 minutos, se cancela y las existencias regresan."
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={!writable}
      />
    );
  }
  return (
    <>
      {error && <Alert tone="danger">{error}</Alert>}
      {body}
    </>
  );
}

function CopyText({ text }: { text: string }) {
  const toast = useToast();
  return (
    <button type="button" className="nx-dns__copy" title="Copiar" onClick={() => { void navigator.clipboard?.writeText(text); toast("Copiado"); }}>
      <span className="nx-mono">{text}</span>
      <Copy className="nx-icon" aria-hidden="true" />
    </button>
  );
}

/** The store on the business's own domain (Cloudflare for SaaS). */
export function DomainCard({ writable }: { writable: boolean }) {
  const toast = useToast();
  const { data, error, setData, reload } = useLoad(() => get<{ available: boolean; planAllows: boolean; domain: StoreDomain | null }>("/store-settings/domain?refresh=1"));
  const [hostname, setHostname] = useState("");
  const add = useSubmit(async () => {
    const domain = await put<StoreDomain>("/store-settings/domain", { hostname });
    setData((d) => (d ? { ...d, domain } : d));
    setHostname("");
    toast("Dominio agregado. Ahora configura tu DNS.");
  });
  const check = useSubmit(async () => {
    await reload();
  });
  const remove = useSubmit(async () => {
    await del("/store-settings/domain");
    setData((d) => (d ? { ...d, domain: null } : d));
    toast("Dominio quitado");
  });
  if (error) return <Card title="Dominio propio"><Alert tone="danger">{error.message}</Alert></Card>;
  if (!data) return null;
  const d = data.domain;

  return (
    <Card title="Dominio propio" description="Tu tienda en tu dirección, por ejemplo tienda.minegocio.com.">
      <div className="nx-stack">
        {!data.planAllows && !d ? (
          <p className="nx-help" style={{ margin: 0 }}>Disponible desde el plan Pro. {upgradeLink}</p>
        ) : !data.available ? (
          <p className="nx-help" style={{ margin: 0 }}>Los dominios propios todavía no están habilitados en la plataforma.</p>
        ) : !d ? (
          writable ? (
            <form className="nx-stack" onSubmit={(e) => { e.preventDefault(); void add.submit(); }}>
              {add.message && !add.fields.hostname && <Alert tone="danger">{add.message}</Alert>}
              <TextField label="Dominio" value={hostname} onChange={(e) => setHostname(e.target.value)} error={add.fields.hostname} placeholder="tienda.minegocio.com" autoComplete="off" spellCheck={false} help="Usa un subdominio (tienda.…) de un dominio que ya tengas." />
              <div><Button type="submit" size="sm" loading={add.pending} disabled={!hostname.trim()}>Conectar dominio</Button></div>
            </form>
          ) : (
            <p className="nx-help" style={{ margin: 0 }}>Sin dominio propio.</p>
          )
        ) : (
          <>
            <div className="nx-row" style={{ gap: 8, flexWrap: "wrap" }}>
              <span className="nx-mono" style={{ fontSize: 14 }}>{d.hostname}</span>
              {d.status === "active" ? <Badge tone="success">Activo</Badge> : d.status === "failed" ? <Badge tone="danger">Falló</Badge> : <Badge tone="warning">Esperando DNS</Badge>}
            </div>
            {d.status !== "active" && (
              <>
                <p className="nx-help" style={{ margin: 0 }}>Agrega estos registros en el DNS de tu dominio (donde lo compraste). Puede tardar unos minutos; lo revisamos cada hora.</p>
                <div className="nx-dns">
                  {[{ type: "CNAME", name: d.hostname, value: d.target }, ...d.verification].map((v) => (
                    <div className="nx-dns__rec" key={`${v.type}${v.name}`}>
                      <Badge plain>{v.type}</Badge>
                      <dl>
                        <div><dt>Nombre</dt><dd><CopyText text={v.name} /></dd></div>
                        <div><dt>Valor</dt><dd><CopyText text={v.value} /></dd></div>
                      </dl>
                    </div>
                  ))}
                </div>
                {d.lastError && <Alert tone="warning">{d.lastError}</Alert>}
              </>
            )}
            {(check.message || remove.message) && <Alert tone="danger">{check.message ?? remove.message}</Alert>}
            <div className="nx-row" style={{ gap: 8, flexWrap: "wrap" }}>
              {d.status === "active" ? (
                <Button size="sm" variant="ghost" onClick={() => window.open(`https://${d.hostname}`, "_blank", "noopener")}><ExternalLink className="nx-icon" aria-hidden="true" />Abrir</Button>
              ) : (
                <Button size="sm" loading={check.pending} onClick={() => void check.submit()}>Comprobar ahora</Button>
              )}
              {writable && <Button size="sm" variant="ghost" loading={remove.pending} onClick={() => void remove.submit()}>Quitar dominio</Button>}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

/* ---------------- Frequently asked questions ---------------- */

export function FaqEditor({ value, onChange, writable, error }: { value: Array<{ q: string; a: string }>; onChange: (v: Array<{ q: string; a: string }>) => void; writable: boolean; error?: string }) {
  const update = (i: number, patch: Partial<{ q: string; a: string }>) => onChange(value.map((f, n) => (n === i ? { ...f, ...patch } : f)));
  return (
    <div className="nx-stack">
      {error && <Alert tone="danger">{error}</Alert>}
      {value.length === 0 && <p className="nx-help" style={{ margin: 0 }}>Ejemplos: ¿Hacen envíos a toda la ciudad? ¿Puedo recoger hoy? ¿Aceptan tarjeta?</p>}
      {value.map((f, i) => (
        <div key={i} className="nx-stack" style={{ gap: 8, paddingTop: i ? 12 : 0, borderTop: i ? "1px solid var(--border)" : 0 }}>
          <TextField label={`Pregunta ${i + 1}`} value={f.q} maxLength={200} onChange={(e) => update(i, { q: e.target.value })} disabled={!writable} />
          <TextAreaField label="Respuesta" rows={2} value={f.a} maxLength={1500} onChange={(e) => update(i, { a: e.target.value })} disabled={!writable} />
          {writable && <div><Button size="sm" variant="ghost" onClick={() => onChange(value.filter((_, n) => n !== i))}>Quitar pregunta</Button></div>}
        </div>
      ))}
      {writable && value.length < 20 && <div><Button size="sm" onClick={() => onChange([...value, { q: "", a: "" }])}>Agregar pregunta</Button></div>}
    </div>
  );
}

/* ---------------- Legal pages ---------------- */

type PolicyRow = StorePolicy | { kind: PolicyKind; content: null; version: 0; published: false; updatedAt: null };

export function PoliciesCard({ writable }: { writable: boolean }) {
  const { data, error, setData } = useLoad(() => get<PolicyRow[]>("/store-settings/policies"));
  const [editing, setEditing] = useState<PolicyKind | null>(null);
  const row = data?.find((r) => r.kind === editing) ?? null;
  return (
    <Card title="Políticas de la tienda" description="Se publican en tu tienda y, al pagar, el cliente acepta los términos y el aviso de privacidad.">
      {error && <Alert tone="danger">{error.message}</Alert>}
      <div>
        {data?.map((r) => (
          <div key={r.kind} className="nx-policy-row">
            <div>
              <div style={{ fontWeight: 500 }}>{POLICY_INFO[r.kind].title}</div>
              <div className="nx-help" style={{ marginTop: 2 }}>
                {r.content === null ? "Sin texto" : r.published ? `Publicada · versión ${r.version}` : `Borrador · versión ${r.version}`}
              </div>
            </div>
            {writable ? (
              <Button size="sm" onClick={() => setEditing(r.kind)}>{r.content === null ? "Crear" : "Editar"}</Button>
            ) : r.content !== null && <Button size="sm" variant="ghost" onClick={() => setEditing(r.kind)}>Ver</Button>}
          </div>
        ))}
      </div>
      <PolicyModal
        row={row}
        writable={writable}
        onClose={() => setEditing(null)}
        onSaved={(p) => { setData((d) => d?.map((x) => (x.kind === p.kind ? p : x)) ?? d); setEditing(null); }}
      />
    </Card>
  );
}

function PolicyModal({ row, writable, onClose, onSaved }: { row: PolicyRow | null; writable: boolean; onClose: () => void; onSaved: (p: StorePolicy) => void }) {
  const toast = useToast();
  const [content, setContent] = useState("");
  const [published, setPublished] = useState(true);
  const [view, setView] = useState<"edit" | "preview">("edit");
  const [confirmTemplate, setConfirmTemplate] = useState(false);
  useEffect(() => {
    if (!row) return;
    setConfirmTemplate(false);
    setContent(row.content ?? "");
    setPublished(row.content === null ? true : row.published);
    setView(writable ? "edit" : "preview");
  }, [row, writable]);
  const template = useSubmit(async () => {
    const res = await get<{ content: string }>(`/store-settings/policies/${row!.kind}/template`);
    setContent(res.content);
    setView("edit");
  });
  const save = useSubmit(async () => {
    const saved = await put<StorePolicy>(`/store-settings/policies/${row!.kind}`, { content, published });
    toast(saved.version !== row!.version && row!.content !== null ? `Guardada como versión ${saved.version}` : "Política guardada");
    onSaved(saved);
  });
  if (!row) return null;
  const info = POLICY_INFO[row.kind];
  return (
    <Modal
      open
      size="lg"
      title={info.title}
      onClose={onClose}
      footer={writable ? <><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.pending} onClick={() => void save.submit()}>Guardar</Button></> : <Button onClick={onClose}>Cerrar</Button>}
    >
      <div className="nx-stack">
        {(save.message || template.message) && <Alert tone="danger">{save.message ?? template.message}</Alert>}
        {writable && (
          <div className="nx-row" style={{ justifyContent: "space-between" }}>
            <Segmented label="Vista" value={view} onChange={setView} options={[{ id: "edit", label: "Editar" }, { id: "preview", label: "Vista previa" }]} />
            <Button
              size="sm"
              variant={confirmTemplate ? "secondary" : "ghost"}
              loading={template.pending}
              onClick={() => { if (content.trim() && !confirmTemplate) setConfirmTemplate(true); else { setConfirmTemplate(false); void template.submit(); } }}
            >
              {confirmTemplate ? "Reemplazar mi texto por la plantilla" : "Usar plantilla"}
            </Button>
          </div>
        )}
        {view === "edit" ? (
          <TextAreaField
            label="Texto"
            rows={16}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            error={save.fields.content}
            placeholder={"## Título de sección\nTexto del párrafo.\n\n- Un punto\n- Otro punto"}
            help={<>Formato: <code>## Título</code>, <code>- lista</code>, <code>**negritas**</code>, <code>[texto](https://enlace)</code>. Los textos entre [corchetes] de las plantillas son para completar.</>}
            style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}
          />
        ) : (
          <div style={{ maxHeight: 420, overflowY: "auto", padding: "4px 2px" }}>{content.trim() ? <Markdown text={content} /> : <p className="nx-muted">Sin texto todavía.</p>}</div>
        )}
        {writable && (
          <>
            <Checkbox label="Publicada en la tienda" checked={published} onChange={(e) => setPublished(e.target.checked)} help={row.kind === "returns" ? "Aparece en el pie de la tienda." : "Aparece en el pie de la tienda y el cliente la acepta al pagar."} />
            <Alert tone="info">Las plantillas son un punto de partida, no asesoría legal. Revisa el texto con un abogado antes de publicarlo. Cada cambio queda guardado como una versión nueva y cada pedido registra cuál aceptó el cliente.</Alert>
          </>
        )}
      </div>
    </Modal>
  );
}
