import http from 'k6/http';
import { check, fail } from 'k6';
import { Counter } from 'k6/metrics';
import { checkout } from './lib/thresholds.js';

/**
 * QA-008-PERF-1 — carga de escritura de `POST /v1/checkout` (US-008 §9, PRD §4).
 *
 * Mismo patrón que `cart-write.js` (TC-740): un carrito NUEVO por iteración (agrega
 * una línea vía `PUT /v1/cart/items/{slug}` para no medir un checkout contra un
 * carrito vacío — eso mediría el camino de rechazo 409, no la escritura real), y un
 * 429 ABORTA la corrida en vez de degradar el número (`rate_limited`, `count<1`):
 * `CHECKOUT_RATE_LIMIT_MAX` por defecto es 10/10min/IP, bajísimo a propósito
 * (checkout.controller.ts) — la corrida se hace contra una instancia con el
 * presupuesto elevado, igual que el resto de la suite QA.
 *
 * Uso:
 *   pnpm --filter @dsm/qa api:up                                  # otra terminal
 *   QA_API_BASE_URL=http://localhost:3009 k6 run --vus 3 --duration 15s qa/performance/checkout.js
 */
const BASE = __ENV.QA_API_BASE_URL || 'http://localhost:3000';
/** Mismas variables y defaults que `qa/support/qa-env.ts` (k6 no puede importar TS). */
const ORIGIN = __ENV.QA_WEB_BASE_URL || 'http://localhost:3200';
const MIN_PRODUCTOS = Number(__ENV.QA_CART_MIN_PRODUCTOS || 3);

const rateLimited = new Counter('rate_limited');

export const options = {
  vus: Number(__ENV.K6_VUS || 3),
  duration: __ENV.K6_DURATION || '15s',
  thresholds: checkout,
};

function leerCookies(res, previas) {
  const cookies = Object.assign({}, previas);
  const jar = res.cookies || {};
  for (const nombre of Object.keys(jar)) {
    const entrada = jar[nombre];
    if (Array.isArray(entrada) && entrada.length > 0) cookies[nombre] = entrada[0].value;
  }
  return cookies;
}

function cabeceras(cookies) {
  const headers = { 'Content-Type': 'application/json', Origin: ORIGIN };
  const pares = Object.keys(cookies).map((n) => `${n}=${cookies[n]}`);
  if (pares.length > 0) headers.Cookie = pares.join('; ');
  if (cookies.dsm_cart_csrf) headers['X-CSRF-Token'] = cookies.dsm_cart_csrf;
  return headers;
}

/** Descubre productos publicados con stock — mismo mecanismo que `cart-write.js`. */
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
        'Sembrá el catálogo antes de medir.',
    );
  }
  return { slugs };
}

export default function (data) {
  let cookies = {};
  const slug = data.slugs[(__VU * 1000 + __ITER) % data.slugs.length];
  const idx = __VU * 100000 + __ITER;

  // 1. Arma un carrito con una línea — sin esto, checkout mediría el 409 de
  //    carrito vacío, no la escritura real.
  const alta = http.put(
    `${BASE}/v1/cart/items/${slug}`,
    JSON.stringify({ quantity: 1 }),
    { headers: cabeceras(cookies), tags: { endpoint: 'setup' } },
  );
  cookies = leerCookies(alta, cookies);
  if (alta.status !== 200) return; // no ensucia el p95 de checkout con un fallo ajeno

  // 2. La escritura medida: POST /v1/checkout con datos válidos.
  const body = JSON.stringify({
    buyer: {
      name: 'Cliente QA Carga',
      email: `checkout-load-${idx}@example.com`,
      phone: '+54 9 11 5555 5555',
    },
    consent: true,
    fulfillment: 'pickup',
  });

  const res = http.post(`${BASE}/v1/checkout`, body, {
    headers: cabeceras(cookies),
    tags: { endpoint: 'checkout' },
  });
  if (res.status === 429) rateLimited.add(1);

  check(res, {
    'checkout: 201': (r) => r.status === 201,
    'checkout: devuelve order_token y order_number': (r) => {
      if (r.status !== 201) return false;
      const b = r.json();
      return typeof b.order_token === 'string' && b.order_number >= 1000;
    },
    'checkout: status pending_payment': (r) => {
      if (r.status !== 201) return false;
      return r.json('status') === 'pending_payment';
    },
  });
}
