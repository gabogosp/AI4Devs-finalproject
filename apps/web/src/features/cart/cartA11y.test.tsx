import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe, toHaveNoViolations } from 'jest-axe';
import type { Cart } from '@/api/generated/model';
import { CartProvider } from './CartProvider';
import { CartPage } from './CartPage';
import { CartEmptyState } from './CartEmptyState';
import { cartService } from './cartService';

vi.mock('./cartService', () => ({
  cartService: { get: vi.fn(), setItemQuantity: vi.fn(), removeItem: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

expect.extend(toHaveNoViolations);

const servicio = vi.mocked(cartService);

/** Carrito con una línea disponible y una bloqueada — los dos estados que conviven. */
function cartMixto(): Cart {
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
        name: 'Mecha widia 8mm',
        image_url: null,
        quantity: 5,
        unit_price_ars_cents: 540000,
        currency: 'ARS',
        subtotal_ars_cents: 2700000,
        availability: 'insufficient_stock',
        available_quantity: 2,
        max_quantity: 2,
        price_changed: true,
        previous_unit_price_ars_cents: 500000,
      },
    ],
    item_count: 2,
    total_quantity: 7,
    total_ars_cents: 640000,
    has_blocking_issues: true,
    updated_at: null,
  };
}

describe('a11y — carrito (WCAG 2.1 AA)', () => {
  it('estado ready con una línea disponible y una bloqueada: axe sin violaciones', async () => {
    servicio.get.mockResolvedValue(cartMixto());

    const { container } = render(
      <CartProvider>
        <CartPage />
      </CartProvider>,
    );
    await screen.findAllByRole('listitem');

    expect(await axe(container)).toHaveNoViolations();
  });

  it('estado vacío: axe sin violaciones', async () => {
    const { container } = render(<CartEmptyState />);

    expect(await axe(container)).toHaveNoViolations();
  });

  it('el recorrido con Tab alcanza TODOS los controles interactivos', async () => {
    servicio.get.mockResolvedValue(cartMixto());

    render(
      <CartProvider>
        <CartPage />
      </CartProvider>,
    );
    await screen.findAllByRole('listitem');

    const interactivos = [
      ...screen.queryAllByRole('button'),
      // `queryAll`: con ítems el carrito no tiene enlaces —el CTA al pago es un
      // botón deshabilitado hasta US-008—, y cero es un resultado válido.
      ...screen.queryAllByRole('link'),
      ...screen.queryAllByRole('spinbutton'),
    ].filter((el) => !(el as HTMLButtonElement).disabled);

    const user = userEvent.setup();
    const alcanzados = new Set<Element>();
    // Un Tab por control + uno de margen: si algún control quedara fuera del orden
    // de tabulación (un div con onClick, por ejemplo), no aparecería acá.
    for (let i = 0; i < interactivos.length + 1; i += 1) {
      await user.tab();
      if (document.activeElement) alcanzados.add(document.activeElement);
    }

    for (const control of interactivos) {
      expect(alcanzados.has(control)).toBe(true);
    }
  });

  it('ningún control interactivo queda sin nombre accesible', async () => {
    servicio.get.mockResolvedValue(cartMixto());

    render(
      <CartProvider>
        <CartPage />
      </CartProvider>,
    );
    await screen.findAllByRole('listitem');

    for (const control of [
      ...screen.queryAllByRole('button'),
      ...screen.queryAllByRole('link'),
      ...screen.queryAllByRole('spinbutton'),
    ]) {
      // Con dos líneas en pantalla, un «Quitar» sin nombre propio no dice cuál.
      const nombre =
        control.getAttribute('aria-label') ?? control.textContent?.trim() ?? '';
      expect(nombre.length).toBeGreaterThan(0);
    }
  });
});
