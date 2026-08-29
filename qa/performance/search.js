import http from 'k6/http';
import { check } from 'k6';
import { search } from './lib/thresholds.js';

// QA-004-PERF-1: p95 de GET /v1/search < 1,5 s (PRD §4 / E2E §17). Consultas
// variadas para no medir sólo el hit de caché de un único vector (§9 — cache de
// consultas frecuentes en Redis): un smoke real recorre varias.
const BASE = __ENV.QA_API_BASE_URL || 'http://localhost:3000';

const QUERIES = [
  'taco fischer',
  'algo para colgar un cuadro en pared dura',
  'manguera para gas',
  'llave allen',
  'xyzzy foobar sin sentido',
];

export const options = {
  vus: Number(__ENV.K6_VUS || 5),
  duration: __ENV.K6_DURATION || '30s',
  thresholds: search,
};

export default function () {
  const q = QUERIES[__ITER % QUERIES.length];
  const res = http.get(`${BASE}/v1/search?q=${encodeURIComponent(q)}`, {
    tags: { endpoint: 'search' },
  });
  check(res, {
    'status 200': (r) => r.status === 200,
    'trae confidence': (r) => ['high', 'low', 'none'].includes(r.json('confidence')),
  });
}
