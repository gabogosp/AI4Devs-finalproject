import http from 'k6/http';
import { check } from 'k6';
import { list_products } from './lib/thresholds.js';

// Perfil baseline del listado del panel (NFR ≥5.000 SKUs, E2E §17). Modelo
// simple (vus/duration) para que el smoke-load (`--vus 2 --duration 30s`) lo
// sobre-escriba limpio. El stress (modelo abierto) vive en stress.js.
const BASE = __ENV.QA_API_BASE_URL || 'http://localhost:3000';
const BOOTSTRAP = __ENV.ADMIN_BOOTSTRAP_TOKEN;
const PAGE = 50;

export const options = {
  vus: Number(__ENV.K6_VUS || 5),
  duration: __ENV.K6_DURATION || '30s',
  thresholds: list_products,
};

export function setup() {
  const res = http.post(
    `${BASE}/v1/admin/auth/login`,
    JSON.stringify({ bootstrapToken: BOOTSTRAP }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(res, { 'login real 200': (r) => r.status === 200 });
  return { token: res.json('token') };
}

export default function (data) {
  const offset = (__ITER % 90) * PAGE; // recorre páginas del dataset grande
  const res = http.get(`${BASE}/v1/admin/products?limit=${PAGE}&offset=${offset}`, {
    headers: { Authorization: `Bearer ${data.token}` },
    tags: { endpoint: 'list_products' },
  });
  check(res, {
    'status 200': (r) => r.status === 200,
    'total >= 5000': (r) => r.json('pagination.total') >= 5000,
    'data.length <= limit': (r) => r.json('data').length <= PAGE,
  });
}
