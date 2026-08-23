import { readFileSync } from 'node:fs';
import { request, type APIRequestContext } from '@playwright/test';
import { QA_API_BASE_URL, QA_WEB_BASE_URL } from './qa-env';

/**
 * Cuentas de cliente para la suite QA (US-014), contra la **API real**.
 *
 * Espejo de `cart-client.ts`: cada cuenta vive en su propio `APIRequestContext`
 * con su almacén de cookies, y ninguna función devuelve el token de sesión — pasarlo
 * a mano probaría que el servidor acepta un token, no que el cliente conserva su
 * sesión, que es lo que AC-2 afirma.
 *
 * **Una cuenta por escenario.** El lockout de US-014 es progresivo y persiste en
 * `customers.locked_until`: compartir una cuenta haría que TC-146 —que la bloquea a
 * propósito— rompa a TC-141 según el orden de ejecución. Es la misma interferencia que
 * se cobró TC-724/TC-725 en US-007.
 */

/** Prefijo único por corrida: la base es compartida y otras suites siembran ahí (OQ-QA-1). */
const CORRIDA = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
let contador = 0;

/** Contraseña válida para la política del backend. Nunca se loguea. */
export const PASSWORD_VALIDA = 'Contrasena-Valida-1';

export interface Cuenta {
  email: string;
  password: string;
  nombre: string;
}

/** Datos de una cuenta nueva, sin crearla todavía. */
export function datosDeCuenta(sufijo = ''): Cuenta {
  contador += 1;
  return {
    email: `qa-us014-${CORRIDA}-${contador}${sufijo}@example.test`,
    password: PASSWORD_VALIDA,
    nombre: `QA Cuenta ${contador}`,
  };
}

/**
 * IP propia por contexto.
 *
 * El rate-limit del backend cuenta **por IP**, así que sin esto todos los escenarios
 * comparten un solo cubo: el contador se agota, y con la ventana de 15 minutos la suite
 * no puede registrar ni una cuenta más — sin importar cuánto se eleve
 * `AUTH_RATE_LIMIT_MAX`. Exige que la API corra con `TRUST_PROXY_HOPS=1`
 * (`qa/scripts/api-up.sh` lo hace); es el mismo mecanismo que usa
 * `apps/api/test/e2e-app.ts` por el mismo motivo.
 *
 * En producción `TRUST_PROXY_HOPS` es 0 a propósito: confiar en este header permitiría
 * evadir el límite falsificándolo. Elevarlo es una decisión **del entorno de QA**.
 */
let ip = 0;
const proximaIp = (): string => {
  ip += 1;
  return `10.${(ip >> 16) & 255}.${(ip >> 8) & 255}.${ip & 255}`;
};

/** Contexto de API con su propio almacén de cookies, su `Origin` y su IP. */
export async function nuevoContexto(): Promise<APIRequestContext> {
  return request.newContext({
    baseURL: QA_API_BASE_URL,
    extraHTTPHeaders: {
      // El backend valida `Origin` contra la allowlist de CORS además del
      // double-submit: sin este header toda escritura muere en 403.
      origin: QA_WEB_BASE_URL,
      'x-forwarded-for': proximaIp(),
    },
  });
}

/** Lee la cookie legible de CSRF; el double-submit la exige en las escrituras. */
async function csrf(ctx: APIRequestContext): Promise<string | undefined> {
  const estado = await ctx.storageState();
  return estado.cookies.find((c) => c.name === 'dsm_csrf')?.value;
}

export interface Sesion {
  ctx: APIRequestContext;
  cuenta: Cuenta;
}

/** Registra una cuenta nueva por la API real. Queda con sesión activa (AC-1). */
export async function nuevaCuenta(sufijo = ''): Promise<Sesion> {
  const cuenta = datosDeCuenta(sufijo);
  const ctx = await nuevoContexto();
  const res = await ctx.post('/v1/auth/register', {
    data: { email: cuenta.email, name: cuenta.nombre, password: cuenta.password },
  });
  if (res.status() !== 201 && res.status() !== 200) {
    throw new Error(`registro falló con ${res.status()} — ${await res.text()}`);
  }
  return { ctx, cuenta };
}

/** Login en un contexto NUEVO (el caso del cliente que vuelve). */
export async function login(
  cuenta: Cuenta,
  password = cuenta.password,
): Promise<{ ctx: APIRequestContext; status: number }> {
  const ctx = await nuevoContexto();
  const res = await ctx.post('/v1/auth/login', {
    data: { email: cuenta.email, password },
  });
  return { ctx, status: res.status() };
}

export async function logout(ctx: APIRequestContext): Promise<number> {
  const token = await csrf(ctx);
  const res = await ctx.post('/v1/auth/logout', {
    headers: token ? { 'x-csrf-token': token } : {},
  });
  return res.status();
}

export async function me(ctx: APIRequestContext): Promise<number> {
  return (await ctx.get('/v1/auth/me')).status();
}

/** Refresca la sesión. Devuelve el status para poder afirmar la rotación (AC-9). */
export async function refresh(ctx: APIRequestContext): Promise<number> {
  const token = await csrf(ctx);
  const res = await ctx.post('/v1/auth/refresh', {
    headers: token ? { 'x-csrf-token': token } : {},
  });
  return res.status();
}

export async function pedirReset(
  ctx: APIRequestContext,
  email: string,
): Promise<{ status: number; ms: number }> {
  const t0 = Date.now();
  const res = await ctx.post('/v1/auth/password-reset/request', { data: { email } });
  return { status: res.status(), ms: Date.now() - t0 };
}

/**
 * Token de recuperación, leído del **log del proceso de la API**.
 *
 * No hay endpoint que lo exponga, y está bien que no lo haya: el token viaja por
 * email. Fuera de producción el mailer de log lo escribe
 * (`password_reset.token customer_id=… token=…`), que es el único canal disponible
 * para una suite automatizada sin depender de una bandeja real (OQ-QA-4).
 *
 * `QA_API_LOG` apunta al stdout redirigido del proceso levantado con `api:up`.
 */
export function ultimoTokenDeReset(logPath = process.env.QA_API_LOG ?? '/tmp/api.log'): string {
  const log = readFileSync(logPath, 'utf8');
  const tokens = [...log.matchAll(/password_reset\.token[^\n]*token=([A-Za-z0-9._-]+)/g)];
  if (tokens.length === 0) {
    throw new Error(
      `no hay token de reset en ${logPath}. ¿La API corre con nivel debug y NODE_ENV != production?`,
    );
  }
  return tokens[tokens.length - 1]![1]!;
}
