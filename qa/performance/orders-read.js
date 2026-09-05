import http from 'k6/http';
import { check, fail } from 'k6';
import { list_orders } from './lib/thresholds.js';

/**
 * TC-1240 — carga de lectura del listado del panel de fulfillment (US-012 §9,
 * PRD §4). Presupuesto en `lib/thresholds.js` (fuente única) — `p(95)<300ms`,
 * no hardcodeado acá.
 *
 * Datos: `seed-orders-load.ts` (vía T1.1 `crearOrdenEnEstado`) siembra el pool
 * de `new` antes de correr esto — ver el `Uso` de ese archivo.
 *
 * Uso:
 *   pnpm --filter @dsm/qa exec tsx performance/seed-orders-load.ts   # una vez
 *   QA_API_BASE_URL=http://localhost:3009 k6 run --vus 2 --duration 20s qa/performance/orders-read.js
 */
const BASE = __ENV.QA_API_BASE_URL || 'http://localhost:3000';
const BOOTSTRAP = __ENV.ADMIN_BOOTSTRAP_TOKEN;
const PAGE = 20;

export const options = {
  vus: Number(__ENV.K6_VUS || 2),
  duration: __ENV.K6_DURATION || '20s',
  thresholds: list_orders,
};

export function setup() {
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
  const offset = (__ITER % 20) * PAGE;
  const res = http.get(`${BASE}/v1/admin/orders?limit=${PAGE}&offset=${offset}`, {
    headers: { Authorization: `Bearer ${data.token}` },
    tags: { endpoint: 'list_orders' },
  });
  check(res, {
    'status 200': (r) => r.status === 200,
    'trae data[] y pagination': (r) => {
      if (r.status !== 200) return false;
      return Array.isArray(r.json('data')) && typeof r.json('pagination.total') === 'number';
    },
    'data.length <= limit': (r) => r.status === 200 && r.json('data').length <= PAGE,
  });
}
