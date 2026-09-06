# language: es
@borrado-cuenta @us-020
Característica: Borrado de cuenta y datos personales (derecho al olvido, US-020)
  Como cliente registrado de DSM
  quiero poder borrar mi cuenta y mis datos personales
  para ejercer mi derecho al olvido (Ley 25.326) sin perder el historial comercial del dueño

  # ─── HAPPY PATH ───

  @happy @critical-path
  Escenario: H-1 — El cliente borra su cuenta y queda como visitante anónimo (AC-1)
    Dado un cliente registrado con sesión iniciada y sin órdenes en curso
    Cuando confirma el borrado de su cuenta
    Entonces el borrado se ejecuta de inmediato, en la misma respuesta
    Y su sesión (cookie de acceso y de refresco) queda cerrada
    Y una llamada siguiente con esa misma sesión ya no lo identifica como cliente

  @happy @critical-path
  Esquema del escenario: H-2 — Los datos personales dejan de existir en toda superficie consultada (AC-2)
    Dado un cliente registrado, con nombre, email y teléfono reales, que compró al menos una vez
    Cuando borra su cuenta
    Entonces "<superficie>" ya no muestra su nombre, su email ni su teléfono reales
    Y en su lugar aparece una indicación de que los datos fueron suprimidos

    Ejemplos:
      | superficie                                                             |
      | el detalle de esa orden en el panel del dueño (GET admin/orders)       |
      | el listado de órdenes del panel del dueño (GET admin/orders)           |
      | la exportación CSV existente que incluya datos de comprador, si la hay |

  @happy
  Escenario: H-3 — El historial comercial sobrevive anonimizado, igual que en US-021 (AC-3)
    Dado un cliente con una orden ya entregada y otra ya cancelada
    Cuando borra su cuenta
    Entonces ambas órdenes conservan sus ítems, cantidades, importes, estado y fechas
    Y ninguna orden ni ninguno de sus ítems desaparece
    Y cada orden queda con motivo de anonimización "account_deletion" y su fecha

  # ─── ALTERNATIVE PATH ───

  @alternative @critical-path
  Esquema del escenario: A-1 — Órdenes en curso bloquean el borrado, con el detalle que ya ve en su historial (AC-4)
    Dado un cliente con una orden real en estado "<estado>"
    Cuando intenta borrar su cuenta
    Entonces la solicitud se rechaza y ningún dato de la cuenta cambia
    Y la respuesta indica cuántas y cuáles son las órdenes que lo bloquean

    Ejemplos:
      | estado          |
      | pending_payment |
      | new             |
      | preparing       |
      | ready           |

  @alternative
  Escenario: A-2 — El email queda libre y el re-registro empieza de cero (AC-5)
    Dado una cuenta que borró su titular
    Cuando alguien se registra de nuevo con el mismo email
    Entonces el registro se completa como si fuera la primera vez
    Y esa cuenta nueva no expone historial, carrito ni dato alguno de la cuenta anterior

  @alternative @critical-path @regression
  Escenario: A-3 — Borrar dos cuentas distintas nunca colisiona por el valor de anonimización (AC-6)
    # NOTA DE ALCANCE (reconciliada contra el `design.md` real, qa-plan.md §5.2):
    # el placeholder ÚNICO por fila (`cuenta-borrada+{customerId}@anonimizado.dsm.invalid`)
    # vive en `customers.email` — ninguna superficie admin expone esa columna
    # (las órdenes anonimizadas usan el placeholder FIJO de US-021 en
    # `buyer_email`, igual para todas). Sin lectura directa de Postgres
    # (prohibida en este plan, qa-plan.md §9), la única propiedad observable
    # por API de "sin colisión" es que NINGÚN borrado termine en un error de
    # restricción de unicidad — una colisión real de `UNIQUE` en Postgres se
    # propagaría como 500, nunca como un valor distinto visible por HTTP.
    Dado dos clientes registrados distintos, cada uno con email real propio
    Cuando el primero borra su cuenta
    Y el segundo borra la suya inmediatamente después
    Entonces los dos borrados terminan sin error

  @alternative @critical-path @regression
  Escenario: A-3b — Borrar dos cuentas AL MISMO TIEMPO nunca colisiona (AC-6, concurrente)
    Dado dos clientes registrados distintos, cada uno con email real propio
    Cuando ambos disparan el borrado de su cuenta al mismo tiempo
    Entonces los dos borrados terminan sin error

  @alternative
  Esquema del escenario: A-4 — Cuenta sin compras, o con compras ya anonimizadas por retención, se borra igual (AC-8)
    Dado un cliente que arranca así: "<condición de partida>"
    Cuando el cliente borra su cuenta
    Entonces el borrado se completa sin error
    Y ninguna orden ya anonimizada cambia su motivo ni su fecha de anonimización

    Ejemplos:
      | condición de partida                                                          |
      | un cliente que nunca compró                                                   |
      | un cliente con una orden ya anonimizada por el barrido de retención de US-021 |

  # ─── NEGATIVE SPACE (regresión — correr en cada release que toque este módulo) ───

  @negative @critical-path @regression
  Escenario: N-1a — Una orden que entra en curso justo antes de confirmar bloquea el borrado en la ejecución (AC-9)
    Dado un cliente sin órdenes en curso al momento de ver la pantalla de borrado
    Y una orden nueva sin pagar que se crea después, antes de confirmar
    Cuando confirma el borrado
    Entonces la solicitud se rechaza con la misma explicación que en AC-4
    Y ningún dato de la cuenta cambia

  @negative @critical-path @regression
  Escenario: N-1b — Una orden bloqueante que se resuelve justo antes de confirmar permite el borrado sin recargar (AC-9)
    Dado un cliente con una orden en curso al momento de ver la pantalla de borrado
    Y esa orden se entrega o se cancela después, antes de confirmar
    Cuando confirma el borrado con la misma solicitud original (sin recargar el estado)
    Entonces el borrado procede y se completa

  @negative @critical-path @regression @us-020-ac10
  Esquema del escenario: N-2 — Ninguna de las tres puertas de acceso vuelve a entrar, y las tres responden igual que un email inexistente (AC-10)
    Dado una cuenta que borró su titular, con "<estado previo>"
    Cuando alguien "<intento>"
    Entonces la respuesta de esa puerta es indistinguible de la de un intento equivalente contra una cuenta que nunca existió
    Y no revela que la cuenta existió ni que fue borrada

    Ejemplos:
      | estado previo                                                                     | intento                                                      |
      | conocía email y contraseña originales                                             | intenta iniciar sesión con esas credenciales                 |
      | tenía una sesión abierta en otro dispositivo antes del borrado                     | esa sesión intenta refrescar su token de acceso              |
      | había pedido un enlace de recuperación de contraseña, sin usarlo, antes de borrar  | intenta confirmar ese enlace pendiente                       |

  @negative @regression @deferred
  Escenario: N-3 — No existe ninguna vía para deshacer, recuperar ni consultar un borrado pendiente (AC-11)
    # QA-020-ACC-5 (execution_mode: manual/documental, qa-plan.md §5.5) —
    # deliberadamente SIN step defs y con @deferred (mismo criterio que
    # SC-021-N2 de `retencion-ordenes.feature`): probar la ausencia de un
    # endpoint inexistente contra un servidor real no distingue "no
    # implementado todavía" de "deliberadamente ausente" — el contrato
    # publicado es la única fuente que sí distingue las dos cosas. Revisión
    # manual del OpenAPI, no un test.
    Dado una cuenta borrada
    Cuando se buscan endpoints de recuperación, deshacer o estado de borrado pendiente
    Entonces ninguno existe en la superficie pública ni en la admin

  @negative @critical-path @us-020-ac12
  Escenario: N-4 — El panel de métricas del dueño no se mueve por el borrado (AC-12)
    Dado un conjunto de órdenes de un cliente, ya contabilizadas en el resumen de métricas (US-016)
    Cuando ese cliente borra su cuenta
    Entonces el resumen de métricas para el período que las incluye trae los mismos totales, cantidades y productos vendidos que antes

  @negative @critical-path @regression @us-020-ac13
  Esquema del escenario: N-5 — Nadie más puede borrar la cuenta de otro (AC-13)
    Dado la cuenta real de un cliente, con sesión iniciada
    Cuando "<actor>" intenta borrarla
    Entonces la operación se rechaza
    Y ni la cuenta ni ninguna de sus órdenes cambia

    Ejemplos:
      | actor                                                 |
      | un visitante sin ninguna sesión                       |
      | otro cliente registrado, con su propia sesión válida  |
      | el dueño, con su token admin, desde el panel          |

  @negative @critical-path @us-020-ac14
  Escenario: N-6 — La PII borrada no sobrevive en los registros operativos (AC-14)
    Dado un cliente con nombre, email y teléfono reales y conocidos
    Cuando borra su cuenta
    Entonces ningún registro del proceso de la API contiene ese nombre, ese email ni ese teléfono, ni siquiera transformados
    Y el registro operativo permite saber que hubo un borrado y cuándo, sin identificar a la persona

  @negative @critical-path @us-020-ac14
  Escenario: N-6b — El 409 de bloqueo por órdenes en curso tampoco filtra PII a los registros (AC-14, camino de bloqueo)
    Dado un cliente con nombre, email y teléfono reales y conocidos, con una orden en curso
    Cuando intenta borrar su cuenta y es rechazado por esa orden
    Entonces ningún registro del proceso de la API contiene ese nombre, ese email ni ese teléfono, ni siquiera transformados

  @negative @critical-path @regression @us-020-ac15
  Escenario: N-7 — Confirmar dos veces casi al mismo tiempo produce un solo efecto (AC-15)
    Dado un cliente con sesión iniciada y sin órdenes en curso
    Cuando dispara dos confirmaciones de borrado casi simultáneas para la misma cuenta
    Entonces el borrado se aplica una sola vez
    Y ninguna de las dos respuestas es un error de servidor
    Y no queda un segundo registro de auditoría ni una segunda pasada de anonimización sobre las mismas órdenes
