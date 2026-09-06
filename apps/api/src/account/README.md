# Account — borrado de cuenta y datos personales (US-020)

`DELETE /v1/me` es el autoservicio de derecho al olvido (Ley 25.326): el propio cliente,
con su propia sesión, borra su cuenta. Inmediato, síncrono e irreversible — sin ventana
de gracia ni estado intermedio.

## Por qué este módulo vive afuera de `AuthModule`

La dirección real de dependencias del repo es `CheckoutModule → AuthModule`
(`checkout.module.ts` importa `AuthModule` para sus guards). Un módulo que necesite
`AuthModule` **y** `CheckoutModule`/`CartModule` a la vez no puede vivir dentro de
`AuthModule` sin cerrar un ciclo — mismo problema y misma solución que ya tomó
`OrdersModule` en US-012/US-015. `AccountModule` importa los tres (`AuthModule` por
`CustomerGuard`/`CsrfGuard`/los repositorios de sesión; `CheckoutModule` por
`OrdersRepository`; `CartModule` por `CartsRepository`) y no re-declara acceso propio al
ORM — sólo orquesta.

## Anonimiza, no borra la fila

Mismo idioma que US-021 (retención de órdenes): la fila de `customers` sobrevive con la
PII sobrescrita y `deleted_at` sellado. El identificador interno se conserva para que el
vínculo con las órdenes no se rompa (AC-12, métricas de US-016 siguen cuadrando). El
email queda **liberado** para re-registro — no se guarda ni siquiera bloqueado, porque
retenerlo para impedir el re-registro sería seguir conservando un dato personal después
de haber prometido borrarlo.

## Las 4 relaciones que este flujo tiene que resolver a mano

Como el borrado es lógico, ningún `ON DELETE` del esquema se dispara — `AccountDeletionService`
se ocupa de cada una explícitamente, dentro de la misma transacción que anonimiza la cuenta:

| Relación | `onDelete` declarado | Qué hace este flujo | AC |
|---|---|---|---|
| `refresh_tokens` | `Cascade` (no se dispara) | Revoca todas las sesiones de la cuenta, en todos los dispositivos. | AC-1, AC-10 |
| `password_reset_tokens` | `Cascade` (no se dispara) | Invalida los enlaces de recuperación pendientes. | AC-10 |
| `carts` | `SetNull` (no se dispara) | Desvincula el carrito de la cuenta — no borra su contenido, pasa a ser anónimo. | AC-2 |
| `orders` | `SetNull` (no se dispara) | El vínculo se mantiene a propósito; se anonimiza la PII de comprador de cada orden reusando el mecanismo de US-021. | AC-3, AC-12 |

## Reuso del mecanismo de US-021

`OrdersRepository.anonymizeAllForCustomer(customerId, 'account_deletion', tx)` es el mismo
método que US-021 ya usaba para `retention_policy`/`requested` — el `AnonymizationReason` se
ensanchó (constraint + tipo), no se duplicó. A diferencia de US-021, que usa un placeholder
**fijo** para el comprador anonimizado, acá el email debe ser **único por cliente**
(`anonymizedCustomerEmail(id)`, AC-6) — un placeholder fijo colisionaría contra el
`UNIQUE` de `customers.email` en el segundo borrado.

## Orden de los pasos en la transacción, y por qué

1. `listBlockingForCustomer` es la primera lectura **dentro** de la transacción (AC-4/AC-9):
   el chequeo de bloqueo y todas las escrituras comparten la misma serialización de
   Postgres, así que la ventana de carrera es la duración de la transacción, no el tiempo
   entre mostrar el aviso y que el cliente confirme.
2. `customers.anonymize` — su `WHERE deleted_at IS NULL` es la guarda de idempotencia
   (AC-15): una cuenta ya borrada no vuelve a escribir nada, y el resto de los pasos ni se
   ejecuta.
3-6. Revocar sesiones, borrar resets pendientes, desvincular carritos, anonimizar
   órdenes — en ese orden, todas dentro de la misma transacción.

El evento `account.deleted` se emite DESPUÉS del commit — si el commit fallara, no debe
quedar un evento huérfano describiendo un borrado que no ocurrió.

## Autorización — sin parámetro de identidad

El controller no tiene `@Body()`: el `customerId` sale ESTRUCTURALMENTE de
`req.customerId` (JWT verificado por `CustomerGuard`), nunca de un campo que el cliente
pudiera enviar. No existe forma de pasar un `customer_id` ajeno (AC-13).

## Observabilidad sin PII (AC-14)

`AccountEventsService` sólo pasa el `customerId` (pseudónimo interno) al `entity_id` del
log — nunca como dimensión de `MetricsService.increment()` (cardinalidad) y nunca el
nombre/email/teléfono, ni siquiera en el 409 de bloqueo.
