---
tracker-id: null
tracker-source: null
parent-us: US-003
discipline: qa
variant: null
language: es
---

# US-003 QA — Suite cross-stack de la ficha pública de producto

## Why

US-003 abre la **primera superficie pública** del sistema. Hasta acá todo `/v1/*` estaba detrás de
`AdminGuard`: el riesgo era que un admin hiciera algo mal. Ahora el riesgo es que **cualquiera en
internet** vea algo que no debería, o que Google no vea lo que debería.

El change de backend cubrió su capa con solidez (19 tasks, 6 specs e2e-nest: 404 uniforme sin
enumeration leak, caché sólo en 2xx, throttlers independientes, evento `product.viewed` sólo en 200).
Lo que **ninguna capa dev-owned puede cubrir** es lo que define esta US:

- **El SEO es el objetivo de negocio**, y vive en el HTML renderizado, no en el JSON de la API. Una
  ficha puede pasar todos los tests de backend y aun así llegarle a Google como una página vacía —
  el AC-2 se incumple sin que nada se ponga rojo.
- **AC-9 (precio vigente)** cruza dos superficies: el dueño cambia el precio en el panel admin y el
  visitante anónimo debe verlo en la ficha. Ninguna capa aislada lo ejercita entero.
- **La accesibilidad y el LCP** son NFRs de la US y sólo se miden en el browser.

Esta es la **capa 3 cross-stack** (`qa-three-layer-regression`): la que ejercita el FE real contra la
API real y certifica los AC de punta a punta.

## What changes

- **Extensión del paquete `@dsm/qa`** (ya existe desde US-001): se suman las suites de la ficha
  pública. No se crea infraestructura nueva — se reusan el fixture de auth (para el paso admin de
  AC-9), el seed, los builders, los thresholds de k6 y la CI ya cableada.
- **E2E de la costura SSR/SEO** (Playwright): lo específico de esta US — HTML servido sin ejecutar
  JavaScript que ya contiene nombre y precio, bloque JSON-LD `Product`, `title`/`meta description`
  propios, y 404 que no filtra contenido.
- **Aceptación BDD** (Cucumber + Playwright): los AC en Gherkin legibles por el dueño — con stock /
  sin stock / sin imagen / draft indistinguible de inexistente.
- **Accesibilidad** (axe-core): las dos variantes de la ficha, con imagen y con placeholder.
- **Carga** (k6): `GET /v1/products/{sku}` contra el NFR p95 < 300 ms, reusando el dataset sembrado.
- **Charters de exploratorio**: preview al compartir en redes y comportamiento de caché bajo CDN —
  dos cosas donde automatizar daría falsa confianza.

## ACs de US-003 cubiertos (capa 3)

| AC | Cobertura QA (L3) | Ya cubierto por dev (nota) |
|---|---|---|
| **AC-1** ficha con datos | Aceptación + E2E SSR | shape público en e2e-nest |
| **AC-2** SSR + JSON-LD + metadatos | **E2E SSR/SEO** — sólo acá | — |
| **AC-3** con stock ofrece comprar | Aceptación | `in_stock` en e2e-nest |
| **AC-4** sin stock visible no comprable | Aceptación | `in_stock:false` en e2e-nest |
| **AC-5** descripción enriquecida | `@deferred` → US-005 | — |
| **AC-6** sin imagen → placeholder | Aceptación + a11y | `image_url:null` en e2e-nest |
| **AC-7** draft/archivado → 404 | E2E SSR + aceptación | 404 en e2e-nest |
| **AC-8** inexistente → 404 | E2E SSR + aceptación | 404 en e2e-nest |
| **AC-9** precio vigente | **E2E cross-superficie** — sólo acá | precio tras PATCH en e2e-nest (lado API) |

## Out of scope

- **Re-autoría de las capas dev-owned**: la TDD del backend ya cubrió su superficie y la del FE
  llegará con su change. Acá sólo se referencian como cobertura consciente.
- **El flujo de compra**: AC-3 verifica que la acción **se ofrezca**; que funcione es US-007.
- **El enriquecimiento por IA**: US-005. El escenario queda escrito y `@deferred`.
- **La URL por slug**: es OQ-BE-1, columna infra-owned. Ver §Open questions.

## Open questions

- **OQ-QA-1 — La ejecución depende de FE-US-003.** `[Deferred: el plan es completo y ejecutable en
  cuanto exista la PDP renderizada; hoy no hay superficie que ejercitar — owner: FE, revisit: tras
  `/develop-frontend-web US-003`]` Se planifica ahora a propósito: escribir los escenarios **antes**
  que la implementación es lo que hace que el FE se construya contra criterios observables y no al
  revés.

- **OQ-QA-2 — AC-1 declara "URL amigable (slug)" pero la ruta pública es por `sku`.**
  `[Deferred: los TC asertan por el identificador vigente; la cláusula de slug queda SIN cubrir hasta
  que exista la columna — owner: infra (OQ-BE-1), revisit: al materializar `products.slug`]`
  El backend hizo lo correcto al escalarlo en vez de agregar esquema en silencio, pero la
  consecuencia es que **US-003 no puede declarar AC-1 completo**. Debe quedar visible en el cierre.

## Referencias

- US: `docs/user-stories/US-003-ficha-producto-pdp.md`
- Change de backend (contexto de implementación): `openspec/changes/US-003-ficha-producto-pdp-backend/`
- Contrato vivo de la capacidad: `openspec/specs/catalogo/contracts/openapi.yaml`
- Suite existente que se extiende: `qa/` (`@dsm/qa`, desde US-001)
