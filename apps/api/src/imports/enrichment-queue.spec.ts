import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EnrichmentRepository } from '../enrichment/enrichment.repository';
import { EnrichmentService } from '../enrichment/enrichment.service';
import { FakeAiProvider } from '../../test/fake-ai.provider';
import { CategoriesRepository } from '../categories/categories.repository';
import { ProductsRepository } from '../products/products.repository';
import {
  EnrichmentQueue,
  NudgeEnrichmentQueue,
} from '../enrichment/ports/enrichment-queue.port';
import { EnrichmentRunner } from '../enrichment/enrichment.runner';
import { importConfigStub } from '../../test/import-config';
import { ImportJobsRepository } from './import-jobs.repository';
import { ImportRunner } from './import-runner';
import { CatalogEventsService } from '../observability/catalog-events.service';
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
    await new ImportRunner(jobs, service, cola, new CatalogEventsService(), config).run(
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
    await new ImportRunner(jobs, service, cola2, new CatalogEventsService(), config).run(
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
    await new ImportRunner(jobs, service, cola, new CatalogEventsService(), config).run(
      previo.id,
      csv(['VIEJO-PRECIO,Viejo de precio,1000,1,Ferretería,intacta']),
      'csv',
    );
    await prisma.product.updateMany({ data: { enrichment_done: true } });

    const job = await nuevoJob();
    const cola2 = new ColaEspia();
    await new ImportRunner(jobs, service, cola2, new CatalogEventsService(), config).run(
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
      new ImportRunner(jobs, service, new ColaQueFalla(), new CatalogEventsService(), config).run(
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

    await new ImportRunner(jobs, service, cola, new CatalogEventsService(), config).run(
      job.id,
      // Todas inválidas: no hay nada para enriquecer.
      csv(['MAL-1,Malo,0,1,Ferretería,x']),
      'csv',
    );

    expect(cola.llamadas).toHaveLength(0);
  });

  describe('NudgeEnrichmentQueue — el adapter real (US-005 T3.5)', () => {
    /** Runner de mentira: sólo cuenta empujones. */
    function runnerEspia(): { kicks: number; runner: EnrichmentRunner } {
      const espia = { kicks: 0 };
      const runner = {
        kick() {
          espia.kicks += 1;
        },
      } as unknown as EnrichmentRunner;
      return { get kicks() { return espia.kicks; }, runner };
    }

    it('tres ids ⇒ UN kick, no tres', async () => {
      // El runner barre por lotes TODO lo pendiente: un kick por producto haría N veces el
      // mismo barrido y multiplicaría el gasto sin procesar nada nuevo.
      const espia = runnerEspia();
      const adapter = new NudgeEnrichmentQueue(espia.runner);

      await adapter.enqueue(['a', 'b', 'c']);

      expect(espia.kicks).toBe(1);
    });

    it('sin ids no empuja: no hay trabajo que anunciar', async () => {
      const espia = runnerEspia();
      await new NudgeEnrichmentQueue(espia.runner).enqueue([]);
      expect(espia.kicks).toBe(0);
    });

    it('si el kick lanza, enqueue RESUELVE igual (el contrato del puerto)', async () => {
      // Es la garantía que hacía valioso al no-op y que el adapter real no puede perder: el
      // import ya escribió el catálogo, y marcarlo `failed` por esto haría que el dueño
      // vuelva a subir un archivo ya aplicado.
      const runnerRoto = {
        kick() {
          throw new Error('el runner explotó');
        },
      } as unknown as EnrichmentRunner;

      await expect(
        new NudgeEnrichmentQueue(runnerRoto).enqueue(['a']),
      ).resolves.toBeUndefined();
    });

    it('no toca la base ni pierde trabajo: la cola sigue siendo enrichment_done=false', async () => {
      // El nudge es un aviso, no un registro. Si se pierde, el trabajo sigue en la base y la
      // próxima corrida lo barre — por eso este adapter puede vivir sin Redis (ADR-0014).
      const espia = runnerEspia();
      const job = await nuevoJob();
      await new ImportRunner(
        jobs,
        service,
        new NudgeEnrichmentQueue(espia.runner),
        new CatalogEventsService(),
        config,
      ).run(job.id, csv(['NUDGE-1,Uno,1000,1,Ferretería,alta']), 'csv');

      expect(espia.kicks).toBe(1);
      expect(await prisma.product.count({ where: { enrichment_done: false } })).toBe(1);
      expect((await jobs.findById(job.id))!.status).toBe('completed');
    });

    /** Espera activa acotada: el nudge es fire-and-forget, no hay promesa que esperar. */
    async function esperarHasta(
      cond: () => Promise<boolean>,
      timeoutMs = 10_000,
    ): Promise<void> {
      const limite = Date.now() + timeoutMs;
      while (Date.now() < limite) {
        if (await cond()) return;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error(`la condición no se cumplió en ${timeoutMs} ms`);
    }

    /** Runner real con el fake de IA por DI (el proveedor real no se toca en tests). */
    function runnerReal(env: Record<string, unknown> = {}) {
      const previo: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(env)) {
        previo[k] = process.env[k];
        process.env[k] = String(v);
      }
      const configNest = new ConfigService({}) as ConfigService;
      const repo = new EnrichmentRepository(prisma, configNest);
      const fake = new FakeAiProvider();
      const service = new EnrichmentService(prisma, repo, configNest, fake, fake);
      return {
        runner: new EnrichmentRunner(repo, service, configNest, fake, fake),
        fake,
        restaurar: () => {
          for (const [k, v] of Object.entries(previo)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
          }
        },
      };
    }

    it('INTEGRACIÓN: tras un import de 3 filas, el enriquecimiento arranca SOLO', async () => {
      // Es el punto de toda la task: el dueño sube un CSV y el catálogo se vuelve buscable
      // sin que nadie apriete nada. Sin este cableado, US-004 depende de una corrida manual.
      const { runner, fake, restaurar } = runnerReal({ ENRICHMENT_ENABLED: 'true' });
      try {
        const job = await nuevoJob();
        await new ImportRunner(
          jobs,
          service,
          new NudgeEnrichmentQueue(runner),
          new CatalogEventsService(),
          config,
        ).run(
          job.id,
          csv([
            'AUTO-1,Amoladora angular,150000,3,Ferretería,amoladora 115mm',
            'AUTO-2,Taladro percutor,220000,2,Ferretería,taladro 13mm',
            'AUTO-3,Mecha widia,18000,10,Ferretería,mecha 8mm',
          ]),
          'csv',
        );

        await esperarHasta(
          async () =>
            (await prisma.product.count({ where: { enrichment_done: true } })) === 3,
        );

        expect(await prisma.product.count({ where: { enrichment_done: false } })).toBe(0);
        expect(fake.embedCalls).toHaveLength(3);
        // Y quedaron con vector: buscables, no sólo marcados.
        const vectores = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
          'SELECT count(*)::bigint AS n FROM product_embeddings',
        );
        expect(Number(vectores[0].n)).toBe(3);
      } finally {
        restaurar();
      }
    });

    it('con el runner disabled, enqueue es un no-op silencioso (no una excepción)', async () => {
      // Sin GEMINI_API_KEY o con el flag en false, el import tiene que seguir funcionando
      // igual: el catálogo se carga y el enriquecimiento queda pendiente en la base.
      const { runner, fake, restaurar } = runnerReal({ ENRICHMENT_ENABLED: 'false' });
      try {
        const job = await nuevoJob();

        await expect(
          new ImportRunner(
            jobs,
            service,
            new NudgeEnrichmentQueue(runner),
            new CatalogEventsService(),
            config,
          ).run(job.id, csv(['OFF-1,Uno,1000,1,Ferretería,alta']), 'csv'),
        ).resolves.toBeUndefined();

        await new Promise((r) => setImmediate(r));
        expect(runner.state).toBe('disabled');
        expect(fake.embedCalls).toHaveLength(0);
        expect((await jobs.findById(job.id))!.status).toBe('completed');
        expect(await prisma.product.count({ where: { enrichment_done: false } })).toBe(1);
      } finally {
        restaurar();
      }
    });
  });
});
