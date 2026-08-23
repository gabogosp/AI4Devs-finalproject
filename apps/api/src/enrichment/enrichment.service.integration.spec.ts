import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EnrichmentRepository, ClaimedProduct } from './enrichment.repository';
import { EnrichmentService } from './enrichment.service';
import { FakeAiProvider } from '../../test/fake-ai.provider';
import { AiPermanentError } from '../common/errors/enrichment-errors';

/**
 * T3.2 (integración) — los dos invariantes que un test con mocks no puede demostrar, porque
 * los garantiza la base: que el `status` del producto sobrevive intacto al enriquecimiento
 * (AC-10) y que el texto y el vector entran **juntos o ninguno**.
 *
 * Sin `TRUNCATE`: base compartida, fixtures con prefijo único (ver
 * `enrichment.repository.spec.ts`).
 */
describe('EnrichmentService (integration)', () => {
  const prisma = new PrismaService();
  const config = new ConfigService({ ENRICHMENT_MAX_ATTEMPTS: 5 }) as ConfigService;
  const repo = new EnrichmentRepository(prisma, config);
  const corrida = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  let categoryId: string;
  let n = 0;

  beforeAll(async () => {
    await prisma.$connect();
    categoryId = (
      await prisma.category.create({
        data: { name: `Svc ${corrida}`, slug: `svc-${corrida}` },
      })
    ).id;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function sembrar(over: {
    status?: string;
    raw?: string | null;
    enriched?: string | null;
    curated?: boolean;
  } = {}): Promise<ClaimedProduct> {
    n += 1;
    const clave = `SVC-${corrida}-${n}`;
    const p = await prisma.product.create({
      data: {
        sku: clave,
        slug: clave.toLowerCase(),
        name: `Producto ${clave}`,
        price_ars_cents: 100_000,
        stock: 4,
        status: over.status ?? 'published',
        category_id: categoryId,
        description_raw: over.raw ?? 'descripcion pobre',
        description_enriched: over.enriched ?? null,
        description_curated: over.curated ?? false,
      },
    });
    return {
      id: p.id,
      name: p.name,
      description_raw: p.description_raw,
      description_enriched: p.description_enriched,
      description_curated: p.description_curated,
      enrichment_source_hash: p.enrichment_source_hash,
      enrichment_attempts: p.enrichment_attempts,
      category_id: p.category_id,
    };
  }

  const servicioCon = (fake: FakeAiProvider) =>
    new EnrichmentService(prisma, repo, config, fake, fake);

  it('un producto DRAFT queda enriquecido y sigue siendo draft (AC-10)', async () => {
    // El enriquecimiento no publica nada: si lo hiciera, un borrador del dueño aparecería
    // en la tienda por el solo hecho de que la IA lo describió.
    const producto = await sembrar({ status: 'draft' });

    const resultado = await servicioCon(new FakeAiProvider()).processProduct(
      producto,
      'Fijaciones',
    );

    const fila = await prisma.product.findUniqueOrThrow({ where: { id: producto.id } });
    expect(resultado).toBe('enriched_and_embedded');
    expect(fila.status).toBe('draft');
    expect(fila.enrichment_done).toBe(true);
    expect(fila.description_enriched).not.toBeNull();
    expect(await repo.hasEmbedding(producto.id)).toBe(true);
  });

  it('un producto PUBLISHED tampoco cambia de estado', async () => {
    const producto = await sembrar({ status: 'published' });

    await servicioCon(new FakeAiProvider()).processProduct(producto, 'Fijaciones');

    expect(
      (await prisma.product.findUniqueOrThrow({ where: { id: producto.id } })).status,
    ).toBe('published');
  });

  it('si el embedder falla, NO queda texto escrito ni vector: la transacción revierte', async () => {
    // El modo de falla que esto evita: texto escrito + hash actualizado + sin vector ⇒ la
    // próxima corrida lo saltea como «sin cambios» y el producto nunca se puede buscar.
    const producto = await sembrar({ enriched: 'texto previo' });
    const fake = new FakeAiProvider();
    jest.spyOn(fake, 'embed').mockRejectedValue(new AiPermanentError('512 dims'));

    await expect(
      servicioCon(fake).processProduct(producto, 'Fijaciones'),
    ).rejects.toBeInstanceOf(AiPermanentError);

    const fila = await prisma.product.findUniqueOrThrow({ where: { id: producto.id } });
    expect(fila.description_enriched).toBe('texto previo'); // intacto
    expect(fila.enrichment_done).toBe(false);
    expect(fila.enrichment_source_hash).toBeNull();
    expect(await repo.hasEmbedding(producto.id)).toBe(false);
  });

  it('el texto curado del dueño sobrevive al enriquecimiento (AC-7)', async () => {
    const producto = await sembrar({
      curated: true,
      enriched: 'Texto escrito por Pedro a mano',
    });
    const fake = new FakeAiProvider();

    const resultado = await servicioCon(fake).processProduct(producto, 'Fijaciones');

    const fila = await prisma.product.findUniqueOrThrow({ where: { id: producto.id } });
    expect(resultado).toBe('embedded_from_curated');
    expect(fila.description_enriched).toBe('Texto escrito por Pedro a mano');
    expect(fake.enrichCalls).toHaveLength(0); // la IA no lo tocó
    expect(await repo.hasEmbedding(producto.id)).toBe(true); // pero sí es buscable
  });

  it('el ciclo completo deja el producto listo para el kNN', async () => {
    const producto = await sembrar();

    await servicioCon(new FakeAiProvider()).processProduct(producto, 'Fijaciones');

    const fila = await prisma.product.findUniqueOrThrow({ where: { id: producto.id } });
    const vecinos = await repo.findNearest(
      FakeAiProvider.vectorDe(
        `${producto.name}. Fijaciones. ${fila.description_enriched}`,
      ),
      50,
    );
    expect(vecinos.map((v) => v.id)).toContain(producto.id);
  });

  describe('registerFailure — backoff durable y abandono (T3.3, AC-5)', () => {
    it('cuenta el intento, deja el código y agenda el próximo con la escalera', async () => {
      const producto = await sembrar();
      const service = servicioCon(new FakeAiProvider());
      const antes = Date.now();

      await service.registerFailure(producto.id, 'dsm:enrichment/ai-transient');

      const fila = await prisma.product.findUniqueOrThrow({ where: { id: producto.id } });
      expect(fila.enrichment_attempts).toBe(1);
      expect(fila.enrichment_error_code).toBe('dsm:enrichment/ai-transient');
      // Primer fallo ⇒ 1 minuto.
      expect(fila.enrichment_next_attempt_at!.getTime()).toBeGreaterThan(antes + 50_000);
      expect(fila.enrichment_next_attempt_at!.getTime()).toBeLessThan(antes + 70_000);
    });

    it('la espera crece con cada fallo (el backoff vive en la BASE, no en memoria)', async () => {
      // Es la crítica que ADR-0012 se hacía a sí mismo: un redeploy no pierde el conteo.
      const producto = await sembrar();
      const service = servicioCon(new FakeAiProvider());

      await service.registerFailure(producto.id, 'e1');
      const primera = (
        await prisma.product.findUniqueOrThrow({ where: { id: producto.id } })
      ).enrichment_next_attempt_at!;
      await service.registerFailure(producto.id, 'e2');
      const segunda = (
        await prisma.product.findUniqueOrThrow({ where: { id: producto.id } })
      ).enrichment_next_attempt_at!;

      expect(segunda.getTime()).toBeGreaterThan(primera.getTime());
    });

    it('a los 5 intentos queda ABANDONADO: claimBatch deja de devolverlo y conserva su base', async () => {
      const producto = await sembrar({ raw: 'descripcion original del catalogo' });
      const service = servicioCon(new FakeAiProvider());

      for (let i = 0; i < 5; i += 1) {
        await service.registerFailure(producto.id, 'dsm:enrichment/ai-permanent');
      }

      const fila = await prisma.product.findUniqueOrThrow({ where: { id: producto.id } });
      expect(fila.enrichment_attempts).toBe(5);
      expect(fila.enrichment_done).toBe(false);
      expect(fila.enrichment_error_code).not.toBeNull();
      // Degradó sin desaparecer: conserva su descripción y sigue publicado.
      expect(fila.description_raw).toBe('descripcion original del catalogo');
      expect(fila.status).toBe('published');
      expect(await repo.hasEmbedding(producto.id)).toBe(false);

      // Y el claim ya no lo devuelve: no se sigue quemando cuota contra él.
      await prisma.$executeRawUnsafe(
        `UPDATE products SET enrichment_next_attempt_at = now() - interval '1 hour' WHERE id = $1::uuid`,
        producto.id,
      );
      const ids = (await repo.claimBatch(100)).map((p) => p.id);
      expect(ids).not.toContain(producto.id);
    });
  });
});
