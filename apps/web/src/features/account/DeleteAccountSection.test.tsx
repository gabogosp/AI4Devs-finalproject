import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { SessionProvider } from './SessionProvider';
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
