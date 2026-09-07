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
status: Backlog
priority: Medium
estimate-tshirt: null   # a definir en el enrich
story_points_traditional: null
story_points_ai_assisted: null
estimation_basis: "Pendiente — se estima al enriquecer a Ready."
language: es
created: 2026-09-07
updated: 2026-09-07
ready-at: null
in-progress-at: null
done-at: null
authored-by: Gabriel Suarez
disciplines: [FE]   # tentativo — el enrich confirma si hace falta BE (endpoint/criterio de "destacado")
linear-issue-id: null
figma-frames: []
---

# US-026: Productos destacados en el home

> **Estado: Backlog (skeleton).** Creada a partir de la prueba visual del dueño para
> enriquecer/refinar más adelante. Las secciones marcadas `[Pendiente de enriquecer]` se
> completan en `/enrich-user-story US-026` (gate Triage → Ready), donde también se resuelven
> las decisiones de producto (ver §10).

## 1. La historia (formato Connextra)

**Como** visitante de la tienda,
**quiero** ver una selección de productos destacados en la página de inicio (además de los rubros),
**para** descubrir artículos concretos sin tener que entrar primero a una categoría — como pasa en Mercado Libre.

## 2. Por qué importa (Valuable)

Hoy el home es una landing de categorías (US-002 AC-1, decisión de diseño deliberada): muestra el hero + la grilla de rubros, pensada para SEO/indexación, pero **ningún producto**. El dueño, comparando con Mercado Libre, quiere que el home también sea una vitrina: mostrar productos concretos (destacados/novedades/más vendidos) acorta el camino a la compra y da vida comercial a la portada. No reemplaza la landing de categorías — la complementa.

## 3. Criterios de aceptación (Gherkin / Given-When-Then)

`[Pendiente de enriquecer]` — borrador tentativo para orientar el enrich:

### AC-1 (borrador): el home muestra una sección de productos destacados
```gherkin
Dado que hay productos publicados con stock
Cuando entro al home
Entonces veo una sección "Destacados" con N productos (imagen, nombre, precio)
Y cada uno linkea a su ficha (/productos/{slug})
```

### AC-2 (borrador): sin productos destacados
```gherkin
Dado que no hay productos que califiquen como destacados
Cuando entro al home
Entonces la sección de destacados no se muestra (o muestra un fallback) — a definir en el enrich
Y la landing de categorías sigue intacta
```

> Faltan: cómo se define "destacado" (ver §10), paginación/tope, orden, comportamiento con productos sin stock, negative-space, a11y. Todo se resuelve en el enrich.

## 4. Out of scope explícito

`[Pendiente de enriquecer]`. Tentativo: NO reemplaza la landing de categorías; NO es un buscador; NO es personalización por usuario (sin recomendación individual en esta US).

## 5. INVEST self-check

`[Pendiente de enriquecer]`

## 6. Dependencias

`[Pendiente de enriquecer]`. Probable: US-002 (storefront/home, Done), catálogo con productos publicados (seed/US-001, Done). Reusa `StorefrontProduct` y el patrón de listado por categoría que ya existe.

## 7. Tasks asociadas (gruesas, una por disciplina afectada)

`[Pendiente de enriquecer]`. Depende de la decisión de §10: si "destacado" reusa un query existente (ej. novedades por `created_at`) puede ser **FE-only**; si requiere un flag/criterio nuevo o un endpoint dedicado, suma **BE**.

## 8. Diseño

`[Pendiente de enriquecer]`. Reusar el design-system y el componente de card de producto ya existente (mismo que el listado por categoría).

## 9. NFRs específicos de esta US

`[Pendiente de enriquecer]`. A considerar: el home es página de alto tráfico/SEO → la sección de destacados no debe degradar el TTFB ni el SSR (posible caché, como el resto del storefront).

## 10. Notas / contexto adicional

**Decisión de producto clave a resolver en el enrich (con el dueño): ¿qué es un "producto destacado"?** Opciones:
- **(a) Novedades** — los últimos N publicados por `created_at` (FE-only, reusa listado existente, cero backend).
- **(b) Más vendidos** — top N por cantidad de órdenes (requiere query/agregado BE sobre order_items).
- **(c) Curados manualmente** — un flag `featured` en producto que el dueño marca desde el admin (requiere migración + UI admin + endpoint).
- **(d) Mejor calificados** — top N por rating promedio (reusa US-025 reseñas).

Cada opción cambia el alcance (FE-only vs BE+FE+admin). El dueño elige en el enrich. Recomendación inicial para un MVP rápido: **(a) novedades**, y dejar (c) curado manual como iteración posterior si lo quiere.

**Contexto**: hallazgo de la prueba visual (2026-09-07). El dueño confirmó que el home-sin-productos es por diseño pero pidió armar esta US para agregar destacados "para luego refinarla o enriquecerla".

## Definition of Ready (gate Triage → Ready)

- [ ] §1 Historia escrita en formato Connextra
- [ ] §2 Por qué importa explicado
- [ ] §3 AC en Gherkin (happy + negative-space) — pendiente de completar
- [ ] §4 Out of scope definido
- [ ] §5 INVEST con todas las letras OK
- [ ] §6 Dependencias chequeadas
- [ ] §7 Tasks por disciplina identificadas con estimado
- [ ] §8 Diseño resuelto
- [ ] §9 NFRs definidos
- [ ] §10 Decisión de "qué es destacado" tomada por el dueño (a/b/c/d)
- [ ] Story points estimados
