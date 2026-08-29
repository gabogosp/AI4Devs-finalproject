# Requirements — Búsqueda semántica con IA (CAP-2)

Acumulado de los ACs entregados por los changes archivados de esta capacidad. Fuente: PRD
§2.1 fila 2, `docs/user-stories/US-004-busqueda-semantica.md`.

## Funcionales

- **AC-1 — Candidatos ordenados por relevancia**: la consulta en lenguaje natural devuelve
  candidatos ordenados y cada uno enlaza a su ficha (`/productos/{slug}`). — `US-004 FE`
  (consume el orden que entrega `US-004 BE`, no lo recalcula).
- **AC-3 — Nunca un «0 resultados» desnudo**: cuando `confidence` es `none`, la pantalla
  ofrece los rubros de `fallback.suggested_categories` como salida. — `US-004 FE`
- **AC-4 — Degradado visible, no tratado como falla**: `degraded: true` se muestra con un
  banner («buscamos por texto»); la búsqueda sigue navegable y los resultados, si los hay, se
  presentan igual. — `US-004 FE`
- **AC-5 — Consulta vacía o corta no gasta un request**: se ataja en cliente y en servidor con
  la misma función de normalización (`queryGuard.ts`); se invita a describir la necesidad. —
  `US-004 FE`
- **AC-7 — Sin stock, sin control de compra**: un resultado sin stock aparece marcado con
  texto y el control de agregar al carrito está **ausente**, no deshabilitado. — `US-004 FE`
- **AC-10 — 429 explicado**: un rate-limit se comunica con el tiempo de espera, sin perder lo
  que el cliente escribió. — `US-004 FE`

## No funcionales / negative-space

- **AC-8 — Sin inyección de HTML**: el eco de la consulta se renderiza como texto (React
  escapa por defecto); una consulta con `<img src=x onerror=…>` aparece literal, nunca se
  monta un nodo. — `US-004 FE`
- **`score` nunca se muestra**: el contrato trae un número de similaridad pero la UI no lo
  expone — no comunica nada a quien compra y expondría la mecánica del ranking. — `US-004 FE`
- **Texto de la consulta fuera de la telemetría**: los cuatro eventos de observabilidad
  (`search_performed`, `search_result_clicked`, `search_fallback_clicked`,
  `search_rate_limited`) no llevan el texto ingresado — entrada libre, riesgo de PII
  (`observability-standards` §9). — `US-004 FE`
- **`noindex, follow`**: la página de resultados no se indexa (contenido delgado y duplicado
  que canibalizaría fichas/categorías) pero sus enlaces sí transmiten. — `US-004 FE`
- **A11y**: cantidad de resultados anunciada en `aria-live="polite"`; foco al encabezado de
  resultados tras la navegación (no se queda en el input del header); avisos de degradado/baja
  confianza en texto, no color. — `US-004 FE`

## Explícitamente fuera de alcance de esta capacidad (por ahora)

- **AC-2** (arnés de relevancia ≥70% top-5) — batería de backend/QA (`US-004 BE` / `US-004
  QA`), no observable desde la UI.
- **AC-6** (sólo productos `published` aparecen) y **AC-9** (un producto sin embedding no
  rompe la búsqueda) — invariantes del servidor; el frontend renderiza lo que el contrato le
  da y no puede afirmarlas por su cuenta.
- Dropdown de sugerencias en vivo / autocompletado (`Deferred`, OQ-FE-1 — sin endpoint de
  backend y contradice el rate-limit de cuota).
- Vista full-screen de búsqueda en mobile (`Deferred`, OQ-FE-3).
- Chip «sugerido / match alto» (`Deferred` — sin `score` visible sería la misma información
  sin la métrica; se prefiere que el orden hable).

## No funcionales

- **Caché**: `revalidate: 60` (mismo `max-age` que declara el contrato) sobre el
  `CATALOG_TAG` compartido con el resto del catálogo — una invalidación tras alta/import
  masivo también refresca la búsqueda. Nunca `no-store` (cada tecla llegaría a la cuota del
  proveedor de IA).
