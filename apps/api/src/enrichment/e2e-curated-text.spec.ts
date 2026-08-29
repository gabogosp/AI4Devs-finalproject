import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { adminToken, bootTestApp } from '../../test/e2e-app';
import { asegurarCategoria, idDeCorrida } from '../../test/enrichment-fixtures';
import { FakeAiProvider } from '../../test/fake-ai.provider';
import { AuthModule } from '../auth/auth.module';
import { CategoriesModule } from '../categories/categories.module';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsModule } from '../products/products.module';
import { EnrichmentRepository } from './enrichment.repository';
import { EnrichmentRunner } from './enrichment.runner';
import { EnrichmentService } from './enrichment.service';

/**
 * T4.3 — curación del texto por el dueño (AC-7, D8): `PATCH /v1/admin/products/{id}` con
 * `description_enriched`.
 *
 * La propiedad que sostiene todo lo demás: **una vez que el dueño escribe su versión, la IA
 * no la vuelve a pisar**. Sin eso, Pedro corrige la descripción de una amoladora, la corrida
 * de la noche la sobrescribe, y él lo descubre mirando su propia tienda. Sería la clase de
 * bug que hace que un dueño deje de confiar en el panel entero.
 */
describe('Curación del texto por el dueño (curated)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let runner: EnrichmentRunner;
  let repo: EnrichmentRepository;
  let fake: FakeAiProvider;
  const corrida = idDeCorrida();
  let n = 0;

  beforeAll(async () => {
    app = await bootTestApp([AuthModule, CategoriesModule, ProductsModule]);
    prisma = app.get(PrismaService);
    // El runner se arma a mano con el fake: lo que se prueba es la interacción entre el PATCH
    // y la corrida siguiente, contando invocaciones exactas del proveedor.
    const config = new ConfigService({}) as ConfigService;
    fake = new FakeAiProvider();
    repo = new EnrichmentRepository(prisma, config);
    const service = new EnrichmentService(prisma, repo, config, fake, fake);
    runner = new EnrichmentRunner(repo, service, config, fake, fake);
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => {
    fake.embedCalls.length = 0;
    fake.enrichCalls.length = 0;
  });

  async function producto(): Promise<{ id: string; sku: string }> {
    const categoryId = await asegurarCategoria(
      prisma,
      `cur-${corrida}`,
      `Curados ${corrida}`,
    );
    n += 1;
    const sku = `CUR-${corrida}-${n}`;
    const p = await prisma.product.create({
      data: {
        sku,
        slug: sku.toLowerCase(),
        name: `Amoladora ${sku}`,
        price_ars_cents: 150_000,
        stock: 2,
        status: 'published',
        category_id: categoryId,
        description_raw: 'amoladora 115mm',
      },
    });
    return { id: p.id, sku };
  }

  const patch = (id: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .patch(`/v1/admin/products/${id}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(body);

  /** Corre el enriquecimiento SÓLO sobre este producto. */
  const correrSobre = (id: string) => runner.start({ productIds: [id] });

  it('PATCH con description_enriched ⇒ 200, curado y elegible para re-embeddear', async () => {
    const p = await producto();

    const res = await patch(p.id, {
      description_enriched: 'Amoladora angular de 115 mm, 900 W, con disco de corte incluido.',
    });

    expect(res.status).toBe(200);
    const fila = await prisma.product.findUniqueOrThrow({ where: { id: p.id } });
    expect(fila.description_enriched).toContain('900 W');
    expect(fila.description_curated).toBe(true);
    // El vector actual (si hubiera) representa el texto viejo: hay que regenerarlo.
    expect(fila.enrichment_done).toBe(false);
    expect(fila.enrichment_source_hash).toBeNull();
  });

  it('la corrida siguiente NO llama al LLM y embeddea el TEXTO DEL DUEÑO (AC-7)', async () => {
    // El conteo es la prueba: cero invocaciones al enriquecedor significa cero pesos gastados
    // en reescribir algo que el dueño ya escribió.
    const p = await producto();
    const textoDelDueno =
      'Amoladora angular 115 mm ideal para cortar hierro y mampostería. Incluye traba de eje.';
    await patch(p.id, { description_enriched: textoDelDueno }).expect(200);

    const resultado = await correrSobre(p.id);

    expect(resultado.processed).toBe(1);
    expect(fake.enrichCalls).toHaveLength(0);
    expect(fake.embedCalls).toHaveLength(1);
    // Y lo que se embebió contiene el texto curado, no la descripción pobre original.
    expect(fake.embedCalls[0]).toContain('traba de eje');
    expect(fake.embedCalls[0]).not.toContain('amoladora 115mm.');
    expect(await repo.hasEmbedding(p.id)).toBe(true);

    const fila = await prisma.product.findUniqueOrThrow({ where: { id: p.id } });
    expect(fila.description_enriched).toBe(textoDelDueno);
    expect(fila.enrichment_done).toBe(true);
  });

  it('un PATCH de sólo precio no toca la curación ni gatilla re-embed', async () => {
    // Si cambiar un precio marcara el producto para re-enriquecer, una actualización de lista
    // de precios re-embeddearía el catálogo entero: cientos de llamadas pagas por nada.
    const p = await producto();
    await patch(p.id, { description_enriched: 'Texto del dueño.' }).expect(200);
    await correrSobre(p.id);
    const antes = await prisma.product.findUniqueOrThrow({ where: { id: p.id } });
    fake.embedCalls.length = 0;

    await patch(p.id, { price_ars_cents: 199_000 }).expect(200);

    const despues = await prisma.product.findUniqueOrThrow({ where: { id: p.id } });
    expect(despues.price_ars_cents).toBe(199_000);
    expect(despues.description_curated).toBe(true);
    expect(despues.enrichment_done).toBe(antes.enrichment_done);
    expect(despues.enrichment_source_hash).toBe(antes.enrichment_source_hash);

    // Y la corrida siguiente no encuentra nada que hacer.
    const resultado = await correrSobre(p.id);
    expect(resultado.processed).toBe(0);
    expect(fake.embedCalls).toHaveLength(0);
  });

  it('un cambio de description_raw NO pisa el texto curado', async () => {
    // La propiedad central de AC-7. El texto del dueño sobrevive a cualquier cosa que pase
    // con la descripción que viene del catálogo o del import.
    const p = await producto();
    const textoDelDueno = 'Descripción escrita por Pedro, y no la toca nadie.';
    await patch(p.id, { description_enriched: textoDelDueno }).expect(200);
    await correrSobre(p.id);

    await patch(p.id, { description_raw: 'texto nuevo del proveedor, mucho peor' }).expect(200);
    await prisma.$executeRawUnsafe(
      `UPDATE products SET enrichment_done = false, enrichment_next_attempt_at = NULL
        WHERE id = $1::uuid`,
      p.id,
    );
    fake.enrichCalls.length = 0;

    await correrSobre(p.id);

    const fila = await prisma.product.findUniqueOrThrow({ where: { id: p.id } });
    expect(fila.description_enriched).toBe(textoDelDueno);
    expect(fila.description_raw).toBe('texto nuevo del proveedor, mucho peor');
    // Cero llamadas al LLM: el producto es curado y eso no cambia porque cambie el raw.
    expect(fake.enrichCalls).toHaveLength(0);
  });

  it('un producto NO curado sí pasa por el LLM: la curación es la excepción, no la regla', async () => {
    // Contraste que le da valor a los tests de arriba: sin curación, el camino normal usa el
    // enriquecedor. Si esto también diera 0, los otros tests no probarían nada.
    const p = await producto();

    await correrSobre(p.id);

    expect(fake.enrichCalls).toHaveLength(1);
    expect(fake.embedCalls).toHaveLength(1);
    expect(
      (await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).description_curated,
    ).toBe(false);
  });

  it('el campo respeta el mismo AdminGuard que el resto del PATCH', async () => {
    const p = await producto();

    const sinToken = await request(app.getHttpServer())
      .patch(`/v1/admin/products/${p.id}`)
      .send({ description_enriched: 'no debería entrar' });

    expect(sinToken.status).toBe(401);
    expect(
      (await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).description_enriched,
    ).toBeNull();
  });
});
