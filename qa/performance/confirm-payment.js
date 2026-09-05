import http from 'k6/http';
import { check, fail } from 'k6';
import exec from 'k6/execution';
import { confirm_payment } from './lib/thresholds.js';

/**
 * QA-023-PERF-1/PERF-2 (US-023 §9 / PRD §4) — carga de `POST
 * /v1/admin/orders/{orderId}/confirm-payment`. Mismo NFR heredado que
 * `cart_write`/`auth_login` (p95 escritura < 500ms, `lib/thresholds.js`
 * `confirm_payment`).
 *
 * Tres decisiones que hacen que el número mida el camino feliz y no otra cosa:
 *
 * 1. **Una orden `pending_payment` REAL distinta por iteración, nunca la
 *    misma dos veces.** Confirmar una orden ya confirmada mide el camino 409
 *    (guard de idempotencia), no el camino feliz que el NFR describe — un
 *    error de diseño distinto, pero con el mismo síntoma que el que ya evitó
 *    `cart-write.js` con el rate-limit. `setup()` pre-siembra un POOL de
 *    `K6_CONFIRM_ORDERS` órdenes (default 150) vía checkout real (nunca INSERT
 *    directo) y `exec.scenario.iterationInTest` — el contador GLOBAL y
 *    monotónico entre TODOS los VUs (mismo mecanismo que ya usa
 *    `auth-login.js` para "una cuenta nueva por iteración, nunca reusada") —
 *    asigna exactamente una orden del pool a cada iteración. Si la corrida
 *    pide más iteraciones que órdenes sembradas, la corrida FALLA con un
 *    mensaje que dice cómo agrandar el pool, en vez de reusar una orden y
 *    reportar un p95 que en realidad es el del 409.
 * 2. **Un solo producto compartido entre todas las órdenes del pool**, con
 *    stock = pool + margen. Es la superficie admin de bajo volumen que
 *    `design.md` describe (un solo local, un solo operador) — no hace falta
 *    un catálogo de N productos distintos para medir la escritura de
 *    `payments`/`orders`/`stock`, y sembrar uno solo reduce el `setup()` de
 *    2N+3 llamadas reales a un puñado fijo + 2N (carrito + checkout).
 * 3. **El `id` interno de cada orden se resuelve con UNA sola llamada a
 *    `GET /pending-payment` al final de `setup()`**, nunca por DB ni con una
 *    llamada por orden — el mismo endpoint que `qa/support/seed-pending-payment-order.ts`
 *    usa para la suite de aceptación (dogfooding de AC-2), pero agregado en
 *    lote porque acá son decenas/cientos de órdenes, no una.
 *
 * `checks` valida `status === 200` y `body.status === 'new'`, gateado por
 * `rate: >0.99` (`lib/thresholds.js`). Sin guarda de `rate_limited`: el
 * endpoint no tiene throttler dedicado (`design.md` §Approach — "sin
 * throttler dedicado", misma superficie que `ProductsController`).
 *
 * **Executor: `shared-iterations`, no `vus`+`duration` abierto.** Un pool
 * FINITO y una duración abierta son incompatibles: con `vus`+`duration` (sin
 * `iterations`), k6 no tiene techo de cuántas iteraciones intentar — al
 * agotarse el pool, cada iteración falla en microsegundos (sin red de por
 * medio) y la corrida gasta el resto de la duración martillando MILLONES de
 * excepciones en vez de detenerse (se vio en la primera versión de este
 * script: 150 confirmaciones reales + >1.000.000 de iteraciones fallidas en
 * los ~15s restantes). `shared-iterations` fija el total en `iterations:
 * POOL` — exactamente una por orden sembrada, nunca de más — y la corrida
 * termina limpia cuando el pool se agota, como hace `auth-login.js` con su
 * propio recurso finito (cuentas pre-registradas).
 *
 * Uso:
 *   pnpm --filter @dsm/api build && pnpm --filter @dsm/qa api:up   # otra terminal
 *   ADMIN_BOOTSTRAP_TOKEN=<mismo valor configurado en la API> \
 *   QA_API_BASE_URL=http://localhost:3009 \
 *   k6 run qa/performance/confirm-payment.js --summary-trend-stats="p(95)"
 *
 * `K6_VUS` (default 3) y `K6_CONFIRM_ORDERS` (default 150, el total de
 * iteraciones) son variables de entorno, no flags `--vus`/`--duration`: con
 * `options.scenarios` explícito, k6 ignora esos flags de CLI a favor de la
 * config del escenario (mismo criterio que `auth-login.js`).
 */
const BASE = __ENV.QA_API_BASE_URL || 'http://localhost:3000';
/** Mismos defaults que `qa/support/qa-env.ts` — k6 no puede importar el módulo TS. */
const ORIGIN = __ENV.QA_WEB_BASE_URL || 'http://localhost:3200';
const BOOTSTRAP = __ENV.ADMIN_BOOTSTRAP_TOKEN;
/**
 * Tamaño del pool de órdenes pre-sembradas. Default 150: a 3 VUs por 15s con
 * un endpoint sin llamadas externas dentro de la transacción (`design.md`
 * §Resilience), es un margen generoso sobre las iteraciones reales que la
 * corrida por defecto puede completar. Subir `K6_VUS`/`K6_DURATION` exige
 * subir `K6_CONFIRM_ORDERS` en la misma proporción.
 */
const POOL = Number(__ENV.K6_CONFIRM_ORDERS || 150);

export const options = {
  scenarios: {
    confirm_payment_load: {
      executor: 'shared-iterations',
      vus: Number(__ENV.K6_VUS || 3),
      iterations: POOL,
      maxDuration: __ENV.K6_MAX_DURATION || '60s',
    },
  },
  setupTimeout: __ENV.K6_SETUP_TIMEOUT || '120s',
  thresholds: confirm_payment,
};

/**
 * Cabeceras para una llamada del carrito/checkout dentro de un `jar` propio
 * (nunca el jar implícito por-VU de k6): `X-CSRF-Token` sale del propio jar,
 * nunca de una variable de cookies armada a mano — así no hay forma de que el
 * valor quede desincronizado del que el jar realmente tiene.
 *
 * **Por qué un `jar` explícito y no el patrón de `cart-write.js`** (que arma el
 * header `Cookie` a mano desde una variable local): `cart-write.js` corre en
 * `default()`, donde cada iteración de VU sí puede aislar su propio objeto de
 * cookies en JS. Acá el ciclo que crea las N órdenes vive en `setup()` — una
 * ejecución LARGA y secuencial en un único contexto de VU — y el jar
 * IMPLÍCITO por-VU de k6 persiste entre vueltas del `for`: sin un `jar` propio
 * por orden, la segunda vuelta hereda el `dsm_cart` de la primera (identidad
 * ajena) sin su `X-CSRF-Token` a juego, y `CartCsrfGuard` la rechaza con 403
 * `dsm:auth/csrf` — el fallo real que este comentario documenta (se vio en la
 * primera versión de este script).
 */
function cabecerasCarrito(jar, url) {
  const headers = { 'Content-Type': 'application/json', Origin: ORIGIN };
  const csrf = (jar.cookiesForURL(url).dsm_cart_csrf || [])[0];
  if (csrf) headers['X-CSRF-Token'] = csrf;
  return headers;
}

export function setup() {
  if (!BOOTSTRAP) {
    fail(
      'setup: falta ADMIN_BOOTSTRAP_TOKEN. El endpoint admin exige login real — ' +
        'configurá la misma credencial en la API (env ADMIN_BOOTSTRAP_TOKEN) y en esta corrida.',
    );
  }

  // 1. Login admin real.
  const login = http.post(
    `${BASE}/v1/admin/auth/login`,
    JSON.stringify({ bootstrapToken: BOOTSTRAP }),
    { headers: { 'Content-Type': 'application/json' }, tags: { endpoint: 'setup' } },
  );
  if (login.status !== 200) {
    fail(`setup: login admin devolvió ${login.status} — ${login.body}`);
  }
  const token = login.json('token');

  // 2. Un solo producto compartido, con stock = pool + margen.
  const sufijo = `${Date.now()}`;
  const categoria = http.post(
    `${BASE}/v1/admin/categories`,
    JSON.stringify({ name: `Carga confirm-payment ${sufijo}` }),
    {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      tags: { endpoint: 'setup' },
    },
  );
  if (categoria.status !== 201) {
    fail(`setup: crear categoría devolvió ${categoria.status} — ${categoria.body}`);
  }
  const producto = http.post(
    `${BASE}/v1/admin/products`,
    JSON.stringify({
      sku: `PERF-CONFIRM-${sufijo}`,
      name: `Producto carga confirm-payment ${sufijo}`,
      price_ars_cents: 100000,
      stock: POOL + 50,
      category_id: categoria.json('id'),
    }),
    {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      tags: { endpoint: 'setup' },
    },
  );
  if (producto.status !== 201) {
    fail(`setup: crear producto devolvió ${producto.status} — ${producto.body}`);
  }
  const slug = producto.json('slug');
  const publicar = http.patch(
    `${BASE}/v1/admin/products/${producto.json('id')}`,
    JSON.stringify({ status: 'published' }),
    {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      tags: { endpoint: 'setup' },
    },
  );
  if (publicar.status !== 200) {
    fail(`setup: publicar producto devolvió ${publicar.status} — ${publicar.body}`);
  }

  // 3. POOL checkouts reales — un invitado nuevo por orden, CADA UNO con su
  //    propio `http.CookieJar()` (ver comentario de `cabecerasCarrito`).
  const cartUrl = `${BASE}/v1/cart/items/${slug}`;
  const checkoutUrl = `${BASE}/v1/checkout`;
  const orderNumbers = [];
  for (let i = 0; i < POOL; i++) {
    const jar = new http.CookieJar();

    const alta = http.put(cartUrl, JSON.stringify({ quantity: 1 }), {
      headers: cabecerasCarrito(jar, cartUrl),
      jar,
      tags: { endpoint: 'setup' },
    });
    if (alta.status !== 200) {
      fail(`setup: agregar al carrito (orden ${i}) devolvió ${alta.status} — ${alta.body}`);
    }

    const checkout = http.post(
      checkoutUrl,
      JSON.stringify({
        buyer: {
          name: `Comprador Carga ${i}`,
          email: `comprador-carga-${sufijo}-${i}@qa.dsm.local`,
          phone: '+54 9 11 5555 5555',
        },
        consent: true,
        fulfillment: 'pickup',
      }),
      { headers: cabecerasCarrito(jar, checkoutUrl), jar, tags: { endpoint: 'setup' } },
    );
    if (checkout.status !== 201) {
      fail(`setup: checkout (orden ${i}) devolvió ${checkout.status} — ${checkout.body}`);
    }
    orderNumbers.push(checkout.json('order_number'));
  }

  // 4. UNA sola llamada a pending-payment para resolver los N ids (AC-2 —
  //    nunca por DB, mismo criterio que `seed-pending-payment-order.ts`).
  const pendientes = http.get(`${BASE}/v1/admin/orders/pending-payment`, {
    headers: { Authorization: `Bearer ${token}` },
    tags: { endpoint: 'setup' },
  });
  if (pendientes.status !== 200) {
    fail(`setup: GET pending-payment devolvió ${pendientes.status} — ${pendientes.body}`);
  }
  const porNumero = new Map();
  for (const fila of pendientes.json() || []) {
    porNumero.set(fila.order_number, fila.id);
  }
  const ids = orderNumbers.map((n) => {
    const id = porNumero.get(n);
    if (!id) fail(`setup: la orden #${n} no aparece en GET /pending-payment`);
    return id;
  });

  return { token, ids };
}

export default function (data) {
  const i = exec.scenario.iterationInTest;
  if (i >= data.ids.length) {
    fail(
      `iteración ${i} sin orden disponible: el pool tiene ${data.ids.length} ` +
        `(K6_CONFIRM_ORDERS=${POOL}). Subí K6_CONFIRM_ORDERS o bajá K6_VUS/K6_DURATION.`,
    );
  }
  const orderId = data.ids[i];

  const res = http.post(
    `${BASE}/v1/admin/orders/${orderId}/confirm-payment`,
    null,
    {
      headers: { Authorization: `Bearer ${data.token}` },
      tags: { endpoint: 'confirm_payment' },
    },
  );

  check(res, {
    'confirm-payment: 200': (r) => r.status === 200,
    'confirm-payment: status body es "new"': (r) => {
      if (r.status !== 200) return false;
      return r.json('status') === 'new';
    },
  });
}
