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
