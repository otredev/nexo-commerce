import { useRef, useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { IMPORT_BATCH_SIZE, normalizeSearch, parseMoney, UNITS, type ImportProduct, type ImportResult } from "@nexo/shared";
import { Alert, Button, Modal, Progress } from "@nexo/ui";
import { post } from "../lib/api";
import { downloadText, parseCsv, toCsv } from "../lib/csv";

const COLUMNS = [
  "nombre", "sku", "codigo_barras", "categoria", "marca", "descripcion", "unidad", "controla_inventario", "impuesto",
  "precio", "costo", "stock_inicial", "stock_minimo", "opcion1", "valor1", "opcion2", "valor2", "opcion3", "valor3", "palabras_clave",
] as const;
type Col = (typeof COLUMNS)[number];

const TEMPLATE = [
  [...COLUMNS],
  ["Taza de cerámica", "TAZ-001", "7501234567890", "Hogar > Cocina", "Olivo", "Taza blanca de 350 ml", "pieza", "si", "16", "185.00", "90.00", "24", "6", "", "", "", "", "", "", "regalo; cerámica"],
  ["Camisa de lino", "CAM-M-BL", "", "Ropa > Camisas", "Olivo", "", "pieza", "si", "16", "590.00", "300.00", "4", "1", "Talla", "M", "Color", "Blanco", "", "", "lino; verano"],
  ["Camisa de lino", "CAM-L-BL", "", "Ropa > Camisas", "Olivo", "", "pieza", "si", "16", "590.00", "300.00", "3", "1", "Talla", "L", "Color", "Blanco", "", "", ""],
  ["Café de grano", "CAF-KG", "", "Despensa", "", "", "kg", "si", "0", "320.00", "180.00", "12.5", "2", "", "", "", "", "", "", "orgánico"],
  ["Envoltura de regalo", "", "", "Servicios", "", "", "servicio", "no", "16", "30.00", "", "", "", "", "", "", "", "", "", ""],
];

const norm = (s: string) => normalizeSearch(s).replace(/[\s-]+/g, "_");
const num = (s: string) => {
  const t = s.trim().replace(/\s/g, "");
  if (!t) return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};
const unitFrom = (s: string) => {
  const v = norm(s);
  if (!v) return "unit";
  return UNITS.find((u) => [u.code, norm(u.label), norm(u.short)].includes(v))?.code ?? (v === "pz" || v === "piezas" ? "unit" : null);
};
const yesNo = (s: string) => {
  const v = norm(s);
  if (!v) return true;
  if (["si", "s", "yes", "true", "1", "x"].includes(v)) return true;
  if (["no", "n", "false", "0"].includes(v)) return false;
  return null;
};

interface Parsed {
  products: ImportProduct[];
  rowCount: number;
  errors: Array<{ rows: number[]; name: string; message: string }>;
}

/** Turns the CSV rows into products (rows with the same name become variants of one product). */
function buildProducts(rows: string[][]): Parsed {
  const header = (rows[0] ?? []).map(norm);
  const missing = (["nombre", "precio"] as Col[]).filter((c) => !header.includes(c));
  if (missing.length) return { products: [], rowCount: 0, errors: [{ rows: [1], name: "", message: `Faltan columnas obligatorias: ${missing.join(", ")}. Descarga la plantilla para ver el formato.` }] };
  const idx = Object.fromEntries(COLUMNS.map((c) => [c, header.indexOf(c)])) as Record<Col, number>;
  const cell = (r: string[], c: Col) => (idx[c] >= 0 ? (r[idx[c]] ?? "").trim() : "");

  const errors: Parsed["errors"] = [];
  const groups = new Map<string, { product: ImportProduct; rows: number[] }>();
  rows.slice(1).forEach((r, i) => {
    const rowNo = i + 2;
    const name = cell(r, "nombre");
    const fail = (message: string) => errors.push({ rows: [rowNo], name, message });
    if (!name) return fail("Falta el nombre");
    const price = parseMoney(cell(r, "precio"));
    if (price === null) return fail("Precio no válido");
    const costText = cell(r, "costo");
    const cost = costText ? parseMoney(costText) : 0;
    if (cost === null) return fail("Costo no válido");
    const stock = num(cell(r, "stock_inicial"));
    const min = num(cell(r, "stock_minimo"));
    if (Number.isNaN(stock) || (stock ?? 0) < 0) return fail("Stock inicial no válido");
    if (Number.isNaN(min) || (min ?? 0) < 0) return fail("Stock mínimo no válido");
    const taxText = cell(r, "impuesto").replace("%", "");
    const tax = num(taxText);
    if (Number.isNaN(tax)) return fail("Impuesto no válido (usa el porcentaje, por ejemplo 16)");
    const unit = unitFrom(cell(r, "unidad"));
    if (!unit) return fail(`Unidad desconocida "${cell(r, "unidad")}". Usa: ${UNITS.map((u) => u.label.toLowerCase()).join(", ")}`);
    const track = yesNo(cell(r, "controla_inventario"));
    if (track === null) return fail('controla_inventario debe ser "si" o "no"');
    const optionNames: string[] = [];
    const options: string[] = [];
    for (const n of [1, 2, 3] as const) {
      const on = cell(r, `opcion${n}` as Col);
      const ov = cell(r, `valor${n}` as Col);
      if (on || ov) {
        if (!on || !ov) return fail(`Completa opcion${n} y valor${n}`);
        optionNames.push(on);
        options.push(ov);
      }
    }
    const variant = { sku: cell(r, "sku"), barcode: cell(r, "codigo_barras") || null, options, priceCents: price, costCents: cost, minStock: min ?? 0, ...(stock !== null && { initialStock: stock }) };
    const key = normalizeSearch(name);
    const group = groups.get(key);
    if (!group) {
      groups.set(key, {
        rows: [rowNo],
        product: {
          name, description: cell(r, "descripcion") || null, categoryName: cell(r, "categoria") || null, brandName: cell(r, "marca") || null,
          keywords: cell(r, "palabras_clave"),
          taxPercent: tax, unit, trackInventory: track, optionNames, variants: [variant], rows: [rowNo],
        },
      });
      return;
    }
    const p = group.product;
    if ((p.optionNames ?? []).length === 0 || optionNames.length === 0) return fail(`"${name}" aparece en varias filas: cada fila debe ser una variante con opciones (opcion1/valor1)`);
    if (optionNames.map(norm).join("|") !== (p.optionNames ?? []).map(norm).join("|")) return fail(`Las opciones deben ser las mismas en todas las filas de "${name}" (${(p.optionNames ?? []).join(", ")})`);
    p.variants.push(variant);
    group.rows.push(rowNo);
    p.rows = group.rows;
  });
  const products = [...groups.values()].map((g) => g.product);
  return { products, rowCount: rows.length - 1, errors };
}

export function ImportProductsModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<{ created: number; errors: Parsed["errors"]; createdTaxes: string[] } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const reset = () => { setFileName(""); setParsed(null); setProgress(null); setResult(null); setFailure(null); };
  const close = () => { if (progress !== null && !result) return; reset(); onClose(); };

  const readFile = async (file: File) => {
    reset();
    setFileName(file.name);
    if (file.size > 5 * 1024 * 1024) return setFailure("El archivo pesa más de 5 MB. Divídelo en partes.");
    const rows = parseCsv(await file.text());
    if (rows.length < 2) return setFailure("El archivo está vacío o solo tiene encabezados.");
    setParsed(buildProducts(rows));
  };

  const run = async () => {
    if (!parsed) return;
    const all = parsed.products;
    const errors = [...parsed.errors];
    let created = 0;
    const createdTaxes: string[] = [];
    setProgress(0);
    for (let i = 0; i < all.length; i += IMPORT_BATCH_SIZE) {
      const batch = all.slice(i, i + IMPORT_BATCH_SIZE);
      try {
        const res = await post<ImportResult>("/products/import", { products: batch });
        created += res.created;
        createdTaxes.push(...res.createdTaxes);
        errors.push(...res.errors.map((e) => ({ rows: e.rows, name: e.name, message: e.message })));
      } catch (e) {
        errors.push(...batch.map((p) => ({ rows: p.rows ?? [], name: p.name, message: (e as Error).message })));
      }
      setProgress(Math.min(1, (i + batch.length) / all.length));
    }
    errors.sort((a, b) => (a.rows[0] ?? 0) - (b.rows[0] ?? 0));
    setResult({ created, errors, createdTaxes });
    if (created) onDone();
  };

  const downloadErrors = () => {
    if (!result) return;
    downloadText("errores-importacion.csv", toCsv([["fila", "producto", "error"], ...result.errors.map((e) => [e.rows.join(" "), e.name, e.message])]));
  };

  const ready = parsed?.products.length ?? 0;
  return (
    <Modal
      open={open}
      size="lg"
      title="Importar productos"
      onClose={close}
      dismissable={progress === null || result !== null}
      footer={
        result ? (
          <Button variant="primary" onClick={close}>Listo</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close} disabled={progress !== null}>Cancelar</Button>
            <Button variant="primary" disabled={!ready || progress !== null} loading={progress !== null} onClick={() => void run()}>
              {ready ? `Importar ${ready} ${ready === 1 ? "producto" : "productos"}` : "Importar"}
            </Button>
          </>
        )
      }
    >
      <div className="nx-stack">
        {!result && progress === null && (
          <>
            <p style={{ margin: 0 }}>
              Sube un archivo CSV con una fila por producto (o por variante). Las filas con el mismo nombre se agrupan como variantes.
              Las categorías y marcas que no existan se crean solas; para una subcategoría escribe «Ropa &gt; Camisas». Separa las palabras clave con punto y coma.{" "}
              <button type="button" className="nx-link" style={{ border: 0, background: "none", padding: 0, cursor: "pointer", font: "inherit" }} onClick={() => downloadText("plantilla-productos.csv", toCsv(TEMPLATE))}>
                Descargar plantilla
              </button>
            </p>
            <div
              className="nx-dropzone"
              data-over={over}
              role="button"
              tabIndex={0}
              onClick={() => fileRef.current?.click()}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileRef.current?.click(); }}
              onDragOver={(e) => { e.preventDefault(); setOver(true); }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) void readFile(f); }}
            >
              <FileSpreadsheet size={22} strokeWidth={1.5} aria-hidden="true" />
              <span style={{ fontWeight: 500 }}>{fileName || "Arrastra tu archivo aquí o haz clic para elegirlo"}</span>
              <span style={{ fontSize: 12 }}>CSV separado por comas o punto y coma, hasta 5 MB</span>
              <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f); e.target.value = ""; }} />
            </div>
          </>
        )}
        {failure && <Alert tone="danger">{failure}</Alert>}
        {parsed && !result && progress === null && (
          <>
            {ready > 0 && <Alert tone="success" title={`${ready} ${ready === 1 ? "producto listo" : "productos listos"} para importar`}>{parsed.rowCount} filas leídas de {fileName}.</Alert>}
            {parsed.errors.length > 0 && (
              <Alert tone="warning" title={`${parsed.errors.length} ${parsed.errors.length === 1 ? "fila tiene" : "filas tienen"} errores y no se importarán`}>
                <ErrorList errors={parsed.errors} />
              </Alert>
            )}
          </>
        )}
        {progress !== null && !result && (
          <div className="nx-stack" style={{ gap: 8 }}>
            <span>Importando… no cierres esta ventana.</span>
            <Progress value={progress} label="Progreso de la importación" />
          </div>
        )}
        {result && (
          <>
            <Alert tone={result.created ? "success" : "danger"} title={result.created ? `${result.created} ${result.created === 1 ? "producto importado" : "productos importados"}` : "No se importó ningún producto"}>
              {result.createdTaxes.length > 0 && `Tasas nuevas creadas: ${result.createdTaxes.join(", ")}. Puedes renombrarlas en Configuración → Impuestos.`}
            </Alert>
            {result.errors.length > 0 && (
              <Alert tone="warning" title={`${result.errors.length} con errores`}>
                <ErrorList errors={result.errors} />
                <Button size="sm" variant="ghost" onClick={downloadErrors} style={{ marginTop: 8, paddingLeft: 0 }}>Descargar errores (CSV)</Button>
              </Alert>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function ErrorList({ errors }: { errors: Parsed["errors"] }) {
  return (
    <ul className="nx-error-list">
      {errors.slice(0, 100).map((e, i) => (
        <li key={i}><span className="nx-num" style={{ fontWeight: 500 }}>Fila {e.rows.join(", ")}</span>{e.name && ` · ${e.name}`} — {e.message}</li>
      ))}
      {errors.length > 100 && <li>…y {errors.length - 100} más.</li>}
    </ul>
  );
}
