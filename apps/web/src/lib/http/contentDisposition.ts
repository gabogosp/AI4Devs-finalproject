/**
 * Nombre de archivo declarado por el servidor en `Content-Disposition`.
 *
 * El nombre NO se construye en el cliente (`security-standards.md` §6.4 —
 * server-generated storage names): si el header no viene, se usa el
 * `fallback` que decide el llamador.
 *
 * Extraído de `imports/importsService.ts` (Extract Method, US-016 —
 * `refactoring-discipline` skill) para reusarlo en las 3 descargas CSV de
 * `metrics/`.
 */
export function filenameFromContentDisposition(
  headers: Headers,
  fallback: string,
): string {
  const disposition = headers.get('content-disposition') ?? '';
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  return match?.[1] ?? fallback;
}
