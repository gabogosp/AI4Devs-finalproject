## Why

Cuatro findings del frontend-web audit (`dsm-web/2026-08-22/audit.md`) con status `open` identifican deuda técnica en `apps/web`. Los 2 Major: CSP con `unsafe-inline` (DSM-WEB-001) y cross-feature imports que violan aislamiento (DSM-WEB-004). El Minor: sin `loading.tsx` global ni Suspense de streaming (DSM-WEB-008). El Info: sin visual regression tests (DSM-WEB-010).

## What changes

1. **Migrar CSP a nonce-based** — eliminar `unsafe-inline` de `script-src` y `style-src` en `next.config.mjs`, implementar generación de nonce en Server Components (o al menos producir un ADR/plan de migración con plazo). Mover de `Report-Only` a enforce. (DSM-WEB-001)
2. **Resolver cross-feature imports** — refactorizar los 6 archivos que importan directamente de otra feature: extraer los componentes compartidos a `core/` o a barrel exports públicos de la feature productora. (DSM-WEB-004)
3. **Documentar decisión de streaming vs 404** — el código documenta que `loading.tsx` compromete el 404 real. Crear la justificación como comentario en el layout o entrada en design.md del change. Opcionalmente agregar Suspense selectivo para secciones no-dinámicas. (DSM-WEB-008)
4. **Agregar ≥3 visual regression tests** con `toHaveScreenshot` de Playwright — cubrir al menos home, PDP y login. (DSM-WEB-010)

## Out of scope

- DSM-WEB-002 (tokens Tailwind): `deferred` (deuda cosmética aceptada).
- DSM-WEB-003 (Sentry SDK): `deferred` (requiere DSN de Sentry, depende de US-019).
- DSM-WEB-005 (eslint-plugin-jsx-a11y): `deferred` (quick win que se incorpora al próximo deploy).
- DSM-WEB-006 (contraste gray-500): `deferred`.
- DSM-WEB-007 (admin token en sessionStorage): ya tiene su change propio (`AUDIT-dsm-web-007-endurecimiento-panel-frontend-web`).
- DSM-WEB-009 (lucide-react ^): ya `addressed`.
- DSM-WEB-011 (initObservability no invocada): `deferred` (dependiente de DSM-WEB-003).
- No se escribe `design.md`: la CSP nonce-based y los cross-feature imports son refactors con patrón documentado en los standards.

## References

- Reporte fuente: `docs/audits/dsm-web/2026-08-22/audit.md`
- Standards: `frontend-next-standards.md` §8.bis (CSP), `frontend-standards.md` §2.2 (aislamiento features)
- Código afectado: `apps/web/next.config.mjs`, `apps/web/src/features/products/`, `apps/web/src/features/storefront/`
