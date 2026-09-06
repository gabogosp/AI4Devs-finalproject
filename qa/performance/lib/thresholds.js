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
 * Escritura de `POST /v1/checkout` de US-008 (QA-008-PERF-1). El número sale
 * del mismo NFR que `cart_write`: PRD §4 fija «p95 de escritura
 * (carrito/orden) < 500 ms» y la US §9 lo repite explícitamente para el
 * checkout — no es un número nuevo, es el mismo presupuesto de escritura
 * aplicado al endpoint que efectivamente crea la orden.
 *
 * `rate_limited` con `count<1`: mismo criterio que `cart_write`/`auth_login` —
 * el checkout tiene su propio throttler (`CHECKOUT_RATE_LIMIT_MAX`, §7.3) y la
 * corrida real se hace contra la instancia QA con el presupuesto elevado
 * (`qa/scripts/api-up.sh`); un solo 429 invalida la medición.
 */
export const checkout = {
  'http_req_duration{endpoint:checkout}': ['p(95)<500'],
  http_req_failed: ['rate<0.01'],
  checks: ['rate>0.99'],
  rate_limited: ['count<1'],
};

/**
 * Login de cuenta de cliente de US-014 (TC-160). **Presupuesto propio,
 * ratificado por el PO 2026-09-06** (OQ-QA-5, resuelto —
 * `openspec/changes/US-014-registro-login-qa/proposal.md`): el PRD §4 fija
 * «p95 de escritura (carrito/orden) < 500 ms», pero esa fila dice
 * literalmente "carrito/orden" — no cubre login — y US-014 §9 no fijaba
 * ningún número de latencia para esta ruta, sólo NFRs cualitativos. El PO
 * ratificó **p95 ≤ 800 ms** como budget propio de login, aceptando
 * expresamente el costo de `bcrypt` cost 12 (~250 ms **por diseño**,
 * mitigación de fuerza bruta) como parte del presupuesto — no un defecto a
 * optimizar. Medido contra la API real: p95 ≈ 621,93 ms, con margen real
 * bajo los 800 ms.
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
  'http_req_duration{endpoint:auth_login}': ['p(95)<800'],
  http_req_failed: ['rate<0.01'],
  checks: ['rate>0.99'],
  rate_limited: ['count<1'],
};

/**
 * Confirmación de pago manual/offline de US-023 (QA-023-PERF-1/PERF-2). Mismo
 * presupuesto heredado que `cart_write`/`auth_login`: el PRD §4 fija «p95 de
 * escritura (carrito/orden) < 500 ms» y la US-023 §9 lo repite explícitamente
 * para "confirmar pago" — no es un número nuevo, es el mismo NFR de escritura
 * aplicado a un tercer endpoint de escritura.
 *
 * Sin `rate_limited` (a diferencia de `cart_write`/`auth_login`): el endpoint
 * no tiene throttler dedicado (`design.md` §Approach de US-023-pago-manual-offline-backend
 * — misma superficie de bajo volumen que `ProductsController`/`CategoriesController`),
 * así que no hay una guarda de esa clase que necesite excluirse.
 */
export const confirm_payment = {
  'http_req_duration{endpoint:confirm_payment}': ['p(95)<500'],
  http_req_failed: ['rate<0.01'],
  checks: ['rate>0.99'],
};

/**
 * Listado del panel de fulfillment de US-012 (TC-1240). El número sale de la
 * US §9 ("Latencia p95 lectura < 300ms"), que hereda el PRD §4 — sin
 * condicional, a diferencia de la lectura del carrito de US-007.
 */
export const list_orders = {
  'http_req_duration{endpoint:list_orders}': ['p(95)<300'],
  http_req_failed: ['rate<0.01'],
  checks: ['rate>0.99'],
};

/**
 * Transición de estado del panel de fulfillment de US-012 (TC-1241). US §9
 * ("Latencia p95 escritura (transición) < 500ms"), mismo NFR que
 * `cart_write`/`auth_login` (PRD §4 — "p95 escritura (carrito/orden) < 500 ms").
 *
 * `rate_limited` con `count<1`: la superficie admin no tiene un throttler
 * dedicado propio distinto del resto de `/v1/admin/*`, pero la corrida real
 * usa una API arrancada para QA (`api:up`) con los presupuestos elevados —
 * misma guarda de honestidad que `cart_write`.
 */
export const order_transition = {
  'http_req_duration{endpoint:order_transition}': ['p(95)<500'],
  http_req_failed: ['rate<0.01'],
  checks: ['rate>0.99'],
};

/**
 * Lectura de los 3 datasets del panel de métricas de US-016 (QA-016-PERF-1).
 * El número sale de la US §9 ("Latencia p95 lectura < 300ms"), heredado de
 * PRD §4/E2E §17/design.md §D8 — mismo NFR que `list_orders`, sin condicional.
 * Tags por endpoint (`k6-load-scaffolding` §Per-scenario thresholds): el
 * endpoint más lento no se esconde detrás de un agregado global.
 */
export const reports_read = {
  'http_req_duration{endpoint:reports_sales}': ['p(95)<300'],
  'http_req_duration{endpoint:reports_top_products}': ['p(95)<300'],
  'http_req_duration{endpoint:reports_summary}': ['p(95)<300'],
  http_req_failed: ['rate<0.01'],
  checks: ['rate>0.99'],
};

/**
 * Medio simulado "DSM" de US-010 (QA-010-PERF-1/PERF-2, `design.md` de backend
 * §D12). Presupuesto **propio** (no heredado de `cart_write`/`confirm_payment`):
 * §D12 propone explícitamente `p95 < 200ms` para este endpoint por no tener
 * ninguna llamada externa dentro de la transacción (a diferencia del webhook
 * real, que sí llamaría a MercadoPago) — se hereda ESE número, no se inventa
 * uno nuevo ni se reusa el de escritura genérico de 500ms.
 *
 * Sin `rate_limited`: `PAYMENTS_SIMULATE_RATE_LIMIT_MAX` se eleva a propósito
 * en el entorno de QA (`qa/scripts/api-up.sh`) — mismo criterio que
 * `confirm_payment` (sin throttler dedicado a nivel de negocio, superficie
 * medida sin la guarda de rate-limit de producción).
 */
export const simulate_payment = {
  'http_req_duration{endpoint:simulate_payment}': ['p(95)<200'],
  http_req_failed: ['rate<0.01'],
  checks: ['rate>0.99'],
};

/**
 * Historial de compras del cliente registrado, de US-015 (QA-015-PERF-1/2,
 * `qa-plan.md` §7, `design.md` §D-QA7). El número sale de la US §9 ("Latencia
 * p95 lectura < 300ms"), heredado de PRD §4 — mismo NFR que `list_orders`
 * (admin), sin condicional. Entrada PROPIA (no reusa `list_orders`): son
 * patrones de acceso distintos — una cuenta ve SU propio historial (1 fila
 * por cliente en el camino normal) vs el panel admin viendo TODAS las
 * órdenes — mismo criterio que `list_products` vs `storefront_product`.
 *
 * Sin `rate_limited`: la corrida real usa una API arrancada para QA
 * (`api:up`) sin elevar `ORDERS_HISTORY_RATE_LIMIT_MAX` (default 60/min) —
 * a diferencia de `cart_write`/`auth_login`, el volumen de VUs de esta
 * carga (documentado en `orders-history-read.js`) se mantiene deliberadamente
 * bajo ese presupuesto por IP simulada, así que no hace falta la guarda.
 */
export const orders_history_list = {
  'http_req_duration{endpoint:orders_history_list}': ['p(95)<300'],
  http_req_failed: ['rate<0.01'],
  checks: ['rate>0.99'],
};

/**
 * `POST /admin/orders/{id}/cancel` de US-013 (QA-013-PERF-1, `design.md` de
 * backend §D8). Mismo criterio que `simulate_payment`: presupuesto **propio**
 * de `p95 < 200ms` sólo para el camino sin llamada externa (confirmación
 * manual/simulada) — el camino `mercadopago` queda deliberadamente SIN
 * threshold acá (no alcanzable por API real en este entorno, QA-013-F1).
 */
export const cancel_order = {
  'http_req_duration{endpoint:cancel_order}': ['p(95)<200'],
  http_req_failed: ['rate<0.01'],
  checks: ['rate>0.99'],
};

/**
 * `DELETE /v1/me` de US-020 (QA-020-PERF-1, `qa-plan.md` §8). El único NFR
 * numérico y cuantificado de toda la US: "p95 < 500 ms para una cuenta con
 * hasta 50 órdenes" (`design.md` §9, `[propuesto — confirma Arquitecto]`) —
 * no es un número inventado por QA, es el que la propia US propone.
 *
 * Sin `rate_limited`: `ACCOUNT_DELETION_RATE_LIMIT_MAX` no tiene guarda de
 * honestidad dedicada acá porque cada iteración usa una cuenta (y por lo
 * tanto una identidad de sesión) distinta — el throttler de este endpoint no
 * tiene una dimensión de "por IP" que un k6 de pocas VUs comparta en la forma
 * en que sí lo hacen `cart_write`/`auth_login` (mismo criterio que
 * `cancel_order`, que tampoco lo declara).
 */
export const delete_account = {
  'http_req_duration{endpoint:delete_account}': ['p(95)<500'],
  http_req_failed: ['rate<0.01'],
  checks: ['rate>0.99'],
};

// Unión de los thresholds de US-004 (`search`, llegó por main), US-014
// (`auth_login`), US-023 (`confirm_payment`), US-012 (`list_orders`/
// `order_transition`), US-010 (`simulate_payment`), US-016 (`reports_read`),
// US-015 (`orders_history_list`), US-013 (`cancel_order`) y US-020
// (`delete_account`): las suites QA extienden el mismo archivo compartido.
export default {
  list_products,
  storefront_product,
  cart_write,
  checkout,
  auth_login,
  search,
  confirm_payment,
  list_orders,
  order_transition,
  simulate_payment,
  reports_read,
  orders_history_list,
  cancel_order,
  delete_account,
  MIN_SKUS,
};
