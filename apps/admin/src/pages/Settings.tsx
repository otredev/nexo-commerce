import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { ImagePlus, MapPin, Percent, Plus } from "lucide-react";
import { bpsToPercent, percentToBps, type BusinessSettings, type Location, type TaxRate } from "@nexo/shared";
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Modal, PageHeader, SelectField, Switch, Tabs, TextAreaField, TextField, useToast } from "@nexo/ui";
import { get, post, put, RequestError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLoad, useSubmit } from "../lib/hooks";
import { CURRENCIES, TIMEZONES } from "../lib/options";
import { useBusiness } from "../lib/business";

type Tab = "negocio" | "impuestos" | "ubicaciones" | "seguridad";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "negocio", label: "Negocio" },
  { id: "impuestos", label: "Impuestos" },
  { id: "ubicaciones", label: "Ubicaciones" },
  { id: "seguridad", label: "Seguridad" },
];

export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.id === params.get("tab"))?.id ?? "negocio") as Tab;
  return (
    <>
      <PageHeader title="Configuración" description="Datos del negocio, impuestos, ubicaciones y seguridad de tu cuenta." />
      <Tabs label="Secciones de configuración" tabs={TABS} value={tab} onChange={(id) => setParams(id === "negocio" ? {} : { tab: id })} />
      {tab === "negocio" && <BusinessTab />}
      {tab === "impuestos" && <TaxesTab />}
      {tab === "ubicaciones" && <LocationsTab />}
      {tab === "seguridad" && <SecurityTab />}
    </>
  );
}

/* ---------------- Negocio ---------------- */
function BusinessTab() {
  const { can, refresh } = useAuth();
  const business = useBusiness();
  const editable = can("settings:write");
  const toast = useToast();
  const { data, error, setData } = useLoad(() => get<BusinessSettings>("/settings"));
  const [form, setForm] = useState<BusinessSettings | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => setForm(data), [data]);

  const save = useSubmit(async () => {
    if (!form) return;
    const { updatedAt: _, ...body } = form;
    const saved = await put<BusinessSettings>("/settings", body);
    setData(saved);
    await refresh();
    void business.reload();
    toast("Cambios guardados");
  });
  const upload = useSubmit(async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await post<{ key: string }>("/uploads", fd);
    setForm((f) => (f ? { ...f, logoKey: res.key } : f));
  });

  if (error) return <Alert tone="danger">{error.message}</Alert>;
  if (!form) return <div className="nx-page-loading"><span className="nx-spinner" aria-label="Cargando" /></div>;
  const text = (k: keyof BusinessSettings) => ({
    value: (form[k] as string | null) ?? "",
    onChange: (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value === "" && k !== "tradeName" ? null : e.target.value }),
    error: save.fields[k],
    disabled: !editable,
  });
  const dirty = JSON.stringify(form) !== JSON.stringify(data);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void save.submit();
  };

  return (
    <form onSubmit={onSubmit} className="nx-stack" style={{ gap: 24 }}>
      {save.message && <Alert tone="danger">{save.message}</Alert>}
      <Card title="Datos del negocio" description="Aparecen en tus recibos y facturas.">
        <div className="nx-form-grid">
          <TextField label="Nombre comercial" {...text("tradeName")} />
          <TextField label="Razón social" optional {...text("legalName")} />
          <TextField label="RFC / NIT / RUT" optional {...text("taxId")} help="Identificación fiscal del negocio." />
          <TextField label="Teléfono" optional type="tel" {...text("phone")} />
          <TextField label="Correo de contacto" optional type="email" {...text("email")} />
          <TextField label="Dirección" optional {...text("address")} />
        </div>
      </Card>

      <Card title="Logotipo" description="Se usa en recibos y en tu tienda online. JPG, PNG o WebP de hasta 5 MB.">
        <div className="nx-row" style={{ gap: 16 }}>
          <div className="nx-thumb" style={{ width: 64, height: 64, display: "grid", placeItems: "center", overflow: "hidden" }}>
            {form.logoKey ? <img src={`/files/${form.logoKey}`} alt="Logotipo actual" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <ImagePlus className="nx-icon" aria-hidden="true" style={{ color: "var(--ink-subtle)" }} />}
          </div>
          {editable && (
            <div className="nx-row">
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload.submit(f); e.target.value = ""; }} />
              <Button onClick={() => fileRef.current?.click()} loading={upload.pending}>{form.logoKey ? "Cambiar imagen" : "Subir imagen"}</Button>
              {form.logoKey && <Button variant="ghost" onClick={() => setForm({ ...form, logoKey: null })}>Quitar</Button>}
            </div>
          )}
        </div>
        {(upload.message || upload.fields.file) && <div style={{ marginTop: 12 }}><Alert tone="danger">{upload.fields.file ?? upload.message}</Alert></div>}
      </Card>

      <Card
        title="Región y ventas"
        footer={editable ? (
          <>
            <Button variant="ghost" disabled={!dirty || save.pending} onClick={() => setForm(data)}>Descartar</Button>
            <Button type="submit" variant="primary" disabled={!dirty} loading={save.pending}>{save.pending ? "Guardando" : "Guardar cambios"}</Button>
          </>
        ) : undefined}
      >
        <div className="nx-form-grid">
          <SelectField label="Moneda" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} disabled={!editable} help="Cambiarla no convierte precios existentes.">
            {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
          </SelectField>
          <SelectField label="Zona horaria" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} disabled={!editable}>
            {[...new Set([form.timezone, ...TIMEZONES])].map((tz) => <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>)}
          </SelectField>
          <div className="nx-span-2">
            <Checkbox
              label="Los precios incluyen impuestos"
              help="Recomendado para ventas al público: el precio que capturas es el que paga el cliente."
              checked={form.pricesIncludeTax}
              disabled={!editable}
              onChange={(e) => setForm({ ...form, pricesIncludeTax: e.target.checked })}
            />
          </div>
          <TextAreaField label="Mensaje al pie del recibo" optional fieldClassName="nx-span-2" {...text("receiptFooter")} placeholder="¡Gracias por tu compra!" rows={2} />
        </div>
      </Card>
    </form>
  );
}

/* ---------------- Impuestos ---------------- */
function TaxesTab() {
  const { can } = useAuth();
  const business = useBusiness();
  const editable = can("taxes:write");
  const toast = useToast();
  const { data, error, reload } = useLoad(() => get<TaxRate[]>("/taxes"));
  const [editing, setEditing] = useState<TaxRate | "new" | null>(null);
  const [form, setForm] = useState({ name: "", percent: "", isDefault: false, active: true });

  const open = (t: TaxRate | "new") => {
    setEditing(t);
    setForm(t === "new" ? { name: "", percent: "", isDefault: false, active: true } : { name: t.name, percent: String(bpsToPercent(t.rateBps)), isDefault: t.isDefault, active: t.active });
  };
  const save = useSubmit(async () => {
    const percent = Number(form.percent.replace(",", "."));
    if (!form.percent.trim() || !Number.isFinite(percent) || percent < 0 || percent > 100) throw new RequestError(422, "validation_error", "Revisa los campos marcados", { rateBps: "Escribe un porcentaje entre 0 y 100" });
    const body = { name: form.name, rateBps: percentToBps(percent), isDefault: form.isDefault, active: form.active };
    if (editing === "new") await post("/taxes", body);
    else if (editing) await put(`/taxes/${editing.id}`, body);
    setEditing(null);
    toast("Impuesto guardado");
    await reload();
    void business.reload();
  });

  if (error) return <Alert tone="danger">{error.message}</Alert>;
  return (
    <>
      <div className="nx-table-wrap">
        <div className="nx-table-toolbar">
          <span className="nx-muted" style={{ fontSize: 13 }}>Las tasas se aplican a cada producto. El predeterminado se asigna a los productos nuevos.</span>
          {editable && <Button size="sm" variant="primary" onClick={() => open("new")}><Plus className="nx-icon" aria-hidden="true" />Nuevo impuesto</Button>}
        </div>
        {data && data.length === 0 ? (
          <EmptyState icon={<Percent className="nx-icon" />} title="Sin impuestos" text="Agrega las tasas que cobras, por ejemplo IVA 16 %." />
        ) : (
          <div className="nx-table-scroll">
            <table className="nx-table">
              <thead><tr><th>Nombre</th><th className="nx-col-num">Tasa</th><th>Estado</th><th aria-label="Acciones" /></tr></thead>
              <tbody>
                {data?.map((t) => (
                  <tr key={t.id}>
                    <td>{t.name} {t.isDefault && <Badge tone="accent" plain>Predeterminado</Badge>}</td>
                    <td className="nx-col-num">{bpsToPercent(t.rateBps).toLocaleString("es-MX", { maximumFractionDigits: 2 })} %</td>
                    <td>{t.active ? <Badge tone="success">Activo</Badge> : <Badge>Inactivo</Badge>}</td>
                    <td style={{ textAlign: "right" }}>{editable && <Button size="sm" variant="ghost" onClick={() => open(t)}>Editar</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Modal
        open={editing !== null}
        title={editing === "new" ? "Nuevo impuesto" : "Editar impuesto"}
        onClose={() => setEditing(null)}
        footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button><Button variant="primary" loading={save.pending} onClick={() => void save.submit()}>Guardar</Button></>}
      >
        <div className="nx-stack">
          {save.message && <Alert tone="danger">{save.message}</Alert>}
          <TextField label="Nombre" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={save.fields.name} placeholder="IVA 16%" />
          <TextField label="Tasa" inputMode="decimal" className="nx-num" value={form.percent} onChange={(e) => setForm({ ...form, percent: e.target.value })} error={save.fields.rateBps} help="En porcentaje, por ejemplo 16." />
          <Switch label="Predeterminado para productos nuevos" checked={form.isDefault} onChange={(v) => setForm({ ...form, isDefault: v })} />
          <Switch label="Activo" checked={form.active} onChange={(v) => setForm({ ...form, active: v })} />
        </div>
      </Modal>
    </>
  );
}

/* ---------------- Ubicaciones ---------------- */
function LocationsTab() {
  const { can } = useAuth();
  const business = useBusiness();
  const editable = can("locations:write");
  const toast = useToast();
  const { data, error, reload } = useLoad(() => get<Location[]>("/locations"));
  const [editing, setEditing] = useState<Location | "new" | null>(null);
  const empty = { name: "", type: "store" as Location["type"], address: "", isDefault: false, active: true };
  const [form, setForm] = useState(empty);

  const open = (l: Location | "new") => {
    setEditing(l);
    setForm(l === "new" ? empty : { name: l.name, type: l.type, address: l.address ?? "", isDefault: l.isDefault, active: l.active });
  };
  const save = useSubmit(async () => {
    const body = { ...form, address: form.address || null };
    if (editing === "new") await post("/locations", body);
    else if (editing) await put(`/locations/${editing.id}`, body);
    setEditing(null);
    toast("Ubicación guardada");
    await reload();
    void business.reload();
  });

  if (error) return <Alert tone="danger">{error.message}</Alert>;
  return (
    <>
      <div className="nx-table-wrap">
        <div className="nx-table-toolbar">
          <span className="nx-muted" style={{ fontSize: 13 }}>Tiendas y bodegas donde guardas inventario.</span>
          {editable && <Button size="sm" variant="primary" onClick={() => open("new")}><Plus className="nx-icon" aria-hidden="true" />Nueva ubicación</Button>}
        </div>
        {data && data.length === 0 ? (
          <EmptyState icon={<MapPin className="nx-icon" />} title="Sin ubicaciones" />
        ) : (
          <div className="nx-table-scroll">
            <table className="nx-table">
              <thead><tr><th>Nombre</th><th>Tipo</th><th>Dirección</th><th>Estado</th><th aria-label="Acciones" /></tr></thead>
              <tbody>
                {data?.map((l) => (
                  <tr key={l.id}>
                    <td>{l.name} {l.isDefault && <Badge tone="accent" plain>Principal</Badge>}</td>
                    <td>{l.type === "store" ? "Tienda" : "Bodega"}</td>
                    <td className="nx-muted">{l.address ?? "—"}</td>
                    <td>{l.active ? <Badge tone="success">Activa</Badge> : <Badge>Inactiva</Badge>}</td>
                    <td style={{ textAlign: "right" }}>{editable && <Button size="sm" variant="ghost" onClick={() => open(l)}>Editar</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Modal
        open={editing !== null}
        title={editing === "new" ? "Nueva ubicación" : "Editar ubicación"}
        onClose={() => setEditing(null)}
        footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button><Button variant="primary" loading={save.pending} onClick={() => void save.submit()}>Guardar</Button></>}
      >
        <div className="nx-stack">
          {save.message && <Alert tone="danger">{save.message}</Alert>}
          <TextField label="Nombre" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={save.fields.name} placeholder="Sucursal Centro" />
          <SelectField label="Tipo" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as Location["type"] })}>
            <option value="store">Tienda (vende al público)</option>
            <option value="warehouse">Bodega (solo almacena)</option>
          </SelectField>
          <TextField label="Dirección" optional value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} error={save.fields.address} />
          <Switch label="Ubicación principal" checked={form.isDefault} onChange={(v) => setForm({ ...form, isDefault: v })} />
          <Switch label="Activa" checked={form.active} onChange={(v) => setForm({ ...form, active: v })} />
        </div>
      </Modal>
    </>
  );
}

/* ---------------- Seguridad ---------------- */
function SecurityTab() {
  const toast = useToast();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [mismatch, setMismatch] = useState(false);
  const save = useSubmit(async () => {
    await post("/auth/password/change", { currentPassword: form.currentPassword, newPassword: form.newPassword });
    setForm({ currentPassword: "", newPassword: "", confirm: "" });
    toast("Contraseña actualizada. Cerramos tus otras sesiones.");
  });
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (form.newPassword !== form.confirm) return setMismatch(true);
    setMismatch(false);
    void save.submit();
  };
  return (
    <form onSubmit={onSubmit} style={{ maxWidth: 560 }}>
      <Card
        title="Cambiar contraseña"
        description="Al cambiarla se cierran tus sesiones en otros dispositivos."
        footer={<Button type="submit" variant="primary" loading={save.pending}>Actualizar contraseña</Button>}
      >
        <div className="nx-stack">
          {save.message && <Alert tone="danger">{save.message}</Alert>}
          <TextField label="Contraseña actual" type="password" autoComplete="current-password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} error={save.fields.currentPassword} />
          <TextField label="Nueva contraseña" type="password" autoComplete="new-password" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} error={save.fields.newPassword} help="Al menos 10 caracteres." />
          <TextField label="Confirma la nueva contraseña" type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} error={mismatch ? "Las contraseñas no coinciden" : undefined} />
        </div>
      </Card>
    </form>
  );
}
