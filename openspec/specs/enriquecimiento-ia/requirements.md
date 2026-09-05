# Requisitos — Enriquecimiento de descripciones con IA (CAP-3)

## Desde US-005 backend

### Funcionales

- **R-1**: al enriquecer un producto elegible, el sistema genera `description_enriched` (vía
  LLM, si no está curado y el texto base cambió) y su embedding (768 dims), y marca
  `enrichment_done=true` (AC-1).
- **R-2**: un producto con embedding en `product_embeddings` queda elegible para la búsqueda
  semántica de `busqueda` (CAP-2) sin ningún paso adicional (AC-2).
- **R-3**: `GET /admin/enrichment/status` expone `coverage_ratio` (embedded / total) y el KPI de
  cobertura del PRD (≥ 90%) se mide sobre esa cifra, no sobre el código (AC-3).
- **R-4**: un fallo transitorio del proveedor (429, 5xx, timeout, red) reintenta in-process (3,
  backoff 1s/4s/9s + jitter) y, si persiste, entra a backoff durable (1m → 10h) sin perder el
  producto de la cola (AC-4).
- **R-5**: tras 5 intentos fallidos el producto se abandona — conserva `description_raw`, queda
  navegable por categoría, y sólo se rehabilita con `POST /runs {force: true}` (AC-5).
- **R-6**: un cambio de precio o stock NO altera el hash del texto fuente ⇒ cero llamadas al
  proveedor en la siguiente corrida (AC-6, control de costo).
- **R-7**: si el dueño curó `description_enriched` (`description_curated=true`), ninguna corrida
  posterior la pisa — sólo se regenera el embedding si el texto curado cambió (AC-7).
- **R-8**: `product_embeddings.model_version` registra qué modelo generó cada vector, para que
  un cambio de modelo sea detectable y no silencioso (AC-8).

### Negative-space

- **N-1**: el pipeline nunca expone `GEMINI_API_KEY` ni la URL completa del proveedor en logs o
  en la respuesta de `/status` — sólo `last_error_code` del catálogo `dsm:enrichment/*` (AC-9).
- **N-2**: un vector con dimensión ≠ 768, componentes no finitos, o norma cero, NUNCA se
  persiste — rompería el tipo de columna y envenenaría el kNN (validación previa a escritura).
- **N-3**: el enriquecimiento NUNCA cambia el estado de publicación del producto — un producto
  `draft` sigue `draft` después de enriquecerse; enriquecer y publicar son ejes independientes
  (AC-10).
- **N-4**: `POST /admin/enrichment/runs` con una corrida en curso responde `409` (nunca encola un
  segundo run) — mismo criterio de concurrencia única que el import de US-006.

### NFRs

- **NFR-1**: cobertura del catálogo enriquecido ≥ 90% (PRD §1.4), medida por
  `GET /admin/enrichment/status`.
- **NFR-2**: ventana de enriquecimiento inicial ≈ 5,5 h para 5.000 SKUs a 15 RPM (techo del
  proveedor free-tier, no del código — Q-4 del E2E §23, sin resolver: la única palanca real es
  subir la cuota de Gemini).
- **NFR-3**: p95 de lectura del storefront durante una corrida de enriquecimiento se mantiene
  < 300 ms (E2E §17) — el runner cede el event loop entre ítems, no compite con el request path.

### Deferred

- **D-1**: UI de curación (pantalla para editar `description_enriched`) — owner: PO, disparador:
  cuando el dueño necesite corregir descripciones sin pasar por Postman/API directa.
- **D-2**: migración del ejecutor in-process a BullMQ — owner: Arquitecto, disparador: ADR-0014
  (catálogo > ~10.000 SKUs o import automatizado; también condicionado a que `REDIS_URL` se
  aprovisione, US-019 T1.3).
- **D-3**: re-embed masivo por cambio de modelo de embeddings — owner: Arquitecto, disparador:
  una US futura que decida actualizar `text-embedding-004`; `model_version` ya deja la brecha
  trazable.
- **D-4**: exponer `description_enriched` en la ficha pública del storefront (impacto SEO) —
  owner: PO, disparador: OQ-BE-3, decisión de producto todavía abierta.
- **D-5**: re-tuning de los parámetros HNSW (`m`, `ef_construction`) contra datos reales de
  catálogo — owner: quien ejecute la batería de relevancia de US-004 (OQ-BE-4).
- **D-6**: ajuste del tope de reintentos durables (hoy 5) si el PO prefiere insistir más antes de
  abandonar un producto — owner: PO (OQ-BE-5), variable de entorno, sin cambio de código.
