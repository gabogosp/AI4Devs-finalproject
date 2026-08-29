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

/**
 * `categoryName` se volvió opcional en US-004 (`design.md` D6): un resultado de
 * búsqueda no trae categoría. Los casos de arriba NO se tocaron —siguen pasando
 * la prop y siguen esperando `{nombre} — {categoría}`—, que es la comprobación
 * de que el cambio fue aditivo y no una relajación del contrato existente.
 */
describe('ProductImage sin categoría (US-004)', () => {
  it('usa el nombre del producto como alt', () => {
    render(
      <ProductImage
        name="Taco Fischer SX 8mm"
        src="https://cdn.example.com/taco.jpg"
      />,
    );

    const img = screen.getByRole('img', { name: 'Taco Fischer SX 8mm' });
    // Sin el guión colgado: `{nombre} — undefined` es lo que saldría de
    // interpolar la prop ausente, y un lector de pantalla lo leería en voz alta.
    expect(img.getAttribute('alt')).not.toContain('undefined');
    expect(img.getAttribute('alt')).not.toMatch(/—\s*$/);
  });

  it('el placeholder sigue nombrando el producto sin categoría', () => {
    render(<ProductImage name="Taco Fischer SX 8mm" src={null} />);

    expect(
      screen.getByRole('img', { name: 'Taco Fischer SX 8mm — sin imagen disponible' }),
    ).toBeInTheDocument();
  });
});
