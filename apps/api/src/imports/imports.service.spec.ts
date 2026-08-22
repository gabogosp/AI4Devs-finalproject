import { PrismaService } from '../prisma/prisma.service';
import { CategoriesRepository } from '../categories/categories.repository';
import { ProductsRepository } from '../products/products.repository';
import { ImportsService, RowOutcome } from './imports.service';
import { ParsedRow, RowError } from './row-schema';

/**
 * T4.2 — integration contra Postgres real. El foco está en la reconciliación:
 * que re-importar no duplique (AC-10), que el import no publique ni cambie URLs
 * (AC-9) y que una fila que falla no se lleve el lote (AC-5).
 */
describe('ImportsService.processRow (integration)', () => {
  const prisma = new PrismaService();
  const products = new ProductsRepository(prisma);
  const categories = new CategoriesRepository(prisma);
  const service = new ImportsService(products, categories);

  const fila = (over: Partial<ParsedRow> = {}): ParsedRow => ({
    kind: 'row',
    rowNumber: 1,
    sku: 'REF-1',
    name: 'Heladera',
    priceArsCents: 150000,
    stock: 5,
    categoryName: 'Refrigeración',
    ...over,
  });

  const esError = (r: RowOutcome): RowError => {
    expect(r.kind).toBe('error');
    return r as RowError;
  };

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

  it('un SKU nuevo se crea en draft con el slug derivado del nombre', async () => {
    const ctx = service.createContext();
    const [r] = await service.processBatch(ctx, [fila()]);

    expect(r.kind).toBe('created');
    const p = (await prisma.product.findUnique({ where: { sku: 'REF-1' } }))!;
    expect(p.slug).toBe('heladera');
    expect(p.status).toBe('draft');
    expect(p.enrichment_done).toBe(false);
    expect(ctx.categoriesCreated).toBe(1);
  });

  it('dos filas del mismo nombre en el lote reciben slugs distintos', async () => {
    const ctx = service.createContext();
    await service.processBatch(ctx, [
      fila({ sku: 'A', rowNumber: 1 }),
      fila({ sku: 'B', rowNumber: 2 }),
    ]);

    const slugs = (
      await prisma.product.findMany({ select: { slug: true }, orderBy: { sku: 'asc' } })
    ).map((p) => p.slug);
    expect(slugs).toEqual(['heladera', 'heladera-2']);
  });

  it('re-importar el mismo archivo actualiza y NO duplica (AC-10)', async () => {
    const primera = service.createContext();
    await service.processBatch(primera, [fila()]);
    const antes = (await prisma.product.findUnique({ where: { sku: 'REF-1' } }))!;

    const segunda = service.createContext();
    const [r] = await service.processBatch(segunda, [
      fila({ priceArsCents: 199900, stock: 9 }),
    ]);

    expect(r.kind).toBe('updated');
    expect(await prisma.product.count()).toBe(1);
    const despues = (await prisma.product.findUnique({ where: { sku: 'REF-1' } }))!;
    expect(despues.price_ars_cents).toBe(199900);
    expect(despues.stock).toBe(9);
    // Ni la URL ni la fecha de alta se mueven.
    expect(despues.slug).toBe(antes.slug);
    expect(despues.created_at.getTime()).toBe(antes.created_at.getTime());
    expect(despues.id).toBe(antes.id);
  });

  it('un producto publicado sigue publicado después del import (AC-9)', async () => {
    const ctx = service.createContext();
    await service.processBatch(ctx, [fila()]);
    await prisma.product.update({
      where: { sku: 'REF-1' },
      data: { status: 'published' },
    });

    const otro = service.createContext();
    await service.processBatch(otro, [
      fila({ name: 'Heladera Exhibidora', priceArsCents: 250000 }),
    ]);

    const p = (await prisma.product.findUnique({ where: { sku: 'REF-1' } }))!;
    expect(p.status).toBe('published');
    // Renombrar no re-deriva la URL: ya pudo indexarse (regla de US-003).
    expect(p.slug).toBe('heladera');
    expect(p.name).toBe('Heladera Exhibidora');
  });

  it('una celda de descripción vacía no borra la descripción persistida', async () => {
    const ctx = service.createContext();
    await service.processBatch(ctx, [
      fila({ descriptionRaw: 'la que escribió el local' }),
    ]);

    const otro = service.createContext();
    // `descriptionRaw: undefined` = celda vacía = no cambiar (OQ-BE-2).
    await service.processBatch(otro, [fila({ priceArsCents: 111100 })]);

    const p = (await prisma.product.findUnique({ where: { sku: 'REF-1' } }))!;
    expect(p.description_raw).toBe('la que escribió el local');
    expect(p.price_ars_cents).toBe(111100);
  });

  it('el mismo sku dos veces en el archivo: la primera entra, la segunda se reporta', async () => {
    const ctx = service.createContext();
    const [primera, segunda] = await service.processBatch(ctx, [
      fila({ rowNumber: 1, priceArsCents: 100000 }),
      fila({ rowNumber: 2, priceArsCents: 200000 }),
    ]);

    expect(primera.kind).toBe('created');
    const err = esError(segunda);
    expect(err.errorCode).toBe('duplicate_sku_in_file');
    expect(err.rowNumber).toBe(2);
    expect(await prisma.product.count()).toBe(1);
    // Gana la PRIMERA aparición, no la última.
    expect(
      (await prisma.product.findUnique({ where: { sku: 'REF-1' } }))!
        .price_ars_cents,
    ).toBe(100000);
  });

  it('la detección de duplicados cruza lotes del mismo trabajo', async () => {
    const ctx = service.createContext();
    await service.processBatch(ctx, [fila({ rowNumber: 1 })]);
    const [r] = await service.processBatch(ctx, [fila({ rowNumber: 250 })]);

    expect(esError(r).errorCode).toBe('duplicate_sku_in_file');
  });

  it('si la categoría desaparece entre la resolución y la escritura: write_failed y el resto del lote SÍ se escribe', async () => {
    const ctx = service.createContext();
    // Se resuelve la categoría del lote…
    const categorias = await ctx.resolver.resolve(['Refrigeración']);
    const categoryId = categorias.get('Refrigeración')!;
    // …y alguien la borra antes de escribir la fila.
    await prisma.category.delete({ where: { id: categoryId } });

    const rota = await service.processRow(
      ctx,
      fila({ sku: 'ROTA', rowNumber: 1 }),
      undefined,
      categorias,
    );

    const buenas = await service.processBatch(ctx, [
      fila({ sku: 'BUENA-1', rowNumber: 2 }),
      fila({ sku: 'BUENA-2', rowNumber: 3 }),
    ]);

    expect(esError(rota).errorCode).toBe('write_failed');
    // El motivo NO filtra nombres de tablas ni columnas de la base.
    expect(esError(rota).errorMessage).not.toMatch(/products|category_id|prisma/i);
    expect(buenas.map((r) => r.kind)).toEqual(['created', 'created']);
    expect(await prisma.product.count()).toBe(2);
  });

  it('una fila cuya categoría no se pudo resolver es invalid_category', async () => {
    const ctx = service.createContext();
    const [r] = await service.processBatch(ctx, [fila({ categoryName: '###' })]);

    expect(esError(r).errorCode).toBe('invalid_category');
    expect(await prisma.product.count()).toBe(0);
  });

  it('un nombre que no deriva URL y un sku que tampoco: la fila se rechaza sin escribir', async () => {
    const ctx = service.createContext();
    const [r] = await service.processBatch(ctx, [
      fila({ sku: '###', name: '###' }),
    ]);

    expect(r.kind).toBe('error');
    expect(await prisma.product.count()).toBe(0);
  });

  it('una colisión de slug creada por otro proceso se reintenta y se resuelve', async () => {
    const ctx = service.createContext();
    // El allocator ceba con la base libre…
    await ctx.allocator.prime(['heladera']);
    // …y otro proceso crea `heladera` antes de que escribamos.
    const cat = await categories.createIfAbsent({
      name: 'Refrigeración',
      slug: 'refrigeracion',
    });
    await products.create({
      sku: 'AJENO',
      slug: 'heladera',
      name: 'Heladera ajena',
      price_ars_cents: 1,
      stock: 0,
      category_id: cat.id,
    });

    const [r] = await service.processBatch(ctx, [fila()]);

    expect(r.kind).toBe('created');
    const p = (await prisma.product.findUnique({ where: { sku: 'REF-1' } }))!;
    // El reintento con el set refrescado consigue la variante libre.
    expect(p.slug).toBe('heladera-2');
  });

  it('actualiza name, precio, stock, categoría e imagen del archivo', async () => {
    const ctx = service.createContext();
    await service.processBatch(ctx, [fila()]);

    const otro = service.createContext();
    await service.processBatch(otro, [
      fila({
        name: 'Heladera nueva',
        priceArsCents: 300000,
        stock: 1,
        categoryName: 'Electricidad',
        imageUrl: 'https://cdn.example.com/n.jpg',
        descriptionRaw: 'otra descripción',
      }),
    ]);

    const p = (await prisma.product.findUnique({ where: { sku: 'REF-1' } }))!;
    const electricidad = (await prisma.category.findUnique({
      where: { slug: 'electricidad' },
    }))!;
    expect(p.name).toBe('Heladera nueva');
    expect(p.price_ars_cents).toBe(300000);
    expect(p.stock).toBe(1);
    expect(p.category_id).toBe(electricidad.id);
    expect(p.image_url).toBe('https://cdn.example.com/n.jpg');
    expect(p.enrichment_done).toBe(false);
  });

  it('marca enrichmentPending sólo cuando cambia la descripción', async () => {
    const ctx = service.createContext();
    await service.processBatch(ctx, [fila({ descriptionRaw: 'igual' })]);

    const soloPrecio = service.createContext();
    const [sinCambio] = await service.processBatch(soloPrecio, [
      fila({ descriptionRaw: 'igual', priceArsCents: 999900 }),
    ]);
    expect(sinCambio.kind).toBe('updated');
    expect(
      (sinCambio as { enrichmentPending: boolean }).enrichmentPending,
    ).toBe(false);

    const conCambio = service.createContext();
    const [cambiada] = await service.processBatch(conCambio, [
      fila({ descriptionRaw: 'distinta' }),
    ]);
    expect(
      (cambiada as { enrichmentPending: boolean }).enrichmentPending,
    ).toBe(true);
  });
});
