import { DomainError } from './domain-errors';

/**
 * Errores de dominio del enriquecimiento IA (US-005 T1.1) — `backend-node-standards.md`
 * §6. Subclases de la `DomainError` existente, así que el `HttpProblemFilter` los mapea
 * al envelope RFC 7807 **sin ningún cambio en el filtro**.
 *
 * La distinción transitorio/permanente no es cosmética: es la que decide si el runner
 * reintenta (y gasta cuota) o abandona. Un 429 del proveedor se reintenta; una respuesta
 * con 512 dimensiones no se va a arreglar reintentando, y reintentarla cinco veces
 * quema cuota para nada.
 *
 * Ninguno de estos mensajes contiene la clave del proveedor ni el texto del prompt: el
 * `detail` viaja al cliente y a los logs (AC-9).
 */

/**
 * 503 — el proveedor falló de forma **reintentable**: 429, 5xx o timeout.
 *
 * `retryAfterSeconds` viene del header `Retry-After` cuando el proveedor lo manda. Si
 * está, gana sobre el backoff calculado: el proveedor sabe mejor que nuestra fórmula
 * cuándo va a volver a atender.
 */
export class AiTransientError extends DomainError {
  readonly status = 503;
  readonly type = 'dsm:enrichment/ai-transient';
  readonly retryAfterSeconds?: number;

  constructor(message = 'El proveedor de IA no respondió', retryAfterSeconds?: number) {
    super(message);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * 502 — el proveedor respondió algo **inservible**: dimensión equivocada, `NaN`, vector
 * vacío, JSON con otra forma, o texto vacío. No se reintenta.
 */
export class AiPermanentError extends DomainError {
  readonly status = 502;
  readonly type = 'dsm:enrichment/ai-permanent';
}

/**
 * Ya hay una corrida en curso (409 del `POST /v1/admin/enrichment/runs`).
 *
 * No es un fallo: es la respuesta correcta a un segundo pedido. Arrancar dos barridos del
 * mismo catálogo gastaría el doble de cuota para el mismo resultado, así que el segundo
 * pedido se rechaza con el estado actual en vez de encolarse.
 */
export class EnrichmentRunInProgressError extends DomainError {
  readonly status = 409;
  readonly type = 'dsm:enrichment/run-in-progress';

  constructor(estado: string) {
    super(
      `Ya hay una corrida de enriquecimiento en curso (estado: ${estado}). Consultá GET /v1/admin/enrichment/status para ver su progreso.`,
      undefined,
      { runner_state: estado },
    );
  }
}

/**
 * El breaker está abierto: el proveedor viene fallando y se está esperando el cooldown
 * (409 del `POST /runs`).
 *
 * Es distinto de «hay una corrida en curso» y merece su propio código: el dueño que ve esto
 * no tiene que esperar a que termine un trabajo, tiene un problema con el proveedor. Decirle
 * «ya hay una corrida» lo mandaría a mirar un progreso que no existe.
 */
export class EnrichmentCooldownError extends DomainError {
  readonly status = 409;
  readonly type = 'dsm:enrichment/cooldown';

  constructor() {
    super(
      'El enriquecimiento está en enfriamiento tras fallos consecutivos del proveedor de IA. Reintentá cuando el estado vuelva a `idle`.',
      undefined,
      { runner_state: 'cooldown' },
    );
  }
}

/**
 * 503 — no hay proveedor configurado (sin `GEMINI_API_KEY` o con
 * `ENRICHMENT_ENABLED=false`).
 *
 * Existe para que la ausencia de clave sea **explícita y visible** en vez de silenciosa:
 * el `/status` del enriquecimiento la reporta como `disabled` y el catálogo queda
 * navegable por categoría (AC-5, D6). La alternativa —un adapter que devuelva vectores
 * sintéticos— haría que la búsqueda «funcione» devolviendo basura, y eso se descubre en
 * la demo.
 */
export class AiDisabledError extends DomainError {
  readonly status = 503;
  readonly type = 'dsm:enrichment/disabled';

  constructor() {
    super(
      'El enriquecimiento por IA está deshabilitado: falta configurar el proveedor',
    );
  }
}
