import { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import request from 'supertest';
import {
  adminToken,
  bootTestApp,
  customerToken, nuevaIpDeTest } from '../../test/e2e-app';
import { PrismaService } from '../prisma/prisma.service';
import { ImportsModule } from './imports.module';

/**
 * T5.2 — e2e del alta del import.
 *
 * El corazón de este spec es AC-6: cada rechazo de archivo compara
 * `count(products)` y `count(import_jobs)` **antes y después**. Un 4xx que dejó
 * un trabajo colgado o media tabla escrita cumple el código de estado y rompe el
 * criterio de aceptación.
 */
describe('POST /v1/admin/imports (e2e-imports-upload, AC-6/AC-8/AC-11)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  /**
   * IP propia por test: el `POST` tiene presupuesto de 3/hora por IP (T5.5), así
   * que sin esto el cuarto request de la suite recibiría 429 en lugar del código
   * que el test está verificando. El límite no está mal puesto — son los tests
   * los que tienen que hablar desde IPs distintas.
   */
  let ip: string;

  const CSV_OK = [
    'sku,nombre,precio,stock,categoria',
    'REF-1,Heladera,1234.56,3,Refrigeración',
    'REF-2,Mecha 8mm,900,10,Herramientas',
  ].join('\n');

  const post = () =>
    request(app.getHttpServer())
      .post('/v1/admin/imports')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Forwarded-For', ip);

  /**
   * Espera a que el trabajo agendado termine.
   *
   * No es cortesía: el runner sigue corriendo después de que el request
   * respondió, y si el test siguiente hace TRUNCATE mientras escribe, el runner
   * falla contra una tabla vacía y ensucia otro test con errores que no son suyos.
   */
  const esperarCierre = async (id: string): Promise<void> => {
    for (let i = 0; i < 200; i += 1) {
      const job = await prisma.importJob.findUnique({ where: { id } });
      if (!job || job.status === 'completed' || job.status === 'failed') return;
      await new Promise((r) => setTimeout(r, 20));
    }
  };

  const conteos = async () => ({
    products: await prisma.product.count(),
    jobs: await prisma.importJob.count(),
  });

  beforeAll(async () => {
    process.env.TRUST_PROXY_HOPS = '1';
    app = await bootTestApp([ImportsModule]);
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app?.close();
    delete process.env.TRUST_PROXY_HOPS;
  });
  const limpiar = () =>
    prisma.$executeRawUnsafe(
      'TRUNCATE TABLE import_job_rows, import_jobs, products, categories RESTART IDENTITY CASCADE',
    );

  beforeEach(async () => {
    ip = nuevaIpDeTest();
    // Doble barrido con una pausa: el runner de un import anterior —de otro test
    // o de otra corrida de la suite— puede tener una escritura en vuelo cuando
    // arranca este test, y aparecería como productos "fantasma" en los conteos
    // de impacto cero. Es un artefacto del ejecutor asíncrono, no del producto.
    await limpiar();
    await new Promise((r) => setTimeout(r, 30));
    await limpiar();
  });

  describe('frontera de autorización (AC-8)', () => {
    it('sin token → 401 y no crea nada', async () => {
      const antes = await conteos();
      const res = await request(app.getHttpServer())
        .post('/v1/admin/imports')
        .set('X-Forwarded-For', ip)
        .attach('file', Buffer.from(CSV_OK), 'catalogo.csv');

      expect(res.status).toBe(401);
      expect(await conteos()).toEqual(antes);
    });

    it('con token de cliente → 403 (el AdminGuard no se modificó)', async () => {
      const antes = await conteos();
      const res = await request(app.getHttpServer())
        .post('/v1/admin/imports')
        .set('Authorization', `Bearer ${customerToken()}`)
        .set('X-Forwarded-For', ip)
        .attach('file', Buffer.from(CSV_OK), 'catalogo.csv');

      expect(res.status).toBe(403);
      expect(await conteos()).toEqual(antes);
    });
  });

  describe('rechazo del archivo con impacto CERO (AC-6, AC-11)', () => {
    it('sin la columna precio → 422 dsm:import/missing-columns', async () => {
      const antes = await conteos();
      const res = await post().attach(
        'file',
        Buffer.from('sku,nombre,stock,categoria\nREF-1,Heladera,3,Refrigeración\n'),
        'catalogo.csv',
      );

      expect(res.status).toBe(422);
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(res.body.type).toBe('dsm:import/missing-columns');
      expect(res.body.errors).toEqual([
        { field: 'precio', message: 'columna requerida ausente en el encabezado' },
      ]);
      expect(await conteos()).toEqual(antes);
    });

    it('un ejecutable renombrado a .csv → 415 dsm:import/unsupported-format', async () => {
      const antes = await conteos();
      const elf = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01]);

      const res = await post().attach('file', elf, 'catalogo.csv');

      expect(res.status).toBe(415);
      expect(res.body.type).toBe('dsm:import/unsupported-format');
      expect(res.body.title).toBe('Unsupported Media Type');
      expect(await conteos()).toEqual(antes);
    });

    it('un CSV en windows-1252 → 422 dsm:import/invalid-encoding', async () => {
      const antes = await conteos();
      const latin1 = Buffer.from(
        'sku,nombre,precio,stock,categoria\nREF-1,Refrigeración,10,1,Varios\n',
        'latin1',
      );

      const res = await post().attach('file', latin1, 'catalogo.csv');

      expect(res.status).toBe(422);
      expect(res.body.type).toBe('dsm:import/invalid-encoding');
      expect(await conteos()).toEqual(antes);
    });

    it('más filas que el tope → 422 dsm:import/row-limit-exceeded, sin crear el trabajo', async () => {
      const antes = await conteos();
      const lineas = ['sku,nombre,precio,stock,categoria'];
      const tope = Number(process.env.IMPORT_MAX_ROWS ?? 5_000);
      for (let i = 0; i <= tope; i += 1) {
        lineas.push(`REF-${i},Producto ${i},1000,1,Varios`);
      }

      const res = await post().attach(
        'file',
        Buffer.from(lineas.join('\n') + '\n'),
        'catalogo.csv',
      );

      expect(res.status).toBe(422);
      expect(res.body.type).toBe('dsm:import/row-limit-exceeded');
      expect(res.body.detail).toContain(String(tope));
      expect(await conteos()).toEqual(antes);
    });

    it('un archivo más grande que el cap → 413 dsm:import/file-too-large', async () => {
      const antes = await conteos();
      const cap = Number(process.env.IMPORT_MAX_FILE_BYTES ?? 4_194_304);
      // Una sola celda gigante: pesa más que el cap sin ser un archivo raro.
      const gordo = Buffer.concat([
        Buffer.from('sku,nombre,precio,stock,categoria\nREF-1,'),
        Buffer.alloc(cap + 1, 0x41),
        Buffer.from(',1000,1,Varios\n'),
      ]);

      const res = await post().attach('file', gordo, 'catalogo.csv');

      expect(res.status).toBe(413);
      expect(res.body.type).toBe('dsm:import/file-too-large');
      expect(res.body.title).toBe('Payload Too Large');
      expect(await conteos()).toEqual(antes);
    });

    it('sin parte `file` → 422 y no crea nada', async () => {
      const antes = await conteos();
      const res = await post().field('otro', 'x');

      expect(res.status).toBe(422);
      expect(await conteos()).toEqual(antes);
    });
  });

  describe('alta del trabajo (AC-7)', () => {
    it('un CSV válido → 202 con Location y el trabajo creado', async () => {
      const res = await post().attach('file', Buffer.from(CSV_OK), 'catalogo.csv');

      expect(res.status).toBe(202);
      expect(res.body.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(res.headers['location']).toBe(`/v1/admin/imports/${res.body.id}`);
      expect(['pending', 'running', 'completed']).toContain(res.body.status);
      expect(await prisma.importJob.count()).toBe(1);
      await esperarCierre(res.body.id);
    });

    it('un xlsx válido también → 202, con source_format xlsx', async () => {
      const wb = new ExcelJS.Workbook();
      const hoja = wb.addWorksheet('catalogo');
      hoja.addRow(['sku', 'nombre', 'precio', 'stock', 'categoria']);
      hoja.addRow(['XL-1', 'Heladera', '1000,50', 2, 'Refrigeración']);
      const buffer = Buffer.from(await wb.xlsx.writeBuffer());

      const res = await post().attach('file', buffer, 'catalogo.xlsx');

      expect(res.status).toBe(202);
      const job = (await prisma.importJob.findUnique({
        where: { id: res.body.id },
      }))!;
      expect(job.source_format).toBe('xlsx');
      await esperarCierre(res.body.id);
    });

    it('el filename es sólo metadata: no decide el formato ni llega a ser una ruta', async () => {
      const res = await post().attach(
        'file',
        Buffer.from(CSV_OK),
        '../../etc/passwd',
      );

      expect(res.status).toBe(202);
      const job = (await prisma.importJob.findUnique({
        where: { id: res.body.id },
      }))!;
      // El transporte ya entrega el nombre base (`passwd`), y aunque llegara con
      // separadores no sería una ruta: el storage es memoria, no hay archivo
      // temporal y el formato lo decidió el CONTENIDO (el nombre dice `.csv`
      // pero podría decir cualquier cosa).
      expect(job.filename).not.toContain('/');
      expect(job.filename).not.toContain('..');
      expect(job.filename).toBe('passwd');
      expect(job.source_format).toBe('csv');
      expect(job.file_size_bytes).toBe(Buffer.from(CSV_OK).length);
      await esperarCierre(res.body.id);
    });

    it('registra el subject del admin que importó (pseudónimo, no PII)', async () => {
      const res = await post().attach('file', Buffer.from(CSV_OK), 'catalogo.csv');
      const job = (await prisma.importJob.findUnique({
        where: { id: res.body.id },
      }))!;
      expect(job.created_by_subject).toBe('admin');
      await esperarCierre(res.body.id);
    });
  });

  describe('un solo import a la vez (409)', () => {
    it('el segundo POST mientras hay uno vigente → 409 dsm:import/already-running', async () => {
      // Un trabajo `pending` a mano: no depende de ganarle la carrera al runner.
      await prisma.importJob.create({
        data: {
          filename: 'previo.csv',
          file_size_bytes: 10,
          source_format: 'csv',
          status: 'running',
        },
      });

      const res = await post().attach('file', Buffer.from(CSV_OK), 'catalogo.csv');

      expect(res.status).toBe(409);
      expect(res.body.type).toBe('dsm:import/already-running');
      expect(await prisma.importJob.count()).toBe(1);
    });
  });

  describe('Idempotency-Key (api-standards §10)', () => {
    it('el mismo POST repetido devuelve 200 con el MISMO id y no crea otro trabajo', async () => {
      const primera = await post()
        .set('Idempotency-Key', 'k-abc')
        .attach('file', Buffer.from(CSV_OK), 'catalogo.csv');
      expect(primera.status).toBe(202);

      const repetida = await post()
        .set('Idempotency-Key', 'k-abc')
        .attach('file', Buffer.from(CSV_OK), 'catalogo.csv');

      expect(repetida.status).toBe(200);
      expect(repetida.body.id).toBe(primera.body.id);
      expect(await prisma.importJob.count()).toBe(1);
      await esperarCierre(primera.body.id);
    });

    it('la réplica gana al 409: un reintento no se convierte en conflicto', async () => {
      // El caso real: el panel reintenta porque no le llegó la respuesta, y el
      // trabajo original todavía está corriendo. Si contestáramos 409, el dueño
      // vería un error por un import que sí arrancó.
      const primera = await post()
        .set('Idempotency-Key', 'k-retry')
        .attach('file', Buffer.from(CSV_OK), 'catalogo.csv');

      await prisma.importJob.update({
        where: { id: primera.body.id },
        data: { status: 'running', heartbeat_at: new Date() },
      });

      const repetida = await post()
        .set('Idempotency-Key', 'k-retry')
        .attach('file', Buffer.from(CSV_OK), 'catalogo.csv');

      expect(repetida.status).toBe(200);
      expect(repetida.body.id).toBe(primera.body.id);
      expect(await prisma.importJob.count()).toBe(1);
    });
  });
});
