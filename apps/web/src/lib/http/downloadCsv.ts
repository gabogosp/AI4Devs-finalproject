/**
 * Materializa un CSV en el navegador como una descarga de archivo real.
 *
 * **Por qué no es un `<a href>` directo a la API**: el panel se autentica con
 * un Bearer que vive en memoria (`src/lib/http/authToken.ts`), y un link
 * nativo no lo lleva — el dueño recibiría un 401 sin explicación. El CSV
 * llega vía el servicio (mutator único, `frontend-standards.md` §8) y se
 * materializa acá desde un `Blob`.
 *
 * Extraído de `imports/reportDownload.ts` (Extract Method, US-016 —
 * `refactoring-discipline` skill) para reusarlo en los 3 exports de
 * `metrics/`. El evento de negocio (`track(...)`) NO se movió acá: es
 * específico de cada feature, no de la descarga en sí.
 */
export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = filename;
    // No se agrega al DOM: `click()` sobre un elemento desconectado alcanza
    // para disparar la descarga y evita dejar basura si algo falla en el
    // medio.
    enlace.click();
  } finally {
    // Sin revocar, cada descarga deja el CSV completo retenido en memoria
    // hasta que se cierre la pestaña.
    URL.revokeObjectURL(url);
  }
}
