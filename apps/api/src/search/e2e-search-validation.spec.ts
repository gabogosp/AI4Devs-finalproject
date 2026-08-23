import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CatalogEventsModule } from '../observability/catalog-events.module';
import { configureApp } from '../bootstrap';
import { FakeAiProvider } from '../../test/fake-ai.provider';
import { SEARCH_EMBEDDER } from './search-embedder.provider';
import { SearchModule } from './search.module';

/**
 * T3.1 — validación del borde de `/v1/search` (e2e-search-validation).
 *
 * Todo lo que se rechaza acá se rechaza **antes** de gastar: el `ValidationPipe` corre antes del
 * handler, y el handler es el único que llama al proveedor. Por eso estos tests son de costo
 * tanto como de contrato.
 */
describe('GET /v1/search — validación (e2e-search-validation)', () => {
  let app: INestApplication;
  let fake: FakeAiProvider;

  beforeAll(async () => {
    fake = new FakeAiProvider();
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, PrismaModule, CatalogEventsModule, SearchModule],
    })
      .overrideProvider(SEARCH_EMBEDDER)
      .useValue(fake)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => {
    fake.embedCalls.length = 0;
  });

  const buscar = (qs: string) => request(app.getHttpServer()).get(`/v1/search${qs}`);

  it('sin `q` ⇒ 422', async () => {
    const res = await buscar('');
    expect(res.status).toBe(422);
    expect(fake.embedCalls).toHaveLength(0);
  });

  it('`q` vacío ⇒ 422 y no se llama al proveedor', async () => {
    const res = await buscar('?q=');
    expect(res.status).toBe(422);
    expect(fake.embedCalls).toHaveLength(0);
  });

  it('`q` de un carácter ⇒ 422 dsm:search/query-too-short con el mínimo en el cuerpo', async () => {
    const res = await buscar('?q=a');

    expect(res.status).toBe(422);
    expect(res.body.type).toBe('dsm:search/query-too-short');
    // El mínimo viaja como extension member de RFC 7807: el cliente no tiene que parsear la
    // frase para saber cuántos caracteres le faltan.
    expect(res.body.min_length).toBe(2);
    expect(fake.embedCalls).toHaveLength(0);
  });

  it('`q` de 300 caracteres ⇒ 422 dsm:search/query-too-long SIN llamar al proveedor', async () => {
    // El texto viaja al proveedor y se cobra por tamaño: un cuerpo enorme en el buscador es un
    // ataque de costo con forma de consulta.
    const res = await buscar(`?q=${'x'.repeat(300)}`);

    expect(res.status).toBe(422);
    expect(res.body.type).toBe('dsm:search/query-too-long');
    expect(res.body.max_length).toBe(200);
    expect(fake.embedCalls).toHaveLength(0);
  });

  it('`limit` fuera de rango ⇒ 422', async () => {
    expect((await buscar('?q=taco fischer&limit=999')).status).toBe(422);
    expect((await buscar('?q=taco fischer&limit=0')).status).toBe(422);
    expect((await buscar('?q=taco fischer&limit=abc')).status).toBe(422);
  });

  it('un query param desconocido ⇒ 422 por whitelist', async () => {
    // `?limite=100` (en español) es un typo plausible. Sin whitelist se aceptaría como «sin
    // límite» y devolvería el default, y nadie se enteraría de que el parámetro no existe.
    const res = await buscar('?q=taco fischer&limite=100');

    expect(res.status).toBe(422);
  });

  it('el 200 NO contiene ningún UUID ni el vector', async () => {
    // La identidad pública es el `slug` (US-002/US-003). Y el embedding es el resultado de un
    // trabajo pago: exponerlo permitiría reconstruir el catálogo vectorial sin buscar.
    const res = await buscar('?q=taco fischer');

    expect(res.status).toBe(200);
    const cuerpo = JSON.stringify(res.body);
    expect(cuerpo).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(cuerpo).not.toContain('embedding');
    expect(cuerpo).not.toContain('vector');
  });

  it('el 200 declara la forma completa del contrato', async () => {
    const res = await buscar('?q=amoladora angular');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      results: expect.any(Array),
      confidence: expect.stringMatching(/^(high|low|none)$/),
      interpreted_as: res.body.interpreted_as,
      degraded: expect.any(Boolean),
      fallback: res.body.fallback,
    });
    // `stock` exacto NO viaja: es información del negocio (le dice a un competidor cuánto rota
    // cada producto). El cliente sólo necesita saber si puede comprar.
    for (const r of res.body.results as Array<Record<string, unknown>>) {
      expect(r).toHaveProperty('in_stock');
      expect(r).not.toHaveProperty('stock');
      expect(r).not.toHaveProperty('id');
    }
  });
});
