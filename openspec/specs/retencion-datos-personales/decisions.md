# CAP-13 Retención y anonimización de datos personales — Decisiones

Decisiones que gobiernan el estado vivo de la capacidad. Los ADR son la
fuente de verdad; acá se registra **cuál aplica a esta capacidad y por qué**.

## ADRs que aplican

| ADR | Decisión | Impacto en esta capacidad |
|---|---|---|
| ADR-0009 | Seam de auth admin (`AdminGuard`, `role=admin`). | Ambos endpoints son admin-only, mismo guard que el resto de `/v1/admin/*` — sin modificar. |
| ADR-0012 | Ejecución in-process mientras Redis/BullMQ no esté aprovisionado (enmienda a ADR-0004). | Aplicada por tercera vez en el proyecto (import, US-014, y ahora esto) — el barrido corre al arrancar la API (`onApplicationBootstrap`) y bajo demanda vía `POST /retention-sweep`, sin cola real. |

Ninguna decisión de este change abre un ADR nuevo — la aplicación de
ADR-0012 a este dominio ya tenía dos precedentes en el repo, así que se
aplicó directo, sin abrir pregunta al usuario.

## Decisiones de implementación

| Decisión | Motivo |
|---|---|
| Extiende `checkout/` (`OrdersRepository`, único punto de ORM) en vez de abrir un módulo `orders` admin dedicado. | No hay dueño natural distinto todavía para la superficie admin de órdenes — `US-012-panel-ordenes-dueno-backend` seguía `Ready` sin change de backend al momento de planificar esto. |
| `anonymized_at`/`anonymization_reason` como dos columnas nuevas en `orders` con un `CHECK` de consistencia cruzada, no una tabla `order_anonymizations` separada. | La relación es 1:1 con la orden y el estado de anonimización es un atributo de la orden, no un evento con historial propio — una tabla separada exigiría un JOIN en cada lectura sin ganar nada (mismo criterio que otros changes del repo para atributos de control 1:1). |
| `TEXT` + `CHECK` para `anonymization_reason`, no un `enum` de Prisma. | El resto del schema usa `String` + `CHECK`/`@default` para campos de estado cerrado (`Order.status`, `Product.status`) — no hay un solo `enum` de Postgres en la base; mantener el mismo idioma evita una migración de tipo distinta al resto. |
| `POST /retention-sweep` responde síncrono, no `202`+polling. | No hay transformación por fila (a diferencia del import, que sí la tiene) — es un único `UPDATE` de conjunto sobre un índice de rango, barato incluso a varios cientos de filas. El contrato asíncrono del import existe para un problema que este endpoint no tiene. |
| Sin índice nuevo para el predicado `anonymized_at IS NULL AND created_at < cutoff`. | YAGNI — el volumen esperado (algunos cientos de órdenes/mes, una sola sucursal) hace aceptable un *sequential scan* ocasional; un índice parcial es la primera palanca si el volumen crece un orden de magnitud, documentado como nota para esa revisión futura. |
| `access_token_hash` fuera de alcance — decisión explícita, no un olvido. | No es PII (hash de un token aleatorio de 256 bits, no derivado de datos personales); revocarlo rompería la consulta de estado del invitado (US-009 `/latest`) que ningún AC de esta US pide tocar. |
| Sin `Idempotency-Key` en ninguna de las dos rutas. | El riesgo que protegería (doble efecto de un retry) ya está resuelto por el `WHERE anonymized_at IS NULL` del propio `UPDATE` — agregar la máquina de claves encima sería protección duplicada sin ganancia. Misma deviación en espíritu que ya declaró US-008 para el checkout. |
| Rate-limits asimétricos: 30/min (`:id/anonymize`, acción humana puntual) vs 5/hora (`retention-sweep`, deliberadamente angosto). | Un disparador externo mal configurado en loop sobre el barrido no debería poder convertir una operación barata en una carga recurrente indeseada; la acción a pedido del dueño no tiene ese riesgo (es él respondiendo a un pedido puntual). |
| `reason` nunca viene del body — el controller lo fija server-side en las dos rutas. | Elimina toda superficie de tampering sobre el motivo de anonimización; ninguna de las dos rutas tiene `@Body()`. |

## Riesgo de reconciliación con `ordenes` (US-012)

El futuro DTO de lectura de una orden (`AdminOrderDetail`, capacidad
`ordenes`) **debe** exponer `anonymized_at`/`anonymization_reason` para que
el AC-5 de esta US sea observable desde el panel — hoy no los expone (ver
`requirements.md` D-1). Esta nota se declaró en el `design.md` original de
US-021 como *open question* para quien planificara `US-012-panel-ordenes-dueno-backend`,
pero ese change ya se planificó y archivó sin incorporarla (`ordenes/`
archivado antes que esta capacidad). Queda registrada acá como deuda
explícita, no oculta, para la próxima vez que se toque `ordenes/`.

## Desviaciones conscientes registradas

- **El spec publicado (`apps/api/docs/api/openapi.yaml`) no incluye estos 2
  endpoints.** El `tasks.md` de este change no tuvo una task de "mergear al
  spec publicado" (a diferencia de otros changes archivados, que sí la
  tenían) — la capacidad vive hoy sólo en el contrato acumulado de
  `openspec/specs/`, seedeado directo desde los dos yaml draft del change
  (`contracts/openapi/anonymize-order.yaml` + `retention-sweep.yaml`).
  Brecha conocida, no bloqueante para el archive (los dos yaml lintean
  limpio y describen fielmente lo implementado).
