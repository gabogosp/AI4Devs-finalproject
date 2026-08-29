import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  adminToken,
  bootTestApp,
  nuevaIpDeTest,
} from '../../test/e2e-app';
import { PrismaService } from '../prisma/prisma.service';
import { StorefrontModule } from '../storefront/storefront.module';
import { ImportsModule } from './imports.module';

/**
 * T7.1 — aceptación de la reconciliación por SKU (AC-1, AC-4, AC-9, AC-10).
 *
 * El caso que más importa es el **día 2** del dueño: subir un archivo de precios
 * actualizados sobre un catálogo ya publicado. Ahí se cruzan los cuatro criterios
 * —actualizar sin duplicar, sin despublicar y sin cambiar URLs— y es donde una
 * regresión se paga con productos duplicados o fichas caídas de Google.
 */
describe('Import — reconciliación por SKU (e2e-imports-acceptance, AC-1/4/9/10)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ip: string;

  const post = (buffer: Buffer) =>
    request(app.getHttpServer())
      .post('/v1/admin/imports')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Forwarded-For', ip)
      .attach('file', buffer, 'catalogo.csv');

  const csv = (lineas: string[]) =>
    Buffer.from(
      ['sku,nombre,precio,stock,categoria', ...lineas].join('\n') + '\n',
      'utf8',
    );

  const esperarCierre = async (id: string): Promise<void> => {
    for (let i = 0; i < 400; i += 1) {
      const job = await prisma.importJob.findUnique({ where: { id } });
      if (!job || job.status === 'completed' || job.status === 'failed') return;
      await new Promise((r) => setTimeout(r, 20));
    }
  };

  /** Sube el archivo y espera a que el trabajo cierre. Devuelve el trabajo final. */
  const importar = async (buffer: Buffer) => {
    const res = await post(buffer);
    expect(res.status).toBe(202);
    await esperarCierre(res.body.id);
    return (await prisma.importJob.findUnique({ where: { id: res.body.id } }))!;
  };

  const limpiar = () =>
    prisma.$executeRawUnsafe(
      'TRUNCATE TABLE import_job_rows, import_jobs, products, categories RESTART IDENTITY CASCADE',
    );

  const catalogo = () =>
    prisma.product.findMany({
      select: {
        sku: true,
        slug: true,
        status: true,
        price_ars_cents: true,
        stock: true,
        name: true,
      },
      orderBy: { sku: 'asc' },
    });

  beforeAll(async () => {
    process.env.TRUST_PROXY_HOPS = '1';
    app = await bootTestApp([ImportsModule, StorefrontModule]);
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app?.close();
    delete process.env.TRUST_PROXY_HOPS;
  });
  beforeEach(async () => {
    ip = nuevaIpDeTest();
    await limpiar();
    await new Promise((r) => setTimeout(r, 30));
    await limpiar();
  });

  it('AC-1: los SKUs nuevos se crean en draft y el existente se actualiza', async () => {
    // Estado previo: un producto ya en el catálogo.
    const previo = await importar(
      csv(['VIEJO-1,Heladera vieja,100000,1,Refrigeración']),
    );
    expect(previo.created_count).toBe(1);

    const job = await importar(
      csv([
        'NUEVO-1,Mecha 8mm,90000,10,Herramientas',
        'NUEVO-2,Tarugo Fischer,32000,50,Fijaciones',
        'VIEJO-1,Heladera vieja,150000,2,Refrigeración',
      ]),
    );

    expect(job.status).toBe('completed');
    expect(job.created_count).toBe(2);
    expect(job.updated_count).toBe(1);
    expect(job.failed_count).toBe(0);

    const productos = await catalogo();
    expect(productos).toHaveLength(3);
    expect(productos.every((p) => p.status === 'draft')).toBe(true);
    const viejo = productos.find((p) => p.sku === 'VIEJO-1')!;
    // El archivo trae ARS y la base guarda centavos: 150000 pesos son 15.000.000
    // de centavos (api-standards §5.5 — money en unidades menores enteras).
    expect(viejo.price_ars_cents).toBe(150000 * 100);
    expect(viejo.stock).toBe(2);
  });

  it('AC-10: re-importar el MISMO archivo no duplica y cuenta 3 updates', async () => {
    const archivo = csv([
      'REF-1,Heladera,100000,1,Refrigeración',
      'REF-2,Mecha,90000,10,Herramientas',
      'REF-3,Tarugo,32000,50,Fijaciones',
    ]);

    const primera = await importar(archivo);
    expect(primera.created_count).toBe(3);
    const antes = await catalogo();

    const segunda = await importar(archivo);

    expect(segunda.created_count).toBe(0);
    expect(segunda.updated_count).toBe(3);
    expect(await prisma.product.count()).toBe(3);
    // Idéntico, campo por campo: re-subir el archivo es una operación segura y
    // es lo que el runbook le dice al dueño ante un import interrumpido.
    expect(await catalogo()).toEqual(antes);
  });

  it('AC-4 + AC-9: un archivo de sólo precios sobre catálogo PUBLICADO no despublica ni cambia URLs', async () => {
    await importar(
      csv([
        'REF-1,Heladera,100000,5,Refrigeración',
        'REF-2,Mecha 8mm,90000,10,Herramientas',
      ]),
    );
    // El dueño revisó y publicó: es una decisión suya, no del archivo.
    await prisma.product.updateMany({ data: { status: 'published' } });
    const antes = await catalogo();

    // Día 2: ajuste de precios por inflación. Las columnas requeridas viajan con
    // su valor vigente; sólo cambia `precio`.
    const job = await importar(
      csv([
        'REF-1,Heladera,135000,5,Refrigeración',
        'REF-2,Mecha 8mm,121500,10,Herramientas',
      ]),
    );

    expect(job.updated_count).toBe(2);
    const despues = await catalogo();

    expect(despues.map((p) => p.price_ars_cents)).toEqual([
      135000 * 100,
      121500 * 100,
    ]);
    // Ni el estado ni la URL se mueven, y no aparece ningún duplicado.
    expect(despues.map((p) => p.status)).toEqual(antes.map((p) => p.status));
    expect(despues.map((p) => p.slug)).toEqual(antes.map((p) => p.slug));
    expect(despues).toHaveLength(2);
  });

  it('AC-4 + OQ-8: el archivo de ajuste de precios puede dejar las demás celdas VACÍAS', async () => {
    await importar(
      csv([
        'REF-1,Heladera,100000,5,Refrigeración',
        'REF-2,Mecha 8mm,90000,10,Herramientas',
      ]),
    );
    await prisma.product.updateMany({ data: { status: 'published' } });
    const antes = await catalogo();

    // Lo que el dueño realmente hace el día 2: exporta la plantilla, borra todo
    // menos el sku y escribe el precio nuevo. Las 5 columnas requeridas siguen en
    // el encabezado (AC-6), pero sus celdas van vacías.
    const job = await importar(
      csv(['REF-1,,135000,,', 'REF-2,,121500,,']),
    );

    expect(job.status).toBe('completed');
    expect(job.updated_count).toBe(2);
    expect(job.failed_count).toBe(0);

    const despues = await catalogo();
    expect(despues.map((p) => p.price_ars_cents)).toEqual([
      135000 * 100,
      121500 * 100,
    ]);
    // Nada más se movió: nombre, stock, estado y URL intactos. Sin esta
    // semántica, este archivo habría puesto el catálogo entero en stock 0.
    expect(despues.map((p) => p.name)).toEqual(antes.map((p) => p.name));
    expect(despues.map((p) => p.stock)).toEqual(antes.map((p) => p.stock));
    expect(despues.map((p) => p.status)).toEqual(antes.map((p) => p.status));
    expect(despues.map((p) => p.slug)).toEqual(antes.map((p) => p.slug));
  });

  it('OQ-8: la misma fila incompleta sobre un SKU que NO existe se rechaza', async () => {
    const job = await importar(csv(['NO-EXISTE,,135000,,']));

    expect(job.status).toBe('completed');
    expect(job.created_count).toBe(0);
    expect(job.failed_count).toBe(1);
    expect(await prisma.product.count()).toBe(0);

    const errores = await prisma.importJobRow.findMany({
      where: { job_id: job.id },
    });
    expect(errores[0].error_code).toBe('missing_required');
    expect(errores[0].error_message).toContain('nombre');
  });

  it('AC-9: un producto creado por el import NO aparece en la ficha pública', async () => {
    await importar(csv(['REF-1,Heladera importada,100000,5,Refrigeración']));

    const creado = (await prisma.product.findUnique({
      where: { sku: 'REF-1' },
    }))!;
    expect(creado.status).toBe('draft');

    const publico = await request(app.getHttpServer()).get(
      `/v1/products/${creado.slug}`,
    );

    // El archivo no tiene columna de estado y no la va a tener: publicar es una
    // decisión explícita del dueño sobre un producto que ya revisó.
    expect(publico.status).toBe(404);
  });

  it('AC-1 + AC-9: renombrar por import conserva la URL indexable', async () => {
    await importar(csv(['REF-1,Heladera,100000,5,Refrigeración']));
    const original = (await prisma.product.findUnique({
      where: { sku: 'REF-1' },
    }))!;
    expect(original.slug).toBe('heladera');

    await importar(csv(['REF-1,Heladera Exhibidora Premium,100000,5,Refrigeración']));

    const renombrado = (await prisma.product.findUnique({
      where: { sku: 'REF-1' },
    }))!;
    expect(renombrado.name).toBe('Heladera Exhibidora Premium');
    // Regenerar el slug rompería la URL que Google ya pudo indexar.
    expect(renombrado.slug).toBe('heladera');
    expect(renombrado.id).toBe(original.id);
  });
});
