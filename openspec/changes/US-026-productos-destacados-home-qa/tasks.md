# Tasks — US-026 QA: productos destacados en el home

> Este change **planifica**, no ejecuta. La única task es escribir el plan;
> la ejecución real es `/develop-qa US-026`, bloqueada hasta que exista al
> menos los 2 endpoints (BE-US-026).

## Traceability matrix

| AC (US-026) | Título | Escenario(s) qa-plan.md | Estado |
|---|---|---|---|
| AC-1 | Novedades | SC-026-H1 | in this change |
| AC-2 | Más vendidos | SC-026-H2 | in this change |
| AC-3 | Menos de 8 disponibles | SC-026-E1 | in this change |
| AC-4 | Catálogo vacío | SC-026-N1 | in this change |
| AC-5 | Sin ventas todavía | SC-026-N2 | in this change |
| AC-6 | Empate determinista | SC-026-N3 | in this change |
| AC-7 | Producto despublicado no aparece | SC-026-N4 | in this change |
| AC-8 | Sin stock, visible pero marcado | SC-026-N5 | in this change |

Los 8 AC de US-026 quedan cubiertos, uno a uno, en `qa-plan.md` §3.

## Fase única — Escribir el qa-plan

- [x] T-QA1 Escribir `qa-plan.md`: perfil de riesgo, matriz de test, 8
  escenarios Gherkin (1 por AC), test-case de shape público + caché
  per-handler (D-QA2/D-QA3), seeds/builders requeridos, dependencias
  declaradas.
  - **Exit criterion**: `qa-plan.md` existe, cubre los 8 AC de la US (uno a
    uno, verificable por número), y declara explícitamente qué test-case
    depende de qué disciplina/change todavía inexistente.
  - **Verify**: `grep -c "AC-[1-8]" openspec/changes/US-026-productos-destacados-home-qa/qa-plan.md` (≥ 8) `&& test -f openspec/changes/US-026-productos-destacados-home-qa/qa-plan.md`
  - **Nota de ejecución (2026-09-07)**: hecho. 8/8 AC cubiertos. Elegibilidad
    de "más vendidos" (AC-2/AC-5) reusa `crearOrdenEnEstado` de
    `qa/support/seed-ordenes.ts` tal cual (a diferencia de US-025-qa, acá
    NO hace falta una compra logueada — el ranking es agregado global, no
    por cliente). Todo test-case que necesita los 2 endpoints reales queda
    `Blocked-by: BE-US-026/FE-US-026` en §4/§5.

## Próximo paso

`/develop-qa US-026` — **bloqueado** hasta que `BE-US-026` (al menos
`GET /v1/products/novedades` + `GET /v1/products/mas-vendidos`) exista.
Avisar a la coordinadora cuando ese change abra su PR.
