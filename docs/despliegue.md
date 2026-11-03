# Guía de despliegue

Cómo publicar Nexo Commerce en Cloudflare (staging y producción), y qué falta antes de abrirlo al público.

## Antes de empezar

- Una cuenta de Cloudflare con **R2** y **Analytics Engine** activados (cada uno se activa una vez desde el dashboard; si no, `wrangler` muestra los errores `10042` y `10089`).
- Node 22 y el repositorio instalado (`npm install`).
- Los comandos de `wrangler` se corren desde `apps/api`.

## Crear el entorno

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
4. Ajusta `STORE_URL` con el dominio de la tienda (se usa en los enlaces de los correos).
5. Crea el proyecto de Pages de la tienda (una sola vez): `cd apps/store && npx wrangler pages project create nexo-commerce --production-branch main`. El service binding hacia la API ya está en `apps/store/wrangler.toml` (rama `staging` → `nexo-api-staging`, `main` → `nexo-api-production`).
6. Despliega desde la raíz: `npm run deploy:staging`. Esto compila, aplica las migraciones remotas, publica el Worker y sube la tienda a Pages.
7. Plataforma: `npx wrangler secret put PLATFORM_ADMINS --env staging` con tu correo.
8. Notificaciones push: `node scripts/vapid-keys.mjs` (una vez por entorno; **no las cambies después** o todos tendrán que reactivarlas) y guarda `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT` (`mailto:` con tu correo) con `npx wrangler secret put … --env staging`. La pantalla del cliente usa el Durable Object `DisplayHub`, que el primer despliegue crea solo (migración `v1` en `wrangler.jsonc`).
9. Estadísticas de visitas: en el dashboard de Cloudflare crea un token de API con permiso **Account → Account Analytics → Read** y guárdalo con `npx wrangler secret put CF_ANALYTICS_TOKEN --env staging`; guarda también tu Account ID (barra lateral de *Workers & Pages*) con `npx wrangler secret put CF_ACCOUNT_ID --env staging`. `STORE_EVENTS_DATASET` ya está en `wrangler.jsonc`. Las visitas se empiezan a registrar desde el primer despliegue con el binding `STORE_EVENTS`.

**Stripe** (opcional; sin estas claves el panel dice que el cobro en línea aún no está disponible):

1. Crea dos productos con precio mensual (Pro y Negocio) y guarda sus `price_…` en `STRIPE_PRICE_PRO` y `STRIPE_PRICE_BUSINESS`.
2. Activa Connect (cuentas Standard) y el portal del cliente en el dashboard de Stripe.
3. Crea dos webhooks hacia `https://<app>/api/webhooks/stripe`: uno de la cuenta (`customer.subscription.created/updated/deleted`, `checkout.session.completed`) y otro de **Connect** (`checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`, `account.updated`, `account.application.deauthorized`).
4. Secretos: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET` y, si cobras comisión, `STRIPE_APPLICATION_FEE_BPS`. En local: copia `apps/api/.dev.vars.example` a `.dev.vars` y usa `stripe listen --forward-to localhost:8787/api/webhooks/stripe`.

**Dominios propios** (opcional):

1. En la zona de la plataforma activa **Cloudflare for SaaS**, crea el registro de respaldo (p. ej. `tiendas.example.com AAAA 100::`, con proxy) y márcalo como *fallback origin*. Ese nombre va en `STORE_CNAME_TARGET`.
2. Despliega el router: `npm run deploy:router:staging -w @nexo/store` (ajusta `STORE_ORIGIN` en `apps/store/router/wrangler.jsonc`) y en la zona agrega la ruta `*/*` → `nexo-store-router-<entorno>`, más rutas con Worker *None* para tus propios dominios (app, tienda).
3. En Pages define `STORE_HOSTS` con el dominio compartido de la tienda.
4. Secretos de la API: `CF_API_TOKEN` (permiso *SSL and Certificates: Edit* en la zona) y `CF_ZONE_ID`.

**Otra D1 para negocios grandes**: `wrangler d1 create nexo-tenant-2-production`, agrégala en `wrangler.jsonc` como `DB_TENANT_2` (con `migrations_dir` de tenant), aplica las migraciones y despliega. Desde *Plataforma* mueve el negocio.

Con GitHub: añade los secretos `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID`. Cada push a `main` despliega a staging; producción se lanza a mano desde **Actions → Deploy**. El workflow `CI` revisa tipos, ejecuta pruebas, compila y corre la prueba de punta a punta en cada PR.

## Variables y secretos

| Nombre | Dónde | Para qué |
|---|---|---|
| `APP_URL`, `STORE_URL`, `STORE_CNAME_TARGET`, `STORE_EVENTS_DATASET` | `vars` del entorno en `wrangler.jsonc` | Direcciones del panel y de la tienda, destino CNAME de dominios propios, dataset de visitas |
| `PLATFORM_ADMINS` | secreto | Correos con acceso al panel de *Plataforma* |
| `RESEND_API_KEY`, `EMAIL_FROM` | secreto | Correos transaccionales |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | secreto | Notificaciones push (`node scripts/vapid-keys.mjs`) |
| `CF_ACCOUNT_ID`, `CF_ANALYTICS_TOKEN` | secreto | Leer las visitas de la tienda (Estadísticas) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_BUSINESS`, `STRIPE_APPLICATION_FEE_BPS` | secreto | Suscripciones y cobro con tarjeta |
| `CF_API_TOKEN`, `CF_ZONE_ID` | secreto | Dominios propios (Cloudflare for SaaS) |
| `STORE_HOSTS`, `GOOGLE_SITE_VERIFICATION` | variables del proyecto de Pages | Dominio compartido de la tienda y verificación de Search Console |

Todos los secretos se guardan con `npx wrangler secret put <NOMBRE> --env staging` (o `--env production`). En local van en `apps/api/.dev.vars` (copia `.dev.vars.example`). Sin un secreto opcional, la función correspondiente avisa en el panel que no está disponible y lo demás sigue funcionando.

## Pendiente antes de producción

- **Correo en staging (Fase 0, paso 4 — Resend)**: pospuesto. Mientras tanto los correos de staging (pedidos, avisos y recuperar contraseña) no se envían: se imprimen en los registros del Worker (`cd apps/api && npx wrangler tail --env staging`), y ahí aparece el enlace para restablecer la contraseña. Para activarlo: verificar el dominio en Resend, copiar sus registros DNS a Cloudflare y guardar `RESEND_API_KEY` y `EMAIL_FROM` con `npx wrangler secret put … --env staging`. **Obligatorio antes de producción.**
- **Stripe en staging (Fase 0, paso 5)**: pospuesto. Sin las claves, el panel avisa que el cobro en línea aún no está disponible: no se pueden contratar planes desde la app (se cambian a mano en *Plataforma*) ni activar el pago con tarjeta en las tiendas; el pago al recibir y la transferencia funcionan igual. Para activarlo (en modo prueba): crear los productos Pro y Negocio, habilitar el portal del cliente y Connect (cuentas Standard), crear los dos webhooks hacia `<APP_URL>/api/webhooks/stripe` (cuenta y cuentas conectadas) y guardar `STRIPE_SECRET_KEY`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_BUSINESS`, `STRIPE_WEBHOOK_SECRET` y `STRIPE_CONNECT_WEBHOOK_SECRET` con `npx wrangler secret put … --env staging`. Antes, confirmar que Stripe permite Connect para una plataforma en México. **Obligatorio antes de cobrar en producción.**
- **Dominios propios en staging (Fase 0, paso 6 — Cloudflare for SaaS)**: pospuesto. Sin `CF_API_TOKEN` y `CF_ZONE_ID`, *Ajustes de la tienda* avisa que los dominios propios aún no están disponibles; las tiendas funcionan en `https://staging.nexo-commerce.pages.dev/<negocio>`. Para activarlo hace falta el dominio de la plataforma en Cloudflare: activar Custom Hostnames, crear el registro de respaldo (`tiendas-staging AAAA 100::`, con proxy) como *Fallback Origin*, publicar el router (`npm run deploy:router:staging -w @nexo/store`), agregar la ruta `*/*` → `nexo-store-router-staging`, crear el token (*SSL and Certificates: Edit*) y guardar `CF_API_TOKEN` y `CF_ZONE_ID`, y poner `STORE_CNAME_TARGET` en `wrangler.jsonc`.
- **Facturación electrónica (CFDI)**: se dejó fuera de la Fase 6 por decisión de alcance. El recibo sigue indicando que no es comprobante fiscal.
- Antes de producción: probar los flujos de Stripe con claves de prueba reales (`stripe listen`) y un dominio de prueba en Cloudflare for SaaS; las pruebas automáticas usan servidores falsos.
