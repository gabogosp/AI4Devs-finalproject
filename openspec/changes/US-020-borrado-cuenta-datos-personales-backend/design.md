---
tracker-id: null
tracker-source: null
parent-us: US-020
discipline: backend
variant: null
language: es
---

# US-020 Backend — Design

## Context

`customers.deleted_at` existe desde US-014 (DER del E2E §8) y el login ya lo
filtra (`findActiveByEmailWithHash`/`findActiveById`), pero nada lo escribe. Las
4 relaciones que cuelgan de `customers` ya declaran su `onDelete` (US §10,
"Consecuencia operativa de no hacer borrado físico"): `orders`/`carts` con
`SetNull`, `refresh_tokens`/`password_reset_tokens` con `Cascade`. Como el
borrado de esta US es **lógico** (anonimizar, decisión de producto 1), **ninguno
de esos `onDelete` se dispara** — el flujo tiene que ocuparse explícitamente de
cada una.

US-021 (`Done`) ya construyó el mecanismo de anonimización para `orders`
(columnas `anonymized_at`/`anonymization_reason`, `OrdersRepository.anonymize`/
`anonymizeRetentionEligible`, constantes en `checkout/order-anonymization.ts`,
`OrdersRetentionEventsService`). Este change **reusa ese mecanismo sin
duplicarlo** — agrega un tercer valor al enum de `reason` y un método de
`OrdersRepository` que aplica el mismo `UPDATE` guardado a **todas** las órdenes
de un cliente en vez de a una sola.

No existe todavía un módulo natural para "la cuenta del cliente" más allá de
`AuthModule` (que posee `customers`, `refresh_tokens`, `password_reset_tokens`) —
pero `AuthModule` no puede importar `CheckoutModule` ni `CartModule` para esta
operación porque **`CheckoutModule` ya importa `AuthModule`** (`CustomerGuard`/
`CsrfGuard`/`AuthEventsService`): importar en el otro sentido crearía un ciclo.
`OrdersModule` (US-012/US-015) ya resolvió este mismo problema para una
necesidad distinta (panel admin + historial de compras) importando `AuthModule`
+ `CheckoutModule` de forma acíclica, con la dirección documentada explícitamente
en su propio `orders.module.ts`: *"orders → checkout, checkout no conoce
orders"*. Este change reproduce esa misma forma acíclica para un propósito
distinto (borrado de cuenta, no lectura de órdenes) en un módulo nuevo
`AccountModule`, que además necesita `CartModule` (que `OrdersModule` no
importa) — ninguno de los tres módulos importados conoce a `AccountModule`, así
que la dirección se mantiene acíclica.

## Goals

- AC-1: el borrado se ejecuta en el momento de confirmar, cierra la sesión y
  limpia las cookies del dispositivo.
- AC-2/AC-11: ninguna copia recuperable de `name`/`email`/`phone` sobrevive en
  ninguna tabla ni en logs.
- AC-3/AC-8/AC-12: las órdenes históricas sobreviven anonimizadas, reusando el
  mecanismo de US-021; ninguna se borra; los agregados de US-016 no cambian.
- AC-4/AC-9: las órdenes en curso bloquean el borrado, verificado al ejecutar (no
  antes), con el detalle de cuáles.
- AC-5: el email queda genuinamente libre para un re-registro limpio.
- AC-6: el placeholder de anonimización es único por fila, sin colisión entre
  dos borrados concurrentes.
- AC-10: ninguna de las tres puertas (login, sesión abierta en otro dispositivo,
  link de reset pendiente) sigue abierta después del borrado.
- AC-13: sólo el titular con sesión propia puede borrar su cuenta.
- AC-14: observabilidad sin PII.
- AC-15: doble confirmación produce un solo efecto, sin error.

## Non-goals

- Construir la UI de confirmación destructiva (frontend-web, change separado).
- Construir el barrido periódico de tokens vencidos (`Deferred: operaciones`).
- Cambiar el plazo de retención de 12 meses de órdenes (US-021).
- Cerrar el residual de invalidación de un access-JWT stateless todavía vigente
  en otro dispositivo (ver Trade-offs) — es una propiedad estructural de
  ADR-0011 que esta US no introduce ni empeora.
- Exportación / derecho de acceso a datos personales (diferido, `D-4` de
  `retencion-datos-personales/requirements.md`).

## Approach

### Persistencia

```prisma
// packages/db/prisma/schema.prisma — SIN cambios en `Customer` (deleted_at,
// name, email, phone ya existen desde US-014). Sin cambios en `Cart`
// (customer_id ya es nullable con onDelete: SetNull). Sin cambios en
// `RefreshToken`/`PasswordResetToken` (onDelete: Cascade ya declarado, aunque
// no se dispara — el borrado es lógico, no físico).
```

La única escritura de esquema es ensanchar el `CHECK` que US-021 ya declaró
sobre `orders.anonymization_reason`:

```sql
-- Migración aditiva: agrega 'account_deletion' como tercer valor válido.
ALTER TABLE "orders" DROP CONSTRAINT "orders_anonymization_reason_check";
ALTER TABLE "orders" ADD CONSTRAINT "orders_anonymization_reason_check"
  CHECK ("anonymization_reason" IS NULL
         OR "anonymization_reason" IN ('retention_policy', 'requested', 'account_deletion'));
```

El `CHECK` de consistencia cruzada (`anonymized_at IS NULL = anonymization_reason
IS NULL`) de US-021 no cambia — sigue siendo válido con 3 valores en vez de 2.

**Evaluación contra `data-architecture-patterns`** (mandatoria por el comando):
workload = relacional, operación de conjunto (`UPDATE ... WHERE`), volumen bajo
(una cuenta, sus carritos y sus órdenes — decenas, no miles de filas), motor ya
en uso (Postgres/Prisma, baseline `aws-lightsail-baseline`). No hay tabla nueva,
no hay columna nueva en `customers`/`carts`/`refresh_tokens`/
`password_reset_tokens` (todo lo que este flujo necesita ya existe desde
US-014/US-021), no hay movimiento de datos entre motores, no hay cambio de
motor. **Caso trivial** — no amerita invocar al sub-agente `data-architect`
(Mode B); se resuelve inline, mismo criterio que US-021 aplicó a su propia
migración de dos columnas.

**Por qué un tercer valor de `reason` y no reusar `'requested'`** (decisión de
diseño explícita, no diferida): `'requested'` en US-021 significa "el dueño
anonimizó ESTA orden puntual porque el comprador invitado se lo pidió por email/
WhatsApp" — una acción manual, de a una orden por vez, sobre un comprador sin
cuenta. `'account_deletion'` es estructuralmente distinto: es el **efecto en
cascada** de que el titular borró su cuenta entera, dispara la anonimización de
**todas** sus órdenes no anonimizadas en una sola operación, y lo ejecuta el
propio cliente, no el dueño. Colapsar los dos en `'requested'` perdería esa
distinción operativa (AC-3 exige que "conste que la anonimización fue a pedido
de la persona y en qué momento" — un tercer valor lo deja más preciso, no menos,
sin costo real: el `CHECK` ya es un `TEXT` con enum cerrado, ensancharlo es
aditivo y barato, mismo idioma que el resto del schema para campos de estado
cerrado).

### Constantes de anonimización de `customers`

`apps/api/src/auth/customer-anonymization.ts` (nuevo, espejo de
`checkout/order-anonymization.ts`):

```ts
/** 'Cuenta eliminada' — no colisiona con ningún nombre real (US §9, irreversibilidad). */
export const ANONYMIZED_CUSTOMER_NAME = 'Cuenta eliminada';
/** Mismo placeholder que orders (US-021) — no es información nueva, es "sin teléfono". */
export const ANONYMIZED_CUSTOMER_PHONE = '+00 000-0000';

/**
 * A diferencia de `ANONYMIZED_BUYER_EMAIL` de US-021 (valor FIJO, porque
 * `orders.buyer_email` no tiene `UNIQUE`), acá el valor **tiene** que ser único
 * por fila: `customers.email` sí tiene `UNIQUE`, y la decisión de producto 2
 * exige que el email real quede libre para un re-registro (AC-5) sin colisionar
 * con el placeholder de un borrado anterior (AC-6). Usar el UUID de la propia
 * fila como sufijo lo garantiza determinísticamente, sin aleatoriedad ni
 * verificación de colisión: dos clientes distintos tienen `id` distintos por
 * construcción (PK), así que sus placeholders también lo son.
 */
export function anonymizedCustomerEmail(customerId: string): string {
  return `cuenta-borrada+${customerId}@anonimizado.dsm.invalid`;
}
```

Mismo TLD `.invalid` (RFC 2606, no resoluble) que US-021 ya adoptó — si algún
día un adapter de email intentara enviar ahí, fallaría en DNS antes de llegar a
nadie real.

**`password_hash` no se toca** (decisión explícita, mismo criterio que
`access_token_hash` en US-021): no es de los tres datos que la US pide borrar
(`name`/`email`/`phone`), y como `findActiveByEmailWithHash` filtra por el email
real (que ya no existe en la fila tras el borrado), el hash queda huérfano e
inalcanzable por cualquier flujo de login — cambiarlo no agrega ninguna garantía
que el sistema no tenga ya.

### `CustomersRepository.anonymize` — guardado por `WHERE deleted_at IS NULL`

```ts
async anonymize(
  id: string,
  tx: Prisma.TransactionClient | PrismaService = this.prisma,
): Promise<{ anonymizedAt: Date } | null> {
  const { count } = await tx.customer.updateMany({
    where: { id, deleted_at: null },
    data: {
      name: ANONYMIZED_CUSTOMER_NAME,
      email: anonymizedCustomerEmail(id),
      phone: ANONYMIZED_CUSTOMER_PHONE,
      deleted_at: new Date(),
    },
  });
  if (count === 0) return null; // ya estaba borrada (AC-15) o no existe
  const row = await tx.customer.findUnique({
    where: { id },
    select: { deleted_at: true },
  });
  return row?.deleted_at ? { anonymizedAt: row.deleted_at } : null;
}
```

Mismo mecanismo de idempotencia estructural que `OrdersRepository.anonymize`
(US-021): el `WHERE deleted_at: null` hace que una segunda llamada sobre la
misma fila afecte 0 filas y devuelva `null` — sin excepción, sin una segunda
escritura. Bajo `READ COMMITTED` (default de Postgres/Prisma), dos llamadas
CONCURRENTES sobre el mismo `id` serializan a nivel de fila: la segunda espera
el lock de la primera y, al re-evaluar el `WHERE` después del commit, no
matchea nada — mismo argumento de concurrencia que ya validó AC-8 de US-021.

### `OrdersRepository` — dos métodos nuevos, mismo archivo (único punto de ORM)

```ts
/** Estados que impiden el borrado de cuenta (US-020 §10 decisión 5, AC-4). */
const BLOCKING_ORDER_STATUSES = ['pending_payment', 'new', 'preparing', 'ready'];

/**
 * AC-4/AC-9: se llama SIEMPRE dentro de la misma transacción que el resto del
 * borrado, como primera lectura — nunca antes, nunca cacheada desde una
 * pantalla previa. Devuelve las filas completas (no sólo el conteo) porque
 * AC-4 exige mostrar CUÁLES bloquean, "con el mismo nivel de detalle que ya ve
 * en su historial de compras" — el caller las proyecta con
 * `OrderHistorySummaryDto.from` (US-015), sin duplicar esa forma.
 */
async listBlockingForCustomer(
  customerId: string,
  tx: Prisma.TransactionClient | PrismaService = this.prisma,
): Promise<Order[]> {
  return tx.order.findMany({
    where: { customer_id: customerId, status: { in: BLOCKING_ORDER_STATUSES } },
    orderBy: { created_at: 'desc' },
  });
}

/**
 * Anonimiza TODAS las órdenes no anonimizadas del cliente en un único `UPDATE`
 * de conjunto — mismo idioma que `anonymizeRetentionEligible` (US-021), pero
 * con `customer_id` en el `WHERE` en vez de un corte de fecha. Devuelve cuántas
 * tocó (US §9 — "cuántas órdenes anonimizó" va al evento, AC-14).
 */
async anonymizeAllForCustomer(
  customerId: string,
  reason: AnonymizationReason,
  tx: Prisma.TransactionClient | PrismaService = this.prisma,
): Promise<number> {
  const { count } = await tx.order.updateMany({
    where: { customer_id: customerId, anonymized_at: null },
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

`checkout/order-anonymization.ts` amplía el tipo:

```ts
export type AnonymizationReason = 'retention_policy' | 'requested' | 'account_deletion';
```

### `RefreshTokensRepository`/`PasswordResetTokensRepository` — `tx` opcional aditivo

Ambos métodos YA EXISTÍAN desde US-014 (`revokeAllForCustomer`,
`deleteAllForCustomer`) — este change sólo les agrega el parámetro `tx`
opcional, mismo idioma que `StockRepository`/`PaymentsRepository`/
`OrderStatusHistoryRepository`:

```ts
// refresh-tokens.repository.ts
async revokeAllForCustomer(
  customerId: string,
  tx: Prisma.TransactionClient | PrismaService = this.prisma,
): Promise<number> {
  const { count } = await tx.refreshToken.updateMany({
    where: { customer_id: customerId, revoked_at: null },
    data: { revoked_at: new Date() },
  });
  return count;
}

// password-reset-tokens.repository.ts
async deleteAllForCustomer(
  customerId: string,
  tx: Prisma.TransactionClient | PrismaService = this.prisma,
): Promise<number> {
  const { count } = await tx.passwordResetToken.deleteMany({
    where: { customer_id: customerId },
  });
  return count;
}
```

Aditivo puro: `PasswordResetService.confirm` y `SessionService.
revokeAllForCustomer` (reset de contraseña) siguen llamándolos sin `tx` y su
comportamiento no cambia — el default `= this.prisma` reproduce exactamente lo
que hacían antes.

### `CartsRepository.unlinkAllForCustomer` — desvincula, no borra

```ts
async unlinkAllForCustomer(
  customerId: string,
  tx: Prisma.TransactionClient | PrismaService = this.prisma,
): Promise<number> {
  const { count } = await tx.cart.updateMany({
    where: { customer_id: customerId },
    data: { customer_id: null },
  });
  return count;
}
```

El carrito nunca contuvo PII propia (sólo `customer_id`, que ya es nullable con
`onDelete: SetNull` — este método hace explícitamente lo que el trigger de la
base habría hecho en un borrado físico). El comentario del schema (`Cart.
customer_id`) ya fijaba esta intención desde US-014: *"(US-020) anonimiza el
carrito, no lo borra"* — más preciso: **desvincula**, el contenido del carrito
sobrevive como anónimo y expira por su propia ventana (US-007).

### `AccountDeletionService` — orquestación transaccional

```ts
@Injectable()
export class AccountDeletionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomersRepository,
    private readonly refreshTokens: RefreshTokensRepository,
    private readonly passwordResetTokens: PasswordResetTokensRepository,
    private readonly carts: CartsRepository,
    private readonly orders: OrdersRepository,
    private readonly events: AccountEventsService,
  ) {}

  async deleteAccount(customerId: string): Promise<void> {
    const result = await this.prisma.$transaction(async (tx) => {
      // AC-4/AC-9: lectura fresca, DENTRO de la transacción, primera operación.
      const blocking = await this.orders.listBlockingForCustomer(customerId, tx);
      if (blocking.length > 0) {
        throw new AccountHasActiveOrdersError(blocking.map(OrderHistorySummaryDto.from));
      }

      // AC-15: guardado por WHERE deleted_at IS NULL — 0 filas = ya borrada, no-op.
      const anonymized = await this.customers.anonymize(customerId, tx);
      if (!anonymized) return null;

      await this.refreshTokens.revokeAllForCustomer(customerId, tx);       // AC-10
      await this.passwordResetTokens.deleteAllForCustomer(customerId, tx); // AC-10
      await this.carts.unlinkAllForCustomer(customerId, tx);               // AC-2
      const anonymizedOrders = await this.orders.anonymizeAllForCustomer(
        customerId,
        'account_deletion',
        tx,
      ); // AC-3, AC-8, AC-12
      return { anonymizedOrders };
    });

    if (result) {
      this.events.emit('account.deleted', customerId, undefined, {
        anonymized_orders: result.anonymizedOrders,
      });
    }
  }
}
```

Lanzar `AccountHasActiveOrdersError` **dentro** del callback de `$transaction`
hace rollback automático — en ese punto no se escribió nada todavía, así que no
hay nada que revertir; es la forma más simple de garantizar "si hay una orden en
curso, no se modifica ningún dato" (AC-4) sin un `if` fuera de la transacción
que duplique la lectura.

**Por qué el chequeo de bloqueo vive DENTRO de la transacción y no antes**
(AC-9): correrlo como primera operación de la MISMA transacción que hace las
escrituras minimiza la ventana de carrera a la duración de la transacción entera
(milisegundos, con el presupuesto p95 < 500ms de la US §9) en vez de a la
ventana completa entre que el navegador pintó la pantalla y el humano hizo clic
en confirmar (segundos a minutos). No se usa `SERIALIZABLE` ni `SELECT ... FOR
UPDATE`: el proyecto no tiene ese nivel de defensa en ningún otro flujo
concurrente (ver Trade-offs) y el volumen real (una sola sucursal, checkout
guiado paso a paso) hace que una orden nueva completándose en el mismo
milisegundo que un borrado de cuenta sea, en la práctica, un evento que nunca
ocurrió en este proyecto — documentado como residual aceptado, no como bug.

### Errores de dominio

`apps/api/src/account/account-errors.ts`:

```ts
export class AccountHasActiveOrdersError extends DomainError {
  readonly status = 409;
  readonly type = 'dsm:account/active-orders';

  constructor(blockingOrders: OrderHistorySummaryDto[]) {
    super(
      'No podés borrar tu cuenta mientras tengas órdenes sin retirar o sin pagar',
      undefined,
      { blocking_orders: blockingOrders },
    );
  }
}
```

Usa `extensions` de `DomainError` (RFC 7807 §3.2, mismo mecanismo que el 409 de
stock del carrito) para llevar `blocking_orders` como array tipado, no
incrustado en el `detail` — el frontend lo renderiza directo, sin parsear texto.

### Controller — rutas, guards, rate limit

```ts
@Controller('v1/me')
@UseGuards(AccountThrottlerGuard)
@SkipThrottle({
  auth: true, storefront: true, cart: true, enrichment: true,
  search: true, checkout: true, payments_simulate: true, orders_history: true,
})
export class AccountController {
  constructor(
    private readonly deletion: AccountDeletionService,
    private readonly config: ConfigService,
  ) {}

  @Delete()
  @HttpCode(204)
  @Throttle({ account_deletion: { limit: ACCOUNT_DELETION_RATE_LIMIT_MAX } })
  @UseGuards(CustomerGuard, CsrfGuard)
  async deleteAccount(
    @Req() req: RequestConCliente,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.deletion.deleteAccount(req.customerId!);
    clearSessionCookies(res, this.config.get<string>('AUTH_COOKIE_SECURE') !== 'false');
  }
}
```

`AccountThrottlerGuard` es una copia deliberada de `AuthThrottlerGuard`/
`OrdersHistoryThrottlerGuard` (mismo boilerplate de cabeceras `RateLimit-*`/
`Retry-After`) — el repo ya tiene 3 copias idénticas de esta clase, una por
módulo consumidor, en vez de exportar una desde `AuthModule`; este change sigue
el mismo patrón en vez de romperlo. `CustomerGuard`/`CsrfGuard` sí se importan
de `AuthModule` (mismo par exacto que `logout`, mismo orden: la validez del JWT
la resuelve `CustomerGuard` primero, `CsrfGuard` sólo decodifica después).

**Por qué `DELETE /v1/me` y no `POST /v1/auth/account/delete`**: es el shape
REST canónico para "borrar el recurso que represento" y no colisiona con
`GET /v1/auth/me` (namespace distinto, semántica distinta: uno es la sesión,
otro es la cuenta como recurso). `AccountModule` es un módulo nuevo porque
`AuthModule` no puede importar `CheckoutModule`/`CartModule` sin ciclo (ver
Context) — no porque "borrar cuenta" no sea conceptualmente parte de auth.

**204 sin cuerpo** — mismo criterio que `logout`: no hay nada que el cliente
necesite leer del cuerpo (el mensaje de confirmación de AC-1 lo renderiza el
frontend al recibir 204, no lo construye el backend).

### Por qué NO hace falta `Idempotency-Key`

Mismo argumento que US-021 declaró para sus dos endpoints: el riesgo que
`Idempotency-Key` protegería (doble efecto de un retry/doble clic) ya está
resuelto estructuralmente por el `WHERE deleted_at IS NULL` de
`CustomersRepository.anonymize` — agregar la máquina de claves encima sería
protección duplicada sin ganancia (AC-15 ya cubierto sin ella).

### AC-10 — por qué las 3 puertas cierran sin trabajo adicional en esta US

1. **Login con las credenciales anteriores**: `findActiveByEmailWithHash(email)`
   busca por el email que la persona **tipea** (el real, viejo). Tras el
   borrado, `customers.email` ya no es ese valor — está sobrescrito al
   placeholder. La fila no matchea por NINGÚN motivo, ni siquiera por el filtro
   `deleted_at`. `InvalidCredentialsError` (mismo objeto sea cual sea la causa,
   ya establecido en US-014) responde igual que a un email que nunca existió —
   **cierra gratis**, por la decisión de producto 2 (email liberado), sin tocar
   `credentials.service.ts`.
2. **Sesión abierta en otro dispositivo**: `refreshTokens.revokeAllForCustomer`
   mata todos los refresh — ningún dispositivo puede renovar su access después
   de que venza (`refresh` handler ya llama `findActiveById` y falla si la
   cuenta no está activa, precedente establecido en US-015). El **access JWT**
   ya emitido en el otro dispositivo es stateless (ADR-0011) y sigue siendo
   criptográficamente válido hasta su `exp` (≤ `AUTH_ACCESS_TTL_MIN`, default 15
   min) — pero cualquier endpoint que haga algo con esa identidad ya
   re-verifica `findActiveById`/`deleted_at` antes de actuar (mismo patrón que
   `GET /v1/auth/me`: *"Token válido de una cuenta que ya no está: fail
   closed"*), así que el residual es "el JWT pasa el guard, pero ninguna acción
   con valor de negocio prospera" — ver Trade-offs para el límite exacto de este
   argumento.
3. **Link de recuperación pendiente**: `passwordResetTokens.
   deleteAllForCustomer` borra físicamente las filas. `findUsableByHash` no
   encuentra nada → `InvalidResetTokenError`, el mismo 400 genérico que ya
   colapsa "inexistente"/"vencido"/"usado" en un solo mensaje — cierra sin
   tocar `password-reset.service.ts`.

Ninguna de las tres puertas necesita un cambio de código fuera de lo que este
change ya construye — es una consecuencia de que US-014 diseñó `deleted_at` y
los filtros por-handler pensando en este momento (comentario textual en el
schema: *"Borrado de cuenta → US-020"*).

### Observabilidad

`apps/api/src/observability/account-events.service.ts`, mismo esqueleto que
`OrdersRetentionEventsService`/`AuthEventsService`:

```ts
export type AccountEventName = 'account.deleted';

emit(
  name: AccountEventName,
  customerId: string,
  traceId?: string,
  fields?: EventFields,
): void
```

Un solo evento, sólo en el camino exitoso (no en el bloqueo por órdenes en curso
ni en el no-op de una segunda confirmación — mismo minimalismo que
`OrdersRetentionEventsService`: no se agrega un evento "blocked" porque ningún
AC lo exige y US-021 no tiene un equivalente para su propio 404). `customerId`
va sólo al log (`entity_id`), nunca a una dimensión de métrica (cardinalidad,
`observability-patterns` §3.3); `anonymized_orders` es un entero. Cero
`name`/`email`/`phone`, ni siquiera transformados (AC-14).

### Threat model (lite, `threat-modeling-lite` — superficie 3/8: DELETE autenticado por cookie)

| Threat | Vector específico | Control |
|---|---|---|
| Spoofing | Cookie de access robada dispara el borrado de una cuenta ajena | `CustomerGuard` (JWT en cookie `httpOnly`, no en header — un XSS que robe el token igual no puede usarlo desde otro origen sin pasar `CsrfGuard`) |
| Tampering | Ningún campo del cliente decide `customer_id` — sale de `req.customerId` (JWT `sub`), nunca del body (no hay `@Body()` en la ruta) | Autorización estructural, mismo patrón que `listByCustomer`/`findByOrderNumberForCustomer` de US-015 |
| Repudiation | Doble confirmación (doble clic, dos pestañas) sin dejar dos registros de auditoría | `WHERE deleted_at IS NULL` serializa a nivel de fila en Postgres; la segunda emite 0 escrituras y 0 eventos (AC-15) |
| Info disclosure | El 409 de "órdenes en curso" revela el detalle de esas órdenes | Aceptado: son las órdenes DEL PROPIO titular autenticado — el mismo detalle que ya ve en `GET /v1/me/orders` (US-015), nada nuevo se expone |
| DoS | Loop de DELETE contra el propio endpoint | Throttler `account_deletion` (5/hora por defecto, `[propuesto — confirma Arquitecto]`) — acción rara, destructiva, sin motivo legítimo para repetirse más que unas pocas veces |
| Elevation | El dueño intenta borrar la cuenta de un cliente desde el panel admin | No existe ninguna ruta admin que llegue a `AccountDeletionService` — `AdminGuard` no gatea `v1/me`, y `v1/me` no gatea con `AdminGuard`. Estructuralmente inalcanzable, no es una verificación en runtime (AC-13) |

## Trade-offs

- **Access-JWT stateless todavía válido en otro dispositivo, dentro de su TTL
  (≤15 min por defecto), no se invalida activamente.** Cerrarlo del todo
  exigiría una verificación contra la base en CADA request autenticado por
  cookie (un round-trip extra en el hot path de cada endpoint de cliente) o una
  blocklist de JTIs — ninguna de las dos existe hoy en el proyecto, y el cambio
  de contraseña (que sella `password_changed_at` con la misma intención
  documentada) tiene exactamente el mismo límite sin que ningún AC de US-014 lo
  haya exigido cerrar. Este change no introduce el gap ni lo empeora — lo
  hereda de ADR-0011 (JWT stateless de vida corta + refresh opaco revocable).
  Si el negocio decide que el residual es inaceptable, es un ADR nuevo sobre el
  esquema de sesión entero, no un ajuste de esta US.
- **Sin `SERIALIZABLE` ni `SELECT ... FOR UPDATE` para el chequeo de órdenes en
  curso.** Ver Approach — el proyecto no usa ese nivel de aislamiento en ningún
  otro flujo concurrente (ni siquiera `cancel-order.service.ts`, que resuelve
  sus propias carreras con `UPDATE ... WHERE status = X` condicional, no con
  locks). Mismo criterio aplicado acá: el chequeo fresco dentro de la
  transacción cierra el caso de uso real (segundos de ventana entre pantalla y
  confirmación); el residual de microsegundos dentro de la propia transacción
  es aceptado, documentado, no medido con evidencia real que lo justifique
  (YAGNI, `base-standards.md` §1).
- **`AccountThrottlerGuard` duplica boilerplate de `AuthThrottlerGuard`/
  `OrdersHistoryThrottlerGuard` en vez de exportarlo una vez.** Se seleccionó
  seguir el patrón existente del repo (cada módulo consumidor define su propia
  copia) en vez de introducir una desviación aislada — no es una decisión nueva
  de esta US, es continuidad de una ya tomada 2 veces antes en el proyecto.
- **`password_hash` no se toca al anonimizar.** Ver Approach — no es de los tres
  datos que la US pide borrar, y queda inalcanzable por construcción una vez que
  el email real desaparece de la fila.

## Deployment considerations

Se recomienda `/plan-deployment`. Motivos:

1. **Primera superficie de autoservicio que borra/anonimiza PII de forma
   irreversible, disparada por el propio cliente** (a diferencia de US-021, que
   es una acción admin sobre una orden puntual) — vale una revisión explícita de
   quién puede accionarla y con qué monitoreo en cada ambiente antes de
   producción.
2. **Migración de esquema** sobre `orders` (ensancha un `CHECK` ya en
   producción potencial de US-008/US-021) — aditiva y de bajo riesgo, pero es la
   misma tabla que ya tuvo una migración reciente.
3. **Cierra la capacidad 13 del PRD junto con US-021** — es la condición que el
   PO fijó para que la política de privacidad de US-017 sea publicable sin
   incumplimiento; vale coordinar el go-live de ambas piezas.

No hay secreto nuevo, ni feature flag, ni dependencia externa nueva en el camino
crítico. El perfil de riesgo operativo es bajo (mismo patrón de transacción y
guards que el resto del proyecto), pero el punto 1 es sobre gobernanza/
monitoreo, no sobre código, y por eso el llamado es a `/plan-deployment`.

## Spec delta (para `/archive-change`)

Este change **extiende** la capacidad viva `retencion-datos-personales` (CAP-13,
creada por el archive de US-021) con un tercer endpoint:
`DELETE /v1/me` — nueva entrada en `contracts/openapi.yaml` (raíz viva) +
`contracts/openapi/paths/delete-account.yaml` (nuevo), y una fila nueva en
`requirements.md` documentando `reason='account_deletion'` como tercer valor del
enum ya declarado por US-021 (R-4 se actualiza: "`retention_policy`|`requested`"
pasa a "`retention_policy`|`requested`|`account_deletion`").

**Delta cruzado sobre una capacidad AJENA** (`ordenes`, no `retencion-datos-
personales`): el `AdminOrderDetail.anonymization_reason` que
`openspec/specs/ordenes/contracts/openapi.yaml` ya declara con
`enum: [retention_policy, requested]` (desde el fix `US-021-publish-order-
anonymization-contract`) necesita el tercer valor — cualquier orden anonimizada
por esta US, vista después por `GET /v1/admin/orders/{id}` (US-012), devolverá
`anonymization_reason: 'account_deletion'`, un valor hoy no declarado en ese
enum. `/archive-change` de este change debe aplicar ese delta puntual sobre
`openspec/specs/ordenes/` también, no sólo sobre `retencion-datos-personales/`.
El spec publicado (`apps/api/docs/api/openapi.yaml`) se actualiza **dentro**
de este change (T5.x), no diferido al archive — es el servicio, no la
capacidad viva.

## Open questions

Ninguna. Las 5 decisiones de producto de la US §10 están cerradas; el único
punto que este documento deja explícitamente NO resuelto (el residual de
access-JWT stateless en otro dispositivo) es una decisión de arquitectura de
sesión completa, no de esta US — está documentado como Trade-off, no como
pregunta abierta.

## References

- `packages/db/prisma/schema.prisma` (`Customer`, `Order`, `Cart`,
  `RefreshToken`, `PasswordResetToken`)
- `apps/api/src/checkout/order-anonymization.ts`, `orders.repository.ts`,
  `orders-retention.service.ts` (mecanismo reusado, US-021)
- `apps/api/src/auth/customers.repository.ts`, `refresh-tokens.repository.ts`,
  `password-reset-tokens.repository.ts`, `customer.guard.ts`, `csrf.guard.ts`,
  `cookies.ts`, `customer-auth.controller.ts` (`logout`)
- `apps/api/src/cart/carts.repository.ts`
- `apps/api/src/orders/orders.module.ts` (precedente de import acíclico
  `auth` + `checkout`), `orders/dto/order-history.dto.ts`
  (`OrderHistorySummaryDto`, reusado tal cual)
- `apps/api/src/stock/stock.repository.ts`,
  `apps/api/src/payments/cancel-order.service.ts` (idioma `tx` opcional +
  transacción multi-repositorio)
- `openspec/specs/retencion-datos-personales/` (CAP-13, capacidad extendida)
- `openspec/specs/ordenes/contracts/openapi.yaml` (delta cruzado,
  `AdminOrderDetail.anonymization_reason`)
- ADR-0009 (AdminGuard), ADR-0011 (sesión JWT + refresh opaco)
