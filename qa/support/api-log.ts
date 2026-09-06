import { readFileSync } from 'node:fs';

/**
 * SC-010-H2 (`qa-plan.md` §4) necesita observar que el `NotificationPort`
 * recibió exactamente los dos avisos esperados, sin PII — pero ningún
 * endpoint HTTP expone eventos de notificación (mismo tipo de hallazgo que
 * QA-023-F1 para `payments`). El `LoggingNotificationAdapter`
 * (`apps/api/src/orders/ports/logging-notification.adapter.ts`) es el ÚNICO
 * adapter de este entorno y escribe una línea de log por aviso — se lee ese
 * archivo, nunca se golpea un puerto interno del proceso de la API.
 *
 * `qa/scripts/api-up.sh` corre con `LOG_LEVEL=debug`; este archivo asume que
 * quien levantó la API redirigió su stdout a `QA_API_LOG_FILE` (documentado
 * en `qa-plan.md` §9 / reportado en el resumen final de la corrida).
 */
export const API_LOG_FILE = process.env.QA_API_LOG_FILE ?? '/tmp/dsm-qa-api-us010.log';

export function leerLogApi(): string {
  try {
    return readFileSync(API_LOG_FILE, 'utf8');
  } catch (cause) {
    throw new Error(
      `[qa/api-log] no se pudo leer ${API_LOG_FILE}. La API para QA tiene que arrancar con su ` +
        `stdout redirigido a ese archivo (variable QA_API_LOG_FILE) para que SC-010-H2 pueda ` +
        'observar los avisos de NotificationPort.',
      { cause },
    );
  }
}

/** Cuenta ocurrencias de una línea `order.<evento> order_id=<id>` en el log. */
export function contarAvisos(log: string, evento: string, orderId: string): number {
  const patron = new RegExp(`order\\.${evento} order_id=${orderId}(?:\\s|$)`, 'g');
  return (log.match(patron) ?? []).length;
}

/**
 * pino usa un transporte asíncrono (sonic-boom): entre `logger.log(...)` y el
 * byte realmente en disco hay un lag real, no cero — verificado empíricamente
 * (una lectura inmediata tras el 200 de `simulate-payment` puede ver 0
 * ocurrencias que un segundo intento sí ve). Se sondea con espera acotada
 * — nunca un `sleep` fijo (flakiness-detection, `playwright-stability`
 * §Auto-waiting) — hasta que la línea aparezca o venza el timeout.
 */
export async function esperarAviso(
  evento: string,
  orderId: string,
  timeoutMs = 3_000,
): Promise<number> {
  const limite = Date.now() + timeoutMs;
  let ultimoConteo = 0;
  while (Date.now() < limite) {
    ultimoConteo = contarAvisos(leerLogApi(), evento, orderId);
    if (ultimoConteo > 0) return ultimoConteo;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return ultimoConteo;
}
