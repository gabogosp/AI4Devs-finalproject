import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { PendingPaymentsPanel } from './PendingPaymentsPanel';
import type { PendingPaymentOrder } from './pendingPaymentsService';

const API = 'http://localhost:3000';
const ORDER_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const ORDER_B = 'bbbbbbbb-2222-4222-8222-222222222222';

function orden(over: Partial<PendingPaymentOrder> = {}): PendingPaymentOrder {
  return {
    id: ORDER_A,
    order_number: 101,
    buyer_name: 'Comprador A',
    total_ars_cents: 50_000,
    created_at: '2026-09-05T10:00:00.000Z',
    ...over,
  };
}

describe('PendingPaymentsPanel (T12.3)', () => {
  it('confirmar la fila de order-a manda el POST con ese orderId, no order-b ni un id fijo', async () => {
    const user = userEvent.setup();
    let orderIdRecibido: string | null = null;
    server.use(
      http.get(`${API}/v1/admin/orders/pending-payment`, () =>
        HttpResponse.json([
          orden({ id: ORDER_A, order_number: 101 }),
          orden({ id: ORDER_B, order_number: 102, buyer_name: 'Comprador B' }),
        ]),
      ),
      http.post(`${API}/v1/admin/orders/:orderId/confirm-payment`, ({ params }) => {
        orderIdRecibido = params.orderId as string;
        return HttpResponse.json({ order_number: 101, status: 'new' });
      }),
    );

    render(<PendingPaymentsPanel />);
    await screen.findByText('101');

    const filaA = screen.getByText('101').closest('tr')!;
    await user.click(within(filaA).getByRole('button', { name: 'Confirmar pago' }));

    await waitFor(() => expect(orderIdRecibido).toBe(ORDER_A));
  });

  it('tras confirmar OK, el refetch quita la fila confirmada y deja la que sigue pendiente', async () => {
    const user = userEvent.setup();
    let confirmado = false;
    server.use(
      http.get(`${API}/v1/admin/orders/pending-payment`, () =>
        HttpResponse.json(
          confirmado
            ? [orden({ id: ORDER_B, order_number: 102, buyer_name: 'Comprador B' })]
            : [
                orden({ id: ORDER_A, order_number: 101 }),
                orden({ id: ORDER_B, order_number: 102, buyer_name: 'Comprador B' }),
              ],
        ),
      ),
      http.post(`${API}/v1/admin/orders/:orderId/confirm-payment`, () => {
        confirmado = true;
        return HttpResponse.json({ order_number: 101, status: 'new' });
      }),
    );

    render(<PendingPaymentsPanel />);
    await screen.findByText('101');
    expect(screen.getByText('102')).toBeInTheDocument();

    const filaA = screen.getByText('101').closest('tr')!;
    await user.click(within(filaA).getByRole('button', { name: 'Confirmar pago' }));

    await waitFor(() => expect(screen.queryByText('101')).not.toBeInTheDocument());
    expect(screen.getByText('102')).toBeInTheDocument();
  });

  it('un 409 deja la fila visible, muestra role="alert" y reactiva el botón', async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`${API}/v1/admin/orders/pending-payment`, () =>
        HttpResponse.json([orden({ id: ORDER_A, order_number: 101 })]),
      ),
      http.post(`${API}/v1/admin/orders/:orderId/confirm-payment`, () =>
        HttpResponse.json(
          {
            type: 'dsm:payments/order-not-pending-payment',
            title: 'La orden ya no está pendiente de pago',
            status: 409,
          },
          { status: 409 },
        ),
      ),
    );

    render(<PendingPaymentsPanel />);
    await screen.findByText('101');

    const filaA = screen.getByText('101').closest('tr')!;
    const boton = within(filaA).getByRole('button', { name: 'Confirmar pago' });
    await user.click(boton);

    await screen.findByRole('alert');
    expect(screen.getByText('101')).toBeInTheDocument();
    expect(boton).not.toBeDisabled();
  });

  it('sin filas, renderiza el texto de vacío en vez de una tabla muda', async () => {
    server.use(
      http.get(`${API}/v1/admin/orders/pending-payment`, () => HttpResponse.json([])),
    );

    render(<PendingPaymentsPanel />);

    await screen.findByText('No hay pagos pendientes de confirmar.');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
