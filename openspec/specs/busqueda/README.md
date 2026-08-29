# Capacidad: Búsqueda semántica (CAP-2)

**Estado**: parcialmente entregada — backend vivo; superficie de storefront (input de
búsqueda, resultados) pendiente.

Estado declarado del sistema para la capacidad CAP-2 del PRD §2.1. Este directorio es el
**acumulado** de los changes archivados: se extiende en cada `/archive-change`, nunca se reescribe.

## Qué está vivo hoy

`GET /v1/search` (US-004 backend): búsqueda en lenguaje natural sobre el catálogo.

- **Camino semántico** (primario): embebe la consulta (Gemini `text-embedding-004`,
  ADR-0003) y hace kNN sobre `product_embeddings` con índice HNSW (ADR-0002).
- **Camino full-text** (degradación, AC-4): si el proveedor de IA falla o agota
  `GEMINI_SEARCH_TIMEOUT_MS` (900 ms), responde por `tsvector` (`websearch_to_tsquery`,
  configuración `spanish`) y marca `degraded: true` **con status 200** — nunca un 5xx.
- **Nunca un «cero resultados» desnudo** (AC-3): sin señal sobre el umbral, la respuesta
  trae `fallback.suggested_categories`.
- `confidence` (`high` / `low` / `none`) le dice al frontend cuánta convicción tener en
  los resultados.
- `interpreted_as` se **deriva** de las categorías que matchearon — nunca se genera con
  un LLM: el texto del cliente nunca llega a un modelo generativo (AC-8 estructural).
- Sólo productos `published` (AC-6); sin stock aparece marcado, no oculto (AC-7); un
  producto sin embedding no rompe la búsqueda (AC-9).
- Throttler `search` propio (cubo independiente de `auth`/`storefront`/`cart`) y caché en
  proceso del **vector de la consulta** (no de los resultados) para tolerar el techo de
  RPM del free tier de Gemini.

## Qué NO está vivo todavía

- **Input de búsqueda en el storefront** (UI, autocompletado, página de resultados) →
  `US-004-busqueda-semantica-frontend-web` (en curso).
- **Verificación de AC-2** (relevancia ≥ 70% en el top-5): el backend entrega el **arnés
  ejecutable** (script + gate por exit code + 8 casos semilla), no el veredicto — el
  catálogo de seed no tiene embeddings todavía (depende de US-005). La batería completa
  de ~30 casos y el gate son de QA — `Deferred: /plan-qa US-004`.
- **Caché en Redis**: hoy en proceso (ADR-0012/ADR-0014); migra cuando US-019 T1.3 cierre.
- **Blend léxico calibrado**: `SEARCH_LEXICAL_WEIGHT=0` por defecto hasta que la batería
  con datos reales diga el número correcto.

## Contratos

El contrato vivo de la superficie REST está en [`contracts/openapi.yaml`](contracts/openapi.yaml):
raíz con `info`/`servers`/`security` y los `components/schemas` compartidos, más un archivo
por endpoint bajo [`contracts/openapi/paths/`](contracts/openapi/paths/) referenciado por `$ref`.

| Endpoint | Métodos | AC |
|---|---|---|
| `/search` | GET | AC-1, AC-2 (arnés), AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10 |

## Changes que formaron esta capacidad

| Change | Disciplina | Aporte |
|---|---|---|
| [`US-004-busqueda-semantica-backend`](../../changes/archive/US-004-busqueda-semantica-backend/) | BE | `GET /v1/search`, columna `search_document` (tsvector + GIN), umbral/confianza/fallback, degradación AC-4, throttler + caché de vector, arnés de relevancia (AC-2), qa-plan inline (contract + BDD + k6) |

## Estado de la provisión

Corre hoy en **entorno local** (`docker-compose`, Gemini free tier con 15 RPM
repartidos 10/5 entre búsqueda y enriquecimiento — OQ-BE-1). El caché de vector es en
proceso y muere en cada deploy; migra a Redis cuando US-019 aprovisione la infraestructura
de nube.
