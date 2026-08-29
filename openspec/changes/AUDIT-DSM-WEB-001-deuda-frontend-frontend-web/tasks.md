## Traceability matrix

| Finding ID | Title | Task IDs | Status |
|---|---|---|---|
| AUDIT-DSM-WEB-001 | CSP permite `unsafe-inline` | T1.1, T1.2 | in this change |
| AUDIT-DSM-WEB-004 | Cross-feature imports violan aislamiento | T2.1, T2.2 | in this change |
| AUDIT-DSM-WEB-008 | Sin loading.tsx / Suspense streaming | T3.1 | in this change |
| AUDIT-DSM-WEB-010 | Sin visual regression tests | T4.1 | in this change |

---

## Fase 1 — CSP nonce-based (Major)

- [ ] T1.1 Implementar generación de nonce y aplicar a CSP

En `next.config.mjs` (o `middleware.ts`): generar un nonce por request (crypto.randomUUID), inyectarlo en el header CSP como `script-src 'nonce-{n}' 'self'; style-src 'nonce-{n}' 'self'`, y pasarlo a los inline scripts de Next.js vía `<Script nonce={nonce}>`. Eliminar `unsafe-inline`.

  - **Exit criterion**: `next.config.mjs` no contiene `unsafe-inline` y la CSP usa nonce o hash.
  - **Verify**: `! grep -q "unsafe-inline" apps/web/next.config.mjs && (grep -q "nonce\|sha256" apps/web/next.config.mjs || grep -q "nonce\|sha256" apps/web/src/middleware.ts)`

- [ ] T1.2 Mover CSP de Report-Only a enforce

Cambiar `Content-Security-Policy-Report-Only` a `Content-Security-Policy` (enforce).

  - **Exit criterion**: El header emitido es `Content-Security-Policy` (no Report-Only).
  - **Verify**: `! grep -qi "Report-Only" apps/web/next.config.mjs && ! grep -qi "Report-Only" apps/web/src/middleware.ts`

---

## Fase 2 — Cross-feature imports (Major)

- [ ] T2.1 Extraer componentes compartidos a core/ o barrel exports

Identificar los imports cross-feature (6 archivos: ProductForm, ProductCreate, ProductEdit, ProductActions, ProductPurchase, CategoryForm) y: (a) mover los componentes importados a `src/core/` si son realmente shared, o (b) exponer un barrel export explícito (`index.ts`) de la feature productora.

  - **Exit criterion**: Ningún archivo en `src/features/X/` importa directamente de `src/features/Y/` (excepto vía barrel exports de `index.ts`).
  - **Verify**: `! grep -r "from '@/features/" apps/web/src/features/ --include="*.tsx" --include="*.ts" | grep -v "test\|spec\|index" | grep -v "/index"`

- [ ] T2.2 Agregar eslint rule para prevenir recurrencia

Configurar un alias de ESLint (ej. `no-restricted-imports` o `boundaries/element-types`) que prohíba imports directos entre features excepto vía barrel.

  - **Exit criterion**: Lint falla si se introduce un import cross-feature directo.
  - **Verify**: `grep -q "restricted\|boundaries\|no-cross-feature" apps/web/.eslintrc.json apps/web/eslint.config.* 2>/dev/null`

---

## Fase 3 — Streaming / loading.tsx

- [ ] T3.1 Documentar decisión de no-streaming con justificación

El código ya documenta que `loading.tsx` compromete el 404 real (priorización de SEO sobre TTFB). Formalizar como nota en `openspec/changes/US-002-storefront-navegacion-categorias-frontend-web/design.md` o en un ADR minor, indicando el trade-off aceptado y bajo qué condiciones se reconsideraría (ej.: ≥2s TTFB medido en prod).

  - **Exit criterion**: Existe documentación formal del trade-off streaming-vs-404 con justificación y condiciones de revisión.
  - **Verify**: `grep -rqi "loading.tsx\|streaming.*404\|404.*streaming" openspec/changes/US-002-*/design.md docs/architecture/decisions/ apps/web/app/`

---

## Fase 4 — Visual regression tests (Info)

- [ ] T4.1 Agregar ≥3 tests con toHaveScreenshot

Crear tests Playwright con `toHaveScreenshot()` para: (a) home/storefront, (b) ficha de producto (PDP), (c) login. Guardar baselines.

  - **Exit criterion**: ≥3 archivos de test usan `toHaveScreenshot` y existen las baselines.
  - **Verify**: `grep -rl "toHaveScreenshot" apps/web/e2e/ qa/e2e/ 2>/dev/null | wc -l` devuelve ≥3
