import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { formatArs } from '@/lib/format/currency';
import type { CartItem } from '@/api/generated/model';
import { CartItemRow } from './CartItemRow';

function item(overrides: Partial<CartItem> = {}): CartItem {
  return {
    slug: 'taco-fischer-sx-8',
    name: 'Taco Fischer SX 8mm',
    image_url: null,
    quantity: 2,
    unit_price_ars_cents: 320000,
    currency: 'ARS',
    subtotal_ars_cents: 640000,
    availability: 'available',
    max_quantity: 10,
    price_changed: false,
    ...overrides,
  };
}

function setup(overrides: Partial<CartItem> = {}, props: Partial<Parameters<typeof CartItemRow>[0]> = {}) {
  const onSetQuantity = vi.fn();
  const onRemove = vi.fn();
  render(
    <ul>
      <CartItemRow
        item={item(overrides)}
        onSetQuantity={onSetQuantity}
        onRemove={onRemove}
        {...props}
      />
    </ul>,
  );
  return { onSetQuantity, onRemove, user: userEvent.setup() };
}

describe('CartItemRow — importes', () => {
  it('el subtotal coincide CARÁCTER POR CARÁCTER con el helper compartido', () => {
    setup({ subtotal_ars_cents: 1234500 });

    // Se compara sobre `textContent` y no con `getByText`: `Intl` emite un espacio
    // DURO (U+00A0) que el normalizador de las queries no matchea. El assert
    // literal es además lo que «carácter por carácter» quiere decir. El mismo
    // helper corre en server y client, o habría hydration mismatch (§7.4).
    expect(screen.getByRole('listitem').textContent).toContain(formatArs(1234500));
  });

  it('muestra el precio unitario VIGENTE que devuelve el backend', () => {
    setup({ unit_price_ars_cents: 555500 });

    expect(screen.getByRole('listitem').textContent).toContain(
      `${formatArs(555500)} por unidad`,
    );
  });

  it('con price_changed muestra el precio anterior Y el vigente (AC-9)', () => {
    setup({
      price_changed: true,
      previous_unit_price_ars_cents: 300000,
      unit_price_ars_cents: 320000,
    });

    // El cambio se hace visible, no se aplica en silencio.
    const texto = screen.getByText(/cambió de/i).textContent ?? '';
    expect(texto).toContain(formatArs(300000));
    expect(texto).toContain(formatArs(320000));
  });
});

describe('CartItemRow — disponibilidad (AC-6)', () => {
  it('available: sin badge ni motivo, con stepper', () => {
    setup();

    expect(screen.queryByText(/ya no disponible/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/quedan/i)).not.toBeInTheDocument();
    expect(screen.getByRole('spinbutton')).toBeInTheDocument();
  });

  it('insufficient_stock: el motivo va en TEXTO, no sólo en color', () => {
    setup({ availability: 'insufficient_stock', available_quantity: 1, quantity: 4 });

    // El assert se hace sobre el TEXTO del row: si el estado se comunicara sólo
    // con una clase de color, esto fallaría (design-system §7.7, WCAG 2.1 AA).
    const row = screen.getByRole('listitem');
    expect(row.textContent).toMatch(/quedan 1/i);
    expect(row.textContent).toMatch(/no entra en el total/i);
  });

  it('unavailable: lo dice con texto y NO muestra stepper (no hay cantidad que elegir)', () => {
    setup({ availability: 'unavailable' });

    const row = screen.getByRole('listitem');
    expect(row.textContent).toMatch(/ya no está disponible/i);
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });

  it('ofrece «ajustar a N» y «quitar», y NO muta el carrito por su cuenta (OQ-FE-3)', async () => {
    const { onSetQuantity, onRemove, user } = setup({
      availability: 'insufficient_stock',
      available_quantity: 2,
      quantity: 5,
    });

    // Antes de tocar nada: ninguna mutación automática.
    expect(onSetQuantity).not.toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /ajustar a 2/i }));
    expect(onSetQuantity).toHaveBeenCalledWith('taco-fischer-sx-8', 2);

    await user.click(screen.getByRole('button', { name: /quitar/i }));
    expect(onRemove).toHaveBeenCalledWith('taco-fischer-sx-8');
  });

  it('el botón de quitar nombra el producto (con varias líneas «Quitar» no distingue)', () => {
    setup();

    expect(
      screen.getByRole('button', { name: /quitar Taco Fischer SX 8mm del carrito/i }),
    ).toBeInTheDocument();
  });

  it('muestra el conflicto de la línea cuando el servidor rechazó la cantidad', () => {
    setup({}, { conflict: { message: 'Quedan 2 unidades', availableQuantity: 2 } });

    expect(screen.getByText('Quedan 2 unidades')).toBeInTheDocument();
  });

  it('mientras la línea muta, quitar y ajustar quedan deshabilitados', () => {
    setup(
      { availability: 'insufficient_stock', available_quantity: 2, quantity: 5 },
      { mutating: true },
    );

    expect(screen.getByRole('button', { name: /quitar/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /ajustar a 2/i })).toBeDisabled();
  });
});
