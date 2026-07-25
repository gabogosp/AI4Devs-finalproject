---
tracker-id: null
tracker-source: null
parent-us: US-001
discipline: qa
variant: null
language: es
---

# US-001 QA — Suite cross-stack de aceptación y regresión del admin de catálogo

## Why

US-001 entrega el admin de catálogo del dueño (Pedro): la base sobre la que se apoyan el browse (US-002), la ficha (US-003), la búsqueda IA (US-004/005) y la compra. Es la primera US del ciclo 1 y bloquea a US-002/003/005/006, así que su comportamiento tiene que quedar blindado por una **red de regresión estable** que sobreviva a todas las US que toquen el catálogo después.

Los dos changes de disciplina ya entregaron su capa de tests **owned-by-dev** (TDD): el backend (`US-001-admin-catalogo-productos-backend`) tiene unit (máquina de estado, validaciones), integration (Testcontainers, Postgres real) y e2e-nest (supertest, en proceso) del `AdminGuard`, la validación 422 por campo, el 409 de SKU/slug y las transiciones publicar/archivar; el frontend (`US-001-admin-catalogo-productos-frontend-web`) tiene unit (mappers, state holders, `AppError`), component (RTL) e integration contra MSW (mock del contrato), más un smoke Playwright del happy path (con la red mockeada en el borde del browser).

Lo que **falta** —y es lo que este change QA entrega— es la **capa 3 cross-stack** (`qa-three-layer-regression`): la batería de aceptación que ejercita el **FE real contra la API real** (no contra un mock), certifica cada AC de US-001 de punta a punta, valida el mapeo del contrato RFC 7807 en la costura FE↔BE (que ni el e2e-nest en proceso ni el FE-contra-MSW cubren), y añade la carga (k6 sobre el NFR ≥5.000 SKUs), la accesibilidad integrada y los charters de exploratorio. Esta es la casa de la **regression suite** de la capacidad catálogo.

## What changes

- **Paquete de QA cross-stack** (`@dsm/qa`, nuevo en el monorepo pnpm): estructura `qa/{acceptance,e2e,functional,performance,support}` con las suites owned-by-QA, sus fixtures (auth admin, seed determinista, builders) y sus scripts (`test:acceptance`, `test:e2e`, `test:functional`, `test:load`) cableados a la CI.
- **Batería de aceptación BDD** (Cucumber.js + Playwright): los ACs de US-001 expresados en `.feature` legibles por el dueño/PO, con step definitions que manejan el navegador contra la API viva. Cubre el ciclo completo del catálogo (acceso → categoría → producto draft → publicar → archivar) y los caminos alternativos (publicar incompleto, SKU duplicado, RBAC).
- **E2E cross-stack de la costura FE↔BE** (Playwright, browser → API real): valida el mapeo del contrato que el dev-L2 (FE contra MSW) **no** ejercita contra la API real — 422 → errores inline por campo, 409 → banner + campo, 401 → redirect a `/acceso`, publicar-incompleto → permanece draft sin optimismo falso.
- **Batería funcional de API** (Newman / colección Postman, black-box contra el servicio corriendo): el barrido RBAC (401/403) y la certificación de forma del contrato como **gate de aceptación** contra el servicio desplegado — distinta del e2e-nest in-process del dev (caja negra vs caja blanca).
- **Plan de carga k6** para `GET /v1/admin/products` contra el NFR **≥5.000 SKUs sin degradación** (US §9, E2E §17): baseline + stress con thresholds derivados (`p95<300ms`, `p99<800ms`, `error_rate<1%`) `[propuesto — confirma Arquitecto]`.
- **Accesibilidad integrada** (axe-core sobre las 4 pantallas del panel corriendo contra la API real, WCAG 2.1 AA — US §9) y **charters de exploratorio** para las áreas de mayor riesgo (máquina de estado, validación por campo, costura de auth).
- **Regression suite estable** (Layer 3) con las 4 categorías canónicas (Happy / Corner / Negative / Cross-feature) — el contrato de comportamiento vivo de la capacidad catálogo, orquestable por QA en cada change futuro que la toque.

## ACs de US-001 cubiertos (capa 3 — cross-stack)

Este change **no re-testea** lo que el dev ya cubrió en L1/L2 (evita el anti-pattern de duplicación `qa-three-layer-regression`); certifica cada AC **de punta a punta** contra el sistema corriendo.

| AC | Cobertura QA (L3) | Ya cubierto por dev (nota, no se re-autora) |
|---|---|---|
| **AC-1** crear categoría (slug único) | Aceptación BDD + funcional API | unit slug + e2e-nest categorías |
| **AC-2** alta producto en draft | Aceptación BDD (ciclo) + E2E FE | e2e-nest create + FE component form |
| **AC-3** editar producto | Aceptación BDD + E2E FE | e2e-nest update + FE form |
| **AC-4** publicar producto que cumple | Aceptación BDD (ciclo) + E2E FE | unit state machine + e2e-nest publish |
| **AC-5** validación por campo → 422 | E2E FE (seam 422→inline) + funcional API | e2e-nest validation + FE-MSW |
| **AC-6** publicar incompleto → permanece draft | Aceptación BDD + E2E FE (seam) | unit state machine + e2e-nest |
| **AC-7** archivar (no borrar) | Aceptación BDD (ciclo) + E2E FE (confirm 2 pasos) | e2e-nest archive + FE modal |
| **AC-8** acceso restringido (401/403) | Funcional API (barrido RBAC) + E2E FE (redirect) | e2e-nest RBAC + FE guard |
| **AC-9** SKU único → 409 | E2E FE (seam 409→banner) + funcional API | e2e-nest 409 + FE-MSW |
| **AC-10** precio no altera ventas pasadas | **Diferido** — sin superficie en US-001 | cubierto-por-diseño (BE) |

**AC-10** no tiene superficie ejercitable en US-001 (no existe checkout ni tabla de órdenes todavía; el precio histórico vivirá en `order_items.unit_price_ars_cents`). Se anota como **verificable-más-tarde**: el escenario de regresión queda escrito y **`@deferred`** en el suite, listo para activarse en la US de checkout. No cuenta como AC sin escenario: tiene escenario, marcado diferido con owner (US de checkout).

## Out of scope

- **Re-autoría de tests owned-by-dev** (unit/component/integration/contract-provider/e2e-nest/smoke): son la TDD de los devs (`qa-*-standards.md` §2.1). Acá solo se **referencian** como cobertura consciente, nunca se duplican como stubs.
- **Corrección del gap de la costura de auth** (no existe controller para `POST /v1/admin/auth/login`): es trabajo de backend (US-014 o un follow-up del seam), no de QA. Ver OQ-QA-1.
- **Load test contra producción**: no hay entorno cloud vivo (`platform-cloud` está en draft). La carga corre en local/CI contra un Postgres sembrado; se re-ejecuta en `pre-uat` cuando exista (E2E §17).
- **Batería de relevancia de búsqueda IA** (≥70% top-5, KPI PRD §1.4) → US-004/005, no US-001.
- **BDD con godog**: no aplica — el stack no tiene Go (project-config: BE=NestJS/Node, WEB=Next.js). La aceptación usa Cucumber.js + Playwright.
- **Suite de checkout / órdenes / pago simulado DSM** → US posteriores; AC-10 se activa ahí.

## Standards consultados

- `spekode/docs/base-standards.md` — principios core, §2.4 (idioma: markers en inglés, prosa en español).
- `spekode/docs/quality/testing-standards.md` — §2 (pirámide), §4.1 (naming), §5 (test data), §6 (dobles), §8 (cobertura), §14 (patrones de código de test: SUT factories, builders, matchers, negative-space §14.9), §18 (anti-patterns).
- `spekode/docs/quality/qa-backend-standards.md` — §2.1 (ownership dev vs QA), §13 (performance/k6), §15 (test data), §21 (BDD & Gherkin — adopción y calidad; godog NO aplica al no haber Go).
- `spekode/docs/quality/qa-frontend-standards.md` — §2.1 (ownership), §19 (accesibilidad WCAG), §23 (Vitest+Playwright), §24 (BDD web = Cucumber+Playwright).
- `spekode/docs/cross-cutting/performance-standards.md` — §7 (triggers y diseño de load test), §8 (budgets en CI).
- `spekode/docs/architecture/api-standards.md` — §8 (envelope RFC 7807 + `errors[]`), contract testing.
- `spekode/docs/delivery/operations-standards.md` — SLOs y qué validan los tests; gates de promoción.
- `spekode/docs/ai/documentation-standards.md` — qué docs afecta el plan de QA.
- Skills: `qa-three-layer-regression` (modelo canónico L3 + frontmatter de test-case), `bdd-scenario-quality` (Gherkin declarativo, Outline, tags), `playwright-stability` (E2E estable), `k6-load-scaffolding` (thresholds atados a NFR), `nfr-quantification` (números propuestos), `msw-setup` (referencia — es dev-L2, no se re-usa acá), `flakiness-detection` (higiene anti-flake), `openspec-workflow` (change 3-file + tasks closure-grade), `observability-patterns` (señales de test ↔ observabilidad).
- ADRs heredados: **ADR-0009** (seam de auth admin US-001 — base de la costura y del gap OQ-QA-1), ADR-0005 (auth propia — endurece el seam en US-014), ADR-0007 (monolito modular), ADR-0001 (Railway/Neon/R2 — money en centavos).

## Open questions

- **OQ-QA-1 — La costura de login no tiene ruta HTTP: ¿la aceptación cross-stack espera al backend o mintea el JWT por helper?** `[Resolved: 2026-07-25 — los flujos gateados se ejercitan ya con un JWT role=admin minteado por fixture (mismo contrato que issueAdminToken); el escenario de login real por la página /acceso queda @blocked-by-backend hasta que backend exponga POST /v1/admin/auth/login — owner: backend, revisit: cuando aterrice el controller]` **`[Desbloqueada: 2026-07-25 — el controller aterrizó el mismo día. El backend expone `POST /v1/admin/auth/login` (change backend, Fase 9 T9.1/T9.2), declarada en `openapi.yaml` (tag `admin-auth`, `security: []` — única ruta admin sin bearer, porque es la que emite el token) y verificada contra la API viva: 200 + JWT `role=admin` que abre las rutas gateadas, 401 RFC 7807 sin filtrar el token esperado, 422 por campo. El fixture `adminAuth` resuelve por login REAL; TC-019 (X-6) pierde `@blocked-by-backend`.]`** El párrafo siguiente describe el estado ANTERIOR al desbloqueo, se conserva como registro: El seam de ADR-0009 existe a nivel servicio (`AdminAuthService.loginWithBootstrap(bootstrapToken)` / `issueAdminToken()`), pero **ningún `@Controller` expone `POST /v1/admin/auth/login`** (los controllers son solo products/health/categories). El smoke FE del dev mockea esa ruta con Playwright `page.route`. Por tanto una aceptación cross-stack que pase por el **login real de la página `/acceso`** está **bloqueada** hasta que exista el controller. **Estrategia de este change (sin inventar alrededor del gap)**: (a) un fixture `adminAuth` que, cuando exista la ruta, postee al login real; (b) mientras tanto, **fallback test-only** que emite un JWT `role=admin` firmado con el `JWT_SECRET` compartido (mismo contrato que `issueAdminToken`) e lo inyecta en la sesión del FE / el header del interceptor, para ejercitar **todos los endpoints gateados ahora**. El escenario específico "login real por la página `/acceso`" queda **`@blocked-by-backend`** hasta el follow-up del controller. Escalado al backend; no se resuelve en QA. Ver `design.md` §Auth fixture.
- **OQ-QA-2 — Entorno de la carga k6 sin cloud vivo.** `[Deferred: k6 corre en local/CI contra Postgres sembrado; umbrales propuestos, re-medidos en entorno prod-shaped — owner: Arquitecto/QA, revisit: al provisionar platform-cloud (pre-uat)]` `platform-cloud` está en draft: no hay entorno prod-shaped. La carga corre en **local/CI** contra un Postgres sembrado con ≥5.000 SKUs (perfil reducido de RPS por ser backoffice de un solo admin — el NFR es sobre el **tamaño del dataset**, no la concurrencia). Los thresholds quedan escritos; se re-ejecuta el perfil completo en `pre-uat` cuando exista (E2E §17). Los números son `[propuesto — confirma Arquitecto post-load-test]`.
- **OQ-QA-3 — Tier de servicio sin `service-catalog.yaml`.** `[Resolved: derivado de US §9 + E2E §17]` No existe `service-catalog.yaml` ni `docs/slo.yaml` en el repo. **Tier derivado: Tier 2** (pragmático + camino crítico alto) — la capacidad es *Must* y fundacional (bloquea todo el catálogo), pero la superficie es **backoffice de baja concurrencia** (un admin), con disponibilidad tier-backoffice 99.5% (E2E §17). Se asume Tier 2 con cobertura alta en los caminos críticos (CRUD + máquina de estado + RBAC); registrado como asunción, auditable. Si el equipo materializa `service-catalog.yaml` con otro tier, se re-alinea el objetivo de cobertura.

## References

- User Story: `docs/user-stories/US-001-admin-catalogo-productos.md` (§3 ACs, §9 NFRs)
- PRD: `docs/product/prd.md` §1.4 (KPI cobertura de catálogo), §2.1 (capacidad 1)
- E2E: `docs/product/design-e2e.md` §14 (STRIDE admin), §17 (NFRs ≥5.000 SKUs), §18 (observabilidad), §19 (testing L3)
- Change de backend hermano (API + tests dev): `openspec/changes/US-001-admin-catalogo-productos-backend/`
- Change de frontend hermano (panel + tests dev): `openspec/changes/US-001-admin-catalogo-productos-frontend-web/`
- Contrato de API (NO se redefine): `apps/api/docs/api/openapi.yaml`
- ADRs: `docs/architecture/decisions/0009-admin-auth-seam-us001.md`, `0005-own-jwt-authentication.md`
