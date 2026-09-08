---
tracker-id: null
tracker-source: null
parent-us: US-026
discipline: frontend-web
variant: null
language: es
audit-derived: false
---

# Proposal — US-026 Productos destacados en el home (frontend web)

> **Ticket**: US-026 — Productos destacados en el home
> **Author**: frontend-web-developer agent (assisted by @gabogosp)
> **Date**: 2026-09-07
> **Status**: Proposed
> **Affected layers**: components (presentational), repository (HTTP client, Fase B), composición SSR de `app/(storefront)/page.tsx`
> **Affected platform**: web

## Why

Hoy el home (`app/(storefront)/page.tsx`, US-002 AC-1) es deliberadamente una landing de
categorías: hero + grilla de rubros, sin ningún producto — pensado para SEO/indexación. El dueño,
comparando con Mercado Libre, pidió que el home también muestre productos concretos para acortar
el camino a la compra. La decisión de producto ya está tomada (US-026 §10, vía la coordinadora):
**ambas** secciones — "Novedades" (últimos publicados) y "Más vendidos" (ranking histórico de
ventas) — 8 productos cada una, orden Novedades→Más vendidos, sin ventana de tiempo en "más
vendidos". No hay Figma; el diseño hereda de `docs/product/design-system.md` y reusa el
componente de card de producto ya existente (US-002/US-003), sin inventar uno nuevo (US §8).

**El backend de esta US todavía no está planificado** (`GET /v1/products/novedades` y
`GET /v1/products/mas-vendidos` sólo están sketcheados en US §7, no publicados como contrato
OpenAPI real). Este plan aplica el mismo patrón de dos fases que
`US-024-edicion-perfil-cliente-frontend-web` y
`US-025-resenas-calificaciones-productos-frontend-web` (ambos archivados): una Fase A
presentacional, sin ningún acoplamiento a red, cerrable en esta misma sesión; y una Fase B de
wiring, bloqueada hasta que el backend publique el contrato y el codegen lo materialice.

## What

Dos secciones nuevas ("Novedades" y "Más vendidos") debajo de la grilla "Explorá por rubro" en
`app/(storefront)/page.tsx`, cada una reusando `ProductCard` verbatim (imagen, nombre, precio,
badge de sin-stock — comportamiento ya existente, ninguna reimplementación) y renderizada
server-side (SSR, sin JS de cliente para el contenido — el home sigue siendo indexable, mismo
criterio que el resto del storefront). Cada sección es independientemente resiliente: si no hay
datos (catálogo vacío, o sin ventas todavía), esa sección no se renderiza — nunca un título sin
contenido.

Este change también relaja `ProductCard.categoryName` a opcional (widening compatible hacia
atrás — ningún call-site existente cambia) porque los productos destacados del home no
pertenecen a una única categoría, a diferencia de la grilla de una página de categoría.

## Out of scope

- **Backend**: los dos endpoints nuevos (`novedades`, `mas-vendidos`) — pertenecen a
  `US-026-productos-destacados-home-backend` (change todavía no planificado). Fase B de este
  plan queda `Blocked-by` de ese change.
- **QA E2E cross-stack dedicado**: la US §7 no pide un change `-qa` propio (mismo criterio que
  US-014/US-017/US-024/US-025) — QA vive dentro de este change (Fase A) y del backend.
- **Carrusel / interacción de scroll horizontal**: se usa la misma grilla estática ya usada en el
  listado por categoría (`CategoryPage.tsx`), no un carrusel — ver `design.md` D3 (decisión
  explícita, no un olvido).
- **Curación manual, calificación/reseñas, ventana de tiempo en "más vendidos"**: descartados
  por el dueño (US §4, §10) — no forman parte de ningún alcance de este change.
- **Rediseño de la landing de categorías existente**: la sección "Explorá por rubro" no se toca
  (sigue con su estructura h2+section sin `aria-labelledby`, precedente ya en producción).

## Affected components / screens

- `apps/web/src/features/storefront/ProductCard.tsx` — `categoryName` pasa a opcional (Fase A).
- `apps/web/src/features/storefront/HomeFeaturedSection.tsx` — nuevo, presentacional (Fase A).
- `apps/web/src/features/storefront/HomeFeaturedViewTracker.tsx` — nuevo, telemetría leaf
  (Fase A).
- `apps/web/src/lib/observability/events.ts` — nuevo `BusinessEvent`: `home_featured_shown`
  (Fase A).
- `apps/web/src/features/storefront/homeFeaturedService.ts` — nuevo, repositorio (Fase B).
- `apps/web/app/(storefront)/page.tsx` — compone las dos secciones nuevas (Fase B).

## API consumption

- `GET /v1/products/novedades` — sketcheado en `docs/user-stories/US-026-productos-destacados-home.md`
  §7: reusa el shape de `StorefrontProductListItem` (ya generado, usado hoy por
  `GET /v1/categories/{slug}/products`). **No es un contrato OpenAPI real todavía** — Fase B
  queda bloqueada hasta que `US-026-productos-destacados-home-backend` lo publique.
- `GET /v1/products/mas-vendidos` — ídem, agregado nuevo sobre `order_items` (no reusa
  `ReportsRepository.topProducts` de US-016, que es admin-only y expone revenue — ver US §7).
- Referencia cross-change: `US-026-productos-destacados-home-backend` (a planificar).

## Acceptance criteria

- [ ] AC-1: el home muestra "Novedades" (hasta 8, últimos publicados, cada uno linkea a su ficha).
- [ ] AC-2: el home muestra "Más vendidos" (hasta 8, por cantidad vendida, cada uno linkea a su ficha).
- [ ] AC-3: con menos de 8 productos publicados, "Novedades" muestra esos, sin placeholders.
- [ ] AC-4: catálogo sin productos publicados → ni "Novedades" ni "Más vendidos" se muestran; la
      landing de categorías sigue intacta.
- [ ] AC-5: sin ventas todavía → "Más vendidos" no se muestra; "Novedades" se muestra igual si
      hay productos publicados (criterios independientes).
- [ ] AC-6: empate de ventas → orden determinista por `id` (tie-break del backend; FE nunca
      reordena lo que recibe).
- [ ] AC-7: un producto despublicado no aparece en ninguna sección (filtro del backend; FE nunca
      filtra por status del lado cliente).
- [ ] AC-8: producto sin stock igual visible, marcado no oculto (comportamiento ya existente de
      `ProductCard`, verificado explícitamente, no reimplementado).

## Standards consulted

- `docs/base-standards.md`
- `docs/code/frontend-standards.md` §3 (codegen obligatorio + §3.2 prohibición del escape hatch,
  resuelto igual que en `US-025-resenas-calificaciones-productos-frontend-web/design.md` §D1),
  §9.3 (unión discriminada — N/A para la composición SSR de este change, ver `design.md`), §11.5
  (repository pattern, Fase B), §11.9 (loading-state composition — N/A, ver `design.md`)
- `docs/architecture/api-standards.md` (envelope de paginación, RFC 7807 — Fase B)
- `docs/quality/testing-standards.md` §14
- `docs/quality/qa-frontend-standards.md` §23 (RTL/MSW), §19 (a11y)
- `frontend-resilience-patterns` skill (#5 — degradación sin datos, mismo criterio que
  `categoriesStorefrontService.getTree().catch(() => [])` ya en producción)
- `observability-patterns` skill (evento `home_featured_shown`, sin PII)

## Open questions

Ninguna que bloquee la planificación. Riesgo conocido y explícito: la forma exacta de la
respuesta de los dos endpoints nuevos (envelope `{data, pagination}` vs. array plano) no está
confirmada — Fase B (T-B0/T-B1) la resuelve cuando el backend publique el contrato; el impacto
en Fase A es cero (ver `design.md` D1).
