---
parent-us: US-006
discipline: frontend-web
variant: null
language: es
---

# US-006 frontend-web — Tasks

> Cada task es closure-grade: atómica, con `Pattern:` (el patrón del estándar ya aplicado, para no
> re-abrir el monolito), `Exit criterion:` observable y `Verify:` con el comando exacto que
> `/develop-frontend-web` corre. Los comandos asumen la **raíz del repo** como cwd. El runner es
> `vitest run` (`pnpm --filter @dsm/web test` ya es terminante — no watch, F49).
>
> **Estimación dual**: **4,6 h AI-asistido** / **9 h tradicional** (13 tasks). La US §7 presupuesta
> `FE-US-006` en 8-12 h tradicional: entra en el rango porque el contrato ya está publicado, las
> operaciones generadas **ya existen** y hay patrones establecidos que se reusan
> (`productsService`, `AsyncState`, TanStack Table, `revalidateCatalogSafely`). Lo que no estaba
> presupuestado y sí se paga: el deep-link y el respaldo del id (OQ-FE-3), que existen sólo porque
> el backend difirió el listado de imports.

## Pre-requisitos

- [x] **P1 — El contrato del import está publicado y generado**: las tres operaciones existen en el
  cliente generado. Si faltaran, el codegen se re-corre (`pnpm --filter @dsm/web codegen`) **antes**
  de empezar: escribir tipos a mano acá deja el FE verde contra un contrato viejo (§3.1).
  - **Verify**: `grep -q "export const createImport" apps/web/src/api/generated/endpoints.ts && grep -q "export const getImport" apps/web/src/api/generated/endpoints.ts && grep -q "export const getImportReport" apps/web/src/api/generated/endpoints.ts`
- [x] **P2 — Suite y typecheck del web verdes en el `HEAD` de partida** *(verde 2026-08-23: 86 archivos / 516 tests; typecheck limpio)*: sin esta foto no se puede
  atribuir una regresión propia.
  - **Verify**: `pnpm --filter @dsm/web test && pnpm --filter @dsm/web typecheck`
- [x] **P3 — La costura de invalidación existe**: `revalidateCatalogSafely()` está disponible; esta
  US la **usa**, no la construye.
  - **Verify**: `grep -q "export function revalidateCatalogSafely" apps/web/src/features/storefront/revalidateSafely.ts`
- [x] **P4 — El backend responde el contrato que el plan asume** (opcional pero recomendado antes de
  T2.x): API arriba y el 404 del `GET` con el `type` del catálogo.
  - **Verify**: `curl -sS -o /dev/null -w '%{http_code}' http://localhost:3000/health | grep -q 200`

---

## Fase 0: Servicio sobre el contrato — 0,8 h

- [x] T0.1 `importsService.ts`: las tres operaciones, validadas en el borde
  - **Pattern**: espejo exacto de `src/features/products/productsService.ts` — red por las
    **operaciones generadas**, respuesta validada con el schema Zod generado y tipos
    **re-exportados** del modelo generado; nada de interfaces a mano — `per frontend-standards.md
    §3.1/§3.2 (tipos derivados del contrato) y §3.3 (lo único hand-written es la lógica de
    servicio)`. La red pasa por el mutator único (§8), así que `Authorization`, `traceparent`,
    timeout y traducción RFC 7807 se heredan.
    ```ts
    const res = await getImport({ id }, { signal });
    return parseContract(GetImportResponse, res.data);
    ```
  - **Exit criterion**: `importsService` expone `create(file, idempotencyKey, signal)`,
    `get(id, page, signal)` y `downloadReport(id, signal)`; los tipos `ImportJob`, `ImportRowError`
    e `ImportCreated` se **re-exportan** del modelo generado (`grep` no encuentra `interface
    ImportJob` en la feature); `create` manda `multipart/form-data` con el campo `file` y el header
    `Idempotency-Key`; una respuesta que no valide contra el schema Zod **lanza** en vez de
    propagar un objeto a medias.
  - **Verify**: `pnpm --filter @dsm/web test -- importsService && ! grep -rn "interface ImportJob\|type ImportJob = {" apps/web/src/features/imports/`
  - **Cerrada el 2026-08-23 con dos defectos del mutator corregidos** (`src/lib/http/client.ts`,
    código compartido de US-001). Los encontró esta task por ser la primera que sube un archivo y
    la primera que pide algo que no es JSON:
    1. **`JSON.parse` de toda respuesta exitosa**: el reporte responde `text/csv`, así que el parse
       lanzaba un `SyntaxError` **fuera** del manejo de errores de red — un fallo opaco, sin
       envelope. Ahora se parsea sólo si el `content-type` dice JSON y el texto se devuelve tal cual.
    2. **`content-type: application/json` forzado con cuerpo `FormData`**: un multipart anunciado
       como JSON es un cuerpo que el servidor no puede parsear. Ahora se omite el default cuando el
       cuerpo es `FormData`, detectado con `Object.prototype.toString` y no con `instanceof`, porque
       el `FormData` del cliente generado y el global del realm pueden ser objetos distintos.
    Los dos van con test propio en `importsService.test.ts`, y las 6 suites del cliente y CSRF
    siguen verdes (44 tests) — la frontera que no se movió es el comportamiento de las llamadas JSON.
  - **Límite del entorno declarado**: el cuerpo del multipart **no se puede leer** en el test
    (jsdom cuelga 5 s al leer un `File` de un `FormData`, medido con `formData()` y con `text()`),
    así que el test asserta el **encabezado** —que es donde estaba el defecto— y que el campo se
    llame `file` lo garantizan el cliente generado y el e2e de QA contra la API real.
    (unit con MSW: `create` devuelve `{id,status}` y manda el header de idempotencia; `get` con un
    payload al que le falta `report_truncated` **lanza**; `get` con un `error_code` desconocido en
    `errors[]` **no** lanza —el contrato lo declara `string`—; `downloadReport` devuelve el texto y
    el nombre del `Content-Disposition`)

---

## Fase 1: Estado del seguimiento — 1,2 h

- [x] T1.1 `useImportJob`: polling con corte duro, cancelación y tope
  - **Pattern**: unión discriminada `AsyncState<T>` de `src/lib/async.ts`, un `AbortController` por
    request y limpieza en el `useEffect`; el intervalo se **limpia** al cerrar el trabajo, no se
    deja morir solo — `per frontend-standards.md §11.4 (estado como unión discriminada, sin flags
    booleanos) y §11.9 (todo async con estados explícitos)`.
  - **Exit criterion**: `useImportJob(id)` arranca en `loading`, pasa a `success` con el trabajo y
    **repolea** cada 1 s los primeros 30 s y cada 3 s después; **deja de pollear** en cuanto el
    `status` es `completed` o `failed`; cancela el request en vuelo al desmontar (cero warnings de
    «setState en componente desmontado»); a los 15 min sin cerrar deja de preguntar y expone
    `agotado: true` sin borrar lo último que vio; un 404 se expone como estado propio
    (`noEncontrado`) y **no** como error genérico.
  - **Verify**: `pnpm --filter @dsm/web test -- useImportJob`
    (unit con temporizadores falsos: tras `completed` el contador de llamadas **no crece** aunque
    avancen 60 s; con `running` a los 31 s el intervalo pasó a 3 s; al desmontar, el
    `AbortController` recibió `abort`; a los 15 min `agotado` es `true` y los datos siguen; un 404
    da `noEncontrado`)

- [ ] T1.2 Envío del archivo con `Idempotency-Key` estable por archivo
  - **Nota de secuencia (2026-08-23)**: su `Verify` corre sobre `ImportUpload`, que se construye en
    **T2.1**, así que las dos se cierran juntas. Es un error de orden de este plan, no del criterio:
    los dos `Exit criterion` se verifican igual, con los tests del mismo componente.
  - **Pattern**: la clave se genera **al elegir el archivo** (`crypto.randomUUID()`) y se guarda en
    el estado, no en el submit: reintentar con la misma clave es lo que hace que el 200 de réplica
    sirva — `per api-standards.md §10 (Idempotency-Key en POST retryables)`.
  - **Exit criterion**: dos envíos del **mismo** archivo elegido mandan la **misma** clave (el
    segundo obtiene 200 con el mismo `id` y la pantalla no crea un trabajo nuevo); elegir **otro**
    archivo genera una clave nueva; el `id` se toma de la respuesta (no se inventa) y la pantalla
    navega al deep-link.
  - **Verify**: `pnpm --filter @dsm/web test -- ImportUpload`
    (integración con MSW: el handler captura los headers de los dos envíos y son iguales; con un
    archivo distinto difieren; con un 200 de réplica el componente no dispara un segundo `POST`)

- [x] T1.3 `importErrorCopy.ts`: los dos catálogos, con fallback que no rompe
  - **Pattern**: mapa `Record<string, string>` con **acceso por índice y fallback explícito**, nunca
    un `switch` exhaustivo que dependa de un union type — así un código nuevo del backend degrada a
    «menos lindo» y no a pantalla vacía — `per frontend-standards.md §11.3 (mapeo explícito de
    errores) y api-standards.md §8/§12`.
  - **Exit criterion**: los 7 `type` de nivel archivo tienen copy propio, y el 429 arma su mensaje
    con el `Retry-After` recibido; los 10 `error_code` de fila tienen copy propio; un `type` o un
    `error_code` **desconocido** devuelve el `detail`/`error_message` que vino del servidor y jamás
    cadena vacía; ningún copy nombra tablas ni columnas de la base; el copy de
    `dsm:import/missing-columns` **enumera** las columnas que el servidor devolvió en `errors[]`.
  - **Verify**: `pnpm --filter @dsm/web test -- importErrorCopy`
    (unit tabla de casos: los 7 + los 10 devuelven texto no vacío y distinto entre sí; `type`
    inventado ⇒ devuelve el `detail`; `error_code` inventado ⇒ devuelve el `error_message`; el copy
    del 429 contiene los segundos; ningún copy matchea `/price_ars_cents|products|import_jobs/`)

---

## Fase 2: Componentes — 1,6 h

- [ ] T2.1 `ImportUpload`: selección, límites a la vista y pre-validación honesta
  - **Pattern**: `<input type="file">` con `<label>` asociado —nunca un div con `onClick`— y
    `Button` del design system; el estado del envío es `AsyncState`, no un booleano `loading` — `per
    qa-frontend-standards.md §19 (roles y etiquetas accesibles) y frontend-standards.md §11.9`.
  - **Exit criterion**: la pantalla muestra **antes** de elegir archivo los límites con número
    (4 MiB, 5.000 filas, 3 importaciones por hora) y el esquema de columnas v1 —las 5 requeridas,
    las 2 opcionales, que el separador de miles se rechaza y que **una celda vacía en un SKU
    existente significa «no cambiar»**— (AC-4, AC-11); un archivo de extensión distinta a
    `.csv`/`.xlsx` o de más de 4 MiB se rechaza **en el cliente** con su motivo y sin request; el
    botón queda deshabilitado mientras el `POST` está en vuelo; el input es alcanzable y operable
    **sólo con teclado**.
  - **Verify**: `pnpm --filter @dsm/web test -- ImportUpload`
    (componente: el texto de los tres límites está presente; adjuntar un `.txt` no dispara fetch —
    el handler de MSW no se llamó— y muestra el motivo; adjuntar 5 MiB tampoco; con un archivo
    válido el botón se deshabilita durante el envío; `getByLabelText` encuentra el input)

- [ ] T2.2 `ImportProgress`: indeterminado hasta que el total existe
  - **Pattern**: `role="progressbar"` con `aria-valuemin/max/now` **sólo** cuando hay total, y una
    región viva `role="status" aria-live="polite"` con el conteo; omitir `aria-valuenow` cuando es
    indeterminado en vez de escribir 0 — `per qa-frontend-standards.md §19`.
  - **Exit criterion**: con `total_rows: null` se ve una barra indeterminada y el texto «procesando…
    N filas», **sin** `aria-valuenow`; con total, la barra es determinada y `aria-valuenow` es
    `processed_rows`; el avance queda **anunciado** por la región viva (el nuevo conteo aparece en
    el nodo `role="status"`); los contadores parciales (creados/actualizados/rechazados) se ven
    mientras corre, no sólo al final (AC-7).
  - **Verify**: `pnpm --filter @dsm/web test -- ImportProgress`
    (componente: con `total_rows: null` ⇒ `queryByRole('progressbar')` **no** tiene
    `aria-valuenow`; con `total_rows: 500, processed_rows: 120` ⇒ `aria-valuenow="120"` y
    `aria-valuemax="500"`; el nodo `role="status"` contiene el conteo; re-render con más filas ⇒ el
    texto del `status` cambió)

- [ ] T2.3 `ImportResult`: contadores, borrador, revalidación y foco
  - **Pattern**: efecto de **transición** (dispara al pasar a `completed`, no en cada render) para
    llamar `revalidateCatalogSafely()`, y `focus()` al encabezado del resumen — `per
    frontend-next-standards.md (invalidación de caché tras mutación) y qa-frontend-standards.md §19
    (gestión de foco)`.
  - **Exit criterion**: en `completed` se ven los cinco contadores del contrato (creados,
    actualizados, rechazados, categorías creadas, total) y **el aviso de que lo nuevo quedó en
    borrador** con salida al listado de productos (AC-9); `revalidateCatalogSafely()` se llama
    **exactamente una vez** por trabajo completado y su fallo **no** rompe la pantalla; el foco se
    mueve al encabezado del resumen al cerrar; en `failed` se muestra el `error_code` global
    traducido y, si es `interrupted`, la instrucción del runbook («volvé a subir el mismo archivo:
    la reconciliación por SKU lo hace seguro»); si `report_truncated` es `true`, se avisa que la
    lista está recortada y que el CSV también.
  - **Verify**: `pnpm --filter @dsm/web test -- ImportResult`
    (componente con el módulo de revalidación espiado: pasar de `running` a `completed` ⇒ el espía
    se llamó **1** vez; re-render en `completed` ⇒ sigue en 1; un espía que lanza ⇒ el resumen
    igual se renderiza; el aviso de borrador está y linkea al listado; con `error_code:
    'interrupted'` el texto contiene «volvé a subir»; con `report_truncated: true` aparece el aviso;
    `document.activeElement` es el encabezado del resumen)

- [ ] T2.4 `ImportErrorsTable`: las filas rechazadas, paginadas y como texto
  - **Pattern**: `<table>` con `<th scope="col">` (es tabla de datos, no layout); el contenido de
    las celdas se renderiza como **texto** en JSX —jamás `dangerouslySetInnerHTML`— porque `sku` y
    `error_message` provienen del archivo de un tercero — `per security-standards.md §6 (encoding
    en el contexto de destino)`.
  - **Exit criterion**: muestra fila, sku, campo, código traducido y motivo, ordenadas por número de
    fila, con paginación cableada a `limit`/`offset` del contrato (50 por página, el mismo default
    del servidor) y `pagination.total` como total; un `sku` con contenido tipo `<img src=x
    onerror=alert(1)>` aparece **como texto visible** y no ejecuta nada; un trabajo sin rechazos
    muestra un estado vacío afirmativo («ninguna fila fue rechazada»), no una tabla vacía.
  - **Verify**: `pnpm --filter @dsm/web test -- ImportErrorsTable`
    (componente: 120 errores ⇒ 50 filas y el total dice 120; `?offset=50` ⇒ los `row_number` son
    mayores; un `sku` con markup aparece con `getByText` literal y `container.querySelector('img')`
    es `null`; `getAllByRole('columnheader')` devuelve las 5 columnas; sin errores ⇒ el texto
    afirmativo)

- [ ] T2.5 `reportDownload.ts`: el CSV por `Blob`, no por link
  - **Pattern**: `fetch` por el servicio (que pasa por el mutator y **lleva el Bearer en memoria**)
    → `Blob` → object URL → `revokeObjectURL`; el nombre se toma del `Content-Disposition` del
    servidor — `per frontend-standards.md §8 (único punto de red) y security-standards.md §6.4
    (nombres de archivo generados por el servidor)`.
  - **Exit criterion**: la descarga dispara **una** llamada al endpoint del reporte con el header de
    autorización presente; el nombre del archivo sale del `Content-Disposition`
    (`import-{id}-errores.csv`) y **no** se construye en el cliente; el object URL se revoca después
    de disparar la descarga (sin fuga de memoria); un 404 muestra el mensaje del catálogo y no una
    descarga vacía.
  - **Verify**: `pnpm --filter @dsm/web test -- reportDownload`
    (unit con MSW y `URL.createObjectURL`/`revokeObjectURL` espiados: el nombre coincide con el del
    header; `revokeObjectURL` se llamó; el request llevó `authorization`; un 404 no llama a
    `createObjectURL`)

---

## Fase 3: Rutas y entrada — 0,6 h

- [ ] T3.1 Las dos rutas bajo `(admin)/admin/importar` con deep-link y respaldo del id
  - **Pattern**: páginas finas que delegan en la feature —igual que
    `app/(admin)/admin/productos/page.tsx`—, con `metadata` propia; el respaldo del id va en
    `sessionStorage` y **nunca** es fuente de verdad — `per frontend-next-standards.md (App Router:
    página delgada, feature gruesa)`.
  - **Exit criterion**: `/admin/importar` renderiza el selector y, si hay un id reciente en
    `sessionStorage`, ofrece retomar ese trabajo; `/admin/importar/{id}` retoma el seguimiento
    directo (sobrevive a un refresh, que es lo que OQ-FE-3 compró); un id inexistente muestra «esa
    importación no existe o ya se purgó» y ofrece volver a empezar; las dos páginas tienen
    `metadata.title` propio.
  - **Verify**: `pnpm --filter @dsm/web test -- importar.page && pnpm --filter @dsm/web typecheck`
    (test de las dos páginas: con `sessionStorage` sembrado, `/admin/importar` ofrece retomar; con
    id en la ruta se pide el trabajo (handler MSW llamado con ese id); con 404 aparece el texto de
    no-encontrado y el botón de empezar de nuevo)

- [ ] T3.2 Entrada desde el listado de productos
  - **Pattern**: un `Button`/link del design system junto a las acciones del listado, sin tocar la
    lógica de `ProductList` — `per base-standards.md §1 (cambio mínimo con frontera declarada)`.
  - **Exit criterion**: el listado de productos ofrece «Importar catálogo» apuntando a
    `/admin/importar`, alcanzable por teclado; los tests preexistentes de `ProductList` pasan **sin
    modificarse** (la frontera que no se mueve es su comportamiento actual).
  - **Verify**: `pnpm --filter @dsm/web test -- ProductList && git diff --exit-code HEAD -- apps/web/src/features/products/ProductList.test.tsx`
    (el `git diff` prueba que no se tocó el test preexistente para acomodar el cambio)

---

## Fase 4: Observabilidad — 0,4 h

- [ ] T4.1 Cuatro eventos agregados, sin contenido del archivo
  - **Pattern**: `track()` de `src/lib/observability/events.ts` con el sink ya existente; el fallo de
    red va por `captureError`, no por un evento — `per observability-patterns §3.3 (el id al log,
    nunca como dimensión de métrica) y frontend-standards.md §11.8`.
  - **Exit criterion**: se emiten `import_upload_submitted` (con `size_bytes` y `ext`),
    `import_upload_rejected` (con `problem_type` y `status`), `import_job_finished` (con `status`,
    `created`, `updated`, `failed`, `duration_ms`) y `import_report_downloaded` (con
    `failed_count`); **ningún** evento lleva el nombre del archivo, un `sku` ni un motivo; un import
    de 500 filas emite **un** `import_job_finished`, no uno por poll.
  - **Verify**: `pnpm --filter @dsm/web test -- imports.events`
    (integración con el sink espiado: un flujo completo emite los 4 en orden; el volcado de eventos
    **no** contiene el nombre del archivo ni un sku sembrado reconocible; con 6 polls antes de
    cerrar, `import_job_finished` aparece 1 vez)

---

## Verification (suite-level)

- [ ] Unit + componente + integración del web pasan: `pnpm --filter @dsm/web test`
- [ ] Lint + typecheck limpios: `pnpm --filter @dsm/web lint && pnpm --filter @dsm/web typecheck`
- [ ] Build de producción verde (los Server/Client Components están bien separados):
      `pnpm --filter @dsm/web build`
- [ ] **No regresión del panel ni del storefront**:
      `pnpm --filter @dsm/web test -- ProductList ProductForm storefront cart account`
- [ ] **Sin tipos del contrato escritos a mano** (§3.1):
      `! grep -rnE "interface (ImportJob|ImportRowError|ImportCreated)|type (ImportJob|ImportRowError) = \{" apps/web/src`
- [ ] **Sin `dangerouslySetInnerHTML` en la feature** (§6):
      `! grep -rn "dangerouslySetInnerHTML" apps/web/src/features/imports/`
- [ ] **La revalidación del catálogo está cableada** (la costura que el backend no puede hacer):
      `grep -q "revalidateCatalogSafely" apps/web/src/features/imports/ImportResult.tsx`
- [ ] **El polling corta**: cubierto por T1.1; se re-corre acá porque una regresión ahí es una
      pestaña haciendo requests para siempre:
      `pnpm --filter @dsm/web test -- useImportJob`
- [ ] CI del monorepo verde: `pnpm -r lint && pnpm -r typecheck && pnpm -r test`

---

## Trazabilidad AC → tasks

| AC | Tasks | Estado |
|---|---|---|
| AC-1 (alta + actualización por SKU) | T0.1, T2.3 | en este change — la UI del resultado; la reconciliación es del backend |
| AC-2 (categoría inexistente se crea) | T2.3 | en este change — se informa el contador `categories_created_count` |
| AC-3 (se encola el enriquecimiento) | T2.3 | en este change **como información**: se avisa que los nuevos quedan pendientes de enriquecer. El encolado es del backend (US-005) |
| AC-4 (actualización masiva de precios) | T2.1, T2.3 | en este change — el esquema documentado con la semántica de celda vacía es lo que hace usable el archivo de precios |
| AC-5 (importa válidas, reporta inválidas) | T2.4, T2.5 | en este change — tabla en pantalla **y** descarga (OQ-FE-5) |
| AC-6 (formato/columnas inválidas → rechazo total) | T1.3, T2.1 | en este change — mensaje del catálogo cerrado + «el catálogo no se tocó» |
| AC-7 (procesamiento async con progreso) | T1.1, T2.2 | en este change — el `POST` no bloquea y el progreso avanza en pantalla |
| AC-8 (sólo el admin puede importar) | T3.1 | en este change — la pantalla vive bajo `(admin)`; el 401/403 se traduce. La autorización real es del backend |
| AC-9 (producto nuevo no se publica solo) | T2.3 | en este change — el aviso de borrador con salida al listado |
| AC-10 (re-importar no duplica) | — | **del backend**: no hay superficie de UI que lo pruebe. El FE no lo contradice: no ofrece «forzar» ni «duplicar» |
| AC-11 (límite de tamaño/filas) | T2.1, T1.3 | en este change — límites a la vista + pre-validación en el cliente + copy del 413/422 |

### Declaraciones de `design.md` que **no** son AC (F51)

| Declaración | Task | Estado |
|---|---|---|
| Tipos derivados del contrato + Zod en el borde (§3.1-§3.3, F48) | T0.1 | en este change |
| Unión discriminada para el estado async (§11.4/§11.9) | T1.1 | en este change |
| Polling: cadencia 1 s→3 s, corte duro, `AbortController`, tope de 15 min | T1.1 | en este change |
| `Idempotency-Key` estable por archivo (api-standards §10) | T1.2 | en este change |
| `Retry-After` en el copy del 429 (api-standards §12) | T1.3 | en este change |
| Fallback del catálogo de errores al texto del servidor | T1.3 | en este change |
| Reporte como texto, sin `dangerouslySetInnerHTML` (§6) | T2.4 | en este change |
| Descarga por `Blob` (el panel usa Bearer en memoria) | T2.5 | en este change |
| `revalidateCatalogSafely()` una vez, en la transición a `completed` | T2.3 | en este change |
| Región viva + `progressbar` sin `aria-valuenow` cuando es indeterminada | T2.2 | en este change |
| Foco al resumen al cerrar el trabajo | T2.3 | en este change |
| Deep-link + `sessionStorage` como respaldo (OQ-FE-3) | T3.1 | en este change |
| 4 eventos agregados sin contenido del archivo | T4.1 | en este change |
| Listado/historial de imports | — | `Deferred: US-016 — owner: PO`. Su ausencia se ve en el 409 sin link (OQ-FE-4) |
| E2E de navegador, axe automatizada y carga | — | `Deferred: QA-US-006 — owner: QA` |
| Corrección del archivo desde la pantalla | — | fuera de alcance declarado: el ciclo es descargar, arreglar y volver a subir |
