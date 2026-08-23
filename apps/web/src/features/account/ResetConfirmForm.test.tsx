import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { setEventSink } from '@/lib/observability/events';

let params = new URLSearchParams('token=reset-token-valido');
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => params,
  usePathname: () => '/recuperar/confirmar',
}));

const { ResetConfirmForm } = await import('./ResetConfirmForm');

const SITE = 'http://localhost:3000';
const eventos: Array<{ event: string; props: Record<string, unknown> }> = [];

beforeEach(() => {
  eventos.length = 0;
  params = new URLSearchParams('token=reset-token-valido');
  setEventSink((event, props) => eventos.push({ event, props }));
});
afterEach(() => setEventSink(() => {}));

async function confirmar(password = 'Contrasena-Nueva-1') {
  render(<ResetConfirmForm />);
  await userEvent.type(screen.getByLabelText(/contraseña/i), password);
  await userEvent.click(screen.getByRole('button', { name: /guardar/i }));
}

const responder400 = () =>
  server.use(
    http.post(`${SITE}/v1/auth/password-reset/confirm`, () =>
      HttpResponse.json(
        { type: 'dsm:auth/invalid-reset-token', title: 'Bad Request', status: 400 },
        { status: 400 },
      ),
    ),
  );

describe('ResetConfirmForm (T2.5)', () => {
  it('AC-4: token válido guarda la contraseña e invita a ingresar', async () => {
    server.use(
      http.post(`${SITE}/v1/auth/password-reset/confirm`, () =>
        HttpResponse.json({ ok: true }),
      ),
    );

    await confirmar();

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/ya podés ingresar/i),
    );
    // El backend NO abre sesión al confirmar: quien abra el link no queda
    // logueado por el solo hecho de abrirlo.
    expect(screen.getByRole('link', { name: /ingresar/i })).toHaveAttribute(
      'href',
      '/ingresar',
    );
  });

  it('el token desaparece de la URL apenas se lee', async () => {
    const replaceState = vi.spyOn(window.history, 'replaceState');
    server.use(
      http.post(`${SITE}/v1/auth/password-reset/confirm`, () =>
        HttpResponse.json({ ok: true }),
      ),
    );

    render(<ResetConfirmForm />);

    // Mientras esté en la barra viaja en el Referer, queda en el historial y
    // puede entrar a telemetría. Es una credencial de un solo uso.
    await waitFor(() => expect(replaceState).toHaveBeenCalled());
    expect(replaceState.mock.calls[0][2]).not.toContain('token');
    replaceState.mockRestore();
  });

  it('AC-7: token vencido, usado o inexistente dan el mismo mensaje con salida', async () => {
    responder400();

    await confirmar();

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('El enlace no es válido o ya se usó.');
    expect(screen.getByRole('link', { name: /pedir un link nuevo/i })).toHaveAttribute(
      'href',
      '/recuperar',
    );
  });

  it('un 422 NO mata el token: se corrige la contraseña y se reintenta', async () => {
    server.use(
      http.post(`${SITE}/v1/auth/password-reset/confirm`, () =>
        HttpResponse.json(
          {
            type: 'dsm:catalog/validation',
            title: 'Unprocessable Entity',
            status: 422,
            errors: [{ field: 'password', message: 'Demasiado común' }],
          },
          { status: 422 },
        ),
      ),
    );

    await confirmar();

    // Sigue en el formulario: el enlace todavía sirve, no hay que pedir otro.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /guardar/i })).toBeInTheDocument(),
    );
    expect(screen.queryByText(/pedir un link nuevo/i)).toBeNull();
  });

  it('sin token en la URL, muestra la salida en vez de llamar al backend', async () => {
    params = new URLSearchParams();

    await confirmar();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'El enlace no es válido o ya se usó.',
    );
  });

  it('el token nunca entra a un evento de telemetría', async () => {
    server.use(
      http.post(`${SITE}/v1/auth/password-reset/confirm`, () =>
        HttpResponse.json({ ok: true }),
      ),
    );

    await confirmar();

    await waitFor(() => expect(eventos.length).toBeGreaterThan(0));
    const serializado = JSON.stringify(eventos);
    expect(serializado).not.toContain('reset-token-valido');
    expect(serializado).not.toContain('Contrasena-Nueva-1');
  });
});
