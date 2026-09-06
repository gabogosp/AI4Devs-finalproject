# Capacidad: Pagos (CAP-4)

**Estado**: entregada — camino **manual** (US-023) + confirmación **automática** vía
webhook de MercadoPago y medio simulado «DSM» (US-010). Sólo falta `createPreference`
(crear la preferencia, redirigir al comprador a Checkout Pro) — sigue siendo
`US-009-pago-mercadopago-backend`, `Blocked` sin credenciales reales de MercadoPago.

Estado declarado del sistema para la capacidad CAP-4 del PRD §2.1 (fila 4 —
"Ficha, carrito y checkout guest con MercadoPago", que incluye el medio
simulado «DSM»). Este directorio es el **acumulado** de los changes
archivados: se extiende en cada `/archive-change`, nunca se reescribe.

## Por qué esta capacidad no existía todavía

`US-023-pago-manual-offline-backend` es la **primera implementación real**
de tres elementos que hasta entonces sólo existían como nombre en un
`design.md` sin construir (`US-009-pago-mercadopago-backend`): la tabla
`payments`, cualquier escritor de `products.stock`, y el
`PaymentConfirmationPort`. Nace como un camino de pago **independiente** de
MercadoPago — mientras `US-009` está `Blocked` por falta de credenciales, el
dueño confirma pagos recibidos offline (efectivo, transferencia) a mano
desde un panel mínimo.

## Qué está vivo hoy

Dos módulos nuevos en `apps/api/src/` — `stock/` (único escritor de
`products.stock`) y `payments/` (implementa el puerto):

- **`PaymentConfirmationPort`** con un único método `confirm()`, pensado
  para que `US-009`/`US-010` lo reusen con otros `provider` sin reescribirlo
  — mismo lugar, misma forma de invocación que `US-010-orden-webhook-stock-backend/design.md`
  §D9 ya había bosquejado (sin construir).
- **`POST /admin/orders/{orderId}/confirm-payment`**: transiciona
  `pending_payment → new`, decrementa el stock de cada línea (ADR-0008) y
  registra un pago `provider=manual` — las tres escrituras en **una sola
  transacción** (primera vez en el repo que una transacción Prisma cruza
  tres repositorios). Sin body: monto, líneas y `provider` salen de la
  orden; quién confirma sale del `sub` del JWT admin, nunca de un campo que
  el cliente pudiera falsificar.
- **`GET /admin/orders/pending-payment`**: lista angosta (sin
  `buyer_email`/`buyer_phone`, sin paginación — volumen de un solo local) de
  órdenes `pending_payment` — la excepción declarada al panel general de
  US-012 (que nunca las muestra). Es el único punto de entrada para llegar
  al `POST /confirm-payment` (necesita el `id` UUID de la orden).
- **Idempotencia determinística**: `idempotency_key = manual:{orderId}`,
  UNIQUE — un doble click o reintento de red pega contra `P2002` en el
  segundo intento, nunca dos pagos ni doble descuento de stock.
- **AC-4/AC-5 unificados**: cualquier orden que no esté `pending_payment`
  (ya `new`, `cancelled`, o repetición) devuelve el mismo `409
  dsm:payments/order-not-pending-payment` — el resultado observable que pide
  el AC es idéntico en ambos casos.
- **Stock insuficiente entre checkout y confirmación**: `409
  dsm:payments/insufficient-stock`, la transacción entera revierte (la orden
  no queda `new` con stock sin decrementar).
- **Sin expansión de alcance PCI** (ADR-0006): la fila de `payments` no
  guarda PAN/CVV/vencimiento/titular; `confirmed_by` es un claim de
  identidad interna.

## Qué se sumó con US-010 (webhook + medio simulado + jobs admin)

`ConfirmOrderService.confirm()` (US-023) se amplía con una unión discriminada de
`provider` — un solo método, la rama `manual` sin una línea de cambio:

- **`POST /webhooks/mercadopago`**: verifica `x-signature` (HMAC-SHA256 en tiempo
  constante + ventana de tolerancia sobre `ts`), **re-consulta el pago a la API de
  MercadoPago** (la verdad nunca sale del payload) y, si está `approved`, confirma la
  orden por el mismo camino que el pago manual. Idempotente por el mismo guard de
  `orders` que US-023 construyó. Siempre 200 salvo firma inválida (401) — MercadoPago
  reintenta ante cualquier no-2xx.
- **`POST /checkout/simulate-payment`**: el medio simulado «DSM» de ADR-0006 — salta
  MercadoPago, autorizado por el `order_token` de la orden (no JWT), gateado por
  `PAYMENTS_SIMULATED_ENABLED` (falla el arranque si está prendido en producción).
  Ejercita el mismo `confirm()` que el webhook real — AC-9 estructural, no declarado.
- **Reembolso automático + auto-cancelación por falta de stock**: si el stock no
  alcanza al confirmar un pago automático, la orden se cancela y el pago intenta
  reembolsarse — si el reembolso falla, la fila queda `refund_pending` (nunca se
  pierde en memoria, nunca se marca fallido definitivo).
- **3 endpoints admin sin scheduler in-process**: `POST /admin/payments/reconcile`
  (recupera webhooks que nunca llegaron), `POST /admin/orders/cleanup-abandoned`
  (cancela `pending_payment` viejas), `POST /admin/payments/retry-refunds`
  (reintenta reembolsos `refund_pending`). Un cron externo (Railway/GitHub Actions)
  les pega periódicamente — no hay `setInterval` en `apps/api/src`.
- **`MercadoPagoClient`** (`getPayment`/`searchByExternalReference`/`refund`) con
  timeout, backoff+jitter y circuit-breaker in-process — construido por este change,
  con alcance mínimo (sin `createPreference`, que sigue siendo de US-009).
- **`NotificationPort`** (de `orders/`, no un puerto paralelo) gana
  `orderConfirmed`/`ownerNewOrder`/`orderCancelledNoStock`.

Detalle completo (decisiones D10-D16, threat model STRIDE, requisitos R-7 a R-17) en
[`requirements.md`](requirements.md) y [`decisions.md`](decisions.md).

## Qué se sumó con US-013 (cancelación de orden + reembolso + reintegro de stock)

- **`POST /admin/orders/{id}/cancel`** (`CancelOrderService`/`OrderCancellationController`,
  en `payments/`, no en `ordenes/` — evita el ciclo de módulos, mismo criterio
  que `confirm-payment`): transiciona `new`/`preparing`/`ready` → `cancelled`,
  reintegra el stock de cada línea (inverso de `decrementForOrder`), y
  gestiona el reembolso reusando literal el patrón `refund_pending`/
  `POST /admin/payments/retry-refunds` de US-010 — sin ningún mecanismo de
  reembolso nuevo.
- **Cero migración de Prisma**: `orders.status`/`orders.cancelled_at`/
  `payments.status` ya admitían todo lo que este endpoint escribe (verificado
  contra las migraciones aplicadas).
- **Idempotencia estructural** (mismo patrón que `transitionToCancelledIfPending`/
  `updateStatusConditional`): repetir la llamada sobre una orden ya `cancelled`
  responde 200 idéntico, sin reintegrar stock ni reembolsar dos veces.
- **Trazabilidad sin columnas nuevas**: `order_status_history` (quién/cuándo)
  + `payments.status` (resultado del reembolso).
- **Aviso al comprador (seam)**: `NotificationPort.orderCancelledByOwner`
  (método nuevo, mismo puerto de US-010/US-012) — entrega real
  `Deferred: US-011`.
- **Panel del dueño** (`OrderCancelAction.tsx`, `apps/web/src/features/orders/`):
  botón "Cancelar orden" con confirmación de dos pasos (reusa `ConfirmDialog`
  sin modificarlo), montado junto a `OrderStatusActions` en `OrderDetail.tsx`.
  Reconciliación directa desde `CancelOrderResponse` (sin segundo `GET`),
  mensaje de resultado según `refund.status`, gate de visibilidad por estado
  terminal. **Un defecto real encontrado por QA** (el mensaje de éxito nunca
  se veía — el gate de visibilidad se disparaba en el mismo render que debía
  mostrarlo) se corrigió en `PR #72` antes de este archive; ver
  `decisions.md` D24.

## Qué NO está vivo todavía

- **`createPreference`** del `PaymentConfirmationPort`/`MercadoPagoClient` (crear la
  preferencia, redirigir al comprador a Checkout Pro) — US-009, `Blocked` (sin
  credenciales reales de MercadoPago). Es lo único de esta capacidad que necesita la
  cuenta real: todo lo demás (webhook, medio simulado, jobs admin) se construyó y
  verificó con mocks.
- **Tabla `admins` formal** con FK real desde `payments.confirmed_by` — hoy
  es un string sin integridad referencial (soporta el caso bootstrap-token,
  que no tiene fila en `Customer`).
- **Disparo periódico real** de los 3 jobs admin — es una decisión de infraestructura
  (cron externo), no de código de aplicación; pendiente de su propio `/plan-deployment`.

## Qué verificó QA

Suite QA-owned (`US-010-orden-webhook-stock-qa`), continuación del contrato de
comportamiento persistente que `US-023-pago-manual-offline-backend` ya había construido
para el camino manual (`pago-manual.feature`/`pago-manual.contract.ts`/
`confirm-payment.js`) — ahora también para la superficie automática (webhook + medio
simulado + jobs admin):

- **Aceptación BDD** (Cucumber-js + supertest, `pago-webhook.feature`): 15/15 escenarios
  verdes (11 `SC-010-*` distintos, incluye Examples de 3 Esquemas) — cubre los 11 AC de
  US-010, con foco en negative-space (duplicado, firma inválida, stock insuficiente,
  cancelación automática, reconciliación/limpieza/reintento sin nada elegible). Regresión
  conjunta con `pago-manual.feature` (US-023): 25/25 (`@pagos and not @blocked`).
- **Contract testing**: 13/13 casos contra los 5 endpoints nuevos (`pago-webhook.contract.ts`)
  + 7/7 sin cambios sobre los 2 endpoints de US-023 (`pago-manual.contract.ts`) — ambos
  contra el contrato OpenAPI **vivo** de esta capacidad.
- **Performance (k6)**: `POST /v1/checkout/simulate-payment` — budget `p95 < 200ms`
  (heredado del `design.md` de backend §D12); medido **p95 4-15ms** en 3 corridas,
  150/150 checks.
- **E2E cross-stack (Playwright)**: 2/2 — loop completo checkout real → medio simulado →
  panel del dueño (reusa `OrdersList` de US-012); y la invariante de que una orden
  auto-cancelada por falta de stock nunca aparece accionable para el dueño.
- **Exploratorio**: 3 charters escritos (ventana de tolerancia de la firma, backlog de
  reconciliación, breaker durante retry-refunds) — ejecución queda como checklist humano.

**Hallazgos abiertos, con dueño QA (no bloquean esta capacidad)**:

| Hallazgo | Efecto | Diferido a |
|---|---|---|
| Sin cuenta sandbox de MercadoPago en este entorno (QA-010-F1), `AC-3` completo (pago rechazado real) queda bloqueado black-box — la mayoría de los 11 AC sí corren hoy vía el medio simulado (AC-9 estructural). | `SC-010-N2` marcado `@blocked` explícito, sin mock no autorizado. | Owner: PO/Infra — provisión de cuenta sandbox de MercadoPago. |
| `K6_VUS` (QA-010-F2) es una env var reservada por k6 que pisa `options.scenarios` en silencio — afecta también a los scripts ya archivados de US-023 (`confirm-payment.js`/`auth-login.js`), sin que nadie lo supiera hasta ahora. | El script nuevo de este change usa `SIMULATE_PAYMENT_VUS` para evitarlo; los scripts viejos no se tocaron. | Pase de saneamiento de los scripts k6 existentes — owner QA. |
| Charter exploratorio (QA-010-EXP-1) escrito pero no ejecutado. | Sin hallazgos todavía de esa vía. | Ejecución humana — owner QA. |

## Contratos

El contrato vivo de la superficie REST está en [`contracts/openapi.yaml`](contracts/openapi.yaml)
+ un archivo por endpoint bajo [`contracts/openapi/paths/`](contracts/openapi/paths/). Ocho
endpoints vivos:

| Endpoint | Métodos | AC | Auth |
|---|---|---|---|
| `/admin/orders/{orderId}/confirm-payment` | POST | AC-1, AC-3, AC-4, AC-5, AC-6 | JWT admin |
| `/admin/orders/pending-payment` | GET | AC-2 | JWT admin |
| `/webhooks/mercadopago` | POST | AC-1, AC-3, AC-5, AC-6, AC-7, AC-8 | Firma HMAC (`x-signature`) |
| `/checkout/simulate-payment` | POST | AC-9 | `order_token` (body) |
| `/admin/payments/reconcile` | POST | AC-10 | JWT admin |
| `/admin/orders/cleanup-abandoned` | POST | AC-11 | JWT admin |
| `/admin/payments/retry-refunds` | POST | AC-4 (durabilidad) | JWT admin |
| `/admin/orders/{id}/cancel` | POST | US-013 AC-1..AC-10 | JWT admin |

**Colisión de rutas con `ordenes` (US-012), resuelta del lado de US-012**:
ambos controllers comparten el prefijo `/admin/orders`. `OrdersController`
(capacidad `ordenes`) restringe su `:id` a forma UUID — sin esa restricción,
`GET/PATCH /admin/orders/:id` podría interceptar el literal
`/admin/orders/pending-payment` según el orden de registro de módulos. No
requiere ningún cambio de este lado; documentado en ambas capacidades para
quien toque cualquiera de los dos controllers.

## Changes que formaron esta capacidad

| Change | Disciplina | Aporte |
|---|---|---|
| [`US-023-pago-manual-offline-backend`](../../changes/archive/US-023-pago-manual-offline-backend/) | BE | `payments` (tabla nueva) + `stock/` (escritor único) + `PaymentConfirmationPort`/`ConfirmOrderService`, transacción cruzando 3 repositorios, 2 endpoints admin |
| [`US-010-orden-webhook-stock-backend`](../../changes/archive/US-010-orden-webhook-stock-backend/) | BE | Webhook de MercadoPago, medio simulado «DSM», `MercadoPagoClient`, 3 jobs admin (reconciliación/limpieza/reintento de reembolsos), `confirmed_at`/`cancelled_at`/`refund_pending` |
| [`US-010-orden-webhook-stock-qa`](../../changes/archive/US-010-orden-webhook-stock-qa/) | QA | Suite L1/L3: 15 aceptación BDD, 13 contract, 1 k6, 2 E2E de navegador, 3 charters. Continúa el contrato de comportamiento que US-023 QA (embebida en su propio backend) construyó para el camino manual |
| [`US-013-cancelacion-reembolso-backend`](../../changes/archive/US-013-cancelacion-reembolso-backend/) | BE | `POST /admin/orders/{id}/cancel` — cero migración, reusa `refund_pending`/`retry-refunds` de US-010 tal cual |
| [`US-013-cancelacion-reembolso-frontend-web`](../../changes/archive/US-013-cancelacion-reembolso-frontend-web/) | FE | Acción "Cancelar orden" en `OrderDetail.tsx`, reusa `ConfirmDialog`. Defecto real encontrado por QA (mensaje de éxito nunca se veía) corregido en `PR #72` antes de este archive |

Con esto, `disciplines: [BE, QA]` de US-010 queda completo — ambas disciplinas
archivadas. Sin disciplina FE propia — la UI de confirmación manual (si existe)
vive dentro de `US-012-panel-ordenes-dueno-frontend-web`
(`PendingPaymentsPanel.tsx`, componente separado del listado de
fulfillment), no como un change propio de esta capacidad.

QA de US-013 (suite cross-stack) se archiva en un PR separado inmediatamente
después de este — ver el índice (`docs/_index/openspec-changes.yaml`) para
su estado más reciente si esta tabla no se actualizó todavía.

## Estado de la provisión

Corre hoy en **entorno local** (`docker-compose`, Postgres). La provisión de
nube es US-019, igual que el resto del sistema.
