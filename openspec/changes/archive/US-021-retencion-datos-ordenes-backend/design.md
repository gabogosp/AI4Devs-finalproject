---
tracker-id: null
tracker-source: null
parent-us: US-021
discipline: backend
variant: null
language: es
---

# US-021 Backend — Design

## Context

`orders` ya existe (US-008) con `buyer_name`, `buyer_email`, `buyer_phone` como
`String` obligatorios, sin `unique`. No hay `anonymized_at` ni
`anonymization_reason` — es una migración puramente aditiva, sin movimiento de
datos ni motor nuevo (`data-architecture-patterns` — caso trivial, **no** amerita
invocar al sub-agente `data-architect`, se resuelve inline).

No existe infraestructura de colas (`apps/worker` es un README, `REDIS_URL` no
está aprovisionado — ADR-0004, ADR-0012) ni un módulo admin de órdenes (US-012
sigue `Ready` sin change de backend). Este change extiende `checkout/` —donde ya
vive `OrdersRepository`, el único punto de ORM de `orders`/`order_items` (§5)— en
vez de abrir un módulo nuevo, porque no hay todavía un dueño natural distinto
para la superficie admin de órdenes.

## Goals

- AC-1: barrido que anonimiza toda orden cuyo `created_at` superó la ventana de
  retención.
- AC-2/AC-6/AC-7: ningún otro campo de la orden, sus ítems o su consentimiento
  cambia.
- AC-3/AC-9: acción a pedido, sólo para el dueño autenticado.
- AC-4: auditoría — cuándo y por qué motivo (`retention_policy` vs `requested`).
- AC-5: la orden anonimizada sigue siendo legible (los datos siguen ahí, sólo
  con el placeholder — el panel futuro de US-012 decide cómo lo muestra).
- AC-8: idempotencia estructural, sin excepción de por medio.
- Observabilidad sin PII (US §9).

## Non-goals

- Construir el panel de órdenes o su DTO de lectura (US-012).
- Construir el flujo de exportación / derecho de acceso (otra US).
- Un ejecutor BullMQ real (`Deferred: operaciones / US-019` — ver Trade-offs).
- Revocar o rotar `access_token_hash` (ver Approach, decisión explícita).

## Approach

### Persistencia

```prisma
model Order {
  // ... columnas existentes, sin cambios ...
  anonymized_at         DateTime?
  anonymization_reason  String?
}
```

Migración (`prisma migrate --create-only` + edición manual del `migration.sql`
generado, mismo flujo que el `CHECK (consent_accepted = true)` de US-008 y los
`CHECK` de `cart_items`):

```sql
ALTER TABLE "orders"
  ADD COLUMN "anonymized_at" TIMESTAMP(3),
  ADD COLUMN "anonymization_reason" TEXT;

ALTER TABLE "orders" ADD CONSTRAINT "orders_anonymization_reason_check"
  CHECK ("anonymization_reason" IS NULL
         OR "anonymization_reason" IN ('retention_policy', 'requested'));

ALTER TABLE "orders" ADD CONSTRAINT "orders_anonymization_consistency_check"
  CHECK (("anonymized_at" IS NULL) = ("anonymization_reason" IS NULL));
```

Column-complete (F40): dos columnas + dos `CHECK`, ninguno opcional — el
segundo `CHECK` es lo que hace **estructuralmente imposible** una orden con
fecha de anonimización pero sin motivo (o viceversa), el mismo estilo que
`CHECK (consent_accepted = true)` de US-008.

**Por qué `TEXT` con `CHECK` y no un `enum` de Prisma**: el resto del proyecto
usa `String` + `CHECK`/`@default` para campos de estado cerrado (`Order.status`,
`Product.status`) — no hay un solo `enum` de Postgres en el schema. Mantener el
mismo idioma evita una migración de tipo distinta al resto de la base.

**Índice**: no se agrega ninguno nuevo. El barrido filtra por
`anonymized_at IS NULL AND created_at < cutoff`, y `orders` ya tiene
`@@index([status, created_at])` — no cubre exactamente el predicado, pero el
volumen esperado (órdenes de una sola sucursal, "algunos cientos"/mes según el
E2E §17 ~50 concurrentes pico) hace que un *sequential scan* ocasional sobre
`orders` sea aceptable; no se propone un índice parcial nuevo sin medición real
(YAGNI — `base-standards.md` §1). Si el volumen crece un orden de magnitud, un
índice parcial `WHERE anonymized_at IS NULL` es la primera palanca a tirar,
declarado acá como nota para esa revisión futura, no como tarea de este change.

### `access_token_hash` — decisión explícita: fuera de alcance

No se toca. Razones:

1. **No es PII del comprador** — es el hash SHA-256 de un token aleatorio de 256
   bits (US-008, `OrderTokenService`) generado por el sistema, no derivado de
   ningún dato personal. Es la credencial de acceso del invitado a su propia
   orden, de la misma clase que un `session_token_hash` de carrito.
2. **Invalidarlo rompería una funcionalidad que ningún AC pide tocar**: el
   invitado podría seguir consultando el estado de su orden (US-009 `/latest`)
   después de pedir la supresión de sus datos de contacto, y eso es correcto —
   sigue siendo *su* orden, sólo que ahora sin los datos personales visibles.
   Ningún AC de esta US menciona revocar ese acceso.
3. El US §4 (out of scope) no lo nombra, y tocarlo sin AC que lo exija sería
   alcance no pedido (YAGNI).

### Constantes de anonimización

`apps/api/src/checkout/order-anonymization.ts`:

```ts
export type AnonymizationReason = 'retention_policy' | 'requested';

/** No colisiona con ningún comprador real ni pasado ni futuro (US §9 — irreversibilidad). */
export const ANONYMIZED_BUYER_NAME = 'Comprador anonimizado';
/** TLD `.invalid` — RFC 2606, reservado y no resoluble: si algún día un adapter de
 * email (US-011, todavía no construido) intentara enviar a este valor, la entrega
 * fallaría en DNS, nunca llegaría a un tercero real. */
export const ANONYMIZED_BUYER_EMAIL = 'datos-suprimidos@anonimizado.dsm.invalid';
export const ANONYMIZED_BUYER_PHONE = '+00 000-0000';
```

Verificado contra `apps/api/src/checkout/dto/create-checkout.dto.ts`: estas
escrituras van **directo por `OrdersRepository`**, nunca a través de
`CreateCheckoutDto`/`BuyerDto` (que sólo valida altas), así que no chocan con
`@Length(2, 120)` de `name` ni con `@IsEmail`/`@Matches` de `email`/`phone` — de
todos modos los tres valores cumplirían esas reglas si algún día se reusara el
DTO de lectura para otro propósito.

### `OrdersRepository` — dos escrituras + una lectura, mismo archivo

```ts
findById(id: string): Promise<OrderWithItems | null>

/** Guardado por `anonymized_at: null` en el WHERE — atómico: dos llamadas
 * concurrentes sobre la misma orden serializan en Postgres; la segunda no
 * matchea nada (count 0), ninguna hace un segundo `UPDATE` ni dispara un
 * segundo evento (AC-8, y la parte de "Repudiation"/carrera de la superficie 2
 * de `threat-modeling-lite`). */
async anonymize(
  id: string,
  reason: AnonymizationReason,
): Promise<{ anonymizedAt: Date; anonymizationReason: AnonymizationReason } | null> {
  await this.prisma.order.updateMany({
    where: { id, anonymized_at: null },
    data: {
      buyer_name: ANONYMIZED_BUYER_NAME,
      buyer_email: ANONYMIZED_BUYER_EMAIL,
      buyer_phone: ANONYMIZED_BUYER_PHONE,
      anonymized_at: new Date(),
      anonymization_reason: reason,
    },
  });
  const row = await this.prisma.order.findUnique({
    where: { id },
    select: { anonymized_at: true, anonymization_reason: true },
  });
  if (!row || !row.anonymized_at) return null; // no existe, o el `updateMany` no
  // encontró nada Y la orden tampoco estaba anonimizada antes (imposible en la
  // práctica salvo carrera con un `DELETE`, que no existe en este proyecto —
  // ver la nota de por qué el `null` de "no existe" es seguro).
  return {
    anonymizedAt: row.anonymized_at,
    anonymizationReason: row.anonymization_reason as AnonymizationReason,
  };
}

/** Un único `UPDATE` de conjunto — sin bucle por fila (a diferencia del batch
 * de `ImportRunner`, acá no hay transformación por fila que justifique
 * `await` incremental: es un `SET` con los mismos tres valores para todo el
 * conjunto). Devuelve cuántas filas tocó ESTA corrida. */
async anonymizeRetentionEligible(
  cutoff: Date,
  reason: AnonymizationReason,
): Promise<number> {
  const { count } = await this.prisma.order.updateMany({
    where: { anonymized_at: null, created_at: { lt: cutoff } },
    data: {
      buyer_name: ANONYMIZED_BUYER_NAME,
      buyer_email: ANONYMIZED_BUYER_EMAIL,
      buyer_phone: ANONYMIZED_BUYER_PHONE,
      anonymized_at: new Date(),
      anonymization_reason: reason,
    },
  });
  return count;
}
```

`per backend-node-standards.md §5 — el repositorio es el único punto de ORM`
(sigue siendo `checkout/orders.repository.ts`, nadie más toca `prisma.order`).

### Servicio, endpoints y runner — modo de ejecución (ADR-0012 aplicado a este dominio)

**Decisión tomada (no es una pregunta abierta)**: sin `Deferred: operaciones /
US-019 (Redis no aprovisionado, ADR-0004)`, se replica exactamente el patrón que
ADR-0012 fijó para el import y que el propio `design.md` de US-014 ya citó como
precedente para «purga programada de tokens vencidos»:

1. **`POST /v1/admin/orders/retention-sweep`** — corrida bajo demanda, **síncrona
   dentro del request** (no 202 + polling). Justificación contra
   `backend-node-standards.md §8` (timeouts explícitos, no bloquear el event
   loop): acá no hay transformación por fila — es **un único `UPDATE`** resuelto
   por el motor sobre un índice de rango (`created_at`), sobre un volumen
   estimado de "algunos cientos de órdenes por mes" (contexto del comando; una
   sola sucursal, ~50 concurrentes pico según E2E §17). Un `UPDATE` de conjunto
   de esa cardinalidad se resuelve en milisegundos, no en el orden de magnitud
   que justificaría un contrato asíncrono como el de `POST /v1/admin/imports`
   (que sí procesa 5.000 filas con lógica por fila). Si el volumen creciera dos
   órdenes de magnitud, la primera señal es la métrica de duración del propio
   endpoint (§NFRs cuantificados) — recién ahí se justifica moverlo a un
   contrato asíncrono como el del import.
2. **`OrdersRetentionRunner.onApplicationBootstrap()`** — mismo disparador que
   `ImportRunner`: corre el mismo barrido al arrancar la API, `best-effort`
   (`try/catch`, nunca bloquea el arranque). Cubre el hueco de un redeploy que
   se salta el disparador externo mensual.
3. **Disparador externo real** (cron de Railway u operación manual del dueño
   golpeando el endpoint) queda **fuera de este change** — es tarea de
   `/plan-deployment` u operaciones (ver Deployment considerations).
4. **`Deferred: operaciones / US-019`** — un BullMQ *processor* real que lea el
   mismo trabajo mensual, cuando `REDIS_URL` exista y `apps/worker` deje de ser
   un README. El contrato HTTP (`retention-sweep`) no cambia si eso ocurre: es
   sustituible por lo mismo que ADR-0012 ya declaró sustituible.

No se revisó ninguna razón en las convenciones del repo que contradiga esta
elección — al contrario, es la tercera vez que aparece (import, US-014, y
ahora esto), así que se aplica directo, sin abrir pregunta al usuario.

```ts
@Injectable()
export class OrdersRetentionService {
  private readonly retentionMonths: number;
  constructor(
    private readonly orders: OrdersRepository,
    private readonly events: OrdersRetentionEventsService,
    config: ConfigService,
  ) {
    this.retentionMonths = config.get<number>('ORDER_RETENTION_MONTHS') ?? 12;
  }

  async anonymizeOnRequest(orderId: string): Promise<AnonymizeResult> {
    const result = await this.orders.anonymize(orderId, 'requested');
    if (!result) throw new OrderNotFoundError();
    this.events.emit('orders_retention.anonymized_on_request', orderId);
    return result;
  }

  async runRetentionSweep(): Promise<number> {
    const cutoff = this.cutoffDate();
    const count = await this.orders.anonymizeRetentionEligible(cutoff, 'retention_policy');
    // Siempre se emite, incluso count=0: "registrar cuántas órdenes anonimiza
    // CADA corrida" (US §9) es también la señal de que el barrido corrió.
    this.events.emit('orders_retention.swept', null, undefined, {
      anonymized_count: count,
    });
    return count;
  }

  private cutoffDate(): Date {
    const d = new Date();
    d.setMonth(d.getMonth() - this.retentionMonths);
    return d;
  }
}
```

`OrderNotFoundError` distingue "no existe" de "ya estaba anonimizada" — el
primero es 404, el segundo es 200 idéntico a un anonimizado exitoso (AC-8: "no
se produce ningún cambio ni ningún error").

### Controller — rutas, guards, rate limits

```ts
@Controller('v1/admin/orders')
@UseGuards(AdminGuard, AuthThrottlerGuard)
@SkipThrottle({ storefront: true, cart: true })
export class OrdersRetentionController {
  constructor(private readonly retention: OrdersRetentionService) {}

  @Post(':id/anonymize')
  @HttpCode(200)
  @Throttle({ auth: { limit: ORDER_ANONYMIZE_RATE_LIMIT_MAX, ttl: ORDER_ANONYMIZE_RATE_LIMIT_TTL_MS } })
  async anonymizeOne(
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY }))
    id: string,
  ): Promise<OrderAnonymizationResultDto> {
    const result = await this.retention.anonymizeOnRequest(id);
    return OrderAnonymizationResultDto.from(id, result);
  }

  @Post('retention-sweep')
  @HttpCode(200)
  @Throttle({ auth: { limit: ORDER_RETENTION_SWEEP_RATE_LIMIT_MAX, ttl: ORDER_RETENTION_SWEEP_RATE_LIMIT_TTL_MS } })
  async sweep(): Promise<RetentionSweepResultDto> {
    const count = await this.retention.runRetentionSweep();
    return RetentionSweepResultDto.from(count);
  }
}
```

Mismo `AdminGuard` que categorías/productos/imports (ADR-0009, sin
modificar — AC-9), mismo `AuthThrottlerGuard` + `@SkipThrottle` que
`ImportsController` (reusa el *bucket* `auth` en vez de registrar un cuarto
throttler). No hace falta `Idempotency-Key`: las dos rutas son naturalmente
idempotentes por el `WHERE anonymized_at IS NULL` del `UPDATE` — misma
deviación **en espíritu** de `api-standards.md §10.5` que ya declaró US-008
para el checkout (acá el riesgo que protege `Idempotency-Key` —doble efecto—
ya está resuelto por la guarda del propio `UPDATE`, no por una clave que el
llamador tenga que generar).

Sin CSRF: como el resto de `/v1/admin/*`, la superficie usa `Authorization:
Bearer`, no cookie — no aplica `security-standards.md §7.5`.

### `POST .../:id/anonymize` no colisiona con `POST .../retention-sweep`

`retention-sweep` no es un UUID pero Nest resuelve por segmentos declarados, no
por el tipo del parámetro: `:id/anonymize` son dos segmentos después de
`/orders/`, `retention-sweep` es uno — no hay ambigüedad de ruteo (mismo
razonamiter que `:slug` vs `:slug/products` en
`StorefrontCategoriesController`, un nivel más simple acá porque ni siquiera
comparten cantidad de segmentos).

### Observabilidad

`apps/api/src/observability/orders-retention-events.service.ts`, mismo esqueleto
que `CheckoutEventsService` (delega el contador en `MetricsService`,
`@Optional()` para specs que instancian a mano):

```ts
export type OrdersRetentionEventName =
  | 'orders_retention.swept'
  | 'orders_retention.anonymized_on_request';

emit(name: OrdersRetentionEventName, orderId: string | null, traceId?: string, fields?: EventFields): void
```

- `orders_retention.swept` — **uno por corrida**, no uno por orden (mismo
  principio que `import.completed`: 5.000 filas no son 5.000 líneas de evento).
  `fields: { anonymized_count }`.
- `orders_retention.anonymized_on_request` — uno por acción (ya es 1:1 con la
  orden, no hace falta agregación).
- **Cero PII en el payload**: la firma no acepta nada más que `orderId | null`
  (mismo candado que `CheckoutEventsService` — ni siquiera un hash de email
  entra, porque un hash de email sigue siendo el dato con un paso extra).
  `anonymized_count` es un entero, `reason` (cuando se agregue como dimensión de
  métrica) es un enum cerrado de dos valores — cardinalidad acotada
  (`observability-standards.md §9`, `observability-patterns` §3.3).

### Config (fail-fast, §7)

```ts
ORDER_RETENTION_MONTHS: z.coerce.number().int().positive().default(12),
ORDER_ANONYMIZE_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
ORDER_ANONYMIZE_RATE_LIMIT_TTL_MS: z.coerce.number().int().positive().default(60_000),
ORDER_RETENTION_SWEEP_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
ORDER_RETENTION_SWEEP_RATE_LIMIT_TTL_MS: z.coerce.number().int().positive().default(3_600_000),
```

`ORDER_RETENTION_MONTHS=12` por defecto (PRD §6, sin TBD). El presupuesto del
`anonymize` a pedido es generoso (30/min) porque es una acción humana del dueño
respondiendo a un pedido puntual, no una superficie de fuerza bruta; el del
`retention-sweep` es deliberadamente angosto (5/hora) porque un disparador
externo mal configurado en loop no debería poder convertir esto en una carga
recurrente indeseada — aunque el propio `UPDATE` sea barato, cinco corridas por
hora ya son más que suficientes para cualquier operación real.

### Threat model (lite, `threat-modeling-lite` — superficie 2/6: PATCH-like admin mutation)

| Threat | Vector específico | Control |
|---|---|---|
| Spoofing | JWT admin robado dispara anonimizaciones no autorizadas | `AdminGuard` (JWT `role=admin`), mismo seam que el resto de `/v1/admin/*` — endurecimiento de emisión es AC de US-014, no de este change |
| Tampering | Nadie más que el dueño puede alcanzar la ruta; no hay campo del cliente que decida `reason` — el controller lo fija (`requested` en `:id/anonymize`, `retention_policy` en `retention-sweep`), nunca viene del body | Sin `@Body()` en ninguna de las dos rutas — no hay superficie de tampering de payload |
| Repudiation | Carrera entre el barrido y la acción a pedido sobre la misma orden | `UPDATE ... WHERE anonymized_at IS NULL` es atómico a nivel fila en Postgres: la segunda escritura no matchea nada, count 0, sin segundo evento — no hay ventana donde ambas "ganen" |
| Info disclosure | El 404 de `:id/anonymize` revela si un UUID de orden existe | Aceptado: el llamador es el dueño autenticado, no un actor externo sin `AdminGuard` — no hay enumeración expuesta a nadie que no tenga ya el rol admin |
| DoS | Loop de un disparador externo mal configurado sobre `retention-sweep` | Rate-limit 5/hora (§7.3); el `UPDATE` de conjunto es barato incluso si se dispara varias veces seguidas (WHERE ya excluye lo anonimizado) |
| Elevation | n/a — no hay noción de rol distinto de `admin` en esta superficie | — |

## Trade-offs

- **Ejecutor in-process + endpoint bajo demanda en vez de BullMQ real.**
  Igual que ADR-0012: se paga la config del trabajo periódico dos veces sólo si
  el contrato cambia, y acá el contrato (`POST /v1/admin/orders/retention-sweep`
  con respuesta síncrona `{ anonymized_count }`) **no necesita cambiar** cuando
  llegue el worker — sólo cambia quién lo invoca (un processor de BullMQ en vez
  de un cron externo). `Deferred: operaciones / US-019 (Redis no aprovisionado,
  ADR-0004)`.
- **`UPDATE` de conjunto en vez de barrido por lotes tipo `ImportRunner`.** Se
  evaluó espejar el batching del import (lote + `await` cediendo el turno) y se
  descartó: ese patrón existe para transformación **por fila** con lógica de
  negocio cara (parseo, validación, resolución de categoría). Acá las tres
  columnas escritas son **el mismo valor constante para todo el conjunto** — es
  exactamente el tipo de operación que el motor resuelve mejor en un solo
  `UPDATE ... WHERE` que la aplicación iterando. Se documenta el volumen
  esperado (algunos cientos/mes) como el supuesto que sostiene esta elección; si
  cambia, es la primera pieza a revisar.
- **`access_token_hash` no se toca.** Ver Approach — no es PII, y revocarlo
  rompería una funcionalidad (consulta de estado por el invitado) que ningún AC
  pide tocar.
- **Sin `Idempotency-Key`.** El riesgo que protege (doble efecto de un retry)
  ya está resuelto por el `WHERE anonymized_at IS NULL` — agregar la máquina de
  claves encima sería protección duplicada sin ganancia, misma deviación en
  espíritu que declaró US-008.

## Deployment considerations

Se recomienda `/plan-deployment` para este change. Motivos:

1. **Migración de esquema** (aditiva, bajo riesgo, pero es `orders` — tabla ya
   en producción potencial de US-008/009/010).
2. **Superficie admin nueva que muta PII** — aunque de bajo riesgo operativo,
   es la primera vez que el proyecto expone una acción de *supresión de datos
   personales*; vale una revisión explícita de quién puede accionarla en cada
   ambiente.
3. **Dependencia de un disparador externo** para la cadencia mensual real
   (AC-1 fuera del barrido oportunista de arranque) — el cron de Railway (o el
   proceso manual del dueño) es una pieza operativa que este change no
   provisiona, y que debería quedar documentada en el runbook antes de ir a
   producción (US §9, y la condición que el PO puso sobre esta US entera).

No hay secreto nuevo, ni feature flag, ni dependencia externa nueva en el
camino crítico — el perfil de riesgo es bajo, pero los tres puntos de arriba
son operativos, no de código, y por eso el llamado es a `/plan-deployment` y no
a resolverlo dentro de este change.

## Spec delta (para `/archive-change`)

Capability nueva: `retencion-datos-personales` (CAP-13). Este es el primer
change que la entrega — `/archive-change` crea
`openspec/specs/retencion-datos-personales/` con `README.md` + `requirements.md`
+ `decisions.md` + `contracts/openapi.yaml` (raíz viva) a partir de los dos yaml
de este change (`contracts/openapi/anonymize-order.yaml` y
`contracts/openapi/retention-sweep.yaml`, T6.1).

## Open questions

- **Para US-012 (panel de órdenes del dueño, `Ready`, sin change de backend
  todavía)**: el futuro DTO de lectura de una orden **debe** exponer
  `anonymized_at` y `anonymization_reason` — es lo que el AC-5 de esta US
  necesita para que el panel muestre la indicación de "datos anonimizados" en
  vez del nombre/email/teléfono. Esta nota queda acá porque no hay change de
  US-012 donde dejarla todavía; quien lo planifique debe leer esto primero.
- **Cadencia real del disparador mensual** (cron de Railway vs. proceso manual
  del dueño): decisión operativa que corresponde a `/plan-deployment` o a
  US-019, no a este change de código.

## References

- `packages/db/prisma/schema.prisma` (modelo `Order`, líneas ~290-313)
- `apps/api/src/checkout/orders.repository.ts`, `checkout.module.ts`,
  `checkout-errors.ts`, `dto/create-checkout.dto.ts`
- `apps/api/src/auth/admin.guard.ts`, `apps/api/src/auth/auth-throttler.guard.ts`
- `apps/api/src/imports/import-runner.ts`, `import-jobs.repository.ts`
  (`purgeOlderThan`)
- `apps/api/src/observability/checkout-events.service.ts`,
  `catalog-events.service.ts`, `metrics.service.ts`
- ADR-0012 (`docs/architecture/decisions/0012-in-process-import-executor.md`),
  ADR-0004 (Redis/BullMQ, enmendada), ADR-0008 (stock), ADR-0009 (AdminGuard)
- `openspec/changes/US-014-registro-login-backend/design.md` (precedente de
  purga programada diferida)
