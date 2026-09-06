---
tracker-id: null
tracker-source: null
parent-us: US-021
discipline: frontend-web
variant: null
language: es
---

# US-021 Frontend Web — Design

## Context

`apps/web` es una app Next.js 15 (App Router) — confirmado por `apps/web/app/(admin)/...`
(no `apps/web/src/app`, que sólo contiene un test colocado con import relativo al `app/`
real). Aplica `frontend-standards.md` + el overlay `frontend-next-standards.md`. No hay
`project-config.yml` en el repo; el stack se resolvió inspeccionando el código (per
instrucción de la tarea), no asumiéndolo.

El panel de órdenes (`apps/web/src/features/orders/`) ya existe, construido por US-012 y
extendido por el flujo de pagos manuales (US-023 FE). Este change es una extensión de ese
mismo módulo: no se abre ningún módulo nuevo, se sigue el mismo criterio que el propio
backend aplicó (extender `checkout/` en vez de abrir un módulo admin dedicado, porque el
dueño natural — el panel — ya existe del lado FE).

**No hay Figma** (US §8) — hereda de `docs/product/design-system.md` §7.5 (Modal/Dialog
destructivo), §7.6 (Toast — ver nota de convención real abajo), §7.7 (Badge), §7.9 (Table),
§10.2 (tono). Aplica la skill `fe-design-without-figma`.

### El gap de contrato (detalle completo — ver también proposal.md)

Dos huecos confirmados por lectura directa de código, no supuestos:

1. **`apps/api/docs/api/openapi.yaml`** (el contrato que `orval.config.ts` apunta como
   `CONTRACT`, el único que el codegen del panel puede leer) no incluye
   `/admin/orders/{id}/anonymize` ni `/admin/orders/retention-sweep`. Verificado con
   `git log --oneline -- apps/api/docs/api/openapi.yaml` — el último touch es el merge del
   FE de US-012 (`4f44c42`); ningún commit de US-021 backend (PR #41) lo tocó, y su
   `tasks.md` no tiene ninguna task de publicación (a diferencia de casi todos los changes
   de backend anteriores — US-006/007/008/012/014/023 — que sí la tienen, per
   `documentation-standards.md` §4/§8/§11, "el change que modifica una API actualiza
   AMBOS" contratos, el de `openspec/specs/` y el publicado del servicio).
2. **`AdminOrderDetail`** (schema en `openspec/specs/ordenes/contracts/openapi.yaml` línea
   ~101, y su DTO real `apps/api/src/orders/dto/order.dto.ts`
   `AdminOrderDetailDto.fromWithHistory`) no expone `anonymized_at`/`anonymization_reason`.
   `apps/api/src/checkout/README.md` §"Retención y anonimización (US-021)" lo declara
   explícitamente: *"su DTO de lectura de orden todavía no expone
   anonymized_at/anonymization_reason... agregarlos al DTO es tarea de esa US, no de
   esta"* — pero la nota apunta a "quien planifique US-012", y **US-012 backend ya se
   construyó** (PR #22, antes de que existiera esta nota) sin saberlo. Es un hueco real y
   huérfano, no una tarea pendiente con dueño claro.

**Por qué esto bloquea más que "el badge"**: `frontend-standards.md` §3.2 es explícito y sin
excepción — "Forbidden — the ideally codegen, else hand-write escape hatch". No existe una
versión legítima de este change que hand-escriba el DTO/Zod/mock de `anonymizeOrder` "hasta
que el backend lo publique". La única salida conforme a estándar es (a) que el contrato se
publique primero, o (b) que este change quede con esa porción de tasks explícitamente
bloqueada y documentada — se elige (b) más una recomendación fuerte de resolver (a) cuanto
antes, porque el fix es mecánico (copiar 2 archivos yaml ya escritos y aprobados + 2 campos
opcionales en un DTO que ya tiene los datos en memoria).

## Goals

- AC-3: acción "Anonimizar datos del comprador" en `OrderDetail`, confirmación de dos pasos.
- AC-4: la orden anonimizada muestra `anonymized_at` + de qué motivo (`retention_policy` vs
  `requested`) en una etiqueta legible.
- AC-5: el resto del detalle (ítems, importes, estado, fechas, historial) se sigue
  renderizando exactamente igual; sólo la sección de contacto cambia su contenido.
- AC-9 (FE): confirmar que no hace falta ningún guard nuevo — `AdminGuard` ya cubre toda la
  route`(admin)`.
- Idempotencia visual (AC-8): la acción desaparece (no se deshabilita con apariencia de que
  "podría" volver a hacer algo) una vez que la orden está anonimizada.

## Non-goals

- Publicar el contrato del backend (`apps/api/docs/api/openapi.yaml`) — recomendado como
  follow-up de backend, no ejecutado por este change (fuera del rol de este agente).
- UI para `POST /v1/admin/orders/retention-sweep` — ver "Fuera de alcance" en proposal.md.
- Indicación de "anonimizada" en `OrdersList` (listado) — `AdminOrderSummary` no la necesita
  ni la expone; AC-5 habla del detalle.
- Tocar `AdminGuard`, `adminSession`, o cualquier pieza de autenticación — AC-9 (FE) ya está
  resuelta por código existente.

## Approach

### Servicio — `ordersService.anonymize` (BLOQUEADO hasta T0.1)

```ts
// apps/web/src/features/orders/ordersService.ts — método nuevo, agregado
// AL LADO de `get`/`updateStatus` (mismo archivo, mismo patrón: la operación
// de red sale del cliente GENERADO, nunca de un fetch a mano — F48).
async anonymize(id: string): Promise<AdminOrderDetail> {
  const res = await anonymizeOrder(id); // <- import de '@/api/generated/endpoints',
                                         //    NO existe todavía: nace cuando T0.1
                                         //    (contrato publicado) esté resuelto y
                                         //    se regenere `pnpm --filter @dsm/web codegen`.
  return parseContract(AnonymizeOrderResponse, res.data); // Zod GENERADO, mismo patrón que `get`
}
```

**Decisión explícita de shape de retorno**: `POST /anonymize` responde
`OrderAnonymizationResult` (`{ order_id, anonymized_at, anonymization_reason }`), no el
`AdminOrderDetail` completo. La UI necesita el detalle completo actualizado (para no perder
`items`/`status_history` que ya tiene en memoria) — el patrón es el mismo que
`OrderStatusActions`: la mutación exitosa dispara un **segundo** `GET /admin/orders/{id}`
(refetch-on-success, igual que `PendingPaymentsPanel`, no UI optimista — ver
"Patrones de resiliencia" abajo) en vez de intentar reconstruir el objeto completo a mano
desde una respuesta parcial. `ordersService.anonymize` devuelve el resultado parcial;
`OrderAnonymizeAction` es quien decide refetchear.

### Componente — `OrderAnonymizeAction`

```
Pattern: mismo esqueleto que `apps/web/src/features/products/ProductActions.tsx`
(archivar producto) — `ConfirmDialog` + `role="status"`/`role="alert"` inline, sin
UI optimista (a diferencia de `OrderStatusActions`, que sí es optimista porque
resuelve una carrera entre pestañas que acá no existe: nadie "compite" por
anonimizar la misma orden dos veces con apariencia de negocio distinto — es un
`WHERE anonymized_at IS NULL` de un solo actor, el dueño).
per frontend-standards.md §11.bis.5 — destructive action confirmation
```

```tsx
'use client';

export function OrderAnonymizeAction({
  order,
  onAnonymized,
}: {
  order: { id: string; anonymizedAt: string | null; anonymizationReason: 'retention_policy' | 'requested' | null };
  onAnonymized: (updated: OrderDetail) => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (order.anonymizedAt) return null; // AC-8: ya anonimizada — no se ofrece de nuevo

  async function confirm() {
    setBusy(true);
    setError(null);
    track('order_anonymize_attempted', { order_id: order.id });
    try {
      await ordersService.anonymize(order.id);
      const refreshed = await ordersService.get(order.id); // refetch — trae anonymized_at/reason
      setConfirmOpen(false);
      setMessage('Se anonimizaron los datos del comprador.');
      track('order_anonymize_succeeded', { order_id: order.id });
      onAnonymized(refreshed);
    } catch (err) {
      track('order_anonymize_failed', { order_id: order.id });
      setError(
        isAppError(err, 'notFound')
          ? 'La orden ya no existe.'
          : 'No se pudo anonimizar. Reintentá.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {error && <div role="alert">{error}</div>}
      {message && <div role="status">{message}</div>}
      <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
        Anonimizar datos del comprador
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        title="Anonimizar datos del comprador"
        description="Se van a reemplazar el nombre, el email y el teléfono del comprador por un valor genérico. Los productos, importes, estado y fechas de la orden NO cambian. Esta acción no se puede deshacer."
        confirmWord="ANONIMIZAR"
        confirmLabel="Anonimizar"
        onConfirm={() => void confirm()}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
```

**Copy** — sigue el tono §10.2 del design-system (mismo registro que "¿Seguro que querés
cancelar esta orden? Esta acción no se puede deshacer."): directo, sin jerga, explica qué
cambia y qué no.

### `OrderDetail.tsx` — sección de contacto condicional (AC-4/AC-5)

```tsx
<section aria-labelledby="orden-contacto-heading">
  <h3 id="orden-contacto-heading" className="font-medium">Datos de contacto</h3>
  {order.anonymized_at ? (
    <div className="flex flex-col gap-1 text-sm">
      <p className="text-muted">
        Los datos personales del comprador fueron anonimizados
        {' '}
        <time dateTime={order.anonymized_at}>{formatDateTime(order.anonymized_at)}</time>
        {' '}
        ({order.anonymization_reason === 'requested' ? 'a pedido del comprador' : 'por plazo de retención cumplido'}).
      </p>
    </div>
  ) : (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
      {/* ... nombre/email/teléfono, sin cambios ... */}
    </dl>
  )}
</section>

<OrderAnonymizeAction
  order={{ id: order.id, anonymizedAt: order.anonymized_at, anonymizationReason: order.anonymization_reason }}
  onAnonymized={onConfirmed}  // reusa el mismo setter que ya usa OrderStatusActions
/>
```

`Pattern: audit-trail surfacing (frontend-standards.md §11.bis.4) — se muestra "cuándo" y
"por qué motivo" junto al dato, no en un log separado; no hay AC que pida un log de
auditoría aparte, así que no se construye uno.`

`formatDateTime` — nuevo helper chico en `apps/web/src/lib/format/` (mismo patrón que
`formatArs` en `lib/format/currency.ts`), o reuso de un helper existente si ya hay uno para
`status_history` (`OrderStatusHistory.tsx` ya formatea `changed_at`; unificar en ese mismo
helper si existe, para no duplicar formato de fecha).

### `AdminOrderDetail` — tipos derivados del contrato (BLOQUEADO hasta T0.1)

Una vez publicados los 2 campos en `apps/api/docs/api/openapi.yaml` →
`openspec/specs/ordenes/contracts/openapi.yaml` (corrección de contrato, T0.2 más abajo),
`anonymized_at`/`anonymization_reason` llegan **generados** en `AdminOrderDetail`
(`@/api/generated/model`) sin ningún tipo escrito a mano — `ordersService.ts` ya re-exporta
`AdminOrderDetail as OrderDetail`, así que `OrderDetail.tsx` los recibe gratis por el mismo
`export type`.

### Patrones de resiliencia aplicados (`frontend-resilience-patterns`)

| # patrón | Aplicado |
|---|---|
| #9 Idempotencia | La acción no manda `Idempotency-Key` — el backend ya es idempotente por `WHERE anonymized_at IS NULL` (mismo razonamiento que documentó el backend design.md). Un doble-click no puede duplicar efecto porque, además, el botón desaparece apenas `busy` entra en curso (`disabled` implícito del `ConfirmDialog`, que ya deshabilita `onConfirm` mientras no coincide el texto — se agrega `disabled={busy}` al botón de confirmar). |
| #10 Error boundary / manejo estructurado | `try/catch` con `AppError` tipado, igual que el resto del feature — no hay boundary nuevo, se reusa el de nivel de página si existe. |
| Refetch-on-success (no #4 optimista) | Deliberado: a diferencia de `OrderStatusActions`, no hay condición de carrera entre pestañas que la optimización resuelva, y una reversión visual de "ya anonimizado" a "no anonimizado" sería más confuso que esperar el refetch (la operación es rara — un dueño no la ejecuta seguido). |
| Cancelación | No aplica: el diálogo modal bloquea la navegación mientras está `busy` (no hay forma de "salir" a mitad de la mutación salvo cerrar la pestaña). |

### Observabilidad

Tres eventos nuevos en `apps/web/src/lib/observability/events.ts` (mismo `BusinessEvent`
union), sin PII — mismo criterio que `order_status_change_*`:

```ts
| 'order_anonymize_attempted'
| 'order_anonymize_succeeded'
| 'order_anonymize_failed'
```

Cada uno con `{ order_id }` únicamente — nunca `buyer_name`/`buyer_email`/
`anonymization_reason` (aunque `reason` no es PII, no aporta nada a la analítica del panel
y mantener la misma forma que los otros tres eventos de la orden evita que alguien agregue
"total_ars_cents" mañana pensando que ya hay precedente de más campos).

### Accesibilidad

- `ConfirmDialog` ya cumple foco al abrir, `Escape` cancela, `role="dialog"` + `aria-modal`
  (código existente, sin cambios).
- El botón "Anonimizar datos del comprador" es `variant="destructive"` (mismo componente
  `Button`, ya con área táctil ≥44px y foco visible — sin trabajo nuevo).
- La indicación de "datos anonimizados" es texto plano dentro de la misma `<section
  aria-labelledby="orden-contacto-heading">` que ya existe — no rompe la estructura de
  headings que ya pasa el test de a11y (`a11y.test.tsx`).
- Mensajes de resultado con `role="status"`/`role="alert"`, igual que el resto del panel —
  ya cubierto por el mismo patrón de auditoría axe-core que corre sobre `OrderDetail`.

## Trade-offs

- **No se agrega un componente `Badge` dedicado para "Anonimizada"**: el design-system
  §7.7 lista Badge para *estado de la orden* (nuevo/preparando/etc.), no para este caso. Se
  optó por una oración legible en la sección de contacto en vez de forzar el patrón de
  Badge a un dato que no es un estado de fulfillment — es más consistente con cómo
  `OrderStatusHistory` ya narra eventos de la orden como texto, no como badges. Si Diseño
  prefiere un Badge visual además del texto, es un cambio de UI menor, no estructural.
- **Refetch-on-success en vez de mergear la respuesta parcial a mano**: mergear
  `{ anonymized_at, anonymization_reason }` sobre el estado existente sin volver a pedir el
  detalle sería más rápido, pero el propio patrón ya usado por `OrderStatusActions`
  (`onConfirmed` reemplaza el objeto entero que trae el `PATCH`) no aplica acá porque el
  `POST /anonymize` NO devuelve el detalle completo (ver el contrato:
  `OrderAnonymizationResult`, no `AdminOrderDetail`) — mergear a mano sería reconstruir un
  objeto en el cliente en vez de confiar en la fuente de verdad del servidor. Se prefiere
  un segundo `GET` (ya existe `ordersService.get`, sin trabajo nuevo) sobre mergear a mano.
- **No se hand-escribe el DTO de `anonymizeOrder` como parche temporal.** Fue evaluado y
  rechazado explícitamente: viola `frontend-standards.md` §3.2 y reintroduce el riesgo que
  el propio comentario de `customFetch` describe (`POST /v1/admin/auth/login` sin backend
  real). Se prefiere bloquear la task y documentarlo.

## Plan de mitigación del bloqueo (para quien ejecute `/develop-frontend-web`)

Si al momento de ejecutar este change T0.1 sigue sin resolverse, **no** improvisar un mock
manual del cliente generado. Opciones válidas, en orden de preferencia:

1. Esperar a que el follow-up de backend (recomendado en proposal.md) publique el contrato,
   correr `pnpm --filter @dsm/web codegen`, y continuar con las tasks de la Fase 1 en
   adelante.
2. Si el negocio necesita esto antes de que backend lo resuelva, un desarrollador con
   contexto de backend puede aplicar el follow-up chico él mismo (es documentación + 2
   campos de DTO, no diseño nuevo) — pero eso está fuera del scope de este change
   (frontend-web) y de este agente.

## Spec delta (para `/archive-change`)

Este change no crea una capability nueva de `openspec/specs/` — extiende
`openspec/specs/ordenes/` (CAP-5, panel de fulfillment). El delta a aplicar al archivar:

- `openspec/specs/ordenes/contracts/openapi.yaml` — schema `AdminOrderDetail`: agregar
  `anonymized_at` (`string, format: date-time, nullable: true`) y `anonymization_reason`
  (`string, enum: [retention_policy, requested], nullable: true`). **Depende de que el
  backend ya los haya publicado** (T0.1) — si no, este delta no se puede aplicar
  honestamente y `/archive-change` debe fallar loud en vez de inventar el schema.

## Open questions

- Ver `proposal.md` §Open questions (el bloqueo de contrato es la única pregunta que
  bloquea ejecución; la de copy/legal no bloquea).

## References

- US: `docs/user-stories/US-021-retencion-datos-ordenes.md`
- Backend (código real, ya mergeado): `apps/api/src/checkout/orders-retention.controller.ts`,
  `orders-retention.service.ts`, `orders.repository.ts` (`anonymize`,
  `anonymizeRetentionEligible`), `dto/orders-retention.dto.ts`, `checkout/README.md`
- Backend (openspec, no archivado): `openspec/changes/US-021-retencion-datos-ordenes-backend/`
  (`design.md`, `contracts/openapi/anonymize-order.yaml`, `retention-sweep.yaml`)
- FE existente (US-012/US-023): `apps/web/src/features/orders/OrderDetail.tsx`,
  `OrderStatusActions.tsx`, `ordersService.ts`, `apps/web/src/features/products/ProductActions.tsx`
  (precedente de `ConfirmDialog`), `apps/web/src/components/ui/ConfirmDialog.tsx`
- Contrato vivo consumido hoy: `openspec/specs/ordenes/contracts/openapi.yaml`
- Contrato publicado (codegen, con el gap): `apps/api/docs/api/openapi.yaml`
- `apps/web/orval.config.ts`, `apps/web/src/lib/http/client.ts` (mutator `customFetch`, F48)
- Design system: `docs/product/design-system.md` §7.5/7.6/7.7/7.9/§10.2
- Standards: `spekode/docs/code/frontend-standards.md` §3.2 (regla de codegen sin excepción),
  §11.bis.4, §11.bis.5
