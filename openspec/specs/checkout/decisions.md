# CAP-10 Checkout — Decisiones

Decisiones que gobiernan el estado vivo de la capacidad. Los ADR son la fuente de verdad;
acá se registra **cuál aplica a esta capacidad y por qué**.

## ADRs que aplican

| ADR | Decisión | Impacto en esta capacidad |
|---|---|---|
| [ADR-0008](../../../docs/architecture/decisions/) | El stock se descuenta al aprobarse el pago, sin reserva con TTL. | El checkout **lee** `products.stock` para bloquear líneas no comprables (409 vía `buildCartView`) pero nunca lo escribe. La orden nace inerte precisamente por esto. |
| [ADR-0006](../../../docs/architecture/decisions/) | MercadoPago checkout hosted, sin datos de tarjeta en el propio sistema. | Ninguna columna de `orders`/`order_items` puede alojar PAN/CVV/titular/token; ningún DTO los acepta (AC-7). Guardián automático de columnas. |
| [ADR-0011](../../../docs/architecture/decisions/) | Tokens sensibles se guardan hasheados, nunca en claro. | `orders.access_token_hash` es SHA-256 del `order_token`; mismo precedente que `carts.session_token_hash` y `refresh_tokens.token_hash`. |
| [ADR-0010](../../../docs/architecture/decisions/) | Superficie pública fuera de `/v1/admin`. | `POST /v1/checkout` es pública, sin `AdminGuard`; la orden nace invisible para el panel hasta `new`. |
| [ADR-0007](../../../docs/architecture/decisions/) | Monolito modular en NestJS. | `CheckoutModule` vive dentro del mismo deployable que `cart`/`catalog`/`auth`, como módulo propio (no extiende `CartModule`). |

Ninguna decisión de este change enmienda o bordea un ADR existente — no se abrió ADR
nuevo (verificado contra los 8 ADR vigentes y el E2E §20, ver `design.md` "ADR triggers"
del change archivado).

## Decisiones de implementación tomadas durante la construcción

| Decisión | Motivo |
|---|---|
| Identidad de la orden: **token opaco de 256 bits en `access_token_hash`**, no el UUID interno de `orders`. | Un UUID de orden terminaría en la URL/cuerpo de las llamadas siguientes y de ahí en logs de acceso y en el `Referer` que el navegador manda **a MercadoPago** al redirigir. El token separado hace que `order_id` nunca salga a la red — misma decisión que US-007 tomó para el carrito, por la misma razón. |
| **`order_number`** (entero, `SEQUENCE START WITH 1000`) agregado en esta migración, no diferido. | El DER sólo modela el UUID, que no se expone. Agregarlo después es un `ALTER` con backfill sobre órdenes reales; se decide ahora porque la migración todavía no corrió en ningún ambiente (OQ-BE-4, resuelta por el PO 2026-08-22). Arranca en 1000 (no en 1) para no delatarle al comprador que la tienda vendió pocas veces (PRD §1.3, señales de confianza). |
| **`consent_accepted_at`** + `CHECK (consent_accepted = true)`, más **`consent_terms_version`**. | El DER modela sólo un booleano; AC-8 pide marca temporal y trazabilidad legal (Ley 25.326) — un booleano sin fecha no prueba nada. El `CHECK` hace estructuralmente imposible una orden sin consentimiento. La versión de términos se llena desde `LEGAL_TERMS_VERSION` (configuración) para no acoplar el change a los textos de US-017. |
| **`order_items.product_name` + `product_sku`** snapshoteados, además del precio. | La orden es un registro comercial: si el dueño renombra un producto o cambia su SKU, el email de confirmación (US-011) y el panel (US-012) mostrarían algo que el comprador nunca vio. El `RESTRICT` de la FK a `products` garantiza que la fila exista, no que su nombre sea el de la venta. |
| **Sin `Idempotency-Key`** (deviación de `api-standards.md` §10.1). | El riesgo que protege §10 es el doble cobro, y este endpoint no cobra. La alternativa (índice único parcial + reuso de orden `pending_payment`) obliga a decidir qué pasa si el carrito cambió después de crear la orden — re-snapshotear rompe la preferencia ya emitida por US-009 (bug de plata), no hacerlo deja al comprador pagando algo desactualizado. Doble submit crea dos órdenes inertes; la abandonada la cancela la limpieza de US-010. |
| **El carrito no se vacía** al crear la orden. | Si el pago falla (US-009/US-010), el comprador no pierde el carrito. Vaciar es responsabilidad del flujo de pago aprobado, fuera de este change (OQ-BE-3). |
| `buildCartView` de US-007 **reusado** para validar el carrito, en vez de una validación propia del checkout. | Evita tener dos lugares donde vive la misma regla de precio/stock/disponibilidad y esperar que no diverjan. Costo aceptado: un cambio en `cart-view.ts` puede afectar al checkout — cubierto por un test del invariante del snapshot independiente de esa función. |
| Módulo propio `checkout/`, no extensión de `cart/`. | El E2E §6.1 declara `CheckoutModule` como componente separado; `cart/` ya tiene 888 líneas. `CartModule` exporta lo que el checkout necesita (`CartTokenService`, `CartsRepository`, `CartCsrfGuard`) sin duplicar el acceso a `carts`. |
| `CheckoutEventsService.emit` sólo acepta `orderId`, nunca email/nombre/teléfono, **ni hasheados**. | Un hash de email es reversible por diccionario — sigue siendo el dato con un paso extra. Misma nota que `AuthEventsService` dejó escrita en US-014. |

## Desviaciones conscientes registradas

| Desviación | Motivo |
|---|---|
| Seis deviaciones del DER (E2E §8): `access_token_hash`, `consent_accepted_at`, `consent_terms_version`, `updated_at`, `product_name`+`product_sku` en `order_items`, `order_number`. | Documentadas en detalle en `design.md` del change archivado. Ninguna cambia el motor ni las relaciones; todas resuelven una brecha entre lo que el DER modela y lo que un AC exige explícitamente (identidad de orden sin sesión, trazabilidad legal, legibilidad humana del pedido). |
| Presupuesto de latencia del E2E §17 (`p95 < 500 ms`) aplicado tal cual, sin excepción — a diferencia de `POST /v1/payments` (US-009, 2 s por contener un tercero). | Este endpoint no hace llamadas salientes; el presupuesto estándar aplica sin ajuste. |
