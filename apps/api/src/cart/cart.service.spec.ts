import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { CartProduct, ProductsRepository } from '../products/products.repository';
import {
  CartTooManyItemsError,
  InsufficientStockError,
} from '../common/errors/cart-errors';
import { NotFoundError } from '../common/errors/domain-errors';
import { CART_COOKIE } from '../auth/cookies';
import { CartsRepository, CartWithItems } from './carts.repository';
import { CartTokenService } from './cart-token.service';
import { CartService } from './cart.service';
import { CartEventsService } from '../observability/cart-events.service';

/**
 * T3.3 / T3.4 — casos de uso del carrito con repositorios mockeados. Acá se
 * verifican las reglas y **qué escrituras se hacen y cuáles no**; el recorrido
 * HTTP completo lo cubren los e2e de la Fase 6.
 */
const CART_ID = 'cart-1';
const MAX_ITEMS = 50;

const producto = (over: Partial<CartProduct> = {}): CartProduct => ({
  id: 'prod-1',
  sku: 'SKU-1',
  slug: 'taco-fischer',
  name: 'Taco Fischer',
  image_url: null,
  price_ars_cents: 320_000,
  stock: 10,
  status: 'published',
  ...over,
});

const linea = (over: Partial<CartWithItems['items'][number]> = {}) => ({
  id: 'item-1',
  cart_id: CART_ID,
  product_id: 'prod-1',
  quantity: 1,
  unit_price_ars_cents: 320_000,
  created_at: new Date('2026-08-22T10:00:00.000Z'),
  updated_at: new Date('2026-08-22T10:00:00.000Z'),
  ...over,
});

const carrito = (items: CartWithItems['items'] = []): CartWithItems => ({
  id: CART_ID,
  session_token_hash: 'hash',
  customer_id: null,
  expires_at: new Date(Date.now() + 7 * 86_400_000),
  created_at: new Date('2026-08-22T10:00:00.000Z'),
  updated_at: new Date('2026-08-22T10:00:00.000Z'),
  items,
});

interface Escenario {
  /** Carrito que devuelve la base al resolver la cookie (null = no hay). */
  cartEnBase?: CartWithItems | null;
  /** Producto que devuelve el catálogo (null = inexistente u oculto). */
  publicado?: CartProduct | null;
  /** Productos que ve la vista al renderizar. */
  productos?: CartProduct[];
  lineasExistentes?: number;
  conCookie?: boolean;
}

function armar(esc: Escenario = {}) {
  const cartsMock = {
    findByTokenHash: jest.fn().mockResolvedValue(esc.cartEnBase ?? null),
    findLiveByTokenHash: jest.fn(),
    create: jest.fn().mockResolvedValue(carrito()),
    deleteById: jest.fn().mockResolvedValue(undefined),
    countItems: jest.fn().mockResolvedValue(esc.lineasExistentes ?? 0),
    upsertItem: jest.fn(),
    deleteItem: jest.fn(),
    touch: jest.fn(),
    upsertItemAndTouch: jest
      .fn()
      .mockImplementation((data: { productId: string; quantity: number }) =>
        Promise.resolve(
          carrito([
            linea({ product_id: data.productId, quantity: data.quantity }),
          ]),
        ),
      ),
    deleteItemAndTouch: jest
      .fn()
      .mockResolvedValue({ cart: carrito(), removed: true }),
  };
  const productsMock = {
    findPublishedBySlug: jest
      .fn()
      .mockResolvedValue(
        esc.publicado === undefined ? producto() : esc.publicado,
      ),
    findManyByIds: jest.fn().mockResolvedValue(esc.productos ?? [producto()]),
    findManyBySlugs: jest.fn().mockResolvedValue(esc.productos ?? [producto()]),
    // Escrituras del catálogo: NINGÚN camino del carrito las puede llamar (AC-8).
    create: jest.fn(),
    update: jest.fn(),
  };

  const config = new ConfigService({
    CART_MAX_ITEMS: MAX_ITEMS,
    CART_MAX_QTY_PER_LINE: 99,
    CART_TTL_DAYS: 7,
    AUTH_COOKIE_SECURE: 'false',
  }) as ConfigService;

  const carts = cartsMock as unknown as CartsRepository;
  const products = productsMock as unknown as ProductsRepository;
  const cartToken = new CartTokenService(carts, config);
  const events = new CartEventsService();
  const service = new CartService(carts, products, cartToken, config, events);

  const req = {
    cookies: esc.conCookie === false ? {} : { [CART_COOKIE]: 'token-en-claro' },
  } as unknown as Request;
  const emitidas: string[] = [];
  const res = {
    cookie(name: string) {
      emitidas.push(name);
      return res;
    },
  } as unknown as Response;

  return { service, cartsMock, productsMock, req, res, emitidas };
}

describe('CartService.setItem (AC-1, AC-2, AC-5, AC-10)', () => {
  it('con un producto publicado y cantidad <= stock, fija la cantidad pedida', async () => {
    const { service, req, res, cartsMock } = armar({
      cartEnBase: carrito(),
      productos: [producto()],
    });

    const view = await service.setItem(req, res, 'taco-fischer', 4);

    expect(cartsMock.upsertItemAndTouch).toHaveBeenCalledWith(
      expect.objectContaining({ productId: 'prod-1', quantity: 4 }),
      expect.any(Date),
    );
    expect(view.items[0].quantity).toBe(4);
    expect(view.items[0].unit_price_ars_cents).toBe(320_000);
  });

  it('la cantidad es ABSOLUTA: un segundo PUT con 4 deja 4, no 8', async () => {
    const { service, req, res, cartsMock } = armar({
      cartEnBase: carrito([linea({ quantity: 4 })]),
      productos: [producto()],
    });

    const view = await service.setItem(req, res, 'taco-fischer', 4);

    expect(cartsMock.upsertItemAndTouch).toHaveBeenCalledWith(
      expect.objectContaining({ quantity: 4 }),
      expect.any(Date),
    );
    expect(view.items[0].quantity).toBe(4);
  });

  it('re-sella la instantánea con el precio vigente en cada llamada', async () => {
    const { service, req, res, cartsMock } = armar({
      cartEnBase: carrito([linea({ unit_price_ars_cents: 100 })]),
      publicado: producto({ price_ars_cents: 999_000 }),
      productos: [producto({ price_ars_cents: 999_000 })],
    });

    await service.setItem(req, res, 'taco-fischer', 1);

    expect(cartsMock.upsertItemAndTouch).toHaveBeenCalledWith(
      expect.objectContaining({ unitPriceArsCents: 999_000 }),
      expect.any(Date),
    );
  });

  describe('producto que no se puede agregar (AC-10)', () => {
    // El repositorio devuelve `null` para inexistente, draft y archived: los tres
    // llegan acá indistinguibles, y el error también tiene que serlo.
    const casos = ['inexistente', 'draft', 'archived'];

    it.each(casos)('%s → NotFoundError idéntico', async (caso) => {
      const { service, req, res } = armar({ publicado: null });

      await expect(
        service.setItem(req, res, `slug-${caso}`, 1),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('los tres errores son iguales en type y detail', async () => {
      const errores = [];
      for (const caso of casos) {
        const { service, req, res } = armar({ publicado: null });
        errores.push(
          await service
            .setItem(req, res, `slug-${caso}`, 1)
            .catch((e: NotFoundError) => ({
              type: e.type,
              status: e.status,
              detail: e.message,
            })),
        );
      }

      expect(errores[0]).toEqual(errores[1]);
      expect(errores[1]).toEqual(errores[2]);
      expect(errores[0]).toEqual({
        type: 'dsm:catalog/not-found',
        status: 404,
        detail: 'Producto no encontrado',
      });
    });

    it('no crea carrito ni escribe línea', async () => {
      const { service, req, res, cartsMock } = armar({ publicado: null });

      await service.setItem(req, res, 'x', 1).catch(() => undefined);

      expect(cartsMock.create).not.toHaveBeenCalled();
      expect(cartsMock.upsertItemAndTouch).not.toHaveBeenCalled();
    });
  });

  describe('límite de stock (AC-5)', () => {
    it('quantity > stock lanza InsufficientStockError con available_quantity', async () => {
      const { service, req, res } = armar({
        publicado: producto({ stock: 3 }),
        cartEnBase: carrito(),
      });

      const error = await service
        .setItem(req, res, 'taco-fischer', 4)
        .catch((e: InsufficientStockError) => e);

      expect(error).toBeInstanceOf(InsufficientStockError);
      expect((error as InsufficientStockError).extensions).toEqual({
        available_quantity: 3,
      });
    });

    it('exactamente el stock disponible pasa', async () => {
      const { service, req, res, cartsMock } = armar({
        publicado: producto({ stock: 3 }),
        cartEnBase: carrito(),
        productos: [producto({ stock: 3 })],
      });

      await service.setItem(req, res, 'taco-fischer', 3);

      expect(cartsMock.upsertItemAndTouch).toHaveBeenCalled();
    });

    it('el rechazo NO escribe nada: ni línea, ni carrito, ni cookie', async () => {
      const { service, req, res, cartsMock, emitidas } = armar({
        publicado: producto({ stock: 1 }),
        conCookie: false,
      });

      await service.setItem(req, res, 'taco-fischer', 5).catch(() => undefined);

      expect(cartsMock.upsertItemAndTouch).not.toHaveBeenCalled();
      // Validar ANTES de `ensure` es lo que evita el carrito vacío recién
      // estrenado y la cookie que el cliente no pidió.
      expect(cartsMock.create).not.toHaveBeenCalled();
      expect(emitidas).toEqual([]);
    });
  });

  describe('cota de líneas por carrito (§7.3)', () => {
    it('la línea 51 con CART_MAX_ITEMS=50 lanza CartTooManyItemsError', async () => {
      const { service, req, res, cartsMock } = armar({
        cartEnBase: carrito(),
        lineasExistentes: MAX_ITEMS,
        publicado: producto({ id: 'prod-nuevo' }),
      });

      const error = await service
        .setItem(req, res, 'nuevo', 1)
        .catch((e: CartTooManyItemsError) => e);

      expect(error).toBeInstanceOf(CartTooManyItemsError);
      expect((error as CartTooManyItemsError).extensions).toEqual({
        max_items: MAX_ITEMS,
      });
      expect(cartsMock.upsertItemAndTouch).not.toHaveBeenCalled();
    });

    it('editar una línea EXISTENTE no cuenta contra el límite', async () => {
      // Si contara, un carrito lleno quedaría congelado: no se podría ni bajar la
      // cantidad de algo que ya está adentro.
      const { service, req, res, cartsMock } = armar({
        cartEnBase: carrito([linea()]),
        lineasExistentes: MAX_ITEMS,
        productos: [producto()],
      });

      await service.setItem(req, res, 'taco-fischer', 2);

      expect(cartsMock.upsertItemAndTouch).toHaveBeenCalled();
      expect(cartsMock.countItems).not.toHaveBeenCalled();
    });
  });

  describe('AC-8 — el carrito nunca escribe el catálogo', () => {
    it('ningún camino llama a una escritura de ProductsRepository', async () => {
      const { service, req, res, productsMock } = armar({
        cartEnBase: carrito(),
        productos: [producto()],
      });

      await service.setItem(req, res, 'taco-fischer', 2);
      await service.setItem(req, res, 'taco-fischer', 1);

      expect(productsMock.create).not.toHaveBeenCalled();
      expect(productsMock.update).not.toHaveBeenCalled();
    });
  });
});

describe('CartService.getCart (AC-4, AC-6, AC-7, AC-9)', () => {
  it('sin cookie devuelve el carrito vacío y NO crea nada', async () => {
    const { service, req, cartsMock, emitidas } = armar({ conCookie: false });

    const view = await service.getCart(req);

    expect(view).toEqual({
      id: null,
      items: [],
      item_count: 0,
      total_quantity: 0,
      total_ars_cents: 0,
      has_blocking_issues: false,
      updated_at: null,
    });
    expect(cartsMock.create).not.toHaveBeenCalled();
    expect(emitidas).toEqual([]);
  });

  it('con una cookie huérfana devuelve el vacío, sin error', async () => {
    const { service, req, cartsMock } = armar({ cartEnBase: null });

    const view = await service.getCart(req);

    expect(view.id).toBeNull();
    expect(cartsMock.create).not.toHaveBeenCalled();
  });

  it('con carrito devuelve las líneas con el precio VIGENTE (AC-9)', async () => {
    const { service, req } = armar({
      cartEnBase: carrito([linea({ quantity: 2, unit_price_ars_cents: 100_000 })]),
      productos: [producto({ price_ars_cents: 120_000 })],
    });

    const view = await service.getCart(req);

    expect(view.items[0].unit_price_ars_cents).toBe(120_000);
    expect(view.items[0].subtotal_ars_cents).toBe(240_000);
    expect(view.items[0].price_changed).toBe(true);
    expect(view.items[0].previous_unit_price_ars_cents).toBe(100_000);
    expect(view.total_ars_cents).toBe(240_000);
  });

  it('una línea de producto archivado se devuelve MARCADA, no se omite (AC-6)', async () => {
    const { service, req } = armar({
      cartEnBase: carrito([linea({ quantity: 1 })]),
      productos: [producto({ status: 'archived' })],
    });

    const view = await service.getCart(req);

    expect(view.items).toHaveLength(1);
    expect(view.items[0].availability).toBe('unavailable');
    expect(view.has_blocking_issues).toBe(true);
    expect(view.total_ars_cents).toBe(0);
  });

  it('no desliza la ventana ni emite cookie: el GET es seguro', async () => {
    const { service, req, cartsMock, emitidas } = armar({
      cartEnBase: carrito([linea()]),
      productos: [producto()],
    });

    await service.getCart(req);

    expect(cartsMock.touch).not.toHaveBeenCalled();
    expect(cartsMock.upsertItemAndTouch).not.toHaveBeenCalled();
    expect(emitidas).toEqual([]);
  });
});

describe('CartService.removeItem (AC-3)', () => {
  it('borra la línea y devuelve el carrito recalculado', async () => {
    const { service, req, res, cartsMock } = armar({
      cartEnBase: carrito([linea()]),
      productos: [producto()],
    });
    cartsMock.deleteItemAndTouch.mockResolvedValue({
      cart: carrito(),
      removed: true,
    });

    const view = await service.removeItem(req, res, 'taco-fischer');

    expect(cartsMock.deleteItemAndTouch).toHaveBeenCalledWith(
      CART_ID,
      'prod-1',
      expect.any(Date),
    );
    expect(view.items).toEqual([]);
    expect(view.total_ars_cents).toBe(0);
  });

  it('resuelve el producto SIN filtrar estado: una línea archivada se puede quitar (AC-6)', async () => {
    const { service, req, res, cartsMock, productsMock } = armar({
      cartEnBase: carrito([linea()]),
      publicado: null, // el catálogo público ya no lo devuelve
      productos: [producto({ status: 'archived' })],
    });
    cartsMock.deleteItemAndTouch.mockResolvedValue({
      cart: carrito(),
      removed: true,
    });

    await service.removeItem(req, res, 'taco-fischer');

    expect(productsMock.findManyBySlugs).toHaveBeenCalledWith(['taco-fischer']);
    expect(cartsMock.deleteItemAndTouch).toHaveBeenCalled();
  });

  it('quitar algo que no está en el carrito no lanza y no borra nada (idempotente)', async () => {
    const { service, req, res, cartsMock } = armar({
      cartEnBase: carrito([linea({ product_id: 'otro-producto' })]),
      productos: [producto()],
    });

    const view = await service.removeItem(req, res, 'taco-fischer');

    expect(cartsMock.deleteItemAndTouch).not.toHaveBeenCalled();
    expect(view.id).toBe(CART_ID);
  });

  it('un slug inexistente devuelve el carrito igual, sin borrar', async () => {
    const { service, req, res, cartsMock } = armar({
      cartEnBase: carrito([linea()]),
      productos: [],
    });

    await service.removeItem(req, res, 'no-existe');

    expect(cartsMock.deleteItemAndTouch).not.toHaveBeenCalled();
  });

  it('sin carrito devuelve el vacío y NO crea uno', async () => {
    const { service, req, res, cartsMock, emitidas } = armar({
      conCookie: false,
    });

    const view = await service.removeItem(req, res, 'taco-fischer');

    expect(view.id).toBeNull();
    expect(cartsMock.create).not.toHaveBeenCalled();
    expect(cartsMock.deleteItemAndTouch).not.toHaveBeenCalled();
    expect(emitidas).toEqual([]);
  });
});
