import http from 'k6/http';
import { check, fail } from 'k6';
import { order_transition } from './lib/thresholds.js';

/**
 * TC-1241 — carga de escritura (transición de estado) del panel de
 * fulfillment (US-012 §9, PRD §4). Presupuesto en `lib/thresholds.js`
 * (fuente única) — `p(95)<500ms`.
 *
 * **Una orden `new` distinta por iteración** (`design.md`/tasks.md T7.2
 * Pattern): reusar la misma mediría el `UPDATE` condicional sobre una fila
 * caliente, no el patrón real de un operador avanzando órdenes distintas. El
 * pool sale de `data/orders-load-pool.json`, sembrado por `seed-orders-load.ts`
 * — nunca de `GET /v1/admin/orders?status=new` sin acotar: la base es
 * compartida por otras sesiones QA y ese filtro devolvería también SUS
 * órdenes (mutarlas les rompería el test).
 *
 * Uso:
 *   QA_ORDERS_POOL_SIZE=200 pnpm --filter @dsm/qa exec tsx performance/seed-orders-load.ts
 *   QA_API_BASE_URL=http://localhost:3009 k6 run --vus 2 --duration 20s qa/performance/orders-write.js
 */
const BASE = __ENV.QA_API_BASE_URL || 'http://localhost:3000';
const BOOTSTRAP = __ENV.ADMIN_BOOTSTRAP_TOKEN;
const pool = JSON.parse(open('./data/orders-load-pool.json'));

export const options = {
  vus: Number(__ENV.K6_VUS || 2),
  duration: __ENV.K6_DURATION || '20s',
  thresholds: order_transition,
};

export function setup() {
  if (pool.length === 0) {
    fail(
      'setup: el pool de órdenes está vacío. Sembralo antes: ' +
        'pnpm --filter @dsm/qa exec tsx performance/seed-orders-load.ts',
    );
  }
  const res = http.post(
    `${BASE}/v1/admin/auth/login`,
    JSON.stringify({ bootstrapToken: BOOTSTRAP }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(res, { 'login real 200': (r) => r.status === 200 });
  if (res.status !== 200) fail(`setup: login admin devolvió ${res.status}`);
  return { token: res.json('token') };
}

export default function (data) {
  const idx = (__VU * 100000 + __ITER) % pool.length;
  const orderId = pool[idx];

  const res = http.patch(
    `${BASE}/v1/admin/orders/${orderId}`,
    JSON.stringify({ status: 'preparing' }),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${data.token}`,
      },
      tags: { endpoint: 'order_transition' },
    },
  );

  check(res, {
    'status 200': (r) => r.status === 200,
    'la orden quedó en "preparing"': (r) => r.status === 200 && r.json('status') === 'preparing',
  });

  if (res.status >= 400 && res.status !== 429) {
    // Fuera de rango-limit: cada índice del pool es único por (VU, ITER) —
    // un status distinto de 200 es un defecto real, no un choque esperado.
    fail(`PATCH ${orderId} → ${res.status}: ${res.body}`);
  }
}
