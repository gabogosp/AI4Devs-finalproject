import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CartView, CartViewItem } from '../cart-view';
import { CartDto, CartItemDto } from './cart.dto';
import { SetCartItemDto } from './set-cart-item.dto';

/**
 * T4.1 — el contrato del borde, ejercido **sin HTTP** (el controller todavía no
 * existe cuando esta task cierra). El 422 extremo a extremo lo prueba T6.5.
 *
 * `plainToInstance` + `validate` es exactamente lo que hace el `ValidationPipe`
 * global; lo que se verifica acá son las mismas reglas que van a correr en
 * producción, no una imitación.
 */
const violaciones = async (payload: unknown) =>
  validate(plainToInstance(SetCartItemDto, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

const item = (over: Partial<CartViewItem> = {}): CartViewItem => ({
  slug: 'taco-fischer',
  name: 'Taco Fischer',
  image_url: null,
  quantity: 2,
  unit_price_ars_cents: 320_000,
  currency: 'ARS',
  subtotal_ars_cents: 640_000,
  availability: 'available',
  max_quantity: 10,
  price_changed: false,
  ...over,
});

const view = (over: Partial<CartView> = {}): CartView => ({
  id: 'cart-1',
  items: [item()],
  item_count: 1,
  total_quantity: 2,
  total_ars_cents: 640_000,
  has_blocking_issues: false,
  updated_at: new Date('2026-08-22T12:00:00.000Z'),
  ...over,
});

describe('SetCartItemDto (entrada validada en el borde)', () => {
  it('quantity: 1 es válida', async () => {
    expect(await violaciones({ quantity: 1 })).toHaveLength(0);
  });

  it.each([
    ['0', { quantity: 0 }],
    ['negativa', { quantity: -1 }],
    ['decimal', { quantity: 2.5 }],
    ['string', { quantity: '2' }],
    ['por encima del tope', { quantity: 100 }],
  ])('quantity %s produce violación', async (_caso, payload) => {
    expect((await violaciones(payload)).length).toBeGreaterThan(0);
  });

  it('un campo no declarado produce violación: no se ignora (forbidNonWhitelisted)', async () => {
    // Es el control anti-tampering del threat model: mandar un precio no es
    // "ignorado", es 422. Un campo ignorado en silencio invita a insistir.
    const errores = await violaciones({ quantity: 1, unit_price_ars_cents: 1 });

    expect(errores.length).toBeGreaterThan(0);
    expect(JSON.stringify(errores)).toContain('unit_price_ars_cents');
  });

  it('product_id y cart_id tampoco se aceptan', async () => {
    expect(
      (await violaciones({ quantity: 1, product_id: 'x' })).length,
    ).toBeGreaterThan(0);
    expect(
      (await violaciones({ quantity: 1, cart_id: 'x' })).length,
    ).toBeGreaterThan(0);
  });

  it('el DTO declara SÓLO quantity', () => {
    const dto = plainToInstance(SetCartItemDto, { quantity: 3 });
    expect(Object.keys(dto)).toEqual(['quantity']);
  });
});

describe('CartDto.from', () => {
  it('emite exactamente las 7 claves del carrito', () => {
    const dto = CartDto.from(view());

    expect(Object.keys(dto).sort()).toEqual(
      [
        'id',
        'items',
        'item_count',
        'total_quantity',
        'total_ars_cents',
        'has_blocking_issues',
        'updated_at',
      ].sort(),
    );
  });

  it('el ítem emite exactamente sus claves cuando están todas', () => {
    const dto = CartDto.from(
      view({
        items: [
          item({
            availability: 'insufficient_stock',
            available_quantity: 1,
            price_changed: true,
            previous_unit_price_ars_cents: 300_000,
          }),
        ],
      }),
    );

    expect(Object.keys(dto.items[0]).sort()).toEqual(
      [
        'slug',
        'name',
        'image_url',
        'quantity',
        'unit_price_ars_cents',
        'currency',
        'subtotal_ars_cents',
        'availability',
        'available_quantity',
        'max_quantity',
        'price_changed',
        'previous_unit_price_ars_cents',
      ].sort(),
    );
  });

  it('los dos campos opcionales NO aparecen cuando no aplican', () => {
    const dto = CartDto.from(view());

    expect(dto.items[0]).not.toHaveProperty('available_quantity');
    expect(dto.items[0]).not.toHaveProperty('previous_unit_price_ars_cents');
  });

  it('no filtra identificadores internos ni el inventario crudo', () => {
    const dto = CartDto.from(view()) as unknown as Record<string, unknown>;
    const itemDto = (dto.items as Record<string, unknown>[])[0];

    for (const clave of [
      'product_id',
      'cart_id',
      'status',
      'stock',
      'session_token_hash',
      'token',
    ]) {
      expect(dto).not.toHaveProperty(clave);
      expect(itemDto).not.toHaveProperty(clave);
    }
  });

  it('el carrito vacío es id null, items vacío y contadores en 0 (AC-7)', () => {
    const dto = CartDto.from({
      id: null,
      items: [],
      item_count: 0,
      total_quantity: 0,
      total_ars_cents: 0,
      has_blocking_issues: false,
      updated_at: null,
    });

    expect(dto).toEqual({
      id: null,
      items: [],
      item_count: 0,
      total_quantity: 0,
      total_ars_cents: 0,
      has_blocking_issues: false,
      updated_at: null,
    });
  });

  it('un campo agregado a la vista NO se cuela en la respuesta', () => {
    // El mapeo es campo por campo justamente para esto.
    const conExtra = {
      ...view(),
      campo_interno: 'no debería salir',
      items: [{ ...item(), stock: 99 }],
    } as unknown as CartView;

    const dto = CartDto.from(conExtra) as unknown as Record<string, unknown>;

    expect(dto).not.toHaveProperty('campo_interno');
    expect((dto.items as Record<string, unknown>[])[0]).not.toHaveProperty(
      'stock',
    );
  });

  it('CartItemDto.from preserva los importes tal como los calculó la vista', () => {
    const dto = CartItemDto.from(
      item({ quantity: 3, unit_price_ars_cents: 1000, subtotal_ars_cents: 3000 }),
    );

    expect(dto.unit_price_ars_cents).toBe(1000);
    expect(dto.subtotal_ars_cents).toBe(3000);
    expect(dto.currency).toBe('ARS');
  });
});
