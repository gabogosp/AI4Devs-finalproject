---
parent-us: US-012
discipline: frontend-web
variant: null
language: es
realigned-at: 2026-08-30
---

# US-012 Frontend — Design

> **Realineación 2026-08-30**: `US-012-panel-ordenes-dueno-backend` fue regenerado. Dos
> correcciones de campo/enum se propagan a todo este documento (`confirmed_at` → `created_at`;
> `sort` libre → enum cerrado de 6 valores) y se agrega §D9 (vista de pendientes de pago,
> renumerando la sección de Auth que antes era D9 a D10). Ver `proposal.md` frontmatter
> `realigned-reason` para el detalle completo.

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
- (Aditivo, no-AC — ver §D9) Que el dueño pueda confirmar el pago manual de una orden
  `pending_payment` desde una vista separada, sin que esas órdenes puedan filtrarse jamás a la
  cola de fulfillment (`OrdersList`).

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

### D2 — Contrato ratificado (`US-012-panel-ordenes-dueno-backend` design.md §D3 — todavía sin construir)

No existe hoy en el repo (`grep '/admin/orders' apps/api/docs/api/openapi.yaml` → vacío), pero
ya **no es una propuesta abierta de este plan** — el backend regenerado lo fijó en su propio
`design.md` §D3. Se transcribe acá para que el codegen de Fase 1 (T1.1) tenga un target exacto
en cuanto ese contrato se publique:

```yaml
# GET /v1/admin/orders
# query: status? enum [new, preparing, ready, delivered]  (allowlist cerrada — nunca
#   pending_payment/cancelled, AC-8), limit (default 20, max 100), offset,
# sort? — ENUM CERRADO de 6 valores (no un parser libre ni dos params separados):
#   order_number | -order_number | created_at | -created_at | total_ars_cents | -total_ars_cents
#   default "-created_at"   ← CORREGIDO: la columna real es `created_at`, `confirmed_at`
#   nunca existió (ver proposal.md frontmatter `realigned-reason`)
AdminOrderListResponse:
  data: AdminOrderSummary[]
  pagination: { limit, offset, total }

AdminOrderSummary:
  id: string (uuid)            # interno — NO se expone como link, se usa para el detalle
  order_number: integer        # visible (ya existe en CheckoutCreated)
  buyer_name: string
  total_ars_cents: integer
  status: enum [new, preparing, ready, delivered]   # NUNCA pending_payment/cancelled acá (AC-8)
  created_at: string (date-time)   # CORREGIDO desde `confirmed_at`

# GET /v1/admin/orders/{id}
AdminOrderDetail:
  # todo lo de AdminOrderSummary, más:
  buyer_email: string
  buyer_phone: string
  fulfillment: enum [pickup]
  items: AdminOrderItem[]      # product_name, product_sku, quantity, unit_price_ars_cents, subtotal_ars_cents
  status_history: AdminOrderStatusChange[]   # OQ-FE-1 — ratificada

AdminOrderStatusChange:
  from_status: string | null   # null en el primer registro (pending_payment → new; ver
                                # backend proposal.md decisión 3 — esa fila NO la escribe este
                                # módulo, la escribe US-023, así que en la práctica el primer
                                # registro que este panel produce ya tiene `from_status` no-null)
  to_status: string
  changed_by: string | null    # NUEVO (no estaba en la propuesta original de este plan) — el
                                # `sub` del JWT admin (uuid) o el literal `admin` (bootstrap
                                # token). Ver §D8 para cómo se renderiza.
  changed_at: string (date-time)

# PATCH /v1/admin/orders/{id}
# body: { status: enum [preparing, ready, delivered] }
# 200 → AdminOrderDetail actualizado
# 409 (dsm:orders/invalid-transition) → AppError.conflict — mismo mecanismo que
#   dsm:cart/insufficient-stock (errors.ts ya sabe llevar extension members en `conflict`)
```

Este bloque sigue viviendo en `design.md` y no en `openspec/changes/.../contracts/` porque el
contrato todavía no está construido en `apps/api/docs/api/openapi.yaml` — cuando lo esté, T1.1
(Fase 1) genera los tipos reales desde ahí, no desde esta transcripción.

### D3 — `ordersService.ts`: mismo patrón que `productsService.ts`

```ts
// apps/web/src/features/orders/ordersService.ts
import { parseContract } from '@/lib/http/contract';
import { listAdminOrders, getAdminOrder, updateAdminOrderStatus } from '@/api/generated/endpoints';
import { AdminOrderListResponse, AdminOrderDetailResponse } from '@/api/generated/zod';
import type { AdminOrderSummary, AdminOrderDetail, OrderStatus, OrderSort } from '@/api/generated/model';

export type { AdminOrderSummary as OrderSummary, AdminOrderDetail as OrderDetail, OrderStatus, OrderSort };

export const ordersService = {
  async list(
    // `sort` es un enum cerrado de 6 valores (ver D2) — el tipo `OrderSort` lo genera el
    // codegen a partir del contrato (T1.1); NO se acepta un string libre acá, a diferencia de
    // la versión anterior de este plan.
    params: { status?: OrderStatus; limit: number; offset: number; sort?: OrderSort },
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
que se agrega `manualSorting` cableado a un único param `sort` — **enum cerrado de 6 valores**
(RATIFICADO por `US-012-panel-ordenes-dueno-backend` design.md §D3/§D5, revisión final de
OQ-FE-3): `order_number | -order_number | created_at | -created_at | total_ars_cents |
-total_ars_cents`, default `-created_at`. Esto es una revisión sobre la revisión anterior de
este plan (que asumía un param libre tipo `sort=-confirmed_at`): el backend NO acepta
`sort=buyer_name` ni `sort=status`, así que **solo 3 de las 5 columnas de la tabla son
ordenables** — cliente y estado quedan con `enableSorting: false`:

```tsx
const [sorting, setSorting] = useState<SortingState>([{ id: 'created_at', desc: true }]);
const [status, setStatus] = useState<OrderStatus | ''>('');
const [offset, setOffset] = useState(0);

// ... fetch con { status: status || undefined, limit, offset,
//   sort: `${sorting[0]?.desc ? '-' : ''}${sorting[0]?.id}` as OrderSort }
// El `id` de columna de las 3 columnas ordenables (order_number, total_ars_cents, created_at)
// coincide 1:1 con el nombre de campo del enum del backend — sin tabla de traducción.

const columns: ColumnDef<OrderSummary>[] = [
  { id: 'order_number', accessorKey: 'order_number', header: 'Nº de orden' },              // ordenable
  { id: 'buyer_name', accessorKey: 'buyer_name', header: 'Cliente', enableSorting: false }, // NO ordenable — no hay campo `sort` que lo respalde
  { id: 'total_ars_cents', accessorKey: 'total_ars_cents', header: 'Total', cell: formatArsCell }, // ordenable
  { id: 'status', accessorKey: 'status', header: 'Estado', enableSorting: false, cell: StatusBadgeCell }, // NO ordenable
  { id: 'created_at', accessorKey: 'created_at', header: 'Fecha' },                         // ordenable, default
];

const table = useReactTable({
  data: rows,
  columns,
  getCoreRowModel: getCoreRowModel(),
  manualPagination: true,
  manualSorting: true,
  enableSortingRemoval: false,   // siempre hay un sort activo — nunca "sin ordenar" (el
                                  // backend requiere que `sort` sea uno de los 6 valores o
                                  // ausente-con-default; evitar el estado intermedio "tercer
                                  // click limpia el sort" que TanStack ofrece por default)
  onSortingChange: setSorting,
  state: { sorting },
  rowCount: total,
});

// header (solo en <th> de columnas con enableSorting !== false):
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
`status_history` en el contrato (OQ-FE-1, ratificada).

**`changed_by` (nuevo campo, no estaba en la propuesta original de este plan — ver §D2)**: se
agrega al final de la fila cuando no es `null`: `"— → Nueva · cambiado por {changed_by}"`.
`changed_by` es el `sub` crudo del JWT admin (un uuid) o el literal `admin` (sesión de
bootstrap) — **no se resuelve a un nombre**: no existe ningún lookup de administradores en
este proyecto (operador único, ADR-0009) y agregar uno para mostrar un nombre bonito acá sería
scope creep de un campo que ni siquiera es un AC literal de US-012 (ver backend proposal.md
OQ-BE-3). Cuando `changed_by` es `null` (no debería pasar para transiciones de este panel, pero
sí para la fila inicial `pending_payment → new` que escribe US-023, si esa fila alguna vez
aparece mezclada en el mismo array) se omite esa porción de texto sin dejar un placeholder
vacío ("cambiado por —" sería peor que no decir nada).

### D9 — Vista de "pendientes de pago" (feature aditiva — coexistencia con `US-023-pago-manual-offline`, sin AC formal propio)

**Origen**: nota informal §10 de la US (agregada 2026-08-30, todavía sólo *staged* en el
worktree de US-023 — no visible en `docs/user-stories/US-012-panel-ordenes-dueno.md` de este
worktree). Pide que el dueño tenga una vista separada de órdenes `pending_payment` para poder
confirmarles el pago manualmente. **Esto NO es una de las 9 AC Gherkin formales de esta US** —
ver `proposal.md` OQ-FE-4. Se planifica igual porque `US-012-panel-ordenes-dueno-backend`
(regenerado) ya decidió, en su decisión 3, **reusar** el endpoint que
`US-023-pago-manual-offline-backend` ya planificó — construirlo sin un consumidor FE dejaría
un endpoint admin sin UI.

**Endpoints consumidos** (planificados y diseñados por `US-023-pago-manual-offline-backend`
— [`design.md`](../../../../US-023-pago-manual-offline/openspec/changes/US-023-pago-manual-offline-backend/design.md)
§Endpoints, worktree separado, **solo lectura**, no construidos por este change ni por su
backend hermano):

```yaml
GET /v1/admin/orders/pending-payment
  200: PendingPaymentOrder[]   # sin paginación (volumen bajo, un solo local)
PendingPaymentOrder:
  id: string (uuid)     # requerido — lo consume POST /confirm-payment
  order_number: integer, buyer_name: string, total_ars_cents: integer, created_at: date-time
  # sin buyer_email/buyer_phone (mínimo necesario, criterio de US-023)

POST /v1/admin/orders/{orderId}/confirm-payment
  200: { order_number: integer, status: "new" }
  404: Problem (orden no existe)
  409: Problem (dsm:payments/order-not-pending-payment — ya no está pending_payment)
  409: Problem (dsm:payments/insufficient-stock — stock agotado entre checkout y confirmación)
```

**Resuelto 2026-08-30**: se había flageado que el shape de `GET /pending-payment` en prosa no
incluía `id` (uuid), necesario para `POST /confirm-payment`. `US-023-pago-manual-offline-backend`
corrigió su contrato (`contracts/openapi/orders-pending-payment.yaml` §schema, `id` ahora
`required`) — ya no es una asunción de este plan, es parte del contrato fijado por el backend
hermano. Sin cambios pendientes en `pendingPaymentsService.ts`.

**Componente — `PendingPaymentsPanel`** (`apps/web/src/features/orders/
PendingPaymentsPanel.tsx`), **deliberadamente separado** de `OrdersList`: no un tab dentro de
su misma tabla, no una opción de su `<select>` de filtro (ese filtro estructuralmente nunca
puede ofrecer `pending_payment`, AC-8 — mezclar esta vista ahí adentro sería el primer paso
para romper esa garantía). Vive en la misma ruta `/admin/ordenes` como una **segunda pestaña**
leída por query string (`?tab=pendientes-de-pago`, resuelto en el Server Component de
`page.tsx` — sin introducir un shell/nav persistente nuevo, per Non-goals): el Server Component
monta **exactamente uno** de los dos Client Components por vez, nunca ambos en el DOM
simultáneamente.

```tsx
// apps/web/src/features/orders/pendingPaymentsService.ts — servicio separado de ordersService,
// mismo patrón (parseContract, nunca fetch crudo), concern distinto (backend hermano)
export const pendingPaymentsService = {
  async list(signal?: AbortSignal) {
    const res = await listPendingPaymentOrders({ signal });
    return parseContract(PendingPaymentOrderListResponse, res.data);
  },
  async confirm(orderId: string) {
    const res = await confirmOrderPayment(orderId);
    return parseContract(ConfirmOrderPaymentResponse, res.data);
  },
};
```

```tsx
// apps/web/src/features/orders/PendingPaymentsPanel.tsx (forma, no implementación final)
function PendingPaymentsPanel() {
  const [state, setState] = useState<AsyncState<PendingPaymentOrder[]>>({ status: 'idle' });
  const [confirming, setConfirming] = useState<Set<string>>(new Set());   // por-fila, no global

  const load = useCallback(async (signal?: AbortSignal) => {
    setState({ status: 'loading' });
    try {
      setState({ status: 'success', data: await pendingPaymentsService.list(signal) });
    } catch (err) {
      setState({ status: 'error', error: toAppError(err) });
    }
  }, []);

  useEffect(() => {
    const c = new AbortController();
    load(c.signal);
    return () => c.abort();               // #8 cancelación, igual criterio que OrdersList
  }, [load]);

  async function onConfirm(orderId: string) {
    setConfirming((s) => new Set(s).add(orderId));
    try {
      await pendingPaymentsService.confirm(orderId);
      track('pending_payment_confirmed', { order_id: orderId });   // sin buyer_name — PII
      await load();   // refetch simple — la fila desaparece porque el backend ya la movió a `new`
    } catch (err) {
      setRowError(orderId, toAppError(err));   // mensaje inline en la fila, la fila permanece
    } finally {
      setConfirming((s) => { const n = new Set(s); n.delete(orderId); return n; });
    }
  }

  // render: tabla simple (Nº orden / cliente / total / fecha) + botón "Confirmar pago" por
  // fila, `disabled`+`aria-busy` solo en la fila que está confirmando (dos filas pueden
  // confirmarse en paralelo sin bloquearse entre sí — a diferencia de OrderStatusActions, acá
  // no hay una única fila "la orden" cuyo estado local deba protegerse con un solo flag).
}
```

**Por qué refetch-on-success y NO UI optimista (deviación explícita de D7)** — instrucción del
orquestador: confirmar un pago manual es una acción de baja frecuencia hecha por un único
operador, sin el riesgo de "carrera entre dos pestañas avanzando la misma orden" que
justifica la máquina optimista+rollback de `OrderStatusActions` (esa carrera es la superficie
real de AC-6; esta vista no tiene un AC-6 equivalente). El costo de una request extra por
confirmación es insignificante comparado con la complejidad de duplicar esa máquina para una
acción de este volumen.

**Estados explícitos (§11.4)**: `idle` (transitorio, nunca visible — se carga al montar) /
`loading` (skeleton, mismo criterio que `OrdersList`) / `success` con 0 filas ("No hay pagos
pendientes de confirmar" — estado feliz, no un error) / `success` con N filas / `error` (red o
5xx — `role="alert"` + reintentar) / por-fila: `confirming` (botón `disabled`+`aria-busy`) →
éxito (la fila desaparece en el próximo `load()`) o fallo (mensaje `role="alert"` inline en esa
fila; la fila permanece, el botón vuelve a habilitarse).

**Observabilidad**: evento `pending_payment_confirmed` con `{ order_id }` — sin `buyer_name`
(PII, mismo criterio que el resto de `BusinessEvent`).

**Fuera del alcance de este plan**: el contenido/detalle completo de una orden
`pending_payment` (email/teléfono del comprador) — la lista es deliberadamente angosta
(criterio ya fijado por US-023), y esta US no agrega un endpoint de detalle nuevo para
`pending_payment`.

### D10 — Auth: sin cambios, deviación heredada de §11.bis.9 ya documentada

`frontend-standards.md` §11.bis.9 pide SSO + MFA para backoffice. Este proyecto ya se desvía
de eso a propósito (ADR-0009, "seam de admin": login con `bootstrapToken`, sin SSO — operador
único, no un equipo). Esta US no reabre esa decisión; hereda el mismo `AdminGuard` que
`productos`/`import` ya usan. Aplica igual a `PendingPaymentsPanel` (misma ruta `(admin)`, sin
guard nuevo).

## Trade-offs

**Un solo botón (paso siguiente) vs. un selector de estado.** Un `<select>` con los 4 estados
sería más "flexible", pero le devolvería a la UI la responsabilidad de no ofrecer saltos
inválidos — justo lo que AC-6 pide que NO dependa de que el operador elija bien. Un botón por
paso hace la transición inválida **irrepresentable** en la interfaz.

**Idempotency-Key defensiva sin backend confirmado (OQ-FE-2).** Mandar el header aunque no
sepamos si el backend lo usa cuesta una línea y no rompe nada si se ignora; no mandarlo y que
el backend lo pida después es una segunda vuelta. Se manda ahora.

**`status_history` como array vs. reconstruir del lado del cliente.** Se podría intentar
armar un historial aproximado con `created_at`/`updated_at`/`delivered_at`, pero eso NO
satisface AC-9 ("estado anterior, nuevo y marca temporal" — plural, cada transición) con solo
3 timestamps para 3 transiciones posibles más la inicial. Se pide la lista completa al
backend (OQ-FE-1) en vez de aproximarla mal en el cliente.

**`PendingPaymentsPanel` como pestaña separada vs. absorbida en `OrdersList` (D9).** Meterla
como una fila más del `<select>` de filtro de `OrdersList` sería el camino de menor esfuerzo,
pero convertiría AC-8 ("solo pagadas") en una garantía que depende de que nadie, en el futuro,
agregue esa opción de vuelta — exactamente el tipo de regresión silenciosa que AC-8 existe
para prevenir. Un componente y un servicio separados hacen esa mezcla estructuralmente más
difícil de introducir por accidente.

## Resiliencia (frontend-resilience-patterns)

| Patrón | Aplicado en | Cómo |
|---|---|---|
| #3 Deduplicación de requests | `OrderStatusActions` | Botón `disabled` mientras `busy` |
| #4 UI optimista + rollback | `OrderStatusActions` | D7 — cambia ya, revierte si el backend no confirma |
| #8 Cancelación | `OrdersList`/`OrderDetail` | `AbortSignal` en `ordersService.list/get`, igual que `productsService` — abortar el fetch anterior al cambiar de filtro/página evita una respuesta vieja pisando una nueva |
| #9 Idempotency-Key por intento | `OrderStatusActions` | D7 — una clave por intento, reusada en reintento manual, nunca en un intento nuevo |
| #12 Skeleton loading | `OrdersList`/`OrderDetail`/`PendingPaymentsPanel` | Filas skeleton mientras `status: 'loading'`, no un spinner de página completa (consistente con `ProductList`, que hoy solo tiene texto — se sube el estándar acá porque el filtro hace que el loading sea más frecuente) |
| #8 Cancelación (adicional) | `PendingPaymentsPanel` | `AbortSignal` en `pendingPaymentsService.list`, mismo criterio que `OrdersList` |
| #3 Deduplicación (adicional) | `PendingPaymentsPanel` | Botón "Confirmar pago" `disabled` **por fila** mientras esa confirmación está en vuelo (D9) — sin optimista/rollback (deviación explícita, ver D9 y Trade-offs) |

## Observabilidad

Eventos nuevos en `apps/web/src/lib/observability/events.ts` (`BusinessEvent` union), sin
PII del comprador (mismo criterio que `product_published`/`product_archived`):

- `bo_screen_shown` con `{ screen: 'orders_list' | 'order_detail' }`.
- `order_status_change_attempted` / `order_status_change_succeeded` / `_failed` con
  `{ order_id, from_status, to_status }` — `operator_id: 'admin'` lo agrega `track()`
  automáticamente (no es un evento de `PUBLIC_EVENTS`).
- `orders_filtered` con `{ status }` cuando el operador cambia el filtro (mide qué estados se
  consultan más — insumo liviano para US-016).
- `pending_payment_confirmed` con `{ order_id }` (D9) — sin `buyer_name`/`buyer_email`.

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
component (RTL) para `OrdersList`/`OrderDetail`/`OrderStatusActions`/`OrderStatusBadge`/
`PendingPaymentsPanel` con MSW mockeando `/v1/admin/orders*` (incluyendo
`/v1/admin/orders/pending-payment` y `/v1/admin/orders/{id}/confirm-payment`), y un test de
contrato (`ordersService.test.ts` + `pendingPaymentsService.test.ts`) que verifica que las
llamadas usan las operaciones **generadas** (nunca `fetch` crudo) — mismo gate que
`.consumer-contract-allow` ya aplica al resto del panel. E2E (AC-7 negative-space, AC-6 contra
backend real, BDD) es QA-owned — no se planifica acá.

## Deployment considerations

No hay nada que desplegar de este change en aislado: depende de que
`US-012-panel-ordenes-dueno-backend` esté en producción primero (el contrato tiene que
existir). La tabla `orders`/`order_items` ya está en producción vía `US-008` — a diferencia de
la versión anterior de este plan, ya no hay que esperar a `US-010`. `PendingPaymentsPanel`
adicionalmente depende de `US-023-pago-manual-offline-backend`; si ese change se demora, este
plan puede desplegarse igual con `OrdersList`/`OrderDetail`/`OrderStatusActions` completos y
`PendingPaymentsPanel` detrás de un feature flag simple (o simplemente sin mergear esa pestaña
todavía) — no es una dependencia dura para el resto del panel.

## Open questions

Ver `proposal.md` §Open questions (OQ-FE-1 a OQ-FE-4). OQ-FE-1/2/3 dependen de cómo se
planificó `US-012-panel-ordenes-dueno-backend` (ya resueltas, con revisión). OQ-FE-4 es nueva:
`PendingPaymentsPanel` no tiene un AC Gherkin formal en la US — se recomienda un CR o enmienda
a la US para agregar un AC-10, sin que este plan tenga autoridad para crearlo por su cuenta.

## References

- E2E §6.2 (Componentes web), §9.4 (secuencia de fulfillment), §12 (FSM), §8 (DER — `ORDERS`/
  `ORDER_ITEMS`), §17 (NFRs), §18 (observabilidad), §20 (ADRs — ninguno nuevo, hereda ADR-0008
  y ADR-0009)
- Design-system §7.7 (OrderStatusBadge), §7.9 (Table backoffice), §11 (a11y checklist)
- Precedentes de código: `apps/web/src/features/products/{ProductList,ProductActions,
  productsService,StatusBadge}.tsx`, `apps/web/src/features/auth/guard.tsx`,
  `apps/web/src/lib/http/{errors,async,client}.ts`
- `US-012-panel-ordenes-dueno-backend` design.md (regenerado 2026-08-30) §D2/§D3/§D4/§D5/§D6 —
  fuente del contrato ratificado en este documento.
- [`US-023-pago-manual-offline-backend`](../../../../US-023-pago-manual-offline/openspec/changes/US-023-pago-manual-offline-backend/design.md)
  §Endpoints (worktree separado, solo lectura) — dueño de `GET /pending-payment` y
  `POST /confirm-payment` que consume `PendingPaymentsPanel` (§D9).
- Changes relacionados: `AUDIT-dsm-web-007-endurecimiento-panel-frontend-web` (out of scope,
  no tocar). `US-010-orden-webhook-stock-backend` ya no es una dependencia de este plan (ver
  "Dependencia cruzada" de `proposal.md`).
- Standards: `frontend-standards.md` §3, §8, §9, §11, §11.bis, §12 · `frontend-next-standards.md` ·
  `api-standards.md` · `qa-frontend-standards.md` §19, §23
