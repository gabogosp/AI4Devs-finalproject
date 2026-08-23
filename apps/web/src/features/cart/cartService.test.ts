import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import {
  getGetCartMockHandler,
  getRemoveCartItemMockHandler,
  getSetCartItemMockHandler,
} from '@/api/generated/endpoints';
import type { CartEnvelope } from '@/api/generated/model';
import { cartService } from './cartService';

/**
 * US-007 T1.2 — el repositorio del carrito.
 *
 * Las URLs son **relativas** (`session: 'cart'` + rewrite de ADR-0013), así que
 * en jsdom resuelven contra `http://localhost:3000`, que es donde escuchan los
 * handlers.
 */
const ORIGIN = 'http://localhost:3000';

function cartEnvelope(overrides: Partial<CartEnvelope['cart']> = {}): CartEnvelope {
  return {
    cart: {
      id: '33333333-3333-4333-8333-333333333333',
      items: [
        {
          slug: 'taco-fischer-sx-8',
          name: 'Taco Fischer SX 8mm',
          image_url: null,
          quantity: 2,
          unit_price_ars_cents: 320000,
          currency: 'ARS',
          subtotal_ars_cents: 640000,
          availability: 'available',
          max_quantity: 10,
          price_changed: false,
        },
      ],
      item_count: 1,
      total_quantity: 2,
      total_ars_cents: 640000,
      has_blocking_issues: false,
      updated_at: '2026-08-23T00:00:00.000Z',
      ...overrides,
    },
  };
}

describe('cartService — camino feliz', () => {
  it('get() devuelve el carrito y desenvuelve el sobre', async () => {
    server.use(http.get(`${ORIGIN}/v1/cart`, () => HttpResponse.json(cartEnvelope())));

    const cart = await cartService.get();

    expect(cart.items).toHaveLength(1);
    expect(cart.total_ars_cents).toBe(640000);
  });

  it('setItemQuantity() manda la cantidad ABSOLUTA en el body y usa PUT', async () => {
    let body: Record<string, unknown> = {};
    let method = '';
    server.use(
      http.put(`${ORIGIN}/v1/cart/items/:slug`, async ({ request }) => {
        method = request.method;
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(cartEnvelope());
      }),
    );

    await cartService.setItemQuantity('taco-fischer-sx-8', 3);

    expect(method).toBe('PUT');
    // Absoluta, no un delta: el backend la modeló idempotente a propósito.
    expect(body).toEqual({ quantity: 3 });
  });

  it('removeItem() usa DELETE y devuelve el carrito resultante', async () => {
    let method = '';
    server.use(
      http.delete(`${ORIGIN}/v1/cart/items/:slug`, ({ request }) => {
        method = request.method;
        return HttpResponse.json(cartEnvelope({ items: [], item_count: 0, total_quantity: 0, total_ars_cents: 0 }));
      }),
    );

    const cart = await cartService.removeItem('taco-fischer-sx-8');

    expect(method).toBe('DELETE');
    expect(cart.items).toEqual([]);
  });

  it('funciona contra los handlers MSW GENERADOS del contrato (no escritos a mano)', async () => {
    // Si el contrato cambiara de forma, estos handlers cambiarían con él y este
    // test se caería — que es justamente para lo que existen.
    server.use(
      getGetCartMockHandler(cartEnvelope()),
      getSetCartItemMockHandler(cartEnvelope()),
      getRemoveCartItemMockHandler(cartEnvelope()),
    );

    await expect(cartService.get()).resolves.toMatchObject({ item_count: 1 });
    await expect(cartService.setItemQuantity('taco-fischer-sx-8', 1)).resolves.toBeDefined();
    await expect(cartService.removeItem('taco-fischer-sx-8')).resolves.toBeDefined();
  });
});

describe('cartService — errores del contrato', () => {
  it('409 preserva available_quantity SIN parsear el detail (AC-5)', async () => {
    server.use(
      http.put(`${ORIGIN}/v1/cart/items/:slug`, () =>
        HttpResponse.json(
          {
            type: 'dsm:cart/insufficient-stock',
            title: 'Stock insuficiente',
            status: 409,
            detail: 'Quedan 2 unidades',
            instance: '/v1/cart/items/taco-fischer-sx-8',
            available_quantity: 2,
          },
          { status: 409 },
        ),
      ),
    );

    // El contrato expone `available_quantity` como campo de primer nivel
    // justamente para que la UI no tenga que sacarlo del texto con una regex.
    await expect(
      cartService.setItemQuantity('taco-fischer-sx-8', 5),
    ).rejects.toMatchObject({
      appError: {
        kind: 'conflict',
        availableQuantity: 2,
        problemType: 'dsm:cart/insufficient-stock',
      },
    });
  });

  it('409 de demasiadas líneas llega con max_items y su propio problemType', async () => {
    server.use(
      http.put(`${ORIGIN}/v1/cart/items/:slug`, () =>
        HttpResponse.json(
          {
            type: 'dsm:cart/too-many-items',
            title: 'Demasiadas líneas',
            status: 409,
            detail: 'El carrito admite hasta 50 productos distintos',
            instance: '/v1/cart/items/x',
            max_items: 50,
          },
          { status: 409 },
        ),
      ),
    );

    // Los dos 409 se distinguen por `problemType`, no por la forma del error.
    await expect(cartService.setItemQuantity('x', 1)).rejects.toMatchObject({
      appError: { kind: 'conflict', maxItems: 50, problemType: 'dsm:cart/too-many-items' },
    });
  });

  it('404 → notFound (el mismo para inexistente y no publicado, AC-10)', async () => {
    server.use(
      http.put(`${ORIGIN}/v1/cart/items/:slug`, () =>
        HttpResponse.json(
          {
            type: 'dsm:catalog/not-found',
            title: 'No encontrado',
            status: 404,
            detail: 'Producto no encontrado',
            instance: '/v1/cart/items/fantasma',
          },
          { status: 404 },
        ),
      ),
    );

    await expect(cartService.setItemQuantity('fantasma', 1)).rejects.toMatchObject({
      appError: { kind: 'notFound' },
    });
  });

  it('429 → rateLimited con retryAfterSeconds del header (no es un fallo)', async () => {
    server.use(
      http.put(`${ORIGIN}/v1/cart/items/:slug`, () =>
        HttpResponse.json(
          {
            type: 'dsm:cart/rate-limited',
            title: 'Demasiadas peticiones',
            status: 429,
            detail: 'Esperá un momento',
            instance: '/v1/cart/items/x',
          },
          { status: 429, headers: { 'retry-after': '7' } },
        ),
      ),
    );

    await expect(cartService.setItemQuantity('x', 1)).rejects.toMatchObject({
      appError: { kind: 'rateLimited', retryAfterSeconds: 7 },
    });
  });

  it('403 → forbidden (double-submit que no validó)', async () => {
    server.use(
      http.delete(`${ORIGIN}/v1/cart/items/:slug`, () =>
        HttpResponse.json(
          {
            type: 'dsm:cart/csrf',
            title: 'Prohibido',
            status: 403,
            detail: 'Token CSRF inválido',
            instance: '/v1/cart/items/x',
          },
          { status: 403 },
        ),
      ),
    );

    await expect(cartService.removeItem('x')).rejects.toMatchObject({
      appError: { kind: 'forbidden' },
    });
  });

  it('una respuesta que NO cumple el contrato falla en el borde, no en la UI', async () => {
    server.use(
      http.get(`${ORIGIN}/v1/cart`, () =>
        HttpResponse.json({ cart: { id: null, items: 'no-es-un-array' } }),
      ),
    );

    await expect(cartService.get()).rejects.toMatchObject({
      appError: { kind: 'server' },
    });
  });
});
