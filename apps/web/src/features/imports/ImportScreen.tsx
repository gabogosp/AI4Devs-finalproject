'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { ImportProgress } from './ImportProgress';
import { ImportResult } from './ImportResult';
import { ImportUpload } from './ImportUpload';
import { useImportJob } from './useImportJob';

/**
 * Clave del respaldo del id del trabajo en curso.
 *
 * `sessionStorage` y **no** `localStorage`: los trabajos se purgan a los 90 días,
 * así que un id inmortal termina apuntando a un 404. Y no es fuente de verdad —la
 * URL lo es—: si el id guardado no existe, la pantalla lo dice y vuelve a empezar.
 */
const CLAVE_ULTIMO_ID = 'dsm:ultimo-import';

export interface ImportScreenProps {
  /** Id del trabajo cuando se entra por el deep-link `/admin/importar/{id}`. */
  jobId?: string;
}

/**
 * Orquesta el flujo del import (OQ-FE-1, OQ-FE-3).
 *
 * Compone las cuatro piezas y decide qué se muestra; el estado del seguimiento lo
 * sostiene `useImportJob` y la red vive en el servicio, así que acá no hay ni un
 * `fetch` ni un temporizador.
 */
export function ImportScreen({ jobId }: ImportScreenProps) {
  const router = useRouter();
  const { state, offset, setOffset } = useImportJob(jobId ?? null);
  const [idGuardado, setIdGuardado] = useState<string | null>(null);

  // Sólo importa cuando se entra "pelado": si ya hay un trabajo en la URL, ese manda.
  useEffect(() => {
    if (jobId) return;
    try {
      setIdGuardado(sessionStorage.getItem(CLAVE_ULTIMO_ID));
    } catch {
      /* sin sessionStorage (modo restringido) el flujo funciona igual, sin retomar */
    }
  }, [jobId]);

  const alCrear = useCallback(
    (id: string) => {
      try {
        sessionStorage.setItem(CLAVE_ULTIMO_ID, id);
      } catch {
        /* el deep-link de la URL alcanza */
      }
      // La URL es lo que hace que un refresh no pierda de vista el trabajo.
      router.push(`/admin/importar/${id}`);
    },
    [router],
  );

  const reiniciar = useCallback(() => {
    try {
      sessionStorage.removeItem(CLAVE_ULTIMO_ID);
    } catch {
      /* nada que limpiar */
    }
    router.push('/admin/importar');
  }, [router]);

  if (!jobId) {
    return (
      <div className="flex flex-col gap-6">
        {idGuardado ? (
          <div className="flex items-center gap-3 text-sm">
            <p>Tenés una importación reciente sin revisar.</p>
            <Button onClick={() => router.push(`/admin/importar/${idGuardado}`)}>
              Ver su resultado
            </Button>
          </div>
        ) : null}
        <ImportUpload onCreated={alCrear} />
      </div>
    );
  }

  if (state.kind === 'loading' || state.kind === 'idle') {
    return <p role="status">Buscando la importación…</p>;
  }

  if (state.kind === 'noEncontrado') {
    return (
      <div className="flex flex-col gap-3">
        <p role="alert">
          Esa importación no existe o ya se purgó: los trabajos se guardan 90 días.
        </p>
        <Button onClick={reiniciar}>Importar un archivo</Button>
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="flex flex-col gap-3">
        <p role="alert">
          No pudimos consultar el estado de la importación. Sigue corriendo en el
          servidor: volvé a entrar en un rato.
        </p>
        {state.job ? (
          <ImportProgress job={state.job} agotado />
        ) : (
          <Button onClick={reiniciar}>Volver a empezar</Button>
        )}
      </div>
    );
  }

  const { job, agotado } = state;
  const cerrado = job.status === 'completed' || job.status === 'failed';

  return cerrado ? (
    <ImportResult
      job={job}
      offset={offset}
      onOffsetChange={setOffset}
      onReiniciar={reiniciar}
    />
  ) : (
    <ImportProgress job={job} agotado={agotado} />
  );
}
