# Referencia técnica

Cómo está construido Nexo Commerce por dentro: datos, reglas, módulos, seguridad y la API completa. Para usar el panel, ve el [manual de usuario](manual-de-usuario.md); para publicarlo, la [guía de despliegue](despliegue.md).

## Contenido

- [Bases D1](#bases-d1) · [Reglas que no se rompen](#reglas-que-no-se-rompen) · [Inventario y Kardex](#inventario-y-kardex) · [Catálogo](#catálogo) · [Punto de venta](#punto-de-venta) · [Abastecimiento](#abastecimiento)
- [Tienda en línea](#tienda-en-línea) · [Clientes, promociones y cuentas por pagar](#clientes-promociones-y-cuentas-por-pagar) · [SaaS](#saas-planes-stripe-dominios-y-plataforma) · [Políticas, buscadores e IA](#tienda-políticas-buscadores-e-ia-fase-7)
- [Pantalla del cliente y notificaciones](#operación-diaria-pantalla-del-cliente-y-notificaciones-fase-8) · [Apariencia](#apariencia-de-la-tienda-fase-9) · [Estadísticas](#estadísticas-de-la-tienda-fase-10) · [Integraciones](#integraciones-api-webhooks-y-asistentes-de-ia-fase-11)
- [Seguridad](#seguridad) · [Respaldos](#respaldos) · [API](#api) · [Navegación del panel](#navegación-del-panel) · [Sistema de diseño](#sistema-de-diseño)

---

## Bases D1

| Binding | Contenido |
|---|---|
| `DB_CONTROL` | Plataforma: `tenants` (plan, Stripe, estado), `users`, `memberships`, `sessions`, `password_resets`, `login_attempts`, `tenant_domains`, `stripe_events` |
| `DB_TENANT_DEFAULT` (y `DB_TENANT_*`) | Datos de cada negocio: configuración, catálogo, inventario, ventas, compras, pedidos, clientes… **Todas las tablas llevan `tenant_id`.** |

Cada fila de `tenants` guarda en `db_binding` qué base usa y `getTenantDb()` es la única forma de llegar a ella. Mover un negocio a otra D1 solo cambia ese valor (ver *Plataforma*).

## Reglas que no se rompen

1. **Toda consulta de negocio pasa por `getTenantDb()`** (`apps/api/src/lib/tenant.ts`) y filtra por `tenant_id`. Las rutas reciben la base ya resuelta en `c.var.auth.db`.
2. **Cambio + auditoría en el mismo `db.batch()`.** `auditEntry()` devuelve el INSERT para meterlo en el lote: o se guardan ambos o ninguno. D1 no tiene transacciones interactivas; los lotes son atómicos.
3. **Dinero en centavos (enteros)** y tasas en puntos base (1600 = 16 %). Nunca `float`. Ver `packages/shared/src/money.ts`.
4. **Permisos por nombre** (`can(role, "settings:write")`), no por rol directo. Así se podrán volver granulares sin tocar rutas.
5. **Sin valores visuales literales en la UI**: todo viene de los tokens del sistema de diseño.

6. **El stock nunca se edita directamente.** Solo `apps/api/src/lib/inventory.ts` lo cambia, y siempre genera su movimiento en el Kardex dentro del mismo lote (ver abajo).

## Inventario y Kardex

- `stock_levels` guarda la existencia por variante y ubicación, con `CHECK (quantity >= 0)`. Una salida mayor a lo disponible hace fallar el `CHECK` y **todo el lote se revierte**: la venta, el movimiento y lo demás. Como cada D1 procesa una petición a la vez, no hay condiciones de carrera: la prueba de punta a punta lanza 12 salidas simultáneas y solo pasan las que caben.
- `stock_movements` es el Kardex, solo de inserción: tipo (inicial, entrada, salida, ajuste por conteo), motivo, cantidad con signo, **saldo después del movimiento**, costo unitario del momento, nota, usuario y fecha. Se ordena por el `rowid` de SQLite, que sigue el orden real de escritura.
- **Costo promedio ponderado**: cada entrada con costo recalcula `variants.cost_cents` sobre la existencia de todas las ubicaciones. Las salidas guardan el costo vigente, así la rentabilidad futura usa el costo real de ese momento.
- **Cantidades en milésimas** (enteros): permite vender 1.25 kg sin errores de punto flotante. La API recibe y devuelve números normales en la unidad del producto. Las unidades sin decimales (pieza, caja…) rechazan fracciones.
- Para usarlo desde otro módulo (POS, compras): `movementStatements(d1, actor, movimiento)` devuelve las sentencias; agrégalas al mismo `d1.batch()` que el documento que las causa.

## Catálogo

- Producto → variantes (hasta 3 opciones, 100 combinaciones). Un producto simple es un producto con una sola variante sin opciones: el resto del sistema (POS, tienda) siempre trabaja con variantes.
- SKU único por negocio (se guarda en mayúsculas y se genera solo si se deja vacío) y código de barras único por negocio. Índices parciales: los eliminados liberan sus códigos.
- Búsqueda sin acentos ni mayúsculas sobre nombre, SKU, código de barras y opciones (`products.search_text`, mantenido en cada escritura).
- Productos con existencias no se eliminan (se archivan). No se puede quitar una variante con stock, ni cambiar la unidad o dejar de controlar inventario mientras haya existencias.
- El cajero ve productos y existencias, pero no costos, márgenes ni el valor del inventario (`costs:read`).
- Importación CSV: el dashboard lee el archivo (coma o punto y coma, como lo exporta Excel en español), agrupa por nombre las filas con opciones como variantes y envía lotes de 25. El servidor valida cada producto, crea las categorías, marcas y tasas de impuesto que falten, y reporta los errores por número de fila. Plantilla descargable desde el propio diálogo.

## Punto de venta

- **Una venta = un `d1.batch()`**: folio, venta, líneas, pagos, salidas de inventario (Kardex tipo `sale`) y tablas de resumen. Si falta existencia de un solo producto, el `CHECK` revierte todo: no queda venta a medias ni folio consumido.
- **Folios consecutivos sin huecos** por negocio (`counters`, incrementado dentro del mismo lote).
- **Idempotencia**: el POS genera un `clientId` por cobro y lo reenvía en cada reintento; el índice único `(tenant_id, client_id)` garantiza que un corte de red no cobre dos veces.
- **El servidor recalcula todo** con `computeSale()` (de `@nexo/shared`) usando precios, impuestos y costos de la base. El cliente solo envía qué productos, cuánto y qué descuento.
- **Instantánea en cada línea**: nombre, opciones, SKU, precio, tasa, impuesto y costo del momento. Cambiar un producto después nunca altera ventas pasadas.
- **Impuestos por línea** según el impuesto del producto (o el predeterminado), con precios que incluyen o no impuestos según la configuración. Los descuentos generales se reparten proporcionalmente sin perder centavos.
- **Pagos**: efectivo, tarjeta, transferencia u otro, combinables. Solo el efectivo genera cambio.
- **Descuentos**: el cajero tiene un límite configurable (10 % por defecto); propietario y administrador no.
- **Caja**: una sesión abierta por ubicación (índice único parcial). Cierre ciego: el cajero cuenta antes de ver el esperado. Efectivo esperado = fondo + ventas en efectivo − cambio + ingresos − retiros − reembolsos en efectivo.
- **Anulación** solo dentro del turno de caja abierto y sin devoluciones (después, se usa devolución). Regresa existencias y descuenta de los resúmenes.
- **Devoluciones** parciales o totales, con o sin reingreso al inventario, reembolso por cualquier método (en efectivo exige caja abierta). `CHECK (returned_quantity <= quantity)` impide devolver de más aunque haya dos devoluciones simultáneas.
- **Resúmenes diarios** (`daily_sales`, `daily_product_sales`), actualizados en el mismo lote que cada venta, anulación o devolución, por fecha local del negocio. El dashboard solo lee estas tablas.
- **Recibo** en `/recibo/:id`, ajustado a impresora térmica de 58 u 80 mm, o enviado por correo.
- Atajos del POS: escanear o escribir y `Enter` agrega; `F2` cobrar; `F4` descuento general; `Esc` vuelve a la búsqueda; `+`/`−` cambian la cantidad de la línea seleccionada; en el cobro, `Enter` confirma y abre la siguiente venta.

> Facturación electrónica: no incluida. El recibo indica que no es comprobante fiscal. Se integrará por país cuando el mercado lo exija (CFDI quedó fuera de la Fase 6).

> Escala: la lista de productos calcula existencias y valor al vuelo. Es suficiente para miles de productos; cuando un negocio crezca mucho, la Fase 5 agrega tablas de resumen.

## Abastecimiento

- **Documentos con folio propio** y sin huecos: órdenes `OC-000001`, traspasos `TR-000001`, conteos `CF-000001`. Nunca se borran: se cancelan.
- **Cambios de estado a prueba de carreras**: cada transición va en el mismo lote que sus movimientos como `SET status = CASE WHEN status IN (...) THEN 'siguiente' END`. Si otra petición cambió el estado antes, el `CASE` da `NULL`, falla el `NOT NULL` y se revierte todo (existencias incluidas). Dos envíos o dos aplicaciones simultáneas: solo una entra.
- **Órdenes de compra**: borrador → pedida → recibida en parte → recibida (o cancelada). Se editan mientras no tengan recepciones. Costos netos (antes de impuesto) e impuesto por línea. Se envían al proveedor por correo y se pueden repetir.
- **Recepciones**: parciales o totales, con el costo real de la factura. Cada una sube existencias (Kardex tipo `purchase`, con folio y número de factura) y recalcula el costo promedio ponderado. `CHECK (received_quantity <= quantity)` impide recibir de más aunque dos personas reciban a la vez. Una orden parcial se puede cerrar con pendientes. El vencimiento de la factura sale de los días de crédito del proveedor.
- **Sugerencias de reorden**: productos en su mínimo o por debajo, con cantidad sugerida para llegar al doble del mínimo.
- **Traspasos**: al enviar salen del origen (`transfer_out`, falla si no alcanza); al confirmar la llegada entran al destino (`transfer_in`) con lo que realmente llegó. La diferencia queda registrada y valorizada. Cancelar uno en tránsito regresa todo al origen. El costo promedio no cambia.
- **Conteos físicos** por categoría, de todo el inventario o de productos sueltos. El cajero captura a ciegas (no ve la existencia del sistema); el administrador revisa diferencias y aplica. Al capturar cada línea se guarda la existencia del sistema en ese instante y el ajuste final es `contado − existencia al contar`: **se puede seguir vendiendo durante el conteo** sin descuadrar. El ajuste se aplica con sentencias por conjunto (sirve para miles de productos) y solo genera Kardex donde hay diferencia.

## Tienda en línea

- **Dónde vive**: `apps/store` es una app React publicada en **Cloudflare Pages**. Sus Pages Functions reenvían `/api/store/*` y `/files/*` al Worker de la API por **service binding** (sin salir a internet y en el mismo origen). La API del panel no es accesible desde el dominio de la tienda.
- **Dirección**: `https://<dominio-de-la-tienda>/<slug-del-negocio>`, o el dominio propio del negocio (ver *Dominios propios*). El slug se resuelve contra la D1 de control.
- **Compartir y buscadores**: una Function de middleware pone título, descripción e imagen reales en el HTML de la portada y de cada producto (WhatsApp, redes, Google).
- **Qué se publica**: productos activos marcados “Mostrar en la tienda en línea” (uno por uno o todos desde Ajustes de la tienda). Los precios se muestran con impuestos, sea cual sea la configuración del negocio.
- **Existencias reales**: la tienda vende lo que hay en la ubicación que surte los pedidos. **Un pedido aparta existencias al confirmarse** (Kardex tipo `order`) con el mismo `CHECK` que las ventas: la caja y la web nunca venden la misma última pieza. Cancelar las regresa (`order_cancel`).
- **Pedido = un `d1.batch()`**: folio, pedido, líneas con instantánea de precio, impuesto y costo, y salidas de inventario. Idempotente con `clientId`. El servidor recalcula el total; si los precios cambiaron responde `price_changed` y la tienda actualiza el carrito.
- **Ciclo**: nuevo → aceptado → listo para recoger / en camino → entregado (o cancelado). El cliente recibe un correo en cada paso y sigue su pedido con un enlace secreto; puede cancelarlo mientras sea nuevo y no esté pagado.
- **Cobro**: pago al recibir/recoger, transferencia (con tus datos bancarios) o tarjeta con Stripe (ver *SaaS*). El pago se registra en el panel; **el efectivo entra a la caja abierta** como ingreso, así el corte cuadra. Al entregarse, el pedido suma a las ventas del día (`daily_sales.online_*`) y a lo más vendido.
- **Pedidos olvidados**: cada hora, los pedidos nuevos y sin pagar con más de N horas (48 por defecto, configurable) se cancelan solos y liberan sus existencias.
- **Protección**: máximo 10 pedidos por hora por IP y por tienda; los pedidos se validan contra productos publicados y activos.

## Clientes, promociones y cuentas por pagar

- **Clientes**: se registran en el panel, en la caja al cobrar o solos con cada pedido en línea (se reconocen por correo o teléfono, escrito como sea). La ficha junta compras en caja y en línea, total, ticket promedio, última compra y lo que más compra. No se borran: se archivan. Exportación a CSV.
- **Un solo motor de precios** (`priceCart` en `@nexo/shared`) corre en la caja, en la tienda y en el servidor, así que lo que el cliente ve es lo que se cobra. Orden: promoción automática por línea (la mejor, no se suman) → descuento a mano por línea → cupón sobre el subtotal → descuento general a mano.
- **Promociones automáticas**: porcentaje sobre todo, categorías o productos, con fechas (en la zona horaria del negocio) y canal (caja, tienda o ambos). En la tienda se ve el precio antes y ahora.
- **Cupones**: porcentaje o importe, compra mínima, usos máximos, fechas y canal. `CHECK (uses_count <= max_uses)` en el mismo lote que la venta: dos cajas no pueden gastar la última redención.
- **El límite de descuento del cajero** solo cuenta los descuentos a mano, no las promociones ni los cupones (que autorizó el negocio).
- **Cuentas por pagar**: cada recepción de compra es una factura (neto + IVA) con vencimiento según los días de crédito del proveedor. Pagos parciales o totales, opcionalmente en efectivo desde la caja (queda como retiro en el corte). El saldo nunca baja de cero, ni con dos pagos al mismo tiempo.
- **Reportes**: ventas por periodo con comparación contra el periodo anterior, utilidad sin impuestos, por día, categoría, producto (exportable), forma de pago, cajero, hora y cupón; inventario valorizado por categoría y productos sin movimiento. La utilidad del inicio también se calcula ya sin impuestos.

## SaaS: planes, Stripe, dominios y plataforma

**Planes** (`packages/shared/src/plans.ts`): Gratis (1 ubicación, 2 usuarios, 100 productos), Pro (3 ubicaciones, 10 usuarios, 5 000 productos, tarjeta y dominio propio) y Negocio (20 ubicaciones, usuarios y productos ilimitados). Los límites se revisan al crear o reactivar usuarios y ubicaciones, al crear productos y al importar (las filas que no caben se reportan una por una). Responden `402 plan_limit` con un mensaje listo para mostrar. Bajar de plan no borra nada: solo impide agregar más. Una suscripción cancelada vuelve a Gratis; con pago atrasado (`past_due`) se conserva el plan mientras Stripe reintenta.

**Suscripción (Stripe Billing)**: el propietario elige plan en *Configuración › Plan* → Stripe Checkout. Con suscripción activa, cambiar de plan, la tarjeta, las facturas y la cancelación van por el portal de Stripe. Stripe es la fuente de verdad: el webhook (`customer.subscription.*`, `checkout.session.completed`) actualiza `tenants.plan` y `plan_status`.

**Tarjeta en la tienda (Stripe Connect)**: cada negocio conecta su propia cuenta Standard de Stripe desde *Ajustes de la tienda*; el dinero le llega directo y la plataforma puede cobrar una comisión (`STRIPE_APPLICATION_FEE_BPS`). Al confirmar, el pedido aparta existencias igual que siempre y el cliente pasa a Stripe Checkout (en la cuenta del negocio, por el total ya calculado por `priceCart`). Se marca pagado por el webhook o, antes, al volver a la página del pedido (se le pregunta a Stripe). Si la sesión vence (30 min) sin pago, el pedido se cancela y las existencias regresan; si el cliente cancela, la página de Stripe se cierra. Si Stripe falla al crear la sesión, el pedido se cancela en el acto.

**Webhooks**: `POST /api/webhooks/stripe`, autenticado por la firma (`Stripe-Signature`, 5 min de tolerancia; acepta el secreto de la cuenta y el de Connect). Cada evento se aplica una vez (`stripe_events`) y todos los manejadores son idempotentes. Los eventos de pedidos solo se aceptan si vienen de la cuenta de Stripe de ese mismo negocio.

**Dominios propios (Cloudflare for SaaS)**: el negocio escribe `tienda.sunegocio.com` en *Ajustes de la tienda*; la API crea el *custom hostname* en la zona de la plataforma y muestra los registros DNS (CNAME a `STORE_CNAME_TARGET` y los TXT de verificación). Un cron cada hora (y el botón «Comprobar ahora») revisa los pendientes. El Worker `apps/store/router` recibe esos dominios (ruta `*/*` de la zona) y los pasa a Pages con `x-nexo-host`; el middleware de la tienda resuelve el negocio (`GET /api/store-host/:hostname`, solo dominios activos) y la tienda vive en la raíz del dominio (`/p/:id`, `/pagar`…). Stripe regresa al mismo dominio desde el que se compró.

**Plataforma** (`/plataforma`, solo correos en `PLATFORM_ADMINS`; para el resto la ruta no existe): lista de negocios con propietario, plan, estado y base de datos; uso y ventas de 30 días; plan de cortesía a mano; **suspender** (el panel muestra una pantalla con el motivo y solo deja abrir el portal de pago; la tienda se oculta; no se borra nada) y **mover a otra D1**: estado `migrating` (el panel responde 503 y muestra «Estamos moviendo tus datos»), copia tabla por tabla, verifica conteos, cambia `db_binding` y borra lo viejo; si algo falla, deshace la copia y el negocio sigue donde estaba. Cualquier binding `DB_TENANT_*` del entorno aparece como destino. Para negocios muy grandes conviene `wrangler d1 export`.

## Tienda: políticas, buscadores e IA (Fase 7)

- **Políticas** (*Ajustes de la tienda → Políticas de la tienda*): aviso de privacidad, términos y condiciones, y cambios y devoluciones. Cada una parte de una plantilla para México con los datos del negocio (no es asesoría legal), se edita con un Markdown sencillo y se publica en `/privacidad`, `/terminos` y `/devoluciones`, con enlaces en el pie de la tienda. Cada cambio de texto es una **versión nueva** guardada en `store_policy_versions`.
- **Aceptación al pagar**: si la tienda publica términos o aviso de privacidad, el cliente debe marcar la casilla. El pedido guarda la fecha y las versiones aceptadas (se ven en el detalle del pedido). Si la tienda cambió el texto mientras el cliente compraba, la API responde `legal_changed` y la tienda pide aceptar de nuevo.
- **SEO**: título y descripción para buscadores por tienda y por producto, con vista previa de Google; casilla para no indexar la tienda.
- **Lo que ven buscadores e IAs sin ejecutar JavaScript** (middleware de Pages): título, descripción, URL canónica (el dominio propio cuando hay uno), Open Graph, datos estructurados schema.org (`OnlineStore`, `WebSite`, `Product` con precio y existencias, `BreadcrumbList`, `FAQPage`) y una copia legible del contenido dentro de `#root`, que React reemplaza al cargar. Pago y pedidos llevan `noindex`.
- **Archivos**: `/robots.txt`; `/sitemap.xml` en el dominio compartido es un **índice de todas las tiendas** (para Search Console); cada tienda tiene `/<negocio>/sitemap.xml` (o `/sitemap.xml` en su dominio propio, que se registra aparte en Search Console); `llms.txt` por tienda y uno general.
- **Google Search Console**: agrega una propiedad de tipo *Prefijo de URL* con la dirección de la tienda (`STORE_URL`), verifícala con *Etiqueta HTML* poniendo el código en la variable `GOOGLE_SITE_VERIFICATION` del proyecto de Pages, y envía `<STORE_URL>/sitemap.xml`. Cada tienda con dominio propio se agrega como propiedad aparte, con su `/sitemap.xml`.
- **Preguntas frecuentes**: se muestran en la portada y alimentan el `FAQPage` y el `llms.txt` (AEO/GEO).
- **Visitas sin cookies**: la tienda manda eventos (`page_view`, `product_view`, `add_to_cart`, `checkout_start`; `order_placed` lo registra el servidor) a **Workers Analytics Engine** (binding `STORE_EVENTS`, configurado en staging y producción). El visitante es un hash diario de IP + navegador que nunca guarda la IP. Sin el binding (desarrollo local) no se registra nada. Los reportes llegan en la Fase 10.

## Operación diaria: pantalla del cliente y notificaciones (Fase 8)

- **Pantalla del cliente** (botón de monitor en la caja): muestra lo que se va escaneando con precio y ahorro, el total grande, lo recibido y **el cambio**, y al cobrar «¡Gracias por tu compra!» con el número de venta (12 s o hasta la siguiente venta).
  - *Segundo monitor de la misma computadora*: `/pos/cliente` abre una ventana que recibe los datos por `BroadcastChannel`, sin pasar por el servidor.
  - *Tablet o TV*: la caja genera un **código de 6 dígitos**; en el dispositivo se abre `<APP_URL>/pantalla` (sin iniciar sesión) y se escribe. La caja publica cada cambio (agrupado cada 250 ms) a un **Durable Object** `DisplayHub` por código, que lo reparte por **WebSocket** (con hibernación: no cobra mientras espera). El dispositivo recuerda el código, se reconecta solo y mantiene la pantalla encendida. El código vence tras 24 h sin uso; «Terminar emparejamiento» desconecta la pantalla al instante. Solo el negocio que creó el código puede escribir en él.
- **Notificaciones push** (*Configuración → Notificaciones*): cada persona las activa en cada dispositivo y elige qué avisos recibir: *pedido nuevo*, *pago con tarjeta recibido* (urgencia alta), *resumen de la mañana* (8:00 hora del negocio: productos por resurtir y, para quien ve cuentas por pagar, facturas que vencen) y *avisos de la suscripción* (solo el propietario). Cada aviso respeta los permisos del rol y abre la pantalla correspondiente al tocarlo.
  - Web Push estándar (RFC 8291 + VAPID RFC 8292) implementado con WebCrypto en el Worker, sin servicios de terceros. Las suscripciones viven en la base de control (`push_subscriptions`, `notification_prefs`); las que el navegador da de baja (404/410) se borran solas.
  - El panel es **instalable** (manifest + service worker `sw.js` que solo muestra avisos, sin caché offline). En **iPhone/iPad** primero hay que agregarlo a la pantalla de inicio (iOS 16.4+).
  - Sin `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` la pestaña dice «Aún no disponible» y todo lo demás sigue igual.

## Apariencia de la tienda (Fase 9)

*Tienda en línea → Apariencia*, con vista previa en computadora y celular que usa exactamente los mismos colores que la tienda.

- **Tema**: 6 estilos (Nexo, Boutique, Fresco, Minimal, Mercado, Nocturno). Sobre cualquiera se puede cambiar el color principal, el fondo y el texto, la tipografía de los títulos (5 opciones, autoalojadas: Instrument Serif, Fraunces, Inter, Space Grotesk, Nunito) y las esquinas. El tema se convierte en variables CSS sobre los mismos *tokens* de la tienda (`themeCss` en `@nexo/shared`): el resto de los tonos (bordes, textos secundarios, fondos suaves) se calculan y se ajustan hasta tener contraste legible (WCAG AA). El estilo Nexo sin cambios sigue el modo oscuro del cliente; con colores propios la tienda se ve siempre así. El editor avisa si el texto o los botones casi no se distinguen.
- **Barra de avisos**: hasta 3 mensajes que rotan cada 5 s (se detiene al pasar el cursor y con *movimiento reducido*), con enlace, 4 colores, fechas de inicio y fin, y opción de cerrarla (se recuerda hasta que cambie el texto).
- **Banners**: hasta 6 en carrusel arriba del catálogo, con imagen ancha (2100 × 800) y opcional para celular (1080 × 1350), título, texto, botón, enlace, color de texto, alineación, fechas y orden. Solo se aceptan imágenes subidas por el propio negocio. Los enlaces solo pueden ser rutas de la tienda (`/p/…`, `?categoria=…`) o `https://`.
- **Píxeles** de Meta, Google (GA4, Ads o Tag Manager) y TikTok: no se cargan hasta que el cliente acepta el aviso de cookies (la elección se guarda por tienda y se puede cambiar desde el pie de página). Registran visitas, productos vistos, agregar al carrito, inicio de pago y compra (con total), igual que las métricas propias.
- **Código propio**: CSS (50 000 caracteres) en todas las páginas; HTML en `<head>`/`<body>` y JavaScript solo con plan Pro y **solo en el dominio propio** de la tienda. En el dominio compartido todas las tiendas comparten origen, así que ahí nunca se inyecta HTML/JS ajeno y el servidor envía `Content-Security-Policy: worker-src 'none'` para que nadie instale un service worker. Tampoco se inyecta en el pago ni en el seguimiento del pedido. El código no viaja en los datos de la tienda: el middleware de Pages lo pide aparte e inserta tema y CSS en el HTML (sin parpadeo), con escapes para que no pueda cerrar sus etiquetas.

## Estadísticas de la tienda (Fase 10)

*Tienda en línea → Estadísticas* (permiso `reports:read`), para periodos de hasta 90 días comparados con el periodo anterior del mismo largo, con exportación a CSV.

- **Ventas** (exactas, de los pedidos en D1): pedidos, cancelados, valor sin cancelados, ticket promedio, ventas por día (hora del negocio), productos vendidos, formas de pago, entrega, estados, cupones y clientes nuevos o que ya habían comprado (por correo).
- **Visitas** (de los eventos sin cookies de la Fase 7 en Workers Analytics Engine, leídos con su API SQL): visitantes únicos por día, vistas, **embudo** (visitaron → vieron producto → carrito → pago → pedido), **conversión** (pedidos / visitantes), fuentes (Google, Instagram, Facebook, WhatsApp, ChatGPT… o directo), campañas `utm_*`, dispositivos, países, páginas y vistas/carritos por producto. Las cuentas usan `_sample_interval` porque Analytics Engine muestrea con mucho tráfico; los datos se guardan 3 meses.
- Cada consulta va limitada al negocio (`index1`), al dataset del entorno y al periodo; los valores se validan antes de armar el SQL.
- Sin `CF_ACCOUNT_ID`, `CF_ANALYTICS_TOKEN` y `STORE_EVENTS_DATASET` (desarrollo local) la pantalla muestra ventas y avisa que las visitas no están configuradas; si la consulta falla, avisa y las ventas siguen.

## Integraciones: API, webhooks y asistentes de IA (Fase 11)

*Configuración → Integraciones* (propietario y administradores).

- **Llaves de API** (`Authorization: Bearer nx_…`): se muestran una sola vez; se guarda solo su SHA-256 en la base de control (`api_keys`). Cada llave actúa como un miembro del equipo: **Solo lectura** (administrador, solo `GET`), **Lectura y escritura** (administrador) o **Caja** (cajero); nunca como propietario. Ninguna llave entra a usuarios, plan, notificaciones, pantalla del cliente ni a las propias integraciones. Pueden vencer (30/90/365 días) y se revocan al instante. Lo que hacen queda en la actividad como «API · nombre». Límites: Gratis 2 llaves, Pro 10, Negocio sin límite.
- **Webhooks**: el negocio registra direcciones `https://` públicas (se rechazan localhost, IPs privadas y redirecciones) y elige eventos: `order.created`, `order.paid`, `order.status_changed`, `sale.completed`, `sale.voided`, `sale.returned`, `product.created/updated/deleted` y `stock.changed` (la importación CSV no genera eventos). Cada envío lleva `Nexo-Event`, `Nexo-Delivery` y `Nexo-Signature: t=…,v1=…` (HMAC-SHA256 del secreto `whsec_…` sobre `t.cuerpo`). Se intenta al momento; si no responde 2xx en 10 s, se reintenta en el trabajo de cada hora (hasta 6 intentos, ~1 día). El panel muestra la salud, las entregas de 30 días con su contenido, permite reenviar, probar (`ping`) y rotar el secreto. Límites: Gratis 1, Pro 10, Negocio sin límite.
- **Servidor MCP** en `<APP_URL>/mcp` (Streamable HTTP sin estado, JSON-RPC; versiones de protocolo 2025-06-18, 2025-03-26 y 2024-11-05) con la misma llave de API. 12 herramientas en español: resumen de hoy, buscar y ver productos, ubicaciones, existencias, reporte de ventas, estadísticas de la tienda, listar y ver pedidos, buscar clientes y, con llave de escritura, `avanzar_pedido` y `ajustar_existencias`. Cada herramienta llama a esta misma API con la llave, así que permisos, validación y actividad son los mismos. Valida `Origin` (DNS rebinding). Probado con el SDK oficial de MCP.
  - Claude Code: `claude mcp add --transport http nexo <APP_URL>/mcp --header "Authorization: Bearer nx_…"`.
  - Claude Desktop: con `npx mcp-remote <APP_URL>/mcp --header "Authorization:Bearer …"` (el panel da la configuración lista para copiar).

## Seguridad

- Contraseñas con PBKDF2-SHA256 (100 000 iteraciones, el máximo de Workers), sal por usuario y comparación en tiempo constante.
- Sesiones con token aleatorio de 256 bits en cookie `HttpOnly`, `Secure`, `SameSite=Lax`. En la base solo se guarda su SHA-256. Expiración deslizante de 30 días.
- Bloqueo de 15 minutos tras 5 intentos fallidos por correo. Restablecer la contraseña lo levanta.
- Protección CSRF: las peticiones que modifican datos deben venir del propio origen.
- Recuperar contraseña no revela si un correo existe. El enlace vence en 60 minutos, sirve una vez y cierra todas las sesiones.
- Desactivar a un usuario cierra sus sesiones al instante. El propietario no puede ser modificado.
- Subidas: solo JPG, PNG y WebP de hasta 5 MB (SVG rechazado por seguridad), con claves imposibles de adivinar bajo `t/<tenantId>/`.

## Respaldos

Un cron diario (07:00 UTC) exporta todas las tablas de la base de control y de todas las bases de negocios (`DB_TENANT_*`) a R2 en `backups/AAAA-MM-DD/` como NDJSON, conserva 30 días y limpia sesiones y tokens vencidos. D1 Time Travel cubre además 30 días de recuperación a cualquier punto. En desarrollo: `curl -X POST localhost:8787/api/dev/backup`.

## API

| Método y ruta | Permiso |
|---|---|
| `POST /api/auth/register` · `login` · `logout` | público |
| `POST /api/auth/password/forgot` · `reset` | público |
| `POST /api/auth/password/change` | sesión |
| `GET /api/me` | sesión |
| `GET/PUT /api/settings` | `settings:read` / `settings:write` |
| `GET/POST /api/taxes`, `PUT /api/taxes/:id` | `taxes:write` para escribir |
| `GET/POST /api/locations`, `PUT /api/locations/:id` | `locations:write` para escribir |
| `GET/POST /api/users`, `PATCH /api/users/:id` | `users:read` / `users:write` |
| `GET /api/audit?cursor=&entity=` | `audit:read` |
| `POST /api/uploads` (multipart `file`) | `uploads:write` |
| `GET /api/products?q=&categoryId=&brandId=&status=&stock=&page=` | `catalog:read` |
| `GET /api/products/:id` | `catalog:read` |
| `POST /api/products`, `PUT /api/products/:id`, `DELETE /api/products/:id` | `catalog:write` |
| `POST /api/products/:id/archive` · `restore` | `catalog:write` |
| `POST /api/products/import` (hasta 25 productos) | `catalog:write` |
| `GET/POST /api/categories`, `PUT/DELETE /api/categories/:id` (igual `/api/brands`) | `catalog:read` / `catalog:write` |
| `GET /api/inventory?locationId=&q=&stock=&page=` | `inventory:read` |
| `GET /api/inventory/summary` | `inventory:read` |
| `POST /api/inventory/movements` (entrada, salida o conteo) | `inventory:write` |
| `GET /api/inventory/movements?variantId=&productId=&locationId=&type=&cursor=` | `inventory:read` |
| `GET /api/pos/products?locationId=&q=&categoryId=` | `pos:sell` |
| `POST /api/sales` (con `clientId`) | `pos:sell` |
| `GET /api/sales?from=&to=&status=&q=&locationId=&sessionId=&page=`, `GET /api/sales/:id` | `sales:read` |
| `POST /api/sales/:id/void` | `sales:void` |
| `POST /api/sales/:id/returns` | `sales:return` |
| `POST /api/sales/:id/email` | `pos:sell` |
| `GET /api/cash/current?locationId=`, `POST /api/cash/open` | `cash:operate` |
| `POST /api/cash/:id/movements`, `POST /api/cash/:id/close` | `cash:operate` |
| `GET /api/cash/sessions`, `GET /api/cash/sessions/:id` | `cash:operate` |
| `GET /api/reports/dashboard` | `sales:read` |
| `GET /api/inventory/lookup?locationId=&q=` (buscador de documentos) | `inventory:read` |
| `GET/POST /api/suppliers`, `GET/PUT/DELETE /api/suppliers/:id` | `suppliers:read` / `suppliers:write` |
| `GET /api/purchases?status=&supplierId=&q=&page=`, `GET /api/purchases/:id` | `purchases:read` |
| `GET /api/purchases/suggestions?locationId=` | `purchases:write` |
| `POST /api/purchases`, `PUT /api/purchases/:id` | `purchases:write` |
| `POST /api/purchases/:id/order` · `cancel` · `close` · `duplicate` · `email` | `purchases:write` |
| `POST /api/purchases/:id/receive` | `purchases:receive` |
| `GET /api/transfers?status=&locationId=`, `GET /api/transfers/:id` | `transfers:read` |
| `POST /api/transfers`, `PUT /api/transfers/:id`, `POST /api/transfers/:id/send` · `cancel` | `transfers:write` |
| `POST /api/transfers/:id/receive` | `transfers:receive` |
| `GET /api/counts?status=&locationId=`, `GET /api/counts/:id` | `counts:read` |
| `POST /api/counts`, `POST /api/counts/:id/complete` · `cancel` | `counts:write` |
| `POST /api/counts/:id/entries` · `items` | `counts:count` |
| `GET /api/store/:slug`, `GET /api/store/:slug/products?q=&categoryId=&sort=&page=`, `GET /api/store/:slug/products/:id` | público (tienda) |
| `POST /api/store/:slug/orders`, `GET /api/store/:slug/orders/:token`, `POST /api/store/:slug/orders/:token/cancel` | público (tienda) |
| `GET/PUT /api/store-settings`, `POST /api/store-settings/publish` | `settings:read` / `store:write` |
| `GET /api/orders?status=&q=&page=`, `GET /api/orders/counts`, `GET /api/orders/:id` | `orders:read` |
| `POST /api/orders/:id/confirm` · `ready` · `pay` · `complete` | `orders:fulfill` |
| `POST /api/orders/:id/cancel` | `orders:cancel` |
| `GET/POST /api/customers`, `GET/PUT /api/customers/:id`, `POST /api/customers/:id/archive`, `GET /api/customers/export` | `customers:read` / `customers:write` |
| `GET /api/promotions`, `POST/PUT/DELETE /api/promotions[/:id]`, `POST/PUT /api/promotions/coupons[/:id]` | `promotions:read` / `promotions:write` |
| `GET /api/promotions/live`, `GET /api/promotions/coupons/check/:code` | `pos:sell` |
| `POST /api/store/:slug/coupons/check` | público (tienda) |
| `POST /api/store/:slug/orders/:token/pay` · `payment-status` | público (tienda) |
| `GET /api/store-host/:hostname` | público (middleware de la tienda) |
| `GET /api/store-index` | público: tiendas indexables para el índice de sitemaps |
| `GET /api/store/:slug/policies/:kind` · `GET /api/store/:slug/sitemap` · `POST /api/store/:slug/events` | público (tienda) |
| `GET /api/store-settings/policies`, `GET …/policies/:kind/template`, `PUT …/policies/:kind` | `settings:read` / `store:write` |
| `POST /api/webhooks/stripe` | firma de Stripe |
| `GET /api/billing`, `GET /api/billing/connect` | `settings:read` |
| `POST /api/billing/checkout` · `portal` · `connect` | `billing:write` (propietario) |
| `GET/PUT/DELETE /api/store-settings/domain` | `settings:read` / `store:write` |
| `GET /api/platform/tenants`, `GET/PATCH /api/platform/tenants/:id`, `POST …/:id/move` | `PLATFORM_ADMINS` |
| `GET /api/payables?status=&supplierId=`, `POST /api/payables/:receiptId/payments` | `payables:read` / `payables:write` |
| `GET /api/reports/sales?from=&to=`, `GET /api/reports/inventory?days=` | `reports:read` |
| `GET /api/notifications`, `POST /api/notifications/subscriptions`, `POST …/subscriptions/remove`, `DELETE …/subscriptions/:id`, `PUT …/prefs`, `POST …/test` | sesión (cada quien las suyas) |
| `POST /api/pos/display`, `POST /api/pos/display/:code/state`, `DELETE /api/pos/display/:code` | `pos:sell` |
| `GET /api/display/:code`, `GET /api/display/:code/ws` (WebSocket) | público: el código es la llave |
| `GET/PUT /api/store-settings/appearance` | `settings:read` / `store:write` (HTML/JS: plan Pro) |
| `GET /api/store/:slug/custom-code` | público (middleware de la tienda) |
| `GET /api/reports/store?from=&to=` | `reports:read` |
| `GET /api/integrations`, `POST/DELETE /api/integrations/api-keys[/:id]`, `POST/PUT/DELETE /api/integrations/webhooks[/:id]`, `POST …/webhooks/:id/test` · `rotate-secret`, `GET …/webhooks/:id/deliveries`, `GET …/webhooks/deliveries/:id`, `POST …/deliveries/:id/resend` | `integrations:manage` (nunca con llave de API) |
| `POST /mcp` | llave de API (`Authorization: Bearer nx_…`) |
| Cualquier ruta de `/api` | sesión o llave de API (excepto usuarios, plan, notificaciones e integraciones) |
| `GET /files/<key>` | público |

Los errores siempre tienen la forma `{ "error": { "code", "message", "fields"? } }`, con mensajes en español listos para mostrar.

Roles: **Propietario** y **Administrador** (todo), **Cajero** (vende, opera su caja con cierre ciego y consulta catálogo y existencias; no ve costos ni utilidad, no anula ni hace devoluciones y tiene límite de descuento; confirma la llegada de traspasos, captura conteos a ciegas, atiende pedidos en línea sin cancelarlos y registra clientes; no ve compras, proveedores, cuentas por pagar ni reportes).


---

## Navegación del panel

- **Buscador (`Ctrl + K` o `⌘K`, o la lupa de la barra superior)**: encuentra páginas y atajos por palabras clave y sinónimos sin importar acentos («iva», «corte», «kardex», «nuevo producto», «cambiar contraseña»), y busca en vivo productos, clientes, pedidos (por folio o nombre) y proveedores. Solo muestra lo que el rol puede abrir. `↑ ↓` para moverse, `Enter` para abrir, `Esc` para cerrar; recuerda los últimos cinco resultados abiertos. Las palabras clave viven en `apps/admin/src/layout/nav.ts`, junto al menú.
- **Menú lateral**: tiene su propio scroll fijo a la altura de la ventana y se desplaza solo hasta la página actual. Cada sección se pliega con su título (se recuerda por navegador en `localStorage` `nx.nav.collapsed`); una sección plegada sigue mostrando la página actual y pasa el contador de pedidos nuevos a su título.

## Sistema de diseño

Elegante, minimalista y limpio: neutros cálidos con un único acento verde, Inter para la interfaz, Instrument Serif para los títulos de página y JetBrains Mono para SKU y folios. Fuentes alojadas en el propio proyecto, sin peticiones a terceros.

- Fuente de verdad: `packages/ui/tokens.json`. Tras editarlo: `npm run build -w @nexo/ui`.
- Clases `nx-*` en `packages/ui/styles/components.css`; componentes React en `packages/ui/src`.
- Tema claro y oscuro automáticos (sigue al sistema). Forzar uno: `data-theme="light|dark"` en `<html>`.
