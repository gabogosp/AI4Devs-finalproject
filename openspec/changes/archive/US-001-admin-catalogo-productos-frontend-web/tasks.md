---
parent-us: US-001
discipline: frontend-web
variant: null
language: es
---

# US-001 Frontend Web — Tasks

> Cada task es closure-grade: atómica, con `Exit criterion:` observable y `Verify:` con el comando exacto que `/develop-frontend-web` corre. Los comandos asumen la **raíz del repo** como cwd. La app `apps/web` (`@dsm/web`) hoy es un placeholder vacío (solo `README.md`): la **Fase 1 la scaffoldea** con `create-next-app`, y los `Verify:` de fases siguientes corren contra ese estado scaffoldeado (`pnpm --filter @dsm/web ...`). El esquema de datos y la API se **consumen** del backend (`@dsm/db` / `/v1/admin/*`); ninguna task migra esquema ni redefine el contrato OpenAPI.
>
> **Estimación dual**: **7 h AI-asistido** / **15 h tradicional** (coherente con `story_points_ai_assisted: 6` de la US y la task gruesa FE §7 de 12–16h; acotado a la disciplina FE web; ~0.45× per Peng 2023). El extra sobre BE refleja el scaffolding de la app + panel con TanStack Table + formularios + a11y.

## Traceability matrix (AC → tasks)

| AC | Título | Task IDs | Estado |
|---|---|---|---|
| AC-1 | Categorías: crear/listar/editar | T5.1, T5.2, T5.3 | in this change |
| AC-2 | Alta de producto en draft | T6.1, T6.2 | in this change |
| AC-3 | Editar producto | T6.3 | in this change |
| AC-4 | Publicar producto | T7.1 | in this change |
| AC-5 | Validación por campo (422) | T6.2, T6.5 | in this change |
| AC-6 | Publicar incompleto → qué falta, permanece draft | T7.2 | in this change |
| AC-7 | Archivar (confirmación 2 pasos) | T7.3 | in this change |
| AC-8 | Panel admin-only (route guard) | T4.1, T4.2, T4.3 | in this change (OQ-FE-1 resuelta: opción A) |
| AC-9 | SKU duplicado → 409 | T6.4 | in this change |
| AC-10 | Precio no altera ventas pasadas | — | out of scope FE (sin pantalla de órdenes en US-001) |

## Pre-requisitos
- [x] **OQ-FE-1** (proposal §Open questions) `[Resolved: 2026-07-18 — opción A]`: el admin obtiene el JWT `role=admin` vía una **página mínima de acceso admin** que postea al seam del backend (ADR-0009); US-014 la endurece sin reescribir. La Fase 4 se ejecuta contra la opción A.
- [x] `bootstrap-local` disponible: `apps/web` presente como placeholder en la rama de integración; `.env.example` de Fase 0 con `NEXT_PUBLIC_API_BASE_URL` (o equivalente). Confirmar el nombre exacto de la var contra el `.env.example` entregado por infra.
- [x] API del backend consumible: el change `US-001-admin-catalogo-productos-backend` expone `/v1/admin/categories` y `/v1/admin/products` (contrato en `apps/api/docs/api/openapi.yaml`). Los tests de integración FE mockean ese contrato con MSW; no requieren la API corriendo.

## Fase 1: Scaffolding de `apps/web` + toolchain de la app

- [x] T1.1 Scaffoldear la app Next.js (App Router, TS strict) en `apps/web` anclada al workspace
  - **Exit criterion**: existe `apps/web/package.json` con `"name": "@dsm/web"`, Next 15 + React 19, scripts `dev`/`build`/`lint`/`typecheck`/`test`/`test:e2e`; `pnpm install` resuelve el workspace incluyendo `@dsm/web`; `app/` usa App Router (no `pages/`).
  - **Verify**: `node -e "const p=require('./apps/web/package.json'); if(p.name!=='@dsm/web') process.exit(1); if(!('next' in {...p.dependencies})) process.exit(1); for (const s of ['dev','build','lint','typecheck','test']) if(!(s in (p.scripts||{}))) process.exit(1)" && test -d apps/web/app && test ! -d apps/web/pages && (pnpm install --frozen-lockfile 2>/dev/null || pnpm install)`

- [x] T1.2 TypeScript strict + lint + typecheck de la app
  - **Exit criterion**: `apps/web/tsconfig.json` con `strict: true` (o `extends` que lo aporte); `pnpm --filter @dsm/web lint` y `pnpm --filter @dsm/web typecheck` corren y pasan sobre el scaffold.
  - **Verify**: `node -e "const t=require('./apps/web/tsconfig.json'); const c=t.compilerOptions||{}; if(c.strict!==true && !t.extends) process.exit(1)" && pnpm --filter @dsm/web typecheck && pnpm --filter @dsm/web lint`

- [x] T1.3 Env tipado + validado (`NEXT_PUBLIC_API_BASE_URL`) sin secretos en el bundle
  - **Exit criterion**: existe un módulo de env tipado (Zod) que valida `NEXT_PUBLIC_API_BASE_URL` al arranque; ningún secreto server-only lleva prefijo `NEXT_PUBLIC_`; `.env.example` local documenta la var (per next-standards §8).
  - **Verify**: `pnpm --filter @dsm/web typecheck && grep -rq "NEXT_PUBLIC_API_BASE_URL" apps/web && ! grep -rn "NEXT_PUBLIC_.*SECRET\|NEXT_PUBLIC_.*TOKEN\|NEXT_PUBLIC_JWT" apps/web/src apps/web/app 2>/dev/null`

- [x] T1.4 Vitest + RTL + MSW + Playwright configurados
  - **Exit criterion**: `pnpm --filter @dsm/web test` corre Vitest (jsdom) con un test trivial verde; `msw` instalado con `src/test/server.ts` (`onUnhandledRequest: 'error'`); Playwright instalado con config que corre contra `next build && next start` (no dev).
  - **Verify**: `pnpm --filter @dsm/web test -- --run && test -f apps/web/src/test/server.ts && node -e "const p=require('./apps/web/package.json'); const d={...p.devDependencies}; for(const k of ['vitest','msw','@playwright/test']) if(!(k in d)) process.exit(1)"`

## Fase 2: Design-system → tokens + shell + a11y baseline

- [x] T2.1 Tokens del design-system → `tailwind.config.ts` + CSS vars (alias semánticos §12.1)
  - **Exit criterion**: `tailwind.config.ts` referencia CSS vars para colores (`primary` #1A56DB, `accent` #C2410C, semánticos), `borderRadius` (var `--radius`), `boxShadow` (§6), `spacing` (§4), `screens` (§4.1), `zIndex` (§6.1); `:root` define los alias semánticos (`--background`,`--foreground`,`--surface`,`--border`,`--ring`,`--primary`,...); los componentes consumen alias, no primitivos hex.
  - **Verify**: `pnpm --filter @dsm/web typecheck && grep -q "\-\-primary" apps/web/**/globals.css apps/web/app/globals.css 2>/dev/null && grep -q "hsl(var(--primary))\|var(--primary)" apps/web/tailwind.config.ts`

- [x] T2.2 Shell del layout + Inter (`next/font`) + `<html lang="es-AR">` + Metadata API
  - **Exit criterion**: `app/layout.tsx` es Server Component, carga Inter con `next/font` (`display: swap`), fija `<html lang="es-AR">`, y exporta `metadata` (título del panel) vía Metadata API; sin `<head>` manual.
  - **Verify**: `pnpm --filter @dsm/web typecheck && grep -q 'lang="es-AR"' apps/web/app/layout.tsx && grep -q "next/font" apps/web/app/layout.tsx && grep -q "export const metadata\|generateMetadata" apps/web/app/layout.tsx`

- [x] T2.3 Componentes base accesibles (Button, Input/Field, Select) del design-system
  - **Exit criterion**: existen `Button` (variantes primary/secondary/accent/ghost/destructive, estado `loading` con `aria-busy`, área táctil ≥44px, focus ring `shadow-focus`) e `Input`/`Field` (label asociado, estado error con `aria-describedby`) en `src/components/ui/`; tests component verdes.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/components/ui`

## Fase 3: Cliente HTTP + error mapping RFC 7807 + repositorios

- [x] T3.1 Cliente HTTP centralizado con interceptores (auth, trace, timeout)
  - **Exit criterion**: `src/lib/http/client.ts` es el único punto de red; interceptor inyecta `Authorization: Bearer <token>` cuando hay sesión, propaga `traceparent`, aplica timeout (§8.3); ningún componente llama `fetch`/`axios` directo.
  - **Verify**: `pnpm --filter @dsm/web typecheck && grep -rq "traceparent" apps/web/src/lib/http && ! grep -rn "fetch(" apps/web/src/components apps/web/src/features 2>/dev/null | grep -v ".test." | grep -v "http/client"`

- [x] T3.2 Mapeo del envelope RFC 7807 → `AppError` tipado (por campo)
  - **Exit criterion**: `src/lib/http/errors.ts` mapea `application/problem+json` (`type` `dsm:catalog/*`, `status`, `detail`, `errors[]`) a una unión `AppError` (`validation` con `fieldErrors`, `conflict`, `unauthorized`, `forbidden`, `notFound`, `network`, `server`); nunca filtra el body crudo a la UI; unit tests cubren 422 (por campo), 409, 401/403, 5xx, error de red.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/lib/http/errors`

- [x] T3.3 `categoriesService` (crear / listar / editar) + DTO↔dominio
  - **Exit criterion**: `src/features/categories/categoriesService.ts` envuelve el cliente HTTP para `POST/GET/PATCH /v1/admin/categories`; no envía `slug` (lo deriva el server); mapea DTO↔dominio; unit tests con MSW verdes.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/categories/categoriesService`

- [x] T3.4 `productsService` (crear / listar paginado / obtener / editar / publicar / archivar) + money mapping
  - **Exit criterion**: `src/features/products/productsService.ts` cubre `POST/GET/GET:id/PATCH /v1/admin/products`; el listado envía `limit`/`offset` y devuelve `pagination{limit,offset,total}`; publicar/archivar son `PATCH {status}`; `price_ars_cents` (centavos) se mapea a/desde el dominio; unit tests con MSW verdes.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/products/productsService`

- [x] T3.5 Helper de formato ARS (mismo en server y client, sin hydration mismatch)
  - **Exit criterion**: `src/lib/format/currency.ts` usa `Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0})` sobre `price_ars_cents/100` → `$ 12.500`; es puro y compartido por Server y Client Components; unit test cubre el redondeo entero.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/lib/format/currency`

## Fase 4: Seam de auth admin (AC-8 — OQ-FE-1 resuelta: opción A)

> **OQ-FE-1 resuelta** (`[Resolved: 2026-07-18 — opción A]`): la Fase 4 materializa una **página mínima de acceso admin** que postea al seam del backend (ADR-0009) y persiste el JWT `role=admin`. La arquitectura de auth del FE se construye para que US-014 la endurezca (cookie `httpOnly`, refresh rotado, 2FA) **sin reescribir** el guard ni los servicios (espeja ADR-0009).

- [x] T4.1 Sesión admin + almacenamiento del JWT + interceptor de token
  - **Exit criterion**: `src/features/auth/adminSession.ts` obtiene y persiste el JWT `role=admin` (según la opción confirmada en OQ-FE-1: login mínimo contra el seam, o entrada de bootstrap-token), lo expone al cliente HTTP (T3.1) y ofrece `signOut`; unit tests del flujo de sesión verdes.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/auth/adminSession`

- [x] T4.2 Página de acceso admin
  - **Exit criterion**: existe la ruta de acceso admin (Client Component) que ejecuta el flujo de OQ-FE-1 y, en éxito, redirige al panel; en fallo (401) muestra error accionable sin filtrar detalle; component test verde.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/auth`

- [x] T4.3 Guard del route group `(admin)` — redirige sin sesión (AC-8)
  - **Exit criterion**: el route group `app/(admin)/` está gated: sin sesión admin válida redirige a la página de acceso; ninguna pantalla del panel se renderiza para anónimo; el guard NO es la autoridad (el backend gatea server-side) — es UX; test cubre "anónimo → redirect".
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/auth/guard`

## Fase 5: Categorías — pantallas (AC-1)

- [x] T5.1 Estado + listado de categorías (unión discriminada `idle|loading|success|error`)
  - **Exit criterion**: `app/(admin)/categorias/page.tsx` renderiza el listado con estados explícitos (skeleton en loading, empty accionable, error con reintento); sin flags booleanos ni `if(data)` catch-all (§11.4/11.9); component test cubre los 4 estados.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/categories`

- [x] T5.2 Alta de categoría (nombre → slug server-side)
  - **Exit criterion**: formulario de alta (React Hook Form + Zod: `name` requerido no vacío); el `slug` no es campo editable; en éxito refresca el listado; 409 (slug duplicado) → banner + mensaje claro; component/integration test (MSW) cubre éxito y 409.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/categories`

- [x] T5.3 Edición de categoría
  - **Exit criterion**: formulario de edición precargado (`PATCH /v1/admin/categories/{id}`) que preserva el input en error de validación; 404 (categoría inexistente) → estado accionable; test cubre edición OK.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/categories`

## Fase 6: Productos — alta / edición + validación (AC-2, AC-3, AC-5, AC-9)

- [x] T6.1 Listado de productos con TanStack Table + paginación server-side (OQ-FE-3)
  - **Exit criterion**: `app/(admin)/productos/page.tsx` usa TanStack Table en `manualPagination` cableada a `limit`/`offset` de la API; muestra `pagination.total`; skeleton por página (no spinner de página completa); badge de estado (draft/published/archived) con texto+color (no solo color); tabla→cards en mobile; component test cubre carga + cambio de página.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/products/ProductList`

- [x] T6.2 Formulario de alta de producto en draft (AC-2) + validación cliente (AC-5)
  - **Exit criterion**: `app/(admin)/productos/nuevo/page.tsx` con React Hook Form + Zod espejo del DTO (`sku`,`name` requeridos; `price_ars_cents` derivado de `$>0`; `stock`≥0; `category_id` seleccionado de las categorías; `description_raw?`,`image_url?`); submit deshabilitado in-flight; en éxito feedback "creado en borrador — no visible hasta publicar"; component test cubre validación cliente + submit OK (MSW).
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/products/ProductForm`

- [x] T6.3 Formulario de edición de producto (AC-3)
  - **Exit criterion**: `app/(admin)/productos/[id]/page.tsx` precarga (`GET /v1/admin/products/{id}`) y edita precio/stock/descripción/categoría/`image_url` (`PATCH`); muestra el precio en `$` con "IVA incluido" (helper T3.5); "unsaved changes" al navegar con form dirty (§11.bis.6); component test cubre precarga + edición OK.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/products/ProductForm`

- [x] T6.4 Render del error 409 SKU duplicado (AC-9)
  - **Exit criterion**: al recibir 409 (`type: dsm:catalog/conflict`) en el alta, el FE pinta el mensaje en banner **y** bajo el campo `sku` con copy claro ("Ya existe un producto con ese SKU"); el input del usuario se preserva; integration test (MSW 409) verde.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/products/ProductForm`

- [x] T6.5 Render de los errores 422 por campo (AC-5) sin escritura parcial ni pérdida de input
  - **Exit criterion**: los `errors[]` del 422 se mapean a los campos correctos y se pintan inline con `aria-describedby`; el formulario **no** limpia el input ni aplica cambio optimista; resumen de errores arriba; integration test (MSW 422 multi-campo) verde.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/products/ProductForm`

## Fase 7: Productos — acciones de estado (AC-4, AC-6, AC-7)

- [x] T7.1 Acción "Publicar" (AC-4)
  - **Exit criterion**: acción en fila/detalle → `PATCH {status: published}`; feedback de éxito (toast `role="status"`) + refresco del estado a `published`; submit deshabilitado in-flight; component test cubre publicación OK.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/products`

- [x] T7.2 Publicar incompleto → surface de "qué falta", permanece draft (AC-6)
  - **Exit criterion**: si el backend responde 422 al publicar (falta nombre/precio/stock/categoría), el FE muestra **qué falta** (mapeado de `errors[]`) y el producto **permanece** en `draft` (sin cambio optimista falso — pesimista); integration test (MSW 422 publish-incomplete) verifica que el estado en UI no cambia a published.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/products`

- [x] T7.3 Acción "Archivar" con confirmación destructiva de dos pasos (AC-7)
  - **Exit criterion**: la acción abre un modal de confirmación de dos pasos (§11.bis.5: no cierra por click-outside, escribir/confirmar) → `PATCH {status: archived}`; el producto sale del listado activo (sin delete físico); foco gestionado en el modal (focus trap, Esc, foco vuelve al trigger); component test cubre confirmación + archivado OK y cancelación.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/products`

## Fase 8: Resiliencia, observabilidad y accesibilidad transversales

- [x] T8.1 Error boundary por ruta + skeleton + dedup de submit + cancelación
  - **Exit criterion**: cada route segment del panel tiene `loading.tsx` (skeleton) y `error.tsx` (boundary con reintento que reporta a Sentry, no silencia); los servicios cancelan con `AbortController` al desmontar; el submit deduplica (deshabilitado in-flight); test cubre el boundary con un fetch 5xx.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features && test -f apps/web/app/(admin)/error.tsx -o -f apps/web/app/error.tsx`

- [x] T8.2 Observabilidad FE — Sentry + eventos de negocio backoffice
  - **Exit criterion**: Sentry inicializado (errores + Web Vitals, per E2E §18); se emiten `bo_screen_shown`, `product_created`, `product_published`, `product_archived`, `category_created` con `operator_id` (pseudónimo) y `correlation_id` propagado; sin PII en dimensiones; unit test verifica que la acción de publicar emite `product_published`.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/lib/observability && grep -rq "product_published" apps/web/src`

- [x] T8.3 Accesibilidad — axe-core sin violaciones en las pantallas del panel
  - **Exit criterion**: test de accesibilidad con `axe-core`/`jest-axe` sobre listado, alta, edición y confirmación de archivar → 0 violaciones; teclado navegable; foco al `<h1>` al cambiar de ruta (design-system §11); color nunca único portador de estado.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features --grep a11y` (o el runner de axe configurado)

- [x] T8.4 Security headers (Next wiring) + sin `dangerouslySetInnerHTML` sin sanitizar
  - **Exit criterion**: `next.config.js`/`middleware.ts` fija CSP (report-only → enforce), HSTS, `X-Frame-Options: DENY`, `Referrer-Policy`, `X-Content-Type-Options: nosniff` (next-standards §8.bis); no hay `dangerouslySetInnerHTML` sin DOMPurify (§12.1).
  - **Verify**: `pnpm --filter @dsm/web build && ! grep -rn "dangerouslySetInnerHTML" apps/web/src apps/web/app 2>/dev/null | grep -v "DOMPurify"`

- [x] T8.5 Smoke E2E del happy path (red de seguridad del dev; la batería de aceptación es owned-by-QA)
  - **Exit criterion**: un spec Playwright estable (auto-waiting locators por rol, sin `waitForTimeout`) cubre: acceso admin → crear categoría → alta de producto en draft → publicar; corre contra `next build && next start`; verde.
  - **Verify**: `pnpm --filter @dsm/web test:e2e`

## Fase 10: Codegen del contrato FE↔BE (`frontend-standards` §3.1/§3.2 — obligatorio)

> **Añadida post-hoc (2026-07-25)** tras el pull del framework (G10). El plan original admitía
> "idealmente codegen, o espejo hand-written" — framing que trata una regla obligatoria como
> opcional y reintroduce drift silencioso. Los tipos/validación/mocks derivados del contrato
> ahora se GENERAN; lo hand-written es solo la lógica de servicio (§3.3).

- [x] T10.1 Wire del codegen (DTOs + Zod + MSW desde el OpenAPI del backend hermano)
  - **Exit criterion**: `apps/web/orval.config.ts` genera desde `apps/api/docs/api/openapi.yaml` los DTOs (`src/api/generated/model/`), los schemas Zod (`src/api/generated/zod.ts`) y los handlers MSW; script `codegen` en `package.json`; regenerar no produce diff.
  - **Verify**: `pnpm --filter @dsm/web codegen && git diff --quiet -- apps/web/src/api/generated`

- [x] T10.2 Contrato sub-especificado corregido en el OpenAPI del backend
  - **Exit criterion**: los schemas de respuesta (`Category`, `Product`, `ProductList`, `Problem`) declaran `required`, reflejando lo que el backend realmente devuelve (`ProductResponseDto` — todos los campos presentes; `description_raw`/`image_url`/`parent_id` nullable). Sin `required` el codegen emitía todo opcional y el tipado se volvía inútil.
  - **Verify**: `grep -q "required: \[id, slug, name, parent_id, created_at\]" apps/api/docs/api/openapi.yaml`

- [x] T10.3 Espejos hand-written eliminados + validación runtime en el borde
  - **Exit criterion**: `productsService.ts` y `categoriesService.ts` importan y re-exportan los tipos generados (ninguna `interface` del contrato declarada a mano) y validan cada respuesta con el schema Zod generado vía `parseContract` (`src/lib/http/contract.ts`); fixtures de test normalizados al contrato (ids UUID válidos — los previos habrían fallado contra la API real).
  - **Verify**: `pnpm --filter @dsm/web test -- --run && pnpm --filter @dsm/web typecheck`

- [x] T10.4 Gate de CI `frontend-codegen-fresh`
  - **Exit criterion**: `.github/workflows/frontend-codegen-fresh.yml` reejecuta el codegen en PR y falla ante cualquier diff en `apps/web/src/api/generated` (el gate que `frontend-standards` §3.2.3 promete).
  - **Verify**: `test -f .github/workflows/frontend-codegen-fresh.yml`

## Documentación

- [x] T9.1 `apps/web/README.md` — reemplazar el placeholder
  - **Exit criterion**: `apps/web/README.md` documenta cómo correr la app (`pnpm --filter @dsm/web dev`), la var `NEXT_PUBLIC_API_BASE_URL`, el seam de auth admin (referencia a ADR-0009), y el scope (panel del dueño); sin quedar el texto placeholder original (per documentation-standards §11.1).
  - **Verify**: `! grep -q "Placeholder" apps/web/README.md && grep -q "NEXT_PUBLIC_API_BASE_URL" apps/web/README.md`

## Verification (suite-level)
- [x] Unit + component + integration verdes: `pnpm --filter @dsm/web test -- --run`
- [x] Lint limpio: `pnpm --filter @dsm/web lint`
- [x] Typecheck limpio: `pnpm --filter @dsm/web typecheck`
- [x] Build de producción OK: `pnpm --filter @dsm/web build`
- [x] Smoke E2E verde: `pnpm --filter @dsm/web test:e2e`
- [x] Accesibilidad (axe-core) sin violaciones: componentes del panel (CategoryForm, ProductForm, CategoriesList, ProductActions) **y** pantallas completas con landmarks activos (ProductList, CategoriesPage).
- [x] Codegen del contrato en sync: `pnpm --filter @dsm/web codegen` no produce diff.
