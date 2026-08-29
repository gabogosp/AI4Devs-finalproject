import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EnrichmentRepository } from './enrichment.repository';
import { FakeAiProvider } from '../../test/fake-ai.provider';
import { asegurarCategoria } from '../../test/enrichment-fixtures';

/**
 * T2.2 — escritura del vector. Contra el Postgres real con pgvector: lo que se prueba es
 * que la escritura es **idempotente** (re-embeddear actualiza, no falla ni duplica) y que
 * `model_version` queda persistido, porque sin eso un cambio de modelo dejaría el catálogo
 * con vectores de dos espacios distintos y sin forma de distinguirlos (AC-8).
 *
 * Sin `TRUNCATE`: la base es compartida con las suites de otras sesiones (ver el comentario
 * de `enrichment.repository.spec.ts`). Fixtures con prefijo único y assertions acotadas a
 * las filas propias.
 */
describe('EnrichmentRepository — embeddings (integration)', () => {
  const prisma = new PrismaService();
  const config = new ConfigService({ ENRICHMENT_MAX_ATTEMPTS: 5 }) as ConfigService;
  const repo = new EnrichmentRepository(prisma, config);
  const corrida = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  let categoryId: string;

  beforeAll(async () => {
    await prisma.$connect();
    categoryId = await asegurarCategoria(prisma, `emb-${corrida}`, `Emb ${corrida}`);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  let n = 0;
  async function producto(): Promise<string> {
    // El TRUNCATE de otra suite puede haberse llevado la categoría entre tests:
    // el upsert la recrea y cuesta una query por siembra.
    categoryId = await asegurarCategoria(prisma, `emb-${corrida}`, `Emb ${corrida}`);
    n += 1;
    const clave = `EMB-${corrida}-${n}`;
    const p = await prisma.product.create({
      data: {
        sku: clave,
        slug: clave.toLowerCase(),
        name: `Producto ${clave}`,
        price_ars_cents: 100_000,
        stock: 3,
        status: 'published',
        category_id: categoryId,
      },
    });
    return p.id;
  }

  const filaDe = (productId: string) =>
    prisma.$queryRaw<Array<{ model_version: string; generated_at: Date; dims: number }>>`
      SELECT model_version, generated_at, vector_dims(embedding) AS dims
        FROM product_embeddings WHERE product_id = ${productId}::uuid`;

  it('guarda el vector con su model_version', async () => {
    const id = await producto();
    const v = FakeAiProvider.vectorDe('taco fischer');

    await repo.saveEmbedding(id, v, 'text-embedding-004');

    const [fila] = await filaDe(id);
    expect(fila.dims).toBe(768);
    expect(fila.model_version).toBe('text-embedding-004');
  });

  it('el upsert es idempotente: dos escrituras dejan UNA fila y refrescan los metadatos', async () => {
    const id = await producto();
    await repo.saveEmbedding(id, FakeAiProvider.vectorDe('v1'), 'text-embedding-004');
    const [primera] = await filaDe(id);

    // Espera mínima para que `generated_at` pueda ser estrictamente mayor.
    await new Promise((r) => setTimeout(r, 5));
    await repo.saveEmbedding(id, FakeAiProvider.vectorDe('v2'), 'text-embedding-005');

    const filas = await filaDe(id);
    expect(filas).toHaveLength(1); // no duplica ni lanza
    expect(filas[0].model_version).toBe('text-embedding-005'); // AC-8: queda trazado
    expect(filas[0].generated_at.getTime()).toBeGreaterThan(
      primera.generated_at.getTime(),
    );
  });

  it('el vector guardado es el último escrito', async () => {
    const id = await producto();
    const primero = FakeAiProvider.vectorDe('primero');
    const segundo = FakeAiProvider.vectorDe('segundo');

    await repo.saveEmbedding(id, primero, 'm1');
    await repo.saveEmbedding(id, segundo, 'm1');

    // Se compara por distancia: el vector guardado tiene que ser idéntico al segundo
    // (distancia 0) y distinto del primero.
    const [{ d_segundo, d_primero }] = await prisma.$queryRaw<
      Array<{ d_segundo: number; d_primero: number }>
    >`
      SELECT embedding <=> ${`[${segundo.join(',')}]`}::vector AS d_segundo,
             embedding <=> ${`[${primero.join(',')}]`}::vector AS d_primero
        FROM product_embeddings WHERE product_id = ${id}::uuid`;
    expect(Number(d_segundo)).toBeCloseTo(0, 6);
    expect(Number(d_primero)).toBeGreaterThan(0);
  });

  it('un vector de 767 dimensiones lo RECHAZA la base (defensa en profundidad)', async () => {
    // La validación del adapter (T1.2) es la primera barrera; ésta es la de la base, que
    // no depende de que nadie se acuerde de validar.
    const id = await producto();
    const corto = new Array(767).fill(0.1);

    await expect(repo.saveEmbedding(id, corto, 'm1')).rejects.toBeTruthy();
    expect(await filaDe(id)).toHaveLength(0);
  });

  it('borrar el producto borra su embedding (CASCADE)', async () => {
    const id = await producto();
    await repo.saveEmbedding(id, FakeAiProvider.vectorDe('x'), 'm1');
    expect(await filaDe(id)).toHaveLength(1);

    await prisma.product.delete({ where: { id } });

    expect(await filaDe(id)).toHaveLength(0);
  });

  describe('hasEmbedding', () => {
    it('distingue el producto con vector del que no lo tiene', async () => {
      // Es lo que permite completar un vector faltante sin volver a llamar al LLM
      // cuando el hash no cambió (fila 4 de la matriz de decisión).
      const conVector = await producto();
      const sinVector = await producto();
      await repo.saveEmbedding(conVector, FakeAiProvider.vectorDe('y'), 'm1');

      expect(await repo.hasEmbedding(conVector)).toBe(true);
      expect(await repo.hasEmbedding(sinVector)).toBe(false);
    });
  });
});
