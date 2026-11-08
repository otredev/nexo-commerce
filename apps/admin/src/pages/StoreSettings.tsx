import { useEffect, useState } from "react";
import { Copy, ExternalLink } from "lucide-react";
import { parseMoney, type StoreSettings, type StoreSettingsInput } from "@nexo/shared";
import { Alert, Button, Card, Checkbox, PageHeader, SelectField, Switch, TextAreaField, TextField, useToast } from "@nexo/ui";
import { get, post, put, RequestError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { centsToInput, useBusiness } from "../lib/business";
import { useLoad, useSubmit } from "../lib/hooks";
import { CardPayments, DomainCard, FaqEditor, PoliciesCard } from "./StoreExtras";
import { SeoFields } from "../components/SeoFields";

interface Form {
  enabled: boolean;
  locationId: string;
  tagline: string;
  pickupEnabled: boolean;
  pickupInstructions: string;
  deliveryEnabled: boolean;
  deliveryFee: string;
  freeFrom: string;
  deliveryArea: string;
  minOrder: string;
  payOnDelivery: boolean;
  transferEnabled: boolean;
  transferInstructions: string;
  cardEnabled: boolean;
  whatsapp: string;
  notifyEmail: string;
  holdHours: string;
  seoTitle: string;
  seoDescription: string;
  indexable: boolean;
  faq: Array<{ q: string; a: string }>;
  accountRequired: boolean;
}

const toForm = (s: StoreSettings): Form => ({
  enabled: s.enabled,
  locationId: s.locationId ?? "",
  tagline: s.tagline ?? "",
  pickupEnabled: s.pickupEnabled,
  pickupInstructions: s.pickupInstructions ?? "",
  deliveryEnabled: s.deliveryEnabled,
  deliveryFee: centsToInput(s.deliveryFeeCents),
  freeFrom: s.freeDeliveryFromCents === null ? "" : centsToInput(s.freeDeliveryFromCents),
  deliveryArea: s.deliveryArea ?? "",
  minOrder: s.minOrderCents ? centsToInput(s.minOrderCents) : "",
  payOnDelivery: s.payOnDelivery,
  transferEnabled: s.transferEnabled,
  transferInstructions: s.transferInstructions ?? "",
  cardEnabled: s.cardEnabled,
  whatsapp: s.whatsapp ?? "",
  notifyEmail: s.notifyEmail ?? "",
  holdHours: String(s.holdHours),
  seoTitle: s.seoTitle ?? "",
  seoDescription: s.seoDescription ?? "",
  indexable: s.indexable,
  faq: s.faq,
  accountRequired: s.accountRequired,
});

export function StoreSettingsPage() {
  const { can } = useAuth();
  const { locations, settings } = useBusiness();
  const toast = useToast();
  const { data, error, setData } = useLoad(() => get<StoreSettings>("/store-settings"));
  const [form, setForm] = useState<Form | null>(null);
  useEffect(() => { if (data) setForm(toForm(data)); }, [data]);
  const writable = can("store:write");
  const active = locations.filter((l) => l.active);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));
  const money = (text: string, field: string, fields: Record<string, string>) => {
    if (!text.trim()) return 0;
    const v = parseMoney(text);
    if (v === null || v < 0) fields[field] = "Importe no válido";
    return v ?? 0;
  };
  const save = useSubmit(async () => {
    if (!form) return;
    const fields: Record<string, string> = {};
    const body: StoreSettingsInput = {
      enabled: form.enabled,
      locationId: form.locationId || null,
      tagline: form.tagline || null,
      about: data?.about ?? null,
      pickupEnabled: form.pickupEnabled,
      pickupInstructions: form.pickupInstructions || null,
      deliveryEnabled: form.deliveryEnabled,
      deliveryFeeCents: money(form.deliveryFee, "deliveryFeeCents", fields),
      freeDeliveryFromCents: form.freeFrom.trim() ? money(form.freeFrom, "freeDeliveryFromCents", fields) : null,
      deliveryArea: form.deliveryArea || null,
      minOrderCents: money(form.minOrder, "minOrderCents", fields),
      payOnDelivery: form.payOnDelivery,
      transferEnabled: form.transferEnabled,
      transferInstructions: form.transferInstructions || null,
      cardEnabled: form.cardEnabled,
      whatsapp: form.whatsapp || null,
      notifyEmail: form.notifyEmail || null,
      holdHours: Number(form.holdHours) || 0,
      seoTitle: form.seoTitle.trim() || null,
      seoDescription: form.seoDescription.trim() || null,
      indexable: form.indexable,
      faq: form.faq.map((f) => ({ q: f.q.trim(), a: f.a.trim() })).filter((f) => f.q || f.a),
      accountRequired: form.accountRequired,
    };
    if (Object.keys(fields).length) throw new RequestError(422, "validation_error", "Revisa los campos marcados", fields);
    const saved = await put<StoreSettings>("/store-settings", body);
    setData(saved);
    toast(saved.enabled ? "Tienda guardada y en línea" : "Ajustes guardados");
  });
  const publish = useSubmit(async (online: boolean) => {
    const saved = await post<StoreSettings>("/store-settings/publish", { productIds: null, online });
    setData({ ...saved });
    toast(online ? "Todos los productos activos están en la tienda" : "Ocultaste todos los productos de la tienda");
  });

  if (error) return <Alert tone="danger">{error.message}</Alert>;
  if (!data || !form) return <div className="nx-page-loading"><span className="nx-spinner" aria-label="Cargando" /></div>;
  const f = save.fields;

  return (
    <>
      <PageHeader
        title="Tienda en línea"
        description="Tu catálogo publicado en internet, con existencias reales y pedidos que llegan al panel."
        actions={writable && <Button variant="primary" loading={save.pending} onClick={() => void save.submit()}>Guardar</Button>}
      />
      {save.message && <Alert tone="danger">{save.message}</Alert>}
      <div className="nx-grid-doc">
        <div className="nx-stack" style={{ gap: 24 }}>
          <Card title="Estado">
            <div className="nx-stack">
              <Switch label={form.enabled ? "La tienda está en línea" : "La tienda está apagada"} checked={form.enabled} onChange={(v) => set("enabled", v)} disabled={!writable} />
              <div className="nx-row" style={{ gap: 8, flexWrap: "wrap" }}>
                <code className="nx-mono" style={{ padding: "6px 10px", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", background: "var(--surface-muted)", fontSize: 13 }}>{data.url}</code>
                <Button size="sm" variant="ghost" onClick={() => { void navigator.clipboard?.writeText(data.url); toast("Dirección copiada"); }}><Copy className="nx-icon" aria-hidden="true" />Copiar</Button>
                {data.enabled && <Button size="sm" variant="ghost" onClick={() => window.open(data.url, "_blank", "noopener")}><ExternalLink className="nx-icon" aria-hidden="true" />Abrir</Button>}
              </div>
              <SelectField label="Ubicación que surte los pedidos" value={form.locationId} onChange={(e) => set("locationId", e.target.value)} error={f.locationId} disabled={!writable} help="La tienda vende las existencias de esta ubicación y ahí se preparan los pedidos.">
                <option value="">Elige una ubicación</option>
                {active.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </SelectField>
              <TextField label="Frase de presentación" optional value={form.tagline} onChange={(e) => set("tagline", e.target.value)} disabled={!writable} placeholder="Artesanía hecha a mano, directo del taller a tu casa." help="Aparece bajo el nombre de tu negocio." />
            </div>
          </Card>

          <Card title="Entrega">
            <div className="nx-stack">
              {f.pickupEnabled && <Alert tone="danger">{f.pickupEnabled}</Alert>}
              <Checkbox label="Recoger en tienda" help="Sin costo para el cliente." checked={form.pickupEnabled} onChange={(e) => set("pickupEnabled", e.target.checked)} disabled={!writable} />
              {form.pickupEnabled && <TextField label="Horario o instrucciones para recoger" optional value={form.pickupInstructions} onChange={(e) => set("pickupInstructions", e.target.value)} disabled={!writable} placeholder="Lunes a sábado de 10:00 a 19:00 h." />}
              <Checkbox label="Envío a domicilio" checked={form.deliveryEnabled} onChange={(e) => set("deliveryEnabled", e.target.checked)} disabled={!writable} />
              {form.deliveryEnabled && (
                <div className="nx-form-grid">
                  <TextField label="Costo de envío" inputMode="decimal" className="nx-num" value={form.deliveryFee} onChange={(e) => set("deliveryFee", e.target.value)} error={f.deliveryFeeCents} disabled={!writable} help="0 si es gratis." />
                  <TextField label="Envío gratis desde" optional inputMode="decimal" className="nx-num" value={form.freeFrom} onChange={(e) => set("freeFrom", e.target.value)} error={f.freeDeliveryFromCents} disabled={!writable} help="Total del pedido." />
                  <TextField label="Zona de entrega" optional value={form.deliveryArea} onChange={(e) => set("deliveryArea", e.target.value)} disabled={!writable} placeholder="Centro y colonias a 5 km" fieldClassName="nx-span-2" />
                </div>
              )}
              <TextField label="Pedido mínimo" optional inputMode="decimal" className="nx-num" value={form.minOrder} onChange={(e) => set("minOrder", e.target.value)} error={f.minOrderCents} disabled={!writable} help="Déjalo vacío si no hay mínimo." />
            </div>
          </Card>

          <Card title="Formas de pago">
            <div className="nx-stack">
              {f.payOnDelivery && <Alert tone="danger">{f.payOnDelivery}</Alert>}
              <Checkbox label="Pago al recibir o al recoger" help="En efectivo o con tarjeta. Lo registras al entregar." checked={form.payOnDelivery} onChange={(e) => set("payOnDelivery", e.target.checked)} disabled={!writable} />
              <Checkbox label="Transferencia bancaria" help="El cliente ve tus datos al confirmar y tú registras el pago cuando llegue." checked={form.transferEnabled} onChange={(e) => set("transferEnabled", e.target.checked)} disabled={!writable} />
              {form.transferEnabled && (
                <TextAreaField label="Datos para transferir" rows={3} value={form.transferInstructions} onChange={(e) => set("transferInstructions", e.target.value)} error={f.transferInstructions} disabled={!writable} placeholder={"Banco: …\nCLABE: …\nA nombre de: …"} />
              )}
              <CardPayments checked={form.cardEnabled} onChange={(v) => set("cardEnabled", v)} writable={writable} error={f.cardEnabled} />
            </div>
          </Card>

          <Card title="Cuentas de clientes" description="Tus clientes pueden crear una cuenta en la tienda para ver sus pedidos y comprar más rápido. Al registrarse aparecen en Clientes.">
            <Checkbox
              label="Pedir cuenta para comprar"
              help="Pueden ver productos y llenar el carrito sin cuenta; al pagar se les pide entrar o crear una. Si lo desactivas, también pueden comprar como invitados."
              checked={form.accountRequired}
              onChange={(e) => set("accountRequired", e.target.checked)}
              disabled={!writable}
            />
          </Card>

          <Card title="Buscadores y asistentes de IA" description="Cómo aparece tu tienda en Google y qué leen ChatGPT, Gemini o Perplexity.">
            <div className="nx-stack">
              <SeoFields
                title={form.seoTitle}
                description={form.seoDescription}
                onTitle={(v) => set("seoTitle", v)}
                onDescription={(v) => set("seoDescription", v)}
                fallbackTitle={form.tagline ? `${settings?.tradeName ?? ""} · ${form.tagline}` : (settings?.tradeName ?? "Tu tienda")}
                fallbackDescription={form.tagline || `Compra en línea en ${settings?.tradeName ?? "tu tienda"}.`}
                url={data.url}
                disabled={!writable}
                errors={{ title: f.seoTitle, description: f.seoDescription }}
              />
              <Checkbox
                label="Permitir que los buscadores muestren la tienda"
                help={form.indexable ? "Aparece en el mapa del sitio y Google puede indexarla." : "La tienda funciona, pero pide a los buscadores no mostrarla."}
                checked={form.indexable}
                onChange={(e) => set("indexable", e.target.checked)}
                disabled={!writable}
              />
              <p className="nx-help" style={{ margin: 0 }}>
                Se generan solos: <a className="nx-link" href={`${data.url}/sitemap.xml`} target="_blank" rel="noreferrer">mapa del sitio</a>, datos estructurados de productos y{" "}
                <a className="nx-link" href={`${data.url}/llms.txt`} target="_blank" rel="noreferrer">llms.txt</a> para asistentes de IA.
              </p>
            </div>
          </Card>

          <Card title="Preguntas frecuentes" description="Responden dudas antes de comprar y ayudan a que Google y las IAs citen tu tienda.">
            <FaqEditor value={form.faq} onChange={(v) => set("faq", v)} writable={writable} error={f.faq} />
          </Card>
        </div>

        <div className="nx-stack" style={{ gap: 24 }}>
          <Card title="Productos publicados">
            <div className="nx-stack">
              <div>
                <span style={{ fontSize: 28, fontWeight: 500 }} className="nx-num">{data.publishedCount}</span>
                <span className="nx-muted"> de {data.activeCount} productos activos</span>
              </div>
              <p className="nx-help" style={{ margin: 0 }}>Publica o quita productos uno por uno desde su ficha (“Mostrar en la tienda en línea”).</p>
              {writable && (
                <div className="nx-row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <Button size="sm" loading={publish.pending} onClick={() => void publish.submit(true)} disabled={data.publishedCount === data.activeCount}>Publicar todos</Button>
                  <Button size="sm" variant="ghost" onClick={() => void publish.submit(false)} disabled={data.publishedCount === 0}>Ocultar todos</Button>
                </div>
              )}
            </div>
          </Card>
          <PoliciesCard writable={writable} />
          <DomainCard writable={writable} />
          <Card title="Contacto y avisos">
            <div className="nx-stack">
              <TextField label="WhatsApp" optional inputMode="tel" value={form.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} error={f.whatsapp} disabled={!writable} help="A 10 dígitos o con código de país. Agrega un botón de WhatsApp a tu tienda." />
              <TextField label="Correo para pedidos nuevos" optional type="email" value={form.notifyEmail} onChange={(e) => set("notifyEmail", e.target.value)} error={f.notifyEmail} disabled={!writable} help={`Si lo dejas vacío usamos ${settings?.email ?? "el correo del negocio"}.`} />
              <TextField label="Liberar pedidos sin aceptar después de (horas)" inputMode="numeric" className="nx-num" value={form.holdHours} onChange={(e) => set("holdHours", e.target.value)} error={f.holdHours} disabled={!writable} help="Los pedidos nuevos y sin pagar se cancelan solos y devuelven sus existencias. 0 = nunca." />
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
