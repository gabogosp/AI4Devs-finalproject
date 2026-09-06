---
tracker-id: null
tracker-source: null
parent-us: US-020
discipline: frontend-web
variant: null
language: es
audit-derived: false
---

# Proposal — Borrado de cuenta y datos personales (frontend-web)

> **Ticket**: US-020 — Borrado de cuenta y datos personales (derecho al olvido, Ley 25.326)
> **Author**: frontend-web-developer agent
> **Date**: 2026-09-06
> **Status**: Proposed
> **Affected layers**: componente de acción destructiva, estado de sesión
> (`SessionProvider`), mapeo de errores (`lib/http/errors.ts`), wiring de la
> página `/mi-cuenta`, observabilidad, E2E dev-owned de topología
> **Affected platform**: `apps/web` (Next.js App Router — storefront, route
> group `(storefront)`)

## Why

`US-020-borrado-cuenta-datos-personales-backend` (PR #93, mergeado) construyó
el endpoint `DELETE /v1/me`: autoservicio, inmediato e irreversible, que
anonimiza `customers` (nombre/email/teléfono sobrescritos, email liberado
para re-registro), revoca todas las sesiones y enlaces de recuperación
pendientes, desvincula los carritos y anonimiza las órdenes históricas no
anonimizadas — bloqueando con `409` si el titular tiene pedidos sin pagar o
pagados y sin entregar. Las 5 decisiones de producto que gobiernan el diseño
(anonimizar no borrar, email liberado, inmediato sin ventana de gracia,
autoservicio, las órdenes en curso bloquean) están **cerradas por el PO** en
la US §10 — ninguna se reabre acá.

Este change es la mitad que falta: la UI en `/mi-cuenta` que dispara ese
endpoint, con la confirmación de dos pasos que un borrado irreversible de PII
exige (§8 de la US) y el manejo explícito de sus estados — éxito, bloqueo por
órdenes en curso, error genérico. Sin esta pieza, el sitio sigue publicando
por escrito (política de privacidad, US-017) un derecho que el cliente no
tiene forma de ejercer él mismo.

## What changes

- **`accountService.deleteAccount()`** (nuevo método) — envuelve la
  operación **generada** `deleteAccount` (`DELETE /v1/me`) con el mismo
  `session: 'customer'` que el resto del repositorio (ADR-0013); alias de
  import para resolver la colisión de nombres con la función generada
  (mismo patrón que US-013 D1).
- **`AppError.conflict` gana `blockingOrders`** en `lib/http/errors.ts` —
  extension member del 409 (`AccountHasActiveOrdersProblem.blocking_orders`),
  mismo criterio que `availableQuantity`/`maxItems` del carrito. Se
  **documenta un drift de contrato real** encontrado al planificar (el
  schema publicado no declara `pending_payment` como valor válido de
  `status`, aunque el backend puede emitirlo) y se tipa defensivamente
  (`status: string`) para no depender de un enum que no refleja el
  comportamiento real — ver `design.md` §D2.
- **`SessionProvider` gana `accountDeleted()`** — refleja localmente que la
  sesión terminó (el backend ya limpió las cookies en la respuesta del
  `DELETE`), sin volver a llamar al backend de logout.
- **`DeleteAccountSection`** (componente nuevo) — botón destructivo
  "Eliminar mi cuenta" + `ConfirmDialog` **reusado tal cual**, con copy
  explícito de qué se borra (nombre/email/teléfono), qué sobrevive
  (historial anonimizado) y que el email queda libre. En el 409 por órdenes
  en curso, muestra la lista de pedidos bloqueantes (número, estado,
  importe) en texto plano.
- **`AccountDeletedNotice`** (componente nuevo) — pantalla de confirmación
  post-borrado, sin datos personales, con foco gestionado al heading y un
  link para volver al inicio.
- **`MiCuentaScreen`** (componente nuevo) — levanta el flag "recién borrada"
  por ENCIMA de `CustomerGuard`: el guard oculta sus `children` en el mismo
  render en el que la sesión pasa a anónima, así que la confirmación de
  éxito no puede vivir dentro del árbol que el guard protege (ver
  `design.md` §D3). `app/(storefront)/mi-cuenta/page.tsx` pasa a renderizar
  este componente en vez de envolver el guard directamente.
- **4 eventos de negocio nuevos** (`account_delete_attempted/succeeded/
  blocked/failed`) en `lib/observability/events.ts`, sin PII (mismo criterio
  que `order_history_*`), en `PUBLIC_EVENTS` (superficie de cliente, no de
  operador).
- **E2E dev-owned de topología** (`account-deletion-topology.spec.ts` +
  extensión de `api-stub.mjs`/`api-stub.selftest.mjs`) — cierra
  explícitamente el hueco que dejó pasar el bug real de PR #89 (rewrite de
  `/v1/me/:path*` ausente, encontrado recién por QA en vez de por el propio
  change de FE). El rewrite **ya existe** desde esa corrección; este change
  sólo lo verifica contra la app construida, como hace el resto del repo
  para cada superficie con cookies (`auth`/`cart`/`checkout`-topology).

## Out of scope

- **AC-2, AC-3, AC-5, AC-6, AC-8, AC-10, AC-12, AC-13, AC-15** — garantías
  del backend (US-020 backend, PR #93). La UI las consume/refleja
  (`AccountDeletedNotice` no muestra PII; el `ConfirmDialog` menciona que el
  email queda libre; el guard sigue redirigiendo si se revisita
  `/mi-cuenta`) pero **no las re-prueba** con tests propios — el backend ya
  tiene 10 specs de invariantes cross-AC para eso.
- **Corregir el drift de contrato de D2** (`OrderHistorySummary.status` no
  declara `pending_payment`) — es un cambio de `apps/api/docs/api/openapi.yaml`,
  fuera de alcance de un change FE-only. Se documenta como recomendación de
  follow-up (ver "Open questions").
- **Un componente de confirmación, botón o toast nuevos** — se reusa
  `ConfirmDialog`/`Button`/el patrón `role="alert"`/`role="status"` inline
  tal cual existen (no hay librería de toast en este código, ver
  `design.md` §Context).
- **README de `apps/web`** — evaluado y descartado, mismo motivo que US-013.
- **Un ADR nuevo** — ningún mecanismo/librería/patrón nuevo, sólo la
  aplicación de ADR-0013 ya existente.
- **Cobertura Playwright de journey completo** (login → mi-cuenta → borrar →
  confirmación visual) — el único Playwright de este change es el topology
  dev-owned (infraestructura de red, no journey de usuario), mismo nivel de
  pirámide que el resto de `features/account/`.
- **Borrado iniciado por el dueño desde el panel** — decisión de producto
  explícita de la US (§4, §10 decisión 4): exclusivamente autoservicio.

## Affected components / screens

- `apps/web/src/features/account/accountService.ts` — método nuevo `deleteAccount()`.
- `apps/web/src/lib/http/errors.ts` — `AppError.conflict.blockingOrders` +
  mapeo en `mapProblemToAppError`.
- `apps/web/src/features/account/SessionProvider.tsx` — método nuevo `accountDeleted()`.
- `apps/web/src/features/account/DeleteAccountSection.tsx` — componente nuevo.
- `apps/web/src/features/account/AccountDeletedNotice.tsx` — componente nuevo.
- `apps/web/src/features/account/MiCuentaScreen.tsx` — componente nuevo.
- `apps/web/src/features/account/AccountPanel.tsx` — prop nueva `onAccountDeleted`.
- `apps/web/app/(storefront)/mi-cuenta/page.tsx` — renderiza `MiCuentaScreen`.
- `apps/web/src/lib/observability/events.ts` — 4 literales nuevos + `PUBLIC_EVENTS`.
- `apps/web/e2e/support/api-stub.mjs` + `api-stub.selftest.mjs` — superficie
  `/v1/me` nueva.
- `apps/web/e2e/account-deletion-topology.spec.ts` — spec nuevo.
- Tests nuevos/modificados: `accountService.test.ts`, `errors.test.ts`,
  `SessionProvider.test.tsx`, `AccountPanel.test.tsx`, `a11y.test.tsx`,
  `DeleteAccountSection.test.tsx` (nuevo), `AccountDeletedNotice.test.tsx`
  (nuevo), `MiCuentaScreen.test.tsx` (nuevo), `account.events.test.tsx`
  (nuevo).

## API consumption

- `DELETE /v1/me` — `CustomerGuard`+`CsrfGuard` (cookie `dsm_access` +
  `x-csrf-token` double-submit). Contrato publicado en
  `apps/api/docs/api/openapi.yaml` (líneas 950-984 + schemas 2203-2229),
  cliente/Zod/MSW **ya regenerados** por el orquestador antes de este plan
  (`deleteAccount` en `endpoints.ts`, `AccountHasActiveOrdersProblem` en
  `model/`, `DeleteAccountResponse = zod.void()` en `zod.ts`) — este change
  **no regenera nada nuevo**, sólo verifica que sigue vigente (T1.1).
- Respuestas consumidas: `204` (éxito e idempotencia — sin cuerpo, cookies de
  sesión limpias en la misma respuesta); `401`/`403` (manejados globalmente
  por `CustomerGuard`/el interceptor HTTP centralizado, sin caso especial en
  este componente); `409` (`AccountHasActiveOrdersProblem.blocking_orders` —
  mensaje + lista específicos, ver `design.md` §D5); `429` (mensaje genérico
  de reintento, mismo criterio que el resto de la app).
- **Drift de contrato encontrado** (no corregido en este change, ver
  `design.md` §D2 y "Open questions"): `AccountHasActiveOrdersProblem.blocking_orders`
  reusa el schema `OrderHistorySummary` de US-015, cuyo enum de `status`
  (`new|preparing|ready|delivered|cancelled`) **no incluye `pending_payment`**
  — el estado que, según el propio `design.md` del backend
  (`BLOCKING_ORDER_STATUSES`), es uno de los 4 que el 409 puede legítimamente
  devolver, y probablemente el más común. La FE se diseña defensiva ante
  esto (D2); el contrato publicado no se toca acá.

## Acceptance criteria

- [ ] AC-1: con sesión activa, el cliente ve el botón "Eliminar mi cuenta" en
      `/mi-cuenta`; al confirmar (tipeando "ELIMINAR"), se dispara `DELETE
      /v1/me`; en éxito, la UI refleja que la sesión terminó (pantalla de
      confirmación, sin volver a pedir nada al backend).
- [ ] AC-4/AC-9: un 409 con `blocking_orders` muestra la lista de pedidos
      (número, estado, importe) sin haber pre-chequeado su estado antes de
      ofrecer el botón.
- [ ] AC-7: `Escape`, click en "Cancelar", o cerrar el diálogo sin tipear
      "ELIMINAR" no disparan ninguna llamada de red.
- [ ] AC-11: la copia del diálogo dice explícitamente "inmediato" e
      "irreversible"; no existe ningún estado intermedio "borrado pendiente"
      en la UI.
- [ ] AC-14 (mitad FE): ninguno de los 4 eventos de telemetría que este
      change agrega lleva PII (nombre, email, teléfono, ni el detalle de los
      pedidos bloqueantes).
- [ ] El rewrite `/v1/me/:path*` funciona contra la app **construida**
      (`next build && next start`), verificado por
      `account-deletion-topology.spec.ts` — no sólo mockeado por URL en
      tests de componente.
- [ ] `AccountPanel`/`DeleteAccountSection` (diálogo abierto y cerrado) no
      tienen violaciones axe-core `serious`/`critical`.
- [ ] Ningún `fetch`/`axios` crudo en los archivos nuevos (F48); ningún
      pre-chequeo de órdenes antes de mostrar el botón (AC-9).

## Standards consultados

- `docs/base-standards.md` — KISS/YAGNI: cero componente de confirmación
  nuevo, cero librería de toast nueva; se reusa `ConfirmDialog`/`Button`/el
  patrón `role="alert"`/`role="status"` ya establecidos dos veces en este
  codebase.
- `frontend-standards.md` §3.1-§3.3 (contract-derived artifacts generados,
  nunca a mano — con la excepción documentada y justificada de D2: el campo
  `blockingOrders` se tipa a mano por un drift de contrato real, no por
  conveniencia) · §9.3/§11.4 (estado como unión discriminada) · §11.2 (auth/
  guard heredado, CSRF) · §11.3 (mapeo de errores tipados) · §11.5
  (repositorio por feature) · §11.8 (observabilidad) · §11.9 (composición de
  estados de carga) · §11.bis.5 (confirmación destructiva de dos pasos —
  aplicado aunque la sección nominal es "extensiones de backoffice", porque
  es el mismo patrón que ya reusan dos consumidores customer-facing y
  backoffice indistintamente) · §12.2 (validación cliente=UX/servidor=
  seguridad — no aplica input libre nuevo, sólo la palabra de confirmación).
- `docs/architecture/api-standards.md` §8 (RFC 7807).
- `docs/cross-cutting/security-standards.md` §3.7 (account lifecycle flows —
  "logout actually revokes"; `accountDeleted()` documenta explícitamente que
  NO vuelve a llamar al backend porque el `DELETE` ya revocó todo) · §6.3
  (output encoding) · §7.5 (CSRF double-submit, ya heredado) · §8.4
  (retention & deletion — "deletion is designed").
- `docs/quality/testing-standards.md` §14 · `docs/quality/qa-frontend-standards.md`
  §23 (RTL + MSW + axe-core, mismo nivel de pirámide que el resto de
  `features/account/`, sin Playwright de journey nuevo).
- `docs/product/design-system.md` §7.5 (Modal/Dialog) · §7.6 (Toast — sin
  librería, patrón inline `role="alert"`/`role="status"`, sticky por
  ausencia de auto-cierre) · §10.2 (voz/tono) · §11 (accesibilidad — foco
  gestionado al cambiar de contenido, `aria-live`, color nunca único
  portador).
- `docs/ai/documentation-standards.md` §4/§8/§11 — evaluado: sin ADR
  (ninguna decisión arquitectónica nueva), sin README (ver "Out of scope").
- Skills aplicadas: `openapi-client-codegen` (verificación de frescura, sin
  regenerar nada nuevo) · `msw-setup` (mocks por-test) ·
  `frontend-resilience-patterns` (idempotencia visual — botón deshabilitado
  durante la mutación, patrones #3/#4/#9) · `playwright-stability`
  (selectores/asserts del topology spec — `response.status()`/
  `context.cookies()`, nunca DOM, F59) · `openspec-workflow` (contrato
  closure-grade).

## Open questions

1. **Drift de contrato en `AccountHasActiveOrdersProblem.blocking_orders`**
   (ver `design.md` §D2): el schema publicado reusa `OrderHistorySummary` de
   US-015 (enum `status` sin `pending_payment`, con `delivered`/`cancelled`
   que nunca aparecen en la práctica). Recomendación: que el follow-up de
   backend ensanche el enum existente o declare un schema propio
   (`AccountBlockingOrderSummary`) con los 4 valores reales
   (`pending_payment|new|preparing|ready`). No bloquea este change (la FE ya
   se diseñó defensiva), pero sí a cualquier consumidor futuro que tipe
   estrictamente contra el enum generado.
2. **Copy exacto** ("Eliminar mi cuenta" + `confirmWord="ELIMINAR"`) — la US
   no fija un texto literal; se eligió por ser el registro más natural en
   español rioplatense para un botón imperativo (el resto de la US usa
   "borrado"/"borrar" en prosa, ambos son sinónimos aceptables). Si el PO
   prefiere "Borrar mi cuenta"/`confirmWord="BORRAR"`, es un cambio de copy
   de una sola línea, sin impacto en el resto del diseño.
3. **`blocking_orders` como texto plano, no como links** (D6) — decisión
   deliberada por incertidumbre sobre si `/mi-cuenta/compras/{order_number}`
   soporta pedidos `pending_payment` (US-015 no lo declara explícitamente).
   Si se confirma que sí, una mejora de UX de bajo costo es convertir cada
   fila en un `<Link>`, como ya hace `PurchaseHistoryList`.

## References

- User story: [`docs/user-stories/US-020-borrado-cuenta-datos-personales.md`](../../../docs/user-stories/US-020-borrado-cuenta-datos-personales.md)
- PRD: [`docs/product/prd.md`](../../../docs/product/prd.md) §6 (retención de
  datos), capacidad 13
- Backend (change hermano, mergeado): [`openspec/changes/US-020-borrado-cuenta-datos-personales-backend/`](../US-020-borrado-cuenta-datos-personales-backend/)
  (`proposal.md`, `design.md` — contrato exacto, mecanismo de anonimización)
- Capacidad `retencion-datos-personales` (CAP-13): [`openspec/specs/retencion-datos-personales/`](../../specs/retencion-datos-personales/)
- Precedentes directos de confirmación destructiva de dos pasos:
  `US-013-cancelacion-reembolso-frontend-web` (archivado — `ConfirmDialog`,
  alias de import por colisión de nombres, D1), `US-015-historial-compras-frontend-web`
  (archivado — última UI de `/mi-cuenta`, y el change cuya ausencia de E2E
  dev-owned de topología dejó pasar el bug real de PR #89)
- ADR-0013: `docs/architecture/decisions/0013-same-origin-session-surface.md`
- Design-system: `docs/product/design-system.md` §7.5, §7.6, §10.2, §11
