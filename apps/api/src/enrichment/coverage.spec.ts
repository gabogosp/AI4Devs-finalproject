import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  coverageRatio,
  EnrichmentRepository,
  EMBEDDING_DIMS_CHECK,
} from './enrichment.repository';
import { asegurarCategoria } from '../../test/enrichment-fixtures';

/**
 * T2.4 — cobertura del catálogo, insumo del `/status` (AC-3).
 *
 * Las assertions son **por delta** y no por total absoluto: el plan las escribió como
 * «catálogo de 10 productos ⇒ total: 10», que exige ser dueño de la tabla, y este Postgres
 * es compartido con las suites de otras sesiones. Vaciarlo para poder afirmar totales le
 * borraría las fixtures a quien esté corriendo en paralelo — el costo es peor que el
 * beneficio. La propiedad que importa (cada contador cuenta lo que dice) queda verificada
 * igual, y el `coverage_ratio` se prueba como función pura, donde sí se puede afirmar el
 * caso del catálogo vacío sin vaciar nada.
 */
describe('EnrichmentRepository.coverage (integration)', () => {
  const prisma = new PrismaService();
  const config = new ConfigService({ ENRICHMENT_MAX_ATTEMPTS: 5 }) as ConfigService;
  const repo = new EnrichmentRepository(prisma, config);
  const corrida = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  let categoryId: string;

  beforeAll(async () => {
    await prisma.$connect();
    categoryId = await asegurarCategoria(prisma, `cov-${corrida}`, `Cov ${corrida}`);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  let n = 0;
  async function sembrar(estado: {
    done?: boolean;
    attempts?: number;
    embedded?: boolean;
  }): Promise<string> {
    // El TRUNCATE de otra suite puede haberse llevado la categoría entre tests:
    // el upsert la recrea y cuesta una query por siembra.
    categoryId = await asegurarCategoria(prisma, `cov-${corrida}`, `Cov ${corrida}`);
    n += 1;
    const clave = `COV-${corrida}-${n}`;
    const p = await prisma.product.create({
      data: {
        sku: clave,
        slug: clave.toLowerCase(),
        name: `Producto ${clave}`,
        price_ars_cents: 100_000,
        stock: 3,
        status: 'published',
        category_id: categoryId,
        enrichment_done: estado.done ?? false,
        enrichment_attempts: estado.attempts ?? 0,
      },
    });
    if (estado.embedded) {
      await repo.saveEmbedding(
        p.id,
        new Array(EMBEDDING_DIMS_CHECK).fill(0).map((_, i) => (i === 0 ? 1 : 0)),
        'text-embedding-004',
      );
    }
    return p.id;
  }

  it('cada contador cuenta lo que dice, en UNA sentencia', async () => {
    const antes = await repo.coverage();

    // 7 embebidos y enriquecidos + 1 abandonado + 2 pendientes (el reparto del plan).
    for (let i = 0; i < 7; i += 1) await sembrar({ done: true, embedded: true });
    await sembrar({ attempts: 5 });
    await sembrar({});
    await sembrar({});

    const ahora = await repo.coverage();

    expect(ahora.total).toBe(antes.total + 10);
    expect(ahora.enriched).toBe(antes.enriched + 7);
    expect(ahora.embedded).toBe(antes.embedded + 7);
    expect(ahora.abandoned).toBe(antes.abandoned + 1);
    expect(ahora.pending).toBe(antes.pending + 2);
  });

  it('el ratio es consistente con los contadores de la MISMA respuesta', async () => {
    const c = await repo.coverage();

    expect(c.coverage_ratio).toBeCloseTo(c.embedded / c.total, 10);
    expect(c.coverage_ratio).toBeGreaterThanOrEqual(0);
    expect(c.coverage_ratio).toBeLessThanOrEqual(1);
  });

  it('pendientes + abandonados + enriquecidos cubren el total', async () => {
    // No hay un cuarto estado posible: si aparece uno, este invariante lo caza.
    const c = await repo.coverage();

    expect(c.pending + c.abandoned + c.enriched).toBe(c.total);
  });

  it('un enriquecido sin vector cuenta como enriched pero NO como embedded', async () => {
    // Es el caso del fallo parcial: texto listo, embedding pendiente. Si los contadores
    // lo mezclaran, el /status diría 100% de cobertura sin vectores que buscar.
    const antes = await repo.coverage();

    await sembrar({ done: true, embedded: false });

    const ahora = await repo.coverage();
    expect(ahora.enriched).toBe(antes.enriched + 1);
    expect(ahora.embedded).toBe(antes.embedded);
  });
});

describe('coverageRatio (puro)', () => {
  it('catálogo vacío ⇒ 0, sin división por cero', () => {
    expect(coverageRatio(0, 0)).toBe(0);
    expect(Number.isNaN(coverageRatio(0, 0))).toBe(false);
  });

  it('7 de 10 ⇒ 0.7', () => {
    expect(coverageRatio(7, 10)).toBeCloseTo(0.7, 10);
  });

  it('cobertura completa ⇒ 1', () => {
    expect(coverageRatio(10, 10)).toBe(1);
  });

  it('un total negativo (imposible, pero) ⇒ 0 en vez de un ratio absurdo', () => {
    expect(coverageRatio(5, -1)).toBe(0);
  });
});
