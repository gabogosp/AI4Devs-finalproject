import { INestApplication, Logger } from '@nestjs/common';
import request from 'supertest';
import { adminToken, bootTestApp, nuevaIpDeTest } from '../../test/e2e-app';
import { CatalogEventsService } from '../observability/catalog-events.service';
import { PrismaService } from '../prisma/prisma.service';
import { ImportsModule } from './imports.module';

/**
 * T6.1 — observabilidad del import.
 *
 * Dos propiedades, y las dos se rompen sin que nadie se entere:
 *
 * 1. **Cardinalidad**: un evento por trabajo, no por fila. Un import al tope
 *    emitiendo por fila serían 5.000 líneas y una métrica inservible.
 * 2. **Sin contenido del archivo**: los logs no pueden volverse una copia parcial
 *    del catálogo del cliente. El test busca literalmente el nombre del producto
 *    en TODO lo que se logueó.
 */
describe('Eventos del import (e2e-imports-observability, E2E §18)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  /**
   * IP propia por test: el `POST` tiene presupuesto de 3/hora por IP (T5.5), así
   * que sin esto el cuarto request de la suite recibiría 429 en lugar del código
   * que el test está verificando. El límite no está mal puesto — son los tests
   * los que tienen que hablar desde IPs distintas.
   */
  let ip: string;
  let events: CatalogEventsService;
  let logueado: string[];
  let spies: jest.SpyInstance[];

  const NOMBRE_RECONOCIBLE = 'HeladeraQuintupleXYZ';
  const SKU_RECONOCIBLE = 'SKU-ZZZ-9876';

  const csv = (filas: number) => {
    const lineas = ['sku,nombre,precio,stock,categoria,descripcion'];
    for (let i = 1; i <= filas; i += 1) {
      lineas.push(
        `${SKU_RECONOCIBLE}-${i},${NOMBRE_RECONOCIBLE} ${i},1000,3,Refrigeración,descripcion de prueba`,
      );
    }
    return Buffer.from(lineas.join('\n') + '\n', 'utf8');
  };

  const post = (buffer: Buffer) =>
    request(app.getHttpServer())
      .post('/v1/admin/imports')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Forwarded-For', ip)
      .attach('file', buffer, 'catalogo.csv');

  const esperarCierre = async (id: string): Promise<void> => {
    for (let i = 0; i < 400; i += 1) {
      const job = await prisma.importJob.findUnique({ where: { id } });
      if (!job || job.status === 'completed' || job.status === 'failed') return;
      await new Promise((r) => setTimeout(r, 20));
    }
  };

  beforeAll(async () => {
    process.env.TRUST_PROXY_HOPS = '1';
    app = await bootTestApp([ImportsModule]);
    prisma = app.get(PrismaService);
    events = app.get(CatalogEventsService);
  });
  afterAll(async () => {
    await app?.close();
    delete process.env.TRUST_PROXY_HOPS;
  });
  beforeEach(async () => {
    ip = nuevaIpDeTest();
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE import_job_rows, import_jobs, products, categories RESTART IDENTITY CASCADE',
    );
    await new Promise((r) => setTimeout(r, 30));
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE import_job_rows, import_jobs, products, categories RESTART IDENTITY CASCADE',
    );

    // Se capturan los cuatro niveles: un log de debug con el contenido del
    // archivo filtraría igual que uno de info.
    logueado = [];
    const capturar = (...args: unknown[]) => {
      logueado.push(args.map((a) => JSON.stringify(a)).join(' '));
      return undefined;
    };
    spies = (['log', 'warn', 'error', 'debug'] as const).map((nivel) =>
      jest.spyOn(Logger.prototype, nivel).mockImplementation(capturar),
    );
  });
  afterEach(() => {
    spies.forEach((s) => s.mockRestore());
  });

  it('un import de 500 filas emite UN started y UN completed, no 500 eventos', async () => {
    const antesStarted = events.count('import.started');
    const antesCompleted = events.count('import.completed');

    const alta = await post(csv(500));
    await esperarCierre(alta.body.id);

    expect(events.count('import.started') - antesStarted).toBe(1);
    expect(events.count('import.completed') - antesCompleted).toBe(1);

    const lineasDeEvento = logueado.filter((l) => l.includes('"event":"import.'));
    expect(lineasDeEvento).toHaveLength(2);
  });

  it('import.completed lleva los contadores y la duración', async () => {
    const alta = await post(csv(3));
    await esperarCierre(alta.body.id);

    const completado = logueado.find((l) =>
      l.includes('"event":"import.completed"'),
    )!;
    expect(completado).toBeDefined();
    expect(completado).toContain('"created":3');
    expect(completado).toContain('"updated":0');
    expect(completado).toContain('"failed":0');
    expect(completado).toContain('"categories_created":1');
    expect(completado).toMatch(/"duration_ms":\d+/);
  });

  it('import.started lleva el formato, y el id del trabajo va al LOG (no a la métrica)', async () => {
    const alta = await post(csv(2));
    await esperarCierre(alta.body.id);

    const iniciado = logueado.find((l) =>
      l.includes('"event":"import.started"'),
    )!;
    expect(iniciado).toContain('"source_format":"csv"');
    // El id está en el log para poder correlacionar…
    expect(iniciado).toContain(alta.body.id);
    // …y el contador se lleva sólo por nombre de evento: una serie temporal por
    // trabajo sería una explosión de cardinalidad (observability-patterns §3.3).
    expect(events.count('import.started')).toBeGreaterThan(0);
  });

  it('NINGÚN log de la superficie de import contiene contenido de celdas', async () => {
    const alta = await post(csv(200));
    await esperarCierre(alta.body.id);

    const todo = logueado.join('\n');
    // Si esto falla, los logs se volvieron una copia parcial del catálogo del
    // cliente y encima con menos controles de acceso que la base.
    expect(todo).not.toContain(NOMBRE_RECONOCIBLE);
    expect(todo).not.toContain(SKU_RECONOCIBLE);
    expect(todo).not.toContain('descripcion de prueba');
  });

  it('un fallo global emite import.failed con el código y sin el mensaje', async () => {
    const antes = events.count('import.failed');
    // Se agenda el runner con un archivo que el preflight aprueba pero que falla
    // al procesar: se fuerza borrando la tabla de productos por debajo no es
    // posible, así que se usa un job huérfano con un buffer inválido.
    const job = await prisma.importJob.create({
      data: {
        filename: 'roto.csv',
        file_size_bytes: 10,
        source_format: 'csv',
      },
    });
    const runner = app.get(
      (await import('./import-runner')).ImportRunner,
    );
    await runner.run(
      job.id,
      Buffer.from(`sku,nombre,stock,categoria\n${SKU_RECONOCIBLE},X,1,Y\n`),
      'csv',
    );

    expect(events.count('import.failed') - antes).toBe(1);
    const fallo = logueado.find((l) => l.includes('"event":"import.failed"'))!;
    expect(fallo).toContain('"error_code":"missing-columns"');
    // El mensaje del error cita las columnas del archivo: no va al evento.
    expect(fallo).not.toContain('precio');
  });

  it('la firma vieja de emit sigue funcionando (US-001/002/003 no se tocaron)', () => {
    const antes = events.count('product.created');
    events.emit('product.created', 'prod-1');
    events.emit('product.viewed', 'prod-1', null, 'trace-1');
    expect(events.count('product.created') - antes).toBe(1);
    expect(events.count('product.viewed')).toBeGreaterThan(0);
  });
});
