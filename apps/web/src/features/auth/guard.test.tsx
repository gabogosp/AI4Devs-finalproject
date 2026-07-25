import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { setAuthToken } from '@/lib/http/authToken';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
}));

const { AdminGuard } = await import('./guard');

afterEach(() => {
  replace.mockClear();
  setAuthToken(null);
  window.sessionStorage.clear();
});

describe('AdminGuard (route group admin, AC-8)', () => {
  it('anónimo → redirige a /acceso y no renderiza el panel', async () => {
    render(
      <AdminGuard>
        <div>PANEL</div>
      </AdminGuard>,
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/acceso'));
    expect(screen.queryByText('PANEL')).not.toBeInTheDocument();
  });

  it('con sesión → renderiza el panel, sin redirigir', async () => {
    window.sessionStorage.setItem('dsm.admin.token', 'jwt-admin');
    render(
      <AdminGuard>
        <div>PANEL</div>
      </AdminGuard>,
    );
    expect(await screen.findByText('PANEL')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});
