---
tracker-id: null
tracker-source: null
parent-us: US-007
discipline: frontend-web
variant: null
language: es
created: 2026-08-22
archived: true
archived_at: 2026-08-30
merged_commit: 9a9fc53ef86bcba180979eccbaba3381facfb6a7
pr-url: https://github.com/gabogosp/AI4Devs-finalproject/pull/3
---

# US-007 Frontend Web — Carrito del invitado: superficie de escritura con sesión propia

## Why

El backend del carrito está terminado (24/24 tasks) y publicado en el contrato:
`GET /v1/cart`, `PUT /v1/cart/items/{slug}` y `DELETE /v1/cart/items/{slug}` ya viven en
`apps/api/docs/api/openapi.yaml`. Del lado del navegador **no existe nada**. Hoy la ficha
de producto muestra un botón «Agregar al carrito» **deshabilitado a propósito**, con un
test que asserta que está deshabilitado, como señal explícita de roadmap
(`ProductPurchase.tsx`); y el layout del storefront lleva escrito en un comentario que
el carrito del top-nav es `Deferred: US-004/US-007`. Este change es el que apaga los dos
carteles.

Pero no es «una página más». Es la **primera superficie de escritura del storefront
público**, y eso arrastra tres cosas que ninguna pantalla anterior necesitó.

**La primera es de topología, y ya nos mordió una vez.** ADR-0013 existe porque
`up.railway.app` está en la Public Suffix List: el sitio y el API son **sitios
distintos** para el navegador, así que una cookie emitida por el API nunca vuelve. La
solución fue un rewrite same-origin en Next, y hoy cubre **sólo** `/v1/auth/:path*`. El
propio ADR lo anticipa en su última línea: *«Inherited by: US-007 (cart, if it moves to
a cookie-authenticated surface)»*. El carrito **es** exactamente eso —se identifica con
`dsm_cart` (`httpOnly`) y se protege con `dsm_cart_csrf` (legible)—, así que sin extender
el rewrite el carrito funciona en local y **está roto en producción**, con el peor perfil
de defecto posible: invisible hasta el deploy.

**La segunda es que el carrito tiene su propio sujeto de sesión.** El cliente HTTP ya
sabe hablar con cookies (`session: 'customer'`: same-origin, `credentials: 'include'`,
header de double-submit), pero el lector de CSRF está atado a **una** cookie,
`dsm_csrf`, la de la sesión de US-014. El carrito usa otra. No es un detalle de
nomenclatura: un invitado sin cuenta tiene carrito y no tiene sesión, así que los dos
sujetos coexisten y hay que distinguirlos en el borde.

**La tercera es que el carrito no puede renderizarse en el servidor.** `client.ts`
**lanza** si una llamada con `session: 'customer'` sale desde el servidor, y ese guard es
load-bearing: existe para que un dato personalizado no termine en la Data Cache de Next
y se le sirva a otra persona (US-014 `design.md` D3). El carrito es dato personalizado
por definición. La consecuencia es que `/carrito` es una vista **de cliente**, no
indexable — que además es lo que corresponde.

Y una cuarta cosa que sí es simple pero conviene decir: el carrito **no reserva stock**
(AC-8, ADR-0008). La UI tiene que mostrar disponibilidad sin prometerla, porque entre
que alguien mira el carrito y paga, el stock puede haberse ido.

## What changes

**Topología y borde HTTP** — tres extensiones a piezas existentes, ninguna nueva:

- `next.config.mjs`: el rewrite same-origin se extiende a `/v1/cart/:path*` (ADR-0013).
  Declarativo, sin un solo `fetch` nuevo, así F48 (un único cliente HTTP) queda intacto.
- `src/lib/http/csrf.ts`: el lector único aprende el segundo sujeto —
  `readCsrfToken(subject)` con `'session' | 'cart'`. **Se mantiene un solo lector de
  `document.cookie`** en toda la app; lo que se agrega es el nombre, no un segundo
  parser.
- `src/lib/http/client.ts`: `session: 'cart'` como tercer valor del discriminante. Hereda
  same-origin + `credentials: 'include'` + header de double-submit, y **hereda también el
  throw en servidor**: el carrito es tan personalizado como la sesión.

**Contrato → tipos: generados, nunca escritos a mano.** El contrato publicado ya tiene
los tres endpoints, pero `src/api/generated/model/` todavía no tiene los modelos del
carrito. Se **regenera** con `pnpm --filter @dsm/web codegen` (orval ya está configurado
con el mutator `customFetch` y los mocks MSW), y el gate `frontend-codegen-fresh` de CI
custodia que no haya drift. **No se escribe a mano ni un DTO, ni un schema Zod, ni un
handler de mock** (`frontend-standards.md` §3.1/§3.2 — es *Mandatory*).

**Superficie nueva**:

| Qué | Dónde | AC |
|---|---|---|
| Página del carrito | `app/(storefront)/carrito/page.tsx` — cliente, `noindex` | AC-1..AC-3, AC-6, AC-7, AC-9 |
| `CartItem` + stepper de cantidad | `src/features/cart/` | AC-2, AC-5 |
| Resumen + total + CTA «Ir al pago» | `src/features/cart/CartSummary.tsx` | AC-1, AC-6 |
| Estado vacío | `src/features/cart/CartEmptyState.tsx` | AC-7 |
| Mini-cart (feedback al agregar, **sin redirigir**) | `src/features/cart/MiniCart.tsx` | AC-1 |
| Badge del carrito en el top-nav | `src/features/cart/CartBadge.tsx` (isla cliente dentro del layout servidor) | AC-1, AC-4 |
| «Agregar al carrito» habilitado en la ficha | `src/features/storefront/ProductPurchase.tsx` (hoy `disabled`) | AC-1 |
| «Agregar» en la card del listado | `src/features/storefront/ProductCard.tsx` | AC-1 (ver OQ-FE-2) |

**Estado como unión discriminada** (`frontend-standards.md` §11.4), no banderas
booleanas: `idle | loading | ready | error`, más un `mutating` por línea para que el
stepper de un ítem no bloquee el resto. La respuesta del backend **trae el carrito
completo en las tres operaciones**, así que cada mutación **reemplaza** el estado en vez
de parchearlo — no hay reconciliación local que pueda divergir del servidor.

**Reglas de la UI que salen del contrato, no de la intuición**:

- **Precios vigentes** (AC-9): todo importe se muestra tal como lo devuelve el backend,
  que ya recalcula con el precio actual. Cuando una línea trae `price_changed`, se avisa
  con el precio anterior — el cambio se hace **visible**, no silencioso.
- **Disponibilidad** (AC-6): `availability` distinto de `available` marca la línea y
  `has_blocking_issues` **deshabilita el CTA «Ir al pago»** con el motivo a la vista. La
  línea **no se borra sola** (el backend tampoco la borra).
- **Tope de cantidad** (AC-5): el stepper se acota a `max_quantity` (que el backend ya
  calcula como `min(stock, tope por línea)`). Si igual llega un 409, se muestra
  `available_quantity` — el límite se respeta en el cliente **y** se obedece al servidor.
- **404 indistinguible** (AC-10): agregar un producto despublicado devuelve el mismo 404
  que un slug inexistente; la UI dice «ese producto ya no está disponible» sin insinuar
  que existe pero está oculto.
- **429**: `AppError` ya tiene `kind: 'rateLimited'` con `retryAfterSeconds` (lo agregó
  US-003); se consume, no se trata como fallo.

**Accesibilidad** (WCAG 2.1 AA, US §9): stepper operable por teclado con `aria-label`
por ítem, el total anunciado por `aria-live="polite"` al recalcularse, el mini-cart con
`role="status"` (no `alert`: agregar algo no es un error) y foco gestionado sin robarle
el foco a quien sigue navegando — el design-system §7.11 es explícito en que el mini-cart
**no interrumpe**.

**Observabilidad**: eventos de negocio sin PII (`cart.item_added`, `cart.item_removed`,
`cart.quantity_changed`, `cart.viewed`, `cart.blocked_checkout`) por el módulo de
telemetría existente — insumo de conversión para US-016.

## ACs de US-007 cubiertos (capa frontend)

| AC | Cubierto | Nota |
|---|---|---|
| AC-1 agregar un producto | ✅ | desde la ficha (botón hoy `disabled`) y desde la card del listado (OQ-FE-2); mini-cart de confirmación + badge que incrementa, **sin redirigir** (design-system §7.11) |
| AC-2 editar la cantidad | ✅ | stepper con semántica **absoluta** (el `PUT` del backend fija la cantidad, no la incrementa); subtotal y total se recalculan del carrito que devuelve el servidor |
| AC-3 quitar un producto | ✅ | `DELETE` idempotente; quitar lo que no está deja el carrito igual |
| AC-4 persistencia entre visitas | ✅ (verificado) | la cookie es `httpOnly` y la emite el backend: el FE **no la administra**. Se prueba con Playwright y contexto persistido, no por inspección |
| AC-5 cantidad limitada al stock | ✅ | stepper acotado a `max_quantity` + manejo del 409 con `available_quantity` |
| AC-6 producto que dejó de estar disponible | ✅ | línea marcada + CTA al pago **deshabilitado** con motivo; la línea no se borra sola |
| AC-7 carrito vacío | ✅ | estado vacío con invitación a seguir comprando (design-system §10.1) |
| AC-8 no reserva ni descuenta stock | ✅ (a nivel UX) | la UI **no promete** disponibilidad: muestra el estado del momento y revalida en cada lectura. El invariante de datos lo probó el backend |
| AC-9 precios vigentes | ✅ | sin caché en la superficie del carrito (es cliente, `no-store` del lado del backend) + aviso de `price_changed` |
| AC-10 no se agregan no publicados | ✅ | el 404 del backend se mapea a un mensaje que **no** distingue «no existe» de «no publicado» |

## Out of scope

- **Checkout, datos del comprador y pago** — US-008 / US-009. El CTA «Ir al pago» apunta
  a `/checkout`, que **todavía no existe**; hasta que US-008 FE lo construya queda
  deshabilitado con el motivo a la vista. `Deferred: US-008 — owner: FE`.
- **Fusión del carrito invitado con la cuenta al iniciar sesión** — fuera de v1 (US §4 y
  OQ-BE-3 del backend). El carrito del invitado sigue accesible por su cookie incluso
  con sesión abierta.
- **Buscador del top-nav** — US-004. Este change agrega **sólo** el acceso al carrito al
  header; el `Deferred: US-004` del layout sigue en pie.
- **Descuentos / cupones / envío** — fuera de v1.
- **Selección de sucursal** — hay una sola; el design-system §7.11 la menciona como parte
  del resumen, pero confirmar el retiro es del checkout (US-008).
- **Funcionar sin JavaScript** — ver OQ-FE-5.
- **E2E cross-service, carga y regresión visual completa** — de `/plan-qa`, no dev-owned
  (`qa-frontend-standards.md` §2.1). Sí van acá el E2E de topología, el de persistencia y
  el de accesibilidad, que son dev-owned.

## Standards consultados

| Standard | Secciones aplicadas |
|---|---|
| `base-standards.md` | §1 KISS/YAGNI (sin store global nuevo; reemplazo de estado en vez de reconciliación) |
| `frontend-standards.md` | **§3.1/§3.2 codegen obligatorio del contrato** · §3.3 lógica de servicio a mano · §11.1 cliente HTTP centralizado · §11.3 mapeo a `AppError` · §11.4 unión discriminada · §11.5 repositorio por feature · §11.8 telemetría · §11.9 composición de estados de carga · §12 seguridad cliente |
| `frontend-next-standards.md` (overlay) | App Router, frontera Server/Client Component, `rewrites`, Metadata API (`noindex`), sin caché en datos personalizados |
| `api-standards.md` | §5.5 dinero en centavos · §8 RFC 7807 · §10.5 idempotencia natural (`PUT`/`DELETE`) · §12 `RateLimit-*` |
| `security-standards.md` | §6 XSS/encoding · §7.4 cookies · §7.5 double-submit del lado cliente · sin secretos en el bundle |
| `qa-frontend-standards.md` | §19 accesibilidad · §23.2 componentes con RTL + userEvent · §23.3 integración con MSW · §23.4 Playwright · §23.6 axe-core |
| `testing-standards.md` | §14 pirámide, AAA |
| `documentation-standards.md` | §11.1 README del feature |
| ADR-0013 | **rewrite same-origin — este change lo hereda explícitamente** |
| ADR-0008 | el carrito no reserva stock: la UI no promete disponibilidad |
| ADR-0010 | namespace de URLs (el storefront es la raíz) |

## Preguntas abiertas para el PO

**Una resuelta por el PO el 2026-08-22** (OQ-FE-2, la única que cambiaba el alcance); las
otras cuatro tienen default implementado y no bloquean el arranque.

| Id | Pregunta | Decisión / default | Estado |
|---|---|---|---|
| **OQ-FE-1** | **Stepper: optimista o pesimista.** ¿La cantidad cambia en pantalla antes de que el servidor confirme? | **Pesimista** con debounce de 400 ms y el stepper deshabilitado mientras vuela. El backend es la autoridad del stock y devuelve el carrito completo: mostrar un número que el servidor puede rechazar es mentirle al comprador sobre disponibilidad | `[Default implementado]` |
| **OQ-FE-2** | **¿«Agregar» en la card del listado?** AC-1 dice «desde la ficha o el listado», pero eso **modifica una superficie ya entregada** (`ProductCard` de US-002) | **Opción (a) — sí**, con cantidad 1 y sin stepper en la card (el stepper vive en el carrito y en la ficha). **T3.5 queda en el plan.** El riesgo de tocar US-002 se acota exigiendo que sus specs corran **sin editarse** | `[Resolved: 2026-08-22 — opción (a)]` |
| **OQ-FE-3** | **Línea bloqueada**: ¿la UI ajusta la cantidad al stock disponible por su cuenta? | **No.** Marca la línea, muestra «quedan N» y ofrece dos acciones explícitas —«ajustar a N» y «quitar»—. Nunca muta el carrito sin que la persona lo pida | `[Default implementado]` |
| **OQ-FE-4** | **Badge del carrito**: ¿unidades o líneas distintas? | **Unidades** (`total_quantity`) — es lo que el comprador argentino espera de MercadoLibre | `[Default implementado]` |
| **OQ-FE-5** | ¿`/carrito` tiene que funcionar **sin JavaScript**? | **No.** Es una vista de cliente, no indexable, con cookie `httpOnly` — y renderizarla en servidor está **prohibido** por el guard de `client.ts` (D3 de US-014), que existe para que un dato personal no caiga en la Data Cache | `[Default implementado]` |

## References

- User story: [`docs/user-stories/US-007-carrito-compra.md`](../../../docs/user-stories/US-007-carrito-compra.md)
- PRD: [`docs/product/prd.md`](../../../docs/product/prd.md) §2.1 capacidad 4, §3.1 (loop), §4 (NFRs), §11 (precios)
- E2E: [`docs/product/design-e2e.md`](../../../docs/product/design-e2e.md) §6.2 (`Carrito + Checkout`), §17 (NFRs), §18 (observabilidad), §19 (testing)
- Design system: [`docs/product/design-system.md`](../../../docs/product/design-system.md) **§7.11 Cart/CartItem** (mini-cart, stepper acotado al stock), §7.4 PriceTag ARS, §7.6 Toast, §7.7 Badge de stock, §7.10 top-nav, §10.1 estado vacío, §10.2 tono
- **ADR-0013** — rewrite same-origin de la superficie con cookies (**heredado explícitamente por US-007**)
- **ADR-0008** — el stock se descuenta al aprobar el pago (**por qué la UI no promete disponibilidad**)
- Contrato consumido: [`apps/api/docs/api/openapi.yaml`](../../../apps/api/docs/api/openapi.yaml) — `/cart`, `/cart/items/{slug}`
- Change hermano (terminado): [`US-007-carrito-compra-backend`](../US-007-carrito-compra-backend/proposal.md) — de ahí salen la forma del `CartView`, los estados de `availability` y los códigos de error
- Change aguas abajo: [`US-008-checkout-guest-backend`](../US-008-checkout-guest-backend/proposal.md) — el CTA «Ir al pago» apunta a su superficie
- Changes de referencia: `US-014-registro-login-frontend-web` (topología de cookies, CSRF, sesión sólo-navegador), `US-003-ficha-producto-pdp-frontend-web` (SSR, `AppError`, `rateLimited`), `US-002-storefront-navegacion-categorias-frontend-web` (`ProductCard`, layout del storefront)
