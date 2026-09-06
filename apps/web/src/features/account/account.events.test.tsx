import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { setEventSink } from '@/lib/observability/events';
import { DeleteAccountSection } from './DeleteAccountSection';
import { SessionProvider } from './SessionProvider';
import { SESSION_HINT_KEY } from './sessionState';

/**
 * US-020 T6.2 — calcado a `orders/orders.events.test.tsx` (T9.1): nombre/
 * email "centinela" reconocibles que fallan el test si aparecen en el volcado
 * JSON de los eventos capturados.
 */
const SITE = 'http://localhost:3000';
const NOMBRE_RECONOCIBLE = 'CENTINELA-Cliente-Real';
const EMAIL_RECONOCIBLE = 'centinela-real@no-debe-filtrarse.test';

const customer = {
  id: '55555555-5555-4555-8555-555555555555',
  email: EMAIL_RECONOCIBLE,
  name: NOMBRE_RECONOCIBLE,
  phone: null,
  created_at: '2026-08-22T12:00:00Z',
};

async function montarYAbrir(user: ReturnType<typeof userEvent.setup>) {
  window.localStorage.setItem(SESSION_HINT_KEY, '1');
  server.use(http.get(`${SITE}/v1/auth/me`, () => HttpResponse.json(customer)));

  render(
    <SessionProvider>
      <DeleteAccountSection onDeleted={() => {}} />
    </SessionProvider>,
  );

  await waitFor(() =>
    expect(screen.getByRole('button', { name: /^eliminar mi cuenta$/i })).toBeInTheDocument(),
  );
  await user.click(screen.getByRole('button', { name: /^eliminar mi cuenta$/i }));
  await user.type(screen.getByLabelText(/escribí "eliminar" para confirmar/i), 'ELIMINAR');
  const dialog = screen.getByRole('dialog');
  const confirmar = screen
    .getAllByRole('button', { name: /^eliminar mi cuenta$/i })
    .find((el) => dialog.contains(el))!;
  await user.click(confirmar);
}

describe('eventos del borrado de cuenta (US-020 T6.2, AC-14)', () => {
  let eventos: Array<{ event: string; props: Record<string, unknown> }>;

  beforeEach(() => {
    eventos = [];
    setEventSink((event, props) => eventos.push({ event, props: props as Record<string, unknown> }));
  });
  afterEach(() => {
    setEventSink(() => {});
    window.localStorage.clear();
  });

  it('camino de éxito: attempted antes de succeeded, nunca blocked/failed, sin PII', async () => {
    const user = userEvent.setup();
    server.use(http.delete(`${SITE}/v1/me`, () => new HttpResponse(null, { status: 204 })));

    await montarYAbrir(user);

    await waitFor(() => expect(eventos.some((e) => e.event === 'account_delete_succeeded')).toBe(true));
    const nombres = eventos.map((e) => e.event);
    expect(nombres).toEqual(['account_delete_attempted', 'account_delete_succeeded']);
    expect(nombres).not.toContain('account_delete_blocked');
    expect(nombres).not.toContain('account_delete_failed');

    const volcado = JSON.stringify(eventos);
    expect(volcado).not.toContain(NOMBRE_RECONOCIBLE);
    expect(volcado).not.toContain(EMAIL_RECONOCIBLE);
  });

  it('camino de bloqueo: attempted seguido de blocked, nunca succeeded, sin order_number/importe/PII', async () => {
    const user = userEvent.setup();
    server.use(
      http.delete(`${SITE}/v1/me`, () =>
        HttpResponse.json(
          {
            type: 'dsm:account/active-orders',
            status: 409,
            blocking_orders: [
              {
                order_number: 987654,
                status: 'pending_payment',
                total_ars_cents: 12_345_600,
                created_at: '2026-01-01T00:00:00Z',
              },
            ],
          },
          { status: 409 },
        ),
      ),
    );

    await montarYAbrir(user);

    await waitFor(() => expect(eventos.some((e) => e.event === 'account_delete_blocked')).toBe(true));
    const nombres = eventos.map((e) => e.event);
    expect(nombres).toEqual(['account_delete_attempted', 'account_delete_blocked']);
    expect(nombres).not.toContain('account_delete_succeeded');

    const volcado = JSON.stringify(eventos);
    expect(volcado).not.toContain(NOMBRE_RECONOCIBLE);
    expect(volcado).not.toContain(EMAIL_RECONOCIBLE);
    // Ninguno de los 4 eventos lleva el detalle de los pedidos bloqueantes.
    expect(volcado).not.toContain('987654');
    expect(volcado).not.toContain('12345600');
  });

  it('ninguno de los 4 eventos lleva propiedades (mismo criterio que login_failed)', async () => {
    const user = userEvent.setup();
    server.use(http.delete(`${SITE}/v1/me`, () => new HttpResponse(null, { status: 204 })));

    await montarYAbrir(user);

    await waitFor(() => expect(eventos.length).toBeGreaterThan(0));
    for (const e of eventos) {
      expect(e.props).toEqual({});
    }
  });
});
