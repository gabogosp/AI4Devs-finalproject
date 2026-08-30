import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { formatArs } from '@/lib/format/currency';
import type { Cart } from '@/api/generated/model';
import { CartProvider } from './CartProvider';
import { CartPage } from './CartPage';
import { cartService } from './cartService';

vi.mock('./cartService', () => ({
  cartService: { get: vi.fn(), setItemQuantity: vi.fn(), removeItem: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const servicio = vi.mocked(cartService);

function cart(overrides: Partial<Cart> = {}): Cart {
  return {
    id: 'c1',
    items: [
      {
        slug: 'taco',
        name: 'Taco Fischer SX 8mm',
        image_url: null,
        quantity: 1,
        unit_price_ars_cents: 320000,
        currency: 'ARS',
        subtotal_ars_cents: 320000,
        availability: 'available',
        max_quantity: 9,
        price_changed: false,
      },
    ],
    item_count: 1,
    total_quantity: 1,
    total_ars_cents: 320000,
    has_blocking_issues: false,
    updated_at: null,
    ...overrides,
  };
}

const conEstado = (availability: Cart['items'][number]['availability'], extra = {}) =>
  cart({
    items: [{ ...cart().items[0], availability, ...extra }],
    has_blocking_issues: availability !== 'available',
  });

function montar() {
  render(
    <CartProvider>
      <CartPage />
    </CartProvider>,
  );
}

describe('anuncios del carrito', () => {
  it('el total nuevo queda en la región aria-live tras cambiar una cantidad', async () => {
    servicio.get.mockResolvedValue(cart());
    servicio.setItemQuantity.mockResolvedValue(
      cart({ total_ars_cents: 960000, total_quantity: 3 }),
    );

    montar();
    await screen.findByRole('listitem');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /sumar una unidad/i }));

    await waitFor(() => {
      const live = document.querySelector('[aria-live="polite"]');
      // Se anuncia sin interrumpir: `polite`, no `assertive`.
      expect(live?.textContent).toContain(formatArs(960000));
    });
  });

  it('el motivo de una línea insuficiente es TEXTO, no una clase de color', async () => {
    servicio.get.mockResolvedValue(
      conEstado('insufficient_stock', { available_quantity: 2, quantity: 5 }),
    );

    montar();
    const fila = await screen.findByRole('listitem');

    // Se asserta sobre `textContent`: si el estado viviera sólo en el color, esto
    // fallaría (design-system §7.7 / WCAG 2.1 AA).
    expect(fila.textContent).toMatch(/quedan 2/i);
  });

  it('el motivo de una línea no disponible es TEXTO', async () => {
    servicio.get.mockResolvedValue(conEstado('unavailable'));

    montar();
    const fila = await screen.findByRole('listitem');

    expect(fila.textContent).toMatch(/ya no está disponible/i);
  });

  it('una línea disponible no inventa avisos', async () => {
    servicio.get.mockResolvedValue(conEstado('available'));

    montar();
    const fila = await screen.findByRole('listitem');

    expect(fila.textContent).not.toMatch(/quedan|ya no/i);
  });

  it('el motivo del bloqueo del pago está a la vista, no sólo en el disabled', async () => {
    servicio.get.mockResolvedValue(
      conEstado('insufficient_stock', { available_quantity: 1, quantity: 4 }),
    );

    montar();
    await screen.findByRole('listitem');

    // Un botón deshabilitado y mudo no deja saber si el problema es propio o del sitio.
    expect(screen.getByRole('button', { name: /ir al pago/i })).toBeDisabled();
    expect(
      screen.getByRole('region', { name: /resumen/i }).textContent,
    ).toMatch(/no se pueden comprar/i);
  });
});
