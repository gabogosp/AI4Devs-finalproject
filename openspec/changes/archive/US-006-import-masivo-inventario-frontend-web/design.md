# Design — US-006 frontend-web: pantalla de importación masiva

> **Status**: Proposed · **Date**: 2026-08-23 · **Stack**: Next.js App Router (`stacks.frontend: next`)
> **Hereda de**: `design-e2e.md` §6.2 (Web App), §9.3 (secuencia de import), §17 (NFRs), §18
> (observabilidad) y del **contrato ya publicado** por el lane backend (`apps/api/docs/api/openapi.yaml`,
> tag `admin-imports`). Este documento **no re-arquitectura** nada de eso: aterriza la mitad de UI.

## Enfoque

La pantalla es un **cliente de un trabajo asíncrono**, no un formulario. Esa es la decisión que
ordena todo lo demás: el `POST` no devuelve el resultado, devuelve un **identificador de trabajo**,
y la interfaz vive del `GET` de estado hasta que el trabajo cierra. De ahí salen las tres piezas:
un servicio que sólo traduce contrato, un hook que sostiene el ciclo de vida del seguimiento, y
componentes presentacionales que no saben nada de red.

```
app/(admin)/admin/importar/page.tsx          ← elegir archivo y subir
app/(admin)/admin/importar/[id]/page.tsx     ← seguir un trabajo por su id (deep-link)
        │
        ├── features/imports/useImportJob.ts        (estado + polling + corte)
        │        └── features/imports/importsService.ts   (operaciones generadas + Zod)
        │
        ├── features/imports/ImportUpload.tsx       (idle → subiendo)
        ├── features/imports/ImportProgress.tsx     (pending/running)
        ├── features/imports/ImportResult.tsx       (completed/failed)
        └── features/imports/ImportErrorsTable.tsx  (errors[] paginado)
```

### Por qué un hook y no estado en la página

El seguimiento tiene ciclo de vida propio —arranca, hace polling, se detiene, se cancela al
desmontar— y dos entradas distintas (subir un archivo, o abrir un deep-link). Meterlo en la página
obligaría a duplicarlo en las dos rutas. `useImportJob` es el único lugar con `setInterval`/
`AbortController`, y los componentes reciben datos ya resueltos: es lo que los hace testeables sin
red (`frontend-standards` §11.4).

## Máquina de estados de la pantalla

`AsyncState<T>` (`src/lib/async.ts`) cubre la parte async; el estado del **trabajo** es el `status`
que devuelve el contrato. La pantalla compone los dos:

| Estado UI | Cuándo | Qué se ve |
|---|---|---|
| `idle` | no hay trabajo | selector de archivo + los límites (4 MiB, 5.000 filas, 3/hora) + esquema de columnas |
| `subiendo` | `POST` en vuelo | botón deshabilitado con spinner; el archivo ya no se puede cambiar |
| `rechazado-al-subir` | 4xx del `POST` | mensaje del catálogo cerrado + **«el catálogo no se tocó»** (AC-6) + volver a intentar |
| `pending` \| `running` | `GET` devuelve esos status | progreso (ver abajo) + contadores parciales |
| `completed` | `status: completed` | contadores finales, aviso de borrador, tabla de rechazos, descarga |
| `failed` | `status: failed` | `error_code` global traducido + qué hacer (el runbook en una línea) |
| `no-encontrado` | 404 del `GET` | «esa importación no existe o ya se purgó» (retención de 90 días) |

**El progreso** (OQ-FE-2): `total_rows` es `null` hasta que el servidor termina de leer el archivo,
así que hasta ese momento la barra es **indeterminada** con el conteo crudo («procesando… 320
filas»), y pasa a determinada (`processed_rows / total_rows`) en cuanto el total existe. Estimar el
total por el peso del archivo daría una barra que retrocede, que es peor que no tenerla.

## Polling: cadencia, corte y por qué no hay presupuesto que quemar

`GET {id}` **no consume** el presupuesto de 3 importaciones/hora del `POST` (el backend lo dejó
fuera a propósito, T5.5), así que el polling es seguro. Aun así se acota:

- **1 s** durante los primeros 30 s, **3 s** después. Un import de 5.000 filas tarda segundos en
  esta infraestructura, pero la cadencia lenta evita 1.200 requests en una pestaña olvidada.
- **Corte duro** al llegar a `completed` o `failed`: el intervalo se limpia, no se «apaga solo».
- **`AbortController`** por request y limpieza en el `useEffect`: navegar durante el polling no deja
  un fetch huérfano escribiendo en un componente desmontado.
- **Tope de seguridad**: a los 15 minutos sin cerrar, el hook deja de preguntar y muestra «seguí
  con esto abierto o volvé a entrar»; el trabajo sigue del lado del servidor y el deep-link lo
  recupera. Sin tope, una pestaña abierta un fin de semana son ~14.000 requests.

## Recuperación del seguimiento (OQ-FE-3)

El backend **no tiene listado de imports** (diferido a US-016), así que el id es el único hilo. Se
guarda en dos lugares con roles distintos:

1. **La URL** (`/admin/importar/{id}`) — es lo que hace el estado compartible y sobrevive a un
   refresh. El `POST` responde con `Location`, así que el id no se inventa: se lee de la respuesta.
2. **`sessionStorage`** — para que entrar a `/admin/importar` «pelado» mientras hay un trabajo
   reciente ofrezca retomarlo en vez de arrancar de cero.

`sessionStorage` y no `localStorage` a propósito: el trabajo se purga a los 90 días y un id
guardado para siempre termina apuntando a un 404. Y no es una fuente de verdad: si el id no existe,
la pantalla lo dice y vuelve a `idle`.

## Traducción de errores (catálogo cerrado, sin inventar)

Dos catálogos distintos, y la pantalla no los mezcla:

**Nivel archivo** (RFC 7807, el `POST` falla y **nada** se escribió):

| `type` | Lo que ve el dueño |
|---|---|
| `dsm:import/file-too-large` | «El archivo pesa más de 4 MiB. Partilo en dos y subilos de a uno.» |
| `dsm:import/unsupported-format` | «El archivo no es un CSV ni un Excel válido.» |
| `dsm:import/missing-columns` | «Faltan columnas: {las de `errors[]`}» — se listan las del **archivo**, que es lo que el backend devuelve |
| `dsm:import/row-limit-exceeded` | «El archivo supera las 5.000 filas.» |
| `dsm:import/invalid-encoding` | «Guardalo como CSV UTF-8 y volvé a subirlo.» |
| `dsm:import/already-running` | «Hay una importación en curso; esperá a que termine.» (OQ-FE-4: sin link, porque sin listado no sabemos su id) |
| 429 | «Alcanzaste el límite de 3 importaciones por hora. Volvé a intentar en {`Retry-After`}.» |

**Nivel fila** (`errors[].error_code`, catálogo cerrado de 10): `missing_required`, `invalid_sku`,
**`invalid_text`**, `invalid_price`, `invalid_stock`, `invalid_category`, `invalid_image_url`,
`duplicate_sku_in_file`, `slug_conflict`, `write_failed`. La traducción vive en un mapa
`importErrorCopy.ts` con **fallback explícito**: un código desconocido muestra el `error_message`
que ya viene del servidor en lugar de un hueco. Es lo que hace que agregar un código en el backend
degrade a «menos lindo» y no a «pantalla rota».

> Nota: el código es `invalid_text` y no `name_too_long` — el backend lo renombró el 2026-08-23
> (OQ-7) precisamente para que el panel escribiera el texto correcto la primera vez.

## Seguridad de la pantalla

- **El contenido del reporte es texto de un archivo de terceros.** `error_message` y `sku` vienen
  del CSV del proveedor y se renderizan **como texto** en JSX (escapado por React). Cero
  `dangerouslySetInnerHTML` en esta feature — `security-standards` §6.
- **La descarga del CSV pasa por el cliente, no por un `<a href>`.** El panel se autentica con
  **Bearer en memoria** (`src/lib/http/authToken.ts`), y un link nativo no lleva ese header: daría
  un 401 confuso. Se hace `fetch` por el mutator, se arma un `Blob` y se dispara la descarga con un
  object URL que se revoca después. El nombre sale del `Content-Disposition` del servidor, no se
  construye en el cliente.
- **Pre-validación en el cliente que NO sustituye al servidor.** Extensión (`.csv`/`.xlsx`) y
  tamaño se chequean antes de subir para no gastar 4 MiB de red en un rechazo seguro, pero el
  formato real lo decide el backend por contenido (magic bytes). La pantalla nunca afirma que un
  archivo es válido: sólo evita el viaje obviamente perdido.
- **`Idempotency-Key`**: se genera **una vez por archivo elegido** (`crypto.randomUUID()`) y se
  reusa si el envío se reintenta. Es lo que convierte un doble click o un reintento por red en un
  200 con el mismo trabajo, en vez de dos imports del mismo archivo.

## La costura con el storefront (lo que el backend no puede hacer)

Al ver `status: completed`, la pantalla llama a **`revalidateCatalogSafely()`**
(`src/features/storefront/revalidateSafely.ts`, ya existente). El backend no tiene canal hacia el
renderizado de Next: **sin esta llamada, el storefront sigue sirviendo precios viejos** después de
un ajuste masivo — el peor final posible de AC-4, porque el import salió perfecto y el cliente ve
el precio anterior. Se llama en el efecto de transición a `completed` (una sola vez, no en cada
poll) y con la variante `Safely`, que atrapa el fallo: no poder revalidar no puede tumbar la
pantalla de resultado.

## Accesibilidad

- El input de archivo va con `<label>` asociado, no con un div que escucha clicks.
- El progreso se anuncia en una **región viva** (`role="status"`, `aria-live="polite"`) con el
  conteo, y la barra lleva `role="progressbar"` con `aria-valuenow/min/max` **sólo** cuando el total
  existe; mientras es indeterminada, se omite `aria-valuenow` en lugar de mentir un 0.
- La tabla de rechazos es una `<table>` con encabezados reales (`<th scope="col">`), porque es una
  tabla de datos y no un layout.
- El resultado mueve el foco al encabezado del resumen cuando el trabajo cierra: sin eso, quien usa
  lector de pantalla no se entera de que terminó.
- Los estados de error no dependen del color: llevan texto.

## Observabilidad

`track()` de `src/lib/observability/events.ts` (el sink ya existe), con **eventos agregados** y sin
contenido del archivo — misma regla que el backend aplicó en T6.1:

| Evento | Cuándo | Campos |
|---|---|---|
| `import_upload_submitted` | el dueño confirma el envío | `size_bytes`, `ext` |
| `import_upload_rejected` | 4xx del `POST` | `problem_type`, `status` |
| `import_job_finished` | el trabajo cierra | `status`, `created`, `updated`, `failed`, `duration_ms` |
| `import_report_downloaded` | descarga del CSV | `failed_count` |

**Nunca** el nombre del archivo, un sku ni un motivo: son datos del catálogo del cliente. El fallo
de red se reporta por el camino de errores que ya existe (`captureError`/Sentry), no con un evento.

## Alternativas consideradas

1. **Server Action para el upload** en vez del cliente generado. Descartada: el `POST` es
   `multipart` y necesita `Idempotency-Key` + la lectura del `Location`, y sobre todo el archivo
   está en el navegador. Enrutarlo por el server sumaría un salto y **duplicaría** el contrato
   fuera del cliente generado, que es justo lo que F48 evita.
2. **Progreso por SSE/WebSocket**. Descartada: el backend expone polling (ADR-0012) y abrir un canal
   nuevo desde el FE sería re-arquitecturar el backend desde el consumidor.
3. **Mostrar sólo la descarga del CSV** sin tabla en pantalla. Descartada por el PO (OQ-FE-5): el
   `GET` ya trae las filas en JSON, y obligar a abrir Excel para saber qué falló es trabajo que le
   pasamos al dueño.
4. **Un solo componente con todo el flujo.** Descartada: los cuatro estados tienen copy y
   estructura distintos, y en un componente único los tests tendrían que atravesar el flujo entero
   para asertar el resultado.
5. **`localStorage` para el id del trabajo.** Descartada: la retención es de 90 días y un id
   inmortal termina apuntando a un 404 (ver Recuperación).

## Declaraciones que NO son AC (para la reconciliación F51 al cerrar)

| Declaración | Dónde se cumple |
|---|---|
| Tipos derivados del contrato, nunca a mano (§3.1) | T0.1 |
| Red por operaciones generadas + validación Zod en el borde (F48) | T0.1 |
| Unión discriminada para el estado async (§11.4/§11.9) | T1.1 |
| Polling con corte duro, `AbortController` y tope de 15 min | T1.1 |
| `Idempotency-Key` por archivo elegido (api-standards §10) | T1.2 |
| `Retry-After` leído del 429 (api-standards §12) | T1.3 |
| Catálogo cerrado de errores con fallback al `error_message` del servidor | T1.3 |
| Reporte renderizado como texto, sin `dangerouslySetInnerHTML` (§6) | T2.4 |
| Descarga por `Blob` porque el panel usa Bearer en memoria | T2.5 |
| `revalidateCatalogSafely()` en la transición a `completed` | T2.3 |
| Región viva + `progressbar` sin `aria-valuenow` cuando es indeterminada | T2.2 |
| Foco al resumen cuando el trabajo cierra | T2.3 |
| 4 eventos agregados, sin nombre de archivo ni contenido de celdas | T4.1 |
| Deep-link `/admin/importar/{id}` + `sessionStorage` como respaldo | T3.1 |
| Entrada desde el listado de productos | T3.2 |
| Aviso de borrador con salida al listado (AC-9) | T2.3 |
| Listado/historial de imports | `Deferred: US-016 — owner: PO`. Su ausencia es visible en el 409 (OQ-FE-4) |
| E2E de navegador, axe automatizada y carga | `Deferred: QA-US-006 — owner: QA` |
