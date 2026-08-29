import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cart } from '@/api/generated/model';
import { CartProvider } from './CartProvider';
import { CartBadge } from './CartBadge';
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
        name: 'Taco',
        image_url: null,
        quantity: 1,
        unit_price_ars_cents: 100000,
        currency: 'ARS',
        subtotal_ars_cents: 100000,
        availability: 'available',
        max_quantity: 9,
        price_changed: false,
      },
      {
        slug: 'mecha',
        name: 'Mecha',
        image_url: null,
        quantity: 2,
        unit_price_ars_cents: 100000,
        currency: 'ARS',
        subtotal_ars_cents: 200000,
        availability: 'available',
        max_quantity: 9,
        price_changed: false,
      },
    ],
    item_count: 2,
    total_quantity: 3,
    total_ars_cents: 300000,
    has_blocking_issues: false,
    updated_at: null,
    ...overrides,
  };
}

const montar = () =>
  render(
    <CartProvider>
      <CartBadge />
    </CartProvider>,
  );

describe('CartBadge', () => {
  beforeEach(() => servicio.get.mockResolvedValue(cart()));
  afterEach(() => vi.clearAllMocks());

  it('muestra UNIDADES, no líneas distintas (OQ-FE-4)', async () => {
    // 2 líneas / 3 unidades → 3.
    montar();

    expect(await screen.findByText('3')).toBeInTheDocument();
    expect(screen.queryByText('2')).not.toBeInTheDocument();
  });

  it('mientras carga NO hay dígito en el DOM (un 0 sería incorrecto, no desconocido)', async () => {
    // Promesa DIFERIDA, no una que nunca resuelve: dejarla pendiente al terminar
    // el test filtra trabajo al siguiente y lo cuelga (diagnosticado en T3.2).
    let resolver: (c: Cart) => void = () => {};
    servicio.get.mockReturnValue(
      new Promise<Cart>((r) => {
        resolver = r;
      }),
    );

    const { container } = montar();

    expect(container.textContent).not.toMatch(/\d/);
    // El enlace sigue estando: se puede ir al carrito antes de saber cuántas cosas hay.
    expect(screen.getByRole('link', { name: /ver el carrito/i })).toBeInTheDocument();

    await act(async () => {
      resolver(cart());
    });
  });

  it('con el carrito vacío no muestra el badge (un 0 es ruido)', async () => {
    servicio.get.mockResolvedValue(
      cart({ items: [], item_count: 0, total_quantity: 0, total_ars_cents: 0 }),
    );

    montar();

    await waitFor(() => expect(servicio.get).toHaveBeenCalled());
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('el nombre accesible incluye la cantidad (un ícono solo no dice nada)', async () => {
    montar();

    expect(
      await screen.findByRole('link', { name: /ver el carrito \(3 unidades\)/i }),
    ).toBeInTheDocument();
  });

  it('singulariza «1 unidad»', async () => {
    servicio.get.mockResolvedValue(cart({ total_quantity: 1 }));

    montar();

    expect(
      await screen.findByRole('link', { name: /\(1 unidad\)/i }),
    ).toBeInTheDocument();
  });

  it('no dispara un fetch por render (el header vive en TODA página pública)', async () => {
    const { rerender } = montar();

    await waitFor(() => expect(servicio.get).toHaveBeenCalled());
    const despuesDelMontaje = servicio.get.mock.calls.length;

    // Tres re-renders no pueden agregar llamadas: si las agregaran, cada pintura
    // del storefront pediría el carrito de nuevo.
    for (let i = 0; i < 3; i += 1) {
      rerender(
        <CartProvider>
          <CartBadge />
        </CartProvider>,
      );
    }

    expect(servicio.get.mock.calls.length).toBe(despuesDelMontaje);
  });

  it('apunta a /carrito', async () => {
    montar();

    expect(await screen.findByRole('link', { name: /ver el carrito/i })).toHaveAttribute(
      'href',
      '/carrito',
    );
  });

  // El caso «fallo de lectura no rompe el header» vive en `useCart.test.ts`
  // («un error de red deja kind error CONSERVANDO el carrito previo»), que es la
  // capa que implementa el manejo. Repetirlo acá sólo agregaba una promesa
  // rechazada que vitest reporta como unhandled y tumba el archivo por un motivo
  // ajeno al componente: el badge no maneja el error, lo hace el hook.
});
