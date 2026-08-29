import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppErrorException } from '@/lib/http/errors';
import type { Cart } from '@/api/generated/model';
import { CartProvider } from './CartProvider';
import { CartPage } from './CartPage';
import { cartService } from './cartService';

vi.mock('./cartService', () => ({
  cartService: { get: vi.fn(), setItemQuantity: vi.fn(), removeItem: vi.fn() },
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
      <CartPage />
    </CartProvider>,
  );

describe('CartPage — los cuatro estados (§11.9)', () => {
  beforeEach(() => servicio.get.mockResolvedValue(cart()));
  afterEach(() => vi.clearAllMocks());

  it('loading: muestra esqueleto y lo anuncia, sin líneas todavía', async () => {
    let resolver: (c: Cart) => void = () => {};
    servicio.get.mockReturnValue(
      new Promise<Cart>((r) => {
        resolver = r;
      }),
    );

    montar();

    expect(screen.getAllByTestId('cart-skeleton').length).toBeGreaterThan(0);
    expect(screen.getByText(/cargando tu carrito/i)).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();

    // Se resuelve antes de terminar: una promesa pendiente filtra trabajo al test
    // siguiente y lo cuelga.
    await waitFor(() => resolver(cart()));
  });

  it('ready: lista las líneas y el resumen', async () => {
    montar();

    expect(await screen.findByRole('listitem')).toBeInTheDocument();
    expect(screen.getByText('Taco Fischer SX 8mm')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /resumen/i })).toBeInTheDocument();
  });

  it('vacío: estado vacío y NADA de resumen ni total (AC-7)', async () => {
    servicio.get.mockResolvedValue(vacio());

    montar();

    expect(await screen.findByRole('heading', { name: /carrito está vacío/i })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /resumen/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ir al pago/i })).not.toBeInTheDocument();
  });

  it('una mutación fallida deja el error a la vista SIN borrar las líneas', async () => {
    montar();
    await screen.findByRole('listitem');

    // Falla el DELETE (no la lectura): el carrito previo no puede desaparecer, o
    // un fallo de red parecería un carrito borrado.
    servicio.removeItem.mockImplementation(async () => {
      throw new AppErrorException({ kind: 'network', message: 'Sin conexión' });
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /quitar/i }));

    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toMatch(/sin conexión/i);
    expect(screen.getByText('Taco Fischer SX 8mm')).toBeInTheDocument();
  });

});

describe('CartPage — reintento', () => {
  beforeEach(() => vi.clearAllMocks());

  it('el estado de error muestra el mensaje y un botón de reintento', async () => {
    servicio.get.mockImplementationOnce(async () => {
      throw new AppErrorException({ kind: 'network', message: 'Sin conexión' });
    });
    servicio.get.mockResolvedValue(cart());

    montar();

    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toMatch(/sin conexión/i);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /reintentar/i }));

    // El reintento recupera: la línea aparece y la alerta se va.
    expect(await screen.findByRole('listitem')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
