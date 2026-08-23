'use client';

import type { ImportJob } from './importsService';

export interface ImportProgressProps {
  job: ImportJob;
  /** `true` cuando el seguimiento se apagó por el tope de 15 min (el trabajo sigue). */
  agotado?: boolean;
}

/**
 * Progreso de un trabajo en curso (AC-7).
 *
 * `total_rows` es `null` hasta que el servidor termina de leer el archivo, así que
 * la barra arranca **indeterminada** y pasa a determinada cuando el total existe.
 * Estimarlo por el peso del archivo daría una barra que retrocede, que es peor que
 * no tenerla.
 *
 * Accesibilidad: mientras es indeterminada **se omite** `aria-valuenow` en lugar
 * de escribir 0 —un 0 le miente al lector de pantalla— y el avance se anuncia en
 * una región viva, que es lo único que hace perceptible el progreso sin ver la
 * pantalla (`qa-frontend-standards.md` §19).
 */
export function ImportProgress({ job, agotado = false }: ImportProgressProps) {
  const total = job.total_rows;
  const determinado = typeof total === 'number' && total > 0;
  const porcentaje = determinado
    ? Math.min(100, Math.round((job.processed_rows / total) * 100))
    : 0;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">Importando el catálogo</h2>

      <div
        role="progressbar"
        aria-label="Progreso de la importación"
        aria-valuemin={0}
        {...(determinado
          ? { 'aria-valuemax': total, 'aria-valuenow': job.processed_rows }
          : {})}
        className="h-2 w-full overflow-hidden rounded bg-gray-200"
      >
        <div
          className={
            determinado
              ? 'h-full bg-blue-600'
              : 'h-full w-1/3 animate-pulse bg-blue-600'
          }
          style={determinado ? { width: `${porcentaje}%` } : undefined}
        />
      </div>

      {/*
        Región viva: es la que hace que el avance exista para quien no mira la
        pantalla. `polite` y no `assertive` porque el progreso no debe interrumpir
        lo que la persona esté leyendo.
      */}
      <p role="status" aria-live="polite" className="text-sm">
        {determinado
          ? `Procesando ${job.processed_rows} de ${total} filas (${porcentaje}%).`
          : `Procesando… ${job.processed_rows} filas leídas.`}
      </p>

      {/* Contadores parciales: se ven MIENTRAS corre, no sólo al final (AC-7). */}
      <dl className="flex gap-6 text-sm">
        <div>
          <dt className="text-gray-600">Creados</dt>
          <dd>{job.created_count}</dd>
        </div>
        <div>
          <dt className="text-gray-600">Actualizados</dt>
          <dd>{job.updated_count}</dd>
        </div>
        <div>
          <dt className="text-gray-600">Rechazados</dt>
          <dd>{job.failed_count}</dd>
        </div>
      </dl>

      {agotado ? (
        <p role="alert" className="text-sm">
          Dejamos de consultar el estado por ahora, pero la importación sigue
          corriendo en el servidor. Volvé a entrar a esta página para ver cómo
          terminó.
        </p>
      ) : null}
    </section>
  );
}
