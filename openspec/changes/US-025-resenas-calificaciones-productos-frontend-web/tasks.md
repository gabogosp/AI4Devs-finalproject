---
parent-us: US-025
discipline: frontend-web
variant: null
language: es
---

# US-025 Frontend-web — Tasks

> Cada task es closure-grade: atómica, con `Exit criterion:` observable y `Verify:` con el
> comando exacto que `/develop-frontend-web` corre — siempre en forma **terminante** (F49):
> `pnpm --filter @dsm/web test -- <patrón>` (el script `test` de `apps/web/package.json` ya es
> `vitest run`, no `vitest` a secas), `pnpm --filter @dsm/web test:e2e -- <patrón>` para
> Playwright (`playwright test`, ya terminante). Los comandos asumen la **raíz del repo** como
> cwd.
>
> **Estructura en dos fases, explícita por diseño** (`design.md` §Context): la **Fase A** no
> tiene ninguna dependencia externa a este change — es ejecutable y cerrable en la misma sesión
> que este plan. La **Fase B** lleva `Blocked-by:
> US-025-resenas-calificaciones-productos-backend` (change todavía no planificado) en cada task
> — `/develop-frontend-web` puede ejecutar la Fase A completa y debe **detenerse** antes de la
> Fase B hasta que ese change exista y publique el contrato.
>
> **Estimación dual**: Fase A **~3 h AI-asistido** / **~5,5 h tradicional** (9 tasks,
> presentacional puro, sin red). Fase B **~2,5 h AI-asistido** / **~4,5 h tradicional** (8 tasks
> de wiring) **+ ~1 h AI-asistido / ~2 h tradicional** (T-B9/T-B10/T-B11, vista de moderación —
> agregada después de la planificación inicial, ver "Open questions" #1 de `proposal.md`).

## Traceability matrix (AC de la US → tasks)

| AC | Descripción | Fase A | Fase B |
|---|---|---|---|
| AC-1 | Dejar reseña (comprador, orden `delivered`) | — (requiere red) | T-B3, T-B4, T-B7 |
| AC-2 | Calificar sin comentario | T-A3 (formulario lo permite) | T-B3 (envío real) |
| AC-3 | Ver promedio y conteo | T-A4 | T-B3, T-B4 |
| AC-4 | Producto sin reseñas | T-A4 | T-B3, T-B4 |
| AC-5 | Editar la propia reseña (upsert) | T-A3 (modo edición del formulario) | T-B3 (precarga + submit real) — depende de `design.md` §D5, T-B0 |
| AC-6 | No comprado → no puede reseñar (UX; 403 es del backend) | T-A6 (estado `ineligible` = nada) | T-B3, T-B7 (topología del 403, superficie) |
| AC-7 | Invitado no puede reseñar | T-A5 | T-B3 |
| AC-8 | El dueño oculta una reseña — superficie del autor viendo su propio estado, **y** la acción de ocultar desde `/admin/productos/{id}` (confirmada en alcance, `design.md` §D8) | T-A8 (badge "oculta por moderación" en `ReviewListItem`, ya cerrado) | T-B3 (superficie propia), T-B9/T-B10 (extienden `ReviewListItem`/`ReviewsList` con `onToggleHidden` opcional + servicio admin)/T-B11 (compone en `/admin/productos/{id}`) |
| AC-9 | Calificación fuera de rango rechazada (UX cliente; 422 real es del backend) | T-A3 (rango 1-5 estructuralmente inalcanzable desde `StarRatingInput`; slot de `fieldError`) | T-B3 (mapeo del 422 real) |

---

## Fase A — Presentacional, cerrable ahora (sin dependencias externas)

### Pre-requisitos

- [x] **T-A0 — `apps/web` limpio antes de empezar**
  - **Exit criterion**: no hay cambios sin commitear bajo
    `apps/web/src/features/reviews/` (el directorio todavía no existe, así que esto se cumple
    trivialmente salvo que otra sesión ya haya empezado a escribir ahí).
  - **Verify**: `git status --porcelain apps/web/src/features/reviews` vacío (o el comando no
    devuelve nada porque el directorio no existe todavía)

- [x] **T-A1 — Confirmar que no hay contrato de reviews todavía (documentar el punto de partida, no un error)**
  - **Exit criterion**: `apps/api/docs/api/openapi.yaml` no declara ningún path ni schema con
    "review" en el nombre — este hecho es la premisa de todo `design.md` §D1, no algo a
    corregir en este change.
  - **Verify**: `! grep -qi review apps/api/docs/api/openapi.yaml` (exit 0 = no matchea, confirma la premisa)

### Tipos provisionales

- [x] **T-A2 — `apps/web/src/features/reviews/types.provisional.ts`**
  - **Pattern**: `per design.md §D1/§D2` — banner JSDoc explícito de provisionalidad + tipos de
    dominio de UI, ninguno derivado de un contrato:
    ```ts
    /**
     * PROVISIONAL — no deriva de ningún contrato OpenAPI (todavía no existe uno
     * para reviews, ver design.md §D1). Prohibido: importar este archivo desde
     * cualquier código que hable HTTP. Se borra en Fase B (T-B1) cuando
     * US-025-resenas-calificaciones-productos-backend publique el contrato.
     */
    export interface ReviewViewModel {
      id: string;
      authorName: string;
      rating: number; // 1-5
      comment: string | null;
      createdAt: string; // ISO 8601
      isOwn: boolean;
      hidden: boolean; // AC-8 — sólo relevante cuando isOwn === true
    }

    export interface ReviewsSummaryViewModel {
      average: number;
      count: number;
    }

    export type ViewerReviewState =
      | { kind: 'guest' }
      | { kind: 'ineligible' }
      | { kind: 'eligible-new' }
      | { kind: 'eligible-editing'; ownReview: ReviewViewModel };

    export interface ReviewFormInput {
      rating: number;
      comment: string;
    }

    export interface ReviewFormFieldError {
      field: 'rating' | 'comment';
      message: string;
    }
    ```
  - **Exit criterion**: el archivo existe, exporta los 5 tipos de arriba, lleva el banner
    `PROVISIONAL` en la primera línea de comentario, y ningún archivo bajo `apps/web/src/lib/http/`
    ni `apps/web/src/api/` lo importa.
  - **Verify**: `grep -q "PROVISIONAL" apps/web/src/features/reviews/types.provisional.ts && ! grep -rl "types.provisional" apps/web/src/lib/http apps/web/src/api 2>/dev/null`

### Componentes presentacionales

- [x] **T-A3 — `StarRatingInput.tsx` + `StarRatingInput.test.tsx`**
  - **Pattern**: `per design.md §D3` — `role="radiogroup"` contenedor, cada estrella
    `role="radio"` + `aria-checked` + `aria-label="{n} de 5 estrellas"`, navegación por flechas
    dentro del grupo (WAI-ARIA radiogroup pattern), tokens `text-warning`/`text-muted` (reusados
    de `ProductPurchase.tsx`, no un token nuevo).
  - **Exit criterion**: el componente renderiza 5 controles con los roles/labels de arriba;
    `onChange` se llama con 1-5 al hacer click o al mover el foco con flechas y presionar
    Enter/Space; no existe ningún camino de la UI para producir un valor fuera de 1-5.
  - **Verify**: `pnpm --filter @dsm/web test -- StarRatingInput`

- [x] **T-A4 — `StarRatingDisplay.tsx` + `.test.tsx`**
  - **Exit criterion**: modo `'average'` renderiza `aria-label="Calificación promedio: {n} de 5"`;
    modo `'item'` renderiza `aria-label="{n} de 5 estrellas"`; ningún rol interactivo (`radio`/`button`)
    en ninguno de los dos modos.
  - **Verify**: `pnpm --filter @dsm/web test -- StarRatingDisplay`

- [x] **T-A5 — `ReviewsSummary.tsx` + `.test.tsx` (AC-3/AC-4)**
  - **Exit criterion**: con `count > 0` renderiza el promedio formateado a 1 decimal y
    "{count} reseñas"; con `count === 0` renderiza el texto "Sin reseñas todavía" y NO renderiza
    ningún promedio ni "0 reseñas".
  - **Verify**: `pnpm --filter @dsm/web test -- ReviewsSummary`

- [x] **T-A6 — `ReviewGuestPrompt.tsx` + `.test.tsx` (AC-7)**
  - **Exit criterion**: el componente renderiza un texto explicando que se necesita una cuenta
    para reseñar, un link a `/crear-cuenta` y un link a `/ingresar?next=` con el pathname actual
    codificado (mismo patrón que `CustomerGuard.tsx`).
  - **Verify**: `pnpm --filter @dsm/web test -- ReviewGuestPrompt`

- [x] **T-A7 — `ReviewForm.tsx` + `.test.tsx` (AC-2/AC-5/AC-9)**
  - **Pattern**: `per design.md §D4` — `onSubmit: (input: ReviewFormInput) => Promise<void>`
    inyectado por el padre; estado de envío como `AsyncState<void>` local
    (`@/lib/async` — `frontend-standards.md` §9.3); slot `fieldError?: ReviewFormFieldError`
    controlado por props, nunca inventado dentro del componente.
  - **Exit criterion**: (a) enviar con rating seleccionado y comentario vacío llama a `onSubmit`
    con `comment: ''` (AC-2); (b) sin ningún rating seleccionado el submit está deshabilitado;
    (c) con `initialValue` seteado, el formulario arranca precargado con esa calificación y
    comentario (modo edición, AC-5); (d) con `fieldError` seteado, el mensaje se muestra
    asociado al campo correspondiente (`aria-describedby`); (e) durante `submitState.status ===
    'loading'`, el botón de envío tiene `aria-busy="true"` y está deshabilitado.
  - **Verify**: `pnpm --filter @dsm/web test -- ReviewForm`

- [x] **T-A8 — `ReviewListItem.tsx` + `ReviewsList.tsx` + `.test.tsx` (AC-8, superficie del autor)**
  - **Exit criterion**: cada ítem muestra `StarRatingDisplay` modo `'item'`, el nombre del autor,
    el comentario **como texto plano** (nunca `dangerouslySetInnerHTML` — probado pasando un
    comentario con `<script>alert(1)</script>` y verificando que se renderiza literal, mismo
    charter que `qa-plan.md` §8.3), la fecha formateada (`formatDateTime`, reusado de
    `order-history`); cuando `isOwn && hidden` muestra el texto "Oculta por moderación" (no sólo
    un ícono/color); `ReviewsList` delega a `ReviewsSummary` el caso de lista vacía (no
    renderiza un `<ul>` vacío sin explicación).
  - **Verify**: `pnpm --filter @dsm/web test -- ReviewsList`

- [x] **T-A9 — `ReviewsSection.tsx` + `.test.tsx` (orquestador, los 4 `viewerState`)**
  - **Pattern**: `per design.md §D2` — unión discriminada `ViewerReviewState`, nunca dos
    booleanos (`isGuest`/`isEligible`) combinados a mano.
  - **Exit criterion**: con `viewerState.kind === 'guest'` renderiza `ReviewGuestPrompt` y NO
    `ReviewForm`; con `'ineligible'` no renderiza ni `ReviewForm` ni `ReviewGuestPrompt` (AC-6 —
    ausencia total, no un mensaje); con `'eligible-new'` renderiza `ReviewForm` sin
    `initialValue`; con `'eligible-editing'` renderiza `ReviewForm` con `initialValue` igual a
    `ownReview`; en los cuatro casos renderiza `ReviewsSummary` + `ReviewsList` a partir de
    `reviews: AsyncState<ReviewViewModel[]>` (estados `idle`/`loading`/`success`/`error`
    explícitos, mismo patrón que `PurchaseHistoryList.tsx`).
  - **Verify**: `pnpm --filter @dsm/web test -- ReviewsSection`

- [x] **T-A10 — `ReviewsSection.a11y.test.tsx` — axe-core sobre los 4 `viewerState` (mismo criterio que `order-history/a11y.test.tsx`)**
  - **Exit criterion**: montado con datos de fixture para cada uno de los 4 `viewerState` (más
    `reviews.status === 'loading'` y `'error'`), axe-core reporta 0 violaciones
    `serious`/`critical` en los 6 casos.
  - **Verify**: `pnpm --filter @dsm/web test -- ReviewsSection.a11y`

- [x] **T-A11 — Frontera estructural: Fase A no toca `ProductDetail.tsx`/`ProductPage.tsx`/ningún archivo bajo `apps/web/app/`**
  - **Exit criterion**: ningún archivo fuera de `apps/web/src/features/reviews/` cambió como
    parte de la Fase A — la composición en la ficha real es explícitamente Fase B (`design.md`
    tabla de Riesgos, fila 2).
  - **Verify**: `git diff --stat apps/web/src/features/storefront apps/web/app` vacío

**Fin de Fase A — cerrable en este punto.** Todo lo de arriba pasa sin ningún change adicional
abierto. `develop-frontend-web` puede marcar la Fase A como Done independientemente de cuándo
arranque la Fase B.

---

## Fase B — Desbloqueada (`US-025-resenas-calificaciones-productos-backend` archivado, PR #130)

> El bloqueo original (`Blocked-by: US-025-resenas-calificaciones-productos-backend`) se levantó
> el 2026-09-06: el change de backend se archivó (PR #130 mergeado, contrato publicado en
> `apps/api/docs/api/openapi.yaml`, codegen ya corrido y sin diff pendiente — ver `design.md`
> §D5). Las anotaciones `Blocked-by` de cada task se conservan como registro histórico de la
> dependencia, no como bloqueo activo.
>
> **T-B9/T-B10/T-B11 son nuevas** (no estaban en el plan original): la vista admin de moderación
> (AC-8), confirmada en el alcance de este change por el dueño después de la planificación
> inicial — ver `proposal.md` "Open questions" #1 y `design.md` §D8.

- [x] **T-B0 — Leer el `design.md` de `US-025-resenas-calificaciones-productos-backend` y resolver `design.md` §D5 de este change**
  - **Blocked-by**: US-025-resenas-calificaciones-productos-backend
  - **Exit criterion**: la forma exacta en que el FE conoce (a) elegibilidad del viewer y (b) su
    reseña propia existente queda documentada como una actualización de `design.md` §D5 de
    este change (campo embebido en el `GET` público vs. endpoint dedicado) — no se empieza
    T-B3 sin esto resuelto.
  - **Verify**: `design.md` §D5 de este change ya no dice "todavía no está resuelto" (revisión manual antes de continuar)

- [x] **T-B1 — Verificar frescura del codegen y borrar `types.provisional.ts`**
  - **Blocked-by**: US-025-resenas-calificaciones-productos-backend
  - **Pattern**: `per openapi-client-codegen` skill — verificación de frescura, no regeneración
    manual; el orquestador ya corrió el codegen antes de esta task.
  - **Exit criterion**: `pnpm --filter @dsm/web codegen` no produce diff;
    `apps/web/src/api/generated/` exporta los DTOs/Zod/MSW de reviews; `types.provisional.ts`
    ya no existe.
  - **Verify**: `pnpm --filter @dsm/web codegen && git status --porcelain apps/web/src/api/generated/` vacío `&& ! test -f apps/web/src/features/reviews/types.provisional.ts`

- [x] **T-B2 — `reviewsService.ts` (repository pattern)**
  - **Blocked-by**: US-025-resenas-calificaciones-productos-backend
  - **Pattern**: `per accountService.ts`/`orderHistoryService.ts` — `session: 'customer'` en las
    llamadas de `/v1/me/reviews/:productId`; `parseContract` sobre cada respuesta; ningún
    componente importa `@/api/generated/endpoints` directamente.
  - **Exit criterion**: `reviewsService` expone `list(slug)`, `upsert(productId, input)`; ambos
    métodos devuelven tipos re-exportados de `@/api/generated/model`, no de
    `types.provisional.ts` (borrado en T-B1).
  - **Verify**: `pnpm --filter @dsm/web test -- reviewsService`

- [ ] **T-B3 — `ReviewsDataContainer.tsx` + tests de integración con MSW**
  - **Blocked-by**: US-025-resenas-calificaciones-productos-backend, T-B0, T-B2
  - **Pattern**: `per msw-setup` skill + `PurchaseHistoryList.tsx` — fetch al montar,
    `AsyncState`, `useSession()` para distinguir `guest` de autenticado, la resolución de T-B0
    para distinguir `ineligible`/`eligible-new`/`eligible-editing`, refetch de la lista tras un
    submit exitoso, mapeo de 403→`ineligible` y 422→`fieldError` vía `AppError`.
  - **Exit criterion**: cubre loading/success/error de la carga inicial, los 4 `viewerState`
    derivados de sesión+backend, y el ciclo completo de submit (éxito, 403, 422) — con MSW,
    nunca con `fetch` real.
  - **Verify**: `pnpm --filter @dsm/web test -- ReviewsDataContainer`

- [ ] **T-B4 — Componer en `ProductDetail.tsx`**
  - **Blocked-by**: US-025-resenas-calificaciones-productos-backend, T-B3
  - **Exit criterion**: `ReviewsDataContainer` se renderiza debajo del bloque de descripción,
    recibiendo `productSlug={product.slug}`; `ProductDetail.tsx` sigue siendo Server Component
    (el container es la única hoja `'use client'`, mismo patrón que `ProductPurchase.tsx`).
  - **Verify**: `pnpm --filter @dsm/web test -- ProductDetail`

- [x] **T-B5 — Eventos de telemetría**
  - **Blocked-by**: US-025-resenas-calificaciones-productos-backend
  - **Pattern**: `per events.ts` — nuevos `BusinessEvent`: `review_shown`, `review_submitted`,
    `review_submit_failed`; los tres agregados a `PUBLIC_EVENTS` (superficie de cliente, no de
    operador); ninguno lleva el comentario de la reseña ni el nombre del autor (PII/contenido
    libre, mismo criterio que `observability-standards.md` §9).
  - **Exit criterion**: los 3 eventos existen en `BusinessEvent` y en `PUBLIC_EVENTS`; un test
    de `events.ts` confirma que ninguno de los 3 acepta una propiedad `comment`/`authorName`.
  - **Verify**: `pnpm --filter @dsm/web test -- events`

- [x] **T-B6 — `api-stub.mjs`: superficie de reviews para el E2E dev-owned**
  - **Blocked-by**: US-025-resenas-calificaciones-productos-backend, T-B0
  - **Pattern**: `per apps/web/e2e/support/api-stub.mjs` líneas ~624 (`/v1/me` DELETE) — mismo
    criterio de cookies+CSRF real, header de fuerza para simular 403/422 sin sembrar datos
    reales.
  - **Exit criterion (estructural — la prueba de comportamiento real la hace T-B7, que arranca
    este mismo stub vía `playwright.config.ts` `webServer` y le pega por HTTP)**: el archivo
    declara handlers explícitos para `path === '/v1/me/reviews/'` (POST y PATCH, con branches
    para 200/201, 403 vía header de fuerza, 422 vía header de fuerza) y para
    `path.startsWith('/v1/products/') && path.endsWith('/reviews')` (GET, con branch de lista
    vacía).
  - **Verify**: `grep -q "'/v1/me/reviews/'" apps/web/e2e/support/api-stub.mjs && grep -q "endsWith('/reviews')" apps/web/e2e/support/api-stub.mjs` (estructural — T-B7 es quien prueba que el stub responde correctamente en runtime)

- [ ] **T-B7 — `reviews-topology.spec.ts` (E2E dev-owned, `design.md` §D6)**
  - **Blocked-by**: US-025-resenas-calificaciones-productos-backend, T-B6
  - **Pattern**: `per account-deletion-topology.spec.ts` — `page.evaluate(() => fetch(...))`,
    asserts sobre `response.status()`, nunca sobre el DOM (F59).
  - **Exit criterion**: con sesión válida, `POST /v1/me/reviews/{id}` a través del rewrite
    responde 200/201 (no 404 de rewrite ausente — confirma que `/v1/me/:path*` efectivamente
    cubre el nuevo prefijo contra la app **construida**, no sólo por lectura del config); sin
    sesión, responde 401; con el header de fuerza del stub, responde 403 (AC-6) y 422 (AC-9).
  - **Verify**: `pnpm --filter @dsm/web test:e2e -- reviews-topology`

- [ ] **T-B8 — Confirmar que ninguna entrada nueva de `next.config.mjs` hizo falta**
  - **Blocked-by**: T-B7 (el spec de topología es la prueba real; esta task documenta el resultado)
  - **Exit criterion**: `next.config.mjs` no cambió en este change — el rewrite `/v1/me/:path*`
    preexistente cubrió el nuevo prefijo sin modificación, confirmado por T-B7 pasando en verde.
  - **Verify**: `git diff --stat apps/web/next.config.mjs` vacío `&& pnpm --filter @dsm/web test:e2e -- reviews-topology` en verde

### Vista admin de moderación (AC-8, confirmada en alcance — `design.md` §D8)

- [ ] **T-B9 — `adminReviewsService.ts` (repositorio, superficie admin)**
  - **Pattern**: `per productsService.ts` — llama las operaciones generadas directamente (sin
    marca `session`, el token admin viaja por `Authorization: Bearer` desde
    `getAuthToken()`/`adminSession`, mismo mecanismo que `updateProduct`); `parseContract` sobre
    cada respuesta.
  - **Exit criterion**: `adminReviewsService` expone `listForProduct(slug)` (delega en
    `getPublicReviews(slug)` — mismo endpoint que el storefront, `design.md` §D8 explica por
    qué no hay uno dedicado) y `setHidden(reviewId, hidden)` (delega en `moderateReview`);
    ambos devuelven tipos de `@/api/generated/model`.
  - **Verify**: `pnpm --filter @dsm/web test -- adminReviewsService`

- [ ] **T-B10 — Extender `ReviewListItem`/`ReviewsList` con acción admin opcional + `ProductReviewsModeration.tsx`**
  - **Pattern**: `per design.md §D8` — prop opcional `onToggleHidden?(reviewId, hidden)` en
    `ReviewListItemProps`/`ReviewsListProps` (cuando está presente, renderiza un botón
    "Ocultar"/"Mostrar de nuevo" por fila; ausente en la superficie pública, que nunca la pasa);
    `ProductReviewsModeration` mantiene el estado de reseñas ocultas **de forma optimista en
    memoria** (no refetch tras ocultar) — ver la limitación documentada en `design.md` §D8.
  - **Exit criterion**: (a) `ReviewListItem` sin `onToggleHidden` no renderiza ningún botón de
    moderación (no regresión en la superficie pública/storefront); (b) con `onToggleHidden`
    presente, cada fila muestra el botón correspondiente a su estado `hidden` actual; (c)
    `ProductReviewsModeration` carga las reseñas del producto al montar (`AsyncState`), y al
    confirmar ocultar/mostrar actualiza esa reseña en el estado local sin sacarla de la lista ni
    volver a pedir la lista al backend; (d) el copy de la UI indica explícitamente que la
    reseña deja de ser visible/editable desde esta pantalla después de recargar.
  - **Verify**: `pnpm --filter @dsm/web test -- ReviewsList && pnpm --filter @dsm/web test -- ReviewListItem && pnpm --filter @dsm/web test -- ProductReviewsModeration`

- [ ] **T-B11 — Componer `ProductReviewsModeration` en `/admin/productos/{id}`**
  - **Blocked-by**: T-B9, T-B10
  - **Exit criterion**: `apps/web/src/features/products/ProductEdit.tsx` renderiza
    `ProductReviewsModeration` debajo del formulario de edición existente una vez que el
    producto cargó (usa `product.slug`, ya disponible en el estado de `ProductEdit`, ninguna
    prop nueva en la ruta `app/(admin)/admin/productos/[id]/page.tsx`).
  - **Verify**: `pnpm --filter @dsm/web test -- ProductEdit`

## Verification (nivel de suite)

- [ ] Fase A completa: `pnpm --filter @dsm/web test -- reviews` (todos los `*.test.tsx` bajo
      `src/features/reviews/` en verde, sin red)
- [ ] Fase A: lint/type-check limpios: `pnpm --filter @dsm/web lint && pnpm --filter @dsm/web typecheck`
- [ ] Fase B: `pnpm --filter @dsm/web test -- reviews` (incluye
      `reviewsService`/`ReviewsDataContainer`/`adminReviewsService`) +
      `pnpm --filter @dsm/web test:e2e -- reviews-topology`
- [ ] Fase B: `pnpm --filter @dsm/web test -- ProductEdit` (moderación compuesta, T-B11)
- [ ] Fase B: `pnpm --filter @dsm/web codegen` sin diff (gate `frontend-codegen-fresh`)
