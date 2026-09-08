---
tracker-id: null
tracker-source: null
parent-us: US-026
discipline: backend
variant: null
language: es
archived: true
archived_at: 2026-09-07
merged_commit: d069a03c4b5ac1dc73ff1673db3251a948f916c8
pr-url: https://github.com/gabogosp/AI4Devs-finalproject/pull/146
---

# US-026 Backend — Productos destacados en el home

## Why

El home hoy es una landing pura de categorías (US-002 AC-1, decisión
deliberada) — no muestra ningún producto concreto. El dueño, comparando con
Mercado Libre, pidió dos secciones adicionales debajo de la grilla de rubros:
"Novedades" (últimos publicados) y "Más vendidos" (ranking real de ventas).
Ninguna de las dos existe hoy como endpoint público — `ReportsRepository.
topProducts` (US-016) es admin-only, expone `revenue_ars_cents` y no filtra
por `status`/stock, así que no sirve tal cual para una superficie pública.

## What changes

- **`GET /v1/products/novedades`** — hasta 8 productos `published`, orden
  `created_at desc` (tie-break `id asc`, AC-1). Reusa
  `ProductsRepository`/`StorefrontProductListItemDto` sin tocar nada
  existente.
- **`GET /v1/products/mas-vendidos`** — hasta 8 productos, ranking por
  cantidad total vendida (`SUM(order_items.quantity)`) sobre órdenes
  confirmadas (`new|preparing|ready|delivered`, excluye
  `pending_payment`/`cancelled`), filtrado a productos `published` (AC-2,
  AC-5, AC-7), tie-break `id asc` (AC-6). Query NUEVO y público-safe — NO
  reusa `ReportsRepository.topProducts`: nunca expone `revenue_ars_cents`
  ni columnas admin, sólo el shape de `StorefrontProductListItemDto`.
- **`@StorefrontCache({maxAge:60, swr:30})` explícito en AMBAS rutas** —
  lección directa de US-025/PR #139: el interceptor de caché de clase se
  cuela en cualquier ruta nueva del controller si no se declara el TTL por
  handler; acá el default SÍ es el correcto (mismo TTL que el resto de
  `/v1/products/*`), pero declararlo explícito evita que quede "sin pensar"
  — el NFR §9 de la US lo pide por nombre.
- **Orden de registro de rutas**: `novedades`/`mas-vendidos` se declaran
  ANTES de `:slug` en `StorefrontProductsController` — dos rutas estáticas
  de un solo segmento conviviendo con un `:slug` de un solo segmento
  colisionan si el dinámico se registra primero (Express/Nest matchean por
  orden de registro entre rutas de igual especificidad, no por
  especificidad automática).

## Scope — ACs cubiertos

| AC | Cubierto por |
|---|---|
| AC-1 (home muestra Novedades) | `GET /products/novedades`, orden `created_at desc` |
| AC-2 (home muestra Más vendidos) | `GET /products/mas-vendidos`, orden por cantidad vendida desc |
| AC-3 (menos de 8 disponibles) | Ambos queries usan `LIMIT 8`, nunca rellenan con placeholders — un `take: 8` que encuentra 3 devuelve 3 |
| AC-4 (catálogo sin publicados) | Ambos queries filtran `status='published'` — sin filas, `data: []` |
| AC-5 (sin ventas todavía) | `mas-vendidos` con `data: []` si no hay órdenes confirmadas; `novedades` es independiente, no se ve afectado |
| AC-6 (empate de ventas, tie-break determinista) | `ORDER BY quantity_sold DESC, product_id ASC` — mismo criterio que `findPublishedByCategoryIds` |
| AC-7 (despublicado no aparece) | `status='published'` filtra SIEMPRE, sin importar el historial de ventas |
| AC-8 (sin stock, igual visible) | `StorefrontProductListItemDto.from()` ya marca `in_stock: stock > 0` sin ocultar — reusado tal cual, sin cambios |

## Standards consultados

- `api-standards.md` — `/v1`, respuesta `{data: [...]}` sin pagination
  object (no aplica: top-N fijo, no hay página siguiente).
- `data-standards.md` — sin migración; queries de sólo lectura sobre
  tablas existentes.
- `security-standards.md` — superficie pública sin auth, mismo perfil que
  el resto de `/v1/products/*`.

## Open questions

Ninguna — la decisión de producto ("qué es destacado" = novedades + más
vendidos, 8 por sección, sin ventana de tiempo) ya está cerrada por el
dueño en la US §10.
