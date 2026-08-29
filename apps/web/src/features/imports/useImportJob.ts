'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { isAppError, type AppError } from '@/lib/http/errors';
import { importsService, REPORT_PAGE_SIZE, type ImportJob } from './importsService';

/**
 * Cadencia del polling. Rápido al principio —el dueño está mirando— y más lento
 * después, para que una pestaña olvidada no haga miles de requests.
 *
 * `GET {id}` **no consume** el presupuesto de 3 importaciones/hora del `POST` (el
 * backend lo dejó fuera a propósito), así que preguntar es seguro; lo que se
 * acota es el desperdicio.
 */
const INTERVALO_RAPIDO_MS = 1_000;
const INTERVALO_LENTO_MS = 3_000;
const UMBRAL_CADENCIA_MS = 30_000;

/**
 * Tope de vida del seguimiento. Al llegar, se deja de preguntar y **se conserva
 * lo último que se vio**: el trabajo sigue corriendo del lado del servidor y el
 * deep-link lo recupera. Sin tope, una pestaña abierta un fin de semana son
 * ~14.000 requests contra la API.
 */
const TOPE_SEGUIMIENTO_MS = 15 * 60_000;

/**
 * Estado del seguimiento como **unión discriminada** (`frontend-standards.md`
 * §11.4/§11.9), con dos casos propios que no son «error genérico»:
 *
 * - `noEncontrado` — el 404 del contrato. No es un fallo del panel: el trabajo no
 *   existe o la retención de 90 días ya se lo llevó, y la pantalla ofrece empezar
 *   de nuevo en vez de mostrar un error rojo.
 * - `agotado` (dentro de `ready`) — se dejó de preguntar por el tope. Los datos
 *   siguen ahí; lo que se apagó es el polling.
 */
export type ImportJobState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; job: ImportJob; agotado: boolean }
  | { kind: 'noEncontrado' }
  | { kind: 'error'; error: AppError; job?: ImportJob };

export interface UseImportJob {
  state: ImportJobState;
  /** Offset de la tabla de filas rechazadas. La paginación va por el mismo `GET`. */
  offset: number;
  setOffset: (offset: number) => void;
  /** Reintento manual tras un error de red, sin recargar la página. */
  refetch: () => void;
}

/**
 * Sigue un trabajo de import hasta que cierra.
 *
 * Es el **único** lugar con temporizadores y `AbortController` de esta feature:
 * los componentes reciben datos ya resueltos, y por eso se pueden testear sin red
 * (`frontend-standards.md` §11.4).
 */
export function useImportJob(id: string | null): UseImportJob {
  const [state, setState] = useState<ImportJobState>(
    id ? { kind: 'loading' } : { kind: 'idle' },
  );
  const [offset, setOffset] = useState(0);
  const [reintento, setReintento] = useState(0);

  /** Vive entre renders: si estuviera en el estado, cada poll re-armaría el efecto. */
  const cerrado = useRef(false);
  const comenzoEn = useRef(0);

  const refetch = useCallback(() => {
    cerrado.current = false;
    setReintento((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!id) {
      setState({ kind: 'idle' });
      return;
    }

    cerrado.current = false;
    comenzoEn.current = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let vigente = true;
    const controller = new AbortController();

    const pedir = async (): Promise<void> => {
      try {
        const job = await importsService.get(
          id,
          { limit: REPORT_PAGE_SIZE, offset },
          controller.signal,
        );
        if (!vigente) return;

        const terminado = job.status === 'completed' || job.status === 'failed';
        const transcurrido = Date.now() - comenzoEn.current;
        const agotado = !terminado && transcurrido >= TOPE_SEGUIMIENTO_MS;

        setState({ kind: 'ready', job, agotado });

        if (terminado || agotado) {
          // Corte duro: el timer no se re-agenda. «Dejar que muera solo» es cómo
          // se llega a una pestaña preguntando para siempre.
          cerrado.current = true;
          return;
        }

        timer = setTimeout(
          pedir,
          transcurrido < UMBRAL_CADENCIA_MS
            ? INTERVALO_RAPIDO_MS
            : INTERVALO_LENTO_MS,
        );
      } catch (error) {
        if (!vigente) return;
        if (isAppError(error, 'notFound')) {
          cerrado.current = true;
          setState({ kind: 'noEncontrado' });
          return;
        }
        // Un fallo de red **conserva** lo último visto: tirar el trabajo dejaría
        // la pantalla vacía y parecería que el import se perdió.
        setState((previo) => ({
          kind: 'error',
          error: isAppError(error)
            ? error.appError
            : { kind: 'server', message: 'No se pudo consultar la importación' },
          job: previo.kind === 'ready' ? previo.job : previo.kind === 'error' ? previo.job : undefined,
        }));
        cerrado.current = true;
      }
    };

    void pedir();

    return () => {
      vigente = false;
      if (timer) clearTimeout(timer);
      // Sin esto, navegar durante el polling deja un fetch en vuelo que resuelve
      // sobre un componente desmontado.
      controller.abort();
    };
  }, [id, offset, reintento]);

  return { state, offset, setOffset, refetch };
}
