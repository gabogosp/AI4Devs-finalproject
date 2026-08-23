## Why

Nueve findings del flow-audit (`2026-08-22-flow-audit.md`) identifican drift y gaps de trazabilidad en los índices y user stories del proyecto. El más grave (Major): tres US en ejecución declaran task QA pero no tienen plan de QA (FLOW-004), y US-019 no tiene AC de negative-space (FLOW-006). Los Minor/Info reflejan deuda de mantenimiento de índices: `prd-capacity` no declarado en frontmatters (FLOW-008), assignees correctamente `sin-asignar` (FLOW-009, informativo), cadena crítica sin construir (FLOW-010, observación), y tres confirmaciones de correcto funcionamiento (FLOW-011/012/013, Info).

Incluyo también DOC-007 (índice `us-status.yaml` vs directorio de user stories — drift potencial) porque es la misma clase de problema: coherencia de índices.

## What changes

1. **Planificar QA para US-005, US-006, US-014** — documentar el skip o crear los `-qa` changes. Para esta remediación: documentar la decisión de que QA se absorbe en los qa-plans cross-stack existentes y en los tests dev-owned, añadiendo un `skip-rationale` en cada `design.md` correspondiente. (FLOW-004)
2. **Agregar AC negative-space a US-019** — al menos 1 escenario Gherkin de negative-space (ej.: "el deploy falla si falta un secreto obligatorio"). (FLOW-006)
3. **Agregar `prd-capacity` al frontmatter de las 21 US** que no lo declaran, o documentar que es campo derivado en `index-conventions.md`. (FLOW-008)
4. **Registrar que los 6 changes `sin-asignar` son correctos** — no requiere cambio, se acepta como estado válido. (FLOW-009)
5. **Documentar la cadena crítica como riesgo conocido** en el build-order o en un doc de estado. (FLOW-010)
6. **Verificar que DOC-007 (US-021 en us-status.yaml) esté resuelto** — si ya está sincronizado, confirmar; si no, agregar la entrada. (DOC-007)
7. **Cerrar FLOW-011/012/013 (Info)** — son confirmaciones de correcto funcionamiento: se documentan como "no action required" en la matriz. (FLOW-011, FLOW-012, FLOW-013)

## Out of scope

- FLOW-001, 002, 003, 005, 007: ya `addressed`.
- Regenerar `build-order.yaml` (FLOW-003/005): ya addressed.
- La ejecución real de los plans de QA (US-005/006/014) — eso lo hacen los `/develop-*` correspondientes.
- No se escribe `design.md`: las decisiones son mecánicas (agregar campos, escribir ACs).

## References

- Reporte fuente: `docs/audits/flow/2026-08-22-flow-audit.md`
- Reporte doc: `docs/audits/dsm-ecommerce/2026-08-22/doc-audit.md` (DOC-007)
- Standards: `index-conventions.md` §3, rule Q2 (negative-space AC), rule D2 (QA plan)
