import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { setEventSink } from '@/lib/observability/events';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/ingresar',
}));

const { LoginForm } = await import('./LoginForm');
const { SessionProvider } = await import('./SessionProvider');

const SITE = 'http://localhost:3000';
const eventos: Array<{ event: string; props: Record<string, unknown> }> = [];

beforeEach(() => {
  eventos.length = 0;
  setEventSink((event, props) => eventos.push({ event, props }));
});
afterEach(() => setEventSink(() => {}));

/**
 * US-014 T3.1 — AC-5 probado por IGUALDAD, no por tres asserts de texto.
 *
 * Tres asserts pasarían igual aunque la UI distinguiera, siempre que el copy
 * esperado esté bien escrito en cada rama. Comparar el `innerHTML` completo de
 * los tres casos falla ante cualquier divergencia: un `setError` en un campo,
 * un banner extra, un copy derivado del `detail` del backend.
 */
async function render401(detail: string) {
  server.use(
    http.post(`${SITE}/v1/auth/login`, () =>
      HttpResponse.json(
        {
          type: 'dsm:auth/invalid-credentials',
          title: 'Unauthorized',
          status: 401,
          detail,
        },
        { status: 401 },
      ),
    ),
  );

  const { container, unmount } = render(
    <SessionProvider>
      <LoginForm />
    </SessionProvider>,
  );
  await userEvent.type(screen.getByLabelText(/email/i), 'ana@example.com');
  await userEvent.type(screen.getByLabelText(/contraseña/i), 'la-que-sea');
  await userEvent.click(screen.getByRole('button', { name: /ingresar/i }));
  await screen.findByRole('alert');

  // `useId()` de React incrementa por render, así que tres renders seguidos
  // producen ids distintos. Se normalizan SÓLO los ids generados (`:r0:`,
  // `«r0»`) y sus referencias: es ruido del framework, no una distinción de la
  // UI. Todo lo demás —texto, atributos, estructura— se compara literal.
  const normalizar = (html: string) =>
    html.replace(/«r[0-9a-z]+»|:r[0-9a-z]+:/g, '«ID»');
  const html = normalizar(container.innerHTML);
  const capturados = eventos.map((e) => ({ ...e }));
  eventos.length = 0;
  unmount();
  return { html, eventos: capturados };
}

describe('AC-5: los tres 401 son indistinguibles (T3.1)', () => {
  it('el DOM renderizado es idéntico para los tres detail distintos', async () => {
    // Los tres `detail` que el backend PODRÍA mandar si alguien relajara la
    // anti-enumeración del lado del servidor. El frontend no debe reflejarlos.
    const incorrecta = await render401('Email o contraseña incorrectos');
    const inexistente = await render401('No existe una cuenta con ese email');
    const bloqueada = await render401('La cuenta está bloqueada por intentos fallidos');

    expect(incorrecta.html).toBe(inexistente.html);
    expect(inexistente.html).toBe(bloqueada.html);
  });

  it('la telemetría tampoco los distingue', async () => {
    const a = await render401('Email o contraseña incorrectos');
    const b = await render401('No existe una cuenta con ese email');
    const c = await render401('La cuenta está bloqueada por intentos fallidos');

    // Una propiedad como `reason` reintroduciría por analítica la distinción
    // que la respuesta borra — y los dashboards son consultables.
    expect(JSON.stringify(a.eventos)).toBe(JSON.stringify(b.eventos));
    expect(JSON.stringify(b.eventos)).toBe(JSON.stringify(c.eventos));
  });

  it('el copy mostrado no contiene ninguno de los detail del backend', async () => {
    const { html } = await render401('No existe una cuenta con ese email');

    expect(html).toContain('Email o contraseña incorrectos.');
    expect(html).not.toContain('No existe una cuenta');
  });
});
