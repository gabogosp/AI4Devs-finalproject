# language: es
#
# QA-010-ACC-1 (qa-plan.md §5) — 13 escenarios ejecutables (contando los
# Examples de los 3 Esquemas) hoy contra la API real + Postgres real, sin
# mockear la transacción de pagos/stock. `SC-010-X1`/`SC-010-X2`
# (cross-feature, Layer 3) NO viven acá — son `qa/e2e/pago-webhook-cross-stack.spec.ts`
# (design.md §D-QA8). `SC-010-N2` vive acá pero tageada `@blocked`: necesita que
# MercadoPago responda `rejected` de verdad, sin cuenta sandbox no es ejecutable
# black-box (design.md §D-QA1, hallazgo QA-010-F1) — se declara, nunca se simula
# con un doble no autorizado.
@pagos @us-010
Característica: Webhook de MercadoPago, medio simulado y decremento de stock (US-010)
  Como sistema
  quiero confirmar la orden al recibir un pago aprobado y verificado, y decrementar el stock de forma atómica e idempotente
  para registrar la venta correctamente con el stock como única fuente de verdad, sin sobrevender ni doble-procesar

  Antecedentes:
    Dado un catálogo sembrado con productos disponibles
    Y un comprador que completó el checkout dejando una orden real en estado "pending_payment"

  # ─── HAPPY PATH ───

  @happy @critical-path
  Escenario: SC-010-H1 — El medio simulado confirma la orden y decrementa el stock (AC-1, AC-9)
    Cuando se confirma el pago de esa orden por el medio simulado "DSM"
    Entonces recibo 200 con la orden confirmada
    Y el stock de cada producto de la orden queda decrementado exactamente en la cantidad pedida
    Y queda registrado un pago aprobado para esa orden

  @happy
  Escenario: SC-010-H2 — La confirmación dispara las notificaciones al comprador y al dueño (AC-2)
    Cuando se confirma el pago de esa orden por el medio simulado "DSM"
    Entonces el puerto de notificaciones recibe exactamente un aviso de confirmación para el comprador
    Y exactamente un aviso de orden nueva para el dueño
    Y ninguno de los dos avisos revela el email del comprador en el registro observable

  # ─── CORNER (concurrencia, límites, mecánica de recuperación) ───

  @corner @critical-path
  Escenario: SC-010-C1 — Dos confirmaciones simultáneas sobre la misma orden nunca decrementan el stock dos veces (AC-5, AC-6)
    Cuando se disparan dos confirmaciones simultáneas para esa orden
    Entonces exactamente una responde con éxito
    Y la otra es rechazada por el estado ya no pendiente
    Y el stock del producto se decrementó una sola vez

  @corner @critical-path
  Escenario: SC-010-C2 — Confirmaciones concurrentes compiten por la última unidad de stock (AC-8)
    Dado un producto con exactamente una unidad de stock, pedido por varias órdenes distintas
    Cuando se disparan confirmaciones simultáneas para todas esas órdenes
    Entonces exactamente una confirma con éxito
    Y el stock del producto termina en cero, nunca por debajo de cero

  @corner
  Esquema del escenario: SC-010-C3 — La limpieza de abandonadas respeta el corte de antigüedad (AC-11)
    Dado una orden "pending_payment" creada hace "<antigüedad>"
    Cuando corre el job de limpieza de abandonadas
    Entonces la orden queda "<resultado>"

    Ejemplos:
      | antigüedad | resultado                                            |
      | 49 horas   | cancelada, y deja de aparecer en la cola operativa   |
      | 47 horas   | intacta en pending_payment                           |

  @corner
  Escenario: SC-010-C4 — La reconciliación sin pagos elegibles no toca nada (AC-10, mecánica)
    Dado que ninguna orden "pending_payment" supera la antigüedad mínima de reconciliación
    Cuando corre el job de reconciliación
    Entonces responde con un resumen de cero órdenes escaneadas y confirmadas
    Y ninguna orden ni pago cambia de estado

  # ─── NEGATIVE SPACE ───

  @negative @critical-path
  Esquema del escenario: SC-010-N1 — Un webhook sin firma verificable se rechaza sin ninguna escritura (AC-7)
    Cuando llega un webhook "<variante de firma>" para esa orden
    Entonces recibo 401
    Y la orden permanece "pending_payment"
    Y el stock no se ve afectado

    Ejemplos:
      | variante de firma                               |
      | con formato correcto pero secreto equivocado    |
      | con el header de firma ausente                  |
      | con el ts fuera de la ventana de tolerancia      |

  @negative @blocked
  Escenario: SC-010-N2 — Un pago rechazado no confirma la orden ni toca el stock (AC-3)
    Cuando llega el webhook de un pago rechazado en MercadoPago para esa orden
    Entonces la orden NO se confirma
    Y el stock no se ve afectado
  # BLOQUEADO (ver `design.md` §D-QA1 y hallazgo QA-010-F1 §12): necesita que
  # MercadoPago responda `rejected` de verdad — sin cuenta sandbox no es ejecutable
  # black-box. La rama de negocio ya está probada dev-owned
  # (`confirm-order.service.spec.ts`, sin cambios por este change).

  @negative @critical-path
  Escenario: SC-010-N3 — Aprobado sin stock suficiente: la orden se cancela y el reembolso no se pierde (AC-4)
    Dado que el stock de un producto de la orden bajó por debajo de lo pedido después del checkout
    Cuando se confirma el pago de esa orden por el medio simulado "DSM"
    Entonces recibo el rechazo por auto-cancelación por falta de stock
    Y la orden queda "cancelled"
    Y el pago queda reembolsado
    Y el stock del producto no decrementó

  @negative @critical-path
  Escenario: SC-010-N4 — Repetir la confirmación de una orden ya confirmada no duplica efectos (AC-5)
    Dado que la orden ya fue confirmada por el medio simulado "DSM"
    Cuando se repite la confirmación de esa misma orden
    Entonces recibo el rechazo por estado ya no pendiente
    Y el stock no se decrementa una segunda vez
    Y sigue existiendo exactamente un pago registrado para esa orden

  @negative
  Esquema del escenario: SC-010-N5 — El medio simulado rechaza lo que no debe confirmar (AC-9, control de superficie)
    Cuando "<condición>"
    Entonces recibo 404
    Y la orden permanece sin cambios

    Ejemplos:
      | condición                                          |
      | el flag del medio simulado está apagado            |
      | el order_token no corresponde a ninguna orden real |

  @negative
  Escenario: SC-010-N6 — El reintento de reembolsos sin pagos elegibles no falla y no toca nada (AC-4, durabilidad — mecánica)
    Dado que ningún pago está en "refund_pending" para el proveedor MercadoPago
    Cuando corre el job de reintento de reembolsos
    Entonces responde con un resumen de cero pagos intentados
  # La recuperación real de un reembolso fallido contra MercadoPago queda bloqueada
  # (ver `design.md` §D-QA1); el camino ya está probado dev-owned con el cliente
  # mockeado (`confirm-order.service.provider.spec.ts`).
