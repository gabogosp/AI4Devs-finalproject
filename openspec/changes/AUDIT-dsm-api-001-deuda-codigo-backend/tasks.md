## Traceability matrix

| Finding ID | Title | Task IDs | Status |
|---|---|---|---|
| AUDIT-dsm-api-001 | CartService recibe Request/Response de Express | T1.1, T1.2, T1.3 | in this change |
| AUDIT-dsm-api-005 | Falta OpenAPI contract validation | T2.1, T2.2 | in this change |
| AUDIT-dsm-api-007 | No hay test de integración reproducible (Testcontainers) | T3.1 | in this change |
| AUDIT-dsm-api-011 | Falta documentación per-service | T4.1 | in this change |
| AUDIT-dsm-api-012 | EnrichmentQueue es stub por diseño | T5.1 | in this change |
| AUDIT-dsm-api-013 | Tests de integración usan DB local — aceptable | T5.2 | in this change |

---

## Fase 1 — Separar HTTP del CartService (Major)

- [ ] T1.1 Crear interceptor/middleware de resolución de sesión de carrito

Crear `CartSessionInterceptor` (o equivalente) que extraiga el token de la cookie, resuelva/cree la sesión, y exponga un valor de dominio `CartSession` vía custom decorator (ej. `@CurrentCartSession()`).

  - **Exit criterion**: Existe un interceptor que resuelve la sesión del carrito y un decorator que la inyecta. `CartService` no importa de `express`.
  - **Verify**: `! grep -r "from 'express'" apps/api/src/cart/*.service.ts && test -f apps/api/src/cart/cart-session.interceptor.ts`

- [ ] T1.2 Refactorizar CartService para recibir CartSession

Cambiar la firma de `setItem()`, `getCart()`, `removeItem()` para recibir `CartSession` en vez de `Request`/`Response`. Mover el set de cookies al controller o al interceptor.

  - **Exit criterion**: Ningún método del CartService acepta `Request` o `Response` como parámetro.
  - **Verify**: `! grep -rE "(Request|Response)" apps/api/src/cart/cart.service.ts`

- [ ] T1.3 Verificar que los tests de carrito pasan sin HTTP mocks

Correr la suite de carrito y confirmar que pasa. Los tests deben poder instanciar el service con un `CartSession` directo, sin necesidad de construir un request HTTP.

  - **Exit criterion**: `pnpm --filter @dsm/api test -- --testPathPattern cart` pasa verde.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern cart --ci 2>&1 | tail -5 | grep -q "passed"`

---

## Fase 2 — OpenAPI contract validation

- [ ] T2.1 Agregar step de Spectral lint al CI

En `.github/workflows/ci.yml` (o workflow de QA): agregar step `npx spectral lint apps/api/docs/api/openapi.yaml --fail-severity=warn`.

  - **Exit criterion**: El CI incluye un step que ejecuta spectral lint sobre el OpenAPI.
  - **Verify**: `grep -q "spectral" .github/workflows/ci.yml || grep -q "spectral" .github/workflows/qa.yml`

- [ ] T2.2 Agregar al menos un test de contrato supertest

Crear un test que valide que un endpoint implementado (ej. `GET /v1/products`) responde con un shape conforme al schema del OpenAPI.

  - **Exit criterion**: Existe ≥1 test que valida response shape contra OpenAPI.
  - **Verify**: `grep -rl "openapi\|contract\|schema.*valid" apps/api/src/**/*.spec.ts | wc -l` devuelve ≥1

---

## Fase 3 — Reproducibilidad de tests en CI

- [ ] T3.1 Documentar y verificar docker-compose en CI

Verificar que `.github/workflows/ci.yml` levanta `docker compose up -d` antes de los tests. Si no lo hace, agregar el step. Documentar en el README de la API que `docker compose` es prerequisito.

  - **Exit criterion**: El workflow de CI incluye un step de `docker compose` antes de `test`, O existe documentación explícita de que el runner de CI ya tiene los servicios.
  - **Verify**: `grep -q "docker.compose\|docker compose\|services.*postgres" .github/workflows/ci.yml`

---

## Fase 4 — Documentación per-service

- [ ] T4.1 Asegurar docs per-service mínimos

Verificar que `docs/services/dsm-ecommerce/` contiene runbook + data-model (se crea en AUDIT-DOC-001). Agregar link a SLO (placeholder: "SLO formal pendiente de producción — target operativo: 99.5% uptime mensual").

  - **Exit criterion**: El directorio tiene runbook + data-model + mención de SLO.
  - **Verify**: `test -f docs/services/dsm-ecommerce/runbook.md && test -f docs/services/dsm-ecommerce/data-model.md && grep -qi "SLO\|99.5" docs/services/dsm-ecommerce/runbook.md`

---

## Fase 5 — Info: cerrar items informativos

- [ ] T5.1 Documentar que EnrichmentQueue es stub by-design

Agregar un comentario en `apps/api/src/enrichment/` (o en el README del módulo) que explique que es un stub intencional (ref ADR-0014) y se reemplazará por BullMQ cuando se aprovisione Redis.

  - **Exit criterion**: El módulo de enrichment tiene un comentario/doc que referencia ADR-0014 y explica el stub.
  - **Verify**: `grep -rq "ADR-0014\|stub.*design\|by.design" apps/api/src/enrichment/`

- [ ] T5.2 Documentar que docker-compose local es aceptable para tests

En el README de `apps/api` o en `docs/testing-strategy.md`: indicar explícitamente que los tests de integración dependen de `docker compose up -d` (PostgreSQL + pgvector) y que es la estrategia elegida (vs Testcontainers).

  - **Exit criterion**: Documentación explícita de la dependencia de docker-compose para tests.
  - **Verify**: `grep -qi "docker.compose\|docker compose" apps/api/README.md || grep -qi "docker.compose\|docker compose" docs/testing-strategy.md`
