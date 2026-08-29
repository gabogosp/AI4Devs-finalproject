import { readFileSync, statSync } from 'node:fs';
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
  /** Ausente hasta que la cuenta se registra de verdad (per `nuevaCuenta`). */
  id?: string;
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
 *
 * **El segundo octeto es el índice de worker** (`TEST_PARALLEL_INDEX`, que Playwright
 * expone por proceso). Sin esto, `ip` es una variable de módulo que arranca en 0 en
 * CADA worker —son procesos Node separados—, así que dos specs corriendo en paralelo
 * (el caso normal, `fullyParallel` o no: cada archivo va a su propio worker) le asignan
 * la MISMA IP simulada a cuentas de tests distintos y comparten cubo de rate-limit sin
 * saberlo. Por spec en soledad nunca se veía —el filtro `--grep` de cada task acota a un
 * solo archivo—; corriendo la suite completa sí. Además, la mayoría de los throttlers de
 * `auth` (register 5/h, login 10/15min…) están en `@Throttle` **por ruta** en
 * `customer-auth.controller.ts` y NO leen `AUTH_RATE_LIMIT_MAX` —ese env sólo cambia el
 * default global del throttler, que ninguna ruta de auth de cliente usa—: son
 * presupuestos de producción a propósito (§7.3), así que la única forma de no
 * autobloquearse es que cada cuenta hable desde una IP realmente distinta.
 */
const WORKER = Number(process.env.TEST_PARALLEL_INDEX ?? process.env.TEST_WORKER_INDEX ?? 0);
let ip = 0;
const proximaIp = (): string => {
  ip += 1;
  return `10.${WORKER & 255}.${(ip >> 8) & 255}.${ip & 255}`;
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
  const cuerpo = (await res.json()) as { customer: { id: string } };
  cuenta.id = cuerpo.customer.id;
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
/**
 * Posición actual del log. Se toma **antes** de pedir el reset, y el token se busca
 * a partir de ahí: así el token que se lee es el de ESTE pedido y no el último del
 * archivo, que con varios escenarios pidiendo reset puede ser de otra cuenta.
 */
export function marcaDeLog(logPath = process.env.QA_API_LOG ?? '/tmp/api.log'): number {
  try {
    return statSync(logPath).size;
  } catch {
    return 0;
  }
}

/**
 * Token de recuperación escrito **después** de `marca`, para la cuenta `customerId`.
 *
 * Se ESPERA la línea en vez de leer una vez: pino bufferea, así que leer justo después
 * del request encuentra el archivo sin el token todavía. Es una carrera, no una
 * ausencia — y sin el reintento el fallo miente sobre su causa.
 *
 * `marca` sólo acota cuánto log hay que buscar — la correlación real es por
 * `customer_id`, no por posición: con varios escenarios pidiendo reset en paralelo
 * (workers distintos, mismo archivo), "el último token después de la marca" puede
 * pertenecer a OTRA cuenta y el `confirm` aplicaría a la cuenta equivocada — que es
 * justo lo que hacía fallar TC-143 contra TC-144 en paralelo.
 *
 * No hay endpoint que exponga el token, y está bien que no lo haya: viaja por email.
 * Fuera de producción el mailer de log lo escribe con `LOG_LEVEL=debug` (OQ-QA-4).
 */
export async function tokenDeResetDesde(
  marca: number,
  customerId: string,
  logPath = process.env.QA_API_LOG ?? '/tmp/api.log',
): Promise<string> {
  const limite = Date.now() + 5000;
  while (Date.now() < limite) {
    const log = readFileSync(logPath, 'utf8').slice(marca);
    const tokens = [
      ...log.matchAll(
        /password_reset\.token customer_id=([A-Za-z0-9-]+) token=([A-Za-z0-9._-]+)/g,
      ),
    ].filter((m) => m[1] === customerId);
    if (tokens.length > 0) return tokens[tokens.length - 1]![2]!;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(
    `no apareció un token de reset para customer_id=${customerId} después del byte ${marca} en ${logPath}. ` +
      '¿La API corre con LOG_LEVEL=debug y NODE_ENV != production?',
  );
}
