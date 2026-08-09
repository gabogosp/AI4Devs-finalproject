---
parent-us: US-001
discipline: qa
variant: null
language: es
---

# US-001 QA — Design (arquitectura de la suite cross-stack)

## Context

El E2E (`Approved`) §19 fija el modelo de 3 capas (`qa-three-layer-regression`). Las capas 1 (backend-isolated) y 2 (frontend-isolated) ya las entregaron los devs vía TDD dentro de sus changes de disciplina. Este change materializa la **capa 3 (cross-stack)**: el FE real contra la API real, la regression suite viva de la capacidad catálogo, la carga y el exploratorio. No re-arquitectura nada de producto; define la **arquitectura de la suite de QA** y la ancla a los artefactos ya existentes (contrato OpenAPI, esquema `@dsm/db`, seam de auth ADR-0009).

El stack no tiene Go (`project-config.yml`: BE=NestJS/Node, WEB=Next.js), así que **godog no aplica**. La aceptación BDD usa **Cucumber.js + Playwright** (`qa-frontend-standards.md` §24); la carga usa **k6**; el barrido funcional de API usa **Newman**; el E2E de navegador usa **Playwright** (`playwright-stability`).

## Goals

- Certificar los 10 ACs de US-001 de punta a punta (AC-1..AC-9 activos; AC-10 diferido con escenario escrito).
- Materializar la regression suite estable (L3) con las 4 categorías canónicas (Happy / Corner / Negative / Cross-feature).
- Validar la costura FE↔BE contra la **API real** (lo que el dev-L2 contra MSW no cubre).
- Cargar `GET /v1/admin/products` contra el NFR ≥5.000 SKUs con thresholds atados al NFR.
- Determinismo y anti-flake de primera clase (`flakiness-detection`, `playwright-stability`).

## Non-goals

- Re-autoría de cualquier test owned-by-dev (unit/component/integration/contract-provider/e2e-nest/smoke).
- Arreglar el gap del controller de login (backend; ver OQ-QA-1) o levantar el entorno cloud (infra; OQ-QA-2).
- Batería de relevancia de IA (US-004/005), checkout/órdenes (AC-10 se activa ahí).

## Approach

### Estructura del paquete (a scaffoldear)

Paquete workspace nuevo `@dsm/qa` en la raíz del monorepo (no dentro de `apps/*`, porque cruza disciplinas):

```
qa/                                   # @dsm/qa — suite cross-stack owned-by-QA (Layer 3)
├── package.json                      # cucumber, @playwright/test, newman, k6 (binario), tsx
├── acceptance/                       # BDD legible por el dueño/PO
│   ├── features/
│   │   ├── catalogo-ciclo.feature        # Happy: ciclo completo (AC-1..AC-4, AC-7)
│   │   ├── catalogo-publicacion.feature  # Negative/Corner: publicar incompleto (AC-6)
│   │   ├── catalogo-validacion.feature    # Negative: validación por campo (AC-5, AC-9)
│   │   └── catalogo-acceso.feature        # Negative: RBAC (AC-8)
│   ├── steps/                        # step defs (browser vía Playwright, o API vía APIRequest)
│   │   ├── world.ts                  # contexto por-escenario (aislado, sin estado global)
│   │   ├── auth.steps.ts
│   │   ├── categorias.steps.ts
│   │   └── productos.steps.ts
│   └── cucumber.mjs                  # runner (strict, tags)
├── e2e/                              # Playwright browser → API real (costura FE↔BE)
│   ├── seam-errores.spec.ts          # 422→inline, 409→banner, 401→redirect
│   └── ciclo-visual-a11y.spec.ts     # axe-core sobre las 4 pantallas
├── functional/                       # Newman → servicio corriendo (black-box)
│   └── catalogo-admin.postman_collection.json  # barrido RBAC + forma de contrato
├── performance/                      # k6
│   ├── lib/thresholds.js             # budgets atados al NFR (fuente única)
│   ├── data/seed-skus.js             # generador determinista de ≥5.000 SKUs
│   ├── baseline.js                   # perfil declarado
│   └── stress.js                     # rampa para hallar el knee
└── support/
    ├── admin-auth.ts                 # fixture de auth (login real | fallback JWT minteado)
    ├── seed.ts                       # sembrado determinista vía API (categorías + productos)
    └── builders.ts                   # builders de test data (defaults deterministas)
```

### Mapeo a las 3 capas (`qa-three-layer-regression`)

| Capa | Dónde | Owner | Este change |
|---|---|---|---|
| L1 backend-isolated | `apps/api/src/**/*.spec.ts` | Backend dev (TDD) | ❌ referenciado, no autorado |
| L2 frontend-isolated | `apps/web/src/**/*.test.ts` + `apps/web/e2e/smoke.spec.ts` | Frontend dev (TDD) | ❌ referenciado, no autorado |
| **L3 cross-stack** | `qa/**` | **QA** | ✅ **este change** |

Regla de dependencia: L3 no corre sin L1 + L2 verdes de ambos changes de disciplina. El fixture de seed y auth asume la API viva (o el fallback de JWT minteado).

### Auth fixture (OQ-QA-1 — el gap de la costura de login)

`qa/support/admin-auth.ts` resuelve el token `role=admin` con precedencia:

1. **Login real** — `POST /v1/admin/auth/login` con el bootstrap token. **Bloqueado hoy**: no existe el controller (`AdminAuthService` tiene `loginWithBootstrap`/`issueAdminToken` a nivel servicio, sin ruta HTTP). Se activa cuando el backend lo exponga.
2. **Fallback test-only** — mintea un JWT `role=admin` firmado con el `JWT_SECRET` compartido (mismo claim/contrato que `issueAdminToken`), inyectado en el header del interceptor FE (via `localStorage`/sessionStorage seed antes de navegar) y en el `Authorization` de Newman/k6. Desbloquea **todos los endpoints gateados ahora**.

**Actualizado 2026-07-25**: el escenario "login real por la página `/acceso`" ya **no** está bloqueado — el backend expuso `POST /v1/admin/auth/login` (change backend, Fase 9), declarada en el contrato y verificada contra la API viva. El fixture resuelve por la rama de **login real**; el fallback de JWT minteado queda como red para entornos sin `ADMIN_BOOTSTRAP_TOKEN`.

### Test data y determinismo (`testing-standards.md` §5, §14.3, §14.8)

- **Solo datos sintéticos**, sembrados vía la API real en `support/seed.ts` (no `INSERT` directo — respeta la máquina de estado y las validaciones, y prueba el camino real de alta).
- **Builders con defaults deterministas** (`support/builders.ts`): `nuevaCategoria({...})`, `nuevoProducto({...})` — sin `Date.now()`/`Math.random()` salvo el prefijo único por-run del SKU (para idempotencia entre corridas, no aserción sobre el valor).
- **Idempotencia**: cada escenario siembra lo que necesita y limpia lo que crea (o usa prefijos únicos por-run); ningún escenario depende del residuo de otro (`qa-three-layer-regression` anti-pattern de orden).
- **Money**: `price_ars_cents` entero en centavos en el wire; los builders y aserciones espejan `$>0 → cents≥1` (coherente con el contrato y el helper ARS del FE).

### Carga k6 (NFR ≥5.000 SKUs — `k6-load-scaffolding` + `nfr-quantification`)

`GET /v1/admin/products` es el endpoint bajo el NFR "listado paginado/ordenable sin degradación con ≥5.000 SKUs" (US §9, E2E §17 lectura <300ms). El deliverable de la carga es probar que el índice `products(category_id, status)` + paginación offset lo mantienen bajo con el dataset grande.

- **Modelo abierto** (`ramping-arrival-rate`/`constant-arrival-rate`): el RPS lo dicta el executor, no el response time.
- **Perfil**: backoffice de un solo admin → RPS bajo (baseline ~10 rps sostenido, stress hasta ~50 rps para hallar el knee) — el foco es el **tamaño del dataset** (≥5.000 SKUs sembrados), recorriendo distintos `offset`/páginas con `SharedArray`, no la concurrencia.
- **Thresholds (fuente única en `lib/thresholds.js`, atados al NFR)** `[propuesto — confirma Arquitecto post-load-test]`:
  - `http_req_duration{endpoint:list_products}`: `p(95)<300`, `p(99)<800`.
  - `http_req_failed`: `rate<0.01`.
  - `checks`: `rate>0.99` (status 200 + `pagination.total >= 5000` + `data.length <= limit`).
- **Gate**: exit code no-cero en breach; smoke-load (1-2 VUs, ~1min) en PR CI, baseline on-demand/nightly. Nunca contra producción (OQ-QA-2).

### Accesibilidad (WCAG 2.1 AA — `qa-frontend-standards.md` §19)

axe-core sobre las 4 pantallas del panel (`/acceso`, `/(admin)/categorias`, `/(admin)/productos`, `/(admin)/productos/nuevo|[id]`) corriendo contra la API real (no MSW): 0 violaciones AA. Complementa —no duplica— el `jest-axe` del dev (que corre contra render aislado); acá se valida el árbol de accesibilidad con datos reales y foco gestionado al navegar entre rutas SPA.

### Anti-flake (`flakiness-detection`, `playwright-stability`)

- **Cero `waitForTimeout`/sleeps**: auto-waiting de Playwright + aserción sobre el estado siguiente; `extendedWait` solo con condición nombrada.
- **Selectores por rol/label** (`getByRole`/`getByLabel`), `getByTestId` como último recurso; nunca CSS posicional ni `nth()`.
- **Aislamiento por escenario**: contexto Cucumber en `world.ts` (sin estado global de paquete), datos sembrados y limpiados por escenario.
- **Retries**: 0 local, ≤2 en CI (cushion de infra), nunca como máscara de flake.
- **k6 determinista**: `SharedArray` read-only, sin tokens hardcodeados (auth en `setup()`), warm-up separado del steady-state.

## Seguridad — negative-space desde STRIDE (E2E §14, `threat-modeling-lite`)

El barrido RBAC deriva de la superficie STRIDE de endpoints admin (E2E §14: *Elevation of privilege* → JWT `role=admin` + guard). Negative-space cubierto:
- **No exposición sin auth**: anónimo → 401 en todas las rutas `/v1/admin/*` (no solo el happy).
- **No elevación**: JWT con rol ≠ admin → 403.
- **No escritura parcial**: 422 de validación no crea ni modifica el recurso.
- **No doble efecto**: SKU duplicado → 409 y no crea un segundo producto.
- **No fuga de esquema**: el error nunca expone stack/SQL/Prisma crudo (forma RFC 7807 verificada en la batería funcional).

## Trade-offs

- **Cucumber.js + Playwright vs Playwright-test con estructura Gherkin**: se elige Cucumber.js para que los `.feature` sean legibles por el dueño/PO (valor real de BDD, `bdd-scenario-quality`); el costo es un runner extra. Los E2E de costura pura (mapeo de error) que no aportan a un lector no-técnico van en Playwright-test directo, no en Gherkin.
- **Fallback de JWT minteado vs esperar al controller**: se mintea para no bloquear la certificación de los endpoints gateados hoy; el costo es que la costura de login real queda diferida. Alternativa (bloquear todo hasta el controller) invertiría el valor del change.
- **Newman (funcional API) además del e2e-nest del dev**: no es duplicación — el e2e-nest es caja blanca in-process (TestingModule+supertest); Newman es caja negra contra el servicio corriendo, que es el gate de aceptación real. Se acota a barrido RBAC + forma de contrato para no re-testear la lógica ya cubierta.
- **Carga en local/CI vs prod-shaped**: forzado por la ausencia de cloud (OQ-QA-2); los números quedan propuestos y se re-miden en `pre-uat`.

## Open questions

- **OQ-QA-1** `[Resolved: 2026-07-25 — DESBLOQUEADA el mismo día: el backend expuso POST /v1/admin/auth/login (change backend, Fase 9). El fixture adminAuth resuelve por login REAL; el fallback de JWT minteado queda como red para entornos sin bootstrap token]` Ver proposal §Open questions.
- **OQ-QA-2** `[Deferred: k6 en local/CI, umbrales propuestos re-medidos en prod-shaped — owner: Arquitecto/QA, revisit: al provisionar platform-cloud (pre-uat)]` — carga sin cloud vivo.
- **OQ-QA-3** `[Resolved: Tier 2 derivado]` — sin `service-catalog.yaml`; Tier 2 asumido (backoffice fundacional), cobertura alta en caminos críticos.

## References

- Proposal: `./proposal.md`
- User Story: `docs/user-stories/US-001-admin-catalogo-productos.md`
- E2E: `docs/product/design-e2e.md` §14, §17, §18, §19
- Contrato: `apps/api/docs/api/openapi.yaml`
- Changes hermanos: `openspec/changes/US-001-admin-catalogo-productos-{backend,frontend-web}/`
- Standards: `testing-standards.md`, `qa-backend-standards.md`, `qa-frontend-standards.md`, `performance-standards.md`, `api-standards.md`
- Skills: `qa-three-layer-regression`, `bdd-scenario-quality`, `playwright-stability`, `k6-load-scaffolding`, `nfr-quantification`, `flakiness-detection`
- ADRs: `0009-admin-auth-seam-us001.md`, `0005-own-jwt-authentication.md`
