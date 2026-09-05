---
tracker-id: null
tracker-source: null
parent-us: US-008
discipline: backend
variant: null
language: es
archived: true
archived_at: 2026-09-02
merged_commit: 6172654b0d55de4abf18d756a5ebf5fb09021b89
pr-url: https://github.com/gabogosp/AI4Devs-finalproject/pull/11
---

# US-008 Backend — Checkout del invitado: orden pendiente, snapshot de precios y consentimiento

## Why

US-007 dejó el carrito funcionando: el invitado acumula productos, ve precios
vigentes y sabe qué no puede comprar. Pero un carrito **no compromete a nadie**. Es
un borrador que cambia de precio cada vez que se lo mira (AC-9 de US-007 lo dice sin
vueltas) y que no tiene dueño, ni dirección de contacto, ni valor legal. Entre eso y
cobrar falta el paso que convierte un borrador en un **compromiso comercial**: la
orden.

Este change hace tres cosas que el proyecto nunca hizo, y las tres son delicadas por
motivos distintos.

**Congela el precio.** `order_items.unit_price_ars_cents` es una instantánea, y por
eso el dueño puede cambiar la lista de precios mañana sin reescribir lo que alguien
compró ayer. La US-001 ya fijó ese invariante para el panel (su AC-10) y acá se
materializa: la tabla de la orden es un **registro comercial**, no una vista del
catálogo. La diferencia con `cart_items.unit_price_ars_cents` —que existe pero
deliberadamente **no** entra en ninguna suma— es exactamente ésta: la instantánea del
carrito es un detector de cambios, la de la orden es el precio pactado.

**Guarda PII por primera vez.** Hasta hoy los únicos datos personales en la base eran
de `customers`, gente que se registró a propósito y puede borrar su cuenta (US-020).
Acá entra el nombre, el email y el teléfono de alguien que **no tiene cuenta** y que
no va a poder pedir su borrado por la vía de US-020. Eso arrastra la disciplina de
`observability-standards.md` §9 a un lugar nuevo: la PII no puede aparecer en un log,
en una métrica ni en un mensaje de error, y el módulo tiene que estar construido para
que no pueda llegar ahí por descuido.

**Registra un consentimiento con valor legal.** AC-8 pide que quede «con su marca
temporal» y «disponible para trazabilidad legal» (Ley 25.326, PRD §2.1 cap. 10). El
DER del E2E §8 sólo modela un booleano `consent_accepted`, y un booleano no es
trazabilidad: no dice *cuándo* ni *qué* se aceptó. Este plan agrega las dos columnas
que faltan y declara la deviación.

Lo que este change **no** hace es lo mismo que no hacía el carrito, y por la misma
decisión: **no toca el stock**. ADR-0008 fija que el inventario se decrementa sólo al
aprobarse el pago y descartó explícitamente reservar con TTL. La orden nace en
`pending_payment` y es **inerte**: no retiene mercadería, no mueve plata, no le
aparece al dueño en el panel. AC-6 lo dice y la Fase 5 lo atornilla como invariante
probada.

Y hay una deuda que este change paga: **resuelve OQ-BE-1 del plan de US-009**. El
change de pagos ya está escrito y quedó bloqueado esperando dos cosas de acá —la
tabla `orders` y una identidad opaca de la orden. Este plan las entrega con la forma
exacta que ese contrato pide.

## What changes

**Modelo de datos** — dos tablas nuevas, aditivas; ninguna existente se modifica:

- `orders` — la orden. Datos del comprador **embebidos** (es una compra guest: no hay
  cuenta de la que colgarlos), `status` arrancando en `pending_payment` con `CHECK`
  sobre los seis estados de la FSM del E2E §12, `fulfillment` con `CHECK` en
  `('pickup')` —sucursal única, el checkout confirma el retiro, no elige— y el
  registro de consentimiento. Más `access_token_hash` (UNIQUE), que es cómo un
  invitado sin sesión puede referirse a su propia orden, y **`order_number`** (entero de
  una `SEQUENCE`), que es cómo el dueño y el comprador hablan del mismo pedido por
  teléfono (OQ-BE-4).
- `order_items` — una línea por producto, con `quantity`, la **instantánea del precio**
  y —deviación declarada— el nombre y el SKU del producto al momento de comprar.

**Superficie HTTP** — un solo endpoint público:

| Endpoint | Qué hace | AC |
|---|---|---|
| `POST /v1/checkout` | Valida el carrito de la cookie, valida los datos del comprador, exige el consentimiento, crea la orden `pending_payment` con sus ítems y el snapshot de precios, y devuelve el **`order_token`** (con el que US-009 inicia el pago) y el **`order_number`** legible (para mostrarle al comprador). | AC-1..AC-8 |

**El carrito no viaja en el cuerpo.** El borrador de la API en el readme proponía un
`cart_id`, pero US-007 decidió lo contrario y con razón: el carrito se identifica por
la cookie `dsm_cart`, así que la superficie no tiene un identificador que enumerar ni
depende de un chequeo de propiedad que alguien pueda olvidar. Este endpoint hereda esa
disciplina tal cual: **el cuerpo trae sólo los datos del comprador, el consentimiento
y el modo de entrega**.

**Identidad de la orden** — el seam que US-009 espera:

- Token opaco de 256 bits (CSPRNG), guardado **hasheado** (SHA-256) en
  `orders.access_token_hash`. Reusa `auth/tokens/opaque-token.ts` de US-014: misma
  disciplina de ADR-0011 y del token del carrito — una fuga de base no entrega órdenes
  consultables.
- El claro se devuelve **una sola vez**, en el 201, y de ahí en adelante lo maneja el
  frontend. El `order_id` UUID **no** se expone (los DTO de US-002/US-003 ya
  establecieron que los identificadores internos no salen a la red).

**Reglas de negocio**:

- **Validación del carrito** (AC-5): se reusa `buildCartView` de US-007 —la función
  pura que ya sabe de precios vigentes, stock y disponibilidad— y se bloquea el
  checkout si el carrito está vacío o si `has_blocking_issues` es `true`. La respuesta
  nombra **qué** línea molesta y por qué; no un «no se puede» sin datos.
- **Snapshot** (AC-2): el precio, el nombre y el SKU se copian **dentro de la misma
  transacción** en que se leen. El total de la orden es la suma de esos subtotales,
  calculada del snapshot y no del carrito, para que la orden sea aritméticamente
  cerrada sobre sus propias líneas.
- **Consentimiento obligatorio** (AC-4): `consent: false` o ausente → **422**. No hay
  camino que cree una orden sin consentimiento; el `CHECK` de la tabla lo respalda.
- **Stock intacto** (AC-6): el checkout **lee** stock para validar y no lo escribe.
  Ni una sentencia de escritura sobre `products` en todo el change.
- **El carrito no se toca**: sigue vivo con su contenido. Vaciarlo al confirmar la
  orden sería útil, pero si el pago falla el comprador se quedaría sin carrito —y el
  pago es de US-009/US-010. Ver OQ-BE-3.

**Controles de borde** (`security-standards.md` §7): quinto throttler nombrado
`checkout` por IP (**10 / 10 min** — es escritura pública que crea filas con PII),
**`CartCsrfGuard` reusado** (acá §7.5 **sí** aplica, a diferencia de US-009: la
escritura se autoriza con la cookie `dsm_cart`, que es credencial ambiente),
`Cache-Control: no-store` en toda la superficie `/v1/checkout` —la respuesta lleva un
token de acceso y el total de una compra—, y el email normalizado con
`normalizeEmail` de US-014 antes de persistirse.

**Observabilidad**: `CheckoutEventsService` con 5 eventos **sin una sola pieza de
PII** (`checkout.order_created`, `checkout.rejected_empty_cart`,
`checkout.rejected_blocking_issues`, `checkout.rejected_consent`,
`checkout.validation_failed`). Es el «checkout iniciado» que pide la US §9 y el
denominador de conversión de US-016.

## ACs de US-008 cubiertos (capa backend)

| AC | Cubierto | Nota |
|---|---|---|
| AC-1 checkout válido crea la orden | ✅ | 201 con `order_token` + `status: pending_payment`; el «avanza al pago» lo ejecuta el FE llamando a `POST /v1/payments` (US-009) |
| AC-2 ítems con precio al momento | ✅ | `order_items` con `quantity` + `unit_price_ars_cents` snapshot; total en centavos ARS, IVA incluido; probado como invariante en T5.4 (cambiar el precio del catálogo **no** mueve la orden) |
| AC-3 validación de los datos del comprador | ✅ (backend) | 422 con `errors[]` **por campo** vía el `ValidationPipe` global; la validación inline es FE |
| AC-4 consentimiento obligatorio | ✅ | `consent` distinto de `true` → 422; ningún camino crea la orden |
| AC-5 carrito inválido bloquea | ✅ | 409 distinguiendo carrito vacío de línea no disponible, con el slug y el motivo por línea |
| AC-6 no se descuenta stock antes del pago | ✅ | ninguna escritura sobre `products`; probado como invariante en T5.1 (snapshot de `stock` antes/después) |
| AC-7 no se almacenan datos de tarjeta | ✅ | ninguna columna de `orders`/`order_items` puede alojarlos y ningún DTO los acepta; guardián automático en T5.2 |
| AC-8 el consentimiento queda registrado | ✅ | `consent_accepted` + **`consent_accepted_at`** + **`consent_terms_version`** (las dos últimas, deviaciones del DER justificadas) |

La parte de **UI** (formulario, validación inline, checkbox con enlaces legales,
resumen de la orden, CTA «Ir al pago») es de la capa FE.

## Out of scope

- **Inicio del pago, preferencia de MercadoPago y medio simulado** — US-009. Este
  change deja la orden en `pending_payment` y entrega el `order_token`; **no** crea la
  tabla `payments` ni habla con ningún proveedor.
- **Confirmación de la orden, decremento de stock y transición a `new`** — US-010
  (ADR-0008).
- **Limpieza de órdenes `pending_payment` abandonadas** — US-010 (E2E §18.5). Este
  change las crea sabiendo que son inertes; el barrido es de allá.
  `Deferred: US-010 — owner: BE`
- **Notificaciones por email** — US-011. Acá no se manda un solo email, aunque se
  guarde la dirección.
- **Páginas legales (privacidad / términos)** — US-017. Este change registra **qué
  versión** se aceptó (`LEGAL_TERMS_VERSION` por configuración) y no publica los textos.
- **Panel del dueño y transiciones de la FSM** — US-012. `orders.delivered_at` se crea
  (está en el DER) pero **ningún camino de este change la escribe**.
  `Deferred: US-012 — owner: BE`
- **Vincular la orden a una cuenta registrada** — US-015. `orders.customer_id` se crea
  (está en el DER) y queda **sin escritor** en esta US.
  `Deferred: US-015 — owner: BE`
- **Borrado / anonimización de la PII del invitado.** US-020 cubre el borrado de
  *cuentas*; un comprador guest no tiene cuenta que borrar. La retención de órdenes a
  12 meses del PRD §6 y su purga/anonimización **siguen fuera de este change**, pero ya
  no son un hueco sin dueño: el PO resolvió OQ-BE-5 el 2026-08-22 con **abrir una US de
  retención antes de salir a producción**. **La US ya existe**:
  [`US-021-retencion-datos-ordenes`](../../../docs/user-stories/US-021-retencion-datos-ordenes.md),
  creada y enriquecida a `Ready` el 2026-08-22, con 9 AC y `blocked_by: [US-008]`. Anonimiza
  y **no borra** (el E2E §8 fija que las órdenes no se borran: historial + métricas de
  US-016), y cubre tanto el plazo de 12 meses del PRD §6 como el pedido de supresión de un
  comprador invitado, que no tiene cuenta y por eso queda fuera de US-020.
  `Deferred: US-021 — owner: BE/FE`
- **Envío a domicilio, cupones, facturación AFIP** — roadmap (PRD §2.2).
- **Tests de carga (k6) y E2E cross-service (Playwright)** — de `/plan-qa`.

## Standards consultados

| Standard | Secciones aplicadas |
|---|---|
| `base-standards.md` | §1 KISS/YAGNI (sin reserva de stock, sin máquina de `Idempotency-Key`, sin `order_number` que nadie pidió) |
| `backend-standards.md` | capas handler→service→repository, errores tipados, validación en el borde |
| `backend-node-standards.md` | §2 capas · §3 DI · §4 DTO + `ValidationPipe` whitelist · **§5 Prisma + `$transaction` para el caso de uso multi-escritura + migración aditiva** · §6 errores de dominio + filtro RFC 7807 · §7 config validada fail-fast · §9 logs pino sin PII |
| `api-standards.md` | §2.2 recurso · §3.2 status codes (201 / 409 / 422) · §5.2 `snake_case` · **§5.5 dinero en centavos** · §8 errores RFC 7807 · §10.1 (**deviación declarada**: sin `Idempotency-Key`) · §12 cabeceras `RateLimit-*` |
| `security-standards.md` | §2 STRIDE (4 filas nuevas) · §6 validación de entrada · §7.1 headers + `no-store` · §7.3 rate-limit de escritura pública · §7.4 cookies · **§7.5 CSRF (acá SÍ aplica)** · protección de datos personales |
| `observability-standards.md` | **§9 redacción de PII** — el eje de la Fase 4 |
| `testing-standards.md` / `qa-backend-standards.md` | §14 pirámide, AAA; suites dev-owned vs QA |
| `documentation-standards.md` | §11.1 OpenAPI publicado + README del módulo |

## Preguntas abiertas para el PO / Arquitecto

**Tres resueltas por el PO el 2026-08-22**; las dos restantes tienen default implementado
y no bloquean el arranque.

| Id | Pregunta | Decisión / default | Estado |
|---|---|---|---|
| **OQ-BE-1** | **Doble submit del checkout.** ¿Qué pasa si el comprador hace dos veces «Ir al pago»? | **Opción (a)**: se crean **dos órdenes**, ambas inertes (sin stock ni plata retenidos); la abandonada la cancela la limpieza de US-010. Es la opción sin acoplamiento — cualquier forma de reuso obligaría a US-008 a saber si US-009 ya creó una preferencia, y si se re-snapshotea el total con la preferencia ya emitida, MercadoPago cobra un importe distinto al de la orden (bug de plata). Deviación de `api-standards.md` §10.1 declarada en `design.md` | `[Resolved: 2026-08-22 — opción (a)]` |
| **OQ-BE-2** | ¿El teléfono es obligatorio? | **Sí** (la US §10 lo pone como default para coordinar el retiro y el contacto por WhatsApp de US-018) | `[Default implementado]` |
| **OQ-BE-3** | ¿Se vacía el carrito al crear la orden? | **No**: sigue intacto. Si el pago falla, el comprador no perdió nada | `[Default implementado]` |
| **OQ-BE-4** | ¿La orden lleva un **número legible** («Pedido #1042») además del UUID interno? | **Opción (a) — sí, ahora.** `orders.order_number` (entero, `SEQUENCE START WITH 1000`), expuesto en el 201 y en el contrato. Se agrega en esta migración porque hacerlo después es un `ALTER` **con backfill sobre órdenes reales**, y hasta entonces el dueño leería UUIDs por teléfono. US-011 (email) y US-012 (panel) lo consumen | `[Resolved: 2026-08-22 — opción (a)]` |
| **OQ-BE-5** | **Retención y borrado de la PII del comprador invitado.** El PRD §6 fija 12 meses y anonimización; ninguna US lo implementa, y US-020 cubre sólo cuentas registradas | **Opción (a)**: se abre una **US de retención antes de salir a producción**. Este change sigue **sin** implementar purga —no es su alcance— pero el hueco deja de estar sólo documentado y pasa a tener dueño. **La US todavía no existe**: hay que crearla (ver §Out of scope) | `[Resolved: 2026-08-22 — opción (a): US de retención antes de producción]` |

## References

- User story: [`docs/user-stories/US-008-checkout-guest.md`](../../../docs/user-stories/US-008-checkout-guest.md)
- PRD: [`docs/product/prd.md`](../../../docs/product/prd.md) §2.1 capacidades 4 y 10, §3.1 (loop y casos borde), §6 (retención + PII), §7 (rol Invitado), §11 (precios en centavos, IVA incluido)
- E2E: [`docs/product/design-e2e.md`](../../../docs/product/design-e2e.md) §6.1 (`CheckoutModule`), §8 (DER `ORDERS`/`ORDER_ITEMS`), §9.2 (secuencia), §12 (FSM de orden), §14 (trust boundaries), §17 (NFRs), §18 (observabilidad), §19 (testing)
- **ADR-0008** — decremento de stock al aprobar el pago (**gobierna AC-6**)
- ADR-0011 — almacén server-side de tokens opacos hasheados (patrón del `access_token_hash`)
- ADR-0006 — MercadoPago hosted (**por qué acá no se piden datos de tarjeta**, AC-7)
- ADR-0010 — namespace de URLs storefront vs admin · ADR-0007 — monolito modular
- **Change de US-009**: [`US-009-pago-mercadopago-backend`](../US-009-pago-mercadopago-backend/proposal.md)
  — este plan **resuelve su OQ-BE-1** entregando `orders.access_token_hash` + el
  `order_token` en el 201, con la forma exacta que su contrato espera
- Changes de referencia: `US-007-carrito-compra-backend` (identidad por cookie,
  `buildCartView`, CSRF del invitado, throttler propio),
  `US-014-registro-login-backend` (tokens opacos hasheados, normalización de email,
  PII fuera de logs), `US-001-admin-catalogo-productos-backend` (el invariante de que
  cambiar un precio no altera ventas pasadas)
- Contrato draft de este change: [`contracts/openapi/checkout-create.yaml`](contracts/openapi/checkout-create.yaml)
