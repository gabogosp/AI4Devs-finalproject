'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { revalidateCatalogSafely } from '@/features/storefront/revalidateSafely';
import { isAppError } from '@/lib/http/errors';
import { track } from '@/lib/observability/events';
import { copyDeFalloGlobal, copyDeRechazo } from './importErrorCopy';
import { ImportErrorsTable } from './ImportErrorsTable';
import type { ImportJob } from './importsService';
import { descargarReporte } from './reportDownload';

export interface ImportResultProps {
  job: ImportJob;
  offset: number;
  onOffsetChange: (offset: number) => void;
  /** Volver a empezar con otro archivo. */
  onReiniciar: () => void;
}

/**
 * Resultado de un trabajo cerrado (`completed` o `failed`).
 *
 * Hace tres cosas que no son «mostrar números»:
 *
 * 1. **Invalida la caché del catálogo del storefront** al pasar a `completed`. Es
 *    la mitad de la costura que el backend declaró y no puede hacer: no tiene canal
 *    hacia el renderizado de Next. Sin esto, el storefront sigue sirviendo precios
 *    viejos después de un ajuste masivo — el peor final de AC-4, con el import
 *    perfecto y el cliente viendo el precio anterior.
 * 2. **Avisa que lo nuevo quedó en borrador** (AC-9) con salida al listado. Sin ese
 *    aviso, el dueño busca sus productos en el storefront y no los encuentra.
 * 3. **Mueve el foco** al encabezado del resumen: si no, quien usa lector de
 *    pantalla no se entera de que el trabajo terminó.
 */
export function ImportResult({
  job,
  offset,
  onOffsetChange,
  onReiniciar,
}: ImportResultProps) {
  const titulo = useRef<HTMLHeadingElement>(null);
  const revalidado = useRef<string | null>(null);
  const [errorDescarga, setErrorDescarga] = useState<string | null>(null);
  const [descargando, setDescargando] = useState(false);

  const completado = job.status === 'completed';

  // Efecto de TRANSICIÓN, no de render: se dispara una vez por trabajo completado.
  // Llamarlo en cada render dispararía una revalidación por cada poll.
  useEffect(() => {
    if (!completado || revalidado.current === job.id) return;
    revalidado.current = job.id;
    // `Safely` ya atrapa el fallo de la promesa, pero el `try` acá hace la garantía
    // **local**: no poder revalidar no puede tumbar la pantalla de resultado, que es
    // lo único que le dice al dueño qué pasó con su archivo. Depender de que un
    // helper ajeno nunca lance es prestarle a otro módulo una garantía propia.
    try {
      revalidateCatalogSafely();
    } catch {
      /* el storefront se refrescará solo; el resultado del import importa más */
    }
    track('import_job_finished', {
      status: job.status,
      created: job.created_count,
      updated: job.updated_count,
      failed: job.failed_count,
      duration_ms:
        job.finished_at && job.started_at
          ? new Date(job.finished_at).getTime() - new Date(job.started_at).getTime()
          : 0,
    });
  }, [completado, job]);

  useEffect(() => {
    titulo.current?.focus();
  }, []);

  const descargar = async (): Promise<void> => {
    setDescargando(true);
    setErrorDescarga(null);
    try {
      await descargarReporte(job.id, job.failed_count);
    } catch (error) {
      setErrorDescarga(
        isAppError(error)
          ? copyDeRechazo(error.appError)
          : 'No se pudo descargar el reporte.',
      );
    } finally {
      setDescargando(false);
    }
  };

  if (!completado) {
    return (
      <section className="flex flex-col gap-4">
        <h2 ref={titulo} tabIndex={-1} className="text-lg font-medium">
          La importación no se completó
        </h2>
        <p role="alert">{copyDeFalloGlobal(job.error_code, job.error_message)}</p>
        <Button onClick={onReiniciar}>Subir otro archivo</Button>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 ref={titulo} tabIndex={-1} className="text-lg font-medium">
        Importación terminada
      </h2>

      <dl className="flex flex-wrap gap-6 text-sm">
        <div>
          <dt className="text-gray-600">Productos creados</dt>
          <dd>{job.created_count}</dd>
        </div>
        <div>
          <dt className="text-gray-600">Productos actualizados</dt>
          <dd>{job.updated_count}</dd>
        </div>
        <div>
          <dt className="text-gray-600">Filas rechazadas</dt>
          <dd>{job.failed_count}</dd>
        </div>
        <div>
          <dt className="text-gray-600">Categorías creadas</dt>
          <dd>{job.categories_created_count}</dd>
        </div>
        <div>
          <dt className="text-gray-600">Filas procesadas</dt>
          <dd>{job.total_rows ?? job.processed_rows}</dd>
        </div>
      </dl>

      {job.created_count > 0 ? (
        <p className="text-sm">
          Los {job.created_count} productos nuevos quedaron en{' '}
          <strong>borrador</strong>: revisalos y publicalos desde el{' '}
          <Link href="/admin/productos">listado de productos</Link>. También quedaron
          pendientes de enriquecimiento con IA, que corre por su cuenta.
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        {job.failed_count > 0 ? (
          <Button onClick={descargar} disabled={descargando}>
            {descargando ? 'Preparando…' : 'Descargar reporte de errores (CSV)'}
          </Button>
        ) : null}
        <Button onClick={onReiniciar}>Importar otro archivo</Button>
      </div>

      {errorDescarga ? <p role="alert">{errorDescarga}</p> : null}

      <ImportErrorsTable
        job={job}
        offset={offset}
        onOffsetChange={onOffsetChange}
      />
    </section>
  );
}
