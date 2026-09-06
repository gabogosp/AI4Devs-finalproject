/**
 * QA-010-CT-1 (qa-plan.md §6) — contrato de los 5 endpoints nuevos de US-010
 * contra el OpenAPI VIVO de `pagos` (`openspec/specs/pagos/contracts/openapi.yaml`
 * + `openapi/paths/{webhook-mercadopago,simulate-payment,reconcile-payments,
 * cleanup-abandoned-orders,retry-refunds}.yaml`), no el draft ya archivado del
 * change de backend — `design.md` §D-QA6.
 *
 * Mismo patrón que `pago-manual.contract.ts` (script `tsx` standalone con
 * `fetch`, sin jest ni `--testPathPattern`): corre contra un servidor REAL.
 *
 * **429 (rate limit de `simulate-payment`) no se ejercita acá**: el entorno de
 * QA (`qa/scripts/api-up.sh`) eleva `PAYMENTS_SIMULATE_RATE_LIMIT_MAX` a
 * propósito (la suite de aceptación hace varias confirmaciones reales por
 * escenario) — mismo criterio ya aplicado por este mismo harness a
 * `CART_WRITE_RATE_LIMIT_MAX`/`AUTH_RATE_LIMIT_MAX`: el límite real sigue
 * cubierto dev-owned (`simulate-payment.controller.spec.ts`), sin gap de
 * cobertura, sólo de capa.
 */
import jwt from 'jsonwebtoken';
import { firmaConSecretoEquivocado } from '../support/mercadopago-signature';
import { adminAuth } from '../support/admin-auth';
import { seedPendingPaymentOrder } from '../support/seed-pending-payment-order';

const baseUrl = process.env.QA_API_BASE_URL ?? 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret';
const MP_WEBHOOK_SECRET_QA = process.env.MP_WEBHOOK_SECRET ?? '';

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

const PAYMENT_CONFIRMED_KEYS = ['order_number', 'status'];
const RECONCILE_RESULT_KEYS = ['scanned', 'confirmed', 'stillPending'];
const CLEANUP_RESULT_KEYS = ['cancelled'];
const RETRY_REFUNDS_RESULT_KEYS = ['attempted', 'succeeded', 'failed'];

function validarPaymentConfirmed(caso: string, body: unknown): void {
  const keys = keysOf(body);
  for (const k of PAYMENT_CONFIRMED_KEYS) {
    assert(caso, keys.includes(k), `falta el campo requerido "${k}"`);
  }
  for (const k of keys) {
    assert(caso, PAYMENT_CONFIRMED_KEYS.includes(k), `campo no declarado en el schema: "${k}"`);
  }
  const b = body as Record<string, unknown>;
  assert(caso, Number.isInteger(b.order_number), 'order_number debe ser integer');
  assert(caso, b.status === 'new', `"status" fuera del enum [new]: ${JSON.stringify(b.status)}`);
}

function validarProblem(caso: string, body: unknown, tipoEsperado?: string): void {
  const keys = keysOf(body);
  for (const k of ['type', 'title', 'status']) {
    assert(caso, keys.includes(k), `Problem (RFC 7807) sin "${k}"`);
  }
  const b = body as Record<string, unknown>;
  if (tipoEsperado) {
    assert(caso, b.type === tipoEsperado, `"type" esperado "${tipoEsperado}", llegó "${b.type}"`);
  }
}

function validarShapeExacta(caso: string, body: unknown, keysEsperadas: string[]): void {
  const keys = keysOf(body);
  for (const k of keysEsperadas) {
    assert(caso, keys.includes(k), `falta el campo requerido "${k}"`);
  }
  for (const k of keys) {
    assert(caso, keysEsperadas.includes(k), `campo no declarado en el schema: "${k}"`);
  }
  const b = body as Record<string, unknown>;
  for (const k of keysEsperadas) {
    assert(caso, Number.isInteger(b[k]), `"${k}" debe ser integer, llegó ${JSON.stringify(b[k])}`);
  }
}

async function main(): Promise<void> {
  const adminToken = await adminAuth();
  const tokenNoAdmin = jwt.sign(
    { role: 'customer', sub: 'qa-contract-no-admin' },
    JWT_SECRET,
    { expiresIn: '1h' },
  );

  // ── Caso 1 — POST /webhooks/mercadopago, firma inválida → 401 WebhookUnverified ──
  {
    const dataId = `qa-ct-${Date.now()}`;
    const requestId = `qa-ct-req-${Date.now()}`;
    const ts = String(Math.floor(Date.now() / 1000));
    const headers = firmaConSecretoEquivocado(MP_WEBHOOK_SECRET_QA, dataId, requestId, ts);
    const res = await fetch(`${baseUrl}/v1/webhooks/mercadopago`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ type: 'payment', action: 'payment.updated', data: { id: dataId } }),
    });
    assert('POST webhook firma inválida → 401', res.status === 401, `status ${res.status}`);
    if (res.status === 401) {
      validarProblem('POST webhook firma inválida → 401', await res.json(), 'dsm:payments/webhook-unverified');
    }
  }

  // ── Caso 2 — POST /checkout/simulate-payment 200 con PaymentConfirmed ──
  {
    const seed = await seedPendingPaymentOrder({ qty: 1 });
    const res = await fetch(`${baseUrl}/v1/checkout/simulate-payment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ order_token: seed.orderToken }),
    });
    assert('POST simulate-payment → 200', res.status === 200, `status ${res.status}`);
    if (res.status === 200) {
      validarPaymentConfirmed('POST simulate-payment → 200', await res.json());
    }
  }

  // ── Caso 3 — POST /checkout/simulate-payment 404, order_token inexistente ──
  {
    const res = await fetch(`${baseUrl}/v1/checkout/simulate-payment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ order_token: 'a'.repeat(64) }),
    });
    assert('404 order_token inexistente', res.status === 404, `status ${res.status}`);
    if (res.status === 404) validarProblem('404 order_token inexistente', await res.json());
  }

  // ── Caso 4 — POST /checkout/simulate-payment 422, formato inválido ──
  {
    const res = await fetch(`${baseUrl}/v1/checkout/simulate-payment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ order_token: 'no-es-hex-de-64' }),
    });
    assert('422 order_token formato inválido', res.status === 422, `status ${res.status}`);
    if (res.status === 422) validarProblem('422 order_token formato inválido', await res.json());
  }

  // ── Casos 5-7 — los 3 endpoints admin: 401/403/200 ──
  const jobs: Array<{ path: string; keys: string[]; nombre: string }> = [
    { path: '/v1/admin/payments/reconcile', keys: RECONCILE_RESULT_KEYS, nombre: 'reconcile' },
    { path: '/v1/admin/orders/cleanup-abandoned', keys: CLEANUP_RESULT_KEYS, nombre: 'cleanup-abandoned' },
    { path: '/v1/admin/payments/retry-refunds', keys: RETRY_REFUNDS_RESULT_KEYS, nombre: 'retry-refunds' },
  ];

  for (const job of jobs) {
    {
      const res = await fetch(`${baseUrl}${job.path}`, { method: 'POST' });
      assert(`401 sin token (${job.nombre})`, res.status === 401, `status ${res.status}`);
      if (res.status === 401) validarProblem(`401 sin token (${job.nombre})`, await res.json());
    }
    {
      const res = await fetch(`${baseUrl}${job.path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenNoAdmin}` },
      });
      assert(`403 sesión no-admin (${job.nombre})`, res.status === 403, `status ${res.status}`);
      if (res.status === 403) validarProblem(`403 sesión no-admin (${job.nombre})`, await res.json());
    }
    {
      const res = await fetch(`${baseUrl}${job.path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      assert(`200 admin (${job.nombre})`, res.status === 200, `status ${res.status}`);
      if (res.status === 200) {
        validarShapeExacta(`200 admin (${job.nombre})`, await res.json(), job.keys);
      }
    }
  }

  if (fallas.length > 0) {
    console.error(`✗ ${fallas.length} incumplimiento(s) de contrato contra ${baseUrl}:`);
    for (const f of fallas) console.error(`  [${f.caso}] ${f.detalle}`);
    process.exit(1);
  }
  console.log(
    `✓ pago-webhook (webhook + simulate-payment + 3 jobs admin) conforma el contrato — ` +
      `13/13 casos, ${baseUrl}`,
  );
}

void main();
