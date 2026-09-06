---
parent-us: US-013
discipline: frontend-web
variant: null
language: es
---

# US-013 Frontend-web — Tasks

> Cada task es closure-grade: atómica, con `Exit criterion:` observable y
> `Verify:` con el comando exacto que `/develop-frontend-web` corre — siempre
> en su forma **terminante** (F49): `pnpm --filter @dsm/web vitest run <patrón>`,
> nunca `vitest` a secas (watch por defecto en TTY). Los comandos asumen la
> **raíz del repo** como cwd.
>
> **Estimación dual**: **~3,5 h AI-asistido** / **~5 h tradicional** (17
> tasks, 7 fases + pre-requisitos). La US §7 presupuesta `FE-US-013` en 4-6h
> tradicional —
> este plan queda dentro del rango, más contenido que el estimado porque
> reusa `ConfirmDialog` (2 consumidores ya en producción) sin modificarlo, y
> el cliente/Zod/MSW ya vienen regenerados por el orquestador — no hay Fase
> de codegen real, sólo una verificación de que sigue vigente.

## Traceability matrix (AC de la US → tasks)

| AC | Descripción | Task IDs |
|---|---|---|
| AC-1 | Cancelar orden no entregada (superficie: gate de visibilidad) | T3.1, T5.1, T5.2 |
| AC-3 | Reembolso real MercadoPago (superficie: mensaje según `refund.status`) | T3.2, T4.1 |
| AC-4 | Aviso al comprador (superficie: copy del diálogo) | T3.1 |
| AC-5 | Pago simulado — no-op (superficie: mensaje `not_applicable`/`refunded`) | T3.2, T4.1 |
| AC-6 | Confirmación de dos pasos | T3.1, T3.3, T4.2, T4.3 |
| AC-7 | No cancela orden entregada (superficie: gate + mensaje 409) | T3.1, T4.2, T5.2 |
| AC-9 | Sólo admin puede cancelar | Fuera de alcance — `AdminGuard` de FE (`app/(admin)/layout.tsx`) y de backend, sin cambios (ver `design.md` §Context) |
| AC-10 | Trazabilidad quién/cuándo/resultado | T5.1, T5.2 (superficie — `OrderStatusHistory` ya renderiza `status_history` sin cambios) |

## Pre-requisitos

- [x] **T0.1 — `apps/web` limpio antes de empezar**
  - **Exit criterion**: no hay cambios sin commitear en
    `apps/web/src/features/orders/`, `apps/web/src/lib/observability/events.ts`
    de otra sesión en vuelo en **este** worktree.
  - **Verify**: `git status --porcelain apps/web/src/features/orders apps/web/src/lib/observability/events.ts` vacío

- [x] **T0.2 — El cliente generado ya tiene `cancelOrder`/`CancelOrderResponse` (regenerado por el orquestador, no por este change)**
  - **Exit criterion**: `apps/web/src/api/generated/endpoints.ts` exporta
    `cancelOrder`; `apps/web/src/api/generated/zod.ts` exporta el schema
    `CancelOrderResponse`; `apps/web/src/api/generated/model/cancelOrderResponse.ts`
    existe.
  - **Verify**: `grep -q "export const cancelOrder " apps/web/src/api/generated/endpoints.ts && grep -q "^export const CancelOrderResponse " apps/web/src/api/generated/zod.ts && test -f apps/web/src/api/generated/model/cancelOrderResponse.ts`

## Fase 1 — Contrato: verificar que el cliente generado sigue vigente

- [x] **T1.1 — `pnpm --filter @dsm/web codegen` no produce diff (gate `frontend-codegen-fresh`)**
  - **Pattern**: verificación de frescura, no regeneración — el orquestador
    ya corrió el codegen antes de este plan (`openapi-client-codegen`, skill
    — "nunca a mano"); esta task sólo confirma que `apps/api/docs/api/openapi.yaml`
    (publicado por el backend, T9.2 de su change) y lo ya generado en
    `apps/web/src/api/generated/` siguen sincronizados.
  - **Exit criterion**: correr `codegen` de nuevo no modifica ningún archivo
    bajo `apps/web/src/api/generated/`.
  - **Verify**: `pnpm --filter @dsm/web codegen && git status --porcelain apps/web/src/api/generated/` vacío

## Fase 2 — Repositorio (`ordersService.cancel`)

- [x] **T2.1 — `ordersService.cancel(id)`**
  - **Pattern**: mismo shape que `anonymize(id)` (una operación generada +
    `parseContract`), con el alias de import que resuelve la colisión de
    nombres `CancelOrderResponse` (Zod vs tipo) — `per design.md §D1`:
    ```ts
    import { cancelOrder } from '@/api/generated/endpoints';
    import { CancelOrderResponse as CancelOrderResponseSchema } from '@/api/generated/zod';
    import type { CancelOrderResponse } from '@/api/generated/model';
    // ...
    async cancel(id: string): Promise<CancelOrderResponse> {
      const res = await cancelOrder(id);
      return parseContract(CancelOrderResponseSchema, res.data);
    },
    ```
  - **Exit criterion**: `ordersService.cancel` existe, tipado con
    `CancelOrderResponse` (el tipo del model, no el schema), y la llamada de
    red pasa por la operación **generada** (F48) — nunca `fetch`/`axios`
    crudo.
  - **Verify**: `pnpm --filter @dsm/web exec tsc --noEmit`

- [x] **T2.2 — `ordersService.test.ts` — caso `cancel`**
  - **Exit criterion**: un test nuevo en el archivo existente cubre el
    happy path (`POST /v1/admin/orders/{id}/cancel` responde 200 con
    `CancelOrderResponse` completo) y valida que `ordersService.cancel`
    devuelve el objeto parseado (no lanza) — mismo estilo que los casos
    `list`/`get`/`updateStatus`/`anonymize` ya presentes en ese archivo.
  - **Verify**: `pnpm --filter @dsm/web vitest run src/features/orders/ordersService.test.ts`

## Fase 3 — `OrderCancelAction` (componente base + gating)

- [x] **T3.1 — Componente base: gate de visibilidad + apertura del `ConfirmDialog`**
  - **Pattern**: calcado a `OrderAnonymizeAction.tsx` (gate de visibilidad
    temprano con `return null`, estado local `confirmOpen`/`busy`/`message`/
    `error`, `ConfirmDialog` reusado sin modificar) — `per design.md §D3, §D6, §D7`:
    ```tsx
    if (order.status === 'delivered' || order.status === 'cancelled') return null;
    // ...
    <ConfirmDialog
      open={confirmOpen}
      title="Cancelar orden"
      description="Se reintegra el stock de cada ítem, se gestiona el reembolso del pago y el comprador recibe un aviso por email. Esta acción no se puede deshacer."
      confirmWord="CANCELAR"
      confirmLabel="Cancelar orden"
      onConfirm={() => void confirm()}
      onCancel={() => setConfirmOpen(false)}
      busy={busy}
    />
    ```
  - **Exit criterion**: con `order.status='delivered'` o `'cancelled'`, el
    componente no renderiza nada; con `order.status='new'`/`'preparing'`/
    `'ready'`, renderiza el botón "Cancelar orden" y, al click, abre el
    diálogo con el copy exacto de arriba.
  - **Verify**: `pnpm --filter @dsm/web vitest run src/features/orders/OrderCancelAction.test.tsx -t "T3.1"`

- [x] **T3.2 — Wiring de la mutación: éxito con mensaje según `refund.status`**
  - **Pattern**: `per design.md §D2, §D4` — reconciliación directa (sin
    segundo `GET`, a diferencia de `OrderAnonymizeAction`) porque
    `CancelOrderResponse` ya es self-contained:
    ```ts
    const REFUND_MESSAGE: Record<CancelOrderResponseRefundStatus, string> = {
      refunded: 'Se canceló la orden y se reintegró el pago.',
      refund_pending: 'Se canceló la orden. El reembolso quedó en curso — el sistema lo reintenta automáticamente.',
      not_applicable: 'Se canceló la orden.',
    };
    async function confirm(): Promise<void> {
      setBusy(true); setError(null);
      track('order_cancel_attempted', { order_id: order.id });
      try {
        const cancelado = await ordersService.cancel(order.id);
        setConfirmOpen(false);
        setMessage(REFUND_MESSAGE[cancelado.refund.status]);
        track('order_cancel_succeeded', { order_id: order.id });
        onCancelled(cancelado);
      } catch (err) { /* T4.2/T4.3 */ } finally { setBusy(false); }
    }
    ```
  - **Exit criterion**: en éxito, el diálogo se cierra, se llama
    `onCancelled` con el objeto devuelto por el backend, y el mensaje
    `role="status"` distingue los 3 valores de `refund.status`.
  - **Verify**: `pnpm --filter @dsm/web vitest run src/features/orders/OrderCancelAction.test.tsx -t "T3.2"`

- [x] **T3.3 — El botón de confirmar queda deshabilitado hasta tipear "CANCELAR"**
  - **Exit criterion**: con el diálogo abierto y el campo vacío, el botón
    "Cancelar orden" del diálogo está deshabilitado; al tipear el texto
    exacto "CANCELAR" (mayúsculas), se habilita — comportamiento heredado de
    `ConfirmDialog`, este test verifica el wiring correcto de `confirmWord`.
  - **Verify**: `pnpm --filter @dsm/web vitest run src/features/orders/OrderCancelAction.test.tsx -t "T3.3"`

## Fase 4 — Errores + idempotencia visual

- [x] **T4.1 — Mensajes de error: 409 (específico) vs 404/network/500 (genéricos)**
  - **Pattern**: `per design.md §D5` — `isAppError(err, 'conflict')` primero
    (mensaje específico), luego `isAppError(err, 'notFound')` (mismo copy que
    `OrderAnonymizeAction`), default genérico:
    ```ts
    setError(
      isAppError(err, 'conflict')
        ? 'La orden ya no puede cancelarse (por ejemplo, si ya fue entregada).'
        : isAppError(err, 'notFound')
          ? 'La orden ya no existe.'
          : 'No se pudo cancelar. Reintentá.',
    );
    ```
  - **Exit criterion**: un 409 (`dsm:payments/order-cannot-be-cancelled`)
    muestra el mensaje específico; un 404 muestra "La orden ya no existe.";
    un 500/network muestra el genérico. En los 3 casos el diálogo **permanece
    abierto** (mismo criterio que `OrderAnonymizeAction`).
  - **Verify**: `pnpm --filter @dsm/web vitest run src/features/orders/OrderCancelAction.test.tsx -t "T4.1"`

- [x] **T4.2 — Idempotencia visual: doble-click no dispara un segundo `POST`**
  - **Pattern**: calcado al test equivalente de `OrderAnonymizeAction.test.tsx`
    ("idempotencia visual") — `per frontend-resilience-patterns` #3/#4/#9,
    `design.md §Context` (F51): `server.use` con una promesa que no resuelve
    hasta que el test la libera; el botón de confirmar queda `disabled`
    mientras `busy=true`; segundo click no incrementa el contador de
    llamadas al handler.
  - **Exit criterion**: con la mutación en curso, un segundo click sobre el
    botón de confirmar no dispara una segunda llamada HTTP.
  - **Verify**: `pnpm --filter @dsm/web vitest run src/features/orders/OrderCancelAction.test.tsx -t "T4.2"`

- [ ] **T4.3 — `Escape` cancela sin llamar al servicio; foco entra al input al abrir**
  - **Pattern**: calcado a los dos tests equivalentes de
    `OrderAnonymizeAction.test.tsx` ("foco y Escape del ConfirmDialog
    reusado") — comportamiento 100% heredado de `ConfirmDialog`, este test
    verifica que `OrderCancelAction` no interfiere con él.
  - **Exit criterion**: `Escape` con el diálogo abierto lo cierra sin invocar
    `ordersService.cancel`; al abrir el diálogo, el foco entra al input de
    confirmación.
  - **Verify**: `pnpm --filter @dsm/web vitest run src/features/orders/OrderCancelAction.test.tsx -t "T4.3"`

## Fase 5 — Wiring en `OrderDetail`

- [ ] **T5.1 — Montar `<OrderCancelAction>` junto a `OrderStatusActions`**
  - **Pattern**: `per design.md §D8` — reusa el mismo `onConfirmed` que ya
    reconcilia el estado local:
    ```tsx
    <OrderCancelAction
      order={{ id: order.id, status: order.status }}
      onCancelled={onConfirmed}
    />
    ```
  - **Exit criterion**: `OrderDetail` importa y renderiza `OrderCancelAction`
    inmediatamente después de `OrderStatusActions`, pasándole `onCancelled={onConfirmed}`
    — compila sin errores de tipos (el comportamiento observable se prueba en
    T5.2, que corre a continuación sobre el mismo archivo).
  - **Verify**: `pnpm --filter @dsm/web exec tsc --noEmit`

- [ ] **T5.2 — `OrderDetail.test.tsx` — visibilidad condicional + reconciliación**
  - **Exit criterion**: con la orden en `new`/`preparing`/`ready`, el botón
    "Cancelar orden" es visible; con `delivered`, NO es visible; tras invocar
    la mutación con éxito, `OrderStatusHistory` muestra la fila nueva
    (`to_status='cancelled'`) sin un segundo `GET` a
    `/v1/admin/orders/{id}` (AC-10, superficie).
  - **Verify**: `pnpm --filter @dsm/web vitest run src/features/orders/OrderDetail.test.tsx`

## Fase 6 — Observabilidad (eventos + a11y)

- [ ] **T6.1 — 3 literales nuevos en `BusinessEvent`**
  - **Pattern**: agregar al bloque comentado "Panel de fulfillment (US-012)"
    en `apps/web/src/lib/observability/events.ts`, mismo criterio sin PII
    que `order_status_change_*`/`order_anonymize_*` (sólo `order_id`):
    ```ts
    | 'order_cancel_attempted'
    | 'order_cancel_succeeded'
    | 'order_cancel_failed';
    ```
  - **Exit criterion**: los 3 literales existen en el tipo `BusinessEvent`;
    ninguno se agrega a `PUBLIC_EVENTS` (son de backoffice, van con
    `operator_id: 'admin'` por defecto).
  - **Verify**: `pnpm --filter @dsm/web exec tsc --noEmit`

- [ ] **T6.2 — `orders.events.test.tsx` — caso `OrderCancelAction`, sin PII**
  - **Pattern**: calcado al caso `OrderAnonymizeAction` ya presente en ese
    archivo — usa `buyer_name`/`buyer_email` "centinela" (valores
    reconocibles) y falla si aparecen en el volcado JSON de los eventos
    capturados.
  - **Exit criterion**: `order_cancel_attempted` se emite antes del `POST`;
    `order_cancel_succeeded` se emite al confirmar (nunca `order_cancel_failed`
    en el mismo flujo); el volcado de props no contiene el nombre/email
    centinela del comprador.
  - **Verify**: `pnpm --filter @dsm/web vitest run src/features/orders/orders.events.test.tsx -t "OrderCancelAction"`

- [ ] **T6.3 — `a11y.test.tsx` — `OrderDetail` con "Cancelar orden" visible, sin violaciones serious/critical**
  - **Pattern**: nuevo `it` en el `describe` existente, mismo helper
    `auditar` (axe con `region` deshabilitada) que los 3 casos ya presentes.
  - **Exit criterion**: `OrderDetail` con una orden `new`/`preparing`/`ready`
    (botón "Cancelar orden" visible) no tiene violaciones axe-core
    `serious`/`critical`.
  - **Verify**: `pnpm --filter @dsm/web vitest run src/features/orders/a11y.test.tsx`

## Fase 7 — Pre-merge

- [ ] **T7.1 — Suite completa de `apps/web` verde + lint + typecheck**
  - **Exit criterion**: lint, typecheck y la suite completa de `apps/web`
    pasan sin fallos ni skips inesperados.
  - **Verify**: `pnpm --filter @dsm/web lint && pnpm --filter @dsm/web exec tsc --noEmit && pnpm --filter @dsm/web vitest run`

## Verification (suite-level)

- [ ] Todos los tests del feature `orders` pasan:
      `pnpm --filter @dsm/web vitest run src/features/orders/`
- [ ] Lint / typecheck limpios:
      `pnpm --filter @dsm/web lint && pnpm --filter @dsm/web exec tsc --noEmit`
- [ ] Codegen sigue fresco (gate `frontend-codegen-fresh`):
      `pnpm --filter @dsm/web codegen && git status --porcelain apps/web/src/api/generated/` vacío
- [ ] Ningún `fetch`/`axios` crudo en el archivo nuevo ni en el servicio
      (ambos deben pasar exclusivamente por las operaciones **generadas**,
      F48): `! grep -nE "fetch\(|axios\." apps/web/src/features/orders/OrderCancelAction.tsx apps/web/src/features/orders/ordersService.ts` (exit 0 = ninguna coincidencia; ninguno de los dos archivos llama `customFetch` directamente, sólo las operaciones generadas que lo envuelven)
