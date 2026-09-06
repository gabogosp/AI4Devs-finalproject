---
parent-us: US-015
discipline: backend
variant: null
language: es
---

# US-015 Backend — Historial de compras del cliente registrado — Design

## Context

Dos cosas tienen que existir para que el AC-1 de la US sea verificable: (1) que
algunas órdenes tengan `customer_id` seteado, y (2) que exista una lectura
autorizada de esas órdenes. Hoy sólo falta la primera — `apps/api/src/checkout/`
es 100% guest (verificado con `grep -rn "customer" apps/api/src/checkout/*.ts`,
sin resultados no-spec) y el propio DER (`packages/db/prisma/schema.prisma`,
comentario del modelo `Order`) asigna ese escritor a esta misma US. Este design
cubre ambas partes como un solo cambio coherente: el escritor no tiene sentido
sin el lector, y el lector no tiene nada que leer sin el escritor.

La restricción que gobierna todo: **el checkout guest de US-008 no puede
cambiar de comportamiento observable**. `CustomerGuard` (US-014) es fail-closed
por diseño — cualquier cosa que no sea una sesión válida termina en 401 — y ese
comportamiento es exactamente lo que el checkout NO puede tener, porque el
comprador invitado es el camino principal del PRD (§2.1 cap. 4). De ahí nace la
necesidad de una variante que nunca bloquee.

## Goals

- Escritor de `orders.customer_id` en el checkout, activado sólo cuando hay
  sesión de cliente válida, sin alterar el comportamiento guest.
- Lector autenticado de "mis órdenes" (listado + detalle) con autorización
  estructural (en el WHERE, no en un chequeo posterior) y filtro de retención.
- Cero duplicación de la lógica de verificación de JWT/cookie entre
  `CustomerGuard` y la nueva variante opcional.
- Cero duplicación del cálculo del corte de retención entre el barrido de
  US-021 y este historial.

## Non-goals

- Fusionar retroactivamente órdenes guest existentes a una cuenta (AC-6, US §4).
- Reordenar / re-comprar / cancelar desde el historial (US §4).
- Cambiar el contrato público de `POST /v1/checkout` (la respuesta no gana
  campos; `customer_id` nunca sale a la red).
- Resolver qué hace el frontend con las órdenes anonimizadas (fuera del alcance
  backend).

## Approach

### D1 — `resolveCustomerSession()`: un solo lugar para verificar el JWT de cliente

`CustomerGuard` (US-014) ya implementa la verificación correcta: cookie
`ACCESS_COOKIE`, `algorithms: ['HS256']` pineado, `issuer`/`audience`
verificados, `typ === 'access'`, `role === ROL_CLIENTE`, `sub`/`jti` presentes.
Ese bloque se extrae tal cual (Extract Method, `refactoring-discipline`) a una
función pura en `auth/resolve-customer-session.ts`:

```ts
export interface CustomerSession { customerId: string; accessJti: string; }

export async function resolveCustomerSession(
  req: Request, jwt: JwtService, config: ConfigService,
): Promise<CustomerSession | null> {
  // cookie ausente/vacía, firma inválida, iss/aud, typ, role, claims
  // faltantes: TODO colapsa a `null`. Nunca lanza.
}
```

`CustomerGuard.canActivate` pasa a ser: llamar al helper, `throw
UnauthenticatedError()` si `null`, o setear `req.customerId`/`req.accessJti` y
devolver `true`. Comportamiento **idéntico** al actual — es un refactor puro, no
un cambio funcional — y `customer-guard.spec.ts` (existente, sin modificar) es
el test de caracterización que lo prueba.

`OptionalCustomerGuard` (nuevo, mismo archivo de helper) es la pieza que la US
pedía y no existía:

```ts
@Injectable()
export class OptionalCustomerGuard implements CanActivate {
  async canActivate(context): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestConCliente>();
    const session = await resolveCustomerSession(req, this.jwt, this.config);
    if (session) {
      req.customerId = session.customerId;
      req.accessJti = session.accessJti;
    }
    return true; // NUNCA bloquea — el checkout sigue siendo guest-first
  }
}
```

La diferencia entera entre las dos clases es qué hacen cuando `resolveCustomerSession`
devuelve `null`: una lanza, la otra sigue. Ningún otro archivo vuelve a tocar un
JWT de cliente a mano.

`AuthModule` registra `OptionalCustomerGuard` como provider y lo exporta junto a
`CustomerGuard` — ambos viven donde ya vive el seam de sesión (§5 backend-node-standards,
capas: nada de guards sueltos definidos en el módulo que los consume).

### D2 — El checkout: guard opcional + un campo nuevo en una escritura que ya existe

`CheckoutController.create` agrega `OptionalCustomerGuard` a los guards del
único handler (`@UseGuards(CartCsrfGuard, OptionalCustomerGuard)`). El orden no
importa funcionalmente: el guard opcional nunca lanza, así que no puede
interferir con `CartCsrfGuard`.

`CheckoutService.createOrder` lee `req.customerId` con el mismo patrón que ya
usa para el `trace` (`CheckoutService.traceDe(req)` existente):

```ts
private static customerIdDe(req: Request): string | undefined {
  return (req as RequestConCliente).customerId;
}
```

y lo pasa a `OrdersRepository.createPendingOrder({ ..., customerId })`.
`CreatePendingOrderData` gana `customerId?: string`; el único `INSERT` de la
transacción (`tx.order.create`, sin abrir una segunda transacción) escribe
`customer_id: data.customerId ?? null`. La columna, su FK (`onDelete: SetNull`)
y su índice **ya existen** en el schema — este change sólo le agrega el primer
escritor.

**Por qué el guard opcional y no un chequeo manual dentro del service**: el
service ya recibe `req` crudo (precedente: `traceDe`), así que la superficie de
cambio es la misma clase que ya lee `req` — no se introduce un nuevo punto de
acceso a Express en capas más internas. El guard sigue siendo la única
autoridad que decide si un JWT de cliente es válido; el service sólo lee el
resultado que el guard ya dejó en `req`.

**Prueba de que el invitado no se rompe**: la suite completa de
`e2e-checkout-*.spec.ts` + `checkout.service.spec.ts` + `checkout.module.spec.ts`
corre **sin modificar una sola aserción existente** — sólo se agregan casos
nuevos. Si el guest checkout cambiara de comportamiento, esos tests (que no
mandan ninguna cookie de cliente) fallarían exactamente igual que antes de este
change. Esa es la garantía de "cero cambio observable" — no una afirmación,
un `Verify:` (tasks.md, Fase 5).

### D3 — Lectura: autorización en el WHERE, nunca después de leer

`OrdersRepository` (único punto de ORM de `orders`/`order_items`, §5) gana dos
métodos de lectura, ninguno reutiliza los de US-012/US-021 porque ninguno de
esos filtra por `customer_id` + retención a la vez:

```ts
async listByCustomer(
  customerId: string,
  filter: { cutoff: Date; limit: number; offset: number },
): Promise<{ data: Order[]; total: number }> {
  const where = {
    customer_id: customerId,
    status: { not: 'pending_payment' },
    created_at: { gte: filter.cutoff },
  };
  const [data, total] = await this.prisma.$transaction([
    this.prisma.order.findMany({
      where, orderBy: { created_at: 'desc' },
      take: filter.limit, skip: filter.offset,
    }),
    this.prisma.order.count({ where }),
  ]);
  return { data, total };
}

findByOrderNumberForCustomer(
  orderNumber: number, customerId: string, cutoff: Date,
): Promise<OrderWithItems | null> {
  return this.prisma.order.findFirst({
    where: {
      order_number: orderNumber,
      customer_id: customerId,
      status: { not: 'pending_payment' },
      created_at: { gte: cutoff },
    },
    include: { items: true },
  });
}
```

`findByOrderNumberForCustomer` NO separa "orden inexistente" de "orden ajena" —
ambas devuelven `null` → 404 (`OrderNotFoundError`, reusada de
`checkout-errors.ts`, misma superficie conceptual "la orden no existe"). Es la
misma disciplina que ya aplica `threat-modeling-lite` §"Superficie 4" (IDOR):
la propiedad se verifica en la query, no en un `if` después de traerla — así es
estructuralmente imposible, no una excepción que alguien podría olvidar
atrapar.

**Por qué se excluye `pending_payment`**: es un checkout iniciado y nunca
pagado — no es una "compra" en el sentido de AC-1 ("realizó compras estando
logueado"). El panel admin (US-012) ya trata `pending_payment` como invisible
por la misma razón de negocio; acá se aplica el mismo criterio, no una regla
nueva.

**Por qué el identificador público es `order_number` y no el UUID**: mismo
precedente que `CheckoutResponseDto` — "el `order_id` UUID interno no se expone
(...) la identidad pública de la orden es `order_token` (...) y `order_number`
(legible)". El historial no tiene motivo para romper esa regla; `order_number`
también resuelve la URL humana ("ver el pedido #1042").

### D4 — Corte de retención: un solo cálculo, dos consumidores

`OrdersRetentionService.cutoffDate()` (US-021) calcula `now - N meses` con
`setMonth`. Este change lo extrae a una función pura,
`checkout/retention-cutoff.ts`:

```ts
export function computeRetentionCutoff(months: number, now: Date = new Date()): Date {
  const d = new Date(now);
  d.setMonth(d.getMonth() - months);
  return d;
}
```

`OrdersRetentionService.cutoffDate()` pasa a ser un `return
computeRetentionCutoff(this.retentionMonths)`. La nueva `OrdersHistoryService`
importa la misma función. Ningún archivo vuelve a calcular un corte de
retención con su propia aritmética de fechas — si el cálculo cambia (por
ejemplo, a días en vez de meses), cambia en un solo lugar y ambos consumidores
lo heredan.

### D5 — Módulo, controller, DTOs

El nuevo `OrdersHistoryController` (`v1/me/orders`) vive en `orders/` (no en
`checkout/`): es la misma bounded context de "una orden, vista por alguien",
y `orders.module.ts` ya importa `AuthModule` (tiene `CustomerGuard`) y
`CheckoutModule` (tiene `OrdersRepository` exportado) — cero imports nuevos.

```ts
@Controller('v1/me/orders')
@UseGuards(OrdersHistoryThrottlerGuard, CustomerGuard)
@SkipThrottle({ auth: true, storefront: true, cart: true, enrichment: true,
                search: true, checkout: true, payments_simulate: true })
export class OrdersHistoryController {
  @Get()
  @Throttle({ orders_history: { limit: ORDERS_HISTORY_RATE_LIMIT_MAX } })
  list(@Query() query: ListOrderHistoryQueryDto, @Req() req: RequestConCliente) { ... }

  @Get(':order_number(\\d+)')
  @Throttle({ orders_history: { limit: ORDERS_HISTORY_RATE_LIMIT_MAX } })
  detail(@Param('order_number', ParseIntPipe) n: number, @Req() req: RequestConCliente) { ... }
}
```

`OrdersHistoryThrottlerGuard` es un espejo de `CheckoutThrottlerGuard`
(cabeceras `RateLimit-*`/`Retry-After`, `api-standards` §12). El throttler
nombrado `orders_history` se agrega al array de `ThrottlerModule.forRootAsync`
en `auth.module.ts` con el mismo criterio que `checkout`/`search`/
`enrichment`/`payments_simulate`: **techo `Number.MAX_SAFE_INTEGER` en el
registro global, presupuesto real (`ORDERS_HISTORY_RATE_LIMIT_MAX`, default 60)
en el `@Throttle` del handler**. Es el único patrón que evita agregar
`@SkipThrottle({ orders_history: true })` a los ~10 controllers existentes:
`@nestjs/throttler` aplica TODOS los throttlers nombrados a TODA ruta guardada
por cualquier `ThrottlerGuard`, así que un límite bajo en el registro global se
lo impondría también al carrito, al storefront y a auth.

DTOs nuevos (`orders/dto/order-history.dto.ts`, archivo propio — no se agranda
`order.dto.ts` porque las formas de cliente y de admin divergen: el cliente
nunca ve el UUID interno ni el contacto del comprador):

- `ListOrderHistoryQueryDto` — `limit`/`offset` (mismos límites que
  `ListOrdersQueryDto` admin); sin `sort` ni `status` parametrizables — AC-1
  fija el orden (`-created_at`) y el filtro (no `pending_payment`) como reglas
  de negocio, no como opciones del cliente.
- `OrderHistorySummaryDto` — `order_number`, `status`, `total_ars_cents`,
  `created_at`. Sin `id`, sin `buyer_name`/`buyer_email`/`buyer_phone` (AC-1
  sólo pide fecha/estado/total; el comprador ya sabe quién es).
- `OrderHistoryDetailDto extends OrderHistorySummaryDto` — suma `fulfillment` +
  `items: AdminOrderItemDto[]` (AC-2). Reusa `AdminOrderItemDto.from()`
  (`orders/dto/order.dto.ts`, ya exportada) en vez de duplicar la proyección de
  ítem — misma forma (`product_name`, `product_sku`, `quantity`,
  `unit_price_ars_cents`, `subtotal_ars_cents`) sirve para el panel admin y
  para el cliente por igual; nada en esa clase es admin-only.

### D6 — Observabilidad

`OrdersHistoryEventsService` (`observability/`), mismo esqueleto que
`CheckoutEventsService`/`OrdersRetentionEventsService`: delega el contador en
`MetricsService`, `@Optional()`, cero PII en la firma. Eventos:
`orders_history.list_viewed`, `orders_history.detail_viewed`,
`orders_history.detail_not_found` — el `customerId` (pseudónimo interno, no
PII per `observability-standards.md` §9) va sólo al **log** (`entity_id`),
nunca como dimensión de métrica (cardinalidad).

### Threat model (lite) — `GET /v1/me/orders` y `GET /v1/me/orders/{order_number}`

Superficie 4 de `threat-modeling-lite` (GET autenticado, propio recurso):

| Threat | Vector | Control |
|---|---|---|
| Spoofing | JWT robado lee órdenes ajenas | `CustomerGuard` fail-closed, mismo JWT 15 min + refresh rotado que ya rige toda la sesión de cliente (ADR-0011) |
| Tampering | n/a (read-only) | — |
| Repudiation | Bajo riesgo (lectura propia); igual se deja rastro | `OrdersHistoryEventsService` — un evento por acceso, sin PII, con `trace_id` |
| Info disclosure | IDOR: pedir `order_number` ajeno o fuera de retención | `customer_id` + corte de retención van en el WHERE de la query (D3) — no hay ruta donde el dato ajeno llegue a construirse antes del chequeo |
| DoS | Scraping del propio historial / flood de reads | Throttler nombrado `orders_history` (D5), paginación obligatoria (`limit` máx. 100) |
| Elevation | n/a (nunca escribe) | — |

Superficie 1 (parcial) — el escritor del checkout: el único campo nuevo que
entra al `INSERT` (`customerId`) **nunca viene del cuerpo de la request** —
sale exclusivamente de `req.customerId`, que sólo `OptionalCustomerGuard`
puede setear después de verificar un JWT firmado por el servidor. No hay ruta
por la que un cliente pueda declarar "soy fulano" en el body del checkout.

## Trade-offs

- **`OrdersHistoryController` vive en `orders/`, no en `checkout/`.** Se
  evaluó sumarlo a `checkout/` (que ya acumula retención de US-021 "porque el
  módulo de órdenes admin todavía no existía") y se descartó: ese módulo de
  órdenes admin **ya existe** (US-012), así que la razón que justificaba
  amontonar en `checkout/` ya no aplica acá. `orders/` importa lo que
  necesita sin abrir un ciclo (`orders → checkout`, `checkout` sigue sin
  conocer `orders`).
- **Índice compuesto reemplaza al de una sola columna, no lo suma.** Ningún
  otro método de `OrdersRepository` filtra por `customer_id` solo (se
  verificó: `list`, `findById`, `anonymize*`, `transitionTo*` no lo usan) —
  el índice de una columna quedaría sin ningún consumidor propio después de
  este change. Reemplazarlo no le quita capacidad a nadie y evita mantener
  dos índices que cubren el mismo prefijo.
- **Sin `Idempotency-Key` en los dos GET nuevos.** Son lecturas — la máquina
  de idempotencia de `api-standards.md` §10 es para mutaciones.
- **No se excluyen del historial las órdenes anonimizadas a pedido
  (`anonymization_reason = 'requested'`) que sigan dentro de los 12 meses.**
  El filtro de esta US es el corte de retención (AC-7 literal), no el estado
  de anonimización — que es un evento raro, disparado por el dueño, no por el
  propio cliente. Anonimizar sólo sobrescribe contacto del comprador, nunca
  ítems/importes/estado, así que el historial del cliente no muestra datos
  incorrectos igual. Ver Open questions si se quiere endurecer esto.
- **Sin `Idempotency-Key` tampoco en el escritor del checkout** — no es un
  campo nuevo de la máquina de idempotencia, es una deviación ya declarada
  por US-008 (el checkout entero no la usa, `checkout/decisions.md`); este
  change no la reabre.

## Deployment considerations

Se recomienda `/plan-deployment` para este change. Motivos:

1. **Migración de esquema** (aditiva, índice compuesto sobre `orders` — tabla
   ya en producción potencial de US-008/009/010/012/021).
2. **Modifica el camino crítico del checkout** (tier-1, revenue): aunque el
   cambio es aditivo y la suite existente prueba que el comportamiento guest
   no se mueve, `POST /v1/checkout` es la superficie de escritura pública más
   sensible del proyecto — vale una revisión explícita antes de producción,
   no sólo la suite verde en CI.
3. **Env vars nuevas** (`ORDERS_HISTORY_RATE_LIMIT_MAX`,
   `ORDERS_HISTORY_RATE_LIMIT_TTL_MS`) — sin default peligroso, pero
   `envSchema` las exige al arranque en todo ambiente.
4. **Superficie pública nueva** (`GET /v1/me/orders*`) que expone datos de
   compra a un cliente autenticado — primera vez que un endpoint no-admin
   devuelve datos de `orders`/`order_items`.

No hay secreto nuevo, ni feature flag, ni dependencia externa nueva en el
camino crítico.

## Spec delta (para `/archive-change`)

Capacidad nueva: `historial-compras` (CAP-8, PRD §2.1 cap. 8 —
`docs/_index/us-status.yaml` ya asigna `prd-capacity: 8` a US-015). Este es el
primer change que la entrega — `/archive-change` crea
`openspec/specs/historial-compras/` con `README.md` + `requirements.md` +
`decisions.md` + `contracts/openapi.yaml` (raíz viva) a partir de los dos yaml
de este change (`contracts/openapi/list-order-history.yaml` y
`contracts/openapi/get-order-history-detail.yaml`).

Además, `openspec/specs/checkout/decisions.md` (CAP-10, capacidad ya viva) gana
una fila nueva en su tabla de decisiones de implementación: "El checkout
resuelve `customer_id` vía `OptionalCustomerGuard` si hay sesión — no cambia el
contrato público, sólo agrega un escritor al DER" — sin tocar su
`contracts/openapi.yaml` (la respuesta de `POST /v1/checkout` no cambia de
forma).

## Open questions

- **¿Excluir del historial las órdenes anonimizadas a pedido dentro de los 12
  meses?** Ver Trade-offs — el diseño actual las muestra (con ítems/importes
  intactos, sin contacto real). Si el PO prefiere ocultarlas por completo,
  es un `AND anonymized_at IS NULL` adicional en las dos queries de D3 — no
  bloquea el arranque, se puede sumar en una iteración sin migración.
- **Namespace del frontend** (`/cuenta/pedidos`, `/mis-compras`, u otro):
  decisión de `US-015-historial-compras-frontend-web`, no de este change.

## References

- `packages/db/prisma/schema.prisma` (modelo `Order`, líneas ~290-319;
  `PasswordResetToken` como precedente del índice compuesto, líneas ~222-234)
- `apps/api/src/auth/customer.guard.ts`, `session.service.ts`, `cookies.ts`,
  `auth.module.ts`
- `apps/api/src/checkout/checkout.controller.ts`, `checkout.service.ts`,
  `orders.repository.ts`, `checkout-errors.ts`, `orders-retention.service.ts`,
  `checkout.module.ts`
- `apps/api/src/orders/orders.module.ts`, `orders.controller.ts`,
  `dto/order.dto.ts` (`AdminOrderItemDto`, reusada)
- `apps/api/test/e2e-app.ts` (`bootTestApp`, helpers de token)
- `openspec/changes/archive/US-008-checkout-guest-backend/`
- `openspec/changes/archive/US-014-registro-login-backend/`
- `openspec/changes/archive/US-021-retencion-datos-ordenes-backend/design.md`
  (plantilla de este documento; `cutoffDate()` extraído en D4)
- `openspec/changes/archive/US-012-panel-ordenes-dueno-backend/` (convención de
  paginación `{data, pagination}`, DTOs de orden)
