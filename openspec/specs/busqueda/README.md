# Capacidad: Búsqueda semántica con IA (CAP-2)

**Estado**: entregada — `SearchExperience` (UI del storefront) y el contrato backend
(`GET /v1/search`, con degradación a full-text) vivos y en producción. Los dos changes de
US-004 (`-frontend-web` y `-backend`) quedaron archivados; el contrato del backend vive en
`contracts/openapi.yaml` de este directorio.

Estado declarado del sistema para la capacidad CAP-2 del PRD §2.1 (fila 2, prioridad *Must* —
**el diferenciador** del producto). Este directorio es el **acumulado** de los changes
archivados: se extiende en cada `/archive-change`, nunca se reescribe.

## Qué está vivo hoy

La pantalla `/buscar?q={consulta}` del storefront (US-004 FE), Server Component que lee
`searchParams` — cada búsqueda es una navegación, sin estado global:

- `SearchBar` montado en el layout público, con guard de consulta útil (≥2 caracteres) en
  cliente y en servidor (AC-5) — la búsqueda costosa no se ejecuta si no hay señal.
- Cuatro estados de presentación derivados del contrato (`confidence` + `degraded` +
  `fallback`), nunca cuatro banderas sueltas: `conSenal`, `conReserva`, `sinSenal` (con salida
  a rubros, AC-3), `degradado` (ortogonal a los anteriores, AC-4).
- `SearchResultCard` propio (no reusa `ProductCard`, que exige `currency` — un campo que
  `SearchResult` no trae) — enlaza cada candidato a su ficha (AC-1) y oculta el control de
  compra si no hay stock (AC-7).
- Caché `revalidate: 60` sobre el `CATALOG_TAG` existente: una invalidación del catálogo
  también refresca la búsqueda.
- Eco de la consulta como texto, nunca interpolado como HTML (AC-8).
- `429` explicado con el tiempo de espera, sin perder lo que el cliente escribió (AC-10).
- Cuatro eventos de observabilidad (`search_performed`, `search_result_clicked`,
  `search_fallback_clicked`, `search_rate_limited`) — **sin el texto de la consulta en
  ninguno** (PII, `observability-standards` §9).
- A11y: `role="search"`, cantidad de resultados en región `aria-live="polite"`, foco al
  encabezado de resultados tras la navegación, avisos en texto (no color).

## Qué NO está vivo todavía

- **El contrato OpenSpec vivo** (`specs/busqueda/contracts/openapi.yaml` + `openapi/paths/`)
  — pendiente de `/archive-change US-004-busqueda-semantica-backend`; ese change (`status:
  completed`, ya mergeado a producción) declara el Spec delta que lo crea. Hasta entonces el
  contrato real vive publicado en `apps/api/docs/api/openapi.yaml` y es lo que consume el
  cliente generado (orval) que usa esta capacidad.
- **AC-2** (arnés de relevancia ≥70% top-5) — batería de backend/QA, no de UI.
- **AC-6 / AC-9** (sólo publicados aparecen; un producto sin embedding no rompe nada) —
  invariantes del servidor; el frontend renderiza lo que el contrato le da y no puede
  afirmarlas por su cuenta.
- **Autocompletado / dropdown de sugerencias en vivo** — descartado (OQ-FE-1): el backend no
  tiene endpoint de autocompletado y contradice el rate-limit que protege la cuota del
  proveedor de embeddings.
- **Vista full-screen de búsqueda en mobile** — descartada (OQ-FE-3): el submit ya navega a
  una página propia.

## Contratos

Ninguno todavía en `contracts/` — ver nota arriba. El endpoint que esta capacidad consume es
`GET /v1/search` (`apps/api/src/search/`), publicado en `apps/api/docs/api/openapi.yaml`.
Cuando se archive `US-004-busqueda-semantica-backend`, ese change crea la raíz viva
`contracts/openapi.yaml` + `contracts/openapi/paths/search.yaml` a partir de ese contrato
publicado — no un fragmento nuevo.

## Changes que formaron esta capacidad

| Change | Disciplina | Aporte |
|---|---|---|
| [`US-004-busqueda-semantica-frontend-web`](../../changes/archive/US-004-busqueda-semantica-frontend-web/) | FE | `SearchExperience`: ruta `/buscar`, cuatro estados, tarjeta de resultado propia, guard de consulta, telemetría sin PII, a11y |

Pendientes de archivar sobre esta misma capacidad: `US-004-busqueda-semantica-backend`
(`GET /v1/search`, completed) y `US-004-busqueda-semantica-qa` (suite QA cross-stack, PR #10
abierto).

## Estado de la provisión

Corre hoy en **entorno local** (`docker-compose`, Postgres+pgvector). La provisión de nube es
US-019, igual que el resto del sistema.
