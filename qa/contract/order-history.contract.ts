/**
 * QA-015-CT-1 — contrato de `GET /v1/me/orders` y
 * `GET /v1/me/orders/{order_number}` (US-015) contra el OpenAPI PUBLICADO
 * (`apps/api/docs/api/openapi.yaml`, componentes `OrderHistoryListResponse` /
 * `OrderHistoryDetail`, ambos con `additionalProperties: false`) — `design.md`
 * §D-QA1: NO es el contrato "vivo" de `openspec/specs/` todavía (el backend de
 * US-015 está mergeado pero no archivado). Cuando se archive, este script se
 * re-apunta a `openspec/specs/historial-compras/contracts/openapi.yaml`
 * (cambio de una sola constante `CONTRACT_PATH`, ver abajo).
 *
 * Mismo patrón que `pago-manual.contract.ts`/`retencion-ordenes.contract.ts`:
 * script `tsx` standalone (no jest/`--testPathPattern`), contra un servidor
 * REAL. **Diferencia deliberada**: los dos endpoints de esta US se autorizan
 * por SESIÓN DE CLIENTE (cookie `dsm_access`, no Bearer admin) — se usa
 * Playwright `APIRequestContext` (mismo mecanismo que
 * `qa/support/customer-auth.ts`/`cart-client.ts`) en vez de `fetch` crudo,
 * porque necesita manejo de cookie jar automático, no manual.
 */
import { request } from '@playwright/test';
import { compraLogueada, sembrarProductoPublicado } from '../support/seed-order-history';

const baseUrl = process.env.QA_API_BASE_URL ?? 'http://localhost:3000';

interface Falla {
  caso: string;
  detalle: string;
}
const fallas: Falla[] = [];
function assert(caso: string, cond: boolean, detalle: string): void {
  if (!cond) fallas.push({ caso, detalle });
}
function keysOf(o: unknown): string[] {
  return o && typeof o === 'object' ? Object.keys(o as object) : [];
}

const SUMMARY_KEYS = ['order_number', 'status', 'total_ars_cents', 'created_at'];
const LIST_RESPONSE_KEYS = ['data', 'pagination'];
const DETAIL_KEYS = [...SUMMARY_KEYS, 'fulfillment', 'items'];
const ITEM_KEYS = ['product_name', 'product_sku', 'quantity', 'unit_price_ars_cents', 'subtotal_ars_cents'];
const STATUS_ENUM = ['new', 'preparing', 'ready', 'delivered', 'cancelled'];

function validarSummary(caso: string, fila: unknown): void {
  const keys = keysOf(fila);
  for (const k of SUMMARY_KEYS) assert(caso, keys.includes(k), `falta el campo requerido "${k}"`);
  for (const k of keys) {
    assert(
      caso,
      SUMMARY_KEYS.includes(k),
      `campo no declarado en OrderHistorySummary (additionalProperties: false): "${k}"`,
    );
  }
  const f = fila as Record<string, unknown>;
  assert(caso, Number.isInteger(f.order_number), '"order_number" debe ser integer');
  assert(caso, STATUS_ENUM.includes(f.status as string), `"status" fuera del enum: ${JSON.stringify(f.status)}`);
  assert(caso, Number.isInteger(f.total_ars_cents), '"total_ars_cents" debe ser integer');
  assert(
    caso,
    typeof f.created_at === 'string' && !Number.isNaN(Date.parse(f.created_at)),
    '"created_at" no es date-time ISO 8601 válido',
  );
  // Nunca expone el UUID interno ni datos de contacto del comprador (US-015 §Approach).
  assert(caso, !('id' in f), 'OrderHistorySummary NO debería incluir el UUID interno "id"');
  assert(caso, !('buyer_email' in f), 'OrderHistorySummary NO debería incluir "buyer_email"');
}

function validarListResponse(caso: string, body: unknown): void {
  const keys = keysOf(body);
  for (const k of LIST_RESPONSE_KEYS) assert(caso, keys.includes(k), `falta el campo requerido "${k}"`);
  for (const k of keys) {
    assert(caso, LIST_RESPONSE_KEYS.includes(k), `campo no declarado en OrderHistoryListResponse: "${k}"`);
  }
  const b = body as { data: unknown[]; pagination: Record<string, unknown> };
  assert(caso, Array.isArray(b.data), '"data" debe ser un array');
  for (const fila of b.data) validarSummary(caso, fila);
  const pagKeys = keysOf(b.pagination);
  for (const k of ['limit', 'offset', 'total']) {
    assert(caso, pagKeys.includes(k), `falta "${k}" en pagination`);
  }
}

function validarDetail(caso: string, body: unknown): void {
  const keys = keysOf(body);
  for (const k of DETAIL_KEYS) assert(caso, keys.includes(k), `falta el campo requerido "${k}"`);
  for (const k of keys) {
    assert(
      caso,
      DETAIL_KEYS.includes(k),
      `campo no declarado en OrderHistoryDetail (additionalProperties: false): "${k}"`,
    );
  }
  const b = body as Record<string, unknown>;
  // Sólo los campos de OrderHistorySummary, en un objeto nuevo — reusar
  // `validarSummary` sobre un spread de `b` dejaría claves con valor
  // `undefined` (`items`/`fulfillment`) que `Object.keys()` SÍ reporta,
  // haciendo fallar el chequeo de "campo no declarado" por error propio del
  // contract test, no del contrato real.
  const resumen: Record<string, unknown> = {};
  for (const k of SUMMARY_KEYS) resumen[k] = b[k];
  validarSummary(caso, resumen);
  assert(caso, b.fulfillment === 'pickup', `"fulfillment" esperado "pickup", llegó ${JSON.stringify(b.fulfillment)}`);
  assert(caso, Array.isArray(b.items), '"items" debe ser un array');
  for (const item of b.items as unknown[]) {
    const ik = keysOf(item);
    for (const k of ITEM_KEYS) assert(caso, ik.includes(k), `falta "${k}" en OrderHistoryItem`);
    for (const k of ik) assert(caso, ITEM_KEYS.includes(k), `OrderHistoryItem con campo no declarado: "${k}"`);
  }
}

function validarProblem(caso: string, body: unknown, tipoEsperado?: string): void {
  const keys = keysOf(body);
  for (const k of ['type', 'title', 'status', 'detail', 'instance']) {
    assert(caso, keys.includes(k), `Problem (RFC 7807) sin "${k}"`);
  }
  if (tipoEsperado) {
    const b = body as Record<string, unknown>;
    assert(caso, b.type === tipoEsperado, `"type" esperado "${tipoEsperado}", llegó "${b.type}"`);
  }
}

/**
 * Instancia efímera con el presupuesto de `orders_history` BAJO (mismo
 * criterio que `retencion-ordenes.contract.ts` §Caso 10-11): el throttler es
 * por IP (`OrdersHistoryThrottlerGuard` no sobreescribe `getTracker`, así que
 * hereda el default de `ThrottlerGuard`) y corre ANTES del `CustomerGuard` en
 * el array de guards del controller — agotar el presupuesto no necesita una
 * sesión válida, sólo dos requests seguidas desde la misma IP.
 */
async function levantarInstanciaRateLimitBajo(): Promise<{
  baseUrl: string;
  proceso: import('node:child_process').ChildProcess;
}> {
  const { spawn } = await import('node:child_process');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const REPO_ROOT = path.resolve(__dirname, '../..');
  const puerto = Number(process.env.QA_ORDERS_HISTORY_LOWLIMIT_PORT ?? 3012);
  const main = path.join(REPO_ROOT, 'apps/api/dist/apps/api/src/main.js');
  const proceso = spawn(process.execPath, [main], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: String(puerto),
      AUTH_COOKIE_SECURE: 'false',
      TRUST_PROXY_HOPS: '1',
      LOG_LEVEL: 'warn',
      ORDERS_HISTORY_RATE_LIMIT_MAX: '1',
      ORDERS_HISTORY_RATE_LIMIT_TTL_MS: '60000',
    },
    stdio: 'ignore',
  });
  const baseBajo = `http://localhost:${puerto}`;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseBajo}/health`);
      if (res.ok) return { baseUrl: baseBajo, proceso };
    } catch {
      // todavía no levantó
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  proceso.kill();
  throw new Error(
    `[qa/order-history.contract] la instancia de rate-limit bajo no respondió /health en ${baseBajo} tras 20s`,
  );
}

async function main(): Promise<void> {
  // Siembra real: producto publicado + compra logueada confirmada (checkout
  // real + simulate-payment, nunca INSERT directo).
  const slug = await sembrarProductoPublicado();
  const compra = await compraLogueada(slug, '-ct1');
  const ctx = compra.sesion.ctx; // APIRequestContext con la cookie de sesión ya puesta
  const anon = await request.newContext({ baseURL: baseUrl });

  // Caso 1 — GET /v1/me/orders (con sesión) → 200, OrderHistoryListResponse.
  {
    const res = await ctx.get('/v1/me/orders');
    assert('GET /v1/me/orders → 200', res.status() === 200, `status ${res.status()}`);
    if (res.status() === 200) validarListResponse('GET /v1/me/orders → 200', await res.json());
  }

  // Caso 2 — 401 sin sesión.
  {
    const res = await anon.get('/v1/me/orders');
    assert('401 sin sesión (listado)', res.status() === 401, `status ${res.status()}`);
    if (res.status() === 401) validarProblem('401 sin sesión (listado)', await res.json());
  }

  // Caso 3 — 422 offset negativo.
  {
    const res = await ctx.get('/v1/me/orders?offset=-1');
    assert('422 offset=-1 (listado)', res.status() === 422, `status ${res.status()}`);
    if (res.status() === 422) validarProblem('422 offset=-1 (listado)', await res.json());
  }

  // Caso 4 — 422 limit fuera de rango (>100).
  {
    const res = await ctx.get('/v1/me/orders?limit=101');
    assert('422 limit=101 (listado)', res.status() === 422, `status ${res.status()}`);
    if (res.status() === 422) validarProblem('422 limit=101 (listado)', await res.json());
  }

  // Caso 5 — GET /v1/me/orders/{order_number} (propia) → 200, OrderHistoryDetail.
  {
    const res = await ctx.get(`/v1/me/orders/${compra.orderNumber}`);
    assert('GET /v1/me/orders/:n → 200', res.status() === 200, `status ${res.status()}`);
    if (res.status() === 200) validarDetail('GET /v1/me/orders/:n → 200', await res.json());
  }

  // Caso 6 — 401 sin sesión (detalle).
  {
    const res = await anon.get(`/v1/me/orders/${compra.orderNumber}`);
    assert('401 sin sesión (detalle)', res.status() === 401, `status ${res.status()}`);
    if (res.status() === 401) validarProblem('401 sin sesión (detalle)', await res.json());
  }

  // Caso 7 — 404 orden inexistente, mismo `type` que ajena/fuera-de-retención (IDOR).
  {
    const res = await ctx.get('/v1/me/orders/999999');
    assert('404 orden inexistente (detalle)', res.status() === 404, `status ${res.status()}`);
    if (res.status() === 404) {
      validarProblem('404 orden inexistente (detalle)', await res.json(), 'dsm:checkout/order-not-found');
    }
  }

  // Caso 8 y 9 — 429 en listado y detalle, contra la instancia efímera de rate-limit bajo.
  {
    const { baseUrl: baseBajo, proceso } = await levantarInstanciaRateLimitBajo();
    try {
      const anonBajo = await request.newContext({ baseURL: baseBajo });

      // listado: límite = 1/min por IP, corre ANTES del CustomerGuard. La 1ª
      // consume el presupuesto (401 porque no hay sesión — no importa, el
      // throttle cuenta la request igual, antes del guard de auth); la 2ª
      // debe ser 429.
      await anonBajo.get('/v1/me/orders');
      const segundoListado = await anonBajo.get('/v1/me/orders');
      assert('429 listado', segundoListado.status() === 429, `status ${segundoListado.status()}`);
      if (segundoListado.status() === 429) {
        const headers = segundoListado.headers();
        assert('429 listado trae Retry-After', 'retry-after' in headers, 'falta el header Retry-After');
        assert(
          '429 listado trae RateLimit-Limit',
          'ratelimit-limit' in headers,
          'falta el header RateLimit-Limit',
        );
        validarProblem('429 listado', await segundoListado.json());
      }

      // detalle: NestJS calcula la clave del cubo por handler (no sólo por
      // throttler nombrado), así que el `GET /:order_number` tiene su PROPIO
      // cubo pese a compartir el nombre `orders_history` y el límite con el
      // listado (verificado corriendo este script: la 3ª llamada de la
      // sección anterior seguía en 401, no 429). Se agota este cubo aparte,
      // con sus propias dos llamadas.
      await anonBajo.get('/v1/me/orders/999999');
      const detalleBajo = await anonBajo.get('/v1/me/orders/999999');
      assert('429 detalle', detalleBajo.status() === 429, `status ${detalleBajo.status()}`);
      if (detalleBajo.status() === 429) {
        const headers = detalleBajo.headers();
        assert('429 detalle trae Retry-After', 'retry-after' in headers, 'falta el header Retry-After');
        validarProblem('429 detalle', await detalleBajo.json());
      }

      await anonBajo.dispose();
    } finally {
      proceso.kill();
    }
  }

  await ctx.dispose();
  await anon.dispose();

  if (fallas.length > 0) {
    console.error(`✗ ${fallas.length} incumplimiento(s) de contrato contra ${baseUrl}:`);
    for (const f of fallas) console.error(`  [${f.caso}] ${f.detalle}`);
    process.exit(1);
  }
  console.log(`✓ order-history (listado + detalle) conforma el contrato — 9/9 casos, ${baseUrl}`);
}

void main();
