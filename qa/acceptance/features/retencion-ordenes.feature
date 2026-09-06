# language: es
@retencion-ordenes @us-021
Característica: Retención y anonimización de los datos personales de las órdenes (US-021)
  Como responsable del tratamiento de datos personales de DSM (el dueño)
  quiero que los datos del comprador se anonimicen al cumplirse el plazo o a pedido
  para cumplir la Ley 25.326 sin perder el historial comercial

  Antecedentes:
    Dado un catálogo sembrado con productos disponibles
    Y un token admin real (AdminGuard)

  # ─── HAPPY PATH ───

  @happy @critical-path
  Escenario: SC-021-H1 — El barrido anonimiza toda orden vencida y ninguna otra (AC-1)
    Dado una orden con más de ORDER_RETENTION_MONTHS de antigüedad, sin anonimizar
    Y una segunda orden reciente, sin anonimizar
    Cuando se dispara "POST /v1/admin/orders/retention-sweep" con el token admin
    Entonces la respuesta trae anonymized_count de al menos 1
    Y la orden vencida tiene buyer_name/buyer_email/buyer_phone reemplazados por los valores placeholder
    Y la orden reciente conserva sus datos de comprador intactos
    Y ambas órdenes siguen existiendo con su status y su total_ars_cents sin cambios

  @happy
  Escenario: SC-021-H2 — El barrido no altera los agregados comerciales (AC-2)
    Dado un conjunto de 3 órdenes vencidas con ítems y total_ars_cents conocidos
    Y consultadas por "GET /v1/admin/orders" antes del barrido
    Cuando se anonimizan las 3 mediante el barrido
    Y se vuelve a consultar "GET /v1/admin/orders"
    Entonces la suma de total_ars_cents de las 3 órdenes es idéntica antes y después
    Y la cantidad de órdenes devueltas por status es idéntica antes y después
    Y para cada orden, "GET /v1/admin/orders/:id" devuelve los mismos items, quantity y unit_price_ars_cents que antes de anonimizar

  @happy @critical-path
  Escenario: SC-021-H3 — Anonimización a pedido responde de inmediato con confirmación (AC-3)
    Dado una orden existente, sin anonimizar
    Cuando el dueño dispara "POST /v1/admin/orders/:id/anonymize" con su token admin
    Entonces la respuesta es 200 con order_id, anonymized_at y anonymization_reason igual a "requested"
    Y anonymized_at está dentro de los 5 segundos del momento del pedido

  @happy
  Escenario: SC-021-H4 — La anonimización queda registrada y distingue el motivo (AC-4)
    Dado una orden anonimizada por plazo cumplido
    Y una segunda orden anonimizada a pedido
    Cuando se re-consulta cada una llamando de nuevo a su endpoint de anonimización (idempotente — no produce un segundo efecto, ver AC-8)
    Entonces la primera trae anonymization_reason "retention_policy"
    Y la segunda trae anonymization_reason "requested"
    # NOTA DE ALCANCE (§1.3 del qa-plan): esta es la ÚNICA superficie hoy que expone el
    # motivo — "GET /v1/admin/orders/:id" (US-012) no incluye anonymized_at/
    # anonymization_reason en su DTO. La lectura más natural de AC-4 ("se consulta esa
    # orden") apunta a ESE GET, no a re-llamar al endpoint de anonimizar. Ver test case
    # TC-021-004b (execution_mode: blocked) en la tabla de abajo.

  # ─── ALTERNATIVE PATH ───

  @alternative
  Escenario: SC-021-A1 — Una orden anonimizada sigue siendo operable para el dueño (AC-5)
    Dado una orden anonimizada
    Cuando el dueño la consulta con "GET /v1/admin/orders/:id"
    Entonces ve sus items, quantity, unit_price_ars_cents, status y created_at sin cambios
    Y buyer_name/buyer_email/buyer_phone muestran los valores placeholder de anonimización, no los datos originales del comprador
    # NOTA DE ALCANCE (§1.3): el AC pide una "indicación" de que fueron anonimizados —
    # hoy el placeholder de buyer_name ("Comprador anonimizado") cumple esa función de
    # forma indirecta; un Badge explícito requiere el campo anonymized_at en el DTO
    # (gap documentado) + FE (gap documentado en §1.2). Este escenario prueba lo que la
    # API entrega hoy, no inventa un Badge que no existe.

  # ─── NEGATIVE SPACE (regresión — correr en cada release que toque este módulo) ───

  @negative @regression
  Escenario: SC-021-N1 — Ninguna orden ni ítem se borra al anonimizar (AC-6)
    Dado 2 órdenes en estado activo (una vencida, una no) consultables por "GET /v1/admin/orders"
    Y el total de órdenes en ese listado antes del barrido
    Cuando corre el barrido de retención
    Entonces el total de órdenes en "GET /v1/admin/orders" es idéntico al de antes
    Y "GET /v1/admin/orders/:id" de la orden vencida sigue devolviendo sus items (ningún item desapareció)

  @negative @regression @deferred
  Escenario: SC-021-N2 — El registro de consentimiento no se destruye (AC-7)
    # Diferido a propósito (TC-021-007, qa-plan.md §4: execution_mode: manual). No hay
    # superficie API que exponga consent_accepted/consent_accepted_at/
    # consent_terms_version (ni el GET de US-012 los incluye) — automatizarlo acá
    # requeriría inventar un endpoint que no existe. Se deja como checklist humano
    # (verificación cruzada con la suite dev T5.5, integration contra Postgres real),
    # mismo criterio que el `@deferred` de `catalogo.feature` (AC-10).
    Dado una orden con consentimiento aceptado y una versión de términos conocida
    Cuando se anonimiza esa orden
    Entonces el registro de consentimiento sigue existiendo con el mismo valor y la misma versión de términos

  @negative @regression
  Escenario: SC-021-N3 — Anonimizar dos veces no produce error ni un segundo efecto (AC-8)
    Dado una orden ya anonimizada
    Cuando se dispara de nuevo "POST /v1/admin/orders/:id/anonymize" sobre la misma orden
    Entonces la respuesta es 200 con el mismo anonymized_at que la primera vez
    Y no se produce ningún error

  @negative @regression
  Escenario: SC-021-N4 — El barrido corrido dos veces con el mismo corte no re-anonimiza nada (AC-8)
    Dado que el barrido ya corrió una vez y anonimizó N órdenes
    Cuando se dispara "POST /v1/admin/orders/retention-sweep" de nuevo, sin nuevas órdenes vencidas
    Entonces la respuesta trae anonymized_count igual a 0
    Y no se produce ningún error

  @negative @regression @critical-path
  Esquema del escenario: SC-021-N5 — Sólo el dueño autenticado puede anonimizar a pedido (AC-9)
    Dado una orden existente, sin anonimizar
    Cuando alguien intenta "POST /v1/admin/orders/:id/anonymize" con "<credencial>"
    Entonces la respuesta es "<status>"
    Y la orden no cambia (buyer_name sigue siendo el original tras el intento)

    Ejemplos:
      | credencial                            | status |
      | sin Authorization                     | 401    |
      | JWT expirado                          | 401    |
      | JWT válido con role distinto de admin | 403    |
