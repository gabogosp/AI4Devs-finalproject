import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { adminToken, bootTestApp, customerToken } from '../../test/e2e-app';
import { PrismaService } from '../prisma/prisma.service';
import { ImportsModule } from './imports.module';

/**
 * T5.3 — e2e del estado del trabajo.
 *
 * El test más valioso del archivo es el del **conjunto exacto de claves**: es el
 * que falla si algún día alguien devuelve la fila de la base tal cual y filtra la
 * `idempotency_key` (una credencial de reintento) o el `heartbeat_at` (plumbing
 * del reaper) en una respuesta pública del panel.
 */
const CAMPOS_ESPERADOS = [
  'id',
  'status',
  'filename',
  'source_format',
  'total_rows',
  'processed_rows',
  'created_count',
  'updated_count',
  'failed_count',
  'categories_created_count',
  'error_code',
  'error_message',
  'report_truncated',
  'started_at',
  'finished_at',
  'created_at',
  'errors',
  'pagination',
];

describe('GET /v1/admin/imports/{id} (e2e-imports-status, AC-5/AC-7)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const get = (path: string) =>
    request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${adminToken()}`);

  const post = (buffer: Buffer, nombre = 'catalogo.csv') =>
    request(app.getHttpServer())
      .post('/v1/admin/imports')
      .set('Authorization', `Bearer ${adminToken()}`)
      .attach('file', buffer, nombre);

  const csv = (lineas: string[]) =>
    Buffer.from(
      ['sku,nombre,precio,stock,categoria', ...lineas].join('\n') + '\n',
      'utf8',
    );

  const esperarCierre = async (id: string): Promise<void> => {
    for (let i = 0; i < 300; i += 1) {
      const job = await prisma.importJob.findUnique({ where: { id } });
      if (!job || job.status === 'completed' || job.status === 'failed') return;
      await new Promise((r) => setTimeout(r, 20));
    }
  };

  const limpiar = () =>
    prisma.$executeRawUnsafe(
      'TRUNCATE TABLE import_job_rows, import_jobs, products, categories RESTART IDENTITY CASCADE',
    );

  beforeAll(async () => {
    app = await bootTestApp([ImportsModule]);
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(async () => {
    await limpiar();
    await new Promise((r) => setTimeout(r, 30));
    await limpiar();
  });

  it('devuelve EXACTAMENTE los campos del contrato, sin los internos', async () => {
    const alta = await post(csv(['REF-1,Heladera,1000,3,Refrigeración']));
    await esperarCierre(alta.body.id);

    const res = await get(`/v1/admin/imports/${alta.body.id}`);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual([...CAMPOS_ESPERADOS].sort());
    // Explícito porque son los dos que importan: una credencial de reintento y
    // plumbing interno no salen del backend.
    expect(res.body).not.toHaveProperty('idempotency_key');
    expect(res.body).not.toHaveProperty('heartbeat_at');
    expect(res.body).not.toHaveProperty('updated_at');
    expect(res.body).not.toHaveProperty('created_by_subject');
  });

  it('los contadores y las fechas vienen con el tipo del contrato', async () => {
    const alta = await post(
      csv([
        'REF-1,Heladera,1000,3,Refrigeración',
        'REF-2,Mecha,0,3,Herramientas',
      ]),
    );
    await esperarCierre(alta.body.id);

    const { body } = await get(`/v1/admin/imports/${alta.body.id}`);

    expect(body.status).toBe('completed');
    expect(body.total_rows).toBe(2);
    expect(body.processed_rows).toBe(2);
    expect(body.created_count).toBe(1);
    expect(body.failed_count).toBe(1);
    expect(body.error_code).toBeNull(); // el fallo fue por fila, no global
    expect(body.report_truncated).toBe(false);
    expect(typeof body.created_at).toBe('string');
    expect(new Date(body.created_at).toString()).not.toBe('Invalid Date');
    expect(body.pagination).toEqual({ limit: 50, offset: 0, total: 1 });
  });

  it('un id inexistente → 404 dsm:import/not-found', async () => {
    const res = await get(
      '/v1/admin/imports/00000000-0000-4000-8000-000000000000',
    );

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body.type).toBe('dsm:import/not-found');
  });

  it('un id que no es UUID → 422, nunca 500', async () => {
    const res = await get('/v1/admin/imports/abc');

    expect(res.status).toBe(422);
    expect(res.body.status).toBe(422);
  });

  it('sin token → 401; con token de cliente → 403 (AC-8)', async () => {
    const alta = await post(csv(['REF-1,Heladera,1000,3,Refrigeración']));
    await esperarCierre(alta.body.id);
    const path = `/v1/admin/imports/${alta.body.id}`;

    expect(
      (await request(app.getHttpServer()).get(path)).status,
    ).toBe(401);
    expect(
      (
        await request(app.getHttpServer())
          .get(path)
          .set('Authorization', `Bearer ${customerToken()}`)
      ).status,
    ).toBe(403);
  });

  describe('paginación de las filas rechazadas', () => {
    it('120 filas malas: 50 por página, total real y row_number creciente', async () => {
      const lineas = Array.from(
        { length: 120 },
        (_, i) => `MAL-${i + 1},Producto ${i + 1},0,3,Ferretería`,
      );
      const alta = await post(csv(lineas));
      await esperarCierre(alta.body.id);

      const primera = await get(`/v1/admin/imports/${alta.body.id}`);
      expect(primera.body.errors).toHaveLength(50);
      expect(primera.body.failed_count).toBe(120);
      expect(primera.body.pagination.total).toBe(120);
      expect(primera.body.errors[0].row_number).toBe(1);
      // Ordenado por row_number: el reporte tiene que leerse como el archivo.
      const numeros = primera.body.errors.map(
        (e: { row_number: number }) => e.row_number,
      );
      expect(numeros).toEqual([...numeros].sort((a, b) => a - b));

      const segunda = await get(
        `/v1/admin/imports/${alta.body.id}?offset=50`,
      );
      expect(segunda.body.errors).toHaveLength(50);
      expect(segunda.body.errors[0].row_number).toBeGreaterThan(
        primera.body.errors[49].row_number,
      );

      const tercera = await get(
        `/v1/admin/imports/${alta.body.id}?offset=100`,
      );
      expect(tercera.body.errors).toHaveLength(20);
    });

    it('cada fila rechazada trae fila, sku, campo, código y motivo', async () => {
      const alta = await post(csv(['MAL-1,Producto,0,3,Ferretería']));
      await esperarCierre(alta.body.id);

      const { body } = await get(`/v1/admin/imports/${alta.body.id}`);

      expect(body.errors[0]).toEqual({
        row_number: 1,
        sku: 'MAL-1',
        field: 'precio',
        error_code: 'invalid_price',
        error_message: expect.any(String),
      });
    });

    it.each([
      ['?limit=0', 'limit por debajo del mínimo'],
      ['?limit=201', 'limit por encima del techo'],
      ['?limit=abc', 'limit no numérico'],
      ['?offset=-1', 'offset negativo'],
      ['?pagina=2', 'parámetro desconocido (whitelist)'],
    ])('%s → 422 (%s)', async (query) => {
      const alta = await post(csv(['REF-1,Heladera,1000,3,Refrigeración']));
      await esperarCierre(alta.body.id);

      const res = await get(`/v1/admin/imports/${alta.body.id}${query}`);

      expect(res.status).toBe(422);
    });
  });

  it('el progreso AVANZA entre dos consultas mientras el trabajo corre (AC-7)', async () => {
    const lineas = Array.from(
      { length: 900 },
      (_, i) => `REF-${i + 1},Producto ${i + 1},1000,3,Ferretería`,
    );
    const alta = await post(csv(lineas));
    expect(alta.status).toBe(202);

    const muestras: number[] = [];
    for (let i = 0; i < 60; i += 1) {
      const { body } = await get(`/v1/admin/imports/${alta.body.id}`);
      muestras.push(body.processed_rows);
      if (body.status === 'completed' || body.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 25));
    }

    // Al menos una muestra intermedia con progreso real: es lo que el panel
    // pinta en la barra, y sin esto AC-7 sería un cuento.
    expect(muestras.some((m) => m > 0 && m < 900)).toBe(true);
    expect(muestras[muestras.length - 1]).toBe(900);
    expect(muestras).toEqual([...muestras].sort((a, b) => a - b));

    await esperarCierre(alta.body.id);
  });
});
