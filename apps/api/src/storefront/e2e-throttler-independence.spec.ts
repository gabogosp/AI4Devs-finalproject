import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getOptionsToken } from '@nestjs/throttler';
import request from 'supertest';
import { AppConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CatalogEventsModule } from '../observability/catalog-events.module';
import { AuthModule } from '../auth/auth.module';
import { configureApp } from '../bootstrap';
import { StorefrontModule } from './storefront.module';
import { PrismaService } from '../prisma/prisma.service';

/**
 * m4 (audit): los throttlers `auth` (US-001) y `storefront` (US-003) son
 * INDEPENDIENTES. Agotar uno no consume el presupuesto del otro — el
 * `@SkipThrottle` cruzado los aísla. Fresh app por test → storage del throttler
 * en cero.
 */
describe('Throttlers auth/storefront independientes (e2e-throttler-independence)', () => {
  const AUTH_LIMIT = 2;
  const STOREFRONT_LIMIT = 3;
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        AppConfigModule,
        PrismaModule,
        CatalogEventsModule,
        AuthModule,
        StorefrontModule,
      ],
    })
      .overrideProvider(getOptionsToken())
      .useValue({
        throttlers: [
          { name: 'auth', ttl: 60_000, limit: AUTH_LIMIT },
          { name: 'storefront', ttl: 60_000, limit: STOREFRONT_LIMIT },
        ],
      })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    const prisma = app.get(PrismaService);
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE products, categories RESTART IDENTITY CASCADE',
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

  it('agotar el throttler storefront NO consume el presupuesto de auth', async () => {
    // Agota storefront: STOREFRONT_LIMIT × 200, el siguiente 429.
    for (let i = 0; i < STOREFRONT_LIMIT; i += 1) {
      expect((await getProduct()).status).toBe(200);
    }
    expect((await getProduct()).status).toBe(429);

    // Auth sigue con todo su presupuesto: rechaza por credencial (401), no por throttle.
    expect((await login()).status).toBe(401);
  });

  it('agotar el throttler auth NO afecta a la superficie pública', async () => {
    // Agota auth: AUTH_LIMIT × 401 (credencial inválida), el siguiente 429.
    for (let i = 0; i < AUTH_LIMIT; i += 1) {
      expect((await login()).status).toBe(401);
    }
    expect((await login()).status).toBe(429);

    // La ficha pública sigue respondiendo 200 (su throttler no se tocó).
    expect((await getProduct()).status).toBe(200);
  });
});
