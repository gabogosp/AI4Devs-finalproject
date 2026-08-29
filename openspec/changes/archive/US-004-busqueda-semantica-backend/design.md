---
parent-us: US-004
discipline: backend
variant: null
language: es
---

# US-004 Backend — Design

## Context

El proveedor y el modelo están fijados (ADR-0003: Gemini `text-embedding-004`), el
datastore también (ADR-0002: pgvector 768 + HNSW), y US-005 ya migró
`product_embeddings` con su índice. La secuencia del E2E §9.1 fija el flujo: embebe la
consulta → kNN → si no hay señal, fallback a categorías; si el proveedor cae, full-text.

Lo que queda por decidir son cinco cosas, y la primera no es una preferencia de
implementación sino una restricción de viabilidad que nadie había puesto en números.

## Goals

- Devolver candidatos relevantes ordenados para una consulta en lenguaje natural (AC-1).
- No devolver nunca un «cero resultados» desnudo (AC-3) ni romperse si el proveedor de IA
  cae (AC-4).
- Mantener p95 < 1,5 s **incluido el camino degradado** (PRD §4).
- Entregar un arnés con el que el 70% de AC-2 sea **medible y calibrable**, no una
  aspiración.
- Que la consulta del usuario no pueda ejecutar nada (AC-8), estructuralmente.

## Non-goals

- Generar embeddings de catálogo ni enriquecer descripciones (US-005).
- La batería completa de ~30 consultas y su gate (QA).
- Re-tunear el HNSW (`m`, `ef_construction`) — US-005 lo dejó para cuando haya datos.
- Autocompletado en vivo, filtros avanzados, chatbot (roadmap).

## Approach

### D1 — El presupuesto de latencia decide la arquitectura

p95 < 1,5 s con una llamada a un tercero en el medio. Descomposición:

| Tramo | Presupuesto | Nota |
|---|---|---|
| Validación + normalización + caché | ≤ 5 ms | en proceso |
| Embedding de la consulta (Gemini) | **timeout 900 ms** | el tramo que no controlamos |
| kNN sobre HNSW (~5.000 vectores) | ≤ 30 ms | `ef_search` fijado por consulta |
| Hidratación de productos + DTO | ≤ 60 ms | `JOIN` a `products` por los ids del top-N |
| **Total peor caso no degradado** | **≈ 1,0 s** | deja ~500 ms de margen |
| **Camino degradado (full-text)** | **≈ 100 ms** tras abandonar a los 900 ms | total ≈ 1,0 s |

La consecuencia de diseño es que **el timeout es el disparador de la degradación**, no un
error a reportar: a los 900 ms se abandona el embedding y se responde por full-text
marcando `degraded: true`. Así AC-4 no es un camino excepcional que alguien tenga que
recordar probar — es el comportamiento por defecto cuando el presupuesto se agota.

### D2 — El limitador de RPM: por qué el camino interactivo necesita el suyo

US-005 implementa el limitador como **serializador de intervalo mínimo**
(`60_000 / GEMINI_MAX_RPM`). Es la decisión correcta para trabajo por lotes: garantiza no
pasarse de la cuota. Aplicada al camino interactivo es letal:

- Con `GEMINI_MAX_RPM=15` (free tier), el intervalo mínimo es **4.000 ms** — casi tres
  veces el presupuesto **total** de la búsqueda.
- Detrás de un lote de enriquecimiento en curso, la espera no está acotada por 4 s sino
  por la cola de ese lote.
- Y al revés: cada búsqueda le roba una ranura al enriquecimiento, que es lo que
  **habilita** la búsqueda. Se compiten a sí mismos.

Por eso el camino de búsqueda recibe **su propio limitador y su propio timeout**:
`GEMINI_SEARCH_MAX_RPM` y `GEMINI_SEARCH_TIMEOUT_MS`. El puerto `AI_EMBEDDER` de US-005
**se reusa tal cual** —no se duplica el cliente HTTP de Gemini, ni la redacción de la
API key, ni el parseo de la respuesta—; lo que no se comparte es la **política de
tasa**, que es lo único que difiere entre un lote y una request.

**El límite duro sigue existiendo, y el PO decidió aceptarlo** (OQ-BE-1, opción (b)):
free tier, con los 15 RPM **repartidos 10 / 5** a favor de la búsqueda porque es
interactiva y el enriquecimiento puede esperar. La suma se valida en el arranque, así que
nadie sube un presupuesto sin bajar el otro por descuido.

Las consecuencias se asumen explícitamente: enriquecer el catálogo inicial (~5.000 SKUs ×
2 llamadas) a 5 RPM son del orden de **33 horas** —una ventana de fin de semana, que es la
pregunta Q-4 del E2E §23 todavía abierta con el PO— y **la degradación a full-text pasa a
ser un estado común**, no excepcional: con 10 RPM, una ráfaga la dispara. Eso cambia dos
cosas fuera de este change: el FE debe presentar `degraded: true` como normal y no como
alarma, y la alerta del runbook va sobre la **tasa sostenida** de `search.degraded`, no
sobre cada ocurrencia.

**Ubicación del puerto**: US-005 lo pone en `src/enrichment/ports/ai-embedder.port.ts`.
Con dos consumidores, su dueño natural deja de ser enrichment. Igual que US-005 hizo con
`EnrichmentQueue` —«su dueño natural es el consumidor»—, este change **mueve** el puerto a
`src/ai/ports/ai-embedder.port.ts` con un import cambiado y cero cambio de
comportamiento, y los specs de US-005 tienen que pasar **sin editarse**. Si US-004 se
ejecuta antes que US-005, el movimiento no aplica y la task lo crea ahí directamente.

### D3 — Los dos caminos y su SQL

**Semántico** (`$queryRaw` **parametrizado** — el texto del usuario nunca se concatena):

```sql
SET LOCAL hnsw.ef_search = $efSearch;           -- perilla de lectura (default 64)
SELECT p.slug, p.name, p.price_ars_cents, p.stock, p.image_url, c.name AS category_name,
       1 - (e.embedding <=> $qvec::vector) AS score
  FROM product_embeddings e
  JOIN products p ON p.id = e.product_id
  LEFT JOIN categories c ON c.id = p.category_id
 WHERE p.status = 'published'                    -- AC-6
 ORDER BY e.embedding <=> $qvec::vector          -- usa el HNSW
 LIMIT $limit;
```

El `JOIN` (no `LEFT JOIN`) contra `product_embeddings` es lo que hace verdadero AC-9: un
producto sin embedding no aparece por esta vía y no rompe nada.

**Full-text** (degradación de AC-4 + rescate léxico):

```sql
SELECT p.slug, …, ts_rank(p.search_document, q) AS score
  FROM products p, websearch_to_tsquery('spanish', $q) q
 WHERE p.status = 'published' AND p.search_document @@ q
 ORDER BY score DESC LIMIT $limit;
```

`websearch_to_tsquery` y no `to_tsquery`: acepta texto libre del usuario sin explotar con
sintaxis inválida, que es exactamente lo que llega por un buscador.

### D4 — Persistencia: la columna que faltaba

Una sola adición al esquema, aditiva:

| Columna | Tipo | Notas |
|---|---|---|
| `products.search_document` | `tsvector` | `GENERATED ALWAYS AS (...) STORED`, configuración **`spanish`**, sobre `coalesce(name,'')` + `coalesce(description_enriched,'')` + `coalesce(sku,'')` |

**Índice**: `GIN` sobre `search_document`.

**Generada, no por trigger**: una columna generada no puede quedar desincronizada del
dato que la origina. Un trigger sí —el día que alguien haga un `UPDATE` por una vía que
no lo dispare—, y el síntoma sería «la búsqueda por texto no encuentra un producto que
existe», que es de los más difíciles de atribuir.

Incluye `sku` a propósito: es el caso léxico puro que el vector hace peor («taco fischer
SX 8mm»). Y usa `description_enriched` y no `description_raw` porque es la que US-005
produce y la que el E2E §9.1 nombra.

**Deviación del DER**: el E2E §8 no declara `search_document`. Es una columna derivada, no
un dato nuevo, y la exige AC-4 — que el DER no modela porque el DER no baja a la
estrategia de consulta.

### D5 — Umbral, confianza y fallback

| `confidence` | Condición | Respuesta |
|---|---|---|
| `high` | top score ≥ `SEARCH_MIN_SCORE` (0,55) | resultados, `fallback: null` |
| `low` | hay resultados pero el top está bajo el umbral | resultados **+** `fallback.suggested_categories` (el FE avisa que no está seguro) |
| `none` | sin resultados sobre el piso absoluto | `results: []` + `fallback.suggested_categories` |

Las `suggested_categories` salen de las categorías de los mejores candidatos aunque estén
bajo el umbral; si no hay ninguno, de las categorías raíz con más productos publicados.
**Nunca se devuelve una lista vacía sin salida** (AC-3, design-system §10.1).

`interpreted_as` se arma con las categorías distintas del top-N: «Buscamos en: Fijaciones,
Mechas y brocas». Es honesto —dice dónde miró, no finge entender— y **no cuesta una
llamada** (OQ-BE-3).

#### Calibración medida del umbral (T6.2, 2026-08-23)

> ⚠ **Medido sobre catálogo SIN enriquecer — recalibrar tras la primera corrida de US-005.**
> Sin `GEMINI_API_KEY` el embedder de consultas queda `unavailable`, así que las 8 consultas
> semilla corrieron **degradadas**: lo que la tabla mide es el camino **full-text**, no el
> semántico. El catálogo de seed son 4 productos publicados y **0 con vector**
> (`embedding_coverage: 0`).

Barrido con `pnpm --filter @dsm/api relevance -- --sweep=0.4,0.5,0.55,0.6,0.7`:

| `SEARCH_MIN_SCORE` | % acierto con confianza alta | % acierto en top-5 |
|---|---|---|
| 0,40 | 33,3 % | 33,3 % |
| 0,50 | 33,3 % | 33,3 % |
| **0,55** | 33,3 % | 33,3 % |
| 0,60 | 33,3 % | 33,3 % |
| 0,70 | 33,3 % | 33,3 % |

**El umbral se queda en 0,55**, y la tabla explica por qué la decisión **no puede tomarse
todavía**: el porcentaje es plano en los cinco valores. Eso no significa que el umbral no
importe; significa que en esta corrida no hay ningún resultado cuyo score caiga *entre* 0,40 y
0,70 — los dos aciertos son coincidencias léxicas normalizadas a 1,0 y los seis fallos no
devuelven nada. Un barrido informativo necesita resultados en la zona gris, y esos aparecen
recién con embeddings reales.

**Hallazgo del arnés que sí cambió el código.** La primera corrida reveló que `ts_rank` y la
similitud cosine viven en **escalas distintas**: un match léxico exacto de SKU puntuaba ~0,10
contra un umbral de 0,55 calibrado para cosine. Consecuencias, las dos silenciosas:

1. El camino degradado **nunca** podía reportar `confidence: high` —ni con la coincidencia más
   exacta posible—, así que toda respuesta del plan B se veía dudosa aunque fuera perfecta.
2. `blend` sumaba 0,10 contra 0,85: `SEARCH_LEXICAL_WEIGHT` existía en la configuración y su
   efecto habría sido imperceptible. La perilla que el plan reserva para «si la batería no llega
   al 70 %, subir el peso léxico» no habría funcionado.

`fullText` ahora normaliza el `ts_rank` **al mejor del conjunto** (el top vale 1). La
contrapartida hay que decirla: el score léxico pasa a ser un **rango relativo**, no una
similitud absoluta comparable entre consultas distintas.

### D6 — Caché en proceso (tercera instancia de ADR-0012/0014)

Se cachea **el vector de la consulta**, no los resultados. La distinción importa:

- Cachear resultados haría que un cambio de precio o de stock tarde hasta 10 minutos en
  verse — el mismo defecto que US-007 evitó al recalcular el carrito en cada lectura.
- Cachear el vector ahorra la llamada caras (que es el recurso escaso) y deja que el kNN
  y la hidratación corran siempre frescos. El kNN cuesta 30 ms; no hace falta cachearlo.

**Con el free tier (OQ-BE-1 (b)) este caché deja de ser una optimización y pasa a ser
*load-bearing*: es lo único que hace tolerable el techo.** De ahí dos números revisados al
alza: `SEARCH_CACHE_MAX_ENTRIES=2000` y `SEARCH_CACHE_TTL_MS=86_400_000` (24 h).

El TTL largo no es agresividad: el vector de una consulta es **determinista**
(`embedding = f(texto, modelo)`), así que no hay dato que pueda quedar viejo mientras el
modelo no cambie. La clave incluye el modelo (`${GEMINI_EMBED_MODEL}:${consulta}`), de modo
que cambiarlo invalida todo naturalmente; lo que acota el caché es el **LRU por tamaño**.
Un TTL corto sólo tiraría trabajo ya pagado, y con el free tier ese trabajo es el recurso
escaso.

LRU acotado, clave = modelo + consulta normalizada. El seam queda listo para que un adaptador Redis lo reemplace cuando
US-019 T1.3 cierre; no se agrega ADR porque ADR-0012 y ADR-0014 ya fijaron el patrón y
acá no hay durabilidad en juego.

**Siguiente paso natural si el techo empieza a morder**, antes de pagar el tier: mover este
caché a una **tabla en Postgres**. Hoy es en proceso y muere en cada deploy, justo el
momento en que el free tier menos lo perdona. Como el vector es determinista, guardarlo
para siempre es correcto. **No se construye ahora** (YAGNI): la señal para hacerlo es
`search.degraded` alto con `search.cache_hit` bajo.

### D7 — Capas

```
src/search/
├─ search.module.ts
├─ search.controller.ts        ← GET /v1/search
├─ search.service.ts           ← orquesta: caché → embed → kNN → umbral → fallback / degradación
├─ search.repository.ts        ← único punto de $queryRaw de los dos caminos
├─ query-normalizer.ts         ← puro: trim, lowercase, colapso de espacios, tope de longitud
├─ relevance.ts               ← puro: score, confidence, blend léxico, suggested_categories
├─ query-vector.cache.ts       ← LRU en proceso
├─ search-throttler.guard.ts   ← throttler nombrado propio
├─ dto/search.dto.ts
└─ ports/                      ← (si US-005 no corrió aún) ai-embedder.port.ts movido acá
```

`relevance.ts` y `query-normalizer.ts` son **puros**: es donde vive la lógica que decide
qué se muestra, y así se puede ejercer el umbral, el blend y el fallback sin HTTP, sin
Postgres y sin Gemini — igual que `cart-view.ts` en US-007.

### D8 — Errores

| Situación | Status | `type` |
|---|---|---|
| Consulta vacía o < 2 caracteres útiles | `422` | `dsm:search/query-too-short` — **sin llamar al proveedor** (AC-5) |
| Consulta por encima del tope de longitud | `422` | `dsm:search/query-too-long` |
| Throttler excedido | `429` | (guard, con `RateLimit-*`) |
| Proveedor de IA caído / timeout | **200** | **no es un error**: se degrada y se responde con `degraded: true` (AC-4) |
| Postgres caído | `503` | `dsm:search/unavailable` — acá sí no hay salida |

Que el fallo del proveedor sea un **200 degradado** y no un 5xx es deliberado: la
navegación no se rompe (AC-4), y un buscador que devuelve 5xx en una ráfaga le enseña a
Google a sacar URLs del índice — la lección que US-003 ya pagó con el 429.

### D9 — Threat model (STRIDE, sobre E2E §14)

| Amenaza | Superficie | Control |
|---|---|---|
| **Cost abuse** — quemar la cuota de Gemini | `GET /v1/search` | throttler `search` propio + caché del vector + tope de longitud + `SEARCH_MIN_LENGTH` que corta antes de llamar |
| **Prompt injection** | el texto de la consulta | **estructural**: el texto sólo produce un embedding y un `tsquery` parametrizado. **No existe** una llamada a un modelo generativo en este camino (D5/OQ-BE-3). No hay nada que inyectar |
| **SQL injection** | los dos `$queryRaw` | parámetros ligados siempre; el vector se pasa como parámetro con cast explícito. Test que intenta `'; DROP TABLE` y verifica que se trata como texto |
| **Information disclosure** — catálogo oculto | resultados | filtro `status='published'` en **ambos** caminos, probado como invariante (T5.1). Un `draft` no puede aparecer ni por vector ni por texto |
| **Information disclosure** — la API key | adapter | se reusa el de US-005, que ya manda la clave por header y redacta al loguear. Este change **no** abre un segundo camino de salida |

### D10 — Observabilidad

`SearchEventsService`, contador por nombre de evento (sin dimensión por consulta:
cardinalidad infinita):

| Evento | Para qué |
|---|---|
| `search.performed` | denominador del KPI |
| `search.no_results` | **demanda que el catálogo no cubre** — la señal más valiosa para el dueño |
| `search.low_confidence` | mide si el catálogo está lo bastante enriquecido |
| `search.degraded` | el proveedor está fallando; alerta de §18 |
| `search.cache_hit` | mide cuánto ahorra el caché (insumo para dimensionar el tier) |
| `search.rate_limited` | abuso o límite mal calibrado |

El **texto de la consulta** va en la línea de log (no en una etiqueta de métrica), por
OQ-BE-5: es la única fuente del KPI de relevancia y de la señal de demanda.

## Trade-offs

**Vector puro vs blend léxico desde el día uno.** El blend casi seguro mejora el 70% en
un catálogo de ferretería, donde media consulta es una medida o una marca. Se construye
la capacidad (el full-text es obligatorio por AC-4 de todos modos) pero se deja en `0`
por defecto: el número correcto lo dice la batería con datos reales, y elegirlo ahora
sería adivinar con la apariencia de rigor.

**Cachear el vector vs cachear los resultados.** Cachear resultados ahorra más (evita
también el kNN) pero congela precio y stock hasta 10 minutos. El kNN cuesta 30 ms: no
vale la pena pagar frescura por eso.

**Derivar la interpretación vs generarla con el LLM.** Generarla daría el texto rico que
el design-system imagina («fijación a mampostería: tarugos + tornillos para hormigón»).
Se descarta por dos razones y la segunda es la que manda: no entra en el presupuesto de
latencia, y meter el texto del usuario en un modelo generativo convierte AC-8 de una
propiedad estructural en una promesa que hay que defender con filtros.

**Mover el puerto `AI_EMBEDDER`.** Toca un archivo de un change en vuelo. Se hace igual
porque con dos consumidores el puerto ya no pertenece a enrichment, y US-005 dejó escrito
el mismo criterio para `EnrichmentQueue`. El riesgo se acota exigiendo que los specs de
US-005 pasen sin editarse.

## Deployment considerations

**Se recomienda coordinar con el plan de despliegue de US-005**, no uno propio:

1. **Migración** aditiva. El `ALTER TABLE ... ADD COLUMN ... GENERATED` **reescribe la
   tabla** `products`: con ~5.000 filas es instantáneo, pero conviene decirlo. El
   `CREATE INDEX` GIN puede ir `CONCURRENTLY` si molesta.
2. **Sin secreto nuevo**: reusa `GEMINI_API_KEY` de US-005. **Sí** hay variables nuevas:
   `GEMINI_SEARCH_MAX_RPM`, `GEMINI_SEARCH_TIMEOUT_MS`, `SEARCH_MIN_SCORE`,
   `SEARCH_MIN_LENGTH`, `SEARCH_MAX_LENGTH`, `SEARCH_LIMIT_DEFAULT`, `SEARCH_LIMIT_MAX`,
   `SEARCH_LEXICAL_WEIGHT`, `SEARCH_HNSW_EF_SEARCH`, `SEARCH_CACHE_TTL_MS`,
   `SEARCH_CACHE_MAX_ENTRIES`, `SEARCH_RATE_LIMIT_TTL_MS`, `SEARCH_RATE_LIMIT_MAX`.
3. **Depende del tier del proveedor** (OQ-BE-1). Si se queda en free tier, el despliegue
   debería documentar el techo de 15 RPM como limitación conocida del ambiente.
4. **Sin feature flag**: si el proveedor no está configurado, la búsqueda **degrada a
   full-text** por el mismo camino de AC-4 — no hace falta apagarla.

**Rollback**: revertir el deploy de la API alcanza; la columna generada y el índice pueden
quedar (nadie más los lee).

## Spec delta (para `/archive-change`)

`GET /v1/search` forma la capacidad nueva `openspec/specs/busqueda/`, con
`contracts/openapi.yaml` (raíz viva) + `openapi/paths/search.yaml` a partir del draft de
este change, más `README.md`, `requirements.md` y `decisions.md` (link a ADR-0002 y
ADR-0003).

## Open questions

**OQ-BE-1 bloquea** (el techo de 15 RPM vs el presupuesto de latencia y ~50 concurrentes).
Las otras cinco viven en `proposal.md` con su default implementado.

## References

- ADR-0002 (pgvector + HNSW), ADR-0003 (Gemini `text-embedding-004`),
  ADR-0012 / ADR-0014 (ejecutor en proceso mientras Redis no exista)
- E2E §6.1, §8, **§9.1**, §14, §17, §18, §19, **§21** (la suposición de cuota que este
  plan invalida para el camino interactivo)
- PRD §1.1, **§1.4** (KPI ≥ 70%), §3.2, §4
- Design system §7.12, §10.1
- Change del que depende: [`../US-005-enriquecimiento-ia-embeddings-backend/design.md`](../US-005-enriquecimiento-ia-embeddings-backend/design.md)
- Contrato draft: [`contracts/openapi/search.yaml`](contracts/openapi/search.yaml)
- Standards: `backend-node-standards.md` §2–§9 · `api-standards.md` §2, §3, §5, §8, §12 ·
  `security-standards.md` §2, §5, §6, §7 · `performance-standards.md` ·
  `observability-standards.md` §9 · `testing-standards.md` §14
