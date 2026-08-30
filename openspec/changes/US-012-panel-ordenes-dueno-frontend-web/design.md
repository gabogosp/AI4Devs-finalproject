---
parent-us: US-012
discipline: frontend-web
variant: null
language: es
---

# US-012 Frontend — Design

## Context

El E2E fija tres cosas que este design **no reabre**:

- **§6.2 (Componentes web)**: `admin: Panel del dueño (React) — Catálogo, import, órdenes,
  métricas (TanStack Table + Recharts)`, y a nivel API `Rel(web, orders, "GET/PATCH
  /admin/orders")`.
- **§9.4 (Secuencia de fulfillment)**: `GET /admin/orders?status=new` para listar,
  `PATCH /admin/orders/:id {status: ready}` dispara el email (async, vía Resend, disparado
  por el backend — el FE no lo toca), y `PATCH /admin/orders/:id {status: delivered}` escribe
  `delivered_at`.
- **§12 (FSM)**: `pending_payment → new → preparing → ready → delivered`, con `new/preparing/
  ready → cancelled` fuera de esta US (US-013). `delivered` y `cancelled` son terminales. El
  panel **nunca muestra `pending_payment`**.

El resto del panel admin ya establece los patrones que este change reutiliza sin
modificarlos: `productsService.ts` (repositorio sobre el cliente generado), `ProductList.tsx`
(TanStack Table + `AsyncState`), `ProductActions.tsx` (mutación con `busy`/rollback pesimista
+ `ConfirmDialog` para lo destructivo), `guard.tsx`/`AdminLayout` (route group protegido),
`errors.ts` (unión discriminada `AppError`, incluye `conflict` con extension members — el
mismo mecanismo que necesita AC-6).

## Goals

- Que el dueño pueda listar, filtrar, ver el detalle y avanzar el estado de una orden pagada
  sin poder —desde la UI— disparar una transición inválida.
- Que la transición a "lista para retirar" quede claramente comunicada como el disparador del
  aviso al cliente (AC-4), sin que el FE implemente nada del envío.
- Que una transición fallida (carrera, red, servidor) nunca deje al operador viendo un estado
  que el backend no confirmó.
- Reusar el guard, el cliente HTTP y el patrón de tabla ya construidos — cero superficie
  nueva de auth o de red.

## Non-goals

- Tocar `adminSession.ts` / `client.ts` / `csrf.ts` — eso es
  `AUDIT-dsm-web-007-endurecimiento-panel-frontend-web` (change separado, ya planificado).
- Diseñar el endpoint backend — eso es `US-012-panel-ordenes-dueno-backend` (a planificar).
  Este documento **propone** una forma de contrato para destrabar esa planificación, no la
  fija.
- Cancelación / reembolso (US-013), nav/shell persistente del admin, panel de métricas.

## Approach

### D1 — Rutas: reusar el route group `(admin)`, sin tocar el guard

```
apps/web/app/(admin)/admin/ordenes/page.tsx        → <OrdersList />
apps/web/app/(admin)/admin/ordenes/[id]/page.tsx   → <OrderDetail id={id} />
```

`apps/web/app/(admin)/layout.tsx` ya envuelve **todo** el grupo con `<AdminGuard>`
(`apps/web/src/features/auth/guard.tsx`). Poner las páginas nuevas ahí adentro es lo que
resuelve AC-7 — no hay guard nuevo que escribir ni testear en este change; `guard.test.tsx`
ya cubre el mecanismo, y la garantía real (backend gatea server-side) es responsabilidad del
backend, como el comentario del propio `guard.tsx` aclara ("NO es la autoridad").

**Patrón de página**, calcado de `app/(admin)/admin/productos/page.tsx` /
`admin/productos/[id]/page.tsx` (Server Component delgado que delega a un Client Component
`'use client'` de `features/`) — sin lógica en el archivo de ruta.

### D2 — Forma de contrato propuesta (para destrabar la planificación de backend)

No existe hoy (`grep '/admin/orders' apps/api/docs/api/openapi.yaml` → vacío). Se propone,
derivado de §6.2/§9.4/§8 DER + el precedente de `CheckoutCreated`/`Product` en el contrato
actual:

```yaml
# GET /v1/admin/orders
# query: status?, limit, offset, sort? (order_number|confirmed_at|total_ars_cents), order? (asc|desc)
AdminOrderListResponse:
  data: AdminOrderSummary[]
  pagination: { limit, offset, total }

AdminOrderSummary:
  id: string (uuid)            # interno — NO se expone como link, se usa para el detalle
  order_number: integer        # visible (ya existe en CheckoutCreated)
  buyer_name: string
  total_ars_cents: integer
  status: enum [new, preparing, ready, delivered]   # NUNCA pending_payment/cancelled acá (AC-8)
  confirmed_at: string (date-time)

# GET /v1/admin/orders/{id}
AdminOrderDetail:
  # todo lo de AdminOrderSummary, más:
  buyer_email: string
  buyer_phone: string
  fulfillment: enum [pickup]
  items: AdminOrderItem[]      # product_name, product_sku, quantity, unit_price_ars_cents, subtotal_ars_cents
  status_history: AdminOrderStatusChange[]   # OQ-FE-1 — ver proposal.md

AdminOrderStatusChange:
  from_status: string | null   # null en el primer registro (pending_payment → new)
  to_status: string
  changed_at: string (date-time)

# PATCH /v1/admin/orders/{id}
# body: { status: enum [preparing, ready, delivered] }
# 200 → AdminOrderDetail actualizado
# 409 (dsm:orders/invalid-transition) → AppError.conflict — mismo mecanismo que
#   dsm:cart/insufficient-stock (errors.ts ya sabe llevar extension members en `conflict`)
```

Este bloque es **input para la planificación de backend**, no un contrato cerrado — de ahí
que viva en `design.md` y no en `openspec/changes/.../contracts/` (esa carpeta la crea quien
planifique el backend, per `openspec-workflow` "Living contract rule").

### D3 — `ordersService.ts`: mismo patrón que `productsService.ts`

```ts
// apps/web/src/features/orders/ordersService.ts
import { parseContract } from '@/lib/http/contract';
import { listAdminOrders, getAdminOrder, updateAdminOrderStatus } from '@/api/generated/endpoints';
import { AdminOrderListResponse, AdminOrderDetailResponse } from '@/api/generated/zod';
import type { AdminOrderSummary, AdminOrderDetail, OrderStatus } from '@/api/generated/model';

export type { AdminOrderSummary as OrderSummary, AdminOrderDetail as OrderDetail, OrderStatus };

export const ordersService = {
  async list(
    params: { status?: OrderStatus; limit: number; offset: number; sort?: string; order?: 'asc' | 'desc' },
    signal?: AbortSignal,
  ) {
    const res = await listAdminOrders(params, { signal });
    return parseContract(AdminOrderListResponse, res.data);
  },
  async get(id: string, signal?: AbortSignal) {
    const res = await getAdminOrder(id, { signal });
    return parseContract(AdminOrderDetailResponse, res.data);
  },
  async updateStatus(id: string, status: OrderStatus, idempotencyKey: string) {
    const res = await updateAdminOrderStatus(
      id,
      { status },
      { headers: { 'idempotency-key': idempotencyKey } },
    );
    return parseContract(AdminOrderDetailResponse, res.data);
  },
};
```

Nombres de funciones generadas (`listAdminOrders`, etc.) son ilustrativos — `orval` los
deriva de `operationId` del contrato real; se ajustan cuando el contrato exista (tarea de
Fase 1).

### D4 — `orderStatus.ts`: la FSM vista desde el FE, pura

El backend es la autoridad (E2E §12, `order-state.ts` de US-010 backend). El FE necesita su
**propia** proyección de esa FSM para decidir qué botón mostrar — un módulo puro,
testeable sin red ni React, análogo a por qué `order-state.ts` es puro en el backend:

```ts
// apps/web/src/features/orders/orderStatus.ts
import type { OrderStatus } from './ordersService';

/** Único paso siguiente válido por estado (proyección FE de la FSM del E2E §12).
 *  `null` = estado terminal para este panel (delivered) o fuera de alcance (cancelled). */
export const NEXT_STATUS: Record<OrderStatus, OrderStatus | null> = {
  new: 'preparing',
  preparing: 'ready',
  ready: 'delivered',
  delivered: null,
};

export const STATUS_LABEL: Record<OrderStatus, string> = {
  new: 'Nueva',
  preparing: 'Preparando',
  ready: 'Lista para retirar',
  delivered: 'Entregada',
};

/** Copy del botón — sólo existe para el paso siguiente válido. */
export const ACTION_LABEL: Partial<Record<OrderStatus, string>> = {
  preparing: 'Marcar como preparando',
  ready: 'Marcar como lista para retirar',
  delivered: 'Marcar como entregada',
};
```

**Por qué esto no duplica la FSM del backend de forma peligrosa**: el FE nunca decide sola —
solo decide qué **ofrecer**. La autoridad sigue siendo el backend (AC-6 se cumple aunque este
mapa tuviera un bug, porque el `PATCH` sigue pudiendo devolver 409). Esta proyección solo
evita mostrarle al operador un botón que sabemos de antemano que va a fallar.

### D5 — `OrdersList`: TanStack Table con `manualSorting` (patrón nuevo respecto a `ProductList`)

`ProductList.tsx` ya establece `manualPagination` pero no ordena. AC-1 pide "ordenable", así
que se agrega `manualSorting` cableado a `sort`/`order`:

```tsx
const [sorting, setSorting] = useState<SortingState>([{ id: 'confirmed_at', desc: true }]);
const [status, setStatus] = useState<OrderStatus | ''>('');
const [offset, setOffset] = useState(0);

// ... fetch con { status: status || undefined, limit, offset, sort: sorting[0]?.id, order: sorting[0]?.desc ? 'desc' : 'asc' }

const table = useReactTable({
  data: rows,
  columns,
  getCoreRowModel: getCoreRowModel(),
  manualPagination: true,
  manualSorting: true,
  onSortingChange: setSorting,
  state: { sorting },
  rowCount: total,
});

// header:
<th aria-sort={header.column.getIsSorted() === 'asc' ? 'ascending' : header.column.getIsSorted() === 'desc' ? 'descending' : 'none'}>
```

Cambiar el filtro de estado o el orden **resetea `offset` a 0** (evita una página fantasma:
pedir offset=40 con un filtro que solo tiene 10 resultados).

**Filtro de estado (AC-5, AC-8)**: `<select>` nativo (accesible por default, sin componente
nuevo) con 5 opciones: "Todas", "Nueva", "Preparando", "Lista para retirar", "Entregada".
**Nunca** una opción "Pendiente de pago" — AC-8 se refleja en que el FE no puede ni pedirlas.

### D6 — `OrderStatusBadge`: texto + color por estado (design-system §7.7)

Mismo patrón que `StatusBadge.tsx` (productos), 4 estados (el panel no muestra
`pending_payment` ni `cancelled` en el listado; `cancelled` se renderiza defensivamente por
si el detalle de una orden ya cancelada por US-013 se abre desde un link viejo):

| Estado | Texto | Clase (design-system §7.7) |
|---|---|---|
| `new` | Nueva | `info` / `brand-primary-subtle` |
| `preparing` | Preparando | `warning` / `warning-subtle` |
| `ready` | Lista para retirar | `warning` / `warning-subtle` (mismo bucket que `preparing` — design-system los agrupa; el **texto** los distingue, nunca el color solo — a11y §11) |
| `delivered` | Entregada | `success` / `success-subtle` |
| `cancelled` | Cancelada | `error` / `error-subtle` (defensivo, fuera de flujo de esta US) |

### D7 — `OrderStatusActions`: UI optimista + rollback (frontend-resilience-patterns #4 + #9)

```tsx
async function advance() {
  const next = NEXT_STATUS[order.status];
  if (!next) return;
  const key = idempotencyKeyRef.current ?? (idempotencyKeyRef.current = crypto.randomUUID());
  setBusy(true);
  setError(null);
  const previous = order.status;
  onOptimisticUpdate(next);           // 1. optimista — la fila/badge cambia YA
  try {
    const updated = await ordersService.updateStatus(order.id, next, key);
    idempotencyKeyRef.current = null; // intento cerrado — el próximo click es un intento nuevo
    onConfirmed(updated);             // 2. reconcilia con lo que el backend confirmó
    track('order_status_changed', { order_id: order.id, to_status: next });
    if (next === 'ready') setMessage('Se avisó al cliente que su pedido está listo.');
  } catch (err) {
    onOptimisticUpdate(previous);     // 3. rollback — el backend no confirmó
    setError(
      isAppError(err, 'conflict')
        ? 'La orden ya cambió de estado (probablemente en otra pestaña). Recargá para ver el estado actual.'
        : 'No se pudo actualizar el estado. Reintentá.',
    );
    // idempotencyKeyRef NO se limpia: un reintento manual reusa la misma clave (patrón #9)
  } finally {
    setBusy(false);
  }
}
```

Reglas explícitas (por qué, no solo qué):

- **Un solo botón visible** — el de `NEXT_STATUS[order.status]`. No hay menú de "elegir
  estado": eso sería ofrecer transiciones inválidas en la UI, exactamente lo que AC-6 prohíbe.
- **Sin retry automático** — `frontend-resilience-patterns` solo prescribe retry automático
  para GETs idempotentes; un `PATCH` con efecto lateral (el email de `ready`) no calza ahí. El
  retry es manual (el operador vuelve a apretar el botón) y **reusa la misma
  `idempotency-key`** mientras el intento siga abierto (patrón #9) — si el backend la soporta
  (OQ-FE-2), un reintento después de un timeout no duplica el aviso.
- **Botón deshabilitado durante el vuelo** (`busy` → `disabled`) — dedupe del lado del click
  (patrón #3), mismo mecanismo que `Button loading` ya usa en `ProductActions`.
- **Confirmación**: NO se usa `ConfirmDialog` (el modal de tipear la palabra, reservado para
  lo destructivo per `ProductActions.archive`). Avanzar una orden es la acción **más
  frecuente** de la pantalla (varias veces por día) y es reversible en el sentido de que no
  borra nada; una fricción de tipeo ahí sería ruido, no seguridad. Si en producción se
  observa que "marcar entregada" se aprieta por error, es una fricción a agregar en un
  follow-up — no se anticipa acá (YAGNI).

### D8 — `OrderStatusHistory`: audit trail (§11.bis.4)

Lista simple en el detalle: cada fila `{from_status ?? '—'} → {to_status}` +
`changed_at` formateado (`Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle:
'short' })`, con huso horario visible per §11.bis.1 "Always show timezone"). Depende de
`status_history` en el contrato (OQ-FE-1).

### D9 — Auth: sin cambios, deviación heredada de §11.bis.9 ya documentada

`frontend-standards.md` §11.bis.9 pide SSO + MFA para backoffice. Este proyecto ya se desvía
de eso a propósito (ADR-0009, "seam de admin": login con `bootstrapToken`, sin SSO — operador
único, no un equipo). Esta US no reabre esa decisión; hereda el mismo `AdminGuard` que
`productos`/`import` ya usan.

## Trade-offs

**Un solo botón (paso siguiente) vs. un selector de estado.** Un `<select>` con los 4 estados
sería más "flexible", pero le devolvería a la UI la responsabilidad de no ofrecer saltos
inválidos — justo lo que AC-6 pide que NO dependa de que el operador elija bien. Un botón por
paso hace la transición inválida **irrepresentable** en la interfaz.

**Idempotency-Key defensiva sin backend confirmado (OQ-FE-2).** Mandar el header aunque no
sepamos si el backend lo usa cuesta una línea y no rompe nada si se ignora; no mandarlo y que
el backend lo pida después es una segunda vuelta. Se manda ahora.

**`status_history` como array vs. reconstruir del lado del cliente.** Se podría intentar
armar un historial aproximado con `confirmed_at`/`updated_at`/`delivered_at`, pero eso NO
satisface AC-9 ("estado anterior, nuevo y marca temporal" — plural, cada transición) con solo
3 timestamps para 3 transiciones posibles más la inicial. Se pide la lista completa al
backend (OQ-FE-1) en vez de aproximarla mal en el cliente.

## Resiliencia (frontend-resilience-patterns)

| Patrón | Aplicado en | Cómo |
|---|---|---|
| #3 Deduplicación de requests | `OrderStatusActions` | Botón `disabled` mientras `busy` |
| #4 UI optimista + rollback | `OrderStatusActions` | D7 — cambia ya, revierte si el backend no confirma |
| #8 Cancelación | `OrdersList`/`OrderDetail` | `AbortSignal` en `ordersService.list/get`, igual que `productsService` — abortar el fetch anterior al cambiar de filtro/página evita una respuesta vieja pisando una nueva |
| #9 Idempotency-Key por intento | `OrderStatusActions` | D7 — una clave por intento, reusada en reintento manual, nunca en un intento nuevo |
| #12 Skeleton loading | `OrdersList`/`OrderDetail` | Filas skeleton mientras `status: 'loading'`, no un spinner de página completa (consistente con `ProductList`, que hoy solo tiene texto — se sube el estándar acá porque el filtro hace que el loading sea más frecuente) |

## Observabilidad

Eventos nuevos en `apps/web/src/lib/observability/events.ts` (`BusinessEvent` union), sin
PII del comprador (mismo criterio que `product_published`/`product_archived`):

- `bo_screen_shown` con `{ screen: 'orders_list' | 'order_detail' }`.
- `order_status_change_attempted` / `order_status_change_succeeded` / `_failed` con
  `{ order_id, from_status, to_status }` — `operator_id: 'admin'` lo agrega `track()`
  automáticamente (no es un evento de `PUBLIC_EVENTS`).
- `orders_filtered` con `{ status }` cuando el operador cambia el filtro (mide qué estados se
  consultan más — insumo liviano para US-016).

Sentry ya captura errores no manejados (E2E §18); no se agrega nada nuevo ahí.

## Accesibilidad (WCAG 2.1 AA — US §9, design-system §11)

- `aria-sort` en cada `<th>` ordenable (D5).
- Tabla → cards en mobile (design-system §4.1/§7.9): cada card mantiene la relación
  dato↔encabezado (`aria-label` por campo en la card, no solo texto suelto).
- Foco gestionado: al abrir el detalle desde el listado, el foco entra al `<h1>` de la orden
  (design-system §11 "foco gestionado al cambiar de ruta").
- Filtro de estado: `<select>` con `<label>` visible ("Filtrar por estado"), navegable por
  teclado por default.
- Botón de acción de estado: `aria-busy` durante `busy` (ya lo provee `Button`).
- Color nunca único portador: `OrderStatusBadge` siempre texto + color (D6).

## Test plan

Ver `tasks.md` para el detalle cerrado por task. Resumen: unit (`orderStatus.ts` puro),
component (RTL) para `OrdersList`/`OrderDetail`/`OrderStatusActions`/`OrderStatusBadge` con
MSW mockeando `/v1/admin/orders*`, y un test de contrato (`ordersService.test.ts`) que
verifica que las llamadas usan las operaciones **generadas** (nunca `fetch` crudo) — mismo
gate que `.consumer-contract-allow` ya aplica al resto del panel. E2E (AC-7 negative-space,
AC-6 contra backend real, BDD) es QA-owned — no se planifica acá.

## Deployment considerations

No hay nada que desplegar de este change en aislado: depende de que
`US-010-orden-webhook-stock-backend` y `US-012-panel-ordenes-dueno-backend` estén en
producción primero (las tablas y el contrato tienen que existir). Se recomienda planificar el
despliegue de los tres juntos, igual que el trío US-008→US-009→US-010 lo recomendó para el
backend.

## Open questions

Ver `proposal.md` §Open questions (OQ-FE-1, OQ-FE-2, OQ-FE-3) — las tres dependen de cómo se
planifique `US-012-panel-ordenes-dueno-backend`.

## References

- E2E §6.2 (Componentes web), §9.4 (secuencia de fulfillment), §12 (FSM), §8 (DER — `ORDERS`/
  `ORDER_ITEMS`), §17 (NFRs), §18 (observabilidad), §20 (ADRs — ninguno nuevo, hereda ADR-0008
  y ADR-0009)
- Design-system §7.7 (OrderStatusBadge), §7.9 (Table backoffice), §11 (a11y checklist)
- Precedentes de código: `apps/web/src/features/products/{ProductList,ProductActions,
  productsService,StatusBadge}.tsx`, `apps/web/src/features/auth/guard.tsx`,
  `apps/web/src/lib/http/{errors,async,client}.ts`
- Changes relacionados: `US-010-orden-webhook-stock-backend` (Draft, bloqueante),
  `AUDIT-dsm-web-007-endurecimiento-panel-frontend-web` (out of scope, no tocar)
- Standards: `frontend-standards.md` §3, §8, §9, §11, §11.bis, §12 · `frontend-next-standards.md` ·
  `api-standards.md` · `qa-frontend-standards.md` §19, §23
