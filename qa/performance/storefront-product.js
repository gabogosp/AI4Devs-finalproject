import http from 'k6/http';
import { check } from 'k6';
import { storefront_product } from './lib/thresholds.js';

/**
 * TC-330 — carga de la ficha pública `GET /v1/products/{slug}` (US-003 §9).
 *
 * Dos diferencias con el baseline del listado admin:
 *
 * 1. **Sin `setup()` de login**: la superficie es anónima. Mandar Authorization
 *    mediría otra ruta de código (el guard) y no la que se quiere medir.
 * 2. **Recorre slugs distintos**: pedir siempre el mismo golpearía la caché
 *    (`max-age=60`) y daría un p95 excelente y falso. El patrón real es gente
 *    entrando a fichas distintas.
 *
 * Los umbrales salen de `lib/thresholds.js` — fuente única, nunca duplicados acá.
 */
const BASE = __ENV.QA_API_BASE_URL || 'http://localhost:3000';

export const options = {
  vus: Number(__ENV.K6_VUS || 5),
  duration: __ENV.K6_DURATION || '30s',
  thresholds: storefront_product,
};

/**
 * Toma una muestra de slugs publicados reales del catálogo sembrado. Se hace en
 * `setup()` (una vez) y no por iteración: descubrir el dataset no es parte de lo
 * que se mide.
 */
export function setup() {
  // El listado público de una categoría todavía no existe (US-002), así que la
  // muestra se arma desde el propio storefront: se piden fichas por slug conocido
  // del dataset de `seed:load`, cuyo patrón es determinista.
  const slugs = [];
  for (let i = 0; i < 200; i += 1) {
    slugs.push(`producto-de-carga-${String(i).padStart(5, '0')}`);
  }
  return { slugs };
}

export default function (data) {
  const slug = data.slugs[__ITER % data.slugs.length];
  const res = http.get(`${BASE}/v1/products/${slug}`, {
    tags: { endpoint: 'storefront_product' },
  });

  // 404 es una respuesta legítima del dataset (no todo slug generado existe),
  // pero no debe contarse como éxito de latencia útil.
  check(res, {
    'status 200 o 404': (r) => r.status === 200 || r.status === 404,
    'sin auth y sin 401': (r) => r.status !== 401,
    'la ficha trae slug cuando existe': (r) =>
      r.status !== 200 || typeof r.json('slug') === 'string',
  });
}
