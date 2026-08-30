# US-006 QA — Diseño de la suite

> Decisiones de diseño de la suite owned-by-QA. El **qué se prueba** está en `qa-plan.md`;
> acá está el **cómo**, y sobre todo el por qué de las elecciones que después no se pueden
> revisar sin reescribir tests.

## 1. Las tres capas, y qué queda en cada una

Modelo canónico de `qa-three-layer-regression`:

| Capa | Quién | US-006 |
|---|---|---|
| **L1 backend-isolated** | dev (TDD) | 126 suites en `@dsm/api`, incluidas `imports.service.spec.ts`, `read-rows.spec.ts`, `row-schema.spec.ts`, `import-runner.spec.ts`, `e2e-imports-acceptance.spec.ts`, `e2e-imports-report.spec.ts`. **No se re-autoran.** |
| **L2 frontend-isolated** | dev (TDD) | 14 archivos en `@dsm/web` (`importsService`, `useImportJob`, `importErrorCopy`, `ImportUpload`, `ImportProgress`, `ImportErrorsTable`, `reportDownload`, `ImportResult`, `ImportScreen`, `ImportEntryLink`, `imports.events`). **No se re-autoran.** |
| **L3 cross-stack** | **QA** | Este change: aceptación contra la API arrancada de verdad + E2E de navegador + a11y + throughput. |

La aceptación BDD corre **API-level** y no por navegador. Motivo: 15 de los 23 casos son
afirmaciones sobre el **efecto en el catálogo** (se creó, se actualizó, no se duplicó, quedó
en borrador, la categoría se normalizó), y manejar un navegador para verificar una fila de
la base agrega cinco minutos de suite y una fuente de flakiness sin agregar una sola
afirmación. Al navegador se le reservan **los cuatro casos que sólo él puede ver**
(`qa-frontend-standards.md` §23: E2E para las costuras, no como reemplazo del resto).

## 2. Archivos de prueba: generadores, no fixtures

`qa/support/import-files.ts` expone constructores deterministas que devuelven `Buffer`:

```ts
csvValido({ filas: 3 })                  // altas limpias
csvMixto()                               // válidas + una por cada error_code que se pueda provocar
csvSinColumna('precio')                  // encabezado incompleto → 422 missing-columns
csvSoloPrecios(skus)                     // el archivo del "día 2": sku + precio, resto vacío
csvDuplicado('REF-1')                    // el mismo sku dos veces
csvFilas(5001)                           // un renglón por encima del tope
csvDeTamanio(4 * 1024 * 1024 + 1)        // un byte por encima del cap
csvLatin1()                              // "Refrigeración" en ISO-8859-1 → invalid-encoding
xlsxValido()                             // workbook REAL vía exceljs
```

Tres razones para generar en vez de commitear:

- **Nada binario en git.** Un `.xlsx` en el repo es opaco para el review: nadie ve en un
  diff que cambió una celda.
- **Un archivo de 4 MiB no debería vivir en un repo** que se clona en cada CI.
- **El xlsx se fabrica con `exceljs@4.4.0`, la misma versión que el parser del API.** Es el
  truco que ya usa `detect-format.spec.ts`. La versión se **pina igual** a propósito: si el
  escritor se adelanta al lector, el test empieza a probar el escritor.

Determinismo (`testing-standards.md` §5): sin `Date.now()` ni `Math.random()` en el
contenido. Los SKUs llevan un prefijo por corrida (`QA6-{corrida}-{n}`) que **sí** depende
del reloj, pero sólo para no colisionar con datos previos; nada se assertea sobre él.

## 3. La costura de la revalidación (el caso de mayor valor)

`TC-619` es el único test del proyecto que ejerce el handoff de OQ-10 de punta a punta:

1. sembrar un producto **publicado** con precio conocido y leer su ficha en el storefront;
2. importar un archivo que le cambia el precio;
3. esperar `completed` en el panel;
4. **volver a leer la ficha pública** y verificar que muestra el precio nuevo.

El paso 4 es el que nadie hace hoy. Detalle que decide si el test sirve o miente: la ficha
se sirve con `max-age=60`, así que la lectura tiene que ser **del servidor y sin caché de
navegador** (`page.reload()` con `Cache-Control: no-cache` no alcanza si Next sirvió una
página estática). Se lee con `request.get()` de Playwright —contexto de red aparte del
browser— y se afirma sobre el **HTML servido**, igual que ya hace `pdp-ssr-seo.spec.ts`.

Si `revalidateCatalogSafely()` no estuviera cableada, este test falla y ninguno de los otros
22 se entera. Por eso está marcado `@critical-path`.

## 4. Autorización (AC-8) como Tier 1

Tres afirmaciones, no una:

- **sin token** → `401` y **ningún trabajo creado** (se cuenta antes y después);
- **con token de cliente** (rol `customer`, no admin) → `403`;
- el `GET` de un trabajo **de otro** no filtra nada: hoy hay un único admin, así que se
  prueba lo que sí es verificable, que un id inexistente y uno ajeno se ven **iguales**
  (`404`), sin distinguir «no existe» de «no es tuyo».

La tercera es negative-space puro: nada se pone rojo solo si un día el `GET` empieza a
distinguir, y ese es justo el bug que filtra la existencia de trabajos ajenos.

## 5. El rate-limit de 3 imports/hora/IP administrado, no sufrido

Es el problema operativo de esta suite: **20 de los 23 casos hacen un `POST`**. Con el cap
en 3 por hora, la suite se autoenvenena a la cuarta corrida.

Decisión: la suite **exige** `IMPORT_RATE_LIMIT_PER_HOUR` elevado por entorno
(`qa/scripts/api-up.sh` ya arranca la API con `.env` de QA) y **prueba el límite en un caso
dedicado** (`TC-613`) que lo baja a 1 por su propia variable. Alternativas descartadas:

- **Dejar el cap en 3 y espaciar los tests**: una suite que tarda horas no se corre.
- **Allowlistear la IP de QA**: crea un camino de código que producción no tiene, y el
  límite quedaría sin probar en ningún lado.
- **Resetear el contador por API interna**: no existe endpoint y no se va a agregar uno
  para los tests.

Queda declarado en el pre-requisito P3 del `tasks.md`: si la variable no está, el caso
`TC-613` es el que falla — ruidoso, con el motivo en el mensaje — en vez de una cascada de
`429` inexplicables repartida por toda la suite.

## 6. Progreso asíncrono: cómo se espera sin flakear

El import corre en el proceso del API y publica progreso cada `IMPORT_BATCH_SIZE` (200
filas). Reglas de la suite (`playwright-stability`):

- **Nunca `waitForTimeout`.** Se espera por condición: `expect.poll` sobre el `GET` hasta
  `status ∈ {completed, failed}`, con timeout explícito por tamaño de archivo (5 s para los
  archivos de 3 filas, 90 s para el de 5.000).
- **Nunca assertear el valor exacto de `processed_rows` en vuelo.** Es una carrera perdida:
  el runner avanza mientras el test lee. Se asserta la **monotonía** (nunca decrece) y el
  valor final.
- El estado intermedio de la UI (`ImportProgress` visible) se verifica con un archivo de
  5.000 filas, el único que garantiza que hay un tramo `running` observable. Con 3 filas el
  trabajo puede terminar antes del primer poll, y un test que espera ver la barra ahí es
  flaky por diseño.

## 7. Datos: sembrar por API, nunca por SQL

Los seeds usan `apiCall()` de `qa/support/api.ts` (`POST /v1/admin/products`,
`/v1/admin/categories`), como los de US-001/002/003/007. Escribir directo con Prisma sería
más rápido y también inútil: saltearía las reglas de negocio y los tests pasarían contra
estados que la aplicación no puede producir.

Limpieza: cada corrida usa su prefijo de SKU; **no se borra nada**. Es lo que ya hacen las
otras suites y lo que permite investigar un fallo mirando la base después.

## 8. Anti-patrones que este diseño evita a propósito

| Anti-patrón | Dónde acechaba | Cómo se evita |
|---|---|---|
| «QA re-escribe los tests del dev» | Las 11 AC ya tienen cobertura L1/L2 | Ownership gate: acá sólo L3 + a11y + NFR; las otras se declaran como nota de cobertura |
| E2E de navegador como suite principal | 15 casos son afirmaciones sobre el catálogo | Aceptación API-level; el navegador queda para sus 4 costuras |
| Esperas por tiempo en un flujo asíncrono | Todo el progreso del import | `expect.poll` por condición, timeouts por tamaño |
| Assertion débil sobre «hubo error» | El reporte de 10 códigos | Se asserta el `error_code` **y** la `fila`, contra el catálogo cerrado del contrato |
| Test que pasa contra una costura rota | El seed y el login admin | `apiCall()` y `admin-auth` fallan ruidoso; `QA_AUTH_STRICT` prohíbe el fallback en CI |
| Fixture binario opaco | El caso Excel | Se genera con la misma librería que lo parsea |

## 9. Standards consultados

- `docs/quality/testing-standards.md` §2 (pirámide), §4.1 (naming), §5 (datos), §14.2/14.3
  (factories y builders), §14.9 (negative space), §18 (anti-patrones).
- `docs/quality/qa-backend-standards.md` §2.1 (ownership), §21 (BDD y Gherkin).
- `docs/quality/qa-frontend-standards.md` §2.1 (ownership), §19 (a11y), §23 (patrones web),
  §24 (BDD).
- `docs/cross-cutting/performance-standards.md` §7 (diseño de escenarios), §8 (presupuestos
  en CI) — aplicado al presupuesto de throughput, sin k6 (OQ-QA-3).
- Skills: `qa-three-layer-regression`, `bdd-scenario-quality`, `playwright-stability`,
  `nfr-quantification`.
