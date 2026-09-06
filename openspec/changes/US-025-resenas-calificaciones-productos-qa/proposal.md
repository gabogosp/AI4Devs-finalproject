# Proposal — US-025 QA: reseñas y calificaciones de productos

## Qué

Plan de QA-owned (aceptación BDD + E2E cross-stack + a11y + carga +
exploratorio) para US-025 (estrellas 1-5 + comentario opcional, sólo
compradores con orden `delivered`, moderación básica del dueño) — escrito
**antes** de que exista implementación de disciplina (BE/FE), Modo B
standalone, mismo criterio que `US-024-edicion-perfil-cliente-qa` (change
hermano de este mismo paralelizado) y que `US-009-pago-mercadopago-backend/qa-plan.md`.

## Por qué

Igual motivo que US-024-qa: los 9 AC en Gherkin de
`US-025-resenas-calificaciones-productos.md` (Ready desde 2026-09-06) ya
fijan el comportamiento — QA puede derivar sus escenarios sin esperar al
código, y `/develop-qa` arranca de inmediato cuando BE/FE cierren.

## Alcance

Cubre los 9 AC de US-025 (dejar reseña, calificar sin comentario, promedio,
producto sin reseñas, editar la propia reseña, negative-space de
elegibilidad, moderación, rango de calificación). NO cubre:

- Tests unit/integration/component de BE/FE (dev-owned, TDD).
- Ningún escenario de US-024 (perfil) — change hermano separado.
- Nada fuera del §4 "Out of scope explícito" de la US (fotos en reseñas,
  respuesta del dueño, votar reseñas, notificación por email de moderación).

## ACs cubiertos

AC-1 (dejar reseña, comprador con orden delivered), AC-2 (calificar sin
comentario), AC-3 (ver promedio y conteo), AC-4 (producto sin reseñas),
AC-5 (editar la propia reseña, una por cliente por producto), AC-6
(negative-space: no comprado → no reseña), AC-7 (negative-space: invitado
no reseña), AC-8 (el dueño oculta una reseña), AC-9 (negative-space:
calificación fuera de rango 1-5).

## Standards consultados

- `docs/quality/testing-standards.md` §2, §5, §12
- `docs/quality/qa-backend-standards.md` §2.1, §21 (BDD)
- `docs/quality/qa-frontend-standards.md` §2.1, §19 (a11y), §24 (BDD/E2E)
- `docs/cross-cutting/performance-standards.md` §7 (K6 — sólo si aplica, ver
  `design.md` D-QA2)

## Preguntas abiertas

Ninguna nueva — la US ya interpretó explícitamente "comprado" como orden
`delivered` (§10 de la US) y dejó anotado que es una decisión reconsiderable
por el dueño, no una ambigüedad de QA.

## Referencias

- US: `docs/user-stories/US-025-resenas-calificaciones-productos.md`
- `qa-plan.md` de este change (el entregable principal)
- Change hermano paralelo: `US-024-edicion-perfil-cliente-qa`
- Precedente de formato: `openspec/changes/US-009-pago-mercadopago-backend/qa-plan.md`
