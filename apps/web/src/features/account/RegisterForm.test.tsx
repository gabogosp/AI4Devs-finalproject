import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { setEventSink } from '@/lib/observability/events';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/crear-cuenta',
}));

const { RegisterForm } = await import('./RegisterForm');
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

const eventos: Array<{ event: string; props: Record<string, unknown> }> = [];

beforeEach(() => {
  eventos.length = 0;
  setEventSink((event, props) => eventos.push({ event, props }));
});
afterEach(() => {
  replace.mockClear();
  window.localStorage.clear();
  setEventSink(() => {});
});

const montar = () =>
  render(
    <SessionProvider>
      <RegisterForm />
    </SessionProvider>,
  );

async function completar(over: Partial<Record<string, string>> = {}) {
  await userEvent.type(screen.getByLabelText(/nombre/i), over.name ?? 'Ana Gómez');
  await userEvent.type(screen.getByLabelText(/email/i), over.email ?? 'ana@example.com');
  await userEvent.type(
    screen.getByLabelText(/contraseña/i),
    over.password ?? 'Contrasena-Valida-1',
  );
  await userEvent.click(screen.getByRole('button', { name: /crear cuenta/i }));
}

describe('RegisterForm (T2.1)', () => {
  it('AC-1: alta exitosa deja sesión activa y navega a mi cuenta', async () => {
    server.use(
      http.post(`${SITE}/v1/auth/register`, () =>
        HttpResponse.json({ customer }, { status: 201 }),
      ),
    );

    montar();
    await completar();

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/mi-cuenta'));
    // La marca escrita es lo que evita que la próxima carga pregunte de más.
    expect(window.localStorage.getItem(SESSION_HINT_KEY)).toBe('1');
    expect(eventos.map((e) => e.event)).toContain('account_registered');
  });

  it('AC-6: email existente NO confirma que exista ni marca el campo', async () => {
    server.use(
      http.post(`${SITE}/v1/auth/register`, () =>
        HttpResponse.json(
          { type: 'dsm:auth/registration-failed', title: 'Conflict', status: 409 },
          { status: 409 },
        ),
      ),
    );

    montar();
    await completar();

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('No pudimos crear la cuenta con esos datos.');
    // Marcar el campo email diría "ese email ya está registrado", que es
    // exactamente lo que AC-6 prohíbe.
    expect(alerta.textContent).not.toMatch(/registrad|existe|en uso/i);
    expect(screen.getByLabelText(/email/i)).toBeValid();
    expect(replace).not.toHaveBeenCalled();
  });

  it('AC-10: el 429 muestra la espera concreta y no reintenta', async () => {
    let intentos = 0;
    server.use(
      http.post(`${SITE}/v1/auth/register`, () => {
        intentos += 1;
        return HttpResponse.json(
          { type: 'dsm:auth/rate-limited', title: 'Too Many Requests', status: 429 },
          { status: 429, headers: { 'retry-after': '45' } },
        );
      }),
    );

    montar();
    await completar();

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('45 segundos'),
    );
    expect(intentos).toBe(1);
  });

  it('sin Retry-After el copy es genérico: no se inventa un número', async () => {
    server.use(
      http.post(`${SITE}/v1/auth/register`, () =>
        HttpResponse.json(
          { type: 'dsm:auth/rate-limited', title: 'Too Many Requests', status: 429 },
          { status: 429 },
        ),
      ),
    );

    montar();
    await completar();

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Esperá un momento y probá de nuevo',
      ),
    );
  });

  it('rechaza una contraseña de más de 72 BYTES aunque tenga menos caracteres', async () => {
    montar();
    // 30 "ñ" = 60 bytes; 40 = 80 bytes con sólo 40 caracteres. `.length` lo
    // dejaría pasar y bcrypt lo truncaría en silencio.
    await completar({ password: 'ñ'.repeat(40) });

    expect(await screen.findByText(/máximo 72 bytes/i)).toBeInTheDocument();
  });

  it('el campo de contraseña pide una nueva, no la guardada del sitio', () => {
    montar();
    expect(screen.getByLabelText(/contraseña/i)).toHaveAttribute(
      'autocomplete',
      'new-password',
    );
    expect(screen.getByLabelText(/email/i)).toHaveAttribute('autocomplete', 'username');
  });
});
