# Proposal — US-022 actualización de dependencias del frontend (vulnerabilidades críticas)

> **Ticket**: US-022 — Actualización de dependencias del frontend (vulnerabilidades críticas)
> **Author**: frontend-web-developer agent (assisted by @Gabriel Suarez)
> **Date**: 2026-09-06
> **Status**: Proposed
> **Affected layers**: dependencies (`package.json` / `pnpm-lock.yaml`, root + `apps/web`), build tooling (postcss), no components/state/routing/API surface touched
> **Affected platform**: web (monorepo-wide for the audit gate mechanism)

## Why

Al cerrar el gate de seguridad de US-006 se midió `pnpm audit` sobre el monorepo (2026-08-23, tras el override de `multer` — commit `a4ea348`) y quedaron **53 high y 5 critical**, casi toda la superficie en `apps/web` y en el tooling compartido. Dos de las critical son de `next` (**RCE en el protocolo React flight** y **bypass de autorización en el middleware**) — el código que corre de cara al público del storefront y del panel del dueño. Las dos tienen parche publicado dentro de la misma línea `15.x` (`next` está en `15.1.6`; el lockfile ya marca la resolución actual como `deprecated: This version has a security vulnerability... CVE-2025-66478`).

El PRD (§1.2) pone "que a DSM se la encuentre en Google" como objetivo — un sitio comprometido no sólo pierde ventas, pierde posicionamiento, y ambos se recuperan más lento que un deploy. Esta US no nace de una capacidad del PRD sino de este hallazgo de seguridad, y su único criterio de éxito es que **nada cambie salvo los números de versión** (§8 de la US).

## What

Este change actualiza las dependencias de `apps/web` con vulnerabilidades critical/high conocidas y con parche disponible dentro de la misma línea (sin saltos de major), deja como diferida la única dependencia cuyo parche exige un major (`vitest` 2→3), resuelve las transitivas restantes preferentemente vía `pnpm.overrides` (mismo mecanismo que el override de `multer`, commit `a4ea348`) en vez de forzar un major del padre, y deja un comando de auditoría ejecutable con exit 0 (AC-5) con cualquier exclusión declarada nominalmente, nunca por baja de umbral. No se toca ninguna pantalla, componente, ruta ni contrato de API — es un change de mantenimiento de dependencias puro.

Concretamente:

- **Producción**: `next` 15.1.6 → 15.5.21 (minor, dentro de 15.x); `sharp` agregado como dependencia explícita de `apps/web` en `^0.35.0` (hoy resuelve transitivo vía el `optionalDependencies` de `next`, en `0.33.5`); `postcss` → 8.5.18 (devDependency directa de `apps/web` + `pnpm.overrides` a nivel raíz para forzar la copia interna que `next` fija en `8.4.31`); `undici` → 6.27.0 (transitiva, entra vía `testcontainers` en `apps/api`, se resuelve con `pnpm.overrides` a nivel raíz).
- **Dev-only**: `@playwright/test` de `apps/web` 1.49.1 → 1.55.1 (minor). `vitest` 2.1.8 → 3.2.6 es un major — **diferido, ver Open questions**.
- **Transitivas restantes** (`handlebars`, `node-forge`, `tar-fs`, `brace-expansion`, `js-yaml`, `flatted`, `fast-uri`, `picomatch`, `glob`, `tmp`, `lodash`, `underscore`, `nanoid`, `vite`): resueltas vía `pnpm.overrides` a nivel raíz cuando no se arrastran solas al subir `next`/`playwright`. `handlebars` es especial (entra sólo por `newman`, `qa/`, no toca el bundle de producción) — cualquier ruptura de `newman` por su override cae bajo AC-6+AC-7, **ver Open questions**.
- **Gate ejecutable (AC-5)**: script `scripts/check-audit-exclusions.mjs` (raíz) + `scripts/.audit-exclusions.json` (raíz) + script `audit:gate` en el `package.json` raíz. No se toca CI (`.github/workflows/*.yml`) — endurecer el pipeline es US-019, explícitamente fuera de alcance.
- **Reconciliación de hallazgos nuevos**: 7 highs nuevos desde la medición del 2026-08-23 (`browserslist`×2, `path-to-regexp`, `@faker-js/faker`) — ninguno de producción, se re-auditan en fresco al empezar la ejecución y se resuelven u documentan antes de cerrar el gate.

## Out of scope

- **`react` / `react-dom` de major** — hoy en 19.0.0 sin advisories; tocarlos agrega riesgo sin cerrar ningún hallazgo (US §4).
- **NestJS a major 11** — evaluado y descartado en US-006/commit `a4ea348`: de 61 hallazgos sólo 2 eran de `multer`, ya resueltos con override. Arrastra Express 5 sin cerrar advisories adicionales.
- **Vulnerabilidades `moderate` y `low`** (47 y 12 respectivamente) — fuera del umbral que esta US cierra.
- **Endurecer la CI para que audite en cada PR** — es US-019 (operaciones); acá se deja el comando ejecutable, no el pipeline que lo corre.
- **Bump de `@playwright/test` dentro de `qa/package.json`** — es devDependency propia de la disciplina QA (QA-US-022 la revalida contra las versiones nuevas del stack, pero el bump de su propia copia no es de este change).
- **`vitest` 2→3 (major)** — diferido, ver Open questions. No se ejecuta en este change salvo decisión explícita del usuario.
- **Cualquier `pnpm.overrides` que rompa build/runtime/suite al aplicarse** — no se fuerza ni se decide un workaround unilateral; se escala (ver Open questions y `tasks.md`).

## Affected components / screens

Ninguno — no hay superficie visible (US §8: "No aplica: esta US no cambia ninguna superficie visible"). Archivos tocados:

- `apps/web/package.json` — bump de versiones (`next`, `postcss`, `@playwright/test`) + dependencia nueva (`sharp`).
- `package.json` (raíz) — `pnpm.overrides` ampliado (`postcss`, `undici`, `handlebars`, `node-forge`, `tar-fs`, `brace-expansion`, `js-yaml`, `flatted`, `fast-uri`, `picomatch`, `glob`, `tmp`, `lodash`, `underscore`, `nanoid`, `vite` — el subconjunto que no se arrastre solo) + script `audit:gate`.
- `pnpm-lock.yaml` — regenerado por `pnpm install`.
- `scripts/check-audit-exclusions.mjs` (nuevo, raíz).
- `scripts/.audit-exclusions.json` (nuevo, raíz).

## API consumption

N/A — este change no consume ni modifica ningún endpoint. No hay contrato OpenAPI afectado; no aplica `openapi-client-codegen`.

## Acceptance criteria

Heredadas de `docs/user-stories/US-022-actualizacion-dependencias-frontend.md` §3 (mapeo completo en `tasks.md` — Traceability matrix):

- [ ] AC-1: ninguna dependencia de producción con vulnerabilidad critical (las que queden, documentadas con motivo y dueño).
- [ ] AC-2: `next` en una versión de la línea 15.x sin critical ni high conocidas.
- [ ] AC-3: el sitio sigue funcionando igual — suite completa verde, SSR/sitemap/metadatos intactos.
- [ ] AC-4: dependencias de desarrollo saneadas (`playwright` bump; `vitest` diferido — ver Open questions) sin bajar cobertura.
- [ ] AC-5: comando de auditoría ejecutable con exit 0, exclusiones declaradas nominalmente.
- [ ] AC-6: ningún major que rompa se aplica a ciegas dentro de esta US (negative space).
- [ ] AC-7: ninguna exclusión silenciosa — nunca se sube el umbral de severidad ni se apaga el audit (negative space).

## Standards consulted

- `docs/base-standards.md` — vocabulario prescriptivo; "bumping a library minor version" explícitamente NO amerita ADR (`documentation-standards.md` §8.1).
- `docs/code/frontend-standards.md` §12.5 (Dependencies & OWASP — "run dependency scanning in CI... commit the lockfile", el fundamento directo de AC-5) y §13 (Anti-Patterns, ninguno introducido por este change).
- `docs/code/frontend-next-standards.md` — overlay aplicable porque `stacks.web.framework: nextjs` en `docs/project-config.yml`; sin cambios de App Router/Server Components, sólo verificación de que el bump de `next` no rompe SSR/caching existentes.
- `docs/ai/documentation-standards.md` §4 (docs obligatorios — sin gaps: README/ADR/runbook/api ya existen y ninguno requiere edición) + §8 (ADR triggers — no aplica) + §11 (proceso de actualización — N/A, sin doc nueva).
- `docs/quality/testing-standards.md` §14 — los "tests" de este change son la revalidación de la suite existente, no tests nuevos; AAA no aplica a un bump de dependencias.
- `docs/quality/qa-frontend-standards.md` §23 — cobertura E2E existente (`category-ssr.spec.ts`, `pdp-ssr.spec.ts`, `sitemap.test.ts`, `*-topology.spec.ts`) es la que prueba que SSR/sitemap/metadatos sobrevivieron el bump; no se agregan specs nuevos salvo que la reconciliación de hallazgos nuevos (§ Out of scope) lo exija.

## Open questions

**[Resuelto — 2026-09-06, decisión del usuario: opción (b).** `vitest` 2.1.8 → 3.2.6 (único major de esta US, 2 critical, sólo dev) se ataca primero con un **spike aislado** — medir el blast radius real (qué rompe: provider de coverage, `msw@2.7.0`, `@testing-library/react@16`, setup de `jsdom`) antes de decidir si se integra o se difiere por AC-6. Ver `tasks.md` T4.2 (reemplaza la tarea bloqueada original) para el detalle del spike y el criterio de decisión posterior.]**

**[Deferred — owner: usuario, motivo: cualquier `pnpm.overrides` de una transitiva (Fase 5 de `tasks.md`) que rompa build/runtime/suite al aplicarse — en particular el override de `handlebars` (entra sólo por `newman` en `qa/`, si rompe el rendering de reportes de `newman` cae bajo AC-6+AC-7) pero también cualquiera del resto de la lista (`node-forge`, `tar-fs`, `brace-expansion`, `js-yaml`, `flatted`, `fast-uri`, `picomatch`, `glob`, `tmp`, `lodash`, `underscore`, `nanoid`, `vite`). Esto no se puede evaluar en tiempo de planificación — sólo se sabe si algo rompe al ejecutar el override —, así que cada tarea de Fase 5 en `tasks.md` lleva instrucción explícita: si romper algo, PARAR y escalar como una nueva entrada `[Deferred — owner: usuario, ...]` en este archivo, nunca forzarlo ni resolverlo con un workaround unilateral.]**

Sin más preguntas abiertas fuera de estas dos.
