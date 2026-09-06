---
tracker-id: null
tracker-source: null
parent-us: US-005
discipline: qa
variant: null
language: es
---

# US-005 QA — Enriquecimiento IA de descripciones + embeddings

## Why

`US-005-enriquecimiento-ia-embeddings-backend` está archivado (PR #3, 28/28 tasks, mergeado
2026-08-29) y forma la capacidad viva `openspec/specs/enriquecimiento-ia/`. Su propio
`tasks.md` es explícito sobre qué QA-owned quedó **sin plan**: la sección "Dónde vive el QA
de este change" registra que las dos piezas derivadas a `/plan-qa` (batería de relevancia y
k6 cross-service bajo enriquecimiento concurrente) ya encontraron casa en el qa-plan de
US-004 (`QA-004-REL-*`, `QA-004-PERF-3`) — **porque el riesgo que miden sólo existe cuando
`enriquecimiento` y `búsqueda` conviven**. Eso es correcto y este plan **no las repite**.

Lo que esa nota no cubre — y que ningún otro qa-plan del repo cubre tampoco — es la
**aceptación negro-caja de la capacidad `enriquecimiento-ia` en sí misma**: sus 2 endpoints
admin, su matriz de decisión observable desde afuera, su degradación cuando no hay
proveedor, su contrato RFC 7807, y el NFR de "el runner no degrada la lectura del
storefront" (E2E §17) medido sobre endpoints de **catálogo genérico** (no `/v1/search`, que
ya tiene su propio k6 en US-004). Ese es el alcance de este change.

**Hallazgo que gobierna el diseño de este plan (QA-005-F1, no un incongruencia de
producto — un riesgo de higiene de entorno compartido, mismo tipo de hallazgo que
QA-010-F1 para MercadoPago)**: este worktree (y, por extensión, cualquier sesión que
levante la API para QA con `qa/scripts/api-up.sh` tal como está hoy) tiene
`GEMINI_API_KEY=replace-me` en `.env` — un valor **no vacío**, que la validación de Zod
acepta como "configurado" — y `ENRICHMENT_ENABLED=true` (default). Como
`ai.providers.ts` sólo mira si la clave está *presente*, no si es *válida*, el proceso de
la API para QA arranca con `GeminiHttpClient` real, no con `DisabledAiProvider`. Y como el
enriquecimiento se dispara solo tras cada import completado (`EnrichmentQueue.enqueue` →
`setImmediate`, US-006), **cualquier sesión que corra `importar.feature`/`seed-import.ts`
en el entorno compartido de QA hoy dispara, sin que nadie lo pida, llamadas HTTP reales
a la API de Google con una clave inválida** — quemando `enrichment_attempts` y
`enrichment_error_code` sobre productos reales del catálogo compartido, exactamente el
escenario que el propio `design.md` de backend describe como "lo que NO hay que hacer"
(§Trade-offs, "un embedding falso... se descubre en la demo" — acá ni siquiera es un
embedding falso, es ruido de 401 real ensuciando el catálogo de otras sesiones). Este plan
resuelve esto en Fase 0 (ver `design.md` §D-QA1) antes de escribir ningún escenario: la
instancia larga y compartida de `qa/scripts/api-up.sh` pasa a `ENRICHMENT_ENABLED=false`
determinístico; los escenarios que sí necesitan el proveedor "encendido" levantan su
**propia** instancia temporal (`qa/support/spawn-api.ts`, patrón ya establecido por
`SC-010-N5`), aislada y de vida corta.

**Segundo hallazgo (QA-005-F2, contrato incompleto — no de producto)**: `T4.3` del backend
extendió `UpdateProductDto` para aceptar `description_enriched` (AC-7), pero el contrato
vivo de la capacidad **dueña** de ese DTO (`openspec/specs/catalogo/contracts/openapi.yaml`,
schema `UpdateProduct`) nunca se actualizó — el campo funciona en producción pero no está
declarado. Peor: `ProductResponseDto` (`apps/api/src/products/dto/product.dto.ts`, `static
from()`) **nunca devuelve** `description_enriched`, `description_curated` ni
`enrichment_done` — ni en el `GET`, ni en la respuesta del propio `PATCH` que los setea. Un
cliente negro-caja (esta suite, o la futura UI de curación, D-1 diferida) no tiene manera
de leer por API si un producto está curado. Este plan documenta el hallazgo, corrige la
mitad segura del contrato (declarar `description_enriched` como aceptado en `UpdateProduct`
— es verdad, ya se acepta) y usa una excepción angosta y documentada (lectura directa vía
`@dsm/db`, nunca escritura de aserción) para el resto — ver `design.md` §D-QA2. La otra
mitad (exponer los 3 campos en la respuesta) es un cambio de *código* de la capacidad
`catalogo`, fuera de alcance de un change QA-only; queda recomendado, no ejecutado.

## What changes

Un change hermano `US-005-enriquecimiento-ia-embeddings-qa/` con el plan y su ejecución, en
el harness cross-stack que ya existe (`qa/`), **sin tocar código de aplicación**
(`apps/api/src/`):

| Capa | Herramienta | Qué cubre |
|---|---|---|
| Aceptación BDD (Layer 1, backend-aislado) | Cucumber-js + Playwright `APIRequestContext` | AC-3 (mecánica), AC-4 (backoff durable + cooldown), AC-5 (abandono completo), AC-7 (costura de curación), AC-9, AC-10, más invariantes de infra (401/403/409/422/429/503) para los 2 endpoints admin |
| Contract testing | Script `tsx` (mismo patrón que `search.contract.ts`/`pago-manual.contract.ts`) | Los 2 endpoints de `enriquecimiento-ia` contra su OpenAPI vivo |
| Corrección de contrato incompleto | Edición documental | `openspec/specs/catalogo/contracts/openapi.yaml` — declarar `description_enriched` en `UpdateProduct` (QA-005-F2, mitad segura) |
| Carga (k6) | k6 | Lecturas de storefront (`list_products`, `storefront_product` — presupuestos YA existentes en `qa/performance/lib/thresholds.js`, no se inventa un número nuevo) mientras corre una barrida real de enriquecimiento (NFR-3, E2E §17) |
| Exploratorio | Charters manuales | Ventana de reintentos reales del proveedor, interacción `force`+`product_ids`, ruido cross-sesión del catálogo compartido |

**Lo que este plan NO hace** (ownership matrix, `qa-backend-standards.md` §2.1): no
reescribe unit/integration/e2e-nest — 28/28 tasks del backend ya cubren la matriz de
decisión, el claim por lease, el backoff in-process, con Postgres real y un
`FakeAiProvider` determinista. Se registra como nota de cobertura, no se duplica.

**Lo que este plan NO puede ejecutar en este entorno** (ver `design.md` §D-QA1 para el
detalle completo Q/B por escenario): AC-1 (enriquecer + embeddear con éxito), AC-2 (el
producto resultante es buscable), AC-6 (saltar la 2ª corrida si no cambió — necesita una
1ª corrida exitosa como baseline) y AC-8 (versión de modelo registrada) requieren que
Gemini responda **con éxito** al menos una vez, y este entorno no tiene una
`GEMINI_API_KEY` real (sólo el placeholder `replace-me` de `.env.example`). Se declaran
`@blocked` en el Gherkin, nunca simulados con un doble no autorizado — mismo criterio que
`US-010-orden-webhook-stock-qa` ya aplicó a la cuenta sandbox de MercadoPago. La vía de
desbloqueo es más barata acá: Gemini tiene tier gratuito (ADR-0003) — conseguir una clave
real es un trámite de minutos, no una cuenta sandbox de un proveedor de pagos.

## Out of scope

- **Batería de relevancia IA (≥70%)** y **k6 de `/v1/search` bajo enriquecimiento
  concurrente** — ya viven en `openspec/changes/archive/US-004-busqueda-semantica-backend/qa-plan.md`
  (`QA-004-REL-1/2/3`, `QA-004-PERF-3`). Repetirlas acá sería la duplicación que
  `qa-three-layer-regression` prohíbe.
- **E2E cross-stack (Layer 3, Playwright)** — no existe ninguna pantalla FE para esta
  capacidad (`grep -rn "enrichment" apps/web/src` no devuelve nada; la curación es
  `Deferred: FE — owner: PO`, D-1 de `requirements.md`). Sin UI, no hay journey cross-stack
  que ejercitar; el único riesgo cross-service real (que la búsqueda no se degrade) ya está
  cubierto por `QA-004-PERF-3`.
- **Exponer `description_curated`/`enrichment_done` en `ProductResponseDto`** (QA-005-F2,
  mitad insegura) — requiere tocar `apps/api/src/products/`, fuera de alcance de un change
  QA-only. `Deferred: change de backend futuro — owner: Arquitecto/PO`.
- **La primera corrida real sobre el catálogo de producción y el `coverage_ratio ≥ 90%`
  resultante** — operación (runbook §3.6 del servicio), no test. Ningún plan automatizado
  lo cubre, ni éste ni el del backend.
- **Migración a BullMQ** (ADR-0014, criterio de migración) — no es una superficie testeable
  hoy, no existe el worker.

## Preguntas abiertas

Ninguna es una incongruencia de producto — las dos son hallazgos de entorno/contrato ya
resueltos con un default explícito (ver arriba y `design.md`).

| Id | Pregunta | Default implementado | Estado |
|---|---|---|---|
| OQ-QA-005-1 | ¿Cuándo se consigue una `GEMINI_API_KEY` real de free tier para desbloquear AC-1/AC-2/AC-6/AC-8? | Se documenta el bloqueo (`@blocked`) y se deja el Gherkin ya escrito, listo para re-correr apenas exista la clave — sin rediseñar ningún escenario | `[Deferred — owner: PO/Infra, trámite de minutos]` |
| OQ-QA-005-2 | ¿Se expone `description_curated`/`enrichment_done` en `ProductResponseDto` para que la curación sea observable por API? | No en este plan (QA-005-F2, mitad insegura); se usa lectura directa vía `@dsm/db` como excepción angosta y documentada mientras tanto | `[Deferred — owner: Arquitecto/PO, change de backend futuro]` |

## Standards consultados

| Standard | Secciones aplicadas |
|---|---|
| `qa-backend-standards.md` | §2.1 ownership · §13 performance · §15 datos sintéticos · §21 BDD y Gherkin |
| `testing-standards.md` | §2 pirámide · §4.1 naming · §5 datos de test · §8 coverage · §14 patrones de código de test (§14.2 fakes vs mocks, §14.8 fixtures) · §14.9 negative space · §18 anti-patterns |
| `api-standards.md` | §8 RFC 7807, §10 idempotencia/202, §12 headers de rate-limit |
| `performance-standards.md` | §7 un test de carga necesita umbral numérico atado a un NFR existente |
| `observability-standards.md` | §9 sin secretos ni PII en respuestas observables |
| `security-standards.md` | §5 secretos en header nunca en URL/log (AC-9), §7.3 rate-limit de superficie que gasta dinero |

## Referencias

- User story: [`docs/user-stories/US-005-enriquecimiento-ia-embeddings.md`](../../../docs/user-stories/US-005-enriquecimiento-ia-embeddings.md)
- Change de backend (archivado): [`US-005-enriquecimiento-ia-embeddings-backend`](../archive/US-005-enriquecimiento-ia-embeddings-backend/) — `proposal.md` §"Dónde vive el QA de este change", `design.md`, `tasks.md`
- Capacidad viva: [`openspec/specs/enriquecimiento-ia/`](../../specs/enriquecimiento-ia/) (README, requirements, decisions, contrato OpenAPI de los 2 endpoints)
- Capacidad relacionada (contrato a corregir, QA-005-F2): [`openspec/specs/catalogo/`](../../specs/catalogo/)
- PRD §1.4 (KPI cobertura ≥90% / relevancia ≥70%), §2.1 capacidad 3, §3.2 (red de seguridad)
- E2E §6.1, §8, §9.3, §14, §17, §18/§18.5, §21, §22, §23 Q-4
- Plan QA que ya absorbió las 2 piezas derivadas de este change:
  [`US-004-busqueda-semantica-backend/qa-plan.md`](../archive/US-004-busqueda-semantica-backend/qa-plan.md)
  (`QA-004-REL-*`, `QA-004-PERF-3`)
- Precedente estructural directo de change hermano de QA con hallazgo de entorno
  análogo (cuenta externa faltante, declarado `blocked` en vez de simulado):
  [`US-010-orden-webhook-stock-qa`](../archive/US-010-orden-webhook-stock-qa/proposal.md)
- ADR-0003 (Gemini, free tier), ADR-0014 (ejecutor in-process del enriquecimiento)
