---
tracker-id: null
tracker-source: null
parent-us: US-015
discipline: backend
variant: null
language: es
archived: true
archived_at: 2026-09-06
merged_commit: 9d2d754fbe65efc8ab1ccf9f29ce05cad98dc47c
pr-url: https://github.com/gabogosp/AI4Devs-finalproject/pull/70
---

> **Nota de archivo (2026-09-06)**: mergeado vía PR #70. El contrato publicado
> (`apps/api/docs/api/openapi.yaml`) se completó en un follow-up dedicado,
> PR #71 (`fix/US-015-publish-order-history-contract`) — el `tasks.md` de
> este change (T6.1) sólo verificaba el lint de los 2 yaml draft, no su
> merge al spec del servicio. Crea la capacidad `openspec/specs/historial-compras/`
> (CAP-8), primera vez que se entrega.

# US-015 Backend — Historial de compras del cliente registrado

## Why

El PRD §2.1 cap. 8 pide dar continuidad a la relación con el cliente registrado
dejándolo consultar qué compró y en qué estado está cada pedido — el refuerzo de
valor de haberse registrado (US-014). La US original (§7) presupuestaba esto como
un trabajo de **sólo lectura**: dos endpoints sobre `orders`/`order_items`, que ya
existen desde `US-008-checkout-guest-backend`.

Al verificar el código real antes de planificar aparece un gap que la US, tal
como está escrita, no puede resolver sola: `orders.customer_id` existe en el
schema desde el DER del E2E §8, pero **no tiene escritor**. El propio comentario
del modelo `Order` en `packages/db/prisma/schema.prisma` lo deja dicho:
`customer_id` «queda SIN ESCRITOR en esta US (fusión invitado↔cuenta diferida a
US-015)». `apps/api/src/checkout/` es hoy 100% guest — cero referencias a
`customer`/`customerId` en código no-spec. Sin un escritor, el historial de esta
US listaría **siempre cero órdenes** para cualquier cliente, sin importar cuántas
veces haya comprado logueado: el AC-1 sería estructuralmente inverificable.

**Decisión del PO (2026-09-06)**: este change amplía su alcance para construir
también ese escritor. El checkout pasa a resolver la sesión del cliente **si
existe** (mismo mecanismo de cookie/JWT que `US-014-registro-login-backend`
construyó para `CustomerGuard`) y, sólo si hay una sesión válida, setea
`orders.customer_id` al crear la orden. Sin sesión, el checkout sigue
funcionando exactamente igual que hoy — aditivo puro sobre `checkout/`, cero
cambios de comportamiento observable para el invitado (AC de
`US-008-checkout-guest-backend` intactos, verificados por la suite existente sin
modificar una sola aserción, ver `design.md` §Approach).

AC-6 es la guarda que gobierna todo el diseño: la vinculación es **sólo** para
checkouts nuevos hechos con sesión activa — nunca retroactiva sobre órdenes
guest ya existentes con el mismo email (decisión de privacidad ya tomada por la
US, no se reabre).

## What changes

**Lado escritura — el gap de US-008 (ampliación de alcance)**

- `resolveCustomerSession()` (nuevo, `auth/`) — extrae (Extract Method) la
  verificación de JWT/cookie que hoy vive dentro de `CustomerGuard`, para que
  ninguna otra pieza la reimplemente. Nunca lanza: cualquier motivo de rechazo
  colapsa a `null`.
- `CustomerGuard` (existente, fail-closed) se refactoriza para llamar a ese
  helper — comportamiento 100% preservado, `customer-guard.spec.ts` verde sin
  tocar una sola aserción.
- `OptionalCustomerGuard` (nuevo) — mismo helper, pero **nunca** bloquea: si hay
  sesión válida, deja `req.customerId`; si no, sigue sin ella. Se cuelga en
  `POST /v1/checkout` junto a `CartCsrfGuard` existente.
- `CheckoutService.createOrder` lee `req.customerId` (si el guard opcional lo
  resolvió) y lo pasa a `OrdersRepository.createPendingOrder`, que ahora acepta
  `customerId?: string` y lo escribe en la misma transacción que ya existe (sin
  transacción nueva, sin migración de escritura nueva: la columna y su FK/índice
  ya existen).
- La respuesta pública de `POST /v1/checkout` **no cambia** — `customer_id`
  nunca sale a la red, ni siquiera al propio dueño de la sesión (misma regla que
  ya rige `order_token`/`order_number` vs. el UUID interno).

**Lado lectura — lo que la US pedía originalmente**

- `GET /v1/me/orders` — listado paginado (offset/limit) de las órdenes propias
  del cliente autenticado, ordenado `-created_at` (AC-1), dentro de la ventana
  de retención vigente (AC-7, 12 meses PRD §6 — mismo cálculo que
  `OrdersRetentionService`, extraído a un helper compartido). Excluye
  `pending_payment` (checkout iniciado pero nunca pagado no es una "compra").
- `GET /v1/me/orders/{order_number}` — detalle con ítems, cantidades, precios,
  estado y `fulfillment` (retiro en sucursal) (AC-2). Identificador público es
  `order_number` (entero legible), nunca el UUID interno — misma convención que
  `CheckoutResponseDto`.
- Autorización server-side en el WHERE de la consulta, no como chequeo posterior
  a la lectura: `customer_id = req.customerId` y el corte de retención viajan
  en la misma query (AC-4, AC-5, AC-7 — estructuralmente imposible ver una orden
  ajena o fuera de ventana, no una excepción atrapada).
- `CustomerGuard` (fail-closed, sin cambios de contrato) gatea ambos endpoints:
  sin sesión válida, 401, cero filas expuestas (AC-5).
- Estado vacío (AC-3) es responsabilidad del frontend — el backend devuelve
  `{ data: [], pagination: { total: 0, ... } }` sin caso especial.
- Un throttler nombrado nuevo (`orders_history`, mismo patrón "techo
  inalcanzable + `@Throttle` real en el handler" que `checkout`/`search`/
  `enrichment`/`payments_simulate`) y un evento de observabilidad
  (`OrdersHistoryEventsService`, cero PII) por accesos al historial (US §9).
- Índice compuesto `orders(customer_id, created_at)` (migración aditiva,
  reemplaza el índice de una sola columna) — el patrón exacto que
  `password_reset_tokens` ya usa para el mismo tipo de consulta ("listar lo mío
  ordenado por fecha").

## Out of scope

- **Re-comprar / reordenar desde el historial** — US §4, fuera de v1.
- **Vincular retroactivamente compras guest a la cuenta** — US §4/AC-6,
  decisión de privacidad explícita; requeriría verificación de email y no se
  reabre acá.
- **Cancelar / reembolsar desde el historial** — acción del dueño (US-013).
- **Facturación / comprobantes** — roadmap (AFIP, PRD §2.2).
- **Excluir del historial las órdenes anonimizadas a pedido** (`anonymized_at`
  con `anonymization_reason = 'requested'`, US-021) que todavía estén dentro de
  los 12 meses — ver `design.md` §Open questions; el filtro de esta US es
  puramente por fecha de retención, no por estado de anonimización.
- **Namespace de rutas del frontend** (`/cuenta/pedidos` o similar) — decisión
  de `US-015-historial-compras-frontend-web`, no de este change.

## References

- US: `docs/user-stories/US-015-historial-compras.md`
- PRD: `docs/product/prd.md` §2.1 cap. 8 (valor de la cuenta), §6 (retención 12
  meses)
- E2E: `docs/product/design-e2e.md` §8 (DER — `orders.customer_id`), §14
  (autorización/trust boundaries)
- `openspec/changes/archive/US-008-checkout-guest-backend/` — «`customer_id` se
  crea por el DER y queda SIN ESCRITOR (US-012 y US-015)» (proposal.md)
- `openspec/changes/archive/US-014-registro-login-backend/` — mecanismo de
  sesión de cliente (`CustomerGuard`, cookies, `SessionService`) que este change
  reusa y extiende, no reemplaza
- `openspec/changes/archive/US-021-retencion-datos-ordenes-backend/` —
  `OrdersRetentionService.cutoffDate()`, cálculo de corte que este change
  extrae a un helper compartido en vez de reimplementar
- Precedente de índice compuesto: `packages/db/prisma/schema.prisma`, modelo
  `PasswordResetToken`, `@@index([customer_id, created_at])`
- Capacidad futura esperada en `openspec/specs/`: `historial-compras` (CAP-8,
  PRD §2.1 cap. 8 — `docs/_index/us-status.yaml` ya asigna `prd-capacity: 8` a
  US-015). No se crea acá — la materializa el primer `/archive-change` de esta
  US.
