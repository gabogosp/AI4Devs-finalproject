import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { pendingPaymentsService, type PendingPaymentOrder } from './pendingPaymentsService';

const API = 'http://localhost:3000';
const ID = '2f1c9a4e-1111-4111-8111-111111111111';

function orden(over: Partial<PendingPaymentOrder> = {}): PendingPaymentOrder {
  return {
    id: ID,
    order_number: 101,
    buyer_name: 'Comprador de Prueba',
    total_ars_cents: 50_000,
    created_at: '2026-09-05T10:00:00.000Z',
    ...over,
  };
}

describe('pendingPaymentsService', () => {
  it('list() parsea el listado de órdenes pendientes de pago', async () => {
    server.use(
      http.get(`${API}/v1/admin/orders/pending-payment`, () =>
        HttpResponse.json([orden()]),
      ),
    );

    const resultado = await pendingPaymentsService.list();

    expect(resultado).toHaveLength(1);
    expect(resultado[0].id).toBe(ID);
  });

  it('un body con un campo fuera de forma falla con ZodError, no pasa silenciosamente', async () => {
    server.use(
      http.get(`${API}/v1/admin/orders/pending-payment`, () =>
        HttpResponse.json([{ ...orden(), id: 123 }]),
      ),
    );

    await expect(pendingPaymentsService.list()).rejects.toThrow();
  });

  it("confirm('order-1') manda POST al orderId correcto, no un id hardcodeado ni el order_number", async () => {
    let orderIdRecibido: string | null = null;
    server.use(
      http.post(`${API}/v1/admin/orders/:orderId/confirm-payment`, ({ params }) => {
        orderIdRecibido = params.orderId as string;
        return HttpResponse.json({ order_number: 101, status: 'new' });
      }),
    );

    const resultado = await pendingPaymentsService.confirm('order-1');

    expect(orderIdRecibido).toBe('order-1');
    expect(resultado.status).toBe('new');
  });
});
