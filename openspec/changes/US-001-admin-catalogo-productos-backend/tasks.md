---
parent-us: US-001
discipline: backend
variant: null
language: es
---

# US-001 Backend — Tasks

> Cada task es closure-grade: atómica, con `Exit criterion:` observable y `Verify:` con el comando exacto que `/develop-backend` corre. Los comandos asumen la **raíz del repo** como cwd. La app `apps/api` (`@dsm/api`) hoy es un placeholder vacío: la Fase 1 la scaffoldea, y los `Verify:` de fases siguientes corren contra ese estado scaffoldeado (`pnpm --filter @dsm/api ...`). El esquema de datos se **consume** de `@dsm/db`; ninguna task migra esquema.
>
> **Estimación dual**: **6 h AI-asistido** / **13 h tradicional** (coherente con `story_points_ai_assisted: 6` de la US, acotado a la disciplina BE; ~0.45× per Peng 2023).

## Pre-requisitos
- [x] **OQ-1 resuelta** (proposal §Open questions) `[Resolved: 2026-07-18]`: el seam de auth admin es **owned-by-US-001** (AdminGuard con JWT `role=admin`); US-014 lo endurece sin reescribir el guard. DAG sin invertir → la Fase 3 (guard) **se ejecuta**.
- [x] `bootstrap-local` disponible: `@dsm/db` presente como workspace en la rama de integración `feature-entrega2-GOSP` y `docker-compose` (Postgres+pgvector) healthy. (PR #2 aún no mergeado a `main`; se satisface vía la rama de integración.)
- [x] Confirmadas OQ-2 (sin columna nueva) y OQ-3 (sin `Idempotency-Key` v1, decisión consciente).

## Fase 1: Scaffolding de `apps/api` + toolchain de la app

- [x] T1.1 Scaffoldear la app NestJS en `apps/api` anclada al workspace
  - **Exit criterion**: existe `apps/api/package.json` con `"name": "@dsm/api"`, dependencia `@dsm/db` (workspace), scripts `build`/`start`/`lint`/`typecheck`/`test`; `pnpm install` resuelve el workspace incluyendo `@dsm/api`.
  - **Verify**: `node -e "const p=require('./apps/api/package.json'); if(p.name!=='@dsm/api') process.exit(1); const d={...p.dependencies,...p.devDependencies}; if(!('@dsm/db' in d)) process.exit(1)" && pnpm install --frozen-lockfile 2>/dev/null || pnpm install`

- [x] T1.2 Configurar TypeScript strict + lint + typecheck de la app
  - **Exit criterion**: `apps/api/tsconfig` con `strict: true`; `pnpm --filter @dsm/api lint` y `pnpm --filter @dsm/api typecheck` corren y pasan sobre el scaffold.
  - **Verify**: `node -e "const t=require('./apps/api/tsconfig.json'); const c=t.compilerOptions||{}; if(c.strict!==true && !(t.extends)) process.exit(1)" && pnpm --filter @dsm/api typecheck && pnpm --filter @dsm/api lint`

- [x] T1.3 Config validada al arranque (esquema Zod/Joi de env)
  - **Exit criterion**: `apps/api/src/config` valida `DATABASE_URL`, `JWT_SECRET`, `PORT` con `@nestjs/config` + esquema; el arranque falla si falta una var (fail-fast, §7).
  - **Verify**: `pnpm --filter @dsm/api test -- config` (test unit que arranca el schema de config con env inválido y espera throw)

- [x] T1.4 `PrismaService` que extiende el client de `@dsm/db` + módulo
  - **Exit criterion**: `apps/api/src/prisma/prisma.service.ts` extiende el `PrismaClient` de `@dsm/db`, conecta en `onModuleInit`, desconecta en `onModuleDestroy`; es el único punto de acceso al ORM.
  - **Verify**: `pnpm --filter @dsm/api typecheck && grep -rq "@dsm/db" apps/api/src/prisma/`

## Fase 2: Cross-cutting — filtro RFC 7807, errores de dominio, logging, health

- [x] T2.1 Errores de dominio + filtro de excepciones global RFC 7807
  - **Exit criterion**: existen `NotFoundError`, `ConflictError`, `ValidationError`, `InvalidTransitionError` (TS plano); `HttpProblemFilter` global mapea cada uno al envelope RFC 7807 (`type`,`title`,`status`,`detail`,`instance`,`errors[]`) per api-standards §8; nunca filtra stack/Prisma crudo.
  - **Verify**: `pnpm --filter @dsm/api test -- problem-filter` (unit: cada error de dominio → status + envelope esperado; error de Prisma crudo NO aparece en el body)

- [x] T2.2 `ValidationPipe` global (whitelist) en el bootstrap
  - **Exit criterion**: `main.ts` registra `ValidationPipe` con `whitelist: true, forbidNonWhitelisted: true, transform: true`; un body con campo desconocido → `400`/`422` RFC 7807.
  - **Verify**: `pnpm --filter @dsm/api test -- e2e-validation` (e2e-nest: POST con campo extra → rechazo con envelope)

- [x] T2.3 Logging pino estructurado + interceptor de request/trace id
  - **Exit criterion**: logger pino JSON con logger-por-request que inyecta `trace_id`, `request_id`, `endpoint`, `method`; sin `console.log` en paths de producción (§9).
  - **Verify**: `pnpm --filter @dsm/api typecheck && ! grep -rn "console.log" apps/api/src --include=*.ts | grep -v ".spec."`

- [x] T2.4 Endpoints de health/readiness
  - **Exit criterion**: `GET /health` responde 200 (liveness); `GET /ready` checa la conexión Prisma y responde 200/503.
  - **Verify**: `pnpm --filter @dsm/api test -- e2e-health`

## Fase 3: Guard RBAC admin (seam mínimo — gated por OQ-1)

- [x] T3.1 `AdminGuard` que valida JWT con claim `role=admin`
  - **Exit criterion**: `AdminGuard` valida firma con `JWT_SECRET` y exige claim `role=admin`; sin token → `401`, token válido sin rol admin → `403`; el contrato `role=admin` queda documentado para que US-014 lo endurezca sin reescribir el guard.
  - **Verify**: `pnpm --filter @dsm/api test -- admin-guard` (unit: sin token→401, rol!=admin→403, rol=admin→pasa)

- [x] T3.2 Emisión acotada de token admin (seam) detrás de config
  - **Exit criterion**: mecanismo mínimo para obtener un token admin (login admin básico o token seed de bootstrap) detrás de flag de config; **sin** registro de clientes, refresh rotado ni 2FA (eso es US-014).
  - **Verify**: `pnpm --filter @dsm/api test -- admin-token` (unit/e2e: emite token con `role=admin` verificable por el guard)

## Fase 4: CategoriesModule (AC-1)

- [ ] T4.1 Repositorio de categorías (envuelve Prisma `@dsm/db`)
  - **Exit criterion**: `CategoriesRepository` con `create`/`findMany`/`findById`/`update`; traduce `P2002` (slug) → `ConflictError`; ningún otro servicio toca el client.
  - **Verify**: `pnpm --filter @dsm/api test -- categories.repository` (integration Testcontainers: crear con slug repetido → ConflictError)

- [ ] T4.2 Service de categorías con derivación de slug único (AC-1)
  - **Exit criterion**: `CategoriesService.create` deriva `slug` kebab-normalizado del `name`, persiste; colisión de slug → `ConflictError`; slug NO se acepta del cliente.
  - **Verify**: `pnpm --filter @dsm/api test -- categories.service` (unit: "Refrigeración" → slug "refrigeracion"; colisión → ConflictError)

- [ ] T4.3 Controller `/v1/admin/categories` (POST/GET/PATCH) + DTOs + guard
  - **Exit criterion**: rutas `POST/GET/PATCH /v1/admin/categories` con `CreateCategoryDto`/`UpdateCategoryDto`/`CategoryResponseDto`, protegidas por `AdminGuard`; POST 201 con slug único, colisión 409.
  - **Verify**: `pnpm --filter @dsm/api test -- e2e-categories` (e2e-nest: crear categoría 201; duplicado 409; sin admin 401/403)

## Fase 5: ProductsModule — CRUD + validación (AC-2, AC-3, AC-5, AC-9)

- [ ] T5.1 Repositorio de productos (envuelve Prisma `@dsm/db`)
  - **Exit criterion**: `ProductsRepository` con `create`/`findMany`(paginado)/`findById`/`update`; traduce `P2002` (sku)→`ConflictError`, `P2003` (category_id FK)→`ValidationError`; único punto de acceso al ORM.
  - **Verify**: `pnpm --filter @dsm/api test -- products.repository` (integration Testcontainers: sku duplicado→ConflictError; category_id inexistente→ValidationError; CHECK price/stock atrapados)

- [ ] T5.2 DTOs + validación por campo (AC-5)
  - **Exit criterion**: `CreateProductDto`/`UpdateProductDto` con `price_ars_cents @Min(1)`, `stock @Min(0)`, `sku`/`name` no vacíos, `category_id` uuid, `image_url?` url; violación → `422` con `errors[]` **por campo**; sin escritura parcial.
  - **Verify**: `pnpm --filter @dsm/api test -- e2e-products-validation` (e2e-nest: precio 0 → 422 field `price_ars_cents`; stock -1 → 422 field `stock`; nombre vacío → 422 field `name`)

- [ ] T5.3 Alta de producto en `draft` (AC-2) + SKU único (AC-9)
  - **Exit criterion**: `POST /v1/admin/products` crea el producto con `status='draft'` por defecto; SKU duplicado → `409` "SKU duplicado" sin crear segundo producto.
  - **Verify**: `pnpm --filter @dsm/api test -- e2e-products-create` (e2e-nest: alta → 201 status draft; mismo SKU otra vez → 409, count sigue en 1)

- [ ] T5.4 Editar producto (AC-3)
  - **Exit criterion**: `PATCH /v1/admin/products/{id}` actualiza `price_ars_cents`, `stock`, `description_raw`, `category_id`, `image_url`; `price_ars_cents` es entero (centavos ARS, IVA incluido); `updated_at` se refresca; producto inexistente → `404`.
  - **Verify**: `pnpm --filter @dsm/api test -- e2e-products-update` (e2e-nest: editar precio/stock/categoría persiste; id inexistente → 404)

- [ ] T5.5 Listado paginado del panel (NFR ≥5.000 SKUs)
  - **Exit criterion**: `GET /v1/admin/products?limit=&offset=&sort=` devuelve `{data:[], pagination:{limit,offset,total}}` (api-standards §6.1); usa el índice `(category_id,status)`; array vacío como `[]`.
  - **Verify**: `pnpm --filter @dsm/api test -- e2e-products-list` (integration: sembrar >100 productos, paginar, total correcto, sin degradación de query)

## Fase 6: Máquina de transición de estado (AC-4, AC-6, AC-7)

- [ ] T6.1 `products.state.ts` — transiciones válidas + requisitos de publicación
  - **Exit criterion**: TS plano (sin tipos de framework) que define transiciones válidas (`draft→published`, `draft→archived`, `published→archived`, `published→draft`) y la regla de completitud para publicar (nombre+precio+stock+categoría); transición inválida y publicación incompleta lanzan `InvalidTransitionError` con el detalle de qué falta.
  - **Verify**: `pnpm --filter @dsm/api test -- products.state` (unit: cada transición válida OK; inválida→error; publicar sin categoría→error listando "category_id")

- [ ] T6.2 Publicar (AC-4) + intento incompleto (AC-6) en el service + controller
  - **Exit criterion**: `PATCH /v1/admin/products/{id}` con `{status:"published"}` publica si cumple requisitos (→ `published`); si falta algo → `422` indicando qué falta y el producto **permanece** `draft` (sin escritura parcial).
  - **Verify**: `pnpm --filter @dsm/api test -- e2e-products-publish` (e2e-nest: completo→published; sin categoría→422 y status sigue draft)

- [ ] T6.3 Archivar (AC-7)
  - **Exit criterion**: `PATCH /v1/admin/products/{id}` con `{status:"archived"}` pasa a `archived`; **sin** delete físico (el registro persiste); desde `draft` o `published`.
  - **Verify**: `pnpm --filter @dsm/api test -- e2e-products-archive` (e2e-nest: archivar→status archived; el registro sigue existiendo por findById)

## Fase 7: RBAC end-to-end (AC-8) + observabilidad de negocio

- [ ] T7.1 Guard RBAC cubriendo TODAS las rutas `/v1/admin/*` (AC-8)
  - **Exit criterion**: toda ruta `/v1/admin/*` (categorías y productos, todos los métodos) exige `AdminGuard`; visitante sin sesión → `401`, rol no-admin → `403`; ninguna operación de administración se expone sin auth.
  - **Verify**: `pnpm --filter @dsm/api test -- e2e-rbac` (e2e-nest: barrido de todas las rutas admin sin token → 401; con token no-admin → 403)

- [ ] T7.2 Eventos de negocio (E2E §18, KPI PRD §1.4)
  - **Exit criterion**: `product.created`/`product.published`/`product.archived`/`category.created` se emiten como log pino estructurado (con `admin_user_id` pseudónimo + `trace_id`) + contador de métrica; sin PII de comprador (no aplica en catálogo).
  - **Verify**: `pnpm --filter @dsm/api test -- events` (unit/e2e: publicar un producto emite `product.published` con los campos esperados)

## Fase 8: Contratos OpenAPI + documentación

- [ ] T8.1 Contratos OpenAPI por endpoint alineados con la implementación
  - **Exit criterion**: cada yaml de `contracts/openapi/*.yaml` (7 endpoints) valida (OpenAPI 3.x) y coincide con la implementación (paths, DTOs, catálogo de errores RFC 7807 `dsm:catalog/*`).
  - **Verify**: `npx @stoplight/spectral-cli lint openspec/changes/US-001-admin-catalogo-productos-backend/contracts/openapi/*.yaml`

- [ ] T8.2 README del servicio + OpenAPI publicado del servicio
  - **Exit criterion**: `apps/api/README.md` documenta cómo correr/testear la app; `apps/api/docs/api/openapi.yaml` (o Swagger generado) refleja los endpoints admin.
  - **Verify**: `test -f apps/api/README.md && test -f apps/api/docs/api/openapi.yaml`

## Verification (suite-level)

- [ ] Todos los unit tests pasan: `pnpm --filter @dsm/api test`
- [ ] Integration (Testcontainers) pasan: `pnpm --filter @dsm/api test -- --group=integration` (requiere Docker; usa el esquema de `@dsm/db`)
- [ ] E2E-nest (supertest) pasan: `pnpm --filter @dsm/api test:e2e`
- [ ] Lint + typecheck limpios: `pnpm --filter @dsm/api lint && pnpm --filter @dsm/api typecheck`
- [ ] Contract tests OpenAPI pasan: `npx @stoplight/spectral-cli lint openspec/changes/US-001-admin-catalogo-productos-backend/contracts/openapi/*.yaml`
- [ ] CI del monorepo verde con la app scaffoldeada: `pnpm -r lint && pnpm -r typecheck && pnpm -r test`

## Trazabilidad AC → tasks

| AC | Tasks | Estado |
|---|---|---|
| AC-1 (categoría + slug único) | T4.1, T4.2, T4.3 | en este change |
| AC-2 (alta en draft) | T5.3 | en este change |
| AC-3 (editar producto) | T5.4 | en este change |
| AC-4 (publicar) | T6.1, T6.2 | en este change |
| AC-5 (validación por campo) | T5.2, T2.1 | en este change |
| AC-6 (publicar incompleto → rechazo) | T6.1, T6.2 | en este change |
| AC-7 (archivar, no borrar) | T6.3 | en este change |
| AC-8 (RBAC admin) | T3.1, T3.2, T7.1 | en este change — **gated por OQ-1** |
| AC-9 (SKU único) | T5.1, T5.3 | en este change |
| AC-10 (precio histórico) | — | cubierto-por-diseño; verificable e2e recién con checkout (fuera de US-001 BE) |
