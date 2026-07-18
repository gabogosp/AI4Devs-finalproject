---
tracker-id: null
tracker-source: null
parent-us: US-001
discipline: frontend-web
variant: null
language: es
---

# US-001 Frontend Web — Panel del dueño: catálogo de productos y categorías (Next.js)

## Why

El dueño (Pedro) necesita cargar y mantener el catálogo desde un panel de administración: es la base sobre la que se apoyan el browse (US-002), la ficha (US-003), la búsqueda IA (US-004/005) y la compra. Sin catálogo cargado no hay tienda. US-001 es la primera US del ciclo 1 y bloquea a US-002/US-003/US-005/US-006.

El change de infraestructura `bootstrap-local` ya entregó el sustrato (monorepo runnable, `docker-compose`, esquema `@dsm/db`) y el change de backend (`US-001-admin-catalogo-productos-backend`) ya entregó la **API REST de administración** (`/v1/admin/categories`, `/v1/admin/products`) con máquina de estado, validación por campo RFC 7807 y guard RBAC admin. Lo que falta —y es lo que este change entrega— es la **superficie que consume esa API**: el **panel del dueño** en `apps/web` (Next.js App Router), hoy un placeholder vacío. Ese panel materializa el listado paginado de productos (TanStack Table), los formularios de alta/edición de productos y categorías, y las acciones de estado (publicar / archivar), respetando el `design-system.md` `Approved` como fuente de verdad visual (no hay Figma).

Este es el primer código de la app `apps/web`. La primera cadena de tasks scaffoldea la app Next.js dentro del monorepo pnpm existente (`create-next-app`, cross-reference del `bootstrap-local` marcado ahí como owned-by-FE) y la cablea al `.env.example` de Fase 0. El storefront público, la búsqueda IA, el carrito y el checkout **no** son de esta US.

## What changes

- **Scaffolding de `apps/web`** (`@dsm/web`): app Next.js 15 (App Router, TypeScript `strict`) dentro del monorepo pnpm, con Tailwind CSS + ShadCN UI + TanStack Table + React Hook Form + Zod, tokens del `design-system.md` mapeados a `tailwind.config.ts` + CSS vars (capa de alias semánticos §12.1), fuente Inter vía `next/font`, `<html lang="es-AR">`, scripts `dev`/`build`/`lint`/`typecheck`/`test`/`test:e2e`.
- **Cliente HTTP centralizado + interceptores** (`frontend-standards.md` §8, §11.1): un único cliente que inyecta `Authorization: Bearer <JWT admin>`, propaga `traceparent`, aplica timeout y mapea el envelope RFC 7807 (`type: dsm:catalog/*`, `errors[]` por campo) a un `AppError` tipado (§11.3). Los componentes nunca llaman `fetch` directo.
- **Capa de repositorio/servicio por recurso** (§11.5): `categoriesService` (crear / listar / editar) y `productsService` (crear / listar paginado / obtener / editar / publicar / archivar) que envuelven el cliente HTTP y mapean DTO ↔ dominio (money `price_ars_cents` centavos ↔ display `$`).
- **State holders con unión discriminada** (§11.4, §11.9): estados `idle | loading | success | error` explícitos para el listado y para cada formulario; sin flags booleanos ni `if (data)` catch-all.
- **Rutas del panel** (App Router, backoffice — §11.bis): `/(admin)/productos` (listado TanStack Table + acciones), `/(admin)/productos/nuevo` (alta), `/(admin)/productos/[id]` (edición + publicar/archivar), `/(admin)/categorias` (listado + alta + edición). Route group gated por el seam de auth admin.
- **Seam de auth admin en el FE** (AC-8 + ADR-0009): página mínima de acceso admin que obtiene el JWT `role=admin` contra el seam del backend (`ADMIN_AUTH_ENABLED` / `ADMIN_BOOTSTRAP_TOKEN`); guard de route group que redirige a esa página sin sesión. **Ver Open question OQ-FE-1** — el mecanismo exacto de emisión del token es la única pregunta abierta.
- **Formularios con validación cliente** (§11.bis.6): reglas espejo de los DTO del backend (precio > 0, stock ≥ 0, requeridos no vacíos, categoría seleccionada) con Zod + React Hook Form; los errores 422 por campo del backend se pintan inline bajo cada campo, los errores 409 (SKU/slug duplicado) en banner + campo. La validación cliente es UX; el backend es la autoridad (§12.2).
- **Resiliencia** (`frontend-resilience-patterns`): skeleton en el listado y en la carga de detalle; error boundary con reintento por ruta; deduplicación de submit (deshabilitar durante in-flight); `AbortController` al navegar; formato ARS con el mismo helper en server y client (evita hydration mismatch).
- **Accesibilidad WCAG 2.1 AA** (US §9, design-system §11): roles/labels, navegación por teclado del listado y formularios, focus ring visible, foco gestionado al cambiar de ruta/paso, confirmación destructiva de dos pasos para archivar, tabla→cards en mobile, color nunca como único portador de estado.
- **Observabilidad FE** (`observability-patterns` §9.5, §11.bis.8): Sentry (errores + Web Vitals) + eventos de negocio de backoffice (`bo_screen_shown`, `product_created`, `product_published`, `product_archived`, `category_created`) con `operator_id` (pseudónimo) y `correlation_id` propagado.
- **Tests owned-by-dev** (`qa-frontend-standards.md` §2.1): unit de state holders / helpers / mappers (Vitest), component con RTL + userEvent, integración con MSW mockeando el contrato de la API. La suite de aceptación cross-funcional (Playwright, batería de AC) es owned-by-QA (`QA-US-001`), fuera de este change; este change deja un smoke E2E mínimo del happy path como red de seguridad del dev.

## ACs de US-001 cubiertos (superficie FE)

Este change cierra la **superficie de usuario** de los ACs FE-relevantes. La regla de negocio y la autoridad viven en el backend; acá se entrega la pantalla, el formulario, el estado y el mapeo del error a la UI.

| AC | Qué cubre este change (FE) | Nota |
|---|---|---|
| **AC-1** | Pantalla de categorías: crear (nombre → el slug lo deriva el server), listar, editar | el slug no es campo editable en el FE (lo deriva el backend) |
| **AC-2** | Formulario de alta de producto; se crea en `draft`; feedback de "borrador — no visible aún" | el estado inicial `draft` lo fija el backend |
| **AC-3** | Formulario de edición: precio, stock, descripción, categoría, imagen (`image_url`); display en `$` con IVA incluido | el upload de imagen a R2 es infra/FE avanzado — acá se acepta/edita la `image_url` |
| **AC-4** | Acción "Publicar" en la fila/detalle → `PATCH {status: published}`; feedback de éxito y refresco del estado | |
| **AC-5** | Validación cliente espejo del DTO + render inline de los `errors[]` del 422 por campo; sin perder el input | validación cliente = UX; backend = seguridad (§12.2) |
| **AC-6** | Intento de publicar incompleto → 422; el FE muestra **qué falta** y el producto **permanece** en draft (sin cambio optimista falso) | la completitud la decide el backend; el FE la surface |
| **AC-7** | Acción "Archivar" con **confirmación destructiva de dos pasos** (§11.bis.5) → `PATCH {status: archived}`; sale del listado activo, sin delete físico | |
| **AC-8** | El panel es admin-only: route group gated; sin sesión admin → redirige a la página de acceso; ninguna operación de administración expuesta a anónimo | la autoridad es el guard server-side del backend; el FE es UX (ver OQ-FE-1) |
| **AC-9** | SKU duplicado en alta → 409; el FE lo pinta en banner + bajo el campo `sku` con copy claro | |

**AC-10** (el cambio de precio no altera ventas pasadas) **no** tiene superficie FE en US-001: no hay tabla de órdenes ni pantalla de historial todavía; se verifica end-to-end cuando exista checkout. Se anota como fuera de alcance FE de esta US.

## Out of scope

- **Storefront público, navegación por categorías, ficha de producto, búsqueda IA, carrito, checkout** → US-002/US-003/US-004/US-005. Este change entrega **solo** el panel del dueño.
- **Upload de imágenes a Cloudflare R2** (presigned URL, recorte, múltiples imágenes) → fuera de v1; en esta US el formulario acepta/edita una `image_url` ya resuelta (coherente con el backend, que solo persiste `image_url`).
- **Import masivo CSV/Excel** (`upload` + progreso por fila) → US-006. **Enriquecimiento IA de descripciones** → US-005 (acá la descripción se carga/edita manual).
- **Panel de órdenes, fulfillment, métricas/Recharts** → US posteriores (E2E §9.4, cap. 9). Este change es solo el CRUD de catálogo.
- **AuthModule completo del FE** (registro de clientes, login con cookie `httpOnly`, refresh rotado, 2FA, "mi cuenta") → **US-014**. Este change entrega **solo** el seam mínimo de acceso admin (ADR-0009); ver OQ-FE-1.
- **Modo oscuro** → excluido del MVP por decisión del design-system (§14). La capa de alias semánticos §12.1 se deja lista para habilitarlo sin reescribir componentes, pero el tema dark no se implementa.
- **Nuevas tablas/columnas de esquema o cambios de contrato de API**: ninguna. Este change **consume** el contrato OpenAPI del backend tal como está; si necesitara un cambio de contrato, se detiene y se escala al backend (no se redefine acá).
- **El primer deploy vivo de `apps/web`** → `/plan-deployment` cuando la app esté scaffoldeada (coincide con el gate del change `platform-cloud`).

## Standards consultados

- `spekode/docs/base-standards.md` — principios core, KISS/YAGNI, vocabulario prescriptivo, §2.4 (idioma de artefactos: markers en inglés, prosa en español).
- `spekode/docs/code/frontend-standards.md` — §2 (package-by-feature), §3 (consumo de API + service layer hand-written + DTO↔dominio), §4 (auth/token), §5 (taxonomía de error + mapeo de códigos backend), §7 (observabilidad/Sentry), §8 (cliente HTTP centralizado + interceptores), §9 (state management unidireccional + state holder por feature), §10 (testing), **§11 (Implementation Patterns 11.1–11.9)**, **§11.bis (Backoffice extensions)**, §12 (seguridad — validación cliente=UX/server=seguridad, secretos fuera del bundle, headers, sin `dangerouslySetInnerHTML`).
- `spekode/docs/code/frontend-next-standards.md` (overlay Next) — §1 (App Router), §2 (Server/Client Components), §3 (data fetching + caching explícito), §4 (Server Actions / mutations con validación + authz), §6 (Metadata API, `next/image`, `next/font`), §7 (performance budgets), §8 (env/secrets, `NEXT_PUBLIC_`), §8.bis (security headers), §9 (testing overlay), §10 (anti-patterns).
- `spekode/docs/architecture/api-standards.md` — §5.5 (money), §6.1 (paginación offset), §8 (envelope RFC 7807 + `errors[]`), `traceparent`.
- `spekode/docs/quality/testing-standards.md` §14 + `qa-frontend-standards.md` §2.1 (ownership dev vs QA), §23 (Vitest+Playwright), §24 (BDD — solo referencia; la batería BDD es owned-by-QA).
- `spekode/docs/ai/documentation-standards.md` §11.1 (docs obligatorias) — README de `apps/web`.
- Skills: `openspec-workflow` (change 3-file + tasks closure-grade), `fe-design-without-figma` (design-system como fuente visual), `frontend-resilience-patterns` (skeleton, error boundary, dedup, cancel, optimistic+rollback), `msw-setup` (mock del contrato en tests de integración), `playwright-stability` (smoke E2E estable), `observability-patterns` §9.5 (eventos FE canónicos).
- ADRs heredados: **ADR-0009** (seam de auth admin US-001 — base de OQ-FE-1), ADR-0005 (auth propia JWT — endurece el seam en US-014), ADR-0007 (monolito modular — el FE consume su API), ADR-0001 (Railway/Neon/R2 — money en centavos, secretos de plataforma), ADR-0002 (pgvector — irrelevante al FE salvo por el contrato).

## Open questions

- **OQ-FE-1 — ¿Cómo obtiene el panel del dueño el JWT `role=admin` en US-001?** `[Resolved: 2026-07-18 — opción A: login admin mínimo contra el seam del backend]` El backend gatea `/v1/admin/*` con un JWT `role=admin` emitido por el **seam mínimo** de ADR-0009 (`AdminAuthService` detrás de `ADMIN_AUTH_ENABLED` / `ADMIN_BOOTSTRAP_TOKEN`), pero el **login completo (US-014)** todavía no existe. **Decisión**: opción **A** — una **página mínima de acceso admin** que postea credenciales/bootstrap-token al seam y guarda el JWT resultante, con la capa de auth del FE (cliente HTTP + interceptor de token + guard de route group) construida de forma que US-014 la **endurezca** (cookie `httpOnly`, refresh rotado, 2FA) **sin reescribir** el guard ni los servicios, espejando exactamente ADR-0009 en el backend. Descartadas: (B) entrada de bootstrap-token puro (menos UX, sin form) y (C) gatear todo detrás de US-014 (invierte el DAG). La Fase 4 se ejecuta contra la opción A. Referencia: ADR-0009 y OQ-1 del backend (`openspec/changes/US-001-admin-catalogo-productos-backend/proposal.md`).
- **OQ-FE-2 — ¿Server Components + Server Actions o cliente HTTP client-side para las mutaciones del panel?** `[Resolved: 2026-07-18 — cliente HTTP centralizado client-side contra la API NestJS]` El overlay Next prefiere Server Actions para mutaciones, pero el backend ya expone una API REST versionada (`/v1/admin/*`) que es el contrato de integración. Para US-001 el panel consume esa API vía el **cliente HTTP centralizado** (`frontend-standards.md` §8) desde Client Components donde hay interactividad (tabla, formularios), reservando Server Components para el shell/layout y la carga inicial SSR del listado. Las Route Handlers de Next se evitan como proxy (duplicarían el contrato). Decisión consciente: no se re-implementa la API como Server Actions; el contrato canónico es el OpenAPI del backend.
- **OQ-FE-3 — ¿Paginación server-side desde el día 1?** `[Resolved: 2026-07-18 — sí, offset wired a la API]` El NFR pide ≥5.000 SKUs sin degradación y la API ya pagina (`limit`/`offset`, `pagination{limit,offset,total}`). El listado del panel usa paginación **server-side** cableada a esos parámetros desde el inicio (TanStack Table en modo `manualPagination`), no client-side. Coherente con §11.bis.7 (server-side cuando >1000 filas).

## References

- User Story: `docs/user-stories/US-001-admin-catalogo-productos.md`
- E2E: `docs/product/design-e2e.md` §6.2 (Web App components — Panel del dueño), §13 (deployment), §17 (NFRs), §18 (observabilidad), §19 (testing L2 FE), §20 (ADRs)
- Design system (fuente visual, NO se redefine): `docs/product/design-system.md` (`Approved`) — §7.1/7.2 (Button/Input), §7.9 (Table backoffice), §7.4 (PriceTag ARS), §11 (a11y), §12.1 (contrato de tokens)
- Contrato de API que consume este change (NO se redefine): `apps/api/docs/api/openapi.yaml` + `openspec/changes/US-001-admin-catalogo-productos-backend/contracts/openapi/*.yaml` + su `design.md`
- Change de backend hermano (la API): `openspec/changes/US-001-admin-catalogo-productos-backend/`
- Change de infra hermano (sustrato + `.env.example`): `openspec/changes/US-001-admin-catalogo-productos-bootstrap-local-infrastructure/`
- ADRs: `docs/architecture/decisions/0009-admin-auth-seam-us001.md`, `0005-own-jwt-authentication.md`, `0007-modular-monolith-nestjs.md`, `0001-platform-railway-neon-r2.md`
