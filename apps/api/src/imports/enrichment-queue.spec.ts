import { PrismaService } from '../prisma/prisma.service';
import { CategoriesRepository } from '../categories/categories.repository';
import { ProductsRepository } from '../products/products.repository';
import {
  EnrichmentQueue,
  LoggingEnrichmentQueue,
} from './enrichment-queue';
import { importConfigStub } from '../../test/import-config';
import { ImportJobsRepository } from './import-jobs.repository';
import { ImportRunner } from './import-runner';
import { ImportsService } from './imports.service';

/**
 * T4.4 — el encolado del enriquecimiento (AC-3).
 *
 * Dos propiedades importan y las dos son fáciles de perder: que se encole **una
 * vez** y **sólo** lo que hace falta re-enriquecer (control de costo de Gemini,
 * E2E §9.3), y que un fallo de la cola no arrastre el estado del import.
 */
describe('EnrichmentQueue (puerto de enriquecimiento)', () => {
  const prisma = new PrismaService();
  const jobs = new ImportJobsRepository(prisma);
  const products = new ProductsRepository(prisma);
  const categories = new CategoriesRepository(prisma);
  const service = new ImportsService(
    products,
    categories,
    jobs,
    importConfigStub(),
  );

  class ColaEspia implements EnrichmentQueue {
    llamadas: string[][] = [];
    async enqueue(ids: string[]): Promise<void> {
      this.llamadas.push([...ids]);
    }
  }

  class ColaQueFalla implements EnrichmentQueue {
    async enqueue(): Promise<void> {
      throw new Error('Redis no está aprovisionado');
    }
  }

  const config = importConfigStub();

  const csv = (lineas: string[]): Buffer =>
    Buffer.from(
      ['sku,nombre,precio,stock,categoria,descripcion', ...lineas].join('\n') +
        '\n',
      'utf8',
    );

  const nuevoJob = () =>
    jobs.create({
      filename: 'catalogo.csv',
      fileSizeBytes: 512,
      sourceFormat: 'csv',
    });

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE import_job_rows, import_jobs, products, categories RESTART IDENTITY CASCADE',
    );
  });

  it('encola UNA vez, con los creados y los de descripción cambiada, y sin el de sólo precio', async () => {
    // Estado previo: dos productos ya importados, uno de ellos ya enriquecido.
    const previo = await nuevoJob();
    const cola = new ColaEspia();
    await new ImportRunner(jobs, service, cola, config).run(
      previo.id,
      csv([
        'VIEJO-DESC,Viejo con descripcion,1000,1,Ferretería,original',
        'VIEJO-PRECIO,Viejo de precio,1000,1,Ferretería,intacta',
      ]),
      'csv',
    );
    await prisma.product.updateMany({ data: { enrichment_done: true } });

    // Import real: 2 altas + 1 update de descripción + 1 update de sólo precio.
    const job = await nuevoJob();
    const cola2 = new ColaEspia();
    await new ImportRunner(jobs, service, cola2, config).run(
      job.id,
      csv([
        'NUEVO-1,Nuevo uno,1000,1,Ferretería,alta',
        'NUEVO-2,Nuevo dos,2000,2,Ferretería,alta',
        'VIEJO-DESC,Viejo con descripcion,1000,1,Ferretería,DESCRIPCION NUEVA',
        'VIEJO-PRECIO,Viejo de precio,9999,1,Ferretería,intacta',
      ]),
      'csv',
    );

    expect(cola2.llamadas).toHaveLength(1);
    const encolados = cola2.llamadas[0];
    expect(encolados).toHaveLength(3);

    const porSku = new Map(
      (
        await prisma.product.findMany({ select: { id: true, sku: true } })
      ).map((p) => [p.sku, p.id]),
    );
    expect(encolados).toContain(porSku.get('NUEVO-1'));
    expect(encolados).toContain(porSku.get('NUEVO-2'));
    expect(encolados).toContain(porSku.get('VIEJO-DESC'));
    // El que sólo cambió de precio NO se re-enriquece: seria pagarle a Gemini
    // por un resultado idéntico.
    expect(encolados).not.toContain(porSku.get('VIEJO-PRECIO'));
  });

  it('la marca durable en la base coincide con lo encolado (AC-3 sin cola)', async () => {
    const previo = await nuevoJob();
    const cola = new ColaEspia();
    await new ImportRunner(jobs, service, cola, config).run(
      previo.id,
      csv(['VIEJO-PRECIO,Viejo de precio,1000,1,Ferretería,intacta']),
      'csv',
    );
    await prisma.product.updateMany({ data: { enrichment_done: true } });

    const job = await nuevoJob();
    const cola2 = new ColaEspia();
    await new ImportRunner(jobs, service, cola2, config).run(
      job.id,
      csv([
        'NUEVO-1,Nuevo uno,1000,1,Ferretería,alta',
        'NUEVO-2,Nuevo dos,2000,2,Ferretería,alta',
        'NUEVO-3,Nuevo tres,3000,3,Ferretería,alta',
        'VIEJO-PRECIO,Viejo de precio,9999,1,Ferretería,intacta',
      ]),
      'csv',
    );

    // Reconstruible con un SELECT: es lo que hace que AC-3 sea verificable hoy,
    // sin Redis ni worker.
    const pendientes = await prisma.product.count({
      where: { enrichment_done: false },
    });
    expect(pendientes).toBe(3);
    expect(cola2.llamadas[0]).toHaveLength(3);
  });

  it('un fallo de la cola NO cambia el estado del trabajo ni propaga', async () => {
    const job = await nuevoJob();

    await expect(
      new ImportRunner(jobs, service, new ColaQueFalla(), config).run(
        job.id,
        csv(['NUEVO-1,Nuevo uno,1000,1,Ferretería,alta']),
        'csv',
      ),
    ).resolves.toBeUndefined();

    const final = (await jobs.findById(job.id))!;
    // El import escribió el catálogo: convertirlo en `failed` haría que el dueño
    // vuelva a subir un archivo ya aplicado.
    expect(final.status).toBe('completed');
    expect(final.created_count).toBe(1);
    expect(final.error_code).toBeNull();
    expect(
      await prisma.product.count({ where: { enrichment_done: false } }),
    ).toBe(1);
  });

  it('no encola nada cuando el import no creó ni cambió descripciones', async () => {
    const job = await nuevoJob();
    const cola = new ColaEspia();

    await new ImportRunner(jobs, service, cola, config).run(
      job.id,
      // Todas inválidas: no hay nada para enriquecer.
      csv(['MAL-1,Malo,0,1,Ferretería,x']),
      'csv',
    );

    expect(cola.llamadas).toHaveLength(0);
  });

  it('el adapter interino no intenta conectarse a Redis', async () => {
    const adapter = new LoggingEnrichmentQueue();
    // Si intentara conectarse, esto colgaría o lanzaría: Redis no está
    // aprovisionado (ADR-0012).
    await expect(adapter.enqueue(['a', 'b', 'c'])).resolves.toBeUndefined();
    await expect(adapter.enqueue([])).resolves.toBeUndefined();
  });
});
