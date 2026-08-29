import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { formatArs } from '@/lib/format/currency';
import type { Cart } from '@/api/generated/model';
import { CartSummary } from './CartSummary';

function cart(overrides: Partial<Cart> = {}): Cart {
  return {
    id: 'c1',
    items: [],
    item_count: 1,
    total_quantity: 2,
    total_ars_cents: 640000,
    has_blocking_issues: false,
    updated_at: null,
    ...overrides,
  };
}

const irAlPago = () => screen.getByRole('button', { name: /ir al pago/i });

describe('CartSummary', () => {
  it('el total es el del servidor, formateado con el helper compartido', () => {
    render(<CartSummary cart={cart({ total_ars_cents: 987600 })} />);

    // Espacio duro de Intl: se compara sobre textContent.
    expect(screen.getByRole('region').textContent).toContain(formatArs(987600));
    expect(screen.getByText(/IVA incluido/i)).toBeInTheDocument();
  });

  it('el total vive en una región aria-live="polite" (se anuncia sin interrumpir)', () => {
    render(<CartSummary cart={cart()} />);

    const live = document.querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();
    expect(live?.textContent).toContain(formatArs(640000));
  });

  it('has_blocking_issues deshabilita el CTA Y muestra el motivo (AC-6)', () => {
    render(<CartSummary cart={cart({ has_blocking_issues: true })} checkoutAvailable />);

    expect(irAlPago()).toBeDisabled();
    expect(screen.getByText(/hay líneas que no se pueden comprar/i)).toBeInTheDocument();
  });

  it('sin bloqueos pero sin checkout, el CTA sigue deshabilitado con OTRO motivo', () => {
    render(<CartSummary cart={cart()} />);

    expect(irAlPago()).toBeDisabled();
    expect(screen.getByText(/se habilita en la próxima entrega/i)).toBeInTheDocument();
    // Los dos motivos son distinguibles: uno lo resuelve la persona, el otro no.
    expect(screen.queryByText(/no se pueden comprar/i)).not.toBeInTheDocument();
  });

  it('los dos motivos son textos DISTINTOS', () => {
    const { unmount } = render(
      <CartSummary cart={cart({ has_blocking_issues: true })} checkoutAvailable />,
    );
    const bloqueo = screen.getByRole('region').textContent ?? '';
    unmount();

    render(<CartSummary cart={cart()} />);
    const pendiente = screen.getByRole('region').textContent ?? '';

    expect(bloqueo).not.toBe(pendiente);
  });

  it('con checkout disponible y sin bloqueos, el CTA se habilita', () => {
    render(<CartSummary cart={cart()} checkoutAvailable />);

    expect(irAlPago()).toBeEnabled();
  });
});
