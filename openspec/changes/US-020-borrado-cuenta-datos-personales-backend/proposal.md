---
tracker-id: null
tracker-source: null
parent-us: US-020
discipline: backend
variant: null
language: es
---

# US-020 Backend — Borrado de cuenta y datos personales (Ley 25.326)

## Why

El PRD §6 compromete por escrito: «los datos del comprador (cuenta + contacto) se
conservan **hasta que el cliente solicite el borrado de su cuenta**». US-017 ya
publica esa promesa en la política de privacidad. `customers.deleted_at` existe
desde US-014 (DER del E2E §8) y el login ya lo filtra (`CustomersRepository.
findActiveByEmailWithHash`/`findActiveById`), pero **ningún endpoint lo escribe
todavía** — US-014 lo difirió explícitamente «a una US futura» y US-017 lo declaró
fuera de alcance. Esta US es esa pieza faltante: sin ella el sitio promete por
escrito un derecho que no puede ejercerse, que es incumplimiento con apariencia de
cumplimiento bajo la Ley 25.326 de protección de datos personales (AR).

US-021 (`Done`, PR #41/#48/#54) ya resolvió la mitad equivalente para las órdenes
de **compradores invitados** — anonimizar en vez de borrar, para no romper la
promesa paralela de historial de 12 meses (US §6) ni las métricas de US-016. Esta
US cierra la otra mitad de la capacidad 13 del PRD: las **cuentas registradas**, y
**reusa exactamente el mismo mecanismo de anonimización de órdenes** que US-021
construyó — no lo duplica. La diferencia real con US-021 es estructural: acá el
sujeto es la fila `customers` misma (con una restricción `UNIQUE` en `email` que
`orders.buyer_email` no tiene), el disparo es autoservicio del propio titular con
sesión (no una acción del dueño respondiendo a un pedido por email/WhatsApp), y el
borrado tiene que apagar sesiones y tokens vivos además de anonimizar datos —
ninguno de los `ON DELETE` del esquema se dispara porque el borrado es lógico, no
físico (ver `design.md` §Approach para la tabla completa de las 4 relaciones).

Las 5 decisiones de producto que gobiernan el diseño (anonimizar no borrar, email
liberado, inmediato e irreversible sin ventana de gracia, autoservicio, las
órdenes en curso bloquean) están **cerradas por el PO** en la US §10 — ninguna se
reabre acá; este proposal las traduce a un endpoint concreto.

## What changes

- **Migración aditiva de un solo `CHECK`** sobre `orders.anonymization_reason`:
  agrega `'account_deletion'` como tercer valor válido (junto a los
  `'retention_policy'`/`'requested'` de US-021) — distingue en la auditoría "esta
  orden se anonimizó porque el TITULAR borró su cuenta entera" de "se anonimizó
  esta orden puntual a pedido". Ninguna columna nueva en `customers` — `deleted_at`
  ya existe desde US-014; el resto de la anonimización sobrescribe columnas que ya
  existen (`name`, `email`, `phone`). Evaluado contra `data-architecture-patterns`:
  caso trivial, no amerita invocar `data-architect` Mode B (ver `design.md`
  §Persistencia).
- **`DELETE /v1/me`** — nuevo endpoint de autoservicio, gateado por `CustomerGuard`
  + `CsrfGuard` (mismo par que `logout`, mismo criterio de superficie mutante
  autorizada por cookie). En una sola transacción Prisma:
  1. Verifica órdenes en curso del titular (`pending_payment`/`new`/`preparing`/
     `ready`) **al ejecutar**, no antes — si hay alguna, aborta sin escribir nada y
     responde `409` con la lista (mismo shape que el historial de compras propio,
     US-015 `OrderHistorySummaryDto`, y nada más — AC-4).
  2. Anonimiza la fila `customers` (`name`/`email`/`phone` sobrescritos, `email`
     con un placeholder **único por fila** derivado del propio UUID del cliente —
     AC-6 — y `deleted_at` sellado), guardado por `WHERE deleted_at IS NULL`
     (mismo idioma de idempotencia estructural que US-021 usa en `orders.
     anonymized_at IS NULL` — AC-15: una segunda confirmación no reescribe nada,
     no emite un segundo evento, no falla).
  3. Revoca todas las sesiones del titular (`RefreshTokensRepository.
     revokeAllForCustomer`, ya existía desde US-014) y todos sus enlaces de
     recuperación de contraseña pendientes (`PasswordResetTokensRepository.
     deleteAllForCustomer`, ya existía) — AC-10.
  4. Desvincula (no borra) los carritos del titular (`customer_id = NULL`,
     `Cart.customer_id` ya es nullable con `onDelete: SetNull`) — AC-2.
  5. Anonimiza todas las órdenes históricas no anonimizadas del titular, **reusando
     `OrdersRepository`/las constantes de US-021** con `reason='account_deletion'`
     — AC-3, AC-8, AC-12.
  6. Limpia las cookies de sesión del propio dispositivo (mismo helper que
     `logout`) — AC-1.
- **Nuevo módulo `AccountModule`** (`apps/api/src/account/`) — el único
  orquestador cross-módulo de esta US (necesita `CustomersRepository`/
  `RefreshTokensRepository`/`PasswordResetTokensRepository` de `AuthModule`,
  `OrdersRepository` de `CheckoutModule`, `CartsRepository` de `CartModule`).
  Importa los tres acíclicamente, mismo patrón ya probado por `OrdersModule`
  (`orders → auth`, `orders → checkout`, sin ciclo).
- **`AuthModule` gana 2 exports aditivos** (`CsrfGuard`,
  `CustomersRepository`/`RefreshTokensRepository`/`PasswordResetTokensRepository`)
  y un octavo... noveno throttler nombrado (`account_deletion`) en su registro
  único de `ThrottlerModule` — sin tocar ningún export ni throttler existente.
- **`RefreshTokensRepository.revokeAllForCustomer` y `PasswordResetTokensRepository.
  deleteAllForCustomer` ganan un parámetro `tx` opcional** (`Prisma.
  TransactionClient | PrismaService = this.prisma`), mismo idioma ya establecido
  en `StockRepository`/`PaymentsRepository`/`OrderStatusHistoryRepository` —
  aditivo, sin romper ningún llamador existente (reset de contraseña sigue
  llamándolos sin `tx`).
- **`CustomersRepository` gana `anonymize(id, tx)`** (guardado por `WHERE
  deleted_at IS NULL`) y **`CartsRepository` gana `unlinkAllForCustomer(id, tx)`**
  y **`OrdersRepository` gana `listBlockingForCustomer(id, tx)` +
  `anonymizeAllForCustomer(id, reason, tx)`** — todas siguiendo el mismo idioma
  `tx: Prisma.TransactionClient | PrismaService = this.prisma`.
- **`AccountEventsService`** (observability/) — un evento `account.deleted` por
  borrado exitoso, cero PII en el payload (mismo candado que
  `OrdersRetentionEventsService`/`AuthEventsService`) — AC-14.
- **`apps/api/docs/api/openapi.yaml`** — nuevo endpoint documentado + los 3
  lugares donde `anonymization_reason` está enumerado ganan el tercer valor
  `account_deletion`.

## Out of scope

- **UI del flujo de borrado** (confirmación destructiva de dos pasos en
  `/mi-cuenta`) — change de frontend-web separado.
- **Automatización de los 15 AC** — change de QA separado (o Modo A embebido, a
  decidir al planificar QA).
- **Borrado iniciado por el dueño desde el panel** — decisión de producto
  explícita (US §4, §10 decisión 4): el flujo es exclusivamente autoservicio.
- **Exportación / portabilidad de datos personales** (derecho de acceso) — ya
  diferido con dueño en CAP-13 (`retencion-datos-personales/requirements.md`
  D-4).
- **Purga programada de tokens vencidos** — diferida a operaciones (BullMQ/Redis,
  ADR-0004); esta US revoca en el acto, no construye el barrido periódico.
- **Cambio del plazo de retención de 12 meses de las órdenes** — es de US-021, sin
  tocar acá.
- **Invalidación activa del access-JWT stateless en otro dispositivo dentro de su
  TTL** (≤ 15 min por defecto) — límite estructural preexistente de ADR-0011 (el
  mismo que ya tiene el cambio de contraseña, que sella `password_changed_at` sin
  un chequeo por-request equivalente); ver `design.md` §Trade-offs para por qué no
  se cierra en este change y por qué el residual es acotado y ya documentado como
  propiedad conocida del sistema, no una regresión de esta US.

## References

- US: `docs/user-stories/US-020-borrado-cuenta-datos-personales.md`
- PRD: `docs/product/prd.md` §6 (política de retención), capacidad 13
- E2E: `docs/product/design-e2e.md` §8 (DER), §14 (auth)
- Capacidad viva que este change extiende: `openspec/specs/retencion-datos-personales/`
  (CAP-13, creada por US-021 backend — README/requirements/decisions/contracts)
- Precedente de mecanismo reusado: `apps/api/src/checkout/order-anonymization.ts`,
  `orders-retention.service.ts`, `orders.repository.ts` (`anonymize`,
  `anonymizeRetentionEligible`) — US-021
- Precedente de idioma `tx` opcional: `apps/api/src/stock/stock.repository.ts`,
  `apps/api/src/payments/payments.repository.ts`,
  `apps/api/src/orders/order-status-history.repository.ts`
- Precedente de módulo orquestador acíclico (`auth` + `checkout` sin ciclo):
  `apps/api/src/orders/orders.module.ts` (US-012/US-015)
- Precedente de flujo cookie + CSRF + limpieza de sesión:
  `apps/api/src/auth/customer-auth.controller.ts` (`logout`)
- Origen del hueco: US-020 §10 ("Origen") — detectado el 2026-08-18 al planificar
  el backend de US-014.
