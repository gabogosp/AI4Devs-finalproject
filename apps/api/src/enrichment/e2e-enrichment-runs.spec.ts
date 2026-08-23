import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CatalogEventsModule } from '../observability/catalog-events.module';
import { configureApp } from '../bootstrap';
import { adminToken, nuevaIpDeTest } from '../../test/e2e-app';
import { asegurarCategoria, idDeCorrida } from '../../test/enrichment-fixtures';
import { FakeAiProvider } from '../../test/fake-ai.provider';
import { PrismaService } from '../prisma/prisma.service';
import { EnrichmentModule } from './enrichment.module';
import { EnrichmentRepository } from './enrichment.repository';
import { EnrichmentRunner } from './enrichment.runner';
import { AI_EMBEDDER, AI_ENRICHER } from './ports/ai.ports';

/**
 * T4.2 — `POST /v1/admin/enrichment/runs`.
 *
 * Es la superficie que **gasta plata**: cada corrida son llamadas pagas al proveedor. Las
 * tres propiedades que se prueban acá son las tres formas de gastarla mal: arrancar dos
 * corridas del mismo catálogo (409), aceptar un body que no dice lo que el dueño creyó (422)
 * y dejar que alguien la dispare en loop (429).
 */
describe('POST /v1/admin/enrichment/runs (e2e-enrichment-runs)', () => {
  const ruta = '/v1/admin/enrichment/runs';
  const corrida = idDeCorrida();
  let app: INestApplication;
  let prisma: PrismaService;
  let runner: EnrichmentRunner;
  let repo: EnrichmentRepository;
  let fake: FakeAiProvider;
  let n = 0;

  /**
   * App con el fake de IA sustituido **por el token**: el caso de uso no se toca y el
   * proveedor real no se llama nunca en tests (D6 — no hay clave, y no se inventa una).
   */
  async function bootConFake(
    env: Record<string, string> = {},
  ): Promise<INestApplication> {
    for (const [k, v] of Object.entries(env)) process.env[k] = v;
    fake = new FakeAiProvider();
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, PrismaModule, CatalogEventsModule, EnrichmentModule],
    })
      .overrideProvider(AI_ENRICHER)
      .useValue(fake)
      .overrideProvider(AI_EMBEDDER)
      .useValue(fake)
      .compile();
    const nueva = moduleRef.createNestApplication();
    configureApp(nueva);
    await nueva.init();
    return nueva;
  }

  beforeAll(async () => {
    // Sin esto Express ignora `X-Forwarded-For` y todos los tests comparten el cubo de
    // 127.0.0.1. El default de producción es 0 a propósito: confiar de más deja falsificar
    // la IP y evadir el límite por completo.
    process.env.TRUST_PROXY_HOPS = '1';
    app = await bootConFake();
    prisma = app.get(PrismaService);
    runner = app.get(EnrichmentRunner);
    repo = app.get(EnrichmentRepository);
  });
  afterEach(async () => {
    // Red de seguridad: ninguna corrida disparada acá sobrevive al test que la disparó.
    await esperarCorridaTerminada();
  });
  afterAll(async () => {
    await esperarCorridaTerminada();
    await app?.close();
    delete process.env.TRUST_PROXY_HOPS;
  });
  let ip: string;
  beforeEach(() => {
    fake.embedCalls.length = 0;
    fake.enrichCalls.length = 0;
    runner.resetBreaker();
    // El presupuesto de esta superficie es chico A PROPÓSITO (gasta plata). Los tests hablan
    // desde IPs distintas para verificar códigos y no el rate-limit; el 429 tiene su suite.
    ip = nuevaIpDeTest();
  });

  /** Deja fuera de la cola lo que no sea de esta corrida, para poder contar invocaciones. */
  async function aislarCola(): Promise<void> {
    await prisma.$executeRawUnsafe(
      `UPDATE products SET enrichment_next_attempt_at = now() + interval '1 hour'
        WHERE enrichment_done = false AND sku NOT LIKE $1`,
      `RUNS-${corrida}-%`,
    );
  }

  async function productoPendiente(): Promise<string> {
    const categoryId = await asegurarCategoria(
      prisma,
      `runs-${corrida}`,
      `Runs ${corrida}`,
    );
    n += 1;
    const clave = `RUNS-${corrida}-${n}`;
    const p = await prisma.product.create({
      data: {
        sku: clave,
        slug: clave.toLowerCase(),
        name: `Amoladora ${clave}`,
        price_ars_cents: 150_000,
        stock: 2,
        status: 'published',
        category_id: categoryId,
        description_raw: 'amoladora 115mm',
      },
    });
    return p.id;
  }

  /**
   * Espera a que el runner vuelva a `idle`.
   *
   * El `POST` devuelve 202 y la corrida sigue **en background**: si el test termina antes, el
   * barrido queda escribiendo `products` y `product_embeddings` mientras corre la suite
   * siguiente. Eso es exactamente la clase de inestabilidad de estado compartido que la sesión
   * de US-006 midió (mismo total de fallos, conjuntos distintos de suites). Un e2e que dispara
   * trabajo asíncrono tiene que esperarlo, no sólo verificar su resultado.
   */
  async function esperarCorridaTerminada(timeoutMs = 30_000): Promise<void> {
    const limite = Date.now() + timeoutMs;
    while (Date.now() < limite) {
      if (runner.state !== 'running') return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`la corrida no terminó en ${timeoutMs} ms`);
  }

  /** El 202 no espera a la corrida: hay que darle tiempo a terminar. */
  async function esperarHasta(
    cond: () => Promise<boolean>,
    timeoutMs = 15_000,
  ): Promise<void> {
    const limite = Date.now() + timeoutMs;
    while (Date.now() < limite) {
      if (await cond()) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`la condición no se cumplió en ${timeoutMs} ms`);
  }

  it('202 con { run_id, accepted } y el pendiente queda enriquecido', async () => {
    const id = await productoPendiente();
    await aislarCola();

    const res = await request(app.getHttpServer())
      .post(ruta)
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Forwarded-For', ip)
      .send({});

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ run_id: expect.any(String), accepted: true });

    await esperarHasta(async () => {
      const p = await prisma.product.findUnique({ where: { id } });
      return p?.enrichment_done === true;
    });
    const final = await prisma.product.findUniqueOrThrow({ where: { id } });
    expect(final.description_enriched).not.toBeNull();
    expect(await repo.hasEmbedding(id)).toBe(true);

    // El body vacío barre TODO lo pendiente, incluidas fixtures de otras suites: hay que
    // esperar a que termine o el barrido sigue escribiendo durante la suite siguiente.
    await esperarCorridaTerminada();
  });

  it('un segundo POST con la corrida en curso ⇒ 409 dsm:enrichment/run-in-progress', async () => {
    // El 409 no es un fallo: es la respuesta correcta. Un 202 acá haría creer al panel que
    // arrancó una segunda corrida, y el gasto sería doble para el mismo resultado.
    await productoPendiente();
    await aislarCola();

    // Se fuerza el estado `running` sin depender de una carrera de tiempos: lo que se prueba
    // es la decisión del borde HTTP, no la velocidad del runner.
    const corriendoFalso = jest
      .spyOn(runner, 'state', 'get')
      .mockReturnValue('running');

    const res = await request(app.getHttpServer())
      .post(ruta)
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Forwarded-For', ip)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.type).toBe('dsm:enrichment/run-in-progress');
    expect(res.body.runner_state).toBe('running');
    // Y NO arrancó nada: ni una llamada paga.
    expect(fake.embedCalls).toHaveLength(0);
    corriendoFalso.mockRestore();
  });

  it('un abandonado NO se procesa sin force, y sí con force: true', async () => {
    const id = await productoPendiente();
    await prisma.$executeRawUnsafe(
      `UPDATE products SET enrichment_attempts = 5, enrichment_error_code = 'x',
              enrichment_next_attempt_at = now() - interval '1 day' WHERE id = $1::uuid`,
      id,
    );
    await aislarCola();

    // Sin force: el tope de intentos existe justamente para que esto NO se reintente solo.
    await request(app.getHttpServer())
      .post(ruta)
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Forwarded-For', ip)
      .send({ product_ids: [id] })
      .expect(202);
    await new Promise((r) => setTimeout(r, 300));
    expect((await prisma.product.findUniqueOrThrow({ where: { id } })).enrichment_done).toBe(
      false,
    );

    // Con force: es una decisión explícita del dueño y ahí sí vuelve a la cola.
    await request(app.getHttpServer())
      .post(ruta)
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Forwarded-For', ip)
      .send({ force: true, product_ids: [id] })
      .expect(202);

    await esperarHasta(async () => {
      const p = await prisma.product.findUnique({ where: { id } });
      return p?.enrichment_done === true;
    });
    const final = await prisma.product.findUniqueOrThrow({ where: { id } });
    expect(final.enrichment_attempts).toBe(0);
    expect(final.enrichment_error_code).toBeNull();
  });

  it('product_ids acota la corrida: el resto del catálogo no se toca', async () => {
    const elegido = await productoPendiente();
    const intacto = await productoPendiente();
    await aislarCola();

    await request(app.getHttpServer())
      .post(ruta)
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Forwarded-For', ip)
      .send({ product_ids: [elegido] })
      .expect(202);

    await esperarHasta(async () => {
      const p = await prisma.product.findUnique({ where: { id: elegido } });
      return p?.enrichment_done === true;
    });
    // Una sola llamada al embedder: el pedido acotado no gastó cuota en el otro producto.
    expect(fake.embedCalls).toHaveLength(1);
    expect(
      (await prisma.product.findUniqueOrThrow({ where: { id: intacto } })).enrichment_done,
    ).toBe(false);
  });

  it('un campo desconocido en el body ⇒ 422 (no una corrida que no hace lo pedido)', async () => {
    // `{"forced": true}` es un typo plausible de `force`. Aceptarlo en silencio haría una
    // corrida que el dueño cree que rehabilita abandonados y no lo hace.
    const res = await request(app.getHttpServer())
      .post(ruta)
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Forwarded-For', ip)
      .send({ foo: 1 });

    expect(res.status).toBe(422);
    expect(fake.embedCalls).toHaveLength(0);
  });

  it('sin token ⇒ 401', async () => {
    const res = await request(app.getHttpServer()).post(ruta).send({});
    expect(res.status).toBe(401);
  });

  it('sin proveedor ⇒ 503 dsm:enrichment/disabled, NO un 409 de «ocupado»', async () => {
    // Decirle «ya hay una corrida» a quien no tiene proveedor configurado lo mandaría a
    // mirar un progreso que nunca va a existir. El código tiene que decir la verdad:
    // no hay con qué trabajar.
    const apagado = jest.spyOn(runner, 'state', 'get').mockReturnValue('disabled');

    const res = await request(app.getHttpServer())
      .post(ruta)
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Forwarded-For', ip)
      .send({});

    expect(res.status).toBe(503);
    expect(res.body.type).toBe('dsm:enrichment/disabled');
    apagado.mockRestore();
  });

  it('en cooldown ⇒ 409 dsm:enrichment/cooldown (el breaker, no una corrida)', async () => {
    const enfriando = jest.spyOn(runner, 'state', 'get').mockReturnValue('cooldown');

    const res = await request(app.getHttpServer())
      .post(ruta)
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Forwarded-For', ip)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.type).toBe('dsm:enrichment/cooldown');
    expect(res.body.runner_state).toBe('cooldown');
    expect(fake.embedCalls).toHaveLength(0);
    enfriando.mockRestore();
  });
});
