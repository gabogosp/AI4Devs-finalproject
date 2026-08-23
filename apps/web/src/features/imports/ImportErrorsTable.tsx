'use client';

import { Button } from '@/components/ui/Button';
import { copyDeFila } from './importErrorCopy';
import { REPORT_PAGE_SIZE, type ImportJob } from './importsService';

export interface ImportErrorsTableProps {
  job: ImportJob;
  offset: number;
  onOffsetChange: (offset: number) => void;
}

/**
 * Filas rechazadas del trabajo (AC-5, OQ-FE-5).
 *
 * Es una `<table>` con encabezados reales porque **es** una tabla de datos: el
 * dueño compara filas, no lee un texto maquetado.
 *
 * Todo el contenido se renderiza como **texto** en JSX. `sku` y `error_message`
 * vienen del archivo de un proveedor, o sea de una fuente que no controlamos:
 * cualquier interpolación como HTML acá sería una inyección con el catálogo del
 * cliente como vector (`security-standards.md` §6). React escapa por defecto y esta
 * feature no usa `dangerouslySetInnerHTML` en ningún lado.
 */
export function ImportErrorsTable({
  job,
  offset,
  onOffsetChange,
}: ImportErrorsTableProps) {
  const total = job.pagination.total;
  const limit = job.pagination.limit || REPORT_PAGE_SIZE;

  if (job.failed_count === 0) {
    return (
      <p className="text-sm">Ninguna fila fue rechazada: entró todo el archivo.</p>
    );
  }

  const desde = total === 0 ? 0 : offset + 1;
  const hasta = Math.min(offset + job.errors.length, total);

  return (
    <section className="flex flex-col gap-3">
      <h3 className="font-medium">Filas rechazadas</h3>

      {job.report_truncated ? (
        <p role="alert" className="text-sm">
          Se rechazaron {job.failed_count} filas y guardamos el detalle de las
          primeras {total}. El CSV descargable también viene recortado.
        </p>
      ) : null}

      <table className="w-full text-left text-sm">
        <thead>
          <tr>
            <th scope="col">Fila</th>
            <th scope="col">SKU</th>
            <th scope="col">Campo</th>
            <th scope="col">Motivo</th>
            <th scope="col">Detalle del servidor</th>
          </tr>
        </thead>
        <tbody>
          {job.errors.map((fila) => (
            <tr key={`${fila.row_number}-${fila.field ?? ''}`}>
              <td>{fila.row_number}</td>
              <td>{fila.sku ?? '—'}</td>
              <td>{fila.field ?? '—'}</td>
              <td>{copyDeFila(fila.error_code, fila.error_message)}</td>
              <td>{fila.error_message}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex items-center gap-3 text-sm">
        <span>
          {desde}–{hasta} de {total}
        </span>
        <Button
          onClick={() => onOffsetChange(Math.max(0, offset - limit))}
          disabled={offset === 0}
        >
          Anteriores
        </Button>
        <Button
          onClick={() => onOffsetChange(offset + limit)}
          disabled={offset + job.errors.length >= total}
        >
          Siguientes
        </Button>
      </div>
    </section>
  );
}
