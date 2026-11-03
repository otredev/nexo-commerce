/** Links from each page of the dashboard to its part of the manual (kept apart from the heavy help page). */

/** Section of the manual for each page of the dashboard (the "?" button in the top bar). */
const CONTEXT: Array<[RegExp, string]> = [
  [/^\/pos/, "5-punto-de-venta-y-caja"],
  [/^\/caja/, "ingresos-retiros-y-corte-de-caja"],
  [/^\/ventas/, "6-ventas-devoluciones-y-anulaciones"],
  [/^\/clientes/, "clientes"],
  [/^\/promociones/, "promociones-y-cupones"],
  [/^\/pedidos/, "10-pedidos-en-línea"],
  [/^\/tienda\/estadisticas/, "estadísticas-de-la-tienda"],
  [/^\/tienda\/apariencia/, "apariencia"],
  [/^\/tienda/, "9-tienda-en-línea"],
  [/^\/productos/, "3-productos-y-catálogo"],
  [/^\/inventario\/movimientos/, "movimientos-kardex"],
  [/^\/inventario/, "4-inventario"],
  [/^\/catalogo/, "categorías-y-marcas"],
  [/^\/compras/, "órdenes-de-compra"],
  [/^\/proveedores/, "proveedores"],
  [/^\/cuentas-por-pagar/, "cuentas-por-pagar"],
  [/^\/traspasos/, "traspasos-entre-ubicaciones"],
  [/^\/conteos/, "conteos-físicos"],
  [/^\/usuarios/, "usuarios"],
  [/^\/actividad/, "14-seguridad-y-actividad"],
  [/^\/reportes/, "reportes"],
];
export function helpLinkFor(pathname: string, search: string) {
  if (pathname === "/configuracion") {
    const tab = new URLSearchParams(search).get("tab");
    const byTab: Record<string, string> = { notificaciones: "12-notificaciones-y-el-panel-en-tu-celular", integraciones: "13-integraciones-api-webhooks-y-asistentes-de-ia", plan: "planes", seguridad: "14-seguridad-y-actividad" };
    return `/ayuda#${byTab[tab ?? ""] ?? "2-configura-tu-negocio"}`;
  }
  const hit = CONTEXT.find(([re]) => re.test(pathname));
  return `/ayuda${hit ? `#${hit[1]}` : ""}`;
}
