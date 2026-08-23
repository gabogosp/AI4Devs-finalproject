# US-007 QA — Plan del carrito del invitado

> **Alcance**: capas **owned-by-QA** (Layer 3 cross-stack, aceptación BDD, a11y, carga,
> exploratorio). Las dev-owned (unit / integration / e2e-nest) son la TDD del backend y
> **no se re-autoran acá** (ownership matrix `qa-backend-standards.md` §2.1).
> **Numeración**: `TC-7NN` — el paquete `@dsm/qa` es compartido (US-001 `TC-0NN`,
> US-002 `TC-2NN`, US-003 `TC-3NN`).
> **Estado del stack**: backend **36/37** y contrato publicado ⇒ 14 de 23 test cases son
> **ejecutables hoy**. Frontend **planificado el 2026-08-22 por una sesión paralela y
> todavía sin desarrollar** (`US-007-carrito-compra-frontend-web`, 0 tasks cerradas) ⇒ 9
> quedan **bloqueados**, declarados como tales y no disfrazados de ejecutables.

## 1. Perfil de riesgo

US-007 es el eslabón que cierra el loop de compra del PRD (§3.1) y la **primera
superficie pública de escritura** del producto.

| Riesgo | Por qué importa acá |
|---|---|
| **Que alguien reserve stock** | AC-8 es la invariante que ADR-0008 fijó y que US-008/US-009/US-010 —que se están desarrollando en esta misma rama— pueden romper sin querer al «mejorar» el checkout. Es negative-space puro: nada se pone rojo solo. Es el escenario de mayor valor del plan (§4.3, N-2) |
| **Precio desactualizado** | AC-9 es dinero. La ficha se sirve cacheada (`max-age=60`) y el carrito `no-store`: si el carrito se apoyara en la lectura cacheada del catálogo, cobraría un precio que el dueño ya cambió, y ninguna suite de un solo módulo compara las dos superficies |
| **Callejón sin salida por indisponibilidad** | AC-6: una línea que no se puede comprar **ni quitar** deja al cliente sin salida y al checkout sin forma de avanzar. La mitad «no permite avanzar al pago» pertenece a US-008 (ver §6) |
| **Identidad pública divergente** | El carrito acepta `slug`; la ficha publica `slug`. Si divergen —lo que casi pasa en US-002 con `sku`— el botón «Agregar» de la ficha deja de funcionar y sólo lo ve quien hace clic |
| **Pérdida silenciosa del carrito** | AC-4 con `CART_TTL_DAYS = 7` deslizantes **desde la última escritura**: quien mira el carrito el día 6 sin tocarlo igual lo pierde el día 8. El PO aceptó el costo (OQ-BE-1); QA lo hace visible con un charter, no lo esconde |
| **La superficie inalcanzable desde el navegador** | `PUT`/`DELETE` recién entraron a la allowlist de CORS. Puede funcionar perfecto por `curl` y fallar el preflight en el browser: sólo se ve contra el proceso arrancado con la config real |

## 2. Mapeo de la pirámide (capas QA en negrita)

| Capa | Dueño | Estado |
|---|---|---|
| Unit (`cart-view`, token, guards, cookies) | dev | ✅ cubierto — ver §2.1 |
| Integration Postgres (`carts.repository`, esquema F40) | dev | ✅ cubierto |
| E2E de API en proceso (supertest, 7 specs) | dev | ✅ cubierto |
| **Aceptación BDD cross-stack (API-level)** | **QA** | este plan — **ejecutable hoy** |
| **E2E de navegador del carrito** | **QA** | este plan — **bloqueado (FE sin construir)** |
| **Accesibilidad (axe + teclado + anuncio de total)** | **QA** | este plan — **bloqueado (FE sin construir)** |
| **Carga (k6) de escritura** | **QA + dev** | este plan — ejecutable con la salvedad de §5.4 |
| **Exploratorio** | **QA** | este plan (manual) |

### 2.1 Nota de cobertura dev-owned (awareness, no se re-autora)

El change de backend cubre, con Postgres real y contra la app Nest: el ciclo
`PUT`/`GET`/`DELETE` completo y su idempotencia; la cantidad absoluta; el rechazo 409 con
`available_quantity` y que el rechazo **no** cree línea ni carrito; que el stock es
idéntico antes y después del ciclo y que **ninguna operación escribe `products`**; el
marcado `unavailable` / `insufficient_stock` sin borrar la línea y su recuperación al
republicar; el recálculo con precio vigente, el flag `price_changed` y su re-sellado; el
`no-store`; el 404 indistinguible del no publicado; la cookie con `Max-Age` = 604800 y la
fila con la misma ventana; el deslizamiento sólo en escrituras; la purga oportunista; el
aislamiento entre visitantes; CSRF; rate-limit; y los 6 eventos de observabilidad.

**Nada de eso se repite acá.** Este plan ejercita únicamente lo que vive **fuera de ese
proceso**: el cruce con el panel del dueño y con la ficha pública, la configuración real
del borde, la perspectiva del inventario del dueño, y toda la mitad de UI.

## 3. Matriz de trazabilidad: AC × capa

Leyenda: **DEV** = cubierto por la TDD del dev · **QA-hoy** = autorado acá y ejecutable ya ·
**QA-FE** = autorado acá, bloqueado hasta que exista el frontend · **—** = no aplica.

| AC | e2e-nest (DEV) | **Aceptación API (QA-hoy)** | **E2E navegador (QA-FE)** | **a11y (QA-FE)** | **Carga (QA)** |
|---|---|---|---|---|---|
| **AC-1** agregar un producto | DEV | **H-1**, **X-3** | **E-1** | — | — |
| **AC-2** editar la cantidad | DEV | **H-2** | **E-1** | **A-2** | — |
| **AC-3** quitar un producto | DEV | **H-3** | **E-1** | — | — |
| **AC-4** persistencia entre visitas | DEV | **H-4** | **E-2** | — | — |
| **AC-5** cantidad limitada al stock | DEV | **C-1** | **E-4** | — | — |
| **AC-6** dejó de estar disponible | DEV | **X-1**, **C-3** | **E-5** | — | — |
| **AC-7** carrito vacío | DEV | **C-2** | **E-3** | **A-1** | — |
| **AC-8** no reserva ni descuenta | DEV | **N-2** | — | — | — |
| **AC-9** precios vigentes | DEV | **X-2** | **E-6** | — | — |
| **AC-10** no se agregan no publicados | DEV | **N-1** | — | — | — |
| **NFR** WCAG 2.1 AA + teclado + anuncio de total | — | — | — | **A-1**, **A-2** | — |
| **NFR** p95 escritura < 500 ms (PRD §4) | — | — | — | — | **L-1** |

**Los 10 AC tienen ≥1 escenario QA, y los 10 tienen ≥1 escenario ejecutable hoy.**
Ninguno queda diferido en su totalidad. La única cobertura **parcial declarada** es la
segunda mitad de AC-6 —«no permite avanzar al pago»—, que ejecuta US-008 (§6).

## 4. Escenarios Gherkin (aceptación API-level, ejecutable hoy)

Feature: `qa/acceptance/features/carrito.feature`, tag de feature `@carrito`.
Gherkin en español como el resto de la suite (`# language: es`).

Antecedentes común: *«un catálogo sembrado por el dueño con stock conocido»* —
`seedCarrito()`, vía API admin real.

### 4.1 Happy path

```gherkin
@happy @critical-path
Escenario: H-1 — Agregar un producto publicado lo muestra con su precio y actualiza el total
  Dado un producto publicado con stock disponible
  Cuando un invitado lo agrega a su carrito
  Entonces el carrito muestra ese producto con la cantidad que pidió
  Y muestra el precio unitario que el dueño le puso
  Y el subtotal de la línea es el precio por la cantidad
  Y el total del carrito refleja esa línea

@happy @critical-path
Escenario: H-2 — Cambiar la cantidad recalcula el subtotal y el total
  Dado un invitado con un producto en su carrito
  Cuando cambia la cantidad de ese producto
  Entonces el subtotal de la línea acompaña la cantidad nueva
  Y el total del carrito se recalcula

@happy
Escenario: H-3 — Quitar un producto lo saca del carrito y recalcula el total
  Dado un invitado con dos productos en su carrito
  Cuando quita uno de los dos
  Entonces ese producto ya no está en el carrito
  Y el total del carrito es el del producto que queda

@happy @critical-path
Escenario: H-4 — El carrito sigue ahí en la visita siguiente, sin cuenta de por medio
  Dado un invitado que armó su carrito con dos productos
  Cuando cierra el navegador y vuelve conservando sólo sus cookies persistentes
  Entonces recupera el mismo carrito con los dos productos
  Y no tuvo que crear ninguna cuenta
```

### 4.2 Corner (condiciones de borde)

```gherkin
@corner @critical-path
Escenario: C-1 — No se puede pedir más de lo que hay, y el carrito no queda a medias
  Dado un producto publicado con 3 unidades de stock
  Y un invitado que ya tiene 2 unidades de ese producto en su carrito
  Cuando intenta subir la cantidad a 4
  Entonces el sistema rechaza la operación
  Y le informa cuántas unidades hay realmente disponibles
  Y su carrito sigue teniendo las 2 unidades de antes

@corner
Escenario: C-2 — Un invitado sin carrito ve el estado vacío, y mirarlo no le crea uno
  Dado un invitado que nunca agregó nada
  Cuando abre su carrito
  Entonces ve un carrito vacío, sin error
  Cuando lo vuelve a abrir
  Entonces sigue viendo un carrito vacío
  Y el sistema no le abrió ningún carrito por haberlo mirado

@corner
Escenario: C-3 — Con una línea comprable y otra bloqueada, el total sólo cuenta lo comprable
  Dado un invitado con dos productos publicados en su carrito
  Cuando el dueño despublica uno de los dos
  Y el invitado abre su carrito
  Entonces ve las dos líneas, cada una con su propio subtotal
  Y el total del carrito es solamente el de la línea que sí puede comprar
  Y el carrito avisa que hay algo que impide avanzar al pago
```

### 4.3 Negative (negative-space — lo que NO tiene que pasar)

```gherkin
@negative @critical-path
Esquema del escenario: N-1 — Lo que no está publicado no entra al carrito, y no se distingue de lo inexistente
  Dado un producto en estado "<estado>"
  Cuando un invitado intenta agregarlo a su carrito
  Entonces el sistema rechaza la operación
  Y el producto no queda incorporado al carrito
  Y la respuesta es indistinguible de la de un producto que no existe
  Ejemplos:
    | estado     |
    | borrador   |
    | archivado  |
    | inexistente|

@negative @critical-path
Escenario: N-2 — El carrito no reserva ni descuenta stock, por más carritos que haya
  Dado un producto publicado con exactamente 3 unidades de stock
  Cuando tres invitados distintos ponen las 3 unidades cada uno en su carrito
  Entonces los tres carritos tienen las 3 unidades disponibles para comprar
  Y el dueño sigue viendo 3 unidades de stock en su panel
  Y la ficha pública sigue anunciando el producto como disponible
  Cuando los tres modifican y quitan líneas de sus carritos
  Entonces el dueño sigue viendo 3 unidades de stock en su panel
```

> **Por qué N-2 está diseñado así.** La versión obvia —un invitado agrega, se relee el
> stock, sigue igual— pasa **también** si el sistema reservara inventario: con un carrito
> no hay forma de notarlo. La propiedad que delata la reserva es que **el inventario
> dejaría de alcanzar para todos a la vez**: con reserva, el segundo invitado recibiría un
> rechazo o quedaría marcado sin stock suficiente. Por eso son **tres** invitados con el
> stock completo cada uno. Y la aserción de inventario se hace contra **el panel del
> dueño** y contra la **ficha pública**, no contra el repositorio del carrito: lo que se
> vuelve falso en silencio es lo que el dueño ve, y una reserva implementada en el
> checkout (US-008) o en el webhook (US-010) sólo se detecta desde afuera. La relectura
> final descarta un decremento diferido. `testing-standards.md` §14.9.

### 4.4 Cross-feature (Layer 3 — cruzan disciplinas o US)

```gherkin
@cross-feature @critical-path
Escenario: X-1 — Despublicar desde el panel marca la línea del carrito, no la borra
  Dado un invitado con un producto publicado en su carrito
  Cuando el dueño despublica ese producto desde el panel
  Y el invitado vuelve a abrir su carrito
  Entonces la línea sigue estando, marcada como no disponible
  Y queda fuera del total del carrito
  Y el carrito avisa que hay algo que impide avanzar al pago
  Cuando el invitado quita esa línea
  Entonces la línea desaparece sin error
  # Cruza US-001 (panel) con US-007. La última parte cierra el callejón sin salida:
  # un ítem que no se puede comprar y tampoco sacar deja al cliente encerrado.

@cross-feature @critical-path
Escenario: X-2 — El carrito cobra el precio vigente aunque la ficha siga cacheada
  Dado un invitado con un producto en su carrito
  Cuando el dueño le cambia el precio desde el panel
  Y el invitado vuelve a abrir su carrito
  Entonces el importe unitario, el subtotal y el total usan el precio nuevo
  Y el carrito avisa que ese precio cambió desde que lo agregó
  Y la respuesta del carrito no es cacheable
  # Cruza US-001 (panel), US-003 (ficha cacheada 60 s) y US-007. Es la asimetría a
  # propósito: la ficha puede seguir mostrando el precio viejo un rato; el carrito no.

@cross-feature
Escenario: X-3 — El producto que publica la ficha es el que acepta el carrito
  Dado un producto publicado que el invitado encontró en su ficha pública
  Cuando lo agrega al carrito usando el identificador que la ficha publica
  Entonces el producto entra al carrito
  Y el precio que el carrito cobra es el que la ficha mostraba
  # Cruza US-003 con US-007. Es la red contra la divergencia de identificador público
  # (la lección de D-1 en US-002) y contra dos superficies que muestran precios distintos.
```

## 5. Test cases owned-by-QA

### 5.0 Índice — 23 test cases, 14 ejecutables hoy y 9 bloqueados

| Test case | Escenario | Herramienta | ¿Ejecutable hoy? |
|---|---|---|---|
| TC-701 | H-1 | Cucumber+Playwright | ✅ sí |
| TC-702 | H-2 | Cucumber+Playwright | ✅ sí |
| TC-703 | H-3 | Cucumber+Playwright | ✅ sí |
| TC-704 | H-4 | Cucumber+Playwright | ✅ sí |
| TC-705 | C-1 | Cucumber+Playwright | ✅ sí |
| TC-706 | C-2 | Cucumber+Playwright | ✅ sí |
| TC-707 | C-3 | Cucumber+Playwright | ✅ sí |
| TC-708 | N-1 | Cucumber+Playwright | ✅ sí |
| TC-709 | N-2 | Cucumber+Playwright | ✅ sí — **el de más valor (AC-8)** |
| TC-710 | X-1 | Cucumber+Playwright | ✅ sí |
| TC-711 | X-2 | Cucumber+Playwright | ✅ sí |
| TC-712 | X-3 | Cucumber+Playwright | ✅ sí |
| TC-720 | E-1 | Playwright | ❌ bloqueado — FE sin construir |
| TC-721 | E-2 | Playwright | ❌ bloqueado — FE sin construir |
| TC-722 | E-3 | Playwright | ❌ bloqueado — FE sin construir |
| TC-723 | E-4 | Playwright | ❌ bloqueado — FE sin construir |
| TC-724 | E-5 | Playwright | ❌ bloqueado — FE sin construir |
| TC-725 | E-6 | Playwright | ❌ bloqueado — FE sin construir |
| TC-730 | A-1 | axe-core+Playwright | ❌ bloqueado — FE sin construir |
| TC-731 | A-2 | Playwright | ❌ bloqueado — FE sin construir |
| TC-740 | L-1 | k6 | ✅ sí, con la salvedad de §5.4 |
| TC-750 | charter | manual | ❌ bloqueado — FE sin construir |
| TC-751 | charter | manual | ✅ sí (análisis con el dueño) |

**Por herramienta**: Cucumber+Playwright 12 · Playwright 7 · axe-core+Playwright 1 ·
k6 1 · charter manual 2.

### 5.1 Aceptación BDD API-level (Cucumber + Playwright) — **ejecutable hoy**

```yaml
- id: TC-701
  scenario: H-1
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "H-1 — agregar un producto publicado"
  name: Carrito_AgregarPublicado_MuestraPrecioVigenteSubtotalYTotal

- id: TC-702
  scenario: H-2
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "H-2 — editar la cantidad"
  name: Carrito_CambiarCantidad_RecalculaSubtotalYTotal

- id: TC-703
  scenario: H-3
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "H-3 — quitar un producto"
  name: Carrito_QuitarProducto_DesapareceYRecalculaElTotal

- id: TC-704
  scenario: H-4
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "H-4 — persistencia entre visitas"
  name: Carrito_NuevaSesionConLaCookiePersistente_RecuperaElMismoCarritoSinCuenta

- id: TC-705
  scenario: C-1
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "C-1 — tope de stock"
  name: Carrito_PedirMasQueElStock_RechazaConDisponibleYDejaLaLineaComoEstaba

- id: TC-706
  scenario: C-2
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "C-2 — carrito vacío"
  name: Carrito_InvitadoSinCarrito_VacioYLaLecturaNoLeCreaUno

- id: TC-707
  scenario: C-3
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "C-3 — carrito mixto"
  name: Carrito_LineaBloqueadaYComprable_TotalSoloDeLoComprableConSenalDeBloqueo

- id: TC-708
  scenario: N-1
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "N-1 — no publicados"
  name: Carrito_BorradorArchivadoOInexistente_RechazaIndistinguibleYNoIncorpora

- id: TC-709
  scenario: N-2
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "N-2 — no reserva ni descuenta stock"
  name: Carrito_TresInvitadosConTodoElStock_ElDuenoSigueViendoElMismoInventario

- id: TC-710
  scenario: X-1
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "X-1 — despublicar desde el panel"
  name: Carrito_ProductoDespublicadoPorElDueno_LineaMarcadaFueraDelTotalYQuitable

- id: TC-711
  scenario: X-2
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "X-2 — precio vigente contra ficha cacheada"
  name: Carrito_PrecioCambiadoPorElDueno_ImportesNuevosAvisadosYSinCache

- id: TC-712
  scenario: X-3
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "X-3 — identificador y precio compartidos con la ficha"
  name: Carrito_IdentificadorPublicoDeLaFicha_EsElQueElCarritoAceptaYCobra
```

### 5.2 E2E de navegador (Playwright) — **bloqueado: el FE está planificado, sin construir**

Escritos ahora para que el FE se construya contra criterios observables — y el plan de FE
se escribió **hoy, en paralelo**, así que llegan a tiempo. No se ejecutan hasta que ese
change esté **desarrollado**: hoy tiene 0 tasks cerradas.

| Escenario | Definición | AC |
|---|---|---|
| **E-1** | Desde la ficha: agregar al carrito, ver la línea con precio y subtotal, editar con el stepper, quitar | AC-1, AC-2, AC-3 |
| **E-2** | Cerrar y reabrir el navegador conservando sólo las cookies persistentes: el carrito sigue ahí, sin cuenta | AC-4 |
| **E-3** | Carrito vacío: estado vacío **con invitación a seguir comprando** (no sólo ausencia de ítems) | AC-7 |
| **E-4** | El stepper no deja superar el stock disponible y muestra el motivo | AC-5 |
| **E-5** | Línea no disponible: aviso visible y sin camino al pago | AC-6 |
| **E-6** | Precio cambiado por el dueño: el carrito muestra el vigente y avisa el cambio | AC-9 |

```yaml
- id: TC-720
  scenario: E-1
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: "E-1 — ficha → agregar → carrito → editar → quitar (AC-1/AC-2/AC-3)"
  name: CarritoUI_DesdeLaFicha_AgregarEditarConStepperYQuitar
  blocked_by: "FE-US-007 planificado sin desarrollar"

- id: TC-721
  scenario: E-2
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: "E-2 — persistencia real cerrando el navegador (AC-4)"
  name: CarritoUI_CerrarYReabrirElNavegador_ElCarritoSigueAhiSinCuenta
  blocked_by: "FE-US-007 planificado sin desarrollar"

- id: TC-722
  scenario: E-3
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: "E-3 — estado vacío con invitación a seguir comprando (AC-7)"
  name: CarritoUI_Vacio_EstadoVacioConSalidaAlCatalogo
  blocked_by: "FE-US-007 planificado sin desarrollar"

- id: TC-723
  scenario: E-4
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: "E-4 — el stepper no deja superar el stock y explica por qué (AC-5)"
  name: CarritoUI_Stepper_AcotadoAlStockYConMensajeQueLoExplica
  blocked_by: "FE-US-007 planificado sin desarrollar"

- id: TC-724
  scenario: E-5
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: "E-5 — aviso de no disponible (AC-6)"
  name: CarritoUI_LineaNoDisponible_AvisoVisibleYSinCaminoAlPago
  blocked_by: "FE-US-007 planificado sin desarrollar"

- id: TC-725
  scenario: E-6
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: "E-6 — importe vigente y aviso de cambio de precio (AC-9)"
  name: CarritoUI_PrecioCambiado_MuestraElVigenteYAvisaElCambio
  blocked_by: "FE-US-007 planificado sin desarrollar"
```

### 5.3 Accesibilidad (axe-core + teclado) — **bloqueado: el FE está planificado, sin construir**

| Escenario | Definición | Origen |
|---|---|---|
| **A-1** | 0 violaciones WCAG 2.1 AA en las tres variantes del carrito: con ítems, vacío y **con una línea bloqueada** | US §9 |
| **A-2** | Stepper y acción de quitar alcanzables y operables **sólo con teclado**, con foco visible y orden lógico, **y el nuevo total anunciado** por una región viva | US §9 (pide las dos cosas por su nombre) |

**Sin duplicación con el plan de FE**: ese change corre `axe(container)` y assertea
`aria-live` **a nivel componente** (dev-owned, jest-axe). A-1 y A-2 corren sobre la
**página servida** en un browser real: axe sobre la ruta completa, y alcanzabilidad por
`Tab` a través de toda la página —incluidos header y mini-cart—, que ningún test de
componente aislado puede ver.

```yaml
- id: TC-730
  scenario: A-1
  execution_mode: automated
  test_layer: 3
  target_tooling: axe-core+Playwright
  gherkin_scenario: "A-1 — NFR WCAG 2.1 AA en las tres variantes del carrito"
  name: CarritoUI_SinViolacionesAA_ConItemsVacioYConLineaBloqueada
  blocked_by: "FE-US-007 planificado sin desarrollar"

- id: TC-731
  scenario: A-2
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: "A-2 — NFR teclado + anuncio del total (US §9)"
  name: CarritoUI_StepperYQuitar_OperablesConTecladoYElTotalSeAnuncia
  blocked_by: "FE-US-007 planificado sin desarrollar"
```

**A-2 es específico de esta US y no lo cubre axe.** La US §9 pide dos cosas por su
nombre: stepper navegable por teclado y **anuncio de los cambios de total**. axe no
detecta que un control sea inalcanzable con `Tab` ni que falte una región viva que anuncie
el nuevo total: hay que recorrerlo y asertar foco visible, orden lógico y que el cambio de
total quede anunciado.

### 5.4 Carga (k6) — **ejecutable, con dos condiciones declaradas**

| Escenario | Definición | Presupuesto |
|---|---|---|
| **L-1** | Escritura de línea de carrito (`PUT` + `DELETE`) con un invitado nuevo por iteración | **p95 < 500 ms** — PRD §4 «latencia p95 escritura (carrito/orden)» + US §9 |
| **L-2** | Lectura del carrito (`GET /v1/cart`) | **sin presupuesto ratificado ⇒ el stub no se emite** (ver abajo) |

```yaml
- id: TC-740
  scenario: L-1
  execution_mode: automated
  test_layer: 3
  target_tooling: k6
  gherkin_scenario: "L-1 — NFR p95 escritura < 500 ms (PRD §4, US §9)"
  name: Carrito_EscrituraDeLinea_P95BajoQuinientosMsConInvitadosDistintos
```

El umbral **no se inventa**: el PRD §4 fija «latencia p95 escritura (**carrito**/orden) <
500 ms» y la US §9 lo repite. Se agrega `cart_write` a `qa/performance/lib/thresholds.js`
con el tag `endpoint:cart_write`, junto a los presupuestos que ya viven ahí.

Dos condiciones van escritas en el propio script:

1. **Cada iteración usa un invitado nuevo** (cookie propia + su double-submit). Reusar un
   carrito mediría el upsert de una fila caliente; el patrón real es muchos invitados con
   pocas líneas.
2. **El presupuesto de escritura hace imposible la medición tal como está configurado**:
   `CART_WRITE_RATE_LIMIT_MAX = 30` por minuto y por IP son 0,5 rps. El script **aborta si
   ve un 429** en vez de reportar un p95 falso, y la corrida se hace con el límite elevado
   sólo en el entorno de carga (OQ-QA-2).

#### L-2 — escenario de lectura: **stub rechazado a propósito**

**No se emite** un k6 sobre `GET /v1/cart`. No existe número ratificado: el PRD §4 acota
sus `p95 < 300 ms` a «catálogo/ficha», y el `design.md` del backend marca el valor del
carrito como `[propuesto — confirma Arquitecto]`. Copiar los 300 ms de otra fila del PRD
sería inventar un presupuesto y darle apariencia de gate — el teatro que
`k6-load-scaffolding` §Threshold discipline prohíbe. Se mide **sin umbral** dentro de la
corrida de L-1, como dato informativo, para que el número exista el día que el Arquitecto
tenga que firmarlo (OQ-QA-1).

### 5.5 Exploratorio (manual, justificado)

```yaml
- id: TC-750
  execution_mode: manual
  test_layer: 3
  target_tooling: charter
  gherkin_scenario: "—"
  name: Charter_ElCarritoFrenteANavegadoresReales
  blocked_by: "FE-US-007 planificado sin desarrollar"
  justification: >-
    La identidad del carrito ES una cookie, así que su comportamiento depende del
    navegador y no del servidor: modo incógnito, cookies de terceros bloqueadas,
    varias pestañas a la vez, y sobre todo el techo de vida de cookie que Safari/ITP
    impone — que cae justo en los mismos 7 días de CART_TTL_DAYS. Ningún runner
    reproduce ese conjunto; automatizarlo daría falsa confianza sobre AC-4.

- id: TC-751
  execution_mode: manual
  test_layer: 3
  target_tooling: charter
  gherkin_scenario: "—"
  name: Charter_LaVentanaDeSieteDiasContraElCicloRealDeCompra
  justification: >-
    El PO eligió 7 días (OQ-BE-1) aceptando por escrito que quien vuelve a las dos
    semanas encuentra el carrito vacío, sin aviso ni recuperación. Si el ciclo real
    de un gremio —cotizar, juntar materiales, comprar al cobrar— supera esa ventana,
    el costo deja de ser marginal. Es una sesión de análisis con el dueño, no un
    assert: el criterio es de negocio y la variable se sube por entorno sin deploy.
```

## 6. Bloqueos y dependencias (declarados)

| # | Qué | Estado | Dueño / disparador |
|---|---|---|---|
| B-1 | **El FE de US-007 está planificado y sin desarrollar** (`US-007-carrito-compra-frontend-web`, plan escrito el 2026-08-22 por una sesión paralela, 0 tasks cerradas). Las fases 4 y 5 (E-1…E-6, A-1, A-2, TC-750) necesitan la UI construida. | **Bloquea la ejecución**, no la planificación | `/develop-frontend-web US-007` → luego `/develop-qa US-007` |
| B-2 | **La segunda mitad de AC-6 pertenece a US-008.** El carrito entrega `has_blocking_issues`; **impedir el avance al pago** lo ejecuta el checkout. | Cobertura parcial declarada | US-008 (ver OQ-QA-3) |
| B-3 | **El NFR de lectura del carrito no tiene número ratificado.** | Bloquea el stub L-2, no el plan | Arquitecto (OQ-QA-1) |
| B-4 | **El presupuesto de escritura (30/min/IP) impide medir el NFR de escritura** desde un generador. | Bloquea la corrida de L-1 tal cual | PO / Arquitecto (OQ-QA-2) |
| B-5 | **Entorno**: la API tiene que arrancar con `CORS_ALLOWED_ORIGINS` (el `Origin` del cliente QA) y `ADMIN_BOOTSTRAP_TOKEN`, o toda escritura posterior a la primera muere en 403 y todo seed muere en el login. | Bloquea la corrida | ver `design.md` §Hechos del entorno |

## 7. Infraestructura de test

### Se reusa de `qa/` (sin modificar)

| Pieza | Para qué |
|---|---|
| `qa/acceptance/steps/world.ts` | contexto admin autenticado + contexto anónimo + browser perezoso, aislados por escenario |
| `qa/support/admin-auth.ts` | login **real** con `ADMIN_BOOTSTRAP_TOKEN` (el `Before` del world ya lo llama) |
| `qa/support/api.ts` (`apiCall`) | llamadas admin que fallan **ruidoso** ante cualquier no-2xx |
| `qa/support/builders.ts` | `nuevaCategoria` / `nuevoProducto` con defaults deterministas y prefijo único por corrida |
| `qa/performance/lib/thresholds.js` | fuente única de budgets; se le suma `cart_write` |
| `qa/e2e/playwright.config.ts` · `playwright.a11y.config.ts` | los dos runners ya configurados |
| `qa/exploratory/charters.md` | se le agrega un apéndice; no se reescribe lo anterior |
| scripts de `qa/package.json` | `test:acceptance`, `test:e2e`, `test:a11y`, `test:load` |

### Se agrega (dueño: este change)

| Archivo | Qué hace |
|---|---|
| `qa/support/seed-carrito.ts` | **hermano** de `seed-categorias.ts`, no una extensión (justificación en `design.md`). Siembra por API admin real: un producto con **stock 3** (tope de AC-5 e invariante de AC-8), dos publicados para el carrito mixto, uno para despublicar en vuelo, uno para cambiarle el precio, un `draft` y un `archivado`. Idempotente entre corridas por el prefijo de `builders`. |
| `qa/support/seed-carrito.smoke.ts` | smoke del seed, como los tres que ya existen |
| `qa/support/cart-client.ts` | un invitado = un `APIRequestContext`; deriva `X-CSRF-Token` de la cookie legible `dsm_cart_csrf` y fija `Origin`; expone «cerrar y volver» vía `storageState()` |
| `qa/acceptance/features/carrito.feature` | los 12 escenarios de §4, tag `@carrito` |
| `qa/acceptance/steps/carrito.steps.ts` | steps del carrito; reusa los steps de siembra que ya existen |
| `qa/performance/cart-write.js` | escenario L-1 |

## 8. Estrategia de datos de test

- **Sólo datos sintéticos**, sembrados por la **API real** respetando la máquina de
  estados (`draft → published → archived`) — nunca `INSERT` directo:
  `qa-backend-standards.md` §15, y el mismo criterio que el seed de US-002.
- **Stock exacto y conocido** por producto: la invariante de AC-8 y el tope de AC-5 no se
  pueden asertar contra un stock «alguno».
- **Defaults deterministas**; el único valor no determinista es el prefijo de corrida del
  SKU, que nunca se asserta (`testing-standards.md` §5).
- **Idempotencia entre corridas**: prefijo único por corrida, así el residuo de la corrida
  anterior no colisiona ni contamina.
- **Aislamiento entre invitados**: un `APIRequestContext` por invitado. Ningún escenario
  depende del carrito que dejó otro.

## 9. Quality gates

| Gate | Cuándo | Bloquea |
|---|---|---|
| Aceptación API-level (TC-701…TC-712) | PR y nightly | sí |
| E2E de navegador del carrito (TC-720…TC-725) | PR y nightly, **desde que exista el FE** | sí (cuando aplique) |
| a11y 0 violaciones AA + teclado + anuncio de total | pre-release, **desde que exista el FE** | sí (cuando aplique) |
| Carga de escritura p95 < 500 ms (TC-740) | pre-release | sí, con la salvedad de OQ-QA-2 |
| Charters exploratorios | pre-release | no (informan) |

## 10. Anti-patrones evitados a propósito

- ❌ **Duplicar un escenario en L1 y L3** (`qa-three-layer-regression` §Anti-patterns): no
  se re-autora CSRF, rate-limit, `no-store`, atributos de cookie, purga ni idempotencia —
  el backend los cubre. Cada escenario de §4 declara qué agrega sobre la capa dev.
- ❌ **Autorar capas dev-owned** (`qa-backend-standards.md` §2.1): cero stubs de unit,
  integration o contract en este plan.
- ❌ **Un k6 sin umbral atado a un NFR** (`k6-load-scaffolding`): L-1 lo toma del PRD §4;
  L-2 **no se emite** por no tener número ratificado, en vez de inventarlo.
- ❌ **Un test de AC-8 que no distinga la reserva**: la versión de un invitado pasa igual
  con reserva implementada; por eso son tres y la aserción va contra el panel del dueño.
- ❌ **Esperas fijas** (`playwright-stability`, `flakiness-detection` señal 1): ninguna
  `waitForTimeout`; el carrito es `no-store` así que no hay carrera de caché, y en la
  fase de navegador se usa `expect.poll` re-navegando.
- ❌ **Escenarios sin ejecutar disfrazados de ejecutables**: los 9 bloqueados llevan
  `blocked_by` explícito y no cuentan como cobertura verde.
- ❌ **Fixtures compartidas mutables entre suites**: seed hermano, no extensión del de
  US-002.
- ❌ **Pasar el token del carrito a mano entre requests**: probaría que el servidor acepta
  un token, no que el invitado conserva su carrito.

## 11. Standards consultados

`testing-standards.md` (§2 pirámide, §5 datos, §14 patrones, §14.9 negative-space, §18
anti-patterns) · `qa-backend-standards.md` (§2.1 ownership, §13 performance, §15 datos) ·
`qa-frontend-standards.md` (§19 accesibilidad, §23 Playwright, §24 BDD web) ·
`performance-standards.md` (§7 diseño del load test, §8 budgets en CI) ·
`base-standards.md` (§1 KISS) · skills `qa-three-layer-regression`,
`bdd-scenario-quality`, `playwright-stability`, `k6-load-scaffolding`,
`flakiness-detection`, `nfr-quantification`.

## 12. Open questions

Las cuatro están desarrolladas con opciones y recomendación en `design.md`
§Decisiones abiertas. Resumen:

- **OQ-QA-1** `[Resolved: 2026-08-22 — opción (b): no se emite el stub; se mide sin umbral dentro de L-1]` Ratificado por el usuario. Un umbral inventado que pasa da falsa sensación de cobertura; el dato queda disponible para el día que el Arquitecto firme el número. — presupuesto de latencia de `GET /v1/cart`: no hay número ratificado ⇒ el
  stub L-2 **no se emite**. Recomendación: medir sin umbral dentro de L-1 hasta que el
  Arquitecto firme.
- **OQ-QA-2** `[Resolved: 2026-08-22 — opción (a): elevar CART_WRITE_RATE_LIMIT_MAX sólo en el entorno de carga]` Ratificado por el usuario, con la condición declarada en el reporte para que el p95 se lea sabiendo en qué condiciones se obtuvo. El script aborta ante un 429 en vez de reportar un p95 falso. — cómo se corre L-1 contra 30 escrituras/min/IP. Recomendación: elevar
  `CART_WRITE_RATE_LIMIT_MAX` sólo en el entorno de carga y declararlo en el reporte.
- **OQ-QA-3** `[Resolved: 2026-08-22 — opción (a): se cierra con la señal verificada]` Ratificado por el usuario. El carrito emite `has_blocking_issues` y eso se prueba acá; impedir el avance al pago lo ejecuta US-008 cuando exista — cobertura parcial declarada, no silenciosa. — AC-6 se cierra con la señal verificada, anotando que el bloqueo del pago
  lo cubre US-008. Recomendación: cerrarlo así.
- **OQ-QA-4** `[Resolved: 2026-08-22 — opción (a): no se re-testea; el charter TC-751 cubre el costo declarado]` Ratificado por el usuario. El vencimiento ya lo cubren los tests del backend, que sí pueden manipular el reloj; acá se verifica la supervivencia entre visitas. — la ventana de 7 días no es observable de punta a punta sin manipular
  `carts.expires_at`. Recomendación: no re-testear (dev ya lo cubre) y cubrir el costo con
  el charter TC-751.
