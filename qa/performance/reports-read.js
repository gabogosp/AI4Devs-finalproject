import http from 'k6/http';
import { check, fail } from 'k6';
import { reports_read } from './lib/thresholds.js';

/**
 * QA-016-PERF-1 — carga de lectura de los 3 datasets del panel de métricas
 * (US-016 §9, PRD §4 / E2E §17 / design.md §D8). Presupuesto en
 * `lib/thresholds.js` (fuente única) — `p(95)<300ms`, mismo NFR que ya midió
 * `US-012-panel-ordenes-dueno-qa` (p95 real 1.81 ms) para una superficie
 * admin equivalente.
 *
 * Sin threshold para los 3 `/export` (decisión deliberada, qa-plan.md §5.5):
 * ningún AC/NFR de la US fija un presupuesto de latencia para la descarga
 * CSV — no se inventa uno acá.
 *
 * Datos: `seed-reports-load.ts` siembra el pool de órdenes activas antes de
 * correr esto.
 *
 * Uso:
 *   pnpm --filter @dsm/qa exec tsx performance/seed-reports-load.ts   # una vez
 *   ADMIN_BOOTSTRAP_TOKEN=... QA_API_BASE_URL=http://localhost:3000 k6 run qa/performance/reports-read.js
 */
const BASE = __ENV.QA_API_BASE_URL || 'http://localhost:3000';
const BOOTSTRAP = __ENV.ADMIN_BOOTSTRAP_TOKEN;

export const options = {
  vus: Number(__ENV.K6_VUS || 2),
  duration: __ENV.K6_DURATION || '20s',
  thresholds: reports_read,
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
  const headers = { Authorization: `Bearer ${data.token}` };

  const sales = http.get(`${BASE}/v1/admin/reports/sales`, {
    headers,
    tags: { endpoint: 'reports_sales' },
  });
  check(sales, {
    'sales 200': (r) => r.status === 200,
    // Un 200 con body vacío no pasa el gate (k6-load-scaffolding §Checks vs
    // thresholds): se chequea la FORMA del body, no sólo el status.
    'sales trae range y data[]': (r) =>
      r.status === 200 && typeof r.json('range') === 'object' && Array.isArray(r.json('data')),
  });

  const topProducts = http.get(`${BASE}/v1/admin/reports/top-products`, {
    headers,
    tags: { endpoint: 'reports_top_products' },
  });
  check(topProducts, {
    'top-products 200': (r) => r.status === 200,
    'top-products trae data[]': (r) => r.status === 200 && Array.isArray(r.json('data')),
  });

  const summary = http.get(`${BASE}/v1/admin/reports/summary`, {
    headers,
    tags: { endpoint: 'reports_summary' },
  });
  check(summary, {
    'summary 200': (r) => r.status === 200,
    'summary trae orders_count y breakdown_by_status': (r) =>
      r.status === 200 &&
      typeof r.json('orders_count') === 'number' &&
      typeof r.json('breakdown_by_status') === 'object',
  });
}
