import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { MiCuentaScreen } from './MiCuentaScreen';
import { SessionProvider } from './SessionProvider';
import { SESSION_HINT_KEY } from './sessionState';

const SITE = 'http://localhost:3000';
const customer = {
  id: '55555555-5555-4555-8555-555555555555',
  email: 'ana@example.com',
  name: 'Ana Gómez',
  phone: null,
  created_at: '2026-08-22T12:00:00Z',
};

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/mi-cuenta',
}));

/**
 * `MiCuentaScreen` levanta el flag "recién borrada" por ENCIMA de
 * `CustomerGuard` (design.md §D3): esto se prueba end-to-end (login real →
 * borrar → confirmación) en vez de mockear `AccountPanel`, porque lo que
 * D3 previene es justo una interacción entre `CustomerGuard` y el guard —
 * mockear `AccountPanel` ocultaría exactamente esa interacción.
 */
describe('MiCuentaScreen (US-020 §D3 — levanta el estado por encima del guard)', () => {
  it('con sesión activa, renderiza CustomerGuard + AccountPanel (con la sección de borrado)', async () => {
    window.localStorage.setItem(SESSION_HINT_KEY, '1');
    server.use(http.get(`${SITE}/v1/auth/me`, () => HttpResponse.json(customer)));

    render(<SessionProvider><MiCuentaScreen /></SessionProvider>);

    expect(
      await screen.findByRole('button', { name: /^eliminar mi cuenta$/i }),
    ).toBeInTheDocument();
    window.localStorage.clear();
  });

  it('tras borrar la cuenta, el árbol se reemplaza por AccountDeletedNotice SIN que CustomerGuard redirija', async () => {
    window.localStorage.setItem(SESSION_HINT_KEY, '1');
    server.use(
      http.get(`${SITE}/v1/auth/me`, () => HttpResponse.json(customer)),
      http.delete(`${SITE}/v1/me`, () => new HttpResponse(null, { status: 204 })),
    );
    replace.mockClear();

    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();

    render(<SessionProvider><MiCuentaScreen /></SessionProvider>);

    await user.click(await screen.findByRole('button', { name: /^eliminar mi cuenta$/i }));
    await user.type(screen.getByLabelText(/escribí "eliminar" para confirmar/i), 'ELIMINAR');
    const dialog = screen.getByRole('dialog');
    const confirmar = screen
      .getAllByRole('button', { name: /^eliminar mi cuenta$/i })
      .find((el) => dialog.contains(el))!;
    await user.click(confirmar);

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /tu cuenta fue eliminada/i })).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: /cerrar sesión/i })).not.toBeInTheDocument();
    // El punto central de D3: el guard nunca llega a disparar su redirección
    // aunque `state.kind` haya pasado a `anonymous` — el árbol ya cambió.
    expect(replace).not.toHaveBeenCalled();
    window.localStorage.clear();
  });
});
