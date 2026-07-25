# QA Plan — US-001 Admin de catálogo (productos y categorías)

> **User Story**: US-001 — Admin de catálogo: alta y edición de productos y categorías
> **Autor**: agente qa-engineer (asistido por @Gabriel Suarez)
> **Fecha**: 2026-07-25
> **Estado**: Proposed
> **Plataforma(s) afectada(s)**: backend (NestJS) + frontend-web (Next.js) — QA cross-stack (Layer 3)
> **Service tier**: 2 (derivado — sin `service-catalog.yaml`; ver OQ-QA-3)
> **Companion files**: `proposal.md`, `tasks.md`, `design.md`
> **Alcance de este plan**: capas **owned-by-QA** (E2E cross-stack, aceptación/BDD, funcional API, regresión, carga, accesibilidad, exploratorio). Las capas owned-by-dev (unit/component/integration/contract-provider/e2e-nest/smoke) están cubiertas por la TDD de los devs y se **referencian**, no se re-autoran.

## 1. Perfil de riesgo

- **CRUD de catálogo (categorías + productos)**: **crítico / fundacional** — es la base de US-002/003/005/006 y del loop E2E (PRD §1.4). Journey crítico → aceptación + E2E.
- **Máquina de estado draft→published→archived**: **crítico** — la regla de publicación (AC-6) y la de archivar sin borrar (AC-7) son negocio-load-bearing. Stateful → aceptación + E2E + funcional.
- **Costura de auth admin (RBAC)**: **crítico / seguridad** — AC-8 + STRIDE E2E §14 (elevation of privilege). Cross-service (guard BE + guard UX FE) → barrido RBAC funcional + E2E redirect. **Gap conocido**: sin controller de login (OQ-QA-1).
- **Validación por campo RFC 7807 (422/409)**: **alto** — el mapeo del error en la costura FE↔BE (que el dev-L2 prueba contra MSW, no contra la API real). Cross-service → E2E de costura.
- **Listado paginado con ≥5.000 SKUs**: **performance-sensitive** — NFR US §9 / E2E §17. → carga k6.
- **Formularios del panel**: **accesibilidad-relevante** — WCAG 2.1 AA (US §9). → axe-core integrado.
- **Dependencia externa**: ninguna outbound en US-001 (sin Gemini/MP/R2/Resend en scope) → sin fault-injection en esta US.

**Journeys críticos identificados**:
1. Acceso admin → crear categoría → alta producto (draft) → editar → publicar → archivar (ciclo completo del catálogo).
2. Publicar producto incompleto → rechazo indicando qué falta → permanece en draft.
3. Acceso al panel sin sesión admin → denegado (no expone ninguna operación).
4. Alta con SKU duplicado → rechazo por duplicado.

## 2. Mapeo de la pirámide de tests (capas QA en negrita)

| Capa | Owner | ¿En este plan? | Herramienta | Por qué |
|---|---|---|---|---|
| Unit | Dev (TDD) | ❌ nota de cobertura | Jest (BE) · Vitest (FE) | máquina de estado, mappers, `AppError` — ya cubierto |
| Component / Repository | Dev (TDD) | ❌ nota de cobertura | Jest · Vitest+RTL | repos Prisma, formularios, state holders — ya cubierto |
| Integration | Dev (TDD) | ❌ nota de cobertura | Jest+Testcontainers · Vitest+MSW | repos vs Postgres real; servicios FE vs contrato mock — ya cubierto |
| Contract (provider) | Dev (TDD) | ❌ nota de cobertura | Spectral/supertest sobre el spec | OpenAPI vs implementación — ya cubierto |
| E2E-nest (in-process) | Dev (TDD) | ❌ nota de cobertura | TestingModule+supertest | endpoints + guard in-process — ya cubierto |
| Smoke FE (mock) | Dev (TDD) | ❌ nota de cobertura | Playwright + `page.route` | happy path con red mockeada — ya cubierto |
| **E2E cross-stack (FE→API real)** | **QA** | ✅ | **Playwright** | costura FE↔BE contra API real (no mock) |
| **Aceptación (BDD)** | **QA** | ✅ | **Cucumber.js + Playwright** | escenarios legibles por el dueño/PO |
| **Funcional API (black-box)** | **QA** | ✅ | **Newman** | barrido RBAC + forma de contrato vs servicio corriendo |
| **Regresión (3-capa, L3)** | **QA** | ✅ | Cucumber+Playwright | contrato de comportamiento vivo del catálogo |
| **Carga / performance** | **QA + Dev** | ✅ | **k6** | NFR ≥5.000 SKUs sin degradación |
| **Accesibilidad** | **QA** | ✅ | **axe-core** (Playwright) | WCAG 2.1 AA sobre las 4 pantallas |
| Visual regression | QA | ⚠️ opcional | Playwright `toHaveScreenshot` | 4 pantallas — propuesto, no bloqueante en US-001 |
| **Exploratorio** | **QA** | ✅ | charters manuales | áreas de riesgo (estado, validación, auth) |

### Nota de cobertura (dev-owned — awareness, no se re-autora)

El backend y el frontend ya traen su TDD owned-by-dev (`qa-*-standards.md` §2.1): backend con unit (máquina de estado + validaciones), integration (Testcontainers), e2e-nest (guard RBAC, 422/409, publicar/archivar) y contract (Spectral); frontend con unit (mappers/`AppError`/state holders), component (RTL), integration (MSW contra el contrato) y smoke Playwright del happy path. **Este plan no las duplica**: las referencia como cobertura consciente para no re-testear lo ya blindado (anti-pattern de duplicación L1/L3 de `qa-three-layer-regression`).

## 3. Matriz de trazabilidad: AC × capa

Leyenda: **DEV** = ya cubierto por la TDD del dev (nota, no se autora acá) · **QA** = autorado en este plan · **—** = no aplica.

| AC | Unit (DEV) | Integr/Component (DEV) | E2E-nest / Smoke (DEV) | **E2E cross-stack (QA)** | **Aceptación BDD (QA)** | **Funcional API (QA)** | **Carga (QA)** |
|---|---|---|---|---|---|---|---|
| **AC-1** crear categoría (slug único) | DEV (slug) | DEV | DEV | — | **QA** (H-1) | **QA** (F-1) | — |
| **AC-2** alta producto draft | — | DEV | DEV | — (ver nota) | **QA** (H-2) | — | — |
| **AC-3** editar producto | — | DEV | DEV | — (ver nota) | **QA** (H-3) | — | — |
| **AC-4** publicar (cumple) | DEV (state) | DEV | DEV | — (ver nota) | **QA** (H-4) | — | — |
| **AC-5** validación por campo → 422 | DEV | DEV | DEV | **QA** (E-2) | **QA** (N-1/2/3) | **QA** (F-2) | — |
| **AC-6** publicar incompleto → draft | DEV (state) | DEV | DEV | **QA** (E-3) | **QA** (N-4) | — | — |
| **AC-7** archivar (no borrar) | — | DEV | DEV | **QA** (E-4) | **QA** (H-5) | — | — |
| **AC-8** acceso restringido 401/403 | — | DEV (guard FE) | DEV | **QA** (E-5) | **QA** (N-6) | **QA** (F-3) | — |
| **AC-9** SKU único → 409 | — | DEV | DEV | **QA** (E-6) | **QA** (N-5) | **QA** (F-2) | — |
| **AC-10** precio no altera ventas | — | — | — | **QA `@deferred`** (X-5) | — | — | — |
| **NFR** listado ≥5.000 SKUs | — | — | — | — | — | — | **QA** (L-1/L-2) |
| **NFR** WCAG 2.1 AA | — | DEV (jest-axe) | — | **QA** (A-1) | — | — | — |

**Cada AC activo (AC-1..AC-9) tiene ≥1 escenario QA.** AC-10 tiene escenario escrito y `@deferred` (owner: US de checkout) — verificable-más-tarde, no ausente.

> **Nota (corregido 2026-07-25 — auditoría)**: la matriz citaba un escenario `E-1` para AC-2/3/4 en
> la columna *E2E cross-stack*; ese escenario **no existe** — §5.2 define E-2..E-6 (TC-020..TC-024).
> Las celdas quedan en `—` porque la cobertura de esas tres AC a nivel FE-real→API-real ya la da la
> **aceptación BDD** (H-2/H-3/H-4), que corre contra la API viva igual que el E2E cross-stack. No se
> pierde cobertura; se deja de afirmar una capa que no estaba escrita. Si se quisiera un spec
> Playwright dedicado del CRUD en la costura (además del BDD), habría que definir E-1 y su TC.

## 4. Escenarios Gherkin

> Tense declarativo, keywords Gherkin en inglés + prosa en español (espeja las ACs del US y `base-standards.md` §2.4). Tags: `@acceptance @regression @critical-path` según categoría; `@blocked-by-backend`/`@deferred` donde aplica. Runner Cucumber.js **strict** (steps pending → fallo).

### 4.1 Happy path

```gherkin
# qa/acceptance/features/catalogo-ciclo.feature
Feature: Ciclo de vida del catálogo desde el panel del dueño
  Como dueño autenticado
  Quiero dar de alta, editar, publicar y archivar productos y categorías
  Para tener el catálogo cargado y mantenido como base de la tienda

  Background:
    Given una sesión de administrador válida

  @acceptance @regression @critical-path
  Scenario: H-1 — Crear una categoría con slug único (AC-1)
    When el dueño crea una categoría con nombre "Refrigeración"
    Then la categoría queda registrada con un slug único
    And la categoría queda disponible para asignar a productos

  @acceptance @regression @critical-path
  Scenario: H-2 — Alta de un producto en borrador (AC-2)
    Given una categoría "Refrigeración" existente
    When el dueño da de alta un producto con nombre, SKU, precio, stock y esa categoría
    Then el producto queda creado en estado "borrador"

  @acceptance @regression
  Scenario: H-3 — Editar un producto existente (AC-3)
    Given un producto existente en el catálogo
    When el dueño modifica su precio, stock y categoría
    Then los cambios quedan guardados
    And el precio se refleja en pesos con IVA incluido

  @acceptance @regression @critical-path
  Scenario: H-4 — Publicar un producto que cumple los requisitos (AC-4)
    Given un producto en borrador con nombre, precio, stock y categoría cargados
    When el dueño lo publica
    Then el producto pasa a estado "publicado"

  @acceptance @regression @critical-path
  Scenario: H-5 — Archivar un producto publicado sin borrarlo (AC-7)
    Given un producto publicado
    When el dueño lo archiva con la confirmación de dos pasos
    Then el producto queda en estado "archivado"
    And el producto se conserva (no se elimina físicamente)
```

### 4.2 Corner (condiciones de borde)

```gherkin
# qa/acceptance/features/catalogo-ciclo.feature (cont.)

  @regression
  Scenario: C-1 — Listado paginado más allá del total devuelve página vacía coherente
    Given un catálogo con 3 productos
    When el dueño solicita la página con offset 100 y limit 20
    Then el listado devuelve una colección vacía
    And la paginación informa total 3

  @regression
  Scenario Outline: C-2 — Alta en el borde de los valores permitidos (AC-2/AC-5)
    Given una categoría existente
    When el dueño da de alta un producto con precio <precio_centavos> y stock <stock>
    Then el alta <resultado>

    Examples:
      | precio_centavos | stock | resultado                         |
      | 1               | 0     | queda creada en borrador          |
      | 0               | 0     | es rechazada por precio inválido  |

  @regression
  Scenario: C-3 — Despublicar un producto publicado vuelve a borrador (E2E §18.5)
    Given un producto publicado
    When el dueño lo cambia a estado "borrador"
    Then el producto queda en estado "borrador"
    And deja de ser elegible para el storefront

  @regression
  Scenario: C-4 — Reactivar un producto archivado es rechazado (transición inválida)
    Given un producto archivado
    When el dueño intenta cambiarlo a estado "publicado"
    Then el sistema rechaza la transición
    And el producto permanece archivado
```

### 4.3 Negative (modos de falla)

```gherkin
# qa/acceptance/features/catalogo-validacion.feature
Feature: Validación y unicidad al cargar el catálogo
  Como dueño
  Quiero que el sistema rechace datos inválidos con mensajes claros
  Para no cargar productos corruptos ni duplicados

  Background:
    Given una sesión de administrador válida
    And una categoría "Refrigeración" existente

  @acceptance @regression
  Scenario Outline: N-1/2/3 — Rechazo por campo con mensaje claro y sin escritura parcial (AC-5)
    When el dueño intenta dar de alta un producto con <campo> igual a <valor_invalido>
    Then el sistema rechaza la operación con un mensaje para el campo "<campo>"
    And el producto no se crea

    Examples:
      | campo  | valor_invalido |
      | precio | 0              |
      | precio | -100           |
      | stock  | -1             |
      | nombre | (vacío)        |
      | sku    | (vacío)        |

  @acceptance @regression @critical-path
  Scenario: N-4 — Publicar un producto incompleto es rechazado y permanece en borrador (AC-6)
    Given un producto en borrador sin categoría asignada
    When el dueño intenta publicarlo
    Then el sistema rechaza la publicación indicando que falta la categoría
    And el producto permanece en estado "borrador"

  @acceptance @regression @critical-path
  Scenario: N-5 — Alta con SKU duplicado es rechazada (AC-9)
    Given un producto existente con SKU "REF-001"
    When el dueño intenta crear otro producto con el SKU "REF-001"
    Then el sistema rechaza el alta por SKU duplicado
    And no se crea un segundo producto con ese SKU

  @acceptance @regression
  Scenario: N-8 — Crear una categoría con slug colisionante es rechazada (AC-1)
    Given una categoría "Refrigeración" existente
    When el dueño intenta crear otra categoría cuyo nombre deriva el mismo slug
    Then el sistema rechaza la creación por slug duplicado
```

```gherkin
# qa/acceptance/features/catalogo-acceso.feature
Feature: Acceso restringido al panel de catálogo
  Como sistema
  Quiero denegar toda operación de administración a quien no es dueño
  Para que el catálogo no sea manipulable por clientes ni anónimos

  @acceptance @regression @critical-path
  Scenario: N-6 — Un visitante sin sesión no accede al panel ni a sus operaciones (AC-8)
    Given un visitante sin sesión de administrador
    When intenta acceder al panel de catálogo
    Then el sistema deniega el acceso
    And no expone ninguna operación de administración del catálogo

  @acceptance @regression
  Scenario: N-7 — Una sesión con rol no-admin es rechazada en las operaciones (AC-8)
    Given una sesión con rol distinto de administrador
    When intenta crear o editar un producto
    Then el sistema deniega la operación
```

### 4.4 Cross-feature (Layer 3 — sólo flujos que cruzan disciplinas)

```gherkin
# qa/acceptance/features/catalogo-ciclo.feature (cross-feature)

  @acceptance @regression @critical-path
  Scenario: X-1 — Ciclo completo cross-stack del catálogo (AC-1→AC-4, AC-7)
    Given una sesión de administrador válida en el panel
    When el dueño crea la categoría "Refrigeración"
    And da de alta un producto en esa categoría
    And publica ese producto
    And luego lo archiva
    Then cada transición queda reflejada en el panel y confirmada por la API

  @acceptance @regression
  Scenario: X-2 — Publicar incompleto desde la UI muestra qué falta sin cambio optimista (AC-6)
    Given un producto en borrador sin categoría, abierto en el panel
    When el dueño pulsa "Publicar"
    Then el panel muestra qué falta para publicar
    And el producto sigue mostrándose como "borrador" (sin optimismo falso)

  @deferred @regression
  Scenario: X-5 — Cambiar el precio no altera el precio de ventas pasadas (AC-10)
    # @deferred — sin superficie en US-001 (no hay checkout/órdenes). Owner: US de checkout.
    Given un producto que ya fue comprado en una orden registrada
    When el dueño cambia el precio del producto en el catálogo
    Then el precio de ese producto en la orden histórica no cambia
    And el catálogo refleja el precio nuevo sólo para ventas futuras

  @blocked-by-backend @regression
  Scenario: X-6 — Login admin real por la página de acceso (AC-8)
    # @blocked-by-backend — no existe controller para POST /v1/admin/auth/login (OQ-QA-1).
    # Se activa cuando el backend exponga la ruta; hasta entonces el resto usa el fallback de JWT minteado.
    Given un dueño en la página de acceso con su bootstrap token
    When envía el formulario de acceso
    Then obtiene una sesión de administrador válida
    And accede al panel de catálogo
```

## 5. Test cases owned-by-QA (con frontmatter obligatorio)

> Naming `Subject_Scenario_ExpectedOutcome` (`testing-standards.md` §4.1). `execution_mode: automated` por defecto (habilita scaffolding IA); los charters exploratorios son `manual` con justificación.

### 5.1 Aceptación BDD (Cucumber.js + Playwright)

```yaml
- id: TC-001
  scenario: H-1
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "H-1 — Crear una categoría con slug único (AC-1)"
  name: Categoria_CreadaConNombreValido_QuedaConSlugUnicoYDisponible
- id: TC-002
  scenario: H-2
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "H-2 — Alta de un producto en borrador (AC-2)"
  name: Producto_AltaConCamposMinimos_QuedaEnBorrador
- id: TC-003
  scenario: H-3
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "H-3 — Editar un producto existente (AC-3)"
  name: Producto_EditadoPrecioStockCategoria_GuardaCambios
- id: TC-004
  scenario: H-4
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "H-4 — Publicar un producto que cumple los requisitos (AC-4)"
  name: Producto_PublicadoCumpliendoRequisitos_PasaAPublicado
- id: TC-005
  scenario: H-5
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "H-5 — Archivar un producto publicado sin borrarlo (AC-7)"
  name: Producto_Archivado_QuedaArchivadoYSeConserva
- id: TC-006
  scenario: C-1
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "C-1 — Listado paginado más allá del total"
  name: ListadoProductos_OffsetMayorAlTotal_DevuelvePaginaVaciaCoherente
- id: TC-007
  scenario: C-2
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "C-2 — Alta en el borde de los valores permitidos"
  name: Producto_PrecioEnElBorde_CreaORechazaSegunLimite
- id: TC-008
  scenario: C-3
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "C-3 — Despublicar vuelve a borrador"
  name: Producto_Despublicado_VuelveABorradorYSaleDelStorefront
- id: TC-009
  scenario: C-4
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "C-4 — Reactivar archivado es rechazado"
  name: Producto_ReactivarArchivado_EsRechazadoYPermaneceArchivado
- id: TC-010
  scenario: N-1/2/3
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "N-1/2/3 — Rechazo por campo sin escritura parcial (AC-5)"
  name: Producto_CampoInvalido_RechazaPorCampoYNoCrea
- id: TC-011
  scenario: N-4
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "N-4 — Publicar incompleto permanece en borrador (AC-6)"
  name: Producto_PublicarIncompleto_RechazaIndicandoFaltanteYPermaneceBorrador
- id: TC-012
  scenario: N-5
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "N-5 — Alta con SKU duplicado (AC-9)"
  name: Producto_SkuDuplicado_RechazaYNoCreaSegundo
- id: TC-013
  scenario: N-8
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "N-8 — Slug de categoría colisionante (AC-1)"
  name: Categoria_SlugColisionante_RechazaPorDuplicado
- id: TC-014
  scenario: N-6
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "N-6 — Visitante sin sesión no accede (AC-8)"
  name: Panel_VisitanteSinSesion_DeniegaAccesoYNoExponeOperaciones
- id: TC-015
  scenario: N-7
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "N-7 — Rol no-admin rechazado (AC-8)"
  name: Operacion_RolNoAdmin_EsDenegada
- id: TC-016
  scenario: X-1
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "X-1 — Ciclo completo cross-stack (AC-1→AC-4, AC-7)"
  name: Catalogo_CicloCompletoCrearAltaPublicarArchivar_ReflejaCadaTransicion
- id: TC-017
  scenario: X-2
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "X-2 — Publicar incompleto desde la UI (AC-6)"
  name: Panel_PublicarIncompleto_MuestraFaltanteSinOptimismoFalso
- id: TC-018
  scenario: X-5
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "X-5 — Precio no altera ventas pasadas (AC-10)"
  name: Producto_CambioDePrecio_NoAlteraOrdenHistorica
  status: deferred   # sin superficie en US-001; owner: US de checkout
- id: TC-019
  scenario: X-6
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "X-6 — Login admin real por la página de acceso (AC-8)"
  name: Acceso_LoginRealPorPagina_ObtieneSesionAdmin
  status: blocked-by-backend   # falta controller POST /v1/admin/auth/login (OQ-QA-1)
```

### 5.2 E2E cross-stack de la costura FE↔BE (Playwright, browser → API real)

> Estos NO son Gherkin (no aportan a un lector no-técnico): validan el **mapeo de error** en la costura contra la API real, que el dev-L2 (FE↔MSW) no cubre. Incluyen negative-space explícito.

```yaml
- id: TC-020
  scenario: E-2
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: "N-1/2/3 (costura)"
  name: ProductForm_Error422DeLaApiReal_PintaErroresInlinePorCampoSinPerderInput
- id: TC-021
  scenario: E-6
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: "N-5 (costura)"
  name: ProductForm_Error409DeLaApiReal_PintaBannerYCampoSku
- id: TC-022
  scenario: E-5
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: "N-6 (costura)"
  name: Panel_Respuesta401DeLaApiReal_RedirigeAAcceso
- id: TC-023
  scenario: E-3
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: "X-2 (costura, negative-space)"
  name: Panel_PublicarIncompleto_NoMuestraPublicadoOptimista
- id: TC-024
  scenario: E-4
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: "H-5 (costura, negative-space)"
  name: Producto_Archivar_ExigeConfirmacionDosPasosYNoBorraFisicamente
```

### 5.3 Funcional API (Newman — black-box contra el servicio corriendo)

```yaml
- id: TC-025
  scenario: F-3
  execution_mode: automated
  test_layer: 3
  target_tooling: Newman
  gherkin_scenario: "N-6/N-7 (barrido RBAC)"
  name: EndpointsAdmin_SinTokenYConRolNoAdmin_Devuelven401Y403EnTodaLaSuperficie
- id: TC-026
  scenario: F-1
  execution_mode: automated
  test_layer: 3
  target_tooling: Newman
  gherkin_scenario: "H-1 (forma de contrato)"
  name: CrearCategoria_RespuestaViva_CumpleFormaDelContrato
- id: TC-027
  scenario: F-2
  execution_mode: automated
  test_layer: 3
  target_tooling: Newman
  gherkin_scenario: "N-1/2/3, N-5 (forma RFC 7807)"
  name: ErroresAdmin_422Y409_CumplenEnvelopeRfc7807SinFugaDeEsquema
```

### 5.4 Carga k6

```yaml
- id: TC-028
  scenario: L-1
  execution_mode: automated
  test_layer: 3
  target_tooling: k6
  gherkin_scenario: "NFR ≥5.000 SKUs — baseline"
  name: ListadoProductos_5000Skus_BaselineCumpleP95Bajo300ms
- id: TC-029
  scenario: L-2
  execution_mode: automated
  test_layer: 3
  target_tooling: k6
  gherkin_scenario: "NFR ≥5.000 SKUs — stress"
  name: ListadoProductos_5000Skus_StressRevelaElKneeSinRomperCorrectitud
```

### 5.5 Accesibilidad (axe-core sobre Playwright)

```yaml
- id: TC-030
  scenario: A-1
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: "NFR WCAG 2.1 AA"
  name: PanelCatalogo_CuatroPantallasContraApiReal_CeroViolacionesWcagAA
```

### 5.6 Exploratorio (charters — manual, justificado)

```yaml
- id: TC-031
  scenario: EXP-1
  execution_mode: manual   # exploratorio de riesgo — no scriptable en valor
  test_layer: 3
  target_tooling: manual
  gherkin_scenario: "Charter: máquina de estado"
  name: Charter_MaquinaDeEstado_TransicionesInesperadasYConcurrencia
- id: TC-032
  scenario: EXP-2
  execution_mode: manual
  test_layer: 3
  target_tooling: manual
  gherkin_scenario: "Charter: costura de auth y sesión"
  name: Charter_Auth_ExpiracionTokenYAccesoDirectoARutasProtegidas
```

## 6. Escenarios de aceptación BDD — detalle

Ver §4. **Tooling**: Cucumber.js + Playwright (`qa-frontend-standards.md` §24 — godog NO aplica, sin Go). **Location**: `qa/acceptance/features/*.feature` + `qa/acceptance/steps/*.ts`. **Reusa**: fixture `adminAuth` de `qa/support/admin-auth.ts`, seed de `qa/support/seed.ts`, builders de `qa/support/builders.ts`. **Runner**: `cucumber.mjs` con `strict` (steps pending fallan).

## 7. Carga / performance (k6)

**Endpoint**: `GET /v1/admin/products?limit=&offset=` — NFR "listado paginado/ordenable sin degradación con ≥5.000 SKUs" (US §9, E2E §17).

- **Dataset**: ≥5.000 SKUs sembrados (determinista, `qa/performance/data/seed-skus.js`) — el foco del NFR es el **tamaño**, no la concurrencia.
- **Perfil de carga** (backoffice de un solo admin):
  - **Baseline** (`baseline.js`): `constant-arrival-rate` ~10 rps, 10 min tras warm-up; recorre distintos `offset`/páginas con `SharedArray`.
  - **Stress** (`stress.js`): `ramping-arrival-rate` hasta ~50 rps para hallar el knee (thresholds informativos-laxos; el deliverable es el punto de quiebre).
- **Thresholds (fuente única `lib/thresholds.js`, atados al NFR)** `[propuesto — confirma Arquitecto post-load-test]`:
  - `http_req_duration{endpoint:list_products}`: `p(95)<300`, `p(99)<800`.
  - `http_req_failed`: `rate<0.01`.
  - `checks`: `rate>0.99` → status 200 + `pagination.total >= 5000` + `data.length <= limit`.
- **Criterio de éxito**: baseline verde con el dataset grande; stress documenta el knee. Exit code no-cero en breach.
- **Entorno**: local/CI contra Postgres sembrado (OQ-QA-2 — sin cloud vivo); re-medición en `pre-uat`. **Nunca contra producción**.
- **Gate**: smoke-load (1-2 VUs, ~1min) en PR CI; baseline on-demand/nightly.

## 8. Accesibilidad (WCAG 2.1 AA)

axe-core (vía `@axe-core/playwright`) sobre las 4 pantallas del panel corriendo contra la API real: `/acceso`, `/(admin)/categorias`, `/(admin)/productos`, `/(admin)/productos/nuevo|[id]`. Criterio: **0 violaciones nivel AA** (`qa-frontend-standards.md` §19). Complementa el `jest-axe` del dev (render aislado) validando el árbol con datos reales, foco gestionado al navegar entre rutas SPA, focus-trap del modal de archivar y color no como único portador de estado.

## 9. Infraestructura de test

### SUT / fixtures

- `qa/support/admin-auth.ts` — fixture de auth con precedencia login-real → fallback JWT minteado (OQ-QA-1). `testing-standards.md` §14.2.
- `qa/support/seed.ts` — sembrado determinista **vía la API real** (respeta validación y máquina de estado; no `INSERT` directo).
- `qa/acceptance/steps/world.ts` — contexto Cucumber por-escenario (aislado, sin estado global — anti-flake).

### Builders (`testing-standards.md` §14.3)

- `nuevaCategoria({ name })` y `nuevoProducto({ sku, name, price_ars_cents, stock, category_id, ... })` en `qa/support/builders.ts` — defaults deterministas; SKU con prefijo único por-run para idempotencia (no se asereta el valor, sólo su unicidad).

### Matchers / aserciones (`testing-standards.md` §14.5)

- `esEnvelopeRfc7807(problem)` — verifica `type|title|status|detail|instance` (+ `errors[]:{field,message}` en 422) y **ausencia de fuga** (sin stack/SQL/Prisma crudo).
- `esProductoEnEstado(producto, estado)` — aserción semántica de la máquina de estado.

## 10. Estrategia de datos de test (`testing-standards.md` §5, `qa-backend-standards.md` §15)

- **Solo sintético**, sembrado vía API. Sin datos de producción.
- **Determinista**: sin `Date.now()`/`Math.random()` en aserciones; el único no-determinismo tolerado es el prefijo único de SKU por-run (idempotencia entre corridas).
- **Idempotente**: cada escenario siembra lo suyo y limpia lo que crea; re-ejecutar produce estado equivalente. Ningún escenario depende del residuo de otro.
- **Money**: centavos ARS enteros en el wire; builders y aserciones espejan `$>0 → cents≥1`.

## 11. Objetivos de cobertura

| Componente | Objetivo | Rationale |
|---|---|---|
| ACs activos (AC-1..AC-9) | 100% con ≥1 escenario QA cross-stack | Tier 2 fundacional; caminos críticos del catálogo |
| Máquina de estado (transiciones válidas + inválidas) | 100% de las transiciones del §Design del BE | negocio load-bearing (AC-4/6/7) |
| Barrido RBAC | 100% de la superficie `/v1/admin/*` (401 + 403) | seguridad (AC-8, STRIDE §14) |
| Mapeo de error en costura FE↔BE | 422 + 409 + 401 | lo que dev-L2 (MSW) no cubre contra API real |
| NFR listado ≥5.000 SKUs | baseline verde + knee documentado | US §9 / E2E §17 |
| WCAG 2.1 AA | 0 violaciones AA en 4 pantallas | US §9 |

> Nota: la cobertura de **línea** de la lógica (>80%) es objetivo de la capa dev (unit/integration); este plan mide cobertura por **AC y por transición**, no por línea (es cross-stack, caja negra).

## 12. Quality gates

| Gate | Bloquea | Trigger |
|---|---|---|
| Unit + integration + e2e-nest (dev) | merge | cada PR (owned-by-dev) |
| Smoke-load k6 (1-2 VUs) | merge | cada PR que toque `/v1/admin/products` |
| Aceptación BDD + E2E cross-stack + funcional API | promoción a uat | nightly + pre-uat deploy |
| Accesibilidad (axe-core AA) | release | pre-release |
| Carga k6 baseline | release | on-demand + pre-release (re-medida en `pre-uat`) |
| Regresión L3 (suite estable completa) | release | pre-release + cada change que toque el catálogo |

## 13. Anti-patterns explícitamente evitados

- ❌ `qa-three-layer-regression`: "mismo escenario en L1 + L3" — **evitado** referenciando la TDD del dev (nota de cobertura §2) y limitando L3 a flujos que **cruzan disciplinas** (FE→API real) o al gate black-box (Newman vs servicio corriendo), nunca re-testeando la lógica in-process.
- ❌ "QA escribe todos los tests" — **evitado**: las capas dev-owned son nota de awareness, no stubs autorados.
- ❌ `playwright-stability`/`flakiness-detection`: `waitForTimeout`/sleeps, selectores posicionales, estado global entre escenarios — **evitados** por diseño (auto-waiting, `getByRole`, contexto por-escenario).
- ❌ `k6-load-scaffolding`: load test sin `thresholds` atados a NFR — **evitado** (§7, fuente única en `lib/thresholds.js`); tokens hardcodeados — **evitado** (auth en `setup()`).
- ❌ `bdd-scenario-quality`: escenarios con fuga de implementación ("el POST devuelve 201 con body…") — **evitados** (Gherkin declarativo, outcomes observables); escenarios sin tag — **evitados** (todos tagueados).
- ❌ Inventar alrededor del gap de auth — **evitado**: el gap (OQ-QA-1) se surface explícito con `@blocked-by-backend`, no se oculta.
- ❌ AC sin escenario — **evitado**: AC-10 tiene escenario `@deferred` con owner, no se omite.

## 14. Standards consultados

- `spekode/docs/base-standards.md` §2.4
- `spekode/docs/quality/testing-standards.md` §2, §4.1, §5, §6, §8, §14 (14.2/14.3/14.5/14.8/14.9), §18
- `spekode/docs/quality/qa-backend-standards.md` §2.1, §13, §15, §21
- `spekode/docs/quality/qa-frontend-standards.md` §2.1, §19, §23, §24
- `spekode/docs/cross-cutting/performance-standards.md` §7, §8
- `spekode/docs/architecture/api-standards.md` §8
- `spekode/docs/delivery/operations-standards.md` (gates de promoción)

## 15. Open questions

- **OQ-QA-1** `[Resolved: 2026-07-25 — flujos gateados vía JWT role=admin minteado por fixture; login real por página @blocked-by-backend (TC-019) hasta POST /v1/admin/auth/login — owner: backend, revisit: al aterrizar el controller]` — sin controller de login.
- **OQ-QA-2** `[Deferred: k6 corre en local/CI contra Postgres sembrado; los umbrales quedan propuestos y se re-miden en un entorno prod-shaped — owner: Arquitecto/QA, revisit: al provisionar platform-cloud (pre-uat)]` — carga sin cloud vivo.
- **OQ-QA-3** `[Resolved: Tier 2 derivado]` — sin `service-catalog.yaml`; Tier 2 asumido (backoffice fundacional).

## 16. References

- User Story: `docs/user-stories/US-001-admin-catalogo-productos.md`
- PRD: `docs/product/prd.md` §1.4, §2.1
- E2E: `docs/product/design-e2e.md` §14, §17, §18, §19
- Contrato: `apps/api/docs/api/openapi.yaml`
- Changes hermanos: `openspec/changes/US-001-admin-catalogo-productos-{backend,frontend-web}/`
- ADRs: `0009-admin-auth-seam-us001.md`, `0005-own-jwt-authentication.md`
