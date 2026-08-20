export interface FieldError {
  field: string;
  message: string;
}

/** Unión discriminada de errores de aplicación (nunca se filtra el body crudo a la UI). */
export type AppError =
  | { kind: 'validation'; message: string; fieldErrors: FieldError[] }
  | { kind: 'conflict'; message: string }
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
      return { kind: 'validation', message, fieldErrors: p.errors ?? [] };
    case 409:
      return { kind: 'conflict', message };
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
