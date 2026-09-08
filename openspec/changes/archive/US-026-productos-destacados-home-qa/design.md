# Design — US-026 QA: productos destacados en el home

## Contexto

Igual que `US-024-edicion-perfil-cliente-qa`/`US-025-...-qa`: US-026 no
tiene todavía ningún change de BE/FE — este plan se escribe contra los 8 AC
de la US, Modo B standalone.

## D-QA1 — Escenarios derivados de los AC, no re-inventados

Cada escenario Gherkin de `qa-plan.md` §3 mapea 1:1 a un AC de la US.

## D-QA2 — "Más vendidos" NO es el reporte admin de US-016

La US (§7) ya declara que el endpoint público no puede reusar
`ReportsRepository.topProducts` (admin-only, expone `revenue_ars_cents`,
no filtra por `status`). Este plan verifica esa frontera explícitamente
(AC de shape público, §3) — un `revenue_ars_cents` o un `id` filtrándose a
la respuesta pública sería una regresión de superficie, no sólo un defecto
funcional.

## D-QA3 — Caché per-handler es un AC de facto, no un detalle de implementación

El hallazgo de US-025 (PR #139: el interceptor de caché a nivel de clase
se coló en una ruta que no debía cachear) es la razón directa por la que
la US-026 declara la caché como NFR explícito (§9) en vez de dejarlo
implícito. Este plan agrega un test-case dedicado (§4, contract-level) que
verifica el header `Cache-Control` real de las 2 rutas nuevas — no alcanza
con que el contenido sea correcto, la política de caché es parte del
contrato observable.

## D-QA4 — Elegibilidad de "más vendidos" reusa el mismo criterio de estado que `hasDeliveredOrderWithProduct`... con una diferencia real

A diferencia de US-025 (reseñas, que exige `delivered`), la US-026 AC-2
declara "al menos una orden confirmada (no `pending_payment`/`cancelled`)"
— un universo más amplio (`new`/`preparing`/`ready`/`delivered`), igual al
que ya usa `ReportsRepository.topProducts` (`WHERE o.status IN
('new','preparing','ready','delivered')`). Los seeds de este plan usan
`crearOrdenEnEstado(...)` de `qa/support/seed-ordenes.ts` con cualquiera de
esos 4 estados (no necesariamente `delivered`) — a diferencia de
US-025-qa, que sí necesitaba forzar `delivered` específicamente.

## Trade-offs

- Mismo trade-off que los planes hermanos: el plan puede necesitar ajuste
  menor cuando el `design.md` real de BE-US-026 fije la forma exacta de los
  2 endpoints (rutas, nombres de query params). Se acepta a cambio de tener
  el plan listo el día que BE/FE cierren.

## Open questions

Ninguna sin resolver — ver `proposal.md`.

## Referencias

- US: `docs/user-stories/US-026-productos-destacados-home.md`
- Seeds reusados: `qa/support/seed-ordenes.ts` (`crearOrdenEnEstado`,
  `catalogoParaCheckout`)
- Precedente D-QA: `openspec/changes/archive/US-025-resenas-calificaciones-productos-qa/design.md`
