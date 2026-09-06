---
tracker-id: null
tracker-source: null
parent-us: US-025
discipline: frontend-web
variant: null
language: es
audit-derived: false
---

# Proposal — US-025 Reseñas y calificaciones de productos (frontend web)

> **Ticket**: US-025 — Reseñas y calificaciones de productos
> **Author**: frontend-web-developer agent (assisted by @gabogosp)
> **Date**: 2026-09-06
> **Status**: Proposed — **Fase A planificable y cerrable ahora; Fase B `Blocked-by`
> backend** (ver "Qué cambia" abajo).
> **Affected layers**: components, repository (HTTP client) — sólo en Fase B, state, routing
> **Affected platform**: web (`apps/web`, Next.js App Router)

## Why

El dueño comparó la ficha de producto actual con Mercado Libre y señaló la brecha: no hay
ninguna señal social — ni estrellas, ni reseñas, ni cantidad de compradores (US §2). Sin eso,
cada decisión de compra depende sólo de la descripción y el precio. Los 9 AC de la US (Ready
desde 2026-09-06) ya fijan el comportamiento exacto: sólo clientes con una orden `delivered`
que incluya el producto pueden reseñar (AC-1/AC-6), la calificación es 1-5 estrellas con
comentario opcional (AC-2), el promedio y el conteo se ven en la ficha (AC-3), un producto sin
reseñas muestra un estado explícito (AC-4), la reseña es upsert — una por cliente por producto
(AC-5) —, un invitado ve una invitación a crear cuenta en vez del control (AC-7), y el dueño
puede ocultar una reseña sin borrarla (AC-8, transparencia hacia el autor).

**Restricción que gobierna este plan por completo**: a diferencia de todo change de FE previo
en este proyecto, **el backend de US-025 no existe todavía** — no hay change de
`US-025-resenas-calificaciones-productos-backend` abierto ni mergeado, `apps/api/docs/api/openapi.yaml`
no declara ningún endpoint de `reviews` (verificado: `grep -n review apps/api/docs/api/openapi.yaml`
no matchea nada), y por lo tanto `apps/web/src/api/generated/` no tiene ningún DTO/Zod/MSW de
reseñas para generar. Lo único que existe hoy, además de la US, es
`openspec/changes/US-025-resenas-calificaciones-productos-qa/qa-plan.md` — QA planificado
adelantado (Modo B standalone), mismo patrón que US-024. Este es, por lo tanto, el primer plan
de FE de este proyecto que se escribe **antes** que su backend.

`frontend-standards.md` §3.1/§3.2 es explícito: tipar a mano lo que debería salir del contrato
está prohibido, y el escape hatch "idealmente codegen, si no a mano" está prohibido
nominalmente (§3.2, párrafo "Forbidden"). Este plan NO usa ese escape hatch: la Fase A no
genera ningún artefacto que sea un espejo del contrato (ningún DTO de request/response, ningún
schema Zod, ningún handler MSW) y **no hace ninguna llamada HTTP** — construye únicamente
componentes presentacionales tipados contra tipos de dominio propios de la UI (`design.md`
§D1 justifica por qué esto no es la misma cosa que "hand-typear el contrato", y por qué de
todos modos se tratan como provisionales y se reemplazan en Fase B).

## What changes

**Fase A — construible y cerrable HOY, sin dependencia de backend.** Componentes
presentacionales puros bajo `apps/web/src/features/reviews/` (control de estrellas, formulario
de reseña, lista + resumen de reseñas, estados de carga/error/vacío, mensaje "necesitás una
cuenta" para invitados) tipados contra interfaces TypeScript escritas a mano y marcadas
explícitamente `@provisional` (nunca importadas por ningún código que hable HTTP), probados con
RTL + axe-core usando fixtures locales — cero llamadas de red, cero integración con
`ProductDetail.tsx`. Ver `design.md` §D1-D4 y `tasks.md` Fase A.

**Fase B — bloqueada por el backend (`Blocked-by:
US-025-resenas-calificaciones-productos-backend`, no planificado todavía).** Cuando ese change
publique el contrato en `apps/api/docs/api/openapi.yaml` y el orquestador corra el codegen:
borrar las interfaces provisionales de Fase A y re-tipar contra `apps/web/src/api/generated/`;
escribir `reviewsService.ts` (repository pattern, mismo criterio que `accountService.ts`/
`orderHistoryService.ts`); construir el contenedor con estado real (`AsyncState`, fetch al
montar, envío del formulario); componer la sección en `ProductDetail.tsx`; agregar el E2E
dev-owned de topología de `/v1/me/reviews/:productId` contra la app **construida** (mismo
motivo que US-020 §D8 — ver `design.md` §D6); agregar los eventos de telemetría. Ver
`tasks.md` Fase B.

## Out of scope

- **Backend de US-025** — otro change (`US-025-resenas-calificaciones-productos-backend`,
  no planificado todavía). Este plan no diseña el schema, el endpoint de elegibilidad, ni la
  regla `@@unique([customer_id, product_id])`.
- **QA de US-025** — ya tiene su propio change
  (`openspec/changes/US-025-resenas-calificaciones-productos-qa/`), planificado en paralelo.
- **Reseñas con foto/video, respuesta del dueño a una reseña, votar "esto te sirvió"** —
  explícitamente fuera de v1 en la US §4.
- **Notificar por email cuando una reseña se oculta** — US §4, mismo criterio que US-013/US-021.
- **Reseñar sin cuenta / como invitado** — decisión explícita del dueño (US AC-7).
- **Vista admin de moderación (el dueño ocultando una reseña desde un panel)** — **ambigua entre
  fuentes, NO se asume incluida en este change.** La US §7 lista "vista admin de moderación
  (reusa patrones de tabla del panel de órdenes, US-012)" bajo la fila de tasks de FE; pero
  `qa-plan.md` sólo prueba AC-8 a nivel de API (acceptance BDD vía supertest contra
  `PATCH /v1/admin/reviews/:id`) — no hay ningún spec Playwright de QA que ejercite una pantalla
  de moderación. Dado el criterio explícito de esta planificación ("si es ambiguo, flaguear
  como pregunta abierta, no asumir"), esta vista **no** se incluye en el alcance de este change.
  Ver "Open questions" #1.
- **Ningún llamado HTTP real en Fase A** — es la garantía estructural que hace que Fase A no
  viole `frontend-standards.md` §3 (ver `design.md` §D1).
- **Ubicación exacta del resumen (estrellas+conteo) en la ficha más allá de una sección** —
  se asume una única `ReviewsSection` debajo de la descripción (mismo patrón de composición que
  `ProductDetail.tsx` ya usa para agregar bloques condicionales); un resumen compacto cerca del
  título/precio (estilo Mercado Libre) queda fuera de este change salvo que se confirme como
  requisito — ver "Open questions" #3.

## Affected components / screens

### Fase A (nuevo, sin dependencias)

- `apps/web/src/features/reviews/types.provisional.ts` — **nuevo**. Interfaces de dominio
  de UI (`ReviewViewModel`, `ReviewsSummaryViewModel`, `ReviewFormInput`, `ReviewFormFieldError`)
  marcadas `@provisional`, banner explícito, sin ningún import ni consumo de red.
- `apps/web/src/features/reviews/StarRatingInput.tsx` — **nuevo**. Control interactivo,
  `role="radiogroup"`/`role="radio"` (US §8).
- `apps/web/src/features/reviews/StarRatingDisplay.tsx` — **nuevo**. Versión de sólo lectura
  (resumen, ítems de lista).
- `apps/web/src/features/reviews/ReviewForm.tsx` — **nuevo**. Estrellas + comentario opcional +
  envío; `onSubmit` inyectado por el padre (Fase B lo conecta a `reviewsService`).
- `apps/web/src/features/reviews/ReviewsList.tsx` + `ReviewListItem.tsx` — **nuevo**.
- `apps/web/src/features/reviews/ReviewsSummary.tsx` — **nuevo**. Promedio+conteo (AC-3) o
  "Sin reseñas todavía" (AC-4) en el mismo slot.
- `apps/web/src/features/reviews/ReviewGuestPrompt.tsx` — **nuevo**. Mensaje + links a
  `/ingresar?next=...` y `/crear-cuenta` (AC-7).
- `apps/web/src/features/reviews/ReviewsSection.tsx` — **nuevo**. Orquestador presentacional
  puro: recibe todo por props (`viewerState`, `summary`, `reviews: AsyncState<...>`,
  `onSubmitReview`) — Fase B lo alimenta con datos reales, Fase A lo prueba con fixtures.

### Fase B (bloqueado por backend)

- `apps/web/src/features/reviews/reviewsService.ts` — **nuevo**. Repositorio
  (`frontend-standards.md` §11.5) sobre las operaciones generadas de reviews.
- `apps/web/src/features/reviews/ReviewsDataContainer.tsx` — **nuevo**. `'use client'`,
  fetch al montar (mismo patrón que `PurchaseHistoryList`), envío del formulario, refetch tras
  upsert exitoso.
- `apps/web/src/features/storefront/ProductDetail.tsx` — **modificado**: compone
  `ReviewsDataContainer` debajo de la descripción.
- `apps/web/src/lib/observability/events.ts` — **modificado**: nuevos `BusinessEvent`
  (`review_shown`, `review_submitted`, `review_submit_failed`), agregados a `PUBLIC_EVENTS`.
- `apps/web/e2e/support/api-stub.mjs` — **modificado**: superficie de stub para
  `POST/PATCH /v1/me/reviews/:productId` y `GET /v1/products/:slug/reviews`.
- `apps/web/e2e/reviews-topology.spec.ts` — **nuevo**. Topología dev-owned contra la app
  construida (mismo motivo que `account-deletion-topology.spec.ts`).
- `apps/web/src/features/reviews/types.provisional.ts` — **borrado**, reemplazado por tipos
  derivados de `apps/web/src/api/generated/`.

## API consumption

**No hay contrato publicado todavía.** Endpoints **declarados, no contratados** por la US §7
(el equipo de backend define la forma exacta al planificar `US-025-resenas-calificaciones-productos-backend`):

- `POST/PATCH /v1/me/reviews/:productId` (upsert, AC-5) — superficie de sesión de cliente
  (`session: 'customer'`, mismo criterio que `accountService`/`orderHistoryService`), viaja
  bajo `/v1/me/*`.
- `GET /v1/products/:slug/reviews` (público, AC-3/AC-4) — excluye reseñas con `hidden_at`
  no-nulo, salvo — sin resolver todavía, ver "Open questions" #2 — la reseña propia del viewer
  autenticado (AC-8, transparencia hacia el autor).
- `PATCH /v1/admin/reviews/:id` (moderación) — **fuera de alcance de este change** (ver
  "Out of scope"; superficie de panel admin, no de storefront).

Fase B no puede fijar los nombres exactos de operationId/DTOs hasta que ese contrato exista —
`design.md` documenta el contrato **esperado** con la forma mínima que la US ya fija, para que
la tarea de wiring de Fase B sea mecánica una vez el codegen corra.

## Acceptance criteria

- [ ] AC-1 (Fase B): un cliente con una orden `delivered` que incluye el producto ve el control
      de reseña en la ficha y, al enviarlo, la reseña queda asociada y aparece en la lista.
- [ ] AC-2 (Fase A construye, Fase B conecta): el formulario permite enviar sólo la calificación,
      sin comentario.
- [ ] AC-3 (Fase A construye, Fase B conecta): cualquier persona ve el promedio y el conteo en
      la ficha.
- [ ] AC-4 (Fase A construye, Fase B conecta): un producto sin reseñas muestra "Sin reseñas
      todavía" en vez de un promedio o una lista vacía sin explicación.
- [ ] AC-5 (Fase B, consumida — el upsert es responsabilidad del backend): editar la propia
      reseña actualiza la misma fila; el FE nunca decide POST vs PATCH por sí mismo salvo por
      la presencia de una reseña propia ya cargada.
- [ ] AC-6 (Fase B — UX, no autoridad): un cliente autenticado sin la compra que habilita no ve
      ningún control para reseñar. El 403 real es garantía del backend (US §9); el FE ocultar
      el control es sólo UX, nunca la defensa.
- [ ] AC-7 (Fase A construye, Fase B conecta): un invitado ve una explicación de que necesita
      una cuenta para reseñar, con un camino a crear una.
- [ ] AC-8 (Fase A construye el estado visual "oculta por moderación" para el autor; Fase B lo
      conecta con datos reales — **la acción de ocultar desde un panel admin queda fuera de
      alcance**, ver "Out of scope").
- [ ] AC-9 (Fase A: validación de UX en el cliente para rating fuera de 1-5; Fase B: el rechazo
      real con mensaje claro es del backend, el FE sólo refleja el error de validación).

## Standards consulted

- `docs/base-standards.md`
- `docs/code/frontend-standards.md` §3 (codegen obligatorio — y su excepción documentada en
  `design.md` §D1 para Fase A), §8 (cliente HTTP centralizado), §9 (estado como unión
  discriminada), §11.3 (mapeo de errores), §11.4 (patrón de estado), §11.5 (repository pattern),
  §11.9 (composición de estados de carga), §12 (seguridad — XSS del comentario libre)
- `docs/architecture/api-standards.md` (RFC 7807 — forma esperada de los errores de Fase B)
- `docs/quality/testing-standards.md` §14
- `docs/quality/qa-frontend-standards.md` §19 (a11y), §23 (RTL/MSW/Playwright), §24 (BDD)
- `docs/product/design-system.md` §11 (checklist de accesibilidad baseline) — no existe ningún
  componente de estrellas reusable hoy (verificado: `grep -n estrella docs/product/design-system.md`
  sólo matchea "SearchExperience — componente estrella" en sentido figurado, sección 7.12; no
  hay ningún patrón de rating)
- ADR-0013 (mismo-origen para la superficie de sesión — Fase B hereda el mecanismo, igual que
  US-007/US-015/US-020)
- Precedente estructural directo: `openspec/changes/archive/US-020-borrado-cuenta-datos-personales-frontend-web/`
  (§D8 — E2E dev-owned de topología de `/v1/me/*`), `openspec/changes/archive/US-015-historial-compras-frontend-web/`
  (repository pattern + `AsyncState` + composición de estados)

## Open questions

1. **¿La "vista admin de moderación" (AC-8, ocultar una reseña) es alcance de este change de
   frontend-web, o un follow-up separado?** La US §7 la lista bajo la fila de FE; el
   `qa-plan.md` sólo la prueba a nivel de API. Este plan la deja **fuera de alcance** por
   default (ver "Out of scope") — necesita confirmación de la coordinadora/PO antes de que
   `/develop-frontend-web` la trate como incluida o como un change aparte
   (posiblemente extendiendo el panel de órdenes de US-012).
2. **¿Cómo sabe el FE si el viewer autenticado es elegible para reseñar y si ya tiene una
   reseña propia (para decidir POST vs PATCH y mostrar su propio estado "oculta por
   moderación")?** La US sólo declara `POST/PATCH /v1/me/reviews/:productId` (upsert) y
   `GET /v1/products/:slug/reviews` (público) — ningún endpoint de "mi elegibilidad"/"mi reseña
   para este producto" existe todavía. Esto lo debe resolver `US-025-resenas-calificaciones-productos-backend`
   al diseñar el contrato (opción a: el GET público, cuando la sesión de cliente viaja, incluye
   un campo `viewer` con la reseña propia y su elegibilidad; opción b: un endpoint dedicado). Se
   marca acá para que el arquitecto de backend lo resuelva explícitamente — Fase B de este plan
   no puede cerrar sus tasks de wiring exactas hasta que exista esa respuesta (ver `design.md`
   §D5).
3. **¿Un resumen compacto (estrellas+conteo) cerca del título/precio, además de la sección
   completa?** No bloqueante — default: una sola `ReviewsSection` debajo de la descripción (ver
   "Out of scope"). Confirmar si el dueño quiere el resumen duplicado arriba (patrón Mercado
   Libre) antes de Fase B T-B4.

Ninguna de las tres bloquea el arranque de la Fase A — todas son, por diseño, preguntas que
sólo importan cuando Fase B empieza a wiring real.
