import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { bootTestApp } from '../../test/e2e-app';
import { PrismaService } from '../prisma/prisma.service';
import { StorefrontModule } from '../storefront/storefront.module';
import { EnrichmentRepository } from './enrichment.repository';
import { EnrichmentService } from './enrichment.service';
import { FakeAiProvider } from '../../test/fake-ai.provider';

/**
 * T3.3 — fallo persistente y abandono (AC-4, AC-5).
 *
 * El assert que le da sentido a toda la task es el último: un producto que la IA **nunca
 * pudo** enriquecer **sigue apareciendo en el listado público**. Es la diferencia entre
 * degradar y desaparecer, y es lo que hace que un problema con Gemini sea un problema de
 * calidad de búsqueda y no una caída del catálogo.
 */
describe('Enriquecimiento — fallo persistente y abandono (e2e-enrichment-failure)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let repo: EnrichmentRepository;
  let service: EnrichmentService;

  const corrida = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const rubroSlug = `fallo-${corrida}`;
  let categoryId: string;

  beforeAll(async () => {
    app = await bootTestApp([StorefrontModule]);
    prisma = app.get(PrismaService);
    const config = new ConfigService({ ENRICHMENT_MAX_ATTEMPTS: 5 }) as ConfigService;
    repo = new EnrichmentRepository(prisma, config);
    service = new EnrichmentService(
      prisma,
      repo,
      config,
      new FakeAiProvider(),
      new FakeAiProvider(),
    );

    categoryId = (
      await prisma.category.create({
        data: { name: `Fallos ${corrida}`, slug: rubroSlug },
      })
    ).id;
  });
  afterAll(async () => {
    await app?.close();
  });

  let n = 0;
  async function productoPublicado(): Promise<{ id: string; slug: string }> {
    n += 1;
    const clave = `FALLO-${corrida}-${n}`;
    const p = await prisma.product.create({
      data: {
        sku: clave,
        slug: clave.toLowerCase(),
        name: `Amoladora ${clave}`,
        price_ars_cents: 185_000,
        stock: 3,
        status: 'published',
        category_id: categoryId,
        description_raw: 'amoladora 115mm',
      },
    });
    return { id: p.id, slug: p.slug };
  }

  it('cinco fallos dejan el producto abandonado, con rastro y sin vector (AC-5)', async () => {
    const producto = await productoPublicado();

    for (let i = 0; i < 5; i += 1) {
      await service.registerFailure(producto.id, 'dsm:enrichment/ai-transient');
    }

    const fila = await prisma.product.findUniqueOrThrow({ where: { id: producto.id } });
    expect(fila.enrichment_attempts).toBe(5);
    expect(fila.enrichment_error_code).toBe('dsm:enrichment/ai-transient');
    expect(fila.enrichment_done).toBe(false);
    // Conserva su descripción base: no se pierde lo que el catálogo ya tenía.
    expect(fila.description_raw).toBe('amoladora 115mm');
    expect(fila.description_enriched).toBeNull();
    expect(await repo.hasEmbedding(producto.id)).toBe(false);
  });

  it('el abandonado sale de la cola: no se sigue quemando cuota contra él', async () => {
    const producto = await productoPublicado();
    for (let i = 0; i < 5; i += 1) await service.registerFailure(producto.id, 'e');

    // Incluso con el próximo intento ya vencido, el claim lo ignora por los intentos.
    await prisma.$executeRawUnsafe(
      `UPDATE products SET enrichment_next_attempt_at = now() - interval '1 day' WHERE id = $1::uuid`,
      producto.id,
    );

    const ids = (await repo.claimBatch(200)).map((p) => p.id);
    expect(ids).not.toContain(producto.id);
  });

  it('DEGRADÓ SIN DESAPARECER: el listado público de US-002 lo sigue devolviendo', async () => {
    // El corazón de AC-5. Si esto fallara, un problema con el proveedor de IA se
    // convertiría en productos invisibles en la tienda.
    const producto = await productoPublicado();
    for (let i = 0; i < 5; i += 1) await service.registerFailure(producto.id, 'e');

    const res = await request(app.getHttpServer()).get(
      `/v1/categories/${rubroSlug}/products?limit=100`,
    );

    expect(res.status).toBe(200);
    const slugs = (res.body.data as Array<{ slug: string }>).map((p) => p.slug);
    expect(slugs).toContain(producto.slug);
  });

  it('y su ficha pública también responde 200', async () => {
    const producto = await productoPublicado();
    for (let i = 0; i < 5; i += 1) await service.registerFailure(producto.id, 'e');

    const res = await request(app.getHttpServer()).get(
      `/v1/products/${producto.slug}`,
    );

    expect(res.status).toBe(200);
    // La ficha muestra la descripción base, no un hueco.
    expect(res.body.description).toBe('amoladora 115mm');
  });

  it('un producto que falla y después funciona se recupera solo, sin intervención', async () => {
    // El backoff durable no es un abandono anticipado: mientras queden intentos, el
    // producto vuelve a la cola cuando su espera vence.
    const producto = await productoPublicado();
    await service.registerFailure(producto.id, 'dsm:enrichment/ai-transient');
    await prisma.$executeRawUnsafe(
      `UPDATE products SET enrichment_next_attempt_at = now() - interval '1 minute' WHERE id = $1::uuid`,
      producto.id,
    );

    const claimed = (await repo.claimBatch(200)).find((p) => p.id === producto.id);
    expect(claimed).toBeDefined();

    await service.processProduct(claimed!, 'Fallos');

    const fila = await prisma.product.findUniqueOrThrow({ where: { id: producto.id } });
    expect(fila.enrichment_done).toBe(true);
    // El rastro del fallo se limpia al tener éxito: no queda un error_code mintiendo.
    expect(fila.enrichment_error_code).toBeNull();
    expect(fila.enrichment_attempts).toBe(0);
    expect(await repo.hasEmbedding(producto.id)).toBe(true);
  });
});
