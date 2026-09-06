# Tasks — US-024 QA: edición de perfil del cliente

> Este change **planifica**, no ejecuta. La única task es escribir el plan;
> la ejecución real de sus escenarios es `/develop-qa US-024`, y no puede
> correr hasta que exista al menos el endpoint `PATCH /v1/me` (BE-US-024).

## Traceability matrix

| AC (US-024) | Título | Escenario(s) qa-plan.md | Estado |
|---|---|---|---|
| AC-1 | Editar el nombre | SC-024-H1 | in this change |
| AC-2 | Agregar/cambiar avatar por URL | SC-024-H2 | in this change |
| AC-3 | Quitar el avatar | SC-024-H3 | in this change |
| AC-4 | Nombre vacío rechazado | SC-024-N1 | in this change |
| AC-5 | URL de avatar inválida rechazada | SC-024-N2 | in this change |
| AC-6 | Email no editable | SC-024-N3 | in this change |
| AC-7 | No se puede editar el perfil de otro cliente | SC-024-N4 | in this change |

Los 7 AC de US-024 quedan cubiertos, uno a uno, en `qa-plan.md` §3.

## Fase única — Escribir el qa-plan

- [x] T-QA1 Escribir `qa-plan.md`: perfil de riesgo, matriz de test, 7
  escenarios Gherkin (1 por AC), seeds/builders requeridos, exploratory
  charters, dependencias declaradas.
  - **Exit criterion**: `qa-plan.md` existe, cubre los 7 AC de la US (uno a
    uno, verificable por número), y declara explícitamente qué test-case
    depende de qué disciplina/change todavía inexistente.
  - **Verify**: `grep -c "AC-[1-7]" openspec/changes/US-024-edicion-perfil-cliente-qa/qa-plan.md` (≥ 7 — al menos una mención por AC) `&& test -f openspec/changes/US-024-edicion-perfil-cliente-qa/qa-plan.md`
  - **Nota de ejecución (2026-09-06)**: hecho. 7/7 AC cubiertos (1 escenario
    Gherkin cada uno, sin variantes de negocio nuevas — D-QA1). Todo
    test-case que necesita `PATCH /v1/me` real queda `Blocked-by: BE-US-024`
    en §7, no fingido como ejecutable.

## Próximo paso

`/develop-qa US-024` — pero **bloqueado** hasta que `BE-US-024` (al menos el
endpoint `PATCH /v1/me`) exista. Avisar a la coordinadora cuando ese change
abra su PR.
