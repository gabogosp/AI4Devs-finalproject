import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';

// `axe-core` no es dependencia directa de este paquete (mismo criterio que
// `apps/web/src/features/orders/a11y.test.tsx`) — forma mínima local de lo
// que este archivo necesita, no el `Result` completo de axe-core.
interface AxeViolation {
  impact?: 'minor' | 'moderate' | 'serious' | 'critical' | null;
}
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { PurchaseHistoryList } from './PurchaseHistoryList';
import { PurchaseDetail } from './PurchaseDetail';

expect.extend(toHaveNoViolations);

const SITE = 'http://localhost:3000';

// `region` desactivada: los componentes se montan sueltos, sin el landmark
// que aporta el layout — mismo criterio que `features/orders/a11y.test.tsx`.
const auditar = async (
  container: HTMLElement,
): Promise<{ violations: AxeViolation[] }> =>
  axe(container, { rules: { region: { enabled: false } } }) as Promise<{
    violations: AxeViolation[];
  }>;

function orden(orderNumber: number) {
  return {
    order_number: orderNumber,
    status: 'delivered',
    total_ars_cents: 150_000,
    created_at: '2026-08-30T10:00:00.000Z',
  };
}

describe('Accesibilidad del historial de compras (T7.1)', () => {
  it('PurchaseHistoryList con datos no tiene violaciones serious/critical', async () => {
    server.use(
      http.get(`${SITE}/v1/me/orders`, () =>
        HttpResponse.json({
          data: [orden(1000), orden(1001)],
          pagination: { limit: 20, offset: 0, total: 2 },
        }),
      ),
    );
    const { container } = render(<PurchaseHistoryList />);
    await screen.findByText('Pedido #1000');

    const resultados = await auditar(container);
    const graves = resultados.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(graves).toEqual([]);
  });

  it('PurchaseHistoryList en estado vacío no tiene violaciones serious/critical', async () => {
    server.use(
      http.get(`${SITE}/v1/me/orders`, () =>
        HttpResponse.json({ data: [], pagination: { limit: 20, offset: 0, total: 0 } }),
      ),
    );
    const { container } = render(<PurchaseHistoryList />);
    await screen.findByText('Todavía no compraste nada');

    const resultados = await auditar(container);
    const graves = resultados.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(graves).toEqual([]);
  });

  it('PurchaseDetail con datos no tiene violaciones serious/critical', async () => {
    server.use(
      http.get(`${SITE}/v1/me/orders/1000`, () =>
        HttpResponse.json({
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
        }),
      ),
    );
    const { container } = render(<PurchaseDetail orderNumber="1000" />);
    await screen.findByText('Compresor Embraco');

    const resultados = await auditar(container);
    const graves = resultados.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(graves).toEqual([]);
  });
});
