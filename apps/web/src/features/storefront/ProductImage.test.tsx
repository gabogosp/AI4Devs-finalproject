import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ProductImage } from './ProductImage';

const PROPS = {
  name: 'Heladera exhibidora',
  categoryName: 'Refrigeración',
};

describe('ProductImage', () => {
  it('renderiza la imagen con alt descriptivo cuando hay URL', () => {
    render(<ProductImage {...PROPS} src="https://cdn.example.com/heladera.jpg" />);

    const img = screen.getByRole('img', {
      name: 'Heladera exhibidora — Refrigeración',
    });
    expect(img).toBeInTheDocument();
    // El alt describe el producto, nunca es "imagen" o el nombre del archivo.
    expect(img.getAttribute('alt')).not.toMatch(/^(imagen|image|foto)$/i);
  });

  it('pide la imagen con prioridad y los sizes del hero de ficha (LCP)', () => {
    render(<ProductImage {...PROPS} src="https://cdn.example.com/heladera.jpg" />);

    const img = screen.getByRole('img', { name: /Heladera exhibidora/ });
    // next/image traduce `priority` a fetchpriority/loading eager.
    expect(img.getAttribute('loading')).not.toBe('lazy');
    expect(img.getAttribute('sizes')).toBe('(max-width: 1024px) 100vw, 50vw');
  });

  it('muestra el placeholder cuando el producto no tiene imagen (AC-6)', () => {
    render(<ProductImage {...PROPS} src={null} />);

    expect(
      screen.getByRole('img', { name: 'Heladera exhibidora — sin imagen disponible' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /— Refrigeración$/ })).not.toBeInTheDocument();
  });

  it('cae al placeholder si la imagen se rompe, en vez del broken-image nativo', () => {
    render(<ProductImage {...PROPS} src="https://cdn.example.com/rota.jpg" />);

    fireEvent.error(screen.getByRole('img', { name: /— Refrigeración/ }));

    expect(
      screen.getByRole('img', { name: 'Heladera exhibidora — sin imagen disponible' }),
    ).toBeInTheDocument();
  });
});
