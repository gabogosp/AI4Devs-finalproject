# Carrito del invitado (US-007)

## Por qué es cliente y no servidor

`lib/http/client.ts` **lanza** si una llamada con sesión sale del servidor
(US-014 `design.md` D3): un Server Component que renderizara dato personalizado lo
dejaría en la Data Cache de Next y se lo serviría a otra persona. El carrito es
dato personalizado por definición, así que `/carrito` es vista de cliente y
declara `noindex`. La contraparte: sin JS no hay carrito (OQ-FE-5).

## Por qué el rewrite de ADR-0013 se extendió

`up.railway.app` está en la Public Suffix List, así que el sitio y el API son
**sitios distintos** y una cookie emitida por el API no vuelve. ADR-0013 lo
resolvió con un rewrite same-origin y nombró a US-007 como heredero:
`next.config.mjs` rewritea `/v1/auth/*` **y** `/v1/cart/*`. Sin la segunda entrada
el carrito funciona en local y está roto en producción — defecto invisible hasta el
deploy. Lo prueba `e2e/cart-topology.spec.ts` contra la app construida.

## Dos sujetos de CSRF, un solo lector

El invitado tiene carrito sin tener sesión, así que `dsm_csrf` (US-014) y
`dsm_cart_csrf` coexisten. `lib/http/csrf.ts` sigue siendo el **único** lector de
`document.cookie`: se agregó el sujeto (`readCsrfToken('cart')`), no un parser.

## Los totales vienen del servidor

Las tres operaciones devuelven el carrito completo, así que cada mutación
**reemplaza** el estado. Acá **no se suma nada**: `total_ars_cents` incluye sólo
las líneas comprables, y un total calculado en el cliente sería un número que el
checkout va a desmentir. `useCart.reload` es single-flight — el badge y la página
comparten el hook.

## Lo que NO hace

- **No reserva ni descuenta stock** (ADR-0008): muestra disponibilidad sin
  prometerla; el descuento ocurre al aprobarse el pago — US-010.
- **No cobra ni confirma**: «Ir al pago» está deshabilitado con el motivo a la
  vista hasta que exista `/checkout` — US-008; el pago es US-009.
- **No fusiona** carrito de invitado con cuenta (fuera de v1).
