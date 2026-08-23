import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '@/test/server';
import { setEventSink } from '@/lib/observability/events';
import { ImportScreen } from './ImportScreen';
import type { ImportJob } from './importsService';

const API = 'http://localhost:3000';
const ID = '2f1c9a4e-1111-4111-8111-111111111111';
/** Datos reconocibles del catálogo del cliente: si aparecen en un evento, es una fuga. */
const NOMBRE_ARCHIVO = 'catalogo-del-duenio-septiembre.csv';
const SKU_RECONOCIBLE = 'SKU-ZZZ-9876';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/features/storefront/revalidateSafely', () => ({
  revalidateCatalogSafely: vi.fn(),
  revalidateProductSafely: vi.fn(),
}));

function job(over: Partial<ImportJob> = {}): ImportJob {
  return {
    id: ID,
    status: 'completed',
    filename: NOMBRE_ARCHIVO,
    source_format: 'csv',
    total_rows: 500,
    processed_rows: 500,
    created_count: 480,
    updated_count: 19,
    failed_count: 1,
    categories_created_count: 2,
    error_code: null,
    error_message: null,
    report_truncated: false,
    started_at: '2026-08-23T10:00:00.000Z',
    finished_at: '2026-08-23T10:00:12.000Z',
    created_at: '2026-08-23T10:00:00.000Z',
    errors: [
      {
        row_number: 7,
        sku: SKU_RECONOCIBLE,
        field: 'precio',
        error_code: 'invalid_price',
        error_message: 'el precio no es válido',
      },
    ],
    pagination: { limit: 50, offset: 0, total: 1 },
    ...over,
  };
}

describe('eventos del import (imports.events)', () => {
  let eventos: Array<{ event: string; props: Record<string, unknown> }>;

  beforeEach(() => {
    eventos = [];
    setEventSink((event, props) => eventos.push({ event, props }));
    sessionStorage.clear();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(() => 'blob:mock'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    setEventSink(() => {});
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('el flujo completo emite los cuatro eventos y ninguno lleva contenido del archivo', async () => {
    server.use(
      http.post(`${API}/v1/admin/imports`, () =>
        HttpResponse.json({ id: ID, status: 'pending' }, { status: 202 }),
      ),
    );
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    // 1. subida
    const { unmount } = render(<ImportScreen />);
    await userEvent.upload(
      screen.getByLabelText(/archivo del catálogo/i),
      new File(['sku,nombre\n'], NOMBRE_ARCHIVO, { type: 'text/csv' }),
    );
    await userEvent.click(screen.getByRole('button', { name: /importar catálogo/i }));
    await waitFor(() =>
      expect(eventos.some((e) => e.event === 'import_upload_submitted')).toBe(true),
    );
    unmount();

    // 2. seguimiento hasta el cierre y 3. descarga del reporte
    server.use(
      http.get(`${API}/v1/admin/imports/${ID}`, () => HttpResponse.json(job())),
      http.get(`${API}/v1/admin/imports/${ID}/report`, () =>
        new HttpResponse('fila,sku,campo,codigo,motivo\n', {
          status: 200,
          headers: {
            'content-type': 'text/csv; charset=utf-8',
            'content-disposition': `attachment; filename="import-${ID}-errores.csv"`,
          },
        }),
      ),
    );
    render(<ImportScreen jobId={ID} />);
    await screen.findByRole('heading', { name: /importación terminada/i });
    await userEvent.click(screen.getByRole('button', { name: /descargar reporte/i }));

    await waitFor(() =>
      expect(eventos.some((e) => e.event === 'import_report_downloaded')).toBe(true),
    );

    const nombres = eventos.map((e) => e.event);
    expect(nombres).toContain('import_upload_submitted');
    expect(nombres).toContain('import_job_finished');
    expect(nombres).toContain('import_report_downloaded');

    // La propiedad que importa: los logs no pueden volverse una copia parcial del
    // catálogo del cliente. Ni el nombre del archivo ni un sku.
    const volcado = JSON.stringify(eventos);
    expect(volcado).not.toContain(NOMBRE_ARCHIVO);
    expect(volcado).not.toContain(SKU_RECONOCIBLE);
    expect(volcado).not.toContain('el precio no es válido');
  });

  it('un rechazo del POST emite import_upload_rejected con el type, sin el archivo', async () => {
    server.use(
      http.post(`${API}/v1/admin/imports`, () =>
        HttpResponse.json(
          {
            type: 'dsm:import/missing-columns',
            title: 'Unprocessable Entity',
            status: 422,
            detail: 'El archivo no tiene las columnas requeridas: precio.',
            instance: '/v1/admin/imports',
            errors: [{ field: 'precio', message: 'columna requerida ausente' }],
          },
          { status: 422, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    render(<ImportScreen />);

    await userEvent.upload(
      screen.getByLabelText(/archivo del catálogo/i),
      new File(['sku\n'], NOMBRE_ARCHIVO, { type: 'text/csv' }),
    );
    await userEvent.click(screen.getByRole('button', { name: /importar catálogo/i }));

    await waitFor(() =>
      expect(eventos.some((e) => e.event === 'import_upload_rejected')).toBe(true),
    );
    const rechazo = eventos.find((e) => e.event === 'import_upload_rejected')!;
    expect(rechazo.props.problem_type).toBe('dsm:import/missing-columns');
    expect(JSON.stringify(rechazo.props)).not.toContain(NOMBRE_ARCHIVO);
  });

  it('un trabajo con seis polls emite UN solo import_job_finished', async () => {
    // Timers falsos con `shouldAdvanceTime` (el patrón que ya usa useImportJob.test):
    // seis sondeos de 1 s son ~5 s de reloj real, justo el techo del timeout, y un
    // test que tarda 5 s por esperar de verdad no aporta nada que no aporte este.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let llamadas = 0;
    server.use(
      http.get(`${API}/v1/admin/imports/${ID}`, () => {
        llamadas += 1;
        // Cinco respuestas en curso y después el cierre: si el evento se emitiera
        // por render, acá habría varios.
        return HttpResponse.json(
          llamadas <= 5
            ? job({ status: 'running', finished_at: null, processed_rows: llamadas * 80 })
            : job(),
        );
      }),
    );

    render(<ImportScreen jobId={ID} />);
    await vi.advanceTimersByTimeAsync(7_000);
    await screen.findByRole('heading', { name: /importación terminada/i });

    expect(llamadas).toBeGreaterThanOrEqual(6);
    const finalizados = eventos.filter((e) => e.event === 'import_job_finished');
    expect(finalizados).toHaveLength(1);
    expect(finalizados[0].props).toMatchObject({
      status: 'completed',
      created: 480,
      updated: 19,
      failed: 1,
    });
  });
});
