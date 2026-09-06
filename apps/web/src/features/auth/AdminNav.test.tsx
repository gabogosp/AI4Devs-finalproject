import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setAuthToken } from '@/lib/http/authToken';

const replace = vi.fn();
let pathname = '/admin/productos';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => pathname,
}));

const { AdminNav } = await import('./AdminNav');

afterEach(() => {
  replace.mockClear();
  setAuthToken(null);
  window.sessionStorage.clear();
  pathname = '/admin/productos';
});

describe('AdminNav — header/nav compartido del panel (A1)', () => {
  it('linkea las 5 secciones del panel', () => {
    render(<AdminNav />);

    for (const [name, href] of [
      ['Categorías', '/admin/categorias'],
      ['Productos', '/admin/productos'],
      ['Órdenes', '/admin/ordenes'],
      ['Importar', '/admin/importar'],
      ['Métricas', '/admin/metricas'],
    ] as const) {
      expect(screen.getByRole('link', { name })).toHaveAttribute('href', href);
    }
  });

  it('marca la sección activa con aria-current="page"', () => {
    pathname = '/admin/ordenes/11111111-1111-4111-8111-111111111111';
    render(<AdminNav />);

    expect(screen.getByRole('link', { name: 'Órdenes' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Productos' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('"Cerrar sesión" limpia el token y redirige a /admin/acceso', async () => {
    setAuthToken('jwt-admin');
    render(<AdminNav />);

    await userEvent.click(screen.getByRole('button', { name: /cerrar sesión/i }));

    const { getAuthToken } = await import('@/lib/http/authToken');
    expect(getAuthToken()).toBeNull();
    expect(replace).toHaveBeenCalledWith('/admin/acceso');
  });
});
