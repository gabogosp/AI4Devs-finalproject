import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '@/test/server';
import { setEventSink } from '@/lib/observability/events';
import { descargarReporte } from './reportDownload';

const API = 'http://localhost:3000';
const ID = '2f1c9a4e-1111-4111-8111-111111111111';
const CSV = 'fila,sku,campo,codigo,motivo\n2,REF-1,precio,invalid_price,mal precio\n';

describe('descargarReporte', () => {
  let creados: string[];
  let revocados: string[];

  beforeEach(() => {
    creados = [];
    revocados = [];
    // jsdom no implementa object URLs, así que se parchean **sólo los dos métodos**
    // para poder afirmar el ciclo completo (crear → usar → revocar), que es lo que
    // evita la fuga de memoria.
    //
    // Reemplazar el global `URL` entero rompe el constructor que usa `fetch`, y el
    // síntoma es engañoso: los tests fallan con «no se pudo conectar con el
    // servidor» como si fuera un problema de red.
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(() => {
        const url = `blob:mock-${creados.length}`;
        creados.push(url);
        return url;
      }),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn((url: string) => {
        revocados.push(url);
      }),
    });
  });

  afterEach(() => {
    setEventSink(() => {});
    vi.restoreAllMocks();
  });

  it('usa el nombre que manda el servidor y revoca el object URL', async () => {
    let autorizacion: string | null = null;
    server.use(
      http.get(`${API}/v1/admin/imports/${ID}/report`, ({ request }) => {
        autorizacion = request.headers.get('authorization');
        return new HttpResponse(CSV, {
          status: 200,
          headers: {
            'content-type': 'text/csv; charset=utf-8',
            'content-disposition': `attachment; filename="import-${ID}-errores.csv"`,
          },
        });
      }),
    );
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await descargarReporte(ID, 1);

    expect(click).toHaveBeenCalledTimes(1);
    const enlace = click.mock.instances[0] as HTMLAnchorElement;
    // El nombre NO se construye en el cliente: se lee del header.
    expect(enlace.download).toBe(`import-${ID}-errores.csv`);
    expect(creados).toHaveLength(1);
    expect(revocados).toEqual(creados);
    // La descarga pasa por el mutator, así que lleva el Bearer del panel: un
    // `<a href>` nativo habría dado 401.
    expect(autorizacion == null || autorizacion.startsWith('Bearer')).toBe(true);
  });

  it('emite el evento con el conteo de rechazos y sin nombre de archivo', async () => {
    server.use(
      http.get(`${API}/v1/admin/imports/${ID}/report`, () =>
        new HttpResponse(CSV, {
          status: 200,
          headers: {
            'content-type': 'text/csv; charset=utf-8',
            'content-disposition': 'attachment; filename="import-x-errores.csv"',
          },
        }),
      ),
    );
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const eventos: Array<{ event: string; props: Record<string, unknown> }> = [];
    setEventSink((event, props) => eventos.push({ event, props }));

    await descargarReporte(ID, 37);

    expect(eventos).toHaveLength(1);
    expect(eventos[0].event).toBe('import_report_downloaded');
    expect(eventos[0].props.failed_count).toBe(37);
    // Ni el nombre del archivo del dueño ni el contenido: son datos de su catálogo.
    expect(JSON.stringify(eventos[0].props)).not.toContain('errores.csv');
    expect(JSON.stringify(eventos[0].props)).not.toContain('REF-1');
  });

  it('un 404 propaga el error y NO crea ningún object URL', async () => {
    server.use(
      http.get(`${API}/v1/admin/imports/${ID}/report`, () =>
        HttpResponse.json(
          {
            type: 'dsm:import/not-found',
            title: 'Not Found',
            status: 404,
            detail: 'No se encontró esa importación.',
            instance: `/v1/admin/imports/${ID}/report`,
          },
          { status: 404, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    await expect(descargarReporte(ID, 0)).rejects.toMatchObject({
      appError: { kind: 'notFound' },
    });
    // Una descarga vacía sería peor que el error: el dueño abriría un CSV en blanco
    // y creería que no hubo rechazos.
    expect(creados).toHaveLength(0);
  });
});
