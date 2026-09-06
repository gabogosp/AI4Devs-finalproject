import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { SessionProvider, useSession } from './SessionProvider';
import { SESSION_HINT_KEY } from './sessionState';
import { accountService } from './accountService';
import { DeleteAccountSection } from './DeleteAccountSection';

const SITE = 'http://localhost:3000';
const customer = {
  id: '55555555-5555-4555-8555-555555555555',
  email: 'ana@example.com',
  name: 'Ana Gómez',
  phone: null,
  avatar_url: null,
  created_at: '2026-08-22T12:00:00Z',
};

afterEach(() => window.localStorage.clear());

/**
 * `DeleteAccountSection` lee `useSession()` (necesita `accountDeleted`) —
 * mismo envoltorio que `AccountPanel.test.tsx`, con la sesión ya resuelta
 * `authenticated` antes de cada aserción.
 */
async function montar(onDeleted: () => void = () => {}) {
  window.localStorage.setItem(SESSION_HINT_KEY, '1');
  server.use(http.get(`${SITE}/v1/auth/me`, () => HttpResponse.json(customer)));

  render(
    <SessionProvider>
      <DeleteAccountSection onDeleted={onDeleted} />
    </SessionProvider>,
  );

  // Espera a que la sesión resuelva — `useSession()` no depende de eso, pero
  // evita un warning de "act" por el efecto de `SessionProvider` en curso.
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /^eliminar mi cuenta$/i })).toBeInTheDocument(),
  );
}

describe('DeleteAccountSection — T3.4 (componente base)', () => {
  it('renderiza el botón y la descripción de qué se borra/qué sobrevive', async () => {
    await montar();

    expect(screen.getByRole('heading', { name: /eliminar mi cuenta/i })).toBeInTheDocument();
    expect(
      screen.getByText(/tu historial de compras se conserva, pero sin datos que te identifiquen/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/tu email queda libre/i)).toBeInTheDocument();
  });

  it('al click, abre el diálogo con el copy exacto de irreversibilidad', async () => {
    const user = userEvent.setup();
    await montar();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^eliminar mi cuenta$/i }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText(/es inmediato y no se puede deshacer/i)).toBeInTheDocument();
  });

  it('Escape cierra el diálogo SIN llamar a accountService.deleteAccount (AC-7)', async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(accountService, 'deleteAccount');
    await montar();

    await user.click(screen.getByRole('button', { name: /^eliminar mi cuenta$/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('click en "Cancelar" cierra el diálogo SIN llamar a accountService.deleteAccount (AC-7)', async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(accountService, 'deleteAccount');
    await montar();

    await user.click(screen.getByRole('button', { name: /^eliminar mi cuenta$/i }));
    await user.click(screen.getByRole('button', { name: /cancelar/i }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('el botón de confirmar (dentro del diálogo) queda deshabilitado hasta tipear "ELIMINAR" exacto', async () => {
    const user = userEvent.setup();
    await montar();

    await user.click(screen.getByRole('button', { name: /^eliminar mi cuenta$/i }));

    // Dos botones comparten el texto "Eliminar mi cuenta": el que abre el
    // diálogo y el de confirmar dentro. Se distingue por estar dentro de
    // `role="dialog"`.
    const dialog = screen.getByRole('dialog');
    const confirmarEnDialogo = screen
      .getAllByRole('button', { name: /^eliminar mi cuenta$/i })
      .find((el) => dialog.contains(el))!;
    expect(confirmarEnDialogo).toBeDisabled();

    await user.type(screen.getByLabelText(/escribí "eliminar" para confirmar/i), 'ELIMINAR');

    expect(confirmarEnDialogo).toBeEnabled();
  });
});

/** Abre el diálogo, tipea "ELIMINAR" y clickea confirmar. */
async function confirmarBorrado(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /^eliminar mi cuenta$/i }));
  await user.type(screen.getByLabelText(/escribí "eliminar" para confirmar/i), 'ELIMINAR');
  const dialog = screen.getByRole('dialog');
  const confirmar = screen
    .getAllByRole('button', { name: /^eliminar mi cuenta$/i })
    .find((el) => dialog.contains(el))!;
  await user.click(confirmar);
}

/**
 * Espejo mínimo de `MiCuentaScreen` (design.md §D3): levanta el flag "recién
 * borrada" por ENCIMA del árbol que consume `useSession()`, y registra en
 * `snapshots` el par `(kind, deleted)` de CADA render — así el test puede
 * comprobar, sobre el historial completo, que nunca hubo un render con
 * `kind==='anonymous'` y `deleted===false` (la carrera que D3 previene).
 */
function ArnesMiCuenta({
  snapshots,
}: {
  snapshots: { kind: string; deleted: boolean }[];
}) {
  const { state } = useSession();
  return <SondaYPanel state={state} snapshots={snapshots} />;
}

function SondaYPanel({
  state,
  snapshots,
}: {
  state: ReturnType<typeof useSession>['state'];
  snapshots: { kind: string; deleted: boolean }[];
}) {
  const [deleted, setDeleted] = useState(false);
  snapshots.push({ kind: state.kind, deleted });
  if (deleted) return <p role="status">Cuenta eliminada</p>;
  return <DeleteAccountSection onDeleted={() => setDeleted(true)} />;
}

describe('DeleteAccountSection — T4.1 (wiring de la mutación exitosa)', () => {
  it('en éxito, llama a session.accountDeleted() y onDeleted() en el mismo render (sin flicker, design.md §D3)', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(SESSION_HINT_KEY, '1');
    server.use(
      http.get(`${SITE}/v1/auth/me`, () => HttpResponse.json(customer)),
      http.delete(`${SITE}/v1/me`, () => new HttpResponse(null, { status: 204 })),
    );

    const snapshots: { kind: string; deleted: boolean }[] = [];
    render(
      <SessionProvider>
        <ArnesMiCuenta snapshots={snapshots} />
      </SessionProvider>,
    );

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^eliminar mi cuenta$/i })).toBeInTheDocument(),
    );

    await confirmarBorrado(user);

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/cuenta eliminada/i));

    // La carrera que D3 previene: ID nunca hay un render con la sesión ya
    // anónima pero la pantalla todavía mostrando el panel (`deleted=false`)
    // — eso significaría que `CustomerGuard` alcanzaría a ocultar el árbol
    // antes de que `MiCuentaScreen` reemplace el contenido.
    const conRiesgoDeFlicker = snapshots.some((s) => s.kind === 'anonymous' && !s.deleted);
    expect(conRiesgoDeFlicker).toBe(false);
    // Y sí se llega, en algún momento, al estado final esperado.
    expect(snapshots.some((s) => s.kind === 'anonymous' && s.deleted)).toBe(true);
  });

  it('emite account_delete_attempted y account_delete_succeeded en éxito', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(SESSION_HINT_KEY, '1');
    server.use(
      http.get(`${SITE}/v1/auth/me`, () => HttpResponse.json(customer)),
      http.delete(`${SITE}/v1/me`, () => new HttpResponse(null, { status: 204 })),
    );
    const { setEventSink } = await import('@/lib/observability/events');
    const eventos: string[] = [];
    setEventSink((event) => eventos.push(event));

    await montar();
    await confirmarBorrado(user);

    await waitFor(() => expect(eventos).toContain('account_delete_succeeded'));
    expect(eventos).toEqual(['account_delete_attempted', 'account_delete_succeeded']);
    setEventSink(() => {});
  });
});

describe('DeleteAccountSection — T5.1 (409 con blockingOrders)', () => {
  it('muestra los pedidos bloqueantes (número/estado/importe) en texto plano y cierra el diálogo (D7)', async () => {
    const user = userEvent.setup();
    server.use(
      http.delete(`${SITE}/v1/me`, () =>
        HttpResponse.json(
          {
            type: 'dsm:account/active-orders',
            title: 'Conflict',
            status: 409,
            detail: 'Tenés pedidos en curso',
            blocking_orders: [
              {
                order_number: 1234,
                status: 'pending_payment',
                total_ars_cents: 500000,
                created_at: '2026-01-01T00:00:00Z',
              },
              {
                order_number: 1235,
                status: 'preparing',
                total_ars_cents: 250000,
                created_at: '2026-01-02T00:00:00Z',
              },
            ],
          },
          { status: 409 },
        ),
      ),
    );
    await montar();

    await confirmarBorrado(user);

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent(
      /no podés eliminar tu cuenta mientras tengas pedidos sin retirar o sin pagar/i,
    );
    expect(alerta).toHaveTextContent(/pedido #1234/i);
    expect(alerta).toHaveTextContent(/pendiente de pago/i);
    expect(alerta).toHaveTextContent(/pedido #1235/i);
    expect(alerta).toHaveTextContent(/preparando/i);
    // Sin <Link>: D6 — texto plano, no navegación no verificada.
    expect(alerta.querySelector('a')).toBeNull();

    // D7: el diálogo se cierra, no queda atenuado detrás de un overlay.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // El botón sigue disponible para reabrir y reintentar.
    expect(screen.getByRole('button', { name: /^eliminar mi cuenta$/i })).toBeEnabled();
  });

  it('emite account_delete_attempted seguido de account_delete_blocked (nunca succeeded)', async () => {
    const user = userEvent.setup();
    server.use(
      http.delete(`${SITE}/v1/me`, () =>
        HttpResponse.json(
          {
            type: 'dsm:account/active-orders',
            status: 409,
            blocking_orders: [
              { order_number: 1, status: 'new', total_ars_cents: 1000, created_at: '2026-01-01T00:00:00Z' },
            ],
          },
          { status: 409 },
        ),
      ),
    );
    const { setEventSink } = await import('@/lib/observability/events');
    const eventos: string[] = [];
    setEventSink((event) => eventos.push(event));

    await montar();
    await confirmarBorrado(user);

    await waitFor(() => expect(eventos).toContain('account_delete_blocked'));
    expect(eventos).toEqual(['account_delete_attempted', 'account_delete_blocked']);
    setEventSink(() => {});
  });
});

describe('DeleteAccountSection — T5.2 (error genérico)', () => {
  it.each([401, 403, 429, 500])(
    'un %i muestra el mensaje genérico y cierra el diálogo',
    async (status) => {
      const user = userEvent.setup();
      server.use(
        http.delete(`${SITE}/v1/me`, () =>
          HttpResponse.json({ type: 'about:blank', status }, { status }),
        ),
      );
      await montar();

      await confirmarBorrado(user);

      expect(await screen.findByRole('alert')).toHaveTextContent(
        /no se pudo eliminar tu cuenta\. reintentá\./i,
      );
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    },
  );

  it('un fallo de red también muestra el mensaje genérico y cierra el diálogo', async () => {
    const user = userEvent.setup();
    server.use(http.delete(`${SITE}/v1/me`, () => HttpResponse.error()));
    await montar();

    await confirmarBorrado(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /no se pudo eliminar tu cuenta\. reintentá\./i,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('emite account_delete_attempted seguido de account_delete_failed', async () => {
    const user = userEvent.setup();
    server.use(
      http.delete(`${SITE}/v1/me`, () =>
        HttpResponse.json({ type: 'about:blank', status: 500 }, { status: 500 }),
      ),
    );
    const { setEventSink } = await import('@/lib/observability/events');
    const eventos: string[] = [];
    setEventSink((event) => eventos.push(event));

    await montar();
    await confirmarBorrado(user);

    await waitFor(() => expect(eventos).toContain('account_delete_failed'));
    expect(eventos).toEqual(['account_delete_attempted', 'account_delete_failed']);
    setEventSink(() => {});
  });
});

describe('DeleteAccountSection — T5.3 (idempotencia visual)', () => {
  it('el botón de confirmar queda deshabilitado mientras la mutación está en curso — un doble-click no dispara un segundo DELETE', async () => {
    const user = userEvent.setup();
    let llamadas = 0;
    let resolverDelete!: () => void;
    server.use(
      http.delete(`${SITE}/v1/me`, async () => {
        llamadas += 1;
        await new Promise<void>((resolve) => {
          resolverDelete = resolve;
        });
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await montar();

    await user.click(screen.getByRole('button', { name: /^eliminar mi cuenta$/i }));
    await user.type(screen.getByLabelText(/escribí "eliminar" para confirmar/i), 'ELIMINAR');
    const dialog = screen.getByRole('dialog');
    const confirmar = screen
      .getAllByRole('button', { name: /^eliminar mi cuenta$/i })
      .find((el) => dialog.contains(el))!;

    await user.click(confirmar);
    await waitFor(() => expect(confirmar).toBeDisabled());
    // El propio `disabled` del botón impide que un segundo click llegue a
    // `onConfirm` — mismo criterio que `OrderAnonymizeAction`.
    await user.click(confirmar);

    expect(llamadas).toBe(1);
    // Se deja completar el round-trip ANTES de terminar el test — si no, la
    // promesa pendiente resuelve durante el test siguiente (mismo cuidado
    // que `OrderAnonymizeAction.test.tsx`, "idempotencia visual").
    resolverDelete();
    await waitFor(() => expect(confirmar).toBeEnabled());
  });
});
