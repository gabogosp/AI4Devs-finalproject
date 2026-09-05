# CAP-4 Pagos — Decisiones

Decisiones que gobiernan el estado vivo de la capacidad. Los ADR son la
fuente de verdad; acá se registra **cuál aplica a esta capacidad y por qué**.

## ADRs que aplican

| ADR | Decisión | Impacto en esta capacidad |
|---|---|---|
| [ADR-0008](../../../docs/architecture/decisions/) | El stock se descuenta al aprobarse el pago, sin reserva con TTL. | Gobierna todo este change: el decremento ocurre recién en `confirm()`, dentro de la misma transacción que la transición a `new`. |
| [ADR-0006](../../../docs/architecture/decisions/) | MercadoPago checkout hosted, sin datos de tarjeta en el propio sistema. | `payments` no guarda PAN/CVV/vencimiento/titular en ningún `provider`, incluido `manual`. |
| [ADR-0009](../../../docs/architecture/decisions/) | Seam de auth admin (`AdminGuard`, JWT `role=admin`). | Los 2 endpoints de esta capacidad son admin-only; `confirmed_by` se deriva decodificando (no re-verificando) el mismo bearer que el guard ya validó. |

Ninguna decisión de este change abre un ADR nuevo (verificado contra los ADR
vigentes y el E2E §20).

## Decisiones de implementación

| Id | Decisión | Fundamento |
|---|---|---|
| D1 | `PaymentConfirmationPort` + `ConfirmOrderService` en `src/payments/`, mismo nombre/lugar que `US-010-orden-webhook-stock-backend/design.md` §D9 ya había reservado sin construir. | Para que US-009/US-010 lo reusen sin renombrar cuando se planifiquen. |
| D2 | Módulos nuevos `stock/` y `payments/`, en vez de extender `checkout/orders.repository.ts`. | `checkout/ac6-stock-untouched.spec.ts` (US-008 T5.1) escanea estáticamente `checkout/` y falla ante cualquier escritura de stock ahí — descarta la opción "extender el repository existente". |
| D3 | `payments.provider` agrega `'manual'` al enum del DER (que sólo tenía `mercadopago`\|`simulated_dsm`) + columna `confirmed_by` sin FK. | Deviación declarada del DER (E2E §8) — sin esto no hay forma de registrar quién confirmó un pago sin tercero. |
| D4 | El `CHECK` de `provider` ya incluye los tres valores (`mercadopago`\|`simulated_dsm`\|`manual`) aunque este change sólo escribe `'manual'`. | Reconciliación con `US-009-pago-mercadopago-backend/design.md` §Persistencia (planificado, sin construir): evita que la futura migración aditiva de US-009 tenga que tocar el constraint. |
| D5 | `idempotency_key` determinístico: `manual:{orderId}`. | Reusa el patrón UNIQUE que el DER ya declaraba para `payments`, sin inventar un segundo mecanismo de idempotencia. |
| D6 | Identidad del confirmador vía decodificación del JWT en el controller (`jwt.decode`), no extendiendo `AdminGuard` para adjuntar `req.admin`. | `AdminGuard`/`admin-auth.service.ts` está congelado por un `git diff --exit-code` de US-014 contra la base de su rama — tocarlo rompería ese contrato. Decodificar (no re-verificar, el guard ya lo hizo) es una operación local sin costo de red. |
| D7 | `GET /pending-payment` sin paginación. | Volumen esperado: unidades de órdenes pendientes por día, un solo local (MVP). |
| D8 | `GET /pending-payment` **convive** con `GET /admin/orders` de US-012, no se unifican. | Decisión coordinada 2026-08-30 con quien planificó `US-012-panel-ordenes-dueno-backend`/`-frontend-web`: el listado general de US-012 sigue excluyendo `pending_payment` siempre (su AC-8 intacto); el FE de US-012 consume este endpoint en un componente separado (`PendingPaymentsPanel.tsx`). |
| D9 | Transacción Prisma cruzando tres repositorios (`orders`, `stock`, `payments`) — primera vez en el repo. | La alternativa (cada repository sin transacción compartida) rompe la atomicidad que ADR-0008 exige: una orden `new` con stock sin decrementar (o viceversa) es un bug de integridad de datos, no un detalle cosmético. |

## Colisión de rutas con `ordenes` (US-012)

`PaymentConfirmationController` (esta capacidad) y `OrdersController`
(capacidad `ordenes`, US-012) comparten el prefijo `@Controller('v1/admin/orders')`.
Sin restricción de forma, `GET/PATCH /admin/orders/:id` de US-012 podría
interceptar el literal `/admin/orders/pending-payment` de esta capacidad
según el orden de registro de módulos (Express/Nest matchean por orden, no
por especificidad). **Resuelto del lado de US-012**: su `:id` está
restringido a forma UUID (regex de `path-to-regexp`), lo que hace que el
orden de registro deje de importar. No requiere ningún cambio de este lado;
documentado en ambas capacidades.

## Desviaciones conscientes registradas

| Desviación | Motivo |
|---|---|
| `payments.provider` incluye `'manual'`, ausente del DER original (E2E §8, que sólo tenía `mercadopago`\|`simulated_dsm`). | Documentada en `design.md` del change archivado — necesaria para que exista un tercer camino de pago sin tercero. |
| `payments.confirmed_by` sin FK a `customers`. | Soporta el caso bootstrap-token (sesión admin sin fila en `Customer`); un FK real lo rechazaría. Trade-off consciente, revisitable si se introduce una tabla `admins` formal (ver requirements.md D-6). |
| `payments.created_at`/`updated_at` agregadas, ausentes del DER. | Convención universal del esquema (`Order`/`Product`/`Customer` ya las tienen); `US-009-pago-mercadopago-backend/design.md` §Persistencia ya las pide para su propio caso (auditar intentos `pending` sin resolver). |
