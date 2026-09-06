import { describe, expect, it } from 'vitest';
import { render, screen, waitForElementToBeRemoved } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { PurchaseDetail } from './PurchaseDetail';

const SITE = 'http://localhost:3000';

function detalle(over: Record<string, unknown> = {}) {
  return {
    order_number: 1000,
    status: 'ready',
    total_ars_cents: 150_000,
    created_at: '2026-08-30T10:00:00.000Z',
    fulfillment: 'pickup',
    items: [
      {
        product_name: 'Compresor Embraco',
        product_sku: 'REF-001',
        quantity: 1,
        unit_price_ars_cents: 150_000,
        subtotal_ars_cents: 150_000,
      },
    ],
    ...over,
  };
}

describe('PurchaseDetail (T4.1)', () => {
  it('muestra role="status" mientras carga', async () => {
    server.use(
      http.get(`${SITE}/v1/me/orders/1000`, async () => {
        await new Promise((r) => setTimeout(r, 20));
        return HttpResponse.json(detalle());
      }),
    );

    render(<PurchaseDetail orderNumber="1000" />);

    const status = screen.getByRole('status');
    expect(status).toBeInTheDocument();

    // El fetch demorado resuelve ~20ms después — esperarlo acá evita que
    // siga en vuelo cuando vitest ya desmontó el entorno de este test
    // (vitest 3.x reporta el `setState` tardío como error no manejado).
    await waitForElementToBeRemoved(status);
  });

  it('en success muestra ítems, total, estado y retiro en sucursal', async () => {
    server.use(http.get(`${SITE}/v1/me/orders/1000`, () => HttpResponse.json(detalle())));

    render(<PurchaseDetail orderNumber="1000" />);

    await screen.findByText('Compresor Embraco');
    expect(screen.getByText('Pedido #1000')).toBeInTheDocument();
    expect(screen.getByText('Lista para retirar')).toBeInTheDocument();
    expect(screen.getByText('Retiro en sucursal')).toBeInTheDocument();
    expect(screen.getByText('Total: $ 1.500')).toBeInTheDocument();
  });

  it('en 404 muestra "No encontramos ese pedido" sin botón Reintentar, con link de vuelta', async () => {
    server.use(
      http.get(`${SITE}/v1/me/orders/9999`, () =>
        HttpResponse.json(
          { type: 'dsm:checkout/order-not-found', title: 'Not Found', status: 404 },
          { status: 404 },
        ),
      ),
    );

    render(<PurchaseDetail orderNumber="9999" />);

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('No encontramos ese pedido.');
    expect(screen.queryByRole('button', { name: /reintentar/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /volver a mis compras/i })).toHaveAttribute(
      'href',
      '/mi-cuenta/compras',
    );
  });

  it('en un error 500 muestra un mensaje genérico CON botón Reintentar', async () => {
    const user = userEvent.setup();
    let intentos = 0;
    server.use(
      http.get(`${SITE}/v1/me/orders/1000`, () => {
        intentos += 1;
        if (intentos === 1) return new HttpResponse(null, { status: 500 });
        return HttpResponse.json(detalle());
      }),
    );

    render(<PurchaseDetail orderNumber="1000" />);

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('No pudimos cargar el pedido.');

    await user.click(screen.getByRole('button', { name: /reintentar/i }));
    await screen.findByText('Compresor Embraco');
    expect(intentos).toBe(2);
  });

  it('con orderNumber no numérico, se comporta como 404 sin llamar a la red', async () => {
    let llamadas = 0;
    server.use(
      http.get(`${SITE}/v1/me/orders/:orderNumber`, () => {
        llamadas += 1;
        return HttpResponse.json(detalle());
      }),
    );

    render(<PurchaseDetail orderNumber="abc" />);

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('No encontramos ese pedido.');
    expect(llamadas).toBe(0);
  });
});
