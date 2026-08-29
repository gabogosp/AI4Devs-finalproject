# `search` — búsqueda semántica (US-004)

El diferenciador: el cliente describe lo que necesita y recibe productos relevantes aunque no sepa
el nombre técnico. Superficie **pública**: `GET /v1/search?q=…`.
| Camino | Cuándo | Cómo |
|---|---|---|
| **Semántico** | por defecto, con proveedor y cuota | embedding de la consulta → kNN sobre el HNSW de `product_embeddings` |
| **Full-text** | el proveedor falla, se cuelga o no tiene cuota | `websearch_to_tsquery('spanish', …)` sobre `products.search_document` |

Los dos devuelven **la misma forma**: un solo mapeo a DTO, así que degradar no cambia el contrato.
## El timeout **es** la degradación (AC-4)
A los `GEMINI_SEARCH_TIMEOUT_MS` (900 ms) se abandona el embedding y se responde por full-text con
`degraded: true` y **200**. No es una rama de emergencia: es el valor de una decisión que se toma
siempre. Un 5xx acá volvería el problema de un tercero en una caída de la tienda, y el cliente que
ve un error no reintenta. `QueryEmbedder` devuelve `{ ok: false, reason }` en vez de lanzar: el
compilador obliga a tratar el caso en cada camino nuevo.
## El limitador es propio, no el del lote
El de US-005 serializa a `60_000 / RPM`: **12 s** entre llamadas con los 5 RPM del lote (4 s si
tuviera los 15), contra un presupuesto **total de 1,5 s** por búsqueda (PRD §4). Compartirlo
pondría cada consulta detrás de la fila de un lote; y al revés, cada búsqueda le robaría una ranura
al enriquecimiento, que es lo que *habilita* la búsqueda. El adapter tiene un **perfil**
`interactive` con su instancia y su cola: se reusa la clase, no el estado. Los 15 RPM se reparten
**10 búsqueda / 5 lote** y la suma se valida al arrancar.
## Se cachea el **vector**, no los resultados
Cachear resultados haría que un cambio de precio o de stock tarde hasta 24 h en verse. Cachear el
vector ahorra la llamada paga —el recurso escaso— y deja el kNN y la hidratación siempre frescos.
El TTL de 24 h no es agresividad: el vector es determinista para un modelo dado, y la clave incluye
el modelo, así que cambiarlo invalida todo naturalmente.
## Arnés de relevancia (AC-2)
`pnpm --filter @dsm/api relevance` (aplica el gate de `SEARCH_RELEVANCE_TARGET`, 0.7) ·
`-- --dry-run` (sólo reporta) · `-- --sweep=0.4,0.5,0.55,0.6,0.7 --out=/tmp/sweep.json`. Lo primero
que imprime es la **cobertura de embeddings**: 0 % con cobertura 0 % es un catálogo sin enriquecer,
**no** un buscador malo.
## Qué **no** hace
**No genera embeddings de productos** (eso es US-005 — acá se embebe la *consulta*) · **no llama a
ningún modelo generativo**, así que la protección anti prompt-injection de AC-8 es estructural y no
depende de sanitizar · **no decide qué se publica**: filtra `status = 'published'` en las dos
queries.
