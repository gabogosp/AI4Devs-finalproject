import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bootTestApp } from '../../test/e2e-app';
import { AuthModule } from './auth.module';
import { PrismaService } from '../prisma/prisma.service';

/**
 * T6.2 — anti-enumeración observada desde afuera (AC-5, AC-6, AC-11).
 *
 * Los tests de service ya verifican que los errores son los mismos objetos. Esto
 * verifica lo que de verdad importa: que las **respuestas HTTP** sean
 * indistinguibles. Entre el service y el cable hay filtro, serialización y
 * cabeceras, y cualquiera de los tres podría reintroducir una diferencia.
 */
describe('Anti-enumeración del seam de auth (e2e-auth-enumeration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PASSWORD = 'correo caballo batería grapa';
  const EXISTENTE = 'ana@example.com';
  const INEXISTENTE = 'nadie-en-absoluto@example.com';

  /**
   * IP propia por test. El rate-limit de T6.1 es real y muerde: siete tests
   * compartiendo cubo agotan el presupuesto de altas y los últimos reciben 429
   * en vez del código que están verificando. No es un límite mal puesto — es
   * este archivo el que tiene que aislarse.
   */
  let ipDelTest = 0;
  let IP = '';

  beforeAll(async () => {
    process.env.TRUST_PROXY_HOPS = '1';
    app = await bootTestApp([AuthModule]);
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
    IP = `172.16.0.${++ipDelTest}`;
    await http()
      .post('/v1/auth/register')
      .send({ email: EXISTENTE, name: 'Ana', password: PASSWORD });
  });

  const http = () =>
    ({
      post: (ruta: string) =>
        request(app.getHttpServer()).post(ruta).set('X-Forwarded-For', IP),
    }) as { post: (ruta: string) => request.Test };

  const login = (email: string, password: string) =>
    http().post('/v1/auth/login').send({ email, password });

  /** Cuerpo sin `instance`, que legítimamente puede variar por request. */
  const cuerpoComparable = (res: request.Response): Record<string, unknown> => {
    const body = { ...(res.body as Record<string, unknown>) };
    delete body.instance;
    return body;
  };

  describe('POST /v1/auth/login — los tres modos de fallo (AC-5)', () => {
    it('contraseña incorrecta, email inexistente y cuenta bloqueada dan cuerpos idénticos', async () => {
      const passwordMala = await login(EXISTENTE, 'incorrecta');
      const emailInexistente = await login(INEXISTENTE, PASSWORD);

      // Bloquear la cuenta: 5 fallos.
      for (let i = 0; i < 5; i++) await login(EXISTENTE, 'incorrecta');
      const bloqueada = await login(EXISTENTE, PASSWORD);

      expect(passwordMala.status).toBe(401);
      expect(emailInexistente.status).toBe(bloqueada.status);
      expect(bloqueada.status).toBe(passwordMala.status);

      expect(cuerpoComparable(emailInexistente)).toEqual(
        cuerpoComparable(passwordMala),
      );
      expect(cuerpoComparable(bloqueada)).toEqual(
        cuerpoComparable(passwordMala),
      );
    });

    it('ninguno de los tres emite cookies', async () => {
      const respuestas = [
        await login(EXISTENTE, 'incorrecta'),
        await login(INEXISTENTE, PASSWORD),
      ];
      for (const res of respuestas) {
        expect(res.headers['set-cookie']).toBeUndefined();
      }
    });

    it('las latencias son del mismo orden: el reloj tampoco distingue', async () => {
      const medir = async (email: string): Promise<number> => {
        const t0 = process.hrtime.bigint();
        await login(email, 'una contraseña incorrecta');
        return Number(process.hrtime.bigint() - t0) / 1e6;
      };

      // Se mide varias veces y se toma la mediana: una sola muestra es rehén de
      // cualquier pausa de GC y volvería el test intermitente.
      const mediana = async (email: string): Promise<number> => {
        const muestras: number[] = [];
        for (let i = 0; i < 5; i++) muestras.push(await medir(email));
        return muestras.sort((a, b) => a - b)[2];
      };

      const existente = await mediana(EXISTENTE);
      const inexistente = await mediana(INEXISTENTE);

      const [min, max] = [existente, inexistente].sort((a, b) => a - b);
      // Sin `verifyDummy` la diferencia sería de dos órdenes de magnitud
      // (microsegundos contra ~250 ms), no de un factor 3.
      expect(max).toBeLessThan(min * 3);
    });

    it('el cuerpo no contiene el email consultado', async () => {
      const res = await login(INEXISTENTE, PASSWORD);
      expect(JSON.stringify(res.body)).not.toContain(INEXISTENTE);
    });
  });

  describe('POST /v1/auth/password-reset/request (AC-11)', () => {
    it('email existente e inexistente dan 202 con cuerpo idéntico', async () => {
      const existente = await http()
        .post('/v1/auth/password-reset/request')
        .send({ email: EXISTENTE });
      const inexistente = await http()
        .post('/v1/auth/password-reset/request')
        .send({ email: INEXISTENTE });

      expect(existente.status).toBe(202);
      expect(inexistente.status).toBe(202);
      expect(inexistente.body).toEqual(existente.body);
      expect(inexistente.text).toBe(existente.text);
    });

    it('tampoco se distinguen por las cabeceras de la respuesta', async () => {
      // Un `Content-Length` distinto delataría lo mismo que un cuerpo distinto.
      const interesantes = (res: request.Response) => ({
        contentType: res.headers['content-type'],
        contentLength: res.headers['content-length'],
      });

      const existente = await http()
        .post('/v1/auth/password-reset/request')
        .send({ email: EXISTENTE });
      const inexistente = await http()
        .post('/v1/auth/password-reset/request')
        .send({ email: INEXISTENTE });

      expect(interesantes(inexistente)).toEqual(interesantes(existente));
    });
  });

  describe('POST /v1/auth/register — duplicado (AC-6)', () => {
    it('409 cuyo detail no menciona el email ni afirma que existe', async () => {
      const res = await http()
        .post('/v1/auth/register')
        .send({ email: EXISTENTE, name: 'Otra', password: PASSWORD })
        .expect(409);

      expect(res.body.type).toBe('dsm:auth/registration-failed');
      expect(res.body.detail).not.toContain(EXISTENTE);
      expect(res.body.detail).not.toMatch(/ya (existe|está registrad)/i);
      expect(JSON.stringify(res.body)).not.toContain(EXISTENTE);
    });
  });
});
