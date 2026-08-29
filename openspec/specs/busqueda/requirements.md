# CAP-2 Búsqueda — Requisitos acumulados

Acumulado de los changes archivados de esta capacidad. Cada requisito es el **estado
declarado del sistema vivo**, no la intención de un change.

## Desde US-004 backend (archivada 2026-08-29)

### Funcionales

| # | Requisito | Origen |
|---|---|---|
| R-1 | Una consulta en lenguaje natural devuelve candidatos relevantes ordenados por score descendente. | AC-1 |
| R-2 | El backend entrega un arnés ejecutable (script + gate por exit code + 8 casos semilla + reporte de cobertura de embeddings) para medir relevancia ≥ 70% en el top-5. **El veredicto no está verificado por este change** — depende de que US-005 pueble embeddings; la batería completa (~30 casos) y el gate son de QA. | AC-2 (deferred) |
| R-3 | Cuando no hay señal sobre el umbral (`SEARCH_MIN_SCORE`), la respuesta trae `fallback.suggested_categories` — nunca un «cero resultados» desnudo. | AC-3 |
| R-4 | Si el proveedor de IA falla o agota `GEMINI_SEARCH_TIMEOUT_MS` (900 ms), la respuesta degrada a full-text y marca `degraded: true` **con status 200** — el timeout es el disparador de la degradación, no un error a reportar. | AC-4 |
| R-5 | Una consulta más corta que `SEARCH_MIN_LENGTH` caracteres útiles (tras normalizar) es 422 (`dsm:search/query-too-short`) **sin llamar al proveedor de IA**. | AC-5 |
| R-6 | Sólo se devuelven productos `status: published`, por ambos caminos (semántico y full-text). | AC-6 |
| R-7 | Un producto sin stock aparece con `in_stock: false` — no se oculta. | AC-7 |
| R-8 | `interpreted_as` se deriva de las categorías de los productos que matchearon; el texto de la consulta nunca llega a un modelo generativo. | AC-8 |
| R-9 | Un producto sin fila en `product_embeddings` no rompe la búsqueda semántica (queda fuera del `JOIN`) y sigue siendo alcanzable por el camino full-text. | AC-9 |
| R-10 | La superficie `GET /v1/search` tiene throttler propio (`SEARCH_RATE_LIMIT_MAX` por `SEARCH_RATE_LIMIT_TTL_MS` y por IP), cubo independiente de `auth`/`storefront`/`cart`. | AC-10 |

### Negative-space (lo que NO debe pasar)

| # | Requisito |
|---|---|
| N-1 | El texto de la consulta nunca se concatena en SQL: los dos `$queryRaw` (semántico y full-text) usan parámetros ligados. |
| N-2 | Ninguna llamada a un modelo generativo ocurre en el camino de búsqueda — sólo embedding + `tsquery` parametrizado. |
| N-3 | Un producto `draft` o `archived` no aparece ni por vector ni por texto. |
| N-4 | `fallback.suggested_categories` nunca es una lista vacía cuando el campo está presente. |
| N-5 | El fallo del proveedor de IA nunca produce un 5xx — sólo Postgres caído produce 503. |

### No funcionales

| # | Requisito | Verificación |
|---|---|---|
| NFR-1 | p95 < 1,5 s (PRD §4), **incluido el camino degradado**. | Medido: con el embedder colgado, `GET /v1/search` responde 200 degradado en **1147 ms** (piso de 800 ms probando que el timeout de 900 ms se respeta). |
| NFR-2 | El presupuesto de RPM del proveedor (free tier, 15 RPM) se reparte explícitamente entre búsqueda y enriquecimiento (`GEMINI_SEARCH_MAX_RPM` + `GEMINI_MAX_RPM` ≤ 15), validado al arranque. | Guard de arranque; hoy **10 / 5** a favor de búsqueda (OQ-BE-1 (b), decisión del PO). |
| NFR-3 | El contrato publicado lintea limpio (Spectral, `--fail-severity=warn`). | Gate de CI; 0 warnings tras agregar los `operationId` faltantes de US-001. |
| NFR-4 | Sin regresión sobre lo que el change tocó (esquema de `products`, puerto `AI_EMBEDDER` movido). | 548 tests / 59 suites verdes; suite completa de la API 1407 tests / 141 suites; suite de búsqueda en aislamiento 153 tests / 18 suites. |

### Diferidos con dueño

| # | Requisito | Dueño / disparador |
|---|---|---|
| D-1 | Verificación real de AC-2 (≥ 70% relevancia top-5) contra un catálogo con embeddings. | US-005 (poblar embeddings) → `/plan-qa US-004` (batería ~30 casos + gate). |
| D-2 | Calibración de `SEARCH_MIN_SCORE` y `SEARCH_LEXICAL_WEIGHT` con datos reales (el barrido actual es plano: catálogo de seed sin vectores). | Misma batería que D-1. |
| D-3 | Caché de consultas en Redis (hoy en proceso, `query-vector.cache.ts`). | US-019 T1.3 (provisión de Redis). Señal para migrar: `search.degraded` alto con `search.cache_hit` bajo. |
| D-4 | Input de búsqueda en el storefront (UI). | `US-004-busqueda-semantica-frontend-web` (en curso). |
