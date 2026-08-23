import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe, toHaveNoViolations } from 'jest-axe';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';

expect.extend(toHaveNoViolations);

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams('token=reset-token-valido'),
  usePathname: () => '/ingresar',
}));

const { RegisterForm } = await import('./RegisterForm');
const { LoginForm } = await import('./LoginForm');
const { ResetRequestForm } = await import('./ResetRequestForm');
const { ResetConfirmForm } = await import('./ResetConfirmForm');
const { AccountPanel } = await import('./AccountPanel');
const { AccountMenu } = await import('./AccountMenu');
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

afterEach(() => window.localStorage.clear());

const envolver = (ui: React.ReactNode) =>
  render(<SessionProvider>{ui}</SessionProvider>);

// `region` desactivada: los componentes se montan sueltos, sin el landmark que
// aporta el layout. La regla dispararía por el andamiaje del test, no por el
// componente.
const auditar = async (container: HTMLElement) =>
  axe(container, { rules: { region: { enabled: false } } });

describe('Accesibilidad de las pantallas de cuenta (T3.4)', () => {
  it('los cuatro formularios no tienen violaciones en su estado inicial', async () => {
    for (const ui of [
      <RegisterForm key="r" />,
      <LoginForm key="l" />,
      <ResetRequestForm key="rr" />,
      <ResetConfirmForm key="rc" />,
    ]) {
      const { container, unmount } = envolver(ui);
      expect(await auditar(container)).toHaveNoViolations();
      unmount();
    }
  });

  it('tampoco con el error VISIBLE, que es donde suele romperse el describedby', async () => {
    server.use(
      http.post(`${SITE}/v1/auth/login`, () =>
        HttpResponse.json(
          { type: 'dsm:auth/invalid-credentials', title: 'Unauthorized', status: 401 },
          { status: 401 },
        ),
      ),
    );

    const { container } = envolver(<LoginForm />);
    await userEvent.type(screen.getByLabelText(/email/i), 'ana@example.com');
    await userEvent.type(screen.getByLabelText(/contraseña/i), 'mala');
    await userEvent.click(screen.getByRole('button', { name: /ingresar/i }));
    await screen.findByRole('alert');

    expect(await auditar(container)).toHaveNoViolations();
  });

  it('con errores de validación por campo tampoco', async () => {
    const { container } = envolver(<RegisterForm />);
    // Enviar vacío dispara los mensajes por campo con su aria-describedby.
    await userEvent.click(screen.getByRole('button', { name: /crear cuenta/i }));
    await screen.findAllByRole('alert');

    expect(await auditar(container)).toHaveNoViolations();
  });

  it('el header autenticado y el panel de cuenta no tienen violaciones', async () => {
    window.localStorage.setItem(SESSION_HINT_KEY, '1');
    server.use(http.get(`${SITE}/v1/auth/me`, () => HttpResponse.json(customer)));

    const { container } = envolver(
      <>
        <AccountMenu />
        <AccountPanel />
      </>,
    );
    await waitFor(() =>
      expect(screen.getAllByText('Ana Gómez').length).toBeGreaterThan(0),
    );

    expect(await auditar(container)).toHaveNoViolations();
  });

  it('los formularios se recorren por teclado en orden', async () => {
    envolver(<LoginForm />);

    await userEvent.tab();
    expect(screen.getByLabelText(/email/i)).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByLabelText(/contraseña/i)).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: /ingresar/i })).toHaveFocus();
  });

  it('el error es role=alert y la confirmación role=status', async () => {
    server.use(
      http.post(
        `${SITE}/v1/auth/password-reset/request`,
        () => new HttpResponse(null, { status: 202 }),
      ),
    );

    envolver(<ResetRequestForm />);
    await userEvent.type(screen.getByLabelText(/email/i), 'ana@example.com');
    await userEvent.click(screen.getByRole('button', { name: /enviar/i }));

    // `alert` interrumpe al lector de pantalla; `status` no. Un éxito que
    // interrumpe es tan molesto como un error que pasa desapercibido.
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
  });
});
