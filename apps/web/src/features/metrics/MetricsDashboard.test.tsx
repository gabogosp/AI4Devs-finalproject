import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { setEventSink } from '@/lib/observability/events';
import { MetricsDashboard } from './MetricsDashboard';

const API = 'http://localhost:3000';

vi.mock('./charts/SalesComposedChart', () => ({
  SalesComposedChart: () => <div data-testid="sales-composed-chart" />,
}));

function salesResponse() {
  return {
    range: { from: '2026-08-01T00:00:00Z', to: '2026-08-31T23:59:59Z' },
    granularity: 'day',
    data: [{ period_date: '2026-08-01', orders_count: 3, total_ars_cents: 15_000 }],
  };
}

function topProductsResponse() {
  return {
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
  };
}

function summaryResponse() {
  return {
    range: { from: '2026-08-01T00:00:00Z', to: '2026-08-31T23:59:59Z' },
    orders_count: 12,
    total_ars_cents: 600_000,
    breakdown_by_status: {
      new: { count: 1, total_ars_cents: 10_000 },
      preparing: { count: 2, total_ars_cents: 20_000 },
      ready: { count: 3, total_ars_cents: 30_000 },
      delivered: { count: 6, total_ars_cents: 540_000 },
    },
  };
}

function mockAllHappy() {
  server.use(
    http.get(`${API}/v1/admin/reports/sales`, () => HttpResponse.json(salesResponse())),
    http.get(`${API}/v1/admin/reports/top-products`, () =>
      HttpResponse.json(topProductsResponse()),
    ),
    http.get(`${API}/v1/admin/reports/summary`, () => HttpResponse.json(summaryResponse())),
  );
}

describe('MetricsDashboard', () => {
  it('emite metrics_shown en el primer render', async () => {
    mockAllHappy();
    const eventos: string[] = [];
    setEventSink((event) => eventos.push(event));

    render(<MetricsDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('sales-composed-chart')).toBeInTheDocument();
    });

    expect(eventos).toContain('metrics_shown');
    setEventSink(() => {});
  });

  it('cambiar el rango vía RangeFilterForm refetchea los 3 widgets con el mismo {from,to}', async () => {
    mockAllHappy();
    const urlsVistos: Record<string, string[]> = { sales: [], top: [], summary: [] };
    server.use(
      http.get(`${API}/v1/admin/reports/sales`, ({ request }) => {
        urlsVistos.sales.push(request.url);
        return HttpResponse.json(salesResponse());
      }),
      http.get(`${API}/v1/admin/reports/top-products`, ({ request }) => {
        urlsVistos.top.push(request.url);
        return HttpResponse.json(topProductsResponse());
      }),
      http.get(`${API}/v1/admin/reports/summary`, ({ request }) => {
        urlsVistos.summary.push(request.url);
        return HttpResponse.json(summaryResponse());
      }),
    );

    render(<MetricsDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('sales-composed-chart')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('Desde'), {
      target: { value: '2026-08-01' },
    });
    fireEvent.change(screen.getByLabelText('Hasta'), {
      target: { value: '2026-08-31' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

    await waitFor(() => {
      expect(urlsVistos.sales.length).toBeGreaterThan(1);
      expect(urlsVistos.top.length).toBeGreaterThan(1);
      expect(urlsVistos.summary.length).toBeGreaterThan(1);
    });

    for (const key of ['sales', 'top', 'summary'] as const) {
      const ultima = urlsVistos[key].at(-1)!;
      expect(ultima).toContain('created_at_from=2026-08-01');
      expect(ultima).toContain('created_at_to=2026-08-31');
    }
  });

  it('si SalesChart falla, TopProductsTable/SummaryCards no se ven afectados (aislamiento de fallas)', async () => {
    server.use(
      http.get(`${API}/v1/admin/reports/sales`, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'error', status: 500 },
          { status: 500 },
        ),
      ),
      http.get(`${API}/v1/admin/reports/top-products`, () =>
        HttpResponse.json(topProductsResponse()),
      ),
      http.get(`${API}/v1/admin/reports/summary`, () => HttpResponse.json(summaryResponse())),
    );

    render(<MetricsDashboard />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByText('Heladera')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });
});
