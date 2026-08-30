---
tracker-id: null
tracker-source: null
parent-us: US-012
discipline: qa
variant: null
language: es
audit-derived: false
---

# US-012 QA — Panel de órdenes del dueño: suite cross-stack

## Why

US-012 es la mitad "el dueño prepara y entrega" del loop E2E del PRD (§9.4): sin este
panel, las órdenes que confirma el checkout (US-008, ya mergeado) quedan sin nadie que
las gestione. A diferencia de los tres changes de QA anteriores (US-002, US-007, US-014),
que se planificaron con el backend correspondiente **ya construido** (o, en el caso de
US-007, con el backend construido y solo el FE pendiente), acá **ninguna de las dos
capas dev existe todavía**: `US-012-panel-ordenes-dueno-backend` y
`US-012-panel-ordenes-dueno-frontend-web` están planificados (proposal/design/tasks
completos) pero con **0 tasks ejecutadas cada uno**, en el mismo PR #22 de este mismo
branch.

Esto no es un obstáculo para planificar QA — es la misma lógica que US-007 ya aplicó a
su capa de navegador (escribirla antes de que el FE existiera, para que el FE se
construya contra criterios observables) extendida a **toda** la superficie de esta US,
porque acá las dos capas arrancan en cero a la vez. Todo escenario de este plan queda
`blocked_by` la construcción del change dev correspondiente — declarado explícitamente,
nunca disfrazado de ejecutable — salvo la planificación en sí.

Lo que ninguna capa dev-owned puede ver, porque vive fuera de su propio proceso o de su
propia fixture:

- **Que la orden que el dueño gestiona es la que un cliente realmente compró.** El
  backend de US-012 no arma sus propias órdenes de prueba para el caso feliz completo:
  las siembra directo con Prisma en el estado que necesita (`design.md` T8.4 del backend).
  Eso prueba la FSM y la autorización; no prueba que el panel refleja fielmente lo que
  `POST /v1/checkout` (US-008, ya mergeado) realmente registró — mismos ítems, mismo
  comprador, mismo total. Es la costura entre dos superficies (pública/checkout vs.
  admin/panel) que ningún test de un solo módulo compara.
- **Que una sesión válida de otro rol no alcanza.** El backend prueba "sin token" y "con
  rol no-admin" contra un JWT minteado en el propio test
  (`e2e-rbac.spec.ts`, `AdminGuard`). Lo que no prueba es que una **cuenta de cliente
  real**, registrada y logueada por el flujo real de US-014 (ya mergeado), sigue sin
  poder entrar — la diferencia entre "un token con un claim distinto" y "una sesión que
  el sistema realmente emitió para otro propósito".
- **La invariante de AC-8 contra el futuro.** US-013 (cancelación) y US-016 (métricas) se
  van a construir sobre este mismo módulo, y la reconciliación con
  `US-010-orden-webhook-stock-backend` (pospuesta, ver `design.md` del backend, decisión
  2) es una tensión estructural explícitamente no resuelta. El escenario que prueba "solo
  pagadas" tiene que sobrevivir a esos cambios sin que nadie lo tenga que recordar.
- **El seam de observabilidad compartido.** Este módulo emite eventos a
  `/v1/admin/metrics`, una superficie que otro change (`AUDIT-dsm-api-006`) ya construyó.
  Nadie en el backend de US-012 prueba esa costura porque no es su AC — pero si se rompe,
  el dueño pierde el insumo que US-016 va a necesitar.
- **Toda la mitad de UI de las 9 AC** contra un navegador real, con `AdminGuard` real y
  la tabla accesible por teclado que la US §9 pide por su nombre.

## What changes

- **Extensión del paquete `@dsm/qa`** — se reusan el world de aceptación, el fixture de
  auth admin real (`admin-auth.ts`), el fixture de cuentas de cliente real
  (`customer-auth.ts`, de US-014), `apiCall`, `builders.ts`, `thresholds.js` y los dos
  configs de Playwright. Se agrega **un seed hermano** (`seed-ordenes.ts`) con su smoke.
- **Aceptación BDD API-level** (Cucumber + Playwright): 13 escenarios en las 4 categorías
  canónicas — 5 happy, 2 corner, 3 negative-space, 3 cross-feature. **Bloqueados por el
  backend** (`US-012-panel-ordenes-dueno-backend`, 0 tasks).
- **E2E de navegador** (Playwright): 5 recorridos de la UI del panel. **Bloqueados por
  backend y frontend**, ambos sin construir.
- **Accesibilidad**: axe-core + navegación por teclado sobre `OrdersList`/`OrderDetail`.
  **Bloqueados por el frontend**.
- **Carga** (k6): dos escenarios — lectura del listado y escritura de la transición —
  contra los **dos números que la propia US fija en su §9** (`p95 lectura < 300ms` /
  `p95 escritura < 500ms`, heredados de PRD §4). A diferencia de US-007 (donde el NFR de
  lectura no tenía número ratificado), acá los dos números **ya están en la US**, así que
  ningún threshold queda sin emitir. **Bloqueados por el backend**.
- **Charters de exploratorio**: el panel en un día real de operación (bloqueado por el
  FE) y la reconciliación del ciclo completo cuando `US-023-pago-manual-offline-backend`
  aterrice (bloqueado por ambos backends hermanos).
- **`PendingPaymentsPanel` — coverage-awareness, no AC formal**: el plan de FE (Fase 12)
  agrega esta vista sin que exista un AC Gherkin ratificado en la US (ver su `proposal.md`
  OQ-FE-4). Este plan **no** le da tratamiento de AC×Gherkin completo — sería inventar una
  AC que no le corresponde a QA formalizar. `qa-plan.md` §9 documenta qué se planificó,
  por qué no tiene AC, y cómo lucirían sus escenarios QA-owned el día que se ratifique.

## ACs de la US cubiertos por este change

| AC | Cobertura QA (capa 3) | Nota |
|---|---|---|
| **AC-1** listado | TC-1201, TC-1220, TC-1240 | paginado/ordenable, contra el listado real |
| **AC-2** detalle | TC-1202, TC-1206, TC-1211, TC-1221 | ítems, contacto, retiro, y fidelidad contra el checkout real |
| **AC-3** avanzar estado | TC-1203, TC-1207, TC-1222, TC-1241 | ciclo completo + idempotencia + NFR de escritura |
| **AC-4** aviso al marcar "lista" | TC-1204, TC-1222 | el disparo del seam, no el envío (US-011) |
| **AC-5** filtrar por estado | TC-1205, TC-1220 | — |
| **AC-6** transición inválida bloqueada | TC-1208, TC-1223 | autoridad real del backend |
| **AC-7** acceso restringido | TC-1209, TC-1212, TC-1224 | sin sesión, con sesión de cliente real, y end-to-end |
| **AC-8** solo pagadas | TC-1206, TC-1210 | excluidas del listado, del detalle y de la transición |
| **AC-9** trazabilidad | TC-1203, TC-1207, TC-1213, TC-1221 | historial consultable + métricas + no-doble-efecto |

**Las 9 AC tienen ≥1 escenario QA definido.** Ninguno es ejecutable hoy — los dos changes
dev hermanos están en 0 tasks — pero los 13 escenarios de aceptación (capa API) se
desbloquean con solo el backend, sin esperar al frontend.

## Out of scope

- **Re-autoría de las capas dev-owned** (unit, integration, e2e-nest del backend; unit,
  component/RTL+MSW del frontend): son la TDD de cada disciplina. Se referencian como
  cobertura consciente en `qa-plan.md` §3, nunca se repiten.
- **`PendingPaymentsPanel` como AC formal** — ver "What changes" arriba y `qa-plan.md` §9.
  Este plan no tiene autoridad para crear un AC-10 por su cuenta.
- **Cancelación / reembolso** — US-013. La FSM de este panel no llega a `cancelled` desde
  el `PATCH`; el escenario C-1 verifica el caso defensivo (detalle visible por id), no la
  transición.
- **El envío del email en sí** (contenido, proveedor) — US-011.
- **El endgame de `US-010-orden-webhook-stock-backend`** — la tensión de reconciliación
  que el backend de US-012 deja flageada (su `design.md` decisión 2) no se resuelve acá.
- **Panel de métricas** — US-016. TC-1213 verifica solo que el contador se incrementa, no
  ningún dashboard.

## Open questions

- **OQ-QA-1 — Puente de siembra para alcanzar `new` sin `ConfirmOrderService`.** Hoy no
  existe ningún endpoint que mueva una orden de `pending_payment` a `new`: esa transición
  la escribe `ConfirmOrderService` de `US-023-pago-manual-offline-backend`, que también
  está en 0 tasks (worktree separado). Para sembrar datos realistas sin bloquear TODO
  este plan hasta que ese tercer change aterrice, `seed-ordenes.ts` hace el checkout real
  (`POST /v1/checkout`) y **puentea** el último paso con un `UPDATE` directo vía `@dsm/db`
  (ya es una devDependency de `@dsm/qa`) — documentado como deviación temporal en
  `design.md` §Aproximación. **A revisar cuando `US-023` aterrice**: reemplazar el puente
  por la llamada real a `POST /v1/admin/orders/{orderId}/confirm-payment`.
- **OQ-QA-2 — Coordinación cruzada con la QA de `US-023-pago-manual-offline-backend`.**
  El testing end-to-end completo de `PendingPaymentsPanel` (confirmar un pago manual desde
  el panel y verlo aparecer en el listado de fulfillment) necesita el plan de QA de
  `US-023`, que **no existe todavía** (worktree y sesión distintos). Este plan no lo
  inventa ni asume que "ya está cubierto en otro lado" — queda como punto de coordinación
  explícito, no una suposición silenciosa.
- **OQ-QA-3 — ¿Vale la pena un AC-10 formal para `PendingPaymentsPanel`?** Mismo pedido
  que ya dejó el `proposal.md` de FE (OQ-FE-4): que el PO o quien mantenga la US considere
  un CR o una enmienda. QA no tiene autoridad para crear esa AC.
- **OQ-QA-4 — Los NFR de esta US ya vienen con número, no como `[propuesto]`.** La US §9
  fija `p95 lectura < 300ms` / `p95 escritura < 500ms` (heredados de PRD §4) sin marca de
  "a confirmar" — a diferencia de US-007, donde el número del carrito estaba
  `[propuesto — confirma Arquitecto]`. Este plan los toma como ratificados. Si en algún
  E2E el Arquitecto los revisa, `qa/performance/lib/thresholds.js` es la fuente única a
  actualizar.

## Referencias

- US: `docs/user-stories/US-012-panel-ordenes-dueno.md`
- Change de backend (planificado, 0 tasks): `openspec/changes/US-012-panel-ordenes-dueno-backend/`
- Change de frontend (planificado, 0 tasks): `openspec/changes/US-012-panel-ordenes-dueno-frontend-web/`
- Change relacionado (informativo, worktree separado, no editado por este agente):
  `US-023-pago-manual-offline-backend` — dueño de `GET /admin/orders/pending-payment` y
  `POST /admin/orders/{orderId}/confirm-payment`, que `PendingPaymentsPanel` consume.
- Contrato aún no publicado: `apps/api/docs/api/openapi.yaml` (no tiene `/admin/orders*`
  a la fecha de este plan)
- Suite que se extiende: `qa/` (`@dsm/qa`, desde US-001)
- Change de QA de referencia (misma forma): `openspec/changes/US-007-carrito-compra-qa/`
- ADR-0008 (stock al aprobar el pago) — gobierna por qué `pending_payment` no se gestiona
  acá (AC-8)

## Linear

MCP de Linear no conectado — proyecto local-only. No se crean sub-tasks en Linear.
