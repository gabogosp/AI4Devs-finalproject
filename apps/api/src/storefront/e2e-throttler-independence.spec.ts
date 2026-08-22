import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getOptionsToken } from '@nestjs/throttler';
import request from 'supertest';
import { AppConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CatalogEventsModule } from '../observability/catalog-events.module';
import { AuthModule } from '../auth/auth.module';
import { CartModule } from '../cart/cart.module';
import { configureApp } from '../bootstrap';
import { StorefrontModule } from './storefront.module';
import { PrismaService } from '../prisma/prisma.service';

/**
 * m4 (audit): los throttlers nombrados son INDEPENDIENTES. Agotar uno no consume el
 * presupuesto de los otros — el `@SkipThrottle` cruzado los aísla. Fresh app por
 * test → storage del throttler en cero.
 *
 * US-007 T4.3 lo extiende de 2 a **3** throttlers (`auth`, `storefront`, `cart`) y
 * cubre las 6 combinaciones: agotar cada uno deja los otros dos respondiendo 2xx.
 * Es el punto donde una regresión sería silenciosa — un `@SkipThrottle` que se
 * olvide y el carrito empieza a gastar el presupuesto de login de la misma IP.
 */
describe('Throttlers auth/storefront/cart independientes (e2e-throttler-independence)', () => {
  const AUTH_LIMIT = 2;
  const STOREFRONT_LIMIT = 3;
  const CART_LIMIT = 4;
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        AppConfigModule,
        PrismaModule,
        CatalogEventsModule,
        AuthModule,
        StorefrontModule,
        CartModule,
      ],
    })
      .overrideProvider(getOptionsToken())
      .useValue({
        throttlers: [
          { name: 'auth', ttl: 60_000, limit: AUTH_LIMIT },
          { name: 'storefront', ttl: 60_000, limit: STOREFRONT_LIMIT },
          { name: 'cart', ttl: 60_000, limit: CART_LIMIT },
        ],
      })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    const prisma = app.get(PrismaService);
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE carts, cart_items, products, categories RESTART IDENTITY CASCADE',
    );
    const cat = await prisma.category.create({
      data: { name: 'Refrigeración', slug: 'refrigeracion' },
    });
    await prisma.product.create({
      data: {
        sku: 'IND-001',
        slug: 'heladera-independiente',
        name: 'Heladera',
        price_ars_cents: 100000,
        stock: 5,
        status: 'published',
        category_id: cat.id,
      },
    });
  });
  afterEach(async () => {
    await app?.close();
  });

  const getProduct = () =>
    request(app.getHttpServer()).get('/v1/products/heladera-independiente');
  const login = () =>
    request(app.getHttpServer())
      .post('/v1/admin/auth/login')
      .send({ bootstrapToken: 'wrong-token' });
  const getCart = () => request(app.getHttpServer()).get('/v1/cart');

  /** Agota el throttler de una superficie y devuelve el status del excedente. */
  const agotar = async (
    peticion: () => request.Test,
    limite: number,
    esperado: number,
  ) => {
    for (let i = 0; i < limite; i += 1) {
      expect((await peticion()).status).toBe(esperado);
    }
    expect((await peticion()).status).toBe(429);
  };

  it('agotar storefront NO consume el presupuesto de auth ni el del carrito', async () => {
    await agotar(getProduct, STOREFRONT_LIMIT, 200);

    expect((await login()).status).toBe(401);
    expect((await getCart()).status).toBe(200);
  });

  it('agotar auth NO afecta al storefront ni al carrito', async () => {
    await agotar(login, AUTH_LIMIT, 401);

    expect((await getProduct()).status).toBe(200);
    expect((await getCart()).status).toBe(200);
  });

  it('agotar el carrito NO afecta al storefront ni a auth', async () => {
    await agotar(getCart, CART_LIMIT, 200);

    expect((await getProduct()).status).toBe(200);
    expect((await login()).status).toBe(401);
  });
});
