import http from 'k6/http';
import { check, fail } from 'k6';
import exec from 'k6/execution';
import { simulate_payment } from './lib/thresholds.js';

/**
 * QA-010-PERF-1/PERF-2 (`qa-plan.md` §7, `design.md` de backend §D12) — carga
 * de `POST /v1/checkout/simulate-payment`. Mismo NFR heredado (p95 < 200ms —
 * el único endpoint de esta US sin ninguna llamada externa dentro de la
 * transacción, a diferencia del webhook real que sí llamaría a MercadoPago).
 *
 * Decisiones heredadas SIN repetir la investigación (mismos hallazgos ya
 * resueltos por `confirm-payment.js`, US-023):
 *
 * 1. **Una orden `pending_payment` REAL distinta por iteración, nunca la
 *    misma dos veces** — confirmar una ya confirmada mide el camino 409
 *    (guard de idempotencia), no el camino feliz que el NFR describe.
 * 2. **Executor `shared-iterations` con `iterations: POOL`** — un recurso
 *    finito pre-sembrado es incompatible con `vus`+`duration` abiertos.
 * 3. **Un solo producto compartido**, stock = pool + margen.
 *
 * Diferencia real con `confirm-payment.js`: `simulate-payment` autoriza por
 * `order_token` (el secreto que `POST /v1/checkout` devuelve UNA vez), nunca
 * por sesión admin + `orderId` — así que `setup()` NO necesita la llamada en
 * lote a `GET /pending-payment` para resolver ids (US-023 sí la necesita
 * porque `confirm-payment` toma `orderId` en el path): cada `checkout()` real
 * ya devuelve el `order_token` que la iteración necesita, directo.
 *
 * `checks` valida `status === 200` y `body.status === 'new'`, gateado por
 * `rate: >0.99`. Sin guarda de `rate_limited`: el entorno de QA
 * (`qa/scripts/api-up.sh`) eleva `PAYMENTS_SIMULATE_RATE_LIMIT_MAX` a
 * propósito — mismo criterio que `confirm_payment`.
 *
 * Uso:
 *   pnpm --filter @dsm/api build && pnpm --filter @dsm/qa api:up   # otra terminal
 *   QA_API_BASE_URL=http://localhost:3009 \
 *   ADMIN_BOOTSTRAP_TOKEN=<mismo valor configurado en la API> \
 *   k6 run qa/performance/simulate-payment.js --summary-trend-stats="p(95)"
 */
const BASE = __ENV.QA_API_BASE_URL || 'http://localhost:3000';
const ORIGIN = __ENV.QA_WEB_BASE_URL || 'http://localhost:3200';
const BOOTSTRAP = __ENV.ADMIN_BOOTSTRAP_TOKEN;
const POOL = Number(__ENV.K6_SIMULATE_ORDERS || 150);

/**
 * **Hallazgo QA-010-F2 (harness, no del backend)**: `K6_VUS` NO es un nombre
 * de variable "propio" del script — k6 lo reconoce en runtime como
 * equivalente al flag `--vus` (mismo mecanismo que `K6_ITERATIONS`/
 * `K6_DURATION`) y con eso **pisa `options.scenarios` en silencio**: verificado
 * en esta corrida (`K6_VUS=3` colapsó `iterations: 150` a sólo 3 iteraciones
 * reales, sin ningún error ni warning propio del script — sólo el aviso
 * genérico de k6 "`vus=3` overrides scenarios configuration"). El comentario
 * de `confirm-payment.js`/`auth-login.js` (US-023) afirma que "con
 * `options.scenarios` explícito, k6 ignora esos flags de CLI a favor de la
 * config del escenario" — cierto para el FLAG `--vus`, falso para la env var
 * `K6_VUS`, que sigue pisando igual. Ambos scripts heredan el mismo bug
 * silencioso (fuera de alcance tocarlos — son de un change ya archivado);
 * acá se evita usando un nombre que k6 NO reconoce.
 */
const VUS = Number(__ENV.SIMULATE_PAYMENT_VUS || 3);

export const options = {
  scenarios: {
    simulate_payment_load: {
      executor: 'shared-iterations',
      vus: VUS,
      iterations: POOL,
      maxDuration: __ENV.K6_MAX_DURATION || '60s',
    },
  },
  setupTimeout: __ENV.K6_SETUP_TIMEOUT || '120s',
  thresholds: simulate_payment,
};

/** Mismo `jar` explícito por orden que `confirm-payment.js` — ver su comentario. */
function cabecerasCarrito(jar, url) {
  const headers = { 'Content-Type': 'application/json', Origin: ORIGIN };
  const csrf = (jar.cookiesForURL(url).dsm_cart_csrf || [])[0];
  if (csrf) headers['X-CSRF-Token'] = csrf;
  return headers;
}

export function setup() {
  if (!BOOTSTRAP) {
    fail(
      'setup: falta ADMIN_BOOTSTRAP_TOKEN. Sembrar el catálogo (categoría/producto) exige ' +
        'login admin real — configurá la misma credencial en la API y en esta corrida.',
    );
  }

  const login = http.post(
    `${BASE}/v1/admin/auth/login`,
    JSON.stringify({ bootstrapToken: BOOTSTRAP }),
    { headers: { 'Content-Type': 'application/json' }, tags: { endpoint: 'setup' } },
  );
  if (login.status !== 200) {
    fail(`setup: login admin devolvió ${login.status} — ${login.body}`);
  }
  const token = login.json('token');

  const sufijo = `${Date.now()}`;
  const categoria = http.post(
    `${BASE}/v1/admin/categories`,
    JSON.stringify({ name: `Carga simulate-payment ${sufijo}` }),
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
      sku: `PERF-SIMULATE-${sufijo}`,
      name: `Producto carga simulate-payment ${sufijo}`,
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

  // POOL checkouts reales — un invitado nuevo por orden, cada uno con su
  // propio `jar` (ver `cabecerasCarrito`). El `order_token` sale DIRECTO del
  // 201 de checkout — no hace falta resolver ningún id vía pending-payment.
  const cartUrl = `${BASE}/v1/cart/items/${slug}`;
  const checkoutUrl = `${BASE}/v1/checkout`;
  const orderTokens = [];
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
          email: `comprador-carga-simulate-${sufijo}-${i}@qa.dsm.local`,
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
    orderTokens.push(checkout.json('order_token'));
  }

  return { orderTokens };
}

export default function (data) {
  const i = exec.scenario.iterationInTest;
  if (i >= data.orderTokens.length) {
    fail(
      `iteración ${i} sin orden disponible: el pool tiene ${data.orderTokens.length} ` +
        `(K6_SIMULATE_ORDERS=${POOL}). Subí K6_SIMULATE_ORDERS o bajá SIMULATE_PAYMENT_VUS.`,
    );
  }
  const orderToken = data.orderTokens[i];

  const res = http.post(
    `${BASE}/v1/checkout/simulate-payment`,
    JSON.stringify({ order_token: orderToken }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { endpoint: 'simulate_payment' },
    },
  );

  check(res, {
    'simulate-payment: 200': (r) => r.status === 200,
    'simulate-payment: status body es "new"': (r) => {
      if (r.status !== 200) return false;
      return r.json('status') === 'new';
    },
  });
}
