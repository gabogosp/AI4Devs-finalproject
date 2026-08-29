# QA Plan — US-006 Importación masiva de inventario

> **Ticket**: US-006 — Importación masiva de inventario (CSV/Excel)
> **Autor**: qa-engineer (asistido por @gosp) · **Fecha**: 2026-08-23 · **Estado**: Proposed
> **Plataformas**: backend (`@dsm/api`) + web (panel admin y storefront)
> **Tier**: **2 pragmático**, con AC-8 y AC-11 tratadas como **Tier 1** (OQ-QA-1; no hay
> `service-catalog.yaml` en el repo, así que el supuesto queda declarado acá)
> **Alcance**: capas **owned-by-QA** (L3 cross-stack, aceptación BDD, a11y, throughput,
> exploratorio). Las dev-owned (unit / component / integration / e2e-nest) son la TDD de los
> devs, ya existen y **no se re-autoran** (`qa-backend-standards.md` §2.1)
> **Numeración**: `TC-6NN` — el paquete `@dsm/qa` es compartido (US-001 `TC-0NN`, US-002
> `TC-2NN`, US-003 `TC-3NN`, US-007 `TC-7NN`)
> **Ejecutable hoy**: **los 24 casos**. Backend 35/35 y frontend-web 13/13 están cerrados, la
> API responde en `:3000` y el panel construye; no hay nada bloqueado por otra disciplina
> **Companion**: `proposal.md`, `design.md`, `tasks.md`

## 1. Perfil de riesgo

US-006 es la puerta de escritura **masiva** al catálogo: un solo archivo toca miles de
productos, precios y stock. El radio de explosión no es la pantalla del import, es el
catálogo entero y lo que el cliente ve en el storefront.

| Riesgo | Por qué importa acá |
|---|---|
| **Precio viejo servido después de un ajuste masivo** | AC-4 + el handoff OQ-10. El backend no tiene canal hacia el renderizado de Next: el panel llama a `revalidateCatalogSafely()` al ver `completed`. El test del FE prueba que **llama**; que el storefront **muestre** el precio nuevo cruza browser, web, API y caché, y ninguna suite de un módulo compara las dos superficies. Es plata (§4.4, TC-619) |
| **El multipart que sólo existe en un navegador** | El plan del FE declaró el límite: en jsdom el cuerpo de un `FormData` no se puede leer, así que el test asserta el encabezado. Es exactamente la costura donde el `content-type: application/json` forzado por el mutator ya rompió este flujo una vez (TC-617) |
| **Una importación que publica sin que nadie revise** | AC-9. 5.000 productos sin revisar visibles en el storefront es peor que no importar. Negative space: nada se pone rojo solo si un día el import empieza a publicar (TC-616) |
| **Duplicación del catálogo** | AC-10. La reconciliación es por SKU; si se rompe, el segundo import del mes duplica todo y el dueño lo descubre por el storefront (TC-615) |
| **Superficie de escritura abierta** | AC-8, tratada como Tier 1: `POST /v1/admin/imports` es la superficie de escritura más nueva del producto y acepta un archivo. Un `403` mal cableado es un desconocido cargando el catálogo (TC-614) |
| **Anti-DoS** | AC-11, Tier 1: 4 MiB, 5.000 filas, 32 MiB de expansión y 3 imports/hora/IP. El rechazo tiene que ocurrir **antes** de procesar; si ocurre después, el límite no protege nada (TC-612, TC-613) |
| **Un catálogo con mojibake** | Un archivo Latin-1 decodificado con reemplazos deja «Refrigeraci\ufffdn» en la base, y el error lo descubre el cliente en el storefront, no el dueño al importar (TC-611) |
| **La descarga que nadie bajó de verdad** | El reporte se materializa desde un `Blob` porque el Bearer vive en memoria. Que el navegador baje el archivo con el nombre del `Content-Disposition` es una afirmación que hoy no existe (TC-618) |
| **Un archivo grande que come el proceso** | El runner corre **dentro del API** (ADR-0012, sin Redis): un import de 5.000 filas que bloquee el event loop degrada el storefront de los clientes mientras el dueño importa (TC-622) |

**Journeys críticos**: (1) el dueño carga el catálogo por primera vez desde un archivo;
(2) el dueño ajusta precios por inflación y el storefront lo refleja; (3) el dueño corrige
un archivo con errores usando el reporte de rechazos.

## 2. Mapeo de la pirámide (capas QA en negrita)

| Capa | Dueño | ¿Acá? | Estado / herramienta |
|---|---|---|---|
| Unit | dev | ❌ nota de cobertura | `@dsm/api`: `row-schema`, `read-rows`, `import-errors`, `category-resolver`, `batch-slug-allocator`. `@dsm/web`: `importErrorCopy`, `importsService` |
| Component | dev | ❌ nota de cobertura | `@dsm/web`: `ImportUpload`, `ImportProgress`, `ImportErrorsTable`, `ImportResult`, `ImportScreen` (RTL + MSW) |
| Integration | dev | ❌ nota de cobertura | `@dsm/api`: `imports.service.spec.ts`, `import-runner.spec.ts`, `products.repository.spec.ts` |
| e2e-nest (supertest) | dev | ❌ nota de cobertura | `e2e-imports-acceptance.spec.ts`, `e2e-imports-report.spec.ts` |
| **Aceptación BDD (API-level, L3)** | **QA** | ✅ 16 casos | Cucumber + `# language: es` |
| **E2E de navegador (L3 cross-stack)** | **QA** | ✅ 4 casos | Playwright |
| **Accesibilidad** | **QA** | ✅ 1 caso | Playwright + `@axe-core/playwright` |
| **Throughput / NFR** | **QA** | ✅ 1 caso | script `tsx` con presupuesto (sin k6 — OQ-QA-3) |
| **Regresión (3 capas)** | **QA** | ✅ gate | las suites de US-001/002/003 que el import puede romper (§11) |
| Regresión visual | QA | ❌ | OQ-QA-4: no hay baseline del panel; abrirlo acá es deuda sin dueño |
| **Exploratorio** | **QA** | ✅ 2 charters | `qa/exploratory/charters.md` |

> **Nota de cobertura dev-owned** (obligatoria, no es una omisión): las 11 AC ya tienen
> cobertura L1/L2 escrita por los devs vía TDD — 1.277 tests en `@dsm/api` y 648 en
> `@dsm/web`. Este plan **no** las repite: agrega las capas que ninguna de las dos puede
> ver, que son las que cruzan procesos.

## 3. Matriz de trazabilidad: AC × capa

| AC | Qué exige | L1/L2 (dev, existente) | **Aceptación (QA)** | **Navegador / a11y / NFR (QA)** |
|---|---|---|---|---|
| AC-1 alta + actualización por SKU | crear nuevos, actualizar existentes | `imports.service.spec`, `products.repository.spec` | **TC-601** | **TC-617** |
| AC-2 categoría auto-creada | normalizada, sin duplicar rubros | `category-resolver.spec` | **TC-602** | — |
| AC-3 encola enriquecimiento | los SKUs nuevos/cambiados quedan pendientes | `imports.service.spec` | **TC-605** | — |
| AC-4 ajuste masivo de precios | precios en ARS, sin duplicar | `imports.service.spec` | **TC-603** | **TC-619** (la costura de revalidación) |
| AC-5 válidas sí, inválidas reportadas | reporte con motivo por fila | `row-schema.spec`, `e2e-imports-report.spec` | **TC-606**, **TC-607**, **TC-608** | **TC-618** (la descarga real) |
| AC-6 archivo inválido rechazado entero | mensaje claro, catálogo intacto | `read-rows.spec`, `detect-format.spec` | **TC-609**, **TC-610**, **TC-611** | — |
| AC-7 asíncrono con progreso | 202 + progreso + reporte | `import-runner.spec`, `useImportJob.test` | **TC-604** | **TC-617**, **TC-620**, **TC-621**, **TC-622** |
| AC-8 sólo admin | 401/403 y nada procesado | `e2e-imports-acceptance.spec` | **TC-614** | — |
| AC-9 el nuevo no se publica | queda `draft`, invisible en el storefront | `imports.service.spec`, `ImportResult.test` | **TC-616** | — |
| AC-10 re-importar no duplica | idempotencia por SKU | `imports.service.spec` | **TC-615** | — |
| AC-11 límite de tamaño/filas | rechazo **antes** de procesar | `import-file.interceptor.spec`, `import-schema.spec` | **TC-612**, **TC-613** | **TC-622** |

Los 24 ids citados están definidos en §4 (TC-601..TC-616), §5 (TC-617..TC-620), §6 (TC-621),
§7 (TC-622) y §8 (TC-623, TC-624). Sin ids huérfanos (F47).

## 4. Escenarios de aceptación (Cucumber, API-level)

`qa/acceptance/features/importar.feature`, con `# language: es` y los steps en
`qa/acceptance/steps/importar.steps.ts`. Tono imperativo y declarativo, sin filtración de
implementación (`bdd-scenario-quality`): ningún paso menciona tablas ni endpoints.

### 4.1 Happy path

- **H-1 · TC-601** — un archivo válido crea los SKUs nuevos y actualiza los existentes.
- **H-2 · TC-602** — una categoría que no existe se crea una sola vez, con cualquier grafía.
- **H-3 · TC-603** — el archivo de ajuste de precios cambia sólo el precio.
- **H-4 · TC-604** — la subida responde de inmediato y el progreso avanza hasta terminar.
- **H-5 · TC-605** — quedan pendientes de enriquecimiento sólo los que lo necesitan.

```gherkin
# language: es
@importar
Característica: Importación masiva de inventario (US-006)
  Como dueño del negocio
  quiero cargar y actualizar miles de SKUs desde un archivo
  para mantener el catálogo real sin hacerlo a mano

  Antecedentes:
    Dado el dueño autenticado en el panel

  @happy @critical-path
  Escenario: H-1 · TC-601 — Un archivo válido crea los SKUs nuevos y actualiza los existentes
    Dado un producto ya cargado con el SKU "REF-EXISTE" a $1000
    Y un archivo con ese SKU a $1500 y con dos SKUs que no existen
    Cuando el dueño importa el archivo
    Entonces la importación termina informando 2 productos creados y 1 actualizado
    Y el producto "REF-EXISTE" queda a $1500
    Y los dos SKUs nuevos existen en el catálogo con su nombre, precio y stock

  @happy
  Escenario: H-2 · TC-602 — Una categoría que no existe se crea una sola vez, sin importar cómo se escriba
    Dado que no existe la categoría "Plomería"
    Y un archivo con tres filas que la nombran "Plomería", "plomeria" y "PLOMERÍA"
    Cuando el dueño importa el archivo
    Entonces la importación termina informando 1 categoría creada
    Y los tres productos quedan en la misma categoría

  @happy @critical-path
  Escenario: H-3 · TC-603 — El archivo de ajuste de precios cambia sólo el precio
    Dado dos productos cargados con nombre, stock y categoría conocidos
    Y un archivo con sus SKUs y sus precios nuevos, con las demás celdas vacías
    Cuando el dueño importa el archivo
    Entonces los dos productos quedan con el precio nuevo
    Y conservan su nombre, su stock y su categoría
    Y no se crea ningún producto

  @happy
  Escenario: H-4 · TC-604 — La subida responde de inmediato y el progreso avanza hasta terminar
    Dado un archivo con 5000 filas válidas
    Cuando el dueño sube el archivo
    Entonces recibe de inmediato el identificador del trabajo sin esperar el procesamiento
    Y mientras el trabajo corre, la cantidad de filas procesadas nunca decrece
    Y al terminar, las filas procesadas igualan el total del archivo

  @happy
  Escenario: H-5 · TC-605 — El import deja pendientes de enriquecimiento sólo los que lo necesitan
    Dado un producto ya enriquecido con el SKU "REF-RICO"
    Y un archivo que a "REF-RICO" le cambia sólo el precio y trae además un SKU nuevo
    Cuando el dueño importa el archivo
    Entonces el SKU nuevo queda pendiente de enriquecimiento
    Y "REF-RICO" sigue enriquecido
```

> **TC-605 y OQ-QA-2**: se prueba la **costura observable** —el marcado de pendientes— y no
> el enriquecimiento en sí, que pertenece a US-005 y hoy no tiene clave del proveedor
> cargada. La segunda mitad del escenario es negative-space dentro de un happy: re-enriquecer
> un producto al que sólo le movieron el precio es pagarle al proveedor de IA dos veces por
> el mismo resultado.

### 4.2 Corner cases

- **C-1 · TC-606** — las filas buenas entran y las malas se reportan con su motivo.
- **C-2 · TC-607** — el reporte descargable trae una línea por fila rechazada.
- **C-3 · TC-608** — sin rechazos, el reporte existe y está vacío.
- **C-4 · TC-609** — falta una columna requerida: se rechaza el archivo entero.
- **C-5 · TC-610** — un formato no soportado se rechaza sin tocar el catálogo.
- **C-6 · TC-611** — un archivo que no está en UTF-8 se rechaza en vez de importarse mal.

```gherkin
  @corner @critical-path
  Escenario: C-1 · TC-606 — Las filas buenas entran y las malas se reportan con su motivo
    Dado un archivo con 3 filas válidas y 4 con errores distintos
    Cuando el dueño importa el archivo
    Entonces los 3 productos válidos quedan en el catálogo
    Y la importación informa 4 filas rechazadas
    Y cada rechazo indica su número de fila y el motivo por el que se rechazó
    Y ninguna fila rechazada dejó un producto a medio crear

  @corner
  Escenario: C-2 · TC-607 — El reporte descargable trae una línea por fila rechazada
    Dado un archivo con 2 filas válidas y 2 con errores
    Cuando el dueño importa el archivo y descarga el reporte
    Entonces el reporte viene como archivo adjunto con un nombre que identifica la importación
    Y tiene una línea por cada fila rechazada, con su número de fila, su SKU y su motivo

  @corner
  Escenario: C-3 · TC-608 — Sin rechazos, el reporte existe y está vacío
    Dado un archivo con todas sus filas válidas
    Cuando el dueño importa el archivo y descarga el reporte
    Entonces el reporte tiene solamente el encabezado
    Y la descarga no falla

  @corner @critical-path
  Escenario: C-4 · TC-609 — Falta una columna requerida: se rechaza el archivo entero
    Dado un archivo sin la columna de precio
    Cuando el dueño lo sube
    Entonces el sistema lo rechaza informando qué columna falta
    Y el catálogo queda exactamente como estaba

  @corner
  Escenario: C-5 · TC-610 — Un formato que no se soporta se rechaza sin tocar el catálogo
    Dado un archivo que no es ni CSV ni Excel
    Cuando el dueño lo sube
    Entonces el sistema lo rechaza indicando que el formato no está soportado
    Y el catálogo queda exactamente como estaba

  @corner
  Escenario: C-6 · TC-611 — Un archivo que no está en UTF-8 se rechaza en vez de importarse mal
    Dado un archivo con acentos guardado en una codificación distinta de UTF-8
    Cuando el dueño lo sube
    Entonces el sistema lo rechaza pidiendo que lo guarde en UTF-8
    Y no queda ningún producto con caracteres corruptos en el catálogo
```

> **TC-611** es el que protege al cliente final: un catálogo con «Refrigeraci\ufffdn» adentro
> es peor que un import que falla, porque el error se descubre en el storefront.

### 4.3 Negative space

- **N-1 · TC-612** — un archivo con más filas que el tope se rechaza antes de procesar.
- **N-2 · TC-613** — el tamaño y la frecuencia tienen tope, y el tope se avisa.
- **N-3 · TC-614** — sin sesión de administrador no se importa nada.
- **N-4 · TC-615** — importar dos veces el mismo archivo no duplica nada.
- **N-5 · TC-616** — un producto importado no se publica solo.

```gherkin
  @negative @critical-path
  Escenario: N-1 · TC-612 — Un archivo con más filas que el tope se rechaza antes de procesar
    Dado un archivo con una fila más que el tope permitido
    Cuando el dueño lo sube
    Entonces el sistema lo rechaza por exceder el límite de filas
    Y no se creó ni actualizó ningún producto
    Y no quedó ningún trabajo de importación corriendo

  @negative @critical-path
  Escenario: N-2 · TC-613 — El tamaño y la frecuencia tienen tope, y el tope se avisa
    Dado un archivo más grande que el tamaño permitido
    Cuando el dueño lo sube
    Entonces el sistema lo rechaza por tamaño sin haber leído su contenido
    Y cuando el dueño supera la cantidad de importaciones permitidas por hora
    Entonces el sistema le indica cuánto tiene que esperar

  @negative @critical-path
  Escenario: N-3 · TC-614 — Sin sesión de administrador no se importa nada
    Dado un visitante sin sesión de administrador
    Cuando intenta subir un archivo de importación
    Entonces el sistema le deniega el acceso
    Y cuando lo intenta con una sesión de cliente registrado
    Entonces el sistema también le deniega el acceso
    Y no se creó ningún trabajo de importación en ninguno de los dos intentos

  @negative @critical-path
  Escenario: N-4 · TC-615 — Importar dos veces el mismo archivo no duplica nada
    Dado un archivo con 3 SKUs nuevos
    Cuando el dueño lo importa dos veces
    Entonces existe exactamente un producto por cada SKU del archivo
    Y la segunda importación informa 0 creados y 3 actualizados

  @negative @critical-path
  Escenario: N-5 · TC-616 — Un producto importado no se publica solo
    Dado un archivo con un SKU que no existe en el catálogo
    Cuando el dueño lo importa
    Entonces el producto nuevo queda en borrador
    Y no aparece en el catálogo público del storefront
    Y sigue en borrador después de una segunda importación del mismo archivo
```

> **TC-614** afirma tres cosas y la tercera es la que nadie escribe: que **no se creó
> ningún trabajo**. Un `403` que igual persiste el trabajo y guarda el archivo es un `403`
> que no protegió nada.

## 5. E2E de navegador (Playwright) — las cuatro costuras

`qa/e2e/importar.spec.ts`. Sólo lo que un proceso aparte no puede ver
(`qa-frontend-standards.md` §23). Login admin por `/admin/acceso`, el patrón que ya usa
`a11y.spec.ts`.

- **E-1 · TC-617 — `Import_SubidaRealEnNavegador_MuestraProgresoYResultado`** (AC-1, AC-7).
  Se elige un archivo de verdad con `setInputFiles` (multipart armado por el browser, no por
  jsdom), se ve el estado en curso, y al terminar los cinco contadores del contrato y el
  aviso de borrador con su link al listado. Es la costura donde el mutator ya rompió este
  flujo una vez al forzar `content-type: application/json` sobre un `FormData`.
- **E-2 · TC-618 — `Reporte_DescargaDesdeElNavegador_TraeElArchivoConElNombreDelServidor`** (AC-5).
  `page.waitForEvent('download')`, se afirma `suggestedFilename()` contra el
  `Content-Disposition` del servidor y que el contenido tiene la fila rechazada. Ejerce lo
  que jsdom sólo puede espiar: que un `Blob` + object URL con Bearer en memoria produce una
  descarga real.
- **E-3 · TC-619 — `Storefront_TrasAjusteMasivoDePrecios_SirveElPrecioNuevo`** (AC-4, **el caso de
  mayor valor**). Se siembra un producto publicado, se lee su ficha pública, se importa el
  ajuste, se espera `completed` y se **vuelve a leer la ficha servida** con `request.get()`
  —contexto de red aparte, sobre el HTML del servidor, como `pdp-ssr-seo.spec.ts`— para
  verificar el precio nuevo. Si `revalidateCatalogSafely()` se desconectara, este test es el
  único que se pone rojo.
- **E-4 · TC-620 — `DeepLink_RefrescarDuranteElProceso_NoPierdeElTrabajo`** (AC-7).
  Con un archivo de 5.000 filas: refrescar en medio del proceso vuelve a la misma pantalla
  siguiendo el mismo trabajo; y un id inventado dice que no existe o se purgó, con salida
  para empezar de nuevo. Sin listado de imports (diferido a US-016), la URL es el único hilo
  que sobrevive a un refresh.

## 6. Accesibilidad

`qa/e2e/importar-a11y.spec.ts` con `@axe-core/playwright`, config `playwright.a11y.config.ts`
(WCAG 2.1 AA, el nivel que el PRD §1.3 fija).

- **A-1 · TC-621 — `Importar_TresEstadosDeLaPantalla_SinViolacionesDeAxe`** (AC-7).
  Axe en los tres estados, porque cada uno tiene su propia superficie de fallo: el
  **selector** (input de archivo + su etiqueta), el **progreso** (barra con
  `aria-valuenow`/indeterminada + región viva) y el **resultado** (tabla de rechazos con
  encabezados y paginación). Además, dos afirmaciones que axe no hace: que el avance se
  anuncia en una región viva y que el foco va al encabezado del resumen al terminar — sin
  eso, quien usa lector de pantalla no se entera de que el trabajo terminó.

## 7. Presupuesto de throughput (NFR, sin k6 — OQ-QA-3)

`qa/performance/import-throughput.ts`, ejecutado con `tsx`.

- **P-1 · TC-622 — `Import5000Filas_DentroDelPresupuesto_YLaApiSigueRespondiendo`** (AC-7, AC-11).
  Sube un archivo de 5.000 filas (el tope del contrato, que es también el catálogo objetivo
  del proyecto) y mide dos cosas:

  | Métrica | Presupuesto | Por qué ese número |
  |---|---|---|
  | Tiempo hasta `completed` | **≤ 180 s** | 5.000 filas en lotes de 200 = 25 lotes; el dueño importa una vez por día y espera mirando la pantalla, pero más de 3 minutos sin señal se lee como «se colgó». El progreso visible es lo que compra la paciencia |
  | p95 de `GET /v1/categories` **mientras** el import corre | **≤ 400 ms** | El runner vive **dentro** del proceso del API (ADR-0012, sin Redis): el riesgo real es que el import del dueño degrade el storefront de los clientes. Es el mismo umbral que usa la baseline de `qa/performance` |
  | Filas escritas al terminar | **= 5.000** | Un throughput bueno con filas perdidas no es throughput |

  Sin k6 a propósito: la concurrencia de usuarios no es el riesgo (hay un único dueño) y el
  rate-limit de 3/hora/IP hace que un test de concurrencia mida el rate-limit, no el import.

## 8. Exploratorio (`execution_mode: manual`)

Se **agregan** a `qa/exploratory/charters.md`, sin reescribir los de US-001.

- **X-1 · TC-623 — Excel del mundo real.** *Misión*: descubrir con qué archivos reales se rompe el
  parser. *Áreas*: exports de LibreOffice, Google Sheets y Excel de Windows; números
  guardados como texto; celdas con formato de moneda («$ 1.234,56»); filas vacías al final;
  varias hojas; encabezados con espacios o mayúsculas. *Riesgos*: el separador de miles
  ambiguo (el contrato lo **rechaza** a propósito, y el dueño va a chocar con eso); una hoja
  equivocada leída en silencio. *Por qué manual*: el espacio de variantes que produce una
  planilla real no se enumera, se explora.
- **X-2 · TC-624 — Ciclo de vida del trabajo.** *Misión*: ejercer el runbook de `apps/api/README.md`.
  *Áreas*: matar la API a mitad de un import (queda `running` → el barrido de arranque lo
  marca `interrupted`); volver a subir el mismo archivo después; `409 already-running`;
  un trabajo de más de 90 días (purga). *Riesgos*: que el `interrupted` deje el catálogo a
  medias sin que el mensaje lo diga; que el reintento duplique. *Por qué manual*: requiere
  matar procesos y manipular el reloj de la retención.

## 9. Test cases owned-by-QA

```yaml
- id: TC-601
  scenario: H-1
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber
  gherkin_scenario: "TC-601 — archivo válido: altas y actualizaciones"
  name: Import_ArchivoValido_CreaLosNuevosYActualizaLosExistentesPorSku

- id: TC-602
  scenario: H-2
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber
  gherkin_scenario: "TC-602 — categoría auto-creada y normalizada"
  name: Import_CategoriaInexistenteEnTresGrafias_CreaUnSoloRubro

- id: TC-603
  scenario: H-3
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber
  gherkin_scenario: "TC-603 — archivo de ajuste de precios"
  name: Import_SoloPrecios_ActualizaElPrecioYConservaElResto

- id: TC-604
  scenario: H-4
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber
  gherkin_scenario: "TC-604 — 202 inmediato y progreso monótono"
  name: Import_ArchivoGrande_RespondeSinProcesarYElProgresoNuncaDecrece

- id: TC-605
  scenario: H-5
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber
  gherkin_scenario: "TC-605 — pendientes de enriquecimiento"
  name: Import_SoloCambioDePrecio_NoReabreElEnriquecimientoDelProducto

- id: TC-606
  scenario: C-1
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber
  gherkin_scenario: "TC-606 — válidas sí, inválidas reportadas"
  name: Import_ArchivoMixto_ImportaLasValidasYReportaFilaYMotivoDeCadaRechazo

- id: TC-607
  scenario: C-2
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber
  gherkin_scenario: "TC-607 — el CSV del reporte"
  name: Reporte_ConRechazos_TraeAdjuntoUnaLineaPorFilaConSuMotivo

- id: TC-608
  scenario: C-3
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber
  gherkin_scenario: "TC-608 — reporte sin rechazos"
  name: Reporte_SinRechazos_DevuelveSoloElEncabezadoYNoFalla

- id: TC-609
  scenario: C-4
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber
  gherkin_scenario: "TC-609 — falta una columna requerida"
  name: Import_SinColumnaRequerida_RechazaElArchivoEnteroYNoTocaElCatalogo

- id: TC-610
  scenario: C-5
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber
  gherkin_scenario: "TC-610 — formato no soportado"
  name: Import_FormatoNoSoportado_RechazaYDejaElCatalogoIntacto

- id: TC-611
  scenario: C-6
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber
  gherkin_scenario: "TC-611 — codificación distinta de UTF-8"
  name: Import_ArchivoNoUtf8_RechazaEnVezDeGuardarCaracteresCorruptos

- id: TC-612
  scenario: N-1
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber
  gherkin_scenario: "TC-612 — tope de filas"
  name: Import_UnaFilaSobreElTope_RechazaAntesDeProcesarYNoEscribeNada

- id: TC-613
  scenario: N-2
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber
  gherkin_scenario: "TC-613 — tope de tamaño y de frecuencia"
  name: Import_SobreElTamanioOLaFrecuencia_RechazaYDiceCuantoEsperar

- id: TC-614
  scenario: N-3
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber
  gherkin_scenario: "TC-614 — sólo admin"
  name: Import_SinAdmin_DeniegaYNoCreaNingunTrabajo

- id: TC-615
  scenario: N-4
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber
  gherkin_scenario: "TC-615 — idempotencia por SKU"
  name: Import_MismoArchivoDosVeces_UnSoloProductoPorSkuYCeroCreados

- id: TC-616
  scenario: N-5
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber
  gherkin_scenario: "TC-616 — el nuevo no se publica solo"
  name: Import_SkuNuevo_QuedaEnBorradorYNoAparaceEnElStorefront

- id: TC-617
  scenario: E-1
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: "TC-617 — subida real en navegador"
  name: Import_SubidaRealEnNavegador_MuestraProgresoYResultado

- id: TC-618
  scenario: E-2
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: "TC-618 — descarga real del reporte"
  name: Reporte_DescargaDesdeElNavegador_TraeElArchivoConElNombreDelServidor

- id: TC-619
  scenario: E-3
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: "TC-619 — la costura de revalidación"
  name: Storefront_TrasAjusteMasivoDePrecios_SirveElPrecioNuevo

- id: TC-620
  scenario: E-4
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: "TC-620 — deep-link y refresh"
  name: DeepLink_RefrescarDuranteElProceso_NoPierdeElTrabajo

- id: TC-621
  scenario: A-1
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright+axe
  gherkin_scenario: "TC-621 — a11y de los tres estados"
  name: Importar_TresEstadosDeLaPantalla_SinViolacionesDeAxe

- id: TC-622
  scenario: P-1
  execution_mode: automated
  test_layer: 3
  target_tooling: tsx (presupuesto NFR)
  gherkin_scenario: "TC-622 — throughput de 5.000 filas"
  name: Import5000Filas_DentroDelPresupuesto_YLaApiSigueRespondiendo

- id: TC-623
  scenario: X-1
  execution_mode: manual
  test_layer: 3
  target_tooling: charter exploratorio
  gherkin_scenario: "n/a — charter"
  name: Import_ExcelDelMundoReal_Charter

- id: TC-624
  scenario: X-2
  execution_mode: manual
  test_layer: 3
  target_tooling: charter exploratorio
  gherkin_scenario: "n/a — charter"
  name: Import_CicloDeVidaDelTrabajo_Charter
```

## 10. Infraestructura de test

### Nuevo

| Artefacto | Ruta | Qué hace |
|---|---|---|
| Generadores de archivos | `qa/support/import-files.ts` | Los 9 constructores de §2 del `design.md`; devuelven `Buffer`. El xlsx con `exceljs@4.4.0`, la misma versión que el parser |
| Cliente del import | `qa/support/import-client.ts` | `subirImport(token, buffer, filename)`, `esperarTrabajo(id, {timeoutMs})` con `expect.poll`, `bajarReporte(id)` |
| Seed del import | `qa/support/seed-import.ts` | Productos y categorías previas por API (nunca por SQL), con prefijo de corrida |

### Reutilizado (no se toca)

`qa/support/qa-env.ts` (URLs), `admin-auth.ts` (login real con fallback prohibido en CI),
`customer-auth.ts` (el token de cliente que TC-614 necesita para el `403`), `api.ts`
(`apiCall` que falla ruidoso), `builders.ts`, `qa/scripts/api-up.sh`.

### Custom assertions

- `esperarTrabajo()` **es** la assertion de espera: encapsula el `expect.poll` con el
  timeout por tamaño y falla con el `status` y el `error_code` del trabajo en el mensaje. Sin
  eso, cada test reimplementaría su propia espera y la primera que use
  `waitForTimeout` haría flakear la suite entera.

## 11. Estrategia de datos

- **Sintéticos y deterministas**: sin `Math.random()` ni `Date.now()` en el contenido de los
  archivos. El prefijo de SKU por corrida (`QA6-{ts}-{n}`) es lo único que depende del reloj
  y nada se assertea sobre él.
- **Sembrado por API**, nunca por SQL: escribir con Prisma saltearía las reglas de negocio y
  los tests pasarían contra estados que la aplicación no puede producir.
- **Sin limpieza destructiva**: cada corrida usa su prefijo. Es lo que hacen las otras
  suites y permite investigar un fallo mirando la base después.
- **Regresión de lo que el import puede romper** (3 capas): las suites de US-001 (catálogo
  admin), US-002 (browse) y US-003 (ficha) tienen que seguir verdes, porque el import escribe
  en las mismas tablas: `pnpm --filter @dsm/qa test:acceptance` completo, no sólo
  `@importar`.

## 12. Quality gates

| Gate | Bloquea | Cuándo |
|---|---|---|
| Aceptación `@importar` (16 casos) | merge del PR de esta US | cada push |
| E2E de navegador (4 casos) | promoción a UAT | pre-deploy + nightly |
| a11y (TC-621) | release | pre-release |
| Throughput (TC-622) | release | pre-release y ante cambios del runner |
| Aceptación **completa** (US-001/002/003/007 + importar) | release | pre-release |
| Charters (TC-623, TC-624) | no bloquean | una sesión antes del release |

## 13. Anti-patrones evitados a propósito

- ❌ **«QA re-escribe los tests del dev»** — las 11 AC ya tienen L1/L2; acá sólo L3, a11y y
  NFR, y las dev-owned quedan como nota de cobertura (§2).
- ❌ **E2E de navegador como suite principal** (`qa-frontend-standards.md` §23) — 16 de 24
  casos son afirmaciones sobre el catálogo y corren API-level; el navegador queda para sus
  cuatro costuras.
- ❌ **Esperas por tiempo** (`playwright-stability`) — nunca `waitForTimeout`: `expect.poll`
  por condición, con timeout explícito por tamaño de archivo.
- ❌ **Assertion débil «hubo un error»** (`testing-standards.md` §14.9) — se asserta el
  `error_code` **y** el número de fila, contra el catálogo cerrado de 10 códigos del contrato.
- ❌ **Test que pasa contra una costura rota** — `apiCall()` y `admin-auth` fallan ruidoso;
  `QA_AUTH_STRICT` prohíbe el fallback de auth en CI.
- ❌ **Fixture binario opaco** — el xlsx se genera con la librería que lo parsea; nada
  binario entra al repo.
- ❌ **Assertar `processed_rows` en vuelo** — es una carrera perdida contra el runner; se
  asserta monotonía y valor final.

## 14. Standards consultados

- `docs/base-standards.md` — principios y vocabulario.
- `docs/quality/testing-standards.md` §2, §4.1, §5, §14.2, §14.3, §14.9, §18.
- `docs/quality/qa-backend-standards.md` §2.1 (ownership), §21 (BDD).
- `docs/quality/qa-frontend-standards.md` §2.1, §19 (a11y), §23 (web), §24 (BDD).
- `docs/cross-cutting/performance-standards.md` §7, §8 — presupuesto sin k6 (OQ-QA-3).
- `docs/architecture/api-standards.md` — RFC 7807, que es la forma de todos los rechazos de
  archivo que este plan asserta.

## 15. Open questions

**Ninguna.** Las cinco que había (OQ-QA-1..OQ-QA-5) las cerró el PO el 2026-08-23 antes de
escribir el plan; están en `proposal.md`.

Dos cosas que **no** son open questions pero conviene tener a la vista:

- **El tope de 5.000 filas coincide con el catálogo objetivo del proyecto**, así que el
  presupuesto de TC-622 se mide exactamente en el borde. Cuando el catálogo crezca, el
  archivo hay que partirlo: es decisión consciente del PO (OQ-BE-3) y el charter TC-623
  probablemente lo haga visible desde la experiencia del dueño.
- **AC-3 queda cubierta a medias por diseño** (OQ-QA-2): el marcado de pendientes sí, el
  enriquecimiento real no. Cuando US-005 tenga `GEMINI_API_KEY` y su propio QA, ese plan
  cierra la otra mitad. Declarado, no escondido.

## 16. Referencias

- US: `docs/user-stories/US-006-import-masivo-inventario.md` (11 AC).
- Implementación: `openspec/changes/US-006-import-masivo-inventario-backend/` (35/35),
  `openspec/changes/US-006-import-masivo-inventario-frontend-web/` (13/13).
- Contrato: `apps/api/README.md` §Importación masiva de inventario; OpenAPI en
  `openspec/changes/US-006-import-masivo-inventario-backend/contracts/openapi/`.
- ADRs: ADR-0008 (stock como fuente de verdad), **ADR-0012** y **ADR-0014** (el trabajo
  asíncrono corre en proceso mientras no haya Redis — es la razón del presupuesto de TC-622).
- Suites hermanas: `US-001` (`TC-0NN`), `US-002` (`TC-2NN`), `US-003` (`TC-3NN`), `US-007`
  (`TC-7NN`).
