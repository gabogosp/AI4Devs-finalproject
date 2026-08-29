## Why

Ocho findings del QA audit (`qa-audit.md` del 2026-08-22) identifican gaps en la estrategia de testing del proyecto. Los 2 Major son **cobertura funcional ausente** para el núcleo transaccional (QA-003: checkout/payments/orders/stock) y la búsqueda semántica (QA-004) — ambos bloqueados porque esos módulos **no están implementados** todavía. Los 6 Minor son deuda de pirámide, negative-space, accesibilidad del panel admin, quality gates de CI, E2E del loop de compra y test data management.

Este change **planifica la remediación** dentro de la suite QA: qué agregar, en qué orden, y con qué dependencia. La ejecución real depende de que los modules de código existan (US-008/009/010 para QA-003, US-004 BE para QA-004).

## What changes

1. **Planificar test de cobertura del núcleo transaccional** — declarar que se cubre cuando US-008+009+010 cierren: test de concurrencia de stock, loop E2E con pago simulado, webhook idempotente. (QA-003, QA-006)
2. **Planificar batería de relevancia de búsqueda IA** — declarar que se cubre cuando US-004+005 cierren: `qa/relevance/` con ~30 consultas y gate ≥70%. (QA-004)
3. **Mejorar balance de pirámide** — identificar los e2e-nest que pueden ser unit y documentar la migración como tarea futura. (QA-005)
4. **Agregar tests axe para el panel admin** — rutas `/admin/productos`, `/admin/categorias`. (QA-007)
5. **Configurar quality gates de CI** — `--coverage` con threshold mínimo (60%) + separar steps unit/integration/e2e. (QA-008)
6. **Crear E2E Playwright del loop de compra completo** — cuando exista el loop (depende de QA-003). (QA-010)
7. **Crear factories compartidas en `apps/api/test/factories/`** — builders por entidad para reducir duplicación de setup. (QA-011)

## Out of scope

- QA-001: ya `addressed` (batería planificada en qa-plan de US-004).
- QA-002: ya `addressed` (contract testing distribuido en los qa-plans).
- QA-009: `accepted-as-debt`.
- La implementación de los módulos de código (checkout, payments, orders, search) — eso lo hacen los changes de backend.
- No se escribe `design.md`: las decisiones son estándar (pirámide, factories, gates de CI).

## References

- Reporte fuente: `docs/audits/dsm-ecommerce/2026-08-22/qa-audit.md`
- Standards: E2E §19 (capas prometidas), `qa-backend-standards.md`
- Dependencias: US-008/009/010 (loop transaccional), US-004/005 (búsqueda IA)
