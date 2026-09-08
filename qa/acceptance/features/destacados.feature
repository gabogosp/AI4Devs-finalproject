# language: es
@destacados @us-026
Característica: Productos destacados en el home (US-026)
  Como visitante de la tienda
  quiero ver una selección de productos destacados en el home
  para descubrir artículos concretos sin entrar primero a una categoría

  # Nota de orden (D-QA1/D-QA4, ver qa-plan.md): ambos endpoints son
  # agregados GLOBALES sin scoping (no hay filtro por categoría) — los
  # escenarios que necesitan un conteo EXACTO del catálogo entero (AC-4,
  # AC-5, AC-3) van PRIMERO, en orden narrativo sobre el mismo Postgres
  # aislado de esta corrida (catálogo vacío → con productos sin ventas →
  # con exactamente 3). Del resto en adelante (AC-1/2/6/7/8) alcanza con
  # verificar existencia/orden relativo, no un total exacto — son robustos
  # a lo que ya se acumuló en las etapas anteriores.

  @negative @critical-path
  Escenario: SC-026-N1 — Catálogo sin ningún producto publicado (AC-4)
    Dado que no hay ningún producto en estado "published" todavía
    Cuando consulto novedades y más vendidos
    Entonces ambas responden una lista vacía, sin error

  @negative
  Escenario: SC-026-N2 — Sin ventas confirmadas todavía (AC-5)
    Dado un producto publicado sin ninguna venta confirmada
    Cuando consulto novedades y más vendidos
    Entonces novedades lo incluye
    Y más vendidos sigue vacío

  @edge
  Escenario: SC-026-E1 — Exactamente 3 productos publicados en el catálogo (AC-3)
    Dado que el catálogo llega a exactamente 3 productos publicados en total
    Cuando consulto novedades
    Entonces recibo exactamente esos 3, sin relleno ni error

  @happy @critical-path
  Escenario: SC-026-H1 — Novedades muestra los últimos publicados primero (AC-1)
    Dado 3 productos publicados en orden de alta: A (más viejo), B, C (más nuevo)
    Cuando consulto novedades
    Entonces C aparece antes que B, y B antes que A

  @negative
  Escenario: SC-026-N5 — Sin stock, visible pero marcado (AC-8)
    Dado un producto publicado sin stock recién creado
    Cuando aparece en novedades
    Entonces se lo ve marcado sin stock, no oculto

  @happy @critical-path
  Escenario: SC-026-H2 — Más vendidos ordena por cantidad vendida (AC-2)
    Dado el producto X vendido 5 unidades y el producto Y vendido 2 unidades en una orden confirmada
    Cuando consulto más vendidos
    Entonces X aparece antes que Y

  @negative @critical-path
  Escenario: SC-026-N4 — Producto despublicado no aparece pese a su historial (AC-7)
    Dado un producto que fue "published", tuvo una venta confirmada, y luego pasó a "archived"
    Cuando consulto más vendidos
    Entonces ese producto NO aparece

  @negative @critical-path
  Escenario: SC-026-N3 — Empate de ventas es determinista (AC-6)
    Dado dos productos con exactamente la misma cantidad vendida en una orden confirmada
    Cuando consulto más vendidos dos veces seguidas
    Entonces el orden entre ellos es idéntico en ambas respuestas

  @contract @critical-path
  Escenario: QA-026-CT-1 — El shape público nunca expone id/status/revenue (D-QA2)
    Cuando consulto novedades y más vendidos
    Entonces ningún item de ninguna de las dos respuestas tiene los campos "id", "status" ni "revenue_ars_cents"

  @contract @critical-path
  Escenario: QA-026-CT-2 — Cache-Control declarado explícitamente por ruta (D-QA3)
    Cuando consulto novedades y más vendidos
    Entonces ambas respuestas traen el header Cache-Control "public, max-age=60, stale-while-revalidate=30"
