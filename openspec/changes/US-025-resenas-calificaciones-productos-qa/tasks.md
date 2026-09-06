# Tasks — US-025 QA: reseñas y calificaciones de productos

> Este change **planifica**, no ejecuta. La única task es escribir el plan;
> la ejecución real es `/develop-qa US-025`, bloqueada hasta que exista al
> menos el endpoint de reseñas (BE-US-025).

## Traceability matrix

| AC (US-025) | Título | Escenario(s) qa-plan.md | Estado |
|---|---|---|---|
| AC-1 | Dejar reseña (comprador, orden delivered) | SC-025-H1 | in this change |
| AC-2 | Calificar sin comentario | SC-025-H2 | in this change |
| AC-3 | Ver promedio y conteo | SC-025-H3 | in this change |
| AC-4 | Producto sin reseñas | SC-025-H4 | in this change |
| AC-5 | Editar la propia reseña | SC-025-H5 | in this change |
| AC-6 | No comprado → no puede reseñar | SC-025-N1 | in this change |
| AC-7 | Invitado no puede reseñar | SC-025-N2 | in this change |
| AC-8 | El dueño oculta una reseña | SC-025-H6 | in this change |
| AC-9 | Calificación fuera de rango rechazada | SC-025-N3 | in this change |

Los 9 AC de US-025 quedan cubiertos, uno a uno, en `qa-plan.md` §3.

## Fase única — Escribir el qa-plan

- [x] T-QA1 Escribir `qa-plan.md`: perfil de riesgo, matriz de test, 9
  escenarios Gherkin (1 por AC), seeds/builders requeridos (reusando
  `crearOrdenEnEstado`), exploratory charters, dependencias declaradas.
  - **Exit criterion**: `qa-plan.md` existe, cubre los 9 AC de la US (uno a
    uno, verificable por número), y declara explícitamente qué test-case
    depende de qué disciplina/change todavía inexistente.
  - **Verify**: `grep -c "AC-[1-9]" openspec/changes/US-025-resenas-calificaciones-productos-qa/qa-plan.md` (≥ 9) `&& test -f openspec/changes/US-025-resenas-calificaciones-productos-qa/qa-plan.md`
  - **Nota de ejecución (2026-09-06)**: hecho. 9/9 AC cubiertos. Elegibilidad
    (AC-1/AC-6) se prueba con el seed real `crearOrdenEnEstado(...,
    'delivered')` que ya existe en `qa/support/seed-ordenes.ts` — no hizo
    falta un seed nuevo. Todo test-case que necesita el endpoint de reseñas
    real queda `Blocked-by: BE-US-025` en §7/§8.

## Próximo paso

`/develop-qa US-025` — **bloqueado** hasta que `BE-US-025` (al menos
`POST/GET /v1/products/:slug/reviews`) exista. Avisar a la coordinadora
cuando ese change abra su PR.
