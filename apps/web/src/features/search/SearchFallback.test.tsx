import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchFallback } from './SearchFallback';

const fallback = {
  suggested_categories: [
    { slug: 'electricidad', name: 'Electricidad' },
    { slug: 'ferreteria', name: 'Ferretería' },
  ],
};

describe('SearchFallback', () => {
  it('renderiza cada rubro como enlace a /categorias/{slug} con su nombre', () => {
    render(<SearchFallback fallback={fallback} />);

    expect(screen.getByRole('link', { name: 'Electricidad' })).toHaveAttribute(
      'href',
      '/categorias/electricidad',
    );
    expect(screen.getByRole('link', { name: 'Ferretería' })).toHaveAttribute(
      'href',
      '/categorias/ferreteria',
    );
  });

  it('conserva el orden en que vinieron', () => {
    render(<SearchFallback fallback={fallback} />);

    const nombres = screen.getAllByRole('link').map((a) => a.textContent);
    expect(nombres).toEqual(['Electricidad', 'Ferretería']);
  });
});

describe('SearchFallback — cuándo no renderiza nada', () => {
  it('con fallback null devuelve null', () => {
    const { container } = render(<SearchFallback fallback={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('con la lista vacía devuelve null, no un contenedor con título huérfano', () => {
    // Un «Probá por rubro» sin ningún rubro debajo promete una salida que no
    // existe: peor que no mostrar nada.
    const { container } = render(
      <SearchFallback fallback={{ suggested_categories: [] }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('SearchFallback — accesibilidad', () => {
  it('es alcanzable por teclado', async () => {
    const user = userEvent.setup();
    render(<SearchFallback fallback={fallback} />);

    await user.tab();
    expect(screen.getByRole('link', { name: 'Electricidad' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('link', { name: 'Ferretería' })).toHaveFocus();
  });

  it('la sección tiene nombre accesible propio', () => {
    render(<SearchFallback fallback={fallback} titulo="Mirá estos rubros" />);

    // Sin nombre, quien navega por regiones oye «región» y no sabe qué contiene.
    expect(
      screen.getByRole('region', { name: 'Mirá estos rubros' }),
    ).toBeInTheDocument();
  });
});
