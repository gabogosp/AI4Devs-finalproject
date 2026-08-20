import { execFileSync } from 'node:child_process';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bootTestApp, nuevaIpDeTest } from '../../test/e2e-app';
import { AuthModule } from './auth.module';
import { CategoriesModule } from '../categories/categories.module';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordHasher } from './password/password-hasher';
import { ConfigService } from '@nestjs/config';

/**
 * T8.1 + T8.2 — el seam admin endurecido (ADR-0009).
 *
 * Lo que se prueba acá es que US-014 haya cumplido lo que el ADR prometió:
 * reemplazar el **lado de emisión** sin tocar el contrato. Por eso los tests
 * miran tanto lo nuevo (login por credenciales) como lo viejo (bootstrap token,
 * shape de la respuesta, token que abre `/v1/admin/*`).
 */
describe('Login admin por credenciales (e2e-auth-admin-credentials)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let hasher: PasswordHasher;

  const ADMIN_EMAIL = 'admin@dsmferreteria.com.ar';
  const ADMIN_PASSWORD = 'contraseña del administrador';
  const CLIENTE_EMAIL = 'cliente@example.com';
  const CLIENTE_PASSWORD = 'contraseña de la clienta';

  let ip = '';

  beforeAll(async () => {
    process.env.TRUST_PROXY_HOPS = '1';
    app = await bootTestApp([AuthModule, CategoriesModule]);
    prisma = app.get(PrismaService);
    hasher = new PasswordHasher(app.get(ConfigService));
  });
  afterAll(async () => {
    await app?.close();
    delete process.env.TRUST_PROXY_HOPS;
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE customers RESTART IDENTITY CASCADE',
    );
    ip = nuevaIpDeTest();

    await prisma.customer.create({
      data: {
        email: ADMIN_EMAIL,
        name: 'Administrador',
        password_hash: await hasher.hash(ADMIN_PASSWORD),
        role: 'admin',
      },
    });
    await prisma.customer.create({
      data: {
        email: CLIENTE_EMAIL,
        name: 'Clienta',
        password_hash: await hasher.hash(CLIENTE_PASSWORD),
        role: 'customer',
      },
    });
  });

  const http = () => {
    const agente = request(app.getHttpServer());
    return {
      get: (r: string) => agente.get(r).set('X-Forwarded-For', ip),
      post: (r: string) => agente.post(r).set('X-Forwarded-For', ip),
    };
  };

  const loginAdmin = (email: string, password: string) =>
    http().post('/v1/admin/auth/login').send({ email, password });

  describe('lo nuevo: credenciales (T8.1)', () => {
    it('200 con el MISMO shape { token } de US-001', async () => {
      const res = await loginAdmin(ADMIN_EMAIL, ADMIN_PASSWORD).expect(200);
      // El churn cero en el frontend depende de esto: la respuesta no ganó ni
      // perdió campos.
      expect(Object.keys(res.body)).toEqual(['token']);
      expect(typeof res.body.token).toBe('string');
    });

    it('el token abre GET /v1/admin/categories — el contrato role=admin se preservó', async () => {
      const { body } = await loginAdmin(ADMIN_EMAIL, ADMIN_PASSWORD).expect(200);
      await http()
        .get('/v1/admin/categories')
        .set('Authorization', `Bearer ${body.token}`)
        .expect(200);
    });

    it('además emite cookies de sesión, sin romper el camino del header', async () => {
      const res = await loginAdmin(ADMIN_EMAIL, ADMIN_PASSWORD).expect(200);
      const cookies = res.headers['set-cookie'] as unknown as string[];
      expect(cookies).toHaveLength(3);
    });

    it('las credenciales de un CLIENTE dan el mismo 401 que una contraseña mala', async () => {
      // Si el error dijera "esta cuenta no es admin", confirmaría que la cuenta
      // existe. El panel es un blanco más valioso que el storefront.
      const noEsAdmin = await loginAdmin(CLIENTE_EMAIL, CLIENTE_PASSWORD);
      const passwordMala = await loginAdmin(ADMIN_EMAIL, 'incorrecta');

      expect(noEsAdmin.status).toBe(401);
      expect(passwordMala.status).toBe(401);

      const comparable = (b: Record<string, unknown>) => {
        const copia = { ...b };
        delete copia.instance;
        return copia;
      };
      expect(comparable(noEsAdmin.body)).toEqual(comparable(passwordMala.body));
      expect(noEsAdmin.body.type).toBe('dsm:auth/invalid-credentials');
    });

    it('el admin hereda el lockout: al quinto fallo se bloquea', async () => {
      for (let i = 0; i < 5; i++) await loginAdmin(ADMIN_EMAIL, 'incorrecta');
      // Y ni siquiera la contraseña correcta entra mientras dure el bloqueo.
      await loginAdmin(ADMIN_EMAIL, ADMIN_PASSWORD).expect(401);

      const fila = await prisma.customer.findFirstOrThrow({
        where: { email: ADMIN_EMAIL },
      });
      expect(fila.locked_until).not.toBeNull();
    });

    it('un email inexistente da el mismo 401', async () => {
      const res = await loginAdmin('nadie@example.com', ADMIN_PASSWORD);
      expect(res.status).toBe(401);
      expect(res.body.type).toBe('dsm:auth/invalid-credentials');
    });

    it('ni la contraseña ni el hash salen por la respuesta', async () => {
      const res = await loginAdmin(ADMIN_EMAIL, ADMIN_PASSWORD).expect(200);
      const cuerpo = JSON.stringify(res.body);
      expect(cuerpo).not.toContain(ADMIN_PASSWORD);
      expect(cuerpo).not.toContain('$2b$');
    });
  });

  describe('lo viejo sigue igual: bootstrap token', () => {
    it('el camino de bootstrap responde como antes', async () => {
      const res = await http()
        .post('/v1/admin/auth/login')
        .send({ bootstrapToken: 'token-incorrecto' });
      // 401 (incorrecto) o 503 (deshabilitado): el camino existe y no cambió.
      expect([401, 503]).toContain(res.status);
    });

    it('un body vacío da 422, no un 500 ni un token', async () => {
      await http().post('/v1/admin/auth/login').send({}).expect(422);
    });
  });

  describe('siembra del admin (T8.2)', () => {
    const correrSeed = (env: Record<string, string>): string =>
      execFileSync('pnpm', ['--filter', '@dsm/db', 'seed'], {
        cwd: `${__dirname}/../../../..`,
        env: { ...process.env, ...env },
        encoding: 'utf-8',
        stdio: 'pipe',
      });

    it('sin las env de siembra no crea admin y NO falla', async () => {
      await prisma.$executeRawUnsafe(
        'TRUNCATE TABLE customers RESTART IDENTITY CASCADE',
      );
      const salida = correrSeed({
        ADMIN_SEED_EMAIL: '',
        ADMIN_SEED_PASSWORD: '',
      });

      expect(salida).toContain('Seed admin omitido');
      expect(await prisma.customer.count({ where: { role: 'admin' } })).toBe(0);
    });

    it('correrlo dos veces deja UNA fila admin y el login sigue andando', async () => {
      await prisma.$executeRawUnsafe(
        'TRUNCATE TABLE customers RESTART IDENTITY CASCADE',
      );
      const env = {
        ADMIN_SEED_EMAIL: '  Admin@DSMferreteria.com.AR ',
        ADMIN_SEED_PASSWORD: ADMIN_PASSWORD,
        BCRYPT_COST: '4',
      };
      correrSeed(env);
      correrSeed(env);

      // El email se normaliza al sembrar; si no, la segunda corrida crearía una
      // segunda fila y el UNIQUE no lo impediría (son strings distintos).
      expect(await prisma.customer.count({ where: { role: 'admin' } })).toBe(1);

      await loginAdmin(ADMIN_EMAIL, ADMIN_PASSWORD).expect(200);
    }, 120_000);

    it('la contraseña sembrada no aparece en la salida del seed', async () => {
      const salida = correrSeed({
        ADMIN_SEED_EMAIL: ADMIN_EMAIL,
        ADMIN_SEED_PASSWORD: ADMIN_PASSWORD,
        BCRYPT_COST: '4',
      });
      expect(salida).not.toContain(ADMIN_PASSWORD);
      expect(salida).not.toContain('$2b$');
    }, 120_000);
  });
});
