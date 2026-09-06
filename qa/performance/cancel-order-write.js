import http from 'k6/http';
import { check, fail } from 'k6';
import exec from 'k6/execution';
import { cancel_order } from './lib/thresholds.js';

/**
 * QA-013-PERF-1 (`qa-plan.md` §5.5, `design.md` de backend §D8) — carga de
 * `POST /v1/admin/orders/{id}/cancel` sobre órdenes pagadas por confirmación
 * MANUAL (sin llamada externa dentro de la transacción — mismo criterio de
 * presupuesto propio que `simulate-payment.js`/`confirm-payment.js`, p95 <
 * 200ms). Deliberadamente SIN threshold para el camino `mercadopago` — no
 * alcanzable por API real en este entorno (QA-013-F1, sin sandbox).
 *
 * Decisiones heredadas SIN repetir la investigación (mismos hallazgos ya
 * resueltos por `confirm-payment.js`/`simulate-payment.js`, US-023/US-010):
 *
 * 1. **Una orden REAL distinta por iteración, nunca la misma dos veces** —
 *    cancelar es de un solo uso (idempotente en un segundo intento, pero eso
 *    mediría el camino de guard, no el camino feliz que el NFR describe).
 * 2. **Executor `shared-iterations` con `iterations: POOL`**.
 * 3. **`checks` valida status 200 Y `refund.status === 'refunded'`** en el
 *    body (`k6-load-scaffolding` §Checks vs thresholds) — no sólo el status
 *    HTTP.
 * 4. **Setup**: checkout real × POOL → resuelve ids vía UNA sola
 *    `GET /pending-payment` (nunca por DB) → confirma cada una por
 *    `confirm-payment` real (deja las POOL órdenes en `new`, listas para
 *    cancelar en el `default()`).
 *
 * Uso:
 *   pnpm --filter @dsm/api build && pnpm --filter @dsm/qa api:up   # otra terminal
 *   QA_API_BASE_URL=http://localhost:3009 \
 *   ADMIN_BOOTSTRAP_TOKEN=<mismo valor configurado en la API> \
 *   k6 run qa/performance/cancel-order-write.js --summary-trend-stats="p(95)"
 */
const BASE = __ENV.QA_API_BASE_URL || 'http://localhost:3000';
const ORIGIN = __ENV.QA_WEB_BASE_URL || 'http://localhost:3200';
const BOOTSTRAP = __ENV.ADMIN_BOOTSTRAP_TOKEN;
const POOL = Number(__ENV.K6_CANCEL_ORDERS || 150);

/** Nombre deliberado (no `K6_VUS`, que k6 reconoce en runtime y pisa `options.scenarios` en silencio — hallazgo QA-010-F2). */
const VUS = Number(__ENV.CANCEL_ORDER_VUS || 3);

export const options = {
  scenarios: {
    cancel_order_load: {
      executor: 'shared-iterations',
      vus: VUS,
      iterations: POOL,
      maxDuration: __ENV.K6_MAX_DURATION || '60s',
    },
  },
  setupTimeout: __ENV.K6_SETUP_TIMEOUT || '120s',
  thresholds: cancel_order,
};

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
    JSON.stringify({ name: `Carga cancel-order ${sufijo}` }),
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
      sku: `PERF-CANCEL-${sufijo}`,
      name: `Producto carga cancel-order ${sufijo}`,
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

  // POOL checkouts reales — un invitado nuevo por orden.
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
          email: `comprador-carga-cancel-${sufijo}-${i}@qa.dsm.local`,
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

  // UNA sola llamada a pending-payment para resolver los N ids (nunca por DB).
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

  // Confirma cada orden por confirmación MANUAL real (US-023) — las deja en
  // "new", pagadas, listas para el `default()` de esta carga.
  for (const id of ids) {
    const confirmar = http.post(`${BASE}/v1/admin/orders/${id}/confirm-payment`, null, {
      headers: { Authorization: `Bearer ${token}` },
      tags: { endpoint: 'setup' },
    });
    if (confirmar.status !== 200) {
      fail(`setup: confirm-payment (orden ${id}) devolvió ${confirmar.status} — ${confirmar.body}`);
    }
  }

  return { token, ids };
}

export default function (data) {
  const i = exec.scenario.iterationInTest;
  if (i >= data.ids.length) {
    fail(
      `iteración ${i} sin orden disponible: el pool tiene ${data.ids.length} ` +
        `(K6_CANCEL_ORDERS=${POOL}). Subí K6_CANCEL_ORDERS o bajá CANCEL_ORDER_VUS.`,
    );
  }
  const orderId = data.ids[i];

  const res = http.post(`${BASE}/v1/admin/orders/${orderId}/cancel`, null, {
    headers: { Authorization: `Bearer ${data.token}` },
    tags: { endpoint: 'cancel_order' },
  });

  check(res, {
    'cancel-order: 200': (r) => r.status === 200,
    'cancel-order: refund.status es "refunded"': (r) => {
      if (r.status !== 200) return false;
      return r.json('refund.status') === 'refunded';
    },
  });
}
