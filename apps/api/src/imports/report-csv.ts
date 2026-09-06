import { ImportJob, ImportJobRow } from '@dsm/db';
import { csvCell } from '../common/csv/csv-cell';

/**
 * T5.4 — armado del CSV del reporte de filas rechazadas.
 *
 * `security-standards.md` §6.3 — **encode for the destination context, at output
 * time**. Acá el destino no es HTML: es una planilla de cálculo. Excel y Sheets
 * evalúan como fórmula cualquier celda que empiece con `=`, `+`, `-`, `@`, tab o
 * CR, así que un `sku` como `=cmd|'/c calc'!A1` en el archivo del proveedor se
 * convertiría en ejecución de comandos **en la máquina del dueño** cuando abra el
 * reporte que le dimos nosotros. La fila era inválida, pero el peligro lo
 * introduciríamos nosotros al escribirla sin neutralizar.
 */

/** Encabezado en el idioma del dueño: el reporte lo abre él, no un sistema. */
export const REPORT_HEADER = 'fila,sku,campo,codigo,motivo';

/**
 * La neutralización de celdas se extrajo a `common/csv/csv-cell.ts` (Fowler
 * Extract Function, `design.md §D3` de US-016) — reusada ahora también por
 * los 3 exports de `reports/`. Reexportada bajo su nombre original: cero
 * cambio de comportamiento, cero cambio de firma pública.
 */
export const celdaCsv = csvCell;

/** Nombre del archivo descargable. Server-generated: nunca el del cliente (§6.4). */
export function reportFilename(jobId: string): string {
  return `import-${jobId}-errores.csv`;
}

/**
 * CSV completo del reporte. Un trabajo sin filas rechazadas devuelve **sólo el
 * encabezado**: un 404 o un cuerpo vacío obligarían al panel a tratar "no hay
 * errores" como un caso de error, cuando es el mejor resultado posible.
 */
export function buildReportCsv(job: ImportJob, rows: ImportJobRow[]): string {
  const lineas = [REPORT_HEADER];

  for (const row of rows) {
    lineas.push(
      [
        String(row.row_number),
        celdaCsv(row.sku),
        celdaCsv(row.field),
        celdaCsv(row.error_code),
        celdaCsv(row.error_message),
      ].join(','),
    );
  }

  if (job.report_truncated) {
    // Se declara en el propio archivo, no sólo en el JSON del estado: quien abre
    // el CSV meses después tiene que ver que está recortado sin tener que
    // acordarse de consultar el trabajo.
    lineas.push(
      `# reporte recortado: se listan ${rows.length} de ${job.failed_count} filas rechazadas`,
    );
  }

  return lineas.join('\n') + '\n';
}
