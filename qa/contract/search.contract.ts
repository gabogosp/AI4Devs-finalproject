/**
 * QA-004-CT-2 — contrato de GET /v1/search contra el OpenAPI publicado
 * (apps/api/docs/api/openapi.yaml, componente SearchResponse/SearchResult).
 *
 * Corre contra un servidor REAL (no un mock ni un módulo de Nest en memoria): valida
 * lo que un cliente HTTP real recibe, no lo que el código dice que devuelve.
 * `additionalProperties: false` en el spec es la razón por la que este script
 * también rechaza campos extra, no sólo faltantes — un campo de más sin detectar
 * es tan ruptura de contrato como uno de menos.
 */
const baseUrl = process.env.QA_API_BASE_URL ?? 'http://localhost:3000';

interface Falla {
  caso: string;
  detalle: string;
}

const fallas: Falla[] = [];

function assert(caso: string, cond: boolean, detalle: string): void {
  if (!cond) fallas.push({ caso, detalle });
}

function keysOf(o: unknown): string[] {
  return o && typeof o === 'object' ? Object.keys(o as object) : [];
}

const SEARCH_RESPONSE_KEYS = ['results', 'confidence', 'interpreted_as', 'degraded', 'fallback'];
const SEARCH_RESULT_KEYS = ['slug', 'name', 'price_ars_cents', 'in_stock', 'image_url', 'score'];
const FALLBACK_CATEGORY_KEYS = ['slug', 'name'];

function validarSearchResponse(caso: string, body: unknown): void {
  const keys = keysOf(body);
  assert(caso, keys.length > 0, 'la respuesta no es un objeto');
  for (const k of SEARCH_RESPONSE_KEYS) {
    assert(caso, keys.includes(k), `falta el campo requerido "${k}"`);
  }
  for (const k of keys) {
    assert(caso, SEARCH_RESPONSE_KEYS.includes(k), `campo no declarado en el schema: "${k}"`);
  }
  const b = body as Record<string, unknown>;

  assert(caso, Array.isArray(b.results), '"results" debe ser un array');
  assert(
    caso,
    ['high', 'low', 'none'].includes(b.confidence as string),
    `"confidence" fuera del enum: ${JSON.stringify(b.confidence)}`,
  );
  assert(
    caso,
    b.interpreted_as === null || typeof b.interpreted_as === 'string',
    '"interpreted_as" debe ser string o null',
  );
  assert(caso, typeof b.degraded === 'boolean', '"degraded" debe ser boolean');

  if (b.fallback !== null) {
    const fbKeys = keysOf(b.fallback);
    assert(caso, fbKeys.includes('suggested_categories'), 'fallback sin "suggested_categories"');
    for (const k of fbKeys) {
      assert(caso, k === 'suggested_categories', `campo no declarado en fallback: "${k}"`);
    }
    const cats = (b.fallback as Record<string, unknown>).suggested_categories;
    assert(caso, Array.isArray(cats) && cats.length >= 1, 'suggested_categories vacío (AC-3: nunca 0 resultados desnudo)');
    for (const cat of (cats as unknown[]) ?? []) {
      const ck = keysOf(cat);
      for (const k of FALLBACK_CATEGORY_KEYS) {
        assert(caso, ck.includes(k), `categoría sugerida sin "${k}"`);
      }
    }
  } else {
    assert(caso, b.confidence === 'high', 'fallback null exige confidence=high (spec)');
  }

  for (const r of (b.results as unknown[]) ?? []) {
    const rk = keysOf(r);
    for (const k of SEARCH_RESULT_KEYS) {
      assert(caso, rk.includes(k), `SearchResult sin "${k}"`);
    }
    for (const k of rk) {
      assert(caso, SEARCH_RESULT_KEYS.includes(k), `SearchResult con campo no declarado: "${k}"`);
    }
    const rr = r as Record<string, unknown>;
    assert(caso, typeof rr.slug === 'string', 'slug debe ser string');
    assert(caso, typeof rr.name === 'string', 'name debe ser string');
    assert(caso, Number.isInteger(rr.price_ars_cents), 'price_ars_cents debe ser integer');
    assert(caso, typeof rr.in_stock === 'boolean', 'in_stock debe ser boolean');
    assert(caso, rr.image_url === null || typeof rr.image_url === 'string', 'image_url debe ser string o null');
    assert(
      caso,
      typeof rr.score === 'number' && rr.score >= 0 && rr.score <= 1,
      `score fuera de [0,1]: ${rr.score}`,
    );
  }
}

function validarProblem(caso: string, body: unknown): void {
  const keys = keysOf(body);
  assert(caso, keys.includes('type'), 'Problem (RFC 7807) sin "type"');
  assert(caso, typeof (body as Record<string, unknown>).type === 'string', '"type" debe ser string');
}

async function main(): Promise<void> {
  // Caso 1 — 200 con resultado real (AC-1). "taco fischer" es un fixture estable
  // reusado por los e2e dev-owned de apps/api/src/search/*.spec.ts — no se crea uno
  // nuevo para no competir con el catálogo compartido del entorno de QA.
  {
    const res = await fetch(`${baseUrl}/v1/search?q=${encodeURIComponent('taco fischer')}`);
    assert('200 con resultado', res.status === 200, `status ${res.status}, esperaba 200`);
    if (res.status === 200) validarSearchResponse('200 con resultado', await res.json());
  }

  // Caso 2 — 200 sin resultados, nunca "0 resultados" desnudo (AC-3).
  {
    const res = await fetch(`${baseUrl}/v1/search?q=${encodeURIComponent('xyzzy foobar inexistente')}`);
    assert('200 sin resultados (fallback)', res.status === 200, `status ${res.status}, esperaba 200`);
    if (res.status === 200) validarSearchResponse('200 sin resultados (fallback)', await res.json());
  }

  // Caso 3 — 422 consulta demasiado corta (AC-5).
  {
    const res = await fetch(`${baseUrl}/v1/search?q=a`);
    assert('422 query-too-short', res.status === 422, `status ${res.status}, esperaba 422`);
    if (res.status === 422) validarProblem('422 query-too-short', await res.json());
  }

  // Caso 4 — 422 sin `q`.
  {
    const res = await fetch(`${baseUrl}/v1/search`);
    assert('422 sin q', res.status === 422, `status ${res.status}, esperaba 422`);
    if (res.status === 422) validarProblem('422 sin q', await res.json());
  }

  if (fallas.length > 0) {
    console.error(`✗ ${fallas.length} incumplimiento(s) de contrato contra ${baseUrl}:`);
    for (const f of fallas) console.error(`  [${f.caso}] ${f.detalle}`);
    process.exit(1);
  }
  console.log(`✓ GET /v1/search conforma el contrato (SearchResponse/SearchResult) — 4/4 casos, ${baseUrl}`);
}

void main();
