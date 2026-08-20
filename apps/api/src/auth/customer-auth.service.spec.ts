import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { CustomersRepository } from './customers.repository';
import { RefreshTokensRepository } from './refresh-tokens.repository';
import { PasswordHasher } from './password/password-hasher';
import { CredentialsService } from './credentials.service';
import { SessionService } from './session.service';
import { CustomerAuthService } from './customer-auth.service';
import { InvalidCredentialsError, RegistrationFailedError } from '../common/errors/auth-errors';
import { ValidationError } from '../common/errors/domain-errors';

describe('CustomerAuthService (AC-1, AC-2, AC-6)', () => {
  const prisma = new PrismaService();
  const customers = new CustomersRepository(prisma);
  const refreshTokens = new RefreshTokensRepository(prisma);
  const config = new ConfigService({
    BCRYPT_COST: 4,
    AUTH_ACCESS_TTL_MIN: 15,
    AUTH_REFRESH_TTL_DAYS: 30,
    AUTH_LOGIN_MAX_FAILURES: 5,
  }) as ConfigService;
  const hasher = new PasswordHasher(config);
  const credentials = new CredentialsService(customers, hasher, config);
  const sessions = new SessionService(
    new JwtService({}),
    config,
    refreshTokens,
  );
  const service = new CustomerAuthService(
    customers,
    hasher,
    credentials,
    sessions,
  );

  const PASSWORD = 'correo caballo batería grapa';
  const alta = () =>
    service.register({
      email: 'ana@example.com',
      name: 'Ana',
      password: PASSWORD,
    });

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE customers RESTART IDENTITY CASCADE',
    );
  });

  describe('register (AC-1)', () => {
    it('crea la cuenta y devuelve una sesión activa en la MISMA operación', async () => {
      // AC-1: sin paso de verificación de email intermedio.
      const { customer, session } = await alta();
      expect(customer.email).toBe('ana@example.com');
      expect(session.accessToken).toBeTruthy();
      expect(session.refreshToken).toBeTruthy();
      expect(await prisma.refreshToken.count()).toBe(1);
    });

    it('fija role="customer" server-side', async () => {
      const { customer } = await alta();
      expect(customer.role).toBe('customer');
      expect(CustomerAuthService.rolPorDefecto).toBe('customer');
    });

    it('no hay forma de pedir role="admin": el tipo de entrada no tiene el campo', async () => {
      // Se fuerza el escape de tipos para simular un body malicioso que llegara
      // entero al servicio. Aun así el rol persistido es 'customer', porque el
      // repositorio lo escribe explícito y `CreateCustomerData` no lo acepta.
      const malicioso = {
        email: 'atacante@example.com',
        name: 'Atacante',
        password: PASSWORD,
        role: 'admin',
      } as unknown as Parameters<typeof service.register>[0];

      const { customer } = await service.register(malicioso);
      expect(customer.role).toBe('customer');

      const enBase = await prisma.customer.findFirstOrThrow({
        where: { email: 'atacante@example.com' },
      });
      expect(enBase.role).toBe('customer');
    });

    it('la contraseña NO se guarda en claro y el hash no sale en el resultado (AC-8)', async () => {
      const { customer } = await alta();
      expect(JSON.stringify(customer)).not.toContain(PASSWORD);
      expect(customer).not.toHaveProperty('password_hash');

      const enBase = await prisma.customer.findFirstOrThrow({
        where: { email: 'ana@example.com' },
      });
      expect(enBase.password_hash).not.toBe(PASSWORD);
      expect(enBase.password_hash.startsWith('$2b$')).toBe(true);
    });

    it('phone es opcional', async () => {
      const { customer } = await service.register({
        email: 'con-tel@example.com',
        name: 'Con Teléfono',
        phone: '+54 9 11 5555-5555',
        password: PASSWORD,
      });
      expect(customer.phone).toBe('+54 9 11 5555-5555');
    });
  });

  describe('register — email ya registrado (AC-6)', () => {
    it('lanza RegistrationFailedError sin crear fila NI emitir sesión', async () => {
      await alta();
      const antesClientes = await prisma.customer.count();
      const antesTokens = await prisma.refreshToken.count();

      await expect(alta()).rejects.toBeInstanceOf(RegistrationFailedError);

      expect(await prisma.customer.count()).toBe(antesClientes);
      // Una sesión emitida para un alta fallida sería una sesión sin dueño.
      expect(await prisma.refreshToken.count()).toBe(antesTokens);
    });

    it('el error no confirma que el email ya existe', async () => {
      await alta();
      const error = (await alta().catch((e: Error) => e)) as Error;
      expect(error.message).not.toContain('ana@example.com');
      expect(error.message).not.toMatch(/ya (existe|está registrado)/i);
    });

    it('la variante con mayúsculas y espacios también choca (normalización)', async () => {
      await alta();
      await expect(
        service.register({
          email: '  ANA@Example.COM ',
          name: 'Otra',
          password: PASSWORD,
        }),
      ).rejects.toBeInstanceOf(RegistrationFailedError);
    });
  });

  describe('register — política de contraseña', () => {
    it('una contraseña del corpus lanza ValidationError SIN tocar la base', async () => {
      await expect(
        service.register({
          email: 'nuevo@example.com',
          name: 'Nuevo',
          password: 'password',
        }),
      ).rejects.toBeInstanceOf(ValidationError);
      // El 422 no debe depender de si el email existe: se decide antes.
      expect(await prisma.customer.count()).toBe(0);
    });

    it('una contraseña corta lanza ValidationError con el campo señalado', async () => {
      const error = (await service
        .register({
          email: 'nuevo@example.com',
          name: 'Nuevo',
          password: 'ab3!',
        })
        .catch((e: Error) => e)) as ValidationError;

      expect(error).toBeInstanceOf(ValidationError);
      expect(error.fieldErrors?.[0]?.field).toBe('password');
    });
  });

  describe('login (AC-2)', () => {
    it('las credenciales del alta sirven para entrar después', async () => {
      await alta();
      const { customer, session } = await service.login(
        'ana@example.com',
        PASSWORD,
      );
      expect(customer.email).toBe('ana@example.com');
      expect(session.accessToken).toBeTruthy();
    });

    it('cada login abre una familia nueva: el alta y el login no comparten sesión', async () => {
      const registro = await alta();
      const login = await service.login('ana@example.com', PASSWORD);
      expect(login.session.familyId).not.toBe(registro.session.familyId);
    });

    it('contraseña incorrecta → InvalidCredentialsError y ninguna sesión nueva', async () => {
      await alta();
      const antes = await prisma.refreshToken.count();
      await expect(
        service.login('ana@example.com', 'otra cosa'),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
      expect(await prisma.refreshToken.count()).toBe(antes);
    });
  });
});
