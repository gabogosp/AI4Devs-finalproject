---
tracker-id: null
tracker-source: null
parent-us: US-023
discipline: backend
variant: null
language: es
---

# US-023 Backend — Design

## Context

Nada de lo que este change toca existe todavía en código: `payments` no está
migrada, ningún archivo escribe `products.stock`, y `PaymentConfirmationPort`
sólo existe como nombre en el `design.md` (sin construir) de US-009. Este
document diseña **la primera implementación real** de esos tres elementos,
siguiendo — no inventando — la arquitectura que US-010 ya bosquejó en su
propio `design.md` §D9 (que tampoco se construyó): módulos separados
`orders/` / `stock/` / `payments/`, dirección de dependencias acíclica
`payments → orders`, `payments → stock`.

La razón por la que hay que ser cuidadoso acá y no simplemente "agregar un
endpoint": `checkout/ac6-stock-untouched.spec.ts` (T5.1 de US-008) es un test
que escanea estáticamente cada archivo no-spec de `apps/api/src/checkout/` y
falla si encuentra una línea con "stock" + una palabra de escritura. Cualquier
diseño que meta el decremento de stock adentro de `checkout/` — aunque sea en
un método nuevo de `OrdersRepository` — rompe ese test. Eso descarta la opción
más simple ("extender el repository que ya existe") y obliga a los dos módulos
nuevos.

## Goals

- Construir `PaymentConfirmationPort` + su primer adaptador (`manual`) de
  forma que **US-010 pueda reusarlo** para el webhook de MercadoPago sin
  reescribirlo — mismo lugar (`src/payments/`), misma forma de invocación.
- Que la orden llegue a `new` **de verdad**: pago + transición de estado +
  decremento de stock atómico, los tres en una sola transacción (E2E §12: "pago
  aprobado + stock decrementado OK", ADR-0008).
- Idempotencia sin inventar un mecanismo nuevo: reusar el patrón de
  `idempotency_key` UNIQUE que el DER ya declaraba para `payments`.
- Entregar el requisito de lectura que la futura US-012 necesita (AC-2) sin
  construir el listado completo de US-012.

## Non-goals

- No se construye `PaymentConfirmationPort` para MercadoPago (`provider:
  mercadopago|simulated_dsm`) — eso es US-009/US-010 cuando se planifiquen. Este
  change sólo implementa el adaptador `manual`.
- No se mueve `OrdersRepository` a un módulo `orders/` dedicado (el layout
  completo de US-010 §D9). Se extiende el archivo existente en `checkout/`
  — mover el módulo es una decisión que le corresponde a quien planifique
  US-010, que sí necesita más superficie de `orders` (webhook, reconciliación,
  limpieza).
- No se construye el panel de órdenes (US-012) ni su listado general
  paginado/filtrable — sólo el endpoint mínimo de AC-2.
- No hay reembolso automático por falta de stock (US-010 AC-4 es específica
  del webhook async, donde el comprador ya pagó a un tercero). Acá, si falta
  stock al confirmar, la confirmación se rechaza (409) — nadie cobró
  automáticamente algo que haya que devolver.

## Approach

### Módulos nuevos

```
apps/api/src/stock/
├── stock.module.ts
├── stock.repository.ts        ← único punto de ORM que escribe products.stock
└── stock-errors.ts            ← InsufficientStockError (409)

apps/api/src/payments/
├── payments.module.ts
├── payment-confirmation.port.ts   ← interfaz (US-023 la posee, US §10)
├── confirm-order.service.ts       ← implementa el puerto — mismo nombre que
│                                      US-010 design.md §D9 ya reservó, para
│                                      que esa US lo extienda sin renombrar
├── payments.repository.ts         ← único punto de ORM que escribe `payments`
├── payment-confirmation-errors.ts ← OrderNotPendingPaymentError (409)
└── payment-confirmation.controller.ts   ← admin, dos rutas (confirmar + listar)
```

`checkout.module.ts` agrega `exports: [OrdersRepository]` (hoy sólo la
provee). `PaymentsModule` importa `CheckoutModule` para inyectar
`OrdersRepository`, y `StockModule` para inyectar `StockRepository` — sin
`forwardRef`, dirección acíclica igual que US-010 §D9 planificó.

### `PaymentConfirmationPort`

```typescript
export interface ConfirmPaymentInput {
  orderId: string;
  provider: 'manual'; // US-010 amplía a 'mercadopago' | 'simulated_dsm'
  confirmedBy: string; // el `sub` del JWT admin — ver más abajo
}

export interface ConfirmedPayment {
  orderId: string;
  orderNumber: number;
  status: 'new';
  paymentId: string;
}

export interface PaymentConfirmationPort {
  confirm(input: ConfirmPaymentInput): Promise<ConfirmedPayment>;
}
```

`ConfirmOrderService implements PaymentConfirmationPort`. Un único método
`confirm()`, orquestando dentro de **una** transacción Prisma (`prisma.$transaction`):

1. `orders.transitionToNewIfPending(orderId, tx)` — `UPDATE orders SET
   status='new' WHERE id=:id AND status='pending_payment'`, devuelve la orden
   actualizada + sus líneas, o `null` si 0 filas afectadas.
   - `null` → `throw OrderNotPendingPaymentError(currentStatus)`. Cubre **AC-4
     y AC-5 con el mismo camino**: no importa si la orden ya está `new`,
     `cancelled`, o cualquier otro estado — el resultado observable que pide
     el AC es el mismo ("no cambia nada, el sistema lo rechaza").
2. `stock.decrementForOrder(order.items, tx)` — por cada línea, `UPDATE
   products SET stock = stock - :qty WHERE id=:id AND stock >= :qty`
   (ADR-0008, mismo patrón que ya usa `cart-view.ts` para **leer**
   disponibilidad, ahora por primera vez para **escribir**). Si alguna línea
   afecta 0 filas → `throw InsufficientStockError(productId)`. Al estar
   dentro de la misma transacción que el paso 1, la orden **no** queda en
   `new` si el stock no alcanza — la transacción entera revierte.
3. `payments.create({ orderId, provider: 'manual', status: 'approved',
   externalId: null, amountArsCents: order.totalArsCents, idempotencyKey:
   \`manual:${orderId}\`, processedAt: now, confirmedBy }, tx)`. Un P2002 acá
   (constraint `idempotency_key` UNIQUE) es la misma condición que el paso 1
   ya debería haber atajado — se mapea al mismo `OrderNotPendingPaymentError`
   como defensa en profundidad, no como camino principal.

Los tres repositorios exponen sus métodos con un parámetro `tx` opcional
(`Prisma.TransactionClient`, default `this.prisma`) — **primera vez en el
repo que una transacción cruza repositorios**; hasta ahora cada
`$transaction` era interno a un solo repository (`OrdersRepository.createPendingOrder`,
`CartsRepository.upsertItemAndTouch`). Se documenta acá porque es un patrón
nuevo, no una convención ya probada.

### Identidad del que confirma, sin tocar `AdminGuard`

`AdminGuard` (`auth/admin.guard.ts`) verifica el JWT y no adjunta el payload a
`req` — y **no se puede tocar**: US-014 tiene un `git diff --exit-code` sobre
ese archivo contra la base de la rama (comentario en el propio archivo,
`admin-auth.service.ts`). `PaymentConfirmationController` inyecta `JwtService`
(vía `AuthModule`, que ya lo exporta) y **decodifica** (no re-verifica — el
guard ya lo hizo) el mismo bearer token para leer `sub`:

```typescript
private confirmedByFrom(req: Request): string {
  const token = req.headers.authorization!.slice('Bearer '.length);
  const { sub } = this.jwt.decode(token) as { sub: string };
  return sub; // uuid de Customer (role=admin) o el literal 'admin' (bootstrap)
}
```

Alternativa descartada: extender `AdminGuard` para adjuntar `req.admin`.
Rompería el `git diff --exit-code` de US-014 contra un archivo que esa US
declara explícitamente congelado — el costo de una decodificación extra
(operación local, sin red, ya verificada por el guard) es menor que romper un
contrato de otra US en curso.

### Endpoints

**`POST /v1/admin/orders/{orderId}/confirm-payment`** — `AdminGuard`, sin
throttler dedicado (mismo criterio que `ProductsController`/`CategoriesController`:
superficie admin de bajo volumen, un solo operador). Sin body — todo lo que
necesita sale del path param + el JWT. Responde `200` con
`{ order_number, status: "new" }` en éxito; `404` si la orden no existe; `409`
`dsm:payments/order-not-pending-payment` si no está `pending_payment`
(AC-4/AC-5 unificados); `409` `dsm:payments/insufficient-stock` si algún ítem
se quedó sin stock entre el checkout y la confirmación.

**`GET /v1/admin/orders/pending-payment`** — `AdminGuard`, sin paginación
(volumen esperado: unidades por día, MVP de un solo local — ver Trade-offs).
Responde `200` con un array de `{ id, order_number, buyer_name,
total_ars_cents, created_at }` — lo mínimo para que el dueño identifique y
accione, **sin** `buyer_email`/`buyer_phone` en la lista (I de STRIDE — el
detalle completo, si hace falta, es responsabilidad de un endpoint de detalle
que ya no es parte de esta US). **`id` es obligatorio**: es el UUID que
`POST /confirm-payment` espera en el path (`ConfirmOrderService` resuelve por
`WHERE id = :id`, no por `order_number`) — sin él, ningún consumidor puede
construir la URL del `POST` a partir de este listado (hallazgo del
co-desarrollo con `US-012-panel-ordenes-dueno-frontend-web`, 2026-08-30).

## Persistence

### Schema delta

**Tabla nueva**: `payments` (PostgreSQL, Neon — baseline factory-equivalente
per ADR-0001). Declarada en `docs/product/design-e2e.md` §8 DER pero nunca
migrada — este change es su primera materialización.

| Columna | Tipo | Constraints | Origen |
|---|---|---|---|
| `id` | uuid | PK, default `gen_random_uuid()` | E2E §8 DER |
| `order_id` | uuid | FK → `orders.id`, NOT NULL | E2E §8 DER |
| `provider` | string | NOT NULL, CHECK IN (`mercadopago`, `simulated_dsm`, `manual`) | E2E §8 DER + **deviación US-023** |
| `external_id` | string | nullable | E2E §8 DER — null si `provider='manual'` |
| `status` | string | NOT NULL, CHECK IN (`pending`, `approved`, `rejected`, `refunded`) | E2E §8 DER |
| `amount_ars_cents` | int | NOT NULL | E2E §8 DER |
| `idempotency_key` | string | UNIQUE, NOT NULL | E2E §8 DER |
| `processed_at` | timestamp | nullable | E2E §8 DER |
| `confirmed_by` | string | nullable, **sin FK** | **adición US-023** |
| `created_at` | timestamp | default `now()` | convención universal del esquema (`Order`/`Product`/`Customer` la tienen) |
| `updated_at` | timestamp | default `now()`, `@updatedAt` | idem — **no** está en el DER, pero tampoco lo estaba en `orders`/`products` originalmente y se agregó por consistencia; US-009 §Persistencia ya la pide para su propio caso (auditar intentos `pending` sin resolver) |

**Reconciliación con `US-009-pago-mercadopago-backend/design.md` §Persistencia
(planificado, sin construir)**: ese change ya declaró, para esta misma tabla,
tres columnas propias de MercadoPago (`preference_id`, `init_point`) y una
deviación de cardinalidad (`ORDERS ||--o{ PAYMENTS`, 0..N intentos con **a lo
sumo un** `pending` vía un índice único parcial). Ninguna de las dos cosas se
construye acá — son irrelevantes para el flujo manual, que siempre inserta
directo en `status='approved'`, nunca en `'pending'` — pero el `CHECK` de
`provider` de esta migración **ya incluye** `'mercadopago'` y `'simulated_dsm'`
junto con `'manual'` (los tres valores que el DER + US-009 declaran), para que
la migración aditiva de US-009 no tenga que tocar ese constraint cuando
llegue. Sin este cuidado, la primera inserción con `provider='mercadopago'`
violaría un CHECK escrito sólo para `'manual'`.

**`confirmed_by` sin FK, a propósito**: guarda el claim `sub` del JWT admin —
un uuid de `customers.id` (sesión de admin registrado) o el literal `'admin'`
(sesión de bootstrap token, que no tiene fila en `Customer`). Un FK a
`customers` rechazaría el caso de bootstrap. Sólo se completa si
`provider='manual'`.

**Índices**: `idx_payments_external_id` (E2E §8 DER), `idx_payments_order_id`
(nuevo — Postgres no indexa FKs automáticamente), `uq_payments_idempotency_key`
UNIQUE (E2E §8 DER, ya declarado como UK).

**Constraints**: `fk_payments_order` (`order_id` → `orders.id`),
`chk_payments_provider`, `chk_payments_status` — a nivel DB (no sólo
validación de aplicación), mismo criterio de defensa en profundidad que
`products.stock CHECK (stock >= 0)` de ADR-0008.

### Guard de idempotencia (AC-5)

`idempotency_key` del flujo manual es determinístico: `manual:{orderId}`. La
constraint UNIQUE hace que un mismo pedido produzca **como máximo una** fila
`provider='manual'` — un doble click o un reintento de red pega contra
`23505`/`P2002` en el segundo intento. Mismo mecanismo que ya prueba
`external_id` UNIQUE para MercadoPago (ADR-0008): un solo patrón, no dos.

### Frontera transaccional

Una única transacción Prisma hace las tres escrituras del §Approach (orden →
`new` guardado por `WHERE status`, stock decrementado por línea guardado por
`WHERE stock >= qty`, alta de `payments`). Ninguna vive en `checkout/` —
`ac6-stock-untouched.spec.ts` lo prohíbe para el stock, y `orders.repository.ts`
sigue siendo el único ORM de `orders`/`order_items` por convención local (sin
test automatizado que lo pruebe hoy — a diferencia del de stock, que si lo
tiene; ver Trade-offs).

### Retención

`payments` hereda la postura de retención de `orders` (E2E §8: job mensual que
purga/anonimiza órdenes > 12 meses). Es la primera tabla que cuelga de
`orders` por FK desde que ese job se escribió — abierto como pregunta (ver
más abajo): ¿el job ya cascadea a tablas hijas, o hay que extenderlo?

### Compliance (PCI)

Sin expansión de alcance PCI: la fila no guarda PAN/CVV/vencimiento/titular —
consistente con la postura fuera-de-PCI-DSS de ADR-0006. `confirmed_by` es un
claim de identidad interna, no un dato de instrumento de pago.

### Alternativas consideradas

1. **Elegida**: extender `payments.provider` con `'manual'` + agregar
   `confirmed_by`. Reusa el ledger de pagos único que el sistema ya tiene
   planificado, un solo path de escritura y de lectura.
2. **Tabla separada `manual_payments`** — descartada. Fragmenta la fuente de
   verdad de pagos en dos tablas y rompe el patrón único de idempotencia por
   `idempotency_key`.
3. **Sin fila de `payments`, sólo transición de `orders.status`** — descartada.
   Pierde el registro de auditoría por pago (`confirmed_by`, `processed_at`,
   `amount_ars_cents`) y, más grave, pierde el guard de idempotencia con el
   que cuenta AC-5 — una transición de estado sola no tiene defensa nativa
   contra el doble click sin inventar un mecanismo nuevo.

## Threat model — Superficie 6 (admin), lite per skill `threat-modeling-lite`

| Threat | Vector específico | Control |
|---|---|---|
| Spoofing | JWT admin robado confirma pagos que no pasaron | `AdminGuard` (JWT `role=admin`, ADR-0009); igual exposición que cualquier otro endpoint `/v1/admin/*` ya en producción — sin control nuevo, hereda el existente |
| Tampering | Ninguno — el endpoint no acepta body; nada que el cliente pueda mentir sobre el monto o el `provider` (ambos se derivan server-side de la orden) | N/A por diseño: sin campos editables por el cliente |
| Repudiation | El dueño niega haber confirmado un pago | `payments.confirmed_by` + `processed_at` — auditoría por fila, sin log adicional necesario (AC-6) |
| Info disclosure | `GET /pending-payment` expone datos del comprador a quien tenga el JWT admin | Lista deliberadamente angosta: `buyer_name` (necesario para identificar), sin email/teléfono — igual criterio que el panel de US-012 (E2E, "mínimo necesario") |
| DoS | Flood del `POST /confirm-payment` | Sin throttler dedicado (mismo criterio que `ProductsController` — superficie de bajo volumen, un operador); la transacción es corta (sin llamadas externas adentro) |
| Elevation of privilege | Rol no-admin confirmando pagos | `AdminGuard`, sin rol intermedio en este proyecto (single-tenant, un solo `role=admin`) |

## Resilience

- La transacción no hace llamadas externas (a diferencia del webhook de MP,
  que va a re-consultar a MercadoPago) — no hay timeout/retry/circuit-breaker
  que planificar acá; el único riesgo es contención de fila bajo concurrencia,
  cubierto por el `WHERE` guardado (ver Approach).
- Falla de red del cliente entre el click y la respuesta: el dueño reintenta,
  el `idempotency_key` UNIQUE hace que el reintento sea un no-op observable
  (409 "ya confirmada"), nunca un doble descuento de stock.

## Observability

- Evento `payments.manual_confirmed` (nuevo `PaymentEventsService`, mismo
  patrón que `CheckoutEventsService`: delega el contador en `MetricsService`,
  nunca PII en la firma — sólo `orderId` al log, jamás como label de métrica).
- Evento `payments.manual_confirm_rejected` con motivo (`not-pending-payment`
  | `insufficient-stock`) — para poder medir cuántas confirmaciones fallan y
  por qué sin tener que leer logs uno por uno.
- Sin evento nuevo de negocio para `GET /pending-payment` (lectura pura, sin
  side-effects que valga la pena contar).

## Trade-offs

**`orders.repository.ts` sigue sin test que blinde "único escritor"** — a
diferencia de `ac6-stock-untouched.spec.ts` para stock, la convención de que
sólo ese archivo llama `prisma.order`/`prisma.orderItem` vive en un comentario
del propio archivo, no en un test automatizado. Este change la respeta
(extiende el archivo existente, no agrega un segundo escritor), pero no cierra
la deuda de blindarla con un test — eso queda fuera de alcance porque no es
parte de ninguna AC de US-023 y tocaría código de US-008 ya shippeado sin
necesidad funcional de esta US.

**`GET /pending-payment` sin paginación** — el volumen esperado (un local,
unidades de órdenes pendientes por día mientras no hay MercadoPago) no lo
justifica. **Decisión ya tomada (2026-08-30, coordinada con quien planificó
US-012-panel-ordenes-dueno-backend/-frontend-web)**: este endpoint **convive**
con `GET /v1/admin/orders` de US-012 — no se unifica. `GET /v1/admin/orders`
sigue excluyendo `pending_payment` siempre (su AC-8, intacto); el FE de US-012
consume este endpoint + `POST /confirm-payment` en un componente separado del
listado de fulfillment, no dentro del filtro general.

**Colisión de rutas resuelta del lado de US-012**: `PaymentConfirmationController`
(este change) y `OrdersController` (US-012-backend) comparten el prefix
`@Controller('v1/admin/orders')`. Sin restricción de forma, `GET/PATCH
/v1/admin/orders/:id` de US-012 podría interceptar el literal
`/v1/admin/orders/pending-payment` de este change según el orden de registro
de módulos (Express/Nest matchean por orden, no por especificidad). US-012 lo
resuelve restringiendo su `:id` a forma UUID (regex de `path-to-regexp`), lo
que hace que el orden de registro deje de importar — **no requiere ningún
cambio de este lado**. Documentado acá para que quien toque cualquiera de los
dos controllers en el futuro sepa por qué el `:id` de US-012 lleva esa
restricción.

**Transacción cruzando tres repositorios (primera vez en el repo)** — la
alternativa (que `ConfirmOrderService` llame a cada repository sin transacción
compartida) es más simple de escribir pero rompe la atomicidad que ADR-0008
exige. Se acepta la complejidad del parámetro `tx` opcional en cada método
porque la alternativa es una orden `new` con stock sin decrementar, o
viceversa — un bug de integridad de datos, no un detalle cosmético.

## Deployment considerations

**Se recomienda `/plan-deployment US-023`**: hay migración de schema (tabla
nueva, aditiva — bajo riesgo) y es la primera vez que se toca `products.stock`
en producción. Gate de release sugerido: confirmar en staging que una orden
`pending_payment` real (creada por el checkout) se puede confirmar
manualmente de punta a punta y que el stock decrementado coincide
exactamente con las líneas de la orden.

Sin secretos nuevos, sin variables de entorno nuevas, sin URL pública nueva
(superficie admin ya autenticada existente). Rollback: la migración es
aditiva y se puede dejar — revertir el código deja `payments` como tabla sin
uso, sin romper nada existente.

## Open questions

1. **¿El E2E §8 DER debería actualizarse** para incluir `'manual'` en
   `payments.provider` y la columna `confirmed_by`? No alcanza el umbral de
   ADR (cambio aditivo de una sola tabla, reversible, sin contrato
   cross-servicio, sin dependencia nueva) — se recomienda una actualización de
   doc del E2E, no un ADR nuevo. — **Owner**: `tech-architect` (dueño del
   documento E2E). **[Deferred: no bloquea el arranque de este change — el
   `design.md` de acá es la fuente de la decisión mientras tanto — owner:
   tech-architect, revisit: próxima vez que se toque design-e2e.md §8]**
2. **¿El job mensual de retención/anonimización de `orders` (E2E §8) ya
   cascadea a tablas hijas, o necesita extenderse explícitamente para incluir
   `payments`?** Es la primera tabla que cuelga de `orders` por FK desde que
   ese job se escribió. — **Owner**: quien planifique el siguiente touch de
   ese job (candidato: cuando se audite retención). **[Deferred: no es
   AC de US-023 — owner: backend-developer del próximo change que toque
   retention, revisit: antes de que `payments` acumule 12 meses de filas]**
3. **`confirmed_by` sin integridad referencial** — ¿se planea una tabla
   `admins` formal a futuro que permitiría convertir esta columna en FK real?
   Si no, confirmar que el tipado laxo es un trade-off aceptado permanente. —
   **Owner**: Arquitecto/Producto. **[Deferred: no bloquea — owner:
   tech-architect, revisit: si se introduce una US de gestión de
   administradores]**

## Spec delta (para `/archive-change`)

Este change inaugura `openspec/specs/pagos/` (capacidad nueva: la primera
implementación real de confirmación de pago) con `requirements.md` (el
`PaymentConfirmationPort` + su adaptador manual) y `decisions.md` (la
deviación del DER declarada acá). No modifica `openspec/specs/checkout/`
(sólo agrega un export a `CheckoutModule`, sin cambiar su contrato público).

## References

- User Story: `docs/user-stories/US-023-pago-manual-offline.md`
- E2E: `docs/product/design-e2e.md` §8 (DER), §12 (FSM), §14 (STRIDE base)
- ADR-0006 (fuera de alcance PCI), ADR-0008 (decremento de stock al aprobar el
  pago — gobierna todo este change), ADR-0009 (seam de auth admin)
- Changes relacionados (planificados, sin construir): `../US-009-pago-mercadopago-backend/design.md`,
  `../US-010-orden-webhook-stock-backend/design.md` §D9 (layout de módulos
  que este change sigue)
- Código existente citado: `apps/api/src/checkout/orders.repository.ts`,
  `apps/api/src/checkout/ac6-stock-untouched.spec.ts`,
  `apps/api/src/auth/admin.guard.ts`, `apps/api/src/auth/admin-auth.service.ts`,
  `apps/api/src/cart/cart-view.ts` (patrón de lectura de disponibilidad),
  `apps/api/src/common/prisma-errors.ts`
- Standards: `backend-node-standards.md` §2–§9, `api-standards.md` §3, §8,
  `security-standards.md` §7, `observability-standards.md` §9,
  `testing-standards.md` §14
- Skills: `data-architecture-patterns`, `threat-modeling-lite`,
  `api-contract-completeness`, `nfr-quantification`, `observability-patterns`
