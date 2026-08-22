import { INestApplication } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import request from 'supertest';
import {
  adminToken,
  bootTestApp,
  nuevaIpDeTest,
} from '../../test/e2e-app';
import { PrismaService } from '../prisma/prisma.service';
import { ImportsModule } from './imports.module';

/**
 * T7.3 — aceptación de los dos niveles de rechazo (AC-5, AC-6) y de los límites
 * (AC-11), más el contrato asíncrono (AC-7).
 *
 * Los dos niveles son deliberadamente distintos y este spec los contrasta en el
 * mismo archivo: **por fila**, lo bueno entra y lo malo se reporta; **por
 * archivo**, no entra nada y no se crea ni el trabajo.
 */
describe('Import — errores parciales y rechazo total (e2e-imports-rejection, AC-5/6/7/11)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ip: string;

  const post = (buffer: Buffer) =>
    request(app.getHttpServer())
      .post('/v1/admin/imports')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Forwarded-For', ip)
      .attach('file', buffer, 'catalogo.csv');

  const get = (path: string) =>
    request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Forwarded-For', ip);

  const csv = (lineas: string[], encabezado = 'sku,nombre,precio,stock,categoria') =>
    Buffer.from([encabezado, ...lineas].join('\n') + '\n', 'utf8');

  const esperarCierre = async (id: string): Promise<void> => {
    for (let i = 0; i < 500; i += 1) {
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
    process.env.TRUST_PROXY_HOPS = '1';
    app = await bootTestApp([ImportsModule]);
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

  it('AC-5: 5 válidas entran, 3 inválidas se reportan con fila, código y motivo', async () => {
    const alta = await post(
      csv([
        'OK-1,Bueno uno,1000,5,Ferretería',
        'MAL-PRECIO,Precio cero,0,5,Ferretería',
        'OK-2,Bueno dos,2000,0,Ferretería',
        ',Sin sku,3000,5,Ferretería',
        'OK-3,Bueno tres,3000,1,Ferretería',
        'MAL-STOCK,Stock negativo,4000,-1,Ferretería',
        'OK-4,Bueno cuatro,4000,2,Ferretería',
        'OK-5,Bueno cinco,5000,3,Ferretería',
      ]),
    );
    expect(alta.status).toBe(202);
    await esperarCierre(alta.body.id);

    const { body } = await get(`/v1/admin/imports/${alta.body.id}`);

    expect(body.status).toBe('completed');
    expect(body.created_count).toBe(5);
    expect(body.failed_count).toBe(3);
    expect(body.total_rows).toBe(8);

    // Las 5 buenas están; ninguna de las 3 malas quedó escrita ni a medias.
    const skus = (
      await prisma.product.findMany({ select: { sku: true }, orderBy: { sku: 'asc' } })
    ).map((p) => p.sku);
    expect(skus).toEqual(['OK-1', 'OK-2', 'OK-3', 'OK-4', 'OK-5']);

    // El reporte identifica las 3 por número de fila del ARCHIVO.
    expect(
      body.errors.map((e: { row_number: number; error_code: string }) => [
        e.row_number,
        e.error_code,
      ]),
    ).toEqual([
      [2, 'invalid_price'],
      [4, 'missing_required'],
      [6, 'invalid_stock'],
    ]);
    expect(
      body.errors.every((e: { error_message: string }) => e.error_message.length > 0),
    ).toBe(true);

    // Y el CSV descargable dice lo mismo.
    const reporte = await get(`/v1/admin/imports/${alta.body.id}/report`);
    const filas = parse(reporte.text, {
      columns: true,
      skip_empty_lines: true,
    }) as Record<string, string>[];
    expect(filas.map((f) => f.fila)).toEqual(['2', '4', '6']);
  });

  it('AC-6: sin la columna precio no entra NADA y no se crea el trabajo', async () => {
    const antesProductos = await prisma.product.count();
    const antesTrabajos = await prisma.importJob.count();

    const res = await post(
      csv(
        ['REF-1,Heladera,5,Refrigeración'],
        'sku,nombre,stock,categoria',
      ),
    );

    expect(res.status).toBe(422);
    expect(res.body.type).toBe('dsm:import/missing-columns');
    expect(await prisma.product.count()).toBe(antesProductos);
    // Ni el trabajo: el panel no tiene que explicarle un import que nunca existió.
    expect(await prisma.importJob.count()).toBe(antesTrabajos);
  });

  it('AC-6: un archivo con catálogo previo no lo toca al ser rechazado', async () => {
    const previo = await post(csv(['REF-1,Heladera,100000,5,Refrigeración']));
    await esperarCierre(previo.body.id);
    const antes = await prisma.product.findMany({
      select: { sku: true, price_ars_cents: true, status: true },
    });

    const res = await post(
      csv(['REF-1,Heladera,5,Refrigeración'], 'sku,nombre,stock,categoria'),
    );

    expect(res.status).toBe(422);
    expect(
      await prisma.product.findMany({
        select: { sku: true, price_ars_cents: true, status: true },
      }),
    ).toEqual(antes);
  });

  it('AC-11: más filas que el tope → 422 y sin trabajo creado', async () => {
    const tope = Number(process.env.IMPORT_MAX_ROWS ?? 5_000);
    const lineas = Array.from(
      { length: tope + 1 },
      (_, i) => `REF-${i},Producto ${i},1000,1,Ferretería`,
    );

    const res = await post(csv(lineas));

    expect(res.status).toBe(422);
    expect(res.body.type).toBe('dsm:import/row-limit-exceeded');
    expect(res.body.detail).toContain(String(tope));
    expect(await prisma.importJob.count()).toBe(0);
    expect(await prisma.product.count()).toBe(0);
  });

  it('AC-7: con 800 filas el POST responde rápido y el progreso avanza en GETs sucesivos', async () => {
    const lineas = Array.from(
      { length: 800 },
      (_, i) => `REF-${i},Producto ${i},1000,1,Ferretería`,
    );

    const t0 = Date.now();
    const alta = await post(csv(lineas));
    const tardo = Date.now() - t0;

    expect(alta.status).toBe(202);
    // El request no espera el trabajo: si lo esperara, 5.000 filas serían un
    // timeout y el dueño no vería progreso, vería un error.
    expect(tardo).toBeLessThan(2_000);

    const muestras: number[] = [];
    for (let i = 0; i < 80; i += 1) {
      const { body } = await get(`/v1/admin/imports/${alta.body.id}`);
      muestras.push(body.processed_rows);
      if (body.status === 'completed' || body.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 25));
    }

    expect(muestras.some((m) => m > 0 && m < 800)).toBe(true);
    expect(muestras[muestras.length - 1]).toBe(800);
    expect(await prisma.product.count()).toBe(800);
  });
});
