# CAP-4 Carrito — Decisiones

Decisiones que gobiernan el estado vivo de la capacidad. Los ADR son la fuente de verdad;
acá se registra **cuál aplica a esta capacidad y por qué**.

## ADRs que aplican

| ADR | Decisión | Impacto en esta capacidad |
|---|---|---|
| [ADR-0008](../../../docs/architecture/decisions/) | El stock se descuenta al aprobarse el pago, sin reserva con TTL. | El carrito **lee** `products.stock` para rechazar cantidades imposibles (409) pero nunca lo escribe. Ninguna desviación: el diseño se subordina a la decisión al pie de la letra. |
| [ADR-0002](../../../docs/architecture/decisions/) | Motor de datos único (PostgreSQL). | `carts`/`cart_items` viven en Postgres, no en Redis (no aprovisionado); el volumen esperado (~50 concurrentes) no lo exige. |
| [ADR-0005](../../../docs/architecture/decisions/) | Auth propia con JWT. | No aplica directamente: el carrito **no** usa el seam de sesión de cliente registrado — un invitado no tiene `jti`. Es un mecanismo de identidad paralelo (token opaco en cookie propia), misma familia de controles (`HttpOnly`, hash server-side) que ADR-0011. |
| [ADR-0011](../../../docs/architecture/decisions/) | Tokens sensibles se guardan hasheados, nunca en claro. | `carts.session_token_hash` es SHA-256 del token de la cookie — mismo precedente que `refresh_tokens.token_hash` / `password_reset_tokens.token_hash`. |
| [ADR-0010](../../../docs/architecture/decisions/) | Superficie pública fuera de `/v1/admin`. | El carrito es la **primera escritura pública** del producto, fuera de `AdminGuard` y del seam de cliente registrado. |
| [ADR-0007](../../../docs/architecture/decisions/) | Monolito modular en NestJS. | `CartModule` vive dentro del mismo deployable que `catalog`/`auth`, no como servicio separado. |

## Decisiones de implementación tomadas durante la construcción

| Decisión | Motivo |
|---|---|
| Identidad del carrito: **token opaco en cookie `httpOnly` propia** + fila en Postgres, no `cart_id` en la URL ni el carrito completo en el cliente. | Un UUID en la URL hace que conocerlo **sea** el permiso (IDOR); el contenido en el cliente no evita resolver precio/stock server-side igual. El token hasheado hace la superficie estructuralmente inmune a IDOR (Decisión 1 del design.md). |
| Escritura de cantidad vía **`PUT` absoluto**, no `POST` relativo. | `PUT` es naturalmente idempotente (`api-standards.md` §10.5): un reintento de red nunca duplica unidades, sin necesitar `Idempotency-Key` ni su almacén. El costo (doble clic dejando 1 unidad, no 2) se acepta porque toda respuesta trae el carrito completo. |
| Rechazo (409) en vez de clamp silencioso cuando `quantity > stock`. | AC-5 exige que el sistema "no permita superar el stock"; recortar sin avisar entrega un carrito distinto del pedido. El 409 con `available_quantity` deja que el FE ponga el tope en el stepper. |
| Líneas no disponibles se **marcan**, no se borran. | Un carrito que se vacía solo entre visitas es indistinguible de un bug; AC-6 pide señalar, no quitar. La FK `cart_items.product_id` es `ON DELETE RESTRICT`: un producto con líneas vivas no puede desaparecer, así que no hay líneas huérfanas que manejar. |
| Precio **vigente** en cada lectura; la columna guardada (`unit_price_ars_cents`) sólo alimenta el flag `price_changed`. | AC-9 no deja margen: los importes que ve el cliente son los vigentes. Congelar el precio viejo sería una promesa comercial que el negocio no hizo. |
| Retención de **7 días** deslizantes desde la última **escritura** (no desde la última visita). | Decisión del PO (OQ-BE-1), sobre la recomendación de 30 días de este diseño. Costo aceptado y declarado: un cliente que arma un carrito y vuelve a las dos semanas lo encuentra vacío. Es una variable de entorno — subirla no cuesta un deploy. |
| `max_quantity` (nivel de stock) se expone **sólo en la superficie del carrito**, nunca en el browse público. | El dato ya es sondeable con el 409, así que ocultarlo no protege nada; US-003 mantiene el booleano `in_stock` en la ficha/listado. Divulgación acotada y deliberada (OQ-BE-2), declarada en el threat model. |
| Purga **oportunista** (al resolver una fila vencida), sin job programado. | Redis/BullMQ no está aprovisionado (mismo estado que US-006 / ADR-0012); con `CART_TTL_DAYS = 7` la purga oportunista alcanza de sobra. El job queda diferido con dueño (OQ-BE-6). |
| Sin `Idempotency-Key` en la superficie del carrito. | La semántica `PUT` absoluta ya es idempotente; agregar la maquinaria de idempotencia sería resolver dos veces el mismo problema. |

## Desviaciones conscientes registradas

| Desviación | Motivo |
|---|---|
| Archivado contra `main` vía PR #3 (rama de integración `feature-entrega2-GOSP`, ya mergeada). | Mismo patrón que [`catalogo`](../catalogo/decisions.md): el producto se integra en una rama compartida antes del cambio a rama-por-change (2026-08-29). Los commits de este change son ancestro de `main`. |
| `session_token` (DER E2E §8) se materializó como `session_token_hash`; se agregaron `expires_at` y `updated_at` (no estaban en el DER). | Ninguna cambia el motor, las relaciones ni un contrato cross-stack — se declara acá en vez de abrir un CR del E2E, mismo tratamiento que US-014 le dio a columnas operativas no modeladas. Ver design.md "Desviación declarada respecto del DER". |
| Sin ADR nuevo para este change. | Verificado contra los 8 ADR vigentes y el E2E §20: ninguna decisión de este change enmienda o bordea un ADR existente (tabla completa en design.md "ADR triggers"). |
