import { Injectable, Logger } from '@nestjs/common';

export type AuthEventName =
  | 'auth.registered'
  | 'auth.login_succeeded'
  | 'auth.login_failed'
  | 'auth.account_locked'
  | 'auth.logout'
  | 'auth.password_reset_requested'
  | 'auth.password_reset_completed'
  | 'auth.refresh_reuse_detected';

/**
 * Eventos de negocio de la superficie de auth (E2E §18).
 *
 * Espejo de `CatalogEventsService`, con dos reglas propias que vienen del hecho
 * de que acá sí hay personas identificables:
 *
 * 1. **El email nunca entra.** Es PII (`observability-standards` §9) y además el
 *    logro central de esta US es que la superficie no enumere cuentas — un log
 *    con el email consultado convierte cualquier acceso a los logs en el listado
 *    de direcciones registradas que tanto trabajo costó no dar por HTTP.
 * 2. **El `customer_id` va al log, nunca a una dimensión de métrica**
 *    (`observability-patterns` §3.3). Una etiqueta por usuario hace explotar la
 *    cardinalidad: con 10 000 clientes son 10 000 series por contador, y eso
 *    tumba el backend de métricas mucho antes que el tráfico real.
 *
 * De ahí que el contador sea por nombre de evento a secas, y el id viva sólo en
 * la línea de log.
 */
@Injectable()
export class AuthEventsService {
  private readonly logger = new Logger(AuthEventsService.name);
  private readonly counters = new Map<AuthEventName, number>();

  /**
   * @param customerId UUID del cliente, o `null` cuando no hay cuenta a la cual
   * atribuir el evento — un login fallido contra un email inexistente. **No** se
   * pone el email, ni siquiera hasheado: un hash de email es reversible por
   * diccionario, así que sigue siendo el dato original con un paso extra.
   */
  emit(
    name: AuthEventName,
    customerId: string | null,
    traceId?: string,
  ): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + 1);
    this.logger.log({
      event: name,
      entity_id: customerId,
      trace_id: traceId,
    });
  }

  /** Valor del contador (stand-in de una métrica Prometheus). */
  count(name: AuthEventName): number {
    return this.counters.get(name) ?? 0;
  }

  /** Sólo para tests: reinicia los contadores. */
  reset(): void {
    this.counters.clear();
  }
}
