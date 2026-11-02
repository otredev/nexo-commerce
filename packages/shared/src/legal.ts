/**
 * The store's legal pages (privacy notice, terms, returns) and the tiny Markdown they are written in.
 * The same parser renders them in the store (React), in the server HTML (search engines) and in llms.txt.
 */

export const POLICY_KINDS = ["privacy", "terms", "returns"] as const;
export type PolicyKind = (typeof POLICY_KINDS)[number];

export const POLICY_INFO: Record<PolicyKind, { title: string; path: string; short: string }> = {
  privacy: { title: "Aviso de privacidad", path: "privacidad", short: "Privacidad" },
  terms: { title: "Términos y condiciones", path: "terminos", short: "Términos" },
  returns: { title: "Cambios y devoluciones", path: "devoluciones", short: "Devoluciones" },
};

export const policyByPath = (path: string): PolicyKind | null =>
  (POLICY_KINDS.find((k) => POLICY_INFO[k].path === path) ?? null);

/* ---------------- Markdown subset ---------------- */

export type Inline = { t: "text"; v: string } | { t: "bold"; v: string } | { t: "link"; v: string; href: string };
export type TextBlock = { t: "h2" | "h3" | "p"; c: Inline[] };
export type ListBlock = { t: "ul" | "ol"; items: Inline[][] };
export type Block = TextBlock | ListBlock;
export const isList = (b: Block): b is ListBlock => b.t === "ul" || b.t === "ol";

/** Links allowed in policies: web, email and phone — never javascript: or data:. */
export const safeHref = (href: string): string | null => {
  const h = href.trim();
  if (/^(https?:\/\/|mailto:|tel:)/i.test(h)) return h;
  if (/^\/[^/]/.test(h) || h === "/") return h;
  return null;
};

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ t: "text", v: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ t: "bold", v: m[1] });
    else {
      const href = safeHref(m[3]!);
      out.push(href ? { t: "link", v: m[2]!, href } : { t: "text", v: m[2]! });
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ t: "text", v: text.slice(last) });
  return out;
}

/** Headings (##, ###; # becomes ##), paragraphs, - lists and 1. lists. Anything else is text. */
export function parseMarkdown(md: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { t: "ul" | "ol"; items: Inline[][] } | null = null;
  const flush = () => {
    if (para.length) blocks.push({ t: "p", c: parseInline(para.join(" ")) });
    para = [];
    if (list) blocks.push(list);
    list = null;
  };
  for (const raw of md.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const h = /^(#{1,3})\s+(.+)$/.exec(line);
    if (h) { flush(); blocks.push({ t: h[1]!.length === 3 ? "h3" : "h2", c: parseInline(h[2]!) }); continue; }
    const ul = /^[-*]\s+(.+)$/.exec(line);
    const ol = /^\d+[.)]\s+(.+)$/.exec(line);
    if (ul || ol) {
      const kind = ul ? "ul" : "ol";
      if (para.length) { blocks.push({ t: "p", c: parseInline(para.join(" ")) }); para = []; }
      if (!list || list.t !== kind) { if (list) blocks.push(list); list = { t: kind, items: [] }; }
      list.items.push(parseInline((ul ?? ol)![1]!));
      continue;
    }
    if (list) { blocks.push(list); list = null; }
    para.push(line);
  }
  flush();
  return blocks;
}

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

const inlineHtml = (c: Inline[]) =>
  c.map((i) => (i.t === "text" ? escapeHtml(i.v) : i.t === "bold" ? `<strong>${escapeHtml(i.v)}</strong>` : `<a href="${escapeHtml(i.href)}">${escapeHtml(i.v)}</a>`)).join("");

export function markdownToHtml(md: string): string {
  return parseMarkdown(md)
    .map((b) => {
      if (isList(b)) return `<${b.t}>${b.items.map((i) => `<li>${inlineHtml(i)}</li>`).join("")}</${b.t}>`;
      return `<${b.t}>${inlineHtml(b.c)}</${b.t}>`;
    })
    .join("\n");
}

const inlineText = (c: Inline[]) => c.map((i) => (i.t === "link" ? `${i.v} (${i.href})` : i.v)).join("");
export function markdownToText(md: string): string {
  return parseMarkdown(md)
    .map((b) => {
      if (isList(b)) return b.items.map((i, n) => `${b.t === "ol" ? `${n + 1}.` : "-"} ${inlineText(i)}`).join("\n");
      return inlineText(b.c);
    })
    .join("\n\n");
}

/* ---------------- Starting templates (Mexico) ---------------- */

export interface TemplateBusiness {
  name: string;
  legalName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  storeUrl: string;
}

const or = (v: string | null | undefined, fallback: string) => (v && v.trim() ? v.trim() : fallback);

/**
 * A reasonable starting text for each page, filled with the business's data. Not legal advice:
 * the dashboard says so and asks the owner to review it. Placeholders in [brackets] must be completed.
 */
export function policyTemplate(kind: PolicyKind, b: TemplateBusiness): string {
  const who = or(b.legalName, b.name);
  const email = or(b.email, "[correo de contacto]");
  const address = or(b.address, "[domicilio]");
  const phone = or(b.phone, "[teléfono]");
  if (kind === "privacy") {
    return `## Responsable
${who}, con domicilio en ${address}, es responsable del tratamiento de los datos personales que nos proporcionas al comprar en ${b.storeUrl}.

## Datos que recabamos
- Nombre, correo electrónico y teléfono.
- Dirección de entrega, cuando eliges envío a domicilio.
- Los productos que compras y la forma de pago. No guardamos los datos de tu tarjeta: el pago con tarjeta lo procesa Stripe.

## Para qué los usamos
- Preparar, entregar y darte seguimiento a tu pedido.
- Enviarte la confirmación y los avisos de tu pedido por correo.
- Atender aclaraciones, cambios y devoluciones.
- Cumplir obligaciones fiscales y legales.

No vendemos ni rentamos tus datos. Solo los compartimos con quienes nos ayudan a operar la tienda (alojamiento, envío de correos, procesamiento de pagos y paquetería), y únicamente para esos fines.

## Tus derechos ARCO
Puedes pedir el **acceso**, la **rectificación**, la **cancelación** u **oposición** al uso de tus datos, o revocar tu consentimiento, escribiendo a ${email}. Indica tu nombre, el pedido relacionado y lo que solicitas. Te responderemos en un plazo máximo de 20 días hábiles.

## Cambios a este aviso
Cualquier cambio se publicará en esta página con su fecha de actualización.

Contacto: ${email} · ${phone}`;
  }
  if (kind === "terms") {
    return `## Quiénes somos
Esta tienda en línea es operada por ${who}, con domicilio en ${address}. Contacto: ${email} · ${phone}.

## Pedidos
- Al confirmar un pedido apartamos los productos. El pedido queda formalizado cuando lo aceptamos o, si pagas con tarjeta, cuando se confirma el pago.
- Si un producto deja de estar disponible después de tu pedido, te avisaremos y te devolveremos lo que hayas pagado por él.
- Los pedidos sin pago ni confirmación pueden cancelarse automáticamente después del plazo indicado en la tienda.

## Precios y pagos
- Los precios están en pesos mexicanos e incluyen IVA, salvo que se indique otra cosa.
- El costo de envío se muestra antes de confirmar.
- Formas de pago: las que aparecen al pagar (al recibir, transferencia o tarjeta).

## Entregas
Recoge tu pedido en tienda o recíbelo en la zona de entrega indicada. Los tiempos son estimados y te avisaremos de cualquier retraso.

## Cambios y devoluciones
Consulta nuestra política de [cambios y devoluciones](/devoluciones).

## Datos personales
Tratamos tus datos conforme a nuestro [aviso de privacidad](/privacidad).

## Ley aplicable
Estos términos se rigen por las leyes de México, incluida la Ley Federal de Protección al Consumidor. Para cualquier queja puedes acudir a la PROFECO.`;
  }
  return `## Plazo
Puedes solicitar un cambio o devolución dentro de los **[30] días naturales** siguientes a que recibas tu pedido.

## Condiciones
- El producto debe estar sin uso, en buen estado y con su empaque original.
- Presenta tu número de pedido.
- [Productos que no aplican: por ejemplo, artículos personalizados, de higiene o en liquidación.]

## Cómo solicitarlo
Escríbenos a ${email} o llama al ${phone} con tu número de pedido y el motivo. Te diremos cómo enviarlo o dónde entregarlo.

## Reembolsos
Una vez revisado el producto, reembolsamos por el mismo medio de pago en un plazo de [10] días hábiles. Si el producto llegó dañado o equivocado, nosotros cubrimos el envío.`;
}
