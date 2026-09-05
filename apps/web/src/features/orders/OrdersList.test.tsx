import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { OrdersList } from './OrdersList';
import type { OrderSummary } from './ordersService';

const API = 'http://localhost:3000';

function orden(i: number, over: Partial<OrderSummary> = {}): OrderSummary {
  return {
    id: `1111111${i}-1111-4111-8111-111111111111`,
    order_number: 1000 + i,
    buyer_name: `Comprador ${i}`,
    total_ars_cents: 100000 + i,
    status: 'new',
    created_at: '2026-08-30T10:00:00.000Z',
    ...over,
  };
}

describe('OrdersList (T4.1, AC-1/AC-5/AC-8)', () => {
  it('filtrar por "Nuevas" manda status=new y offset=0', async () => {
    let urlCapturada = '';
    server.use(
      http.get(`${API}/v1/admin/orders`, ({ request }) => {
        urlCapturada = request.url;
        return HttpResponse.json({
          data: [orden(1)],
          pagination: { limit: 20, offset: 0, total: 1 },
        });
      }),
    );
    render(<OrdersList />);
    await screen.findByText('Comprador 1');

    fireEvent.change(screen.getByLabelText('Estado:'), { target: { value: 'new' } });

    await screen.findByText('Comprador 1');
    const params = new URL(urlCapturada).searchParams;
    expect(params.get('status')).toBe('new');
    expect(params.get('offset')).toBe('0');
  });

  it('click en el header "Fecha" manda sort=created_at (asc) y luego sort=-created_at (desc)', async () => {
    const sorts: (string | null)[] = [];
    server.use(
      http.get(`${API}/v1/admin/orders`, ({ request }) => {
        sorts.push(new URL(request.url).searchParams.get('sort'));
        return HttpResponse.json({
          data: [orden(1)],
          pagination: { limit: 20, offset: 0, total: 1 },
        });
      }),
    );
    render(<OrdersList />);
    await screen.findByText('Comprador 1');
    expect(sorts[0]).toBe('-created_at'); // default

    fireEvent.click(screen.getByRole('button', { name: 'Fecha' }));
    await screen.findByText('Comprador 1');
    expect(sorts[1]).toBe('created_at');

    fireEvent.click(screen.getByRole('button', { name: 'Fecha' }));
    await screen.findByText('Comprador 1');
    expect(sorts[2]).toBe('-created_at');
  });

  it('los headers "Cliente" y "Estado" no tienen aria-sort ni disparan una request nueva', async () => {
    let fetchCount = 0;
    server.use(
      http.get(`${API}/v1/admin/orders`, () => {
        fetchCount += 1;
        return HttpResponse.json({
          data: [orden(1)],
          pagination: { limit: 20, offset: 0, total: 1 },
        });
      }),
    );
    render(<OrdersList />);
    await screen.findByText('Comprador 1');
    const antesDelClick = fetchCount;

    const clienteHeader = screen.getByText('Cliente').closest('th')!;
    const estadoHeader = screen.getByText('Estado').closest('th')!;
    expect(clienteHeader).not.toHaveAttribute('aria-sort');
    expect(estadoHeader).not.toHaveAttribute('aria-sort');
    expect(within(clienteHeader).queryByRole('button')).toBeNull();
    expect(within(estadoHeader).queryByRole('button')).toBeNull();

    fireEvent.click(clienteHeader);
    fireEvent.click(estadoHeader);
    expect(fetchCount).toBe(antesDelClick);
  });

  it('el <select> de estado NO ofrece "pendiente de pago" (AC-8, estructural)', async () => {
    server.use(
      http.get(`${API}/v1/admin/orders`, () =>
        HttpResponse.json({ data: [], pagination: { limit: 20, offset: 0, total: 0 } }),
      ),
    );
    render(<OrdersList />);
    await screen.findByText('No hay órdenes con ese filtro.');

    expect(
      screen.queryByRole('option', { name: /pendiente de pago/i }),
    ).toBeNull();
  });
});

describe('OrdersList — estados (T4.2)', () => {
  it('loading renderiza filas skeleton, no texto plano', () => {
    server.use(
      http.get(`${API}/v1/admin/orders`, async () => {
        await new Promise((r) => setTimeout(r, 50));
        return HttpResponse.json({ data: [], pagination: { limit: 20, offset: 0, total: 0 } });
      }),
    );
    render(<OrdersList />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    const { container } = render(<OrdersList />);
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('error renderiza role="alert" + botón Reintentar que re-dispara la misma request', async () => {
    let intentos = 0;
    server.use(
      http.get(`${API}/v1/admin/orders`, () => {
        intentos += 1;
        if (intentos === 1) return HttpResponse.error();
        return HttpResponse.json({
          data: [orden(1)],
          pagination: { limit: 20, offset: 0, total: 1 },
        });
      }),
    );
    render(<OrdersList />);

    await screen.findByRole('alert');
    expect(
      screen.getByRole('button', { name: /reintentar/i }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /reintentar/i }));
    await screen.findByText('Comprador 1');
    expect(intentos).toBe(2);
  });

  it('0 resultados con un filtro activo muestra el mensaje + acción de volver a Todas', async () => {
    server.use(
      http.get(`${API}/v1/admin/orders`, () =>
        HttpResponse.json({ data: [], pagination: { limit: 20, offset: 0, total: 0 } }),
      ),
    );
    render(<OrdersList />);
    await screen.findByText('No hay órdenes con ese filtro.');

    fireEvent.change(screen.getByLabelText('Estado:'), { target: { value: 'new' } });
    await screen.findByText('No hay órdenes con ese filtro.');

    expect(
      screen.getByRole('button', { name: /volver a todas/i }),
    ).toBeInTheDocument();
  });
});
