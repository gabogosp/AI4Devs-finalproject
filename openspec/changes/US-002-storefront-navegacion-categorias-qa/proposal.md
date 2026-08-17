---
tracker-id: null
tracker-source: null
parent-us: US-002
discipline: qa
variant: null
language: es
---

# US-002 QA — Suite cross-stack del browse por categorías

## Why

US-002 es **la vía principal de SEO** del storefront. El PRD pone "que a DSM se la encuentre en
Google" como objetivo de negocio (§1.2/§1.4), y esta US es la superficie que lo entrega: el árbol
rubro→subrubro y el listado paginado, renderizados en servidor e indexables.

Eso define exactamente qué tiene que cubrir QA y qué no. El change de backend cubre su capa con
detalle (18 tasks: agregación rubro+subrubros, paginación con `total`, exclusión de draft/archivado
del listado **y del total**, 404 sin página fantasma, caché por endpoint sólo en 2xx, evento
`category.viewed`). Lo que **ninguna capa dev-owned puede ver**:

- **AC-4 y AC-10 son el corazón de la US y viven en el HTML**, no en el JSON. Un listado que se
  hidrata en el cliente pasa todos los tests de API y de componente, y Google ve una página vacía.
  La US cumple o no cumple su objetivo de negocio, y nada se pone rojo.
- **El sitemap** (AC-4) es un artefacto de sitio, no un endpoint: sólo se verifica sobre el sitio
  servido.
- **AC-7 con catálogo real**: que la paginación no recargue el catálogo completo y que los Core Web
  Vitals aguanten sólo se mide en el browser, contra ≥5.000 SKUs.
- **La navegación por teclado**: axe no detecta que un control sea inalcanzable con `Tab`. El árbol
  de categorías es el componente de mayor tráfico del sitio.
- **La costura con US-003**: que el enlace de la grilla lleve a la ficha correcta cruza dos US y es
  donde un cambio de identificador rompe la navegación en silencio.

## What changes

- **Extensión del paquete `@dsm/qa`**: se suman las suites del browse. No se crea infraestructura —
  se reusan fixture de auth (para el paso admin de X-2), seed, builders, thresholds y CI.
- **E2E de SSR / SEO / sitemap** (Playwright): HTML servido **sin ejecutar JavaScript** que ya
  contiene los productos, metadatos propios de la categoría, sitemap que lista las publicadas y no
  las inexistentes, y 404 sin página fantasma.
- **Aceptación BDD** (Cucumber + Playwright): los AC en Gherkin legibles por el dueño — rubro,
  subrubro, breadcrumb, grilla paginada, sin stock, categoría vacía.
- **Accesibilidad**: axe-core sobre la categoría con productos y vacía, **más** un recorrido de
  navegación y paginación operado sólo con teclado.
- **Carga** (k6): listado paginado contra el NFR p95 < 300 ms recorriendo **páginas distintas**.
- **Charters de exploratorio**: indexación real en herramientas de buscador y coherencia del árbol
  con el catálogo real del dueño.

## ACs de US-002 cubiertos (capa 3)

Los **10 AC** tienen escenario QA; ninguno queda diferido.

| AC | Cobertura QA (L3) | Ya cubierto por dev (nota) |
|---|---|---|
| **AC-1** entrar a un rubro | E2E + aceptación | árbol y agregación en e2e-nest |
| **AC-2** rubro → subrubro + volver | Aceptación + a11y teclado | breadcrumb en e2e-nest |
| **AC-3** grilla con datos, paginada, enlaza a ficha | E2E + aceptación | DTO y paginación en e2e-nest |
| **AC-4** indexable: SSR + metadatos + **sitemap** | **E2E — sólo acá** | — |
| **AC-5** sin stock visible no comprable | Aceptación | `in_stock` en e2e-nest |
| **AC-6** categoría vacía → estado vacío | Aceptación | `data: []` en e2e-nest |
| **AC-7** catálogo grande sin degradación | E2E (LCP) + carga | paginación en e2e-nest |
| **AC-8** draft/archivado nunca en público | **E2E sobre el HTML** | listado y `total` en e2e-nest |
| **AC-9** inexistente → 404 sin fantasma | E2E (+ sitemap) | 404 en e2e-nest |
| **AC-10** contenido server-rendered | **E2E — sólo acá** | — |

## Out of scope

- **Re-autoría de las capas dev-owned**: la TDD del backend y la del FE cubren sus superficies. Acá
  sólo se referencian como cobertura consciente.
- **La ficha de producto en sí**: es US-003. Acá sólo se verifica que el **enlace** lleve a la ficha
  correcta (X-1).
- **La búsqueda semántica**: US-004. Este browse es la red de seguridad cuando esa búsqueda no
  alcanza, pero no la testea.
- **El flujo de compra**: AC-5 verifica que la acción **no** se ofrezca sin stock; el carrito es US-007.

## Open questions

- **OQ-QA-1 — La ejecución depende de FE-US-002 y del backend desarrollado.**
  `[Deferred: el plan es completo y ejecutable en cuanto exista la superficie; hoy el backend tiene
  18 tasks abiertas y el FE no está planificado — owner: BE/FE, revisit: tras
  `/develop-frontend-web US-002`]` Se planifica ahora a propósito: los AC observables escritos antes
  hacen que el FE se construya contra ellos.

- **OQ-QA-2 — El plan de backend de US-002 no incorporó la decisión D-1 (slug).** `[Open]`
  Su `proposal.md` declara en dos lugares que el enlace del listado usa `sku` porque "OQ-BE-1 sigue
  diferida". **Ya no lo está**: el PO resolvió D-1 el 2026-08-16 y `products.slug` se materializa en
  la Fase 10 del backend de US-003. Si no se propaga, la grilla enlazaría a `/productos/{sku}`
  mientras la ficha vive en `/productos/{slug}` y **la navegación se rompe** — lo detectaría X-1
  (TC-215), por diseño. Son dos líneas en un plan con 18 tasks **abiertas**: corregirlo ahora es
  gratis. Este plan de QA asume **slug**, que es la decisión vigente.

## Referencias

- US: `docs/user-stories/US-002-storefront-navegacion-categorias.md`
- Change de backend: `openspec/changes/US-002-storefront-navegacion-categorias-backend/`
- Decisión D-1: `docs/user-stories/US-003-ficha-producto-pdp.md` §10
- Contrato vivo de la capacidad: `openspec/specs/catalogo/contracts/openapi.yaml`
- Suite que se extiende: `qa/` (`@dsm/qa`, desde US-001)
