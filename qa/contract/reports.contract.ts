/**
 * QA-016-CT-1 — contrato de los 6 endpoints de `admin-reports` (US-016)
 * contra el OpenAPI PUBLICADO (`apps/api/docs/api/openapi.yaml`, componentes
 * `AdminReportsSales`/`AdminReportsTopProducts`/`AdminReportsSummary`).
 *
 * Mismo criterio real que `pago-manual.contract.ts` (no el
 * `--testPathPattern` jest-style que asumían los planes Modo A previos a la
 * corrección de US-023): script `tsx` standalone contra un servidor REAL,
 * registrado bajo su propio `test:contract:reports` en `qa/package.json`.
 */
import jwt from 'jsonwebtoken';
import { adminAuth } from '../support/admin-auth';
import { crearOrdenActiva } from '../support/seed-metricas';

const baseUrl = process.env.QA_API_BASE_URL ?? 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SALE_STATUSES = ['new', 'preparing', 'ready', 'delivered'];

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

function validarRange(caso: string, body: Record<string, unknown>): void {
  const range = body.range as Record<string, unknown> | undefined;
  assert(caso, typeof range === 'object' && range !== null, 'falta "range"');
  if (range) {
    for (const k of ['from', 'to']) {
      assert(caso, k in range, `"range" sin "${k}"`);
      assert(caso, typeof range[k] === 'string', `"range.${k}" debe ser string (date-time)`);
    }
  }
}

function validarSales(caso: string, body: unknown): void {
  const keys = keysOf(body);
  for (const k of ['range', 'granularity', 'data']) {
    assert(caso, keys.includes(k), `falta "${k}"`);
  }
  const b = body as Record<string, unknown>;
  validarRange(caso, b);
  assert(caso, ['day', 'week', 'month'].includes(b.granularity as string), `"granularity" fuera del enum: ${b.granularity}`);
  assert(caso, Array.isArray(b.data), '"data" no es un array');
  for (const fila of (b.data as unknown[]) ?? []) {
    const fk = keysOf(fila);
    for (const k of ['period_date', 'orders_count', 'total_ars_cents']) {
      assert(caso, fk.includes(k), `fila de "data" sin "${k}"`);
    }
    const f = fila as Record<string, unknown>;
    assert(caso, typeof f.period_date === 'string', 'period_date debe ser string (date)');
    assert(caso, Number.isInteger(f.orders_count), 'orders_count debe ser integer');
    assert(caso, Number.isInteger(f.total_ars_cents), 'total_ars_cents debe ser integer');
  }
}

function validarTopProducts(caso: string, body: unknown): void {
  const keys = keysOf(body);
  for (const k of ['range', 'data']) {
    assert(caso, keys.includes(k), `falta "${k}"`);
  }
  const b = body as Record<string, unknown>;
  validarRange(caso, b);
  assert(caso, Array.isArray(b.data), '"data" no es un array');
  for (const fila of (b.data as unknown[]) ?? []) {
    const fk = keysOf(fila);
    for (const k of ['product_id', 'product_name', 'product_sku', 'quantity_sold', 'revenue_ars_cents']) {
      assert(caso, fk.includes(k), `fila de "data" sin "${k}"`);
    }
    const f = fila as Record<string, unknown>;
    assert(caso, typeof f.product_id === 'string' && UUID_RE.test(f.product_id), `product_id no es UUID: ${f.product_id}`);
    assert(caso, typeof f.product_name === 'string', 'product_name debe ser string');
    assert(caso, typeof f.product_sku === 'string', 'product_sku debe ser string');
    assert(caso, Number.isInteger(f.quantity_sold), 'quantity_sold debe ser integer');
    assert(caso, Number.isInteger(f.revenue_ars_cents), 'revenue_ars_cents debe ser integer');
  }
}

function validarSummary(caso: string, body: unknown): void {
  const keys = keysOf(body);
  for (const k of ['range', 'orders_count', 'total_ars_cents', 'breakdown_by_status']) {
    assert(caso, keys.includes(k), `falta "${k}"`);
  }
  const b = body as Record<string, unknown>;
  validarRange(caso, b);
  assert(caso, Number.isInteger(b.orders_count), 'orders_count debe ser integer');
  assert(caso, Number.isInteger(b.total_ars_cents), 'total_ars_cents debe ser integer');
  const breakdown = b.breakdown_by_status as Record<string, unknown> | undefined;
  assert(caso, typeof breakdown === 'object' && breakdown !== null, 'falta "breakdown_by_status"');
  if (breakdown) {
    const bk = Object.keys(breakdown);
    assert(
      caso,
      SALE_STATUSES.every((s) => bk.includes(s)) && bk.length === SALE_STATUSES.length,
      `"breakdown_by_status" debe tener EXACTAMENTE las 4 claves activas, tiene: ${bk.join(',')}`,
    );
    for (const status of SALE_STATUSES) {
      const entry = breakdown[status] as Record<string, unknown> | undefined;
      assert(caso, typeof entry === 'object' && entry !== null, `breakdown_by_status.${status} ausente`);
      if (entry) {
        assert(caso, Number.isInteger(entry.count), `breakdown_by_status.${status}.count debe ser integer`);
        assert(
          caso,
          Number.isInteger(entry.total_ars_cents),
          `breakdown_by_status.${status}.total_ars_cents debe ser integer`,
        );
      }
    }
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

interface EndpointSpec {
  nombre: string;
  path: string;
  validarJson: (caso: string, body: unknown) => void;
  csvHeader: string;
}

const ENDPOINTS: EndpointSpec[] = [
  {
    nombre: 'sales',
    path: 'sales',
    validarJson: validarSales,
    csvHeader: 'period_date,orders_count,total_ars_cents',
  },
  {
    nombre: 'top-products',
    path: 'top-products',
    validarJson: validarTopProducts,
    csvHeader: 'product_id,product_name,product_sku,quantity_sold,revenue_ars_cents',
  },
  {
    nombre: 'summary',
    path: 'summary',
    validarJson: validarSummary,
    csvHeader: 'status,count,total_ars_cents',
  },
];

async function main(): Promise<void> {
  const adminToken = await adminAuth();
  const tokenNoAdmin = jwt.sign({ role: 'customer', sub: 'qa-contract-reports-no-admin' }, JWT_SECRET, {
    expiresIn: '1h',
  });

  // Siembra mínima 100% real (checkout + confirm-payment) para que los 3 GET
  // tengan al menos una fila real que validar, no sólo el caso vacío.
  await crearOrdenActiva('new', { adminToken });

  for (const ep of ENDPOINTS) {
    // 200 con token admin real.
    {
      const res = await fetch(`${baseUrl}/v1/admin/reports/${ep.path}`, {
        headers: { authorization: `Bearer ${adminToken}` },
      });
      assert(`GET ${ep.path} → 200`, res.status === 200, `status ${res.status}`);
      if (res.status === 200) ep.validarJson(`GET ${ep.path} → 200`, await res.json());
    }

    // 401 sin token.
    {
      const res = await fetch(`${baseUrl}/v1/admin/reports/${ep.path}`);
      assert(`GET ${ep.path} → 401`, res.status === 401, `status ${res.status}`);
      if (res.status === 401) validarProblem(`GET ${ep.path} → 401`, await res.json());
    }

    // 403 con sesión no-admin.
    {
      const res = await fetch(`${baseUrl}/v1/admin/reports/${ep.path}`, {
        headers: { authorization: `Bearer ${tokenNoAdmin}` },
      });
      assert(`GET ${ep.path} → 403`, res.status === 403, `status ${res.status}`);
      if (res.status === 403) validarProblem(`GET ${ep.path} → 403`, await res.json());
    }

    // 422 con rango incoherente (from > to).
    {
      const res = await fetch(
        `${baseUrl}/v1/admin/reports/${ep.path}?created_at_from=2026-06-01&created_at_to=2026-01-01`,
        { headers: { authorization: `Bearer ${adminToken}` } },
      );
      assert(`GET ${ep.path} → 422`, res.status === 422, `status ${res.status}`);
      if (res.status === 422) {
        validarProblem(`GET ${ep.path} → 422`, await res.json(), 'dsm:reports/invalid-range');
      }
    }

    // 200 export CSV: Content-Type text/csv + Content-Disposition attachment + header correcto.
    {
      const res = await fetch(`${baseUrl}/v1/admin/reports/${ep.path}/export`, {
        headers: { authorization: `Bearer ${adminToken}` },
      });
      assert(`GET ${ep.path}/export → 200`, res.status === 200, `status ${res.status}`);
      if (res.status === 200) {
        const contentType = res.headers.get('content-type') ?? '';
        assert(
          `GET ${ep.path}/export → 200`,
          contentType.startsWith('text/csv'),
          `Content-Type esperado "text/csv", llegó "${contentType}"`,
        );
        const disposition = res.headers.get('content-disposition') ?? '';
        assert(
          `GET ${ep.path}/export → 200`,
          disposition.startsWith('attachment'),
          `Content-Disposition esperado "attachment...", llegó "${disposition}"`,
        );
        const csv = await res.text();
        assert(
          `GET ${ep.path}/export → 200`,
          csv.startsWith(ep.csvHeader),
          `el CSV no empieza con el header esperado "${ep.csvHeader}": "${csv.slice(0, 80)}"`,
        );
      }
    }

    // 401/403/422 del export — mismas reglas que el GET hermano.
    {
      const res = await fetch(`${baseUrl}/v1/admin/reports/${ep.path}/export`);
      assert(`GET ${ep.path}/export → 401`, res.status === 401, `status ${res.status}`);
      if (res.status === 401) validarProblem(`GET ${ep.path}/export → 401`, await res.json());
    }
    {
      const res = await fetch(`${baseUrl}/v1/admin/reports/${ep.path}/export`, {
        headers: { authorization: `Bearer ${tokenNoAdmin}` },
      });
      assert(`GET ${ep.path}/export → 403`, res.status === 403, `status ${res.status}`);
      if (res.status === 403) validarProblem(`GET ${ep.path}/export → 403`, await res.json());
    }
    {
      const res = await fetch(
        `${baseUrl}/v1/admin/reports/${ep.path}/export?created_at_from=2026-06-01&created_at_to=2026-01-01`,
        { headers: { authorization: `Bearer ${adminToken}` } },
      );
      assert(`GET ${ep.path}/export → 422`, res.status === 422, `status ${res.status}`);
      if (res.status === 422) {
        validarProblem(`GET ${ep.path}/export → 422`, await res.json(), 'dsm:reports/invalid-range');
      }
    }
  }

  if (fallas.length > 0) {
    console.error(`✗ ${fallas.length} incumplimiento(s) de contrato contra ${baseUrl}:`);
    for (const f of fallas) console.error(`  [${f.caso}] ${f.detalle}`);
    process.exit(1);
  }
  console.log(`✓ admin-reports (6 endpoints) conforma el contrato — ${ENDPOINTS.length * 7}/${ENDPOINTS.length * 7} casos, ${baseUrl}`);
}

void main();
