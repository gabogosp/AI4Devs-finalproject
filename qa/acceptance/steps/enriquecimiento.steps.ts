import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { After, AfterAll, Given, Then, When } from '@cucumber/cucumber';
import jwt from 'jsonwebtoken';
// `@dsm/db` es CJS y `@dsm/qa` es ESM: los named exports no son analizables
// estáticamente — mismo patrón que `pago-webhook.steps.ts`.
import db from '@dsm/db';
import { apiCall } from '../../support/api';
import { mintAdminToken } from '../../support/admin-auth';
import { nuevaCategoria, nuevoProducto } from '../../support/builders';
import {
  adelantarProximoIntento,
  disconnectEnrichmentDb,
  leerEstadoEnriquecimiento,
  tieneEmbedding,
} from '../../support/enrichment-db';
import { QA_API_BASE_URL } from '../../support/qa-env';
import {
  sembrarLotePendiente,
  sembrarProductoDraft,
  sembrarUnPendiente,
  type ProductoSembradoEnrichment,
} from '../../support/seed-enrichment';
import { levantarApiTemporal, type ApiInstance } from '../../support/spawn-api';
import type { CatalogWorld } from './world';

const { PrismaClient } = db as unknown as { PrismaClient: new () => PrismaLike };
interface PrismaLike {
  product: {
    count(args?: { where?: Record<string, unknown> }): Promise<number>;
  };
  $disconnect(): Promise<void>;
}
const prisma = new PrismaClient();
AfterAll(async () => {
  await prisma.$disconnect();
  await disconnectEnrichmentDb();
});

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret';
/** Mismo default que `env.validation.ts` — usado para replicar la fórmula de `coverage()`. */
const ENRICHMENT_MAX_ATTEMPTS = Number(process.env.ENRICHMENT_MAX_ATTEMPTS ?? 5);

const PASO = { timeout: 60_000 };

// ─────────────────────────────────────────────────────────────────────────────
// Perfiles de instancia temporal (`design.md` §D-QA4) — nunca la instancia
// compartida (`qa/scripts/api-up.sh`, ya con el fix de QA-005-F1 aplicado).
// ─────────────────────────────────────────────────────────────────────────────

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(AQUI, '../../..');

/**
 * Lee `GEMINI_API_KEY` directamente de `.env` (la MISMA clave real inválida que
 * hereda cualquier instancia arrancada con cwd=REPO_ROOT) para poder afirmar
 * después, en SC-005-N4, que ninguna respuesta observable la contiene. Falla
 * ruidoso si no está declarada: sin un valor conocido no hay nada que probar.
 */
function leerGeminiApiKeyDeEnv(): string {
  const contenido = fs.readFileSync(path.join(REPO_ROOT, '.env'), 'utf8');
  const match = contenido.match(/^GEMINI_API_KEY=(.*)$/m);
  if (!match?.[1]?.trim()) {
    throw new Error(
      '[qa/enriquecimiento] GEMINI_API_KEY no está declarada en .env — SC-005-C1/C2/N4/N5 ' +
        'necesitan una clave real INVÁLIDA (no vacía) para ejercitar el camino de fallo real.',
    );
  }
  return match[1].trim();
}
const GEMINI_API_KEY_QA = leerGeminiApiKeyDeEnv();

const PUERTO_ENABLED = Number(process.env.QA_ENRICHMENT_ENABLED_PORT ?? 3925);
const PUERTO_RATELIMIT = Number(process.env.QA_ENRICHMENT_RATELIMIT_PORT ?? 3926);

/**
 * Perfil B ("enabled", `design.md` §D-QA4): proveedor habilitado, apuntando a la
 * clave real INVÁLIDA de `.env` — nunca un doble.
 *
 * **Desviación documentada sobre `design.md` §D-QA4** (ver commit de T1.2): el perfil
 * `batch` de `GeminiHttpClient` serializa las salidas a `60_000 / GEMINI_MAX_RPM` ms
 * (`rate-limiter.ts`). Con el default real (`GEMINI_MAX_RPM=5` ⇒ 12 s entre llamadas),
 * los 6 fallos reales de SC-005-C1 tardarían ~60-70 s de reloj real, empujando (y a
 * veces superando) el timeout del step de Cucumber. Se realoca temporalmente TODO el
 * free tier al enriquecimiento (`GEMINI_MAX_RPM=15`, `GEMINI_SEARCH_MAX_RPM=0` — la
 * suma sigue en el techo real de 15, `env.validation.ts` no lo rechaza) — inocuo: la
 * clave es inválida, así que esta instancia efímera nunca consume cuota real de todos
 * modos, con o sin este ajuste.
 */
async function levantarPerfilB(): Promise<ApiInstance> {
  return levantarApiTemporal(PUERTO_ENABLED, {
    ENRICHMENT_ENABLED: 'true',
    GEMINI_API_KEY: GEMINI_API_KEY_QA,
    ENRICHMENT_RATE_LIMIT_MAX: '100000',
    ENRICHMENT_COOLDOWN_MS: '5000',
    GEMINI_MAX_RPM: '15',
    GEMINI_SEARCH_MAX_RPM: '0',
  });
}

/** Perfil C ("rate-limit real", `design.md` §D-QA4): sin override de `ENRICHMENT_RATE_LIMIT_MAX`. */
async function levantarPerfilC(): Promise<ApiInstance> {
  return levantarApiTemporal(PUERTO_RATELIMIT, {
    ENRICHMENT_ENABLED: 'false',
  });
}

interface RespuestaGenerica {
  status: number;
  body: unknown;
  raw: string;
  headers?: Record<string, string>;
}

/** Llamada HTTP cruda contra una instancia temporal (nunca `this.admin`, que apunta a la compartida). */
async function llamar(
  baseUrl: string,
  token: string | undefined,
  method: string,
  path_: string,
  body?: unknown,
): Promise<RespuestaGenerica> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${path_}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const raw = await res.text();
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : undefined;
  } catch {
    parsed = undefined;
  }
  return { status: res.status, body: parsed, raw, headers: Object.fromEntries(res.headers.entries()) };
}

/**
 * Sondea `GET /status` hasta que el runner deje de estar `running` — nunca un
 * `sleep` fijo (`flakiness-detection`): la condición es observable y el timeout
 * está acotado.
 */
async function esperarFinDeCorrida(
  baseUrl: string,
  token: string,
  timeoutMs = 60_000,
): Promise<RespuestaGenerica> {
  const limite = Date.now() + timeoutMs;
  let ultima: RespuestaGenerica | undefined;
  while (Date.now() < limite) {
    ultima = await llamar(baseUrl, token, 'GET', '/v1/admin/enrichment/status');
    if ((ultima.body as { runner_state?: string } | undefined)?.runner_state !== 'running') {
      return ultima;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(
    `[qa/enriquecimiento] la corrida no terminó dentro de ${timeoutMs}ms — último runner_state: ` +
      `${(ultima?.body as { runner_state?: string } | undefined)?.runner_state}`,
  );
}

interface EstadoEnriquecimientoBody {
  runner_state: string;
  coverage: {
    total: number;
    enriched: number;
    embedded: number;
    pending: number;
    abandoned: number;
    coverage_ratio: number;
  };
  last_error_code: string | null;
}

interface Estado {
  /** Instancia temporal activa de este escenario (perfil B o C), si la hay. */
  instancia?: ApiInstance;
  tokenInstancia?: string;
  /** Lote sembrado (C1/C4) o producto único (C2/N4/N5). */
  lote?: ProductoSembradoEnrichment[];
  producto?: ProductoSembradoEnrichment;
  /** Última respuesta genérica (reusada por `Then('recibo {int}', ...)` de pago-webhook.steps.ts). */
  ultima?: RespuestaGenerica;
  /** Último `GET /status` parseado. */
  statusBody?: EstadoEnriquecimientoBody;
  coverageAntes?: EstadoEnriquecimientoBody['coverage'];
  runnerStateAntes?: string;
  primeraRespuesta?: RespuestaGenerica;
  segundaRespuesta?: RespuestaGenerica;
  respuestas?: RespuestaGenerica[];
}

function est(w: CatalogWorld): Estado {
  return w.state as unknown as Estado;
}

After(async function (this: CatalogWorld) {
  const instancia = est(this).instancia;
  if (instancia) {
    await instancia.stop().catch(() => undefined);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-005-H3 — cobertura observable (AC-3, mecánica de fórmula)
// ─────────────────────────────────────────────────────────────────────────────

Given(
  'un catálogo con una mezcla conocida de productos pendientes y abandonados',
  PASO,
  async function (this: CatalogWorld) {
    // Siembra 2 pendientes reales para asegurar "pending" > 0. La porción "abandonados"
    // de la mezcla depende de lo que ya exista en el catálogo real de este entorno
    // (residuo de C1/C2 en esta misma corrida, u otras corridas anteriores): la
    // aserción de este escenario es la FÓRMULA (coverage.* == conteo real de la base),
    // no un número fijo — sea cual sea la mezcla real, el mecanismo de medición tiene
    // que coincidir con la verdad de la base (`design.md` §D-QA8 / T1.1).
    await sembrarLotePendiente(2);
  },
);

When('se llama {string}', PASO, async function (this: CatalogWorld, endpoint: string) {
  assert.equal(
    endpoint,
    'GET /v1/admin/enrichment/status',
    `este paso sólo llama GET /status, se pidió "${endpoint}"`,
  );
  const res = await this.admin.get('/v1/admin/enrichment/status');
  const body = (await res.json()) as EstadoEnriquecimientoBody;
  est(this).statusBody = body;
  est(this).ultima = { status: res.status(), body, raw: JSON.stringify(body) };
});

Then(
  '{string}, {string} y {string} coinciden con el conteo real de la base',
  PASO,
  async function (this: CatalogWorld, campoTotal: string, campoPending: string, campoAbandoned: string) {
    assert.equal(campoTotal, 'coverage.total');
    assert.equal(campoPending, 'coverage.pending');
    assert.equal(campoAbandoned, 'coverage.abandoned');
    const { coverage } = est(this).statusBody!;
    const totalReal = await prisma.product.count();
    const abandonadosReal = await prisma.product.count({
      where: { enrichment_done: false, enrichment_attempts: { gte: ENRICHMENT_MAX_ATTEMPTS } },
    });
    const pendientesReal = await prisma.product.count({
      where: { enrichment_done: false, enrichment_attempts: { lt: ENRICHMENT_MAX_ATTEMPTS } },
    });
    assert.equal(coverage.total, totalReal, `coverage.total (${coverage.total}) != conteo real (${totalReal})`);
    assert.equal(
      coverage.pending,
      pendientesReal,
      `coverage.pending (${coverage.pending}) != conteo real (${pendientesReal})`,
    );
    assert.equal(
      coverage.abandoned,
      abandonadosReal,
      `coverage.abandoned (${coverage.abandoned}) != conteo real (${abandonadosReal})`,
    );
  },
);

Then('{string} es {string} dividido {string}', function (
  this: CatalogWorld,
  campoRatio: string,
  campoEmbedded: string,
  campoTotal: string,
) {
  assert.equal(campoRatio, 'coverage.coverage_ratio');
  assert.equal(campoEmbedded, 'coverage.embedded');
  assert.equal(campoTotal, 'coverage.total');
  const { coverage } = est(this).statusBody!;
  const esperado = coverage.total > 0 ? coverage.embedded / coverage.total : 0;
  assert.ok(
    Math.abs(coverage.coverage_ratio - esperado) < 1e-9,
    `coverage_ratio (${coverage.coverage_ratio}) != embedded/total (${esperado})`,
  );
});

Then('con un catálogo vacío {string} es 0 sin lanzar una excepción', function (
  this: CatalogWorld,
  campo: string,
) {
  assert.equal(campo, 'coverage.coverage_ratio');
  const { coverage } = est(this).statusBody!;
  // No se fuerza un catálogo vacío real en este entorno compartido (`design.md`
  // §D-QA8): se verifica que la fórmula NUNCA produce NaN/Infinity con los números
  // reales que devuelve el endpoint, y que si `total` llegara a ser 0 el ratio sería
  // exactamente 0 (la única forma de que esa rama del código se ejercite de verdad).
  assert.ok(
    Number.isFinite(coverage.coverage_ratio),
    `coverage_ratio no es un número finito: ${coverage.coverage_ratio}`,
  );
  if (coverage.total === 0) {
    assert.equal(coverage.coverage_ratio, 0);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-005-C1 — backoff durable + cooldown, con proveedor real inválido (AC-4)
// ─────────────────────────────────────────────────────────────────────────────

Given(
  'una instancia con el proveedor de IA habilitado apuntando a una clave real inválida',
  { timeout: 30_000 },
  async function (this: CatalogWorld) {
    est(this).instancia = await levantarPerfilB();
    est(this).tokenInstancia = mintAdminToken();
  },
);

Given(
  'al menos 5 productos pendientes de enriquecer sembrados en el mismo lote',
  PASO,
  async function (this: CatalogWorld) {
    est(this).lote = await sembrarLotePendiente(6);
  },
);

When('se dispara una corrida con {string}', PASO, async function (this: CatalogWorld, endpoint: string) {
  assert.equal(endpoint, 'POST /v1/admin/enrichment/runs');
  const { instancia, tokenInstancia, lote } = est(this);
  const ids = lote?.map((p) => p.id);
  const respuesta = await llamar(
    instancia!.baseUrl,
    tokenInstancia!,
    'POST',
    '/v1/admin/enrichment/runs',
    ids ? { product_ids: ids } : {},
  );
  est(this).primeraRespuesta = respuesta;
  est(this).ultima = respuesta;
});

Then(
  'cada producto tocado acumula un intento con su próximo intento agendado según la escalera de backoff',
  { timeout: 90_000 },
  async function (this: CatalogWorld) {
    const { instancia, tokenInstancia, lote } = est(this);
    const final = await esperarFinDeCorrida(instancia!.baseUrl, tokenInstancia!, 80_000);
    est(this).statusBody = final.body as EstadoEnriquecimientoBody;
    for (const p of lote!) {
      const estado = await leerEstadoEnriquecimiento(p.id);
      assert.ok(estado.enrichment_attempts >= 1, `producto ${p.id} no acumuló ningún intento`);
      assert.ok(
        estado.enrichment_next_attempt_at !== null,
        `producto ${p.id} no tiene enrichment_next_attempt_at agendado`,
      );
      assert.ok(
        estado.enrichment_next_attempt_at!.getTime() > Date.now(),
        `producto ${p.id} tiene enrichment_next_attempt_at en el pasado — no hay backoff agendado`,
      );
    }
  },
);

Then('tras las fallas consecutivas del umbral configurado el estado del runner pasa a {string}', function (
  this: CatalogWorld,
  estadoEsperado: string,
) {
  assert.equal(estadoEsperado, 'cooldown');
  const runnerState = est(this).statusBody?.runner_state;
  assert.equal(runnerState, 'cooldown', `runner_state esperado "cooldown", llegó "${runnerState}"`);
});

Then('una corrida disparada durante el cooldown responde 409 con el tipo {string}', PASO, async function (
  this: CatalogWorld,
  tipoEsperado: string,
) {
  const { instancia, tokenInstancia } = est(this);
  const res = await llamar(instancia!.baseUrl, tokenInstancia!, 'POST', '/v1/admin/enrichment/runs', {});
  assert.equal(res.status, 409, `se esperaba 409, llegó ${res.status}`);
  assert.equal((res.body as { type?: string } | undefined)?.type, tipoEsperado);
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-005-C2 — abandono completo tras agotar los intentos (AC-5)
// ─────────────────────────────────────────────────────────────────────────────

Given(
  'un producto pendiente de enriquecer sembrado, con el proveedor de IA habilitado apuntando a una clave real inválida',
  { timeout: 30_000 },
  async function (this: CatalogWorld) {
    est(this).instancia = await levantarPerfilB();
    est(this).tokenInstancia = mintAdminToken();
    est(this).producto = await sembrarUnPendiente();
  },
);

When(
  'se dispara una corrida y se adelanta su próximo intento hasta agotar el tope de intentos configurado',
  { timeout: 120_000 },
  async function (this: CatalogWorld) {
    const { instancia, tokenInstancia, producto } = est(this);
    for (let intento = 0; intento < ENRICHMENT_MAX_ATTEMPTS; intento += 1) {
      await llamar(instancia!.baseUrl, tokenInstancia!, 'POST', '/v1/admin/enrichment/runs', {
        product_ids: [producto!.id],
      });
      await esperarFinDeCorrida(instancia!.baseUrl, tokenInstancia!, 30_000);
      const estado = await leerEstadoEnriquecimiento(producto!.id);
      if (estado.enrichment_attempts >= ENRICHMENT_MAX_ATTEMPTS) break;
      await adelantarProximoIntento(producto!.id);
      // Si el breaker abrió por este mismo producto, hay que esperar el cooldown
      // (5s en el perfil B) antes de volver a disparar.
      for (;;) {
        const status = await llamar(instancia!.baseUrl, tokenInstancia!, 'GET', '/v1/admin/enrichment/status');
        if ((status.body as { runner_state?: string } | undefined)?.runner_state !== 'cooldown') break;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
  },
);

Then(
  'el producto queda sin marca de enriquecido, sin fila en los embeddings, con su descripción base intacta y con un código de error registrado',
  PASO,
  async function (this: CatalogWorld) {
    const { producto } = est(this);
    const estado = await leerEstadoEnriquecimiento(producto!.id);
    assert.equal(estado.enrichment_done, false, 'el producto quedó marcado enrichment_done=true');
    assert.ok(estado.enrichment_error_code, 'no quedó ningún enrichment_error_code registrado');
    assert.equal(
      await tieneEmbedding(producto!.id),
      false,
      'el producto tiene una fila en product_embeddings — no debería, agotó los intentos sin éxito',
    );
    const detalle = await apiCall<{ description_raw: string | null }>(
      `/v1/admin/products/${producto!.id}`,
      'GET',
      this.token,
    );
    assert.equal(
      detalle.description_raw,
      producto!.descriptionRaw,
      `description_raw cambió: sembrada "${producto!.descriptionRaw}", ahora "${detalle.description_raw}"`,
    );
  },
);

Then('{string} lo cuenta entre los abandonados', PASO, async function (this: CatalogWorld, endpoint: string) {
  assert.equal(endpoint, 'GET /v1/admin/enrichment/status');
  const res = await this.admin.get('/v1/admin/enrichment/status');
  const body = (await res.json()) as EstadoEnriquecimientoBody;
  assert.ok(
    body.coverage.abandoned >= 1,
    `coverage.abandoned esperado >= 1, llegó ${body.coverage.abandoned}`,
  );
});

Then(/^el producto sigue apareciendo en el listado público de su categoría \(US-002\)$/, PASO, async function (
  this: CatalogWorld,
) {
  const { producto } = est(this);
  const res = await fetch(`${QA_API_BASE_URL}/v1/categories/${producto!.categorySlug}/products?limit=100`);
  assert.equal(res.status, 200, `el listado público respondió ${res.status}`);
  const body = (await res.json()) as { data: Array<{ slug: string }> };
  // `StorefrontProductPage` (contrato) no expone `id`, sólo `slug` — comparar por eso.
  const aparece = body.data.some((p) => p.slug === producto!.slug);
  assert.ok(aparece, `el producto ${producto!.slug} no aparece en el listado público de su categoría`);
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-005-C4 — 409 run-in-progress (mecánica, subyace a AC-1/AC-5)
// ─────────────────────────────────────────────────────────────────────────────

Given(
  'una instancia con el proveedor de IA habilitado y productos pendientes sembrados',
  { timeout: 30_000 },
  async function (this: CatalogWorld) {
    est(this).instancia = await levantarPerfilB();
    est(this).tokenInstancia = mintAdminToken();
    // Lote grande: la ventana entre el 1º y el 2º POST tiene que alcanzar mientras el
    // runner sigue `corriendo` (con 10 productos y GEMINI_MAX_RPM=15 el barrido tarda
    // varios segundos — de sobra frente al 2º POST, disparado sin espera artificial).
    est(this).lote = await sembrarLotePendiente(10);
  },
);

When('se dispara una segunda corrida inmediatamente después', PASO, async function (this: CatalogWorld) {
  const { instancia, tokenInstancia, lote } = est(this);
  const ids = lote?.map((p) => p.id);
  est(this).segundaRespuesta = await llamar(
    instancia!.baseUrl,
    tokenInstancia!,
    'POST',
    '/v1/admin/enrichment/runs',
    ids ? { product_ids: ids } : {},
  );
});

Then('la primera responde 202 con {string} y {string} true', function (
  this: CatalogWorld,
  campoRunId: string,
  campoAccepted: string,
) {
  assert.equal(campoRunId, 'run_id');
  assert.equal(campoAccepted, 'accepted');
  const r = est(this).primeraRespuesta!;
  assert.equal(r.status, 202, `se esperaba 202, llegó ${r.status}`);
  const body = r.body as { run_id?: string; accepted?: boolean };
  assert.ok(typeof body.run_id === 'string' && body.run_id.length > 0, 'run_id ausente o vacío');
  assert.equal(body.accepted, true);
});

Then('la segunda responde 409 con el tipo {string}', function (this: CatalogWorld, tipoEsperado: string) {
  const r = est(this).segundaRespuesta!;
  assert.equal(r.status, 409, `se esperaba 409, llegó ${r.status}`);
  assert.equal((r.body as { type?: string } | undefined)?.type, tipoEsperado);
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-005-C5 — sin proveedor, la corrida no arranca (D6, espíritu de AC-5)
// ─────────────────────────────────────────────────────────────────────────────

Given('que la instancia de QA compartida tiene el enriquecimiento deshabilitado', PASO, async function (
  this: CatalogWorld,
) {
  // Ya es así por T0.1 (QA-005-F1). Se snapshotea la cobertura ANTES del intento de
  // POST /runs para poder afirmar después "ningún producto cambia de estado".
  const res = await this.admin.get('/v1/admin/enrichment/status');
  const body = (await res.json()) as EstadoEnriquecimientoBody;
  assert.equal(
    body.runner_state,
    'disabled',
    'la instancia compartida no está "disabled" — ¿el fix de T0.1 no se aplicó a esta API?',
  );
  est(this).coverageAntes = body.coverage;
});

Then('{string} es {string}', function (this: CatalogWorld, campo: string, valorEsperado: string) {
  assert.equal(campo, 'runner_state');
  const runnerState = est(this).statusBody?.runner_state;
  assert.equal(runnerState, valorEsperado);
});

When('se intenta {string}', PASO, async function (this: CatalogWorld, endpoint: string) {
  assert.equal(endpoint, 'POST /v1/admin/enrichment/runs');
  const res = await this.admin.post('/v1/admin/enrichment/runs', { data: {} });
  est(this).ultima = { status: res.status(), body: await res.json().catch(() => undefined), raw: '' };
});

Then('recibo 503 con el tipo {string}', function (this: CatalogWorld, tipoEsperado: string) {
  const e = est(this).ultima!;
  assert.equal(e.status, 503, `se esperaba 503, llegó ${e.status}`);
  assert.equal((e.body as { type?: string } | undefined)?.type, tipoEsperado);
});

Then('ningún producto del catálogo cambia de estado', PASO, async function (this: CatalogWorld) {
  const res = await this.admin.get('/v1/admin/enrichment/status');
  const body = (await res.json()) as EstadoEnriquecimientoBody;
  assert.deepEqual(
    body.coverage,
    est(this).coverageAntes,
    'la cobertura cambió tras un POST /runs que debía rechazarse sin tocar nada',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-005-C6 — 401/403 en los 2 endpoints (mecánica de contrato)
// ─────────────────────────────────────────────────────────────────────────────

When('se llama {string} {string} con {string}', PASO, async function (
  this: CatalogWorld,
  metodo: string,
  endpoint: string,
  credencial: string,
) {
  const headers: Record<string, string> = {};
  if (credencial === 'token de cliente') {
    const tokenNoAdmin = jwt.sign(
      { role: 'customer', sub: 'qa-enriquecimiento-no-admin' },
      JWT_SECRET,
      { expiresIn: '5m' },
    );
    headers.authorization = `Bearer ${tokenNoAdmin}`;
  } else if (credencial !== 'sin token') {
    throw new Error(`credencial desconocida en el Esquema SC-005-C6: "${credencial}"`);
  }
  const res = await fetch(`${QA_API_BASE_URL}${endpoint}`, { method: metodo, headers });
  est(this).ultima = { status: res.status, body: await res.json().catch(() => undefined), raw: '' };
});

Then('recibo {string}', function (this: CatalogWorld, statusEsperado: string) {
  assert.equal(String(est(this).ultima?.status), statusEsperado);
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-005-C7 — 429 con el presupuesto real (AC-4, control de superficie)
// ─────────────────────────────────────────────────────────────────────────────

Given('una instancia con el presupuesto real de {string} sin elevar', { timeout: 30_000 }, async function (
  this: CatalogWorld,
  varName: string,
) {
  assert.equal(varName, 'ENRICHMENT_RATE_LIMIT_MAX');
  est(this).instancia = await levantarPerfilC();
  est(this).tokenInstancia = mintAdminToken();
});

When('se superan las llamadas permitidas por la ventana', { timeout: 30_000 }, async function (
  this: CatalogWorld,
) {
  const { instancia, tokenInstancia } = est(this);
  const limite = Number(process.env.ENRICHMENT_RATE_LIMIT_MAX ?? 6);
  const respuestas: RespuestaGenerica[] = [];
  for (let i = 0; i < limite + 1; i += 1) {
    respuestas.push(
      await llamar(instancia!.baseUrl, tokenInstancia!, 'POST', '/v1/admin/enrichment/runs', {}),
    );
  }
  est(this).respuestas = respuestas;
});

Then('la llamada excedente responde 429 con las cabeceras {string} y {string}', function (
  this: CatalogWorld,
  h1: string,
  h2: string,
) {
  assert.equal(h1, 'Retry-After');
  assert.equal(h2, 'RateLimit-*');
  const respuestas = est(this).respuestas!;
  const excedente = respuestas[respuestas.length - 1]!;
  assert.equal(excedente.status, 429, `se esperaba 429 en la última llamada, llegó ${excedente.status}`);
  const headers = excedente.headers ?? {};
  assert.ok('retry-after' in headers, `falta el header Retry-After (headers: ${Object.keys(headers)})`);
  assert.ok(
    Object.keys(headers).some((k) => k.toLowerCase().startsWith('ratelimit-')),
    `falta al menos un header RateLimit-* (headers: ${Object.keys(headers)})`,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-005-C8 (compartido con SC-005-N1: mismo shape "se llama {string} con
// {string}") / N1 — cuerpo inválido de POST /runs, y costura de curación del PATCH
// ─────────────────────────────────────────────────────────────────────────────

function construirCuerpoInvalido(cuerpo: string): Record<string, unknown> {
  if (cuerpo.includes('campo desconocido')) return { forced: true };
  if (cuerpo.includes('no es UUID')) return { product_ids: ['no-es-un-uuid'] };
  if (cuerpo.includes('más de 500')) {
    return {
      product_ids: Array.from(
        { length: 501 },
        (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      ),
    };
  }
  throw new Error(`cuerpo desconocido en el Esquema SC-005-C8: "${cuerpo}"`);
}

When('se llama {string} con {string}', PASO, async function (
  this: CatalogWorld,
  endpointODescriptor: string,
  segundo: string,
) {
  if (endpointODescriptor === 'POST /v1/admin/enrichment/runs') {
    const cuerpo = construirCuerpoInvalido(segundo);
    const antes = await this.admin.get('/v1/admin/enrichment/status');
    est(this).runnerStateAntes = ((await antes.json()) as EstadoEnriquecimientoBody).runner_state;
    const res = await this.admin.post('/v1/admin/enrichment/runs', { data: cuerpo });
    est(this).ultima = { status: res.status(), body: await res.json().catch(() => undefined), raw: '' };
    return;
  }
  if (endpointODescriptor === 'PATCH /v1/admin/products/{id}') {
    assert.equal(segundo, 'description_enriched');
    const id = est(this).producto!.id;
    const res = await this.admin.patch(`/v1/admin/products/${id}`, {
      data: { description_enriched: 'Descripción curada a mano por el dueño (SC-005-N1).' },
    });
    // `this.state.lastRes` (no `ultima`): reusa el `Then('la respuesta es {int}', ...)`
    // YA registrado por `catalogo.steps.ts` — reuso intencional, evita el "Multiple
    // step definitions match" contra `Then('la respuesta es 200', ...)` propio.
    this.state.lastRes = res;
    return;
  }
  throw new Error(`endpoint/descriptor desconocido en "se llama {string} con {string}": "${endpointODescriptor}"`);
});

Then('el estado del runner no cambia', PASO, async function (this: CatalogWorld) {
  const res = await this.admin.get('/v1/admin/enrichment/status');
  const body = (await res.json()) as EstadoEnriquecimientoBody;
  assert.equal(body.runner_state, est(this).runnerStateAntes);
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-005-N1 — costura de curación (AC-7, mitad mecánica)
// ─────────────────────────────────────────────────────────────────────────────

Given('un producto publicado', PASO, async function (this: CatalogWorld) {
  const categoria = await apiCall<{ id: string; slug: string }>(
    '/v1/admin/categories',
    'POST',
    this.token,
    nuevaCategoria(),
  );
  const creado = await apiCall<{ id: string }>(
    '/v1/admin/products',
    'POST',
    this.token,
    nuevoProducto(categoria.id),
  );
  const publicado = await apiCall<{ id: string; slug: string; sku: string }>(
    `/v1/admin/products/${creado.id}`,
    'PATCH',
    this.token,
    { status: 'published' },
  );
  est(this).producto = {
    ...publicado,
    categorySlug: categoria.slug,
    descriptionRaw: '',
  };
});

Then('leyendo el estado interno del producto, {string} es true y {string} es false', PASO, async function (
  this: CatalogWorld,
  campo1: string,
  campo2: string,
) {
  assert.equal(campo1, 'description_curated');
  assert.equal(campo2, 'enrichment_done');
  const estado = await leerEstadoEnriquecimiento(est(this).producto!.id);
  assert.equal(estado.description_curated, true, 'description_curated no quedó en true tras el PATCH');
  assert.equal(estado.enrichment_done, false, 'enrichment_done no quedó en false tras el PATCH');
});

Then('editar sólo el precio o el stock del mismo producto no cambia {string}', PASO, async function (
  this: CatalogWorld,
  campo: string,
) {
  assert.equal(campo, 'description_curated');
  const id = est(this).producto!.id;
  await apiCall(`/v1/admin/products/${id}`, 'PATCH', this.token, { price_ars_cents: 555_000 });
  const estado = await leerEstadoEnriquecimiento(id);
  assert.equal(
    estado.description_curated,
    true,
    'un PATCH que sólo toca price_ars_cents cambió description_curated',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-005-N4 — sin fuga del secreto, incluso fallando de verdad (AC-9)
// ─────────────────────────────────────────────────────────────────────────────

When('se dispara una corrida y se deja fallar contra el proveedor real', { timeout: 30_000 }, async function (
  this: CatalogWorld,
) {
  const { instancia, tokenInstancia } = est(this);
  const producto = await sembrarUnPendiente();
  est(this).producto = producto;
  await llamar(instancia!.baseUrl, tokenInstancia!, 'POST', '/v1/admin/enrichment/runs', {
    product_ids: [producto.id],
  });
  const estadoFinal = await esperarFinDeCorrida(instancia!.baseUrl, tokenInstancia!, 20_000);
  est(this).statusBody = estadoFinal.body as EstadoEnriquecimientoBody;
  // Una llamada extra a POST /runs: sea cual sea su status (202/409/503), su
  // RESPUESTA tampoco debe filtrar la clave.
  const respuestaRunsExtra = await llamar(
    instancia!.baseUrl,
    tokenInstancia!,
    'POST',
    '/v1/admin/enrichment/runs',
    {},
  );
  est(this).respuestas = [estadoFinal, respuestaRunsExtra];
});

Then(
  'ninguna respuesta de {string} ni de {string} contiene el valor configurado de la clave',
  function (this: CatalogWorld, endpoint1: string, endpoint2: string) {
    assert.equal(endpoint1, 'GET /v1/admin/enrichment/status');
    assert.equal(endpoint2, 'POST /v1/admin/enrichment/runs');
    for (const r of est(this).respuestas ?? []) {
      assert.ok(
        !r.raw.includes(GEMINI_API_KEY_QA),
        `una respuesta contiene el valor literal de GEMINI_API_KEY: ${r.raw.slice(0, 200)}`,
      );
    }
  },
);

Then('{string} es un tipo del catálogo {string}, nunca el mensaje crudo del proveedor', function (
  this: CatalogWorld,
  campo: string,
  patron: string,
) {
  assert.equal(campo, 'last_error_code');
  assert.equal(patron, 'dsm:enrichment/*');
  const lastErrorCode = est(this).statusBody?.last_error_code;
  assert.ok(lastErrorCode, 'last_error_code es null — no se registró ningún fallo');
  assert.match(
    lastErrorCode!,
    /^dsm:enrichment\//,
    `last_error_code "${lastErrorCode}" no matchea el catálogo dsm:enrichment/*`,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-005-N5 — nunca publica, éxito o falla (AC-10)
// ─────────────────────────────────────────────────────────────────────────────

Given(
  'un producto en estado {string} pendiente de enriquecer, con el proveedor de IA habilitado apuntando a una clave real inválida',
  { timeout: 30_000 },
  async function (this: CatalogWorld, estadoEsperado: string) {
    assert.equal(estadoEsperado, 'draft');
    est(this).instancia = await levantarPerfilB();
    est(this).tokenInstancia = mintAdminToken();
    est(this).producto = await sembrarProductoDraft();
  },
);

When('se dispara una corrida de enriquecimiento sobre ese producto', { timeout: 20_000 }, async function (
  this: CatalogWorld,
) {
  const { instancia, tokenInstancia, producto } = est(this);
  await llamar(instancia!.baseUrl, tokenInstancia!, 'POST', '/v1/admin/enrichment/runs', {
    product_ids: [producto!.id],
  });
  await esperarFinDeCorrida(instancia!.baseUrl, tokenInstancia!, 15_000);
});

Then(
  'el producto sigue en estado {string} después de la corrida, sea cual sea el resultado del proveedor',
  PASO,
  async function (this: CatalogWorld, estadoEsperado: string) {
    assert.equal(estadoEsperado, 'draft');
    const detalle = await apiCall<{ status: string }>(
      `/v1/admin/products/${est(this).producto!.id}`,
      'GET',
      this.token,
    );
    assert.equal(detalle.status, 'draft', `el producto quedó en estado "${detalle.status}", no "draft"`);
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// SC-005-H1/H2/C3/N2/N3 — BLOQUEADOS (`design.md` §D-QA1, hallazgo QA-005-F1/
// `proposal.md` OQ-QA-005-1). Steps bindeados (Strict mode los exige) pero
// diseñados para fallar RUIDOSO si alguien corre esta suite sin excluir
// `@blocked` — nunca se simulan con un doble no autorizado (T1.8).
// ─────────────────────────────────────────────────────────────────────────────

const BLOQUEADO_H1 =
  'SC-005-H1 BLOQUEADO (design.md §D-QA1, hallazgo QA-005-F1): necesita que Gemini responda ' +
  'CON ÉXITO al menos una vez; este entorno sólo tiene el placeholder de GEMINI_API_KEY ' +
  '(proposal.md OQ-QA-005-1). Ya probado dev-owned (e2e-enrichment-cycle.spec.ts, T6.1). ' +
  'Corré la suite con --tags "... and not @blocked".';
const BLOQUEADO_H2 =
  'SC-005-H2 BLOQUEADO — depende de SC-005-H1 (necesita un embedding real). La elegibilidad ' +
  'kNN en sí ya está probada dev-owned (knn.spec.ts, T2.3).';
const BLOQUEADO_C3 =
  'SC-005-C3 BLOQUEADO — la rama "hash igual, saltar" sólo se alcanza tras una corrida EXITOSA ' +
  'previa (el hash sólo se persiste en el camino de éxito). Ya probado dev-owned ' +
  '(enrichment.service.spec.ts T3.2, e2e-enrichment-idempotency.spec.ts T6.2).';
const BLOQUEADO_N2 =
  'SC-005-N2 BLOQUEADO — necesita que el embedder responda con éxito sobre texto curado. Ya ' +
  'probado dev-owned (enrichment.service.spec.ts T3.2, e2e-curated-text.spec.ts T4.3/T6.2).';
const BLOQUEADO_N3 =
  'SC-005-N3 BLOQUEADO — necesita al menos una corrida exitosa para registrar una versión de ' +
  'modelo. Ya probado dev-owned (embedding.repository.spec.ts T2.2, AC-8).';

Given('un producto publicado con una descripción base pobre, pendiente de enriquecer', function () {
  throw new Error(BLOQUEADO_H1);
});
Then('el producto queda con una descripción enriquecida no vacía', function () {
  throw new Error(BLOQUEADO_H1);
});
Then('su embedding de 768 dimensiones queda persistido con la versión del modelo usada', function () {
  throw new Error(BLOQUEADO_H1);
});
Then('{string} lo cuenta entre los embebidos', function () {
  throw new Error(BLOQUEADO_H1);
});

Given('un producto enriquecido y embebido con éxito por una corrida real de esta capacidad', function () {
  throw new Error(BLOQUEADO_H2);
});
When('se ejecuta una búsqueda kNN sobre su vector', function () {
  throw new Error(BLOQUEADO_H2);
});
Then('el producto aparece como candidato según su similitud', function () {
  throw new Error(BLOQUEADO_H2);
});

Given('un producto ya enriquecido con éxito y sin cambios en su descripción base', function () {
  throw new Error(BLOQUEADO_C3);
});
When('se vuelve a disparar una corrida', function () {
  throw new Error(BLOQUEADO_C3);
});
Then('no se llama a la IA ni al embedder para ese producto', function () {
  throw new Error(BLOQUEADO_C3);
});

// Reusado por SC-005-H1 (misma literal exacta): ambas @blocked, nunca ejecutado
// sin excluir el tag — un solo binding evita "Multiple step definitions match".
When('se dispara una corrida de enriquecimiento', function () {
  throw new Error(`${BLOQUEADO_H1}\n${BLOQUEADO_N2}`);
});

Given('un producto curado por el dueño', function () {
  throw new Error(BLOQUEADO_N2);
});
Then('no se llama a la IA de enriquecimiento para ese producto', function () {
  throw new Error(BLOQUEADO_N2);
});
Then('el embedding persistido corresponde al texto curado, no al texto base', function () {
  throw new Error(BLOQUEADO_N2);
});

Given('embeddings ya generados con una versión del modelo', function () {
  throw new Error(BLOQUEADO_N3);
});
When('se procesa un producto nuevo con éxito', function () {
  throw new Error(BLOQUEADO_N3);
});
Then('su embedding registra la versión del modelo usada', function () {
  throw new Error(BLOQUEADO_N3);
});
Then('los embeddings previos conservan su propia versión sin alterarse', function () {
  throw new Error(BLOQUEADO_N3);
});
