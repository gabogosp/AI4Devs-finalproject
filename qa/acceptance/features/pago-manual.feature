# language: es
#
# QA-023-ACC-1 (qa-plan.md §4) — 8 escenarios ejecutables hoy contra la API
# real + Postgres real, sin mockear la transacción de pagos/stock. SC-023-X1
# (cross-feature, Layer 3, bloqueado por PendingPaymentsPanel sin construir —
# qa-plan.md §7) NO vive acá: es `QA-023-E2E-1`, `execution_mode: manual`,
# `status: blocked` — se deja fuera de este archivo a propósito.
@pagos @us-023
Característica: Pago manual / offline — confirmación del dueño (US-023)
  Como dueño de DSM
  quiero confirmar el pago de una orden pagada por transferencia o efectivo coordinado por WhatsApp
  para completar la venta y descontar el stock sin depender de una pasarela de pago online

  Antecedentes:
    Dado un catálogo sembrado con productos disponibles
    Y un comprador que completó el checkout dejando una orden real en estado "pending_payment"

  # ─── HAPPY PATH ───

  @happy @critical-path
  Escenario: SC-023-H1 — El dueño confirma el pago y la orden pasa a "new" (AC-1)
    Cuando el dueño autenticado confirma el pago de esa orden
    Entonces recibe 200 con la orden en estado "new"
    Y el stock de cada producto de la orden queda decrementado exactamente en la cantidad pedida
    Y queda registrado un pago por un medio manual/offline para esa orden

  @happy
  Escenario: SC-023-H2 — El listado de pendientes de pago expone lo necesario para confirmar (AC-2, mitad API)
    Dado que existen dos órdenes en estado "pending_payment", la segunda creada después de la primera
    Cuando se consulta el listado de órdenes pendientes de confirmar pago
    Entonces la respuesta incluye ambas órdenes, la más nueva primero
    Y cada fila trae el identificador interno de la orden, su número, el nombre del comprador, el total y la fecha de creación
    Y ninguna fila incluye el email ni el teléfono del comprador

  # ─── ALTERNATIVE PATH ───

  @alternative @critical-path
  Esquema del escenario: SC-023-A1 — Sin sesión de dueño, la acción se rechaza (AC-3)
    Cuando "<quién>" intenta confirmar el pago de esa orden
    Entonces recibe <código>
    Y la orden permanece en "pending_payment"

    Ejemplos:
      | quién                       | código |
      | nadie (sin token)           | 401    |
      | alguien con sesión no-admin | 403    |

  @alternative
  Esquema del escenario: SC-023-A2 — No se puede confirmar una orden que no está pendiente de pago (AC-4)
    Dado que la orden ya está en estado "<estado>"
    Cuando el dueño intenta confirmar su pago
    Entonces recibe 409 con un mensaje claro sobre el estado actual de la orden
    Y el estado de la orden no cambia

    Ejemplos:
      | estado    |
      | new       |
      | cancelled |

  # ─── NEGATIVE SPACE ───

  @negative @critical-path
  Escenario: SC-023-N1 — Repetir la confirmación no duplica efectos (AC-5, doble click / reintento)
    Dado que el dueño ya confirmó el pago de esa orden
    Cuando el dueño repite la acción de confirmar
    Entonces recibe 409 con un mensaje claro sobre el estado actual de la orden
    Y el stock no se decrementa una segunda vez
    Y sigue existiendo exactamente un pago registrado para esa orden

  @negative @critical-path
  Escenario: SC-023-N2 — Dos confirmaciones simultáneas nunca duplican el pago (AC-5, concurrencia real)
    Cuando el dueño dispara dos confirmaciones simultáneas sobre la misma orden
    Entonces exactamente una responde con éxito y la otra con el rechazo por estado
    Y queda exactamente un pago registrado para esa orden
    Y el stock quedó decrementado una sola vez

  @negative
  Escenario: SC-023-N3 — El registro de quién y cuándo confirmó queda disponible para auditoría (AC-6)
    Dado que un dueño con identidad conocida confirma el pago de esa orden
    Cuando se consulta el registro de auditoría de ese pago
    Entonces el registro identifica a quién confirmó
    Y el registro tiene una marca temporal dentro de los 5 segundos de la confirmación

  @negative
  Escenario: SC-023-N4 — Sin stock suficiente al confirmar, la confirmación se rechaza (invariante ADR-0008)
    Dado que el stock de un producto de la orden bajó por debajo de lo pedido después del checkout
    Cuando el dueño intenta confirmar el pago
    Entonces recibe 409 señalando que no hay stock suficiente
    Y la orden permanece en "pending_payment"
    Y no se registra ningún pago nuevo para esa orden
