import http from 'k6/http';
import { check } from 'k6';
import { list_products } from './lib/thresholds.js';

// Stress con modelo ABIERTO (ramping-arrival-rate): el RPS lo dicta el executor,
// no el response time — así se halla el "knee" donde el p95 rompe el budget.
const BASE = __ENV.QA_API_BASE_URL || 'http://localhost:3000';
const BOOTSTRAP = __ENV.ADMIN_BOOTSTRAP_TOKEN;
const PAGE = 50;

export const options = {
  scenarios: {
    stress: {
      executor: 'ramping-arrival-rate',
      startRate: 5,
      timeUnit: '1s',
      preAllocatedVUs: 10,
      maxVUs: 100,
      stages: [
        { target: 10, duration: '30s' },
        { target: 30, duration: '1m' },
        { target: 50, duration: '1m' },
        { target: 0, duration: '30s' },
      ],
    },
  },
  thresholds: list_products,
};

export function setup() {
  const res = http.post(
    `${BASE}/v1/admin/auth/login`,
    JSON.stringify({ bootstrapToken: BOOTSTRAP }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  return { token: res.json('token') };
}

export default function (data) {
  const offset = Math.floor(Math.random() * 90) * PAGE;
  const res = http.get(`${BASE}/v1/admin/products?limit=${PAGE}&offset=${offset}`, {
    headers: { Authorization: `Bearer ${data.token}` },
    tags: { endpoint: 'list_products' },
  });
  check(res, { 'status 200': (r) => r.status === 200 });
}
