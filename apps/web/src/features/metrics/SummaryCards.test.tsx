import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { SummaryCards } from './SummaryCards';

const API = 'http://localhost:3000';

function summaryResponse(overrides: Partial<{ orders_count: number }> = {}) {
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
    ...overrides,
  };
}

const CAPTION = 'Sólo se cuentan órdenes confirmadas por pago aprobado.';

describe('SummaryCards', () => {
  it('carga y muestra las 4 tarjetas con el caption AC-8', async () => {
    server.use(
      http.get(`${API}/v1/admin/reports/summary`, () => HttpResponse.json(summaryResponse())),
    );

    render(<SummaryCards range={{}} />);

    expect(screen.getByRole('status')).toHaveTextContent(/Cargando/);
    expect(screen.queryByText(CAPTION)).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('12')).toBeInTheDocument();
    });
    expect(screen.getByText(CAPTION)).toBeInTheDocument();
  });

  it('estado vacío explícito cuando orders_count === 0, con el caption presente', async () => {
    server.use(
      http.get(`${API}/v1/admin/reports/summary`, () =>
        HttpResponse.json(
          summaryResponse({ orders_count: 0 }),
        ),
      ),
    );

    render(<SummaryCards range={{}} />);

    await waitFor(() => {
      expect(screen.getByTestId('summary-empty-state')).toBeInTheDocument();
    });
    expect(screen.getByText(CAPTION)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('estado de error con reintento, sin el caption', async () => {
    let attempts = 0;
    server.use(
      http.get(`${API}/v1/admin/reports/summary`, () => {
        attempts += 1;
        if (attempts === 1) {
          return HttpResponse.json(
            { type: 'about:blank', title: 'error', status: 500 },
            { status: 500 },
          );
        }
        return HttpResponse.json(summaryResponse());
      }),
    );

    render(<SummaryCards range={{}} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.queryByText(CAPTION)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    await waitFor(() => {
      expect(screen.getByText(CAPTION)).toBeInTheDocument();
    });
  });
});
