import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { TopProductsTable } from './TopProductsTable';

const API = 'http://localhost:3000';

function topProductsResponse(data: unknown[] = [
  {
    product_id: 'a1111111-1111-4111-8111-111111111111',
    product_name: 'Heladera',
    product_sku: 'REF-1',
    quantity_sold: 10,
    revenue_ars_cents: 500_000,
  },
  {
    product_id: 'b2222222-2222-4222-8222-222222222222',
    product_name: 'Lavarropas',
    product_sku: 'REF-2',
    quantity_sold: 4,
    revenue_ars_cents: 200_000,
  },
]) {
  return {
    range: { from: '2026-08-01T00:00:00Z', to: '2026-08-31T23:59:59Z' },
    data,
  };
}

describe('TopProductsTable', () => {
  it('muestra loading y luego la tabla con filas en el orden del backend', async () => {
    server.use(
      http.get(`${API}/v1/admin/reports/top-products`, () =>
        HttpResponse.json(topProductsResponse()),
      ),
    );

    render(<TopProductsTable range={{}} />);

    expect(screen.getByRole('status')).toHaveTextContent(/Cargando/);

    await waitFor(() => {
      expect(screen.getByText('Heladera')).toBeInTheDocument();
    });

    const filas = screen.getAllByRole('row').slice(1); // sin el header
    expect(within(filas[0]).getByText('Heladera')).toBeInTheDocument();
    expect(within(filas[1]).getByText('Lavarropas')).toBeInTheDocument();
  });

  it('estado vacío explícito cuando data.length === 0, nunca error', async () => {
    server.use(
      http.get(`${API}/v1/admin/reports/top-products`, () =>
        HttpResponse.json(topProductsResponse([])),
      ),
    );

    render(<TopProductsTable range={{}} />);

    await waitFor(() => {
      expect(screen.getByTestId('top-products-empty-state')).toBeInTheDocument();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('estado de error con reintento', async () => {
    let attempts = 0;
    server.use(
      http.get(`${API}/v1/admin/reports/top-products`, () => {
        attempts += 1;
        if (attempts === 1) {
          return HttpResponse.json(
            { type: 'about:blank', title: 'error', status: 500 },
            { status: 500 },
          );
        }
        return HttpResponse.json(topProductsResponse());
      }),
    );

    render(<TopProductsTable range={{}} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    await waitFor(() => {
      expect(screen.getByText('Heladera')).toBeInTheDocument();
    });
  });
});
