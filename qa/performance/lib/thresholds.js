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

// Búsqueda semántica de US-004 (§9 / PRD §4 / E2E §17): «p95 de búsqueda < 1,5 s
// (incluye el embedding de la consulta)». Sin auth ni rate-limit propio en el
// threshold: SEARCH_RATE_LIMIT_MAX (20/min/IP) se ejercita aparte en el gate
// funcional (QA-004-N5), no acá — mezclar los dos convertiría un 429 esperado en
// ruido del p95.
//
// [ADVERTENCIA — corrida sin GEMINI_API_KEY, ver qa-plan.md §6 QA-004-PERF-1]:
// sin la key el proveedor de IA está deshabilitado y TODA request degrada a
// full-text (AC-4) — el número que sale de acá es el p95 del camino léxico, NO
// el del kNN+embedding que el NFR realmente describe. Es una medición honesta de
// una superficie distinta a la que el umbral fue pensado para el día que haya
// credencial: se documenta acá para que quien lo re-corra con la key sepa que el
// resultado anterior no era el camino feliz.
export const search = {
  'http_req_duration{endpoint:search}': ['p(95)<1500'],
  http_req_failed: ['rate<0.01'],
  checks: ['rate>0.99'],
};

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

/**
 * Login de cuenta de cliente de US-014 (TC-160). Mismo presupuesto que
 * `cart_write` porque es el MISMO NFR: PRD §4 fija «p95 de escritura
 * (carrito/orden) < 500 ms» y la US-014 §9 lo repite para login.
 *
 * `rate_limited` con `count<1` es la misma guarda de honestidad que
 * `cart_write`: `/v1/auth/login` tiene su propio `@Throttle` de **10 intentos
 * / 15 min por IP** en `customer-auth.controller.ts`, fijo — no lee
 * `AUTH_RATE_LIMIT_MAX` (§7.3, presupuesto de producción a propósito). El
 * script asigna una IP simulada distinta por VU (`X-Forwarded-For`, requiere
 * `TRUST_PROXY_HOPS=1` como en el resto de la suite QA) para no chocar contra
 * ese límite — si aparece un 429 igual, el resultado no se publica.
 */
export const auth_login = {
  'http_req_duration{endpoint:auth_login}': ['p(95)<500'],
  http_req_failed: ['rate<0.01'],
  checks: ['rate>0.99'],
  rate_limited: ['count<1'],
};

// Unión de los thresholds de US-004 (`search`, llegó por main) y US-014 (`auth_login`):
// las dos suites QA extienden el mismo archivo compartido.
export default { list_products, storefront_product, cart_write, auth_login, search, MIN_SKUS };
