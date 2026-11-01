# Tienda en línea (Fase 4)

App React publicada en **Cloudflare Pages**. Cada negocio vive en `/<slug>`.

- `src/` — catálogo, producto con variantes, carrito (en `localStorage` por tienda), pago del pedido y seguimiento.
- `functions/api/[[path]].ts` — reenvía solo `/api/store/*` al Worker de la API por service binding.
- `functions/files/[[path]].ts` — imágenes de R2 a través de la API.
- `functions/_middleware.ts` — pone título, descripción e imagen reales en el HTML para compartir y buscadores.
- `wrangler.toml` — proyecto de Pages y service bindings por entorno.

Desarrollo: `npm run dev` en la raíz levanta la tienda en http://localhost:5174 (Vite reenvía `/api/store` y `/files` a `wrangler dev`).
Para probar las Functions tal como en producción: `npm run build -w @nexo/store && cd apps/store && npx wrangler pages dev dist --port 8788` con la API corriendo.
