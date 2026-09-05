import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse, delay } from 'msw';
import { server } from '@/test/server';
import { OrderStatusActions } from './OrderStatusActions';
import type { OrderDetail, OrderStatus } from './ordersService';

const API = 'http://localhost:3000';
const ID = '2f1c9a4e-1111-4111-8111-111111111111';

function orden(status: OrderStatus): OrderDetail {
  return {
    id: ID,
    order_number: 1000,
    buyer_name: 'Comprador de Prueba',
    total_ars_cents: 100_000,
    status,
    created_at: '2026-08-30T10:00:00.000Z',
    buyer_email: 'comprador@test.local',
    buyer_phone: '+54 351 555 0000',
    fulfillment: 'pickup',
    items: [],
    status_history: [],
  };
}

/** Harness: sostiene el status en un padre, como haría OrderDetail (Fase 7). */
function Harness({
  initial,
  onStatusChange,
}: {
  initial: OrderStatus;
  onStatusChange?: (s: OrderStatus) => void;
}) {
  const [status, setStatus] = useState<OrderStatus>(initial);
  const update = (s: OrderStatus) => {
    setStatus(s);
    onStatusChange?.(s);
  };
  return (
    <OrderStatusActions
      order={{ id: ID, status }}
      onOptimisticUpdate={update}
      onConfirmed={(o) => update(o.status)}
    />
  );
}

describe('OrderStatusActions — T6.1 (AC-3/AC-6, UI optimista + rollback)', () => {
  it("exactamente 1 botón 'Marcar...' para status:'new', 0 para 'delivered'", () => {
    const { unmount } = render(<Harness initial="new" />);
    expect(screen.getAllByRole('button', { name: /marcar/i })).toHaveLength(1);
    expect(screen.getByRole('button', { name: /marcar como preparando/i })).toBeInTheDocument();
    unmount();

    render(<Harness initial="delivered" />);
    expect(screen.queryAllByRole('button', { name: /marcar/i })).toHaveLength(0);
  });

  it('el click cambia el estado ANTES de que resuelva la promesa (optimista)', async () => {
    const user = userEvent.setup();
    server.use(
      http.patch(`${API}/v1/admin/orders/${ID}`, async () => {
        await delay(50);
        return HttpResponse.json(orden('preparing'));
      }),
    );
    let estadoActual: OrderStatus = 'new';
    render(<Harness initial="new" onStatusChange={(s) => (estadoActual = s)} />);

    await user.click(screen.getByRole('button', { name: /marcar/i }));
    // Justo después del click, antes de que el delay(50) resuelva: ya optimista.
    expect(estadoActual).toBe('preparing');
  });

  it('con 409 (dsm:orders/invalid-transition), el estado vuelve al original + role=alert', async () => {
    const user = userEvent.setup();
    server.use(
      http.patch(`${API}/v1/admin/orders/${ID}`, () =>
        HttpResponse.json(
          {
            type: 'dsm:orders/invalid-transition',
            title: 'Conflict',
            status: 409,
            detail: 'No se puede pasar de "new" a "preparing"',
          },
          { status: 409, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
    );
    let estadoActual: OrderStatus = 'new';
    render(<Harness initial="new" onStatusChange={(s) => (estadoActual = s)} />);

    await user.click(screen.getByRole('button', { name: /marcar/i }));

    await screen.findByRole('alert');
    expect(estadoActual).toBe('new'); // rollback — nunca quedó confirmado en 'preparing'
  });
});

describe('OrderStatusActions — T6.2 (AC-4, mensaje sólo en ready)', () => {
  it("preparing → ready muestra 'Se avisó al cliente...'", async () => {
    const user = userEvent.setup();
    server.use(
      http.patch(`${API}/v1/admin/orders/${ID}`, () => HttpResponse.json(orden('ready'))),
    );
    render(<Harness initial="preparing" />);

    await user.click(screen.getByRole('button', { name: /marcar/i }));

    expect(await screen.findByText(/se avisó al cliente/i)).toBeInTheDocument();
  });

  it('new → preparing NO muestra el mensaje de aviso', async () => {
    const user = userEvent.setup();
    server.use(
      http.patch(`${API}/v1/admin/orders/${ID}`, () => HttpResponse.json(orden('preparing'))),
    );
    render(<Harness initial="new" />);

    await user.click(screen.getByRole('button', { name: /marcar/i }));

    await screen.findByRole('button', { name: /marcar como lista/i });
    expect(screen.queryByText(/se avisó al cliente/i)).toBeNull();
  });
});

describe('OrderStatusActions — T6.3 (dedupe de clicks)', () => {
  it('2 clicks rápidos sólo disparan 1 PATCH', async () => {
    const user = userEvent.setup();
    let cuenta = 0;
    server.use(
      http.patch(`${API}/v1/admin/orders/${ID}`, async () => {
        cuenta += 1;
        await delay(30);
        return HttpResponse.json(orden('preparing'));
      }),
    );
    render(<Harness initial="new" />);

    const boton = screen.getByRole('button', { name: /marcar/i });
    await user.click(boton);
    await user.click(boton); // el botón ya está disabled/loading acá

    await screen.findByRole('button', { name: /marcar como lista/i });
    expect(cuenta).toBe(1);
  });
});
