---
tracker-id: null
tracker-source: null
parent-us: US-004
discipline: backend
variant: null
language: es
---

# US-004 Backend — Búsqueda semántica: kNN sobre pgvector, umbral, fallback y degradación

## Why

Este es **el diferenciador** (PRD §1.1) y el que carga el único KPI de producto numérico
del proyecto: **relevancia ≥ 70%** en el top-5 (PRD §1.4). Todo lo demás del e-commerce
lo tiene cualquier competidor; esto es lo que hace que a DSM valga la pena entrar.

La infraestructura de datos ya está: la migración de US-005 creó `product_embeddings`
con `vector(768)` y el índice **HNSW** (`vector_cosine_ops`, `m=16`,
`ef_construction=64`), y `pgvector` está habilitado desde la primera migración del
proyecto. Lo que no existe es **nada del lado de la consulta**: ni el endpoint, ni el
kNN, ni el umbral, ni el fallback.

Y hay tres cosas que la US da por resueltas y no lo están:

**El full-text no existe.** AC-4 exige degradar a búsqueda por texto cuando el
proveedor de IA no responde, y el E2E §9.1 la especifica como «`tsvector` sobre `name` +
`description_enriched`». No hay una sola columna `tsvector` ni un índice GIN en el
esquema. **Este change es el dueño de ese trabajo**, aunque la US lo mencione al pasar
como una alternativa.

**El cache de Redis no se puede construir.** La US §9 y el E2E §17 piden «cache de
consultas frecuentes (Redis)». Redis **no está aprovisionado**: ADR-0012 y ADR-0014 ya
enmendaron ADR-0004 dos veces por la misma razón (US-019 T1.3 sigue abierta, gated en
cuentas externas). Este change es la **tercera** vez que el proyecto se topa con lo
mismo, y aplica el mismo patrón: ejecutor en proceso con el seam intacto para cuando
Redis exista.

**Y la más incómoda: el rate-limit del proveedor hace inviable el camino interactivo.**
US-005 construye el limitador de RPM como un **serializador de intervalo mínimo**:
`60_000 / GEMINI_MAX_RPM`, que con el default de 15 RPM del free tier son **4 segundos
entre llamadas**. Si la búsqueda comparte ese limitador, una consulta espera 4 s —o
mucho más si hay un lote de enriquecimiento corriendo— contra un presupuesto de
**p95 < 1,5 s** (PRD §4). Y al revés: cada búsqueda le come cuota al enriquecimiento.

Peor que la latencia es la aritmética: **15 RPM son 15 búsquedas por minuto en total,
para todo el sitio.** El E2E §17 dimensiona ~50 concurrentes en pico. La suposición
§21 del E2E —«Gemini tiene cuota/rate-limit suficiente»— **no se sostiene para el camino
interactivo**, y este plan la invalida explícitamente. Es la decisión que hay que tomar
antes de ejecutar (OQ-BE-1).

## What changes

**Esquema** — una columna generada y un índice, aditivos:

- `products.search_document` — `tsvector` **generado** (`GENERATED ALWAYS AS … STORED`)
  con la configuración `spanish` sobre `name` + `description_enriched` + `sku`. Generada
  y no mantenida por trigger: se actualiza sola, no hay forma de que quede
  desincronizada.
- Índice **GIN** sobre esa columna. Es lo que hace posible AC-4 y el rescate léxico.

**Superficie HTTP** — un endpoint público:

| Endpoint | Qué hace | AC |
|---|---|---|
| `GET /v1/search?q=&limit=` | Embebe la consulta, hace kNN sobre `product_embeddings` (HNSW), aplica umbral, y devuelve resultados rankeados con `confidence` y, cuando no hay señal, `fallback.suggested_categories`. Degrada a full-text si el proveedor de IA falla o agota el timeout. | AC-1, AC-3, AC-4, AC-5, AC-6, AC-7, AC-9, AC-10 |

`GET` y no `POST`: es una lectura (E2E §9.1 la dibuja así), es cacheable, y permite que
el FE la renderice del lado del servidor. El costo —la consulta queda en logs de
acceso— se asume a conciencia: **es la única fuente de datos del KPI de relevancia**
(US §9 pide registrar búsquedas con y sin resultado), y en una ferretería las consultas
no son PII. Queda declarado, no ignorado.

**Dos caminos de búsqueda, un solo contrato de respuesta**:

1. **Semántico (primario)**: embedding de la consulta por el puerto `AI_EMBEDDER` de
   US-005 → `ORDER BY embedding <=> :qvec` con `LIMIT` y umbral, sobre productos
   `published`. `score = 1 - distancia_cosine`.
2. **Full-text (degradación de AC-4 y rescate léxico)**: `websearch_to_tsquery('spanish', :q)`
   contra `products.search_document`, con `ts_rank`. Cubre además lo que el vector hace
   mal: un SKU, una marca, una medida exacta («taco fischer 8mm» es léxico, no
   semántico).

El **blend** entre los dos queda detrás de una variable (`SEARCH_LEXICAL_WEIGHT`, default
`0` = vector puro) para que la batería de relevancia de AC-2 lo calibre con datos reales
en vez de que este plan lo adivine.

**Umbral y confianza** (AC-3): `SEARCH_MIN_SCORE` (default **0,55**) separa
`confidence: high | low | none`. Con `none` la respuesta trae
`fallback.suggested_categories` derivadas del catálogo — **nunca un «0 resultados»
desnudo** (design-system §7.12, PRD §3.2).

**Interpretación visible sin una segunda llamada al LLM.** El design-system §7.12 pide
mostrar cómo entendió la IA la necesidad. Se deriva de las **categorías de los productos
que matchearon** («Buscamos en: Fijaciones, Mechas y brocas»), no de un segundo prompt.
Dos razones: el presupuesto de latencia no lo aguanta, y —más importante— así **ningún
texto del usuario llega nunca a un modelo generativo**, lo que vuelve AC-8
(anti prompt-injection) *estructuralmente* verdadero en vez de una promesa. Ver OQ-BE-3.

**Presupuesto propio para el proveedor de IA** (OQ-BE-1): el camino interactivo recibe su
propio limitador y su propio timeout (`GEMINI_SEARCH_TIMEOUT_MS`, default **900 ms**),
separados de los del enriquecimiento. El timeout **es** el disparador de la degradación:
a los 900 ms se abandona el embedding y se responde por full-text, lo que mantiene el
p95 bajo 1,5 s incluso en el camino degradado.

**Caché en proceso** (no Redis): LRU acotado por tamaño y TTL, con clave en la consulta
**normalizada** (trim + lowercase + colapso de espacios). Cachea el **vector** de la
consulta, no los resultados — así un cambio de precio o de stock se refleja de inmediato
(AC-9 de US-007 y el mismo principio acá) mientras se ahorra la llamada caras. Mismo
patrón y mismo seam que ADR-0012/ADR-0014.

**Controles de borde**: throttler nombrado `search` propio (AC-10 — protege el costo del
proveedor, no sólo el servidor), consulta acotada en longitud, y `$queryRaw`
**parametrizado** siempre (el texto del usuario nunca se concatena en SQL).

**Observabilidad**: `SearchEventsService` con `search.performed`, `search.no_results`,
`search.low_confidence`, `search.degraded`, `search.cache_hit`,
`search.rate_limited`. `search.no_results` es el evento más valioso del proyecto para el
dueño: **es demanda que el catálogo no cubre.**

## ACs de US-004 cubiertos (capa backend)

| AC | Cubierto | Nota |
|---|---|---|
| AC-1 consulta en lenguaje natural devuelve candidatos | ✅ | kNN sobre HNSW, ordenado por relevancia; el DTO trae `slug` para que el FE enlace a la ficha |
| AC-2 relevancia ≥ 70% en top-5 | ⚠️ **arnés, no veredicto** | Este change entrega el **arnés ejecutable** (script + umbral configurable + 8 consultas semilla). La batería completa de ~30 y el gate son de QA (US §7). **No se puede medir hasta que US-005 pueble embeddings** — hoy 1/28 tasks |
| AC-3 fallback a categorías | ✅ | `confidence: none` → `fallback.suggested_categories`; nunca un cero desnudo |
| AC-4 degradación si la IA no responde | ✅ | timeout de 900 ms o error del proveedor → full-text sobre `search_document`; la respuesta marca `degraded: true` |
| AC-5 consulta vacía o muy corta | ✅ | `< 2` caracteres útiles → **422 sin llamar al proveedor** (no se gasta un centavo) |
| AC-6 sólo productos publicados | ✅ | filtro `status='published'` en **los dos** caminos; probado como invariante |
| AC-7 sin stock aparece marcado | ✅ | `in_stock: false` en el DTO, no se oculta — misma regla que US-002/US-003 |
| AC-8 la consulta no ejecuta acciones | ✅ **estructural** | el texto sólo genera un embedding y un `tsquery` parametrizado; **no existe** ninguna llamada a un modelo generativo en el camino de búsqueda (ver OQ-BE-3) |
| AC-9 productos sin embedding no rompen nada | ✅ | el kNN es un `JOIN` con `product_embeddings`: sin fila, el producto simplemente no aparece por la vía semántica, y sigue alcanzable por full-text y por browse (US-002) |
| AC-10 control de abuso | ✅ | throttler `search` propio + caché + tope de longitud de consulta |

La **UI** (SearchBar, dropdown, skeleton «buscando con IA», página de resultados,
interpretación visible) es de la capa FE.

## Out of scope

- **Enriquecimiento de descripciones y generación de embeddings de productos** — US-005.
  Este change **consume** su puerto `AI_EMBEDDER` y **no** genera embeddings de catálogo.
- **La batería completa de ~30 consultas y el gate del 70%** — QA (US §7, E2E §19). Acá
  va el arnés y una semilla de 8 consultas para poder calibrar el umbral.
  `Deferred: /plan-qa US-004 — owner: QA`
- **Re-tuning del HNSW** (`m`, `ef_construction`) — US-005 lo dejó explícitamente para
  cuando exista la batería. Este change **sí** fija `hnsw.ef_search` por consulta, que es
  la perilla de lectura.
- **Filtros avanzados** (marca, precio, atributos) y **chatbot conversacional** — roadmap
  (PRD §2.2).
- **Caché en Redis** — no está aprovisionado (ADR-0012/0014). Acá va en proceso, con el
  seam listo. `Deferred: US-019 T1.3 — owner: Arquitecto`
- **Autocompletado / sugerencias en vivo** del dropdown (design-system §7.12): no hay AC
  que lo pida y sería un segundo endpoint con su propio presupuesto de latencia.
  `Deferred: US futura — owner: PO`
- **Tests de carga (k6) y E2E cross-service** — de `/plan-qa`.

## Standards consultados

| Standard | Secciones aplicadas |
|---|---|
| `base-standards.md` | §1 KISS/YAGNI (sin segundo LLM, sin autocompletado, blend detrás de una variable en vez de heurística propia) |
| `backend-standards.md` | capas, errores tipados, validación en el borde, resiliencia |
| `backend-node-standards.md` | §2 capas · §3 DI por token (**reusa `AI_EMBEDDER`**) · §4 DTO + `ValidationPipe` · §5 Prisma + `$queryRaw` **parametrizado** + migración aditiva · §6 errores de dominio + RFC 7807 · §7 config fail-fast · **§8 timeout como disparador de degradación** · §9 logs sin PII |
| `api-standards.md` | §2.6 nombres de query params · §3.2 status codes · §5.5 dinero en centavos · §8 RFC 7807 · §12 `RateLimit-*` |
| `security-standards.md` | §2 STRIDE (4 filas nuevas) · §6 validación de entrada · §7.1 headers · §7.3 rate-limit (**acá protege costo de un tercero, no sólo CPU**) · §5 secretos |
| `performance-standards.md` | presupuesto p95 descompuesto; el timeout como parte del presupuesto |
| `observability-standards.md` | §9 sin PII; contadores por nombre de evento |
| `testing-standards.md` / `qa-backend-standards.md` | §14 pirámide; suites dev-owned vs QA (la batería es QA) |
| ADR-0002 | pgvector 768 + HNSW como datastore único |
| ADR-0003 | Gemini `text-embedding-004` — proveedor y modelo, **no negociables acá** |
| ADR-0012 / ADR-0014 | precedente del ejecutor en proceso mientras Redis no exista |

## Preguntas abiertas

La primera **sí bloquea**: cambia la viabilidad del diferenciador y tiene costo.

### OQ-BE-1 — El techo de 15 RPM `[Resolved: 2026-08-22 — opción (b): free tier, techo aceptado y documentado]`

US-005 implementa el limitador del proveedor como **serializador de intervalo mínimo**:
`60_000 / GEMINI_MAX_RPM`. Con el free tier de 15 RPM eso es **una llamada cada 4
segundos** y **15 búsquedas por minuto para todo el sitio**, contra un presupuesto de
p95 < 1,5 s y los ~50 concurrentes en pico del E2E §17. La suposición §21 del E2E
(«Gemini tiene cuota suficiente») no cubría el camino interactivo.

**Decisión del PO: se queda en free tier.** Alcanza para la demo del máster y para el
tráfico real de una ferretería de barrio, donde las consultas se repiten. El techo se
acepta **como limitación conocida del ambiente**, no como deuda oculta.

Eso convierte tres cosas de este plan en decisiones distintas, y están reflejadas abajo:

1. **El caché deja de ser una optimización y pasa a ser *load-bearing*** (OQ-BE-6). Es lo
   único que hace tolerable el techo.
2. **La degradación a full-text pasa a ser un estado común, no excepcional** — con 15 RPM
   una ráfaga la dispara. El FE tiene que tratarla como normal (no como alarma) y el
   runbook la describe como comportamiento esperado bajo carga, con la alerta puesta en la
   **tasa** y no en cada ocurrencia.
3. **`GEMINI_SEARCH_MAX_RPM` y `GEMINI_MAX_RPM` reparten un total de 15**, con la búsqueda
   quedándose la mayor parte: es interactiva y el enriquecimiento puede esperar. Default
   **10 para búsqueda / 5 para enriquecimiento**, y queda dicho que enriquecer el catálogo
   inicial (~5.000 SKUs × 2 llamadas) a 5 RPM son del orden de **33 horas** — una ventana
   de fin de semana. Es la pregunta Q-4 del E2E §23, que sigue abierta con el PO.

**Cuándo revisar la decisión**: `search.degraded` y `search.cache_hit` son las métricas que
lo dicen. Si la tasa de degradación sube de forma sostenida, el techo empezó a morder y el
tier pago vuelve a la mesa. **Siguiente paso natural si eso pasa**, antes de pagar: mover el
caché de vectores de consulta a una tabla en Postgres —hoy es en proceso y muere en cada
deploy—, ya que el vector de una consulta es determinista y se puede guardar para siempre.
No se construye ahora (YAGNI).

| Id | Pregunta | Default implementado | Estado |
|---|---|---|---|
| **OQ-BE-2** | Umbral `SEARCH_MIN_SCORE` que separa `high`/`low`/`none` | **0,55** sobre `1 - distancia_cosine`. Es un punto de partida: lo calibra la batería de AC-2, no este plan | `[Default implementado]` |
| **OQ-BE-3** | **Interpretación visible** (design-system §7.12): ¿se genera con el LLM o se deriva de las categorías? | **Derivada de las categorías** que matchearon. Ahorra una llamada en el camino interactivo —que con el techo de 15 RPM es la diferencia entre funcionar y no— y, lo que importa más, hace que **ningún texto del usuario llegue a un modelo generativo**, volviendo AC-8 estructural | `[Default implementado]` |
| **OQ-BE-4** | ¿Blend léxico + vectorial desde el día uno? | `SEARCH_LEXICAL_WEIGHT=0` (vector puro) y la perilla lista. El full-text se construye igual porque AC-4 lo exige; si la batería no llega al 70%, se sube el peso. **Con el free tier gana peso extra**: el camino léxico no consume cuota | `[Default implementado]` |
| **OQ-BE-5** | ¿Se loguea el texto de la consulta? | **Sí.** Es la única fuente del KPI de relevancia (US §9) y de la señal de demanda no cubierta. En una ferretería las consultas no son PII. Queda declarado como decisión, no como descuido | `[Default implementado]` |
| **OQ-BE-6** | TTL y tamaño del caché de vectores de consulta | **24 h** y **2.000 entradas** (revisado al alza tras resolver OQ-BE-1 como (b) — ver abajo) | `[Resolved: 2026-08-22 — consecuencia de OQ-BE-1 (b)]` |

> **Por qué el TTL del caché sube de 10 min a 24 h.** El vector de una consulta es
> **determinista**: `embedding = f(texto, modelo)`. El mismo texto produce siempre el mismo
> vector mientras no cambie `GEMINI_EMBED_MODEL`. No hay dato que se pueda quedar viejo, así
> que un TTL corto sólo tira trabajo ya pagado — y con el free tier ese trabajo es el recurso
> escaso. La clave del caché incluye el **modelo**, de modo que cambiarlo invalida todo
> naturalmente. Lo que sigue acotando el caché es el **LRU por tamaño**, no el tiempo.
> Y sigue cacheándose **el vector y no los resultados**: precio y stock se leen frescos
> siempre.

## References

- User story: [`docs/user-stories/US-004-busqueda-semantica.md`](../../../docs/user-stories/US-004-busqueda-semantica.md)
- PRD: [`docs/product/prd.md`](../../../docs/product/prd.md) §1.1 (el diferenciador), **§1.4 (KPI ≥70%)**, §3.2, §4 (p95 < 1,5 s)
- E2E: [`docs/product/design-e2e.md`](../../../docs/product/design-e2e.md) §6.1 (`SearchModule`), §8 (DER + HNSW), **§9.1 (secuencia con fallback)**, §14 (STRIDE — cost abuse y prompt injection), §17 (NFRs), §18 (observabilidad), §19 (batería de calidad), **§21 (la suposición de cuota que este plan invalida)**
- Design system: §7.12 SearchExperience, §10.1 estado vacío
- **ADR-0002** (pgvector + HNSW), **ADR-0003** (Gemini `text-embedding-004`),
  **ADR-0012 / ADR-0014** (ejecutor en proceso mientras Redis no exista)
- Change del que depende: [`US-005-enriquecimiento-ia-embeddings-backend`](../US-005-enriquecimiento-ia-embeddings-backend/design.md)
  — de ahí salen `product_embeddings`, el índice HNSW y el puerto **`AI_EMBEDDER`**
- Changes de referencia: `US-003-ficha-producto-pdp-backend` (superficie pública, DTO sin
  ids internos, caché acotada), `US-007-carrito-compra-backend` (throttler nombrado
  propio), `US-009-pago-mercadopago-backend` (timeout/degradación de un tercero)
