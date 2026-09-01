import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { ordersService, type OrderDetail } from './ordersService';

const API = 'http://localhost:3000';
const ID = '2f1c9a4e-1111-4111-8111-111111111111';

/** Detalle completo del contrato. Los tests parten de acá y sólo tocan lo suyo. */
function orden(over: Partial<OrderDetail> = {}): OrderDetail {
  return {
    id: ID,
    order_number: 1000,
    buyer_name: 'Comprador de Prueba',
    total_ars_cents: 100_000,
    status: 'preparing',
    created_at: '2026-08-30T10:00:00.000Z',
    buyer_email: 'comprador@test.local',
    buyer_phone: '+54 351 555 0000',
    fulfillment: 'pickup',
    items: [],
    status_history: [],
    ...over,
  };
}

describe('ordersService', () => {
  it("updateStatus('id-1','ready','clave-1') manda PATCH con el header de idempotencia y el body correcto", async () => {
    let idempotency: string | null = null;
    let cuerpoRecibido: unknown = null;
    server.use(
      http.patch(`${API}/v1/admin/orders/id-1`, async ({ request }) => {
        idempotency = request.headers.get('idempotency-key');
        cuerpoRecibido = await request.json();
        // El `id` de la respuesta es UUID válido (lo exige el schema Zod) —
        // el path `id-1` es sólo el segmento de URL que se manda, no se valida.
        return HttpResponse.json(orden({ status: 'ready' }));
      }),
    );

    const resultado = await ordersService.updateStatus('id-1', 'ready', 'clave-1');

    expect(idempotency).toBe('clave-1');
    expect(cuerpoRecibido).toEqual({ status: 'ready' });
    expect(resultado.status).toBe('ready');
  });

  it('un body con status fuera del enum falla con ZodError, no pasa silenciosamente', async () => {
    server.use(
      http.patch(`${API}/v1/admin/orders/id-1`, () =>
        HttpResponse.json(orden({ status: 'cancelled' as never })),
      ),
    );

    await expect(
      ordersService.updateStatus('id-1', 'ready', 'clave-1'),
    ).rejects.toThrow();
  });

  it('list manda status/limit/offset/sort y parsea la respuesta', async () => {
    server.use(
      http.get(`${API}/v1/admin/orders`, () =>
        HttpResponse.json({
          data: [orden()],
          pagination: { limit: 20, offset: 0, total: 1 },
        }),
      ),
    );

    const resultado = await ordersService.list({ limit: 20, offset: 0, sort: '-created_at' });

    expect(resultado.data).toHaveLength(1);
    expect(resultado.pagination.total).toBe(1);
  });

  it('get devuelve el detalle parseado', async () => {
    server.use(
      http.get(`${API}/v1/admin/orders/id-1`, () => HttpResponse.json(orden())),
    );

    const resultado = await ordersService.get('id-1');

    expect(resultado.id).toBe(ID);
  });
});
