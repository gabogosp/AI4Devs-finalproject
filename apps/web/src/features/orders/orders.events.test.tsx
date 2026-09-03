import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { setEventSink } from '@/lib/observability/events';
import { OrdersList } from './OrdersList';
import { OrderStatusActions } from './OrderStatusActions';
import type { OrderDetail, OrderSummary, OrderStatus } from './ordersService';

const API = 'http://localhost:3000';
const ID = '2f1c9a4e-1111-4111-8111-111111111111';
/** Datos reconocibles del comprador: si aparecen en un evento, es una fuga. */
const NOMBRE_RECONOCIBLE = 'CENTINELA-Comprador-Real';
const EMAIL_RECONOCIBLE = 'centinela-real@no-debe-filtrarse.test';

function orden(status: OrderStatus): OrderDetail {
  return {
    id: ID,
    order_number: 1000,
    buyer_name: NOMBRE_RECONOCIBLE,
    total_ars_cents: 100_000,
    status,
    created_at: '2026-08-30T10:00:00.000Z',
    buyer_email: EMAIL_RECONOCIBLE,
    buyer_phone: '+54 351 555 0000',
    fulfillment: 'pickup',
    items: [],
    status_history: [],
  };
}

function summary(): OrderSummary {
  return {
    id: ID,
    order_number: 1000,
    buyer_name: NOMBRE_RECONOCIBLE,
    total_ars_cents: 100_000,
    status: 'new',
    created_at: '2026-08-30T10:00:00.000Z',
  };
}

describe('eventos del panel de órdenes (T9.1)', () => {
  let eventos: Array<{ event: string; props: Record<string, unknown> }>;

  beforeEach(() => {
    eventos = [];
    setEventSink((event, props) => eventos.push({ event, props: props as Record<string, unknown> }));
  });
  afterEach(() => {
    setEventSink(() => {});
  });

  it('OrdersList emite orders_filtered al cambiar el <select>, sin PII', async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`${API}/v1/admin/orders`, () =>
        HttpResponse.json({ data: [summary()], pagination: { limit: 20, offset: 0, total: 1 } }),
      ),
    );
    render(<OrdersList />);
    await screen.findByText(NOMBRE_RECONOCIBLE);

    await user.selectOptions(screen.getByLabelText('Estado:'), 'new');

    await waitFor(() => expect(eventos.some((e) => e.event === 'orders_filtered')).toBe(true));
    const filtrado = eventos.find((e) => e.event === 'orders_filtered')!;
    expect(filtrado.props.status).toBe('new');
    expect(JSON.stringify(filtrado.props)).not.toContain(NOMBRE_RECONOCIBLE);
  });

  it('OrderStatusActions emite attempted antes del PATCH y succeeded al confirmar, sin buyer_name/buyer_email', async () => {
    const user = userEvent.setup();
    server.use(
      http.patch(`${API}/v1/admin/orders/${ID}`, () => HttpResponse.json(orden('preparing'))),
    );
    render(
      <OrderStatusActions
        order={{ id: ID, status: 'new' }}
        onOptimisticUpdate={() => {}}
        onConfirmed={() => {}}
      />,
    );

    await user.click(screen.getByRole('button', { name: /marcar/i }));

    await waitFor(() =>
      expect(eventos.some((e) => e.event === 'order_status_change_succeeded')).toBe(true),
    );
    const nombres = eventos.map((e) => e.event);
    expect(nombres).toContain('order_status_change_attempted');
    expect(nombres).toContain('order_status_change_succeeded');
    expect(nombres).not.toContain('order_status_change_failed');

    const volcado = JSON.stringify(eventos);
    expect(volcado).not.toContain(NOMBRE_RECONOCIBLE);
    expect(volcado).not.toContain(EMAIL_RECONOCIBLE);
  });

  it('OrderStatusActions emite failed (no succeeded) cuando el PATCH devuelve 409', async () => {
    const user = userEvent.setup();
    server.use(
      http.patch(`${API}/v1/admin/orders/${ID}`, () =>
        HttpResponse.json(
          { type: 'dsm:orders/invalid-transition', title: 'Conflict', status: 409, detail: 'x' },
          { status: 409, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
    );
    render(
      <OrderStatusActions
        order={{ id: ID, status: 'new' }}
        onOptimisticUpdate={() => {}}
        onConfirmed={() => {}}
      />,
    );

    await user.click(screen.getByRole('button', { name: /marcar/i }));

    await waitFor(() =>
      expect(eventos.some((e) => e.event === 'order_status_change_failed')).toBe(true),
    );
    const nombres = eventos.map((e) => e.event);
    expect(nombres).toContain('order_status_change_attempted');
    expect(nombres).not.toContain('order_status_change_succeeded');
  });
});
