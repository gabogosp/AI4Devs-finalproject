import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  setEventSink,
  type BusinessEvent,
  type EventProps,
} from '@/lib/observability/events';
import type { Cart } from '@/api/generated/model';
import { CartProvider } from './CartProvider';
import { CartPage } from './CartPage';
import { AddToCartButton } from './AddToCartButton';
import { cartService } from './cartService';

vi.mock('./cartService', () => ({
  cartService: { get: vi.fn(), setItemQuantity: vi.fn(), removeItem: vi.fn() },
}));

const servicio = vi.mocked(cartService);
const eventos: { event: BusinessEvent; props: EventProps }[] = [];

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

const nombres = () => eventos.map((e) => e.event);

describe('telemetría del carrito (§D9)', () => {
  beforeEach(() => {
    eventos.length = 0;
    setEventSink((event, props) => eventos.push({ event, props }));
    servicio.get.mockResolvedValue(cart());
    servicio.setItemQuantity.mockResolvedValue(cart());
    servicio.removeItem.mockResolvedValue(cart({ items: [], item_count: 0 }));
  });
  afterEach(() => {
    setEventSink(() => {});
    vi.clearAllMocks();
  });

  function montarPagina() {
    render(
      <CartProvider>
        <CartPage />
      </CartProvider>,
    );
  }

  it('cart_viewed se emite al ver el carrito, UNA vez', async () => {
    montarPagina();

    await waitFor(() => expect(nombres()).toContain('cart_viewed'));
    expect(nombres().filter((n) => n === 'cart_viewed')).toHaveLength(1);
  });

  it('cart_item_added se emite al agregar desde la ficha o el listado', async () => {
    render(
      <CartProvider>
        <AddToCartButton slug="taco" productName="Taco Fischer SX 8mm" />
      </CartProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: /agregar al carrito/i }));

    await waitFor(() => expect(nombres()).toContain('cart_item_added'));
  });

  it('cart_quantity_changed se emite al cambiar la cantidad', async () => {
    montarPagina();
    await screen.findByRole('listitem');

    await userEvent.click(screen.getByRole('button', { name: /sumar una unidad/i }));

    await waitFor(() => expect(nombres()).toContain('cart_quantity_changed'));
  });

  it('cart_item_removed se emite al quitar una línea', async () => {
    montarPagina();
    await screen.findByRole('listitem');

    await userEvent.click(screen.getByRole('button', { name: /quitar/i }));

    await waitFor(() => expect(nombres()).toContain('cart_item_removed'));
  });

  it('cart_blocked_checkout se emite UNA vez, no por render', async () => {
    servicio.get.mockResolvedValue(
      cart({
        items: [{ ...cart().items[0], availability: 'unavailable' }],
        has_blocking_issues: true,
      }),
    );

    montarPagina();
    await screen.findByRole('listitem');

    // Tres interacciones que re-pintan la página: la métrica de demanda perdida
    // no puede inflarse por eso.
    const user = userEvent.setup();
    for (let i = 0; i < 3; i += 1) {
      await user.tab();
    }

    await waitFor(() => expect(nombres()).toContain('cart_blocked_checkout'));
    expect(nombres().filter((n) => n === 'cart_blocked_checkout')).toHaveLength(1);
  });

  it('ninguna carga útil lleva PII ni el token del carrito', async () => {
    montarPagina();
    await screen.findByRole('listitem');
    await userEvent.click(screen.getByRole('button', { name: /quitar/i }));

    const todo = JSON.stringify(eventos);
    expect(todo).not.toMatch(/dsm_cart/);
    expect(todo).not.toMatch(/@/);
    expect(todo).not.toMatch(/\+54/);
  });
});
