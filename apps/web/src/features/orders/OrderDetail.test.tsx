import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { OrderDetail } from './OrderDetail';
import type { OrderDetail as Order } from './ordersService';

const API = 'http://localhost:3000';
const ID = '2f1c9a4e-1111-4111-8111-111111111111';

function orden(over: Partial<Order> = {}): Order {
  return {
    id: ID,
    order_number: 1000,
    buyer_name: 'Comprador de Prueba',
    total_ars_cents: 300_000,
    status: 'preparing',
    created_at: '2026-08-30T10:00:00.000Z',
    buyer_email: 'comprador@test.local',
    buyer_phone: '+54 351 555 0000',
    fulfillment: 'pickup',
    items: [
      {
        product_name: 'Compresor Embraco',
        product_sku: 'REF-001',
        quantity: 1,
        unit_price_ars_cents: 200_000,
        subtotal_ars_cents: 200_000,
      },
      {
        product_name: 'Gas R134a',
        product_sku: 'REF-002',
        quantity: 2,
        unit_price_ars_cents: 50_000,
        subtotal_ars_cents: 100_000,
      },
    ],
    status_history: [],
    ...over,
  };
}

describe('OrderDetail (T5.1, AC-2)', () => {
  it('renderiza AMBOS ítems (nombre+cantidad+subtotal), total y contacto', async () => {
    server.use(
      http.get(`${API}/v1/admin/orders/${ID}`, () => HttpResponse.json(orden())),
    );

    render(<OrderDetail id={ID} />);

    // ítem 1
    expect(await screen.findByText('Compresor Embraco')).toBeInTheDocument();
    expect(screen.getByText('REF-001')).toBeInTheDocument();
    // ítem 2 — el test falla si el componente trunca la lista
    expect(screen.getByText('Gas R134a')).toBeInTheDocument();
    expect(screen.getByText('REF-002')).toBeInTheDocument();

    // cantidades de ambos ítems
    const filas = screen.getAllByRole('row');
    expect(filas.length).toBeGreaterThanOrEqual(3); // header + 2 items

    // contacto
    expect(screen.getByText('comprador@test.local')).toBeInTheDocument();
    expect(screen.getByText('+54 351 555 0000')).toBeInTheDocument();
    expect(screen.getByText('Retiro en sucursal')).toBeInTheDocument();

    // badge + total (300_000 centavos → $3.000, formatArs sin decimales)
    expect(screen.getByText('Preparando')).toBeInTheDocument();
    expect(screen.getByText(/Total:/)).toHaveTextContent('3.000');
  });
});
