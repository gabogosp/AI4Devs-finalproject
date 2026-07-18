import { PrismaService } from '../prisma/prisma.service';
import { ProductsRepository } from './products.repository';
import {
  ConflictError,
  ValidationError,
} from '../common/errors/domain-errors';

/** Integration contra el Postgres pgvector real (docker-compose). */
describe('ProductsRepository (products.repository, integration)', () => {
  const prisma = new PrismaService();
  const repo = new ProductsRepository(prisma);
  let categoryId: string;

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
    const cat = await prisma.category.create({
      data: { name: 'Refrigeración', slug: 'refrigeracion' },
    });
    categoryId = cat.id;
  });

  const base = (sku: string) => ({
    sku,
    name: 'Heladera',
    price_ars_cents: 100000,
    stock: 5,
    category_id: categoryId,
  });

  it('crea un producto en draft', async () => {
    const p = await repo.create(base('REF-001'));
    expect(p.status).toBe('draft');
    expect(p.sku).toBe('REF-001');
  });

  it('SKU duplicado → ConflictError (P2002)', async () => {
    await repo.create(base('REF-001'));
    await expect(repo.create(base('REF-001'))).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('category_id inexistente → ValidationError (P2003 FK)', async () => {
    await expect(
      repo.create({
        ...base('REF-002'),
        category_id: '00000000-0000-0000-0000-0000000000ff',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('CHECK de la DB rechaza precio <= 0', async () => {
    await expect(
      repo.create({ ...base('REF-003'), price_ars_cents: -1 }),
    ).rejects.toBeTruthy();
  });

  it('CHECK de la DB rechaza stock < 0', async () => {
    await expect(
      repo.create({ ...base('REF-004'), stock: -5 }),
    ).rejects.toBeTruthy();
  });
});
