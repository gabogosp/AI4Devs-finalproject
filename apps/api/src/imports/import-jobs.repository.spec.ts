import { PrismaService } from '../prisma/prisma.service';
import { ConflictError } from '../common/errors/domain-errors';
import {
  ImportJobsRepository,
  JobCounters,
} from './import-jobs.repository';

/** Integration contra el Postgres real de docker-compose. */
describe('ImportJobsRepository (integration)', () => {
  const prisma = new PrismaService();
  const repo = new ImportJobsRepository(prisma);

  const CONTADORES: JobCounters = {
    processedRows: 0,
    createdCount: 0,
    updatedCount: 0,
    failedCount: 0,
    categoriesCreatedCount: 0,
  };

  const alta = (over: Partial<Parameters<typeof repo.create>[0]> = {}) =>
    repo.create({
      filename: 'catalogo.csv',
      fileSizeBytes: 1024,
      sourceFormat: 'csv',
      ...over,
    });

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE import_job_rows, import_jobs RESTART IDENTITY CASCADE',
    );
  });

  describe('create', () => {
    it('crea el trabajo en pending con los contadores en cero', async () => {
      const job = await alta();
      expect(job.status).toBe('pending');
      expect(job.processed_rows).toBe(0);
      expect(job.total_rows).toBeNull();
      expect(job.report_truncated).toBe(false);
      expect(job.started_at).toBeNull();
    });

    it('persiste el filename como metadata y el subject del admin', async () => {
      const job = await alta({
        filename: '../../etc/passwd',
        createdBySubject: 'admin-1',
      });
      // El nombre se guarda tal cual porque es sólo metadata para mostrar: nunca
      // se usa como ruta (no se escribe nada a disco).
      expect(job.filename).toBe('../../etc/passwd');
      expect(job.created_by_subject).toBe('admin-1');
    });

    it('la misma Idempotency-Key lanza ConflictError, NO un error de Prisma', async () => {
      await alta({ idempotencyKey: 'k-1' });

      const error = await alta({ idempotencyKey: 'k-1' }).catch((e) => e);

      expect(error).toBeInstanceOf(ConflictError);
      // Que no escape el error crudo del ORM es la mitad del criterio: el borde
      // HTTP no tiene por qué saber qué es un P2002.
      expect(error.constructor.name).not.toContain('Prisma');
      expect(await prisma.importJob.count()).toBe(1);
    });

    it('dos trabajos sin Idempotency-Key conviven (el UNIQUE no cuenta los null)', async () => {
      await alta();
      await alta();
      expect(await prisma.importJob.count()).toBe(2);
    });
  });

  describe('findActive', () => {
    it('devuelve el pending y el running, y null cuando todos cerraron', async () => {
      const job = await alta();
      expect((await repo.findActive())?.id).toBe(job.id);

      await repo.markRunning(job.id);
      expect((await repo.findActive())?.id).toBe(job.id);

      await repo.markCompleted(job.id, CONTADORES);
      expect(await repo.findActive()).toBeNull();
    });

    it('un trabajo failed tampoco está vigente', async () => {
      const job = await alta();
      await repo.markFailed(job.id, 'interrupted', 'se murió el proceso');
      expect(await repo.findActive()).toBeNull();
    });
  });

  describe('progreso y cierre', () => {
    it('markRunning sella started_at y el primer latido', async () => {
      const job = await repo.markRunning((await alta()).id);
      expect(job.status).toBe('running');
      expect(job.started_at).toBeInstanceOf(Date);
      expect(job.heartbeat_at).toBeInstanceOf(Date);
    });

    it('heartbeat publica el progreso parcial y renueva el latido', async () => {
      const creado = await alta();
      const primero = await repo.markRunning(creado.id);

      await new Promise((r) => setTimeout(r, 10));
      const job = await repo.heartbeat(creado.id, {
        ...CONTADORES,
        processedRows: 200,
        createdCount: 180,
        failedCount: 20,
        totalRows: 500,
      });

      expect(job.status).toBe('running');
      expect(job.processed_rows).toBe(200);
      expect(job.created_count).toBe(180);
      expect(job.failed_count).toBe(20);
      expect(job.total_rows).toBe(500);
      expect(job.heartbeat_at!.getTime()).toBeGreaterThan(
        primero.heartbeat_at!.getTime(),
      );
    });

    it('markCompleted cierra con los contadores finales', async () => {
      const creado = await alta();
      const job = await repo.markCompleted(creado.id, {
        processedRows: 500,
        createdCount: 400,
        updatedCount: 95,
        failedCount: 5,
        categoriesCreatedCount: 3,
        totalRows: 500,
        reportTruncated: true,
      });

      expect(job.status).toBe('completed');
      expect(job.finished_at).toBeInstanceOf(Date);
      expect(job.report_truncated).toBe(true);
      expect(job.categories_created_count).toBe(3);
    });

    it('markFailed registra el código y el motivo del fallo global', async () => {
      const job = await repo.markFailed(
        (await alta()).id,
        'interrupted',
        'el proceso se reinició',
      );
      expect(job.status).toBe('failed');
      expect(job.error_code).toBe('interrupted');
      expect(job.error_message).toContain('reinició');
    });
  });

  describe('filas rechazadas', () => {
    it('las persiste, las cuenta y las devuelve paginadas por row_number', async () => {
      const job = await alta();
      const filas = Array.from({ length: 5 }, (_, i) => ({
        rowNumber: 5 - i, // desordenadas a propósito
        sku: `REF-${5 - i}`,
        field: 'precio',
        errorCode: 'invalid_price' as const,
        errorMessage: 'el precio no es válido',
      }));

      expect(await repo.appendRowErrors(job.id, filas)).toBe(5);
      expect(await repo.countRowErrors(job.id)).toBe(5);

      const pagina = await repo.findRowErrors(job.id, { limit: 3, offset: 0 });
      expect(pagina.map((f) => f.row_number)).toEqual([1, 2, 3]);

      const segunda = await repo.findRowErrors(job.id, { limit: 3, offset: 3 });
      expect(segunda.map((f) => f.row_number)).toEqual([4, 5]);
    });

    it('appendRowErrors con lista vacía no escribe nada', async () => {
      const job = await alta();
      expect(await repo.appendRowErrors(job.id, [])).toBe(0);
      expect(await repo.countRowErrors(job.id)).toBe(0);
    });

    it('borrar el trabajo se lleva sus filas por cascada', async () => {
      const job = await alta();
      await repo.appendRowErrors(job.id, [
        {
          rowNumber: 1,
          errorCode: 'missing_required',
          errorMessage: 'falta el sku',
        },
      ]);

      await prisma.importJob.delete({ where: { id: job.id } });

      expect(await prisma.importJobRow.count()).toBe(0);
    });
  });

  describe('reapStale', () => {
    it('cierra sólo el running sin latido reciente y deja los otros intactos', async () => {
      const viejo = await alta({ filename: 'viejo.csv' });
      await repo.markRunning(viejo.id);
      await prisma.importJob.update({
        where: { id: viejo.id },
        data: { heartbeat_at: new Date(Date.now() - 10 * 60 * 1000) },
      });

      const fresco = await alta({ filename: 'fresco.csv' });
      await repo.markRunning(fresco.id);

      const cerrado = await alta({ filename: 'cerrado.csv' });
      await repo.markCompleted(cerrado.id, CONTADORES);

      const cuantos = await repo.reapStale(2 * 60 * 1000);

      expect(cuantos).toBe(1);
      expect((await repo.findById(viejo.id))!.status).toBe('failed');
      expect((await repo.findById(viejo.id))!.error_code).toBe('interrupted');
      expect((await repo.findById(fresco.id))!.status).toBe('running');
      expect((await repo.findById(cerrado.id))!.status).toBe('completed');
    });

    it('el motivo del trabajo interrumpido le dice al dueño qué hacer', async () => {
      const job = await alta();
      await repo.markRunning(job.id);
      await prisma.importJob.update({
        where: { id: job.id },
        data: { heartbeat_at: new Date(Date.now() - 10 * 60 * 1000) },
      });

      await repo.reapStale(60_000);

      // Re-subir es seguro por la reconciliación por SKU: el runbook lo dice y
      // el mensaje que ve el dueño tiene que decir lo mismo.
      expect((await repo.findById(job.id))!.error_message).toContain('SKU');
    });

    it('sin trabajos huérfanos no cierra nada', async () => {
      const job = await alta();
      await repo.markRunning(job.id);
      expect(await repo.reapStale(60_000)).toBe(0);
    });
  });

  describe('purgeOlderThan (retención de 90 días)', () => {
    it('borra sólo los trabajos fuera de la ventana, con sus filas', async () => {
      const viejo = await alta({ filename: 'de-hace-100-dias.csv' });
      await repo.appendRowErrors(viejo.id, [
        { rowNumber: 1, errorCode: 'invalid_price', errorMessage: 'mal precio' },
      ]);
      await prisma.importJob.update({
        where: { id: viejo.id },
        data: { created_at: new Date(Date.now() - 100 * 24 * 3600 * 1000) },
      });

      const reciente = await alta({ filename: 'de-hace-10-dias.csv' });
      await prisma.importJob.update({
        where: { id: reciente.id },
        data: { created_at: new Date(Date.now() - 10 * 24 * 3600 * 1000) },
      });

      expect(await repo.purgeOlderThan(90)).toBe(1);
      expect(await repo.findById(viejo.id)).toBeNull();
      expect(await repo.findById(reciente.id)).not.toBeNull();
      expect(await prisma.importJobRow.count()).toBe(0);
    });

    it('una ventana no positiva lanza en vez de barrer la tabla entera', async () => {
      await alta();
      await expect(repo.purgeOlderThan(0)).rejects.toThrow(/ventana positiva/);
      expect(await prisma.importJob.count()).toBe(1);
    });
  });
});
