# Nexo Commerce

Plataforma para pequeños y medianos negocios: productos, inventario, punto de venta, tienda online y administración en un solo sistema. Pensada para desplegarse completa en **Cloudflare** (Workers, D1, R2 y Pages).

Estado actual:

- **Fase 0 — Fundamentos:** autenticación, negocios (multi-tenant), usuarios y roles, configuración del negocio, impuestos, ubicaciones, auditoría, archivos en R2, respaldos y el sistema de diseño.
- **Fase 1 — Catálogo e inventario:** productos con variantes, categorías y marcas, SKU y código de barras, imágenes, unidades de medida, costo promedio y margen, búsqueda y filtros, importación por CSV, existencias por ubicación y Kardex.

---

## Arranque rápido

Requisitos: Node 22 (`.nvmrc`) y npm.

```bash
npm install
npm run build -w @nexo/ui      # compila los tokens de diseño
npm run dev                     # migra la D1 local y levanta API (:8787) + dashboard (:5173)
```

Abre http://localhost:5173 y crea tu negocio. No necesitas cuenta de Cloudflare para desarrollar: `wrangler dev` simula D1 y R2 en `apps/api/.wrangler/`.

Los correos (recuperar contraseña) se imprimen en la consola de la API. En desarrollo, la respuesta de `/api/auth/password/forgot` incluye además el enlace (`devResetUrl`).

| Comando | Qué hace |
|---|---|
| `npm run dev` | Migra la D1 local y levanta API + dashboard |
| `npm run typecheck` | Revisa tipos de todos los paquetes |
| `npm test` | Pruebas unitarias (Vitest) |
| `npm run smoke` | Pruebas de punta a punta contra la API en marcha (39 de la Fase 0 + 60 de la Fase 1) |
| `npm run db:generate` | Genera migraciones SQL a partir del esquema Drizzle |
| `npm run build` | Compila tokens y dashboard |
| `npm run deploy:staging` / `deploy:production` | Compila, migra la D1 remota y despliega |

---

## Estructura

```
apps/
  api/        Worker (Hono): API en /api/* y además sirve el dashboard compilado. D1 + R2 + cron.
  admin/      Dashboard en React + Vite. Se compila a apps/admin/dist y lo publica el Worker.
  store/      Tienda online en Cloudflare Pages (marcador de posición hasta la Fase 4).
packages/
  db/         Esquema Drizzle y migraciones de las dos bases D1.
  shared/     Roles y permisos, esquemas Zod, utilidades de dinero y tipos de la API (compartidos API ↔ UI).
  ui/         Sistema de diseño: tokens.json → tokens.css, components.css y componentes React.
scripts/
  smoke.mjs           Prueba de punta a punta de la Fase 0.
  smoke-catalog.mjs   Prueba de punta a punta de la Fase 1 (incluye sobreventa concurrente).
```

Un solo Worker sirve la API y el dashboard en el mismo dominio, así la cookie de sesión no necesita CORS.

---

## Arquitectura

### Dos bases D1

| Binding | Contenido |
|---|---|
| `DB_CONTROL` | Plataforma: `tenants`, `users`, `memberships`, `sessions`, `password_resets`, `login_attempts`, `tenant_domains` |
| `DB_TENANT_DEFAULT` | Datos de cada negocio: `business_settings`, `tax_rates`, `locations`, `audit_log`, `categories`, `brands`, `products`, `variants`, `stock_levels`, `stock_movements`. **Todas las tablas llevan `tenant_id`.** |

Hoy todos los negocios comparten `DB_TENANT_DEFAULT`. Cada fila de `tenants` guarda en `db_binding` qué base usa. Cuando un negocio pase a su propia D1 (Fase 6), solo cambia ese valor: ninguna ruta se toca.

### Reglas que no se rompen

1. **Toda consulta de negocio pasa por `getTenantDb()`** (`apps/api/src/lib/tenant.ts`) y filtra por `tenant_id`. Las rutas reciben la base ya resuelta en `c.var.auth.db`.
2. **Cambio + auditoría en el mismo `db.batch()`.** `auditEntry()` devuelve el INSERT para meterlo en el lote: o se guardan ambos o ninguno. D1 no tiene transacciones interactivas; los lotes son atómicos.
3. **Dinero en centavos (enteros)** y tasas en puntos base (1600 = 16 %). Nunca `float`. Ver `packages/shared/src/money.ts`.
4. **Permisos por nombre** (`can(role, "settings:write")`), no por rol directo. Así se podrán volver granulares sin tocar rutas.
5. **Sin valores visuales literales en la UI**: todo viene de los tokens del sistema de diseño.

6. **El stock nunca se edita directamente.** Solo `apps/api/src/lib/inventory.ts` lo cambia, y siempre genera su movimiento en el Kardex dentro del mismo lote (ver abajo).

### Inventario y Kardex

- `stock_levels` guarda la existencia por variante y ubicación, con `CHECK (quantity >= 0)`. Una salida mayor a lo disponible hace fallar el `CHECK` y **todo el lote se revierte**: la venta, el movimiento y lo demás. Como cada D1 procesa una petición a la vez, no hay condiciones de carrera: la prueba de punta a punta lanza 12 salidas simultáneas y solo pasan las que caben.
- `stock_movements` es el Kardex, solo de inserción: tipo (inicial, entrada, salida, ajuste por conteo), motivo, cantidad con signo, **saldo después del movimiento**, costo unitario del momento, nota, usuario y fecha. Se ordena por el `rowid` de SQLite, que sigue el orden real de escritura.
- **Costo promedio ponderado**: cada entrada con costo recalcula `variants.cost_cents` sobre la existencia de todas las ubicaciones. Las salidas guardan el costo vigente, así la rentabilidad futura usa el costo real de ese momento.
- **Cantidades en milésimas** (enteros): permite vender 1.25 kg sin errores de punto flotante. La API recibe y devuelve números normales en la unidad del producto. Las unidades sin decimales (pieza, caja…) rechazan fracciones.
- Para usarlo desde otro módulo (POS, compras): `movementStatements(d1, actor, movimiento)` devuelve las sentencias; agrégalas al mismo `d1.batch()` que el documento que las causa.

### Catálogo

- Producto → variantes (hasta 3 opciones, 100 combinaciones). Un producto simple es un producto con una sola variante sin opciones: el resto del sistema (POS, tienda) siempre trabaja con variantes.
- SKU único por negocio (se guarda en mayúsculas y se genera solo si se deja vacío) y código de barras único por negocio. Índices parciales: los eliminados liberan sus códigos.
- Búsqueda sin acentos ni mayúsculas sobre nombre, SKU, código de barras y opciones (`products.search_text`, mantenido en cada escritura).
- Productos con existencias no se eliminan (se archivan). No se puede quitar una variante con stock, ni cambiar la unidad o dejar de controlar inventario mientras haya existencias.
- El cajero ve productos y existencias, pero no costos, márgenes ni el valor del inventario (`costs:read`).
- Importación CSV: el dashboard lee el archivo (coma o punto y coma, como lo exporta Excel en español), agrupa por nombre las filas con opciones como variantes y envía lotes de 25. El servidor valida cada producto, crea las categorías, marcas y tasas de impuesto que falten, y reporta los errores por número de fila. Plantilla descargable desde el propio diálogo.

> Escala: la lista de productos calcula existencias y valor al vuelo. Es suficiente para miles de productos; cuando un negocio crezca mucho, la Fase 5 agrega tablas de resumen.

### Seguridad

- Contraseñas con PBKDF2-SHA256 (100 000 iteraciones, el máximo de Workers), sal por usuario y comparación en tiempo constante.
- Sesiones con token aleatorio de 256 bits en cookie `HttpOnly`, `Secure`, `SameSite=Lax`. En la base solo se guarda su SHA-256. Expiración deslizante de 30 días.
- Bloqueo de 15 minutos tras 5 intentos fallidos por correo. Restablecer la contraseña lo levanta.
- Protección CSRF: las peticiones que modifican datos deben venir del propio origen.
- Recuperar contraseña no revela si un correo existe. El enlace vence en 60 minutos, sirve una vez y cierra todas las sesiones.
- Desactivar a un usuario cierra sus sesiones al instante. El propietario no puede ser modificado.
- Subidas: solo JPG, PNG y WebP de hasta 5 MB (SVG rechazado por seguridad), con claves imposibles de adivinar bajo `t/<tenantId>/`.

### Respaldos

Un cron diario (07:00 UTC) exporta todas las tablas de ambas bases a R2 en `backups/AAAA-MM-DD/` como NDJSON, conserva 30 días y limpia sesiones y tokens vencidos. D1 Time Travel cubre además 30 días de recuperación a cualquier punto. En desarrollo: `curl -X POST localhost:8787/api/dev/backup`.

### API

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
| `GET /files/<key>` | público |

Los errores siempre tienen la forma `{ "error": { "code", "message", "fields"? } }`, con mensajes en español listos para mostrar.

Roles: **Propietario** y **Administrador** (todo), **Cajero** (punto de venta y consulta del catálogo y existencias, sin costos).

---

## Desplegar en Cloudflare

Una sola vez por entorno (ejemplo con staging; para producción cambia el sufijo):

```bash
cd apps/api
npx wrangler login
npx wrangler d1 create nexo-control-staging
npx wrangler d1 create nexo-tenant-staging
npx wrangler r2 bucket create nexo-files-staging
```

1. Copia los `database_id` que imprime cada comando en `apps/api/wrangler.jsonc` (sustituye `REPLACE_WITH_...`).
2. Ajusta `APP_URL` del entorno con el dominio donde vivirá el dashboard.
3. Correo transaccional (opcional pero necesario para recuperar contraseñas): `npx wrangler secret put RESEND_API_KEY --env staging` y define `EMAIL_FROM`.
4. Despliega desde la raíz: `npm run deploy:staging`. Esto compila, aplica las migraciones remotas y publica el Worker.

Con GitHub: añade los secretos `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID`. Cada push a `main` despliega a staging; producción se lanza a mano desde **Actions → Deploy**. El workflow `CI` revisa tipos, ejecuta pruebas, compila y corre la prueba de punta a punta en cada PR.

---

## Sistema de diseño

Elegante, minimalista y limpio: neutros cálidos con un único acento verde, Inter para la interfaz, Instrument Serif para los títulos de página y JetBrains Mono para SKU y folios. Fuentes alojadas en el propio proyecto, sin peticiones a terceros.

- Fuente de verdad: `packages/ui/tokens.json`. Tras editarlo: `npm run build -w @nexo/ui`.
- Clases `nx-*` en `packages/ui/styles/components.css`; componentes React en `packages/ui/src`.
- Tema claro y oscuro automáticos (sigue al sistema). Forzar uno: `data-theme="light|dark"` en `<html>`.

---

## Siguiente: Fase 2 — Punto de venta

Interfaz de caja para teclado y escáner, carrito, descuentos, impuestos, pagos mixtos, apertura y cierre de caja, recibos y devoluciones. Cada venta usará `movementStatements()` para descontar existencias en el mismo lote que la venta, con tablas de resumen para el dashboard.
