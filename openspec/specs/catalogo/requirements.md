# CAP-1 Catálogo — Requisitos acumulados

Acumulado de los changes archivados de esta capacidad. Cada requisito es el **estado declarado
del sistema vivo**, no la intención de un change.

## Desde US-001 — Admin de catálogo (archivada 2026-08-09)

### Funcionales

| # | Requisito | Origen |
|---|---|---|
| R-1 | El dueño crea una categoría dando sólo el nombre; el slug se deriva server-side y es único. Un slug colisionante se rechaza con 409. | AC-1 |
| R-2 | El dueño da de alta un producto y queda en estado `draft`. | AC-2 |
| R-3 | El dueño edita un producto existente. | AC-3 |
| R-4 | Un producto que cumple los requisitos de publicación pasa a `published`. | AC-4 |
| R-5 | La validación es **por campo**: una violación devuelve 422 con `errors[]` identificando el campo, y **no se escribe parcialmente**. | AC-5 |
| R-6 | Publicar un producto incompleto se rechaza y el producto **permanece en `draft`**; se informa qué falta. | AC-6 |
| R-7 | Archivar un producto lo pasa a `archived` — **no lo borra**. En la UI requiere confirmación de dos pasos. | AC-7 |
| R-8 | Toda la superficie `/v1/admin/*` exige JWT con claim `role=admin`: sin token → 401, rol no-admin → 403. La única excepción es la ruta que emite el token. | AC-8 |
| R-9 | El SKU es único: un alta con SKU existente se rechaza con 409, sin crear un segundo producto. | AC-9 |

### Negative-space (lo que NO debe pasar)

| # | Requisito |
|---|---|
| N-1 | Un rechazo por validación no deja escritura parcial en la base. |
| N-2 | Un SKU duplicado no crea un segundo producto. |
| N-3 | Publicar incompleto no cambia el estado. |
| N-4 | Los errores no filtran stack traces, SQL crudo ni el bootstrap token esperado. |
| N-5 | El slug no se acepta del cliente: siempre se deriva. |

### No funcionales

| # | Requisito | Verificación |
|---|---|---|
| NFR-1 | El listado de productos soporta **≥5.000 SKUs** sin degradación: `p95 < 300ms`, `p99 < 800ms`, error rate < 1%. | Carga k6 sobre `GET /admin/products`. Medido en **local** (`p95 ≈ 2.95ms`); los umbrales son `[propuesto]` hasta re-medir en entorno prod-shaped — se dispara al cerrar **US-019**. |
| NFR-2 | Las pantallas del panel cumplen **WCAG 2.1 AA**: 0 violaciones axe-core. | Suite a11y contra la API real (4 pantallas) + checks a nivel componente y página en el FE. |
| NFR-3 | El borde HTTP cumple los controles §7 de security-standards: CORS con allowlist exacta por entorno, rate limiting con lockout en la superficie de auth (429 + `Retry-After` + `RateLimit-*`), y security headers de perfil API-only. | Suite `e2e-security-edge`. |
| NFR-4 | Los artefactos derivados del contrato en el frontend (DTOs, validación runtime, mocks) se **generan** desde el `openapi.yaml`; nunca se escriben a mano. | Gate de CI `frontend-codegen-fresh`: regenerar no produce diff. |

### Diferidos con dueño

| # | Requisito | Dueño / disparador |
|---|---|---|
| D-1 | Cambiar el precio de un producto **no altera** el precio de ventas ya realizadas (vivirá en `order_items.unit_price_ars_cents`). | US de checkout. Escenario de regresión escrito y `@deferred`; AC-10 de US-001. |
| D-2 | Endurecimiento del seam de auth admin: cookie `httpOnly` + refresh rotado + 2FA + rate limit por cuenta, **preservando** el contrato `role=admin`. | US-014. Ver ADR-0009. |

## Desde US-006 — Importación masiva de inventario (archivada 2026-08-30)

### Funcionales

| # | Requisito | Origen |
|---|---|---|
| R-10 | El dueño sube un CSV o XLSX y el catálogo se actualiza por SKU: alta si no existe, actualización si existe. Formato detectado por contenido (magic bytes), no por extensión ni `Content-Type`. | AC-1 |
| R-11 | Una categoría referenciada por nombre que no existe se crea automáticamente. | AC-2 |
| R-12 | Tras un import, los productos nuevos/tocados quedan marcados `enrichment_done = false` para que US-005 los recoja. | AC-3 |
| R-13 | Un archivo de sólo `sku` + `precio` actualiza precios sin pisar stock ni categoría: celda vacía en una fila de **actualización** significa "no cambiar ese campo" (OQ-BE-2). En una fila de **alta**, una celda requerida vacía rechaza esa fila. | AC-4 |
| R-14 | Filas inválidas no abortan el archivo: las válidas se importan y las inválidas se reportan con `fila` + `error_code`, paginado en `GET` y descargable como CSV (`errors[]`, hasta 1.000 filas persistidas). | AC-5 |
| R-15 | Un archivo con formato no soportado, columnas requeridas ausentes o encoding inválido se rechaza **completo** (`415`/`422`), sin crear el trabajo ni escribir nada. | AC-6 |
| R-16 | El import es asíncrono: `POST` responde `202` de inmediato y el progreso se consulta con `GET /admin/imports/{id}` (`pending → running → completed\|failed`). Sólo un trabajo concurrente — un segundo `POST` mientras hay uno activo da `409`, salvo reintento con la misma `Idempotency-Key`. | AC-7 |
| R-17 | Producto importado nuevo queda en `draft`, igual que el alta manual — el import no publica solo. | AC-9 |
| R-18 | Re-importar el mismo archivo es idempotente por SKU: no duplica productos. | AC-10 |
| R-19 | Archivo por encima de 5.000 filas o 4 MiB se rechaza (`422`/`413`) antes de escribir nada. | AC-11 |

### Negative-space (lo que NO debe pasar)

| # | Requisito |
|---|---|
| N-6 | El import no escribe `status`, `slug` ni `id` desde el archivo — sólo columnas de la allowlist (`sku`, `nombre`, `precio`, `stock`, `categoria`, `descripcion`, `imagen_url`). |
| N-7 | Un archivo rechazado (formato/encabezados/tamaño) no crea trabajo ni toca un solo producto. |
| N-8 | El reporte de errores nunca nombra tablas ni columnas de la base — habla en el idioma del archivo del dueño (`precio`, no `price_ars_cents`). |
| N-9 | Sin token o con rol no-admin, `0` trabajos creados — se cuenta antes y después del intento (AC-8). |

### No funcionales

| # | Requisito | Verificación |
|---|---|---|
| NFR-5 | Límites: **5.000 filas**, **4 MiB** de archivo, **32 MiB** descomprimidos, **3 imports/hora/IP**, **1** trabajo concurrente. Sin margen sobre el catálogo objetivo (~5.000 SKUs) — gatillo de re-medición al superar 4.000 productos o el primer `422 row-limit-exceeded` real en producción. | Tests de límite (fixtures generadas, `qa-plan.md` TC-608/TC-609/TC-613); contador + `422`/`413`. |
| NFR-6 | Celdas del reporte CSV neutralizadas contra inyección de fórmulas (`= + - @`, tab, CR prefijados con `'`) — el destino es una planilla del dueño. | `security-standards §6.3`; verificado en la suite QA (TC-618). |
| NFR-7 | Historial de trabajos retenido 90 días (`IMPORT_RETENTION_DAYS`), purga oportunista al crear un trabajo nuevo. | Variable de entorno; sin gate de CI dedicado. |
| NFR-8 | Accesibilidad WCAG 2.1 AA en la pantalla de import (selector, progreso, resultado, tabla de rechazos). | Suite a11y QA (TC-621, 4 estados). |

### Diferidos con dueño

| # | Requisito | Dueño / disparador |
|---|---|---|
| D-3 | Ejecución in-process del import (ADR-0012, enmienda a ADR-0004): migrar a BullMQ real cuando Redis esté aprovisionado, sin tocar el contrato HTTP ni el modelo de datos. | US-019 (provisión de nube). |
| D-4 | Re-medir la duración del trabajo al tope (5.000 filas) en entorno prod-shaped; los NFRs de latencia de `POST`/`GET` quedan `[propuesto — confirma Arquitecto]`. | Gatillo: primera medición en Neon / US-019. |

## Desde US-002 — Navegación pública por categorías (archivada 2026-09-05)

Superficie cubierta: `GET /categories`, `GET /categories/{slug}`,
`GET /categories/{slug}/products`, más las páginas SSR `(storefront)` que las
consumen.

### Funcionales

| # | Requisito | Origen |
|---|---|---|
| R-20 | `GET /categories` devuelve el árbol público de dos niveles: rubros (`parent_id = null`) con sus subrubros directos embebidos, ambos ordenados por nombre. | AC-1 |
| R-21 | `GET /categories/{slug}` devuelve la categoría con su `parent` (para el breadcrumb) y sus `children` — slug inexistente responde `404`, nunca un `200` vacío indexable fantasma. | AC-2, AC-9 |
| R-22 | `GET /categories/{slug}/products` pagina (offset, `limit` 1..100 default 20) sólo productos `published` de la categoría — un RUBRO agrega los de sus subrubros directos, un SUBRUBRO lista sólo los propios. Orden estable `name ASC, id ASC`. | AC-3 |
| R-23 | Categoría existente sin productos publicados responde `200` con `data: []` y `total: 0` (no un 404 ni un error). | AC-6 |
| R-24 | El árbol de categorías y el listado de la home/rubro se renderizan **server-side**, indexables por buscadores (sin JS requerido para el contenido). | AC-4, AC-10 |
| R-25 | La ficha de producto (US-003) muestra el breadcrumb con la categoría como link — el enlace al rubro padre queda diferido (`OQ-FE-11`, requiere `category.parent` en un segundo fetch). | AC-2 (FE) |
| R-26 | La paginación de categoría es **linkeable** (server-side por `searchParams`, offset derivado) — no un botón "cargar más" que pierde el estado al compartir la URL. | Design FE §D3 |
| R-27 | Cada página de categoría/paginación declara `canonical` auto-referencial + `rel=prev/next` + título propio por página (SEO). | Design FE §D4 |
| R-28 | El sitemap incluye las rutas de categoría; convención de archivo compartiendo el tag de frescura `catalog`. | Design FE §D5 |

### Negative-space (lo que NO debe pasar)

| # | Requisito |
|---|---|
| N-10 | `draft`/`archived` nunca aparecen en `GET /categories/{slug}/products` — ni en `data` ni en `total`. |
| N-11 | El catálogo completo nunca se transfiere de una sola vez — `limit` tiene tope 100, default 20. |
| N-12 | El evento `category.viewed` sólo lo emite el detalle (`GET /categories/{slug}`), nunca el árbol ni el listado — y nunca lleva PII (lectura anónima). |
| N-13 | Ninguna página de `(storefront)` usa `loading.tsx` (F59) — evita que Next confirme un `200` antes de poder emitir un `404` real. |

### No funcionales

| # | Requisito | Verificación |
|---|---|---|
| NFR-9 | Caché por endpoint: árbol `max-age=300, stale-while-revalidate=60` (cambia poco); detalle y listado `max-age=60, stale-while-revalidate=30` (mismo criterio que la ficha de US-003) — sólo en `2xx`, nunca en `404`/`429`. | Suite dev-owned; hallazgo M1 heredado de US-003. |
| NFR-10 | LCP < 2.5s, p95 < 300ms en las páginas de categoría (US §9, E2E §17). | Suite dev-owned. |
| NFR-11 | WCAG 2.1 AA en `CategoryNav`, breadcrumb y grilla. | Suite a11y. |

### Diferidos con dueño

| # | Requisito | Dueño / disparador |
|---|---|---|
| D-5 | CTA "Agregar" en la card de producto. | US-007 — `design-system §7.3`. |
| D-6 | Top-nav completo (buscador, carrito, cuenta). | US-004/US-007 — `design-system §7.10`. |
| D-7 | Grilla global `/productos` (todas las categorías juntas). | `OQ-FE-7` — sin endpoint público que la sirva todavía. |
| D-8 | Breadcrumb con el rubro **padre** en la ficha de producto (hoy sólo la categoría directa). | `OQ-FE-11` — requiere `category.parent` en el contrato de la ficha; exigiría un segundo fetch en cadena. |
| D-9 | `generateSitemaps` particionado. | Disparador: > 50.000 URLs (design.md D5). |
| D-10 | `placeholder="blur"` en imágenes remotas de producto. | Requiere loader propio (design.md D9). |
| D-11 | Número real de WhatsApp en el footer/contacto. | `OQ-FE-3` (PO/cliente). |
