import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SearchSkeleton } from './SearchSkeleton';

describe('SearchSkeleton', () => {
  it('anuncia que se está buscando, una sola vez', () => {
    render(<SearchSkeleton />);

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(/buscando/i);
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('las cajas son decorativas: no anuncian contenido falso', () => {
    const { container } = render(<SearchSkeleton items={4} />);

    // Sin `aria-hidden`, un lector recorre una grilla de elementos vacíos y le
    // hace creer a la persona que ya hay resultados.
    const grilla = container.querySelector('[aria-hidden="true"]');
    expect(grilla).not.toBeNull();
    expect(grilla!.children).toHaveLength(4);

    // Y nada dentro del skeleton se anuncia como enlace o botón: si algo lo
    // hiciera, quien navega por elementos interactivos encontraría destinos que
    // no existen.
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('es un skeleton y no un spinner (§10.1)', () => {
    const { container } = render(<SearchSkeleton items={8} />);

    // Ocho cajas con la forma de una tarjeta: eso comunica qué va a aparecer y
    // dónde, así la página no salta cuando llegan los datos.
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(8);
  });
});
