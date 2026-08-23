// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { customFetch } from './client';

/**
 * US-007 T1.1 — el carrito hereda la prohibición de renderizarse en servidor.
 *
 * Es la mitad load-bearing del guard: el carrito es dato personalizado por
 * definición, así que si esto no lanzara, un Server Component podría renderizar
 * el carrito de alguien y Next lo guardaría en la Data Cache — servido después a
 * otra persona (US-014 design.md D3).
 */
describe("customFetch con session: 'cart' (servidor)", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch() {
    const spy = vi.fn().mockImplementation(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', spy);
    return spy;
  }

  it('lanza y NO llega a hacer la llamada', async () => {
    expect(typeof window).toBe('undefined');
    const spy = stubFetch();

    await expect(customFetch('/v1/cart', { session: 'cart' })).rejects.toMatchObject({
      appError: { kind: 'server' },
    });
    // Que lance no alcanza: tiene que lanzar ANTES de salir a la red.
    expect(spy).not.toHaveBeenCalled();
  });

  it('lanza igual en una escritura', async () => {
    stubFetch();

    await expect(
      customFetch('/v1/cart/items/taco-fischer', { method: 'PUT', session: 'cart' }),
    ).rejects.toMatchObject({ appError: { kind: 'server' } });
  });

  it('una llamada pública desde servidor sigue funcionando (sin regresión)', async () => {
    stubFetch();

    await expect(customFetch('/v1/products/REF-001')).resolves.toMatchObject({
      status: 200,
    });
  });
});
