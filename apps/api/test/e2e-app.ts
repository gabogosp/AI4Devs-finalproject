import { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AppConfigModule } from '../src/config/config.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { CatalogEventsModule } from '../src/observability/catalog-events.module';
import { configureApp } from '../src/bootstrap';

/**
 * Helper e2e-nest: arranca una app con Config validado + Prisma + los módulos
 * de dominio bajo prueba, aplicando el mismo `configureApp` (ValidationPipe +
 * filtro RFC 7807) que producción.
 */
export async function bootTestApp(
  modules: Type<unknown>[],
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppConfigModule, PrismaModule, CatalogEventsModule, ...modules],
  }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}

/** Firma un JWT admin válido para el AdminGuard (mismo JWT_SECRET del test env). */
export function adminToken(): string {
  const jwt = new JwtService({});
  return jwt.sign({ role: 'admin', sub: 'admin' }, {
    secret: process.env.JWT_SECRET,
  });
}

export function customerToken(): string {
  const jwt = new JwtService({});
  return jwt.sign({ role: 'customer', sub: 'c1' }, {
    secret: process.env.JWT_SECRET,
  });
}

/** Vacía el catálogo (products→categories por FK) para tests deterministas. */
export async function truncateCatalog(prisma: {
  $executeRawUnsafe: (sql: string) => Promise<unknown>;
}): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE products, categories RESTART IDENTITY CASCADE',
  );
}
