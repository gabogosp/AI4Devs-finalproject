import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { OrderAnonymizeAction } from './OrderAnonymizeAction';
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

describe('OrderAnonymizeAction — T3.1 (componente base)', () => {
  it('no renderiza nada si la orden ya está anonimizada (AC-8)', () => {
    const { container } = render(
      <OrderAnonymizeAction
        order={{ id: ID, anonymizedAt: '2026-09-01T00:00:00.000Z', anonymizationReason: 'requested' }}
        onAnonymized={() => {}}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('abre el ConfirmDialog al click', async () => {
    const user = userEvent.setup();
    render(
      <OrderAnonymizeAction
        order={{ id: ID, anonymizedAt: null, anonymizationReason: null }}
        onAnonymized={() => {}}
      />,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /anonimizar datos del comprador/i }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('el botón de confirmar está deshabilitado hasta tipear la palabra exacta', async () => {
    const user = userEvent.setup();
    render(
      <OrderAnonymizeAction
        order={{ id: ID, anonymizedAt: null, anonymizationReason: null }}
        onAnonymized={() => {}}
      />,
    );

    await user.click(screen.getByRole('button', { name: /anonimizar datos del comprador/i }));
    const confirmar = screen.getByRole('button', { name: /^anonimizar$/i });
    expect(confirmar).toBeDisabled();

    await user.type(screen.getByLabelText(/escribí "anonimizar" para confirmar/i), 'ANONIMIZAR');

    expect(confirmar).toBeEnabled();
  });
});

describe('OrderAnonymizeAction — T3.2 (wiring de la mutación)', () => {
  it('en éxito, llama a ordersService.anonymize, refetchea y llama onAnonymized con el objeto refrescado', async () => {
    const user = userEvent.setup();
    const onAnonymized = vi.fn();
    server.use(
      http.post(`${API}/v1/admin/orders/${ID}/anonymize`, () =>
        HttpResponse.json({
          order_id: ID,
          anonymized_at: '2026-09-05T12:00:00.000Z',
          anonymization_reason: 'requested',
        }),
      ),
      http.get(`${API}/v1/admin/orders/${ID}`, () =>
        HttpResponse.json(
          orden({ anonymized_at: '2026-09-05T12:00:00.000Z', anonymization_reason: 'requested' }),
        ),
      ),
    );

    render(
      <OrderAnonymizeAction
        order={{ id: ID, anonymizedAt: null, anonymizationReason: null }}
        onAnonymized={onAnonymized}
      />,
    );

    await user.click(screen.getByRole('button', { name: /anonimizar datos del comprador/i }));
    await user.type(screen.getByLabelText(/escribí "anonimizar" para confirmar/i), 'ANONIMIZAR');
    await user.click(screen.getByRole('button', { name: /^anonimizar$/i }));

    await waitFor(() => expect(onAnonymized).toHaveBeenCalledTimes(1));
    expect(onAnonymized).toHaveBeenCalledWith(
      expect.objectContaining({ anonymized_at: '2026-09-05T12:00:00.000Z', anonymization_reason: 'requested' }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByRole('status')).toHaveTextContent(/se anonimizaron los datos del comprador/i);
  });

  it('en error 404, muestra un mensaje distinto y el diálogo NO se cierra', async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${API}/v1/admin/orders/${ID}/anonymize`, () =>
        HttpResponse.json(
          { type: 'dsm:orders/not-found', title: 'Not found', status: 404, detail: 'x' },
          { status: 404, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
    );

    render(
      <OrderAnonymizeAction
        order={{ id: ID, anonymizedAt: null, anonymizationReason: null }}
        onAnonymized={() => {}}
      />,
    );

    await user.click(screen.getByRole('button', { name: /anonimizar datos del comprador/i }));
    await user.type(screen.getByLabelText(/escribí "anonimizar" para confirmar/i), 'ANONIMIZAR');
    await user.click(screen.getByRole('button', { name: /^anonimizar$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/la orden ya no existe/i);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('en error 500/network, muestra el mensaje genérico y el diálogo NO se cierra', async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${API}/v1/admin/orders/${ID}/anonymize`, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Server error', status: 500 },
          { status: 500, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
    );

    render(
      <OrderAnonymizeAction
        order={{ id: ID, anonymizedAt: null, anonymizationReason: null }}
        onAnonymized={() => {}}
      />,
    );

    await user.click(screen.getByRole('button', { name: /anonimizar datos del comprador/i }));
    await user.type(screen.getByLabelText(/escribí "anonimizar" para confirmar/i), 'ANONIMIZAR');
    await user.click(screen.getByRole('button', { name: /^anonimizar$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudo anonimizar\. reintentá\./i);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('OrderAnonymizeAction — T3.3 (copy y tono)', () => {
  it('muestra el copy exacto de irreversibilidad', async () => {
    const user = userEvent.setup();
    render(
      <OrderAnonymizeAction
        order={{ id: ID, anonymizedAt: null, anonymizationReason: null }}
        onAnonymized={() => {}}
      />,
    );

    await user.click(screen.getByRole('button', { name: /anonimizar datos del comprador/i }));

    expect(screen.getByText(/Esta acción no se puede deshacer/)).toBeInTheDocument();
  });
});

describe('OrderAnonymizeAction — T6.2 (foco y Escape del ConfirmDialog reusado)', () => {
  it('Escape cierra el diálogo sin ejecutar la mutación', async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(ordersService, 'anonymize');

    render(
      <OrderAnonymizeAction
        order={{ id: ID, anonymizedAt: null, anonymizationReason: null }}
        onAnonymized={() => {}}
      />,
    );

    await user.click(screen.getByRole('button', { name: /anonimizar datos del comprador/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();

    spy.mockRestore();
  });

  it('el foco entra al input de confirmación al abrir el diálogo', async () => {
    const user = userEvent.setup();
    render(
      <OrderAnonymizeAction
        order={{ id: ID, anonymizedAt: null, anonymizationReason: null }}
        onAnonymized={() => {}}
      />,
    );

    await user.click(screen.getByRole('button', { name: /anonimizar datos del comprador/i }));

    await waitFor(() =>
      expect(screen.getByLabelText(/escribí "anonimizar" para confirmar/i)).toHaveFocus(),
    );
  });
});
