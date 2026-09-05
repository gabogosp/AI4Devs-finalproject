# CAP-13 Retención y anonimización de datos personales — Requisitos acumulados

Acumulado de los changes archivados de esta capacidad. Cada requisito es el
**estado declarado del sistema vivo**, no la intención de un change.

## Desde US-021 backend — Retención y anonimización de PII de órdenes (archivada 2026-09-05)

Superficie cubierta: `POST /admin/orders/{id}/anonymize`,
`POST /admin/orders/retention-sweep`.

### Funcionales

| # | Requisito | Origen |
|---|---|---|
| R-1 | `POST /admin/orders/retention-sweep` anonimiza en un único `UPDATE` de conjunto todas las órdenes con `created_at` anterior al corte de `ORDER_RETENTION_MONTHS` (default 12) y `anonymized_at IS NULL`. | AC-1 |
| R-2 | `POST /admin/orders/{id}/anonymize` anonimiza una orden puntual a pedido del comprador, con `reason='requested'` fijado server-side. | AC-3, AC-9 |
| R-3 | Anonimizar sobrescribe únicamente `buyer_name`, `buyer_email`, `buyer_phone` por un valor fijo no reversible — ningún otro campo de la orden, sus ítems o su registro de consentimiento cambia. | AC-2, AC-6, AC-7 |
| R-4 | Cada anonimización registra `anonymized_at` (timestamp) + `anonymization_reason` (`retention_policy`\|`requested`) — auditable, nunca silenciosa. | AC-4 |
| R-5 | `OrdersRetentionRunner` corre el mismo barrido oportunísticamente al arrancar la API (`onApplicationBootstrap`, best-effort, nunca bloquea el arranque) — cubre el hueco de un redeploy que se salta el disparador externo. | AC-1 (complemento) |
| R-6 | Repetir la anonimización sobre una orden ya anonimizada responde `200` idéntico al de la primera vez — nunca un error, nunca un segundo evento. | AC-8 |
| R-7 | `access_token_hash` de la orden NO se toca al anonimizar — el comprador invitado sigue pudiendo consultar el estado de su orden después de pedir la supresión de sus datos de contacto. | Decisión explícita (design.md §Approach) |

### Negative-space (lo que NO debe pasar)

| # | Requisito |
|---|---|
| N-1 | `reason` nunca se acepta del body de ninguna de las dos rutas — `retention-sweep` siempre produce `retention_policy`, `:id/anonymize` siempre `requested`; ninguna acepta `@Body()`. |
| N-2 | Un `UPDATE` de anonimización nunca deja una orden con `anonymized_at` seteado y `anonymization_reason` nulo (o viceversa) — un `CHECK` a nivel de base lo hace estructuralmente imposible. |
| N-3 | Ningún evento de observabilidad (`orders_retention.swept`, `.anonymized_on_request`) lleva más que `orderId | null` — nunca el nombre/email/teléfono, ni siquiera hasheados. |
| N-4 | Dos llamadas concurrentes sobre la misma orden (barrido + acción a pedido, o dos pedidos) nunca producen un doble efecto ni un segundo evento — el `WHERE anonymized_at IS NULL` serializa a nivel de fila en Postgres. |

### No funcionales

| # | Requisito | Verificación |
|---|---|---|
| NFR-1 | `POST /admin/orders/retention-sweep` responde síncrono (no `202`+polling) — el volumen esperado (algunos cientos de órdenes/mes, una sola sucursal) hace que un `UPDATE` de conjunto se resuelva en milisegundos. | Suite dev-owned; gatillo de revisión documentado si el volumen crece dos órdenes de magnitud. |
| NFR-2 | Rate-limit: `retention-sweep` 5/hora/IP (deliberadamente angosto — un disparador externo mal configurado en loop no debe convertir esto en carga recurrente); `:id/anonymize` 30/min/IP (acción humana puntual del dueño). | Suite dev-owned, reusa el cubo `auth`. |

### Diferidos con dueño

| # | Requisito | Dueño / disparador |
|---|---|---|
| D-1 | Panel de lectura que muestre `anonymized_at`/`anonymization_reason` (AC-5). | `US-012-panel-ordenes-dueno-backend` — ya archivado, pero su `AdminOrderDetail` no expone estos campos todavía; quien lo extienda debe leer esta nota primero. |
| D-2 | Disparador externo real (cron de Railway u operación manual documentada) para la cadencia mensual de AC-1. | Owner: `/plan-deployment` u operaciones — el barrido al arrancar (R-5) cubre sólo el caso de redeploy, no reemplaza un disparador mensual real. |
| D-3 | Ejecutor BullMQ real para el barrido periódico. | Owner: Arquitecto — `Deferred: operaciones/US-019`, condicionado a que `REDIS_URL` se aprovisione (ADR-0004). El contrato HTTP no cambia cuando eso ocurra. |
| D-4 | Flujo de exportación / derecho de acceso (otro derecho de la Ley 25.326). | Owner: PO — otra US, fuera de alcance de este change. |
| D-5 | Índice parcial `WHERE anonymized_at IS NULL` sobre `orders`. | Owner: quien detecte degradación — sin medición real que lo justifique hoy (YAGNI); primera palanca a tirar si el volumen crece un orden de magnitud. |
