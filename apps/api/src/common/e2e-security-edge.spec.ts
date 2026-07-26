import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getOptionsToken } from '@nestjs/throttler';
import request from 'supertest';
import { bootTestApp } from '../../test/e2e-app';
import { AppConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CatalogEventsModule } from '../observability/catalog-events.module';
import { configureApp } from '../bootstrap';
import { AuthModule } from '../auth/auth.module';
import { CategoriesModule } from '../categories/categories.module';

/**
 * Controles §7 del borde HTTP (security-standards): CORS con allowlist exacta
 * (§7.2), rate limiting de la superficie de auth (§7.3) y security headers
 * (§7.1, perfil API-only).
 *
 * Contexto: la ausencia de CORS la encontró la E2E cross-stack (OQ-QA-4) — el
 * panel corre en otro origen que la API. Al auditarlo aparecieron también el
 * rate limit y los headers ausentes. Estos tests fijan los tres.
 */
const ALLOWED = 'http://localhost:3200';
const FORBIDDEN = 'http://evil.example.com';

describe('Borde HTTP — controles §7', () => {
  describe('§7.2 CORS — allowlist exacta', () => {
    let app: INestApplication;
    beforeAll(async () => {
      app = await bootTestApp([AuthModule, CategoriesModule]);
    });
    afterAll(async () => {
      await app?.close();
    });

    it('preflight desde un origen permitido → refleja ese origen exacto', async () => {
      const res = await request(app.getHttpServer())
        .options('/v1/admin/categories')
        .set('Origin', ALLOWED)
        .set('Access-Control-Request-Method', 'GET');

      expect(res.status).toBeLessThan(400);
      expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
      // Nunca el comodín: es incompatible con credentials y está prohibido.
      expect(res.headers['access-control-allow-origin']).not.toBe('*');
    });

    it('origen fuera de la allowlist → sin Access-Control-Allow-Origin', async () => {
      const res = await request(app.getHttpServer())
        .options('/v1/admin/categories')
        .set('Origin', FORBIDDEN)
        .set('Access-Control-Request-Method', 'GET');

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('no hace match por sufijo (el bypass clásico)', async () => {
      const res = await request(app.getHttpServer())
        .options('/v1/admin/categories')
        .set('Origin', 'http://localhost:3200.evil.com')
        .set('Access-Control-Request-Method', 'GET');

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('el preflight cachea ≤ 24 h', async () => {
      const res = await request(app.getHttpServer())
        .options('/v1/admin/categories')
        .set('Origin', ALLOWED)
        .set('Access-Control-Request-Method', 'GET');

      expect(Number(res.headers['access-control-max-age'])).toBeLessThanOrEqual(
        86_400,
      );
    });
  });

  describe('§7.1 security headers (perfil API-only)', () => {
    let app: INestApplication;
    beforeAll(async () => {
      app = await bootTestApp([AuthModule, CategoriesModule]);
    });
    afterAll(async () => {
      await app?.close();
    });

    it('toda respuesta lleva el baseline de cabeceras', async () => {
      const res = await request(app.getHttpServer()).get('/v1/admin/categories');

      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['strict-transport-security']).toMatch(/max-age=\d+/);
      expect(res.headers['referrer-policy']).toBe(
        'strict-origin-when-cross-origin',
      );
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['content-security-policy']).toContain(
        "default-src 'none'",
      );
      expect(res.headers['content-security-policy']).toContain(
        "frame-ancestors 'none'",
      );
    });

    it('las respuestas de /v1/admin no se cachean', async () => {
      const res = await request(app.getHttpServer()).get('/v1/admin/categories');
      expect(res.headers['cache-control']).toBe('no-store');
    });
  });

  describe('§7.3 rate limiting de la superficie de auth', () => {
    let app: INestApplication;
    const LIMIT = 3;

    beforeAll(async () => {
      // El límite NO se puede bajar por env acá: `ConfigModule.forRoot` captura
      // `process.env` al **importarse** el módulo, antes de este `beforeAll`.
      // Se sobreescriben las opciones del throttler por DI, que es determinista.
      const moduleRef = await Test.createTestingModule({
        imports: [AppConfigModule, PrismaModule, CatalogEventsModule, AuthModule],
      })
        .overrideProvider(getOptionsToken())
        .useValue({ throttlers: [{ name: 'auth', ttl: 60_000, limit: LIMIT }] })
        .compile();
      app = moduleRef.createNestApplication();
      configureApp(app);
      await app.init();
    });
    afterAll(async () => {
      await app?.close();
    });

    it('excederse en el login → 429 con Retry-After, sin filtrar el token', async () => {
      const post = () =>
        request(app.getHttpServer())
          .post('/v1/admin/auth/login')
          .send({ bootstrapToken: 'brute-force-attempt' });

      // Dentro del límite: rechaza por credencial (401), no por throttle.
      for (let i = 0; i < LIMIT; i += 1) {
        expect((await post()).status).toBe(401);
      }

      // Excedido: el throttle corta.
      const blocked = await post();
      expect(blocked.status).toBe(429);
      expect(blocked.headers['retry-after']).toBeDefined();
      expect(JSON.stringify(blocked.body)).not.toContain(
        process.env.ADMIN_BOOTSTRAP_TOKEN,
      );
    });
  });
});
