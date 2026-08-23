/**
 * Arnés de relevancia de la búsqueda semántica (US-004 T6.1/T6.2, AC-2).
 *
 * Corre un archivo de casos contra la búsqueda **real** —el mismo `SearchService` que sirve
 * `/v1/search`, no una simulación— y reporta qué fracción encuentra el producto esperado en el
 * top-5.
 *
 * Tres decisiones de diseño de este script, y las tres existen para que el número no engañe:
 *
 * 1. **No inventa datos.** Corre contra el catálogo que haya. Si el catálogo está vacío o sin
 *    vectores, el porcentaje va a ser bajo y eso **no** es un problema de relevancia: por eso lo
 *    primero que imprime es la **cobertura de embeddings**. Un 0 % con cobertura 0 % es un
 *    catálogo sin enriquecer, no un buscador malo, y confundir las dos cosas llevaría a
 *    recalibrar un umbral que está bien.
 * 2. **Distingue «no está en el catálogo» de «está mal rankeado».** Un `expected` que no existe
 *    como producto publicado se reporta como `slug_inexistente`, aparte de los fallos.
 * 3. **El gate muerde**: si el porcentaje queda por debajo de `SEARCH_RELEVANCE_TARGET`, sale
 *    con código ≠ 0. Un arnés que siempre sale con 0 no es un gate, es un reporte.
 *
 * Uso:
 *   pnpm --filter @dsm/api relevance
 *   pnpm --filter @dsm/api relevance -- --dry-run
 *   pnpm --filter @dsm/api relevance -- --sweep=0.4,0.5,0.55,0.6,0.7 --out=/tmp/sweep.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { InMemoryQueryVectorCache } from '../src/search/query-vector.cache';
import { QueryEmbedder } from '../src/search/query-embedder';
import { SearchRepository } from '../src/search/search.repository';
import { SearchService } from '../src/search/search.service';
import { searchEmbedderProvider } from '../src/search/search-embedder.provider';
import { AiEmbedder } from '../src/ai/ports/ai.ports';

interface Caso {
  id: string;
  clase: string;
  query: string;
  expected: string[];
  por_que?: string;
}

interface ResultadoCaso {
  id: string;
  clase: string;
  query: string;
  /** Un `expected` apareció en el top-5. */
  hit: boolean;
  /** El top-5 acertó **y** el sistema dijo estar seguro. Es lo que percibe el cliente. */
  hitConfiado: boolean;
  confidence: string;
  degraded: boolean;
  top5: string[];
  /** `expected` que no existen como producto publicado: dato del catálogo, no de relevancia. */
  slugsInexistentes: string[];
  /** Casos sin `expected`: sólo se exige que ofrezcan una salida (AC-3). */
  soloExigeFallback: boolean;
  ofreceFallback: boolean;
}

const TOP_N = 5;

function parseArgs(argv: string[]) {
  const arg = (nombre: string): string | undefined =>
    argv.find((a) => a.startsWith(`--${nombre}=`))?.split('=')[1];
  return {
    dryRun: argv.includes('--dry-run'),
    sweep: arg('sweep')?.split(',').map(Number).filter((n) => Number.isFinite(n)),
    out: arg('out'),
  };
}

/** Construye el servicio a mano: sin HTTP, sin throttler, mismo código de producción. */
function armarServicio(prisma: PrismaService, minScore: number) {
  const config = new ConfigService({}) as unknown as ConfigService;
  // `SEARCH_MIN_SCORE` se sobreescribe por barrido; el resto sale del entorno validado.
  process.env.SEARCH_MIN_SCORE = String(minScore);

  const embedder = (
    searchEmbedderProvider as unknown as {
      useFactory: (c: ConfigService) => AiEmbedder;
    }
  ).useFactory(config);

  return {
    servicio: new SearchService(
      new SearchRepository(prisma, config),
      new QueryEmbedder(embedder, config, new InMemoryQueryVectorCache(config)),
      config,
    ),
    embedderDisponible: embedder.available,
  };
}

async function coberturaDeEmbeddings(prisma: PrismaService) {
  const filas = await prisma.$queryRawUnsafe<
    Array<{ publicados: bigint; con_vector: bigint }>
  >(
    `SELECT (SELECT count(*) FROM products WHERE status = 'published')::bigint AS publicados,
            (SELECT count(*) FROM product_embeddings e
               JOIN products p ON p.id = e.product_id
              WHERE p.status = 'published')::bigint AS con_vector`,
  );
  const publicados = Number(filas[0].publicados);
  const conVector = Number(filas[0].con_vector);
  return {
    publicados,
    conVector,
    ratio: publicados === 0 ? 0 : conVector / publicados,
  };
}

async function slugsQueExisten(
  prisma: PrismaService,
  slugs: string[],
): Promise<Set<string>> {
  if (slugs.length === 0) return new Set();
  const filas = await prisma.$queryRawUnsafe<Array<{ slug: string }>>(
    `SELECT slug FROM products WHERE status = 'published' AND slug = ANY($1::text[])`,
    slugs,
  );
  return new Set(filas.map((f) => f.slug));
}

async function correrCasos(
  prisma: PrismaService,
  casos: Caso[],
  minScore: number,
): Promise<{ filas: ResultadoCaso[]; degradado: boolean }> {
  const { servicio } = armarServicio(prisma, minScore);
  const existentes = await slugsQueExisten(
    prisma,
    casos.flatMap((c) => c.expected),
  );

  const filas: ResultadoCaso[] = [];
  let degradado = false;

  for (const caso of casos) {
    const salida = await servicio.search(caso.query, TOP_N);
    const top5 = salida.results.slice(0, TOP_N).map((r) => r.slug);
    const hit = caso.expected.some((s) => top5.includes(s));
    degradado = degradado || salida.degraded;

    filas.push({
      id: caso.id,
      clase: caso.clase,
      query: caso.query,
      hit,
      hitConfiado: hit && salida.confidence === 'high',
      confidence: salida.confidence,
      degraded: salida.degraded,
      top5,
      slugsInexistentes: caso.expected.filter((s) => !existentes.has(s)),
      soloExigeFallback: caso.expected.length === 0,
      ofreceFallback: (salida.fallback?.suggested_categories.length ?? 0) > 0,
    });
  }

  return { filas, degradado };
}

/**
 * Porcentaje de acierto.
 *
 * Los casos **sin** `expected` (ambiguos y negative-match) no se cuentan como relevancia: lo que
 * se les exige es que ofrezcan una salida (AC-3), y eso se reporta aparte. Meterlos en el
 * promedio inflaría el número con casos que no miden relevancia.
 */
function porcentaje(filas: ResultadoCaso[], criterio: 'hit' | 'hitConfiado'): number {
  const medibles = filas.filter((f) => !f.soloExigeFallback);
  if (medibles.length === 0) return 0;
  return medibles.filter((f) => f[criterio]).length / medibles.length;
}

async function main(): Promise<void> {
  const { dryRun, sweep, out } = parseArgs(process.argv.slice(2));
  const objetivo = Number(process.env.SEARCH_RELEVANCE_TARGET ?? 0.7);

  const archivo = join(__dirname, 'relevance-cases.json');
  const casos: Caso[] = JSON.parse(readFileSync(archivo, 'utf8')).cases;

  const prisma = new PrismaService();
  await prisma.$connect();

  try {
    const cobertura = await coberturaDeEmbeddings(prisma);

    console.log('\n═══ Arnés de relevancia — US-004 AC-2 ═══\n');
    console.log(
      `embedding_coverage: ${cobertura.conVector}/${cobertura.publicados} productos publicados con vector (${(
        cobertura.ratio * 100
      ).toFixed(1)}%)`,
    );
    if (cobertura.ratio < 0.9) {
      console.log(
        '  ⚠ cobertura por debajo del 90%: un porcentaje bajo de acá abajo es un catálogo sin\n' +
          '    enriquecer, NO un problema de relevancia. Correr el enriquecimiento (US-005) primero.',
      );
    }
    console.log(`casos: ${casos.length}   top_n: ${TOP_N}   objetivo: ${objetivo}`);

    // --- Barrido de umbrales (T6.2) ---
    if (sweep && sweep.length > 0) {
      const rows: Array<Record<string, unknown>> = [];
      for (const umbral of sweep) {
        const { filas } = await correrCasos(prisma, casos, umbral);
        rows.push({
          threshold: umbral,
          pct: Number(porcentaje(filas, 'hitConfiado').toFixed(4)),
          pct_top5: Number(porcentaje(filas, 'hit').toFixed(4)),
          embedding_coverage: Number(cobertura.ratio.toFixed(4)),
        });
      }
      console.log('\n--- barrido de SEARCH_MIN_SCORE ---');
      console.log('umbral | % con confianza alta | % en top-5 (indep. del umbral)');
      for (const r of rows) {
        console.log(
          `  ${String(r.threshold).padEnd(5)} | ${String(
            ((r.pct as number) * 100).toFixed(1) + '%',
          ).padEnd(20)} | ${((r.pct_top5 as number) * 100).toFixed(1)}%`,
        );
      }
      if (out) {
        writeFileSync(out, JSON.stringify({ thresholds: sweep, rows }, null, 2));
        console.log(`\nbarrido escrito en ${out}`);
      }
      return;
    }

    // --- Corrida normal ---
    const minScore = Number(process.env.SEARCH_MIN_SCORE ?? 0.55);
    const { filas, degradado } = await correrCasos(prisma, casos, minScore);

    console.log(`\nSEARCH_MIN_SCORE: ${minScore}`);
    if (degradado) {
      console.log(
        '  ⚠ al menos un caso corrió DEGRADADO (sin proveedor de IA o sin cuota): lo que se está\n' +
          '    midiendo es el camino full-text, no la búsqueda semántica.',
      );
    }
    console.log('');

    for (const f of filas) {
      const marca = f.soloExigeFallback
        ? f.ofreceFallback
          ? '✓ (fallback)'
          : '✗ (sin salida)'
        : f.hit
          ? f.hitConfiado
            ? '✓'
            : '~ (acertó pero sin confianza)'
          : '✗';
      console.log(`${marca}  [${f.clase}] «${f.query}»`);
      console.log(`      confidence=${f.confidence} degraded=${f.degraded}`);
      console.log(`      top${TOP_N}: ${f.top5.length > 0 ? f.top5.join(', ') : '(vacío)'}`);
      if (f.slugsInexistentes.length > 0) {
        console.log(
          `      ⚠ slug_inexistente: ${f.slugsInexistentes.join(', ')} — el producto esperado NO está en el catálogo publicado, así que esto no mide relevancia`,
        );
      }
    }

    const pct = porcentaje(filas, 'hitConfiado');
    const pctTop5 = porcentaje(filas, 'hit');
    const sinSalida = filas.filter((f) => f.soloExigeFallback && !f.ofreceFallback);

    console.log('\n═══ Resultado ═══');
    console.log(`acierto en top-${TOP_N} con confianza alta: ${(pct * 100).toFixed(1)}%`);
    console.log(`acierto en top-${TOP_N} (sin exigir confianza): ${(pctTop5 * 100).toFixed(1)}%`);
    console.log(`objetivo (SEARCH_RELEVANCE_TARGET): ${(objetivo * 100).toFixed(1)}%`);
    if (sinSalida.length > 0) {
      console.log(
        `✗ ${sinSalida.length} caso(s) ambiguo(s) sin fallback — AC-3 exige ofrecer una salida siempre`,
      );
    }

    if (dryRun) {
      console.log('\n--dry-run: no se aplica el gate.');
      return;
    }

    if (pct < objetivo || sinSalida.length > 0) {
      console.log('\n✗ POR DEBAJO DEL OBJETIVO — exit 1');
      process.exitCode = 1;
      return;
    }
    console.log('\n✓ objetivo alcanzado');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('el arnés falló:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
