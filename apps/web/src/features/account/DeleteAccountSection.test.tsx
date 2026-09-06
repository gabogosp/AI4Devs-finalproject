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
