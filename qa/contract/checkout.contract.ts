/**
 * QA-008-CT-1 — contrato de `POST /v1/checkout` contra el OpenAPI PUBLICADO
 * (`apps/api/docs/api/openapi.yaml`, componentes `CreateCheckoutRequest` /
 * `CheckoutCreated` / `Problem`, ambos con `additionalProperties: false`).
 *
 * Sigue la MISMA convención real que `pago-manual.contract.ts` (no la del
 * `Verify:` original de `qa-plan.md` §4, que asumía un runner jest-style):
 * script `tsx` standalone contra un servidor REAL, registrado bajo su propio
 * script `test:contract:checkout`.
 *
 * El 201/403/409/422 corren contra la instancia QA compartida
 * (`QA_API_BASE_URL`, límites elevados a propósito por `qa/scripts/api-up.sh`
 * — varias sesiones corren la suite en simultáneo). El 429 **no puede**
 * dispararse ahí sin miles de requests, así que este archivo levanta una
 * segunda instancia efímera de la misma API compilada con
 * `CHECKOUT_RATE_LIMIT_MAX=2` SOLO para ese caso, la apaga al terminar, y no
 * toca la instancia compartida ni sus puertos.
 */
import { ChildProcess, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { adminAuth } from '../support/admin-auth';
import { buildCheckoutBody, nuevaCategoria, nuevoProducto } from '../support/builders';
import { Invitado } from '../support/cart-client';
import { QA_API_BASE_URL, QA_WEB_BASE_URL } from '../support/qa-env';

const baseUrl = QA_API_BASE_URL;
const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret';

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

const CHECKOUT_CREATED_KEYS = ['order_token', 'order_number', 'status', 'total_ars_cents', 'items_count'];

function validarCheckoutCreated(caso: string, body: unknown): void {
  const keys = keysOf(body);
  for (const k of CHECKOUT_CREATED_KEYS) {
    assert(caso, keys.includes(k), `falta el campo requerido "${k}"`);
  }
  for (const k of keys) {
    assert(caso, CHECKOUT_CREATED_KEYS.includes(k), `campo no declarado en el schema: "${k}"`);
  }
  const b = body as Record<string, unknown>;
  assert(caso, typeof b.order_token === 'string' && /^[0-9a-f]{64}$/.test(b.order_token as string), 'order_token no matchea ^[0-9a-f]{64}$');
  assert(caso, Number.isInteger(b.order_number) && (b.order_number as number) >= 1000, 'order_number debe ser integer >= 1000');
  assert(caso, b.status === 'pending_payment', `"status" fuera del enum [pending_payment]: ${JSON.stringify(b.status)}`);
  assert(caso, Number.isInteger(b.total_ars_cents), 'total_ars_cents debe ser integer');
  assert(caso, Number.isInteger(b.items_count), 'items_count debe ser integer');
}

function validarProblem(caso: string, contentType: string | null, body: unknown, tipoEsperado?: string): void {
  assert(caso, !!contentType && contentType.includes('application/problem+json'), `content-type no es application/problem+json: "${contentType}"`);
  const keys = keysOf(body);
  for (const k of ['type', 'title', 'status', 'detail', 'instance']) {
    assert(caso, keys.includes(k), `Problem (RFC 7807) sin "${k}"`);
  }
  const b = body as Record<string, unknown>;
  if (tipoEsperado) {
    assert(caso, b.type === tipoEsperado, `"type" esperado "${tipoEsperado}", llegó "${b.type}"`);
  }
}

/**
 * Igual que `qa/support/api.ts`, pero contra un `base` explícito — el helper
 * compartido apunta siempre a `QA_API_BASE_URL`, y el caso 429 necesita hablar
 * con la instancia EFÍMERA, no con la compartida.
 */
async function adminCall<T>(base: string, path: string, method: string, token: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`${method} ${path} → ${res.status} ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

/** Carrito comprable con UN producto, más el token admin — para armar cada caso. */
async function invitadoConCarrito(base: string, origin: string, token: string): Promise<{ invitado: Invitado; slug: string }> {
  const categoria = await adminCall<{ id: string }>(base, `/v1/admin/categories`, 'POST', token, nuevaCategoria());
  const producto = await adminCall<{ id: string; slug: string }>(base, `/v1/admin/products`, 'POST', token, nuevoProducto(categoria.id, { stock: 5 }));
  await adminCall(base, `/v1/admin/products/${producto.id}`, 'PATCH', token, { status: 'published' });

  const { request } = await import('@playwright/test');
  const ctx = await request.newContext({ baseURL: base, extraHTTPHeaders: { origin } });
  const invitado = new Invitado(ctx);
  const alta = await invitado.fijar(producto.slug, 1);
  if (alta.status !== 200) {
    throw new Error(`[checkout.contract] no se pudo agregar ${producto.slug} al carrito: ${alta.status}`);
  }
  return { invitado, slug: producto.slug };
}

async function main(): Promise<void> {
  const adminToken = await adminAuth();

  // Caso 1 — 201 con CheckoutCreated (additionalProperties: false) + no-store.
  {
    const { invitado } = await invitadoConCarrito(baseUrl, QA_WEB_BASE_URL, adminToken);
    const res = await invitado.checkout(buildCheckoutBody());
    await invitado.cerrar();
    assert('POST /checkout → 201', res.status === 201, `status ${res.status}: ${JSON.stringify(res.body)}`);
    if (res.status === 201) {
      validarCheckoutCreated('POST /checkout → 201', res.body);
      const cc = res.headers['cache-control'] ?? '';
      assert('POST /checkout → 201 no-store', /no-store/.test(cc), `Cache-Control: "${cc}"`);
    }
  }

  // Caso 2 — 403 sin X-CSRF-Token (CartCsrfGuard, application/problem+json).
  {
    const { invitado } = await invitadoConCarrito(baseUrl, QA_WEB_BASE_URL, adminToken);
    const res = await invitado.checkout(buildCheckoutBody(), { conCsrf: false });
    await invitado.cerrar();
    assert('POST /checkout → 403 sin CSRF', res.status === 403, `status ${res.status}`);
    if (res.status === 403) {
      const raw = await fetch(`${baseUrl}/v1/checkout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: QA_WEB_BASE_URL },
        body: JSON.stringify(buildCheckoutBody()),
      });
      validarProblem('POST /checkout → 403 sin CSRF', raw.headers.get('content-type'), await raw.json());
    }
  }

  // Caso 3 — 409 dsm:checkout/cart-empty (invitado sin carrito).
  {
    const { request } = await import('@playwright/test');
    const ctx = await request.newContext({ baseURL: baseUrl, extraHTTPHeaders: { origin: QA_WEB_BASE_URL } });
    const invitado = new Invitado(ctx);
    const res = await invitado.checkout(buildCheckoutBody());
    await invitado.cerrar();
    assert('POST /checkout → 409 cart-empty', res.status === 409, `status ${res.status}`);
    if (res.status === 409) {
      const raw = await fetch(`${baseUrl}/v1/checkout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: QA_WEB_BASE_URL },
        body: JSON.stringify(buildCheckoutBody()),
      });
      validarProblem('POST /checkout → 409 cart-empty', raw.headers.get('content-type'), await raw.json(), 'dsm:checkout/cart-empty');
    }
  }

  // Caso 4 — 422 (ValidationPipe, consent ausente) application/problem+json.
  {
    const { invitado } = await invitadoConCarrito(baseUrl, QA_WEB_BASE_URL, adminToken);
    const body = buildCheckoutBody();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- se descarta a propósito
    const { consent: _consent, ...sinConsent } = body;
    const res = await invitado.checkout(sinConsent as typeof body);
    await invitado.cerrar();
    assert('POST /checkout → 422 sin consent', res.status === 422, `status ${res.status}`);
    if (res.status === 422) {
      assert('POST /checkout → 422 sin consent, content-type', /application\/problem\+json/.test(res.headers['content-type'] ?? ''), `content-type "${res.headers['content-type']}"`);
      const b = res.body as unknown as { errors?: unknown };
      assert('POST /checkout → 422 sin consent, errors[]', Array.isArray(b.errors), 'falta errors[]');
    }
  }

  // Caso 5 — 429 con RateLimit-*/Retry-After, contra una instancia EFÍMERA de
  // límite bajo (la compartida corre con CHECKOUT_RATE_LIMIT_MAX elevado a
  // propósito para no chocar entre sesiones QA concurrentes — no se toca).
  await conInstanciaEfimera(async (efimero) => {
    let ultima: { status: number; headers: Record<string, string> } | undefined;
    for (let i = 0; i < 4; i += 1) {
      const { invitado } = await invitadoConCarrito(efimero.baseUrl, efimero.origin, efimero.adminToken);
      const res = await invitado.checkout(buildCheckoutBody());
      await invitado.cerrar();
      ultima = res;
      if (res.status === 429) break;
    }
    assert('POST /checkout → 429 (instancia efímera)', ultima?.status === 429, `no se alcanzó 429 tras 4 intentos (límite=2): última respuesta ${ultima?.status}`);
    if (ultima?.status === 429) {
      for (const h of ['ratelimit-limit', 'ratelimit-remaining', 'ratelimit-reset', 'retry-after']) {
        assert('POST /checkout → 429 cabeceras', h in ultima.headers, `falta la cabecera ${h}`);
      }
      assert('POST /checkout → 429 Retry-After numérico', Number(ultima.headers['retry-after']) > 0, `Retry-After="${ultima.headers['retry-after']}"`);
      const cc = ultima.headers['cache-control'] ?? '';
      assert('POST /checkout → 429 no-store', /no-store/.test(cc), `Cache-Control: "${cc}"`);
    }
  });

  if (fallas.length > 0) {
    console.error(`✗ ${fallas.length} incumplimiento(s) de contrato contra ${baseUrl}:`);
    for (const f of fallas) console.error(`  [${f.caso}] ${f.detalle}`);
    process.exit(1);
  }
  console.log(`✓ checkout (POST /v1/checkout) conforma el contrato — 5/5 casos, ${baseUrl}`);
}

interface InstanciaEfimera {
  baseUrl: string;
  origin: string;
  adminToken: string;
}

/**
 * Levanta una segunda copia de la API compilada (mismo `dist`, otro puerto,
 * `CHECKOUT_RATE_LIMIT_MAX=2`) sólo para el caso 429, y la apaga siempre —
 * incluso si el caso falla — para no dejar procesos huérfanos.
 */
async function conInstanciaEfimera(fn: (i: InstanciaEfimera) => Promise<void>): Promise<void> {
  const aquí = path.dirname(fileURLToPath(import.meta.url));
  const main = path.resolve(aquí, '../../apps/api/dist/apps/api/src/main.js');
  const puerto = Number(process.env.QA_CT_EPHEMERAL_PORT ?? 4311);
  const origin = 'http://localhost:4322';

  const proc: ChildProcess = spawn('node', [main], {
    env: {
      ...process.env,
      PORT: String(puerto),
      CORS_ALLOWED_ORIGINS: origin,
      AUTH_COOKIE_SECURE: 'false',
      TRUST_PROXY_HOPS: '1',
      AUTH_RATE_LIMIT_MAX: '100000',
      CART_RATE_LIMIT_MAX: '100000',
      CART_WRITE_RATE_LIMIT_MAX: '100000',
      STOREFRONT_RATE_LIMIT_MAX: '100000',
      CHECKOUT_RATE_LIMIT_MAX: '2',
      CHECKOUT_RATE_LIMIT_TTL_MS: '600000',
    },
    stdio: 'ignore',
  });

  try {
    const base = `http://localhost:${puerto}`;
    await esperarSalud(base, 15_000);
    const adminToken = jwt.sign({ role: 'admin', sub: 'qa-contract-checkout-efimero' }, JWT_SECRET, { expiresIn: '5m' });
    await fn({ baseUrl: base, origin, adminToken });
  } finally {
    proc.kill('SIGTERM');
  }
}

async function esperarSalud(base: string, timeoutMs: number): Promise<void> {
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) return;
    } catch {
      // todavía no levantó
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`[checkout.contract] la instancia efímera en ${base} no respondió /health en ${timeoutMs}ms`);
}

void main();
