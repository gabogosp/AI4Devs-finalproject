import http from 'k6/http';
import { check, fail } from 'k6';
import { Counter } from 'k6/metrics';
import exec from 'k6/execution';
import { auth_login } from './lib/thresholds.js';

/**
 * TC-160 — carga de `POST /v1/auth/login` (US-014 §9, PRD §4).
 *
 * Espejo de `cart-write.js`, con una diferencia de diseño obligada por el
 * propio endpoint: **una cuenta y una IP simulada por ITERACIÓN, nunca
 * reusadas** — no una IP fija por VU como en `cart-write.js`.
 *
 * `/v1/auth/login` tiene su propio `@Throttle` de **10 intentos / 15 min por
 * IP**, fijo en el handler — no lee `AUTH_RATE_LIMIT_MAX` (§7.3, presupuesto
 * de producción a propósito). Con IP fija por VU, 10 VUs corriendo en bucle
 * abierto agotan su cupo de 10 en los primeros segundos y el resto de los 30s
 * queda martillando 429 a velocidad de máquina (~200k iteraciones/30s en la
 * primera versión de este script) — un número que no mide login, mide el
 * rate-limiter. Con una IP nueva por iteración (nunca se reusa, así que nunca
 * puede superar su propio límite de 10), el p95 medido es el de `bcrypt`, que
 * es lo que TC-160 quiere.
 *
 * Por eso el executor es `shared-iterations` con un total FIJO —no duración
 * abierta—: hace falta saber de antemano cuántas cuentas sembrar en `setup()`.
 * El total por defecto (100) alcanza para un p95 estable con 10 VUs
 * concurrentes, que es la concurrencia que pide el escenario de `qa-plan.md`.
 *
 * Igual que `cart-write.js`: un 429 (`rate_limited`, umbral `count<1`) aborta
 * la corrida en vez de degradar el resultado a un número que parece bueno.
 *
 * Uso:
 *   pnpm --filter @dsm/qa api:up                               # otra terminal
 *   QA_API_BASE_URL=http://localhost:3009 pnpm --filter @dsm/qa test:load:auth
 */
const BASE = __ENV.QA_API_BASE_URL || 'http://localhost:3000';
/** Mismos defaults que `qa/support/qa-env.ts` — k6 no puede importar el módulo TS. */
const ORIGIN = __ENV.QA_WEB_BASE_URL || 'http://localhost:3200';
const PASSWORD = 'Contrasena-Carga-1';
const TOTAL_ITERACIONES = Number(__ENV.K6_ITERATIONS || 100);

const rateLimited = new Counter('rate_limited');

export const options = {
  scenarios: {
    login_load: {
      executor: 'shared-iterations',
      vus: Number(__ENV.K6_VUS || 10),
      iterations: TOTAL_ITERACIONES,
      maxDuration: __ENV.K6_MAX_DURATION || '60s',
    },
  },
  thresholds: auth_login,
};

/** IP simulada exclusiva del índice `i` — sale desplazada al azar por CORRIDA. */
const RUN_SALT = Date.now() % 65536;
function ipDeIndice(i) {
  const salted = (RUN_SALT + i) % 65536;
  return `10.77.${(salted >> 8) & 255}.${salted & 255}`;
}

export function setup() {
  const cuentas = [];
  for (let i = 0; i < TOTAL_ITERACIONES; i++) {
    const email = `qa-us014-carga-${Date.now()}-${i}@example.test`;
    const registro = http.post(
      `${BASE}/v1/auth/register`,
      JSON.stringify({ email, name: `Carga ${i}`, password: PASSWORD }),
      {
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          // Registro e login de este índice comparten IP: cada una se usa UNA
          // sola vez en total (1 registro + 1 login), muy por debajo de
          // cualquier límite — nunca hace falta separarlas.
          'X-Forwarded-For': ipDeIndice(i),
        },
        tags: { endpoint: 'setup' },
      },
    );
    if (registro.status !== 201 && registro.status !== 200) {
      fail(
        `setup: registro ${i} devolvió ${registro.status} — ${registro.body}. ` +
          '¿La API corre con TRUST_PROXY_HOPS=1 (qa/scripts/api-up.sh)?',
      );
    }
    cuentas.push({ email, password: PASSWORD });
  }
  return { cuentas };
}

export default function (data) {
  const i = exec.scenario.iterationInTest;
  const cuenta = data.cuentas[i];

  const login = http.post(
    `${BASE}/v1/auth/login`,
    JSON.stringify({ email: cuenta.email, password: cuenta.password }),
    {
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        'X-Forwarded-For': ipDeIndice(i),
      },
      tags: { endpoint: 'auth_login' },
    },
  );
  if (login.status === 429) rateLimited.add(1);

  check(login, {
    'login: 200': (r) => r.status === 200,
    'login: la cookie de sesión vuelve': (r) => {
      const jar = r.cookies || {};
      const acceso = jar.dsm_access;
      return Array.isArray(acceso) && acceso.length > 0;
    },
  });
}
