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
archivado antes que esta capacidad). Quedó registrada acá como deuda
explícita, no oculta.

**RESUELTO (2026-09-05, fix/US-021-publish-order-anonymization-contract)**: al
planificar el FE de US-021 (`/plan-frontend-web-ticket US-021`), el bloqueo se
hizo concreto — sin estos 2 campos ni el spec publicado, el codegen del panel
no podía generar el cliente. Se extendió `AdminOrderDetailDto.fromWithHistory`
(`apps/api/src/orders/dto/order.dto.ts`) con `anonymized_at`/
`anonymization_reason` (ambas columnas ya existían en `orders`, sólo faltaba
proyectarlas al DTO) y se documentaron en el schema `AdminOrderDetail` de
`openspec/specs/ordenes/contracts/openapi.yaml` (living contract) y de
`apps/api/docs/api/openapi.yaml` (spec publicado). Ver la desviación de abajo
para el segundo fix (publicar los 2 endpoints).

## Decisiones de US-020 (borrado de cuenta)

| Decisión | Motivo |
|---|---|
| Anonimizar la fila de `customers` (soft-delete), no borrado físico. | Mismo idioma que esta capacidad ya aplicaba a `orders` — conserva el vínculo orden↔cliente que sostiene los agregados de `metricas` (CAP US-016), sin romper integridad referencial (que de todos modos no se habría roto: las 4 relaciones de `customers` ya declaran `onDelete` propio). |
| Tercer valor de `anonymization_reason` (`account_deletion`) en vez de reusar `'requested'`. | Disparadores estructuralmente distintos: `'requested'` es una acción del DUEÑO sobre una orden puntual a pedido del comprador invitado; `'account_deletion'` es el efecto en cascada de que el TITULAR borró su cuenta entera, todas sus órdenes de una vez, disparado por el propio cliente. |
| `AccountModule` nuevo, fuera de `AuthModule`, importando `AuthModule`+`CheckoutModule`+`CartModule` de forma acíclica. | `CheckoutModule` ya importa `AuthModule` — `AuthModule` no puede importar de vuelta sin ciclo. Misma forma que `OrdersModule` (capacidad `historial-compras`) ya probó para `auth`+`checkout`. |
| `sessionCookie` en vez de `adminBearer` para este único endpoint de la capacidad. | Es la primera y única superficie de esta capacidad donde el AUTOSERVICIO del cliente (no una acción del dueño) dispara la anonimización — coherente con que US-020 es autoservicio por decisión de producto explícita (US §10, decisión 4). |
| Placeholder de email único por fila (`cuenta-borrada+{customerId}@...`), no fijo como el de `orders.buyer_email`. | `customers.email` tiene `UNIQUE` (a diferencia de `orders.buyer_email`) — un valor fijo colisionaría en el segundo borrado, y la decisión de producto 2 exige que el email real quede libre para re-registro sin bloquear el próximo borrado. |
| Sin `Idempotency-Key` — mismo argumento que ya declaró esta capacidad para sus 2 endpoints originales. | El `WHERE deleted_at IS NULL` de `CustomersRepository.anonymize` ya resuelve estructuralmente el doble efecto de un doble clic/retry. |

## Decisiones de US-020 frontend-web (archivada 2026-09-06)

| Decisión | Motivo |
|---|---|
| `blockingOrders` en `AppError.conflict` se tipa `status: string`, no el enum generado (`OrderHistorySummaryStatus`). | **Drift de contrato encontrado al planificar**: `AccountHasActiveOrdersProblem.blocking_orders` reusa el schema `OrderHistorySummary` de US-015, cuyo enum (`new\|preparing\|ready\|delivered\|cancelled`) no declara `pending_payment` — uno de los 4 valores que `BLOCKING_ORDER_STATUSES` del backend puede legítimamente devolver, y el más probable en la práctica. Tipar `string` evita que la UI reviente o descarte el dato ante un valor real que el contrato publicado no admite. No corregido en este change (requiere tocar `apps/api/docs/api/openapi.yaml`, fuera de alcance FE-only) — recomendado como follow-up de backend. |
| Lookup de etiquetas de estado LOCAL a la feature (`BLOCKING_STATUS_LABEL`), no reuso de `OrderStatusBadge`. | `OrderStatusBadge.status` está tipado al enum ADMIN de 5 valores (sin `pending_payment`) — pasarle el valor real ni siquiera compilaría. |
| La confirmación post-borrado se levanta a un componente nuevo (`MiCuentaScreen`), hermano de `CustomerGuard`, no hijo de `AccountPanel`. | `CustomerGuard` oculta sus `children` en el MISMO render en el que la sesión pasa a `anonymous` — un mensaje de éxito que viviera dentro del árbol que el guard protege nunca llegaría a pintarse. Ver `design.md` §D3 del change para el mecanismo completo (batching de React). |
| `SessionProvider` gana `accountDeleted()` en vez de reusar `logout()`. | `logout()` hace un `POST` al backend antes de limpiar el estado local; el `DELETE /v1/me` ya cerró la sesión del lado del servidor en la misma respuesta (`204`) — un segundo `POST` de logout sería una escritura redundante contra una sesión que ya no existe. |
| E2E dev-owned de topología (`account-deletion-topology.spec.ts`) agregado explícitamente en este change, no diferido a QA. | Auditando el precedente se encontró que `US-015-historial-compras-frontend-web` (archivada) no tenía ninguna task de esta familia — exactamente el hueco que dejó pasar a producción el bug real del rewrite `/v1/me/:path*` ausente (PR #89), encontrado recién por el E2E cross-stack de QA en vez de por el propio change de FE. Este change cierra esa clase de gap para sí mismo en vez de repetirla. |
| Manejo de error del diálogo destructivo se aparta del precedente (`OrderCancelAction`/`OrderAnonymizeAction`, que dejan el diálogo abierto tras un error): acá SIEMPRE se cierra. | El 409 de esta US puede traer una LISTA de varios pedidos bloqueantes — atenuarla detrás del overlay semitransparente del diálogo es una degradación real de legibilidad que el caso de una sola línea (el precedente) no tenía. |

## Desviaciones conscientes registradas

- **RESUELTO (2026-09-05, fix/US-021-publish-order-anonymization-contract)**:
  el spec publicado (`apps/api/docs/api/openapi.yaml`) no incluía estos 2
  endpoints. El `tasks.md` de este change no tuvo una task de "mergear al
  spec publicado" (a diferencia de otros changes archivados, que sí la
  tenían) — la capacidad vivía sólo en el contrato acumulado de
  `openspec/specs/`, seedeado directo desde los dos yaml draft del change.
  Se mergearon `POST /admin/orders/{id}/anonymize` y
  `POST /admin/orders/retention-sweep` (tag `admin-orders-retention`) al spec
  publicado, reusando los componentes compartidos existentes
  (`#/components/responses/Problem`, `RateLimited`, `#/components/parameters/Id`)
  en vez de duplicar los que declaraban los yaml draft en aislamiento.
