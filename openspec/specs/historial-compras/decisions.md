# CAP-8 Historial de compras — Decisiones

Decisiones que gobiernan el estado vivo de la capacidad. Los ADR son la fuente de
verdad; acá se registra **cuál aplica a esta capacidad y por qué**.

## ADRs que aplican

| ADR | Decisión | Impacto en esta capacidad |
|---|---|---|
| [ADR-0010](../../../docs/architecture/decisions/) | Namespace de rutas del frontend (`/mi-cuenta/*` es storefront). | Gobierna el namespace elegido por `US-015-historial-compras-frontend-web` (`/mi-cuenta/compras`) — sin conflicto con `/admin/*`. |
| [ADR-0011](../../../docs/architecture/decisions/) | Access JWT corto + refresh opaco server-side (US-014). | `OptionalCustomerGuard` y `CustomerGuard` reusan el mismo mecanismo de verificación sin cambiarlo. |

Ninguna decisión de este change abre un ADR nuevo (verificado contra los ADR
vigentes y el E2E §20).

## Decisiones de implementación

### Desde US-015 backend (archivada 2026-09-06)

| Id | Decisión | Fundamento |
|---|---|---|
| D1 | `resolveCustomerSession()` se extrae de `CustomerGuard` por Extract Method (función pura, nunca lanza) en vez de escribir la verificación JWT/cookie de nuevo para el guard opcional. | Cero duplicación de la lógica de verificación (cookie, `JWT_ISSUER`/`JWT_AUDIENCE`, rol `ROL_CLIENTE`). `customer-guard.spec.ts` (existente) queda sin modificar — prueba que la extracción preserva el comportamiento fail-closed original. |
| D2 | `OptionalCustomerGuard` (nuevo) siempre devuelve `true`; sólo completa `req.customerId` si la sesión resuelve. Se aplica junto a `CartCsrfGuard` en `CheckoutController.create`, no reemplaza ningún guard existente. | El checkout tiene que seguir aceptando invitados — un guard que bloqueara sin sesión rompería US-008 completa. La alternativa (duplicar el controller en una variante "autenticada") multiplicaría la superficie de mantenimiento por una diferencia de una sola columna. |
| D3 | El lector vive en `orders/` (`OrdersHistoryController`, nuevo), no en `checkout/`. Reusa `AdminOrderItemDto.from()` de `orders/dto/order.dto.ts` para la proyección de ítems en vez de duplicarla. | `checkout/` es guest-only por convención de todo el módulo (ver `checkout/decisions.md`); mezclar lectura autenticada ahí rompería esa frontera. `orders/` ya existe (US-012) y ya tiene el patrón de DTOs de sólo lectura para admin — el mismo patrón sirve para cliente. |
| D4 | `computeRetentionCutoff()` se extrae de `OrdersRetentionService` (US-021) a un helper compartido, en vez de que el lector recalcule el corte de 12 meses por su cuenta. | Un solo cálculo del corte de retención en todo el repo — la alternativa (dos implementaciones del mismo `now() - 12 meses`) es exactamente el tipo de divergencia silenciosa que ya causó bugs en otras capacidades de este proyecto. |
| D5 | Autorización estructural: `customer_id` + el corte de retención van en el `WHERE` de la misma query que resuelve la orden — nunca un `SELECT` sin filtrar seguido de un chequeo en memoria. | Es la única forma de que un `order_number` ajeno y uno inexistente sean **estructuralmente** indistinguibles (mismo 404, misma latencia, sin rama de código que un timing attack pudiera explotar) — no depende de que el desarrollador recuerde agregar el chequeo después. |
| D6 | Índice compuesto `orders(customer_id, created_at)` reemplaza el índice de una sola columna sobre `customer_id`, en vez de agregar un segundo índice en paralelo. | El listado siempre filtra por `customer_id` Y ordena por `created_at` — un índice compuesto cubre ambos accesos con una sola estructura; mantener los dos índices por separado sería peso de escritura sin beneficio de lectura adicional. Mismo patrón que `PasswordResetToken` ya usa. |
| D7 | Contrato publicado en un follow-up dedicado (`fix/US-015-publish-order-history-contract`, PR #71), no como task del backend original. | El `tasks.md` original (T6.1) sólo verificaba que los yaml draft lintearan limpio — un gap de proceso, no una decisión de diseño. Se cerró como fix independiente, verificado campo por campo contra el DTO/controller reales antes de publicar, mismo patrón que `US-021-retencion-datos-ordenes-backend` ya había necesitado. |

### Desde US-015 frontend-web (archivada 2026-09-06)

| Id | Decisión | Fundamento |
|---|---|---|
| D8 | Paginación "Cargar más" (append), no una tabla con paginación numerada. | `design-system.md` §7.9 (Table con paginación) es explícitamente un patrón de backoffice; AC-1 fija el orden y prohíbe sort/filtro interactivo del lado del cliente — no hay ninguna interacción que justifique una tabla completa. |
| D9 | Namespace `/mi-cuenta/compras` bajo `(storefront)`, no bajo `/admin`. | ADR-0010 ya declara `/mi-cuenta/*` como storefront (US-014); es la cuenta del cliente, no del dueño — mismo criterio que el resto de esa route group. |
| D10 | Cero componentes de infraestructura nuevos — reusa `CustomerGuard`, `OrderStatusBadge`, `AsyncState`, `formatArs`/`formatDateTime`, `track`/`BusinessEvent`. | El panel del cliente (`AccountPanel`) y el módulo `orders/` del panel admin ya resolvieron estos patrones; duplicarlos para una feature de sólo lectura sería el anti-patrón que `frontend-standards.md` ya prohíbe. |
| D11 | 401 a mitad de sesión y 404 en el detalle se muestran como error inline reintentable (`role="alert"`), sin refresh automático silencioso. | Mismo alcance que el `OrderDetail` del panel admin hoy — no hay AC que pida una reautenticación transparente, y un refresh silencioso escondería al usuario que su sesión venció. |

## Desviaciones conscientes registradas

| Desviación | Motivo |
|---|---|
| El gap de T6.1 (contrato nunca publicado al spec del servicio) se repitió después de que ya había pasado una vez en `US-021-retencion-datos-ordenes-backend`. | Documentado para que quien planifique el próximo backend de este repo revise explícitamente que su `tasks.md` incluya la task de merge al `apps/api/docs/api/openapi.yaml` publicado, no sólo el lint del draft — es la segunda vez que este defecto de planificación aparece con el mismo patrón exacto. |
