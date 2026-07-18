import { PrismaService } from '../prisma/prisma.service';
import { CategoriesRepository } from './categories.repository';
import { ConflictError } from '../common/errors/domain-errors';

/**
 * Integration contra el Postgres pgvector real (docker-compose) con el esquema
 * de @dsm/db. Ver nota de deviación en test/jest.setup.js.
 */
describe('CategoriesRepository (categories.repository, integration)', () => {
  const prisma = new PrismaService();
  const repo = new CategoriesRepository(prisma);

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE products, categories RESTART IDENTITY CASCADE',
    );
  });

  it('crea una categoría', async () => {
    const c = await repo.create({ name: 'Refrigeración', slug: 'refrigeracion' });
    expect(c.slug).toBe('refrigeracion');
    expect(c.id).toBeTruthy();
  });

  it('slug duplicado → ConflictError (P2002 traducido)', async () => {
    await repo.create({ name: 'Ferretería', slug: 'ferreteria' });
    await expect(
      repo.create({ name: 'Otra', slug: 'ferreteria' }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('findMany devuelve las categorías creadas', async () => {
    await repo.create({ name: 'Electricidad', slug: 'electricidad' });
    const all = await repo.findMany();
    expect(all).toHaveLength(1);
  });
});
