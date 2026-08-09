---
parent-us: US-001
discipline: backend
variant: null
language: es
---

# US-001 Backend — Design

## Context

El E2E (`Approved`) fija la arquitectura: monolito modular NestJS (ADR-0007), Prisma como ORM (§16), PostgreSQL+pgvector como datastore único (ADR-0002), money en centavos ARS (§8). El change de infraestructura `bootstrap-local` ya materializó el esquema `categories`+`products` en el paquete `@dsm/db` (única fuente de verdad) y dejó `apps/api` como placeholder con la instrucción explícita de que **BE scaffoldea `nest new` en su primer ticket**. Este design **no re-arquitectura** nada: transcribe las decisiones del E2E a la capa de comportamiento (endpoints, reglas de estado, validación, RBAC) y las ancla al esquema existente.

La decisión de auth admin (OQ-1 del proposal) quedó **resuelta** (2026-07-18) y **formalizada en ADR-0009**: AC-8 pide RBAC en US-001 pero el AuthModule completo es de US-014, así que US-001 entrega un **seam mínimo** (abajo, §Seguridad) que US-014 endurece sin reescribir el guard. El DAG no se invierte; la Fase 3 se ejecuta.

## Goals

- Entregar la API de administración del catálogo que `FE-US-001` consume, cubriendo los ACs backend-relevantes (AC-1 a AC-9) a nivel comportamiento.
- Layering estricto controller→service→repository per `backend-node-standards.md` §2, con la regla de estado (publicar/archivar) en el service.
- Validación en el borde (DTOs) + errores RFC 7807 por campo.
- Guard RBAC admin (seam mínimo, endurecible por US-014 sin reescribir el contrato).
- Suite de tests owned-by-dev (unit/integration/e2e-nest).

## Non-goals

- AuthModule completo (login de clientes, refresh rotado, bcrypt, 2FA, rate-limit de login) → US-014.
- Panel FE, upload de imágenes a R2, import masivo, enriquecimiento IA, storefront/búsqueda.
- Nuevas tablas/columnas o migraciones de esquema (se consume `@dsm/db` tal cual).
- Worker BullMQ (no hay trabajo asíncrono en US-001 backend).

## Approach

### Estructura de la app (a scaffoldear en `apps/api`)

```
apps/api/                         # @dsm/api — nest new, TypeScript strict
├── package.json                  # depende de @dsm/db (workspace:*), @nestjs/*, class-validator, zod
├── nest-cli.json / tsconfig
├── src/
│   ├── main.ts                   # bootstrap: ValidationPipe global, filtro RFC 7807, pino, CORS
│   ├── app.module.ts             # importa Config(validado), Prisma, Categories, Products, Auth(seam)
│   ├── config/                   # esquema Zod de env (DATABASE_URL, JWT_SECRET, PORT, ...)
│   ├── prisma/                   # PrismaService (extiende PrismaClient de @dsm/db) + módulo
│   ├── common/
│   │   ├── filters/              # HttpProblemFilter (RFC 7807, api-standards §8)
│   │   ├── errors/               # errores de dominio: NotFoundError, ConflictError, ValidationError, InvalidTransitionError
│   │   ├── logging/              # pino + interceptor de trace/request id
│   │   └── health/               # /health /ready
│   ├── auth/                     # SEAM mínimo: AdminGuard + emisión acotada de token admin (OQ-1)
│   ├── categories/
│   │   ├── categories.controller.ts   # POST/GET/PATCH /v1/admin/categories
│   │   ├── categories.service.ts      # slug único, reglas
│   │   ├── categories.repository.ts   # envuelve Prisma (@dsm/db)
│   │   └── dto/                        # CreateCategoryDto, UpdateCategoryDto, CategoryResponseDto
│   └── products/
│       ├── products.controller.ts     # POST/GET/PATCH /v1/admin/products + publish/archive
│       ├── products.service.ts        # máquina de estado + validación de negocio
│       ├── products.repository.ts     # envuelve Prisma
│       ├── products.state.ts          # transiciones válidas + requisitos de publicación (AC-6)
│       └── dto/                        # CreateProductDto, UpdateProductDto, ProductResponseDto
└── test/                          # e2e-nest (supertest)
```

**Anclaje a `@dsm/db`**: el `PrismaService` extiende el `PrismaClient` generado por `@dsm/db`; los tipos del esquema (`Product`, `Category`) se importan de ahí. El repositorio es la **única** capa que toca el client (regla §5 — services no llaman al ORM directo).

### API — tabla resumen de endpoints (cross-stack)

Base URL `/v1` (api-standards §2.1). Todas bajo `/admin` → guard RBAC. Detalle OpenAPI por endpoint en `contracts/openapi/*.yaml`.

| Endpoint | Método | Auth | AC | Schema completo |
|---|---|---|---|---|
| `POST /v1/admin/categories` | POST | admin JWT | AC-1 | [`admin-create-category.yaml`](./contracts/openapi/admin-create-category.yaml) |
| `GET /v1/admin/categories` | GET | admin JWT | AC-1 | [`admin-list-categories.yaml`](./contracts/openapi/admin-list-categories.yaml) |
| `PATCH /v1/admin/categories/{id}` | PATCH | admin JWT | AC-1 | [`admin-update-category.yaml`](./contracts/openapi/admin-update-category.yaml) |
| `POST /v1/admin/products` | POST | admin JWT | AC-2, AC-5, AC-9 | [`admin-create-product.yaml`](./contracts/openapi/admin-create-product.yaml) |
| `GET /v1/admin/products` | GET | admin JWT | listado panel (NFR) | [`admin-list-products.yaml`](./contracts/openapi/admin-list-products.yaml) |
| `GET /v1/admin/products/{id}` | GET | admin JWT | AC-3 (leer antes de editar) | [`admin-get-product.yaml`](./contracts/openapi/admin-get-product.yaml) |
| `PATCH /v1/admin/products/{id}` | PATCH | admin JWT | AC-3, AC-4, AC-5, AC-6, AC-7 | [`admin-update-product.yaml`](./contracts/openapi/admin-update-product.yaml) |

**Notas cross-stack**:
- Errores RFC 7807 con prefijo `type` `dsm:catalog/*` (catálogo cerrado por endpoint en cada yaml).
- Enums en `lower_snake_case` (`status: draft|published|archived`) per api-standards §5.6.
- Money: `price_ars_cents` es entero en centavos en el wire (coherente con el esquema y E2E §8; el display FE formatea a `$`). Se documenta la desviación consciente del envelope `{amount, currency}` de api-standards §5.5 en §Trade-offs.
- **Publicar/archivar via `PATCH`** (no sub-recurso de acción): el cliente envía `{ "status": "published" }`; el service valida la transición. Alternativa considerada (`POST .../publish`) en §Trade-offs.
- Paginación offset (api-standards §6.1): `GET /v1/admin/products?limit=&offset=&sort=`, con `pagination{limit,offset,total}` en la respuesta (NFR ≥5.000 SKUs sin degradación).

### Máquina de transición de estado (products.state.ts)

`status ∈ {draft, published, archived}` (constraint DB ya existente). Transiciones válidas, aplicadas en el **service**:

```
draft ──publish──▶ published        (requiere: name, price_ars_cents>0, stock>=0, category_id)  [AC-4/AC-6]
draft ──archive──▶ archived                                                                       [AC-7]
published ──archive──▶ archived                                                                   [AC-7]
published ──(re)draft──▶ draft       (despublicar — deriva de "editar stock o despublicar", E2E §18.5)
archived  ── (terminal para US-001; reactivar no es un AC de US-001)
```

- **Requisitos de publicación (AC-6)**: al intentar `→ published`, el service verifica completitud (nombre, precio, stock, categoría). Si falta algo → `InvalidTransitionError` → `422` con `errors[]` listando qué falta; el producto **permanece** en su estado (sin escritura parcial).
- **Transición inválida** (p. ej. saltar a un estado desconocido, o reactivar `archived` — fuera de AC) → `409`/`422` RFC 7807.
- La regla vive en TS plano (`products.state.ts`), sin tipos de framework → testeable en unit sin Nest.

### Validación (DTOs, api-standards §8.5 + backend-node-standards §4)

`ValidationPipe` global con `whitelist: true, forbidNonWhitelisted: true, transform: true`. Cada campo con mensaje claro (AC-5), agregados en `errors[]` del envelope:

- `CreateProductDto`: `sku` (string, no vacío, formato), `name` (no vacío), `price_ars_cents` (int, `@Min(1)` → precio > 0), `stock` (int, `@Min(0)`), `category_id` (uuid), `description_raw?` (string), `image_url?` (url).
- `UpdateProductDto`: subconjunto parcial de los editables de AC-3 (`price_ars_cents`, `stock`, `description_raw`, `category_id`, `image_url`) + `status` opcional para la transición.
- `CreateCategoryDto`: `name` (no vacío); `slug` derivado del nombre en el service (kebab, normalizado), no aceptado del cliente.
- Errores de negocio no expresables en el DTO (SKU duplicado, categoría inexistente, transición inválida) → errores de dominio mapeados por el filtro global, **no** `throw new HttpException` disperso (§6).

### Persistencia

**No se toca el esquema.** Este change consume `@dsm/db` (`packages/db/prisma/schema.prisma`) exactamente como lo dejó `bootstrap-local`. Referencia (NO redefinición) de lo relevante:

- `products` (11 columnas AS-BUILT): `id`, `sku` (UNIQUE `products_sku_key` → AC-9), `name`, `description_raw?`, `price_ars_cents` (CHECK `>0` → AC-5), `stock` (default 0, CHECK `>=0` → AC-5), `status` (default `draft`, CHECK IN draft/published/archived → AC-2/4/7), `category_id` (FK RESTRICT), `image_url?`, `created_at`, `updated_at` (`@updatedAt`).
- `categories` (5 columnas): `id`, `slug` (UNIQUE `categories_slug_key` → AC-1), `name`, `parent_id?` (self-FK), `created_at`.
- Índice `products(category_id, status)` — soporta el listado del panel y el filtrado por estado.

**Rol de los constraints DB en el backend**: son **defensa en profundidad**, no la fuente del mensaje de error. El backend valida primero (DTO + regla de service) y produce el mensaje por campo (AC-5); el constraint DB atrapa la condición de carrera / bypass y el repositorio traduce el error de Prisma (`P2002` unique → `ConflictError`; `P2003` FK → `ValidationError` categoría inexistente) a un error de dominio. Nunca se filtra el error crudo de Prisma al cliente (§6).

**data-architect Mode B: NO invocado.** Por el skill `data-architecture-patterns` (workload-first): motor, topología, constraints y tipos ya están resueltos por el E2E `Approved` + `bootstrap-local`. Desde la vista del backend la persistencia es **trivial**: no hay tabla/columna nueva (OQ-2 cerrada — no), no hay migración de datos, no hay elección de motor. Todas las columnas que la lógica de US-001 toca ya existen. Invocar Mode B produciría una transcripción, no una decisión. Si durante la ejecución se descubriera la necesidad de una columna nueva, **se detiene y se escala** (sería de infra/US-005, no de este change).

### Transacciones

Las operaciones de US-001 son single-write (un `INSERT`/`UPDATE` por request), no requieren `$transaction`. La publicación es un `UPDATE status` condicionado por la verificación previa en el service (lectura + regla + escritura); dado un solo admin de baja concurrencia, no hay riesgo de carrera que exija bloqueo. Si un AC futuro exigiera multi-write atómico, se envolvería en `prisma.$transaction` (§5).

## Seguridad — RBAC admin + threat model lite

Per skill `threat-modeling-lite` (superficies: POST crea recurso, PATCH modifica — admin). La escalation rule **no** aplica (sin PCI/PHI/crypto nuevo: el JWT usa `JWT_SECRET` de plataforma ya previsto por ADR-0005; no se inventa primitiva). Lite es suficiente.

**Seam de auth admin (OQ-1 resuelta — owned-by-US-001; formalizado en ADR-0009)**: `AdminGuard` valida un JWT con claim `role=admin` firmado con `JWT_SECRET` (env validado). US-014 endurece el mecanismo de emisión (login + cookie `httpOnly`+`Secure`+`SameSite`, refresh rotado, rate-limit, 2FA) **preservando** el contrato `role=admin`, sin reescribir el guard.

**STRIDE — `POST /v1/admin/products` y `PATCH /v1/admin/products/{id}` (mutantes admin)**:

| Threat | Vector | Control (en este change) |
|---|---|---|
| **S** Spoofing | Request sin sesión / JWT ajeno fingiendo admin | `AdminGuard` valida firma + claim `role=admin`; sin sesión → `401`, rol insuficiente → `403` (AC-8) |
| **T** Tampering | Cliente envía `status` o campos no editables para saltar reglas | `ValidationPipe` whitelist rechaza campos no permitidos; `status` solo muta vía la máquina de transición del service, nunca por asignación directa |
| **R** Repudiation | Cambio de catálogo sin huella | Evento de negocio `producto creado/publicado/archivado` (log pino estructurado con `admin_user_id`+`trace_id`+timestamp — E2E §18) |
| **I** Info disclosure | Error verbose revela esquema / SQL / stack | Filtro RFC 7807; nunca stack trace ni error de Prisma crudo al cliente (§6, api-standards §8.6) |
| **D** DoS | Flood de escrituras | Bajo riesgo (un admin); rate-limit de plataforma (Cloudflare/Railway, E2E §14). No se añade rate-limit por-endpoint en v1 (revisitable) |
| **E** Elevation | Cliente/anónimo invoca operación admin | `AdminGuard` en todas las rutas `/v1/admin/*`; RBAC server-side es autoritativo, el FE es solo UX (AC-8) |

**Controles concretos**: `JWT_SECRET` desde variables de plataforma (nunca en repo, §7); `role=admin` verificado server-side siempre; `ValidationPipe` con whitelist en todo controller; PII fuera de logs (el catálogo no tiene PII de comprador en US-001).

## Resiliencia y observabilidad

- **Resiliencia**: US-001 backend no hace llamadas outbound (sin Gemini/MP/Resend/R2 en scope) → no aplica timeout/retry/circuit-breaker de §8. Sin colas (worker es de US-005+). La única dependencia es Postgres (via Prisma), gestionada por el pool del client.
- **Observabilidad** (E2E §18, skill `observability-patterns`):
  - **Logs**: pino JSON → Railway logs; logger por request con `trace_id`, `request_id`, `admin_user_id` (pseudónimo), `endpoint`, `method`, `status_code`, `latency_ms`. Sin `console.log` (§9).
  - **Eventos de negocio** (mandatorio, KPI PRD §1.4): `product.created`, `product.published`, `product.archived`, `category.created` como log estructurado + contador de métrica (`Custom/product_published_total` etc.). Dimensiones acotadas (`status`, `category_id`) — nunca `product_id` como dimensión de métrica (cardinalidad).
  - **Health/readiness**: `GET /health` (liveness), `GET /ready` (checa conexión Prisma).
  - **Errores**: Sentry (E2E §18) — inicialización en `main.ts`; los `5xx` se reportan, los `4xx` de validación no.
- **NFRs cuantificados** (skill `nfr-quantification`, heredados de US-001 §9 + E2E §17):
  - Escritura (alta/edición/publicar) **p95 < 500ms** `[propuesto — confirma Arquitecto post-load-test]`; medido por latencia de transacción (Sentry/Railway); alerta si breach 5min sostenido.
  - Listado del panel **p95 < 300ms** con ≥5.000 SKUs (backoffice tolera hasta 500ms per heurística, pero el índice `(category_id,status)` + paginación offset lo mantienen bajo) `[propuesto — confirma Arquitecto]`.
  - Disponibilidad tier backoffice: hereda 99.5% mensual del proyecto (E2E §17).

## Testing (owned-by-dev; qa-backend-standards §2.1)

Modelo de 3 capas del E2E §19, **capa dev** (la suite de aceptación Playwright cross-funcional es owned-by-QA en `QA-US-001`, fuera de este change):

| Capa | Qué | Herramienta | Alcance |
|---|---|---|---|
| Unit BE | máquina de estado (transiciones válidas/ inválidas, requisitos de publicación AC-6), derivación de slug, mapeo de errores de dominio | Jest, repos mockeados | > 80% lógica de dominio |
| Integration BE | repositorios contra Postgres real con el esquema `@dsm/db`; `P2002`→409, `P2003`→422, CHECK constraints | Jest + Testcontainers (`pgvector/pgvector:pg16`) | repos + flujos críticos |
| E2E-nest | endpoints `/v1/admin/*` end-to-end + `AdminGuard` (401/403), validación 422 por campo, publicar/archivar, SKU duplicado 409 | Nest TestingModule + supertest | todos los endpoints + RBAC |
| Contract | OpenAPI de `contracts/openapi/*` vs implementación | Spectral / supertest sobre el spec | endpoints admin |

Cada AC backend tiene al menos un test que lo ejercita (trazabilidad en `tasks.md`).

## Trade-offs

- **Publicar via `PATCH {status}` vs sub-recurso de acción (`POST .../publish`)**: se elige `PATCH` porque la transición es un cambio de estado del recurso, alineado con el CRUD del panel y con menos superficie de endpoints. Costo: la regla de transición vive en el service en vez de en rutas dedicadas — mitigado con `products.state.ts` explícito. `POST .../publish` daría semántica de comando más clara pero duplica endpoints; se rechaza para v1.
- **Money como entero `price_ars_cents` en el wire vs envelope `{amount, currency}` (api-standards §5.5)**: se usa el entero en centavos, coherente con el esquema AS-BUILT y el E2E §8 (evita redondeo). Es una **desviación consciente** del envelope del standard, justificada porque toda la moneda del proyecto es ARS única y el FE formatea el display. Documentada acá; no requiere ADR (decisión de representación, no de arquitectura).
- **Seam de auth mínimo en US-001 vs esperar a US-014**: se entrega el seam para no bloquear US-001 (AC-8 es de esta US); costo: una porción de auth se implementa dos veces (el seam, luego endurecido). Beneficio: US-001 es entregable sin invertir el DAG. Alternativa (invertir dependencia) en OQ-1.
- **Sin `Idempotency-Key` en v1** (OQ-3): la unicidad de SKU/slug deduplica reintentos; un solo admin de baja concurrencia. Se revisita cuando entre un cliente automatizado (import US-006).

## Deployment considerations

- **Schema migration**: NO — este change no migra esquema (consume `@dsm/db`). Sin expand-and-contract acá.
- **Breaking API**: NO — API nueva (primer surface de `/v1/admin/*`); no rompe consumidores existentes (no hay).
- **Nuevo env/secret**: SÍ — `JWT_SECRET` (para el seam admin) + `DATABASE_URL` (ya previsto por infra). Deben existir como variables de plataforma antes del deploy (Railway). Sin secretos en repo (§7).
- **Nueva dependencia**: SÍ — `apps/api` incorpora `@nestjs/*`, `class-validator`, `zod`/`joi`, `pino`, cliente Sentry; app nueva en el monorepo.
- **Feature flag**: recomendado para el seam de auth admin mientras US-014 no lo endurezca (des/habilitar el login admin básico).
- **Tier-1 hot path**: NO — backoffice de baja concurrencia (un admin).
- **Nueva superficie pública**: los `/v1/admin/*` NO son públicos (gated por RBAC), pero son el primer surface HTTP de la app → requiere planificación de deploy (health checks, CORS, dominio).
- **Recomendación de deployment-planning**: **SÍ** — invocar `/plan-deployment` cuando la app esté scaffoldeada. Motivo: es el primer deploy vivo de `apps/api` (nuevo servicio + nuevo secret `JWT_SECRET` + nueva superficie HTTP), y coincide con el gate del change `platform-cloud`.

## ADR triggers heredados del E2E

La resolución de OQ-1 quedó registrada en **ADR-0009** (seam de auth admin US-001). Se aplican además (ya `Accepted`): ADR-0005 (auth propia — **refinada por ADR-0009** para el seam mínimo de US-001), ADR-0007 (monolito modular), ADR-0002 (pgvector datastore único), ADR-0001 (Railway/Neon/R2 — money en centavos, secretos de plataforma).

## Open questions

- **OQ-1** `[Resolved: 2026-07-18 — seam mínimo owned-by-US-001, endurecido por US-014; DAG sin invertir — ADR-0009]` — propiedad del auth admin. La Fase 3 (guard) se ejecuta. Ver proposal §Open questions y `docs/architecture/decisions/0009-admin-auth-seam-us001.md`.
- **OQ-2** `[cerrada — no]` — ¿columna nueva de esquema? No; toda columna necesaria existe en `@dsm/db`.
- **OQ-3** `[propuesto — confirma Arquitecto]` — sin `Idempotency-Key` en v1.

## References

- Proposal: `./proposal.md`
- E2E: `docs/product/design-e2e.md` §6.1, §8, §14, §17, §18, §19, §20
- Esquema (fuente de verdad): `packages/db/prisma/schema.prisma`
- Standards: `backend-node-standards.md`, `api-standards.md`, `backend-standards.md`, `qa-backend-standards.md`
- ADRs: `0005-own-jwt-authentication.md`, `0007-modular-monolith-nestjs.md`, `0002-postgresql-pgvector-single-datastore.md`, `0001-platform-railway-neon-r2.md`, `0009-admin-auth-seam-us001.md`
- Contratos: `./contracts/openapi/`
