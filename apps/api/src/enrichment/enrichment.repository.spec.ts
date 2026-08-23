import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EnrichmentRepository } from './enrichment.repository';
import { asegurarCategoria } from '../../test/enrichment-fixtures';

/**
 * T2.1 — el claim por lease, contra el Postgres real. Es la task donde un test con mocks
 * no probaría nada: lo que hay que demostrar es que **dos corridas concurrentes no se
 * pisan**, y eso lo decide `FOR UPDATE SKIP LOCKED` en el motor, no nuestro código.
 *
 * ⚠ Las assertions están acotadas a **las filas que este spec siembra** (subconjuntos y
 * deltas), nunca al total de la tabla. El Postgres de `docker-compose` es compartido y hay
 * otras sesiones corriendo sus propias suites: un `expect(lote).toHaveLength(10)` pasa o
 * falla según quién más esté sembrando en ese instante, y eso no es una propiedad del
 * claim. Verificado en carne propia: la primera corrida de este spec devolvió 12 por
 * fixtures ajenas (`SKU-QA…`) y la segunda, 10.
 */
describe('EnrichmentRepository.claimBatch (integration)', () => {
  const prisma = new PrismaService();
  const config = new ConfigService({
    ENRICHMENT_LEASE_MS: 120_000,
    ENRICHMENT_MAX_ATTEMPTS: 5,
  }) as ConfigService;
  const repo = new EnrichmentRepository(prisma, config);

  let categoryId: string;
  /** Prefijo único por corrida: sin TRUNCATE, los SKU/slug no pueden colisionar. */
  const corrida = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  beforeAll(async () => {
    await prisma.$connect();
    // Se crea UNA categoría para toda la suite y NO se truncan tablas: este Postgres es
    // compartido con las suites de otras sesiones, y un `TRUNCATE products` acá les
    // borra las fixtures a mitad de su corrida. Ser buen ciudadano de la base es parte
    // del contrato: fixtures con prefijo único y assertions por subconjunto.
    categoryId = await asegurarCategoria(prisma, `fij-${corrida}`, `Fijaciones ${corrida}`);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Siembra `n` productos con el estado de enriquecimiento pedido. */
  async function sembrar(
    prefijo: string,
    n: number,
    estado: { done?: boolean; attempts?: number; nextAttemptAt?: Date | null } = {},
  ): Promise<string[]> {
    // El TRUNCATE de otra suite puede haberse llevado la categoría entre tests:
    // el upsert la recrea y cuesta una query por siembra.
    categoryId = await asegurarCategoria(prisma, `fij-${corrida}`, `Fijaciones ${corrida}`);
    const ids: string[] = [];
    for (let i = 0; i < n; i += 1) {
      const clave = `${prefijo}-${corrida}-${i}`;
      const p = await prisma.product.create({
        data: {
          sku: clave,
          slug: clave.toLowerCase(),
          name: `Producto ${prefijo} ${i}`,
          price_ars_cents: 100_000,
          stock: 5,
          status: 'published',
          category_id: categoryId,
          enrichment_done: estado.done ?? false,
          enrichment_attempts: estado.attempts ?? 0,
          enrichment_next_attempt_at: estado.nextAttemptAt ?? null,
        },
      });
      ids.push(p.id);
    }
    return ids;
  }

  it('devuelve sólo los pendientes elegibles: ni hechos ni abandonados', async () => {
    const pendientes = await sembrar('PEND', 10);
    const abandonados = await sembrar('ABAND', 2, { attempts: 5 }); // agotados (AC-5)
    const hechos = await sembrar('HECHO', 3, { done: true });

    const ids = (await repo.claimBatch(100)).map((p) => p.id);

    // Los míos pendientes: todos presentes. Los abandonados y los hechos: ninguno.
    for (const id of pendientes) expect(ids).toContain(id);
    for (const id of [...abandonados, ...hechos]) expect(ids).not.toContain(id);
  });

  it('el claim empuja `next_attempt_at` al futuro en la MISMA sentencia', async () => {
    await sembrar('LEASE', 3);
    const antes = Date.now();

    const lote = await repo.claimBatch(3);

    const filas = await prisma.product.findMany({
      where: { id: { in: lote.map((p) => p.id) } },
      select: { enrichment_next_attempt_at: true },
    });
    for (const f of filas) {
      expect(f.enrichment_next_attempt_at).not.toBeNull();
      // Lease de 120 s: la fila queda arrendada hasta ~2 minutos en el futuro.
      expect(f.enrichment_next_attempt_at!.getTime()).toBeGreaterThan(antes + 60_000);
    }
  });

  it('dos claims concurrentes devuelven conjuntos DISJUNTOS', async () => {
    // La propiedad que hace que la corrección no dependa de tener una sola réplica.
    await sembrar('CONC', 10);

    const [a, b] = await Promise.all([repo.claimBatch(5), repo.claimBatch(5)]);

    const idsA = a.map((p) => p.id);
    const idsB = b.map((p) => p.id);
    const interseccion = idsA.filter((id) => idsB.includes(id));
    expect(interseccion).toEqual([]);
    expect(new Set([...idsA, ...idsB]).size).toBe(idsA.length + idsB.length);
  });

  it('un segundo claim inmediato no devuelve MIS filas: quedaron arrendadas', async () => {
    const ids = await sembrar('ARR', 4);

    const primero = (await repo.claimBatch(100)).map((p) => p.id);
    const segundo = (await repo.claimBatch(100)).map((p) => p.id);

    for (const id of ids) {
      expect(primero).toContain(id);
      expect(segundo).not.toContain(id);
    }
  });

  it('al vencer el lease las filas vuelven a ser elegibles solas (sin reaper)', async () => {
    // Es la auto-curación del trabajo huérfano: un proceso que muere no deja nada
    // trabado, sólo arrendado.
    const ids = await sembrar('VENC', 2);
    await repo.claimBatch(100);
    const arrendadas = (await repo.claimBatch(100)).map((p) => p.id);
    for (const id of ids) expect(arrendadas).not.toContain(id);

    await prisma.$executeRawUnsafe(
      `UPDATE products SET enrichment_next_attempt_at = now() - interval '1 minute' WHERE id = ANY($1::uuid[])`,
      ids,
    );

    const reelegibles = (await repo.claimBatch(100)).map((p) => p.id);
    for (const id of ids) expect(reelegibles).toContain(id);
  });

  it('respeta el tamaño del lote pedido', async () => {
    await sembrar('LOTE', 10);

    expect(await repo.claimBatch(3)).toHaveLength(3);
  });

  it('prioriza los NUNCA intentados sobre los que ya fallaron', async () => {
    // Un producto recién importado se enriquece antes que uno que ya falló tres veces:
    // el catálogo nuevo es el que el dueño está esperando ver.
    //
    // Se prueba la SELECCIÓN, no el orden del array: `UPDATE … RETURNING` no garantiza
    // el orden de las filas devueltas (el `ORDER BY` decide *cuáles* se arriendan). Así
    // que se arrienda de a una y se mira en qué turno aparece cada una de MIS filas.
    // Si alguien quitara el `NULLS FIRST`, Postgres ordenaría con `NULLS LAST` y el que
    // ya falló —con fecha en el pasado— se llevaría el turno antes: el test falla.
    const [yaFallo] = await sembrar('FALLO', 1, {
      attempts: 3,
      nextAttemptAt: new Date(Date.now() - 60_000),
    });
    const [nuevo] = await sembrar('NUEVO', 1);

    const turnos: string[] = [];
    for (let i = 0; i < 300 && turnos.length < 2; i += 1) {
      const lote = await repo.claimBatch(1);
      if (lote.length === 0) break;
      const id = lote[0].id;
      if (id === nuevo || id === yaFallo) turnos.push(id);
    }

    expect(turnos).toEqual([nuevo, yaFallo]);
  });

  it('el RETURNING trae exactamente los campos que el service necesita', async () => {
    const [id] = await sembrar('CAMPOS', 1);

    const lote = await repo.claimBatch(100);
    const p = lote.find((f) => f.id === id)!;

    expect(p).toBeDefined();
    expect(Object.keys(p).sort()).toEqual(
      [
        'id',
        'name',
        'description_raw',
        'description_enriched',
        'description_curated',
        'enrichment_source_hash',
        'enrichment_attempts',
        'category_id',
      ].sort(),
    );
  });

  describe('contadores del /status', () => {
    it('countPending cuenta los elegibles y countAbandoned los agotados', async () => {
      // Deltas, no totales: el Postgres es compartido con otras suites.
      const pendientesAntes = await repo.countPending();
      const abandonadosAntes = await repo.countAbandoned();

      await sembrar('P', 4);
      await sembrar('A', 2, { attempts: 5 });
      await sembrar('D', 3, { done: true });

      expect(await repo.countPending()).toBe(pendientesAntes + 4);
      expect(await repo.countAbandoned()).toBe(abandonadosAntes + 2);
    });

    it('un producto arrendado sigue contando como pendiente', async () => {
      // Arrendado no es hecho: si la corrida muere, ese producto sigue debiendo trabajo.
      const antes = await repo.countPending();
      await sembrar('ARR2', 3);
      await repo.claimBatch(100);

      expect(await repo.countPending()).toBe(antes + 3);
    });
  });
});
