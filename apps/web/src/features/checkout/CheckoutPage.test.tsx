import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Cart } from '@/api/generated/model';
import { CartProvider } from '@/features/cart/CartProvider';
import { cartService } from '@/features/cart/cartService';
import type { CheckoutCreated } from './checkoutService';
import { checkoutService } from './checkoutService';
import { CheckoutPage } from './CheckoutPage';

vi.mock('@/features/cart/cartService', () => ({
  cartService: { get: vi.fn(), setItemQuantity: vi.fn(), removeItem: vi.fn() },
}));
vi.mock('./checkoutService', () => ({
  checkoutService: { submit: vi.fn() },
}));

const cartServicio = vi.mocked(cartService);
const checkoutServicio = vi.mocked(checkoutService);

afterEach(() => vi.clearAllMocks());

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
    ],
    item_count: 1,
    total_quantity: 2,
    total_ars_cents: 640000,
    has_blocking_issues: false,
    updated_at: null,
    ...overrides,
  };
}

const vacio = (): Cart => ({
  id: null,
  items: [],
  item_count: 0,
  total_quantity: 0,
  total_ars_cents: 0,
  has_blocking_issues: false,
  updated_at: null,
});

const montar = () =>
  render(
    <CartProvider>
      <CheckoutPage />
    </CartProvider>,
  );

const orden: CheckoutCreated = {
  order_token: 'a'.repeat(64),
  order_number: 1000,
  status: 'pending_payment',
  total_ars_cents: 640000,
  items_count: 1,
};

describe('CheckoutPage — los estados de entrada (D4/D8)', () => {
  it('carrito vacío → CheckoutBlocked', async () => {
    cartServicio.get.mockResolvedValue(vacio());

    montar();

    expect(await screen.findByRole('heading', { name: /no podés continuar/i })).toBeInTheDocument();
    expect(screen.getByText(/carrito está vacío/i)).toBeInTheDocument();
  });

  it('has_blocking_issues: true → CheckoutBlocked con reason not_purchasable', async () => {
    cartServicio.get.mockResolvedValue(cart({ has_blocking_issues: true }));

    montar();

    expect(await screen.findByRole('heading', { name: /no podés continuar/i })).toBeInTheDocument();
    expect(screen.getByText(/ya no se pueden comprar/i)).toBeInTheDocument();
  });

  it('carrito válido → CheckoutForm', async () => {
    cartServicio.get.mockResolvedValue(cart());

    montar();

    expect(await screen.findByRole('button', { name: /confirmar pedido/i })).toBeInTheDocument();
  });

  it('tras un submit exitoso simulado → CheckoutConfirmation y el formulario sale del DOM', async () => {
    cartServicio.get.mockResolvedValue(cart());
    checkoutServicio.submit.mockResolvedValue(orden);

    montar();
    const user = userEvent.setup();

    await screen.findByRole('button', { name: /confirmar pedido/i });
    await user.type(screen.getByLabelText(/nombre/i), 'Ana Gómez');
    await user.type(screen.getByLabelText(/email/i), 'ana@example.com');
    await user.type(screen.getByLabelText(/teléfono/i), '+54 9 11 5555 5555');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /confirmar pedido/i }));

    expect(await screen.findByRole('heading', { name: /pedido quedó registrado/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /confirmar pedido/i })).not.toBeInTheDocument();
  });
});
