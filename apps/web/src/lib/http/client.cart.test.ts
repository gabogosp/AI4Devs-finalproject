import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { customFetch } from './client';
import { setAuthToken } from './authToken';

/**
 * US-007 T1.1 — el tercer valor del discriminante: `session: 'cart'`.
 *
 * Va en un archivo aparte a propósito, igual que `csrf.cart.test.ts`: los specs
 * de `client.test.ts` son de US-001/US-003/US-014 y tienen que seguir pasando
 * **sin editarse**. El patrón `client` del `Verify` corre los dos.
 */
function stubFetch(status = 200) {
  const spy = vi.fn().mockImplementation(
    async () =>
      new Response(JSON.stringify({ ok: true }), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

describe("customFetch con session: 'cart' (browser)", () => {
  beforeEach(() => {
    setAuthToken(null);
    document.cookie = 'dsm_cart_csrf=tok-carrito; Path=/';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setAuthToken(null);
    document.cookie = 'dsm_cart_csrf=; Max-Age=0; Path=/';
    document.cookie = 'dsm_csrf=; Max-Age=0; Path=/';
  });

  it('usa URL RELATIVA — la resuelve el rewrite, no el navegador (ADR-0013)', async () => {
    const spy = stubFetch();

    await customFetch('/v1/cart', { session: 'cart' });

    // Una URL absoluta al API rompería la topología: la cookie del carrito es
    // host-only y no volvería nunca desde otro sitio.
    expect(spy.mock.calls[0][0]).toBe('/v1/cart');
  });

  it('manda credentials: include (sin eso la cookie no viaja ni se guarda)', async () => {
    const spy = stubFetch();

    await customFetch('/v1/cart', { session: 'cart' });

    expect(spy.mock.calls[0][1].credentials).toBe('include');
  });

  it('en una escritura firma con dsm_cart_csrf, NO con el token de la sesión', async () => {
    document.cookie = 'dsm_csrf=tok-sesion; Path=/';
    const spy = stubFetch();

    await customFetch('/v1/cart/items/taco-fischer', {
      method: 'PUT',
      session: 'cart',
      body: JSON.stringify({ quantity: 2 }),
    });

    const headers = new Headers(spy.mock.calls[0][1].headers);
    expect(headers.get('x-csrf-token')).toBe('tok-carrito');
    expect(headers.get('x-csrf-token')).not.toBe('tok-sesion');
  });

  it('un DELETE también firma (es escritura)', async () => {
    const spy = stubFetch();

    await customFetch('/v1/cart/items/taco-fischer', {
      method: 'DELETE',
      session: 'cart',
    });

    expect(new Headers(spy.mock.calls[0][1].headers).get('x-csrf-token')).toBe(
      'tok-carrito',
    );
  });

  it('un GET NO lleva header CSRF (el backend no lo exige y rompería al invitado)', async () => {
    const spy = stubFetch();

    await customFetch('/v1/cart', { session: 'cart' });

    expect(new Headers(spy.mock.calls[0][1].headers).get('x-csrf-token')).toBeNull();
  });

  it('sin la cookie del carrito sale SIN header — fail closed, no inventa un valor', async () => {
    document.cookie = 'dsm_cart_csrf=; Max-Age=0; Path=/';
    const spy = stubFetch();

    await customFetch('/v1/cart/items/taco-fischer', {
      method: 'PUT',
      session: 'cart',
    });

    // Inventar un token cambiaría el 403 del backend por un error más confuso.
    expect(new Headers(spy.mock.calls[0][1].headers).get('x-csrf-token')).toBeNull();
  });

  it('propaga el 403 del backend cuando el double-submit no valida', async () => {
    stubFetch(403);

    await expect(
      customFetch('/v1/cart/items/taco-fischer', { method: 'PUT', session: 'cart' }),
    ).rejects.toMatchObject({ appError: { kind: 'forbidden' } });
  });

  it('una llamada pública sigue usando URL absoluta y sin credentials (sin regresión)', async () => {
    const spy = stubFetch();

    await customFetch('/v1/products/REF-001');

    expect(spy.mock.calls[0][0]).toMatch(/^https?:\/\//);
    expect(spy.mock.calls[0][1].credentials).toBeUndefined();
  });
});
