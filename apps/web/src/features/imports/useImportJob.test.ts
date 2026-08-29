import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppErrorException } from '@/lib/http/errors';
import { importsService, type ImportJob } from './importsService';
import { useImportJob } from './useImportJob';

const ID = '2f1c9a4e-1111-4111-8111-111111111111';

function job(over: Partial<ImportJob> = {}): ImportJob {
  return {
    id: ID,
    status: 'running',
    filename: 'catalogo.csv',
    source_format: 'csv',
    total_rows: null,
    processed_rows: 10,
    created_count: 8,
    updated_count: 2,
    failed_count: 0,
    categories_created_count: 1,
    error_code: null,
    error_message: null,
    report_truncated: false,
    started_at: '2026-08-23T10:00:00.000Z',
    finished_at: null,
    created_at: '2026-08-23T10:00:00.000Z',
    errors: [],
    pagination: { limit: 50, offset: 0, total: 0 },
    ...over,
  };
}

describe('useImportJob', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('deja de pollear cuando el trabajo cierra: el contador NO crece aunque pasen 60 s', async () => {
    const get = vi
      .spyOn(importsService, 'get')
      .mockResolvedValueOnce(job({ status: 'running' }))
      .mockResolvedValue(job({ status: 'completed', total_rows: 10, finished_at: '2026-08-23T10:00:05.000Z' }));

    const { result } = renderHook(() => useImportJob(ID));

    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100);
    });
    await waitFor(() =>
      expect(result.current.state).toMatchObject({ kind: 'ready' }),
    );
    const llamadasAlCerrar = get.mock.calls.length;

    // 60 s más: si el corte no fuera duro, acá habría ~20 requests más.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(get).toHaveBeenCalledTimes(llamadasAlCerrar);
    expect(result.current.state).toMatchObject({
      kind: 'ready',
      agotado: false,
    });
  });

  it('la cadencia pasa de 1 s a 3 s después de los 30 s', async () => {
    const get = vi.spyOn(importsService, 'get').mockResolvedValue(job());

    renderHook(() => useImportJob(ID));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));

    // Primeros 30 s: ~1 request por segundo.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    const enLosPrimeros30 = get.mock.calls.length;
    expect(enLosPrimeros30).toBeGreaterThan(20);

    // Los 30 s siguientes, a 3 s: bastante menos que en el primer tramo.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    const enLosSegundos30 = get.mock.calls.length - enLosPrimeros30;

    expect(enLosSegundos30).toBeLessThan(enLosPrimeros30 / 2);
    expect(enLosSegundos30).toBeGreaterThan(5);
  });

  it('al desmontar aborta el request en vuelo', async () => {
    let señal: AbortSignal | undefined;
    const get = vi
      .spyOn(importsService, 'get')
      .mockImplementation(async (_id, _page, signal) => {
        señal = signal;
        return job();
      });

    const { unmount } = renderHook(() => useImportJob(ID));
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(señal?.aborted).toBe(false);

    unmount();

    expect(señal?.aborted).toBe(true);
  });

  it('a los 15 minutos deja de preguntar y CONSERVA lo último que vio', async () => {
    const get = vi.spyOn(importsService, 'get').mockResolvedValue(
      job({ status: 'running', processed_rows: 4_000, total_rows: 5_000 }),
    );

    const { result } = renderHook(() => useImportJob(ID));
    await waitFor(() => expect(get).toHaveBeenCalled());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60_000 + 4_000);
    });
    const llamadasAlAgotarse = get.mock.calls.length;

    expect(result.current.state).toMatchObject({
      kind: 'ready',
      agotado: true,
    });
    // Los datos siguen: el trabajo corre en el servidor, lo que se apagó es el polling.
    if (result.current.state.kind === 'ready') {
      expect(result.current.state.job.processed_rows).toBe(4_000);
    }

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(get).toHaveBeenCalledTimes(llamadasAlAgotarse);
  });

  it('un 404 es su propio estado, no un error genérico', async () => {
    vi.spyOn(importsService, 'get').mockRejectedValue(
      new AppErrorException({
        kind: 'notFound',
        message: 'No se encontró esa importación.',
      }),
    );

    const { result } = renderHook(() => useImportJob(ID));

    await waitFor(() =>
      expect(result.current.state).toEqual({ kind: 'noEncontrado' }),
    );
  });

  it('un fallo de red conserva el trabajo previo en vez de vaciar la pantalla', async () => {
    const get = vi
      .spyOn(importsService, 'get')
      .mockResolvedValueOnce(job({ processed_rows: 120 }))
      .mockRejectedValue(
        new AppErrorException({ kind: 'network', message: 'sin conexión' }),
      );

    const { result } = renderHook(() => useImportJob(ID));
    await waitFor(() => expect(result.current.state.kind).toBe('ready'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100);
    });

    await waitFor(() => expect(result.current.state.kind).toBe('error'));
    if (result.current.state.kind === 'error') {
      expect(result.current.state.error.kind).toBe('network');
      expect(result.current.state.job?.processed_rows).toBe(120);
    }
    expect(get).toHaveBeenCalled();
  });

  it('sin id no consulta nada y queda en idle', async () => {
    const get = vi.spyOn(importsService, 'get').mockResolvedValue(job());

    const { result } = renderHook(() => useImportJob(null));

    expect(result.current.state).toEqual({ kind: 'idle' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(get).not.toHaveBeenCalled();
  });

  it('cambiar el offset re-consulta con ese offset (paginación del reporte)', async () => {
    const get = vi.spyOn(importsService, 'get').mockResolvedValue(
      job({ status: 'completed', total_rows: 10 }),
    );

    const { result } = renderHook(() => useImportJob(ID));
    await waitFor(() => expect(get).toHaveBeenCalled());

    act(() => {
      result.current.setOffset(50);
    });

    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith(
        ID,
        { limit: 50, offset: 50 },
        expect.anything(),
      ),
    );
  });
});
