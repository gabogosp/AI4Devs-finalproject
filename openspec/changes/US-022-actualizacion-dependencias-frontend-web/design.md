# Design — US-022 actualización de dependencias del frontend

## Context

US-022 no nace de una capacidad del PRD sino de un hallazgo del gate de seguridad de US-006 (`pnpm audit` monorepo-wide tras el override de `multer`, commit `a4ea348`). Ese commit ya estableció el patrón que este change reutiliza: **preferir `pnpm.overrides` sobre forzar un major del paquete padre** cuando el hallazgo es transitivo y el major arrastra un radio de impacto mucho mayor que el problema que resuelve. `next` es distinto — el hallazgo es del paquete directo, con parche disponible dentro de la misma línea `15.x`, así que ahí el mecanismo es un bump directo, no un override.

Este change no introduce ninguna decisión arquitectónica nueva: es la aplicación del mismo mecanismo ya aceptado, a un conjunto distinto de paquetes. Por eso ninguna de las decisiones de abajo dispara ADR — `documentation-standards.md` §8.1 excluye explícitamente "bumping a library minor version" de la tabla de lo que amerita ADR, y la elección del mecanismo (`pnpm.overrides`) ya está documentada como precedente en el commit `a4ea348`, no como una decisión nueva de este change.

## Goals

- Cerrar las 2 critical + 11 high de `next` sin salir de la línea `15.x`.
- Cerrar los high de `sharp`, `postcss` y `undici` (producción/build/transitiva) con el mismo criterio: sin saltos de major que no cierren ningún hallazgo adicional.
- Resolver las transitivas restantes vía `pnpm.overrides`, con escalamiento explícito (no decisión unilateral) si alguna rompe algo al aplicarse.
- Dejar un comando de auditoría ejecutable (`pnpm run audit:gate`) con exit 0, con cualquier exclusión declarada nominalmente — nunca por baja de umbral ni por apagar el audit.
- Cero regresión funcional: la suite completa del monorepo verde antes y después, con el mismo número de tests (US §9).

## Non-goals

- No se decide el destino de `vitest` 2→3 en este change — queda como pregunta abierta explícita (ver `proposal.md`).
- No se endurece la CI para que corra `audit:gate` en cada PR — es US-019.
- No se toca ninguna superficie visible, componente, ruta o contrato de API.
- No se resuelve aquí el bump del `@playwright/test` propio de `qa/package.json` — pertenece a la disciplina QA de esta misma US.

## Approach

### D1 — `next` 15.1.6 → 15.5.21 (bump directo, dentro de línea)

`apps/web/package.json` `dependencies.next` pasa de `15.1.6` a `15.5.21`. El lockfile hoy marca la resolución actual como:

```yaml
next@15.1.6:
  resolution: {integrity: sha512-Hch4wzbaX0vKQtalpXvUiw5sYivBy4cm5rzUKrBnUB/y436LGrvOUqYvlSeNVCWFO/770gDlltR9gqZH62ct4Q==}
  deprecated: This version has a security vulnerability. Please upgrade to a patched version. See https://nextjs.org/blog/CVE-2025-66478 for more details.
```

confirmando el hallazgo de la US sin re-medirlo. `next` en `apps/web` fija internamente su propia copia de `postcss` (`postcss: 8.4.31` bajo `next@15.1.6`'s `dependencies`, línea 12897 de `pnpm-lock.yaml`, distinta de la copia que usa Tailwind vía `apps/web`'s propia devDependency `postcss: 8.4.49`) — el bump de `next` puede o no arrastrar una versión más nueva de esa copia interna; D3 cubre el caso en que no lo haga.

**Riesgo específico de este bump**: las dos critical que cierra son *RCE en el protocolo React flight* y *bypass de autorización en middleware* — el segundo toca exactamente el mecanismo sobre el que se apoyan los guards de `apps/web` (`AdminGuard`, `CustomerGuard`, el rewrite de `/v1/auth/*` de ADR-0013). Cualquier cambio de comportamiento del middleware entre `15.1.6` y `15.5.21` tiene que verificarse contra la suite E2E de topología existente (`e2e/auth-topology.spec.ts`, `e2e/cart-topology.spec.ts`, `e2e/checkout-topology.spec.ts`, `e2e/admin-noindex.spec.ts`, `e2e/cart-noindex.spec.ts`) antes de considerar el bump cerrado — no alcanza con que el build compile.

### D2 — `sharp`: dependencia explícita de producción, no override

Hoy `sharp` no es una dependencia directa de `apps/web` — resuelve transitivo como `optionalDependencies.sharp` de `next@15.1.6` (línea 12912 de `pnpm-lock.yaml`, resuelto en `0.33.5`). La convención de Next.js para despliegues self-hosted es instalar `sharp` explícitamente para la optimización de imágenes en producción (evita el fallback a optimización no acelerada y fija la versión en vez de depender de qué resuelva el optional de `next`). Este change agrega `sharp: "^0.35.0"` a `dependencies` de `apps/web/package.json` — no es un `pnpm.overrides`, es una dependencia directa nueva, consistente con la guía upstream de Next.js.

**Options considered**:
- **Override de `sharp` sin agregarlo como dependencia directa** — descartado: quedaría implícito que `apps/web` depende de un optional de `next`, lo que es exactamente el tipo de dependencia frágil que la US busca sanear.
- **Dependencia explícita (elegida)** — hace visible en `apps/web/package.json` que la optimización de imágenes depende de una versión pinneada, alineado con el NFR de LCP < 2.5s (US §9) y con la guía oficial de Next.js.

**ADR triggered?**: no — es una adición de dependencia con guía upstream clara, no una decisión de arquitectura.

### D3 — `postcss`: bump directo + override para la copia interna de `next`

Dos copias de `postcss` conviven en el árbol: la devDependency directa de `apps/web` (`8.4.49`, usada por Tailwind/autoprefixer) y la copia interna que `next@15.1.6` fija en `8.4.31` para su propio procesamiento de CSS. Bumpear sólo la devDependency directa no necesariamente resuelve la copia interna de `next` si el bump de `next` (D1) no la arrastra sola. Este change:

1. Bumpea `apps/web/package.json` `devDependencies.postcss` a `8.5.18`.
2. Agrega `postcss: "8.5.18"` a `pnpm.overrides` en el `package.json` raíz — mismo mecanismo que el override de `multer` (commit `a4ea348`) — para forzar la resolución de **toda** copia de `postcss` en el árbol, incluida la interna de `next`, sin esperar a que `next` la arrastre sola.

Si tras el bump de `next` (D1) `pnpm audit` ya no reporta `postcss` como vulnerable (porque `next@15.5.21` ya fija internamente una versión segura), el override de todos modos no rompe nada — sólo es redundante — así que se agrega de todas formas como cinturón de seguridad, salvo que rompa el build de Tailwind (en cuyo caso aplica la cláusula de escalamiento de Fase 5, ver `tasks.md`).

### D4 — `undici`: override de raíz, viene de `apps/api` (fuera de `apps/web`)

Verificado en el lockfile: `undici: 5.29.0` resuelve como dependencia directa de `testcontainers@10.16.0` (línea 14371 de `pnpm-lock.yaml`), que es devDependency de `apps/api` (`@testcontainers/postgresql`, usado en tests de integración del backend) — **no** de `apps/web`. Aun así, la US §7 asigna este ítem a la tarea FE, y el mecanismo (`pnpm.overrides` a nivel raíz) es monorepo-wide por diseño — el mismo `package.json` raíz que ya tiene el override de `multer` es el lugar correcto para declarar `undici: "6.27.0"`, independientemente de qué workspace lo consuma. Se documenta acá para que quede explícito que la tarea toca una dependencia de test de `apps/api`, no de `apps/web` — y que `develop-frontend-web` debe correr la suite de integración de `apps/api` (que usa `testcontainers`) como parte de la verificación, no sólo la de `apps/web`.

### D5 — Transitivas restantes: `pnpm.overrides` primero, nunca forzar el major del padre

`handlebars`, `node-forge`, `tar-fs`, `brace-expansion`, `js-yaml`, `flatted`, `fast-uri`, `picomatch`, `glob`, `tmp`, `lodash`, `underscore`, `nanoid`, `vite` tienen múltiples versiones conviviendo en el lockfile (confirmado por `grep` — p. ej. `glob@10.4.5`, `glob@10.5.0`, `glob@13.0.6`, `glob@7.2.3` todas presentes). El mecanismo preferido es el mismo de `a4ea348`: agregar la entrada al `pnpm.overrides` raíz apuntando a la versión mínima segura que el propio `pnpm audit` reporte como "fixed in" al momento de ejecutar (no se fija de antemano en este plan una versión que no se pudo verificar contra el advisory vivo — hacerlo sería repetir el error que motivó el comentario del commit `a4ea348`: "de 61 hallazgos high/critical sólo 2 eran de multer", una premisa que se pudo haber evitado midiendo antes de decidir).

`handlebars` es el caso especial: confirmado en el lockfile que entra únicamente vía `postman-runtime` (dependencia de `newman`, devDependency de `qa/package.json`) — no toca ningún bundle de producción. Si el override rompe el rendering de reportes de `newman`, cae bajo AC-6 (no se aplica a ciegas) + AC-7 (la exclusión, si hace falta, es nominal) — nunca se revierte en silencio ni se decide un workaround sin escalar.

**ADR triggered?**: no — el mecanismo ya es precedente aceptado (commit `a4ea348`), esto es su aplicación, no su adopción.

### D6 — Gate de auditoría ejecutable (AC-5)

Mecanismo elegido, siguiendo el estilo ya usado en `apps/web/scripts/check-whatsapp-configured.mjs` (script Node plano, sin dependencias nuevas, `console.error` + `process.exit(1)` en el camino de falla):

- `scripts/.audit-exclusions.json` (raíz) — array de exclusiones nominales. Cada entrada exige `package`, `advisoryId` (GHSA o CVE), `reason`, `owner`, `reviewBy` (fecha ISO). Una entrada sin los cinco campos hace fallar el gate igual que un hallazgo sin excluir — la nominalidad no es opcional.
- `scripts/check-audit-exclusions.mjs` (raíz) — recibe por stdin el JSON de `pnpm audit --audit-level=high --json`, cruza cada hallazgo `high`/`critical` contra `.audit-exclusions.json` por `package` + `advisoryId`, y:
  - Exit 0 sólo si **todo** hallazgo ≥ high está excluido nominalmente.
  - Exit 1 listando cada hallazgo no cubierto, o cada exclusión mal formada.
  - **Nunca** lee ni acepta un flag que suba el umbral de severidad del audit — el `--audit-level=high` está hardcodeado en el script invocador (`package.json`), no es configurable desde `.audit-exclusions.json` ni desde el propio script. Esto es lo que impide que AC-7 se viole por accidente.
- `package.json` raíz — nuevo script `"audit:gate": "pnpm audit --audit-level=high --json | node scripts/check-audit-exclusions.mjs"`.

**Options considered**:
- **Wirear el gate directo en `.github/workflows/ci.yml`** — descartado: la US marca explícitamente esto como fuera de alcance (US-019, operaciones). El comando queda ejecutable y documentado; engancharlo al pipeline es otro change.
- **Usar una herramienta de terceros (Snyk, Socket.dev) en vez de un script propio** — descartado por ahora: `frontend-standards.md` §12.5 menciona `npm audit / Snyk / Dependabot / Socket.dev` como alternativas equivalentes, ninguna mandatoria; el proyecto no tiene cuenta de ninguna herramienta comercial provisionada, y un script propio sobre `pnpm audit` (ya disponible sin instalar nada) es la opción de menor fricción y consistente con el estilo ya establecido (`check-whatsapp-configured.mjs`).

**ADR triggered?**: no — es un script operativo (mismo nivel que el gate de WhatsApp), no una decisión de arquitectura.

### D7 (Deferred) — `vitest` 2 → 3

No se decide en este change. Ver `proposal.md` Open questions. `tasks.md` deja la tarea correspondiente en un estado explícitamente bloqueado (no ejecutable) hasta que el usuario elija una de las tres opciones planteadas.

## Trade-offs

- **Override "cinturón de seguridad" de `postcss` aunque el bump de `next` ya lo resuelva** (D3): trabajo redundante si `next@15.5.21` ya trae una copia interna segura, pero el costo de verificarlo antes es mayor que el de simplemente declarar el override y confirmar que no rompe nada — mismo criterio que ya aplicó `a4ea348` (agregar el override y verificar, no decidir a mano sin medir).
- **No fijar de antemano las versiones exactas del batch de transitivas de D5**: un plan más "completo" fijaría cada versión ahora, pero eso repetiría el error que el propio commit `a4ea348` señala como causa de un deferral que dejó de ser cierto — decidir sin medir. Se prefiere que `develop-frontend-web` lea el advisory vivo al ejecutar.
- **Gate propio en vez de una herramienta comercial** (D6): menos features (sin dashboard, sin tracking histórico) pero cero fricción de setup y consistente con el resto del repo — el trade-off se revisita si el proyecto adopta Snyk/Socket.dev por otra razón.

## Open questions

Ver `proposal.md` — las dos entradas `[Deferred — owner: usuario, ...]` (vitest 2→3, y cualquier override de Fase 5 que rompa algo al aplicarse).

## References

- Ticket: US-022 (`docs/user-stories/US-022-actualizacion-dependencias-frontend.md`)
- Precedente directo: commit `a4ea348` (`fix(deps): parchea la DoS de multer con un override, sin upgrade de major`)
- Standards: `docs/code/frontend-standards.md` §12.5 (Dependencies & OWASP), §8.1 de `docs/ai/documentation-standards.md` (ADR triggers — bump de minor explícitamente excluido)
- Related ADRs: ninguno (ver D1-D6, ninguna decisión dispara ADR)
- Related OpenSpec changes: ninguno en `openspec/changes/` con overlap detectado en el momento de planificar
