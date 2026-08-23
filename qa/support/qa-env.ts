/**
 * Fuente única del entorno de la suite QA (D-2/D-4, decisiones del PO 2026-08-23).
 *
 * Antes, tres archivos declaraban su propio default y **ninguno coincidía**:
 * `world.ts` asumía el web en `3100`, `cart-client.ts` mandaba `Origin: 3210` y el
 * storefront real corre en `3200`. El costo de esa divergencia no fue un test
 * rojo claro: fue **cinco escenarios del carrito acusando asserts de negocio**
 * («la línea quitada sigue en el carrito», «1 !== 2») cuando lo que pasaba era que
 * la segunda escritura moría en 403 porque el `Origin` no estaba en la allowlist.
 * Un problema de entorno disfrazado de defecto de producto cuesta horas.
 *
 * Los defaults son los **canónicos de `docs/RUN-MVP.md`**: API en 3000, web en
 * 3200 (esa guía descarta el 3100 a propósito, porque suele estar ocupado por
 * contenedores de otros proyectos).
 */

export const QA_API_BASE_URL =
  process.env.QA_API_BASE_URL ?? 'http://localhost:3000';

/**
 * Origen del cliente web para la suite. Cumple dos roles y por eso vive acá una
 * sola vez: es la URL que el navegador visita **y** el `Origin` que la API tiene
 * que tener en su allowlist para aceptar las escrituras del carrito.
 */
export const QA_WEB_BASE_URL =
  process.env.QA_WEB_BASE_URL ?? 'http://localhost:3200';

/** Comando que deja la API en condiciones de correr la suite. */
export const RECETA_API_QA = 'pnpm --filter @dsm/qa api:up';

/**
 * Verifica que la API sea **apta para QA** antes de que corra el primer
 * escenario, y falla con un mensaje de entorno en vez de dejar que el problema
 * reviente después como un assert de dominio.
 *
 * Se chequean las dos condiciones que ya nos hicieron perder tiempo:
 *
 * 1. **La API responde.** Si no, ningún escenario tiene sentido.
 * 2. **El `Origin` de la suite está en la allowlist de CORS.** Es el chequeo que
 *    más valor tiene, porque su ausencia es silenciosa: la **primera** escritura
 *    del carrito pasa igual (sin cookie no hay carrito que secuestrar) y sólo
 *    falla la segunda, así que el síntoma aparece lejos de la causa.
 *
 * El presupuesto de rate-limit no se puede inspeccionar desde afuera, así que ahí
 * la defensa es el mensaje de `admin-auth.ts` cuando el login devuelve 429.
 */
export async function verificarEntornoQA(): Promise<void> {
  let salud: Response;
  try {
    salud = await fetch(`${QA_API_BASE_URL}/health`);
  } catch (cause) {
    throw new Error(
      `[qa/entorno] La API no responde en ${QA_API_BASE_URL}. ` +
        `Levantala con: ${RECETA_API_QA}`,
      { cause },
    );
  }
  if (!salud.ok) {
    throw new Error(
      `[qa/entorno] ${QA_API_BASE_URL}/health devolvió ${salud.status}. ` +
        `La API está arriba pero no sana; revisá su log antes de correr la suite.`,
    );
  }

  // Preflight real contra una ruta de escritura del carrito: es la que exige el
  // `CartCsrfGuard`, así que es la que hay que probar.
  const preflight = await fetch(`${QA_API_BASE_URL}/v1/cart/items/preflight`, {
    method: 'OPTIONS',
    headers: {
      Origin: QA_WEB_BASE_URL,
      'Access-Control-Request-Method': 'PUT',
    },
  });
  const permitido = preflight.headers.get('access-control-allow-origin');
  if (permitido !== QA_WEB_BASE_URL) {
    throw new Error(
      `[qa/entorno] La API en ${QA_API_BASE_URL} NO tiene ${QA_WEB_BASE_URL} en su allowlist de CORS ` +
        `(el preflight devolvió ${preflight.status} y allow-origin=${permitido ?? 'ausente'}). ` +
        `Sin eso la PRIMERA escritura del carrito pasa y la SEGUNDA muere en 403, y los escenarios ` +
        `fallan como si el carrito estuviera roto. Arrancá la API con ` +
        `CORS_ALLOWED_ORIGINS=${QA_WEB_BASE_URL} o usá: ${RECETA_API_QA}`,
    );
  }
}
