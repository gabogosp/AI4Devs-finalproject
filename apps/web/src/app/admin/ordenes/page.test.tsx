import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import Page from '../../../../app/(admin)/admin/ordenes/page';

const API = 'http://localhost:3000';

describe('/admin/ordenes page (T12.4)', () => {
  it('sin ?tab, renderiza OrdersList y NO PendingPaymentsPanel', async () => {
    server.use(
      http.get(`${API}/v1/admin/orders`, () =>
        HttpResponse.json({ data: [], pagination: { limit: 20, offset: 0, total: 0 } }),
      ),
    );

    const jsx = await Page({ searchParams: Promise.resolve({}) });
    render(jsx);

    expect(await screen.findByTestId('orders-list')).toBeInTheDocument();
    expect(screen.queryByTestId('pending-payments-panel')).not.toBeInTheDocument();
  });

  it('con ?tab=pendientes-de-pago, renderiza PendingPaymentsPanel y NO OrdersList', async () => {
    server.use(
      http.get(`${API}/v1/admin/orders/pending-payment`, () => HttpResponse.json([])),
    );

    const jsx = await Page({ searchParams: Promise.resolve({ tab: 'pendientes-de-pago' }) });
    render(jsx);

    expect(await screen.findByTestId('pending-payments-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('orders-list')).not.toBeInTheDocument();
  });
});
