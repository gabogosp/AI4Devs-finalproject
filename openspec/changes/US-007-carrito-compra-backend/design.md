---
parent-us: US-007
discipline: backend
language: es
---

# US-007 Backend — Diseño

## Qué se hereda del E2E (no se re-decide acá)

- **Módulo `cart` propio** (§6 Component): no se cuelga del storefront. El
  storefront es superficie de **lectura** pública y cacheable; el carrito es
  **escritura** por cliente y no cacheable. Mezclarlos haría que el interceptor de
  caché del storefront tuviera que aprender a excluir rutas, que es justo el tipo
  de excepción que después alguien olvida.
- **DER §8**: `carts` (id, customer_id, session_token, created_at) y `cart_items`
  (id, cart_id, product_id, quantity, unit_price_ars_cents).
- **ADR-0008**: el stock se descuenta al aprobarse el pago. El carrito no reserva.
- **NFR §17**: p95 de escritura < 500 ms.

## Persistencia

### `carts`

| Columna | Tipo | Nota |
|---|---|---|
| `id` | uuid PK | |
| `customer_id` | uuid FK null | **Creada y sin escribir en US-007** (OQ-BE-3). `Deferred: fusión guest→cuenta — owner: PO` |
| `session_token` | text UNIQUE | Hash SHA-256 del token de la cookie, **nunca el claro** |
| `expires_at` | timestamp | **Columna agregada al DER** — ver abajo |
| `created_at` | timestamp | |
| `updated_at` | timestamp | **Columna agregada al DER** — ver abajo |

**Dos columnas que el DER no declara y que hacen falta.** El DER se escribió sin
fijar la política de expiración; AC-4 la exige y OQ-BE-2 la fijó en 7 días. Sin
`expires_at` no hay forma de saber cuándo vence un carrito, y sin `updated_at` no
hay forma de renovarlo cuando el cliente vuelve a tocarlo — el carrito se moriría
a los 7 días de creado aunque la persona lo hubiera usado ayer. Se declaran acá
explícitamente en vez de agregarlas al pasar, porque son un delta sobre un
documento aprobado.

**`session_token` guarda el hash, no el claro.** El DER dice `string
session_token` sin especificar. Se aplica el mismo criterio de §3.7 que US-014
usó para los refresh tokens: una filtración de la base no debe entregar carritos
usables. El costo es nulo —la búsqueda es por igualdad sobre un índice UNIQUE—
y el beneficio es que el dump de la tabla deja de ser una lista de capacidades.

### `cart_items`

| Columna | Tipo | Nota |
|---|---|---|
| `id` | uuid PK | |
| `cart_id` | uuid FK → carts | `ON DELETE CASCADE` |
| `product_id` | uuid FK → products | `ON DELETE CASCADE` |
| `quantity` | int | `CHECK (quantity > 0)` |
| `unit_price_ars_cents` | int | Precio **al agregar**. No participa del cálculo (OQ-BE-1) |
| `created_at` | timestamp | |

**`UNIQUE (cart_id, product_id)`** — un producto, una fila (OQ-BE-4). Agregar dos
veces suma la cantidad.

**`CHECK (quantity > 0)`** — la barandilla final. La validación de rango vive en
el DTO y en el service, pero un `quantity: 0` que llegara por otro camino
convertiría el ítem en un fantasma: presente en la tabla, invisible en la UI,
sumando 0 al total. Que la base lo rechace cierra la clase entera.

**Cascadas.** Borrar un producto se lleva sus filas de carrito. Es lo correcto:
un `cart_item` apuntando a un producto inexistente no tiene lectura posible. En
la práctica el catálogo **archiva** en vez de borrar (US-001), así que el camino
normal es que el ítem sobreviva marcado `unpublished` — la cascada es la red para
el borrado duro.

### Índices

- `carts.session_token` UNIQUE — el lookup de cada request.
- `carts.expires_at` — la limpieza oportunista.
- `cart_items.cart_id` — el listado del carrito.
- `cart_items (cart_id, product_id)` UNIQUE — el upsert al agregar.

## Identidad del carrito

La cookie `dsm_cart` lleva un token opaco de 256 bits generado con el CSPRNG,
reusando `newToken()`/`hashToken()` de `auth/tokens/opaque-token.ts` (US-014).
**No se escribe una primitiva nueva**: si hubiera dos generadores de tokens en el
repo, uno de los dos terminaría siendo el débil.

Atributos (§7.4): `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age` = 7 días,
`Secure` desde `AUTH_COOKIE_SECURE` — la misma variable que gobierna las cookies
de sesión, para que no haya dos verdades sobre si el entorno tiene TLS.

**`HttpOnly` aunque no sea una sesión.** El carrito no da acceso a datos
personales, pero sí revela qué está por comprar una persona, y un script
inyectado que pueda leer el token puede vaciarle el carrito a alguien. No hay
razón para que el JavaScript del sitio necesite leerlo.

### Creación perezosa

**Sólo las mutaciones crean carrito.** `GET /v1/cart` sin cookie devuelve un
carrito vacío y **no** emite cookie ni crea fila. Si creara, cada bot que pasa por
el sitio dejaría una fila y una cookie, y la tabla crecería con el tráfico de
crawlers en vez de con el de clientes.

## Cálculo de importes (AC-9)

```
subtotal_ítem = product.price_ars_cents × quantity      ← precio VIVO
total         = Σ subtotales de los ítems disponibles
```

Los ítems no disponibles **no suman** al total: mostrar un total que incluye algo
que no se puede comprar es peor que no mostrarlo, porque el número que la persona
memoriza no es el que va a pagar.

`price_changed = item.unit_price_ars_cents !== product.price_ars_cents` — se
devuelve junto con `unit_price_ars_cents_at_add` para que el FE pueda decir "salía
X, ahora sale Y". Enterarse en el carrito es recuperable; enterarse en el
checkout es una compra abandonada.

## Disponibilidad por ítem (AC-6)

| Estado | Cuándo | Suma al total |
|---|---|---|
| `available` | `status='published'` y `stock >= quantity` | sí |
| `unpublished` | `status` es `draft` o `archived` | no |
| `out_of_stock` | publicado pero `stock < quantity` | no |

Se **marca**, no se borra ni se ajusta la cantidad sola. Bajarle la cantidad a
alguien sin avisarle produce el peor resultado posible: la persona paga menos de
lo que creía llevar y se entera cuando retira.

## Límite de cantidad contra stock (AC-5)

Al agregar y al editar, `quantity` no puede superar `product.stock` **en ese
instante**. Es un chequeo de cortesía, no una garantía: entre el chequeo y el pago
el stock puede caer, y por eso US-008 revalida y US-010 usa el UPDATE condicional
atómico de ADR-0008. El plan **no** intenta cerrar esa ventana acá — cerrarla
requeriría reservas, que es exactamente lo que ADR-0008 descartó.

**Tope duro de 99 unidades por ítem**, además del stock. Sin tope, un `quantity`
de 10 millones pasa la validación el día que el dueño cargue stock alto, y el
total desborda el rango del entero. Es una barandilla de integridad, no de
negocio.

## AC-8 — el negative space, y cómo se prueba

`products.stock` **no se lee para escribir** en ningún camino de esta US: se lee
para comparar y nada más. No hay columna de reserva, ni contador de "en
carritos", ni tabla intermedia.

Se prueba de la única forma que sirve: un test que agrega el mismo producto a
**dos carritos distintos** hasta el límite del stock, y verifica que las dos
operaciones tienen éxito y que `products.stock` **no cambió**. Un test que sólo
mirara un carrito no distinguiría "no reserva" de "reserva y todavía no la usó".

## Errores de dominio

Catálogo cerrado, mapeado por el `HttpProblemFilter` existente sin tocarlo:

| Error | Status | `type` |
|---|---|---|
| `CartItemNotFoundError` | 404 | `dsm:cart/item-not-found` |
| `ProductNotPurchasableError` | 409 | `dsm:cart/product-not-purchasable` |
| `InsufficientStockError` | 409 | `dsm:cart/insufficient-stock` |
| (validación de DTO) | 422 | `dsm:catalog/validation` |

**`ProductNotPurchasableError` no distingue "no existe" de "no publicado"**
(AC-10). Distinguirlos convertiría el endpoint en un oráculo de qué SKUs existen
en borrador — la misma clase de fuga que US-003 cerró con su 404 uniforme.

**`InsufficientStockError` sí devuelve el máximo disponible** en `errors[]`. Acá
no hay nada que ocultar: el stock disponible ya es público vía `in_stock` de la
ficha, y sin el número el FE no puede ofrecer "llevar 3 en vez de 5".

## Rate limit

Throttler `cart` **nuevo**, tercero del array. US-014 tuvo la regla contraria —no
agregar un throttler y usar `@Throttle` sobre el existente— porque compartía la
superficie de auth. Acá es distinto: el carrito es una superficie pública de
escritura con un perfil de tráfico propio (muchas más operaciones legítimas por
sesión que un login), y meterlo en el presupuesto de `auth` haría que armar un
carrito grande consumiera el presupuesto de login del mismo cliente.

`60 / 15 min` por IP en las mutaciones. `GET /v1/cart` va con el throttler
`storefront` que ya existe.

## Observabilidad

`CartEventsService`, espejo de `AuthEventsService` (US-014):

| Evento | Cuándo | `entity_id` |
|---|---|---|
| `cart.item_added` | alta o suma de cantidad | `product_id` |
| `cart.item_updated` | cambio de cantidad | `product_id` |
| `cart.item_removed` | baja | `product_id` |
| `cart.viewed` | `GET /cart` con ítems | `cart_id` |
| `cart.item_unavailable_shown` | se devolvió un ítem no disponible | `product_id` |

`cart.item_added` es el insumo directo del embudo de conversión de US-016, y
`cart.item_unavailable_shown` es el que dice cuánta compra se pierde por catálogo
desactualizado — un número que hoy nadie tiene.

**El `session_token` no entra en ningún log** (§9), ni hasheado: es una capacidad
al portador, y un log con tokens es una lista de carritos ajenos.

## Limpieza de carritos vencidos

Oportunista y acotada, igual que US-014 con los refresh: al crear un carrito se
borran los vencidos **de esa misma sesión**. La purga global necesita BullMQ y
Redis no está provisionado (ADR-0004) — `Deferred: US-019 / operaciones`.

> **Consecuencia declarada**: sin purga programada, las filas de carritos
> abandonados por clientes que nunca vuelven **quedan**. Con 50 concurrentes y
> 7 días de TTL el volumen es despreciable, pero es deuda real y está anotada, no
> silenciada.

## Consideraciones de despliegue

- **Migración puramente aditiva**: dos tablas nuevas, cero `ALTER` sobre las
  existentes. No requiere expand-and-contract ni ventana.
- **Sin variables de entorno nuevas obligatorias.** `CART_TTL_DAYS` se agrega con
  default 7, así que un deploy sin tocarla se comporta como lo decidido.
- **Sin feature flag.** La superficie es nueva: no hay comportamiento previo que
  pueda romperse, y las rutas no existen hasta que el deploy las crea.
- **Rollback**: quitar el módulo. Las tablas quedan vacías y sin lectores.
- **No requiere `/plan-deployment`.**

## Anti-patrones evitados

- **Reservar stock al agregar** — contradice ADR-0008. Sería la implementación
  "obvia" y rompe el modelo entero.
- **Cachear el carrito** — AC-9. El carrito es la superficie donde una caché
  produce el peor daño posible: un precio viejo que la persona ya decidió pagar.
- **Borrar solo los ítems no disponibles** — AC-6 pide señalarlos.
- **Devolver el precio guardado** — AC-9. La columna existe y no se usa para
  calcular; el test lo ancla.
- **Un throttler por ruta** — se agrega **uno** para toda la superficie de
  carrito, no cinco.
