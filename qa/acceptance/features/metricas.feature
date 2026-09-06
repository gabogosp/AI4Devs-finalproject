# language: es
@metricas
Característica: Panel de métricas del dueño (US-016)
  Como dueño de DSM
  quiero ver la evolución de ventas, el ranking de productos y el resumen del período
  para tomar decisiones de negocio con datos que reflejen exactamente lo que pasó

  @happy @critical-path
  Escenario: H-1 — El panel muestra la evolución de ventas, el ranking y el resumen del período por defecto
    Dado un catálogo con dos productos publicados
    Y tres órdenes reales confirmadas por pago, en distintos días del último mes
    Cuando el dueño consulta las tres métricas sin especificar rango
    Entonces la evolución de ventas incluye una fila por cada día con al menos una orden
    Y el ranking de productos muestra cada producto con la cantidad realmente vendida
    Y el resumen muestra la cantidad de órdenes, el monto facturado y el desglose por estado
    Y los tres coinciden entre sí en la cantidad total de órdenes del período

  @happy
  Escenario: H-2 — Cambiar el rango recalcula las tres métricas
    Dado una orden real confirmada por pago hace 40 días
    Y ninguna orden real en los últimos 7 días
    Cuando el dueño consulta las métricas con el rango por defecto (30 días)
    Entonces esa orden no aparece en ninguna de las tres
    Cuando el dueño consulta las métricas con un rango que sí cubre esos 40 días
    Entonces esa orden aparece en las tres

  @happy
  Escenario: H-3 — Descargar el CSV de cada métrica trae los mismos datos que el JSON
    Dado una orden real confirmada por pago dentro del período consultado
    Cuando el dueño pide el JSON y el CSV de cada una de las tres métricas para el mismo rango
    Entonces el CSV de ventas, el de productos y el de resumen contienen los mismos valores que sus respuestas JSON hermanas
    Y los tres archivos tienen el Content-Type text/csv y un Content-Disposition de tipo attachment

  @corner
  Escenario: C-1 — Un período sin ventas muestra ceros y arrays vacíos, nunca un error
    Dado un rango de fechas futuro, sin ninguna orden
    Cuando el dueño consulta las tres métricas para ese rango
    Entonces la evolución de ventas es un array vacío
    Y el ranking de productos es un array vacío
    Y el resumen tiene orders_count y total_ars_cents en cero
    Y el desglose por estado tiene las 4 claves activas, cada una en cero
    Y ninguna de las tres respuestas es un error

  @corner
  Escenario: C-2 — Un rango que excede la retención se acota al piso vigente, no se rechaza
    Dado la política de retención vigente de 12 meses
    Y una orden real confirmada por pago dentro de la ventana de retención
    Cuando el dueño pide un rango que empieza 24 meses atrás
    Entonces la respuesta es 200, nunca 422
    Y el rango efectivo devuelto (range.from) es el piso de retención, no lo pedido
    Y la orden dentro de la ventana aparece en los tres datasets

  @corner
  Escenario: C-3 — Exportar un período sin datos entrega un CSV válido, no un archivo roto
    Dado un rango de fechas futuro, sin ninguna orden
    Cuando el dueño descarga el CSV de cada una de las tres métricas para ese rango
    Entonces los tres archivos son CSV válidos con al menos la fila de encabezado
    Y ninguno de los tres es un archivo vacío ni una respuesta de error

  @negative @critical-path
  Escenario: N-1 — Sin sesión de dueño, el panel de métricas deniega el acceso
    Dado un visitante sin ninguna sesión
    Cuando intenta consultar cualquiera de los 6 endpoints de reportes
    Entonces el sistema deniega la solicitud de métricas
    Cuando una cuenta de cliente real (US-014, sesión válida pero no admin) lo intenta
    Entonces el sistema la deniega igual que al visitante sin sesión

  @negative @critical-path
  Escenario: N-2 — Una orden pendiente de pago no se contabiliza como venta
    Dado una orden real recién generada por checkout, todavía sin confirmar el pago (métricas)
    Cuando el dueño consulta las tres métricas para el período que la incluiría
    Entonces esa orden no está contada en orders_count
    Y no aporta a total_ars_cents
    Y sus productos no aparecen en el ranking

  @negative @critical-path
  Escenario: N-3 — Una orden cancelada por falta de stock (pago reembolsado) no se contabiliza como venta
    Dado una orden real cuyo pago automático se aprobó pero el stock ya no alcanzaba al confirmar
    Y esa orden quedó "cancelled" con el pago en estado de reembolso
    Cuando el dueño consulta las tres métricas para el período que la incluiría
    Entonces esa orden no está contada en orders_count
    Y no aporta a total_ars_cents
    Y no aparece en el desglose por estado

  @cross-feature @critical-path
  Escenario: X-1 — El panel refleja el ciclo de vida real de un lote de órdenes, no una siembra a mano
    Dado seis órdenes nacidas de un checkout real, cada una llevada por su camino real hasta A pending_payment, B new, C preparing, D ready, E delivered y F cancelled por falta de stock
    Cuando el dueño consulta el resumen del período que las incluye a las seis
    Entonces orders_count es 4, no 6
    Y el desglose por estado tiene exactamente una orden en cada uno de new, preparing, ready, delivered
    Y total_ars_cents es la suma exacta de los montos de B, C, D y E — nunca A ni F
    Cuando el dueño consulta la evolución de ventas para ese mismo período
    Entonces la suma de orders_count de todas las filas es 4
    Cuando el dueño consulta el ranking de productos para ese mismo período
    Entonces la cantidad vendida de cada producto sólo cuenta las líneas de B, C, D y E

  @cross-feature
  Escenario: X-2 — El nombre del ranking es el snapshot que el cliente compró, no el catálogo actual
    Dado un producto renombrado en el catálogo después de que un cliente lo compró vía checkout real
    Cuando el dueño consulta el ranking de productos del período de esa compra
    Entonces el ranking muestra el nombre tal como estaba al momento de la compra
    Y no el nombre actual del producto en el catálogo
