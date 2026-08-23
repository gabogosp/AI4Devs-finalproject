---
tracker-id: null
tracker-source: null
parent-us: US-010
discipline: backend
variant: null
language: es
---

# US-010 Backend — Webhook verificado, confirmación de orden y decremento atómico de stock

## Why

Es el **núcleo transaccional** del producto. Todo lo demás del loop admite un reintento
manual; esto no: una falla acá es **plata mal cobrada o stock inconsistente**, y las dos
se descubren tarde y se arreglan a mano.

El resto del loop ya está planificado y cada pieza dejó su enganche esperando esta US:
US-008 crea la orden en `pending_payment`, US-009 crea el intento de pago y —lo importante—
dejó un **`PaymentConfirmationPort` con un adaptador no-op** por el que hoy pasan tanto el
webhook real como el medio simulado, sin hacer nada. Este change es el que pone la
implementación real detrás de ese puerto. Ese diseño es lo que vuelve AC-9 («el simulado
pasa por el mismo camino») **estructural**: no hay un segundo camino de confirmación que
pueda divergir.

Lo que hace difícil esta US no es el camino feliz —una transacción con dos `UPDATE`— sino
que **todo el valor está en las condiciones adversas**, y son siete de los once AC:
webhooks duplicados, tardíos, fuera de orden o falsos; dos compradores peleando por la
última unidad; un pago aprobado que no se puede cumplir; un webhook que nunca llega; y
órdenes abandonadas que ensucian la cola del dueño.

Tres cosas que la US da por resueltas y no lo están:

**«Se disparan las notificaciones» (AC-2) no tiene a dónde dispararse.** Redis no está
aprovisionado —ADR-0012 y ADR-0014 ya enmendaron ADR-0004 dos veces, y US-004 lo encontró
una tercera— así que no hay cola. Este change define un `NotificationPort` con adaptador
de log y US-011 pone la implementación, exactamente como US-009 hizo con la confirmación.

**«Corre la reconciliación» y «corre el job de limpieza» (AC-10, AC-11) no tienen quién los
corra.** No hay `@nestjs/schedule` ni ningún planificador en `apps/api`. Se usa el patrón
de runner en proceso que ya establecieron US-005 y US-006, **más** endpoints admin para
disparar a mano — que es literalmente lo que el runbook del E2E §18.5 pide («job/endpoint
manual idempotente»).

**El puerto de MercadoPago sólo sabe crear preferencias.** US-009 declaró
`MercadoPagoClient` con un único método. Para verificar un pago (AC-7) y para reembolsar
(AC-4) hacen falta dos más. Este change **extiende** ese puerto, y con eso aparece la
capacidad de reembolso que **US-013 va a reusar** en vez de construir.

## What changes

**Esquema** — dos adiciones acotadas, ambas sobre tablas de otras US:

- `payments.status` gana **`refund_pending`** en su `CHECK` (hoy
  `pending|approved|rejected|refunded`, de US-009). Es lo que hace **durable** el reembolso
  de AC-4: si la llamada a MercadoPago falla, el intento no se pierde en memoria — queda una
  fila que un runner reintenta.
- `orders` gana **`confirmed_at`** y **`cancelled_at`**. La FSM del E2E §12 tiene seis
  estados y hoy sólo `delivered_at` está modelada; sin estas dos no se puede reconstruir
  cuándo se confirmó una venta (lo necesita US-016) ni distinguir una orden cancelada por
  abandono de una cancelada por falta de stock.

**Superficie HTTP** — tres endpoints, uno público y dos admin:

| Endpoint | Qué hace | AC |
|---|---|---|
| `POST /v1/webhooks/mercadopago` | Verifica la firma, **re-consulta el pago a MercadoPago** y, si está aprobado, confirma la orden y decrementa stock en una transacción. Idempotente. | AC-1, AC-3, AC-5, AC-6, AC-7, AC-8 |
| `POST /v1/admin/payments/reconcile` | Dispara la reconciliación a mano (el runbook del E2E §18.5 la pide así). | AC-10 |
| `POST /v1/admin/orders/cleanup-abandoned` | Dispara la limpieza de `pending_payment` vencidas. | AC-11 |

Los dos admin existen **además** del runner en proceso, no en su lugar: cuando algo se
atasca a las tres de la mañana, el operador necesita un botón, no esperar el próximo tick.

**Confianza cero en el payload** (AC-7): se valida la firma `x-signature` de MercadoPago
—HMAC sobre el manifiesto `id;request-id;ts`, con comparación en **tiempo constante** y
ventana de tolerancia sobre el `ts` para cortar replay— y después **se re-consulta el pago
a la API de MP**. La verdad del pago sale de esa consulta, nunca del cuerpo recibido. Un
cuerpo que dice `approved` sin firma válida se rechaza con 401 y **no toca stock**.

**Idempotencia por la base, no por un `if`** (AC-5, AC-6): dentro de **una** transacción,
`SELECT … FOR UPDATE` sobre la fila del pago y sólo la transición `pending → approved` hace
trabajo. Un webhook duplicado encuentra `approved` y corta; dos duplicados **concurrentes**
se serializan en el lock de la fila y el segundo también corta. `payments.external_id`
UNIQUE (de US-009) es la segunda red. No hay check-then-act: eso es precisamente lo que se
corre en una carrera.

**Decremento atómico sin locks de tabla** (AC-8):
`UPDATE products SET stock = stock - :q WHERE id = :id AND stock >= :q`, verificando que
afecte **exactamente una fila**. Si afecta cero, no hay stock y arranca la compensación. El
`CHECK (stock >= 0)` del esquema es la red de la base. Los ítems se recorren en **orden
determinista por `product_id`** para que dos órdenes que comparten productos no se
abracen en un deadlock.

**Compensación: cobrado y no se puede cumplir** (AC-4). La secuencia importa y está pensada
para que nada quede en el aire:

1. La transacción del decremento **revierte** (no queda stock a medias).
2. En una transacción nueva: orden → `cancelled` con `cancelled_at`, pago →
   `refund_pending`.
3. El reembolso se ejecuta **fuera** de toda transacción (es una llamada a un tercero: dejar
   una transacción abierta esperándola bloquearía filas durante segundos).
4. Si el reembolso falla, la fila queda en `refund_pending` y el runner la reintenta con
   backoff. **Nunca se pierde un reembolso por un error transitorio.**

**El puerto de MercadoPago se extiende** con `getPayment(id)` (la re-consulta de AC-7) y
`refund(paymentId, amount)` (AC-4), sobre el adaptador que US-009 ya construyó con timeout,
reintentos, jitter y circuit breaker. **No se crea un segundo cliente HTTP.**

**Dos puertos nuevos para lo que todavía no existe**: `NotificationPort` (AC-2 — US-011 lo
implementa) y el runner de trabajos periódicos en proceso, con el patrón de US-005/US-006.

**Observabilidad**: `OrderEventsService` con `order.confirmed`, `order.cancelled_no_stock`,
`payment.webhook_received`, `payment.webhook_rejected_signature`,
`payment.duplicate_ignored`, `stock.decrement_blocked`, `refund.enqueued`,
`refund.failed`, `reconcile.recovered`, `cleanup.cancelled`. Tres de estos son los que el
E2E §18 pide vigilar y los que dicen si el sistema está sano: los duplicados evitados, los
oversell bloqueados y los reembolsos que no salieron.

## ACs de US-010 cubiertos

| AC | Cubierto | Nota |
|---|---|---|
| AC-1 pago aprobado confirma y decrementa | ✅ | una transacción: idempotencia → decremento por ítem → `pending_payment → new` |
| AC-2 dispara notificaciones | ✅ (seam) | `NotificationPort` invocado con el payload final; la entrega del email es US-011. `Deferred: US-011` |
| AC-3 pago rechazado no confirma ni toca stock | ✅ | el pago pasa a `rejected`, la orden **queda** en `pending_payment` (el comprador puede reintentar, OQ-BE-2 de US-009), stock intacto |
| AC-4 aprobado sin stock → reembolso | ✅ | rollback → `cancelled` → `refund_pending` → reembolso con reintentos durables |
| AC-5 duplicado no decrementa dos veces | ✅ | `FOR UPDATE` + transición única, probado con webhooks **concurrentes** además de secuenciales |
| AC-6 tardío o fuera de orden | ✅ | el estado final depende del pago re-consultado, no del orden de llegada |
| AC-7 webhook no verificado se rechaza | ✅ | firma en tiempo constante + ventana de `ts` + **re-consulta**; 401 sin tocar nada |
| AC-8 el stock nunca queda negativo | ✅ | `UPDATE … WHERE stock >= q` + `CHECK`, probado con concurrencia real sobre la última unidad |
| AC-9 el simulado pasa por el mismo camino | ✅ **estructural** | US-009 ya invoca `PaymentConfirmationPort`; este change pone la implementación detrás. Un solo camino, no dos |
| AC-10 reconciliación del webhook faltante | ✅ | runner + endpoint admin; consulta a MP los pagos de órdenes `pending_payment` y los procesa por el **mismo** servicio idempotente |
| AC-11 limpieza de abandonadas | ✅ | runner + endpoint admin; `pending_payment` vencidas → `cancelled` |

## Out of scope

- **La entrega de los emails** — US-011. Acá se invoca el puerto.
  `Deferred: US-011 — owner: BE`
- **El panel de órdenes del dueño y las transiciones `new → preparing → ready → delivered`** —
  US-012. Este change escribe **sólo** `pending_payment → new` y `→ cancelled`.
  `Deferred: US-012 — owner: BE/FE`
- **Cancelación a pedido del dueño con reintegro de stock** — US-013. Este change construye
  la capacidad de **reembolso** (la necesita AC-4) y US-013 la reusa; lo que no construye es
  el **reintegro de stock**, que sólo aplica a una orden ya confirmada.
- **Iniciar el pago, crear la preferencia y el medio simulado** — US-009.
- **Métricas y gráficos** — US-016 (este change deja `confirmed_at`, que es su insumo).
- **Anonimización por retención** — US-021.
- **Tests de carga y E2E cross-service con Playwright** — `/plan-qa`. Sí van acá los tests
  de concurrencia y de idempotencia, que son dev-owned e irrenunciables.

## Standards consultados

| Standard | Secciones aplicadas |
|---|---|
| `base-standards.md` | §1 KISS (sin cola, sin reservas, sin máquina de estados genérica) |
| `backend-standards.md` | capas, errores tipados, transacciones, resiliencia |
| `backend-node-standards.md` | §2 capas · §3 DI por token · §4 DTO · **§5 `$transaction` + `$queryRaw` parametrizado + migración aditiva** · §6 errores de dominio · §7 config fail-fast + secretos · **§8 timeouts/reintentos/breaker en salientes + idempotencia** · §9 logs sin PII |
| `api-standards.md` | §3.2 status codes · **§10 idempotencia** · §8 RFC 7807 · webhooks |
| `security-standards.md` | **§2 STRIDE (la fila del webhook es la más crítica del E2E §14)** · §5 secretos · §6 validación · §7.1 headers |
| `observability-standards.md` | §9 sin PII (el webhook toca una orden con datos del comprador) |
| `testing-standards.md` / `qa-backend-standards.md` | §14 pirámide; tests de concurrencia con Postgres real |
| **ADR-0008** | decremento al aprobar el pago, `UPDATE` atómico + idempotencia — **gobierna todo el change** |
| ADR-0006 | webhook verificado + re-consulta; el simulado por el mismo camino |
| ADR-0012 / ADR-0014 | patrón en proceso mientras Redis no exista (cuarta instancia) |

## Preguntas abiertas

Ninguna bloquea el arranque; las tres primeras conviene mirarlas.

| Id | Pregunta | Default implementado (recomendado) | Si se decide distinto |
|---|---|---|---|
| **OQ-BE-1** | **Plazo de abandono** de una orden `pending_payment` (AC-11) | **48 h.** Cubre a quien deja el checkout abierto, vuelve al otro día y paga. Más corto cancela ventas reales; más largo ensucia la reconciliación | Con 24 h se limpia antes pero se pierde al comprador que paga al día siguiente. Nota: la preferencia de MercadoPago vence a las 24 h (OQ-BE-5 de US-009), así que 48 h deja una ventana donde la orden vive y el `init_point` ya no sirve — el comprador tiene que iniciar un intento nuevo, que US-009 permite |
| **OQ-BE-2** | ¿La reconciliación corre sola o sólo a pedido? | **Las dos**: runner cada 15 min + endpoint admin. El runner atrapa el webhook perdido sin que nadie mire; el endpoint es lo que el runbook necesita a las 3 AM | Sólo a pedido deja el hueco abierto hasta que alguien se dé cuenta — y el síntoma (una orden que el comprador pagó y el dueño no ve) llega como un reclamo, no como una alerta |
| **OQ-BE-3** | Un pago aprobado que **no se puede reembolsar** tras N reintentos | Queda en `refund_pending` **para siempre** + evento `refund.failed` + entrada de runbook. **No** se cancela el reintento solo: es plata de un cliente | Marcarlo como fallido definitivo y cerrar el caso oculta una deuda real con una persona |
| **OQ-BE-4** | ¿La orden rechazada vuelve a estar pagable? | **Sí**: queda en `pending_payment` y US-009 permite hasta 5 intentos | Cancelarla al primer rechazo mata la venta por un problema del banco |
| **OQ-BE-5** | Ventana de tolerancia del `ts` de la firma | **5 minutos** | Más amplia agranda la ventana de replay; más angosta rechaza webhooks legítimos con reloj desfasado |

## References

- User story: [`docs/user-stories/US-010-orden-webhook-stock.md`](../../../docs/user-stories/US-010-orden-webhook-stock.md)
- PRD: [`docs/product/prd.md`](../../../docs/product/prd.md) §2.1 capacidad 6, §3.1 (casos borde del loop), §4
- E2E: [`docs/product/design-e2e.md`](../../../docs/product/design-e2e.md) §6.1 (`PaymentsModule`/`OrdersModule`/`StockModule`), §8 (DER + `CHECK stock >= 0`), **§9.2 (la secuencia completa, incluida la rama de compensación)**, **§12 (FSM de orden)**, **§14 (STRIDE — el webhook es la superficie más crítica)**, §17, §18, **§18.5 (runbook: «reconciliar consultando estado a MP»)**, §19, §22 (riesgo de webhook perdido/duplicado)
- **ADR-0008** — decremento al aprobar el pago (**gobierna todo**), **ADR-0006** — webhook
  verificado + medio simulado, ADR-0012 / ADR-0014 — patrón en proceso
- Change del que depende: [`US-009-pago-mercadopago-backend`](../US-009-pago-mercadopago-backend/design.md)
  — de ahí salen `payments`, el `MercadoPagoClient` (que este change **extiende**) y el
  **`PaymentConfirmationPort`** cuyo no-op se reemplaza acá
- Changes relacionados: [`US-008-checkout-guest-backend`](../US-008-checkout-guest-backend/design.md)
  (crea `orders`), US-011 (notificaciones), US-012 (panel), US-013 (reusa el reembolso),
  US-016 (consume `confirmed_at`)
- Contratos draft: [`contracts/openapi/`](contracts/openapi/)
