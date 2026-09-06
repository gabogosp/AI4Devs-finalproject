import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * SC-010-N5 ("el flag del medio simulado está apagado") necesita observar el
 * comportamiento REAL de la app arrancada con `PAYMENTS_SIMULATED_ENABLED`
 * en `false` — pero la API principal de la corrida (`qa/scripts/api-up.sh`)
 * arranca con el flag en `true`, precondición obligatoria del resto de la
 * suite (`tasks.md` Pre-requisitos). Un proceso Node lee su config UNA vez
 * al arrancar (`ConfigModule.forRoot`, `env.validation.ts`): no hay ninguna
 * forma de togglear el flag a mitad de corrida sin reiniciar el proceso.
 *
 * Este helper levanta una SEGUNDA instancia real de la misma app compilada
 * (nunca un doble/mock) en un puerto propio, con el flag apagado (default),
 * SOLO para la duración de esa aserción puntual — nunca para el resto de la
 * suite, que sigue contra la instancia principal. Se cierra apenas termina.
 */

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(AQUI, '../..');
const MAIN = path.join(REPO_ROOT, 'apps/api/dist/apps/api/src/main.js');

export interface ApiInstance {
  baseUrl: string;
  stop(): Promise<void>;
}

/** Sondea `/health` con espera acotada — nunca un `sleep` fijo (flakiness-detection). */
async function esperarSalud(baseUrl: string, proceso: ChildProcess, timeoutMs: number): Promise<void> {
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    if (proceso.exitCode !== null) {
      throw new Error(
        `[qa/spawn-api] el proceso terminó antes de levantar (exit ${proceso.exitCode}) — ` +
          `revisá que ${MAIN} exista (pnpm --filter @dsm/api build) y que las env vars alcancen.`,
      );
    }
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return;
    } catch {
      // Todavía no acepta conexiones — se reintenta.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  proceso.kill('SIGKILL');
  throw new Error(`[qa/spawn-api] ${baseUrl}/health no respondió dentro de ${timeoutMs}ms`);
}

/**
 * `envOverrides` se aplica SOBRE `process.env` heredado (mismas
 * `DATABASE_URL`/`JWT_SECRET`/`ADMIN_BOOTSTRAP_TOKEN` que la corrida de la
 * suite ya tiene exportadas) — nunca reemplaza el entorno entero.
 */
export async function levantarApiTemporal(
  port: number,
  envOverrides: Record<string, string>,
): Promise<ApiInstance> {
  // `NODE_OPTIONS=--import tsx` (heredado del script `test:acceptance` que
  // ejecuta ESTE proceso Cucumber) rompe el arranque de la app YA COMPILADA
  // — se filtra explícitamente, nunca se hereda hacia el proceso hijo.
  const { NODE_OPTIONS: _omitido, ...envPadreSinNodeOptions } = process.env;
  const proceso = spawn('node', [MAIN], {
    cwd: REPO_ROOT,
    env: { ...envPadreSinNodeOptions, PORT: String(port), ...envOverrides },
    stdio: 'ignore',
  });
  const baseUrl = `http://localhost:${port}`;
  await esperarSalud(baseUrl, proceso, 30_000);
  return {
    baseUrl,
    async stop() {
      proceso.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        proceso.once('exit', () => resolve());
        setTimeout(resolve, 5_000);
      });
    },
  };
}
