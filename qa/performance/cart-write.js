import http from 'k6/http';
import { check, fail } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { cart_write } from './lib/thresholds.js';

/**
 * TC-740 — carga de **escritura** del carrito (US-007 §9, PRD §4).
 *
 * Mide `PUT /v1/cart/items/{slug}` y `DELETE /v1/cart/items/{slug}`, que son las
 * dos escrituras públicas que introduce US-007. Tres decisiones que hacen que el
 * número signifique algo:
 *
 * 1. **Un invitado NUEVO por iteración.** Las cookies se manejan a mano y se
 *    descartan al terminar la iteración, así cada una crea su propio carrito. Si
 *    se reusara uno, se mediría el `UPDATE` de una fila caliente y su índice en
 *    caché; el patrón real de una ferretería son muchos invitados con pocas líneas.
 * 2. **Los `check` verifican el CUERPO, no sólo el status.** Un 200 con un carrito
 *    vacío sería una escritura que no escribió: se asserta que la línea vuelve con
 *    su slug y su cantidad.
 * 3. **Un 429 aborta la corrida** (`rate_limited`, umbral `count<1`). Con
 *    `CART_WRITE_RATE_LIMIT_MAX = 30` por minuto y por IP el throttler entra antes
 *    que el carrito, y el p95 resultante sería el del rate-limit (OQ-QA-2). La
 *    corrida se hace contra una instancia con el presupuesto elevado; si aparece un
 *    429, el resultado no se publica: se corrige el entorno.
 *
 * El presupuesto vive en `lib/thresholds.js` (fuente única) y sale del PRD §4.
 * `GET /v1/cart` se mide con su tag y **sin umbral** a propósito — ver la nota de
 * `cart_read` en `thresholds.js` (OQ-QA-1).
 *
 * Uso:
 *   QA_API_BASE_URL=http://localhost:3001 \
 *   QA_CART_ORIGIN=http://localhost:3100 \
 *   k6 run --vus 2 --duration 20s qa/performance/cart-write.js
 */
const BASE = __ENV.QA_API_BASE_URL || 'http://localhost:3000';
/** El `CartCsrfGuard` valida `Origin` contra la allowlist, no sólo el double-submit. */
const ORIGIN = __ENV.QA_CART_ORIGIN || 'http://localhost:3100';
/** Mínimo de productos distintos para no medir siempre la misma fila. */
const MIN_PRODUCTOS = Number(__ENV.QA_CART_MIN_PRODUCTOS || 3);

const rateLimited = new Counter('rate_limited');
/**
 * Latencia de `GET /v1/cart` como métrica propia y **sin umbral** (OQ-QA-1).
 *
 * El tag `endpoint:cart_read` por sí solo no aparece en el resumen —k6 sólo
 * desglosa los sub-metrics que tienen threshold—, y un número que no se imprime no
 * sirve para que el Arquitecto lo ratifique. Con la `Trend` el dato queda a la
 * vista en cada corrida sin fingir que es un gate.
 */
const cartRead = new Trend('cart_read_duration', true);

export const options = {
  vus: Number(__ENV.K6_VUS || 2),
  duration: __ENV.K6_DURATION || '20s',
  thresholds: cart_write,
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

function cabeceras(cookies) {
  const headers = {
    'Content-Type': 'application/json',
    Origin: ORIGIN,
  };
  const pares = Object.keys(cookies).map((n) => `${n}=${cookies[n]}`);
  if (pares.length > 0) headers.Cookie = pares.join('; ');
  // El double-submit: el frontend lee `dsm_cart_csrf` (sin HttpOnly) y lo reenvía
  // como header. Se replica igual, no se saltea.
  if (cookies.dsm_cart_csrf) headers['X-CSRF-Token'] = cookies.dsm_cart_csrf;
  return headers;
}

/**
 * Descubre productos publicados **con stock** desde la superficie pública.
 *
 * Se descubren en vez de generarse: el dataset de carga de US-001 no sirve acá
 * —un producto sin stock devuelve 409 y mediría el camino de rechazo— y un slug
 * inventado daría 404. Si el catálogo no tiene suficientes, la corrida **falla con
 * un mensaje que dice qué sembrar**, en vez de reportar un p95 de 404s.
 */
export function setup() {
  const categorias = http.get(`${BASE}/v1/categories`, {
    tags: { endpoint: 'setup' },
  });
  if (categorias.status !== 200) {
    fail(
      `setup: GET /v1/categories devolvió ${categorias.status}. ¿Está la API en ${BASE}?`,
    );
  }

  const slugs = [];
  for (const categoria of categorias.json('data') || []) {
    const listado = http.get(
      `${BASE}/v1/categories/${categoria.slug}/products?limit=50`,
      { tags: { endpoint: 'setup' } },
    );
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
  // Invitado nuevo: arranca sin cookies y las descarta al terminar la iteración.
  let cookies = {};
  const slug = data.slugs[(__VU * 1000 + __ITER) % data.slugs.length];

  // 1. Primera escritura: crea el carrito y emite las cookies. Sin `dsm_cart` no
  //    hay double-submit posible y el guard lo acepta (no hay nada que secuestrar).
  const alta = http.put(
    `${BASE}/v1/cart/items/${slug}`,
    JSON.stringify({ quantity: 1 }),
    { headers: cabeceras(cookies), tags: { endpoint: 'cart_write' } },
  );
  if (alta.status === 429) rateLimited.add(1);
  cookies = leerCookies(alta, cookies);

  check(alta, {
    'alta: 200': (r) => r.status === 200,
    'alta: la línea vuelve en el carrito': (r) => {
      if (r.status !== 200) return false;
      const items = r.json('cart.items') || [];
      return items.some((i) => i.slug === slug && i.quantity === 1);
    },
    'alta: emite la cookie de identidad del carrito': () =>
      typeof cookies.dsm_cart === 'string' && cookies.dsm_cart.length > 0,
  });

  // 2. Segunda escritura sobre el MISMO carrito: es el `UPDATE` de la línea, el
  //    caso que más veces ocurre en la vida real (el stepper del carrito).
  const edicion = http.put(
    `${BASE}/v1/cart/items/${slug}`,
    JSON.stringify({ quantity: 2 }),
    { headers: cabeceras(cookies), tags: { endpoint: 'cart_write' } },
  );
  if (edicion.status === 429) rateLimited.add(1);
  cookies = leerCookies(edicion, cookies);

  check(edicion, {
    'edición: 200': (r) => r.status === 200,
    'edición: la cantidad quedó en 2': (r) => {
      if (r.status !== 200) return false;
      const items = r.json('cart.items') || [];
      return items.some((i) => i.slug === slug && i.quantity === 2);
    },
  });

  // 3. Lectura: se mide con su tag y SIN umbral (OQ-QA-1). Está acá para que el
  //    número exista cuando el Arquitecto tenga que ratificarlo.
  const lectura = http.get(`${BASE}/v1/cart`, {
    headers: cabeceras(cookies),
    tags: { endpoint: 'cart_read' },
  });
  if (lectura.status === 429) rateLimited.add(1);
  cartRead.add(lectura.timings.duration);
  check(lectura, {
    'lectura: 200': (r) => r.status === 200,
    'lectura: devuelve el carrito con la línea': (r) => {
      if (r.status !== 200) return false;
      const items = r.json('cart.items') || [];
      return items.some((i) => i.slug === slug);
    },
  });

  // 4. Baja: cierra el ciclo de escritura del carrito.
  const baja = http.del(`${BASE}/v1/cart/items/${slug}`, null, {
    headers: cabeceras(cookies),
    tags: { endpoint: 'cart_write' },
  });
  if (baja.status === 429) rateLimited.add(1);

  check(baja, {
    'baja: 200': (r) => r.status === 200,
    'baja: la línea ya no está': (r) => {
      if (r.status !== 200) return false;
      const items = r.json('cart.items') || [];
      return !items.some((i) => i.slug === slug);
    },
  });
}
