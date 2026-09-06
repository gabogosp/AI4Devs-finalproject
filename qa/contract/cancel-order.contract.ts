/**
 * QA-013-CT-1 — contrato de `POST /v1/admin/orders/{id}/cancel` contra el
 * OpenAPI PUBLICADO (`apps/api/docs/api/openapi.yaml`, componente
 * `CancelOrderResponse`, self-contained per backend `design.md` §D6).
 *
 * Mismo criterio real que `pago-manual.contract.ts`/`reports.contract.ts`:
 * script `tsx` standalone contra un servidor REAL, registrado bajo su propio
 * `test:contract:cancel-order` en `qa/package.json`.
 */
import jwt from 'jsonwebtoken';
import { adminAuth } from '../support/admin-auth';
import { cancelarOrden } from '../support/cancelar-orden';
import {
  catalogoParaMetricas,
  crearOrdenActiva,
  crearOrdenPendiente,
} from '../support/seed-metricas';

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

const CANCEL_ORDER_RESPONSE_KEYS = [
  'id',
  'order_number',
  'buyer_name',
  'total_ars_cents',
  'status',
  'created_at',
  'buyer_email',
  'buyer_phone',
  'fulfillment',
  'items',
  'status_history',
  'anonymized_at',
  'anonymization_reason',
  'refund',
];

function validarCancelOrderResponse(caso: string, body: unknown): void {
  const keys = keysOf(body);
  for (const k of CANCEL_ORDER_RESPONSE_KEYS) {
    assert(caso, keys.includes(k), `falta el campo requerido "${k}"`);
  }
  const b = body as Record<string, unknown>;
  assert(caso, typeof b.id === 'string' && UUID_RE.test(b.id), '"id" no es un UUID válido');
  assert(caso, Number.isInteger(b.order_number), 'order_number debe ser integer');
  assert(caso, typeof b.buyer_name === 'string', 'buyer_name debe ser string');
  assert(caso, Number.isInteger(b.total_ars_cents), 'total_ars_cents debe ser integer');
  assert(caso, b.status === 'cancelled', `"status" fuera del enum [cancelled]: ${JSON.stringify(b.status)}`);
  assert(caso, typeof b.created_at === 'string', 'created_at debe ser string (date-time)');
  assert(caso, typeof b.buyer_email === 'string', 'buyer_email debe ser string');
  assert(caso, typeof b.buyer_phone === 'string', 'buyer_phone debe ser string');
  assert(caso, b.fulfillment === 'pickup', `"fulfillment" fuera del enum [pickup]: ${JSON.stringify(b.fulfillment)}`);
  assert(caso, Array.isArray(b.items), '"items" no es un array');
  assert(caso, Array.isArray(b.status_history), '"status_history" no es un array');
  assert(
    caso,
    b.anonymized_at === null || typeof b.anonymized_at === 'string',
    'anonymized_at debe ser string o null',
  );
  assert(
    caso,
    b.anonymization_reason === null ||
      ['retention_policy', 'requested'].includes(b.anonymization_reason as string),
    `anonymization_reason fuera del enum: ${JSON.stringify(b.anonymization_reason)}`,
  );

  const refundKeys = keysOf(b.refund);
  for (const k of ['status', 'provider']) {
    assert(caso, refundKeys.includes(k), `falta "refund.${k}"`);
  }
  const refund = b.refund as Record<string, unknown>;
  assert(
    caso,
    ['refunded', 'refund_pending', 'not_applicable'].includes(refund.status as string),
    `refund.status fuera del enum: ${JSON.stringify(refund.status)}`,
  );
  assert(
    caso,
    refund.provider === null || ['mercadopago', 'simulated_dsm', 'manual'].includes(refund.provider as string),
    `refund.provider fuera del enum: ${JSON.stringify(refund.provider)}`,
  );
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

async function main(): Promise<void> {
  const adminToken = await adminAuth();

  // Caso 1 — 200 con CancelOrderResponse completo (orden new, pago manual).
  const catalogo = await catalogoParaMetricas(1, { token: adminToken });
  const ordenFeliz = await crearOrdenActiva('new', { adminToken, catalogo });
  {
    const res = await cancelarOrden(adminToken, ordenFeliz.id);
    assert('200 cancelación exitosa', res.status === 200, `status ${res.status}`);
    if (res.status === 200) {
      validarCancelOrderResponse('200 cancelación exitosa', res.body);
    }
  }

  // Caso 2 — 401 sin ningún token.
  {
    const res = await fetch(`${baseUrl}/v1/admin/orders/${ordenFeliz.id}/cancel`, {
      method: 'POST',
    });
    assert('401 sin token', res.status === 401, `status ${res.status}`);
    if (res.status === 401) validarProblem('401 sin token', await res.json());
  }

  // Caso 3 — 403 con un JWT válido pero sin role=admin.
  {
    const tokenNoAdmin = jwt.sign(
      { role: 'customer', sub: 'qa-contract-no-admin' },
      JWT_SECRET,
      { expiresIn: '1h' },
    );
    const res = await fetch(`${baseUrl}/v1/admin/orders/${ordenFeliz.id}/cancel`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tokenNoAdmin}` },
    });
    assert('403 sesión no-admin', res.status === 403, `status ${res.status}`);
    if (res.status === 403) validarProblem('403 sesión no-admin', await res.json());
  }

  // Caso 4 — 404 orden inexistente (UUID con forma válida, sin fila en base).
  {
    const res = await fetch(
      `${baseUrl}/v1/admin/orders/00000000-0000-4000-8000-000000000000/cancel`,
      { method: 'POST', headers: { authorization: `Bearer ${adminToken}` } },
    );
    assert('404 orden inexistente', res.status === 404, `status ${res.status}`);
    if (res.status === 404) {
      validarProblem('404 orden inexistente', await res.json(), 'dsm:payments/order-not-found');
    }
  }

  // Caso 5 — 404 orden todavía pending_payment (fuera de alcance de esta acción).
  {
    const ordenPendiente = await crearOrdenPendiente({ adminToken, catalogo });
    const res = await cancelarOrden(adminToken, ordenPendiente.id);
    assert('404 orden pending_payment', res.status === 404, `status ${res.status}`);
    if (res.status === 404) {
      validarProblem('404 orden pending_payment', res.body, 'dsm:payments/order-not-found');
    }
  }

  // Caso 6 — 409 orden ya entregada (estado terminal).
  {
    const ordenEntregada = await crearOrdenActiva('delivered', { adminToken, catalogo });
    const res = await cancelarOrden(adminToken, ordenEntregada.id);
    assert('409 orden entregada', res.status === 409, `status ${res.status}`);
    if (res.status === 409) {
      validarProblem(
        '409 orden entregada',
        res.body,
        'dsm:payments/order-cannot-be-cancelled',
      );
    }
  }

  if (fallas.length > 0) {
    console.error(`✗ ${fallas.length} incumplimiento(s) de contrato contra ${baseUrl}:`);
    for (const f of fallas) console.error(`  [${f.caso}] ${f.detalle}`);
    process.exit(1);
  }
  console.log(`✓ cancel-order conforma el contrato — 6/6 casos, ${baseUrl}`);
}

void main();
