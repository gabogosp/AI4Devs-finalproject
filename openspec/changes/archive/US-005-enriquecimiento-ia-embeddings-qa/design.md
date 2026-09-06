---
parent-us: US-005
discipline: qa
language: es
---

# US-005 QA — Design

## Context

Este plan diseña la arquitectura de test para la superficie **admin** de la capacidad
`enriquecimiento-ia` (2 endpoints, matriz de decisión por producto, degradación sin
proveedor) que `US-005-enriquecimiento-ia-embeddings-backend` construyó y archivó el
2026-08-29. A diferencia de otros planes hermanos de este repo, el riesgo que gobierna el
diseño **no** es sólo "qué queda `blocked` por falta de una cuenta externa" (aunque eso
también aplica, ver §D-QA1) — es que el entorno compartido de QA, **tal como está
configurado hoy**, puede estar generando tráfico real no solicitado hacia Google con una
clave inválida cada vez que cualquier sesión corre un import. Ese hallazgo (QA-005-F1) se
resuelve antes de escribir el primer escenario, en Fase 0.

## Goals

- Cerrar la brecha de higiene de entorno (QA-005-F1) para que la instancia larga y
  compartida de `qa/scripts/api-up.sh` **nunca** llame a Gemini por accidente.
- Construir la suite de aceptación negro-caja para todo lo que SÍ es ejecutable hoy sin una
  `GEMINI_API_KEY` real: mecánica de los 2 endpoints, degradación explícita (`disabled`),
  backoff durable + cooldown del circuit-breaker (usando **fallas reales** del proveedor
  contra una clave inválida — nunca un doble), abandono completo tras
  `ENRICHMENT_MAX_ATTEMPTS`, la costura de curación en `PATCH /admin/products/{id}`, "nunca
  publica" y "nunca filtra el secreto".
- Dejar explícito, escenario por escenario, cuál AC queda `@blocked` por necesitar una
  respuesta **exitosa** real del proveedor, y por qué eso no es simulable sin violar la
  regla de "sustitución estructural sólo si el propio diseño la autoriza" (no la autoriza
  acá: no existe un endpoint equivalente a `simulate-payment` para el enriquecimiento).
- Corregir la mitad segura del hallazgo de contrato incompleto (QA-005-F2) y documentar la
  mitad que requiere código.
- Medir NFR-3 (E2E §17: la lectura del storefront no se degrada durante una corrida) sobre
  endpoints de catálogo genérico, reusando los presupuestos YA declarados en
  `qa/performance/lib/thresholds.js` (`list_products`, `storefront_product`) — sin inventar
  un número nuevo.

## Non-goals

- Repetir `QA-004-REL-*` / `QA-004-PERF-3` — ya viven en el qa-plan de US-004 y miden
  exactamente el riesgo de la convivencia `enriquecimiento` + `búsqueda`.
- E2E cross-stack Playwright — no hay pantalla FE que cruzar (D-1 diferida).
- Tocar `apps/api/src/` — ninguna task de este plan modifica código de aplicación.
- Conseguir una `GEMINI_API_KEY` real — recomendado en `proposal.md` (OQ-QA-005-1), no
  ejecutado por este plan.
- Exponer `description_curated`/`enrichment_done` en `ProductResponseDto` — cambio de
  código de `catalogo`, fuera de alcance (OQ-QA-005-2).

## Approach

### D-QA1 — Qué es ejecutable negro-caja sin una `GEMINI_API_KEY` real, y por qué

Verificado leyendo el código real (`ai.providers.ts`, `enrichment.service.ts`,
`enrichment.runner.ts`), no asumido:

| Mecanismo | Necesita que Gemini responda **con éxito** | Alcanzable hoy (negro-caja) |
|---|---|---|
| Auth (401/403) en los 2 endpoints | No | ✅ Sí |
| `GET /status` — forma, `coverage` correcto vs. la base real, sin secreto, `no-store` | No | ✅ Sí |
| `POST /runs` — 422 de validación (campo desconocido, `product_ids` mal formado o > 500) | No | ✅ Sí — el `ValidationPipe` corre antes de tocar el runner |
| `POST /runs` — 503 `dsm:enrichment/disabled` (sin proveedor o `ENRICHMENT_ENABLED=false`) | No (es justamente el camino sin llamada) | ✅ Sí |
| `POST /runs` — 409 `run-in-progress` (segundo POST mientras el primero sigue en vuelo) | No — sólo necesita que la llamada esté *en curso*, no que tenga éxito | ✅ Sí |
| `POST /runs` — 409 `cooldown` tras `ENRICHMENT_FAILURE_THRESHOLD` fallas consecutivas | No — el circuit-breaker cuenta fallas, no éxitos | ✅ Sí, con una clave real **inválida**: Google rechaza con un 401/403 **real**, no simulado |
| `registerFailure` — backoff durable (1m/5m/25m/2h/10h) y abandono a los `ENRICHMENT_MAX_ATTEMPTS` (AC-5, parte de AC-4) | No — el código no distingue error transitorio de permanente para este contador | ✅ Sí, mismo mecanismo: cada corrida real contra la clave inválida es una falla real que empuja el contador |
| Costura de curación — `PATCH` setea `description_curated=true` + `enrichment_done=false` (AC-7, mitad mecánica) | No | ✅ Sí, con la excepción de lectura de §D-QA2 |
| AC-9 (sin secreto en `/status`/`/runs`, incl. en una corrida real que falla) | No — de hecho **más fácil** con fallas reales que con un mock | ✅ Sí |
| AC-10 (nunca publica, éxito o falla) | No — la columna `status` está fuera del `UPDATE` en las dos ramas | ✅ Sí |
| AC-1 (enriquecer + embeddear **con éxito**) | Sí | ❌ **Blocked** |
| AC-2 (el producto resultante es buscable) | Sí (depende de AC-1) | ❌ **Blocked** — y aunque hubiera clave, ya está cubierto dev-owned (T2.3/T6.1) + por el seed directo de `QA-004-*` |
| AC-6 (saltar la 2ª corrida si no cambió) | Sí — el hash sólo se persiste en el camino de éxito (`actualizarProducto`); en falla nunca se escribe `enrichment_source_hash` | ❌ **Blocked** |
| AC-7 (mitad completa: el embedding se regenera sobre el texto curado, nunca sobre el crudo) | Sí | ❌ **Blocked** — sólo la mitad mecánica es Q |
| AC-8 (versión de modelo registrada) | Sí | ❌ **Blocked** |

**Por qué el circuit-breaker y el backoff durable SÍ son alcanzables sin clave real, y no
es una sustitución estructural no autorizada**: `registerFailure` (`enrichment.service.ts`)
y el contador de `cooldown` (`enrichment.runner.ts`) no leen el *tipo* del error para
decidir si cuentan — cuentan cualquier excepción del puerto `AiEmbedder`/`AiEnricher`. Con
`GEMINI_API_KEY` apuntando a un valor que Google rechaza, el `GeminiHttpClient` real hace
una llamada HTTP real, contra el servidor real de Google, que responde un 401/403 real (no
inventado, no mockeado) — la clasificación "permanente" de ese código simplemente significa
que el cliente no reintenta *en el mismo request* (T1.3, dev-owned), pero el contador
*durable* de intentos y el contador *de runner* de fallas consecutivas no distinguen, así
que ambos avanzan igual que avanzarían con un 429 transitorio repetido. Es el **mismo
proveedor real**, respondiendo lo que responde a una clave que no reconoce — no un doble.

**Por qué AC-1/AC-2/AC-6/AC-8 no tienen un atajo estructural análogo** (a diferencia de
`simulate-payment` en US-010): no existe, ni el propio `design.md` de backend propone, un
endpoint que produzca el efecto de "enriquecido con éxito" sin llamar al proveedor real. Un
adapter de "éxito falso" está explícitamente prohibido por el propio D6 del backend ("un
embedding falso... se descubre en la demo"). La única vía honesta es una clave real.

### D-QA2 — El hallazgo de contrato incompleto (QA-005-F2) y la excepción de lectura

`UpdateProductDto` acepta `description_enriched` (T4.3, verificado en
`apps/api/src/products/dto/product.dto.ts:67`) pero:

1. `openspec/specs/catalogo/contracts/openapi.yaml`, schema `UpdateProduct`, no lo declara
   — **mitad segura de corregir**: el campo ya es verdad en producción, declararlo es
   documentar lo que existe, no inventar comportamiento. Este plan agrega
   `description_enriched: { type: string, nullable: true }` a `UpdateProduct` (T2.1 de
   `tasks.md`).
2. `ProductResponseDto.from()` (`apps/api/src/products/dto/product.dto.ts:127`) nunca
   devuelve `description_enriched`, `description_curated` ni `enrichment_done` — ni en el
   `GET`, ni en la respuesta del propio `PATCH` que los setea. **Mitad insegura de
   corregir**: agregarlos al contrato sin que el código los devuelva haría que el contrato
   describiera algo falso — peor que la ausencia actual. Queda como hallazgo documentado
   (`proposal.md` OQ-QA-005-2), no se toca el contrato de lectura.

**Consecuencia para el escenario de curación (AC-7 mitad mecánica)**: no hay forma de leer
por API si `description_curated`/`enrichment_done` cambiaron tras el `PATCH`. Se agrega
`qa/support/enrichment-db.ts` con una función de **sólo lectura** vía `@dsm/db` (Prisma) —
`leerEstadoEnriquecimiento(productId)` — para observar esas tres columnas. Es una excepción
angosta y documentada, mismo tipo de precedente que `qa/support/backdate-order.ts` de
`US-010-orden-webhook-stock-qa` (D-QA5 de ese plan): existe **sólo** para leer lo que la API
no expone, nunca para fabricar el efecto que el escenario prueba (el `PATCH` real sigue
siendo el que produce el cambio; la función sólo lo *observa*).

### D-QA3 — Aislar la instancia compartida del entorno de QA (fix de QA-005-F1)

`qa/scripts/api-up.sh` gana **una línea**: `ENRICHMENT_ENABLED=false` en el bloque `exec
env ...` (mismo patrón que las demás variables ya documentadas ahí — un comentario nuevo
explica el motivo, siguiendo el estilo de los comentarios existentes de ese archivo). Con
esto:

- La instancia larga que usan **todas** las demás suites (`carrito`, `importar`,
  `ordenes`, etc.) queda determinísticamente `runner_state: disabled` — ningún import de
  ninguna sesión dispara tráfico real hacia Google con la clave placeholder.
- `GET /status` sobre esa instancia es, por diseño, el escenario "sin proveedor
  configurado" — se aprovecha como el camino natural para `SC-005-C5`.
- Los escenarios que sí necesitan `runner_state` distinto de `disabled` levantan su propia
  instancia temporal (§D-QA4), nunca la compartida.

También se eleva `ENRICHMENT_RATE_LIMIT_MAX=100000` en esa misma instancia (mismo criterio
que `AUTH_RATE_LIMIT_MAX`/`CART_RATE_LIMIT_MAX`/etc. ya elevados ahí) — aunque con
`ENRICHMENT_ENABLED=false` casi ningún escenario de este plan llama `POST /runs` contra
ella, `GET /status` no consume ese presupuesto (per el propio contrato) así que no hace
falta para los escenarios mecánicos, pero se eleva de todas formas por si una sesión futura
agrega un escenario que sí lo necesite contra la instancia compartida — consistencia con el
resto del archivo.

### D-QA4 — Instancias temporales: `spawn-api.ts`, tres perfiles, per-escenario

Extiende el patrón que `SC-010-N5` ya estableció (`qa/support/spawn-api.ts`,
`levantarApiTemporal`). Tres perfiles de env, **nunca la instancia compartida**:

| Perfil | `ENRICHMENT_ENABLED` | `GEMINI_API_KEY` | `ENRICHMENT_RATE_LIMIT_MAX` | `ENRICHMENT_COOLDOWN_MS` | Puerto (env override) | Usado por |
|---|---|---|---|---|---|---|
| **B — "enabled"** | `true` | heredada de `.env` (`replace-me` — clave real, inválida, **no un doble**) | `100000` (elevado — no es lo que se mide) | `5000` (5 s — elegido para que el test sea rápido, no 300000 default; es una variable de entorno documentada, no un cambio de código) | `QA_ENRICHMENT_ENABLED_PORT` (default `3925`) | `SC-005-C1`, `SC-005-C2`, `SC-005-C4`, `SC-005-N4`, `SC-005-N5`, `qa/performance/storefront-under-enrichment.js` |
| **C — "rate-limit real"** | `false` (no importa para este caso — el throttle corre antes que el guard de disponibilidad) | irrelevante | **sin override** (queda el default real, 6/min) | irrelevante | `QA_ENRICHMENT_RATELIMIT_PORT` (default `3926`) | `SC-005-C7` |
| **A — compartida** (`api-up.sh`, sin cambios de este plan salvo D-QA3) | `false` (tras el fix) | irrelevante | `100000` | irrelevante | la de siempre | `SC-005-C5`, `SC-005-C6`, `SC-005-C8`, `SC-005-N1` (mecánico — no dispara ninguna corrida, sólo el `PATCH` + una lectura) |

**Cada escenario que usa el perfil B/C levanta y apaga SU PROPIA instancia** (`Before`/
`After` scoped por escenario, no por archivo): el contador de fallas consecutivas del
circuit-breaker y el estado `cooldown` viven en memoria del proceso — compartir una
instancia entre escenarios haría que el orden de ejecución importara (`flakiness-detection`
señal 5, "order dependencies"). El costo (≈1-3s de arranque por escenario) es aceptable
frente al riesgo de un estado de breaker que se filtra entre escenarios.

### D-QA5 — Adelantar `enrichment_next_attempt_at`: excepción angosta, con precedente

Para llegar al abandono completo (`SC-005-C2`, 5 intentos) sin esperar la escalera real de
backoff (1m+5m+25m+2h ≈ 2h31m de espera real antes del 5º intento), se agrega
`adelantarProximoIntento(productId)` en `qa/support/enrichment-db.ts`: `UPDATE products SET
enrichment_next_attempt_at = now()` vía `@dsm/db` — **sólo** para que `claimBatch` vuelva a
considerar elegible al producto de inmediato, nunca para fabricar `enrichment_attempts` ni
`enrichment_error_code` (esos los escribe el `POST /runs` real, contra el proveedor real,
en cada iteración). Mismo criterio exacto que `backdate-order.ts`/`backdate-enrichment.ts`
de `US-010-orden-webhook-stock-qa` §D-QA5: la excepción toca sólo la *precondición de
tiempo*, nunca la *aserción*.

### D-QA6 — Suite de aceptación: Cucumber-js + Playwright `APIRequestContext`

Mismo patrón que el resto de `qa/acceptance/` (`carrito.feature`, `pago-webhook.feature`):
`qa/acceptance/features/enriquecimiento.feature` +
`qa/acceptance/steps/enriquecimiento.steps.ts`. Cada escenario siembra sus propios
productos vía `qa/support/seed-enrichment.ts` (API real — `POST /v1/admin/products` +
`PATCH .../publish`, mismo patrón que `seed-busqueda.ts`), nunca reusa productos de otras
suites (evita colisión con el catálogo compartido, mismo criterio que
`QA-023-ACC-1`/`QA-010-ACC-1`).

### D-QA7 — Contract testing: script `tsx`, mismo patrón que `search.contract.ts`

`qa/contract/enrichment.contract.ts` — valida forma de respuesta + catálogo RFC 7807 de los
2 endpoints contra `openspec/specs/enriquecimiento-ia/contracts/openapi.yaml` (raíz viva).
Cubre los estados alcanzables negro-caja (200/401/403/409-run-in-progress/409-cooldown/
422/429/503); no inventa una forma para 202 exitoso con datos reales (ya lo prueba
`SC-005-C4` como efecto colateral de disparar el run).

### D-QA8 — Performance: reusar `list_products`/`storefront_product`, ningún umbral nuevo

`qa/performance/storefront-under-enrichment.js`: `setup()` siembra ~150 productos frescos
(prefijo propio) + dispara `POST /admin/enrichment/runs` contra el perfil B (§D-QA4) para
que el runner esté activo durante toda la ventana de medición; los VUs alternan
`GET /v1/categories/{slug}/products` (tag `list_products`) y `GET /v1/products/{slug}` (tag
`storefront_product`) usando el pool de slugs que `seed:load` ya deja disponible. Los
thresholds son los que **ya existen** en `qa/performance/lib/thresholds.js` — no se
inventa un NFR nuevo, se mide el mismo bajo la condición nueva (NFR-3, E2E §17). El script
verifica que `runner_state === 'running'` en al menos un `GET /status` durante la ventana
(mismo criterio que `QA-004-PERF-3`: si la corrida terminó antes, el test no midió nada y
debe fallar, no pasar por defecto).

## Trade-offs

**Usar una clave real inválida para ejercitar backoff/cooldown/abandono, en vez de dejarlos
todos `@blocked` junto con AC-1/AC-2/AC-6/AC-8.** Se acepta porque el mecanismo de conteo de
fallas (`registerFailure`, el contador de `cooldown`) es genuinamente agnóstico al tipo de
error — es el **mismo código** que correría con un 429 transitorio real. La alternativa
(declarar también AC-4/AC-5 `@blocked`) dejaría sin cobertura negro-caja justamente la parte
más crítica de la resiliencia (que un fallo persistente degrada con gracia, no bloquea el
producto para siempre) por una pureza que el propio backend no exige — mismo argumento que
`US-010-orden-webhook-stock-qa` ya aplicó para `simulate-payment`, aplicado acá a un
mecanismo interno en vez de a un endpoint alternativo explícito.

**No agregar un endpoint/flag de "modo test" que le haga creer al runner que Gemini
respondió con éxito.** Sería la vía más rápida para desbloquear AC-1/AC-2/AC-6/AC-8, pero
es exactamente el patrón que el propio D6 del backend prohíbe (embeddings falsos
descubiertos en demo). Se prefiere `@blocked` + la recomendación de conseguir una clave real
de free tier (trámite de minutos, a diferencia de una cuenta sandbox de MercadoPago).

**Adelantar `enrichment_next_attempt_at` vía Prisma en vez de esperar el backoff real.**
Mismo trade-off ya aceptado por `US-010-*-qa` (D-QA5 de ese plan) — la excepción es angosta
(sólo la precondición de tiempo, nunca `attempts`/`error_code`, que siguen viniendo del
proveedor real) y tiene precedente documentado.

**Corregir sólo la mitad seguro del contrato de `catalogo` (QA-005-F2).** Declarar
`description_enriched` en `UpdateProduct` es documentar la verdad; agregar los 3 campos de
lectura sin que el código los devuelva sería documentar una mentira. Se prefiere dejar la
mitad insegura como hallazgo explícito (`proposal.md` OQ-QA-005-2) en vez de "completar" el
contrato con algo que el servidor real no cumple.

## Open questions

Las dos viven en `proposal.md` §Preguntas abiertas con su default. Ninguna bloquea la
ejecución de lo que SÍ es alcanzable hoy (13 de 16 escenarios, ver `qa-plan.md` §3).

## References

- `qa-plan.md` de este change (matriz AC×capa, escenarios Gherkin completos, stubs)
- Backend archivado: [`US-005-enriquecimiento-ia-embeddings-backend`](../archive/US-005-enriquecimiento-ia-embeddings-backend/)
  — `design.md` §Resiliencia, §Persistencia, §Trade-offs (D6); `tasks.md` T1.2-T1.4, T3.2-T3.4
  (código real citado en §D-QA1 de este documento)
- Precedente directo del patrón "hallazgo de entorno → `@blocked` documentado, nunca
  simulado": [`US-010-orden-webhook-stock-qa/design.md`](../archive/US-010-orden-webhook-stock-qa/design.md)
  §D-QA1, §D-QA5
- Precedente de instancia temporal aislada: `qa/support/spawn-api.ts` +
  `qa/acceptance/steps/pago-webhook.steps.ts` (`SC-010-N5`)
- Skills: `qa-three-layer-regression` (no duplicar `QA-004-*`), `bdd-scenario-quality`
  (`@blocked` nunca se cuela verde), `k6-load-scaffolding` (reusar thresholds existentes,
  verificar que la corrida estaba activa), `flakiness-detection` (señal 5 — instancia por
  escenario, no compartida), `threat-modeling-lite` (STRIDE del proveedor de IA ya cerrado
  por el backend en su `design.md` §Seguridad; este plan lo verifica vía AC-9, no lo
  reabre), `openspec-workflow`
- Standards: `qa-backend-standards.md` §2.1/§13/§15/§21 · `testing-standards.md`
  §2/§4.1/§5/§8/§14/§14.9/§18 · `api-standards.md` §8/§10/§12 · `performance-standards.md` §7
  · `security-standards.md` §5/§7.3
