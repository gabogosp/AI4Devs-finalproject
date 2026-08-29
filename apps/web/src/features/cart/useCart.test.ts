import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppErrorException } from '@/lib/http/errors';
import type { Cart } from '@/api/generated/model';
import { cartReducer, useCart, type CartState } from './useCart';
import { cartService } from './cartService';

vi.mock('./cartService', () => ({
  cartService: {
    get: vi.fn(),
    setItemQuantity: vi.fn(),
    removeItem: vi.fn(),
  },
}));

const servicio = vi.mocked(cartService);

function cart(overrides: Partial<Cart> = {}): Cart {
  return {
    id: 'c1',
    items: [
      {
        slug: 'taco',
        name: 'Taco Fischer',
        image_url: null,
        quantity: 1,
        unit_price_ars_cents: 100000,
        currency: 'ARS',
        subtotal_ars_cents: 100000,
        availability: 'available',
        max_quantity: 5,
        price_changed: false,
      },
      {
        slug: 'mecha',
        name: 'Mecha widia 8mm',
        image_url: null,
        quantity: 2,
        unit_price_ars_cents: 200000,
        currency: 'ARS',
        subtotal_ars_cents: 400000,
        availability: 'available',
        max_quantity: 9,
        price_changed: false,
      },
    ],
    item_count: 2,
    total_quantity: 3,
    total_ars_cents: 500000,
    has_blocking_issues: false,
    updated_at: '2026-08-23T00:00:00.000Z',
    ...overrides,
  };
}

const listo = (c: Cart): CartState => ({
  kind: 'ready',
  cart: c,
  mutatingSlugs: [],
  conflicts: {},
});

describe('useCart', () => {
  beforeEach(() => {
    servicio.get.mockResolvedValue(cart());
    servicio.setItemQuantity.mockResolvedValue(cart());
    servicio.removeItem.mockResolvedValue(cart());
  });
  afterEach(() => vi.clearAllMocks());

  it('va de loading a ready al montar', async () => {
    const { result } = renderHook(() => useCart());

    await waitFor(() => expect(result.current.state.kind).toBe('ready'));
    expect(servicio.get).toHaveBeenCalledTimes(1);
  });

  it('el total mostrado es EXACTAMENTE el del servidor, no una suma local', async () => {
    // El servidor excluye del total las líneas no comprables; si el cliente
    // sumara subtotales, mostraría un número que el checkout va a desmentir.
    const inconsistente = cart({ total_ars_cents: 1 });
    servicio.get.mockResolvedValue(inconsistente);

    const { result } = renderHook(() => useCart());
    await waitFor(() => expect(result.current.state.kind).toBe('ready'));

    const estado = result.current.state;
    expect(estado.kind === 'ready' && estado.cart.total_ars_cents).toBe(1);
    // La suma de las líneas es 500000: el hook NO la usa.
    expect(estado.kind === 'ready' && estado.cart.total_ars_cents).not.toBe(500000);
  });

  it('dos mutaciones concurrentes en slugs distintos no se bloquean entre sí', async () => {
    let resolverTaco: (c: Cart) => void = () => {};
    servicio.setItemQuantity.mockImplementation((slug: string) =>
      slug === 'taco'
        ? new Promise<Cart>((r) => {
            resolverTaco = r;
          })
        : Promise.resolve(cart()),
    );

    const { result } = renderHook(() => useCart());
    await waitFor(() => expect(result.current.state.kind).toBe('ready'));

    act(() => {
      void result.current.setQuantity('taco', 3);
      void result.current.setQuantity('mecha', 4);
    });

    await waitFor(() => {
      const s = result.current.state;
      expect(s.kind === 'ready' && s.mutatingSlugs).toContain('taco');
    });
    // `mecha` resolvió sola mientras `taco` sigue en vuelo: la línea lenta no
    // congela la otra.
    const s = result.current.state;
    expect(s.kind === 'ready' && s.mutatingSlugs).not.toContain('mecha');

    await act(async () => resolverTaco(cart()));
  });

  it('un 409 deja el estado en ready y expone el conflicto POR LÍNEA', async () => {
    servicio.setItemQuantity.mockRejectedValue(
      new AppErrorException({
        kind: 'conflict',
        message: 'Quedan 2 unidades',
        availableQuantity: 2,
      }),
    );

    const { result } = renderHook(() => useCart());
    await waitFor(() => expect(result.current.state.kind).toBe('ready'));

    await act(async () => {
      await result.current.setQuantity('taco', 9);
    });

    const s = result.current.state;
    // No se cae a `error`: el carrito sigue a la vista.
    expect(s.kind).toBe('ready');
    expect(s.kind === 'ready' && s.conflicts.taco?.availableQuantity).toBe(2);
    // El conflicto es de ESA línea, no del carrito.
    expect(s.kind === 'ready' && s.conflicts.mecha).toBeUndefined();
    expect(s.kind === 'ready' && s.mutatingSlugs).toEqual([]);
  });

  it('un error de red deja kind error CONSERVANDO el carrito previo', async () => {
    servicio.removeItem.mockRejectedValue(
      new AppErrorException({ kind: 'network', message: 'sin conexión' }),
    );

    const { result } = renderHook(() => useCart());
    await waitFor(() => expect(result.current.state.kind).toBe('ready'));

    await act(async () => {
      await result.current.remove('taco');
    });

    const s = result.current.state;
    expect(s.kind).toBe('error');
    // Si el carrito se perdiera acá, un fallo de red parecería un carrito borrado.
    expect(s.kind === 'error' && s.cart?.items).toHaveLength(2);
  });

  it('add() suma una unidad a la línea existente (el PUT es absoluto)', async () => {
    const { result } = renderHook(() => useCart());
    await waitFor(() => expect(result.current.state.kind).toBe('ready'));

    await act(async () => {
      await result.current.add('mecha');
    });

    // La línea tenía 2 → se pide 3, no 1 ni un delta.
    expect(servicio.setItemQuantity).toHaveBeenCalledWith('mecha', 3);
  });

  it('add() de un producto que no está en el carrito pide 1', async () => {
    const { result } = renderHook(() => useCart());
    await waitFor(() => expect(result.current.state.kind).toBe('ready'));

    await act(async () => {
      await result.current.add('nuevo');
    });

    expect(servicio.setItemQuantity).toHaveBeenCalledWith('nuevo', 1);
  });

  it('add() no supera max_quantity', async () => {
    servicio.get.mockResolvedValue(
      cart({
        items: [
          {
            slug: 'taco',
            name: 'Taco',
            image_url: null,
            quantity: 5,
            unit_price_ars_cents: 100000,
            currency: 'ARS',
            subtotal_ars_cents: 500000,
            availability: 'available',
            max_quantity: 5,
            price_changed: false,
          },
        ],
      }),
    );

    const { result } = renderHook(() => useCart());
    await waitFor(() => expect(result.current.state.kind).toBe('ready'));

    await act(async () => {
      await result.current.add('taco');
    });

    expect(servicio.setItemQuantity).toHaveBeenCalledWith('taco', 5);
  });

  it('totalQuantity es undefined hasta que resuelve (nunca 0, que seria incorrecto)', () => {
    servicio.get.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useCart());

    expect(result.current.totalQuantity).toBeUndefined();
  });
});

describe('cartReducer', () => {
  it('una recarga sobre un carrito visible no lo esconde', () => {
    const estado = cartReducer(listo(cart()), { type: 'load' });

    expect(estado.kind).toBe('ready');
  });

  it('mutated REEMPLAZA el carrito completo', () => {
    const nuevo = cart({ total_ars_cents: 999, item_count: 1 });

    const estado = cartReducer(listo(cart()), {
      type: 'mutated',
      slug: 'taco',
      cart: nuevo,
    });

    expect(estado.kind === 'ready' && estado.cart.total_ars_cents).toBe(999);
  });

  it('mutating limpia el conflicto previo de esa línea', () => {
    const conConflicto: CartState = {
      kind: 'ready',
      cart: cart(),
      mutatingSlugs: [],
      conflicts: { taco: { message: 'Quedan 2', availableQuantity: 2 } },
    };

    const estado = cartReducer(conConflicto, { type: 'mutating', slug: 'taco' });

    expect(estado.kind === 'ready' && estado.conflicts.taco).toBeUndefined();
  });
});
