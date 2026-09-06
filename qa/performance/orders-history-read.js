import http from 'k6/http';
import { check, fail } from 'k6';
import exec from 'k6/execution';
import { orders_history_list } from './lib/thresholds.js';

/**
 * QA-015-PERF-1 — carga de lectura del historial de compras del cliente
 * (US-015 §9, PRD §4, `design.md` §D-QA7). Presupuesto en `lib/thresholds.js`
 * (fuente única) — `p(95)<300ms`, mismo NFR que ya midieron `list_orders`
 * (US-012) y `reports_read` (US-016) para superficies de lectura admin
 * equivalentes; acá la superficie es de CLIENTE (su propio historial).
 *
 * Por iteración: `POST /v1/auth/login` (NO tagueado — sólo mide el GET) +
 * `GET /v1/me/orders` (tagueado `orders_history_list`). El login reusa el jar
 * de cookies automático por VU que k6 mantiene durante todo el test — no se
 * manipula el header `Cookie` a mano; el login de esta misma iteración
 * sobreescribe cualquier cookie de una iteración anterior antes del GET.
 *
 * IP simulada distinta por ITERACIÓN (mismo criterio que `auth-login.js`,
 * TC-160): `/v1/auth/login` tiene su propio `@Throttle` FIJO de 10/15min por
 * IP que NO lee ningún env de `api-up.sh` — con IP fija por VU, unos pocos
 * VUs corriendo 20s+ agotarían ese cupo y el resto mediría el rate-limiter,
 * no el historial. Con IP nueva por iteración, ningún login puede chocar
 * contra su propio límite.
 *
 * Datos: `seed-orders-history-load.ts` siembra el pool de cuentas (cada una
 * con 1 compra confirmada) antes de correr esto.
 *
 * Uso:
 *   pnpm --filter @dsm/qa exec tsx performance/seed-orders-history-load.ts   # una vez
 *   QA_API_BASE_URL=http://localhost:3009 k6 run qa/performance/orders-history-read.js
 */
const BASE = __ENV.QA_API_BASE_URL || 'http://localhost:3000';
/** Mismos defaults que `qa/support/qa-env.ts` — k6 no puede importar el módulo TS. */
const ORIGIN = __ENV.QA_WEB_BASE_URL || 'http://localhost:3200';

const cuentas = JSON.parse(open('./data/orders-history-load-accounts.json'));

export const options = {
  vus: Number(__ENV.K6_VUS || 2),
  duration: __ENV.K6_DURATION || '20s',
  thresholds: orders_history_list,
};

/** IP simulada exclusiva del índice `i` — sale desplazada al azar por CORRIDA. */
const RUN_SALT = Date.now() % 65536;
function ipDeIndice(i) {
  const salted = (RUN_SALT + i) % 65536;
  return `10.78.${(salted >> 8) & 255}.${salted & 255}`;
}

export default function () {
  const i = exec.scenario.iterationInTest;
  const cuenta = cuentas[i % cuentas.length];
  const ip = ipDeIndice(i);

  const login = http.post(
    `${BASE}/v1/auth/login`,
    JSON.stringify({ email: cuenta.email, password: cuenta.password }),
    {
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'X-Forwarded-For': ip },
      tags: { endpoint: 'setup' }, // deliberadamente NO 'orders_history_list' — no cuenta para el threshold
    },
  );
  if (login.status !== 200) {
    fail(
      `login devolvió ${login.status} para ${cuenta.email} — ${login.body}. ` +
        '¿Corrió seed-orders-history-load.ts contra esta misma API?',
    );
  }

  const historial = http.get(`${BASE}/v1/me/orders`, {
    headers: { Origin: ORIGIN, 'X-Forwarded-For': ip },
    tags: { endpoint: 'orders_history_list' },
  });
  check(historial, {
    'historial: 200': (r) => r.status === 200,
    'historial: pagination.total >= 1': (r) => r.status === 200 && r.json('pagination').total >= 1,
  });
}
