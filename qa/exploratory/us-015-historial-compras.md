# Charters exploratorios — US-015 Historial de compras del cliente registrado

> Exploración con **tiempo acotado**, no scripts (`qa-plan.md` §10, `QA-015-EXP-1`,
> `execution_mode: manual`). Lo que se busca es lo que la suite automatizada
> (aceptación/contract/k6) no puede afirmar: comportamiento con VOLUMEN real,
> percepción del cliente en distintos husos horarios, y sorpresas de UX de la
> paginación por offset que ningún assert de status/shape detecta. Los
> hallazgos se registran acá abajo, con fecha.

## Charter: paginación con volumen real · 30 min

**Riesgo que explora**: la suite automatizada siembra como máximo un puñado de
órdenes por escenario (`compraLogueada` × 1-2 por caso); ningún escenario
navega página por página con decenas de compras reales, que es el caso de un
cliente frecuente en producción — el offset/limit del contrato (`AC-1`, PRD §4)
nunca se ejercitó con un volumen que revele duplicados o saltos.

Recorrido sugerido:

1. Sembrar 50+ compras logueadas para UNA misma cuenta (reusando
   `compraLogueada`/`sembrarProductoPublicado` de `qa/support/seed-order-history.ts`,
   sin modificarlos) y navegar el listado página por página con `limit`/`offset`
   manuales (por ejemplo, `limit=10` en 5+ páginas sucesivas).
2. Comparar el conjunto de `order_number` visto a través de todas las páginas
   contra el conjunto real sembrado: ¿aparece alguno duplicado entre dos
   páginas? ¿falta alguno?
3. Intercalar una compra NUEVA (logueada, confirmada) entre la lectura de la
   página 1 y la página 2: como la paginación es por `offset` (sin cursor,
   `design.md` de backend), la compra nueva corre el offset de todo lo
   siguiente — ¿el cliente ve una fila repetida, una fila salteada, o ninguna
   de las dos (el corrimiento es imperceptible con `limit` chico)?
4. Repetir el mismo recorrido pidiendo `limit=100` (el máximo del contrato) en
   una sola página: ¿la respuesta se mantiene rápida y completa con 50+ filas?

**Hallazgos** · _(pendiente de ejecución)_

## Charter: husos horarios en el borde de retención · 30 min

**Riesgo que explora**: el corte de 12 meses se calcula con `setMonth` sobre el
reloj del SERVIDOR (UTC, `computeRetentionCutoff`); `SC-015-C1` ya prueba el
borde exacto desde la perspectiva del servidor (con margen de 5s, ver
`historial-compras.steps.ts`), pero ningún test automatizado explora qué
PERCIBE un cliente en un huso horario con offset negativo (por ejemplo,
Argentina, UTC-3) justo el día del corte — el borde que el servidor aplica y
el que el cliente esperaría según su propio reloj local pueden diferir hasta
por horas.

Recorrido sugerido:

1. Con `backdateOrder` (`qa/support/backdate-order.ts`, reusado sin modificar),
   dejar una compra propia con `created_at` en un punto donde el corte de 12
   meses cae distinto según UTC vs. UTC-3 (por ejemplo, últimas horas de un día
   en UTC que todavía son el día anterior en Argentina).
2. Consultar `GET /v1/me/orders` y observar si esa orden aparece o no: ¿coincide
   con lo que un cliente en Argentina, mirando la fecha en SU propio calendario
   (no en UTC), esperaría ver?
3. Documentar la magnitud del desfase (en horas) entre "el corte que el
   servidor aplicó" y "el corte que un cliente en cada huso de LATAM percibe"
   (México, Argentina, Chile — E2E, zonas horarias en scope) — información para
   quien diseñe el copy del FE ("tus compras de los últimos 12 meses"), no un
   defecto de este backend (el corte en UTC es una decisión de diseño
   documentada, no un bug).

**Hallazgos** · _(pendiente de ejecución)_

## Charter: UX del offset/limit sin cursor · 30 min

**Riesgo que explora**: el contrato de paginación (`OrderHistoryListResponse.pagination`)
es por `offset`/`limit`, sin cursor — `SC-015-C2`/`SC-015-C3` prueban que los
valores fuera de rango se manejan bien (200 vacío / 422), pero ningún test
automatizado juzga si el CONTRATO en sí produce una experiencia rara para quien
lo consuma (el futuro FE de esta US, todavía en otro worktree — `design.md`
§D-QA2), más allá de que cada respuesta individual sea correcta.

Recorrido sugerido:

1. Con cientos de órdenes reales sembradas (mismo pool que el charter de
   volumen), simular la secuencia que haría un FE real: leer página 1
   (`offset=0`), y mientras el cliente mira esa página, sembrar una compra
   NUEVA logueada. Leer página 2 (`offset=20` con `limit=20`, por ejemplo): ¿la
   fila que debería estar en el borde de la página 1/2 aparece dos veces, o
   desaparece?
2. Evaluar si el contrato actual (`limit`/`offset`, sin `next_cursor`) le exige
   al consumidor (FE) alguna lógica adicional para no confundir al cliente
   final con ese corrimiento — o si el volumen típico esperado (un cliente
   normal difícilmente pasa de una compra por semana) hace que el riesgo sea
   teórico y no práctico.
3. Documentar la conclusión (con evidencia del paso 1) como INSUMO para quien
   diseñe el FE de esta US: no es un defecto de este backend — es información
   sobre un trade-off ya tomado (`design.md` de backend, `offset` en vez de
   cursor) que el consumidor necesita conocer.

**Hallazgos** · _(pendiente de ejecución)_

---

> Los tres charters son **manuales a propósito** (`execution_mode: manual`,
> `QA-015-EXP-1` en `qa-plan.md` §5/§10): lo que exploran es volumen real,
> percepción humana de huso horario, y juicio de UX sobre un contrato ya
> decidido — automatizarlos costaría más que el valor que dan, y ninguno
> bloquea la cobertura automatizada de los 7 AC de la US (100% ejecutable hoy,
> sin bloqueos externos).
