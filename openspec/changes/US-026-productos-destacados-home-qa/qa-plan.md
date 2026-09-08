# QA Plan — US-026 Productos destacados en el home

> **Ticket**: US-026 — Productos destacados en el home (Novedades + Más vendidos)
> **Author**: qa-engineer (Claude)
> **Date**: 2026-09-07
> **Status**: Proposed — escrito antes de BE/FE (Modo B, standalone)
> **Affected platform(s)**: backend + frontend-web
> **Service tier(s)**: 2 (vitrina del home, sin dinero involucrado)
> **Companion files**: `proposal.md`, `tasks.md`, `design.md`

---

## 1. Perfil de riesgo

- **Shape público (D-QA2)**: el riesgo real de "más vendidos" — si el
  endpoint reusa u operacionaliza mal el query de `ReportsRepository.
  topProducts` (admin-only), podría filtrar `revenue_ars_cents` o `id` a
  una superficie pública sin auth. Se prueba explícitamente, no se asume.
- **Caché per-handler (D-QA3)**: el hallazgo real de US-025 (PR #139) — si
  las 2 rutas nuevas no declaran su propio `@StorefrontCache`, heredan el
  TTL de cualquier default de clase (o, peor, quedan sin ningún
  `Cache-Control`, perdiendo el NFR de rendimiento del home).
- **Filtrado de `status`**: un producto despublicado con historial de
  ventas real NO debe aparecer en "más vendidos" — journey crítica.

Journeys críticas identificadas:
1. Visitante entra al home → ve "Novedades" (últimos publicados) y "Más
   vendidos" (ranking real de ventas), cada card linkea a su ficha.
2. Catálogo recién lanzado (sin ventas, o sin productos) → ninguna sección
   rota ni con datos inventados.
3. Un producto vendido y luego archivado → desaparece de "más vendidos"
   pese a su historial.

---

## 2. Matriz de test (QA-owned)

| Capa | Requerida | Herramienta | Qué cubre |
|---|---|---|---|
| Unit / Integration BE+FE | Dev-owned (TDD) | Jest/Vitest | Query de agregado, componente de sección — **no planificado acá** |
| **Acceptance (BDD)** | ✅ Sí | Cucumber-js + supertest (`qa/acceptance/`) | AC-1..AC-8 a nivel API |
| **Contract** | ✅ Sí | Supertest directo (shape + headers) | Shape público (D-QA2) + `Cache-Control` per-ruta (D-QA3) |
| **E2E cross-stack (Playwright)** | ✅ Sí | Playwright (`qa/e2e/`) | El home real mostrando ambas secciones |
| **Exploratory** | ✅ Sí | Charters | Catálogo con 1000+ productos (performance del agregado), producto con ventas pero stock 0 |

---

## 3. Escenarios BDD (Gherkin)

```gherkin
# language: es
@destacados @us-026
Característica: Productos destacados en el home (US-026)
  Como visitante de la tienda
  quiero ver una selección de productos destacados en el home
  para descubrir artículos concretos sin entrar primero a una categoría

  # ─── HAPPY PATH ───

  @happy @critical-path
  Escenario: SC-026-H1 — Novedades muestra los últimos publicados (AC-1)
    Dado 3 productos publicados en orden de alta: A (más viejo), B, C (más nuevo)
    Cuando consulto la sección de novedades
    Entonces los veo en orden C, B, A (del más nuevo al más viejo)

  @happy @critical-path
  Escenario: SC-026-H2 — Más vendidos ordena por cantidad vendida (AC-2)
    Dado el producto X vendido 5 unidades y el producto Y vendido 2 unidades (órdenes confirmadas)
    Cuando consulto la sección de más vendidos
    Entonces X aparece antes que Y

  # ─── EDGE CASE ───

  @edge
  Escenario: SC-026-E1 — Menos de 8 productos disponibles (AC-3)
    Dado sólo 3 productos publicados en todo el catálogo
    Cuando consulto novedades
    Entonces recibo exactamente esos 3, sin relleno ni error

  # ─── NEGATIVE SPACE ───

  @negative @critical-path
  Escenario: SC-026-N1 — Catálogo sin ningún producto publicado (AC-4)
    Dado que no hay ningún producto en estado "published"
    Cuando consulto novedades y más vendidos
    Entonces ambas responden vacío (sin error), nunca un 404 ni datos inventados

  @negative
  Escenario: SC-026-N2 — Sin ventas confirmadas todavía (AC-5)
    Dado productos publicados pero ninguna orden fuera de "pending_payment"/"cancelled"
    Cuando consulto más vendidos
    Entonces la respuesta es vacía
    Y novedades sigue mostrando productos igual (criterios independientes)

  @negative @critical-path
  Escenario: SC-026-N3 — Empate de ventas es determinista (AC-6)
    Dado dos productos con exactamente la misma cantidad vendida
    Cuando consulto más vendidos dos veces seguidas
    Entonces el orden entre ellos es idéntico en ambas respuestas (mismo tie-break por id)

  @negative @critical-path
  Escenario: SC-026-N4 — Producto despublicado no aparece pese a su historial (AC-7)
    Dado un producto que fue "published", tuvo ventas reales, y luego pasó a "archived"
    Cuando consulto más vendidos
    Entonces ese producto NO aparece

  @negative
  Escenario: SC-026-N5 — Sin stock, visible pero marcado (AC-8)
    Dado un producto publicado sin stock que califica para novedades
    Cuando aparece en la sección
    Entonces se lo ve marcado sin stock, no oculto (mismo criterio que el listado por categoría)
```

**Tooling**: Cucumber-js con `qa/acceptance/steps/destacados.steps.ts`.
**Location**: `qa/acceptance/features/destacados.feature`.
**Reuses**: `qa/support/seed-ordenes.ts` (`catalogoParaCheckout`,
`crearOrdenEnEstado` — CUALQUIERA de `new`/`preparing`/`ready`/`delivered`
cuenta para "más vendidos", a diferencia de US-025-qa que exigía
`delivered` específicamente, D-QA4).

**Ejecutado (2026-09-07, `/develop-qa`)**: 8/8 escenarios verdes contra el
BE real (ya mergeado, PR #146) + Postgres aislado propio, 3 corridas
limpias en proceso/DB fresca. **Corrección real de metodología** (no de
producto): `this.state` (el World de Cucumber) se resetea en CADA
escenario, así que la continuidad narrativa entre SC-026-N2 y SC-026-E1
(mismo catálogo acumulando de a poco, per el orden declarado arriba) usa un
acumulador de **módulo** (`productosAcumulados`), no `this.state` — el
primer intento con `this.state` fallaba porque el estado "recordado" de un
escenario anterior nunca llegaba al siguiente. Los escenarios que necesitan
un conteo EXACTO del catálogo (N1, E1) se reordenaron al PRINCIPIO del
archivo (antes que cualquier otro cree productos/órdenes) — documentado en
el propio `.feature`. `QA-026-CT-1`/`QA-026-CT-2` (ver §4) también viven en
este mismo archivo, no en un contract-test separado — más simple y
suficiente para lo que hacía falta verificar. Ver `tasks.md` T-QA2.

---

## 4. Contract testing (shape público + caché — D-QA2/D-QA3)

- [x] **QA-026-CT-1**: El shape público de ambos endpoints nunca expone `id`/`status`/`revenue_ars_cents`
  - Exit criterion: un spec valida que `GET /v1/products/novedades` y
    `GET /v1/products/mas-vendidos` devuelven exactamente el shape de
    `StorefrontProductListItemDto` (`slug`, `name`, `price_ars_cents`,
    `currency`, `image_url`, `in_stock`) — ningún campo extra, en
    particular ni `id` ni `revenue_ars_cents` (D-QA2: la frontera con el
    reporte admin de US-016).
  - Verify: `pnpm --filter @dsm/qa test:contract -- --testPathPattern=destacados` (exit 0, cuando BE-US-026 exista)
  - **Nota de ejecución (2026-09-07)**: verde. Implementado como escenario
    Cucumber (`QA-026-CT-1` en `destacados.feature`), no como spec de
    contract testing separado — verifica las claves de cada item de ambas
    respuestas contra el shape real, confirmado además a mano con `curl`
    contra el BE real: exactamente `slug/name/price_ars_cents/currency/
    image_url/in_stock`, sin `id`/`status`/`revenue_ars_cents`.

- [x] **QA-026-CT-2**: `Cache-Control` declarado explícitamente por ruta (D-QA3)
  - Exit criterion: ambas rutas responden con un `Cache-Control` propio
    (no `undefined`, no heredado sin querer de otra ruta) — mismo criterio
    de "declarado, no heredado" que el fix de US-025 (PR #139).
  - Verify: supertest inspecciona el header `cache-control` de ambas
    respuestas 200 y falla si está ausente o si coincide byte-a-byte con
    el de una ruta que NO debería compartir TTL (ej. `/me/reviews/:slug`,
    que es `no-store`).
  - **Nota de ejecución (2026-09-07)**: verde. `QA-026-CT-2` en
    `destacados.feature` confirma `Cache-Control: public, max-age=60,
    stale-while-revalidate=30` en ambas rutas (declarado per-handler,
    `@StorefrontCache({maxAge:60,swr:30})` — verificado leyendo el código
    real, no asumido) — distinto y explícito, no heredado por accidente
    como el hallazgo de US-025.

---

## 5. E2E Playwright (cross-stack)

- [ ] **QA-026-E2E-1**: El home real muestra ambas secciones
  - Exit criterion: `qa/e2e/destacados.spec.ts` — con productos + una
    venta confirmada sembrados, navega a `/`, ve "Novedades" y "Más
    vendidos" con al menos 1 card cada una, cada card linkea a su ficha.
  - Verify: `pnpm --filter @dsm/qa exec playwright test destacados.spec.ts --reporter=list` (exit 0, cuando FE-US-026 exista)
  - **Blocked-by**: FE-US-026.

- [ ] **QA-026-E2E-2**: Catálogo vacío no rompe el home
  - Exit criterion: sin productos publicados, el home carga igual (hero +
    rubros intactos), sin ninguna sección de destacados ni error visible.
  - Verify: incluido en el mismo spec, corrida separada.
  - **Blocked-by**: FE-US-026.

---

## 6. Datos y fixtures

### Seeds requeridos

- Ninguno nuevo — reusa `qa/support/seed-ordenes.ts` (`catalogoParaCheckout`
  para productos, `crearOrdenEnEstado` para ventas confirmadas en
  cualquiera de los 4 estados que cuentan).

### Builders requeridos

- Ninguno nuevo.

---

## 7. Exploratory charters

Agregar a `qa/exploratory/charters.md`:

1. **Charter: Catálogo con 1000+ productos** — verificar que el agregado
   de "más vendidos" no degrada el TTFB del home (el `LIMIT 8` debería
   hacerlo trivial, pero vale medirlo una vez con volumen real).
2. **Charter: Producto con ventas históricas pero stock 0 hoy** — confirmar
   que aparece en "más vendidos" marcado sin stock (AC-8 aplica también acá,
   no sólo a "novedades").
3. **Charter: Refrescar el home varias veces seguidas** — confirmar
   visualmente que el `Cache-Control` de ambas rutas efectivamente evita
   golpear la DB en cada request dentro del TTL (D-QA3, verificación manual
   complementaria al contract test automatizado).

---

## 8. Quality gates

| Gate | Blocks | Trigger |
|---|---|---|
| Acceptance BDD (API-level) | merge | todo PR que toque los 2 endpoints nuevos |
| Contract (shape + caché) | merge | ídem |
| E2E Playwright | uat promotion | post-deploy staging |

---

## 9. Anti-patterns evitados

- ❌ "Reusar el reporte admin de US-016 sin revisar el shape" — D-QA2 lo
  prueba explícitamente como regresión de superficie, no sólo funcional.
- ❌ "Asumir que la caché está bien porque el contenido es correcto" —
  D-QA3 es un test-case propio, no una nota al pie.
- ❌ "Sembrar la venta con una compra logueada" — a diferencia de
  US-025-qa, acá no hace falta: el ranking es agregado global
  (`crearOrdenEnEstado` de invitado alcanza, D-QA4).

---

## 10. Preguntas abiertas

Ninguna — los 8 AC de la US ya resuelven las decisiones de producto
relevantes.

---

## 11. Dependencias declaradas

| Dependencia | Estado | Efecto |
|---|---|---|
| BE-US-026 (`GET /v1/products/novedades`, `GET /v1/products/mas-vendidos`) | No planificado todavía | **BLOQUEA** acceptance BDD, contract testing |
| FE-US-026 (secciones en el home) | No planificado todavía | **BLOQUEA** E2E Playwright |
| US-001/US-002 (catálogo, Done) | Resuelto | Necesario para productos publicados |
| US-008/US-010 (checkout + confirmación, Done) | Resuelto | Necesario para órdenes confirmadas |

---

## 12. Standards consultados

- `docs/quality/testing-standards.md` §2, §5, §12
- `docs/quality/qa-backend-standards.md` §2.1, §21
- `docs/quality/qa-frontend-standards.md` §2.1, §24
- `docs/user-stories/US-026-productos-destacados-home.md` (fuente de los 8 AC)
