# CAP-14 Reseñas — Requisitos acumulados

Acumulado de los changes archivados de esta capacidad. Cada requisito es el
**estado declarado del sistema vivo**, no la intención de un change.

## Desde US-025 backend — Reseñas y calificaciones (archivada 2026-09-06)

Superficie cubierta: `GET/PUT /me/reviews/{slug}`,
`GET /products/{slug}/reviews`, `PATCH /admin/reviews/{id}`.

### Funcionales

| # | Requisito | Origen |
|---|---|---|
| R-1 | Un cliente con una orden `delivered` que incluye el producto puede dejar una reseña (1-5 estrellas + comentario opcional) vía `PUT /me/reviews/{slug}`. | AC-1, AC-2 |
| R-2 | Reeditar la propia reseña actualiza la MISMA fila (`@@unique([customer_id, product_id])`), nunca crea una segunda. | AC-5 |
| R-3 | `GET /products/{slug}/reviews` (público, sin auth) devuelve el promedio y el conteo de reseñas VISIBLES (excluye `hidden_at IS NOT NULL`) + lista paginada con el nombre del autor. | AC-3 |
| R-4 | Sin reseñas visibles, `average: null` y `count: 0` — nunca un promedio inventado ni una lista vacía sin explicación. | AC-4 |
| R-5 | `GET /me/reviews/{slug}` (auth) devuelve `{eligible, review}` en una sola llamada: `eligible` para decidir si mostrar el control, `review` (la propia, exista o no) para pre-llenar el form de edición. | AC-6, AC-7 (soporte de UX) |
| R-6 | El dueño oculta una reseña vía `PATCH /admin/reviews/{id}` (`hidden: true`) — soft-flag (`hidden_at`), nunca borra la fila ni edita el contenido. Excluye la reseña del agregado y de la lista pública de inmediato. | AC-8 |
| R-7 | El autor de una reseña oculta la sigue viendo (con `hidden: true`) si consulta `GET /me/reviews/{slug}` — transparencia, no censura invisible. | AC-8 |
| R-8 | `rating` fuera de 1-5 se rechaza con `422` (DTO) — la migración además impone un `CHECK` de DB como defensa en profundidad. | AC-9 |

### Negative-space (lo que NO debe pasar)

| # | Requisito |
|---|---|
| N-1 | Un cliente sin una orden `delivered` que incluya el producto recibe `403 dsm:reviews/not-eligible` al intentar `PUT /me/reviews/{slug}` — verificado SIEMPRE server-side, sin importar lo que envíe el body. | AC-6 |
| N-2 | Un cliente con el producto en una orden NO `delivered` (`pending_payment`/`new`/`preparing`/`ready`/`cancelled`) sigue sin ser elegible. | AC-6 |
| N-3 | Sin sesión (invitado, incluye checkout guest de US-008), `GET`/`PUT /me/reviews/*` responden `401` — nunca exponen ningún dato de elegibilidad ni permiten reseñar. | AC-7 |
| N-4 | Una reseña oculta (`hidden_at` seteado) nunca aparece en `GET /products/{slug}/reviews` ni cuenta en su agregado, sin importar quién pregunte (esa distinción es exclusiva de `GET /me/reviews/{slug}` con la sesión del autor). | AC-8 |
| N-5 | `rating: 0` o `rating: 6` (o cualquier valor fuera de 1-5) se rechaza con `422` y NO se guarda ninguna fila. | AC-9 |

### No funcionales

| # | Requisito | Verificación |
|---|---|---|
| NFR-1 | El promedio se calcula on-read (`AVG`/`COUNT` con índice en `product_id`), sin caché ni incremental — aceptable a la volumetría esperada (catálogo ~100-1000 productos, reseñas en las decenas por producto). | Diseño, no test — nota de escala futura si el catálogo creciera órdenes de magnitud. |
| NFR-2 | La elegibilidad (AC-6) se verifica SIEMPRE server-side, nunca confiando en que el FE oculte el control. | Suite dev-owned (`ac6-ac7-elegibilidad.spec.ts`). |

### Diferidos con dueño

| # | Requisito | Dueño / disparador |
|---|---|---|
| D-1 | Reseñas con foto/video adjunta. | Owner: PO — US futura, probablemente reusando la decisión de US-024 (URL pegada vs. upload real). |
| D-2 | Respuesta pública del dueño a una reseña. | Owner: PO — CR futuro si se pide. |
| D-3 | Votar "esto te sirvió" en una reseña ajena. | Fuera de v1 (US §4). |
| D-4 | Notificar al cliente por email cuando su reseña es ocultada. | Fuera de v1 — mismo criterio que US-013/US-021 (notificar sólo lo ya declarado crítico). |
| D-5 | `reviews.customer_id` no se anonimiza en el borrado de cuenta (US-020) — el nombre público SÍ se actualiza porque se resuelve por JOIN en cada lectura, así que en la práctica no hay gap observable hoy. | Owner: Arquitecto — revisar si algún día `customer_name` se cachea en la fila (rompería esta garantía implícita). |
