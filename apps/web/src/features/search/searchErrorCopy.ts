import type { AppError } from '@/lib/http/errors';
import { MIN_CARACTERES_UTILES } from './queryGuard';

/**
 * El copy de los rechazos de la búsqueda (design-system §10.2: de vos, sin
 * jerga, accionable).
 *
 * Dos reglas gobiernan todo el módulo:
 *
 * 1. **El `detail` del servidor nunca se muestra.** No es una preferencia de
 *    estilo: ese texto lo escribió el backend para un desarrollador, cambia sin
 *    aviso, y en el peor caso filtra el nombre de una variable de entorno o de
 *    un proveedor. El copy es constante nuestra; el error del servidor sólo
 *    elige cuál.
 * 2. **Nadie tiene la culpa.** «Consulta inválida» le dice al cliente que
 *    escribió mal cuando lo que pasó es que nuestro mínimo es de dos caracteres.
 *    El mensaje dice qué hacer, no qué hizo mal.
 *
 * La ramificación va por `problemType` —el `type` RFC 7807, catálogo cerrado que
 * el backend garantiza— y no por la forma del error: distinguir «corta» de
 * «larga» mirando si el `detail` contiene la palabra «corta» sería adivinar por
 * apariencia y romperse con el primer cambio de redacción.
 */

export const COPY_CONSULTA_CORTA = `Escribí al menos ${MIN_CARACTERES_UTILES} caracteres para buscar.`;

/**
 * El tope exacto no se nombra: es una constante del servidor que puede cambiar,
 * y un número desactualizado en pantalla es peor que ninguno.
 */
export const COPY_CONSULTA_LARGA =
  'La búsqueda es muy larga. Probá con menos palabras, las más importantes.';

export const COPY_NO_DISPONIBLE =
  'La búsqueda no está disponible en este momento. Podés seguir navegando por rubros.';

export const COPY_RED =
  'No pudimos conectar. Revisá tu conexión y probá de nuevo.';

export const COPY_GENERICO =
  'No pudimos completar la búsqueda. Probá de nuevo en un momento.';

const TYPE_CONSULTA_CORTA = 'dsm:search/query-too-short';
const TYPE_CONSULTA_LARGA = 'dsm:search/query-too-long';

/**
 * AC-10: el rate-limit se explica, no se esconde.
 *
 * Cuando el backend manda `Retry-After` se dice el número; cuando no, el mensaje
 * es genérico en lugar de inventar una espera. Prometer «30 segundos» sin
 * saberlo hace que el cliente vuelva a los 30 y se coma otro rechazo, que es
 * peor que no haber prometido nada.
 */
export function copyRateLimited(retryAfterSeconds?: number): string {
  if (!retryAfterSeconds || retryAfterSeconds <= 0) {
    return 'Hiciste varias búsquedas seguidas. Esperá un momento y probá de nuevo.';
  }
  if (retryAfterSeconds < 60) {
    return `Hiciste varias búsquedas seguidas. Probá de nuevo en ${retryAfterSeconds} segundos.`;
  }
  const minutos = Math.ceil(retryAfterSeconds / 60);
  return `Hiciste varias búsquedas seguidas. Probá de nuevo en ${minutos} ${
    minutos === 1 ? 'minuto' : 'minutos'
  }.`;
}

/** Traduce un `AppError` de la búsqueda al copy que ve el cliente. */
export function searchErrorCopy(error: AppError): string {
  switch (error.kind) {
    case 'validation':
      if (error.problemType === TYPE_CONSULTA_LARGA) return COPY_CONSULTA_LARGA;
      if (error.problemType === TYPE_CONSULTA_CORTA) return COPY_CONSULTA_CORTA;
      // Un 422 de otro `type` (por ejemplo un query param fuera de la
      // whitelist) no es culpa de lo que el cliente escribió, así que no se le
      // dice que su consulta está mal.
      return COPY_GENERICO;
    case 'rateLimited':
      return copyRateLimited(error.retryAfterSeconds);
    case 'network':
      return COPY_RED;
    case 'server':
      return COPY_NO_DISPONIBLE;
    default:
      return COPY_GENERICO;
  }
}
