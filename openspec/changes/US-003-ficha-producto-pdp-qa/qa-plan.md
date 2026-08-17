# US-003 QA — Plan de la ficha pública de producto (PDP)

> **Alcance**: capas **owned-by-QA** (Layer 3 cross-stack, aceptación BDD, a11y, carga,
> exploratorio). Las capas dev-owned (unit / integration / e2e-nest / component / smoke) son la
> TDD de cada disciplina y **no se re-autoran acá** (ownership matrix `qa-backend`/`qa-frontend` §2.1).
> **Numeración**: `TC-3NN` — el paquete `@dsm/qa` es compartido entre US y `TC-0NN` ya lo usa US-001.

## 1. Perfil de riesgo

US-003 es la **primera superficie pública** del sistema: hasta acá todo `/v1/*` estaba gateado por
`AdminGuard`. Eso cambia el perfil de riesgo:

| Riesgo | Por qué importa acá |
|---|---|
| **Fuga por enumeración** | Un 404 que distinga "no existe" de "existe pero está en draft" filtra el catálogo no publicado a cualquier anónimo. |
| **SEO es el objetivo de negocio** | El PRD pone "ser encontrado" como objetivo; si el SSR no rinde HTML con contenido, la US entrega una página que Google no ve. Es la clase de fallo que **pasa todos los tests de API** y aun así incumple el AC. |
| **Caché sirviendo precio viejo** | AC-9 es negative-space explícito: un `Cache-Control` largo en un CDN compartido sirve precio desactualizado. Ya mordió una vez (hallazgo M1 del audit: el header se estampaba también en 404). |
| **Abuso de la superficie anónima** | Sin auth, el rate limit por IP es el único control. |

## 2. Mapeo de la pirámide (capas QA en negrita)

| Capa | Dueño | Estado |
|---|---|---|
| Unit / integration / e2e-nest (BE) | dev | ✅ entregado — ver §2.1 |
| Component / integration MSW (FE) | dev | ⏳ llega con FE-US-003 |
| **Aceptación BDD cross-stack** | **QA** | este plan |
| **E2E de la costura SSR/SEO** | **QA** | este plan |
| **Accesibilidad (axe-core)** | **QA** | este plan |
| **Carga (k6)** | **QA** | este plan |
| **Exploratorio** | **QA** | este plan (manual) |

### 2.1 Nota de cobertura dev-owned (awareness, no se re-autora)

El change de backend ya cubre, con Postgres real: `in_stock` por stock (AC-3/AC-4), `image_url:null`
(AC-6), precio vigente tras PATCH admin (AC-9 lado API), 404 para draft / archived / inexistente
(AC-7/AC-8), **mensaje idéntico en los tres** (sin enumeration leak), `Cache-Control` acotado sólo en
2xx, `product.viewed` emitido sólo en 200, 429 con `Retry-After`, e **independencia de throttlers**
entre la superficie pública y la de auth. Nada de eso se repite acá.

## 3. Matriz de trazabilidad: AC × capa

Leyenda: **DEV** = cubierto por la TDD del dev · **QA** = autorado en este plan · **—** = no aplica.

| AC | Unit/Integr (DEV) | e2e-nest (DEV) | **E2E SSR/SEO (QA)** | **Aceptación BDD (QA)** | **a11y (QA)** | **Carga (QA)** |
|---|---|---|---|---|---|---|
| **AC-1** ficha con datos + URL amigable | DEV (shape) | DEV | **QA** (S-1) | **QA** (H-1) | — | — |
| **AC-2** SSR + metadatos + JSON-LD | — | — | **QA** (S-2, S-3) | **QA** (H-2) | — | — |
| **AC-3** con stock → ofrece comprar | DEV (`in_stock`) | DEV | — | **QA** (H-3) | — | — |
| **AC-4** sin stock → visible, no comprable | DEV (`in_stock`) | DEV | — | **QA** (C-1) | — | — |
| **AC-5** descripción enriquecida / fallback | — | — | — | **QA `@deferred`** (X-1) | — | — |
| **AC-6** sin imagen → placeholder | DEV (`null`) | DEV | — | **QA** (C-2) | **QA** (A-1) | — |
| **AC-7** draft/archivado → 404 | DEV | DEV | **QA** (S-4) | **QA** (N-1) | — | — |
| **AC-8** inexistente → 404 | DEV | DEV | **QA** (S-4) | **QA** (N-2) | — | — |
| **AC-9** precio vigente, sin caché rancia | DEV (API) | DEV | **QA** (S-5) | **QA** (N-3) | — | — |
| **NFR** p95 < 300 ms | — | — | — | — | — | **QA** (L-1) |
| **NFR** LCP < 2.5 s | — | — | **QA** (S-6) | — | — | — |
| **NFR** WCAG 2.1 AA | — | — | — | — | **QA** (A-1) | — |

**Cada AC tiene ≥1 escenario QA**, salvo AC-5 que queda `@deferred` con dueño (ver §Bloqueos).

## 4. Escenarios Gherkin

### 4.1 Happy path

```gherkin
@happy @critical-path
Scenario: H-1 — La ficha de un producto publicado muestra sus datos
  Given un producto publicado con precio, stock, imagen y categoría
  When un visitante anónimo abre su ficha
  Then ve el nombre, la descripción, el precio en ARS y la categoría
  And ve el indicador de disponibilidad "en stock"

@happy @critical-path @seo
Scenario: H-2 — La ficha llega renderizada desde el servidor
  Given la ficha de un producto publicado
  When se solicita el HTML sin ejecutar JavaScript
  Then el HTML ya contiene el nombre y el precio del producto
  And contiene el bloque JSON-LD de tipo Product
  And contiene las etiquetas title y meta description propias del producto

@happy
Scenario: H-3 — Un producto con stock ofrece iniciar la compra
  Given un producto publicado con stock disponible
  When un visitante abre su ficha
  Then se ofrece la acción de agregar al carrito
```

### 4.2 Corner (condiciones de borde)

```gherkin
@corner
Scenario: C-1 — Sin stock: visible pero no comprable
  Given un producto publicado con stock en cero
  When un visitante abre su ficha
  Then ve el indicador "Sin stock"
  And NO se ofrece la acción de agregar al carrito
  And se ofrece el canal de contacto para consultar

@corner
Scenario: C-2 — Producto sin imagen usa placeholder
  Given un producto publicado sin imagen cargada
  When un visitante abre su ficha
  Then se muestra una imagen placeholder con texto alternativo descriptivo
  And el resto de la ficha se renderiza normalmente
```

### 4.3 Negative (modos de falla)

```gherkin
@negative @critical-path
Scenario Outline: N-1 — Un producto no publicado no es accesible ni indexable
  Given un producto en estado "<estado>"
  When alguien solicita su ficha directamente por URL
  Then la respuesta es 404
  And el HTML no contiene el nombre del producto
  And la página no se ofrece como indexable
  Examples:
    | estado   |
    | borrador |
    | archivado|

@negative
Scenario: N-2 — Una ficha inexistente devuelve 404, no un 200 vacío
  Given una URL de ficha que no corresponde a ningún producto
  When alguien la solicita
  Then la respuesta es 404
  And no es una página 200 sin contenido

@negative @critical-path
Scenario: N-3 — El precio mostrado nunca es uno vencido por caché
  Given un producto publicado visible en su ficha con su precio cacheado
  When el dueño actualiza su precio desde la UI del panel
  And un visitante vuelve a abrir la ficha
  Then la ficha muestra el precio nuevo sin esperar el vencimiento de la caché

@negative
Scenario: N-4 — El 404 no distingue "no existe" de "no publicado"
  Given un producto en borrador y un identificador inexistente
  When se solicitan ambas fichas
  Then ambas respuestas son indistinguibles para el visitante
```

### 4.4 Cross-feature (Layer 3 — cruzan disciplinas o US)

```gherkin
@deferred @cross-feature
Scenario: X-1 — La ficha usa la descripción enriquecida cuando existe (AC-5)
  Given un producto cuya descripción fue enriquecida por IA
  When un visitante abre su ficha
  Then se muestra la descripción enriquecida
  But si el producto no fue enriquecido, se muestra su descripción base
  # @deferred — el enriquecimiento llega con US-005. El fallback a descripción
  # base SÍ es verificable hoy y se cubre en H-1.
```

## 5. Test cases owned-by-QA

### 5.1 E2E de la costura SSR/SEO (Playwright, browser → stack real)

```yaml
- id: TC-301
  scenario: S-1
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: "H-1 — ficha con datos"
  name: Pdp_ProductoPublicado_MuestraNombrePrecioCategoriaYDisponibilidad

- id: TC-302
  scenario: S-2
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: "H-2 — SSR"
  name: Pdp_HtmlSinJavaScript_YaContieneNombreYPrecio

- id: TC-303
  scenario: S-3
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: "H-2 — JSON-LD + metadatos"
  name: Pdp_Html_ContieneJsonLdProductYMetadatosPropios

- id: TC-304
  scenario: S-4
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: "N-1 / N-2 — 404"
  name: Pdp_DraftArchivadoEInexistente_Devuelven404SinFiltrarContenido

- id: TC-305
  scenario: S-5
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: "N-3 — precio vigente"
  name: Pdp_TrasEditarPrecioEnLaUiDelPanel_LaFichaMuestraElPrecioNuevoSinEsperar

- id: TC-306
  scenario: S-6
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: "NFR LCP"
  name: Pdp_LcpBajoDosPuntoCincoSegundos
```

### 5.2 Aceptación BDD (Cucumber.js + Playwright)

```yaml
- id: TC-310
  scenario: H-1
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "H-1"
  name: Aceptacion_FichaPublicada_MuestraDatosCompletos

- id: TC-311
  scenario: H-3
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "H-3"
  name: Aceptacion_ConStock_OfreceAgregarAlCarrito

- id: TC-312
  scenario: C-1
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "C-1"
  name: Aceptacion_SinStock_VisibleSinAgregarYConCanalDeContacto

- id: TC-313
  scenario: C-2
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "C-2"
  name: Aceptacion_SinImagen_MuestraPlaceholderConAltDescriptivo

- id: TC-314
  scenario: N-4
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "N-4"
  name: Aceptacion_DraftEInexistente_SonIndistinguibles

- id: TC-315
  scenario: X-1
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "X-1"
  name: Aceptacion_DescripcionEnriquecida_UsaLaEnriquecidaSiExiste
  status: deferred   # US-005 — el escenario queda escrito y excluido por tag
```

### 5.3 Accesibilidad (axe-core sobre Playwright)

```yaml
- id: TC-320
  scenario: A-1
  execution_mode: automated
  test_layer: 3
  target_tooling: axe-core+Playwright
  gherkin_scenario: "NFR WCAG 2.1 AA"
  name: Pdp_SinViolacionesAA_ConImagenYConPlaceholder
```

Cubre las dos variantes de la ficha (con imagen y con placeholder) porque el `alt` descriptivo del
placeholder es requisito explícito del AC-6 y es donde se rompe la a11y en la práctica.

### 5.4 Carga (k6)

```yaml
- id: TC-330
  scenario: L-1
  execution_mode: automated
  test_layer: 3
  target_tooling: k6
  gherkin_scenario: "NFR p95 < 300 ms"
  name: Storefront_GetProductPorSku_P95BajoTrescientosMs
```

Reusa `qa/performance/lib/thresholds.js` como fuente única de budgets (nuevo tag
`endpoint:storefront_product`) y el dataset ya sembrado por `seed:load`.

### 5.5 Exploratorio (manual, justificado)

```yaml
- id: TC-340
  execution_mode: manual
  test_layer: 3
  target_tooling: charter
  gherkin_scenario: "—"
  name: Charter_SeoYCompartirEnRedes
  justification: >-
    Verificar cómo se ve la ficha compartida (preview de WhatsApp/redes) y qué
    interpreta un validador de datos estructurados exige juicio humano sobre
    herramientas externas; automatizarlo daría falsa confianza.

- id: TC-341
  execution_mode: manual
  test_layer: 3
  target_tooling: charter
  gherkin_scenario: "—"
  name: Charter_CachePrecioBajoCdn
  justification: >-
    El comportamiento real de caché depende del CDN delante; el charter explora
    combinaciones de headers que un test contra el origen no reproduce.
```

## 6. Bloqueos y diferidos (declarados, no silenciosos)

| # | Qué | Estado | Dueño / disparador |
|---|---|---|---|
| B-1 | **FE-US-003 no está planificado**: toda la capa L3 de este plan necesita la PDP renderizada. | **Bloquea la ejecución**, no la planificación | `/plan-frontend-web-ticket US-003` → luego `/develop-qa US-003` |
| B-2 | ~~AC-1 "URL amigable" no verificable~~ — **resuelto 2026-08-16 (D-1)**: el PO decide materializar `products.slug` antes de la PDP (Fase 10 del change de backend). | **Desbloqueado**: TC-301 asierta la URL por slug; AC-1 queda cubierto completo | — |
| B-3 | **AC-5 depende de US-005** (enriquecimiento IA). | X-1 escrito y `@deferred` | US-005 |
| B-4 | **AC-3 sólo verifica que la acción se ofrezca**; que la compra funcione es US-007. | Acotado a propósito | US-007 |

**B-2 quedó resuelto**: el PO optó por materializar el slug antes de construir la PDP, así que AC-1
se cubre completo. El backend hizo lo correcto al escalarlo en vez de agregar esquema en silencio;
la decisión de producto llegó y lo cerró.

## 7. Quality gates

| Gate | Cuándo | Bloquea |
|---|---|---|
| E2E SSR/SEO + aceptación (sin `@deferred`) | PR y nightly | sí |
| a11y 0 violaciones AA | pre-release | sí |
| Carga p95 < 300 ms | pre-release | sí |
| Charters exploratorios | pre-release | no (informan) |

## 8. Standards consultados

`testing-standards.md` (§2 pirámide, §5 datos, §14 patrones, §14.9 negative-space, §18 anti-patterns) ·
`qa-frontend-standards.md` (§19 accesibilidad, §23 Playwright, §24 BDD web) ·
`qa-backend-standards.md` (§2.1 ownership, §13 performance) ·
`performance-standards.md` (§7 diseño de load test, §8 budgets en CI) ·
`qa-three-layer-regression` (L3 cross-stack).

## 9. Open questions

- **OQ-QA-1** `[Deferred: la ejecución de este plan espera a FE-US-003 — owner: FE, revisit: al
  planificar/desarrollar la PDP]` El plan es completo y ejecutable en cuanto exista la superficie.
- **OQ-QA-2** `[Resolved: 2026-08-16 — D-1: `products.slug` se materializa en la Fase 10 del change
  de backend, antes de la PDP. TC-301 asierta la URL por slug; AC-1 cubierto completo.]`
