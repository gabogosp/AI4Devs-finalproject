/**
 * QA-023-CT-1 — contrato de `POST /v1/admin/orders/{orderId}/confirm-payment`
 * y `GET /v1/admin/orders/pending-payment` contra el OpenAPI PUBLICADO
 * (`apps/api/docs/api/openapi.yaml`, componentes `PaymentConfirmed` /
 * `PendingPaymentOrder`, ambos con `additionalProperties: false`).
 *
 * **Desviación documentada del `Verify:` original de `qa-plan.md` §5** (registrada
 * también ahí): el plan proponía `pnpm --filter @dsm/qa test:contract --
 * --testPathPattern=pago-manual`, que asume un runner jest-style. El único
 * contract test existente en el repo (`search.contract.ts`) es un script `tsx`
 * standalone, sin jest ni `--testPathPattern`. Este archivo sigue esa MISMA
 * convención real (no la del plan) y se registra bajo su propio script
 * `test:contract:pago-manual` en `qa/package.json`, sin tocar el `test:contract`
 * existente de `search.contract.ts`.
 *
 * Corre contra un servidor REAL (no un mock ni un módulo de Nest en memoria):
 * valida lo que un cliente HTTP real recibe.
 */
import jwt from 'jsonwebtoken';
import { adminAuth } from '../support/admin-auth';
import { apiCall } from '../support/api';
import { seedPendingPaymentOrder } from '../support/seed-pending-payment-order';

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

const PAYMENT_CONFIRMED_KEYS = ['order_number', 'status'];
const PENDING_PAYMENT_ORDER_KEYS = [
  'id',
  'order_number',
  'buyer_name',
  'total_ars_cents',
  'created_at',
];

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

function validarPendingPaymentOrders(caso: string, body: unknown): void {
  assert(caso, Array.isArray(body), 'la respuesta no es un array');
  for (const fila of (body as unknown[]) ?? []) {
    const keys = keysOf(fila);
    for (const k of PENDING_PAYMENT_ORDER_KEYS) {
      assert(caso, keys.includes(k), `falta "${k}" en una fila de PendingPaymentOrder`);
    }
    for (const k of keys) {
      assert(caso, PENDING_PAYMENT_ORDER_KEYS.includes(k), `fila con campo no declarado: "${k}"`);
    }
    const f = fila as Record<string, unknown>;
    assert(
      caso,
      typeof f.id === 'string' && UUID_RE.test(f.id),
      `"id" no es un UUID válido: ${JSON.stringify(f.id)}`,
    );
    assert(caso, Number.isInteger(f.order_number), 'order_number debe ser integer');
    assert(caso, typeof f.buyer_name === 'string', 'buyer_name debe ser string');
    assert(caso, Number.isInteger(f.total_ars_cents), 'total_ars_cents debe ser integer');
    assert(caso, typeof f.created_at === 'string', 'created_at debe ser string (date-time)');
  }
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

async function main(): Promise<void> {
  const adminToken = await adminAuth();

  // Caso 1 — GET /pending-payment 200, array de PendingPaymentOrder con "id" UUID.
  {
    const res = await fetch(`${baseUrl}/v1/admin/orders/pending-payment`, {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert('GET pending-payment → 200', res.status === 200, `status ${res.status}`);
    if (res.status === 200) {
      validarPendingPaymentOrders('GET pending-payment → 200', await res.json());
    }
  }

  // Siembra real (checkout real, nunca INSERT directo) para los casos que sí confirman.
  const ordenFeliz = await seedPendingPaymentOrder({ qty: 1 });

  // Caso 2 — POST confirm-payment 200 con PaymentConfirmed (additionalProperties: false).
  {
    const res = await fetch(
      `${baseUrl}/v1/admin/orders/${ordenFeliz.id}/confirm-payment`,
      { method: 'POST', headers: { authorization: `Bearer ${adminToken}` } },
    );
    assert('POST confirm-payment → 200', res.status === 200, `status ${res.status}`);
    if (res.status === 200) {
      validarPaymentConfirmed('POST confirm-payment → 200', await res.json());
    }
  }

  // Caso 3 — 401 sin ningún token.
  {
    const res = await fetch(
      `${baseUrl}/v1/admin/orders/${ordenFeliz.id}/confirm-payment`,
      { method: 'POST' },
    );
    assert('401 sin token', res.status === 401, `status ${res.status}`);
    if (res.status === 401) validarProblem('401 sin token', await res.json());
  }

  // Caso 4 — 403 con un JWT válido pero sin role=admin.
  {
    const tokenNoAdmin = jwt.sign(
      { role: 'customer', sub: 'qa-contract-no-admin' },
      JWT_SECRET,
      { expiresIn: '1h' },
    );
    const res = await fetch(
      `${baseUrl}/v1/admin/orders/${ordenFeliz.id}/confirm-payment`,
      { method: 'POST', headers: { authorization: `Bearer ${tokenNoAdmin}` } },
    );
    assert('403 sesión no-admin', res.status === 403, `status ${res.status}`);
    if (res.status === 403) validarProblem('403 sesión no-admin', await res.json());
  }

  // Caso 5 — 404 orden inexistente (UUID con forma válida, sin fila en base).
  {
    const res = await fetch(
      `${baseUrl}/v1/admin/orders/00000000-0000-4000-8000-000000000000/confirm-payment`,
      { method: 'POST', headers: { authorization: `Bearer ${adminToken}` } },
    );
    assert('404 orden inexistente', res.status === 404, `status ${res.status}`);
    if (res.status === 404) validarProblem('404 orden inexistente', await res.json());
  }

  // Caso 6 — 409 dsm:payments/order-not-pending-payment (la orden feliz ya se confirmó, caso 2).
  {
    const res = await fetch(
      `${baseUrl}/v1/admin/orders/${ordenFeliz.id}/confirm-payment`,
      { method: 'POST', headers: { authorization: `Bearer ${adminToken}` } },
    );
    assert('409 order-not-pending-payment', res.status === 409, `status ${res.status}`);
    if (res.status === 409) {
      validarProblem(
        '409 order-not-pending-payment',
        await res.json(),
        'dsm:payments/order-not-pending-payment',
      );
    }
  }

  // Caso 7 — 409 dsm:payments/insufficient-stock (stock bajado por debajo de lo pedido).
  {
    const ordenSinStock = await seedPendingPaymentOrder({ qty: 2 });
    await apiCall(
      `/v1/admin/products/${ordenSinStock.productId}`,
      'PATCH',
      adminToken,
      { stock: 1 },
    );
    const res = await fetch(
      `${baseUrl}/v1/admin/orders/${ordenSinStock.id}/confirm-payment`,
      { method: 'POST', headers: { authorization: `Bearer ${adminToken}` } },
    );
    assert('409 insufficient-stock', res.status === 409, `status ${res.status}`);
    if (res.status === 409) {
      validarProblem('409 insufficient-stock', await res.json(), 'dsm:payments/insufficient-stock');
    }
  }

  if (fallas.length > 0) {
    console.error(`✗ ${fallas.length} incumplimiento(s) de contrato contra ${baseUrl}:`);
    for (const f of fallas) console.error(`  [${f.caso}] ${f.detalle}`);
    process.exit(1);
  }
  console.log(
    `✓ admin-payments (confirm-payment + pending-payment) conforma el contrato — 7/7 casos, ${baseUrl}`,
  );
}

void main();
