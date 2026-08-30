/**
 * QA-008-CT-1 — contrato de POST /v1/checkout contra el OpenAPI publicado
 * (apps/api/docs/api/openapi.yaml, componentes CreateCheckoutRequest/CheckoutCreated/Problem).
 *
 * Corre contra un servidor REAL, nunca un mock. `additionalProperties: false` en el
 * spec es la razón por la que este script también rechaza campos extra en la
 * respuesta, no sólo faltantes.
 *
 * El caso 429 corre contra una instancia DEDICADA de rate-limit bajo (mismo patrón
 * que `importar.steps.ts` TC-613): la instancia principal (`QA_API_BASE_URL`) corre
 * con `CHECKOUT_RATE_LIMIT_MAX` elevado para no chocar contra el resto de la suite,
 * así que el 429 real se prueba aparte, en `QA_CHECKOUT_LOWLIMIT_BASE_URL`, para no
 * quemar el cupo de la instancia compartida.
 */
const baseUrl = process.env.QA_API_BASE_URL ?? 'http://localhost:3000';
const origin = process.env.QA_WEB_BASE_URL ?? 'http://localhost:3200';
const lowLimitBaseUrl = process.env.QA_CHECKOUT_LOWLIMIT_BASE_URL;

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
  for (const k of CHECKOUT_CREATED_KEYS) assert(caso, keys.includes(k), `falta el campo requerido "${k}"`);
  for (const k of keys) assert(caso, CHECKOUT_CREATED_KEYS.includes(k), `campo no declarado en el schema: "${k}"`);

  const b = body as Record<string, unknown>;
  assert(caso, typeof b.order_token === 'string' && /^[0-9a-f]{64}$/.test(b.order_token as string), `order_token no matchea ^[0-9a-f]{64}$: ${b.order_token}`);
  assert(caso, Number.isInteger(b.order_number) && (b.order_number as number) >= 1000, `order_number debe ser integer >= 1000: ${b.order_number}`);
  assert(caso, b.status === 'pending_payment', `status debe ser "pending_payment": ${b.status}`);
  assert(caso, Number.isInteger(b.total_ars_cents), 'total_ars_cents debe ser integer');
  assert(caso, Number.isInteger(b.items_count), 'items_count debe ser integer');
}

function validarProblem(caso: string, res: Response, body: unknown): void {
  assert(caso, res.headers.get('content-type')?.includes('application/problem+json') ?? false, `content-type no es application/problem+json: ${res.headers.get('content-type')}`);
  const keys = keysOf(body);
  for (const k of ['type', 'title', 'status', 'detail', 'instance']) {
    assert(caso, keys.includes(k), `Problem (RFC 7807) sin "${k}"`);
  }
}

function cookieDe(res: Response, nombre: string): string | undefined {
  const raw = res.headers.getSetCookie?.() ?? [];
  for (const linea of raw) {
    const [par] = linea.split(';');
    const [n, v] = par.split('=');
    if (n === nombre) return v;
  }
  return undefined;
}

async function nuevoCarritoConLinea(base: string): Promise<{ cartCookie: string; csrf: string }> {
  const categorias = await fetch(`${base}/v1/categories`);
  const cats = ((await categorias.json()) as { data: { slug: string }[] }).data;
  let slug: string | undefined;
  for (const c of cats) {
    const listado = await fetch(`${base}/v1/categories/${c.slug}/products?limit=50`);
    const items = ((await listado.json()) as { data: { slug: string; in_stock: boolean }[] }).data;
    slug = items.find((i) => i.in_stock)?.slug;
    if (slug) break;
  }
  if (!slug) throw new Error('setup: no hay producto publicado con stock en el catálogo — sembrá antes de correr el contract test');

  const res = await fetch(`${base}/v1/cart/items/${slug}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ quantity: 1 }),
  });
  if (res.status !== 200) throw new Error(`setup: PUT /v1/cart/items/${slug} devolvió ${res.status}`);
  const cartCookie = cookieDe(res, 'dsm_cart');
  const csrf = cookieDe(res, 'dsm_cart_csrf');
  if (!cartCookie || !csrf) throw new Error('setup: la API no emitió dsm_cart/dsm_cart_csrf');
  return { cartCookie, csrf };
}

function bodyValido(overrides: Record<string, unknown> = {}) {
  return {
    buyer: { name: 'Cliente Contrato', email: 'contrato@example.com', phone: '+54 9 11 5555 5555' },
    consent: true,
    fulfillment: 'pickup',
    ...overrides,
  };
}

async function postCheckout(
  base: string,
  cookies: { cartCookie?: string; csrf?: string },
  body: unknown,
  { conCsrf = true }: { conCsrf?: boolean } = {},
): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json', origin };
  if (cookies.cartCookie) headers.cookie = `dsm_cart=${cookies.cartCookie}`;
  if (conCsrf && cookies.csrf) headers['x-csrf-token'] = cookies.csrf;
  return fetch(`${base}/v1/checkout`, { method: 'POST', headers, body: JSON.stringify(body) });
}

async function main(): Promise<void> {
  // Caso 1 — 201 con carrito y datos válidos (AC-1/AC-2).
  {
    const { cartCookie, csrf } = await nuevoCarritoConLinea(baseUrl);
    const res = await postCheckout(baseUrl, { cartCookie, csrf }, bodyValido());
    assert('201 checkout válido', res.status === 201, `status ${res.status}, esperaba 201`);
    if (res.status === 201) validarCheckoutCreated('201 checkout válido', await res.json());
  }

  // Caso 2 — 409 dsm:checkout/cart-empty (AC-5, sin carrito).
  {
    const res = await postCheckout(baseUrl, {}, bodyValido());
    assert('409 cart-empty', res.status === 409, `status ${res.status}, esperaba 409`);
    if (res.status === 409) {
      const body = await res.json();
      validarProblem('409 cart-empty', res, body);
      assert('409 cart-empty', (body as { type?: string }).type === 'dsm:checkout/cart-empty', `type inesperado: ${(body as { type?: string }).type}`);
    }
  }

  // Caso 3 — 422 validación por campo (AC-3, email inválido).
  {
    const { cartCookie, csrf } = await nuevoCarritoConLinea(baseUrl);
    const res = await postCheckout(baseUrl, { cartCookie, csrf }, bodyValido({ buyer: { name: 'X', email: 'no-es-email', phone: '+54 9 11 5555 5555' } }));
    assert('422 email inválido', res.status === 422, `status ${res.status}, esperaba 422`);
    if (res.status === 422) validarProblem('422 email inválido', res, await res.json());
  }

  // Caso 4 — 429 con las cabeceras RateLimit-* (instancia dedicada de rate-limit bajo).
  if (lowLimitBaseUrl) {
    let ultima: Response | undefined;
    for (let i = 0; i < 12; i += 1) {
      const { cartCookie, csrf } = await nuevoCarritoConLinea(lowLimitBaseUrl);
      ultima = await postCheckout(lowLimitBaseUrl, { cartCookie, csrf }, bodyValido({ buyer: { name: 'RL', email: `rl-${i}@example.com`, phone: '+54 9 11 5555 5555' } }));
      if (ultima.status === 429) break;
    }
    assert('429 rate-limit', ultima?.status === 429, `no se alcanzó 429 tras 12 intentos (último: ${ultima?.status})`);
    if (ultima?.status === 429) {
      for (const h of ['retry-after', 'ratelimit-limit', 'ratelimit-remaining', 'ratelimit-reset']) {
        assert('429 rate-limit', ultima.headers.has(h), `falta la cabecera ${h}`);
      }
      validarProblem('429 rate-limit', ultima, await ultima.json());
    }
  } else {
    console.warn('[checkout.contract] QA_CHECKOUT_LOWLIMIT_BASE_URL no está seteada — se SALTEA el caso 429 (instancia dedicada no levantada).');
  }

  if (fallas.length > 0) {
    console.error(`✗ ${fallas.length} incumplimiento(s) de contrato contra ${baseUrl}:`);
    for (const f of fallas) console.error(`  [${f.caso}] ${f.detalle}`);
    process.exit(1);
  }
  console.log(`✓ POST /v1/checkout conforma el contrato (CreateCheckoutRequest/CheckoutCreated/Problem) — ${lowLimitBaseUrl ? '4/4' : '3/3'} casos, ${baseUrl}`);
}

main().catch((err) => {
  console.error('✗ error inesperado corriendo el contract test:', err);
  process.exit(1);
});
