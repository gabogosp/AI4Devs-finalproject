/**
 * QA-021-CT-1 — contrato de `POST /v1/admin/orders/{id}/anonymize` y
 * `POST /v1/admin/orders/retention-sweep` contra los dos yaml de
 * `openspec/changes/US-021-retencion-datos-ordenes-backend/contracts/openapi/`
 * (`OrderAnonymizationResult` / `RetentionSweepResult`, ambos con
 * `additionalProperties: false`), y contra las respuestas RFC 7807
 * (401/403/404/422/429) que esos mismos yaml declaran.
 *
 * Mismo patrón que `search.contract.ts`/`pago-manual.contract.ts` — script
 * `tsx` standalone (no jest/`--testPathPattern`, pese a lo que sugiere
 * `qa-plan.md` §5: mismo `Verify:` real que ya corrigió `pago-manual.contract.ts`),
 * corriendo contra un servidor REAL, nunca un mock ni un módulo de Nest en
 * memoria: valida lo que un cliente HTTP real recibe.
 *
 * El caso 429 necesita un presupuesto de rate-limit BAJO para poder agotarlo en
 * unas pocas llamadas — pero la API principal de la suite (`qa/scripts/api-up.sh`)
 * corre con `ORDER_ANONYMIZE_RATE_LIMIT_MAX`/`ORDER_RETENTION_SWEEP_RATE_LIMIT_MAX`
 * elevados a propósito (para que el resto de la suite no se autobloquee, ver el
 * comentario de esa variable en el script). Mismo criterio que TC-613
 * (`qa/acceptance/steps/importar.steps.ts`, rate-limit de imports): este script
 * levanta su PROPIA instancia efímera, con el límite bajo, sólo para el caso
 * 429, en un puerto dedicado — nunca toca la instancia compartida de la suite.
 * La instancia efímera se apaga sola al terminar `main()` (éxito o error).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import { adminAuth } from '../support/admin-auth';
import { seedOrdenesRetencion } from '../support/seed-orders-retention';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

const baseUrl = process.env.QA_API_BASE_URL ?? 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

const ANONYMIZATION_RESULT_KEYS = ['order_id', 'anonymized_at', 'anonymization_reason'];
const SWEEP_RESULT_KEYS = ['anonymized_count', 'reason'];

function validarOrderAnonymizationResult(caso: string, body: unknown): void {
  const keys = keysOf(body);
  for (const k of ANONYMIZATION_RESULT_KEYS) {
    assert(caso, keys.includes(k), `falta el campo requerido "${k}"`);
  }
  for (const k of keys) {
    assert(
      caso,
      ANONYMIZATION_RESULT_KEYS.includes(k),
      `campo no declarado en el schema (additionalProperties: false): "${k}"`,
    );
  }
  const b = body as Record<string, unknown>;
  assert(
    caso,
    typeof b.order_id === 'string' && UUID_RE.test(b.order_id),
    `"order_id" no es un UUID válido: ${JSON.stringify(b.order_id)}`,
  );
  assert(
    caso,
    typeof b.anonymized_at === 'string' && !Number.isNaN(Date.parse(b.anonymized_at)),
    `"anonymized_at" no es date-time ISO 8601 válido: ${JSON.stringify(b.anonymized_at)}`,
  );
  assert(
    caso,
    b.anonymization_reason === 'retention_policy' || b.anonymization_reason === 'requested',
    `"anonymization_reason" fuera del enum [retention_policy, requested]: ${JSON.stringify(b.anonymization_reason)}`,
  );
}

function validarRetentionSweepResult(caso: string, body: unknown): void {
  const keys = keysOf(body);
  for (const k of SWEEP_RESULT_KEYS) {
    assert(caso, keys.includes(k), `falta el campo requerido "${k}"`);
  }
  for (const k of keys) {
    assert(
      caso,
      SWEEP_RESULT_KEYS.includes(k),
      `campo no declarado en el schema (additionalProperties: false): "${k}"`,
    );
  }
  const b = body as Record<string, unknown>;
  assert(
    caso,
    Number.isInteger(b.anonymized_count) && (b.anonymized_count as number) >= 0,
    `"anonymized_count" debe ser integer >= 0: ${JSON.stringify(b.anonymized_count)}`,
  );
  assert(
    caso,
    b.reason === 'retention_policy',
    `"reason" fijo esperado "retention_policy", llegó ${JSON.stringify(b.reason)}`,
  );
}

function validarProblem(caso: string, body: unknown, tipoEsperado?: string): void {
  const keys = keysOf(body);
  for (const k of ['type', 'title', 'status', 'detail', 'instance']) {
    assert(caso, keys.includes(k), `Problem (RFC 7807) sin "${k}"`);
  }
  const b = body as Record<string, unknown>;
  if (tipoEsperado) {
    assert(caso, b.type === tipoEsperado, `"type" esperado "${tipoEsperado}", llegó "${b.type}"`);
  }
}

function tokenNoAdmin(): string {
  return jwt.sign({ role: 'customer', sub: 'qa-contract-no-admin' }, JWT_SECRET, {
    expiresIn: '1h',
  });
}

/**
 * Instancia efímera de la API con el rate-limit de retención BAJO — sólo para
 * el caso 429 (mismo criterio que TC-613, ver cabecera del archivo). Usa el
 * `dist` ya compilado (`pnpm --filter @dsm/api build`), el mismo `.env` de la
 * raíz del repo (mismo `DATABASE_URL`/`JWT_SECRET` — así el token minteado acá
 * también sirve contra ella) y un puerto dedicado para no colisionar con la
 * instancia principal de la suite.
 */
async function levantarInstanciaRateLimitBajo(): Promise<{
  baseUrl: string;
  proceso: ChildProcess;
}> {
  const puerto = Number(process.env.QA_RETENCION_LOWLIMIT_PORT ?? 3010);
  const main = path.join(REPO_ROOT, 'apps/api/dist/apps/api/src/main.js');
  const proceso = spawn(process.execPath, [main], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: String(puerto),
      AUTH_COOKIE_SECURE: 'false',
      TRUST_PROXY_HOPS: '1',
      LOG_LEVEL: 'warn',
      ORDER_ANONYMIZE_RATE_LIMIT_MAX: '1',
      ORDER_ANONYMIZE_RATE_LIMIT_TTL_MS: '60000',
      ORDER_RETENTION_SWEEP_RATE_LIMIT_MAX: '1',
      ORDER_RETENTION_SWEEP_RATE_LIMIT_TTL_MS: '60000',
    },
    stdio: 'ignore',
  });

  const baseBajo = `http://localhost:${puerto}`;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseBajo}/health`);
      if (res.ok) return { baseUrl: baseBajo, proceso };
    } catch {
      // todavía no levantó
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  proceso.kill();
  throw new Error(
    `[qa/retencion-ordenes.contract] la instancia de rate-limit bajo no respondió /health en ${baseBajo} tras 20s`,
  );
}

async function main(): Promise<void> {
  const adminToken = await adminAuth();

  // Siembra real (checkout real + confirm-payment, nunca INSERT directo) — una
  // orden "reciente" alcanza para los casos 200/idempotencia/401/403/422; el
  // barrido (sin filtro por id) no necesita una orden vencida para responder
  // 200 con anonymized_count=0.
  const seed = await seedOrdenesRetencion({ recientes: 1, token: adminToken });
  const orden = seed.recientes[0];

  // Caso 1 — POST :id/anonymize → 200, OrderAnonymizationResult (additionalProperties: false).
  {
    const res = await fetch(`${baseUrl}/v1/admin/orders/${orden.id}/anonymize`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert('POST :id/anonymize → 200', res.status === 200, `status ${res.status}`);
    if (res.status === 200) {
      validarOrderAnonymizationResult('POST :id/anonymize → 200', await res.json());
    }
  }

  // Caso 2 — repetir sobre la misma orden (AC-8): sigue siendo 200, mismo shape.
  {
    const res = await fetch(`${baseUrl}/v1/admin/orders/${orden.id}/anonymize`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert('POST :id/anonymize (repetido) → 200', res.status === 200, `status ${res.status}`);
    if (res.status === 200) {
      validarOrderAnonymizationResult('POST :id/anonymize (repetido) → 200', await res.json());
    }
  }

  // Caso 3 — 401 sin ningún token.
  {
    const res = await fetch(`${baseUrl}/v1/admin/orders/${orden.id}/anonymize`, {
      method: 'POST',
    });
    assert('401 sin token (anonymize)', res.status === 401, `status ${res.status}`);
    if (res.status === 401) validarProblem('401 sin token (anonymize)', await res.json());
  }

  // Caso 4 — 403 JWT válido, sin role=admin.
  {
    const res = await fetch(`${baseUrl}/v1/admin/orders/${orden.id}/anonymize`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tokenNoAdmin()}` },
    });
    assert('403 sesión no-admin (anonymize)', res.status === 403, `status ${res.status}`);
    if (res.status === 403) validarProblem('403 sesión no-admin (anonymize)', await res.json());
  }

  // Caso 5 — 404 orden inexistente (UUID con forma válida, sin fila en base).
  {
    const res = await fetch(
      `${baseUrl}/v1/admin/orders/00000000-0000-4000-8000-000000000000/anonymize`,
      { method: 'POST', headers: { authorization: `Bearer ${adminToken}` } },
    );
    assert('404 orden inexistente (anonymize)', res.status === 404, `status ${res.status}`);
    if (res.status === 404) {
      validarProblem('404 orden inexistente (anonymize)', await res.json(), 'dsm:checkout/order-not-found');
    }
  }

  // Caso 6 — 422 id con forma inválida (no UUID).
  {
    const res = await fetch(`${baseUrl}/v1/admin/orders/no-es-un-uuid/anonymize`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert('422 id no-UUID (anonymize)', res.status === 422, `status ${res.status}`);
    if (res.status === 422) validarProblem('422 id no-UUID (anonymize)', await res.json());
  }

  // Caso 7 — POST retention-sweep → 200, RetentionSweepResult.
  {
    const res = await fetch(`${baseUrl}/v1/admin/orders/retention-sweep`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert('POST retention-sweep → 200', res.status === 200, `status ${res.status}`);
    if (res.status === 200) {
      validarRetentionSweepResult('POST retention-sweep → 200', await res.json());
    }
  }

  // Caso 8 — 401 sin token (retention-sweep).
  {
    const res = await fetch(`${baseUrl}/v1/admin/orders/retention-sweep`, { method: 'POST' });
    assert('401 sin token (retention-sweep)', res.status === 401, `status ${res.status}`);
    if (res.status === 401) validarProblem('401 sin token (retention-sweep)', await res.json());
  }

  // Caso 9 — 403 sesión no-admin (retention-sweep).
  {
    const res = await fetch(`${baseUrl}/v1/admin/orders/retention-sweep`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tokenNoAdmin()}` },
    });
    assert('403 sesión no-admin (retention-sweep)', res.status === 403, `status ${res.status}`);
    if (res.status === 403) validarProblem('403 sesión no-admin (retention-sweep)', await res.json());
  }

  // Caso 10 y 11 — 429 en ambos endpoints, contra la instancia efímera de rate-limit bajo.
  {
    const { baseUrl: baseBajo, proceso } = await levantarInstanciaRateLimitBajo();
    try {
      const tokenBajo = jwt.sign({ role: 'admin', sub: 'qa-contract-lowlimit' }, JWT_SECRET, {
        expiresIn: '1h',
      });

      // anonymize: límite = 1/min. La 1ª consume el presupuesto (404 porque el id
      // no existe en esta instancia efímera — no importa, el throttle cuenta la
      // request igual, antes del handler); la 2ª debe ser 429.
      await fetch(`${baseBajo}/v1/admin/orders/00000000-0000-4000-8000-000000000000/anonymize`, {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenBajo}` },
      });
      const segundaAnonymize = await fetch(
        `${baseBajo}/v1/admin/orders/00000000-0000-4000-8000-000000000001/anonymize`,
        { method: 'POST', headers: { authorization: `Bearer ${tokenBajo}` } },
      );
      assert('429 anonymize', segundaAnonymize.status === 429, `status ${segundaAnonymize.status}`);
      if (segundaAnonymize.status === 429) {
        assert(
          '429 anonymize trae Retry-After',
          segundaAnonymize.headers.has('retry-after'),
          'falta el header Retry-After',
        );
        validarProblem('429 anonymize', await segundaAnonymize.json());
      }

      // retention-sweep: límite = 1/hora, mismo criterio.
      await fetch(`${baseBajo}/v1/admin/orders/retention-sweep`, {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenBajo}` },
      });
      const segundoSweep = await fetch(`${baseBajo}/v1/admin/orders/retention-sweep`, {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenBajo}` },
      });
      assert('429 retention-sweep', segundoSweep.status === 429, `status ${segundoSweep.status}`);
      if (segundoSweep.status === 429) {
        assert(
          '429 retention-sweep trae Retry-After',
          segundoSweep.headers.has('retry-after'),
          'falta el header Retry-After',
        );
        validarProblem('429 retention-sweep', await segundoSweep.json());
      }
    } finally {
      proceso.kill();
    }
  }

  if (fallas.length > 0) {
    console.error(`✗ ${fallas.length} incumplimiento(s) de contrato contra ${baseUrl}:`);
    for (const f of fallas) console.error(`  [${f.caso}] ${f.detalle}`);
    process.exit(1);
  }
  console.log(
    `✓ admin-orders-retention (anonymize + retention-sweep) conforma el contrato — 11/11 casos, ${baseUrl}`,
  );
}

void main();
