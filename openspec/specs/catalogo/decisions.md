# CAP-1 Catálogo — Decisiones

Decisiones que gobiernan el estado vivo de la capacidad. Los ADR son la fuente de verdad;
acá se registra **cuál aplica a esta capacidad y por qué**.

## ADRs que aplican

| ADR | Decisión | Impacto en esta capacidad |
|---|---|---|
| [ADR-0009](../../../docs/architecture/decisions/) | Seam de auth admin de US-001 | `AdminGuard` valida JWT con claim `role=admin`; la emisión es interina (intercambio de bootstrap token) y US-014 la endurece **sin reescribir** el guard ni los servicios. |
| [ADR-0007](../../../docs/architecture/decisions/) | Monolito modular en NestJS | La capacidad vive como módulos (`categories`, `products`, `auth`) de un único deployable, no como servicios separados. |
| [ADR-0001](../../../docs/architecture/decisions/) | Railway + Neon + Cloudflare R2 | Money como entero en centavos (`price_ars_cents`); secretos en variables de plataforma, nunca en repo. |
| [ADR-0002](../../../docs/architecture/decisions/) | pgvector como datastore único | Relevante a futuro para US-004/005; hoy la capacidad no usa vectores. |
| [ADR-0005](../../../docs/architecture/decisions/) | Auth propia con JWT | Refinada por ADR-0009 para el seam mínimo de US-001. |

## Decisiones de implementación tomadas durante la construcción

| Decisión | Motivo |
|---|---|
| El **esquema es fuente única de verdad** y vive en `packages/db` (`@dsm/db`), no acoplado a la app API. | Permite que la provisión de nube (US-019) aplique migraciones desde el mismo paquete, y que cualquier disciplina lo consuma como dependencia de workspace. |
| El slug **se deriva server-side**, nunca se acepta del cliente. | Garantiza unicidad y evita que el cliente fabrique colisiones. |
| Los errores usan **RFC 7807** con `errors[]` por campo; el filtro es global, no por handler. | Un único punto de traducción; ningún handler filtra detalle interno. |
| La validación devuelve **422**, no 400. | AC-5 distingue "request mal formado" de "campos inválidos"; el `ValidationPipe` global usa `errorHttpStatusCode: 422`. |
| El FE **genera** DTOs + validación Zod + mocks MSW desde el `openapi.yaml` del backend hermano. | `frontend-standards` §3.1/§3.2: un mirror escrito a mano reintroduce drift silencioso — los mocks pasan verdes contra el contrato viejo. Gate de CI `frontend-codegen-fresh`. |
| La ruta de login es la **única** bajo `/v1/admin/*` sin `AdminGuard`. | Es la que emite el token; exigirlo sería circular. Declarada con `security: []` en el contrato. |
| Los controles §7 (CORS, rate limit, headers) se setean **una vez en el borde** (`configureApp`), compartido por producción y tests e2e. | Un único punto de verdad; evita que los tests corran contra una configuración distinta a la real. |
| El throttle de auth necesita un **guard propio** que ponga `Retry-After` y `RateLimit-*` antes de lanzar. | El filtro RFC 7807 reconstruye la respuesta de error y perdía las cabeceras que ponía el guard base. |

## Desviaciones conscientes registradas

| Desviación | Motivo |
|---|---|
| Archivado contra la rama de integración (`feature-entrega2-GOSP`) en vez de `main`. | En este repo `main` es el fork del repo plantilla del máster, con historia de otros alumnos; el producto vive en la rama de integración, que además es el entregable evaluable. La **intención** del gate —no sincronizar el contrato vivo con algo fuera de la baseline— está satisfecha: todo está en la baseline. Ver gap F54 del framework. |
| Sin `Idempotency-Key` en los POST de v1. | Decisión consciente registrada como OQ-3 del change de backend; la superficie es un panel de un solo admin. |
