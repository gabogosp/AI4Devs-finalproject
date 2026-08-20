# US-002 QA — Plan del browse por categorías

> **Alcance**: capas **owned-by-QA** (Layer 3 cross-stack, aceptación BDD, a11y, carga, exploratorio).
> Las dev-owned (unit / integration / e2e-nest / component / smoke) son la TDD de cada disciplina y
> **no se re-autoran acá** (ownership matrix `qa-backend`/`qa-frontend` §2.1).
> **Numeración**: `TC-2NN` — el paquete `@dsm/qa` es compartido (US-001 usa `TC-0NN`, US-003 `TC-3NN`).

## 1. Perfil de riesgo

US-002 es la **vía principal de SEO** del storefront (PRD §1.2/§1.4: que a DSM "se la encuentre en
Google") y la red de seguridad del descubrimiento cuando la búsqueda IA de US-004 no alcanza.

| Riesgo | Por qué importa acá |
|---|---|
| **SSR que no rinde** | AC-4 y AC-10 son el corazón de la US. Un listado que se hidrata en el cliente pasa **todos** los tests de API y de componente, y Google ve una página vacía. La US entrega su objetivo de negocio o no lo entrega, y ninguna capa dev-owned lo distingue. |
| **Fuga de no-publicados** | AC-8 es negative-space: un `draft` que se cuela en el listado —o peor, en el `total` de la paginación— expone catálogo no publicado a cualquier anónimo **y a Google**. |
| **Páginas fantasma** | AC-9: una categoría inexistente que devuelve 200 vacío se indexa y contamina el sitio con URLs sin contenido. |
| **Degradación con catálogo real** | AC-7: el browse debe sostener ≥5.000 SKUs paginando sin recargar el catálogo entero. |
| **Navegación por teclado** | El árbol rubro→subrubro es el componente de navegación principal; si no es operable por teclado, la a11y se rompe en el punto de mayor tráfico. |

## 2. Mapeo de la pirámide (capas QA en negrita)

| Capa | Dueño | Estado |
|---|---|---|
| Unit / integration / e2e-nest (BE) | dev | ⏳ planificado (18 tasks) — ver §2.1 |
| Component / integration MSW (FE) | dev | ⏳ llega con FE-US-002 |
| **Aceptación BDD cross-stack** | **QA** | este plan |
| **E2E de SSR / SEO / sitemap** | **QA** | este plan |
| **Accesibilidad (axe + teclado)** | **QA** | este plan |
| **Carga (k6)** | **QA** | este plan |
| **Exploratorio** | **QA** | este plan (manual) |

### 2.1 Nota de cobertura dev-owned (awareness, no se re-autora)

El change de backend declara cubrir con Postgres real: árbol de dos niveles, breadcrumb (`parent`),
paginación con `total`, `limit` max 100, categoría vacía → `data: []` / `total: 0`, `in_stock`
derivado, **`draft`/`archived` excluidos del listado y del `total`**, 404 de categoría inexistente,
caché heredada sólo en 2xx, rate-limit, y el evento `category.viewed` emitido/no emitido. Nada de
eso se repite acá: este plan sólo ejercita lo que vive **arriba del JSON**.

## 3. Matriz de trazabilidad: AC × capa

Leyenda: **DEV** = cubierto por la TDD del dev · **QA** = autorado en este plan · **—** = no aplica.

| AC | e2e-nest (DEV) | **E2E SSR/SEO (QA)** | **Aceptación BDD (QA)** | **a11y (QA)** | **Carga (QA)** |
|---|---|---|---|---|---|
| **AC-1** entrar a un rubro (URL por slug) | DEV (datos) | **QA** (S-1) | **QA** (H-1) | — | — |
| **AC-2** rubro → subrubro + volver al padre | DEV (breadcrumb) | — | **QA** (H-2) | **QA** (A-2) | — |
| **AC-3** grilla con datos + paginada + enlaza a ficha | DEV (DTO) | **QA** (S-2) | **QA** (H-3) | — | — |
| **AC-4** indexable: SSR + metadatos + **sitemap** | — | **QA** (S-3, S-4) | — | — | — |
| **AC-5** sin stock visible, no comprable | DEV (`in_stock`) | — | **QA** (C-1) | — | — |
| **AC-6** categoría sin productos → estado vacío | DEV (`data: []`) | — | **QA** (C-2) | — | — |
| **AC-7** catálogo grande sin degradación | DEV (paginación) | **QA** (S-5, LCP) | — | — | **QA** (L-1) |
| **AC-8** draft/archivado nunca en público | DEV (listado+total) | **QA** (S-6) | **QA** (N-1) | — | — |
| **AC-9** categoría inexistente → 404, sin fantasma | DEV (404) | **QA** (S-7) | **QA** (N-2) | — | — |
| **AC-10** contenido server-rendered | — | **QA** (S-8) | — | — | — |
| **NFR** WCAG 2.1 AA + teclado | — | — | — | **QA** (A-1, A-2) | — |
| **NFR** p95 < 300 ms | — | — | — | — | **QA** (L-1) |

**Los 10 AC tienen ≥1 escenario QA.** Ninguno queda diferido en esta US.

## 4. Escenarios Gherkin

### 4.1 Happy path

```gherkin
@happy @critical-path
Scenario: H-1 — Entrar a un rubro muestra sus subrubros y productos
  Given el rubro "Refrigeración" con subrubros y productos publicados
  When un visitante entra al rubro desde la navegación
  Then ve los subrubros del rubro
  And ve los productos publicados, incluidos los de sus subrubros
  And la URL del rubro es su slug legible

@happy @critical-path
Scenario: H-2 — Bajar a un subrubro y volver al rubro padre
  Given el rubro "Refrigeración" con el subrubro "Compresores"
  When el visitante entra a "Compresores"
  Then ve únicamente los productos de ese subrubro
  And puede volver al rubro padre desde la navegación

@happy
Scenario: H-3 — La grilla muestra los datos de cada producto y enlaza a su ficha
  Given una categoría con productos publicados
  When el visitante la abre
  Then cada producto muestra nombre, precio en ARS, imagen o placeholder y disponibilidad
  And el listado está paginado
  And cada producto enlaza a su ficha
```

### 4.2 Corner (condiciones de borde)

```gherkin
@corner
Scenario: C-1 — Un producto sin stock se ve pero no se puede comprar
  Given una categoría con un producto publicado sin stock
  When el visitante abre la categoría
  Then ese producto aparece con el indicador "Sin stock"
  And no ofrece la acción de agregar al carrito

@corner
Scenario: C-2 — Una categoría sin productos publicados muestra estado vacío
  Given una categoría publicada sin productos publicados
  When el visitante la abre
  Then ve un mensaje de estado vacío claro
  And puede navegar a otros rubros desde ahí
```

### 4.3 Negative (modos de falla)

```gherkin
@negative @critical-path
Scenario Outline: N-1 — Los productos no publicados no existen para el público
  Given un producto en estado "<estado>" en una categoría
  When el visitante abre la categoría y se inspecciona el HTML
  Then ese producto NO aparece en el listado
  And NO está contado en el total de la paginación
  Examples:
    | estado    |
    | borrador  |
    | archivado |

@negative @critical-path
Scenario: N-2 — Una categoría inexistente no genera página indexable
  Given una URL de categoría que no existe
  When alguien la solicita
  Then la respuesta es 404
  And no es una página 200 vacía
  And no queda registrada en el sitemap
```

### 4.4 Cross-feature (Layer 3 — cruzan disciplinas o US)

```gherkin
@cross-feature @critical-path
Scenario: X-1 — El enlace de la grilla lleva a la ficha correcta
  Given una categoría con un producto publicado
  When el visitante hace clic en ese producto
  Then llega a la ficha de ese mismo producto
  And la ficha muestra el mismo nombre y precio que mostraba la grilla
  # Cruza US-002 (grilla) con US-003 (ficha). Verifica que el identificador
  # del enlace y el de la ruta pública coinciden — la costura donde un cambio
  # de identificador (D-1: sku → slug) rompe la navegación en silencio.

@cross-feature
Scenario: X-2 — Publicar un producto lo hace aparecer en su categoría
  Given un producto en borrador que no aparece en el listado público
  When el dueño lo publica desde el panel
  And un visitante recarga la categoría pasada la ventana de caché
  Then el producto aparece en el listado
```

## 5. Test cases owned-by-QA

### 5.1 E2E de SSR / SEO / sitemap (Playwright)

```yaml
- id: TC-201   # [x] verde 2026-08-19 (qa/e2e/categoria-ssr-seo.spec.ts)
  scenario: S-1
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: "H-1 — rubro por slug"
  name: Categoria_Rubro_UrlPorSlugYMuestraSubrubrosYProductos

- id: TC-202   # [x] verde 2026-08-19 (qa/e2e/categoria-ssr-seo.spec.ts)
  scenario: S-2
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: "H-3 — grilla"
  name: Categoria_Grilla_MuestraDatosYPaginaSinRecargarCatalogoCompleto

- id: TC-203   # [x] verde 2026-08-19 (qa/e2e/categoria-ssr-seo.spec.ts)
  scenario: S-3
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: "AC-4 — metadatos"
  name: Categoria_Html_TitleYMetaDescriptionPropiosDeLaCategoria

- id: TC-204   # [ ] BLOQUEADO por implementacion: sitemap = Fase 5 del change FE, abierta
  scenario: S-4
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: "AC-4 — sitemap"
  name: Sitemap_ListaLasCategoriasPublicadasYNoLasInexistentes

- id: TC-205   # [ ] pendiente: LCP con catalogo grande
  scenario: S-5
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: "AC-7 — Core Web Vitals"
  name: Categoria_LcpBajoDosPuntoCincoSegundosConCatalogoGrande

- id: TC-206   # [x] verde 2026-08-19 (qa/e2e/categoria-ssr-seo.spec.ts)
  scenario: S-6
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: "N-1 — no publicados"
  name: Categoria_HtmlServido_NoContieneDraftNiArchivados

- id: TC-207   # [x] verde 2026-08-19 (qa/e2e/categoria-ssr-seo.spec.ts)
  scenario: S-7
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: "N-2 — 404"
  name: Categoria_Inexistente_Devuelve404YNoQuedaEnSitemap

- id: TC-208   # [x] verde 2026-08-19 (qa/e2e/categoria-ssr-seo.spec.ts)
  scenario: S-8
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: "AC-10 — SSR"
  name: Categoria_HtmlSinJavaScript_YaContieneLosProductosDelListado
```

### 5.2 Aceptación BDD (Cucumber.js + Playwright)

```yaml
- id: TC-210
  scenario: H-1
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "H-1"
  name: Aceptacion_Rubro_MuestraSubrubrosYProductosAgregados

- id: TC-211
  scenario: H-2
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "H-2"
  name: Aceptacion_Subrubro_SoloSusProductosYVuelveAlPadre

- id: TC-212
  scenario: H-3
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "H-3"
  name: Aceptacion_Grilla_DatosCompletosYPaginada

- id: TC-213
  scenario: C-1
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "C-1"
  name: Aceptacion_SinStock_VisibleSinAccionDeCompra

- id: TC-214
  scenario: C-2
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "C-2"
  name: Aceptacion_CategoriaVacia_EstadoVacioConSalidaANavegacion

- id: TC-215
  scenario: X-1
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "X-1"
  name: Aceptacion_ClicEnProducto_LlevaALaFichaDelMismoProducto

- id: TC-216
  scenario: X-2
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "X-2"
  name: Aceptacion_PublicarEnPanel_ApareceEnLaCategoria
```

### 5.3 Accesibilidad (axe-core + navegación por teclado)

```yaml
- id: TC-220
  scenario: A-1
  execution_mode: automated
  test_layer: 3
  target_tooling: axe-core+Playwright
  gherkin_scenario: "NFR WCAG 2.1 AA"
  name: Categoria_SinViolacionesAA_ConProductosYVacia

- id: TC-221
  scenario: A-2
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: "NFR teclado"
  name: Navegacion_RubroSubrubroYPaginacion_OperablesSoloConTeclado
```

**A-2 es específico de esta US**: el árbol de navegación y la paginación son los controles de mayor
tráfico del storefront. axe no detecta que un control sea inalcanzable por teclado — hay que
recorrerlo con `Tab`/`Enter` y asertar foco visible y orden lógico.

### 5.4 Carga (k6)

```yaml
- id: TC-230
  scenario: L-1
  execution_mode: automated
  test_layer: 3
  target_tooling: k6
  gherkin_scenario: "AC-7 / NFR p95"
  name: Categoria_ListadoPaginado_P95BajoTrescientosMsConCatalogoGrande
```

Recorre **páginas distintas** del listado (offset variable), no la misma una y otra vez: con TTL de
caché de 60 s, martillar un solo offset mide la caché, no la base. Reusa `thresholds.js` con el tag
`endpoint:category_products` y el dataset de `seed:load`.

### 5.5 Exploratorio (manual, justificado)

```yaml
- id: TC-240
  execution_mode: manual
  test_layer: 3
  target_tooling: charter
  gherkin_scenario: "—"
  name: Charter_IndexacionRealYSitemapEnHerramientasDeBuscador
  justification: >-
    Verificar cómo interpreta un buscador el sitemap y las páginas de categoría
    exige herramientas externas (Search Console, validadores) y juicio humano.
    Automatizarlo daría falsa confianza sobre el objetivo de negocio de la US.

- id: TC-241
  execution_mode: manual
  test_layer: 3
  target_tooling: charter
  gherkin_scenario: "—"
  name: Charter_CoherenciaDelArbolConCatalogoReal
  justification: >-
    Con datos reales del dueño aparecen rubros mal asignados, nombres ambiguos y
    subrubros vacíos que ningún fixture reproduce. Es exploración de datos, no
    de comportamiento.
```

## 6. Bloqueos y dependencias (declarados)

| # | Qué | Estado | Dueño / disparador |
|---|---|---|---|
| B-1 | **FE-US-002 no está planificado**: toda la capa L3 necesita las páginas de categoría renderizadas. | **Bloquea la ejecución**, no la planificación | `/plan-frontend-web-ticket US-002` → luego `/develop-qa US-002` |
| B-2 | **El backend de US-002 está planificado pero no desarrollado** (18 tasks abiertas). | Bloquea la ejecución | `/develop-backend US-002` |
| B-3 | **X-1 y X-2 cruzan con US-003 y US-001**: el enlace grilla→ficha necesita la PDP viva; X-2 necesita el panel admin (ya vivo). | X-1 se ejecuta cuando FE-US-003 esté; X-2 ya es ejecutable | US-003 |
| B-4 | **Identificador del enlace a la ficha**: el plan de backend de US-002 dice que el enlace usa `sku` "per OQ-BE-1 heredada", pero **D-1 (2026-08-16) resolvió OQ-BE-1** y materializa `products.slug` en la Fase 10 del backend de US-003. | **El plan de backend de US-002 quedó desactualizado en ese punto** | Ver §7 |

## 7. Hallazgo: el plan de backend de US-002 no incorporó D-1

El `proposal.md` del change de backend declara, en dos lugares, que el enlace del listado usa `sku`
porque OQ-BE-1 "sigue diferida". **Ya no lo está**: el PO decidió el 2026-08-16 materializar
`products.slug` antes de construir el FE, precisamente porque el SEO es el objetivo de negocio y
cambiar URLs después de indexar cuesta 301s y re-crawl.

Consecuencia si no se corrige: la grilla de US-002 enlazaría a `/productos/{sku}` mientras la ficha
de US-003 vive en `/productos/{slug}` — **la navegación se rompe**, y el escenario que lo detecta es
justamente X-1 (TC-215). Es un cambio de dos líneas en un plan **todavía no desarrollado** (18 tasks
abiertas), así que corregirlo ahora es gratis; después de codearlo, no.

Este plan de QA asume **slug**, que es la decisión vigente.

## 8. Quality gates

| Gate | Cuándo | Bloquea |
|---|---|---|
| E2E SSR/SEO + aceptación | PR y nightly | sí |
| a11y (axe + teclado) 0 violaciones AA | pre-release | sí |
| Carga p95 < 300 ms recorriendo páginas | pre-release | sí |
| Charters exploratorios | pre-release | no (informan) |

## 9. Standards consultados

`testing-standards.md` (§2 pirámide, §5 datos, §14 patrones, §14.9 negative-space, §18 anti-patterns) ·
`qa-frontend-standards.md` (§19 accesibilidad, §23 Playwright, §24 BDD web) ·
`qa-backend-standards.md` (§2.1 ownership, §13 performance) ·
`performance-standards.md` (§7 diseño de load test, §8 budgets en CI) ·
`qa-three-layer-regression` (L3 cross-stack) · `playwright-stability` · `accessibility-audit`.

## 10. Open questions

- **OQ-QA-1** `[Deferred: la ejecución espera a FE-US-002 y a que el backend esté desarrollado —
  owner: FE/BE, revisit: tras `/develop-frontend-web US-002`]` El plan es completo y ejecutable en
  cuanto exista la superficie.
- **OQ-QA-2 — ¿Se propagó al plan de backend la decisión D-1 (`slug` en vez de `sku`)?**
  `[Resolved: 2026-08-18 — sí, se corrigió y se implementó]` La observación era correcta y el riesgo
  que describía era real. Se atendió en dos pasos verificables: el plan de backend se corrigió en el
  commit `d93a340` («el enlace del listado pasa a slug», tocando `design.md`, `proposal.md` y
  `tasks.md`), y la implementación cerró 18/18. Hoy el contrato publicado declara
  `StorefrontProductListItem.required: [slug, …]` con la descripción «Enlaza a la ficha
  `/v1/products/{slug}`». Consecuencia para esta suite: **X-1 (TC-215) ya no falla por diseño** —
  grilla y ficha comparten el identificador público, así que el test verifica navegación real y no
  una discrepancia conocida de antemano.