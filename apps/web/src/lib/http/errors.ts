export interface FieldError {
  field: string;
  message: string;
}

/**
 * Unión discriminada de errores de aplicación (nunca se filtra el body crudo a
 * la UI).
 *
 * `kind` agrupa por **cómo se trata** el error, y a veces eso junta cosas que
 * la UI necesita separar: 400 y 422 son ambos `validation`, pero el backend usa
 * el 400 para "este token de recuperación no sirve" y el 422 para "esta
 * contraseña es débil" — reacciones opuestas, porque una manda a pedir un link
 * nuevo y la otra deja reintentar en el mismo formulario.
 *
 * Por eso se propaga `problemType`: el `type` del envelope RFC 7807, que es un
 * catálogo cerrado que el backend garantiza. Distinguir por la **forma** del
 * error (por ejemplo, "si no trae fieldErrors es un token muerto") sería
 * adivinar por apariencia en vez de leer el hecho.
 */
export type AppError =
  | {
      kind: 'validation';
      message: string;
      fieldErrors: FieldError[];
      problemType?: string;
    }
  /**
   * 409. Lleva los **extension members** RFC 7807 §3.2 que el backend declara
   * como campos de primer nivel a propósito —`available_quantity` de
   * `dsm:cart/insufficient-stock` y `max_items` de `dsm:cart/too-many-items`—
   * para que el frontend no tenga que sacarlos del `detail` con una regex
   * (US-007 AC-5). `problemType` distingue los dos casos sin adivinar por la
   * forma del error.
   */
  | {
      kind: 'conflict';
      message: string;
      problemType?: string;
      availableQuantity?: number;
      maxItems?: number;
    }
  | { kind: 'unauthorized'; message: string }
  | { kind: 'forbidden'; message: string }
  | { kind: 'notFound'; message: string }
  /** 429: el backend pide esperar. Transitorio y esperado, NO un fallo. */
  | { kind: 'rateLimited'; message: string; retryAfterSeconds?: number }
  | { kind: 'network'; message: string }
  | { kind: 'server'; message: string };

interface ProblemBody {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  errors?: FieldError[];
  /** Extension member de `dsm:cart/insufficient-stock` (US-007). */
  available_quantity?: number;
  /** Extension member de `dsm:cart/too-many-items` (US-007). */
  max_items?: number;
}

/** Mapea el envelope RFC 7807 (`application/problem+json`) a un `AppError` tipado. */
export function mapProblemToAppError(
  status: number,
  body: unknown,
  retryAfterSeconds?: number,
): AppError {
  const p: ProblemBody =
    typeof body === 'object' && body !== null ? (body as ProblemBody) : {};
  const message = p.detail || p.title || 'Ocurrió un error';
  switch (status) {
    case 400:
    case 422:
      return {
        kind: 'validation',
        message,
        fieldErrors: p.errors ?? [],
        problemType: p.type,
      };
    case 409:
      return {
        kind: 'conflict',
        message,
        problemType: p.type,
        ...(typeof p.available_quantity === 'number'
          ? { availableQuantity: p.available_quantity }
          : {}),
        ...(typeof p.max_items === 'number' ? { maxItems: p.max_items } : {}),
      };
    case 401:
      return { kind: 'unauthorized', message };
    case 403:
      return { kind: 'forbidden', message };
    case 404:
      return { kind: 'notFound', message };
    case 429:
      // Sin este caso, un 429 caía en el `default` y —al no ser >= 500— salía
      // como `server`, que la página relanza y el boundary convierte en un
      // **500**. Eso es lo peor posible justo en las páginas que existen para
      // ser indexadas: un buscador que crawlea durante una ráfaga ve 5xx y
      // termina sacando URLs del índice. Además tiraba el `Retry-After` que el
      // backend manda a propósito.
      return { kind: 'rateLimited', message, retryAfterSeconds };
    default:
      return status >= 500
        ? { kind: 'server', message: 'Ocurrió un error en el servidor' }
        : { kind: 'server', message };
  }
}

export function networkError(): AppError {
  return { kind: 'network', message: 'No se pudo conectar con el servidor' };
}

/** Excepción portadora de un `AppError` — lo que capturan los componentes. */
export class AppErrorException extends Error {
  constructor(public readonly appError: AppError) {
    super(appError.message);
    this.name = 'AppErrorException';
  }
}

/**
 * Type-guard para ramificar por tipo de error sin inspeccionar strings. Con
 * `kind`, estrecha a ese caso (p.ej. `notFound` → `notFound()` de Next).
 */
export function isAppError(error: unknown, kind?: AppError['kind']): error is AppErrorException {
  return (
    error instanceof AppErrorException &&
    (kind === undefined || error.appError.kind === kind)
  );
}
