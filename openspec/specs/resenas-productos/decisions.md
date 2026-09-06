# CAP-14 Reseñas — Decisiones

Decisiones que gobiernan el estado vivo de la capacidad.

## Decisiones de producto (dueño, US-025 §10)

| Decisión | Motivo |
|---|---|
| Sólo quien compró puede reseñar (orden `delivered`), no cualquier cliente logueado. | Mismo criterio de confianza que Mercado Libre — evita reseñas de quien nunca tuvo el producto en mano. |
| Estrellas 1-5 + comentario OPCIONAL (no obligatorio). | Bajar la fricción — muchos clientes sólo quieren calificar sin escribir. |
| Moderación básica: el dueño sólo puede ocultar, nunca editar el contenido. | Evita que el dueño reescriba/blanquee opiniones — transparencia con el autor (AC-8), no censura invisible. |
| "Comprado" = orden en `delivered`, no `pending_payment`/`confirmed`. | La reseña llega después de recibir el producto, igual que Mercado Libre. Reconsiderar sería reabrir el AC, no un bug. |

## Decisiones de implementación

| Decisión | Motivo |
|---|---|
| `hasDeliveredOrderWithProduct` vive en `OrdersRepository` (checkout), no en un repo nuevo de reseñas. | `orders`/`order_items` son propiedad exclusiva de `OrdersRepository` — único punto de acceso al ORM de esas tablas (backend-standards §5). Un método nuevo en otro repo duplicaría el criterio de qué estados cuentan como "entregado". |
| `PUT`, no `POST`/`PATCH`, para `/me/reviews/{productId}`. | Semántica de upsert idempotente sobre un recurso identificado por URL — exactamente lo que `PUT` describe. Evita dos verbos (alta/edición) que en la práctica son la MISMA operación (`upsert` de Prisma sobre el `@@unique` compuesto). |
| `GET /me/reviews/{productId}` separado del `PUT`. | La FE necesita responder "¿elegible?" y "¿ya reseñé?" ANTES de renderizar el control (AC-6/AC-7 piden que el control ni siquiera aparezca) — una sola llamada resuelve ambas preguntas. La alternativa (inferir elegibilidad de un 403 al intentar el `PUT`) es un antipatrón de "probar y fallar". |
| `hidden_at` (soft-flag), nunca se borra la fila ni se edita el contenido. | AC-8 exige transparencia hacia el autor — mismo idioma que `Customer.deleted_at`/`Order.anonymized_at` de este proyecto: un timestamp nullable, nunca una fila borrada. |
| `rating` validado en el DTO (`@IsInt() @Min(1) @Max(5)`) Y con un `CHECK` en la migración. | Defensa en profundidad — mismo criterio que el `CHECK` de `orders.anonymization_reason` (US-020/US-021): ningún camino futuro que escriba `reviews` sin pasar por el DTO (script, migración de datos) puede insertar un rating inválido. |
| FK de `reviews` a `customers`/`products`: `onDelete: Restrict` en ambas direcciones. | Ni `Customer` ni `Product` se borran físicamente en este proyecto (`Customer` se anonimiza, `Product` se archiva por `status`) — mismo criterio que `OrderItem.product`. |
| `GET /products/{slug}/reviews` reusa el throttler/caché de `StorefrontProductsController` — sin un throttler nombrado propio. | Conceptualmente es la misma superficie pública de lectura del catálogo (mismo perfil de abuso que la ficha) — inventar un throttler nuevo para esto sería una superficie de configuración sin ganancia real. |

## Gap cross-cutting señalado (no resuelto por esta US, documentado a propósito)

`reviews.customer_id` no se toca cuando un cliente borra su cuenta
(US-020, `AccountDeletionService.deleteAccount`) — sólo `customers.name`/
`email`/`phone` se anonimizan. En la práctica esto NO produce una reseña
pública con un nombre viejo: `PublicReview.customer_name` se resuelve por
JOIN en `GET /products/{slug}/reviews` en cada lectura (nunca se cachea en
la fila de `reviews`), así que después del borrado el nombre mostrado
pasa a ser el placeholder de anonimización ("Cuenta eliminada")
automáticamente. Se documenta para que un futuro cambio que empezara a
cachear `customer_name` en `reviews` (por ejemplo, para evitar el JOIN a
escala) sepa que rompería esta garantía implícita si no la reconstruye.
