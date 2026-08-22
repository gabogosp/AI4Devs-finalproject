import { PrismaService } from '../prisma/prisma.service';
import { CategoriesRepository } from '../categories/categories.repository';
import { CategoryResolver, CategorySource } from './category-resolver';

/**
 * T4.1 — integration contra el Postgres real. Lo que hay que probar no es sólo
 * que resuelva: es que **no duplique por acentos ni mayúsculas** (AC-2) y que no
 * vuelva a la base por un rubro que ya resolvió.
 */
describe('CategoryResolver (integration)', () => {
  const prisma = new PrismaService();
  const repo = new CategoriesRepository(prisma);

  /** Envuelve el repositorio real y cuenta las idas a la base. */
  class RepoContado implements CategorySource {
    consultas = 0;
    creaciones = 0;

    findManyBySlugs(slugs: string[]) {
      this.consultas += 1;
      return repo.findManyBySlugs(slugs);
    }

    createIfAbsent(data: { name: string; slug: string }) {
      this.creaciones += 1;
      return repo.createIfAbsent(data);
    }
  }

  let contado: RepoContado;
  let resolver: CategoryResolver;

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
    contado = new RepoContado();
    resolver = new CategoryResolver(contado);
  });

  it('las variantes de acento y mayúsculas colapsan en UNA categoría', async () => {
    const mapa = await resolver.resolve([
      'Plomería',
      'plomeria',
      'PLOMERÍA',
      '  Plomería  ',
    ]);

    const ids = new Set(mapa.values());
    expect(mapa.size).toBe(4);
    expect(ids.size).toBe(1);
    expect(resolver.categoriesCreated).toBe(1);

    const filas = await prisma.category.findMany();
    expect(filas).toHaveLength(1);
    expect(filas[0].slug).toBe('plomeria');
    // El nombre persistido es el que escribió el dueño, no el slug.
    expect(filas[0].name).toBe('Plomería');
    expect(filas[0].parent_id).toBeNull();
  });

  it('resuelve una categoría preexistente sin crear ni contar creación', async () => {
    const previa = await repo.create({ name: 'Plomería', slug: 'plomeria' });

    const mapa = await resolver.resolve(['PLOMERIA']);

    expect(mapa.get('PLOMERIA')).toBe(previa.id);
    expect(resolver.categoriesCreated).toBe(0);
    expect(await prisma.category.count()).toBe(1);
  });

  it('el cache sobrevive entre lotes: el segundo lote no consulta ni crea', async () => {
    await resolver.resolve(['Plomería', 'Electricidad']);
    expect(resolver.categoriesCreated).toBe(2);
    const consultasPrimeras = contado.consultas;
    const creacionesPrimeras = contado.creaciones;

    const mapa = await resolver.resolve(['plomeria', 'ELECTRICIDAD']);

    expect(mapa.size).toBe(2);
    expect(resolver.categoriesCreated).toBe(2);
    // Cero consultas y cero creaciones nuevas: es el criterio de cierre.
    expect(contado.consultas).toBe(consultasPrimeras);
    expect(contado.creaciones).toBe(creacionesPrimeras);
  });

  it('un rubro repetido en 500 filas hace UNA consulta, no 500', async () => {
    const nombres = Array.from({ length: 500 }, (_, i) =>
      i % 2 === 0 ? 'Plomería' : 'plomeria',
    );

    const mapa = await resolver.resolve(nombres);

    expect(new Set(mapa.values()).size).toBe(1);
    expect(contado.consultas).toBe(1);
    expect(contado.creaciones).toBe(1);
    expect(resolver.categoriesCreated).toBe(1);
  });

  it('un lote mixto consulta una vez y crea sólo las ausentes', async () => {
    await repo.create({ name: 'Plomería', slug: 'plomeria' });

    await resolver.resolve(['Plomería', 'Electricidad', 'Refrigeración']);

    expect(contado.consultas).toBe(1);
    expect(resolver.categoriesCreated).toBe(2);
    expect(await prisma.category.count()).toBe(3);
  });

  it('un nombre que no produce slug queda fuera del mapa y no crea nada', async () => {
    const mapa = await resolver.resolve(['###', 'Plomería']);

    expect(mapa.has('###')).toBe(false);
    expect(mapa.has('Plomería')).toBe(true);
    // Crear una categoría sin URL usable sería peor que rechazar la fila.
    expect(await prisma.category.count()).toBe(1);
  });

  it('sin nombres no consulta nada', async () => {
    const mapa = await resolver.resolve([]);
    expect(mapa.size).toBe(0);
    expect(contado.consultas).toBe(0);
  });
});
