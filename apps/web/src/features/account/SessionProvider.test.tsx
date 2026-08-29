import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { SessionProvider, useSession } from './SessionProvider';
import { SESSION_HINT_KEY } from './sessionState';

const SITE = 'http://localhost:3000';

const customer = {
  id: '55555555-5555-4555-8555-555555555555',
  email: 'ana@example.com',
  name: 'Ana Gómez',
  phone: null,
  created_at: '2026-08-22T12:00:00Z',
};

/** Espía del estado: renderiza el `kind` para poder assertear sobre él. */
function Sonda() {
  const { state, logout } = useSession();
  return (
    <div>
      <span data-testid="kind">{state.kind}</span>
      {state.kind === 'authenticated' && (
        <span data-testid="nombre">{state.customer.name}</span>
      )}
      <button onClick={() => void logout()}>salir</button>
    </div>
  );
}

const montar = () =>
  render(
    <SessionProvider>
      <Sonda />
    </SessionProvider>,
  );

describe('SessionProvider (T1.2)', () => {
  afterEach(() => window.localStorage.clear());

  it('sin marca: queda anónimo SIN tocar la red', async () => {
    // El setup de MSW usa `onUnhandledRequest: 'error'`, así que si el provider
    // llamara a `/auth/me` sin handler, este test revienta. Ése es el punto:
    // el visitante anónimo —la mayoría— no paga un request por carga.
    montar();

    await waitFor(() =>
      expect(screen.getByTestId('kind')).toHaveTextContent('anonymous'),
    );
  });

  it('con marca y sesión viva: resuelve authenticated con el nombre', async () => {
    window.localStorage.setItem(SESSION_HINT_KEY, '1');
    server.use(http.get(`${SITE}/v1/auth/me`, () => HttpResponse.json(customer)));

    montar();

    await waitFor(() =>
      expect(screen.getByTestId('kind')).toHaveTextContent('authenticated'),
    );
    expect(screen.getByTestId('nombre')).toHaveTextContent('Ana Gómez');
  });

  it('con marca pero 401: cae a anónimo y BORRA la marca', async () => {
    window.localStorage.setItem(SESSION_HINT_KEY, '1');
    server.use(
      http.get(`${SITE}/v1/auth/me`, () =>
        HttpResponse.json(
          { type: 'dsm:auth/invalid-credentials', title: 'Unauthorized', status: 401 },
          { status: 401 },
        ),
      ),
    );

    montar();

    await waitFor(() =>
      expect(screen.getByTestId('kind')).toHaveTextContent('anonymous'),
    );
    // Si la marca quedara, cada carga futura volvería a preguntar por una
    // sesión que ya sabemos que no existe.
    expect(window.localStorage.getItem(SESSION_HINT_KEY)).toBeNull();
  });

  it('con marca y fallo de RED: queda en error, NO en anónimo, y conserva la marca', async () => {
    window.localStorage.setItem(SESSION_HINT_KEY, '1');
    server.use(http.get(`${SITE}/v1/auth/me`, () => HttpResponse.error()));

    montar();

    // La distinción es el motivo de que el estado sea una unión: decir
    // "anónimo" cuando en realidad no pudimos preguntar le avisa al cliente que
    // su sesión se cayó y lo manda a loguearse sin motivo.
    await waitFor(() =>
      expect(screen.getByTestId('kind')).toHaveTextContent('error'),
    );
    expect(window.localStorage.getItem(SESSION_HINT_KEY)).toBe('1');
  });

  it('logout limpia la marca y deja anónimo', async () => {
    window.localStorage.setItem(SESSION_HINT_KEY, '1');
    server.use(
      http.get(`${SITE}/v1/auth/me`, () => HttpResponse.json(customer)),
      http.post(`${SITE}/v1/auth/logout`, () => new HttpResponse(null, { status: 204 })),
    );
    montar();
    await waitFor(() =>
      expect(screen.getByTestId('kind')).toHaveTextContent('authenticated'),
    );

    await userEvent.click(screen.getByRole('button', { name: 'salir' }));

    await waitFor(() =>
      expect(screen.getByTestId('kind')).toHaveTextContent('anonymous'),
    );
    expect(window.localStorage.getItem(SESSION_HINT_KEY)).toBeNull();
  });

  it('si el logout del backend falla, la sesión local se cierra igual', async () => {
    window.localStorage.setItem(SESSION_HINT_KEY, '1');
    server.use(
      http.get(`${SITE}/v1/auth/me`, () => HttpResponse.json(customer)),
      http.post(`${SITE}/v1/auth/logout`, () => HttpResponse.error()),
    );
    montar();
    await waitFor(() =>
      expect(screen.getByTestId('kind')).toHaveTextContent('authenticated'),
    );

    await userEvent.click(screen.getByRole('button', { name: 'salir' }));

    // Dejar la marca puesta haría que la próxima carga intente resucitar una
    // sesión que el usuario ya quiso cerrar.
    await waitFor(() =>
      expect(screen.getByTestId('kind')).toHaveTextContent('anonymous'),
    );
    expect(window.localStorage.getItem(SESSION_HINT_KEY)).toBeNull();
  });
});
