import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CartEmptyState } from './CartEmptyState';

describe('CartEmptyState (AC-7)', () => {
  it('tiene un encabezado REAL, no un div con estilo de título', () => {
    render(<CartEmptyState />);

    expect(screen.getByRole('heading', { name: /carrito está vacío/i })).toBeInTheDocument();
  });

  it('ofrece un enlace navegable a los rubros', () => {
    render(<CartEmptyState />);

    expect(screen.getByRole('link', { name: /ver rubros/i })).toHaveAttribute(
      'href',
      '/categorias',
    );
  });

  it('no muestra resumen, total ni CTA al pago (no hay nada que pagar)', () => {
    render(<CartEmptyState />);

    expect(screen.queryByRole('button', { name: /ir al pago/i })).toBeNull();
    expect(screen.queryByText(/total/i)).toBeNull();
  });
});
