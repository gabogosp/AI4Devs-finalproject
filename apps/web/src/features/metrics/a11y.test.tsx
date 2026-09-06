import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';

// `axe-core` no es dependencia directa de este paquete (pnpm no resuelve sus
// tipos acá aunque esté presente transitivamente) — forma mínima local de lo
// que este archivo necesita, no el `Result` completo de axe-core.
interface AxeViolation {
  impact?: 'minor' | 'moderate' | 'serious' | 'critical' | null;
}
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { MetricsDashboard } from './MetricsDashboard';

expect.extend(toHaveNoViolations);

vi.mock('./charts/SalesComposedChart', () => ({
  SalesComposedChart: () => <div data-testid="sales-composed-chart" />,
}));

const API = 'http://localhost:3000';

// `region` desactivada: el componente se monta suelto, sin el landmark que
// aporta el layout — mismo criterio que `src/features/orders/a11y.test.tsx`.
const auditar = async (
  container: HTMLElement,
): Promise<{ violations: AxeViolation[] }> =>
  axe(container, { rules: { region: { enabled: false } } }) as Promise<{
    violations: AxeViolation[];
  }>;

function salesResponse(data: unknown[]) {
  return {
    range: { from: '2026-08-01T00:00:00Z', to: '2026-08-31T23:59:59Z' },
    granularity: 'day',
    data,
  };
}

function topProductsResponse(data: unknown[]) {
  return { range: { from: '2026-08-01T00:00:00Z', to: '2026-08-31T23:59:59Z' }, data };
}

function summaryResponse(orders_count: number) {
  return {
    range: { from: '2026-08-01T00:00:00Z', to: '2026-08-31T23:59:59Z' },
    orders_count,
    total_ars_cents: orders_count === 0 ? 0 : 600_000,
    breakdown_by_status: {
      new: { count: 0, total_ars_cents: 0 },
      preparing: { count: 0, total_ars_cents: 0 },
      ready: { count: 0, total_ars_cents: 0 },
      delivered: { count: orders_count, total_ars_cents: orders_count === 0 ? 0 : 600_000 },
    },
  };
}

async function graves(container: HTMLElement) {
  const resultados = await auditar(container);
  return resultados.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
}

describe('Accesibilidad del panel de métricas (US-016 T11.1)', () => {
  it('MetricsDashboard con datos en los 3 endpoints no tiene violaciones serious/critical', async () => {
    server.use(
      http.get(`${API}/v1/admin/reports/sales`, () =>
        HttpResponse.json(
          salesResponse([{ period_date: '2026-08-01', orders_count: 3, total_ars_cents: 15_000 }]),
        ),
      ),
      http.get(`${API}/v1/admin/reports/top-products`, () =>
        HttpResponse.json(
          topProductsResponse([
            {
              product_id: 'a1111111-1111-4111-8111-111111111111',
              product_name: 'Heladera',
              product_sku: 'REF-1',
              quantity_sold: 10,
              revenue_ars_cents: 500_000,
            },
          ]),
        ),
      ),
      http.get(`${API}/v1/admin/reports/summary`, () =>
        HttpResponse.json(summaryResponse(12)),
      ),
    );

    const { container } = render(<MetricsDashboard />);
    await waitFor(() => {
      expect(screen.getByTestId('sales-composed-chart')).toBeInTheDocument();
      expect(screen.getByText('Heladera')).toBeInTheDocument();
    });

    expect(await graves(container)).toEqual([]);
  });

  it('MetricsDashboard con los 3 datasets vacíos (AC-5) también es accesible', async () => {
    server.use(
      http.get(`${API}/v1/admin/reports/sales`, () => HttpResponse.json(salesResponse([]))),
      http.get(`${API}/v1/admin/reports/top-products`, () =>
        HttpResponse.json(topProductsResponse([])),
      ),
      http.get(`${API}/v1/admin/reports/summary`, () => HttpResponse.json(summaryResponse(0))),
    );

    const { container } = render(<MetricsDashboard />);
    await waitFor(() => {
      expect(screen.getByTestId('sales-empty-state')).toBeInTheDocument();
      expect(screen.getByTestId('top-products-empty-state')).toBeInTheDocument();
      expect(screen.getByTestId('summary-empty-state')).toBeInTheDocument();
    });

    expect(await graves(container)).toEqual([]);
  });
});
