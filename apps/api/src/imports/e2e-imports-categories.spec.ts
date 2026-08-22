import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CatalogEventsModule } from '../observability/catalog-events.module';
import { configureApp } from '../bootstrap';
import { PrismaService } from '../prisma/prisma.service';
import { adminToken, nuevaIpDeTest } from '../../test/e2e-app';
import { ENRICHMENT_QUEUE, EnrichmentQueue } from './enrichment-queue';
import { ImportsModule } from './imports.module';

/**
 * T7.2 — aceptación de las categorías auto-creadas (AC-2) y de la marca de
 * enriquecimiento pendiente (AC-3).
 *
 * El puerto de enriquecimiento se **espía** con un doble en el contenedor: es la
 * única forma de verificar AC-3 de punta a punta hoy, con Redis sin aprovisionar.
 * La otra mitad de AC-3 —la que hace que no se pierda trabajo— es la marca
 * durable en la base, que este spec compara contra lo encolado.
 */
class ColaEspia implements EnrichmentQueue {
  llamadas: string[][] = [];
  async enqueue(ids: string[]): Promise<void> {
    this.llamadas.push([...ids]);
  }
}

describe('Import — categorías y enriquecimiento (e2e-imports-categories, AC-2/AC-3)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let cola: ColaEspia;
  let ip: string;

  const post = (buffer: Buffer) =>
    request(app.getHttpServer())
      .post('/v1/admin/imports')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Forwarded-For', ip)
      .attach('file', buffer, 'catalogo.csv');

  const csv = (lineas: string[]) =>
    Buffer.from(
      ['sku,nombre,precio,stock,categoria,descripcion', ...lineas].join('\n') +
        '\n',
      'utf8',
    );

  const esperarCierre = async (id: string): Promise<void> => {
    for (let i = 0; i < 400; i += 1) {
      const job = await prisma.importJob.findUnique({ where: { id } });
      if (!job || job.status === 'completed' || job.status === 'failed') return;
      await new Promise((r) => setTimeout(r, 20));
    }
  };

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

  beforeAll(async () => {
    process.env.TRUST_PROXY_HOPS = '1';
    cola = new ColaEspia();
    const moduleRef = await Test.createTestingModule({
      imports: [
        AppConfigModule,
        PrismaModule,
        CatalogEventsModule,
        ImportsModule,
      ],
    })
      .overrideProvider(ENRICHMENT_QUEUE)
      .useValue(cola)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app?.close();
    delete process.env.TRUST_PROXY_HOPS;
  });
  beforeEach(async () => {
    ip = nuevaIpDeTest();
    cola.llamadas = [];
    await limpiar();
    await new Promise((r) => setTimeout(r, 30));
    await limpiar();
  });

  it('AC-2: "Plomería", "plomeria" y "Electricidad" crean DOS categorías', async () => {
    const job = await importar(
      csv([
        'PLO-1,Codo 1/2,5000,10,Plomería,codo de bronce',
        'PLO-2,Tee 1/2,6000,10,plomeria,tee de bronce',
        'ELE-1,Cable 2.5mm,12000,30,Electricidad,cable unipolar',
      ]),
    );

    expect(job.status).toBe('completed');
    expect(job.created_count).toBe(3);
    expect(job.categories_created_count).toBe(2);

    const categorias = await prisma.category.findMany({
      select: { name: true, slug: true, parent_id: true },
      orderBy: { slug: 'asc' },
    });
    expect(categorias).toEqual([
      { name: 'Electricidad', slug: 'electricidad', parent_id: null },
      // El nombre persistido es el primero que escribió el dueño, con acento.
      { name: 'Plomería', slug: 'plomeria', parent_id: null },
    ]);

    // Y los tres productos quedaron en la categoría correcta.
    const plomeria = categorias.findIndex((c) => c.slug === 'plomeria');
    expect(plomeria).toBeGreaterThanOrEqual(0);
    const porSku = new Map(
      (
        await prisma.product.findMany({
          select: { sku: true, category: { select: { slug: true } } },
        })
      ).map((p) => [p.sku, p.category.slug]),
    );
    expect(porSku.get('PLO-1')).toBe('plomeria');
    expect(porSku.get('PLO-2')).toBe('plomeria');
    expect(porSku.get('ELE-1')).toBe('electricidad');
  });

  it('AC-2: una categoría que YA existe no se duplica ni se cuenta como creada', async () => {
    await prisma.category.create({
      data: { name: 'Plomería', slug: 'plomeria' },
    });

    const job = await importar(
      csv(['PLO-1,Codo 1/2,5000,10,PLOMERIA,codo de bronce']),
    );

    expect(job.categories_created_count).toBe(0);
    expect(await prisma.category.count()).toBe(1);
  });

  it('AC-3: los creados quedan pendientes y el puerto recibe exactamente esos ids', async () => {
    const job = await importar(
      csv([
        'NUE-1,Producto uno,1000,1,Ferretería,descripcion uno',
        'NUE-2,Producto dos,2000,2,Ferretería,descripcion dos',
        'NUE-3,Producto tres,3000,3,Ferretería,descripcion tres',
      ]),
    );

    expect(job.created_count).toBe(3);
    const ids = (
      await prisma.product.findMany({ select: { id: true }, orderBy: { sku: 'asc' } })
    ).map((p) => p.id);

    expect(await prisma.product.count({ where: { enrichment_done: false } })).toBe(3);
    expect(cola.llamadas).toHaveLength(1);
    expect([...cola.llamadas[0]].sort()).toEqual([...ids].sort());
  });

  it('AC-3: sólo se re-encola lo que cambió de descripción, no lo que cambió de precio', async () => {
    await importar(
      csv([
        'DESC-1,Con descripcion,1000,1,Ferretería,original',
        'PRECIO-1,Solo precio,1000,1,Ferretería,intacta',
      ]),
    );
    // Se simula que US-005 ya enriqueció los dos.
    await prisma.product.updateMany({ data: { enrichment_done: true } });
    cola.llamadas = [];

    await importar(
      csv([
        'DESC-1,Con descripcion,1000,1,Ferretería,DESCRIPCION NUEVA',
        'PRECIO-1,Solo precio,9999,1,Ferretería,intacta',
      ]),
    );

    const desc = (await prisma.product.findUnique({ where: { sku: 'DESC-1' } }))!;
    const precio = (await prisma.product.findUnique({
      where: { sku: 'PRECIO-1' },
    }))!;

    expect(desc.enrichment_done).toBe(false);
    // Re-enriquecer un producto al que sólo le movieron el precio es pagarle a
    // Gemini por el mismo resultado (E2E §9.3 — control de costo).
    expect(precio.enrichment_done).toBe(true);
    expect(cola.llamadas).toHaveLength(1);
    expect(cola.llamadas[0]).toEqual([desc.id]);
  });

  it('AC-3: la marca durable permite reconstruir la cola con un SELECT', async () => {
    await importar(
      csv([
        'NUE-1,Producto uno,1000,1,Ferretería,uno',
        'NUE-2,Producto dos,2000,2,Ferretería,dos',
      ]),
    );

    // Es la garantía de que no se pierde trabajo con Redis sin aprovisionar:
    // el worker de US-005 barre esto, no una cola en memoria.
    const pendientes = await prisma.product.findMany({
      where: { enrichment_done: false },
      select: { sku: true },
      orderBy: { sku: 'asc' },
    });
    expect(pendientes.map((p) => p.sku)).toEqual(['NUE-1', 'NUE-2']);
  });
});
