# QA Plan — US-025 Reseñas y calificaciones de productos

> **Ticket**: US-025 — Reseñas y calificaciones de productos
> **Author**: qa-engineer (Claude, sesión de cierre de US-022)
> **Date**: 2026-09-06
> **Status**: Proposed — escrito antes de BE/FE (Modo B, standalone)
> **Affected platform(s)**: backend + frontend-web
> **Service tier(s)**: 2 (prueba social, sin dinero involucrado)
> **Companion files**: `proposal.md`, `tasks.md`, `design.md`

---

## 1. Perfil de riesgo

- **Regla de elegibilidad (AC-1/AC-6/AC-7)**: el riesgo real de esta US. Si
  el endpoint confía en algo que el cliente controla (un flag en el body,
  "ya compré" sin verificar server-side), cualquiera podría reseñar sin
  haber comprado — journey crítica a probar con más de un escenario
  (negative-space directo por API, no sólo "el botón no aparece en el FE").
- **Una reseña por cliente por producto (AC-5)**: si el `@@unique` falla o
  el endpoint hace `INSERT` en vez de `UPSERT`, un cliente podría inflar el
  promedio con múltiples reseñas del mismo producto.
- **Moderación (AC-8)**: riesgo de que "ocultar" borre en vez de marcar — lo
  que rompería la transparencia hacia el autor (D-QA4 de `design.md`).
- Sin dinero, sin PII nueva más allá del nombre (ya cubierto por US-024) —
  tier 2.

Journeys críticas identificadas:
1. Cliente con una compra `delivered` reseña un producto → ve su reseña y el
   promedio actualizado.
2. Cliente sin esa compra intenta reseñar (por UI o por API directa) → 403
   siempre, sin excepción.
3. Dueño oculta una reseña ofensiva → deja de contar en el promedio, el
   autor lo ve reflejado.

---

## 2. Matriz de test (QA-owned)

| Capa | Requerida | Herramienta | Qué cubre |
|---|---|---|---|
| Unit / Integration BE+FE | Dev-owned (TDD) | Jest/Vitest | Validación de DTO, cálculo de promedio, componente de estrellas — **no planificado acá** |
| **Acceptance (BDD)** | ✅ Sí | Cucumber-js + supertest (`qa/acceptance/`) | AC-1..AC-9 a nivel API |
| **E2E cross-stack (Playwright)** | ✅ Sí | Playwright (`qa/e2e/`) | Flujo completo desde la ficha del producto |
| **Accesibilidad** | ✅ Sí | axe-core (`qa/e2e/*a11y*`) | El control de estrellas (`radiogroup`) y la lista de reseñas son navegables por teclado |
| **Contract** | ✅ Sí | Spectral + supertest vs OpenAPI | Endpoints de reviews matchean el schema |
| **Carga (opcional, D-QA3)** | Sanidad, no gate | K6 | `GET .../reviews` con volumetría realista de decenas de reseñas |
| **Exploratory** | ✅ Sí | Charters | Doble reseña concurrente, reseña tras cancelación/reembolso de la orden que la habilitó |

---

## 3. Escenarios BDD (Gherkin)

```gherkin
# language: es
@resenas @us-025
Característica: Reseñas y calificaciones de productos (US-025)
  Como cliente que compró un producto
  quiero calificarlo con estrellas y un comentario
  para ayudar a otros compradores a decidir

  # ─── HAPPY PATH ───

  @happy @critical-path
  Escenario: SC-025-H1 — Dejar una reseña de un producto comprado y entregado (AC-1)
    Dado un cliente autenticado con una orden en estado "delivered" que incluye el producto "Taladro X"
    Cuando elige 4 estrellas y escribe "Anduvo bien, tardó lo esperado"
    Entonces la reseña se guarda asociada a su cliente y al producto
    Y aparece en la lista de reseñas del producto

  @happy
  Escenario: SC-025-H2 — Calificar sin comentario (AC-2)
    Dado un cliente elegible para reseñar un producto
    Cuando elige 5 estrellas y no escribe ningún comentario
    Entonces la reseña se guarda igual, sólo con la calificación

  @happy
  Escenario: SC-025-H3 — Ver el promedio y el conteo en la ficha (AC-3)
    Dado un producto con 3 reseñas visibles de 5, 4 y 3 estrellas
    Cuando cualquier persona entra a la ficha del producto
    Entonces ve el promedio "4.0" y "3 reseñas"

  @happy
  Escenario: SC-025-H4 — Producto sin reseñas todavía (AC-4)
    Dado un producto sin ninguna reseña
    Cuando cualquier persona entra a su ficha
    Entonces ve un estado "Sin reseñas todavía", no un promedio ni una lista vacía sin explicación

  @happy @critical-path
  Esquema del escenario: SC-025-H5 — Editar la propia reseña (AC-5)
    Dado un cliente que ya dejó una reseña de un producto con "<calificación_original>" estrellas
    Cuando vuelve a la ficha y cambia su calificación a "<calificación_nueva>" estrellas
    Entonces se actualiza la MISMA reseña, no se crea una segunda
    Y el conteo total de reseñas del producto no aumenta

    Ejemplos:
      | calificación_original | calificación_nueva |
      | 3                      | 5                   |

  @happy
  Escenario: SC-025-H6 — El dueño oculta una reseña (AC-8)
    Dado una reseña visible con contenido ofensivo
    Cuando el dueño la oculta desde el panel admin
    Entonces deja de contarse en el promedio y de listarse en la ficha pública
    Y el cliente autor, si vuelve a la ficha, ve su reseña marcada "oculta por moderación" (no desaparece en silencio)

  # ─── NEGATIVE SPACE ───

  @negative @critical-path
  Escenario: SC-025-N1 — No comprado (o no entregado) → no puede reseñar (AC-6)
    Dado un cliente autenticado que nunca compró "Taladro X", o cuya orden con ese producto no llegó a "delivered"
    Cuando intenta un POST directo a la API de reseñas para "Taladro X"
    Entonces el sistema lo rechaza con 403, sin importar qué envíe en el body
    Y en la ficha del producto no ve ningún control para reseñar

  @negative @critical-path
  Escenario: SC-025-N2 — Invitado no puede reseñar (AC-7)
    Dado una persona sin sesión iniciada (incluye quien compró como invitado, US-008)
    Cuando entra a la ficha de un producto
    Entonces no ve ningún control para dejar una reseña
    Y se le explica que necesita una cuenta para reseñar

  @negative
  Escenario: SC-025-N3 — Calificación fuera de rango es rechazada (AC-9)
    Dado un cliente elegible dejando una reseña
    Cuando envía una calificación de 0 o de 6 estrellas
    Entonces el sistema la rechaza con un mensaje claro
    Y no se guarda ninguna reseña
```

**Tooling**: Cucumber-js con `qa/acceptance/steps/resenas.steps.ts`.
**Location**: `qa/acceptance/features/resenas.feature`.
**Reuses**: `qa/support/seed-resenas.ts` (`compraEntregada`, ver nota de
ejecución abajo — `crearOrdenEnEstado` original resultó ser siempre de
invitado) para la elegibilidad, `qa/support/customer-auth.ts` para la sesión.

**Ejecutado (2026-09-06, `/develop-qa`)**: 9/9 escenarios verdes contra el BE
real (endpoints de reviews, ya mergeados a main) + Postgres aislado propio,
3 corridas limpias consecutivas. **AC-8 (moderación) verificado sólo a nivel
API** — el escenario de UI (el dueño oculta una reseña desde el panel admin)
queda pendiente para cuando el FE de moderación (Fase B de FE-US-025)
aterrice, per pedido explícito de la coordinadora tras el enrich de esa
decisión (2026-09-06). **Corrección real sobre D-QA2** (ver `design.md`):
`crearOrdenEnEstado` es SIEMPRE de invitado (`checkoutReal` usa
`nuevoInvitado()`, deja `customer_id: null`) — no sirve para elegibilidad,
que exige una orden ligada a un cliente logueado. Se construyó
`compraEntregada` (checkout logueado real + `simulate-payment` + los mismos
`PATCH` admin de avance de estado) en su lugar. Ver `tasks.md` T-QA2.

---

## 4. Contract testing

- [ ] **QA-025-CT-1**: Supertest contract test para los endpoints de reviews
  - Exit criterion: un spec valida que `POST/PATCH /v1/me/reviews/:slug`
    (200/201, 403, 422) y `GET /v1/products/:slug/reviews` (200) matcheen el
    schema declarado en OpenAPI.
  - Verify: `pnpm --filter @dsm/qa test:contract -- --testPathPattern=reviews` (exit 0, cuando BE-US-025 publique el endpoint)
  - **Blocked-by**: BE-US-025.

- [ ] **QA-025-CT-2**: Contract del endpoint de moderación admin
  - Exit criterion: `PATCH /v1/admin/reviews/:id` matchea el schema
    (requiere rol admin — 401/403 si no).
  - Verify: `pnpm --filter @dsm/qa test:contract -- --testPathPattern=admin-reviews` (exit 0, cuando exista)
  - **Blocked-by**: BE-US-025.

---

## 5. E2E Playwright (cross-stack)

- [x] **QA-025-E2E-1**: Spec Playwright — dejar y editar una reseña desde la ficha
  - Exit criterion: `qa/e2e/resenas.spec.ts` — con una orden `delivered`
    sembrada, navega a la ficha, deja una reseña, la edita, verifica que el
    promedio se actualiza.
  - Verify: `pnpm --filter @dsm/qa exec playwright test resenas.spec.ts --reporter=list` (exit 0, cuando FE-US-025 exista)
  - **Nota de ejecución (2026-09-07)**: verde, 3 corridas limpias en proceso
    fresco (stack aislado propio). Encontró un defecto real de backend
    (`StorefrontCacheInterceptor` a nivel de clase cacheaba
    `GET /products/:slug/reviews` con el mismo TTL que el precio — el
    promedio no se refetcheaba tras dejar una reseña, violando AC-3 en la
    práctica). No se debilitó el assert; se reportó y BE lo corrigió (PR
    #139, `@StorefrontCache({maxAge:0, swr:0})` sólo en esa ruta) antes de
    cerrar esta task.

- [x] **QA-025-E2E-2**: Spec Playwright — sin control de reseña si no es elegible
  - Exit criterion: con un cliente sin compra `delivered` de ese producto,
    la ficha no muestra el control de reseñar.
  - Verify: incluido en el mismo spec de arriba, corrida separada.
  - **Nota de ejecución (2026-09-07)**: verde — 2 escenarios separados
    (E2E-2a: cliente logueado que nunca compró; E2E-2b: invitado sin
    sesión), ambos sin el `radiogroup` de calificación visible.

- [x] **QA-025-E2E-3 (agregado tras el cierre de US-022/TC-731)**: moderación
  por UI — el dueño oculta una reseña desde `/admin/productos/{id}` y deja
  de verse en la ficha pública.
  - Exit criterion: `qa/e2e/resenas.spec.ts` — login admin real (form de
    `/admin/acceso`, bootstrap token), oculta la reseña desde
    `ProductReviewsModeration`, y una **navegación nueva** a la ficha
    pública (no el estado optimista del propio panel admin) confirma que
    ya no aparece.
  - Verify: incluido en `resenas.spec.ts`, mismo comando que QA-025-E2E-1.
  - **Nota de ejecución (2026-09-07)**: verde, 3 corridas limpias. Mismo
    defecto de caché que QA-025-E2E-1 lo bloqueaba (la ficha pública no
    reflejaba el ocultamiento hasta que expiraba el caché) — resuelto por
    el mismo fix (PR #139).

- [ ] **QA-025-A11Y-1**: axe-core sobre el control de estrellas + lista de reseñas
  - Exit criterion: `qa/e2e/resenas-a11y.spec.ts` corre axe sobre la sección
    de reseñas de la ficha; 0 violaciones. El control de estrellas usa
    `role="radiogroup"`/`role="radio"`, navegable con flechas y anunciado
    ("N de 5 estrellas").
  - Verify: `pnpm --filter @dsm/qa test:a11y -- --grep "resenas"` (exit 0, cuando FE-US-025 exista)
  - **Blocked-by**: FE-US-025.

---

## 6. Carga (opcional, D-QA3 — sanidad, no gate de merge)

- [ ] **QA-025-PERF-1**: Smoke K6 de `GET /v1/products/:slug/reviews`
  - Exit criterion: contra un producto con ~50 reseñas sembradas, el
    endpoint responde consistentemente (sin threshold estricto — la US no
    declara un NFR numérico de esta capa, per D-QA3). Se reporta el p95
    medido, no se bloquea el merge por él.
  - Verify: `pnpm --filter @dsm/qa k6 run performance/resenas.js` (reporta, no falla)
  - **Blocked-by**: BE-US-025.

---

## 7. Datos y fixtures

### Seeds requeridos

- **Ninguno nuevo para elegibilidad** — `qa/support/seed-ordenes.ts` ya
  expone `crearOrdenEnEstado(slug, 'delivered')`, que hace el checkout real
  + avanza el estado hasta `delivered` vía la API (nunca `UPDATE` directo).
- `seed-resenas.ts` (nuevo, chico): siembra N reseñas de distintos clientes
  sobre un mismo producto, para los escenarios de promedio/conteo (SC-025-H3)
  y el smoke de carga (QA-025-PERF-1) — reusa `crearOrdenEnEstado` por cada
  cliente antes de dejar su reseña (nunca inserta la reseña sin la orden que
  la habilita).

### Builders requeridos

- `buildReviewBody(overrides?)`: genera `{ rating, comment }` con defaults
  válidos (rating 1-5).

---

## 8. Exploratory charters

Agregar a `qa/exploratory/charters.md`:

1. **Charter: Doble reseña concurrente del mismo cliente** — dos requests
   simultáneos de `POST /v1/me/reviews/:slug` del mismo cliente sobre
   el mismo producto; verificar que el `@@unique([customer_id, product_id])`
   deja una sola fila (upsert, no dos filas ni un 500).
2. **Charter: Reseña tras cancelar/reembolsar la orden que la habilitó** —
   un cliente reseña con una orden `delivered`, y luego (si el negocio lo
   permitiera) esa orden se cancela/reembolsa; verificar qué pasa con la
   reseña ya existente (¿se mantiene? ¿se debería revisar? — no hay AC que
   lo cubra, es exploratorio a propósito).
3. **Charter: Comentario con contenido malicioso (XSS)** — pegar
   `<script>alert(1)</script>` como comentario; verificar que se renderiza
   como texto plano, nunca interpretado (mismo criterio que el texto legal
   de US-017).

---

## 9. Quality gates

| Gate | Blocks | Trigger |
|---|---|---|
| Acceptance BDD (API-level) | merge | todo PR de `src/reviews/` (o el módulo que BE-US-025 defina) |
| Contract (supertest vs OpenAPI) | merge | todo PR que toque los endpoints |
| E2E Playwright | uat promotion | post-deploy staging |
| a11y (axe) | merge | todo PR que toque la sección de reseñas |
| Carga (K6) | reporte, no bloquea | post-deploy staging |

---

## 10. Anti-patterns evitados

- ❌ "Confiar en un flag del FE para elegibilidad" — el 403 del backend es
  la garantía real (D-QA de la US §9); el FE ocultar el control es sólo UX.
- ❌ "Sembrar la reseña sin la orden que la habilita" — todo seed de reseña
  pasa primero por `crearOrdenEnEstado(..., 'delivered')`, nunca un `INSERT`
  directo en `reviews` sin la orden real detrás.
- ❌ "Moderación = borrado en el test" — SC-025-H6 verifica explícitamente
  que el autor sigue viendo su reseña (marcada), no que desaparezca (D-QA4).

---

## 11. Preguntas abiertas

Ninguna sin resolver — ver `proposal.md`. La interpretación de "comprado" =
orden `delivered` está fijada por la US, no por este plan.

---

## 12. Dependencias declaradas

| Dependencia | Estado | Efecto |
|---|---|---|
| BE-US-025 (endpoints de reviews) | No planificado todavía | **BLOQUEA** acceptance BDD, contract testing, carga |
| FE-US-025 (control de estrellas + lista) | No planificado todavía | **BLOQUEA** E2E Playwright, a11y |
| US-008 (checkout, Done) | Resuelto | Necesario para `crearOrdenEnEstado` |
| US-013 (estado `delivered`, Done) | Resuelto | Necesario para `crearOrdenEnEstado` |
| US-014 (cuentas, Done) | Resuelto | Necesario para la sesión del cliente |

---

## 13. Standards consultados

- `docs/quality/testing-standards.md` §2, §5, §12
- `docs/quality/qa-backend-standards.md` §2.1, §21
- `docs/quality/qa-frontend-standards.md` §2.1, §19 (a11y), §24 (BDD/E2E)
- `docs/cross-cutting/performance-standards.md` §7 (K6, ver D-QA3 — sin
  threshold estricto porque la US no declara un NFR numérico de esta capa)
- `docs/user-stories/US-025-resenas-calificaciones-productos.md` (fuente de
  los 9 AC)
