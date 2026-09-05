# Capacidad: Panel de fulfillment del dueño (CAP-5)

**Estado**: superficie de **backend** viva (panel admin de órdenes pagadas); **UI del
panel** construida en `US-012-panel-ordenes-dueno-frontend-web` (PR #22 + #31, mergeados
a `main`) pendiente de su propio `/archive-change`.

Estado declarado del sistema para la capacidad CAP-5 del PRD §2.1. Este directorio es el
**acumulado** de los changes archivados: se extiende en cada `/archive-change`, nunca se
reescribe.

## Por qué esta capacidad no existía todavía

`US-010-orden-webhook-stock-backend` iba a inaugurarla originalmente (confirmación de
pago, webhook de stock, y de ahí el árbol `src/orders/`), pero quedó indefinidamente
pospuesta (US-009 `Blocked`, sin credenciales de MercadoPago). `US-012-panel-ordenes-dueno-backend`
la inaugura en su lugar: diseñada sobre lo que **existe de verdad** (la orden que crea
`checkout` — CAP-10 — más lo que este panel necesita), sin depender de artefactos que
US-010 nunca construyó (ports genéricos, FSM de 6 estados compartida).

## Qué está vivo hoy

Panel admin de fulfillment sobre las órdenes ya pagadas (US-012 backend):

- `GET /v1/admin/orders` — listado paginado/ordenable/filtrable de las órdenes en los 4
  estados activos de fulfillment (`new`/`preparing`/`ready`/`delivered`) — **nunca**
  `pending_payment`/`cancelled` (AC-1, AC-5, AC-8, garantía de negocio, no de schema).
- `GET /v1/admin/orders/{id}` — detalle con ítems, contacto del comprador, retiro e
  historial de transiciones (AC-2, AC-9). `404` si la orden es `pending_payment`
  (AC-8); `cancelled` sí responde 200 (defensivo, trazable por id aunque no haya hoy
  ningún flujo que la enumere).
- `PATCH /v1/admin/orders/{id}` — avanza **un** paso de la FSM propia de fulfillment
  (4 estados activos, no la FSM completa de 6): `new→preparing→ready→delivered`.
  `cancelled` nunca es un valor de tipo válido acá (US-013, ruta distinta). Idempotente
  **por estructura** (un `UPDATE` condicional `WHERE status=$from`), no por
  `Idempotency-Key` almacenada — el header se acepta y se ignora. `status=ready` dispara
  `NotificationPort.orderReadyForPickup` (AC-4, seam — la entrega real es
  `Deferred: US-011 — owner: BE`).
- Cada transición que el dueño ejecuta en fulfillment queda registrada en
  `order_status_history` (`from_status`, `to_status`, `changed_by`, `changed_at`),
  transaccional con el `UPDATE` de estado — trazabilidad consultable (AC-9). La
  transición inicial `pending_payment → new` **no** entra acá — la escribe
  `payments/` (US-023, capacidad hermana `pagos`).
- **El backend es la autoridad real** de AC-6 (transición inválida bloqueada), AC-7
  (acceso restringido) y AC-8 (sólo pagadas) — la UI es UX, nunca el mecanismo de
  seguridad. `AdminGuard` en los tres endpoints; FSM server-side propia
  (`order-state.ts`) rechaza cualquier salto inválido con `409`, sin importar qué haya
  mostrado el cliente.

Una **UI del panel** construida sobre esta superficie (US-012 frontend-web, PR #22 +
#31) — listado, detalle, avanzar estado con UI optimista, y el
`PendingPaymentsPanel` de pendientes de pago — todavía no atravesó su propio
`/archive-change`; este documento se extiende cuando lo haga.

## Qué NO está vivo todavía

- **UI del panel** — construida y mergeada (US-012 frontend-web), pero sin archivar.
- **Cancelación / reintegro de stock** — US-013.
- **Métricas agregadas / gráficos del panel** — US-016.
- **FSM de 6 estados completa** (`pending_payment`/`cancelled` incluidos) — sólo se
  gestionan acá las 4 transiciones activas de fulfillment.
- **Reconciliación con `US-010-orden-webhook-stock-backend`** — indefinidamente
  pospuesta; si se retoma, hay que revisar contra lo que este panel ya construyó (ver
  `decisions.md` "Riesgo de reconciliación").
- **Notificación real al cliente** ("lista para retirar") — el seam
  (`NotificationPort.orderReadyForPickup`) existe y se invoca; el adaptador real
  (Resend u otro proveedor) es US-011.

## Contratos

El contrato vivo de la superficie REST está en [`contracts/openapi.yaml`](contracts/openapi.yaml):
raíz con `info`/`servers`/`security` y los `components/schemas` propios, más un archivo
por path bajo [`contracts/openapi/paths/`](contracts/openapi/paths/) referenciado por
`$ref`. Un path, una operación:

| Endpoint | Métodos | AC |
|---|---|---|
| `/admin/orders` | GET | AC-1, AC-5, AC-8 |
| `/admin/orders/{id}` | GET, PATCH | AC-2, AC-3, AC-4, AC-6, AC-8, AC-9 |

**Capacidad hermana, no anidada**: `GET /v1/admin/orders/pending-payment` (misma base
de ruta) pertenece a `US-023-pago-manual-offline-backend`, capacidad `pagos` — no vive
en este directorio. La colisión de rutas entre los dos módulos se resolvió restringiendo
`:id` a forma UUID en el path de Nest (`decisions.md`), independiente del orden de merge
entre ambos changes.

## Changes que formaron esta capacidad

| Change | Disciplina | Aporte |
|---|---|---|
| [`US-012-panel-ordenes-dueno-backend`](../../changes/archive/US-012-panel-ordenes-dueno-backend/) | BE | `OrdersModule`, `order_status_history`, FSM de fulfillment (4 estados), `NotificationPort`, los 3 endpoints admin |
| [`US-012-panel-ordenes-dueno-frontend-web`](../../changes/US-012-panel-ordenes-dueno-frontend-web/) | FE | Listado, detalle, avanzar estado con UI optimista, `PendingPaymentsPanel`. Mergeado (PR #22 + #31), pendiente `/archive-change` propio |
| [`US-012-panel-ordenes-dueno-qa`](../../changes/archive/US-012-panel-ordenes-dueno-qa/) | QA | Suite cross-stack: aceptación BDD (13), E2E de navegador (5), accesibilidad (5), carga (2), charters (2) — 24/24 verdes |

## Estado de la provisión

La capacidad corre hoy en **entorno local** (`docker-compose`). La provisión de nube
(Railway/Neon/Cloudflare) es **US-019**, gated en dependencias externas.
