/** Settings → Integraciones (Phase 11): API keys, AI assistants (MCP) and webhooks. */
import { useState, type ReactNode } from "react";
import { Copy, Eye, EyeOff, KeyRound, Plus, RefreshCw, Send, Trash2, Webhook } from "lucide-react";
import {
  API_KEY_ACCESS, API_KEY_ACCESS_IDS, WEBHOOK_EVENT_TYPES, WEBHOOK_EVENTS,
  type ApiKey, type ApiKeyAccess, type IntegrationsSettings, type WebhookDelivery, type WebhookEndpoint, type WebhookEventType,
} from "@nexo/shared";
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Modal, Segmented, SelectField, Switch, TextField, useToast } from "@nexo/ui";
import { del, get, post, put } from "../lib/api";
import { useLoad, useSubmit } from "../lib/hooks";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" }) : "—");

function CopyField({ value, label, mono = true, secret }: { value: string; label: string; mono?: boolean; secret?: boolean }) {
  const toast = useToast();
  const [shown, setShown] = useState(!secret);
  return (
    <div className="nx-copy">
      <code className={mono ? "nx-copy__value nx-mono" : "nx-copy__value"} aria-label={label}>{shown ? value : "•".repeat(Math.min(value.length, 32))}</code>
      {secret && (
        <button type="button" className="nx-copy__btn" aria-label={shown ? "Ocultar" : "Mostrar"} onClick={() => setShown(!shown)}>
          {shown ? <EyeOff className="nx-icon" aria-hidden="true" /> : <Eye className="nx-icon" aria-hidden="true" />}
        </button>
      )}
      <button type="button" className="nx-copy__btn" aria-label={`Copiar ${label}`} onClick={() => { void navigator.clipboard?.writeText(value); toast("Copiado"); }}>
        <Copy className="nx-icon" aria-hidden="true" />
      </button>
    </div>
  );
}

function CodeBlock({ code, label }: { code: string; label: string }) {
  const toast = useToast();
  return (
    <div className="nx-codeblock">
      <pre aria-label={label}><code>{code}</code></pre>
      <button type="button" className="nx-copy__btn" aria-label={`Copiar ${label}`} onClick={() => { void navigator.clipboard?.writeText(code); toast("Copiado"); }}>
        <Copy className="nx-icon" aria-hidden="true" />
      </button>
    </div>
  );
}

export function IntegrationsTab() {
  const load = useLoad(() => get<IntegrationsSettings>("/integrations"));
  if (load.error) return <Alert tone="danger">{load.error.message}</Alert>;
  if (!load.data) return <div className="nx-page-loading"><span className="nx-spinner" aria-label="Cargando" /></div>;
  const s = load.data;
  return (
    <div className="nx-stack" style={{ gap: 24, maxWidth: 920 }}>
      <ApiKeysCard s={s} reload={load.reload} />
      <McpCard s={s} />
      <WebhooksCard s={s} reload={load.reload} />
      <RestCard s={s} />
    </div>
  );
}

/* ---------------- API keys ---------------- */

function ApiKeysCard({ s, reload }: { s: IntegrationsSettings; reload: () => Promise<void> }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [form, setForm] = useState<{ name: string; access: ApiKeyAccess; expires: string }>({ name: "", access: "read", expires: "" });
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const create = useSubmit(async () => {
    const r = await post<{ apiKey: ApiKey; key: string }>("/integrations/api-keys", { name: form.name, access: form.access, expiresInDays: form.expires ? Number(form.expires) : null });
    setCreated(r.key);
    await reload();
  });
  const revoke = useSubmit(async () => {
    await del(`/integrations/api-keys/${revoking!.id}`);
    setRevoking(null);
    toast("Llave revocada. Ya no funciona.");
    await reload();
  });
  const full = s.limits.apiKeys !== null && s.apiKeys.length >= s.limits.apiKeys;
  const close = () => { setOpen(false); setCreated(null); setForm({ name: "", access: "read", expires: "" }); };

  return (
    <Card
      title="Llaves de API"
      description="Para conectar otros sistemas (tu ERP, una hoja de cálculo, un asistente de IA) con tu negocio. Cada llave actúa con el acceso que elijas y queda en la actividad."
      actions={<Button size="sm" disabled={full} onClick={() => setOpen(true)}><Plus className="nx-icon" aria-hidden="true" />Crear llave</Button>}
    >
      {full && <div style={{ marginBottom: 12 }}><Alert tone="info">Llegaste al límite de tu plan ({s.limits.apiKeys} llaves). Revoca una o mejora tu plan.</Alert></div>}
      {s.apiKeys.length === 0 ? (
        <EmptyState icon={<KeyRound className="nx-icon" />} title="Sin llaves" text="Crea una para usar la API o conectar un asistente de IA." />
      ) : (
        <div className="nx-table-scroll">
          <table className="nx-table">
            <thead><tr><th>Nombre</th><th>Acceso</th><th>Llave</th><th>Último uso</th><th>Vence</th><th aria-label="Acciones" /></tr></thead>
            <tbody>
              {s.apiKeys.map((k) => (
                <tr key={k.id}>
                  <td><div style={{ fontWeight: 500 }}>{k.name}</div><div className="nx-muted" style={{ fontSize: 12 }}>{k.createdByName} · {when(k.createdAt)}</div></td>
                  <td><Badge tone={k.access === "read" ? "neutral" : "warning"}>{API_KEY_ACCESS[k.access].label}</Badge></td>
                  <td className="nx-mono" style={{ fontSize: 12 }}>{k.prefix}…</td>
                  <td>{k.lastUsedAt ? when(k.lastUsedAt) : <span className="nx-muted">Nunca</span>}</td>
                  <td>{k.expiresAt ? when(k.expiresAt) : <span className="nx-muted">No vence</span>}</td>
                  <td className="nx-col-num"><Button size="sm" variant="ghost" aria-label={`Revocar ${k.name}`} onClick={() => setRevoking(k)}><Trash2 className="nx-icon" aria-hidden="true" />Revocar</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={open}
        title={created ? "Copia tu llave" : "Crear llave de API"}
        onClose={close}
        dismissable={!created}
        footer={created ? <Button variant="primary" onClick={close}>Ya la guardé</Button> : <><Button variant="ghost" onClick={close}>Cancelar</Button><Button variant="primary" loading={create.pending} onClick={() => void create.submit()}>Crear llave</Button></>}
      >
        {created ? (
          <div className="nx-stack">
            <Alert tone="warning" title="Solo se muestra esta vez">Guárdala en un lugar seguro (por ejemplo tu gestor de contraseñas). Si la pierdes, revócala y crea otra.</Alert>
            <CopyField value={created} label="llave de API" />
          </div>
        ) : (
          <div className="nx-stack">
            {create.message && <Alert tone="danger">{create.message}</Alert>}
            <TextField label="Nombre" placeholder="Claude, mi ERP, Zapier…" value={form.name} maxLength={60} onChange={(e) => setForm({ ...form, name: e.target.value })} error={create.fields.name} help="Para reconocerla después." />
            <div className="nx-field" role="radiogroup" aria-label="Acceso">
              <span className="nx-label">Acceso</span>
              {API_KEY_ACCESS_IDS.map((id) => (
                <label key={id} className="nx-choice">
                  <input type="radio" name="access" checked={form.access === id} onChange={() => setForm({ ...form, access: id })} />
                  <span><strong>{API_KEY_ACCESS[id].label}</strong><span className="nx-muted">{API_KEY_ACCESS[id].help}</span></span>
                </label>
              ))}
            </div>
            <SelectField label="Vence" value={form.expires} onChange={(e) => setForm({ ...form, expires: e.target.value })}>
              <option value="">Nunca</option>
              <option value="30">En 30 días</option>
              <option value="90">En 90 días</option>
              <option value="365">En un año</option>
            </SelectField>
            <p className="nx-help" style={{ margin: 0 }}>Ninguna llave puede ver usuarios, tu plan ni estas integraciones.</p>
          </div>
        )}
      </Modal>

      <Modal open={Boolean(revoking)} title="Revocar llave" onClose={() => setRevoking(null)} footer={<><Button variant="ghost" onClick={() => setRevoking(null)}>Cancelar</Button><Button variant="danger" loading={revoke.pending} onClick={() => void revoke.submit()}>Revocar</Button></>}>
        <p style={{ margin: 0 }}>«{revoking?.name}» dejará de funcionar de inmediato. Lo que la use (un asistente, otro sistema) perderá el acceso.</p>
      </Modal>
    </Card>
  );
}

/* ---------------- MCP ---------------- */

function McpCard({ s }: { s: IntegrationsSettings }) {
  const [client, setClient] = useState<"code" | "desktop" | "other">("code");
  const code = `claude mcp add --transport http nexo ${s.mcpUrl} \\\n  --header "Authorization: Bearer TU_LLAVE"`;
  const desktop = JSON.stringify({ mcpServers: { nexo: { command: "npx", args: ["-y", "mcp-remote", s.mcpUrl, "--header", "Authorization:Bearer ${NEXO_KEY}"], env: { NEXO_KEY: "TU_LLAVE" } } } }, null, 2);
  return (
    <Card title="Asistentes de IA (MCP)" description="Conecta Claude u otro asistente compatible con MCP para preguntarle por tus ventas, existencias o pedidos, y pedirle que actualice pedidos o inventario.">
      <div className="nx-stack">
        <div className="nx-field">
          <span className="nx-label">Dirección del servidor MCP</span>
          <CopyField value={s.mcpUrl} label="dirección MCP" />
        </div>
        <Segmented label="Cliente" value={client} onChange={setClient} options={[{ id: "code", label: "Claude Code" }, { id: "desktop", label: "Claude Desktop" }, { id: "other", label: "Otro cliente" }]} />
        {client === "code" && <CodeBlock code={code} label="comando de Claude Code" />}
        {client === "desktop" && (
          <>
            <p className="nx-help" style={{ margin: 0 }}>En Claude Desktop: <em>Configuración → Desarrollador → Editar configuración</em>, pega esto (necesita Node.js) y reinicia la app.</p>
            <CodeBlock code={desktop} label="configuración de Claude Desktop" />
          </>
        )}
        {client === "other" && <p style={{ margin: 0 }}>Transporte <strong>HTTP (Streamable)</strong> en la dirección de arriba, con la cabecera <code>Authorization: Bearer TU_LLAVE</code>.</p>}
        <Alert tone="info">Cambia <code>TU_LLAVE</code> por una llave de arriba. Para empezar, usa una de <strong>Solo lectura</strong>: el asistente podrá consultar pero no cambiar nada. Con una de lectura y escritura también podrá aceptar y entregar pedidos o ajustar existencias (te pedirá confirmación).</Alert>
        <details className="nx-details">
          <summary>Qué puede hacer el asistente</summary>
          <p className="nx-muted" style={{ margin: "8px 0 0" }}>Resumen de hoy, buscar productos y ver su detalle, existencias (y qué resurtir), ubicaciones, reporte de ventas de cualquier periodo, estadísticas de la tienda en línea, pedidos y su detalle, buscar clientes; con permiso de escritura: avanzar pedidos y ajustar existencias.</p>
        </details>
      </div>
    </Card>
  );
}

/* ---------------- Webhooks ---------------- */

type HookForm = { url: string; description: string; all: boolean; events: WebhookEventType[]; active: boolean };
const emptyHook: HookForm = { url: "https://", description: "", all: true, events: [], active: true };

function health(w: WebhookEndpoint): { tone: "success" | "warning" | "danger" | "neutral"; label: string } {
  if (!w.active) return { tone: "neutral", label: "Pausado" };
  if (w.failures >= 3) return { tone: "danger", label: `${w.failures} fallas seguidas` };
  if (w.failures > 0) return { tone: "warning", label: "Falló el último envío" };
  return { tone: "success", label: w.lastSuccessAt ? "Funcionando" : "Activo" };
}

function WebhooksCard({ s, reload }: { s: IntegrationsSettings; reload: () => Promise<void> }) {
  const toast = useToast();
  const [editing, setEditing] = useState<WebhookEndpoint | "new" | null>(null);
  const [form, setForm] = useState<HookForm>(emptyHook);
  const [deleting, setDeleting] = useState<WebhookEndpoint | null>(null);
  const [logOf, setLogOf] = useState<WebhookEndpoint | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const openEdit = (w: WebhookEndpoint | "new") => {
    setEditing(w);
    setForm(w === "new" ? emptyHook : { url: w.url, description: w.description ?? "", all: w.events.length === 0, events: w.events, active: w.active });
  };
  const save = useSubmit(async () => {
    const body = { url: form.url.trim(), description: form.description.trim() || null, events: form.all ? [] : form.events, active: form.active };
    if (editing === "new") await post("/integrations/webhooks", body);
    else await put(`/integrations/webhooks/${(editing as WebhookEndpoint).id}`, body);
    setEditing(null);
    toast(editing === "new" ? "Webhook creado" : "Webhook guardado");
    await reload();
  });
  const remove = useSubmit(async () => {
    await del(`/integrations/webhooks/${deleting!.id}`);
    setDeleting(null);
    toast("Webhook eliminado");
    await reload();
  });
  const act = async (key: string, fn: () => Promise<unknown>) => { setBusy(key); try { await fn(); } catch (e) { toast((e as Error).message); } finally { setBusy(null); } };
  const test = (w: WebhookEndpoint) => act(`test-${w.id}`, async () => {
    const d = await post<WebhookDelivery>(`/integrations/webhooks/${w.id}/test`);
    toast(d.status === "succeeded" ? `Prueba entregada (HTTP ${d.lastStatus})` : `La prueba falló: ${d.lastError ?? `HTTP ${d.lastStatus}`}`);
    await reload();
  });
  const rotate = (w: WebhookEndpoint) => act(`rot-${w.id}`, async () => { await post(`/integrations/webhooks/${w.id}/rotate-secret`); toast("Secreto nuevo. Actualízalo en tu sistema."); await reload(); });
  const full = s.limits.webhooks !== null && s.webhooks.length >= s.limits.webhooks;

  return (
    <Card
      title="Webhooks"
      description="Avisamos a otro sistema, al instante, cuando pasa algo en tu negocio: un pedido nuevo, una venta, un cambio de producto. Si no responde, reintentamos durante un día."
      actions={<Button size="sm" disabled={full} onClick={() => openEdit("new")}><Plus className="nx-icon" aria-hidden="true" />Agregar webhook</Button>}
    >
      {full && <div style={{ marginBottom: 12 }}><Alert tone="info">Llegaste al límite de tu plan ({s.limits.webhooks} {s.limits.webhooks === 1 ? "webhook" : "webhooks"}).</Alert></div>}
      {s.webhooks.length === 0 ? (
        <EmptyState icon={<Webhook className="nx-icon" />} title="Sin webhooks" text="Agrega la dirección https:// que te dio tu otro sistema (Zapier, Make, n8n o tu propio servidor)." />
      ) : (
        <div className="nx-stack">
          {s.webhooks.map((w) => {
            const h = health(w);
            return (
              <div key={w.id} className="nx-hook">
                <div className="nx-hook__head">
                  <div style={{ minWidth: 0 }}>
                    <div className="nx-mono nx-hook__url">{w.url}</div>
                    <div className="nx-muted" style={{ fontSize: 12 }}>{w.description ? `${w.description} · ` : ""}{w.events.length ? `${w.events.length} ${w.events.length === 1 ? "evento" : "eventos"}` : "Todos los eventos"} · último éxito: {when(w.lastSuccessAt)}</div>
                  </div>
                  <Badge tone={h.tone}>{h.label}</Badge>
                </div>
                <div className="nx-field">
                  <span className="nx-label">Secreto para verificar la firma</span>
                  <CopyField value={w.secret} label="secreto del webhook" secret />
                </div>
                <div className="nx-row" style={{ gap: 6 }}>
                  <Button size="sm" loading={busy === `test-${w.id}`} disabled={!w.active} onClick={() => void test(w)}><Send className="nx-icon" aria-hidden="true" />Probar</Button>
                  <Button size="sm" onClick={() => setLogOf(w)}>Entregas</Button>
                  <Button size="sm" variant="ghost" onClick={() => openEdit(w)}>Editar</Button>
                  <Button size="sm" variant="ghost" loading={busy === `rot-${w.id}`} onClick={() => void rotate(w)}><RefreshCw className="nx-icon" aria-hidden="true" />Nuevo secreto</Button>
                  <Button size="sm" variant="ghost" aria-label={`Eliminar ${w.url}`} onClick={() => setDeleting(w)}><Trash2 className="nx-icon" aria-hidden="true" /></Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <details className="nx-details" style={{ marginTop: 16 }}>
        <summary>Cómo verificar la firma</summary>
        <p className="nx-muted" style={{ margin: "8px 0" }}>Cada envío trae <code>Nexo-Signature: t=…,v1=…</code>: el HMAC-SHA256 con tu secreto de <code>t + "." + cuerpo</code>. Rechaza firmas que no coincidan o con más de 5 minutos.</p>
        <CodeBlock label="ejemplo de verificación" code={`import { createHmac, timingSafeEqual } from "node:crypto";

function verify(body, header, secret) {
  const [, t, v1] = /^t=(\\d+),v1=([0-9a-f]{64})$/.exec(header ?? "") ?? [];
  if (!t || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const mac = createHmac("sha256", secret).update(\`\${t}.\${body}\`).digest();
  return timingSafeEqual(mac, Buffer.from(v1, "hex"));
}`} />
      </details>

      <Modal
        open={editing !== null}
        title={editing === "new" ? "Agregar webhook" : "Editar webhook"}
        size="lg"
        onClose={() => setEditing(null)}
        footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button><Button variant="primary" loading={save.pending} onClick={() => void save.submit()}>Guardar</Button></>}
      >
        <div className="nx-stack">
          {save.message && <Alert tone="danger">{save.message}</Alert>}
          <TextField label="Dirección (URL)" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} error={save.fields.url} placeholder="https://hooks.zapier.com/…" />
          <TextField label="Descripción" optional value={form.description} maxLength={120} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <Switch label="Activo" checked={form.active} onChange={(v) => setForm({ ...form, active: v })} />
          <div className="nx-field">
            <span className="nx-label">Eventos</span>
            <Checkbox label="Todos los eventos (también los que se agreguen después)" checked={form.all} onChange={(e) => setForm({ ...form, all: e.target.checked })} />
            {!form.all && (
              <div className="nx-events">
                {WEBHOOK_EVENT_TYPES.map((t) => (
                  <Checkbox
                    key={t}
                    label={<><code>{t}</code> <span className="nx-muted">{WEBHOOK_EVENTS[t]}</span></>}
                    checked={form.events.includes(t)}
                    onChange={(e) => setForm({ ...form, events: e.target.checked ? [...form.events, t] : form.events.filter((x) => x !== t) })}
                  />
                ))}
              </div>
            )}
            {!form.all && form.events.length === 0 && <span className="nx-help" style={{ color: "var(--warning)" }}>Sin eventos elegidos no se enviará nada; usa «Todos» o marca al menos uno.</span>}
          </div>
        </div>
      </Modal>

      <Modal open={Boolean(deleting)} title="Eliminar webhook" onClose={() => setDeleting(null)} footer={<><Button variant="ghost" onClick={() => setDeleting(null)}>Cancelar</Button><Button variant="danger" loading={remove.pending} onClick={() => void remove.submit()}>Eliminar</Button></>}>
        <p style={{ margin: 0 }}>Dejaremos de enviar eventos a <span className="nx-mono">{deleting?.url}</span> y se borra su registro de entregas.</p>
      </Modal>

      {logOf && <DeliveriesModal endpoint={logOf} onClose={() => { setLogOf(null); void reload(); }} />}
    </Card>
  );
}

const STATUS: Record<WebhookDelivery["status"], { tone: "success" | "warning" | "danger"; label: string }> = {
  succeeded: { tone: "success", label: "Entregado" },
  pending: { tone: "warning", label: "Reintentando" },
  failed: { tone: "danger", label: "Falló" },
};

function DeliveriesModal({ endpoint, onClose }: { endpoint: WebhookEndpoint; onClose: () => void }) {
  const toast = useToast();
  const load = useLoad(() => get<WebhookDelivery[]>(`/integrations/webhooks/${endpoint.id}/deliveries`), [endpoint.id]);
  const [detail, setDetail] = useState<{ id: string; payload: unknown } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const resend = async (d: WebhookDelivery) => {
    setBusy(d.id);
    try {
      const r = await post<WebhookDelivery>(`/integrations/webhooks/deliveries/${d.id}/resend`);
      toast(r.status === "succeeded" ? "Reenviado" : `Falló otra vez: ${r.lastError ?? `HTTP ${r.lastStatus}`}`);
      await load.reload();
    } finally { setBusy(null); }
  };
  const show = async (d: WebhookDelivery) => setDetail(await get<{ id: string; payload: unknown }>(`/integrations/webhooks/deliveries/${d.id}`));
  return (
    <Modal open title="Entregas recientes" size="lg" onClose={onClose} footer={<Button onClick={onClose}>Cerrar</Button>}>
      <p className="nx-muted nx-mono" style={{ margin: "0 0 12px", fontSize: 12, overflowWrap: "anywhere" }}>{endpoint.url}</p>
      {load.error && <Alert tone="danger">{load.error.message}</Alert>}
      {!load.data ? <span className="nx-spinner" aria-label="Cargando" /> : load.data.length === 0 ? (
        <p className="nx-muted" style={{ margin: 0 }}>Aún no hay entregas. Usa «Probar» para enviar una.</p>
      ) : (
        <div className="nx-table-scroll" style={{ maxHeight: 420, overflowY: "auto" }}>
          <table className="nx-table">
            <thead><tr><th>Fecha</th><th>Evento</th><th>Estado</th><th className="nx-col-num">Intentos</th><th aria-label="Acciones" /></tr></thead>
            <tbody>
              {load.data.map((d) => (
                <tr key={d.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{when(d.createdAt)}</td>
                  <td className="nx-mono" style={{ fontSize: 12 }}>{d.type}</td>
                  <td>
                    <Badge tone={STATUS[d.status].tone}>{STATUS[d.status].label}</Badge>
                    {d.status !== "succeeded" && <div className="nx-muted" style={{ fontSize: 12, marginTop: 4 }}>{d.lastStatus ? `HTTP ${d.lastStatus}` : ""}{d.lastError ? ` ${d.lastError.slice(0, 80)}` : ""}{d.nextAttemptAt ? ` · próximo: ${when(d.nextAttemptAt)}` : ""}</div>}
                  </td>
                  <td className="nx-col-num">{d.attempts}</td>
                  <td className="nx-col-num" style={{ whiteSpace: "nowrap" }}>
                    <Button size="sm" variant="ghost" onClick={() => void show(d)}>Ver</Button>
                    <Button size="sm" variant="ghost" loading={busy === d.id} onClick={() => void resend(d)}>Reenviar</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {detail && (
        <div style={{ marginTop: 16 }}>
          <span className="nx-label">Contenido enviado</span>
          <CodeBlock label="contenido del evento" code={JSON.stringify(detail.payload, null, 2)} />
        </div>
      )}
    </Modal>
  );
}

/* ---------------- REST ---------------- */

function RestCard({ s }: { s: IntegrationsSettings }) {
  const example = `curl ${s.apiUrl}/products?q=martillo \\\n  -H "Authorization: Bearer TU_LLAVE"`;
  return (
    <Card title="API REST" description="La misma API que usa este panel. Responde JSON; el dinero va en centavos.">
      <div className="nx-stack">
        <div className="nx-field"><span className="nx-label">Dirección base</span><CopyField value={s.apiUrl} label="dirección de la API" /></div>
        <CodeBlock code={example} label="ejemplo con curl" />
        <Doc>Rutas más usadas: <code>GET /products</code>, <code>GET /inventory?stock=low</code>, <code>POST /inventory/movements</code>, <code>GET /orders</code>, <code>POST /orders/:id/confirm</code>, <code>GET /sales</code>, <code>GET /reports/sales?from=&amp;to=</code>, <code>GET /customers</code>. Los errores tienen la forma <code>{"{ error: { code, message, fields } }"}</code>.</Doc>
      </div>
    </Card>
  );
}
const Doc = ({ children }: { children: ReactNode }) => <p className="nx-help" style={{ margin: 0 }}>{children}</p>;
