import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import Page from '../../../../app/(admin)/admin/metricas/page';

const API = 'http://localhost:3000';

vi.mock('@/features/metrics/charts/SalesComposedChart', () => ({
  SalesComposedChart: () => <div data-testid="sales-composed-chart" />,
}));

/** Smoke test de la ruta (US-016 T9.3) — mirror de `admin/ordenes/page.test.tsx`. */
describe('/admin/metricas page', () => {
  it('con los 3 endpoints devolviendo 200, monta los 3 widgets', async () => {
    server.use(
      http.get(`${API}/v1/admin/reports/sales`, () =>
        HttpResponse.json({
          range: { from: '2026-08-01T00:00:00Z', to: '2026-08-31T23:59:59Z' },
          granularity: 'day',
          data: [{ period_date: '2026-08-01', orders_count: 3, total_ars_cents: 15_000 }],
        }),
      ),
      http.get(`${API}/v1/admin/reports/top-products`, () =>
        HttpResponse.json({
          range: { from: '2026-08-01T00:00:00Z', to: '2026-08-31T23:59:59Z' },
          data: [
            {
              product_id: 'a1111111-1111-4111-8111-111111111111',
              product_name: 'Heladera',
              product_sku: 'REF-1',
              quantity_sold: 10,
              revenue_ars_cents: 500_000,
            },
          ],
        }),
      ),
      http.get(`${API}/v1/admin/reports/summary`, () =>
        HttpResponse.json({
          range: { from: '2026-08-01T00:00:00Z', to: '2026-08-31T23:59:59Z' },
          orders_count: 12,
          total_ars_cents: 600_000,
          breakdown_by_status: {
            new: { count: 1, total_ars_cents: 10_000 },
            preparing: { count: 2, total_ars_cents: 20_000 },
            ready: { count: 3, total_ars_cents: 30_000 },
            delivered: { count: 6, total_ars_cents: 540_000 },
          },
        }),
      ),
    );

    render(<Page />);

    expect(screen.getByRole('heading', { name: 'Métricas' })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId('sales-chart')).toBeInTheDocument();
      expect(screen.getByTestId('top-products-table')).toBeInTheDocument();
      expect(screen.getByTestId('summary-cards')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId('sales-composed-chart')).toBeInTheDocument();
      expect(screen.getByText('Heladera')).toBeInTheDocument();
      expect(screen.getByText('12')).toBeInTheDocument();
    });
  });
});
