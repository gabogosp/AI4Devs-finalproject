# Decisiones — Enriquecimiento de descripciones con IA (CAP-3)

## ADRs aplicables

| ADR | Título | Relevancia acá |
|---|---|---|
| ADR-0002 | pgvector + HNSW, dimensión 768 | fija el datastore y la forma de `product_embeddings` |
| ADR-0003 | Proveedor Gemini (`gemini-1.5-flash` + `text-embedding-004`) y sus modelos | fija con qué se enriquece y se embeddea |
| ADR-0004 | BullMQ para trabajo asíncrono (enmendada dos veces — ADR-0012, ADR-0014) | el enriquecimiento iba a esperar la cola; no la esperó |
| ADR-0012 | Precedente in-process para el import (US-006) | el pipeline de enriquecimiento reusa el mismo patrón, sin tabla de jobs |
| ADR-0014 | Ejecutor in-process en `apps/api`, criterio de migración a BullMQ | decidida en este change (T0.1); enmienda ADR-0004 por tercera vez en el proyecto |

## Decisiones de implementación

| Id | Decisión | Fundamento |
|---|---|---|
| D1 | Ejecutor in-process en `apps/api`, contrato durable en Postgres | `REDIS_URL` no aprovisionado (US-019 T1.3 abierta); `apps/worker/` es un README. Criterio de migración en ADR-0014 |
| D2 | La cola es `WHERE enrichment_done = false`; el "encolado" de US-006 es un *nudge*, no una cola real | un evento perdido no pierde trabajo — el claim por `SELECT` es la fuente de verdad |
| D3 | Texto fuente = `name` + categoría + (curado ∥ enriquecido ∥ base) | sin el rubro, un nombre corto como "Mecha widia 8" es casi ruido para el embedder |
| D4 | `description_curated` como columna explícita, no heurística sobre `updated_at` | AC-7 necesita memoria de autoría; inferirla adivinaría |
| D5 | Clave del proveedor viaja en header (`x-goog-api-key`), nunca en `?key=` de la URL | cualquier log de error que incluya la URL filtraría la clave |
| D6 | Sin `GEMINI_API_KEY`, el runner queda `disabled`; en producción el arranque falla | precedente `RESEND_API_KEY` (`env.validation.ts`) — una feature que "funciona" sin hacer nada es peor que un arranque roto |
| D7 | 2 endpoints admin, ninguno público | AC-3 exige que la cobertura sea observable; el storefront no necesita esta superficie |
| D8 | La curación (AC-7) reusa `PATCH /admin/products/{id}` de `catalogo`, sin endpoint nuevo | sin un camino de curación el AC no es verificable de punta a punta; la pantalla es FE (diferida) |

## Riesgo de reconciliación con US-006

`enrichment_done` y las columnas de estado de enriquecimiento ya vivían parcialmente en
`products` por decisión del DER (US-006 puso `enrichment_done`). Este change agrega las 5
columnas restantes (`description_enriched`, `description_curated`, `enrichment_source_hash`,
`enrichment_attempts`, `enrichment_next_attempt_at`, `enrichment_error_code`) — todas aditivas,
ninguna pisa lo que US-006 ya declaró. El puerto `EnrichmentQueue` que US-006 inyecta se
resolvió en `src/enrichment/ports/` (el consumidor es su dueño natural); si US-006 llegó primero
y lo creó en `src/imports/enrichment/`, este change lo mueve sin cambiar comportamiento.

## Desviaciones conscientes registradas

- **Puertos de IA unificados**: el plan preveía `ai-enricher.port.ts` + `ai-embedder.port.ts`
  separados; AS-BUILT quedaron unidos en `ports/ai.ports.ts` porque ambos comparten
  `AiAvailability` y el mismo adapter los implementa — separarlos duplicaba el encabezado sin
  separar responsabilidad real.
- **Throttler `enrichment` con techo inalcanzable en el registro global**: `@nestjs/throttler`
  aplica todos los throttlers nombrados a toda ruta guardada del proceso; registrarlo con el
  tope real (6/min) le imponía ese límite también al storefront, a `auth` y a imports. El tope
  real vive en el `@Throttle` del handler, no en el registro del módulo.
- **Ejemplos `null` fuera del schema OpenAPI**: Spectral crashea sobre un literal `null` dentro
  de un `examples` (bug conocido de la versión usada). La nulabilidad de `last_error_code` /
  `last_run_at` sigue declarada en el `schema`; el ejemplo se documentó en prosa.
- **`openapi.yaml` publicado en 3.0, no 3.1**: `type: [string, 'null']` + `const: true` (sintaxis
  3.1) se tradujeron a `nullable: true` + `enum: [true]` (3.0) — el spec publicado del proyecto
  es OpenAPI 3.0.3.
