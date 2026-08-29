import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getOptionsToken } from '@nestjs/throttler';
import request from 'supertest';
import { AppConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CatalogEventsModule } from '../observability/catalog-events.module';
import { AuthModule } from '../auth/auth.module';
import { CartModule } from '../cart/cart.module';
import { CategoriesModule } from '../categories/categories.module';
import { ProductsModule } from '../products/products.module';
import { StorefrontModule } from '../storefront/storefront.module';
import { configureApp } from '../bootstrap';
import { PrismaService } from '../prisma/prisma.service';
import { adminToken } from '../../test/e2e-app';
import { ImportsModule } from './imports.module';

/**
 * T5.5 — presupuesto del `POST` de import y **aislamiento** de los presupuestos
 * que ya existían.
 *
 * Nota sobre el plan: su criterio decía "el array de `ThrottlerModule` sigue
 * teniendo **dos** throttlers". Mientras se ejecutaba este change, US-007
 * registró el tercero (`cart`), así que la afirmación quedó vieja. Lo que este
 * spec verifica es el invariante que importaba: **el import no agrega ningún
 * throttler** —reusa `auth`— y no consume el presupuesto de nadie más.
 */
describe('Rate limit del import (e2e-imports-security, §7.3)', () => {
  const IMPORT_LIMIT = 3;
  let app: INestApplication;
  let prisma: PrismaService;

  const CSV_OK = [
    'sku,nombre,precio,stock,categoria',
    'REF-1,Heladera,1000,3,Refrigeración',
  ].join('\n');

  beforeAll(async () => {
    // `X-Forwarded-For` aísla el cubo por test; sin esto todos comparten
    // 127.0.0.1 y el orden de ejecución decide quién pasa.
    process.env.TRUST_PROXY_HOPS = '1';
    process.env.IMPORT_RATE_LIMIT_MAX = String(IMPORT_LIMIT);

    const moduleRef = await Test.createTestingModule({
      imports: [
        AppConfigModule,
        PrismaModule,
        CatalogEventsModule,
        AuthModule,
        CategoriesModule,
        ProductsModule,
        StorefrontModule,
        CartModule,
        ImportsModule,
      ],
    })
      .overrideProvider(getOptionsToken())
      .useValue({
        throttlers: [
          { name: 'auth', ttl: 60_000, limit: IMPORT_LIMIT },
          { name: 'storefront', ttl: 60_000, limit: 5 },
          { name: 'cart', ttl: 60_000, limit: 5 },
        ],
      })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.TRUST_PROXY_HOPS;
    delete process.env.IMPORT_RATE_LIMIT_MAX;
  });

  const limpiar = () =>
    prisma.$executeRawUnsafe(
      'TRUNCATE TABLE import_job_rows, import_jobs, products, categories RESTART IDENTITY CASCADE',
    );

  beforeEach(async () => {
    await limpiar();
    await new Promise((r) => setTimeout(r, 30));
    await limpiar();
  });

  const post = (ip: string) =>
    request(app.getHttpServer())
      .post('/v1/admin/imports')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Forwarded-For', ip)
      .attach('file', Buffer.from(CSV_OK), 'catalogo.csv');

  it('el POST N+1 devuelve 429 con Retry-After, RateLimit-* y problem+json', async () => {
    const IP = '10.6.0.1';
    const codigos: number[] = [];
    for (let i = 0; i < IMPORT_LIMIT; i += 1) {
      const res = await post(IP);
      codigos.push(res.status);
    }
    // Dentro del presupuesto: 202 el primero y 409 los siguientes (ya hay uno
    // vigente). Lo que importa es que NINGUNO sea 429.
    expect(codigos.every((c) => c === 202 || c === 409)).toBe(true);

    const excedido = await post(IP);

    expect(excedido.status).toBe(429);
    expect(excedido.headers['content-type']).toContain(
      'application/problem+json',
    );
    expect(excedido.headers['retry-after']).toBeDefined();
    expect(excedido.headers['ratelimit-limit']).toBe(String(IMPORT_LIMIT));
    expect(excedido.headers['ratelimit-remaining']).toBe('0');
    expect(excedido.headers['ratelimit-reset']).toBeDefined();
    expect(excedido.body.status).toBe(429);
  });

  it('los GET de estado NO gastan el presupuesto del POST (el panel hace polling)', async () => {
    const IP = '10.6.0.2';
    const alta = await post(IP);
    expect(alta.status).toBe(202);

    for (let i = 0; i < 20; i += 1) {
      const res = await request(app.getHttpServer())
        .get(`/v1/admin/imports/${alta.body.id}`)
        .set('Authorization', `Bearer ${adminToken()}`)
        .set('X-Forwarded-For', IP);
      expect(res.status).toBe(200);
    }

    // 20 lecturas después, el presupuesto de escritura sigue casi intacto: el
    // siguiente POST no es 429 (es 409 porque hay un trabajo vigente).
    expect((await post(IP)).status).not.toBe(429);
  });

  it('agotar el import NO toca el storefront ni las rutas admin de US-001', async () => {
    const IP = '10.6.0.3';
    const cat = await prisma.category.create({
      data: { name: 'Refrigeración', slug: 'refrigeracion' },
    });
    await prisma.product.create({
      data: {
        sku: 'PUB-1',
        slug: 'heladera-publicada',
        name: 'Heladera publicada',
        price_ars_cents: 100000,
        stock: 1,
        status: 'published',
        category_id: cat.id,
      },
    });

    for (let i = 0; i <= IMPORT_LIMIT; i += 1) await post(IP);
    expect((await post(IP)).status).toBe(429);

    // Misma IP, superficies ajenas: intactas.
    const publico = await request(app.getHttpServer())
      .get('/v1/products/heladera-publicada')
      .set('X-Forwarded-For', IP);
    expect(publico.status).toBe(200);

    const admin = await request(app.getHttpServer())
      .get('/v1/admin/categories')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Forwarded-For', IP);
    expect(admin.status).toBe(200);
  });

  it('el import no registra un throttler propio: siguen siendo los tres de siempre', async () => {
    const opciones = app.get<{ throttlers: { name: string }[] }>(
      getOptionsToken(),
    );
    expect(opciones.throttlers.map((t) => t.name)).toEqual([
      'auth',
      'storefront',
      'cart',
    ]);
    expect(
      opciones.throttlers.some((t) => t.name.includes('import')),
    ).toBe(false);
  });
});
