import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CatalogEventsModule } from '../observability/catalog-events.module';
import { configureApp } from '../bootstrap';
import { adminToken } from '../../test/e2e-app';
import { asegurarCategoria, idDeCorrida } from '../../test/enrichment-fixtures';
import { FakeAiProvider } from '../../test/fake-ai.provider';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsModule } from '../products/products.module';
import { EnrichmentModule } from './enrichment.module';
import { EnrichmentRunner } from './enrichment.runner';
import { AI_EMBEDDER, AI_ENRICHER } from './ports/ai.ports';

/**
 * T6.2 — idempotencia y texto curado (AC-6, AC-7).
 *
 * Todo este spec cuenta **llamadas al proveedor**, porque cada llamada es plata. El escenario
 * que se protege es el más caro y el más fácil de romper sin darse cuenta: el dueño actualiza
 * su lista de precios de 800 productos y, si el hash estuviera mal armado, eso dispararía 800
 * enriquecimientos y 800 embeddings para producir exactamente el mismo texto y el mismo vector.
 */
describe('Idempotencia del enriquecimiento (e2e-enrichment-idempotency)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let runner: EnrichmentRunner;
  let fake: FakeAiProvider;
  const corrida = idDeCorrida();
  let n = 0;

  beforeAll(async () => {
    fake = new FakeAiProvider();
    const moduleRef = await Test.createTestingModule({
      imports: [
        AppConfigModule,
        PrismaModule,
        CatalogEventsModule,
        AuthModule,
        ProductsModule,
        EnrichmentModule,
      ],
    })
      .overrideProvider(AI_ENRICHER)
      .useValue(fake)
      .overrideProvider(AI_EMBEDDER)
      .useValue(fake)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    runner = app.get(EnrichmentRunner);
  });
  afterAll(async () => {
    await app?.close();
  });

  /** Producto pendiente, ya enriquecido por una primera corrida. */
  async function productoYaEnriquecido(): Promise<string> {
    const categoryId = await asegurarCategoria(
      prisma,
      `idem-${corrida}`,
      `Idempotencia ${corrida}`,
    );
    n += 1;
    const sku = `IDEM-${corrida}-${n}`;
    const p = await prisma.product.create({
      data: {
        sku,
        slug: sku.toLowerCase(),
        name: `Amoladora ${sku}`,
        price_ars_cents: 150_000,
        stock: 5,
        status: 'published',
        category_id: categoryId,
        description_raw: 'amoladora 115mm',
      },
    });
    await runner.start({ productIds: [p.id] });
    const fila = await prisma.product.findUniqueOrThrow({ where: { id: p.id } });
    expect(fila.enrichment_done).toBe(true);
    return p.id;
  }

  const patch = (id: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .patch(`/v1/admin/products/${id}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(body);

  /** Cuenta las llamadas al proveedor de una corrida acotada a `id`. */
  async function llamadasDeUnaCorrida(id: string) {
    fake.enrichCalls.length = 0;
    fake.embedCalls.length = 0;
    // El producto se vuelve a poner en la cola sin tocar el hash: es lo que hace una corrida
    // programada al barrer el catálogo.
    await prisma.$executeRawUnsafe(
      `UPDATE products SET enrichment_done = false, enrichment_next_attempt_at = NULL
        WHERE id = $1::uuid`,
      id,
    );
    const resultado = await runner.start({ productIds: [id] });
    return {
      enrich: fake.enrichCalls.length,
      embed: fake.embedCalls.length,
      outcomes: resultado.outcomes,
    };
  }

  it('AC-6: segunda corrida sin cambios ⇒ 0 llamadas al enricher y 0 al embedder', async () => {
    const id = await productoYaEnriquecido();

    const llamadas = await llamadasDeUnaCorrida(id);

    expect(llamadas.enrich).toBe(0);
    expect(llamadas.embed).toBe(0);
    expect(llamadas.outcomes?.skipped_unchanged).toBe(1);
  });

  it('AC-6: cambiar SÓLO el stock no gatilla ninguna llamada', async () => {
    // Un cambio de stock ocurre con cada venta. Si re-enriqueciera, cada venta costaría dinero
    // en llamadas a la IA.
    const id = await productoYaEnriquecido();
    await patch(id, { stock: 99 }).expect(200);

    const llamadas = await llamadasDeUnaCorrida(id);

    expect(llamadas.enrich).toBe(0);
    expect(llamadas.embed).toBe(0);
  });

  it('AC-6: cambiar SÓLO el precio no gatilla ninguna llamada', async () => {
    // El escenario caro: una actualización de lista de precios de 800 productos.
    const id = await productoYaEnriquecido();
    await patch(id, { price_ars_cents: 222_000 }).expect(200);

    const llamadas = await llamadasDeUnaCorrida(id);

    expect(llamadas.enrich).toBe(0);
    expect(llamadas.embed).toBe(0);
  });

  it('AC-6: cambiar description_raw ⇒ 1 llamada a cada uno', async () => {
    // El contraste que le da sentido a los tres tests anteriores: cuando cambia lo que
    // describe al producto, sí se paga. Si esto diera 0, los otros no probarían nada.
    const id = await productoYaEnriquecido();
    fake.enrichCalls.length = 0;
    fake.embedCalls.length = 0;

    await patch(id, {
      description_raw: 'amoladora angular de 115 mm con 900 W y disco incluido',
    }).expect(200);
    // El PATCH la devolvió a la cola: no hace falta empujarla a mano.
    const fila = await prisma.product.findUniqueOrThrow({ where: { id } });
    expect(fila.enrichment_done).toBe(false);

    await runner.start({ productIds: [id] });

    expect(fake.enrichCalls).toHaveLength(1);
    expect(fake.embedCalls).toHaveLength(1);
    // El enricher recibió el texto NUEVO como base: es lo que prueba que el pipeline usa la
    // descripción corregida y no la anterior. (No se asserta sobre la prosa que devuelve el
    // fake: eso probaría el doble de prueba, no el sistema.)
    expect(fake.enrichCalls[0].baseText).toContain('900 W');
  });

  it('AC-7: curar el texto ⇒ 0 al enricher, 1 al embedder, y el texto NO cambia', async () => {
    const id = await productoYaEnriquecido();
    const textoDelDueno =
      'Amoladora angular 115 mm, 900 W. Sirve para cortar hierro y mampostería.';

    await patch(id, { description_enriched: textoDelDueno }).expect(200);
    fake.enrichCalls.length = 0;
    fake.embedCalls.length = 0;
    await runner.start({ productIds: [id] });

    expect(fake.enrichCalls).toHaveLength(0);
    expect(fake.embedCalls).toHaveLength(1);
    const fila = await prisma.product.findUniqueOrThrow({ where: { id } });
    // El texto del dueño queda EXACTAMENTE como lo escribió.
    expect(fila.description_enriched).toBe(textoDelDueno);
    expect(fila.description_curated).toBe(true);
  });

  it('AC-7: dos corridas más sobre el curado no lo tocan ni gastan nada', async () => {
    // La propiedad tiene que ser estable en el tiempo, no sólo en la corrida siguiente: el
    // catálogo se barre todas las noches.
    const id = await productoYaEnriquecido();
    const textoDelDueno = 'Texto de Pedro, definitivo.';
    await patch(id, { description_enriched: textoDelDueno }).expect(200);
    await runner.start({ productIds: [id] });

    const segunda = await llamadasDeUnaCorrida(id);
    const tercera = await llamadasDeUnaCorrida(id);

    expect(segunda).toMatchObject({ enrich: 0, embed: 0 });
    expect(tercera).toMatchObject({ enrich: 0, embed: 0 });
    expect(
      (await prisma.product.findUniqueOrThrow({ where: { id } })).description_enriched,
    ).toBe(textoDelDueno);
  });
});
