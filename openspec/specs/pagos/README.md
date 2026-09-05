# Capacidad: Pagos (CAP-4, camino manual/offline)

**Estado**: entregada parcialmente — sólo el adaptador **manual** del
`PaymentConfirmationPort`. MercadoPago (US-009) sigue `Blocked` (sin
credenciales); el webhook async (US-010) sigue sin planificar.

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

## Qué NO está vivo todavía

- **Adaptador MercadoPago** del `PaymentConfirmationPort` — US-009,
  `Blocked` (sin credenciales).
- **Webhook async de confirmación** (reconciliación, limpieza de
  `pending_payment` abandonadas) — US-010, sin planificar.
- **Medio de pago simulado «DSM»** (aprobación instantánea para demos/test)
  — no construido por este change; sigue siendo parte del alcance de
  US-009/US-010 según el PRD.
- **Reembolso automático por falta de stock** — fuera de alcance: si falta
  stock al confirmar, la confirmación se rechaza (409); nadie cobró
  automáticamente algo que haya que devolver.
- **Tabla `admins` formal** con FK real desde `payments.confirmed_by` — hoy
  es un string sin integridad referencial (soporta el caso bootstrap-token,
  que no tiene fila en `Customer`).

## Contratos

El contrato vivo de la superficie REST está en [`contracts/openapi.yaml`](contracts/openapi.yaml)
+ un archivo por endpoint bajo [`contracts/openapi/paths/`](contracts/openapi/paths/). Dos
endpoints vivos:

| Endpoint | Métodos | AC |
|---|---|---|
| `/admin/orders/{orderId}/confirm-payment` | POST | AC-1, AC-3, AC-4, AC-5, AC-6 |
| `/admin/orders/pending-payment` | GET | AC-2 |

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

Sin disciplinas FE/QA propias todavía — la UI de confirmación manual (si
existe) vive dentro de `US-012-panel-ordenes-dueno-frontend-web`
(`PendingPaymentsPanel.tsx`, componente separado del listado de
fulfillment), no como un change propio de esta capacidad.

## Estado de la provisión

Corre hoy en **entorno local** (`docker-compose`, Postgres). La provisión de
nube es US-019, igual que el resto del sistema.
