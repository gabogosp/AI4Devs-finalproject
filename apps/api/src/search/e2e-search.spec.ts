import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CatalogEventsModule } from '../observability/catalog-events.module';
import { configureApp } from '../bootstrap';
import { asegurarCategoria, idDeCorrida } from '../../test/enrichment-fixtures';
import { FakeAiProvider } from '../../test/fake-ai.provider';
import { EnrichmentRepository } from '../enrichment/enrichment.repository';
import { PrismaService } from '../prisma/prisma.service';
import { SEARCH_EMBEDDER } from './search-embedder.provider';
import { SearchModule } from './search.module';

/**
 * T3.2 — `GET /v1/search` de punta a punta (e2e-search).
 *
 * Con el fake determinista: el vector de una consulta es el hash de su texto, así que sembrando
 * un producto con el vector de «amoladora angular» se puede afirmar que **ese** producto sale
 * primero. Es lo que permite probar el ranking sin depender de la calidad de Gemini.
 */
describe('GET /v1/search (e2e-search)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const fake = new FakeAiProvider();
  const corrida = idDeCorrida();
  const CONSULTA = `amoladora angular ${corrida}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, PrismaModule, CatalogEventsModule, SearchModule],
    })
      .overrideProvider(SEARCH_EMBEDDER)
      .useValue(fake)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = app.get(PrismaService);
    const enrichment = new EnrichmentRepository(
      prisma,
      app.get(ConfigService) as unknown as ConfigService,
    );

    // Aislamiento real, no por prefijo: la búsqueda rankea sobre TODA la tabla con limit=50,
    // así que borrar sólo `e2es-%` no alcanza — los cientos de productos que siembran otros
    // specs (imports carga 800/900) empujan al producto sin-stock fuera del top-50 y AC-7 lo
    // pierde ("Received: undefined", sólo en CI con la base sucia). Mismo caso que el claim de
    // enrichment.repository: un query sobre toda la tabla no se aísla por prefijo, se trunca.
    // La base de tests va aislada por schema por sesión y en CI es dedicada, así que truncar
    // acá no pisa a nadie.
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE products RESTART IDENTITY CASCADE',
    );
    const categoryId = await asegurarCategoria(
      prisma,
      `e2es-${corrida}`,
      `Herramientas ${corrida}`,
    );

    const crear = async (
      clave: string,
      opts: { stock: number; status?: string; textoDelVector?: string },
    ) => {
      const p = await prisma.product.create({
        data: {
          sku: `E2ES-${corrida}-${clave}`,
          slug: `e2es-${corrida}-${clave}`,
          name: `Producto ${clave}`,
          price_ars_cents: 177_000,
          stock: opts.stock,
          status: opts.status ?? 'published',
          category_id: categoryId,
        },
      });
      if (opts.textoDelVector) {
        await enrichment.saveEmbedding(
          p.id,
          FakeAiProvider.vectorDe(opts.textoDelVector),
          fake.modelVersion,
        );
      }
      return p;
    };

    // El vector de la consulta ⇒ este sale primero.
    await crear('exacto', { stock: 5, textoDelVector: CONSULTA });
    // Publicado, con vector de otro texto y SIN stock: tiene que aparecer marcado (AC-7).
    await crear('sinstock', { stock: 0, textoDelVector: 'otra cosa distinta' });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  const buscar = (q: string, extra = '') =>
    request(app.getHttpServer()).get(
      `/v1/search?q=${encodeURIComponent(q)}${extra}`,
    );

  it('200 con resultados ordenados por score descendente', async () => {
    const res = await buscar(CONSULTA);

    expect(res.status).toBe(200);
    const scores = (res.body.results as Array<{ score: number }>).map((r) => r.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(res.body.results[0].slug).toBe(`e2es-${corrida}-exacto`);
    // El vector es idéntico al de la consulta: la confianza tiene que ser alta.
    expect(res.body.confidence).toBe('high');
    expect(res.body.degraded).toBe(false);
    expect(res.body.fallback).toBeNull();
  });

  it('AC-7: un producto publicado SIN stock aparece con in_stock false, no se oculta', async () => {
    // Esconderlo haría que el cliente crea que no lo vendemos. Que exista y esté agotado es
    // información útil —puede preguntar por WhatsApp— y ocultarlo pierde esa venta.
    const res = await buscar(CONSULTA, '&limit=50');

    const sinStock = (res.body.results as Array<{ slug: string; in_stock: boolean }>).find(
      (r) => r.slug === `e2es-${corrida}-sinstock`,
    );
    expect(sinStock).toBeDefined();
    expect(sinStock!.in_stock).toBe(false);

    const conStock = (res.body.results as Array<{ slug: string; in_stock: boolean }>).find(
      (r) => r.slug === `e2es-${corrida}-exacto`,
    );
    expect(conStock!.in_stock).toBe(true);
  });

  it('lleva caché ACOTADA y no `no-store`', async () => {
    // Es contenido público derivado del catálogo, no personalizado: dos clientes que buscan lo
    // mismo merecen la misma respuesta. Con `no-store`, cada tecleo llegaría al origen y —peor—
    // a la cuota del proveedor.
    const res = await buscar(CONSULTA);

    expect(res.headers['cache-control']).toContain('max-age=60');
    expect(res.headers['cache-control']).toContain('stale-while-revalidate=30');
    expect(res.headers['cache-control']).not.toContain('no-store');
  });

  it('la interpretación dice dónde miró, sin repetir el texto del cliente', async () => {
    const res = await buscar(CONSULTA);

    // Se afirma la PROPIEDAD y no el string exacto: la base es compartida con las otras
    // suites, así que el top-N puede traer categorías ajenas. Lo que importa es que la
    // interpretación arranque por la categoría del mejor match.
    expect(res.body.interpreted_as).toMatch(
      new RegExp(`^Buscamos en: Herramientas ${corrida}`),
    );
    // AC-8 estructural: la interpretación se arma con datos del catálogo, así que el texto del
    // cliente no vuelve en el cuerpo — y nunca llegó a un modelo generativo.
    expect(res.body.interpreted_as).not.toContain('amoladora');
  });

  it('el `limit` acota la cantidad devuelta', async () => {
    const res = await buscar(CONSULTA, '&limit=1');

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
  });

  it('una consulta sin coincidencias ofrece una salida en vez de un vacío desnudo (AC-3)', async () => {
    // El fake genera un vector determinista por texto, así que una consulta absurda produce un
    // vector lejano de todo: scores bajos ⇒ `low` o `none`, y en los dos casos hay fallback.
    const res = await buscar(`zzz-nada-que-ver-${corrida}`);

    expect(res.status).toBe(200);
    expect(res.body.confidence).not.toBe('high');
    expect(res.body.fallback).not.toBeNull();
    expect(res.body.fallback.suggested_categories.length).toBeGreaterThan(0);
  });
});
