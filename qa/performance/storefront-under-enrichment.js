import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { list_products, storefront_product } from './lib/thresholds.js';

/**
 * QA-005-PERF-1 (qa-plan.md §8, `design.md` §D-QA8) — NFR-3 (E2E §17): la lectura
 * del storefront no se degrada mientras corre una barrida real de enriquecimiento.
 *
 * Requiere una instancia arrancada a mano con el proveedor de IA HABILITADO
 * (k6 no orquesta el spawn de la API):
 *
 *   ENRICHMENT_ENABLED=true qa/scripts/api-up.sh
 *
 * (o cualquier instancia — perfil B de `design.md` §D-QA4 — apuntada por
 * `QA_API_BASE_URL`). `GEMINI_API_KEY` puede seguir siendo el placeholder
 * inválido: el runner cuenta CUALQUIER llamada arrancada, éxito o fallo, y lo
 * que este script mide es la competencia por el event loop/DB (ADR-0014), no el
 * resultado del proveedor.
 *
 * Reusa `list_products`/`storefront_product` de `lib/thresholds.js` — NO se
 * inventa un threshold nuevo para esta condición (`k6-load-scaffolding`).
 */
const BASE = __ENV.QA_API_BASE_URL || 'http://localhost:3000';
const BOOTSTRAP = __ENV.ADMIN_BOOTSTRAP_TOKEN;
const CATEGORY_SLUG_CARGA = 'carga-qa'; // `seed:load` (seed-load-data.ts)
const N_PRODUCTOS_FRESCOS = Number(__ENV.K6_ENRICH_SEED_N || 150);

/**
 * Se incrementa cada vez que un `GET /status` de control observa
 * `runner_state: "running"`. El threshold `count>=1` es lo que hace FALLAR la
 * corrida entera (exit != 0) si la barrida terminó antes de medir nada, en vez
 * de pasar por defecto — mismo criterio que `QA-004-PERF-3`.
 */
const runnerConfirmedRunning = new Counter('runner_confirmed_running');

export const options = {
  vus: Number(__ENV.K6_VUS || 5),
  duration: __ENV.K6_DURATION || '30s',
  thresholds: {
    ...list_products,
    ...storefront_product,
    runner_confirmed_running: ['count>=1'],
  },
};

export function setup() {
  const loginRes = http.post(
    `${BASE}/v1/admin/auth/login`,
    JSON.stringify({ bootstrapToken: BOOTSTRAP }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(loginRes, { 'login real 200': (r) => r.status === 200 });
  const token = loginRes.json('token');
  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  // Siembra ~150 productos frescos (prefijo propio, categoría propia) — nunca
  // el dataset de `seed:load` (ese es sólo el pool de LECTURA del storefront).
  const catRes = http.post(
    `${BASE}/v1/admin/categories`,
    JSON.stringify({ name: `PerfEnrich ${Date.now()}` }),
    { headers: authHeaders },
  );
  check(catRes, { 'categoría creada 201': (r) => r.status === 201 });
  const categoryId = catRes.json('id');

  const ids = [];
  for (let i = 0; i < N_PRODUCTOS_FRESCOS; i += 1) {
    const prodRes = http.post(
      `${BASE}/v1/admin/products`,
      JSON.stringify({
        sku: `PERF-ENRICH-${Date.now()}-${i}`,
        name: `Producto perf enriquecimiento ${i}`,
        price_ars_cents: 100_000,
        stock: 5,
        category_id: categoryId,
        description_raw: 'Bueno.',
      }),
      { headers: authHeaders },
    );
    if (prodRes.status !== 201) continue;
    const id = prodRes.json('id');
    http.patch(
      `${BASE}/v1/admin/products/${id}`,
      JSON.stringify({ status: 'published' }),
      { headers: authHeaders },
    );
    ids.push(id);
  }
  check(ids, { 'sembró al menos 100 productos frescos': (arr) => arr.length >= 100 });

  const runRes = http.post(
    `${BASE}/v1/admin/enrichment/runs`,
    JSON.stringify({ product_ids: ids }),
    { headers: authHeaders },
  );
  check(runRes, {
    'POST /runs aceptado (202)': (r) => r.status === 202,
  });

  // Pool de slugs del storefront — mismo patrón determinista que
  // `qa/performance/storefront-product.js` (dataset de `seed:load`).
  const slugs = [];
  for (let i = 0; i < 200; i += 1) {
    slugs.push(`producto-de-carga-${String(i).padStart(5, '0')}`);
  }

  return { token, slugs };
}

export default function (data) {
  // Alterna listado de categoría (tag `list_products`) y ficha (tag
  // `storefront_product`) — las dos superficies de lectura del storefront
  // genérico bajo la barrida activa, NUNCA `/v1/search` (eso ya es
  // `QA-004-PERF-3`, no se repite acá).
  if (__ITER % 2 === 0) {
    const offset = (__ITER % 90) * 20;
    const res = http.get(
      `${BASE}/v1/categories/${CATEGORY_SLUG_CARGA}/products?limit=20&offset=${offset}`,
      { tags: { endpoint: 'list_products' } },
    );
    check(res, { 'list_products status 200': (r) => r.status === 200 });
  } else {
    const slug = data.slugs[__ITER % data.slugs.length];
    const res = http.get(`${BASE}/v1/products/${slug}`, {
      tags: { endpoint: 'storefront_product' },
    });
    check(res, { 'storefront_product status 200 o 404': (r) => r.status === 200 || r.status === 404 });
  }

  // Control de que la corrida sigue activa — barato, cada ~10 iteraciones por VU.
  if (__ITER % 10 === 0) {
    const statusRes = http.get(`${BASE}/v1/admin/enrichment/status`, {
      headers: { Authorization: `Bearer ${data.token}` },
      tags: { endpoint: 'control_status' },
    });
    if (statusRes.status === 200 && statusRes.json('runner_state') === 'running') {
      runnerConfirmedRunning.add(1);
    }
  }
}
