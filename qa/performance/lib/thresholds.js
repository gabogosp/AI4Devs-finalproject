// Fuente única de budgets de carga, atados al NFR de US-001 (§9) + E2E §17:
// "listado paginado sin degradación con ≥5.000 SKUs" (lectura p95 < 300ms).
// [propuesto — confirma Arquitecto post-load-test en entorno prod-shaped, OQ-QA-2]
export const list_products = {
  'http_req_duration{endpoint:list_products}': ['p(95)<300', 'p(99)<800'],
  http_req_failed: ['rate<0.01'],
  checks: ['rate>0.99'],
};

// Ficha pública de US-003 (§9): misma latencia de lectura, superficie ANÓNIMA.
// Presupuesto propio para no diluir la señal del listado admin: son patrones de
// acceso distintos (una fila por slug vs una página de 50).
export const storefront_product = {
  'http_req_duration{endpoint:storefront_product}': ['p(95)<300', 'p(99)<800'],
  http_req_failed: ['rate<0.01'],
  checks: ['rate>0.99'],
};

export const MIN_SKUS = 5000;

/**
 * Escritura del carrito de US-007 (TC-740). El número **no se inventa**: el PRD §4
 * fija «latencia p95 escritura (carrito/orden) < 500 ms» y la US §9 lo repite.
 *
 * `rate_limited` con `count<1` es la guarda que hace la medición honesta: con
 * `CART_WRITE_RATE_LIMIT_MAX = 30` por minuto y por IP (0,5 rps), cualquier
 * corrida realista choca contra el throttler y el p95 que se reportaría sería el
 * del rate-limit, no el del carrito (OQ-QA-2). Un solo 429 **aborta** la corrida
 * en vez de degradar el resultado a un número que parece bueno y no mide nada.
 *
 * La **lectura** del carrito (`GET /v1/cart`) se mide en la misma corrida con su
 * propio tag y su propia `Trend`, pero **a propósito no tiene presupuesto acá**: no
 * existe número ratificado (el PRD §4 acota sus 300 ms a «catálogo/ficha» y el
 * diseño del backend marca el del carrito como `[propuesto — confirma Arquitecto]`).
 * Copiarlo de otra fila sería inventar un gate; el dato se recoge sin umbral para
 * que exista el día que haya que firmarlo (OQ-QA-1). Este archivo es la fuente
 * única de presupuestos, así que la ausencia de la lectura acá **es** la decisión.
 */
export const cart_write = {
  'http_req_duration{endpoint:cart_write}': ['p(95)<500'],
  http_req_failed: ['rate<0.01'],
  checks: ['rate>0.99'],
  rate_limited: ['count<1'],
};

export default { list_products, storefront_product, cart_write, MIN_SKUS };
