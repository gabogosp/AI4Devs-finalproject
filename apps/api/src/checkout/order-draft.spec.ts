import { buildCartView, CartViewInput, CartViewItemInput, CartViewProduct } from '../cart/cart-view';
import { buildOrderDraft, OrderDraftProduct } from './order-draft';

/**
 * T2.1 — la función pura que arma el snapshot de la orden. Se ejerce sobre una
 * `CartView` real construida con `buildCartView` (US-007), no con un doble: lo
 * que hay que probar es que el draft es fiel a lo que la vista realmente trae.
 */
const LIMITES = { maxQtyPerLine: 99 };

const producto = (
  over: Partial<CartViewProduct> & { id: string; sku: string },
): CartViewProduct & { id: string; sku: string } => ({
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

function draftProducts(
  productos: Array<CartViewProduct & { id: string; sku: string }>,
): OrderDraftProduct[] {
  return productos.map((p) => ({ slug: p.slug, id: p.id, sku: p.sku }));
}

describe('buildOrderDraft', () => {
  it('3 líneas: el total es la suma exacta de los subtotales', () => {
    const productos = [
      producto({ id: 'p1', sku: 'SKU-1', price_ars_cents: 100_000 }),
      producto({ id: 'p2', sku: 'SKU-2', price_ars_cents: 250_000 }),
      producto({ id: 'p3', sku: 'SKU-3', price_ars_cents: 30_000 }),
    ];
    const view = buildCartView(
      carrito([
        linea({ product_id: 'p1', quantity: 2, unit_price_ars_cents: 100_000 }),
        linea({ product_id: 'p2', quantity: 1, unit_price_ars_cents: 250_000 }),
        linea({ product_id: 'p3', quantity: 3, unit_price_ars_cents: 30_000 }),
      ]),
      productos,
      LIMITES,
    );

    const draft = buildOrderDraft(view, draftProducts(productos));

    expect(draft.lines).toHaveLength(3);
    expect(draft.totalArsCents).toBe(2 * 100_000 + 1 * 250_000 + 3 * 30_000);
  });

  it('el total del draft coincide con el de la vista cuando todo está available', () => {
    const productos = [producto({ id: 'p1', sku: 'SKU-1' })];
    const view = buildCartView(
      carrito([linea({ product_id: 'p1', quantity: 2 })]),
      productos,
      LIMITES,
    );

    const draft = buildOrderDraft(view, draftProducts(productos));

    expect(draft.totalArsCents).toBe(view.total_ars_cents);
  });

  it('el snapshot copia el precio VIGENTE de la vista, no la instantánea del carrito', () => {
    // price_changed: true — el catálogo subió el precio después de que el
    // cliente agregó la línea. El draft tiene que reflejar el nuevo precio,
    // que es el que cobra el checkout: copiar la instantánea sería un error
    // de plata en la dirección equivocada.
    const productos = [producto({ id: 'p1', sku: 'SKU-1', price_ars_cents: 150_000 })];
    const view = buildCartView(
      carrito([
        linea({ product_id: 'p1', quantity: 1, unit_price_ars_cents: 100_000 }),
      ]),
      productos,
      LIMITES,
    );
    expect(view.items[0].price_changed).toBe(true);
    expect(view.items[0].previous_unit_price_ars_cents).toBe(100_000);

    const draft = buildOrderDraft(view, draftProducts(productos));

    expect(draft.lines[0].unit_price_ars_cents).toBe(150_000);
    expect(draft.totalArsCents).toBe(150_000);
  });

  it('cada línea trae product_id y product_sku recuperados del producto', () => {
    const productos = [producto({ id: 'p1', sku: 'SKU-COMPRESOR' })];
    const view = buildCartView(
      carrito([linea({ product_id: 'p1', quantity: 1 })]),
      productos,
      LIMITES,
    );

    const draft = buildOrderDraft(view, draftProducts(productos));

    expect(draft.lines[0].product_id).toBe('p1');
    expect(draft.lines[0].product_sku).toBe('SKU-COMPRESOR');
    expect(draft.lines[0].product_name).toBe('Producto p1');
  });

  it('una vista con has_blocking_issues: true lanza', () => {
    const productos = [
      producto({ id: 'p1', sku: 'SKU-1', status: 'draft' }), // no publicado → unavailable
    ];
    const view = buildCartView(
      carrito([linea({ product_id: 'p1', quantity: 1 })]),
      productos,
      LIMITES,
    );
    expect(view.has_blocking_issues).toBe(true);

    expect(() => buildOrderDraft(view, draftProducts(productos))).toThrow();
  });

  it('una vista vacía lanza', () => {
    const view = buildCartView(null, [], LIMITES);

    expect(() => buildOrderDraft(view, [])).toThrow();
  });
});
