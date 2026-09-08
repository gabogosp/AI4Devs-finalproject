import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bootTestApp, truncateCatalog } from '../../test/e2e-app';
import { StorefrontModule } from './storefront.module';
import { PrismaService } from '../prisma/prisma.service';

/**
 * e2e-nest de "Más vendidos" del home (US-026 AC-2, AC-5, AC-6, AC-7).
 * Ranking agregado GLOBAL (no por cliente): una orden de invitado alcanza
 * para sembrar los tests — no hace falta login (a diferencia de US-025
 * `hasDeliveredOrderWithProduct`, que sí es por-cliente).
 */
describe('Storefront más vendidos (e2e-storefront-mas-vendidos)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let categoryId: string;

  beforeAll(async () => {
    app = await bootTestApp([StorefrontModule]);
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(async () => {
    // `truncateCatalog` sólo trunca products/categories; order_items cae por
    // CASCADE (FK a products) pero `orders` no tiene FK hacia products, así
    // que hace falta truncarla explícitamente para aislar los tests entre sí.
    await prisma.$executeRawUnsafe('TRUNCATE TABLE orders RESTART IDENTITY CASCADE');
    await truncateCatalog(prisma);
    categoryId = (
      await prisma.category.create({
        data: { name: 'Refrigeración', slug: 'refrigeracion' },
      })
    ).id;
  });

  const seedProduct = (sku: string, slug: string, status = 'published', stock = 5) =>
    prisma.product.create({
      data: {
        sku,
        slug,
        name: 'Heladera',
        description_raw: 'No-frost 300L',
        price_ars_cents: 100000,
        stock,
        status,
        category_id: categoryId,
      },
    });

  let contador = 0;
  const crearOrdenConLinea = async (
    status: string,
    lineas: Array<{ productId: string; quantity: number }>,
  ) => {
    contador += 1;
    const orden = await prisma.order.create({
      data: {
        access_token_hash: `hash-mv-${contador}`,
        buyer_name: 'Comprador de Prueba',
        buyer_email: `comprador-mv-${contador}@test.local`,
        buyer_phone: '+54 351 555 0000',
        total_ars_cents: 100000,
        consent_accepted: true,
        consent_accepted_at: new Date(),
        consent_terms_version: '2026-06-15',
        status,
      },
    });
    for (const [i, l] of lineas.entries()) {
      await prisma.orderItem.create({
        data: {
          order_id: orden.id,
          product_id: l.productId,
          quantity: l.quantity,
          unit_price_ars_cents: 100000,
          product_name: 'Producto',
          product_sku: `MV-${contador}-${i}`,
        },
      });
    }
    return orden;
  };

  const get = () => request(app.getHttpServer()).get('/v1/products/mas-vendidos');

  it('ordena por cantidad total vendida sobre órdenes confirmadas (AC-2)', async () => {
    const a = await seedProduct('MV-A', 'compresor');
    const b = await seedProduct('MV-B', 'gas-refrigerante');
    await crearOrdenConLinea('delivered', [{ productId: a.id, quantity: 5 }]);
    await crearOrdenConLinea('preparing', [{ productId: b.id, quantity: 2 }]);

    const res = await get();

    expect(res.status).toBe(200);
    expect(res.body.data.map((p: { slug: string }) => p.slug)).toEqual([
      'compresor',
      'gas-refrigerante',
    ]);
    expect(res.body.data[0]).toMatchObject({
      slug: 'compresor',
      currency: 'ARS',
    });
  });

  it('sin ninguna orden confirmada, la sección no se muestra: data vacío (AC-5)', async () => {
    const a = await seedProduct('MV-C', 'sin-ventas');
    await crearOrdenConLinea('pending_payment', [{ productId: a.id, quantity: 9 }]);

    const res = await get();

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('excluye pending_payment y cancelled', async () => {
    const a = await seedProduct('MV-D', 'producto-pendiente');
    const b = await seedProduct('MV-E', 'producto-cancelado');
    const c = await seedProduct('MV-F', 'producto-confirmado');
    await crearOrdenConLinea('pending_payment', [{ productId: a.id, quantity: 9 }]);
    await crearOrdenConLinea('cancelled', [{ productId: b.id, quantity: 9 }]);
    await crearOrdenConLinea('delivered', [{ productId: c.id, quantity: 1 }]);

    const res = await get();

    expect(res.body.data.map((p: { slug: string }) => p.slug)).toEqual([
      'producto-confirmado',
    ]);
  });

  it('empate de cantidad vendida: orden determinista (AC-6)', async () => {
    const a = await seedProduct('MV-G', 'empate-a');
    const b = await seedProduct('MV-H', 'empate-b');
    await crearOrdenConLinea('delivered', [{ productId: a.id, quantity: 3 }]);
    await crearOrdenConLinea('delivered', [{ productId: b.id, quantity: 3 }]);

    const res1 = await get();
    const res2 = await get();

    expect(res1.body.data.map((p: { slug: string }) => p.slug)).toEqual(
      res2.body.data.map((p: { slug: string }) => p.slug),
    );
  });

  it('un producto despublicado no aparece aunque tenga ventas históricas (AC-7)', async () => {
    const a = await seedProduct('MV-I', 'con-ventas-pero-despublicado');
    await crearOrdenConLinea('delivered', [{ productId: a.id, quantity: 4 }]);
    await prisma.product.update({ where: { id: a.id }, data: { status: 'archived' } });

    const res = await get();

    expect(res.body.data.map((p: { slug: string }) => p.slug)).not.toContain(
      'con-ventas-pero-despublicado',
    );
  });

  it('el shape público nunca expone id ni revenue_ars_cents ni sku', async () => {
    const a = await seedProduct('MV-J', 'shape-publico');
    await crearOrdenConLinea('delivered', [{ productId: a.id, quantity: 1 }]);

    const res = await get();

    expect(res.body.data[0]).not.toHaveProperty('id');
    expect(res.body.data[0]).not.toHaveProperty('revenue_ars_cents');
    expect(res.body.data[0]).not.toHaveProperty('sku');
    expect(Object.keys(res.body.data[0]).sort()).toEqual(
      ['currency', 'image_url', 'in_stock', 'name', 'price_ars_cents', 'slug'].sort(),
    );
  });

  it('responde 200 sin Authorization (superficie pública)', async () => {
    const a = await seedProduct('MV-K', 'mas-vendidos-sin-auth');
    await crearOrdenConLinea('delivered', [{ productId: a.id, quantity: 1 }]);

    expect((await get()).status).toBe(200);
  });
});
