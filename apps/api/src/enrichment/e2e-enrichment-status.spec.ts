import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { adminToken, bootTestApp, customerToken } from '../../test/e2e-app';
import { asegurarCategoria, idDeCorrida } from '../../test/enrichment-fixtures';
import { PrismaService } from '../prisma/prisma.service';
import { EnrichmentModule } from './enrichment.module';

/**
 * T4.1 — `GET /v1/admin/enrichment/status` (AC-3).
 *
 * Este endpoint es la respuesta a «¿la búsqueda semántica va a funcionar?» **antes** de que
 * un cliente la pruebe. Sin él, un catálogo con 3 de 800 productos embeddeados se ve idéntico
 * a uno completo hasta que alguien busca y no encuentra nada.
 *
 * Y como es una superficie admin que reporta el estado del proveedor, la mitad del valor de
 * esta suite está en el último test: que el cuerpo **no filtre la clave**.
 */
describe('GET /v1/admin/enrichment/status (e2e-enrichment-status)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const corrida = idDeCorrida();
  const ruta = '/v1/admin/enrichment/status';

  beforeAll(async () => {
    app = await bootTestApp([EnrichmentModule]);
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app?.close();
  });

  it('200 con las 6 métricas de cobertura y un runner_state válido', async () => {
    const res = await request(app.getHttpServer())
      .get(ruta)
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.coverage).toEqual({
      total: expect.any(Number),
      enriched: expect.any(Number),
      embedded: expect.any(Number),
      pending: expect.any(Number),
      abandoned: expect.any(Number),
      coverage_ratio: expect.any(Number),
    });
    expect(['idle', 'running', 'cooldown', 'disabled']).toContain(res.body.runner_state);
    expect(res.body.models).toEqual({
      enrich: expect.any(String),
      embed: expect.any(String),
    });
    expect(res.body).toHaveProperty('last_error_code');
    expect(res.body).toHaveProperty('last_run_at');
  });

  it('la cobertura refleja el catálogo: sembrar pendientes MUEVE los números', async () => {
    // Por delta, no por total: la base es compartida con otras suites y un assert sobre el
    // total absoluto sería verde o rojo según quién más esté corriendo.
    const antes = (
      await request(app.getHttpServer())
        .get(ruta)
        .set('Authorization', `Bearer ${adminToken()}`)
    ).body.coverage;

    const categoryId = await asegurarCategoria(
      prisma,
      `st-${corrida}`,
      `Status ${corrida}`,
    );
    for (let i = 0; i < 3; i += 1) {
      const clave = `STATUS-${corrida}-${i}`;
      await prisma.product.create({
        data: {
          sku: clave,
          slug: clave.toLowerCase(),
          name: `Producto ${clave}`,
          price_ars_cents: 100_000,
          stock: 1,
          status: 'published',
          category_id: categoryId,
          description_raw: 'pobre',
        },
      });
    }

    const despues = (
      await request(app.getHttpServer())
        .get(ruta)
        .set('Authorization', `Bearer ${adminToken()}`)
    ).body.coverage;

    expect(despues.total).toBe(antes.total + 3);
    expect(despues.pending).toBe(antes.pending + 3);
    // Los tres nuevos no tienen vector: la cobertura no puede haber subido.
    expect(despues.embedded).toBe(antes.embedded);
    expect(despues.coverage_ratio).toBeLessThanOrEqual(antes.coverage_ratio);
  });

  it('sin token ⇒ 401', async () => {
    const res = await request(app.getHttpServer()).get(ruta);
    expect(res.status).toBe(401);
  });

  it('con token de cliente ⇒ 403 (no alcanza estar logueado)', async () => {
    const res = await request(app.getHttpServer())
      .get(ruta)
      .set('Authorization', `Bearer ${customerToken()}`);
    expect(res.status).toBe(403);
  });

  it('lleva Cache-Control: no-store — el estado de un runner no se cachea', async () => {
    const res = await request(app.getHttpServer())
      .get(ruta)
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.headers['cache-control']).toContain('no-store');
  });

  it('NO FILTRA LA CLAVE del proveedor ni ningún dato de comprador', async () => {
    // El test que justifica la suite. El endpoint reporta el estado del proveedor de IA:
    // es exactamente el lugar donde una clave se escaparía «para facilitar el diagnóstico».
    const claveFalsa = 'CLAVE-DE-PRUEBA-QUE-NO-DEBE-APARECER-EN-NINGUN-BODY';
    const previo = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = claveFalsa;
    try {
      const res = await request(app.getHttpServer())
        .get(ruta)
        .set('Authorization', `Bearer ${adminToken()}`);

      const serializado = JSON.stringify(res.body);
      expect(serializado).not.toContain(claveFalsa);
      // También se descarta la FORMA de una clave real de Google, no sólo el valor exacto
      // del canario: si alguien filtrara otra clave, el patrón la caza igual.
      expect(serializado).not.toMatch(/AIza[0-9A-Za-z_-]{10,}/);
      // Ni la URL del proveedor: con la URL y el modelo, un log se vuelve una guía de cómo
      // llamar a la API en nombre del negocio.
      expect(serializado).not.toContain('generativelanguage');
      // Ni PII: este endpoint habla de productos, no de personas.
      expect(serializado).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i);
    } finally {
      if (previo === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = previo;
    }
  });
});
