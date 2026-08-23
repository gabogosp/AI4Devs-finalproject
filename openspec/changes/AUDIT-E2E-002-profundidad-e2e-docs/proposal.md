## Why

Cinco findings del E2E depth audit (`2026-08-22-e2e-depth-audit.md`) identifican gaps de profundidad en el documento `design-e2e.md`. El más grave (Major): §14 STRIDE es una tabla de controles genérica, no un modelo de amenazas por flujo con las 6 categorías (E2E-002). Los restantes son menores: el DER no modela `refresh_tokens` (E2E-007), el 99.5% no tiene procedimiento de medición (E2E-006), y dos Info (delegación de contratos documentada E2E-008, Q-4 abierta E2E-009).

El E2E está `Approved` desde 2026-06-15 — la remediación es una actualización del documento de referencia para cerrar la deuda de especificación.

## What changes

1. **Expandir §14 STRIDE por flujo** — cubrir al menos webhook de pago, login/sesión y búsqueda IA con las 6 categorías (S, T, R, I, D, E) explícitas y controles nombrados para cada una. (E2E-002)
2. **Agregar método de medición del 99.5%** a §17 — definir: uptime del servicio API reportado por Railway (health endpoint), ventana mensual, excluyendo mantenimiento planificado. (E2E-006)
3. **Agregar entidad `REFRESH_TOKENS` al DER §8** — columnas: id, customer_id FK, token_hash, expires_at, revoked_at, family_id, created_at. (E2E-007)
4. **Documentar que contratos API están delegados** — confirmar que la nota post-§6 es suficiente; opcionalmente agregar link al directorio `contracts/`. (E2E-008)
5. **Cerrar Q-4 en §23** — indicar que fue resuelta por el plan de US-005 (estimación ~5.5h para catálogo inicial con free tier a 15 RPM). (E2E-009)

## Out of scope

- E2E-001: ya `addressed` (suposición §21 actualizada).
- E2E-003, E2E-004, E2E-005: ya `addressed`.
- Reformular completamente el E2E — sólo se parchean las secciones señaladas.
- No se escribe `design.md`: las decisiones del STRIDE por flujo son contenido del E2E, no del change.

## References

- Reporte fuente: `docs/audits/e2e/2026-08-22-e2e-depth-audit.md`
- Documento objetivo: `docs/product/design-e2e.md`
- ADR-0011 (refresh tokens): `docs/architecture/decisions/0011-server-refresh-token-store.md`
- US-005 proposal (ventana de corrida): `openspec/changes/US-005-enriquecimiento-ia-embeddings-backend/proposal.md`
