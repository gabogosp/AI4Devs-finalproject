import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';

// `axe-core` no es dependencia directa de este paquete (pnpm no resuelve sus
// tipos acá aunque esté presente transitivamente) — forma mínima local de lo
// que este archivo necesita, no el `Result` completo de axe-core.
interface AxeViolation {
  impact?: 'minor' | 'moderate' | 'serious' | 'critical' | null;
}
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { OrdersList } from './OrdersList';
import { OrderDetail } from './OrderDetail';
import type { OrderDetail as Order, OrderSummary } from './ordersService';

expect.extend(toHaveNoViolations);

const API = 'http://localhost:3000';
const ID = '2f1c9a4e-1111-4111-8111-111111111111';

// `region` desactivada: los componentes se montan sueltos, sin el landmark
// que aporta el layout — mismo criterio que src/features/account/a11y.test.tsx.
const auditar = async (
  container: HTMLElement,
): Promise<{ violations: AxeViolation[] }> =>
  axe(container, { rules: { region: { enabled: false } } }) as Promise<{
    violations: AxeViolation[];
  }>;

function summary(): OrderSummary {
  return {
    id: ID,
    order_number: 1000,
    buyer_name: 'Comprador de Prueba',
    total_ars_cents: 100_000,
    status: 'new',
    created_at: '2026-08-30T10:00:00.000Z',
  };
}

function detalle(): Order {
  return {
    ...summary(),
    status: 'preparing',
    buyer_email: 'comprador@test.local',
    buyer_phone: '+54 351 555 0000',
    fulfillment: 'pickup',
    items: [
      {
        product_name: 'Compresor Embraco',
        product_sku: 'REF-001',
        quantity: 1,
        unit_price_ars_cents: 100_000,
        subtotal_ars_cents: 100_000,
      },
    ],
    status_history: [
      { from_status: null, to_status: 'new', changed_by: null, changed_at: '2026-08-30T10:00:00.000Z' },
      { from_status: 'new', to_status: 'preparing', changed_by: 'admin', changed_at: '2026-08-30T10:05:00.000Z' },
    ],
  };
}

describe('Accesibilidad del panel de órdenes (T10.1)', () => {
  it('OrdersList no tiene violaciones serious/critical con datos de ejemplo', async () => {
    server.use(
      http.get(`${API}/v1/admin/orders`, () =>
        HttpResponse.json({ data: [summary()], pagination: { limit: 20, offset: 0, total: 1 } }),
      ),
    );
    const { container } = render(<OrdersList />);
    await screen.findByText('Comprador de Prueba');

    const resultados = await auditar(container);
    const graves = resultados.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(graves).toEqual([]);
  });

  it('OrderDetail no tiene violaciones serious/critical con datos de ejemplo', async () => {
    server.use(http.get(`${API}/v1/admin/orders/${ID}`, () => HttpResponse.json(detalle())));
    const { container } = render(<OrderDetail id={ID} />);
    await screen.findByText('Compresor Embraco');

    const resultados = await auditar(container);
    const graves = resultados.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(graves).toEqual([]);
  });
});
