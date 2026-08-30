import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
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
    render(<CartSummary cart={cart({ has_blocking_issues: true })} />);

    expect(irAlPago()).toBeDisabled();
    expect(screen.getByText(/hay líneas que no se pueden comprar/i)).toBeInTheDocument();
  });

  it('US-008: sin bloqueos, el CTA está habilitado sin necesitar ningún prop adicional', () => {
    render(<CartSummary cart={cart()} />);

    expect(irAlPago()).toBeEnabled();
    expect(screen.queryByText(/no se pueden comprar/i)).not.toBeInTheDocument();
  });

  it('click en el CTA invoca onCheckout', async () => {
    const onCheckout = vi.fn();
    render(<CartSummary cart={cart()} onCheckout={onCheckout} />);

    await userEvent.setup().click(irAlPago());

    expect(onCheckout).toHaveBeenCalledTimes(1);
  });
});
