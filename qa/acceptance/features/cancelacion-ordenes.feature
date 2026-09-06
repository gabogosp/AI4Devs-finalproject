# language: es
@cancelacion-ordenes
Característica: Cancelación de orden + reembolso + reintegro de stock (US-013)
  Como dueño de DSM
  quiero cancelar una orden pagada no entregada
  para resolver el camino post-venta sin perder stock ni dejar el pago sin resolver

  @happy @critical-path
  Esquema del escenario: H-1 — Cancelar una orden activa reintegra el stock, resuelve el reembolso y deja trazabilidad
    Dado una orden real confirmada por pago manual, en estado "<estado>", con un ítem de 2 unidades
    Y el stock de ese producto antes de cancelar
    Cuando el dueño la cancela
    Entonces la cancelación deja la orden en estado "cancelada"
    Y el stock del producto vuelve a su valor de antes de la orden
    Y el sistema dispara el aviso de cancelación al comprador
    Y el historial registra quién canceló y cuándo
    Y el pago de la orden queda "reembolsado"

    Ejemplos:
      | estado    |
      | new       |
      | preparing |
      | ready     |

  @happy
  Escenario: H-2 — Cancelar una orden pagada con el medio simulado deja el reembolso resuelto sin llamada externa
    Dado una orden real confirmada por el medio simulado "DSM"
    Cuando el dueño la cancela
    Entonces la cancelación deja la orden en estado "cancelada" y el stock se reintegra
    Y el pago queda "reembolsado" sin que el sistema haya llamado a ningún proveedor externo

  @corner @critical-path
  Escenario: C-1 — Repetir la cancelación de una orden ya cancelada no reintegra el stock una segunda vez
    Dado una orden real que el dueño ya canceló
    Cuando el dueño repite exactamente esa misma cancelación
    Entonces la respuesta sigue siendo exitosa
    Y el stock del producto no vuelve a incrementarse
    Y el historial de la orden no gana una segunda entrada de cancelación

  @corner @critical-path
  Escenario: C-2 — Dos cancelaciones simultáneas de la misma orden no reintegran el stock dos veces
    Dado una orden real activa con un ítem de stock conocido
    Cuando se disparan dos cancelaciones simultáneas para esa misma orden
    Entonces exactamente una aplica la transición de estado
    Y el stock del producto queda incrementado una sola vez, nunca el doble

  @negative @critical-path
  Esquema del escenario: N-1 — Cancelar una orden que no puede cancelarse se rechaza sin cambiar nada
    Dado "<condición>"
    Cuando el dueño intenta cancelarla
    Entonces recibo el código <código>
    Y ningún stock del producto involucrado cambia
    Y ningún pago cambia de estado

    Ejemplos:
      | condición                                     | código |
      | una orden real ya entregada                   | 409    |
      | una orden real todavía sin confirmar el pago   | 404    |
      | un id que no corresponde a ninguna orden real  | 404    |

  @negative @critical-path
  Escenario: N-2 — Sin sesión de dueño, ni con sesión de cliente real, se puede cancelar una orden
    Dado un visitante sin ninguna sesión
    Cuando el visitante intenta cancelar una orden real activa
    Entonces el sistema deniega la cancelación
    Cuando una cuenta de cliente real (US-014, sesión válida pero no admin) intenta cancelar esa misma orden
    Entonces el sistema deniega la cancelación igual que al visitante
    Y la orden de cancelación-ordenes permanece sin cambios en los dos casos

  @cross-feature @critical-path
  Escenario: X-1 — El stock reintegrado es exactamente el que decrementó el ciclo real de checkout y confirmación
    Dado un producto con stock conocido antes de cualquier venta
    Y un cliente que completó un checkout real de 3 unidades de ese producto (US-008)
    Y esa orden confirmada por pago manual real (US-023)
    Cuando el dueño cancela esa orden
    Entonces el stock del producto vuelve exactamente al valor previo a la venta

  @cross-feature
  Escenario: X-2 — Una orden recién cancelada por este endpoint deja de contar como venta en el panel de métricas
    Dado una orden real confirmada por pago manual, ya contabilizada en el resumen del panel de métricas (US-016)
    Cuando el dueño la cancela
    Entonces el resumen de métricas para el período que la incluye ya no la cuenta en orders_count
    Y su monto ya no aporta a total_ars_cents

  @cross-feature
  Escenario: X-3 — Una orden recién cancelada por este endpoint sigue consultable por id en el panel de fulfillment, pero desaparece del listado sin filtro
    Dado una orden real activa, visible en el listado sin filtro del panel de órdenes (US-012)
    Cuando el dueño la cancela
    Entonces el detalle de esa orden sigue abriéndose por su id, con el nuevo estado
    Y esa orden ya no aparece en el listado sin filtro del panel
