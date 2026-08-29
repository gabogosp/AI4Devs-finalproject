import {
  buildCartView,
  CartViewInput,
  CartViewItemInput,
  CartViewProduct,
} from './cart-view';

/**
 * T3.2 — la función pura que decide precio, disponibilidad y totales. Es donde vive
 * el dinero de esta US, así que los casos son AAA y explícitos.
 */
const LIMITES = { maxQtyPerLine: 99 };

const producto = (
  over: Partial<CartViewProduct> & { id: string },
): CartViewProduct => ({
  slug: `slug-${over.id}`,
  name: `Producto ${over.id}`,
  image_url: null,
  price_ars_cents: 100_000,
  stock: 10,
  status: 'published',
  ...over,
});

const linea = (
  over: Partial<CartViewItemInput> & { product_id: string },
): CartViewItemInput => ({
  quantity: 1,
  unit_price_ars_cents: 100_000,
  created_at: new Date('2026-08-22T12:00:00.000Z'),
  ...over,
});

const carrito = (items: CartViewItemInput[]): CartViewInput => ({
  id: 'cart-1',
  updated_at: new Date('2026-08-22T12:00:00.000Z'),
  items,
});

describe('buildCartView', () => {
  describe('carrito vacío (AC-7)', () => {
    it('sin carrito devuelve el vacío, no null ni error', () => {
      const view = buildCartView(null, [], LIMITES);

      expect(view).toEqual({
        id: null,
        items: [],
        item_count: 0,
        total_quantity: 0,
        total_ars_cents: 0,
        has_blocking_issues: false,
        updated_at: null,
      });
    });

    it('un carrito existente sin líneas también es un carrito vacío pero con id', () => {
      const view = buildCartView(carrito([]), [], LIMITES);

      expect(view.id).toBe('cart-1');
      expect(view.items).toEqual([]);
      expect(view.total_ars_cents).toBe(0);
      expect(view.has_blocking_issues).toBe(false);
    });
  });

  describe('precio vigente (AC-9)', () => {
    it('el producto subió de precio: el subtotal usa el NUEVO y price_changed avisa', () => {
      // Arrange: la instantánea quedó en 179.000 y el vigente es 185.000.
      const items = [
        linea({ product_id: 'p1', quantity: 2, unit_price_ars_cents: 179_000 }),
      ];
      const productos = [producto({ id: 'p1', price_ars_cents: 185_000 })];

      // Act
      const view = buildCartView(carrito(items), productos, LIMITES);

      // Assert
      expect(view.items[0].unit_price_ars_cents).toBe(185_000);
      expect(view.items[0].subtotal_ars_cents).toBe(370_000);
      expect(view.total_ars_cents).toBe(370_000);
      expect(view.items[0].price_changed).toBe(true);
      expect(view.items[0].previous_unit_price_ars_cents).toBe(179_000);
    });

    it('el producto BAJÓ de precio: también se avisa, con el viejo más alto', () => {
      const view = buildCartView(
        carrito([
          linea({ product_id: 'p1', quantity: 1, unit_price_ars_cents: 200_000 }),
        ]),
        [producto({ id: 'p1', price_ars_cents: 150_000 })],
        LIMITES,
      );

      expect(view.items[0].unit_price_ars_cents).toBe(150_000);
      expect(view.items[0].price_changed).toBe(true);
      expect(view.items[0].previous_unit_price_ars_cents).toBe(200_000);
    });

    it('sin cambio de precio no aparece previous_unit_price_ars_cents', () => {
      const view = buildCartView(
        carrito([
          linea({ product_id: 'p1', unit_price_ars_cents: 100_000 }),
        ]),
        [producto({ id: 'p1', price_ars_cents: 100_000 })],
        LIMITES,
      );

      expect(view.items[0].price_changed).toBe(false);
      expect(view.items[0]).not.toHaveProperty('previous_unit_price_ars_cents');
    });

    it('la instantánea NUNCA entra en una suma', () => {
      // Si el total usara la instantánea, sería 2 × 1 = 2. Usa el vigente: 2 × 500.
      const view = buildCartView(
        carrito([
          linea({ product_id: 'p1', quantity: 2, unit_price_ars_cents: 1 }),
        ]),
        [producto({ id: 'p1', price_ars_cents: 500 })],
        LIMITES,
      );

      expect(view.total_ars_cents).toBe(1000);
    });
  });

  describe('disponibilidad (AC-6)', () => {
    it('published con stock suficiente ⇒ available y suma al total', () => {
      const view = buildCartView(
        carrito([linea({ product_id: 'p1', quantity: 3 })]),
        [producto({ id: 'p1', stock: 5, price_ars_cents: 1000 })],
        LIMITES,
      );

      expect(view.items[0].availability).toBe('available');
      expect(view.items[0]).not.toHaveProperty('available_quantity');
      expect(view.total_ars_cents).toBe(3000);
      expect(view.has_blocking_issues).toBe(false);
    });

    it('quantity 3 con stock 1 ⇒ insufficient_stock, available_quantity 1 y FUERA del total', () => {
      const view = buildCartView(
        carrito([linea({ product_id: 'p1', quantity: 3 })]),
        [producto({ id: 'p1', stock: 1, price_ars_cents: 1000 })],
        LIMITES,
      );

      expect(view.items[0].availability).toBe('insufficient_stock');
      expect(view.items[0].available_quantity).toBe(1);
      // El subtotal de la línea igual se calcula: el FE muestra el detalle.
      expect(view.items[0].subtotal_ars_cents).toBe(3000);
      expect(view.total_ars_cents).toBe(0);
      expect(view.has_blocking_issues).toBe(true);
    });

    it('stock 0 ⇒ insufficient_stock con available_quantity 0', () => {
      const view = buildCartView(
        carrito([linea({ product_id: 'p1', quantity: 1 })]),
        [producto({ id: 'p1', stock: 0 })],
        LIMITES,
      );

      expect(view.items[0].availability).toBe('insufficient_stock');
      expect(view.items[0].available_quantity).toBe(0);
    });

    it('archived ⇒ unavailable, fuera del total, y la línea NO se borra', () => {
      const view = buildCartView(
        carrito([linea({ product_id: 'p1', quantity: 2 })]),
        [producto({ id: 'p1', status: 'archived', stock: 10 })],
        LIMITES,
      );

      expect(view.items).toHaveLength(1);
      expect(view.items[0].availability).toBe('unavailable');
      expect(view.total_ars_cents).toBe(0);
      expect(view.has_blocking_issues).toBe(true);
    });

    it('draft ⇒ unavailable aunque tenga stock de sobra', () => {
      const view = buildCartView(
        carrito([linea({ product_id: 'p1', quantity: 1 })]),
        [producto({ id: 'p1', status: 'draft', stock: 99 })],
        LIMITES,
      );

      expect(view.items[0].availability).toBe('unavailable');
    });
  });

  describe('totales de un carrito mixto', () => {
    it('el total es EXACTAMENTE la suma de las disponibles', () => {
      const items = [
        linea({
          product_id: 'ok',
          quantity: 2,
          created_at: new Date('2026-08-22T10:00:00.000Z'),
        }),
        linea({
          product_id: 'sin-stock',
          quantity: 5,
          created_at: new Date('2026-08-22T11:00:00.000Z'),
        }),
        linea({
          product_id: 'archivado',
          quantity: 1,
          created_at: new Date('2026-08-22T12:00:00.000Z'),
        }),
      ];
      const productos = [
        producto({ id: 'ok', price_ars_cents: 1000, stock: 10 }),
        producto({ id: 'sin-stock', price_ars_cents: 2000, stock: 1 }),
        producto({ id: 'archivado', price_ars_cents: 3000, status: 'archived' }),
      ];

      const view = buildCartView(carrito(items), productos, LIMITES);

      expect(view.total_ars_cents).toBe(2000); // sólo la línea `ok`
      expect(view.item_count).toBe(3); // las tres siguen visibles
      expect(view.total_quantity).toBe(8); // unidades de las tres
      expect(view.has_blocking_issues).toBe(true);
    });

    it('todo disponible ⇒ has_blocking_issues false y el total suma todo', () => {
      const items = [
        linea({
          product_id: 'a',
          quantity: 1,
          created_at: new Date('2026-08-22T10:00:00.000Z'),
        }),
        linea({
          product_id: 'b',
          quantity: 2,
          created_at: new Date('2026-08-22T11:00:00.000Z'),
        }),
      ];
      const productos = [
        producto({ id: 'a', price_ars_cents: 1000 }),
        producto({ id: 'b', price_ars_cents: 2500 }),
      ];

      const view = buildCartView(carrito(items), productos, LIMITES);

      expect(view.has_blocking_issues).toBe(false);
      expect(view.total_ars_cents).toBe(6000);
      expect(view.item_count).toBe(2);
      expect(view.total_quantity).toBe(3);
    });
  });

  describe('max_quantity (OQ-BE-2)', () => {
    it('es el stock cuando el stock es el techo', () => {
      const view = buildCartView(
        carrito([linea({ product_id: 'p1' })]),
        [producto({ id: 'p1', stock: 5 })],
        LIMITES,
      );
      expect(view.items[0].max_quantity).toBe(5);
    });

    it('es CART_MAX_QTY_PER_LINE cuando el stock es enorme', () => {
      const view = buildCartView(
        carrito([linea({ product_id: 'p1' })]),
        [producto({ id: 'p1', stock: 5000 })],
        LIMITES,
      );
      expect(view.items[0].max_quantity).toBe(99);
    });
  });

  describe('orden y bordes', () => {
    it('las líneas salen por antigüedad: el orden no depende de la base', () => {
      const items = [
        linea({
          product_id: 'nuevo',
          created_at: new Date('2026-08-22T13:00:00.000Z'),
        }),
        linea({
          product_id: 'viejo',
          created_at: new Date('2026-08-22T09:00:00.000Z'),
        }),
      ];
      const productos = [
        producto({ id: 'nuevo', slug: 'nuevo' }),
        producto({ id: 'viejo', slug: 'viejo' }),
      ];

      const view = buildCartView(carrito(items), productos, LIMITES);

      expect(view.items.map((i) => i.slug)).toEqual(['viejo', 'nuevo']);
    });

    it('una línea sin producto en el conjunto se omite sin romper', () => {
      // No puede pasar (FK ON DELETE RESTRICT), pero la vista no explota si pasa.
      const view = buildCartView(
        carrito([linea({ product_id: 'fantasma' })]),
        [],
        LIMITES,
      );

      expect(view.items).toEqual([]);
      expect(view.item_count).toBe(0);
    });

    it('la moneda es siempre ARS (PRD: precio final con IVA)', () => {
      const view = buildCartView(
        carrito([linea({ product_id: 'p1' })]),
        [producto({ id: 'p1' })],
        LIMITES,
      );
      expect(view.items[0].currency).toBe('ARS');
    });
  });
});
