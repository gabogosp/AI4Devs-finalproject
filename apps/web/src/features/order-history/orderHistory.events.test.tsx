import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { setEventSink } from '@/lib/observability/events';
import { PurchaseHistoryList } from './PurchaseHistoryList';
import { PurchaseDetail } from './PurchaseDetail';

const SITE = 'http://localhost:3000';

function orden(orderNumber: number) {
  return {
    order_number: orderNumber,
    status: 'delivered',
    total_ars_cents: 150_000,
    created_at: '2026-08-30T10:00:00.000Z',
  };
}

describe('eventos del historial de compras (T6.1)', () => {
  let eventos: Array<{ event: string; props: Record<string, unknown> }>;

  beforeEach(() => {
    eventos = [];
    setEventSink((event, props) => eventos.push({ event, props: props as Record<string, unknown> }));
  });
  afterEach(() => {
    setEventSink(() => {});
  });

  it('PurchaseHistoryList emite order_history_shown una sola vez con item_count correcto aunque el componente re-renderice', async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`${SITE}/v1/me/orders`, ({ request }) => {
        const offset = new URL(request.url).searchParams.get('offset');
        if (offset === '20') {
          return HttpResponse.json({
            data: [orden(1020)],
            pagination: { limit: 20, offset: 20, total: 21 },
          });
        }
        return HttpResponse.json({
          data: Array.from({ length: 20 }, (_, i) => orden(1000 + i)),
          pagination: { limit: 20, offset: 0, total: 21 },
        });
      }),
    );

    render(<PurchaseHistoryList />);
    await screen.findByText('Pedido #1000');

    await user.click(screen.getByRole('button', { name: /cargar más/i }));
    await screen.findByText('Pedido #1020');

    const shown = eventos.filter((e) => e.event === 'order_history_shown');
    expect(shown).toHaveLength(1);
    expect(shown[0].props.item_count).toBe(20);
  });

  it('PurchaseHistoryList emite order_history_load_more_clicked al click en "Cargar más"', async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`${SITE}/v1/me/orders`, ({ request }) => {
        const offset = new URL(request.url).searchParams.get('offset');
        if (offset === '20') {
          return HttpResponse.json({
            data: [orden(1020)],
            pagination: { limit: 20, offset: 20, total: 21 },
          });
        }
        return HttpResponse.json({
          data: Array.from({ length: 20 }, (_, i) => orden(1000 + i)),
          pagination: { limit: 20, offset: 0, total: 21 },
        });
      }),
    );

    render(<PurchaseHistoryList />);
    await screen.findByText('Pedido #1000');
    await user.click(screen.getByRole('button', { name: /cargar más/i }));

    await waitFor(() =>
      expect(eventos.some((e) => e.event === 'order_history_load_more_clicked')).toBe(true),
    );
  });

  it('PurchaseDetail emite order_detail_shown con order_number y SIN buyer_name/buyer_email aunque el mock los incluyera', async () => {
    server.use(
      http.get(`${SITE}/v1/me/orders/1000`, () =>
        HttpResponse.json({
          order_number: 1000,
          status: 'ready',
          total_ars_cents: 150_000,
          created_at: '2026-08-30T10:00:00.000Z',
          fulfillment: 'pickup',
          items: [],
          // Centinela anti-fuga: si algún día el mock (o el backend) incluyera
          // estos campos, el evento no debe reproducirlos.
          buyer_name: 'CENTINELA-Comprador-Real',
          buyer_email: 'centinela-real@no-debe-filtrarse.test',
        }),
      ),
    );

    render(<PurchaseDetail orderNumber="1000" />);

    await waitFor(() => expect(eventos.some((e) => e.event === 'order_detail_shown')).toBe(true));
    const shown = eventos.find((e) => e.event === 'order_detail_shown')!;
    expect(shown.props.order_number).toBe(1000);

    const volcado = JSON.stringify(eventos);
    expect(volcado).not.toContain('CENTINELA-Comprador-Real');
    expect(volcado).not.toContain('centinela-real@no-debe-filtrarse.test');
  });

  it('un 404 emite order_detail_not_found, no order_detail_shown', async () => {
    server.use(
      http.get(`${SITE}/v1/me/orders/9999`, () =>
        HttpResponse.json(
          { type: 'dsm:checkout/order-not-found', title: 'Not Found', status: 404 },
          { status: 404 },
        ),
      ),
    );

    render(<PurchaseDetail orderNumber="9999" />);

    await waitFor(() =>
      expect(eventos.some((e) => e.event === 'order_detail_not_found')).toBe(true),
    );
    const nombres = eventos.map((e) => e.event);
    expect(nombres).not.toContain('order_detail_shown');
    const notFound = eventos.find((e) => e.event === 'order_detail_not_found')!;
    expect(notFound.props.order_number).toBe(9999);
  });
});
