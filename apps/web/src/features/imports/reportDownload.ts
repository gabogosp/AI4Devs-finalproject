import { track } from '@/lib/observability/events';
import { downloadCsv } from '@/lib/http/downloadCsv';
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

  downloadCsv(csv, filename);
  track('import_report_downloaded', { failed_count: failedCount });
}
