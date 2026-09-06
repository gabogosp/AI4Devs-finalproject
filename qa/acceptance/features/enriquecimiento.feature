# language: es
#
# QA-005-ACC-1 (qa-plan.md §5) — 11 escenarios ejecutables (contando las 4+3
# combinaciones de los dos Esquemas del Escenario) hoy contra la API real +
# Postgres real, sin doblar el proveedor de IA: los escenarios que necesitan el
# proveedor "encendido" (`@needs-provider-enabled` de facto, ver steps) usan una
# clave real INVÁLIDA — nunca un mock — y ejercitan la resiliencia (backoff,
# cooldown, abandono) contra fallas reales del proveedor (`design.md` §D-QA1).
#
# `SC-005-H1/H2/C3/N2/N3` viven acá tageados `@blocked`: necesitan que Gemini
# responda CON ÉXITO al menos una vez, y este entorno sólo tiene el placeholder
# de `.env.example` (`design.md` §D-QA1, hallazgo QA-005-F1/`proposal.md`
# OQ-QA-005-1) — se declaran, nunca se simulan con un doble no autorizado.
@enriquecimiento @us-005
Característica: Enriquecimiento IA de descripciones + generación de embeddings (US-005)
  Como sistema
  quiero enriquecer descripciones pobres con IA y generar sus embeddings, respetando el texto curado por el dueño y degradando con gracia cuando el proveedor falla
  para que el catálogo sea buscable en lenguaje natural (US-004) sin arriesgar el catálogo entero a un proveedor externo

  # ─── HAPPY PATH ───

  @happy @blocked
  Escenario: SC-005-H1 — Un producto con descripción pobre se enriquece y se embebe con éxito (AC-1)
    Dado un producto publicado con una descripción base pobre, pendiente de enriquecer
    Cuando se dispara una corrida de enriquecimiento
    Entonces el producto queda con una descripción enriquecida no vacía
    Y su embedding de 768 dimensiones queda persistido con la versión del modelo usada
    Y "GET /v1/admin/enrichment/status" lo cuenta entre los embebidos
  # BLOQUEADO (ver `design.md` §D-QA1): necesita que Gemini responda CON ÉXITO. Este
  # entorno sólo tiene el placeholder de `.env.example` (`proposal.md` OQ-QA-005-1). Ya
  # probado dev-owned (`e2e-enrichment-cycle.spec.ts`, T6.1) con el FakeAiProvider
  # determinista.

  @happy @blocked
  Escenario: SC-005-H2 — Un producto enriquecido por esta corrida queda elegible para la búsqueda semántica (AC-2)
    Dado un producto enriquecido y embebido con éxito por una corrida real de esta capacidad
    Cuando se ejecuta una búsqueda kNN sobre su vector
    Entonces el producto aparece como candidato según su similitud
  # BLOQUEADO — depende de SC-005-H1. La elegibilidad kNN en sí ya está probada dev-owned
  # (`knn.spec.ts`, T2.3, `EXPLAIN` sobre el índice HNSW) y con datos sembrados directo por
  # `US-004-busqueda-semantica-backend/qa-plan.md` (`seed-busqueda.ts`). Lo que este
  # escenario probaría de más — que ESTE pipeline real produjo el vector — no es
  # alcanzable sin clave real.

  @happy @critical-path
  Escenario: SC-005-H3 — La cobertura del catálogo es observable y coincide con la verdad de la base (AC-3)
    Dado un catálogo con una mezcla conocida de productos pendientes y abandonados
    Cuando se llama "GET /v1/admin/enrichment/status"
    Entonces "coverage.total", "coverage.pending" y "coverage.abandoned" coinciden con el conteo real de la base
    Y "coverage.coverage_ratio" es "coverage.embedded" dividido "coverage.total"
    Y con un catálogo vacío "coverage.coverage_ratio" es 0 sin lanzar una excepción
  # El umbral de negocio (≥90%) es un resultado de operación sobre el catálogo real
  # (runbook §3.6 del servicio), no una propiedad verificable en este entorno — este
  # escenario prueba que el MECANISMO de medición es correcto, no el número.

  # ─── CORNER (resiliencia real, mecánica de contrato) ───

  @corner @critical-path
  Escenario: SC-005-C1 — El fallo real del proveedor acumula intentos con backoff creciente y abre el circuito (AC-4)
    Dado una instancia con el proveedor de IA habilitado apuntando a una clave real inválida
    Y al menos 5 productos pendientes de enriquecer sembrados en el mismo lote
    Cuando se dispara una corrida con "POST /v1/admin/enrichment/runs"
    Entonces cada producto tocado acumula un intento con su próximo intento agendado según la escalera de backoff
    Y tras las fallas consecutivas del umbral configurado el estado del runner pasa a "cooldown"
    Y una corrida disparada durante el cooldown responde 409 con el tipo "dsm:enrichment/cooldown"

  @corner @critical-path
  Escenario: SC-005-C2 — Un producto agota sus intentos y queda abandonado, navegable y con el error registrado (AC-5)
    Dado un producto pendiente de enriquecer sembrado, con el proveedor de IA habilitado apuntando a una clave real inválida
    Cuando se dispara una corrida y se adelanta su próximo intento hasta agotar el tope de intentos configurado
    Entonces el producto queda sin marca de enriquecido, sin fila en los embeddings, con su descripción base intacta y con un código de error registrado
    Y "GET /v1/admin/enrichment/status" lo cuenta entre los abandonados
    Y el producto sigue apareciendo en el listado público de su categoría (US-002)

  @corner @blocked
  Escenario: SC-005-C3 — Re-enriquecer sólo si cambió la descripción base (AC-6)
    Dado un producto ya enriquecido con éxito y sin cambios en su descripción base
    Cuando se vuelve a disparar una corrida
    Entonces no se llama a la IA ni al embedder para ese producto
  # BLOQUEADO — la rama de "hash igual, saltar" sólo se alcanza tras una corrida EXITOSA
  # previa: el hash sólo se persiste en el camino de éxito (`actualizarProducto`). Sin una
  # GEMINI_API_KEY real no hay baseline que verificar. Ya probado dev-owned
  # (`enrichment.service.spec.ts` T3.2, `e2e-enrichment-idempotency.spec.ts` T6.2).

  @corner @critical-path
  Escenario: SC-005-C4 — Una corrida en curso rechaza un segundo disparo (mecánica, subyace a AC-1/AC-5)
    Dado una instancia con el proveedor de IA habilitado y productos pendientes sembrados
    Cuando se dispara una corrida con "POST /v1/admin/enrichment/runs"
    Y se dispara una segunda corrida inmediatamente después
    Entonces la primera responde 202 con "run_id" y "accepted" true
    Y la segunda responde 409 con el tipo "dsm:enrichment/run-in-progress"

  @corner
  Escenario: SC-005-C5 — Sin proveedor de IA configurado, la corrida no arranca y el catálogo sigue navegable (D6, espíritu de AC-5)
    Dado que la instancia de QA compartida tiene el enriquecimiento deshabilitado
    Cuando se llama "GET /v1/admin/enrichment/status"
    Entonces "runner_state" es "disabled"
    Cuando se intenta "POST /v1/admin/enrichment/runs"
    Entonces recibo 503 con el tipo "dsm:enrichment/disabled"
    Y ningún producto del catálogo cambia de estado

  @corner
  Esquema del escenario: SC-005-C6 — Sin permiso admin, los 2 endpoints rechazan (mecánica de contrato)
    Cuando se llama "<método>" "<endpoint>" con "<credencial>"
    Entonces recibo "<status>"

    Ejemplos:
      | método | endpoint                          | credencial          | status |
      | GET    | /v1/admin/enrichment/status       | sin token           | 401    |
      | GET    | /v1/admin/enrichment/status       | token de cliente    | 403    |
      | POST   | /v1/admin/enrichment/runs         | sin token           | 401    |
      | POST   | /v1/admin/enrichment/runs         | token de cliente    | 403    |

  @corner
  Escenario: SC-005-C7 — El presupuesto real de POST /runs protege el costo (AC-4, control de superficie)
    Dado una instancia con el presupuesto real de "ENRICHMENT_RATE_LIMIT_MAX" sin elevar
    Cuando se superan las llamadas permitidas por la ventana
    Entonces la llamada excedente responde 429 con las cabeceras "Retry-After" y "RateLimit-*"

  @corner
  Esquema del escenario: SC-005-C8 — El cuerpo de POST /runs con forma inválida se rechaza sin tocar el runner
    Cuando se llama "POST /v1/admin/enrichment/runs" con "<cuerpo>"
    Entonces recibo 422
    Y el estado del runner no cambia

    Ejemplos:
      | cuerpo                                                |
      | un campo desconocido, por ejemplo forced: true        |
      | product_ids con un elemento que no es UUID            |
      | product_ids con más de 500 elementos                  |

  # ─── NEGATIVE SPACE ───

  @negative @critical-path
  Escenario: SC-005-N1 — Curar la descripción del dueño marca el producto como curado y elegible para re-embeddear (AC-7, mitad mecánica)
    Dado un producto publicado
    Cuando se llama "PATCH /v1/admin/products/{id}" con "description_enriched"
    Entonces la respuesta es 200
    Y leyendo el estado interno del producto, "description_curated" es true y "enrichment_done" es false
    Y editar sólo el precio o el stock del mismo producto no cambia "description_curated"

  @negative @blocked
  Escenario: SC-005-N2 — El embedding se regenera sobre el texto curado y nunca sobre el crudo (AC-7, mitad completa)
    Dado un producto curado por el dueño
    Cuando se dispara una corrida de enriquecimiento
    Entonces no se llama a la IA de enriquecimiento para ese producto
    Y el embedding persistido corresponde al texto curado, no al texto base
  # BLOQUEADO — necesita que el embedder responda con éxito. Ya probado dev-owned
  # (`enrichment.service.spec.ts` T3.2, `e2e-curated-text.spec.ts`, T4.3/T6.2 con el
  # FakeAiProvider determinista).

  @negative @blocked
  Escenario: SC-005-N3 — La versión del modelo queda registrada y un cambio de modelo no corrompe embeddings previos (AC-8)
    Dado embeddings ya generados con una versión del modelo
    Cuando se procesa un producto nuevo con éxito
    Entonces su embedding registra la versión del modelo usada
    Y los embeddings previos conservan su propia versión sin alterarse
  # BLOQUEADO — necesita al menos una corrida exitosa. Ya probado dev-owned
  # (`embedding.repository.spec.ts`, T2.2, AC-8).

  @negative @critical-path
  Escenario: SC-005-N4 — Ninguna respuesta observable filtra la clave del proveedor, incluso durante una corrida que falla de verdad (AC-9)
    Dado una instancia con el proveedor de IA habilitado apuntando a una clave real inválida
    Cuando se dispara una corrida y se deja fallar contra el proveedor real
    Entonces ninguna respuesta de "GET /v1/admin/enrichment/status" ni de "POST /v1/admin/enrichment/runs" contiene el valor configurado de la clave
    Y "last_error_code" es un tipo del catálogo "dsm:enrichment/*", nunca el mensaje crudo del proveedor

  @negative @critical-path
  Escenario: SC-005-N5 — El enriquecimiento nunca publica, tenga éxito o falle (AC-10)
    Dado un producto en estado "draft" pendiente de enriquecer, con el proveedor de IA habilitado apuntando a una clave real inválida
    Cuando se dispara una corrida de enriquecimiento sobre ese producto
    Entonces el producto sigue en estado "draft" después de la corrida, sea cual sea el resultado del proveedor
