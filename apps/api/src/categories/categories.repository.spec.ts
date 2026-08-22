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

  describe('lecturas públicas del storefront (US-002 T1.1)', () => {
    // Se siembra en orden NO alfabético a propósito: si el repositorio no
    // ordenara, el test pasaría por casualidad con datos ya ordenados.
    const seedArbol = async () => {
      const refrigeracion = await repo.create({
        name: 'Refrigeración',
        slug: 'refrigeracion',
      });
      const ferreteria = await repo.create({
        name: 'Ferretería',
        slug: 'ferreteria',
      });
      await repo.create({
        name: 'Compresores',
        slug: 'compresores',
        parent_id: refrigeracion.id,
      });
      await repo.create({
        name: 'Aislantes',
        slug: 'aislantes',
        parent_id: refrigeracion.id,
      });
      await repo.create({
        name: 'Tornillos',
        slug: 'tornillos',
        parent_id: ferreteria.id,
      });
      await repo.create({
        name: 'Herramientas',
        slug: 'herramientas',
        parent_id: ferreteria.id,
      });
      return { refrigeracion, ferreteria };
    };

    it('findRoots: sólo rubros, con sus hijos, ambos niveles por nombre ASC', async () => {
      await seedArbol();

      const roots = await repo.findRoots();

      expect(roots.map((r) => r.slug)).toEqual(['ferreteria', 'refrigeracion']);
      // Ningún subrubro se cuela como raíz.
      expect(roots.every((r) => r.parent_id === null)).toBe(true);
      expect(roots[0].children.map((c) => c.slug)).toEqual([
        'herramientas',
        'tornillos',
      ]);
      expect(roots[1].children.map((c) => c.slug)).toEqual([
        'aislantes',
        'compresores',
      ]);
    });

    it('findBySlugWithFamily de un subrubro: trae su padre', async () => {
      await seedArbol();

      const sub = await repo.findBySlugWithFamily('compresores');

      expect(sub?.parent?.slug).toBe('refrigeracion');
      expect(sub?.children).toEqual([]);
    });

    it('findBySlugWithFamily de un rubro: parent null + hijos ordenados', async () => {
      await seedArbol();

      const rubro = await repo.findBySlugWithFamily('refrigeracion');

      expect(rubro?.parent).toBeNull();
      expect(rubro?.children.map((c) => c.slug)).toEqual([
        'aislantes',
        'compresores',
      ]);
    });

    it('findBySlugWithFamily de un slug inexistente: null, no lanza (AC-9)', async () => {
      await seedArbol();

      // Devolver null y no lanzar es lo que deja al service decidir el 404.
      await expect(
        repo.findBySlugWithFamily('no-existe'),
      ).resolves.toBeNull();
    });
  });

  describe('resolución por lote del import (US-006 T3.3)', () => {
    it('findManyBySlugs devuelve sólo las que existen, en una consulta', async () => {
      await repo.create({ name: 'Plomería', slug: 'plomeria' });
      await repo.create({ name: 'Electricidad', slug: 'electricidad' });

      const mapa = await repo.findManyBySlugs([
        'plomeria',
        'electricidad',
        'no-existe',
      ]);

      expect(mapa.size).toBe(2);
      expect(mapa.get('plomeria')).toBeTruthy();
      expect(mapa.get('no-existe')).toBeUndefined();
    });

    it('sin slugs devuelve un mapa vacío', async () => {
      expect((await repo.findManyBySlugs([])).size).toBe(0);
    });

    it('createIfAbsent crea como rubro raíz y reporta created', async () => {
      const r = await repo.createIfAbsent({ name: 'Plomería', slug: 'plomeria' });

      expect(r.created).toBe(true);
      const c = (await repo.findById(r.id))!;
      expect(c.parent_id).toBeNull();
      expect(c.name).toBe('Plomería');
    });

    it('createIfAbsent sobre una existente devuelve su id sin crear nada', async () => {
      const previa = await repo.create({ name: 'Plomería', slug: 'plomeria' });

      const r = await repo.createIfAbsent({
        name: 'PLOMERIA EN MAYUSCULAS',
        slug: 'plomeria',
      });

      expect(r).toEqual({ id: previa.id, created: false });
      // El nombre de la existente NO se sobreescribe: el dueño ya lo curó.
      expect((await repo.findById(previa.id))!.name).toBe('Plomería');
      expect(await prisma.category.count()).toBe(1);
    });

    it('dos llamadas CONCURRENTES sobre el mismo slug resuelven al mismo id y ninguna lanza', async () => {
      // Dos filas del mismo rubro son el caso normal de un archivo de catálogo:
      // si la carrera hiciera fallar una fila, AC-2 se rompería con datos válidos.
      const [a, b] = await Promise.all([
        repo.createIfAbsent({ name: 'Plomería', slug: 'plomeria' }),
        repo.createIfAbsent({ name: 'Plomería', slug: 'plomeria' }),
      ]);

      expect(a.id).toBe(b.id);
      expect([a.created, b.created].filter(Boolean)).toHaveLength(1);
      expect(
        await prisma.category.count({ where: { slug: 'plomeria' } }),
      ).toBe(1);
    });
  });
});
