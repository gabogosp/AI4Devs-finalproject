import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getOptionsToken } from '@nestjs/throttler';
import request from 'supertest';
import { AppConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CatalogEventsModule } from '../observability/catalog-events.module';
import { configureApp } from '../bootstrap';
import { StorefrontModule } from './storefront.module';
import { PrismaService } from '../prisma/prisma.service';

/**
 * e2e del rate-limit de la superficie pública (US-003 §7.3). El límite NO se
 * puede bajar por env (ConfigModule captura process.env al importarse), así que
 * se sobreescriben las opciones del throttler por DI — igual que el spec de auth.
 */
describe('Storefront rate-limit (e2e-storefront-security, §7.3)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const LIMIT = 3;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, PrismaModule, CatalogEventsModule, StorefrontModule],
    })
      .overrideProvider(getOptionsToken())
      .useValue({ throttlers: [{ name: 'storefront', ttl: 60_000, limit: LIMIT }] })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE products, categories RESTART IDENTITY CASCADE',
    );
    const cat = await prisma.category.create({
      data: { name: 'Refrigeración', slug: 'refrigeracion' },
    });
    await prisma.product.create({
      data: {
        sku: 'RL-001',
        slug: 'heladera-rate-limit',
        name: 'Heladera',
        price_ars_cents: 100000,
        stock: 5,
        status: 'published',
        category_id: cat.id,
      },
    });
  });
  afterAll(async () => {
    await app?.close();
  });

  it('excederse en la ficha pública → 429 con Retry-After en problem+json', async () => {
    const get = () =>
      request(app.getHttpServer()).get('/v1/products/heladera-rate-limit');

    // Dentro del límite: 200.
    for (let i = 0; i < LIMIT; i += 1) {
      expect((await get()).status).toBe(200);
    }

    // Excedido: el throttle corta con 429.
    const blocked = await get();
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    expect(blocked.headers['ratelimit-limit']).toBeDefined();
    // El body del 429 sale como RFC 7807 (envelope vía el filtro).
    expect(blocked.body).toHaveProperty('type');
    expect(blocked.body).toHaveProperty('status', 429);
    // m2: el title del 429 es el correcto (no el genérico "Error").
    expect(blocked.body.title).toBe('Too Many Requests');
    // M1: un 429 no lleva header cacheable (el interceptor sólo corre en 2xx).
    expect(blocked.headers['cache-control'] ?? '').not.toContain('max-age=60');
  });
});
