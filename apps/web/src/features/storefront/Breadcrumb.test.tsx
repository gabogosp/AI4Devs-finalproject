import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Breadcrumb } from './Breadcrumb';

describe('Breadcrumb (AC-2)', () => {
  it('enlaza los ancestros y NO el ítem actual', () => {
    render(
      <Breadcrumb
        items={[
          { name: 'Inicio', href: '/' },
          { name: 'Climatización', href: '/categorias/climatizacion' },
          { name: 'Compresor 1HP' },
        ]}
      />,
    );

    expect(screen.getByRole('navigation', { name: 'Ruta de navegación' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Inicio' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Climatización' })).toHaveAttribute(
      'href',
      '/categorias/climatizacion',
    );
    // Enlazar la página actual no aporta navegación y confunde a lectores de
    // pantalla: el último ítem es texto con aria-current.
    expect(screen.queryByRole('link', { name: 'Compresor 1HP' })).not.toBeInTheDocument();
  });

  it('marca el ítem actual con aria-current="page"', () => {
    render(
      <Breadcrumb items={[{ name: 'Inicio', href: '/' }, { name: 'Climatización' }]} />,
    );

    expect(screen.getByText('Climatización')).toHaveAttribute('aria-current', 'page');
  });

  it('funciona con dos niveles (rubro raíz) y con tres (subrubro)', () => {
    const { unmount } = render(
      <Breadcrumb items={[{ name: 'Inicio', href: '/' }, { name: 'Ferretería' }]} />,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    unmount();

    render(
      <Breadcrumb
        items={[
          { name: 'Inicio', href: '/' },
          { name: 'Climatización', href: '/categorias/climatizacion' },
          { name: 'Compresores' },
        ]}
      />,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });
});
