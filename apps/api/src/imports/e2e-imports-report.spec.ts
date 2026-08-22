import { INestApplication } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import request from 'supertest';
import { adminToken, bootTestApp, customerToken } from '../../test/e2e-app';
import { PrismaService } from '../prisma/prisma.service';
import { ImportsModule } from './imports.module';
import { celdaCsv } from './report-csv';

/**
 * T5.4 — e2e del reporte descargable.
 *
 * El caso que justifica el archivo entero: un `sku` que empieza con `=` en el
 * archivo del proveedor. Si lo escribiéramos tal cual, Excel lo ejecutaría al
 * abrir el reporte **en la máquina del dueño**. La fila era inválida; el peligro
 * lo agregaríamos nosotros.
 */
describe('GET /v1/admin/imports/{id}/report (e2e-imports-report)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const post = (buffer: Buffer) =>
    request(app.getHttpServer())
      .post('/v1/admin/imports')
      .set('Authorization', `Bearer ${adminToken()}`)
      .attach('file', buffer, 'catalogo.csv');

  const getReport = (id: string) =>
    request(app.getHttpServer())
      .get(`/v1/admin/imports/${id}/report`)
      .set('Authorization', `Bearer ${adminToken()}`);

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

  it('neutraliza la inyección de fórmulas: el sku =1+1 se escribe con comilla', async () => {
    // Precio 0 ⇒ la fila se rechaza y su sku entra al reporte.
    const alta = await post(csv(['=1+1,Producto raro,0,3,Ferretería']));
    await esperarCierre(alta.body.id);

    const res = await getReport(alta.body.id);

    expect(res.status).toBe(200);
    expect(res.text).toContain("'=1+1");
    // Ninguna línea arranca con `=`: eso es lo que evalúa la planilla.
    const arrancaConFormula = res.text
      .split('\n')
      .some((linea) => /^[=+@]/.test(linea));
    expect(arrancaConFormula).toBe(false);
  });

  it('los headers son exactos y el nombre lo genera el servidor', async () => {
    const alta = await post(csv(['MAL-1,Producto,0,3,Ferretería']));
    await esperarCierre(alta.body.id);

    const res = await getReport(alta.body.id);

    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="import-${alta.body.id}-errores.csv"`,
    );
  });

  it('el CSV se puede volver a parsear y trae tantas filas como failed_count', async () => {
    const alta = await post(
      csv([
        'OK-1,Bueno,1000,1,Ferretería',
        'MAL-1,Malo uno,0,1,Ferretería',
        'MAL-2,Malo dos,1000,-2,Ferretería',
        ',Sin sku,1000,1,Ferretería',
      ]),
    );
    await esperarCierre(alta.body.id);

    const res = await getReport(alta.body.id);
    const filas = parse(res.text, { columns: true, skip_empty_lines: true }) as
      Record<string, string>[];

    const job = (await prisma.importJob.findUnique({
      where: { id: alta.body.id },
    }))!;
    expect(job.failed_count).toBe(3);
    expect(filas).toHaveLength(3);
    expect(Object.keys(filas[0])).toEqual([
      'fila',
      'sku',
      'campo',
      'codigo',
      'motivo',
    ]);
    expect(filas.map((f) => f.codigo)).toEqual([
      'invalid_price',
      'invalid_stock',
      'missing_required',
    ]);
    expect(filas.map((f) => f.fila)).toEqual(['2', '3', '4']);
  });

  it('un trabajo sin filas rechazadas devuelve SÓLO el encabezado (no 404)', async () => {
    const alta = await post(csv(['OK-1,Bueno,1000,1,Ferretería']));
    await esperarCierre(alta.body.id);

    const res = await getReport(alta.body.id);

    expect(res.status).toBe(200);
    // "No hay errores" es el mejor resultado posible: no puede llegarle al panel
    // como un caso de error.
    expect(res.text.trim().split('\n')).toEqual(['fila,sku,campo,codigo,motivo']);
  });

  it('cuando el reporte está recortado, el propio archivo lo declara', async () => {
    const alta = await post(csv(['MAL-1,Malo,0,1,Ferretería']));
    await esperarCierre(alta.body.id);
    // Se fuerza la marca: el tope real (1.000) haría un test de 1.001 filas.
    await prisma.importJob.update({
      where: { id: alta.body.id },
      data: { report_truncated: true, failed_count: 5_000 },
    });

    const res = await getReport(alta.body.id);
    const ultima = res.text.trim().split('\n').pop()!;

    expect(ultima).toMatch(/^# reporte recortado/);
    expect(ultima).toContain('5000');
  });

  it('un id inexistente → 404 y uno mal formado → 422', async () => {
    expect(
      (await getReport('00000000-0000-4000-8000-000000000000')).status,
    ).toBe(404);
    expect((await getReport('abc')).status).toBe(422);
  });

  it('sin token → 401; con token de cliente → 403 (AC-8)', async () => {
    const alta = await post(csv(['MAL-1,Malo,0,1,Ferretería']));
    await esperarCierre(alta.body.id);
    const path = `/v1/admin/imports/${alta.body.id}/report`;

    expect((await request(app.getHttpServer()).get(path)).status).toBe(401);
    expect(
      (
        await request(app.getHttpServer())
          .get(path)
          .set('Authorization', `Bearer ${customerToken()}`)
      ).status,
    ).toBe(403);
  });
});

describe('celdaCsv (neutralización + RFC 4180)', () => {
  it.each([
    ['=1+1', "'=1+1"],
    ['+1', "'+1"],
    ['-1', "'-1"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ["=cmd|'/c calc'!A1", "'=cmd|'/c calc'!A1"],
    ['\tvalor', "'\tvalor"],
  ])('neutraliza %s', (entrada, esperado) => {
    expect(celdaCsv(entrada)).toBe(esperado);
  });

  it.each([
    ['con,coma', '"con,coma"'],
    ['con"comilla', '"con""comilla"'],
    ['con\nsalto', '"con\nsalto"'],
    ['normal', 'normal'],
    ['', ''],
  ])('escapa %s según RFC 4180', (entrada, esperado) => {
    expect(celdaCsv(entrada)).toBe(esperado);
  });

  it('null y undefined son celda vacía, no la cadena "null"', () => {
    expect(celdaCsv(null)).toBe('');
    expect(celdaCsv(undefined)).toBe('');
  });

  it('un texto que sólo contiene un guión adentro no se toca', () => {
    // La neutralización mira el PRIMER caracter: `REF-1` no es una fórmula.
    expect(celdaCsv('REF-1')).toBe('REF-1');
  });
});
