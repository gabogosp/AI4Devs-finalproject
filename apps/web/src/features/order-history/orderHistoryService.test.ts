import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { orderHistoryService } from './orderHistoryService';

/**
 * Las rutas de sesión de cliente salen **same-origin** (`session: 'customer'`,
 * ADR-0013), así que MSW las intercepta en el origen del sitio, no en el del
 * API — si alguien quitara la marca, la llamada iría al API directo y estos
 * handlers no matchearían: el test falla, que es la regresión que queremos
 * comprar.
 */
const SITE = 'http://localhost:3000';

describe('orderHistoryService', () => {
  it('list() llama a GET /v1/me/orders?limit=20&offset=0 con las cookies de sesión y devuelve data + pagination parseados', async () => {
    let vistaUrl: URL | undefined;
    server.use(
      http.get(`${SITE}/v1/me/orders`, ({ request }) => {
        vistaUrl = new URL(request.url);
        return HttpResponse.json({
          data: [
            {
              order_number: 1000,
              status: 'delivered',
              total_ars_cents: 150_000,
              created_at: '2026-08-30T10:00:00.000Z',
            },
          ],
          pagination: { limit: 20, offset: 0, total: 1 },
        });
      }),
    );

    const page = await orderHistoryService.list({ limit: 20, offset: 0 });

    expect(vistaUrl?.searchParams.get('limit')).toBe('20');
    expect(vistaUrl?.searchParams.get('offset')).toBe('0');
    expect(page.data).toHaveLength(1);
    expect(page.data[0].order_number).toBe(1000);
    expect(page.pagination).toEqual({ limit: 20, offset: 0, total: 1 });
  });

  it('get() llama a GET /v1/me/orders/{orderNumber} y devuelve el detalle parseado', async () => {
    server.use(
      http.get(`${SITE}/v1/me/orders/1000`, () =>
        HttpResponse.json({
          order_number: 1000,
          status: 'ready',
          total_ars_cents: 150_000,
          created_at: '2026-08-30T10:00:00.000Z',
          fulfillment: 'pickup',
          items: [
            {
              product_name: 'Compresor Embraco',
              product_sku: 'REF-001',
              quantity: 1,
              unit_price_ars_cents: 150_000,
              subtotal_ars_cents: 150_000,
            },
          ],
        }),
      ),
    );

    const order = await orderHistoryService.get(1000);

    expect(order.order_number).toBe(1000);
    expect(order.fulfillment).toBe('pickup');
    expect(order.items).toHaveLength(1);
  });

  it('un 401 propaga un AppError unauthorized', async () => {
    server.use(
      http.get(`${SITE}/v1/me/orders`, () =>
        HttpResponse.json(
          { type: 'dsm:auth/unauthenticated', title: 'Unauthorized', status: 401 },
          { status: 401 },
        ),
      ),
    );

    await expect(orderHistoryService.list({ limit: 20, offset: 0 })).rejects.toMatchObject({
      appError: { kind: 'unauthorized' },
    });
  });

  it('un 404 en get() propaga un AppError notFound', async () => {
    server.use(
      http.get(`${SITE}/v1/me/orders/9999`, () =>
        HttpResponse.json(
          { type: 'dsm:checkout/order-not-found', title: 'Not Found', status: 404 },
          { status: 404 },
        ),
      ),
    );

    await expect(orderHistoryService.get(9999)).rejects.toMatchObject({
      appError: { kind: 'notFound' },
    });
  });

  it('una respuesta que no cumple el contrato falla en el borde, no en la UI', async () => {
    server.use(
      http.get(`${SITE}/v1/me/orders`, () => HttpResponse.json({ data: [{}], pagination: {} })),
    );

    await expect(orderHistoryService.list({ limit: 20, offset: 0 })).rejects.toBeTruthy();
  });
});
