import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cart } from '@/api/generated/model';
import { CartProvider } from './CartProvider';
import { AddToCartButton } from './AddToCartButton';
import { AUTO_CLOSE_MS } from './MiniCart';
import { cartService } from './cartService';

vi.mock('./cartService', () => ({
  cartService: { get: vi.fn(), setItemQuantity: vi.fn(), removeItem: vi.fn() },
}));

// Espía del router: agregar al carrito NO puede navegar (design-system §7.11 —
// el mini-cart no interrumpe).
const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
}));

const servicio = vi.mocked(cartService);
const VENTANA = 40;

function cart(): Cart {
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
  };
}

function montar() {
  render(
    <CartProvider>
      <AddToCartButton slug="taco" productName="Taco Fischer SX 8mm" autoCloseMs={VENTANA} />
    </CartProvider>,
  );
  return { user: userEvent.setup() };
}

const boton = () => screen.getByRole('button', { name: /agregar al carrito/i });

describe('AddToCartButton + MiniCart (AC-1)', () => {
  beforeEach(() => {
    servicio.get.mockResolvedValue(cart());
    servicio.setItemQuantity.mockResolvedValue(cart());
  });
  afterEach(() => vi.clearAllMocks());

  it('agrega UNA unidad y confirma con el mini-cart', async () => {
    const { user } = montar();

    await user.click(boton());

    expect(servicio.setItemQuantity).toHaveBeenCalledWith('taco', 1);
    const aviso = await screen.findByRole('status');
    expect(aviso.textContent).toMatch(/agregaste Taco Fischer SX 8mm/i);
  });

  it('el aviso es role="status", NO alert (agregar algo no es un error)', async () => {
    const { user } = montar();

    await user.click(boton());

    expect(await screen.findByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('NO redirige: el router no recibe ninguna navegación', async () => {
    const { user } = montar();

    await user.click(boton());
    await screen.findByRole('status');

    // Si esto navegara, el §7.11 se rompe: quien está mirando el catálogo pierde
    // su lugar por agregar algo.
    expect(push).not.toHaveBeenCalled();
  });

  it('NO roba el foco: sigue en el botón que se clickeó', async () => {
    const { user } = montar();
    const b = boton();

    await user.click(b);
    await screen.findByRole('status');

    // Quien navega con teclado se quedaría sin su lugar si el aviso tomara el foco.
    expect(document.activeElement).toBe(b);
  });

  it('ofrece «Ir al carrito» como opción, no como consecuencia', async () => {
    const { user } = montar();

    await user.click(boton());

    expect(await screen.findByRole('link', { name: /ir al carrito/i })).toHaveAttribute(
      'href',
      '/carrito',
    );
  });

  it('se cierra solo al vencer la ventana (§7.6)', async () => {
    const { user } = montar();

    await user.click(boton());
    await screen.findByRole('status');

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });

  it('la ventana por default es de 4 s, no un valor de test', () => {
    expect(AUTO_CLOSE_MS).toBe(4000);
  });

  it('Escape lo cierra', async () => {
    const { user } = montar();

    await user.click(boton());
    await screen.findByRole('status');
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('el botón de cerrar lo cierra', async () => {
    const { user } = montar();

    await user.click(boton());
    await screen.findByRole('status');
    await user.click(screen.getByRole('button', { name: /cerrar el aviso/i }));

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
