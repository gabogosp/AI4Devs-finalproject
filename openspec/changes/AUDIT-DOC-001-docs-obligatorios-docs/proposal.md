## Why

Siete findings de la auditoría de documentación (`doc-audit.md` del 2026-08-22) identifican gaps en documentación obligatoria y drift entre el estado documentado y el real. El finding principal (Major) es la **ausencia de `data-model.md`** — un doc obligatorio por §4 de `documentation-standards.md` para todo servicio que posee una base de datos. Los seis restantes (Minor) son: runbook incompleto, READMEs de servicio sin estructura canónica, README del worker aspiracional, OpenAPI sin validación anotada, y falta de doc de estrategia de testing.

Sin estos docs, el operador de guardia no tiene procedimientos, el nuevo contribuidor no encuentra una referencia del modelo de datos fuera del Prisma schema raw, y el estado real de la API queda opaco.

## What changes

1. **Crear `docs/services/dsm-ecommerce/data-model.md`** — diagrama ER, descripción de entidades, restricciones/índices notables, convenciones (centavos, soft-delete), referencia al Prisma schema. (DOC-001)
2. **Completar secciones pendientes del runbook** — URLs de dashboards (placeholder hasta US-019), procedimiento de rollback, restore de DB, alertas. (DOC-004)
3. **Enriquecer READMEs de `apps/api` y `apps/web`** con Quick Links, At-a-glance (tier, on-call), y Troubleshooting. (DOC-005)
4. **Actualizar `apps/worker/README.md`** para indicar que está reservado/diferido (ref ADR-0012/0014). (DOC-006)
5. **Anotar en el OpenAPI o en un doc** qué endpoints están implementados vs planificados + referencia al gate de Spectral que se introduce en QA. (DOC-009)
6. **Crear `docs/testing-strategy.md`** — stack, capas existentes, cómo correr cada una, coverage targets, estado actual. (DOC-011)
7. **Subsanar link roto de `packages/shared/` y `packages/ui/`** en el README raíz — ya cubierto por el drift general de DOC-002 (addressed), pero DOC-008 pide aclarar explícitamente que no existen. (DOC-008)

## Out of scope

- DOC-002 (drift README raíz): ya `addressed` — no se retoca acá.
- DOC-003, DOC-010: ya `addressed`.
- La validación de OpenAPI en CI (AUDIT-QA-003/AUDIT-dsm-api-005) es de los changes de QA/backend.
- Contenido del runbook que depende de infraestructura no aprovisionada (US-019 — URLs reales) queda con placeholder documentado.
- No se escribe diseño (`design.md`): este change es mecánico — copiar del schema Prisma, de los ADRs y del E2E a un formato de referencia.

## References

- Reporte fuente: `docs/audits/dsm-ecommerce/2026-08-22/doc-audit.md`
- Standards: `documentation-standards.md` §4, §5
- Prisma schema: `packages/db/prisma/schema.prisma`
- E2E §8 (DER): `docs/product/design-e2e.md`
