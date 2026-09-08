---
type: user-story
id: US-026
slug: productos-destacados-home
parent-prd: docs/product/prd.md
prd-capacity: null   # no nace del PRD §2.1: hallazgo de la prueba visual del dueño — el home
# hoy es una landing de categorías (US-002 AC-1, por diseño) y el dueño quiere que además
# muestre productos destacados debajo de los rubros (patrón Mercado Libre). Mismo criterio
# `prd-capacity: null` que US-024/US-025 (features nacidas de la prueba visual, no del PRD).
parent-e2e: docs/product/design-e2e.md
status: Done
priority: Medium
estimate-tshirt: M
story_points_traditional: 8
story_points_ai_assisted: 4
estimation_basis: "Disciplina dominante BE: endpoint nuevo de ranking «más vendidos» público (join products + agregado sobre order_items, distinto del reporte admin de US-016 — sin revenue, sólo published/con su in_stock, Cohn 2005 §10, 5 SP) + endpoint de «novedades» (query simple por created_at, reusa StorefrontProductListItemDto, Cohn 2005 §8, 2 SP). FE: 2 secciones nuevas en el home + reuso de ProductCard (Cohn 2005 §8, 4 SP). QA reusa BDD/E2E existentes de storefront como base. Se toma el dominante × 0.45 (Peng 2023) = 3.15 → redondeado a 4 por las 2 fuentes de datos distintas (no es una sola query)."
language: es
created: 2026-09-07
updated: 2026-09-07
ready-at: 2026-09-07
in-progress-at: 2026-09-07   # /plan-frontend-web-ticket US-026 — primera planificación de
# disciplina (openspec/changes/US-026-productos-destacados-home-frontend-web/, plan en dos
# fases: Fase A + Fase B, esta última desbloqueada y cerrada tras PR #146 (backend)).
done-at: null
authored-by: Gabriel Suarez
disciplines: [BE, FE, QA]
linear-issue-id: null
figma-frames: []
---

# US-026: Productos destacados en el home

## 1. La historia (formato Connextra)

**Como** visitante de la tienda,
**quiero** ver una selección de productos destacados en la página de inicio (además de los rubros),
**para** descubrir artículos concretos sin tener que entrar primero a una categoría — como pasa en Mercado Libre.

## 2. Por qué importa (Valuable)

Hoy el home es una landing de categorías (US-002 AC-1, decisión de diseño deliberada): muestra el hero + la grilla de rubros, pensada para SEO/indexación, pero **ningún producto**. El dueño, comparando con Mercado Libre, quiere que el home también sea una vitrina: mostrar productos concretos (novedades + más vendidos) acorta el camino a la compra y da vida comercial a la portada. No reemplaza la landing de categorías — la complementa.

## 3. Criterios de aceptación (Gherkin / Given-When-Then)

**Decisión del dueño (§10): el home muestra AMBOS criterios** — "Novedades" (últimos publicados) y "Más vendidos" (ranking real de ventas), como dos secciones separadas debajo de la grilla de rubros. **8 productos por sección** (default sensato, tamaño típico de una fila de vitrina — no es una decisión de producto que ameritara escalar).

### AC-1: El home muestra "Novedades"
```gherkin
Dado que hay productos publicados
Cuando entro al home
Entonces veo una sección "Novedades" con hasta 8 productos (imagen, nombre, precio)
Y son los últimos publicados por fecha de alta, del más nuevo al más viejo
Y cada uno linkea a su ficha (/productos/{slug})
```

### AC-2: El home muestra "Más vendidos"
```gherkin
Dado que hay al menos una orden confirmada (no `pending_payment`/`cancelled`) con productos publicados
Cuando entro al home
Entonces veo una sección "Más vendidos" con hasta 8 productos
Y están ordenados por cantidad total vendida (de mayor a menor)
Y cada uno linkea a su ficha (/productos/{slug})
```

### AC-3 (edge case): menos de 8 productos disponibles
```gherkin
Dado que sólo hay 3 productos publicados en todo el catálogo
Cuando entro al home
Entonces "Novedades" muestra esos 3, sin espacios vacíos ni placeholders
```

### AC-4 (negative-space): catálogo sin ningún producto publicado
```gherkin
Dado que no hay ningún producto en estado "published"
Cuando entro al home
Entonces ni "Novedades" ni "Más vendidos" se muestran (ninguna sección vacía con su título sin contenido)
Y la landing de categorías (hero + rubros) sigue intacta
```

### AC-5 (negative-space): sin ventas todavía
```gherkin
Dado que no hay ninguna orden confirmada (recién lanzado, o sólo pending_payment/cancelled)
Cuando entro al home
Entonces "Más vendidos" no se muestra
Y "Novedades" se muestra igual si hay productos publicados (son criterios independientes)
```

### AC-6 (negative-space): empate de ventas
```gherkin
Dado que dos productos tienen exactamente la misma cantidad vendida
Cuando se arma "Más vendidos"
Entonces el orden entre ellos es determinista (mismo tie-break por id que el resto del storefront, US-002/US-003) — nunca varía entre pedidos idénticos
```

### AC-7 (negative-space): un producto despublicado no aparece
```gherkin
Dado un producto que fue "published" y tuvo ventas, pero el dueño lo pasó a "draft" o "archived"
Cuando se arma cualquiera de las dos secciones
Entonces ese producto NO aparece, aunque su historial de ventas siga existiendo
```

### AC-8: sin stock, igual visible (consistencia con el resto del storefront)
```gherkin
Dado un producto publicado sin stock que califica para "Novedades" o "Más vendidos"
Cuando aparece en la sección
Entonces se muestra igual que en el listado por categoría (US-002/US-003): marcado sin stock, no oculto — mismo criterio de "nunca ocultar, sólo marcar" que ya rige el resto del catálogo público
```

## 4. Out of scope explícito

- **NO reemplaza la landing de categorías** — la complementa, debajo de la grilla de rubros.
- **NO es un buscador** ni un sistema de recomendación — ambas secciones son agregados globales (todos los visitantes ven lo mismo), sin personalización por usuario/historial.
- **NO es curación manual** — el dueño no elige a mano qué aparece (opción (c) del borrador original, descartada por el dueño en favor de (a)+(b) reales). Si se quiere en el futuro, es una US aparte.
- **NO usa calificación/reseñas** (opción (d) del borrador) — fuera de esta iteración.
- **"Más vendidos" no tiene ventana de tiempo** (no es "más vendidos este mes") — es el ranking histórico completo desde que existe la tienda. Acotarlo a una ventana (ej. últimos 90 días) es una mejora futura, no en esta US — evita la complejidad de un selector de rango que el reporte admin (US-016) sí necesita pero el home no.

## 5. INVEST self-check

| Letra | Criterio | Cumple? | Notas |
|---|---|---|---|
| **I** | Independent | ✅ | Depende de catálogo (US-001/US-002, Done) y checkout confirmado (US-008/US-010, Done) — ninguno bloqueante activo. |
| **N** | Negotiable | ✅ | Los AC fijan el comportamiento; el query SQL exacto y el layout quedan al equipo. |
| **V** | Valuable | ✅ | Capturado en §2 — pedido directo del dueño tras comparar con Mercado Libre. |
| **E** | Estimable | ✅ | T-shirt M, dos fuentes de datos con precedente parcial (reports.repository.ts ya tiene un query de ranking similar, aunque admin-only). |
| **S** | Small | ✅ | Completable en un ciclo corto — 2 endpoints + 2 secciones de FE. |
| **T** | Testable | ✅ | Los 8 AC son verificables sin ambigüedad. |

## 6. Dependencias

- **Bloqueada por**: US-001/US-002 (catálogo + storefront, Done — necesita productos publicados), US-008/US-010 (checkout + confirmación de pago, Done — necesita órdenes en estados post-`pending_payment` para "más vendidos").
- **Bloquea a**: ninguna conocida.

## 7. Tasks asociadas (gruesas, una por disciplina afectada)

| Disciplina | Task id | Estimado (h) | Owner | Estado |
|---|---|---|---|---|
| BE | BE-US-026 | 5h | claude-code | Todo |
| FE | FE-US-026 | 4h | claude-code | Planificado (`openspec/changes/US-026-productos-destacados-home-frontend-web/`, Fase A lista para ejecutar, Fase B Blocked-by BE) |
| QA | QA-US-026 | 2h | claude-code | Todo |

> BE: `GET /v1/products/novedades` (query simple: `status: 'published'`,
> `orderBy: created_at desc`, `take: 8`, reusa `StorefrontProductListItemDto`)
> + `GET /v1/products/mas-vendidos` (agregado nuevo — **no reusar
> directamente** `ReportsRepository.topProducts` de US-016: ese es
> admin-only, expone `revenue_ars_cents` y no filtra por `status`/stock —
> acá hace falta un `JOIN products` que filtre `published` y devuelva el
> shape público, sin revenue, con el mismo tie-break por `id` que el resto
> del storefront para AC-6). **Ambos endpoints van en el mismo controller
> de storefront y CON `@StorefrontCache` explícito por ruta** —
> lección directa de US-025 (PR #139): el interceptor de caché a nivel de
> clase se cuela en rutas nuevas si no se declara el TTL explícito por
> handler, y una sección de "más vendidos"/"novedades" desactualizada por
> horas sería un bug silencioso igual de real. FE: 2 secciones nuevas en
> `app/(storefront)/page.tsx`, reusan el componente de card de producto ya
> existente (mismo que el listado por categoría) — SSR, sin JS extra para
> indexar (mismo criterio que el resto del home, US-002 D-algo). QA vive
> dentro de FE/BE (mismo criterio que US-014/US-017/US-024/US-025 — sin
> change `-qa` propio salvo que se decida E2E cross-stack aparte).

## 8. Diseño

- **Tiene Figma**: no.
- Hereda de `docs/product/design-system.md` — reusa el componente de card
  de producto del listado por categoría (imagen, nombre, precio, badge de
  sin-stock) sin inventar uno nuevo. Layout: dos filas/carruseles
  horizontales bajo la grilla de rubros, cada una con su título ("Novedades"
  / "Más vendidos") — orden de arriba a abajo a definir por el equipo de FE
  (sugerido: Novedades primero, Más vendidos después, sin que sea una
  decisión de producto crítica).

## 9. NFRs específicos de esta US

- **Caché acotada, explícita por ruta** (no heredada de la clase): mismo
  mecanismo que el resto del storefront (`StorefrontCacheInterceptor`,
  `maxAge`/`swr` per-handler) — el home es la página de mayor tráfico del
  sitio, así que SÍ debe cachear (a diferencia de reseñas, que
  deliberadamente NO cachea tras el hallazgo de US-025). Default sugerido:
  `maxAge: 60, swr: 30` (igual que el resto de `/v1/products/*`) — "más
  vendidos"/"novedades" no necesitan frescura al segundo, sólo no heredar
  por accidente el TTL de otra ruta ni quedar sin declarar.
- Sin NFR de volumetría distinto al baseline: ambos queries son agregados
  acotados (`LIMIT 8`) sobre tablas ya indexadas (`products.status`,
  `products.created_at`, `order_items.product_id`).

## 10. Notas / contexto adicional

**Decisión de producto tomada por el dueño (2026-09-07, vía la coordinadora):
opciones (a) Novedades + (b) Más vendidos, ambas** — no una sola. Se
descartaron (c) curación manual y (d) mejor calificados para esta
iteración (quedan como posible CR futuro).

Decisiones chicas resueltas acá con default sensato, sin escalar (per
criterio explícito del pedido): 8 productos por sección; "más vendidos" sin
ventana de tiempo (histórico completo); orden Novedades→Más vendidos en la
página.

**Contexto**: hallazgo de la prueba visual (2026-09-07). El dueño confirmó
que el home-sin-productos es por diseño (US-002) pero pidió esta US para
agregar destacados "para acortar el camino a la compra, como Mercado
Libre".

## Definition of Ready (gate Triage → Ready)

- [x] §1 Historia escrita en formato Connextra
- [x] §2 Por qué importa explicado
- [x] §3 8 AC en Gherkin (2 happy + 1 edge + 5 negative-space)
- [x] §4 Out of scope definido
- [x] §5 INVEST con todas las letras OK
- [x] §6 Dependencias chequeadas (US-001/002/008/010 Done, sin bloqueantes)
- [x] §7 Tasks por disciplina identificadas con estimado en horas
- [x] §8 Diseño resuelto (design-system + componente existente reusado)
- [x] §9 NFRs definidos (caché explícita por ruta — lección de US-025)
- [x] §10 Decisión de "qué es destacado" tomada por el dueño: (a)+(b)
- [x] Story points estimados

## Definition of Done (gate QA → Done)

- [ ] Todas las tasks de la US en estado Done
- [ ] Regression suite del producto verde en staging
- [ ] AC manuales verificados por QA
- [ ] PO firma acceptance
