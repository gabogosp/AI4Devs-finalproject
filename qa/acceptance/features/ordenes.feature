# language: es
@ordenes
Característica: Panel de órdenes del dueño (US-012)
  Como dueño de DSM
  quiero ver y avanzar el estado de las órdenes pagadas
  para gestionar la preparación y el retiro de cada pedido

  @happy @critical-path
  Escenario: H-1 — El listado muestra las órdenes pagadas, paginado y ordenable
    Dado tres órdenes reales de distintos clientes, en distintos estados activos
    Cuando el dueño abre el listado de órdenes sin filtro
    Entonces ve cada orden con cliente, total en ARS, estado y fecha de creación
    Y la lista respeta el límite y el desplazamiento que pidió
    Y ordenar por fecha, por número de orden o por total cambia el orden de la página

  @happy @critical-path
  Escenario: H-2 — El detalle muestra los ítems, el contacto del comprador y el retiro
    Dado una orden real con dos ítems de distinto producto
    Cuando el dueño abre esa orden desde el listado
    Entonces ve cada ítem con su cantidad y su precio
    Y ve el nombre, el email y el teléfono del comprador
    Y ve que el retiro es en sucursal

  @happy @critical-path
  Escenario: H-3 — Avanzar la orden completa deja un historial consultable
    Dado una orden real en estado "new"
    Cuando el dueño la avanza a "preparing", luego a "ready" y luego a "delivered"
    Entonces cada transición queda registrada con su estado anterior, el nuevo y una marca temporal
    Y el detalle de la orden expone esas tres transiciones en orden cronológico
    Y la orden entregada queda con su fecha de entrega poblada

  @happy @critical-path
  Escenario: H-4 — Marcar "lista para retirar" dispara el aviso al cliente
    Dado una orden real en estado "preparing"
    Cuando el dueño la marca como "lista para retirar"
    Entonces la transición se confirma
    Y el sistema dispara el aviso de que el pedido está listo para ese comprador
    # El envío en sí (US-011) es un seam sin proveedor real todavía; acá se verifica que
    # el disparo ocurre exactamente una vez por esta transición, no el envío.

  @happy
  Escenario: H-5 — Filtrar por estado muestra solo las órdenes de ese estado
    Dado órdenes reales en los cuatro estados activos de fulfillment
    Cuando el dueño filtra el listado por "preparando"
    Entonces ve únicamente las órdenes en ese estado
    Y ninguna orden de otro estado activo aparece en la página

  @corner
  Escenario: C-1 — El detalle de una orden cancelada sigue siendo consultable por id
    Dado una orden real que fue cancelada
    Cuando el dueño abre esa orden por su id
    Entonces ve su detalle igual, sin que el sistema la trate como inexistente
    Y esa orden no aparece en el listado sin filtro

  @corner
  Escenario: C-2 — Repetir la misma transición no duplica el historial ni el aviso
    Dado una orden real que el dueño ya marcó como "ready"
    Cuando el dueño repite exactamente esa misma transición
    Entonces la respuesta sigue siendo exitosa
    Y el historial de la orden no gana una segunda entrada
    Y el aviso de "lista para retirar" no se dispara una segunda vez

  @negative @critical-path
  Escenario: N-1 — Saltar un paso de la FSM se rechaza y el estado no cambia
    Dado una orden real en estado "new"
    Cuando el dueño intenta marcarla directamente como "delivered"
    Entonces el sistema rechaza la transición
    Y la orden sigue en estado "new"
    Y el historial de la orden no gana ninguna entrada nueva

  @negative @critical-path
  Escenario: N-2 — Sin sesión de dueño, el panel deniega el acceso
    Dado un visitante que no inició ninguna sesión
    Cuando intenta abrir el panel de órdenes o cambiar el estado de una orden real
    Entonces el sistema deniega la solicitud

  @negative @critical-path
  Escenario: N-3 — Las órdenes pendientes de pago no se gestionan desde este panel
    Dado una orden real recién generada por checkout, todavía sin confirmar el pago
    Cuando el dueño abre el listado de órdenes sin filtro
    Entonces esa orden no aparece
    Cuando el dueño intenta abrir esa orden por su id
    Entonces el sistema responde que no existe
    Cuando el dueño intenta avanzar su estado
    Entonces el sistema también responde que no existe

  @cross-feature @critical-path
  Escenario: X-1 — La orden que ve el dueño es la que el cliente realmente compró
    Dado un cliente que completó un checkout real con dos productos y sus cantidades
    Cuando el dueño abre esa orden en el panel
    Entonces ve los mismos productos con las mismas cantidades y los mismos precios que el cliente pagó
    Y ve el mismo nombre, email y teléfono que el cliente cargó en el checkout
    # Cruza US-008 (checkout guest) con US-012. El backend de este panel no arma fixtures
    # propias para esto: lee la orden real que otro módulo escribió.

  @cross-feature @critical-path
  Escenario: X-2 — Una cuenta de cliente real no es una cuenta de dueño
    Dado una cuenta de cliente registrada y logueada por el flujo real de US-014
    Cuando esa cuenta intenta abrir el panel de órdenes
    Entonces el sistema la deniega igual que a un visitante sin sesión
    # Cruza US-014 (cuentas de cliente) con US-012. La negación no depende de la ausencia
    # de sesión sino del rol: una sesión válida de otro tipo no alcanza.

  @cross-feature
  Escenario: X-3 — Cada transición queda visible en las métricas del panel de observabilidad
    Dado una orden real en estado "new"
    Cuando el dueño la avanza a "preparing"
    Y el dueño intenta después saltarla directo a "delivered"
    Entonces el contador de transiciones aplicadas subió en uno
    Y el contador de transiciones rechazadas también subió en uno
    # Cruza el módulo de órdenes con /v1/admin/metrics (AUDIT-dsm-api-006), una superficie
    # que otro change ya construyó y que ningún test de un solo módulo ejercita junta.
