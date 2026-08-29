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

  describe('findSlugsByPrefixes (US-006 T2.2 — una query por lote)', () => {    it('trae los slugs de varias bases y no los ajenos', async () => {
      await repo.create({ ...base('HEL-001'), slug: 'heladera' });
      await repo.create({ ...base('HEL-002'), slug: 'heladera-2' });
      await repo.create({ ...base('MEC-003'), slug: 'mecha-3' });
      await repo.create({ ...base('OTR-001'), slug: 'otro' });

      const found = await repo.findSlugsByPrefixes(['heladera', 'mecha']);

      expect(found.sort()).toEqual(['heladera', 'heladera-2', 'mecha-3']);
      expect(found).not.toContain('otro');
    });

    it('sin bases no consulta y devuelve vacío', async () => {
      await repo.create({ ...base('HEL-003'), slug: 'heladera' });
      expect(await repo.findSlugsByPrefixes([])).toEqual([]);
    });
  });

  describe('findManyBySkus (US-006 T3.2 — reconciliación por SKU)', () => {
    it('devuelve un mapa sólo con los skus que existen', async () => {
      await repo.create({ ...base('REF-A'), slug: 'a' });
      await repo.create({ ...base('REF-B'), slug: 'b' });

      const mapa = await repo.findManyBySkus(['REF-A', 'REF-B', 'REF-INEXISTENTE']);

      expect(mapa.size).toBe(2);
      expect(mapa.get('REF-A')!.slug).toBe('a');
      expect(mapa.get('REF-INEXISTENTE')).toBeUndefined();
    });

    it('sin skus devuelve un mapa vacío sin consultar', async () => {
      expect((await repo.findManyBySkus([])).size).toBe(0);
    });
  });

  describe('upsertFromImport (US-006 T3.2)', () => {
    const fila = (over: Record<string, unknown> = {}) => ({
      sku: 'IMP-1',
      slug: 'heladera-importada',
      name: 'Heladera importada',
      priceArsCents: 150000,
      stock: 7,
      categoryId,
      ...over,
    });

    it('un sku nuevo se crea en draft, con enrichment_done en false', async () => {
      const r = await repo.upsertFromImport(fila());

      expect(r.outcome).toBe('created');
      const p = (await repo.findById(r.id))!;
      expect(p.status).toBe('draft');
      expect(p.enrichment_done).toBe(false);
      expect(p.price_ars_cents).toBe(150000);
      expect(p.stock).toBe(7);
    });

    it('el mismo sku se actualiza sin tocar slug, status ni el id', async () => {
      const creado = await repo.create({
        ...base('IMP-2'),
        slug: 'heladera',
        status: 'published',
        name: 'Heladera',
      });

      const r = await repo.upsertFromImport(
        fila({ sku: 'IMP-2', slug: 'heladera-exhibidora', name: 'Heladera Exhibidora' }),
      );

      expect(r.outcome).toBe('updated');
      expect(r.id).toBe(creado.id);
      const p = (await repo.findById(creado.id))!;
      expect(p.name).toBe('Heladera Exhibidora');
      // El slug propuesto se ignora: la URL ya pudo indexarse (regla de US-003).
      expect(p.slug).toBe('heladera');
      // AC-9: el import no publica ni despublica.
      expect(p.status).toBe('published');
      expect(p.sku).toBe('IMP-2');
      expect(await prisma.product.count()).toBe(1);
    });

    it('una celda vacía NO pisa la descripción ni la imagen persistidas', async () => {
      const creado = await repo.create({
        ...base('IMP-3'),
        slug: 'con-datos',
        description_raw: 'descripción del local',
        image_url: 'https://cdn.example.com/vieja.jpg',
      });

      // `descriptionRaw` e `imageUrl` ausentes = celda vacía = no cambiar.
      await repo.upsertFromImport(fila({ sku: 'IMP-3' }));

      const p = (await repo.findById(creado.id))!;
      expect(p.description_raw).toBe('descripción del local');
      expect(p.image_url).toBe('https://cdn.example.com/vieja.jpg');
    });

    it('la misma descripción NO reabre el enriquecimiento', async () => {
      const creado = await repo.create({
        ...base('IMP-4'),
        slug: 'ya-enriquecida',
        description_raw: 'igual',
      });
      await prisma.product.update({
        where: { id: creado.id },
        data: { enrichment_done: true },
      });

      await repo.upsertFromImport(fila({ sku: 'IMP-4', descriptionRaw: 'igual' }));

      // Re-enriquecer un producto al que sólo le movieron el precio es pagarle a
      // Gemini por un resultado idéntico.
      expect((await repo.findById(creado.id))!.enrichment_done).toBe(true);
    });

    it('una descripción distinta vuelve a marcar el enriquecimiento pendiente', async () => {
      const creado = await repo.create({
        ...base('IMP-5'),
        slug: 'cambia-descripcion',
        description_raw: 'vieja',
      });
      await prisma.product.update({
        where: { id: creado.id },
        data: { enrichment_done: true },
      });

      await repo.upsertFromImport(fila({ sku: 'IMP-5', descriptionRaw: 'nueva' }));

      const p = (await repo.findById(creado.id))!;
      expect(p.description_raw).toBe('nueva');
      expect(p.enrichment_done).toBe(false);
    });

    it('un slug ya tomado devuelve ConflictError con field slug (no "SKU duplicado")', async () => {
      await repo.create({ ...base('OTRO'), slug: 'heladera' });

      const error = await repo
        .upsertFromImport(fila({ sku: 'IMP-6', slug: 'heladera' }))
        .catch((e) => e);

      expect(error).toBeInstanceOf(ConflictError);
      expect(error.fieldErrors).toEqual([
        { field: 'slug', message: 'URL de producto duplicada' },
      ]);
    });
  });

  describe('findManyBySlugs (US-007 T2.2 — lectura de las líneas del carrito)', () => {
    beforeEach(async () => {
      await repo.create({ ...base('CART-PUB'), slug: 'pub', status: 'published' });
      await repo.create({ ...base('CART-DRA'), slug: 'dra', status: 'draft' });
      await repo.create({ ...base('CART-ARC'), slug: 'arc', status: 'archived' });
    });

    it('devuelve los 3 estados: el carrito necesita ver los ocultos para MARCARLOS (AC-6)', async () => {
      const found = await repo.findManyBySlugs(['pub', 'dra', 'arc']);

      expect(found.map((p) => p.slug).sort()).toEqual(['arc', 'dra', 'pub']);
      expect(found.map((p) => p.status).sort()).toEqual([
        'archived',
        'draft',
        'published',
      ]);
    });

    it('trae los campos que la vista del carrito necesita', async () => {
      const [p] = await repo.findManyBySlugs(['pub']);

      expect(Object.keys(p).sort()).toEqual(
        [
          'id',
          'slug',
          'name',
          'image_url',
          'price_ars_cents',
          'stock',
          'status',
        ].sort(),
      );
    });

    it('los slugs inexistentes simplemente no aparecen', async () => {
      const found = await repo.findManyBySlugs(['pub', 'no-existe-999']);
      expect(found.map((p) => p.slug)).toEqual(['pub']);
    });

    it('conjunto vacío → array vacío sin ir a la base', async () => {
      expect(await repo.findManyBySlugs([])).toEqual([]);
    });

    it('findPublishedBySlug NO cambió: sigue devolviendo null para draft y archived', async () => {
      // US-003 depende de esto: si el filtro se relajara, la ficha pública
      // empezaría a servir productos ocultos.
      expect(await repo.findPublishedBySlug('dra')).toBeNull();
      expect(await repo.findPublishedBySlug('arc')).toBeNull();
      expect(await repo.findPublishedBySlug('pub')).not.toBeNull();
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
