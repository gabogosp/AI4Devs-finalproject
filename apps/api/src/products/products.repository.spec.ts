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
    slug: sku.toLowerCase(),
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

  describe('findPublishedBySlug (US-003 lectura pública)', () => {
    it('producto publicado → lo devuelve con su categoría', async () => {
      await repo.create({ ...base('PUB-001'), status: 'published' });
      const found = await repo.findPublishedBySlug('pub-001');
      expect(found).not.toBeNull();
      expect(found?.sku).toBe('PUB-001');
      expect(found?.category.slug).toBe('refrigeracion');
    });

    it('producto draft → null (AC-7)', async () => {
      await repo.create({ ...base('DRA-001'), status: 'draft' });
      expect(await repo.findPublishedBySlug('dra-001')).toBeNull();
    });

    it('producto archived → null (AC-7)', async () => {
      await repo.create({ ...base('ARC-001'), status: 'archived' });
      expect(await repo.findPublishedBySlug('arc-001')).toBeNull();
    });

    it('slug inexistente → null (AC-8)', async () => {
      expect(await repo.findPublishedBySlug('no-existe-999')).toBeNull();
    });
  });

  describe('findPublishedByCategoryIds (US-002 T2.1)', () => {
    let otraCategoria: string;

    const sembrar = async (
      categoryId: string,
      prefijo: string,
      status: string,
      cantidad: number,
    ) => {
      for (let i = 0; i < cantidad; i += 1) {
        await repo.create({
          ...base(`${prefijo}-${i}`),
          name: `${prefijo} ${i}`,
          category_id: categoryId,
          status,
        });
      }
    };

    beforeEach(async () => {
      otraCategoria = (
        await prisma.category.create({
          data: { name: 'Ferretería', slug: 'ferreteria' },
        })
      ).id;
      // 5 publicados repartidos en dos categorías + ruido que NO debe aparecer.
      await sembrar(categoryId, 'PUB-A', 'published', 3);
      await sembrar(otraCategoria, 'PUB-B', 'published', 2);
      await sembrar(categoryId, 'DRAFT', 'draft', 2);
      await sembrar(categoryId, 'ARCH', 'archived', 1);
    });

    it('total cuenta sólo publicados del filtro (AC-8)', async () => {
      const { data, total } = await repo.findPublishedByCategoryIds(
        [categoryId, otraCategoria],
        { limit: 50, offset: 0 },
      );

      expect(total).toBe(5);
      expect(data).toHaveLength(5);
      expect(data.every((p) => p.status === 'published')).toBe(true);
    });

    it('páginas consecutivas son disjuntas y cubren el conjunto (AC-7)', async () => {
      const ids = [categoryId, otraCategoria];
      const p0 = await repo.findPublishedByCategoryIds(ids, {
        limit: 2,
        offset: 0,
      });
      const p1 = await repo.findPublishedByCategoryIds(ids, {
        limit: 2,
        offset: 2,
      });
      const p2 = await repo.findPublishedByCategoryIds(ids, {
        limit: 2,
        offset: 4,
      });

      const skus = [...p0.data, ...p1.data, ...p2.data].map((p) => p.sku);
      expect(skus).toHaveLength(5);
      expect(new Set(skus).size).toBe(5); // sin duplicados entre páginas
      // Orden estable name ASC: la unión respeta el orden global.
      const nombres = [...p0.data, ...p1.data, ...p2.data].map((p) => p.name);
      expect(nombres).toEqual([...nombres].sort());
    });

    it('con un solo id trae sólo los de esa categoría (D1: subrubro)', async () => {
      const { data, total } = await repo.findPublishedByCategoryIds(
        [otraCategoria],
        { limit: 50, offset: 0 },
      );

      expect(total).toBe(2);
      expect(data.every((p) => p.category_id === otraCategoria)).toBe(true);
    });

    it('categoría sin publicados → data vacía y total 0 (AC-6)', async () => {
      const vacia = (
        await prisma.category.create({
          data: { name: 'Electricidad', slug: 'electricidad' },
        })
      ).id;

      const { data, total } = await repo.findPublishedByCategoryIds([vacia], {
        limit: 50,
        offset: 0,
      });

      expect(data).toEqual([]);
      expect(total).toBe(0);
    });
  });

  describe('findSlugsByPrefix (T10.2 — insumo de desambiguación)', () => {
    it('devuelve sólo los slugs que arrancan con el prefijo', async () => {
      await repo.create({ ...base('HEL-001'), slug: 'heladera' });
      await repo.create({ ...base('HEL-002'), slug: 'heladera-2' });
      await repo.create({ ...base('VEN-001'), slug: 'ventilador' });

      const found = await repo.findSlugsByPrefix('heladera');

      expect(found.sort()).toEqual(['heladera', 'heladera-2']);
    });

    it('sin coincidencias → array vacío', async () => {
      await repo.create({ ...base('VEN-002'), slug: 'ventilador-techo' });
      expect(await repo.findSlugsByPrefix('heladera')).toEqual([]);
    });
  });

  it('slug duplicado → ConflictError que apunta a slug, no a sku', async () => {
    await repo.create({ ...base('DUP-001'), slug: 'mismo-slug' });

    await expect(
      repo.create({ ...base('DUP-002'), slug: 'mismo-slug' }),
    ).rejects.toMatchObject({
      fieldErrors: [{ field: 'slug', message: 'URL de producto duplicada' }],
    });
  });
});
