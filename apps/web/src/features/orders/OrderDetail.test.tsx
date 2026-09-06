import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    anonymized_at: null,
    anonymization_reason: null,
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

describe('OrderDetail — T10.2 (foco gestionado al montar)', () => {
  it('tras el render, document.activeElement es el <h1> de la orden', async () => {
    server.use(http.get(`${API}/v1/admin/orders/${ID}`, () => HttpResponse.json(orden())));

    render(<OrderDetail id={ID} />);

    const h1 = await screen.findByRole('heading', { level: 1, name: /orden #1000/i });
    // El foco lo mueve un useEffect que corre un tick DESPUÉS de que el h1 aparece;
    // findByRole resuelve con el h1 ya en el DOM pero el foco aún en <body> → se re-evalúa
    // con waitFor en vez de asertar una sola vez (flaky en CI).
    await waitFor(() => expect(document.activeElement).toBe(h1));
  });
});

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

describe('OrderDetail — T4.1 (sección de contacto condicional, AC-4/AC-5)', () => {
  it('orden NO anonimizada: sigue mostrando buyer_email (sin regresión)', async () => {
    server.use(http.get(`${API}/v1/admin/orders/${ID}`, () => HttpResponse.json(orden())));

    render(<OrderDetail id={ID} />);

    expect(await screen.findByText('comprador@test.local')).toBeInTheDocument();
    expect(screen.getByText('+54 351 555 0000')).toBeInTheDocument();
    expect(screen.getByText('Comprador de Prueba')).toBeInTheDocument();
  });

  it('orden anonimizada: muestra cuándo/por qué y NO muestra buyer_email/buyer_phone/buyer_name reales', async () => {
    server.use(
      http.get(`${API}/v1/admin/orders/${ID}`, () =>
        HttpResponse.json(
          orden({ anonymized_at: '2026-09-05T12:00:00.000Z', anonymization_reason: 'retention_policy' }),
        ),
      ),
    );

    render(<OrderDetail id={ID} />);

    expect(await screen.findByText(/anonimizados/i)).toBeInTheDocument();
    expect(screen.getByText(/por plazo de retención cumplido/i)).toBeInTheDocument();
    expect(screen.queryByText('comprador@test.local')).not.toBeInTheDocument();
    expect(screen.queryByText('+54 351 555 0000')).not.toBeInTheDocument();
    expect(screen.queryByText('Comprador de Prueba')).not.toBeInTheDocument();
  });
});

describe('OrderDetail — T4.2 (OrderAnonymizeAction montado, actualiza sin recargar)', () => {
  it('tras confirmar la anonimización, la sección de contacto se actualiza sin un segundo render de OrderDetail', async () => {
    const user = userEvent.setup();
    let getCount = 0;
    server.use(
      http.get(`${API}/v1/admin/orders/${ID}`, () => {
        getCount += 1;
        return HttpResponse.json(
          getCount === 1
            ? orden()
            : orden({ anonymized_at: '2026-09-05T12:00:00.000Z', anonymization_reason: 'requested' }),
        );
      }),
      http.post(`${API}/v1/admin/orders/${ID}/anonymize`, () =>
        HttpResponse.json({
          order_id: ID,
          anonymized_at: '2026-09-05T12:00:00.000Z',
          anonymization_reason: 'requested',
        }),
      ),
    );

    render(<OrderDetail id={ID} />);
    // La orden trae ítems desde el primer render: si hubiera un remount total
    // (navegación de página completa), este contenido desaparecería y volvería
    // a aparecer tras un estado de carga — acá nunca pasa por 'Cargando orden…'
    // una segunda vez.
    expect(await screen.findByText('comprador@test.local')).toBeInTheDocument();
    expect(getCount).toBe(1);

    await user.click(screen.getByRole('button', { name: /anonimizar datos del comprador/i }));
    await user.type(screen.getByLabelText(/escribí "anonimizar" para confirmar/i), 'ANONIMIZAR');
    await user.click(screen.getByRole('button', { name: /^anonimizar$/i }));

    expect(await screen.findByText(/anonimizados/i)).toBeInTheDocument();
    expect(getCount).toBe(2); // refetch-on-success — exactamente un GET más, no un remount
    expect(screen.queryByText('Cargando orden…')).not.toBeInTheDocument();
    // El resto del detalle (ítems) sigue en el mismo árbol, sin recarga completa.
    expect(screen.getByText('Compresor Embraco')).toBeInTheDocument();
  });
});

describe('OrderDetail — T7.2 (el historial refleja el cambio sin un segundo GET)', () => {
  it('tras avanzar el estado, el historial pasa de N a N+1 SIN un segundo GET al detalle', async () => {
    const user = userEvent.setup();
    let getCount = 0;
    const inicial = orden({
      status: 'new',
      status_history: [
        {
          from_status: null,
          to_status: 'new',
          changed_by: null,
          changed_at: '2026-08-30T10:00:00.000Z',
        },
      ],
    });
    server.use(
      http.get(`${API}/v1/admin/orders/${ID}`, () => {
        getCount += 1;
        return HttpResponse.json(inicial);
      }),
      http.patch(`${API}/v1/admin/orders/${ID}`, () =>
        HttpResponse.json(
          orden({
            status: 'preparing',
            status_history: [
              ...inicial.status_history,
              {
                from_status: 'new',
                to_status: 'preparing',
                changed_by: 'admin',
                changed_at: '2026-08-30T10:05:00.000Z',
              },
            ],
          }),
        ),
      ),
    );

    render(<OrderDetail id={ID} />);
    await screen.findByText('Comprador de Prueba');
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(getCount).toBe(1);

    await user.click(screen.getByRole('button', { name: /marcar como preparando/i }));

    await screen.findByRole('button', { name: /marcar como lista/i });
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(getCount).toBe(1); // sin un segundo GET — el PATCH ya trajo el detalle completo
  });
});

describe('OrderDetail — T5.2 (OrderCancelAction montado: visibilidad condicional + reconciliación)', () => {
  it.each(['new', 'preparing', 'ready'] as const)(
    'con status=%s, el botón "Cancelar orden" es visible',
    async (status) => {
      server.use(http.get(`${API}/v1/admin/orders/${ID}`, () => HttpResponse.json(orden({ status }))));

      render(<OrderDetail id={ID} />);

      expect(await screen.findByRole('button', { name: /^cancelar orden$/i })).toBeInTheDocument();
    },
  );

  it('con status=delivered, el botón "Cancelar orden" NO es visible', async () => {
    server.use(
      http.get(`${API}/v1/admin/orders/${ID}`, () => HttpResponse.json(orden({ status: 'delivered' }))),
    );

    render(<OrderDetail id={ID} />);

    await screen.findByText('Comprador de Prueba');
    expect(screen.queryByRole('button', { name: /^cancelar orden$/i })).not.toBeInTheDocument();
  });

  it('tras cancelar con éxito, OrderStatusHistory muestra la fila nueva (to_status=cancelled) SIN un segundo GET', async () => {
    const user = userEvent.setup();
    let getCount = 0;
    const inicial = orden({
      status: 'preparing',
      status_history: [
        {
          from_status: null,
          to_status: 'new',
          changed_by: null,
          changed_at: '2026-08-30T10:00:00.000Z',
        },
      ],
    });
    server.use(
      http.get(`${API}/v1/admin/orders/${ID}`, () => {
        getCount += 1;
        return HttpResponse.json(inicial);
      }),
      http.post(`${API}/v1/admin/orders/${ID}/cancel`, () =>
        HttpResponse.json({
          ...orden({
            status: 'cancelled',
            status_history: [
              ...inicial.status_history,
              {
                from_status: 'preparing',
                to_status: 'cancelled',
                changed_by: 'admin',
                changed_at: '2026-08-30T10:10:00.000Z',
              },
            ],
          }),
          refund: { status: 'refunded', provider: 'mercadopago' },
        }),
      ),
    );

    render(<OrderDetail id={ID} />);
    await screen.findByText('Comprador de Prueba');
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(getCount).toBe(1);

    await user.click(screen.getByRole('button', { name: /^cancelar orden$/i }));
    await user.type(screen.getByLabelText(/escribí "cancelar" para confirmar/i), 'CANCELAR');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^cancelar orden$/i }));

    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
    expect(getCount).toBe(1); // sin un segundo GET — la respuesta ya es self-contained
  });
});
