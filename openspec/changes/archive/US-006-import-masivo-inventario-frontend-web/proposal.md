---
archived: true
archived_at: 2026-08-30
merged_commit: 9a9fc53ef86bcba180979eccbaba3381facfb6a7
pr-url: https://github.com/gabogosp/AI4Devs-finalproject/pull/3
---

# Proposal — US-006 frontend-web: pantalla de importación masiva de inventario

> **Ticket**: US-006 — Importación masiva de inventario (CSV/Excel)
> **Author**: frontend-web-developer agent (assisted by @gosp)
> **Date**: 2026-08-23
> **Status**: Proposed
> **Affected layers**: components, service (sobre operaciones generadas), state (hook + unión discriminada), routing (`(admin)`), observabilidad
> **Affected platform**: web (Next.js App Router — `stacks.frontend: next`)

## Why

El dueño ya puede importar miles de SKUs: el backend de US-006 está construido y su contrato
publicado. Lo que no existe es **la superficie por la que un ser humano lo usa**. Hoy la única
forma de disparar un import es un `curl` con `multipart/form-data`, así que la capacidad está
entregada y es inaccesible para la persona a la que estaba destinada.

La US lo dice sin rodeos: a 30 segundos por producto, cargar 5.000 SKUs de a uno son ~40 horas de
tipeo, y sin catálogo no hay búsqueda semántica (US-004) ni loop de compra. Pero el valor real no
está sólo en el alta inicial: está en el **día 2**, el ajuste masivo de precios por inflación
(AC-4), que en una ferretería argentina es una tarea mensual. Ese flujo necesita que el dueño
pueda subir un archivo, ver que avanza, y entender qué filas quedaron afuera **y por qué** — sin
abrir una terminal y sin llamar a nadie.

Hay además dos criterios que **sólo** se pueden cerrar con esta pantalla. AC-7 pide que el import
no bloquee la interfaz y que el dueño vea el progreso y pueda descargar el reporte al terminar;
AC-5 pide que el reporte de filas rechazadas llegue con su motivo. El backend los sirve; sin FE,
ninguno de los dos es verificable de punta a punta.

## What

Una pantalla en el panel, `(admin)/admin/importar`, que cubre el ciclo completo: elegir el
archivo, subirlo, ver el progreso mientras el trabajo corre en el servidor, y al terminar mostrar
los contadores, la tabla de filas rechazadas y la descarga del CSV. Con un **deep-link por
trabajo** (`/admin/importar/{id}`) para que recargar la página o volver más tarde retome el
seguimiento en vez de perderlo.

La lógica de red no se escribe a mano: se consume por las **operaciones generadas** desde el spec
publicado (`createImport`, `getImport`, `getImportReport`, ya presentes en
`apps/web/src/api/generated/`) y las respuestas se validan en el borde con los schemas Zod
generados, igual que `productsService` (`frontend-standards` §3.1-§3.3, F48).

Al completarse el trabajo, la pantalla llama a **`revalidateCatalogSafely()`** —que ya existe en
`src/features/storefront/`—: es la mitad de la costura que el backend declaró y no puede hacer
(no tiene canal hacia el renderizado de Next). **Sin esa llamada, el storefront sirve precios
viejos después de un ajuste masivo**, que es el escenario de AC-4 con el peor final posible.

## Out of scope

- **Listado / historial de imports.** `GET /v1/admin/imports` no existe: quedó diferido a US-016.
  Su consecuencia visible se asume en el diseño (D-3/D-4) y no se disimula.
- **Editar el archivo en la pantalla** o corregir filas rechazadas desde el panel. El ciclo es
  «descargar el reporte, arreglar el archivo, volver a subirlo», que la reconciliación por SKU
  hace seguro.
- **Publicar productos** desde esta pantalla. El import nunca publica (AC-9): los nuevos nacen
  `draft` y publicarlos es una decisión aparte, que ya vive en el listado de productos (US-001).
- **Mapeo de columnas configurable.** El esquema v1 es fijo; la pantalla lo **documenta**, no lo
  configura.
- **Barra de progreso por WebSocket/SSE.** El contrato es polling sobre `GET {id}`; abrir un canal
  nuevo sería re-arquitecturar el backend desde el FE.
- **E2E de navegador, a11y automatizada y carga.** Son QA-owned (`qa-frontend-standards` §2.1) y
  viven en `QA-US-006`. Acá van los tests dev-owned: unit, componente e integración con MSW.

## Affected components / screens

- `src/features/imports/importsService.ts` — servicio sobre las operaciones generadas.
- `src/features/imports/useImportJob.ts` — hook de seguimiento con polling y corte.
- `src/features/imports/ImportUpload.tsx` — selección y envío del archivo.
- `src/features/imports/ImportProgress.tsx` — estado y progreso del trabajo.
- `src/features/imports/ImportResult.tsx` — contadores, aviso de borrador y acciones.
- `src/features/imports/ImportErrorsTable.tsx` — filas rechazadas paginadas.
- `src/features/imports/importErrorCopy.ts` — traducción del catálogo cerrado de `error_code`.
- `src/features/imports/reportDownload.ts` — descarga del CSV vía `Blob` (el panel usa Bearer en
  memoria, así que un `<a href>` no llevaría el header).
- `app/(admin)/admin/importar/page.tsx` y `app/(admin)/admin/importar/[id]/page.tsx` — rutas.
- `src/features/products/ProductList.tsx` — punto de entrada («Importar catálogo»).

## API consumption

Todo desde `apps/api/docs/api/openapi.yaml` (tag `admin-imports`), vía operaciones generadas:

| Operación generada | Endpoint | Qué aporta a la pantalla |
|---|---|---|
| `createImport` | `POST /v1/admin/imports` | 202 con `{id, status}` + `Location`; 200 en réplica de `Idempotency-Key` |
| `getImport` | `GET /v1/admin/imports/{id}` | estado, contadores, `errors[]` paginados, `pagination` |
| `getImportReport` | `GET /v1/admin/imports/{id}/report` | CSV con `Content-Disposition` |

Errores que la pantalla tiene que saber leer (catálogo **cerrado**, RFC 7807):
`dsm:import/file-too-large` (413), `dsm:import/unsupported-format` (415),
`dsm:import/missing-columns` (422, con `errors[]` de columnas faltantes),
`dsm:import/row-limit-exceeded` (422), `dsm:import/invalid-encoding` (422),
`dsm:import/already-running` (409), `dsm:import/not-found` (404),
`dsm:catalog/validation` (422, falta la parte `file`) y 429 con `Retry-After`.

Límites vigentes que la pantalla **muestra antes de que el dueño elija el archivo**, en vez de
esperar el rechazo: **4 MiB**, **5.000 filas**, **3 importaciones por hora**.

## Acceptance criteria

Cubre la mitad de UI de los AC del import; los de servidor los cierra el lane backend.

- [ ] **AC-1** — la pantalla sube el archivo y muestra el resultado: creados y actualizados.
- [ ] **AC-2** — el resultado informa cuántas categorías se crearon solas.
- [ ] **AC-3** — el resultado dice que los productos nuevos quedaron pendientes de enriquecimiento
      (el encolado es del backend; acá es información, no acción).
- [ ] **AC-4** — el flujo de ajuste de precios es usable: la pantalla documenta que una celda vacía
      significa «no cambiar ese campo» en un SKU existente.
- [ ] **AC-5** — las filas rechazadas se ven en pantalla con fila, sku, campo y motivo, **y** se
      pueden descargar en CSV.
- [ ] **AC-6** — un archivo rechazado entero muestra un mensaje claro de qué falta (columnas,
      formato, encoding, tope de filas) y deja explícito que el catálogo no se tocó.
- [ ] **AC-7** — el `POST` no bloquea la interfaz; el progreso avanza en pantalla y el reporte se
      puede descargar al terminar.
- [ ] **AC-8** — la pantalla vive bajo `(admin)` y un 401/403 se traduce a un mensaje de sesión, no
      a una pantalla en blanco.
- [ ] **AC-9** — el resultado avisa que lo importado quedó en **borrador** y ofrece ir al listado a
      publicar. Sin ese aviso, el dueño busca sus productos en el storefront y no los encuentra.
- [ ] **AC-11** — los límites se muestran antes de subir y el archivo se pre-valida en el cliente
      (tamaño y extensión), sin sustituir la validación del servidor.

## Standards consulted

- `docs/base-standards.md` — §1 refactor con disciplina, vocabulario prescriptivo.
- `docs/code/frontend-standards.md` — §3.1-§3.3 (tipos derivados del contrato, servicio hand-written),
  §8 (cliente centralizado), §11.4/§11.9 (unión discriminada y estados explícitos).
- `docs/code/frontend-next-standards.md` — Server/Client Components, Metadata, `revalidate`/tags.
- `docs/architecture/api-standards.md` — §8 RFC 7807, §10 `Idempotency-Key`, §12 `Retry-After`.
- `docs/cross-cutting/security-standards.md` — §6 encoding de salida (el CSV y los motivos del
  reporte son **texto del archivo del proveedor**: se renderizan como texto, nunca como HTML).
- `docs/quality/testing-standards.md` §14, `docs/quality/qa-frontend-standards.md` §23.
- `docs/product/design-system.md` — §7 componentes, §10.2 tono del copy.

## Open questions

Las cinco decisiones de UX se cerraron con el PO el **2026-08-23** antes de escribir el plan:

- **OQ-FE-1 — ¿Dónde vive el flujo?** `[Resolved: página propia (admin)/admin/importar, con entrada
  desde el listado de productos]` El flujo tiene cuatro estados y una descarga; un modal con
  polling de minutos se pierde al navegar.
- **OQ-FE-2 — ¿Cómo se muestra el progreso, si `total_rows` es `null` hasta que termina la
  lectura?** `[Resolved: indeterminado mientras es null, determinado en cuanto aparece]` Estimar el
  total por el tamaño del archivo daría una barra que salta hacia atrás.
- **OQ-FE-3 — ¿Qué pasa si el dueño recarga o se va?** `[Resolved: el id va en la URL y además en
  sessionStorage; al volver se retoma el seguimiento]` Sin listado en el backend, perder el id
  significa perder de vista un trabajo que sigue corriendo.
- **OQ-FE-4 — ¿Qué ofrece la pantalla ante el 409?** `[Resolved: aviso honesto sin link, porque sin
  listado no se puede saber el id del trabajo en curso]` Queda registrado como el costo visible de
  haber diferido `GET /v1/admin/imports` a US-016.
- **OQ-FE-5 — ¿Las filas rechazadas se ven o sólo se descargan?** `[Resolved: tabla en pantalla
  (50 por página) y además descarga del CSV]` El `GET` ya las devuelve en JSON; obligar a abrir
  Excel para saber qué falló es trabajo que le pasamos al dueño.
