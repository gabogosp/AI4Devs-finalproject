import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { SalesChart } from './SalesChart';

const API = 'http://localhost:3000';

vi.mock('./charts/SalesComposedChart', () => ({
  SalesComposedChart: ({ rows }: { rows: unknown[] }) => (
    <div data-testid="sales-composed-chart">{rows.length} filas</div>
  ),
}));

function salesResponse(overrides: Partial<{ data: unknown[] }> = {}) {
  return {
    range: { from: '2026-08-01T00:00:00Z', to: '2026-08-31T23:59:59Z' },
    granularity: 'day',
    data: [{ period_date: '2026-08-01', orders_count: 3, total_ars_cents: 15_000 }],
    ...overrides,
  };
}

describe('SalesChart', () => {
  it('muestra el estado de carga y luego el chart con datos', async () => {
    server.use(
      http.get(`${API}/v1/admin/reports/sales`, () => HttpResponse.json(salesResponse())),
    );

    render(<SalesChart range={{}} />);

    expect(screen.getByRole('status')).toHaveTextContent(/Cargando/);

    await waitFor(() => {
      expect(screen.getByTestId('sales-composed-chart')).toBeInTheDocument();
    });
  });

  it('estado vacío explícito cuando data.length === 0, nunca error', async () => {
    server.use(
      http.get(`${API}/v1/admin/reports/sales`, () =>
        HttpResponse.json(salesResponse({ data: [] })),
      ),
    );

    render(<SalesChart range={{}} />);

    await waitFor(() => {
      expect(screen.getByTestId('sales-empty-state')).toBeInTheDocument();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('estado de error con reintento', async () => {
    let attempts = 0;
    server.use(
      http.get(`${API}/v1/admin/reports/sales`, () => {
        attempts += 1;
        if (attempts === 1) {
          return HttpResponse.json(
            { type: 'about:blank', title: 'error', status: 500 },
            { status: 500 },
          );
        }
        return HttpResponse.json(salesResponse());
      }),
    );

    render(<SalesChart range={{}} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    await waitFor(() => {
      expect(screen.getByTestId('sales-composed-chart')).toBeInTheDocument();
    });
  });

  it('cambiar granularity dispara un nuevo fetch sin tocar range', async () => {
    const granularidadesVistas: string[] = [];
    server.use(
      http.get(`${API}/v1/admin/reports/sales`, ({ request }) => {
        const url = new URL(request.url);
        granularidadesVistas.push(url.searchParams.get('granularity') ?? 'day');
        return HttpResponse.json(salesResponse());
      }),
    );

    render(<SalesChart range={{}} />);

    await waitFor(() => {
      expect(screen.getByTestId('sales-composed-chart')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('Agrupar por:'), {
      target: { value: 'month' },
    });

    await waitFor(() => {
      expect(granularidadesVistas).toContain('month');
    });
  });
});
