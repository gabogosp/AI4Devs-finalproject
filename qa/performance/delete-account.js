import http from 'k6/http';
import { check, fail } from 'k6';
import exec from 'k6/execution';
import { delete_account } from './lib/thresholds.js';

/**
 * QA-020-PERF-1 (`qa-plan.md` §8) — carga de `DELETE /v1/me` sobre cuentas
 * reales con hasta 50 órdenes `delivered` cada una. El único NFR numérico y
 * cuantificado de toda la US ("p95 < 500 ms para una cuenta con hasta 50
 * órdenes", `design.md` §9, `[propuesto — confirma Arquitecto]`) — a
 * diferencia de otros precedentes de este repo que declararon "no k6"
 * (US-011/US-021), acá SÍ se justifica.
 *
 * Decisiones heredadas SIN repetir la investigación (mismo criterio que
 * `cancel-order-write.js` de US-013-...-qa, citado explícitamente por el plan):
 *
 * 1. **Una cuenta REAL, distinta, por iteración — nunca reusada.** Borrar es
 *    de un solo uso (AC-15 lo hace idempotente, pero una segunda vez no mide
 *    el camino feliz que el NFR describe). Por eso el executor es
 *    `shared-iterations` con un total FIJO (`POOL`), no `constant-vus`: con un
 *    recurso de un solo uso hace falta saber de antemano cuántas cuentas
 *    sembrar — igual que `cancel-order-write.js` resolvió el mismo problema
 *    para `POST .../cancel` (el propio qa-plan.md §8 cita ese script como el
 *    criterio a seguir, aunque el texto también menciona "constant-vus"; con
 *    un recurso de un solo uso, `constant-vus` sobre una duración abierta
 *    agotaría el pool antes de terminar — se prioriza el criterio explícito
 *    "cada iteración consume una cuenta pre-sembrada distinta, nunca
 *    reusada").
 * 2. **El costo de sembrar 50 órdenes por cuenta se paga UNA VEZ en
 *    `setup()`**, nunca dentro de la iteración medida.
 * 3. **`checks` valida el status Y que la sesión quede efectivamente
 *    cerrada** (un `GET /v1/auth/me` inmediato posterior con la misma cookie
 *    responde "no identificado") — cerrar la sesión es parte del contrato
 *    observable del NFR, no sólo el código de status.
 * 4. **Resolución de ids por UNA sola `GET /v1/admin/orders` de conjunto**
 *    (nunca por Postgres directo), igual que `idPorOrderNumber` del suite de
 *    aceptación de esta misma US.
 *
 * Uso:
 *   pnpm --filter @dsm/api build && pnpm --filter @dsm/qa api:up   # otra terminal
 *   QA_API_BASE_URL=http://localhost:3009 \
 *   k6 run qa/performance/delete-account.js --summary-trend-stats="p(95)"
 *
 * Env configurables: `K6_DELETE_ACCOUNTS` (cuentas a sembrar, default 5),
 * `K6_ORDERS_PER_ACCOUNT` (default 50, el número que fija el NFR),
 * `DELETE_ACCOUNT_VUS` (default 3), `K6_SETUP_TIMEOUT` (default 900s — sembrar
 * POOL × 50 órdenes reales, cada una con checkout + simulate-payment + 3
 * PATCH de estado, es la parte cara de esta corrida).
 */
const BASE = __ENV.QA_API_BASE_URL || 'http://localhost:3000';
const ORIGIN = __ENV.QA_WEB_BASE_URL || 'http://localhost:3200';
const POOL = Number(__ENV.K6_DELETE_ACCOUNTS || 5);
const ORDERS_PER_ACCOUNT = Number(__ENV.K6_ORDERS_PER_ACCOUNT || 50);
/** Nombre deliberado (no `K6_VUS`, que k6 pisa `options.scenarios` en silencio — QA-010-F2). */
const VUS = Number(__ENV.DELETE_ACCOUNT_VUS || 3);
const ADMIN_BOOTSTRAP = __ENV.ADMIN_BOOTSTRAP_TOKEN;

export const options = {
  scenarios: {
    delete_account_load: {
      executor: 'shared-iterations',
      vus: Math.min(VUS, POOL),
      iterations: POOL,
      maxDuration: __ENV.K6_MAX_DURATION || '120s',
    },
  },
  setupTimeout: __ENV.K6_SETUP_TIMEOUT || '900s',
  thresholds: delete_account,
};

function jsonHeaders(jar, url, cookieName) {
  const headers = { 'Content-Type': 'application/json', Origin: ORIGIN };
  const valor = (jar.cookiesForURL(url)[cookieName] || [])[0];
  if (valor) headers['X-CSRF-Token'] = valor;
  return headers;
}

function loginAdmin() {
  if (!ADMIN_BOOTSTRAP) {
    // Mismo fallback test-only que `qa/support/admin-auth.ts` (JWT minteado
    // con el `JWT_SECRET` compartido) — k6 no puede importar ese módulo TS,
    // así que se replica acá el mínimo indispensable. Nunca aceptable en CI
    // (esa disciplina la aplica la suite Node; acá sólo hace falta un token
    // admin real de la instancia QA levantada para esta corrida).
    fail(
      'setup: falta ADMIN_BOOTSTRAP_TOKEN. Configurá la misma credencial que la API para ' +
        'resolver ids de orden vía /v1/admin/orders (mismo criterio que cancel-order-write.js).',
    );
  }
  const res = http.post(
    `${BASE}/v1/admin/auth/login`,
    JSON.stringify({ bootstrapToken: ADMIN_BOOTSTRAP }),
    { headers: { 'Content-Type': 'application/json' }, tags: { endpoint: 'setup' } },
  );
  if (res.status !== 200) fail(`setup: login admin devolvió ${res.status} — ${res.body}`);
  return res.json('token');
}

function sembrarCatalogo(adminToken) {
  const sufijo = `${Date.now()}`;
  const categoria = http.post(
    `${BASE}/v1/admin/categories`,
    JSON.stringify({ name: `Carga delete-account ${sufijo}` }),
    {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      tags: { endpoint: 'setup' },
    },
  );
  if (categoria.status !== 201) fail(`setup: crear categoría devolvió ${categoria.status} — ${categoria.body}`);

  const producto = http.post(
    `${BASE}/v1/admin/products`,
    JSON.stringify({
      sku: `PERF-DELACC-${sufijo}`,
      name: `Producto carga delete-account ${sufijo}`,
      price_ars_cents: 50000,
      stock: POOL * ORDERS_PER_ACCOUNT + 50,
      category_id: categoria.json('id'),
    }),
    {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      tags: { endpoint: 'setup' },
    },
  );
  if (producto.status !== 201) fail(`setup: crear producto devolvió ${producto.status} — ${producto.body}`);

  const slug = producto.json('slug');
  const publicar = http.patch(
    `${BASE}/v1/admin/products/${producto.json('id')}`,
    JSON.stringify({ status: 'published' }),
    {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      tags: { endpoint: 'setup' },
    },
  );
  if (publicar.status !== 200) fail(`setup: publicar producto devolvió ${publicar.status} — ${publicar.body}`);

  return slug;
}

/** Cuenta real + N órdenes `delivered` reales — el costo caro de este script, pagado en `setup()`. */
/** IP simulada exclusiva del índice — el `@Throttle` de `register` es 5/hora
 * FIJO por IP en el propio decorador (`customer-auth.controller.ts`), no lee
 * `AUTH_RATE_LIMIT_MAX` (mismo hallazgo que documenta `auth-login.js`) — sin
 * esto, la cuenta #6 de `setup()` moriría en 429 sin importar cuánto se eleve
 * la env var. Requiere `TRUST_PROXY_HOPS=1` en la API (`qa/scripts/api-up.sh`). */
function ipDeIndice(i) {
  return `10.88.${(i >> 8) & 255}.${i & 255}`;
}

function sembrarCuentaConOrdenes(adminToken, slug, indice) {
  const jar = new http.CookieJar();
  const email = `qa-us020-perf-${Date.now()}-${indice}@example.test`;
  const ip = ipDeIndice(indice);

  const registro = http.post(
    `${BASE}/v1/auth/register`,
    JSON.stringify({ email, name: `Carga PERF ${indice}`, password: 'Contrasena-Carga-1' }),
    {
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'X-Forwarded-For': ip },
      jar,
      tags: { endpoint: 'setup' },
    },
  );
  if (registro.status !== 201) {
    fail(`setup: registro de la cuenta ${indice} devolvió ${registro.status} — ${registro.body}`);
  }

  const cartUrl = `${BASE}/v1/cart/items/${slug}`;
  const checkoutUrl = `${BASE}/v1/checkout`;
  const orderNumbers = [];

  for (let i = 0; i < ORDERS_PER_ACCOUNT; i++) {
    const alta = http.put(cartUrl, JSON.stringify({ quantity: 1 }), {
      headers: jsonHeaders(jar, cartUrl, 'dsm_cart_csrf'),
      jar,
      tags: { endpoint: 'setup' },
    });
    if (alta.status !== 200) {
      fail(`setup: agregar al carrito (cuenta ${indice}, orden ${i}) devolvió ${alta.status} — ${alta.body}`);
    }

    const checkout = http.post(
      checkoutUrl,
      JSON.stringify({
        buyer: { name: `Comprador Carga ${indice}-${i}`, email, phone: '+54 9 11 5555 5555' },
        consent: true,
        fulfillment: 'pickup',
      }),
      { headers: jsonHeaders(jar, checkoutUrl, 'dsm_cart_csrf'), jar, tags: { endpoint: 'setup' } },
    );
    if (checkout.status !== 201) {
      fail(`setup: checkout (cuenta ${indice}, orden ${i}) devolvió ${checkout.status} — ${checkout.body}`);
    }

    const confirm = http.post(
      `${BASE}/v1/checkout/simulate-payment`,
      JSON.stringify({ order_token: checkout.json('order_token') }),
      { headers: { 'Content-Type': 'application/json' }, tags: { endpoint: 'setup' } },
    );
    if (confirm.status !== 200) {
      fail(`setup: simulate-payment (cuenta ${indice}, orden ${i}) devolvió ${confirm.status} — ${confirm.body}`);
    }
    orderNumbers.push(checkout.json('order_number'));
  }

  // UNA sola llamada de conjunto para resolver los `ORDERS_PER_ACCOUNT` ids —
  // nunca por Postgres directo, mismo criterio que `cancel-order-write.js`.
  // `limit=100` es el tope real de `ListOrdersQueryDto` (`@Max(100)`); alcanza
  // porque `setup()` es de un solo hilo y este `GET` corre INMEDIATAMENTE
  // después de los `ORDERS_PER_ACCOUNT` (≤100) checkouts de ESTA cuenta, con
  // el sort por default (`-created_at`) — son, por construcción, las órdenes
  // más recientes de todo el sistema en ese instante.
  const lista = http.get(`${BASE}/v1/admin/orders?limit=100`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    tags: { endpoint: 'setup' },
  });
  if (lista.status !== 200) fail(`setup: GET /v1/admin/orders devolvió ${lista.status} — ${lista.body}`);
  const porNumero = new Map();
  for (const fila of lista.json('data') || []) {
    porNumero.set(fila.order_number, fila.id);
  }

  for (const numero of orderNumbers) {
    const id = porNumero.get(numero);
    if (!id) fail(`setup: la orden #${numero} (cuenta ${indice}) no aparece en GET /v1/admin/orders`);
    for (const paso of ['preparing', 'ready', 'delivered']) {
      const r = http.patch(
        `${BASE}/v1/admin/orders/${id}`,
        JSON.stringify({ status: paso }),
        {
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
          tags: { endpoint: 'setup' },
        },
      );
      if (r.status !== 200) {
        fail(`setup: PATCH a "${paso}" (cuenta ${indice}, orden #${numero}) devolvió ${r.status} — ${r.body}`);
      }
    }
  }

  // `setup()` devuelve datos que k6 clona vía JSON al distribuirlos a las VUs
  // (`k6-load-scaffolding` — un `http.CookieJar` NO sobrevive esa clonación:
  // pierde sus métodos y queda un objeto plano inútil). Se extraen los
  // VALORES de cookie como strings acá y se arma el header `Cookie` a mano en
  // `default()` — el mismo mecanismo por el que curl/el navegador identifican
  // la sesión, sin depender del jar.
  const cookies = jar.cookiesForURL(`${BASE}/v1/me`);
  const access = (cookies.dsm_access || [])[0];
  const csrf = (cookies.dsm_csrf || [])[0];
  if (!access || !csrf) {
    fail(`setup: la cuenta ${indice} no tiene cookies de sesión (dsm_access/dsm_csrf) tras registrarse`);
  }
  return { access, csrf };
}

export function setup() {
  if (ORDERS_PER_ACCOUNT > 100) {
    fail(
      `setup: K6_ORDERS_PER_ACCOUNT=${ORDERS_PER_ACCOUNT} excede el tope de 100 de ` +
        '`GET /v1/admin/orders` (ListOrdersQueryDto.limit `@Max(100)`) — la resolución de ' +
        'ids de este script asume que 1 página alcanza. El NFR de la US sólo pide hasta 50.',
    );
  }
  const adminToken = loginAdmin();
  const slug = sembrarCatalogo(adminToken);

  const cuentas = [];
  for (let i = 0; i < POOL; i++) {
    cuentas.push(sembrarCuentaConOrdenes(adminToken, slug, i));
  }
  return { cuentas };
}

export default function (data) {
  const i = exec.scenario.iterationInTest;
  if (i >= data.cuentas.length) {
    fail(
      `iteración ${i} sin cuenta disponible: el pool tiene ${data.cuentas.length} ` +
        `(K6_DELETE_ACCOUNTS=${POOL}). Subí K6_DELETE_ACCOUNTS o bajá DELETE_ACCOUNT_VUS.`,
    );
  }
  const { access, csrf } = data.cuentas[i];
  const meUrl = `${BASE}/v1/me`;
  const cookieHeader = `dsm_access=${access}`;

  const res = http.del(meUrl, null, {
    headers: { Cookie: cookieHeader, 'X-CSRF-Token': csrf, Origin: ORIGIN },
    tags: { endpoint: 'delete_account' },
  });

  const sesionCerrada = () => {
    // `responseCallback` marca el 401 esperado como éxito de PROTOCOLO para
    // `http_req_failed` (k6 clasifica >=400 como "failed" por default) — sin
    // esto, esta llamada de verificación (cuyo resultado BUENO es un 401)
    // infla el `http_req_failed` global del script con un rechazo deseado,
    // no un error real.
    const verificar = http.get(`${BASE}/v1/auth/me`, {
      headers: { Cookie: cookieHeader },
      tags: { endpoint: 'setup' },
      responseCallback: http.expectedStatuses(401),
    });
    return verificar.status !== 200;
  };

  check(res, {
    'delete-account: 204': (r) => r.status === 204,
    'delete-account: la sesión queda cerrada': () => sesionCerrada(),
  });
}
