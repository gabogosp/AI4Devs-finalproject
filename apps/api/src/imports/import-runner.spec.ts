import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { bootTestApp } from '../../test/e2e-app';
import { HealthModule } from '../health/health.module';
import { PrismaService } from '../prisma/prisma.service';
import { CategoriesRepository } from '../categories/categories.repository';
import { ProductsRepository } from '../products/products.repository';
import { ImportJobsRepository } from './import-jobs.repository';
import { ImportRunner } from './import-runner';
import { ImportsService } from './imports.service';

/**
 * T4.3 — integration del ejecutor. Lo que se prueba es el comportamiento
 * asíncrono, que es lo que sostiene AC-7: progreso consultable **mientras**
 * corre, cierre garantizado, tope de reporte honesto y un event loop que sigue
 * atendiendo.
 */
describe('ImportRunner (integration)', () => {
  const prisma = new PrismaService();
  const jobs = new ImportJobsRepository(prisma);
  const products = new ProductsRepository(prisma);
  const categories = new CategoriesRepository(prisma);
  const service = new ImportsService(products, categories);

  const runner = (over: Record<string, number> = {}): ImportRunner => {
    const valores: Record<string, number> = {
      IMPORT_BATCH_SIZE: 50,
      IMPORT_MAX_ROWS: 5_000,
      IMPORT_MAX_UNCOMPRESSED_BYTES: 33_554_432,
      IMPORT_MAX_REPORT_ROWS: 1_000,
      IMPORT_JOB_STALE_MS: 120_000,
      IMPORT_RETENTION_DAYS: 90,
      ...over,
    };
    const config = {
      get: <T>(clave: string): T => valores[clave] as unknown as T,
    } as ConfigService;
    return new ImportRunner(jobs, service, config);
  };

  const csv = (filas: number, valido = true): Buffer => {
    const lineas = ['sku,nombre,precio,stock,categoria'];
    for (let i = 1; i <= filas; i += 1) {
      lineas.push(
        valido
          ? `REF-${i},Producto ${i},1000.50,3,Ferretería`
          : `REF-${i},Producto ${i},0,-1,Ferretería`,
      );
    }
    return Buffer.from(lineas.join('\n') + '\n', 'utf8');
  };

  const nuevoJob = () =>
    jobs.create({
      filename: 'catalogo.csv',
      fileSizeBytes: 1024,
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

  it('lleva el trabajo de pending a completed con los contadores cuadrados', async () => {
    const job = await nuevoJob();
    expect(job.status).toBe('pending');

    await runner().run(job.id, csv(120), 'csv');

    const final = (await jobs.findById(job.id))!;
    expect(final.status).toBe('completed');
    expect(final.processed_rows).toBe(120);
    expect(final.total_rows).toBe(120);
    expect(
      final.created_count + final.updated_count + final.failed_count,
    ).toBe(120);
    expect(final.created_count).toBe(120);
    expect(final.categories_created_count).toBe(1);
    expect(final.finished_at).toBeInstanceOf(Date);
    expect(await prisma.product.count()).toBe(120);
  });

  it('el progreso es consultable MIENTRAS corre, no sólo al final (AC-7)', async () => {
    const job = await nuevoJob();
    const muestras: { status: string; processed: number }[] = [];

    const corriendo = runner({ IMPORT_BATCH_SIZE: 50 }).run(
      job.id,
      csv(500),
      'csv',
    );

    // Muestrear mientras el runner cede el turno entre lotes.
    for (let i = 0; i < 40; i += 1) {
      await new Promise((r) => setTimeout(r, 15));
      const j = (await jobs.findById(job.id))!;
      muestras.push({ status: j.status, processed: j.processed_rows });
      if (j.status !== 'running') break;
    }
    await corriendo;

    const enCurso = muestras.filter(
      (m) => m.status === 'running' && m.processed > 0 && m.processed < 500,
    );
    expect(enCurso.length).toBeGreaterThan(0);

    const final = (await jobs.findById(job.id))!;
    expect(final.status).toBe('completed');
    expect(final.processed_rows).toBe(500);
    expect(final.total_rows).toBe(500);
  });

  it('el heartbeat avanza entre lotes (insumo del reaper)', async () => {
    const job = await nuevoJob();
    await runner({ IMPORT_BATCH_SIZE: 20 }).run(job.id, csv(100), 'csv');

    const final = (await jobs.findById(job.id))!;
    expect(final.heartbeat_at).toBeInstanceOf(Date);
    expect(final.heartbeat_at!.getTime()).toBeGreaterThanOrEqual(
      final.started_at!.getTime(),
    );
  });

  it('un archivo íntegramente malo cuenta TODO pero persiste hasta el tope', async () => {
    const job = await nuevoJob();

    await runner({ IMPORT_MAX_REPORT_ROWS: 100, IMPORT_BATCH_SIZE: 50 }).run(
      job.id,
      csv(300, false),
      'csv',
    );

    const final = (await jobs.findById(job.id))!;
    expect(final.status).toBe('completed');
    // El contador dice la verdad completa…
    expect(final.failed_count).toBe(300);
    // …y el reporte declara que está recortado.
    expect(final.report_truncated).toBe(true);
    expect(await jobs.countRowErrors(job.id)).toBe(100);
    expect(await prisma.product.count()).toBe(0);
  });

  it('mezcla válidas e inválidas sin dejar escrituras parciales (AC-5)', async () => {
    const job = await nuevoJob();
    const buffer = Buffer.from(
      [
        'sku,nombre,precio,stock,categoria',
        'OK-1,Bueno 1,1000,5,Ferretería',
        'MAL-1,Malo 1,0,5,Ferretería',
        'OK-2,Bueno 2,2000,1,Ferretería',
        'MAL-2,Malo 2,1000,-3,Ferretería',
        'OK-3,Bueno 3,3000,0,Ferretería',
      ].join('\n') + '\n',
      'utf8',
    );

    await runner().run(job.id, buffer, 'csv');

    const final = (await jobs.findById(job.id))!;
    expect(final.created_count).toBe(3);
    expect(final.failed_count).toBe(2);
    expect(final.report_truncated).toBe(false);
    const skus = (
      await prisma.product.findMany({ select: { sku: true }, orderBy: { sku: 'asc' } })
    ).map((p) => p.sku);
    expect(skus).toEqual(['OK-1', 'OK-2', 'OK-3']);

    const errores = await jobs.findRowErrors(final.id, { limit: 10, offset: 0 });
    expect(errores.map((e) => [e.row_number, e.error_code])).toEqual([
      [2, 'invalid_price'],
      [4, 'invalid_stock'],
    ]);
  });

  it('NO bloquea el event loop: un temporizador de 10 ms sigue disparando a tiempo', async () => {
    const job = await nuevoJob();
    const latencias: number[] = [];
    let seguir = true;

    const medir = async (): Promise<void> => {
      while (seguir) {
        const t0 = Date.now();
        await new Promise((r) => setTimeout(r, 10));
        latencias.push(Date.now() - t0);
      }
    };
    const midiendo = medir();

    await runner({ IMPORT_BATCH_SIZE: 100 }).run(job.id, csv(2_000), 'csv');
    seguir = false;
    await midiendo;

    expect(latencias.length).toBeGreaterThan(5);
    // Si el runner ocupara el loop, un timer de 10 ms tardaría segundos.
    expect(Math.max(...latencias)).toBeLessThan(1_000);
  });

  it('la API sigue respondiendo: GET /health contesta mientras se procesan 2.000 filas', async () => {
    // La variante honesta del criterio: no un proxy del event loop, sino la
    // superficie HTTP real atendiendo durante el import.
    const app = await bootTestApp([HealthModule]);
    try {
      const job = await nuevoJob();
      const corriendo = runner({ IMPORT_BATCH_SIZE: 100 }).run(
        job.id,
        csv(2_000),
        'csv',
      );

      // Esperar a que el runner esté efectivamente trabajando.
      await new Promise((r) => setTimeout(r, 50));
      const t0 = Date.now();
      const res = await request(app.getHttpServer()).get('/health');
      const tardo = Date.now() - t0;

      expect(res.status).toBe(200);
      expect(tardo).toBeLessThan(1_000);
      expect((await jobs.findById(job.id))!.status).toBe('running');

      await corriendo;
      expect((await jobs.findById(job.id))!.status).toBe('completed');
    } finally {
      await app.close();
    }
  });

  it('un fallo global deja el trabajo failed con su error_code, nunca running', async () => {
    const job = await nuevoJob();
    // Sin la columna `precio` el archivo entero es inválido.
    const roto = Buffer.from('sku,nombre,stock,categoria\nA,B,1,C\n', 'utf8');

    await runner().run(job.id, roto, 'csv');

    const final = (await jobs.findById(job.id))!;
    expect(final.status).toBe('failed');
    expect(final.error_code).toBe('missing-columns');
    expect(await prisma.product.count()).toBe(0);
  });

  it('el trabajo se cierra aunque el lote lance un error inesperado', async () => {
    const job = await nuevoJob();
    const r = runner();
    jest
      .spyOn(service, 'processBatch')
      .mockRejectedValueOnce(new Error('la base se cayó'));

    await r.run(job.id, csv(10), 'csv');

    const final = (await jobs.findById(job.id))!;
    expect(final.status).toBe('failed');
    expect(final.error_code).toBe('internal');
    // Lo que importa: NO quedó `running` bloqueando los imports siguientes.
    expect(await jobs.findActive()).toBeNull();
    jest.restoreAllMocks();
  });

  it('schedule devuelve el control en el acto y el trabajo termina después', async () => {
    const job = await nuevoJob();

    const t0 = Date.now();
    runner().schedule(job.id, csv(200), 'csv');
    const devolvioEn = Date.now() - t0;

    expect(devolvioEn).toBeLessThan(50);
    // El `POST` ya respondió 202: el trabajo termina por su cuenta.
    for (let i = 0; i < 100; i += 1) {
      await new Promise((r) => setTimeout(r, 20));
      if ((await jobs.findById(job.id))!.status === 'completed') break;
    }
    expect((await jobs.findById(job.id))!.status).toBe('completed');
    expect(await prisma.product.count()).toBe(200);
  });

  describe('barrido de arranque', () => {
    it('cierra como interrupted el trabajo running sin latido y purga el historial vencido', async () => {
      const huerfano = await nuevoJob();
      await jobs.markRunning(huerfano.id);
      await prisma.importJob.update({
        where: { id: huerfano.id },
        data: { heartbeat_at: new Date(Date.now() - 10 * 60 * 1000) },
      });

      const vencido = await nuevoJob();
      await prisma.importJob.update({
        where: { id: vencido.id },
        data: { created_at: new Date(Date.now() - 100 * 24 * 3600 * 1000) },
      });

      await runner({ IMPORT_JOB_STALE_MS: 60_000 }).onApplicationBootstrap();

      const cerrado = (await jobs.findById(huerfano.id))!;
      expect(cerrado.status).toBe('failed');
      expect(cerrado.error_code).toBe('interrupted');
      expect(await jobs.findById(vencido.id)).toBeNull();
      // Y lo más importante: el próximo import ya no está bloqueado.
      expect(await jobs.findActive()).toBeNull();
    });

    it('no toca los trabajos con latido reciente', async () => {
      const vivo = await nuevoJob();
      await jobs.markRunning(vivo.id);

      await runner({ IMPORT_JOB_STALE_MS: 120_000 }).onApplicationBootstrap();

      expect((await jobs.findById(vivo.id))!.status).toBe('running');
    });
  });
});
