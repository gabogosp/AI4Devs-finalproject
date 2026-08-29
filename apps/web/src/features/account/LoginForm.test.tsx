import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { setEventSink } from '@/lib/observability/events';

const replace = vi.fn();
let params = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  useSearchParams: () => params,
  usePathname: () => '/ingresar',
}));

const { LoginForm } = await import('./LoginForm');
const { SessionProvider } = await import('./SessionProvider');

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
  params = new URLSearchParams();
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
      <LoginForm />
    </SessionProvider>,
  );

async function ingresar(password = 'Contrasena-Valida-1') {
  await userEvent.type(screen.getByLabelText(/email/i), 'ana@example.com');
  await userEvent.type(screen.getByLabelText(/contraseña/i), password);
  await userEvent.click(screen.getByRole('button', { name: /ingresar/i }));
}

const responder401 = () =>
  server.use(
    http.post(`${SITE}/v1/auth/login`, () =>
      HttpResponse.json(
        { type: 'dsm:auth/invalid-credentials', title: 'Unauthorized', status: 401 },
        { status: 401 },
      ),
    ),
  );

describe('LoginForm (T2.2)', () => {
  it('AC-2: credenciales correctas abren sesión y llevan a mi cuenta', async () => {
    server.use(http.post(`${SITE}/v1/auth/login`, () => HttpResponse.json({ customer })));

    montar();
    await ingresar();

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/mi-cuenta'));
    expect(eventos.map((e) => e.event)).toContain('login_succeeded');
  });

  it('respeta el destino ?next= cuando es del mismo origen', async () => {
    params = new URLSearchParams('next=/mi-cuenta/pedidos');
    server.use(http.post(`${SITE}/v1/auth/login`, () => HttpResponse.json({ customer })));

    montar();
    await ingresar();

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/mi-cuenta/pedidos'),
    );
  });

  it('descarta un ?next= a otro sitio: el login no es un trampolín de phishing', async () => {
    params = new URLSearchParams('next=https://evil.tld/phishing');
    server.use(http.post(`${SITE}/v1/auth/login`, () => HttpResponse.json({ customer })));

    montar();
    await ingresar();

    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(replace).not.toHaveBeenCalledWith(
      expect.stringContaining('evil.tld'),
    );
  });

  it('AC-5: el 401 muestra el copy constante, sin marcar campos ni navegar', async () => {
    responder401();

    montar();
    await ingresar('la-que-sea');

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('Email o contraseña incorrectos.');
    // Ni "no existe esa cuenta" ni "cuenta bloqueada": los tres casos del
    // backend llegan como el mismo 401 y acá tienen una sola rama.
    expect(alerta.textContent).not.toMatch(/existe|bloquead|registrad/i);
    expect(replace).not.toHaveBeenCalled();
  });

  it('AC-5: el evento login_failed va SIN propiedades', async () => {
    responder401();

    montar();
    await ingresar('mala');

    await screen.findByRole('alert');
    const fallo = eventos.find((e) => e.event === 'login_failed');
    expect(fallo).toBeDefined();
    // Una propiedad como `reason: 'not_found'` reintroduciría por telemetría
    // la distinción que la respuesta borra.
    expect(Object.keys(fallo!.props)).toHaveLength(0);
  });

  it('AC-10: el 429 informa la espera y no reintenta', async () => {
    let intentos = 0;
    server.use(
      http.post(`${SITE}/v1/auth/login`, () => {
        intentos += 1;
        return HttpResponse.json(
          { type: 'dsm:auth/rate-limited', title: 'Too Many Requests', status: 429 },
          { status: 429, headers: { 'retry-after': '120' } },
        );
      }),
    );

    montar();
    await ingresar();

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('2 minutos'),
    );
    expect(intentos).toBe(1);
  });

  it('un fallo de red se distingue de credenciales inválidas', async () => {
    server.use(http.post(`${SITE}/v1/auth/login`, () => HttpResponse.error()));

    montar();
    await ingresar();

    // Decirle "contraseña incorrecta" a alguien sin internet lo manda a
    // resetear una contraseña que estaba bien.
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/conexión/i),
    );
  });

  it('no valida la forma de la contraseña: sería una pista para el atacante', async () => {
    server.use(http.post(`${SITE}/v1/auth/login`, () => HttpResponse.json({ customer })));

    montar();
    // Una contraseña corta y vieja tiene que poder intentarse igual.
    await ingresar('abc');

    await waitFor(() => expect(replace).toHaveBeenCalled());
  });
});
