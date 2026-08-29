import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { setEventSink } from '@/lib/observability/events';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams('token=reset-token-valido'),
  usePathname: () => '/crear-cuenta',
}));

const { RegisterForm } = await import('./RegisterForm');
const { LoginForm } = await import('./LoginForm');
const { ResetConfirmForm } = await import('./ResetConfirmForm');
const { SessionProvider } = await import('./SessionProvider');

const SITE = 'http://localhost:3000';
const PASSWORD = 'Contrasena-Secreta-Unica-42';
const customer = {
  id: '55555555-5555-4555-8555-555555555555',
  email: 'ana@example.com',
  name: 'Ana Gómez',
  phone: null,
  created_at: '2026-08-22T12:00:00Z',
};

const capturado: unknown[] = [];

beforeEach(() => {
  capturado.length = 0;
  setEventSink((event, props) => capturado.push({ event, props }));
});
afterEach(() => {
  setEventSink(() => {});
  window.localStorage.clear();
  window.sessionStorage.clear();
});

const envolver = (ui: React.ReactNode) =>
  render(<SessionProvider>{ui}</SessionProvider>);

describe('AC-8: la contraseña no sale del formulario (T3.3)', () => {
  it('no aparece en telemetría ni en storage tras registrarse', async () => {
    server.use(
      http.post(`${SITE}/v1/auth/register`, () =>
        HttpResponse.json({ customer }, { status: 201 }),
      ),
    );

    envolver(<RegisterForm />);
    await userEvent.type(screen.getByLabelText(/nombre/i), 'Ana');
    await userEvent.type(screen.getByLabelText(/email/i), 'ana@example.com');
    await userEvent.type(screen.getByLabelText(/contraseña/i), PASSWORD);
    await userEvent.click(screen.getByRole('button', { name: /crear cuenta/i }));

    await waitFor(() => expect(capturado.length).toBeGreaterThan(0));
    // Se serializa el sink COMPLETO: si la contraseña se colara en cualquier
    // propiedad de cualquier evento, aparece acá.
    expect(JSON.stringify(capturado)).not.toContain(PASSWORD);
    expect(JSON.stringify(window.localStorage)).not.toContain(PASSWORD);
    expect(JSON.stringify(window.sessionStorage)).not.toContain(PASSWORD);
  });

  it('no aparece tras un login fallido', async () => {
    server.use(
      http.post(`${SITE}/v1/auth/login`, () =>
        HttpResponse.json(
          { type: 'dsm:auth/invalid-credentials', title: 'Unauthorized', status: 401 },
          { status: 401 },
        ),
      ),
    );

    envolver(<LoginForm />);
    await userEvent.type(screen.getByLabelText(/email/i), 'ana@example.com');
    await userEvent.type(screen.getByLabelText(/contraseña/i), PASSWORD);
    await userEvent.click(screen.getByRole('button', { name: /ingresar/i }));

    await screen.findByRole('alert');
    expect(JSON.stringify(capturado)).not.toContain(PASSWORD);
  });

  it('no aparece tras confirmar la recuperación', async () => {
    server.use(
      http.post(`${SITE}/v1/auth/password-reset/confirm`, () =>
        HttpResponse.json({ ok: true }),
      ),
    );

    envolver(<ResetConfirmForm />);
    await userEvent.type(screen.getByLabelText(/contraseña/i), PASSWORD);
    await userEvent.click(screen.getByRole('button', { name: /guardar/i }));

    await waitFor(() => expect(capturado.length).toBeGreaterThan(0));
    expect(JSON.stringify(capturado)).not.toContain(PASSWORD);
  });

  it('los tres formularios son POST: la contraseña no puede terminar en la URL', () => {
    const { container: a } = envolver(<RegisterForm />);
    expect(a.querySelector('form')).toHaveAttribute('method', 'post');

    const { container: b } = envolver(<LoginForm />);
    expect(b.querySelector('form')).toHaveAttribute('method', 'post');

    const { container: c } = envolver(<ResetConfirmForm />);
    expect(c.querySelector('form')).toHaveAttribute('method', 'post');
  });
});

describe('AC-9: el frontend no toca los tokens de sesión (T3.3)', () => {
  it('lo único que persiste es la marca booleana', async () => {
    server.use(
      http.post(`${SITE}/v1/auth/login`, () => HttpResponse.json({ customer })),
    );

    envolver(<LoginForm />);
    await userEvent.type(screen.getByLabelText(/email/i), 'ana@example.com');
    await userEvent.type(screen.getByLabelText(/contraseña/i), PASSWORD);
    await userEvent.click(screen.getByRole('button', { name: /ingresar/i }));

    await waitFor(() =>
      expect(window.localStorage.getItem('dsm.session')).toBe('1'),
    );
    // Ni un token, ni el email, ni el id: sólo la pista de que hubo sesión.
    expect(Object.keys(window.localStorage)).toEqual(['dsm.session']);
    expect(Object.keys(window.sessionStorage)).toHaveLength(0);
  });
});
