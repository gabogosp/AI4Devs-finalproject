---
tracker-id: null
tracker-source: null
parent-us: US-026
discipline: qa
variant: null
language: es
audit-derived: false
archived: true
archived_at: 2026-09-08
merged_commit: d555eeba732e406a6161bbebf4a1d25c4bfb00fa
pr-url: https://github.com/gabogosp/AI4Devs-finalproject/pull/152
---

# Proposal — US-026 QA: productos destacados en el home

## Qué

Plan de QA-owned (aceptación BDD + E2E cross-stack + carga) para US-026
(secciones "Novedades" + "Más vendidos" en el home) — escrito **antes** de
que exista implementación de disciplina (BE/FE), Modo B standalone, mismo
patrón que `US-024-edicion-perfil-cliente-qa`/`US-025-...-qa`.

## Por qué

Los 8 AC en Gherkin de `US-026-productos-destacados-home.md` (Ready desde
2026-09-07) ya fijan el comportamiento — QA deriva sus escenarios sin
esperar al código, y `/develop-qa` arranca el mismo día que BE/FE cierren.

## Alcance

Cubre los 8 AC de US-026 (Novedades, Más vendidos, menos de 8 disponibles,
catálogo vacío, sin ventas todavía, empate determinista, producto
despublicado no aparece, sin-stock visible pero marcado). Incluye
explícitamente la verificación del **shape público** (nunca `id`/
`revenue_ars_cents`/`status` en la respuesta) y de la **caché per-handler**
(`Cache-Control` correcto en las 2 rutas nuevas) — la lección directa de
US-025 (PR #139). NO cubre:

- Tests unit/integration/component de BE/FE (dev-owned, TDD).
- Personalización, recomendación, curación manual, ranking por calificación
  — explícitamente fuera de alcance de la propia US (§4).
- Una ventana de tiempo para "más vendidos" — la US declara ranking
  histórico completo, sin selector de rango (§4).

## ACs cubiertos

AC-1 (Novedades), AC-2 (Más vendidos), AC-3 (menos de 8 disponibles), AC-4
(catálogo vacío), AC-5 (sin ventas todavía), AC-6 (empate determinista),
AC-7 (producto despublicado no aparece), AC-8 (sin stock, visible pero
marcado).

## Standards consultados

- `docs/quality/testing-standards.md` §2, §5, §12
- `docs/quality/qa-backend-standards.md` §2.1, §21
- `docs/quality/qa-frontend-standards.md` §2.1, §24

## Preguntas abiertas

Ninguna — los 8 AC de la US ya resuelven las decisiones de producto
relevantes (incluida la caché, per NFR explícito de la US §9).

## Referencias

- US: `docs/user-stories/US-026-productos-destacados-home.md`
- `qa-plan.md` de este change (el entregable principal)
- Precedente directo del hallazgo de caché: PR #139 (US-025)
- Precedente de formato: `US-024-edicion-perfil-cliente-qa`,
  `US-025-resenas-calificaciones-productos-qa`
