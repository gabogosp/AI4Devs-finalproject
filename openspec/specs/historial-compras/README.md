# Capacidad: Historial de compras (CAP-8)

**Estado**: backend entregado — lectura del historial del cliente autenticado + el
escritor de `orders.customer_id` en el checkout. Nace de
`US-015-historial-compras-backend` (mergeada, PR #70/#71). El FE
(`US-015-historial-compras-frontend-web`, mergeada, PR #74) todavía no archivó al
momento de escribir esta sección — se suma en el próximo `/archive-change`.

Estado declarado del sistema para la capacidad CAP-8 del PRD §2.1 cap. 8. Este directorio
es el **acumulado** de los changes archivados: se extiende en cada `/archive-change`,
nunca se reescribe.

## Por qué esta capacidad no existía todavía

`orders.customer_id` está en el DER (E2E §8) desde `US-008-checkout-guest-backend`, pero
ese change lo dejó **sin escritor**: el checkout de US-008 es 100% guest, y el comentario
del propio modelo `Order` diferís explícitamente la "fusión invitado↔cuenta" a esta US. Sin
un escritor, la premisa de US-015 ("un cliente logueado ve sus compras") no tenía forma de
cumplirse — cualquier orden nacía con `customer_id = null` sin importar quién estuviera
logueado al comprar.

## Qué está vivo hoy

Dos superficies nuevas, ninguna con módulo propio dedicado (viven en `checkout/` y
`orders/`, que ya existían):

- **El escritor** — `OptionalCustomerGuard` (nuevo, `apps/api/src/auth/`), aplicado a
  `CheckoutController.create`. Resuelve la sesión del cliente **si existe** vía
  `resolveCustomerSession()` (función pura, extraída de `CustomerGuard` por Extract
  Method, behavior-preserving — el guard fail-closed original no cambió su
  comportamiento). Sin sesión, el checkout funciona exactamente igual que antes de esta
  US (guest, `customer_id` sigue `null`). Aditivo puro: probado con los 12 archivos de
  test de `US-008-checkout-guest-backend` sin una sola aserción modificada.
- **El lector** — `GET /v1/me/orders` (listado paginado, `-created_at`, excluye
  `pending_payment`) + `GET /v1/me/orders/{order_number}` (detalle: ítems, cantidades,
  precios, estado, retiro). Superficie de **cliente**, distinta de `admin-orders`
  (capacidad `ordenes`, panel del dueño) aunque leen las mismas tablas — nunca expone el
  UUID interno de la orden ni datos de contacto del comprador.
- **Autorización estructural**: `customer_id` + la ventana de retención (12 meses,
  PRD §6, mismo cálculo que `OrdersRetentionService` de US-021 vía
  `computeRetentionCutoff()` compartido) se verifican en la misma consulta que resuelve
  la orden — nunca un chequeo posterior. Un `order_number` ajeno o fuera de retención
  responde 404, indistinguible de "no existe" (IDOR, `threat-modeling-lite`).
- **Índice compuesto** `orders(customer_id, created_at)` (migración aditiva, reemplaza
  el de una sola columna) — mismo patrón que `PasswordResetToken` ya usa en el schema.

## Contrato publicado con un follow-up dedicado (gap conocido, ya cerrado)

El `tasks.md` de `US-015-historial-compras-backend` sólo verificaba que los 2 yaml draft
(`list-order-history.yaml`, `get-order-history-detail.yaml`) lintearan limpio — nunca los
mergeaba al `apps/api/docs/api/openapi.yaml` publicado, que es la única fuente que lee
`orval` (codegen del FE). Mismo patrón de gap ya visto en
`US-021-retencion-datos-ordenes-backend` (ver `decisions.md`). Se cerró en un change
chico dedicado, `fix/US-015-publish-order-history-contract` (PR #71), antes de planificar
el FE — sin él, el codegen no podía generar el cliente tipado.

## Qué verificó QA

Suite QA-owned (`US-015-historial-compras-qa`), Layer 1 (backend-aislado) — el E2E
cross-stack (Layer 3) queda diferido a que exista el FE (resuelto después por PR #74; el
Layer 3 en sí sigue como candidato de follow-up, no construido en este QA change):

- **Aceptación BDD** (Cucumber-js + supertest, `historial-compras.feature`): 16/16
  escenarios verdes (78/78 steps) — cubre los 7 AC de la US, con foco en negative-space
  (sin sesión, detalle ajeno/IDOR, guest con mismo email no se vincula, retención en el
  borde exacto, `pending_payment` excluida, orden anonimizada sigue visible por default).
  Sin regresión en las suites QA ya existentes (`pago-manual`, `pago-webhook`,
  `retencion-ordenes`), cada escenario siembra su propia cuenta.
- **Contract testing**: 9/9 casos (`order-history.contract.ts`) contra los 2 endpoints
  nuevos — contra el contrato **publicado** en su momento (el backend todavía no estaba
  archivado cuando corrió esta suite; ver `design.md` del change QA §D-QA1), ahora
  coincide con el contrato **vivo** de esta misma capacidad.
- **Performance (k6)**: `GET /v1/me/orders` — budget `p95 < 300ms` (US §9, heredado del
  PRD §4); medido **p95 = 3.29ms**, `http_req_failed` 0%, checks 100%.
- **Exploratorio**: 1 charter escrito (`qa/exploratory/us-015-historial-compras.md`) —
  ejecución queda como checklist humano.

**E2E cross-stack (Layer 3)**: diferido explícitamente por el propio plan de QA (§D-QA2)
porque la UI no existía al planificar — el FE ya aterrizó (PR #74), así que queda como
candidato real de follow-up, no como trabajo pendiente de este archive.

## Extiende `checkout` (CAP-10)

Esta capacidad no reemplaza nada de `checkout` — le agrega un escritor opcional sin
cambiar su contrato público (`POST /v1/checkout` sigue respondiendo exactamente igual).
Ver la fila nueva en `openspec/specs/checkout/decisions.md` ("Desde US-015 backend").
