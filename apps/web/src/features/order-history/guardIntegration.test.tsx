import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';

/**
 * T5.1 (AC-5): sin sesión, `CustomerGuard` redirige antes de montar
 * `PurchaseHistoryList`/`PurchaseDetail` — ninguna orden se renderiza mientras
 * la redirección ocurre, y ningún `fetch` a `/v1/me/orders*` se dispara.
 * Mismo patrón que `CustomerGuard.test.tsx` (US-014 T2.6).
 */
const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/mi-cuenta/compras',
}));

const { CustomerGuard } = await import('@/features/account/CustomerGuard');
const { SessionProvider } = await import('@/features/account/SessionProvider');
const { PurchaseHistoryList } = await import('./PurchaseHistoryList');
const { PurchaseDetail } = await import('./PurchaseDetail');

const SITE = 'http://localhost:3000';

afterEach(() => {
  replace.mockClear();
  window.localStorage.clear();
});

describe('CustomerGuard + order-history (T5.1, AC-5)', () => {
  it('anónimo: PurchaseHistoryList no llega a montarse ni dispara fetch a /v1/me/orders', async () => {
    let llamadas = 0;
    server.use(
      http.get(`${SITE}/v1/me/orders`, () => {
        llamadas += 1;
        return HttpResponse.json({ data: [], pagination: { limit: 20, offset: 0, total: 0 } });
      }),
    );

    render(
      <SessionProvider>
        <CustomerGuard>
          <PurchaseHistoryList />
        </CustomerGuard>
      </SessionProvider>,
    );

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/ingresar?next=%2Fmi-cuenta%2Fcompras'),
    );
    expect(screen.queryByText('Cargando tus compras…')).not.toBeInTheDocument();
    expect(llamadas).toBe(0);
  });

  it('anónimo: PurchaseDetail no llega a montarse ni dispara fetch a /v1/me/orders/{orderNumber}', async () => {
    let llamadas = 0;
    server.use(
      http.get(`${SITE}/v1/me/orders/1000`, () => {
        llamadas += 1;
        return HttpResponse.json({});
      }),
    );

    render(
      <SessionProvider>
        <CustomerGuard>
          <PurchaseDetail orderNumber="1000" />
        </CustomerGuard>
      </SessionProvider>,
    );

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/ingresar?next=%2Fmi-cuenta%2Fcompras'),
    );
    expect(screen.queryByText('Pedido #1000')).not.toBeInTheDocument();
    expect(llamadas).toBe(0);
  });
});
