import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { getCreateGuestCheckoutMockHandler } from '@/api/generated/endpoints';
import type { CreateCheckoutRequest } from '@/api/generated/model';
import { checkoutService } from './checkoutService';

const ORIGIN = 'http://localhost:3000';

const input: CreateCheckoutRequest = {
  buyer: { name: 'Ana Gómez', email: 'ana@example.com', phone: '+54 9 11 5555 5555' },
  consent: true,
  fulfillment: 'pickup',
};

describe('checkoutService — camino feliz', () => {
  it('submit() devuelve el CheckoutCreated validado', async () => {
    server.use(
      getCreateGuestCheckoutMockHandler({
        order_token: 'a'.repeat(64),
        order_number: 1000,
        status: 'pending_payment',
        total_ars_cents: 640000,
        items_count: 1,
      }),
    );

    const created = await checkoutService.submit(input);

    expect(created.order_number).toBe(1000);
    expect(created.status).toBe('pending_payment');
  });

  it('manda el body tal cual, vía POST /v1/checkout', async () => {
    let body: unknown;
    let method = '';
    server.use(
      http.post(`${ORIGIN}/v1/checkout`, async ({ request }) => {
        method = request.method;
        body = await request.json();
        return HttpResponse.json({
          order_token: 'b'.repeat(64),
          order_number: 1001,
          status: 'pending_payment',
          total_ars_cents: 100,
          items_count: 1,
        });
      }),
    );

    await checkoutService.submit(input);

    expect(method).toBe('POST');
    expect(body).toEqual(input);
  });
});

describe('checkoutService — contrato', () => {
  it('un 201 con order_token mal formado lanza AppErrorException({ kind: "server" })', async () => {
    server.use(
      http.post(`${ORIGIN}/v1/checkout`, () =>
        HttpResponse.json({
          order_token: 'no-es-hex',
          order_number: 1000,
          status: 'pending_payment',
          total_ars_cents: 100,
          items_count: 1,
        }),
      ),
    );

    await expect(checkoutService.submit(input)).rejects.toMatchObject({
      appError: { kind: 'server' },
    });
  });
});
