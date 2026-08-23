import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { importsService, type ImportJob } from './importsService';

const API = 'http://localhost:3000';
const ID = '2f1c9a4e-1111-4111-8111-111111111111';

/** Trabajo completo del contrato. Los tests parten de acá y sólo tocan lo suyo. */
function job(over: Partial<ImportJob> = {}): ImportJob {
  return {
    id: ID,
    status: 'completed',
    filename: 'catalogo.csv',
    source_format: 'csv',
    total_rows: 3,
    processed_rows: 3,
    created_count: 2,
    updated_count: 1,
    failed_count: 0,
    categories_created_count: 1,
    error_code: null,
    error_message: null,
    report_truncated: false,
    started_at: '2026-08-23T10:00:00.000Z',
    finished_at: '2026-08-23T10:00:05.000Z',
    created_at: '2026-08-23T10:00:00.000Z',
    errors: [],
    pagination: { limit: 50, offset: 0, total: 0 },
    ...over,
  };
}

describe('importsService', () => {
  it('create manda multipart con boundary (no JSON) y el header de idempotencia', async () => {
    let idempotency: string | null = null;
    let contentType: string | null = null;
    server.use(
      http.post(`${API}/v1/admin/imports`, async ({ request }) => {
        idempotency = request.headers.get('idempotency-key');
        contentType = request.headers.get('content-type');
        // El CUERPO no se lee a propósito: leer un multipart con un `File` cuelga
        // bajo jsdom (medido: 5 s de timeout, con o sin `formData()`). Lo que este
        // test tiene que probar es el **encabezado**, que es donde estaba el
        // defecto; que el campo se llame `file` lo garantiza el cliente generado,
        // que lo construye desde el contrato, y lo verifica el e2e de QA contra la
        // API real.
        return HttpResponse.json({ id: ID, status: 'pending' }, { status: 202 });
      }),
    );

    const creado = await importsService.create(
      new File(['sku,nombre\nREF-1,Heladera\n'], 'catalogo.csv', {
        type: 'text/csv',
      }),
      'clave-abc',
    );

    expect(creado).toEqual({ id: ID, status: 'pending' });
    expect(idempotency).toBe('clave-abc');
    // El defecto que este test fija: el mutator forzaba `application/json` a todo
    // cuerpo sin content-type, y un multipart anunciado como JSON es un cuerpo que
    // el servidor no puede parsear.
    expect(contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(contentType).not.toContain('application/json');
  });

  it('get manda limit/offset y devuelve el trabajo validado', async () => {
    let url = '';
    server.use(
      http.get(`${API}/v1/admin/imports/${ID}`, ({ request }) => {
        url = request.url;
        return HttpResponse.json(job());
      }),
    );

    const recibido = await importsService.get(ID, { limit: 50, offset: 50 });

    expect(url).toContain('limit=50');
    expect(url).toContain('offset=50');
    expect(recibido.status).toBe('completed');
    expect(recibido.created_count).toBe(2);
  });

  it('get acepta total_rows null: el contrato lo declara así hasta que termina la lectura', async () => {
    server.use(
      http.get(`${API}/v1/admin/imports/${ID}`, () =>
        HttpResponse.json(job({ status: 'running', total_rows: null, processed_rows: 120 })),
      ),
    );

    const recibido = await importsService.get(ID);

    expect(recibido.total_rows).toBeNull();
    expect(recibido.processed_rows).toBe(120);
  });

  it('get LANZA si la respuesta no cumple el contrato (falta report_truncated)', async () => {
    const incompleto = job() as unknown as Record<string, unknown>;
    delete incompleto.report_truncated;
    server.use(
      http.get(`${API}/v1/admin/imports/${ID}`, () =>
        HttpResponse.json(incompleto),
      ),
    );

    // Fallar acá, en el borde, es preferible a propagar un objeto a medias a la
    // UI: la pantalla leería `undefined` y mostraría un estado que no existe.
    await expect(importsService.get(ID)).rejects.toThrow();
  });

  it('get NO lanza con un error_code de fila desconocido', async () => {
    server.use(
      http.get(`${API}/v1/admin/imports/${ID}`, () =>
        HttpResponse.json(
          job({
            failed_count: 1,
            errors: [
              {
                row_number: 2,
                sku: 'REF-1',
                field: 'precio',
                error_code: 'codigo_que_todavia_no_existe',
                error_message: 'motivo del servidor',
              },
            ],
            pagination: { limit: 50, offset: 0, total: 1 },
          }),
        ),
      ),
    );

    // El contrato declara `error_code` como string, no como enum: si el backend
    // agrega un código, el panel tiene que seguir funcionando (la traducción cae
    // al mensaje del servidor). Un enum acá haría que un código nuevo tirara la
    // pantalla entera.
    const recibido = await importsService.get(ID);
    expect(recibido.errors[0].error_code).toBe('codigo_que_todavia_no_existe');
  });

  it('downloadReport devuelve el CSV como TEXTO y el nombre del servidor', async () => {
    const csv = 'fila,sku,campo,codigo,motivo\n2,REF-1,precio,invalid_price,mal precio\n';
    server.use(
      http.get(`${API}/v1/admin/imports/${ID}/report`, () =>
        new HttpResponse(csv, {
          status: 200,
          headers: {
            'content-type': 'text/csv; charset=utf-8',
            'content-disposition': `attachment; filename="import-${ID}-errores.csv"`,
          },
        }),
      ),
    );

    const reporte = await importsService.downloadReport(ID);

    // Es el caso que rompía antes de arreglar el mutator: `JSON.parse` de un CSV
    // lanzaba un SyntaxError fuera del manejo de errores de red.
    expect(reporte.csv).toBe(csv);
    expect(reporte.filename).toBe(`import-${ID}-errores.csv`);
  });

  it('downloadReport usa un nombre de respaldo si el servidor no manda Content-Disposition', async () => {
    server.use(
      http.get(`${API}/v1/admin/imports/${ID}/report`, () =>
        new HttpResponse('fila,sku,campo,codigo,motivo\n', {
          status: 200,
          headers: { 'content-type': 'text/csv; charset=utf-8' },
        }),
      ),
    );

    const reporte = await importsService.downloadReport(ID);

    expect(reporte.filename).toBe(`import-${ID}-errores.csv`);
  });

  it('un 404 del reporte se propaga como error tipado, no como descarga vacía', async () => {
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

    await expect(importsService.downloadReport(ID)).rejects.toMatchObject({
      appError: { kind: 'notFound' },
    });
  });
});
