# language: es
#
# QA-015-ACC-1 (qa-plan.md §4-§5) — 18 casos ejecutables (contando los
# Examples de los 3 Esquemas: SC-015-C1×2, SC-015-C3×4, SC-015-N1×2) hoy
# contra la API real + Postgres real. Sin ningún `@blocked`: esta US no
# depende de ningún proveedor externo (a diferencia de US-010/MercadoPago).
# No hay Layer 3 (E2E cross-stack) en este change — diferido, ver
# `design.md` §D-QA2 y `proposal.md` §Out of scope: no hay UI de esta US
# construida todavía.
@historial-compras @us-015
Característica: Historial de compras del cliente registrado (US-015)
  Como cliente registrado
  quiero ver el historial de mis compras
  para consultar qué compré y el estado de cada pedido

  Antecedentes:
    Dado un catálogo sembrado con productos disponibles

  # ─── HAPPY PATH ───

  @happy @critical-path
  Escenario: SC-015-H1 — El listado muestra sólo las compras propias, ordenadas de la más reciente a la más antigua (AC-1, AC-4)
    Dado un cliente con sesión que compró dos veces estando logueado
    Y otro cliente distinto que también compró estando logueado
    Cuando el primer cliente abre su historial de compras
    Entonces ve exactamente sus dos órdenes, con fecha, estado y total en ARS
    Y el listado está ordenado de la más reciente a la más antigua
    Y no aparece la orden del otro cliente

  @happy
  Escenario: SC-015-H2 — El detalle de una compra muestra ítems, cantidades, precios, estado y retiro (AC-2)
    Dado un cliente con sesión que compró un producto estando logueado
    Cuando abre el detalle de esa orden
    Entonces ve sus ítems con cantidades y precios
    Y ve el estado actual de la orden
    Y ve la modalidad de retiro en sucursal

  # ─── ALTERNATIVE PATH ───

  @alternative
  Escenario: SC-015-A1 — Un cliente sin compras ve un listado vacío, sin error (AC-3)
    Dado un cliente registrado que aún no compró estando logueado
    Cuando abre su historial
    Entonces recibe 200 con un listado vacío
    Y la paginación indica un total de cero

  # ─── CORNER ───

  @corner @critical-path
  Esquema del escenario: SC-015-C1 — La retención respeta el corte de 12 meses en el borde exacto (AC-7)
    Dado una compra propia con fecha "<antigüedad>"
    Cuando el cliente abre su historial
    Entonces esa compra "<resultado>" en el listado
    Y el detalle de esa compra "<resultado_detalle>"

    Ejemplos:
      | antigüedad                  | resultado    | resultado_detalle          |
      | exactamente en el corte     | aparece      | responde 200               |
      | un milisegundo antes del corte | no aparece | responde 404 (no existe)   |

  @corner
  Escenario: SC-015-C2 — Un offset más allá del total devuelve un listado vacío, no un error (paginación, PRD §4)
    Dado un cliente con sesión que compró una vez estando logueado
    Cuando pide su historial con un offset mayor a la cantidad total de sus compras
    Entonces recibe 200 con un listado vacío
    Y la paginación conserva el total real de compras

  @corner
  Esquema del escenario: SC-015-C3 — Parámetros de paginación inválidos se rechazan sin tocar la base (paginación)
    Dado un cliente con sesión que compró una vez estando logueado
    Cuando pide su historial con "<parámetro>" igual a "<valor>"
    Entonces recibe 422 sin exponer ninguna orden

    Ejemplos:
      | parámetro | valor        |
      | offset    | -1           |
      | offset    | no-numerico  |
      | limit     | 0            |
      | limit     | 101          |

  @corner @critical-path
  Escenario: SC-015-C4 — Una compra iniciada y nunca pagada no aparece en el historial (AC-1, regla de negocio)
    Dado un cliente con sesión que inició un checkout sin confirmar el pago
    Cuando abre su historial
    Entonces esa orden no aparece en el listado
    Y el detalle de esa orden responde 404

  @corner
  Escenario: SC-015-C5 — Una orden anonimizada a pedido sigue apareciendo con ítems y estado intactos (comportamiento documentado)
    Dado una compra propia que el dueño anonimizó a pedido
    Cuando el cliente abre su historial
    Entonces esa orden aparece en el listado con su fecha, estado y total sin cambios
    Y el detalle de esa orden muestra sus ítems y cantidades sin cambios

  # ─── NEGATIVE SPACE ───

  @negative @critical-path
  Esquema del escenario: SC-015-N1 — Sin sesión de cliente válida, ninguna orden se expone (AC-5)
    Cuando un visitante sin sesión pide "<endpoint>"
    Entonces recibe 401
    Y la respuesta no contiene ninguna orden

    Ejemplos:
      | endpoint                                   |
      | su listado de historial                    |
      | el detalle de una orden por su número       |

  @negative @critical-path
  Escenario: SC-015-N2 — El detalle de una orden ajena responde igual que una inexistente (AC-4, IDOR)
    Dado un cliente con sesión que compró estando logueado
    Y otro cliente distinto con sesión propia
    Cuando el segundo cliente pide el detalle de la orden del primero
    Entonces recibe 404
    Y la respuesta es indistinguible de pedir un número de orden que no existe

  @negative @critical-path
  Escenario: SC-015-N3 — Una compra hecha como invitado con el mismo email de una cuenta no aparece en su historial (AC-6, privacidad)
    Dado una compra hecha como invitado con el email de una cuenta que se registra después
    Cuando el dueño de esa cuenta abre su historial con su propia sesión
    Entonces esa compra de invitado NO aparece en el listado
    Y sólo aparecen las órdenes que ese cliente hizo estando logueado
