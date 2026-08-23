import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bootTestApp } from '../../test/e2e-app';
import { AuthModule } from './auth.module';
import { getOptionsToken } from '@nestjs/throttler';
import { StorefrontModule } from '../storefront/storefront.module';
import { PrismaService } from '../prisma/prisma.service';

/**
 * T6.1 — presupuestos por ruta (§7.3) + no contaminación del throttler público.
 *
 * Cada `it` usa una IP distinta vía `X-Forwarded-For`: el throttler cuenta por
 * IP, y sin eso los tests se pisarían entre sí y el orden de ejecución
 * decidiría cuáles pasan.
 */
describe('Rate-limit del seam de auth (e2e-auth-ratelimit)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PASSWORD = 'correo caballo batería grapa';

  beforeAll(async () => {
    // Se confía en un salto para que `X-Forwarded-For` aísle los cubos por
    // test. Sin esto Express devuelve siempre 127.0.0.1 y los tests comparten
    // presupuesto, así que el orden de ejecución decidiría cuáles pasan — que es
    // exactamente el bug de producción que este ajuste destapó (ver
    // TRUST_PROXY_HOPS).
    process.env.TRUST_PROXY_HOPS = '1';
    app = await bootTestApp([AuthModule, StorefrontModule]);
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app?.close();
    delete process.env.TRUST_PROXY_HOPS;
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE customers RESTART IDENTITY CASCADE',
    );
  });

  const http = () => request(app.getHttpServer());

  describe('POST /v1/auth/login — 10 por 15 min', () => {
    const IP = '10.0.0.1';

    it('el 11.º intento da 429 con Retry-After y envelope problem+json', async () => {
      await http()
        .post('/v1/auth/register')
        .set('X-Forwarded-For', IP)
        .send({ email: 'ana@example.com', name: 'Ana', password: PASSWORD });

      const codigos: number[] = [];
      for (let i = 0; i < 12; i++) {
        const res = await http()
          .post('/v1/auth/login')
          .set('X-Forwarded-For', IP)
          .send({ email: 'ana@example.com', password: 'incorrecta' });
        codigos.push(res.status);

        if (res.status === 429) {
          expect(res.headers['retry-after']).toBeDefined();
          expect(res.headers['ratelimit-limit']).toBeDefined();
          expect(res.headers['ratelimit-remaining']).toBe('0');
          expect(res.headers['ratelimit-reset']).toBeDefined();
          expect(res.headers['content-type']).toContain('application/problem+json');
          expect(res.body.status).toBe(429);
          break;
        }
      }

      // Los primeros son 401 (credenciales), no 429: el límite no muerde antes.
      expect(codigos.filter((c) => c === 401).length).toBeGreaterThanOrEqual(10);
      expect(codigos).toContain(429);
    });
  });

  describe('POST /v1/auth/register — 5 por hora', () => {
    it('el 6.º alta desde la misma IP da 429', async () => {
      const IP = '10.0.0.2';
      const codigos: number[] = [];
      for (let i = 0; i < 7; i++) {
        const res = await http()
          .post('/v1/auth/register')
          .set('X-Forwarded-For', IP)
          .send({
            email: `alta-${i}@example.com`,
            name: `Alta ${i}`,
            password: PASSWORD,
          });
        codigos.push(res.status);
      }
      // Un alta cuesta un bcrypt de cost 12 y su abuso llena la tabla de cuentas
      // basura: por eso va más apretada que el login.
      expect(codigos.filter((c) => c === 201)).toHaveLength(5);
      expect(codigos).toContain(429);
    });
  });

  describe('POST /v1/auth/password-reset/request — 5 por hora por IP', () => {
    it('el 6.º pedido da 429 aunque cada uno apunte a una cuenta distinta', async () => {
      // El límite por cuenta del service no cubre este caso: cambiar de
      // destinatario lo evade. Por eso hacen falta los dos límites.
      const IP = '10.0.0.3';
      const codigos: number[] = [];
      for (let i = 0; i < 7; i++) {
        const res = await http()
          .post('/v1/auth/password-reset/request')
          .set('X-Forwarded-For', IP)
          .send({ email: `victima-${i}@example.com` });
        codigos.push(res.status);
      }
      expect(codigos.filter((c) => c === 202)).toHaveLength(5);
      expect(codigos).toContain(429);
    });
  });

  describe('el throttler del storefront NO se contaminó (US-003)', () => {
    it('tras agotar el presupuesto de auth, el catálogo público sigue respondiendo', async () => {
      const IP = '10.0.0.4';
      for (let i = 0; i < 12; i++) {
        await http()
          .post('/v1/auth/login')
          .set('X-Forwarded-For', IP)
          .send({ email: 'nadie@example.com', password: 'x' });
      }

      // Misma IP, misma corrida: si los presupuestos estuvieran mezclados, esta
      // llamada daría 429 y una ráfaga de logins fallidos podría tirar abajo la
      // vidriera pública.
      const res = await http()
        .get('/v1/categories')
        .set('X-Forwarded-For', IP);
      expect(res.status).not.toBe(429);
    });
  });

  it('existen exactamente CINCO throttlers nombrados: uno por superficie, no uno por ruta', () => {
    // El plan de US-014 lo pedía explícito con dos: registrar un throttler por
    // ruta habría sido la salida fácil y habría dejado cada presupuesto sin
    // gobierno central; los límites por ruta van como `@Throttle` sobre el
    // throttler de la superficie.
    //
    // US-007 (T4.3) suma el tercero, `cart` — la primera superficie pública de
    // escritura, con su propio presupuesto por §7.3. Sigue siendo **uno por
    // superficie**: el límite más estricto de las escrituras del carrito es un
    // `@Throttle({ cart: … })` en el handler, no un throttler nuevo.
    //
    // US-005 (T4.2) suma el cuarto, `enrichment` — la única superficie donde un request de
    // más cuesta **plata** (llamadas pagas al proveedor de IA), y por eso no comparte el cubo
    // de `auth`: unas cuantas corridas dejarían al dueño sin poder entrar al panel. Sigue
    // siendo uno por superficie.
    //
    // US-004 (T3.3) suma el quinto, `search` — la única superficie **pública** que puede
    // costar plata en un tercero. Su presupuesto real (20/min) vive en el `@Throttle` del
    // handler; el registro global lleva un techo inalcanzable, porque el throttler aplica
    // todos los nombres a toda ruta guardada.
    //
    // Se lee la configuración REAL que resolvió el contenedor, no el archivo
    // fuente: lo que gobierna en runtime es esto.
    const opciones = app.get<Array<{ name?: string }>>(getOptionsToken());
    const nombres = opciones.map((o) => o.name).sort();
    expect(nombres).toEqual(['auth', 'cart', 'enrichment', 'search', 'storefront']);
  });
});
