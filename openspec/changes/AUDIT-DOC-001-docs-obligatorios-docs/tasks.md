## Traceability matrix

| Finding ID | Title | Task IDs | Status |
|---|---|---|---|
| AUDIT-DOC-001 | Doc obligatorio ausente (data-model.md) | T1.1 | in this change |
| AUDIT-DOC-004 | Runbook incompleto | T2.1 | in this change |
| AUDIT-DOC-005 | README de servicio incompleto | T3.1 | in this change |
| AUDIT-DOC-006 | Doc aspiracional vs real (worker) | T4.1 | in this change |
| AUDIT-DOC-008 | Links/referencias rotos (packages/) | T5.1 | in this change |
| AUDIT-DOC-009 | OpenAPI freshness (sin anotación de estado) | T5.2 | in this change |
| AUDIT-DOC-011 | Documentación de testing ausente | T6.1 | in this change |

---

## Fase 1 — Doc obligatorio: data-model.md

- [ ] T1.1 Crear `docs/services/dsm-ecommerce/data-model.md`

Documento de referencia del modelo de datos: diagrama ER (Mermaid, derivado de §8 del E2E + actualizaciones de ADR-0011 y los changes implementados), descripción de cada entidad (8+), restricciones notables (`CHECK (stock >= 0)`, `idempotency_key` UK, `sku` UK), índices (HNSW, GIN, compuestos), convenciones (precios en centavos, soft-delete, UUIDs), y link al Prisma schema como fuente canónica.

  - **Exit criterion**: El archivo existe, contiene ≥8 entidades documentadas con sus restricciones, un diagrama ER Mermaid que renderiza, y la sección de convenciones.
  - **Verify**: `test -f docs/services/dsm-ecommerce/data-model.md && grep -c "^###" docs/services/dsm-ecommerce/data-model.md` devuelve ≥8 (una heading por entidad) `&& grep -q "erDiagram" docs/services/dsm-ecommerce/data-model.md && grep -q "CHECK" docs/services/dsm-ecommerce/data-model.md && grep -q "schema.prisma" docs/services/dsm-ecommerce/data-model.md`

---

## Fase 2 — Runbook

- [ ] T2.1 Completar secciones pendientes del runbook

Abrir `docs/services/dsm-ecommerce/runbook.md`, reemplazar los `[pendiente: T…]` con: (a) procedimiento de rollback (redeploy del commit verde anterior en Railway), (b) procedimiento de restore de DB (Neon PITR), (c) URLs de dashboards como placeholder `TBD — se completa al cerrar US-019 T4.2/T4.3`, (d) configuración de alertas (esqueleto: health endpoint 5xx → notificación).

  - **Exit criterion**: El runbook no contiene la cadena `[pendiente:` y tiene ≥4 procedimientos (rollback, restore, escalation, alertas — aunque sea placeholder documentado como tal).
  - **Verify**: `! grep -q "\[pendiente:" docs/services/dsm-ecommerce/runbook.md && grep -c "^##" docs/services/dsm-ecommerce/runbook.md` devuelve ≥6

---

## Fase 3 — READMEs de servicio

- [ ] T3.1 Enriquecer READMEs de apps/api y apps/web

Agregar a cada README: sección At-a-glance (tier: standalone, owner: Pedro Suárez), Quick Links (runbook, ADRs, data-model, OpenAPI, E2E), y Troubleshooting (≥3 problemas comunes con solución).

  - **Exit criterion**: Ambos READMEs contienen las secciones "At-a-glance", "Quick Links" y "Troubleshooting".
  - **Verify**: `grep -q "At-a-glance\|Quick [Ll]inks\|Troubleshooting" apps/api/README.md && grep -q "At-a-glance\|Quick [Ll]inks\|Troubleshooting" apps/web/README.md`

---

## Fase 4 — Worker README

- [ ] T4.1 Actualizar `apps/worker/README.md` con estado real

Reescribir el README (205 bytes) para indicar: directorio **reservado** para cuando se aprovisione Redis (ref ADR-0004, ADR-0012, ADR-0014); por ahora la ejecución asíncrona corre in-process en `apps/api`; instrucciones de qué haría el worker cuando exista.

  - **Exit criterion**: El README indica explícitamente que está reservado/diferido y referencia ADR-0012.
  - **Verify**: `grep -q "ADR-0012\|reservado\|diferido" apps/worker/README.md && test $(wc -c < apps/worker/README.md) -gt 400`

---

## Fase 5 — OpenAPI y links

- [ ] T5.1 Corregir referencia a packages inexistentes en README raíz

En `readme.md`, agregar nota indicando que `packages/shared/` y `packages/ui/` son planificados (no existen todavía), o eliminarlos del árbol documentado.

  - **Exit criterion**: El README raíz no lista como existentes packages que no están en disco, o los marca explícitamente como `(planificado)`.
  - **Verify**: `! grep -E "packages/(shared|ui)/" readme.md || grep -q "planificado\|planned\|futuro" readme.md`

- [ ] T5.2 Anotar estado de implementación en el OpenAPI o doc adjunto

Agregar en `apps/api/docs/api/` un archivo `IMPLEMENTATION-STATUS.md` (o nota al inicio del YAML) que liste los endpoints implementados vs planificados, con referencia al gate de Spectral (se introduce en AUDIT-QA-003/AUDIT-dsm-api-005).

  - **Exit criterion**: Existe un doc que distingue endpoints implementados de planificados.
  - **Verify**: `test -f apps/api/docs/api/IMPLEMENTATION-STATUS.md || head -20 apps/api/docs/api/openapi.yaml | grep -qi "status\|implemented"`

---

## Fase 6 — Testing strategy

- [ ] T6.1 Crear `docs/testing-strategy.md`

Stack de testing (Jest BE, Vitest FE, Playwright E2E, Cucumber BDD, k6 perf), capas existentes (tabla con ubicación y cantidad), cómo correr cada una (`pnpm --filter @dsm/api test`, etc.), coverage targets actuales, y estado respecto al E2E §19.

  - **Exit criterion**: El archivo existe, documenta ≥5 capas con el comando de ejecución de cada una, y tiene una tabla de estado.
  - **Verify**: `test -f docs/testing-strategy.md && grep -c "pnpm" docs/testing-strategy.md` devuelve ≥4 `&& grep -q "Jest\|Vitest\|Playwright" docs/testing-strategy.md`
