# Tienda online (Fase 4)

Marcador de posición para la tienda pública, que se desplegará en **Cloudflare Pages**.

Plan para la Fase 4:
- Astro con SSR en Pages, para buen SEO.
- Cada negocio en `<slug>.<dominio>`; el slug se resuelve contra `tenant_domains` / `tenants.slug` de la D1 de control.
- Lectura del catálogo a través del Worker de la API con un **service binding** (sin salir a internet).
- Mismo sistema de diseño: `@nexo/ui/styles.css` (estilo `body-lg` y `display` para la portada).

Hoy solo publica una página estática para reservar el proyecto de Pages.
