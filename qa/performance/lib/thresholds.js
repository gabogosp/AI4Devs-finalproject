// Fuente única de budgets de carga, atados al NFR de US-001 (§9) + E2E §17:
// "listado paginado sin degradación con ≥5.000 SKUs" (lectura p95 < 300ms).
// [propuesto — confirma Arquitecto post-load-test en entorno prod-shaped, OQ-QA-2]
export const list_products = {
  'http_req_duration{endpoint:list_products}': ['p(95)<300', 'p(99)<800'],
  http_req_failed: ['rate<0.01'],
  checks: ['rate>0.99'],
};

export const MIN_SKUS = 5000;

export default { list_products, MIN_SKUS };
