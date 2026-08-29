/**
 * TC-622 — presupuesto de throughput del import (`qa-plan.md` §7, sin k6 —
 * OQ-QA-3: la concurrencia de usuarios no es el riesgo acá, un único dueño, y
 * el rate-limit de 3/hora/IP haría que un test de concurrencia mida el
 * rate-limit en vez del throughput).
 *
 * Sube 5.000 filas (el tope del contrato) y mide tres cosas mientras el
 * runner corre **dentro del proceso del API** (ADR-0012, sin Redis):
 *
 *   1. Tiempo hasta `completed`         ≤ 180 s
 *   2. p95 de GET /v1/categories        ≤ 400 ms  (mientras el import corre)
 *   3. Filas escritas al terminar       = 5.000
 *
 * El runner sin cola dedicada es justo el riesgo real: un import que bloquee
 * el event loop degradaría el storefront de los clientes mientras el dueño
 * importa. El presupuesto #2 es lo que lo hace visible.
 *
 * Sale con código ≠ 0 si viola alguno de los tres — un presupuesto que no
 * falla no es un presupuesto.
 */
import { csvFilas } from '../support/import-files';
import { adminAuth } from '../support/admin-auth';
import { subirImport, estadoImport } from '../support/import-client';
import { QA_API_BASE_URL } from '../support/qa-env';

const PRESUPUESTO_MS = 180_000;
const PRESUPUESTO_P95_MS = 400;
const FILAS = 5_000;

async function medirCategoriesMs(): Promise<number> {
  const inicio = Date.now();
  await fetch(`${QA_API_BASE_URL}/v1/categories`);
  return Date.now() - inicio;
}

async function main(): Promise<void> {
  const token = await adminAuth();
  const buffer = csvFilas(FILAS);

  const muestras: number[] = [];
  let midiendo = true;
  const sondeo = (async () => {
    while (midiendo) {
      try {
        muestras.push(await medirCategoriesMs());
      } catch {
        /* una falla de red puntual no invalida la corrida; el p95 la absorbe */
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  })();

  const inicio = Date.now();
  const { status, body } = await subirImport(token, buffer, 'throughput-5000.csv');
  if (status !== 202 || !body.id) {
    throw new Error(`el POST no devolvió 202 con id: status=${status} body=${JSON.stringify(body)}`);
  }
  const jobId = body.id;

  let job = await estadoImport(token, jobId).then((r) => r.body);
  const limite = Date.now() + PRESUPUESTO_MS + 10_000; // margen para no confundir timeout de medición con violación de presupuesto
  while (job.status !== 'completed' && job.status !== 'failed' && Date.now() < limite) {
    await new Promise((r) => setTimeout(r, 500));
    job = await estadoImport(token, jobId).then((r) => r.body);
  }
  const duracionMs = Date.now() - inicio;
  midiendo = false;
  await sondeo;

  muestras.sort((a, b) => a - b);
  const p95 = muestras.length > 0 ? muestras[Math.floor(muestras.length * 0.95)] : NaN;

  const filasEscritas = job.created_count + job.updated_count;

  console.log(
    JSON.stringify(
      {
        status: job.status,
        duracion_ms: duracionMs,
        presupuesto_duracion_ms: PRESUPUESTO_MS,
        p95_categories_ms: p95,
        presupuesto_p95_ms: PRESUPUESTO_P95_MS,
        muestras_categories: muestras.length,
        filas_escritas: filasEscritas,
        filas_esperadas: FILAS,
      },
      null,
      2,
    ),
  );

  const violaciones: string[] = [];
  if (job.status !== 'completed') {
    violaciones.push(
      `el trabajo no terminó 'completed' (status=${job.status}, error_code=${job.error_code ?? 'ninguno'})`,
    );
  }
  if (duracionMs > PRESUPUESTO_MS) {
    violaciones.push(`duración ${duracionMs}ms > presupuesto ${PRESUPUESTO_MS}ms`);
  }
  if (!Number.isFinite(p95)) {
    violaciones.push('no se pudo medir el p95 de /v1/categories (sin muestras)');
  } else if (p95 > PRESUPUESTO_P95_MS) {
    violaciones.push(`p95 de /v1/categories ${p95}ms > presupuesto ${PRESUPUESTO_P95_MS}ms`);
  }
  if (filasEscritas !== FILAS) {
    violaciones.push(`filas escritas ${filasEscritas} !== ${FILAS} esperadas`);
  }

  if (violaciones.length > 0) {
    console.error('PRESUPUESTO VIOLADO:\n' + violaciones.map((v) => `  - ${v}`).join('\n'));
    process.exitCode = 1;
    return;
  }
  console.log('Presupuesto de throughput OK.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
