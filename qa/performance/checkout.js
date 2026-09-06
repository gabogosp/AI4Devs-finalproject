import http from 'k6/http';
import { check, fail } from 'k6';
import { Counter } from 'k6/metrics';
import { checkout } from './lib/thresholds.js';

/**
 * QA-008-PERF-1 — carga de **escritura** de `POST /v1/checkout` (US-008 §9,
 * PRD §4: «p95 de escritura (carrito/orden) < 500 ms»).
 *
 * Tres decisiones que hacen que el número signifique algo (mismo criterio que
 * `cart-write.js`, TC-740):
 *
 * 1. **Un invitado NUEVO por iteración**, con su propio carrito de una línea:
 *    el checkout consume el carrito (OQ-QA-008-1 de `qa-plan.md` §11) — no
 *    tiene sentido reusar uno entre iteraciones, y cada checkout exitoso deja
 *    una orden `pending_payment` real e inerte (no descuenta stock, ADR-0008),
 *    así que correr esto repetidamente no agota el catálogo sembrado.
 * 2. **Los `check` verifican el CUERPO**, no sólo el status: un 201 con un
 *    `order_number` ausente sería una escritura que no escribió lo que dice.
 * 3. **Un 429 aborta la corrida** (`rate_limited`, umbral `count<1`). La
 *    corrida se hace contra la instancia QA con `CHECKOUT_RATE_LIMIT_MAX`
 *    elevado (`qa/scripts/api-up.sh`); si aparece un 429 el resultado no
 *    mide el checkout sino el rate-limit y no se publica.
 *
 * El presupuesto vive en `lib/thresholds.js` (fuente única).
 *
 * Uso:
 *   pnpm --filter @dsm/qa api:up            # en otra terminal
 *   QA_API_BASE_URL=http://localhost:3009 \
 *   k6 run --vus 3 --duration 15s qa/performance/checkout.js
 */
const BASE = __ENV.QA_API_BASE_URL || 'http://localhost:3000';
/** Mismo criterio que `cart-write.js`: el `CartCsrfGuard` valida `Origin`. */
const ORIGIN = __ENV.QA_WEB_BASE_URL || 'http://localhost:3200';
/** Mínimo de productos distintos para no medir siempre la misma fila. */
const MIN_PRODUCTOS = Number(__ENV.QA_CHECKOUT_MIN_PRODUCTOS || 3);

const rateLimited = new Counter('rate_limited');

export const options = {
  vus: Number(__ENV.K6_VUS || 3),
  duration: __ENV.K6_DURATION || '15s',
  thresholds: checkout,
};

/** Nombre=valor de las cookies de una respuesta, sin depender del jar de k6. */
function leerCookies(res, previas) {
  const cookies = Object.assign({}, previas);
  const jar = res.cookies || {};
  for (const nombre of Object.keys(jar)) {
    const entrada = jar[nombre];
    if (Array.isArray(entrada) && entrada.length > 0) {
      cookies[nombre] = entrada[0].value;
    }
  }
  return cookies;
}

function cabeceras(cookies, extra) {
  const headers = Object.assign({ 'Content-Type': 'application/json', Origin: ORIGIN }, extra || {});
  const pares = Object.keys(cookies).map((n) => `${n}=${cookies[n]}`);
  if (pares.length > 0) headers.Cookie = pares.join('; ');
  if (cookies.dsm_cart_csrf) headers['X-CSRF-Token'] = cookies.dsm_cart_csrf;
  return headers;
}

/** Igual que `cart-write.js`: descubre productos publicados con stock, en vez de generarlos. */
export function setup() {
  const categorias = http.get(`${BASE}/v1/categories`, { tags: { endpoint: 'setup' } });
  if (categorias.status !== 200) {
    fail(`setup: GET /v1/categories devolvió ${categorias.status}. ¿Está la API en ${BASE}?`);
  }

  const slugs = [];
  for (const categoria of categorias.json('data') || []) {
    const listado = http.get(`${BASE}/v1/categories/${categoria.slug}/products?limit=50`, {
      tags: { endpoint: 'setup' },
    });
    if (listado.status !== 200) continue;
    for (const item of listado.json('data') || []) {
      if (item.in_stock === true) slugs.push(item.slug);
    }
    if (slugs.length >= 50) break;
  }

  if (slugs.length < MIN_PRODUCTOS) {
    fail(
      `setup: sólo ${slugs.length} producto(s) publicado(s) con stock; hacen falta ${MIN_PRODUCTOS}. ` +
        'Sembrá el catálogo antes de medir (pnpm --filter @dsm/qa seed:carrito o el seed de demo).',
    );
  }

  return { slugs };
}

export default function (data) {
  const slug = data.slugs[(__VU * 100000 + __ITER) % data.slugs.length];
  let cookies = {};

  // 1. Arma el carrito de una línea (no medido: el presupuesto es del checkout).
  const alta = http.put(
    `${BASE}/v1/cart/items/${slug}`,
    JSON.stringify({ quantity: 1 }),
    { headers: cabeceras(cookies), tags: { endpoint: 'checkout_setup' } },
  );
  cookies = leerCookies(alta, cookies);
  if (alta.status !== 200) {
    // Sin carrito no hay nada que medir en esta iteración: se salta, no se
    // infla el p95 del checkout con el fallo de un paso previo.
    return;
  }

  // 2. La escritura medida: POST /v1/checkout con datos de comprador sintéticos.
  const id = `${__VU}-${__ITER}-${Date.now()}`;
  const body = JSON.stringify({
    buyer: {
      name: `Comprador K6 ${id}`,
      email: `comprador-k6-${id}@qa.dsm.local`,
      phone: '+54 9 11 5555 5555',
    },
    consent: true,
    fulfillment: 'pickup',
  });
  const checkoutRes = http.post(`${BASE}/v1/checkout`, body, {
    headers: cabeceras(cookies),
    tags: { endpoint: 'checkout' },
  });
  if (checkoutRes.status === 429) rateLimited.add(1);

  check(checkoutRes, {
    'checkout: 201': (r) => r.status === 201,
    'checkout: trae order_number >= 1000': (r) => {
      if (r.status !== 201) return false;
      const b = r.json();
      return Number.isInteger(b.order_number) && b.order_number >= 1000;
    },
    'checkout: trae order_token hex de 64': (r) => {
      if (r.status !== 201) return false;
      return /^[0-9a-f]{64}$/.test(r.json('order_token'));
    },
  });
}
