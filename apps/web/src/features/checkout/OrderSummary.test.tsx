import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { formatArs } from '@/lib/format/currency';
import type { Cart } from '@/api/generated/model';
import { OrderSummary } from './OrderSummary';

function cart(overrides: Partial<Cart> = {}): Cart {
  return {
    id: 'c1',
    items: [
      {
        slug: 'taco',
        name: 'Taco Fischer SX 8mm',
        image_url: null,
        quantity: 2,
        unit_price_ars_cents: 320000,
        currency: 'ARS',
        subtotal_ars_cents: 640000,
        availability: 'available',
        max_quantity: 9,
        price_changed: false,
      },
      {
        slug: 'mecha',
        name: 'Mecha widia',
        image_url: null,
        quantity: 1,
        unit_price_ars_cents: 100000,
        currency: 'ARS',
        subtotal_ars_cents: 100000,
        availability: 'unavailable',
        max_quantity: 0,
        price_changed: false,
      },
    ],
    item_count: 2,
    total_quantity: 3,
    total_ars_cents: 640000,
    has_blocking_issues: true,
    updated_at: null,
    ...overrides,
  };
}

// Espacio duro de Intl (NBSP): se compara sobre textContent, no con getByText
// del string formateado (mismo criterio que CartSummary.test.tsx).
const region = () => screen.getByRole('region', { name: /tu pedido/i });

describe('OrderSummary — ítems + total del carrito ya cargado (AC-2)', () => {
  it('renderiza cada línea available con nombre, cantidad y subtotal', () => {
    render(<OrderSummary cart={cart()} />);

    const texto = region().textContent ?? '';
    expect(texto).toContain('Taco Fischer SX 8mm');
    expect(texto).toContain('× 2');
    expect(texto).toContain(formatArs(640000));
  });

  it('una línea NO available no aparece (ya la filtró CheckoutBlocked)', () => {
    render(<OrderSummary cart={cart()} />);

    expect(screen.queryByText('Mecha widia')).not.toBeInTheDocument();
  });

  it('el total es el del carrito, no una suma propia', () => {
    render(<OrderSummary cart={cart({ total_ars_cents: 999999 })} />);

    expect(region().textContent ?? '').toContain(formatArs(999999));
  });
});
