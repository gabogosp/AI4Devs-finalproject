import { track } from '@/lib/observability/events';
import { importsService } from './importsService';

/**
 * Dispara la descarga del CSV del reporte.
 *
 * **Por qué no es un `<a href>`**: el panel se autentica con un Bearer que vive en
 * memoria (`src/lib/http/authToken.ts`), y un link nativo no lo lleva — el dueño
 * recibiría un 401 en una pestaña nueva, sin explicación. Así que la descarga pasa
 * por el servicio (o sea por el mutator único, `frontend-standards.md` §8), y el
 * archivo se materializa desde un `Blob`.
 *
 * El nombre lo elige el **servidor** (`Content-Disposition`); construirlo acá sería
 * duplicar una decisión que ya está tomada del otro lado
 * (`security-standards.md` §6.4).
 */
export async function descargarReporte(
  id: string,
  failedCount: number,
): Promise<void> {
  const { csv, filename } = await importsService.downloadReport(id);

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = filename;
    // No se agrega al DOM: `click()` sobre un elemento desconectado alcanza para
    // disparar la descarga y evita dejar basura si algo falla en el medio.
    enlace.click();
    track('import_report_downloaded', { failed_count: failedCount });
  } finally {
    // Sin revocar, cada descarga deja el CSV completo retenido en memoria hasta
    // que se cierre la pestaña.
    URL.revokeObjectURL(url);
  }
}
