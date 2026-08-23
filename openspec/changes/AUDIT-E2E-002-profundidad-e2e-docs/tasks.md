## Traceability matrix

| Finding ID | Title | Task IDs | Status |
|---|---|---|---|
| AUDIT-E2E-002 | §14 STRIDE es tabla, no modelo por flujo | T1.1 | in this change |
| AUDIT-E2E-006 | §17 disponibilidad 99.5% sin medición | T2.1 | in this change |
| AUDIT-E2E-007 | §8 DER no modela refresh_tokens | T3.1 | in this change |
| AUDIT-E2E-008 | Contratos API delegados (decisión documentada) | T4.1 | in this change |
| AUDIT-E2E-009 | §23 Q-4 sigue Open pero E2E Approved | T4.2 | in this change |

---

## Fase 1 — STRIDE por flujo (Major)

- [ ] T1.1 Expandir §14 con STRIDE por flujo

En `docs/product/design-e2e.md` §14: mantener la tabla existente como resumen y agregar debajo un análisis STRIDE por flujo para al menos 3 flujos que cruzan trust boundaries: (1) webhook de pago, (2) login/sesión, (3) búsqueda IA. Cada flujo debe cubrir las 6 categorías con un control nombrado o "N/A — justificación" por cada una. Agregar Repudiation y DoS para checkout/pagos (ausentes en la tabla actual).

  - **Exit criterion**: §14 contiene ≥3 subsecciones de flujo, cada una con las 6 categorías STRIDE explícitas y controles nombrados.
  - **Verify**: `grep -c "Spoofing\|Tampering\|Repudiation\|Information Disclosure\|Denial of Service\|Elevation" docs/product/design-e2e.md` devuelve ≥18 (6 categorías × 3 flujos)

---

## Fase 2 — NFR de medición

- [ ] T2.1 Agregar método de medición del 99.5% a §17

En la fila de disponibilidad de §17: agregar cómo se mide (uptime del servicio API reportado por Railway health endpoint, ventana mensual, excluye mantenimiento planificado con aviso >24h).

  - **Exit criterion**: La fila de 99.5% en §17 incluye el método de medición (endpoint + ventana + exclusiones).
  - **Verify**: `grep -A3 "99.5" docs/product/design-e2e.md | grep -qi "health\|mensual\|monthly\|ventana"`

---

## Fase 3 — DER

- [ ] T3.1 Agregar REFRESH_TOKENS al DER de §8

Agregar la entidad con sus columnas (id, customer_id FK, token_hash, expires_at, revoked_at, family_id, created_at) y la relación CUSTOMERS ||--o{ REFRESH_TOKENS.

  - **Exit criterion**: El bloque Mermaid `erDiagram` de §8 contiene `REFRESH_TOKENS` con sus columnas.
  - **Verify**: `grep -q "REFRESH_TOKENS" docs/product/design-e2e.md && grep -q "family_id" docs/product/design-e2e.md`

---

## Fase 4 — Info: cerrar items informativos

- [ ] T4.1 Confirmar delegación de contratos con link

Verificar que la nota post-§6 ("contratos OpenAPI en la planificación de tickets") es suficiente. Si no tiene link al directorio `contracts/` o a los changes que los producen, agregarlo.

  - **Exit criterion**: La nota post-§6 referencia dónde viven los contratos (path o link a openspec).
  - **Verify**: `grep -A5 "planificación de tickets\|planning" docs/product/design-e2e.md | grep -qi "contracts\|openspec\|openapi"`

- [ ] T4.2 Cerrar Q-4 de §23

Marcar Q-4 como `[Closed]` con la resolución: ventana estimada ~5.5h para catálogo de ~5.000 productos con free tier a 15 RPM (ref US-005 proposal).

  - **Exit criterion**: Q-4 en §23 está marcada `[Closed]` o `[Resolved]` con la estimación.
  - **Verify**: `grep -A2 "Q-4" docs/product/design-e2e.md | grep -qi "Closed\|Resolved\|resuelta\|5.5"`
