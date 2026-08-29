## Why

Doce findings del plan-review (`2026-08-22-plan-review.md`) identifican debilidades en las verificaciones (`Verify:`) de los 5 planes de backend/frontend-web recién creados. El patrón dominante es **F50**: el `Verify:` usa `rg -q` para probar presencia textual cuando el exit criterion pide **comportamiento** (6 violaciones). También hay un problema de wiring inter-módulos NestJS (REV-009, High) y varias observaciones menores.

Estos findings no bloquean la planificación pero sí la **ejecución disciplinada**: si `/develop-*` marca como verde un `Verify:` que no prueba lo que dice el exit criterion, la deuda entra silenciosa.

## What changes

1. **REV-001 (PLAN-003)** — US-004 T6.2: reemplazar `rg -q` por declaración explícita de revisión humana o por ejecución del arnés de calibración.
2. **REV-002 (PLAN-004)** — US-004 T7.2: idem, aclarar que el README operativo es revisión humana.
3. **REV-003 (PLAN-005)** — US-007 FE T0.2: eliminar el `rg` redundante (la prueba de mutación ya es F50-compliant).
4. **REV-004 (PLAN-006)** — US-008 T6.2: idem REV-002, replicar la aclaración de US-009.
5. **REV-005 (PLAN-007)** — US-010 T7.2: idem, replicar la aclaración.
6. **REV-006 (PLAN-010)** — US-007 FE T6.1/T6.2: añadir aclaración.
7. **REV-007 (PLAN-011)** — US-004 design §D6: agregar aserción de DI o declarar Deferred explícito.
8. **REV-009 (PLAN-012)** — US-010 T2.4: agregar task/exit para wiring inter-módulos y resolver dependencia circular.
9. **REV-010 (PLAN-013)** — US-004: anotar deviación POST→GET respecto al §4 del readme.
10. **REV-011 (PLAN-015)** — US-009: declarar el timeout del host (Railway) en design o agregar abort controller.
11. **REV-012 (PLAN-016)** — US-010: agregar nota al runbook sobre >1 instancia.
12. **REV-013 (PLAN-017)** — US-010 T0.1: declarar que se edita `order-schema.spec.ts` de US-008.

## Out of scope

- PLAN-001, PLAN-002, PLAN-009: ya `addressed`.
- PLAN-008, PLAN-014: `false-positive`.
- La ejecución de los planes — este change sólo enmienda los artefactos de planificación.
- No se escribe `design.md`: las enmiendas son ediciones puntuales a `tasks.md` y `design.md` existentes.

## References

- Reporte fuente: `docs/audits/openspec-plans/2026-08-22-plan-review.md`
- Standards: `openspec-workflow/SKILL.md` §F50, §F49, §F51
- Planes afectados: `openspec/changes/US-004-busqueda-semantica-backend/`, `US-007-carrito-compra-frontend-web/`, `US-008-checkout-guest-backend/`, `US-009-pago-mercadopago-backend/`, `US-010-orden-webhook-stock-backend/`
