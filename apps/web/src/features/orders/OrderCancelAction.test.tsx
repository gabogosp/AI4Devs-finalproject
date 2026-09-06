import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { OrderCancelAction } from './OrderCancelAction';
import { ordersService, type OrderDetail } from './ordersService';

const API = 'http://localhost:3000';
const ID = '2f1c9a4e-1111-4111-8111-111111111111';

function orden(over: Partial<OrderDetail> = {}): OrderDetail {
  return {
    id: ID,
    order_number: 1000,
    buyer_name: 'Comprador de Prueba',
    total_ars_cents: 100_000,
    status: 'preparing',
    created_at: '2026-08-30T10:00:00.000Z',
    buyer_email: 'comprador@test.local',
    buyer_phone: '+54 351 555 0000',
    fulfillment: 'pickup',
    anonymized_at: null,
    anonymization_reason: null,
    items: [],
    status_history: [],
    ...over,
  };
}

/**
 * El trigger y el botón de confirmar del `ConfirmDialog` comparten texto
 * ("Cancelar orden", per `design.md` §D3/§D7 — mismo `confirmLabel` que el
 * título de la acción) — se desambigua acotando la consulta al `dialog`.
 */
function botonConfirmarDelDialogo() {
  return within(screen.getByRole('dialog')).getByRole('button', { name: /^cancelar orden$/i });
}

describe('OrderCancelAction — T3.1 (componente base)', () => {
  it('no renderiza nada si la orden está delivered o cancelled (AC-7)', () => {
    const { container: entregada } = render(
      <OrderCancelAction order={{ id: ID, status: 'delivered' }} onCancelled={() => {}} />,
    );
    expect(entregada).toBeEmptyDOMElement();

    const { container: cancelada } = render(
      <OrderCancelAction order={{ id: ID, status: 'cancelled' }} onCancelled={() => {}} />,
    );
    expect(cancelada).toBeEmptyDOMElement();
  });

  it('renderiza el botón para new/preparing/ready y abre el diálogo con el copy exacto', async () => {
    const user = userEvent.setup();
    render(<OrderCancelAction order={{ id: ID, status: 'preparing' }} onCancelled={() => {}} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^cancelar orden$/i }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(
      screen.getByText(
        /Se reintegra el stock de cada ítem, se gestiona el reembolso del pago y el comprador recibe un aviso por email\. Esta acción no se puede deshacer\./,
      ),
    ).toBeInTheDocument();
  });
});

describe('OrderCancelAction — T3.2 (wiring de la mutación)', () => {
  it('en éxito, llama a ordersService.cancel, cierra el diálogo y llama onCancelled con el objeto devuelto — sin refetch', async () => {
    const user = userEvent.setup();
    const onCancelled = vi.fn();
    let getLlamado = false;
    server.use(
      http.post(`${API}/v1/admin/orders/${ID}/cancel`, () =>
        HttpResponse.json({
          ...orden({ status: 'cancelled' }),
          refund: { status: 'refunded', provider: 'mercadopago' },
        }),
      ),
      http.get(`${API}/v1/admin/orders/${ID}`, () => {
        getLlamado = true;
        return HttpResponse.json(orden());
      }),
    );

    render(<OrderCancelAction order={{ id: ID, status: 'preparing' }} onCancelled={onCancelled} />);

    await user.click(screen.getByRole('button', { name: /^cancelar orden$/i }));
    await user.type(screen.getByLabelText(/escribí "cancelar" para confirmar/i), 'CANCELAR');
    await user.click(botonConfirmarDelDialogo());

    await waitFor(() => expect(onCancelled).toHaveBeenCalledTimes(1));
    expect(onCancelled).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'cancelled', refund: { status: 'refunded', provider: 'mercadopago' } }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(getLlamado).toBe(false);
  });

  it.each([
    ['refunded', 'Se canceló la orden y se reintegró el pago.'],
    [
      'refund_pending',
      'Se canceló la orden. El reembolso quedó en curso — el sistema lo reintenta automáticamente.',
    ],
    ['not_applicable', 'Se canceló la orden.'],
  ] as const)('con refund.status=%s, muestra el mensaje correspondiente', async (status, esperado) => {
    const user = userEvent.setup();
    server.use(
      http.post(`${API}/v1/admin/orders/${ID}/cancel`, () =>
        HttpResponse.json({
          ...orden({ status: 'cancelled' }),
          refund: { status, provider: status === 'not_applicable' ? null : 'simulated_dsm' },
        }),
      ),
    );

    render(<OrderCancelAction order={{ id: ID, status: 'preparing' }} onCancelled={() => {}} />);

    await user.click(screen.getByRole('button', { name: /^cancelar orden$/i }));
    await user.type(screen.getByLabelText(/escribí "cancelar" para confirmar/i), 'CANCELAR');
    await user.click(botonConfirmarDelDialogo());

    expect(await screen.findByRole('status')).toHaveTextContent(esperado);
  });
});

describe('OrderCancelAction — T3.3 (confirmWord)', () => {
  it('el botón de confirmar está deshabilitado hasta tipear "CANCELAR"', async () => {
    const user = userEvent.setup();
    render(<OrderCancelAction order={{ id: ID, status: 'preparing' }} onCancelled={() => {}} />);

    await user.click(screen.getByRole('button', { name: /^cancelar orden$/i }));
    const confirmar = botonConfirmarDelDialogo();
    expect(confirmar).toBeDisabled();

    await user.type(screen.getByLabelText(/escribí "cancelar" para confirmar/i), 'CANCELAR');

    expect(confirmar).toBeEnabled();
  });
});

describe('OrderCancelAction — T4.1 (mensajes de error)', () => {
  it('en 409, muestra el mensaje específico y el diálogo NO se cierra', async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${API}/v1/admin/orders/${ID}/cancel`, () =>
        HttpResponse.json(
          {
            type: 'dsm:payments/order-cannot-be-cancelled',
            title: 'Conflict',
            status: 409,
            detail: 'x',
          },
          { status: 409, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
    );

    render(<OrderCancelAction order={{ id: ID, status: 'preparing' }} onCancelled={() => {}} />);

    await user.click(screen.getByRole('button', { name: /^cancelar orden$/i }));
    await user.type(screen.getByLabelText(/escribí "cancelar" para confirmar/i), 'CANCELAR');
    await user.click(botonConfirmarDelDialogo());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /la orden ya no puede cancelarse/i,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('en 404, muestra "La orden ya no existe." y el diálogo NO se cierra', async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${API}/v1/admin/orders/${ID}/cancel`, () =>
        HttpResponse.json(
          { type: 'dsm:payments/order-not-found', title: 'Not found', status: 404, detail: 'x' },
          { status: 404, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
    );

    render(<OrderCancelAction order={{ id: ID, status: 'preparing' }} onCancelled={() => {}} />);

    await user.click(screen.getByRole('button', { name: /^cancelar orden$/i }));
    await user.type(screen.getByLabelText(/escribí "cancelar" para confirmar/i), 'CANCELAR');
    await user.click(botonConfirmarDelDialogo());

    expect(await screen.findByRole('alert')).toHaveTextContent(/la orden ya no existe/i);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('en 500/network, muestra el mensaje genérico y el diálogo NO se cierra', async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${API}/v1/admin/orders/${ID}/cancel`, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Server error', status: 500 },
          { status: 500, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
    );

    render(<OrderCancelAction order={{ id: ID, status: 'preparing' }} onCancelled={() => {}} />);

    await user.click(screen.getByRole('button', { name: /^cancelar orden$/i }));
    await user.type(screen.getByLabelText(/escribí "cancelar" para confirmar/i), 'CANCELAR');
    await user.click(botonConfirmarDelDialogo());

    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudo cancelar\. reintentá\./i);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('OrderCancelAction — regresión QA-013-E2E-3 (mensaje sobrevive al re-render del padre)', () => {
  it('el mensaje de éxito sigue visible cuando el padre re-renderiza con order.status="cancelled" (mismo prop que pasaría OrderDetail vía onCancelled)', async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${API}/v1/admin/orders/${ID}/cancel`, () =>
        HttpResponse.json({
          ...orden({ status: 'cancelled' }),
          refund: { status: 'refunded', provider: 'mercadopago' },
        }),
      ),
    );

    const { rerender } = render(
      <OrderCancelAction order={{ id: ID, status: 'preparing' }} onCancelled={() => {}} />,
    );

    await user.click(screen.getByRole('button', { name: /^cancelar orden$/i }));
    await user.type(screen.getByLabelText(/escribí "cancelar" para confirmar/i), 'CANCELAR');
    await user.click(botonConfirmarDelDialogo());

    await screen.findByRole('status');

    // Simula lo que OrderDetail hace de verdad: onCancelled → setState → el
    // padre re-renderiza este componente con el order.status YA actualizado.
    rerender(<OrderCancelAction order={{ id: ID, status: 'cancelled' }} onCancelled={() => {}} />);

    expect(screen.getByRole('status')).toHaveTextContent(
      'Se canceló la orden y se reintegró el pago.',
    );
    // El gate SÍ sigue ocultando una nueva cancelación (AC-7 — no se reofrece la acción).
    expect(screen.queryByRole('button', { name: /^cancelar orden$/i })).not.toBeInTheDocument();
  });
});

describe('OrderCancelAction — T4.2 (idempotencia visual)', () => {
  it('el botón de confirmar queda deshabilitado mientras la mutación está en curso — un doble-click no dispara un segundo POST', async () => {
    const user = userEvent.setup();
    let llamadas = 0;
    let resolverPost!: () => void;
    server.use(
      http.post(`${API}/v1/admin/orders/${ID}/cancel`, async () => {
        llamadas += 1;
        await new Promise<void>((resolve) => {
          resolverPost = resolve;
        });
        return HttpResponse.json({
          ...orden({ status: 'cancelled' }),
          refund: { status: 'refunded', provider: 'mercadopago' },
        });
      }),
    );

    render(<OrderCancelAction order={{ id: ID, status: 'preparing' }} onCancelled={() => {}} />);

    await user.click(screen.getByRole('button', { name: /^cancelar orden$/i }));
    await user.type(screen.getByLabelText(/escribí "cancelar" para confirmar/i), 'CANCELAR');
    const confirmar = botonConfirmarDelDialogo();

    await user.click(confirmar);
    await waitFor(() => expect(confirmar).toBeDisabled());
    await user.click(confirmar);

    expect(llamadas).toBe(1);
    resolverPost();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('OrderCancelAction — T4.3 (foco y Escape del ConfirmDialog reusado)', () => {
  it('Escape cierra el diálogo sin ejecutar la mutación', async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(ordersService, 'cancel');

    render(<OrderCancelAction order={{ id: ID, status: 'preparing' }} onCancelled={() => {}} />);

    await user.click(screen.getByRole('button', { name: /^cancelar orden$/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();

    spy.mockRestore();
  });

  it('el foco entra al input de confirmación al abrir el diálogo', async () => {
    const user = userEvent.setup();
    render(<OrderCancelAction order={{ id: ID, status: 'preparing' }} onCancelled={() => {}} />);

    await user.click(screen.getByRole('button', { name: /^cancelar orden$/i }));

    await waitFor(() =>
      expect(screen.getByLabelText(/escribí "cancelar" para confirmar/i)).toHaveFocus(),
    );
  });
});
