# Proposal — US-024 QA: edición de perfil del cliente

## Qué

Plan de QA-owned (aceptación BDD + E2E cross-stack + a11y + exploratorio) para
US-024 (edición de nombre + avatar del cliente en "Mi cuenta"), escrito **antes**
de que exista implementación de disciplina (BE/FE) — Modo B standalone, mismo
patrón que `US-020-borrado-cuenta-datos-personales-qa` ("sibling, pre-backend")
y que `US-009-pago-mercadopago-backend/qa-plan.md` (escrito antes del código,
con dependencias declaradas explícitamente en vez de asumidas).

## Por qué

La coordinadora pidió paralelizar: los escenarios de QA se derivan directamente
de los 7 AC en Gherkin que ya tiene `US-024-edicion-perfil-cliente.md` (Ready
desde 2026-09-06) — no dependen del código, sólo del contrato de comportamiento
ya fijado en el enrich. Así, cuando BE/FE construyan sus changes, `/develop-qa`
puede arrancar de inmediato en vez de esperar a que alguien escriba el plan.

## Alcance

Cubre los 7 AC de US-024 (édición de nombre, avatar por URL, validaciones,
negative-space de autorización). NO cubre:

- Los tests unit/integration/component de BE/FE (dev-owned, TDD dentro de
  `/develop-backend`/`/develop-frontend-web` — ownership matrix
  `qa-backend-standards.md`/`qa-frontend-standards.md` §2.1).
- Ningún escenario de US-025 (reseñas) — change hermano separado.

## ACs cubiertos

AC-1 (editar nombre), AC-2 (avatar por URL), AC-3 (quitar avatar), AC-4 (nombre
vacío rechazado), AC-5 (URL inválida rechazada), AC-6 (email no editable),
AC-7 (no se puede editar el perfil de otro cliente).

## Standards consultados

- `docs/quality/testing-standards.md` §2, §5, §12
- `docs/quality/qa-backend-standards.md` §2.1, §21 (BDD)
- `docs/quality/qa-frontend-standards.md` §2.1, §24 (BDD/E2E/a11y)

## Preguntas abiertas

Ninguna — los 7 AC de la US ya resuelven todas las decisiones de producto
relevantes para QA (el enrich las dejó explícitas, ver §10 de la US).

## Referencias

- US: `docs/user-stories/US-024-edicion-perfil-cliente.md`
- `qa-plan.md` de este change (el entregable principal)
- Precedente de formato: `openspec/changes/US-009-pago-mercadopago-backend/qa-plan.md`
  (qa-plan escrito antes del código, dependencias declaradas)
- Precedente de Modo B pre-código: `openspec/changes/archive/US-020-borrado-cuenta-datos-personales-qa/`
