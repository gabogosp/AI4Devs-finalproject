import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/mi-cuenta',
}));

const { CustomerGuard } = await import('./CustomerGuard');
const { SessionProvider } = await import('./SessionProvider');
const { SESSION_HINT_KEY } = await import('./sessionState');

const SITE = 'http://localhost:3000';
const customer = {
  id: '55555555-5555-4555-8555-555555555555',
  email: 'ana@example.com',
  name: 'Ana Gómez',
  phone: null,
  created_at: '2026-08-22T12:00:00Z',
};

afterEach(() => {
  replace.mockClear();
  window.localStorage.clear();
});

const montar = () =>
  render(
    <SessionProvider>
      <CustomerGuard>
        <p>datos privados de Ana</p>
      </CustomerGuard>
    </SessionProvider>,
  );

describe('CustomerGuard (T2.6)', () => {
  it('autenticado: renderiza el contenido', async () => {
    window.localStorage.setItem(SESSION_HINT_KEY, '1');
    server.use(http.get(`${SITE}/v1/auth/me`, () => HttpResponse.json(customer)));

    montar();

    await waitFor(() =>
      expect(screen.getByText('datos privados de Ana')).toBeInTheDocument(),
    );
    expect(replace).not.toHaveBeenCalled();
  });

  it('anónimo: redirige a ingresar con el destino y NO muestra ni un fragmento', async () => {
    montar();

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/ingresar?next=%2Fmi-cuenta'),
    );
    expect(screen.queryByText('datos privados de Ana')).toBeNull();
  });

  it('mientras resuelve no muestra el contenido ni redirige', async () => {
    window.localStorage.setItem(SESSION_HINT_KEY, '1');
    server.use(http.get(`${SITE}/v1/auth/me`, () => HttpResponse.json(customer)));

    montar();

    // Redirigir acá mandaría al login a alguien que sí tiene sesión, sólo
    // porque la respuesta todavía no llegó.
    expect(screen.queryByText('datos privados de Ana')).toBeNull();
    expect(replace).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByText('datos privados de Ana')).toBeInTheDocument(),
    );
  });

  it('ante fallo de red NO redirige: no sabemos si hay sesión', async () => {
    window.localStorage.setItem(SESSION_HINT_KEY, '1');
    server.use(http.get(`${SITE}/v1/auth/me`, () => HttpResponse.error()));

    montar();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    // Mandar al login sería afirmar que no hay sesión cuando lo cierto es que
    // no pudimos preguntar.
    expect(replace).not.toHaveBeenCalled();
    expect(screen.queryByText('datos privados de Ana')).toBeNull();
  });
});
