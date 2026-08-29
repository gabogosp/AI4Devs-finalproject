import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { setAuthToken } from '@/lib/http/authToken';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));

// Import después del mock.
const { AdminAccessForm } = await import('./AdminAccessForm');

const API = 'http://localhost:3000';

afterEach(() => {
  push.mockClear();
  setAuthToken(null);
  window.sessionStorage.clear();
});

describe('AdminAccessForm (acceso admin)', () => {
  it('login OK → redirige al panel', async () => {
    server.use(
      http.post(`${API}/v1/admin/auth/login`, () =>
        HttpResponse.json({ token: 'jwt-admin' }),
      ),
    );
    render(<AdminAccessForm />);
    await userEvent.type(screen.getByLabelText(/Token de acceso/), 'seed-token');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(push).toHaveBeenCalledWith('/admin/productos');
  });

  it('token inválido (401) → muestra error accionable, no redirige', async () => {
    server.use(
      http.post(`${API}/v1/admin/auth/login`, () =>
        HttpResponse.json({ status: 401, detail: 'inválido' }, { status: 401 }),
      ),
    );
    render(<AdminAccessForm />);
    await userEvent.type(screen.getByLabelText(/Token de acceso/), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/inválido/i);
    expect(push).not.toHaveBeenCalled();
  });
});
