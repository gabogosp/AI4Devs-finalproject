# Capacidad: Enriquecimiento de descripciones con IA (CAP-3)

**Estado**: entregada — el pipeline backend (enriquecer + embeddear) vive y corre en
producción. Sin UI de curación (diferida a FE) ni exposición del texto enriquecido en el
storefront (decisión de producto pendiente, OQ-BE-3).

Estado declarado del sistema para la capacidad CAP-3 del PRD §2.1 (fila 3, prioridad *Must* —
"sub-objetivo crítico que habilita la capacidad 2", búsqueda semántica). Este directorio es el
**acumulado** de los changes archivados: se extiende en cada `/archive-change`, nunca se
reescribe.

## Por qué esta capacidad no existía todavía

El PRD trata "enriquecimiento de descripciones con IA" como una capacidad propia (CAP-3),
distinta de "catálogo" (CAP-1) y de "búsqueda semántica" (CAP-2) — es el puente entre ambas: un
catálogo pobre (nombre + SKU, sin descripción de valor) no alimenta embeddings útiles, y sin
embeddings CAP-2 no tiene qué buscar. `US-005-enriquecimiento-ia-embeddings-backend` es el único
change que construye esta capacidad; se archiva ahora (barrido administrativo) aunque su PR #3
mergeó a `main` el 2026-08-29 — el trabajo estaba completo, sólo faltaba el paso de archivo.

## Qué está vivo hoy

El pipeline de enriquecimiento (`apps/api/src/enrichment/`), **ejecutor in-process** (ADR-0014,
sin BullMQ — `REDIS_URL` no está aprovisionado, US-019 T1.3 abierta):

- **Matriz de decisión por producto** (AC-6, AC-7): decide llamar al LLM (`gemini-1.5-flash`)
  y/o al embedder (`text-embedding-004`) según si el texto está curado por el dueño y si el
  hash del texto fuente cambió. Un cambio de precio/stock no dispara ninguna llamada.
- **Claim atómico sin tabla de jobs**: `UPDATE ... FOR UPDATE SKIP LOCKED` con lease propio en
  `products.enrichment_next_attempt_at` — dos corridas concurrentes no pisan el mismo producto,
  no hace falta reaper (el lease vencido re-habilita solo), el backoff sobrevive a un reinicio.
- **Resiliencia por llamada**: timeouts (20 s enriquecer / 10 s embeddear), 3 reintentos
  in-process con backoff + jitter, `Retry-After` respetado, backoff durable de 1 m a 10 h,
  abandono a los 5 intentos (AC-5 — degrada a descripción base, nunca bloquea el producto),
  cooldown de 5 min tras fallos consecutivos, tope de `GEMINI_MAX_RPM=15` (free tier).
- **Validación de la respuesta del proveedor**: vector de 768 dims exactas, componentes finitos,
  norma ≠ 0 — no se persiste basura que envenenaría el kNN.
- **2 endpoints admin** (`AdminGuard`, `role=admin`): `GET /admin/enrichment/status` (cobertura
  del catálogo + estado del runner, AC-3) y `POST /admin/enrichment/runs` (dispara una corrida,
  202 + polling, AC-1/AC-5; `force: true` rehabilita abandonados).
- **Curación del dueño** (AC-7): reusa `PATCH /admin/products/{id}` (capacidad `catalogo`) — no
  es un endpoint nuevo de esta capacidad, es una costura sobre el existente.
- **Persistencia**: `products` +6 columnas de control (todas aditivas) + tabla nueva
  `product_embeddings` (1:1, `vector(768)`, índice HNSW `vector_cosine_ops`) — la infraestructura
  que CAP-2 (`busqueda`) consume directamente.
- **Seguridad**: `GEMINI_API_KEY` sólo en header (nunca `?key=` en URL), rate-limit propio de
  6/min/IP en `POST /runs` (throttler dedicado — compartir el de `auth` dejaría al dueño sin
  poder entrar al panel durante una corrida), texto de catálogo (no PII) es lo único que cruza
  al proveedor.

## Qué NO está vivo todavía

- **UI de curación** (pantalla para que el dueño edite `description_enriched`) — diferida a FE,
  owner: PO. El endpoint (`PATCH /admin/products/{id}`) ya la soporta.
- **Migración a BullMQ** — diferida a US-019 (aprovisionamiento de Redis), owner: Arquitecto.
  ADR-0014 fija el criterio de migración (catálogo > ~10.000 SKUs o import automatizado).
- **Re-embed masivo por cambio de modelo** — diferida a una US futura, owner: Arquitecto.
  `model_version` en `product_embeddings` ya deja la migración trazable cuando se decida.
- **Exponer el texto enriquecido en el storefront** — decisión de producto con impacto SEO
  pendiente (OQ-BE-3). El texto existe (`description_enriched`) y no se muestra hoy.

## Contratos

El contrato vivo de la superficie REST está en [`contracts/openapi.yaml`](contracts/openapi.yaml)
+ un archivo por endpoint bajo [`contracts/openapi/paths/`](contracts/openapi/paths/). Dos
endpoints vivos:

| Endpoint | Métodos | AC |
|---|---|---|
| `/admin/enrichment/status` | GET | AC-3, AC-8, AC-9 |
| `/admin/enrichment/runs` | POST | AC-1, AC-5, AC-6 |

La curación (AC-7) vive en `/admin/products/{id}` (PATCH), contrato de la capacidad `catalogo`
— no duplicado acá.

## Changes que formaron esta capacidad

| Change | Disciplina | Aporte |
|---|---|---|
| [`US-005-enriquecimiento-ia-embeddings-backend`](../../changes/archive/US-005-enriquecimiento-ia-embeddings-backend/) | BE | Pipeline in-process (ADR-0014), matriz de decisión, claim por lease, `product_embeddings` + HNSW, 2 endpoints admin, throttler dedicado, 9 eventos de observabilidad |

Sin disciplinas FE/QA propias — el consumo del vector es de `busqueda` (US-004) y la curación es
una costura de `catalogo` (US-001). Ningún change adicional planificado para esta capacidad hoy.

## Estado de la provisión

Corre hoy en **entorno local** (`docker-compose`, Postgres+pgvector). Requiere `GEMINI_API_KEY`
provisionada (slot previsto en US-019 T2.x) — sin ella el runner arranca `disabled` en
desarrollo y **no arranca** en producción (decisión D6, precedente de `RESEND_API_KEY`). La
provisión de nube es US-019, igual que el resto del sistema.
