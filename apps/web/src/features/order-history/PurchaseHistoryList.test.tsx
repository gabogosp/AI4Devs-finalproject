import { describe, expect, it } from 'vitest';
import { render, screen, within, waitForElementToBeRemoved } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { PurchaseHistoryList } from './PurchaseHistoryList';

const SITE = 'http://localhost:3000';

function orden(orderNumber: number, over: Record<string, unknown> = {}) {
  return {
    order_number: orderNumber,
    status: 'delivered',
    total_ars_cents: 150_000,
    created_at: '2026-08-30T10:00:00.000Z',
    ...over,
  };
}

describe('PurchaseHistoryList (T3.1)', () => {
  it('muestra role="status" mientras carga', async () => {
    server.use(
      http.get(`${SITE}/v1/me/orders`, async () => {
        await new Promise((r) => setTimeout(r, 20));
        return HttpResponse.json({ data: [], pagination: { limit: 20, offset: 0, total: 0 } });
      }),
    );

    render(<PurchaseHistoryList />);

    const status = screen.getByRole('status');
    expect(status).toBeInTheDocument();

    // El fetch demorado resuelve ~20ms después — esperarlo acá evita que
    // siga en vuelo cuando vitest ya desmontó el entorno de este test
    // (vitest 3.x reporta el `setState` tardío como error no manejado).
    await waitForElementToBeRemoved(status);
  });

  it('con 2+ órdenes, renderiza en el mismo orden que devuelve la API (sin reordenar)', async () => {
    server.use(
      http.get(`${SITE}/v1/me/orders`, () =>
        HttpResponse.json({
          data: [
            orden(1002, { created_at: '2026-09-01T10:00:00.000Z' }),
            orden(1001, { created_at: '2026-08-30T10:00:00.000Z' }),
          ],
          pagination: { limit: 20, offset: 0, total: 2 },
        }),
      ),
    );

    render(<PurchaseHistoryList />);

    await screen.findByText('Pedido #1002');
    const filas = screen.getAllByRole('link').map((el) => el.textContent);
    expect(filas[0]).toContain('1002');
    expect(filas[1]).toContain('1001');
  });

  it('muestra fecha, estado y total ARS por orden, con link al detalle', async () => {
    server.use(
      http.get(`${SITE}/v1/me/orders`, () =>
        HttpResponse.json({
          data: [orden(1000, { status: 'ready', total_ars_cents: 250_000 })],
          pagination: { limit: 20, offset: 0, total: 1 },
        }),
      ),
    );

    render(<PurchaseHistoryList />);

    const link = await screen.findByRole('link', { name: /pedido #1000/i });
    expect(link).toHaveAttribute('href', '/mi-cuenta/compras/1000');
    expect(within(link).getByText('Lista para retirar')).toBeInTheDocument();
    expect(within(link).getByText('$ 2.500')).toBeInTheDocument();
  });

  it('en error muestra role="alert" con botón Reintentar que vuelve a pedir', async () => {
    const user = userEvent.setup();
    let intentos = 0;
    server.use(
      http.get(`${SITE}/v1/me/orders`, () => {
        intentos += 1;
        if (intentos === 1) {
          return new HttpResponse(null, { status: 500 });
        }
        return HttpResponse.json({
          data: [orden(1000)],
          pagination: { limit: 20, offset: 0, total: 1 },
        });
      }),
    );

    render(<PurchaseHistoryList />);

    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: /reintentar/i }));

    await screen.findByText('Pedido #1000');
    expect(intentos).toBe(2);
  });
});

describe('PurchaseHistoryList — "Cargar más" (T3.2)', () => {
  it('aparece cuando total > limit, agrega resultados sin reemplazar los ya mostrados, y desaparece al llegar al total', async () => {
    const user = userEvent.setup();
    const primeraPagina = Array.from({ length: 20 }, (_, i) => orden(1000 + i));
    const segundaPagina = Array.from({ length: 5 }, (_, i) => orden(1020 + i));

    server.use(
      http.get(`${SITE}/v1/me/orders`, ({ request }) => {
        const offset = new URL(request.url).searchParams.get('offset');
        if (offset === '20') {
          return HttpResponse.json({
            data: segundaPagina,
            pagination: { limit: 20, offset: 20, total: 25 },
          });
        }
        return HttpResponse.json({
          data: primeraPagina,
          pagination: { limit: 20, offset: 0, total: 25 },
        });
      }),
    );

    render(<PurchaseHistoryList />);

    await screen.findByText('Pedido #1000');
    expect(screen.getAllByRole('link')).toHaveLength(20);

    const cargarMas = screen.getByRole('button', { name: /cargar más/i });
    await user.click(cargarMas);

    await screen.findByText('Pedido #1024');
    // las 20 filas originales siguen presentes tras el click
    expect(screen.getByText('Pedido #1000')).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(25);
    expect(screen.queryByRole('button', { name: /cargar más/i })).not.toBeInTheDocument();
  });
});

describe('PurchaseHistoryList — estado vacío (T3.3)', () => {
  it('con data: [], muestra "Todavía no compraste nada" y el link a /categorias, no un botón "Cargar más"', async () => {
    server.use(
      http.get(`${SITE}/v1/me/orders`, () =>
        HttpResponse.json({ data: [], pagination: { limit: 20, offset: 0, total: 0 } }),
      ),
    );

    render(<PurchaseHistoryList />);

    await screen.findByText('Todavía no compraste nada');
    const link = screen.getByRole('link', { name: /ver rubros/i });
    expect(link).toHaveAttribute('href', '/categorias');
    expect(screen.queryByRole('button', { name: /cargar más/i })).not.toBeInTheDocument();
  });
});
