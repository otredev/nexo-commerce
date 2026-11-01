# Nexo Commerce

Plataforma para pequeños y medianos negocios: productos, inventario, punto de venta, tienda online y administración en un solo sistema. Pensada para desplegarse completa en **Cloudflare** (Workers, D1, R2 y Pages).

Este repositorio contiene la **Fase 0 — Fundamentos**: autenticación, negocios (multi-tenant), usuarios y roles, configuración del negocio, impuestos, ubicaciones, auditoría, archivos en R2, respaldos y el sistema de diseño. Todo lo que viene después se construye encima sin rehacer la base.

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
| `node scripts/smoke.mjs` | 39 pruebas de punta a punta contra la API en marcha |
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
  smoke.mjs   Prueba de punta a punta.
```

Un solo Worker sirve la API y el dashboard en el mismo dominio, así la cookie de sesión no necesita CORS.

---

## Arquitectura

### Dos bases D1

| Binding | Contenido |
|---|---|
| `DB_CONTROL` | Plataforma: `tenants`, `users`, `memberships`, `sessions`, `password_resets`, `login_attempts`, `tenant_domains` |
| `DB_TENANT_DEFAULT` | Datos de cada negocio: `business_settings`, `tax_rates`, `locations`, `audit_log` (y desde la Fase 1, productos e inventario). **Todas las tablas llevan `tenant_id`.** |

Hoy todos los negocios comparten `DB_TENANT_DEFAULT`. Cada fila de `tenants` guarda en `db_binding` qué base usa. Cuando un negocio pase a su propia D1 (Fase 6), solo cambia ese valor: ninguna ruta se toca.

### Reglas que no se rompen

1. **Toda consulta de negocio pasa por `getTenantDb()`** (`apps/api/src/lib/tenant.ts`) y filtra por `tenant_id`. Las rutas reciben la base ya resuelta en `c.var.auth.db`.
2. **Cambio + auditoría en el mismo `db.batch()`.** `auditEntry()` devuelve el INSERT para meterlo en el lote: o se guardan ambos o ninguno. D1 no tiene transacciones interactivas; los lotes son atómicos.
3. **Dinero en centavos (enteros)** y tasas en puntos base (1600 = 16 %). Nunca `float`. Ver `packages/shared/src/money.ts`.
4. **Permisos por nombre** (`can(role, "settings:write")`), no por rol directo. Así se podrán volver granulares sin tocar rutas.
5. **Sin valores visuales literales en la UI**: todo viene de los tokens del sistema de diseño.

Para la Fase 1 (inventario) se añade la regla del Kardex: el stock nunca se edita directamente, y la tabla de existencias lleva `CHECK (cantidad >= 0)` para que una venta sin unidades suficientes falle y revierta todo su lote.

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
| `GET /files/<key>` | público |

Los errores siempre tienen la forma `{ "error": { "code", "message", "fields"? } }`, con mensajes en español listos para mostrar.

Roles: **Propietario** y **Administrador** (todo), **Cajero** (punto de venta y lectura).

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

## Siguiente: Fase 1 — Catálogo e inventario

Productos con variantes, categorías y marcas, SKU y código de barras, imágenes en R2, costo y precio, importación por CSV y el Kardex como fuente de verdad del stock. Las tablas nuevas van en `packages/db/src/schema/tenant.ts`; luego `npm run db:generate`.
