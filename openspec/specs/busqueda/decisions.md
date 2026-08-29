# CAP-2 Búsqueda — Decisiones

Decisiones que gobiernan el estado vivo de la capacidad. Los ADR son la fuente de verdad;
acá se registra **cuál aplica a esta capacidad y por qué**.

## ADRs que aplican

| ADR | Decisión | Impacto en esta capacidad |
|---|---|---|
| [ADR-0002](../../../docs/architecture/decisions/) | pgvector + HNSW como datastore de embeddings | `product_embeddings` (creada por US-005) es la fuente del kNN; este change reusa el índice HNSW sin re-tunear `m`/`ef_construction`. |
| [ADR-0003](../../../docs/architecture/decisions/) | Gemini `text-embedding-004` como proveedor de embeddings | El puerto `AI_EMBEDDER` (reusado de US-005) es el único cliente hacia Gemini; esta capacidad no duplica el HTTP client ni el parseo. |
| [ADR-0012 / ADR-0014](../../../docs/architecture/decisions/) | Caché en proceso mientras Redis no exista | Tercera instancia del mismo patrón: el vector de la consulta se cachea en un LRU en proceso (`query-vector.cache.ts`), con el seam listo para un adaptador Redis. |

## Decisiones de implementación tomadas durante la construcción

| Decisión | Motivo |
|---|---|
| **`GET /v1/search`** y no `POST /search` (desviación del readme de la Entrega 1). | Una búsqueda es una lectura: `GET` la hace enlazable, compartible y cacheable por el cliente y por el edge. |
| El timeout (`GEMINI_SEARCH_TIMEOUT_MS=900ms`) **es** el disparador de la degradación, no un error a reportar. | AC-4 deja de ser un camino excepcional que alguien deba recordar probar: es el comportamiento por defecto cuando el presupuesto de latencia se agota. |
| El camino de búsqueda tiene **su propio limitador y timeout** (`GEMINI_SEARCH_MAX_RPM`, `GEMINI_SEARCH_TIMEOUT_MS`), separados del de enriquecimiento (US-005), aunque **reusan** el puerto `AI_EMBEDDER`. | El limitador de US-005 es un serializador de intervalo mínimo pensado para lotes; aplicado al camino interactivo (free tier, 15 RPM) es ~3× el presupuesto total de la búsqueda. Repartir sin separar la política de tasa hace que búsqueda y enriquecimiento compitan por la misma ranura. |
| El puerto `AI_EMBEDDER` se **mueve** de `src/enrichment/ports/` a `src/ai/ports/` (archivo real: `ai.ports.ts`, junto con `AI_ENRICHER` — desviación heredada de US-005). | Con dos consumidores (enriquecimiento + búsqueda), el dueño natural del puerto deja de ser `enrichment`. Mismo criterio que US-005 aplicó a `EnrichmentQueue`. |
| Se cachea **el vector de la consulta**, no los resultados. | Cachear resultados congelaría precio/stock hasta el TTL. El kNN cuesta ~30 ms — no vale la pena pagar frescura por eso. Con el free tier, este caché pasa de optimización a *load-bearing*. |
| `interpreted_as` se **deriva** de las categorías que matchearon, no se genera con el LLM (OQ-BE-3). | No entra en el presupuesto de latencia, y evita que el texto del usuario llegue a un modelo generativo — vuelve AC-8 estructural en vez de una promesa defendida con filtros. |
| El fallo del proveedor de IA es un **200 degradado**, no un 5xx. | Un buscador que devuelve 5xx en una ráfaga le enseña a Google a sacar URLs del índice — la lección que US-003 ya pagó con el 429. |
| `products.search_document` (`tsvector`) es **`GENERATED ALWAYS AS (...) STORED`**, no poblada por trigger. | Una columna generada no puede quedar desincronizada; un trigger sí, si algún `UPDATE` no lo dispara. |
| `fullText` normaliza `ts_rank` **al mejor del conjunto** (el top vale 1), en vez de usar el valor absoluto. | Medido: `ts_rank` y la similitud cosine viven en escalas distintas (~0,10 vs 0,55 calibrado para cosine). Sin normalizar, el camino degradado nunca podía reportar `confidence: high` y `SEARCH_LEXICAL_WEIGHT` no tenía efecto perceptible. |
| `SEARCH_MIN_SCORE` se queda en **0,55** pese a que el barrido (0,4–0,7) dio el mismo % de acierto en los cinco valores. | El catálogo de seed no tiene embeddings (`embedding_coverage: 0/4`): no hay resultados en la zona gris que un barrido necesita para ser informativo. Recalibrar tras la primera corrida real de US-005. |
| `SEARCH_LEXICAL_WEIGHT=0` por defecto (capacidad de blend construida, apagada). | El número correcto lo dice la batería con datos reales (QA); fijarlo ahora sería adivinar con apariencia de rigor. |

## Desviaciones conscientes registradas

| Desviación | Motivo |
|---|---|
| AC-2 (relevancia ≥ 70% en top-5) **no queda verificada** por este change. | Se entrega el arnés ejecutable (script + gate + 8 casos semilla), no el veredicto: no se puede medir hasta que US-005 pueble embeddings. La batería completa (~30 casos) y el gate son de QA — `Deferred: /plan-qa US-004`. |
| Ningún test ejercitó al proveedor real (Gemini). | Misma limitación que US-005: sin `GEMINI_API_KEY` en el entorno de test, toda la suite corrió por el camino degradado (full-text). La calidad de los embeddings de consulta queda sin evidencia empírica. |
| Alcance de la task de contrato ampliado a agregar 8 `operationId` faltantes en endpoints admin de US-001 (fuera del scope nominal de esta capacidad). | El gate de lint (`--fail-severity=warn`) fallaba por esos warnings preexistentes; sin `operationId` el codegen del FE (orval) deriva nombres inestables del path. |
