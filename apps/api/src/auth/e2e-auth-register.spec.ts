import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bootTestApp } from '../../test/e2e-app';
import { AuthModule } from './auth.module';
import { PrismaService } from '../prisma/prisma.service';
import { ACCESS_COOKIE, CSRF_COOKIE, REFRESH_COOKIE } from './cookies';

/**
 * T5.1 + T10.1 — el alta por HTTP, de punta a punta (AC-1, AC-6, AC-8).
 */
describe('POST /v1/auth/register (e2e-auth-register)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PASSWORD = 'correo caballo batería grapa';
  const ALTA = {
    email: 'ana@example.com',
    name: 'Ana Pérez',
    password: PASSWORD,
  };

  beforeAll(async () => {
    app = await bootTestApp([AuthModule]);
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE customers RESTART IDENTITY CASCADE',
    );
  });

  const alta = (body: Record<string, unknown> = ALTA) =>
    request(app.getHttpServer()).post('/v1/auth/register').send(body);

  const cookies = (res: request.Response): string[] =>
    (res.headers['set-cookie'] as unknown as string[]) ?? [];

  describe('alta exitosa (AC-1)', () => {
    it('201 y la sesión queda activa en el acto, sin verificación intermedia', async () => {
      const res = await alta().expect(201);

      const c = cookies(res);
      expect(c.some((x) => x.startsWith(`${ACCESS_COOKIE}=`))).toBe(true);
      expect(c.some((x) => x.startsWith(`${REFRESH_COOKIE}=`))).toBe(true);
      expect(c.some((x) => x.startsWith(`${CSRF_COOKIE}=`))).toBe(true);

      // Y la sesión sirve YA: `/me` responde con las cookies de esta respuesta.
      await request(app.getHttpServer())
        .get('/v1/auth/me')
        .set('Cookie', c)
        .expect(200)
        .expect((r) => expect(r.body.email).toBe('ana@example.com'));
    });

    it('el cuerpo expone EXACTAMENTE cinco campos', async () => {
      const res = await alta().expect(201);
      expect(Object.keys(res.body.customer).sort()).toEqual([
        'created_at',
        'email',
        'id',
        'name',
        'phone',
      ]);
    });

    it('ni la contraseña ni el hash salen por la respuesta (AC-8)', async () => {
      const res = await alta().expect(201);
      const cuerpo = JSON.stringify(res.body);
      expect(cuerpo).not.toContain(PASSWORD);
      expect(cuerpo).not.toContain('$2b$');
      expect(cuerpo).not.toContain('password_hash');
    });

    it('ningún token de sesión viaja en el cuerpo — sólo en cookies (AC-9)', async () => {
      const res = await alta().expect(201);
      const cuerpo = JSON.stringify(res.body);
      const access = cookies(res)
        .find((c) => c.startsWith(`${ACCESS_COOKIE}=`))!
        .split(';')[0]
        .split('=')[1];
      expect(cuerpo).not.toContain(access);
    });

    it('el hash persistido no es la contraseña', async () => {
      await alta().expect(201);
      const fila = await prisma.customer.findFirstOrThrow();
      expect(fila.password_hash).not.toBe(PASSWORD);
      expect(fila.password_hash.startsWith('$2b$')).toBe(true);
    });
  });

  describe('escalada de privilegios bloqueada en el borde', () => {
    it('mandar role:"admin" da 422, no se ignora en silencio', async () => {
      // Un campo ignorado invita a probar si alguna versión futura lo acepta;
      // un 422 dice que no existe. `forbidNonWhitelisted` hace la diferencia.
      const res = await alta({ ...ALTA, role: 'admin' }).expect(422);
      expect(res.body.errors).toBeDefined();
      expect(await prisma.customer.count()).toBe(0);
    });

    it('mandar id o password_hash también da 422', async () => {
      await alta({ ...ALTA, id: 'forzado' }).expect(422);
      await alta({ ...ALTA, password_hash: '$2b$12$loquesea' }).expect(422);
    });
  });

  describe('validación del borde', () => {
    it('email inválido → 422 con errors[]', async () => {
      const res = await alta({ ...ALTA, email: 'no-es-un-email' }).expect(422);
      expect(res.body.errors.some((e: { field: string }) => e.field === 'email')).toBe(
        true,
      );
    });

    it('name vacío → 422', () => alta({ ...ALTA, name: '' }).expect(422));

    it('sin password → 422', async () => {
      const { password: _p, ...sinPassword } = ALTA;
      await alta(sinPassword).expect(422);
    });

    it('contraseña que viola la política → 422 (la decide validatePassword, no el DTO)', async () => {
      const res = await alta({ ...ALTA, password: 'password' }).expect(422);
      expect(res.body.type).toBe('dsm:catalog/validation');
    });
  });

  describe('email ya registrado (AC-6)', () => {
    it('409 dsm:auth/registration-failed sin confirmar que la cuenta existe', async () => {
      await alta().expect(201);
      const res = await alta().expect(409);

      expect(res.body.type).toBe('dsm:auth/registration-failed');
      expect(res.body.detail).not.toContain('ana@example.com');
      expect(res.body.detail).not.toMatch(/ya (existe|está registrad)/i);
    });

    it('el alta fallida no emite cookies de sesión', async () => {
      await alta().expect(201);
      const res = await alta().expect(409);
      expect(cookies(res)).toHaveLength(0);
    });

    it('la variante en mayúsculas choca igual (normalización)', async () => {
      await alta().expect(201);
      await alta({ ...ALTA, email: '  ANA@Example.COM ' }).expect(409);
      expect(await prisma.customer.count()).toBe(1);
    });
  });
});
