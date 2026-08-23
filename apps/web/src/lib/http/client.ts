import { publicEnv } from '../env';
import { getAuthToken } from './authToken';
import { AppErrorException, mapProblemToAppError, networkError } from './errors';
import { readCsrfToken, requiereCsrf } from './csrf';

/**
 * **Mutator del cliente generado** (orval `override.mutator`) y único punto de
 * red del panel (`frontend-standards` §8).
 *
 * Por qué es el mutator y no un cliente paralelo (F48): el cliente **generado**
 * es un artefacto del contrato, así que no puede nombrar un endpoint que el
 * contrato no declara. Enrutando todo por él, una ruta fuera de contrato se
 * vuelve estructuralmente imposible — que es exactamente cómo se coló
 * `POST /v1/admin/auth/login` cuando el backend no lo exponía. Las operaciones
 * generadas delegan acá, así que los cross-cutting (Authorization, traceparent,
 * timeout, traducción RFC 7807) se conservan intactos.
 *
 * Éste es el ÚNICO `fetch` crudo del frontend y está declarado como tal en
 * `.consumer-contract-allow`.
 *
 * **Isomorfo** (US-003): el storefront lo ejecuta también desde Server
 * Components. En servidor no se inyectan `authorization` (superficie pública)
 * ni `traceparent`: un header aleatorio por render entra en la clave de la Data
 * Cache de Next y anularía `revalidate`/`tags`. Las opciones de caché del caller
 * (`next`, `cache`) se reenvían al `fetch` subyacente — la política de caché la
 * declara cada servicio, nunca este mutator (next-standards §3).
 */

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * `RequestInit` + las extensiones de caché de Next. Es el tipo que ve el cliente
 * generado (`options?: Parameters<typeof customFetch>[1]`), así que un servicio
 * puede declarar `{ next: { revalidate, tags } }` con tipos.
 */
export type FetchInit = RequestInit & {
  next?: { revalidate?: number | false; tags?: string[] };
  /**
   * Marca la llamada como parte de una **superficie autenticada por cookies**.
   *
   * - `'customer'` — la sesión del cliente (US-014): cookies de sesión +
   *   `dsm_csrf`.
   * - `'cart'` — el carrito del invitado (US-007): `dsm_cart` (`httpOnly`) +
   *   `dsm_cart_csrf`. Son **dos sujetos distintos** porque alguien sin cuenta
   *   tiene carrito y no tiene sesión.
   *
   * Los dos comparten el mismo tratamiento —same-origin, `credentials`,
   * double-submit, prohibido en servidor—; lo que cambia es de qué cookie sale
   * el token. Sin esta marca el comportamiento es exactamente el de antes
   * (el panel con `Bearer` desde memoria).
   */
  session?: 'customer' | 'cart';
};

/**
 * Sujeto de CSRF por superficie. El carrito no puede reusar el token de la
 * sesión: el backend valida cada uno contra su propia cookie.
 */
const SUJETO_CSRF = { customer: 'session', cart: 'cart' } as const;

function hex(len: number): string {
  let out = '';
  for (let i = 0; i < len; i += 1) {
    out += Math.floor(Math.random() * 16).toString(16);
  }
  return out;
}

/** W3C traceparent para correlación cliente↔backend. */
function traceparent(): string {
  return `00-${hex(32)}-${hex(16)}-01`;
}

/**
 * Mutator: recibe la URL que construyó el cliente generado (siempre derivada
 * del contrato) y ejecuta la llamada con los cross-cutting del panel.
 *
 * `T` es el **sobre completo** que declara la operación generada
 * (`{ data, status }`), no sólo el payload — por eso se construye y castea acá.
 */
export async function customFetch<T>(
  url: string,
  init: FetchInit = {},
): Promise<T> {
  const isServer = typeof window === 'undefined';
  // Las dos superficies con cookies comparten tratamiento; `conCookies` evita
  // repetir la comparación en los cinco puntos donde importa (y evita que
  // agregar un tercer sujeto se olvide en uno).
  const conCookies = init.session === 'customer' || init.session === 'cart';

  // Las superficies con cookies son **sólo de navegador** (design.md D3 de
  // US-014, heredado por el carrito): las cookies las maneja el navegador, y un
  // Server Component que renderizara contenido personalizado lo metería en la
  // Data Cache de Next — cacheado y servido a otra persona. El carrito es dato
  // personalizado por definición. Lanzar acá lo vuelve imposible por accidente,
  // no por disciplina.
  if (conCookies && isServer) {
    throw new AppErrorException({
      kind: 'server',
      message: 'La sesión del cliente es sólo de navegador (design.md D3)',
    });
  }

  // Same-origin a propósito (ADR-0013): el rewrite de Next lleva la llamada al
  // API, y así la cookie aterriza en el dominio del sitio y vuelve. Una URL
  // absoluta al API rompería la topología entera.
  const absolute = conCookies
    ? url
    : url.startsWith('http')
      ? url
      : `${publicEnv.NEXT_PUBLIC_API_BASE_URL}${url}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  if (init.signal) {
    init.signal.addEventListener('abort', () => controller.abort());
  }

  const headers = new Headers(init.headers);
  // `content-type` por defecto sólo cuando el cuerpo NO es `FormData`.
  //
  // Con un multipart, el `content-type` lo tiene que poner el runtime **con su
  // boundary** (`multipart/form-data; boundary=...`); forzar `application/json`
  // deja un cuerpo multipart anunciado como JSON y el servidor no puede parsearlo
  // — el `POST` del import se colgaba en `request.formData()`. Detectado al
  // cablear US-006 FE (T0.1), que es el primer envío de archivo del panel.
  // `instanceof` no alcanza: el `FormData` que construye el cliente generado y el
  // global de este realm pueden ser objetos distintos (jsdom, tests), y ahí el
  // chequeo daría falso y volveríamos a anunciar el multipart como JSON.
  const esFormData =
    Object.prototype.toString.call(init.body) === '[object FormData]';
  if (!headers.has('content-type') && !esFormData) {
    headers.set('content-type', 'application/json');
  }
  // Sólo en el browser: el token es de la sesión del panel y el traceparent es
  // aleatorio por llamada — en servidor rompería la clave de la Data Cache.
  if (!isServer) {
    headers.set('traceparent', traceparent());
    const token = getAuthToken();
    if (token) headers.set('authorization', `Bearer ${token}`);
  }

  // Double-submit sólo donde el backend lo exige: escrituras de una superficie
  // con cookies. El token sale de la cookie **del sujeto correspondiente** — el
  // carrito no puede firmar con el token de la sesión, el backend valida cada
  // uno contra su propia cookie. Si la cookie no está, la llamada sale SIN
  // header y el 403 se propaga — fail closed. Inventar un valor sólo cambiaría
  // el 403 por un error más confuso.
  if (conCookies && requiereCsrf(init.method)) {
    const csrf = readCsrfToken(SUJETO_CSRF[init.session!]);
    if (csrf) headers.set('x-csrf-token', csrf);
  }

  let res: Response;
  try {
    res = await fetch(absolute, {
      ...init,
      headers,
      signal: controller.signal,
      // Sin `include` el navegador no manda las cookies ni guarda las que
      // vuelven, aunque el rewrite esté bien: la topología no alcanza sola.
      //
      // `cache: 'no-store'` NO es una optimización, es corrección: sin esto el
      // navegador sirve la segunda lectura de `GET /v1/cart` desde su caché y el
      // request no sale, así que el carrito se ve VACÍO para siempre después de
      // agregar algo. Lo encontró `e2e/cart-topology.spec.ts` contra la app
      // construida. No alcanza con que el backend mande `Cache-Control: no-store`
      // —lo manda— porque el header no sobrevive el rewrite same-origin; y de todas
      // formas una lectura personalizada no puede depender de eso para ser correcta.
      ...(conCookies
        ? { credentials: 'include' as const, cache: 'no-store' as const }
        : {}),
    });
  } catch {
    throw new AppErrorException(networkError());
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }
    // El backend manda `Retry-After` en los 429; sin leerlo acá se pierde y la
    // UI no puede decirle al cliente cuánto esperar.
    const retryAfter = Number(res.headers.get('retry-after'));
    throw new AppErrorException(
      mapProblemToAppError(
        res.status,
        body,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
      ),
    );
  }

  // El cuerpo se parsea como JSON **sólo si el servidor dice que es JSON**.
  //
  // Antes se hacía `JSON.parse` de toda respuesta exitosa, y eso rompía
  // cualquier endpoint que no devuelva JSON: el reporte del import
  // (`GET /v1/admin/imports/{id}/report`) responde `text/csv`, así que el parse
  // lanzaba un `SyntaxError` **fuera** del try/catch de red — un fallo opaco, sin
  // envelope y sin traducir, en un camino que el contrato declara desde siempre.
  // Detectado al cablear US-006 FE (T0.1).
  //
  // El texto crudo se devuelve tal cual: quien pide un CSV lo quiere como texto,
  // y castearlo a `T` es exactamente lo que el tipo generado ya declara
  // (`getImportReportResponse200.data: string`).
  const sinCuerpo = [204, 205, 304].includes(res.status);
  const text = sinCuerpo ? '' : await res.text();
  const contentType = res.headers.get('content-type') ?? '';
  const esJson = contentType.includes('json');
  const data = !text ? undefined : esJson ? JSON.parse(text) : text;
  return { data, status: res.status, headers: res.headers } as T;
}

export default customFetch;
