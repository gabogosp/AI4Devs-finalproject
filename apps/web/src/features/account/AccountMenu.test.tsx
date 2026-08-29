import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { AccountMenu } from './AccountMenu';
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

const montar = () =>
  render(
    <SessionProvider>
      <AccountMenu />
    </SessionProvider>,
  );

describe('AccountMenu (T1.3)', () => {
  afterEach(() => window.localStorage.clear());

  it('anónimo: ofrece Ingresar', async () => {
    montar();

    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Ingresar' })).toBeInTheDocument(),
    );
  });

  it('autenticado: muestra el nombre y Cerrar sesión, y NO Ingresar', async () => {
    window.localStorage.setItem(SESSION_HINT_KEY, '1');
    server.use(http.get(`${SITE}/v1/auth/me`, () => HttpResponse.json(customer)));

    montar();

    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Ana Gómez' })).toBeInTheDocument(),
    );
    expect(
      screen.getByRole('button', { name: 'Cerrar sesión' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Ingresar' })).toBeNull();
  });

  it('mientras resuelve NO dice Ingresar: sería afirmar algo que no sabemos', async () => {
    window.localStorage.setItem(SESSION_HINT_KEY, '1');
    server.use(http.get(`${SITE}/v1/auth/me`, () => HttpResponse.json(customer)));

    montar();

    // Antes de que resuelva, el placeholder ocupa el lugar: sin esto el header
    // primero diría "Ingresar" y después saltaría al nombre.
    expect(screen.queryByRole('link', { name: 'Ingresar' })).toBeNull();

    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Ana Gómez' })).toBeInTheDocument(),
    );
  });

  it('ante fallo de red no ofrece Ingresar: avisa que la cuenta no está disponible', async () => {
    window.localStorage.setItem(SESSION_HINT_KEY, '1');
    server.use(http.get(`${SITE}/v1/auth/me`, () => HttpResponse.error()));

    montar();

    // Decir "Ingresar" afirmaría que no hay sesión, cuando lo cierto es que no
    // pudimos preguntar — y mandaría a loguearse a alguien que sigue logueado.
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Cuenta no disponible',
      ),
    );
    expect(screen.queryByRole('link', { name: 'Ingresar' })).toBeNull();
  });

  it('el enlace del nombre lleva a mi cuenta', async () => {
    window.localStorage.setItem(SESSION_HINT_KEY, '1');
    server.use(http.get(`${SITE}/v1/auth/me`, () => HttpResponse.json(customer)));

    montar();

    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Ana Gómez' })).toHaveAttribute(
        'href',
        '/mi-cuenta',
      ),
    );
  });
});
