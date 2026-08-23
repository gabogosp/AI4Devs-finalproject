---
tracker-id: null
tracker-source: null
parent-us: US-009
discipline: backend
variant: null
language: es
---

# US-009 Backend — Inicio de pago con MercadoPago (hosted) + medio simulado "DSM"

## Why

El loop de compra del PRD (§3.1) tiene todas sus piezas de lectura construidas y la de
escritura a medio camino: US-001 dio el panel, US-002 la navegación, US-003 la ficha,
US-007 el carrito (tablas ya migradas) y US-008 dejará la orden en `pending_payment`.
**Ahí se corta: hoy nadie puede pagar.** `packages/db/prisma/schema.prisma` no conoce
`payments`, y `apps/api` no tiene una sola llamada saliente a un tercero — ni un
timeout, ni un reintento, ni un breaker. Este change introduce las dos cosas: **el
cobro** y **la primera dependencia externa del camino crítico**.

Cobrar es lo que convierte el catálogo en un negocio, pero el PRD pone una condición
no negociable (§5): **DSM nunca custodia datos de tarjeta**. ADR-0006 ya resolvió cómo
— MercadoPago Checkout Pro en modo *hosted*, el comprador pone la tarjeta en el sitio
de MercadoPago y nosotros sólo creamos la preferencia y recibimos el resultado. Este
plan no re-decide eso: lo implementa. La consecuencia de diseño más importante es que
**la verdad del pago nunca está en el navegador del comprador**: la URL de retorno es
una pista, no un hecho (AC-8), y la confirmación real llega por webhook verificado
(US-010).

La segunda pieza es el **medio simulado "DSM"**, y no es un adorno de conveniencia:
ADR-0006 y el E2E §19 lo declaran *load-bearing* para el test E2E automatizado y para
las demos al dueño. Un método que aprueba pagos sin cobrar es, al mismo tiempo, el
peor agujero imaginable si alguna vez se enciende en producción (E2E §14, fila «Pago
simulado DSM»). Por eso acá no se resuelve con un `if` en el handler: la ruta
simulada **no se monta** cuando el flag está apagado, y el flag **no puede estar
encendido en producción** porque el arranque falla. Ausencia estructural, no rechazo
condicional.

Lo que este change **no** hace también es load-bearing: **no confirma la orden ni
toca el stock**. ADR-0008 fija que el inventario se decrementa sólo al aprobarse el
pago, dentro de la transacción del webhook, y eso es US-010. Acá se deja el asiento
del pago y el *seam* (`PaymentConfirmationPort`) por el que US-010 se enchufa — el
mismo seam que usa el medio simulado, que es lo que hace verdadera la promesa de AC-3
(«se dispara el mismo flujo de confirmación que un pago real»).

## What changes

**Modelo de datos** — una tabla nueva, aditiva; ninguna existente se modifica:

- `payments` — un **intento de pago** por fila. `provider`
  (`mercadopago` | `simulated_dsm`), `status`
  (`pending` | `approved` | `rejected` | `refunded`), `amount_ars_cents` (copia del
  total de la orden al momento del intento), `idempotency_key` UNIQUE,
  `external_id` UNIQUE nullable (el `payment_id` de MercadoPago — lo escribe US-010),
  y las tres columnas que este plan **agrega al DER** con justificación en
  `design.md` §Persistencia: `preference_id`, `init_point`, `updated_at`.
- Un **índice único parcial** `WHERE status = 'pending'` deja **a lo sumo un intento
  vivo por orden**. Es la idempotencia natural del endpoint: el segundo clic en
  «Pagar» no crea una segunda preferencia en MercadoPago, devuelve la misma.

`orders` y `order_items` **no** se crean acá: son de US-008 (ver §Pre-requisitos de
`tasks.md`). Este change **lee** la orden y **no la transiciona** — la orden sigue en
`pending_payment` hasta que US-010 la mueva.

**Superficie HTTP** — tres endpoints públicos, ninguno bajo `/v1/admin`:

| Endpoint | Qué hace | AC |
|---|---|---|
| `POST /v1/payments` | Crea el intento de pago real: preferencia en MercadoPago + fila `payments(pending)`, y devuelve el `init_point` del checkout hosted. Emite la cookie `dsm_order` para el camino de retorno. | AC-1, AC-6, AC-9 |
| `POST /v1/payments/simulate` | Medio simulado "DSM": marca el intento `approved` sin transacción real y llama al **mismo** `PaymentConfirmationPort` que usará el webhook. **Sólo se monta con el flag encendido**; en producción el flag no puede encenderse. | AC-3, AC-7 |
| `GET /v1/payments/latest` | Estado **autoritativo** del último intento de la orden en la cookie `dsm_order`, leído de nuestra base. Es lo que consultan las páginas de retorno de éxito / en proceso / no completado. | AC-2, AC-4, AC-5, AC-8 |

**La orden nunca se identifica por su UUID en la URL.** El intento se autoriza con un
`order_token` opaco que viaja en el **cuerpo** (nunca en la query ni en el path, donde
quedaría en logs de acceso y en el `Referer` que el navegador manda a MercadoPago), y
el camino de retorno se resuelve con una cookie `httpOnly`. La superficie es
estructuralmente inmune a IDOR: no hay identificador de orden que enumerar (AC-9).

**Integración con MercadoPago** — puerto + adaptador, sin SDK oficial:

- `MercadoPagoClient` (puerto) con dos implementaciones: `HttpMercadoPagoClient`
  (`fetch` global de Node 20 — **sin dependencia nueva**) y `FakeMercadoPagoClient`
  para los tests.
- **Timeout 4 s + 2 reintentos con backoff exponencial y jitter + circuit breaker**
  (5 fallos consecutivos → abierto 30 s), per `backend-node-standards.md` §8. Los
  reintentos sólo aplican a fallos de red y `5xx`; un `4xx` de MercadoPago es
  determinista y no se reintenta.
- El cuerpo de error de MercadoPago **nunca** se reenvía al cliente: se mapea a un
  `502` genérico del catálogo de errores. `MP_ACCESS_TOKEN` no entra en ningún log,
  respuesta ni mensaje de excepción.

**Feature flag del medio simulado** — dos capas, ninguna en el handler:

1. `PAYMENTS_SIMULATED_ENABLED` validada por Zod; el `superRefine` de producción
   **hace fallar el arranque** si vale `true` con `NODE_ENV=production`.
2. Con el flag apagado, `PaymentsModule` **no registra** el controller simulado → la
   ruta devuelve el `404` genérico del router, indistinguible de una URL inexistente.

**Controles de borde** (`security-standards.md` §7): cuarto throttler nombrado
`payments` por IP (10 intentos / 5 min — es escritura pública adyacente al dinero),
tope de **5 intentos por orden** para que nadie use nuestra cuenta de MercadoPago como
generador gratuito de preferencias, `Cache-Control: no-store` en toda la superficie
`/v1/payments` (hoy el middleware del borde sólo cubre `/v1/admin`), y comparación en
tiempo constante del `order_token`. **No se agrega guard de CSRF**: la escritura no se
autoriza con una cookie ambiente sino con un token en el cuerpo, así que §7.5 no
aplica — se deja dicho para que la ausencia se lea como decisión y no como olvido.

**Observabilidad**: `PaymentEventsService` con 8 eventos de negocio sin PII
(`payment.intent_created`, `payment.intent_reused`, `payment.simulated_approved`,
`payment.status_read`, `payment.provider_error`, `payment.provider_degraded`,
`payment.attempt_cap_reached`, `payment.order_not_payable`). Alimenta la tasa
aprobado/rechazado del E2E §18 y la señal de degradación del proveedor.

## ACs de US-009 cubiertos (capa backend)

| AC | Cubierto | Nota |
|---|---|---|
| AC-1 iniciar el pago real | ✅ | `POST /v1/payments` crea la preferencia con `external_reference = order_id` y devuelve `init_point`; **la redirección la ejecuta el FE** con esa URL |
| AC-2 retorno tras pagar | ✅ (backend) | `GET /v1/payments/latest` devuelve el estado autoritativo; **la página** de éxito / en proceso es FE |
| AC-3 medio simulado DSM | ✅ | `POST /v1/payments/simulate` marca `approved` y llama al **mismo** `PaymentConfirmationPort` que invocará el webhook de US-010; verificado por test sobre el puerto, no por inspección |
| AC-4 pago rechazado o cancelado | ✅ (backend) | el intento queda `rejected`/`pending`, la orden **sigue** en `pending_payment` y el stock no se toca (probado como invariante en T6.3); la página de «pago no completado» es FE |
| AC-5 pago pendiente | ✅ (backend) | `GET /v1/payments/latest` distingue `pending` de `approved`; la resolución llega por webhook (US-010) |
| AC-6 no se almacenan datos de tarjeta | ✅ | el modelo `payments` no tiene ninguna columna capaz de alojarlos y el adaptador no acepta ningún campo de tarjeta; probado por test de esquema y de contrato |
| AC-7 simulado deshabilitado en producción | ✅ | doble capa: arranque **falla** con el flag encendido en producción + la ruta **no se monta** con el flag apagado |
| AC-8 no se confía en la URL de retorno | ✅ | ningún endpoint acepta el estado del pago como entrada; `GET /v1/payments/latest` lee sólo la base. El intento **no** puede pasar a `approved` por HTTP público (sólo el webhook de US-010 o el medio simulado) |
| AC-9 la intención de pago es trazable a su orden | ✅ | `order_token` opaco hasheado + `payments.order_id` FK; token desconocido o de otra orden → **mismo** 404 |

La capa de **UI** (redirección al `init_point`, páginas de retorno, selector de medio
en demo) es del FE; US-009 no declara disciplina FE, así que esas pantallas se apoyan
en el design-system desde la US §8.

## Out of scope

- **Webhook de MercadoPago, confirmación de la orden y decremento de stock** — US-010
  (ADR-0008). Este change define y consume el `PaymentConfirmationPort`; la
  implementación real la aporta US-010.
  `Deferred: US-010 — owner: BE`
- **Reembolsos** — US-013. `payments.status = 'refunded'` existe en el CHECK (está en
  el DER) pero **ningún camino de este change lo escribe**.
  `Deferred: US-013 — owner: BE`
- **Reconciliación de webhooks perdidos y limpieza de órdenes `pending_payment`
  abandonadas** — US-010 (E2E §18.5, runbook). Acá sólo se documenta el síntoma.
  `Deferred: US-010 — owner: BE`
- **Notificaciones por email** — US-011. El `PaymentConfirmationPort` es el punto
  donde se enganchan; este change no manda un solo email.
- **Creación de la orden, datos del comprador y consentimiento** — US-008. Este change
  **no** crea `orders`/`order_items` y no valida el carrito.
- **Páginas de retorno (éxito / en proceso / no completado)** — FE.
- **Provisión de credenciales de MercadoPago y de la URL pública HTTPS del webhook** —
  `INFRA-US-009` (US §7). Este plan declara los nombres de las variables y las
  consume; no las provisiona.
- **Tests de carga (k6) y E2E cross-service (Playwright)** — de `/plan-qa`, no
  dev-owned (`qa-backend-standards.md` §2.1).
- **SDK oficial `mercadopago`** — descartado; ver `design.md` §Trade-offs.

## Standards consultados

| Standard | Secciones aplicadas |
|---|---|
| `base-standards.md` | §1 KISS/YAGNI (idempotencia natural en vez de máquina de `Idempotency-Key`; sin cola) |
| `backend-standards.md` | capas handler→service→repository, errores tipados, validación en el borde, resiliencia |
| `backend-node-standards.md` | §2 capas · §3 DI por token (puerto `MercadoPagoClient`) · §4 DTO + `ValidationPipe` whitelist · §5 Prisma + repositorio + migración aditiva · §6 errores de dominio + filtro RFC 7807 · **§7 config validada fail-fast + secretos fuera del repo** · **§8 timeout + reintentos con backoff + circuit breaker en llamadas salientes** · §9 logs pino sin PII · §10 pirámide de tests |
| `api-standards.md` | §2.2 recurso plural · §3.2 status codes · §5.5 dinero en centavos · §5.6 enums · §8 errores RFC 7807 · **§10.5 idempotencia natural** (por qué no hay `Idempotency-Key`) · §12 cabeceras `RateLimit-*` |
| `security-standards.md` | §2 STRIDE (4 filas nuevas) · §5 secretos · §6 validación de entrada · §7.1 headers + `no-store` · §7.2 CORS (sin métodos nuevos) · §7.3 rate-limit de escritura pública · §7.4 cookies · §7.5 CSRF (**por qué no aplica**) |
| `observability-standards.md` | §9 sin PII ni secretos en logs; contadores por nombre de evento (cardinalidad) |
| `performance-standards.md` | presupuesto p95 con dependencia externa; timeout como parte del presupuesto |
| `testing-standards.md` / `qa-backend-standards.md` | §14 pirámide, AAA; suites dev-owned vs QA |
| `documentation-standards.md` | §11.1 OpenAPI publicado + runbook + README del servicio |

## Preguntas abiertas para el PO / Arquitecto

**Ninguna bloquea el arranque**: las seis tienen un default implementado en el plan.
Lo que cambia si el PO decide distinto está dicho en cada fila.

| Id | Pregunta | Default implementado (recomendado) | Si se decide distinto |
|---|---|---|---|
| **OQ-BE-1** | **El seam con US-008.** Este plan necesita que `POST /v1/checkout` devuelva un `order_token` opaco y que `orders` tenga `access_token_hash`. Es la única obligación que US-009 le impone a una US todavía sin planificar. | US-008 mina el token (256 bit CSPRNG, SHA-256 en base) — mismo patrón que ADR-0011 y que el carrito de US-007 | Si US-008 prefiere exponer el `order_id` UUID, cae AC-9 a «no adivinable por entropía» y hay que agregar una prueba de propiedad (cookie del carrito). Peor: el UUID acabaría en URLs y logs |
| **OQ-BE-2** | ¿Se permite **reintentar** el pago tras un rechazo? | **Sí**, hasta **5 intentos** por orden; a lo sumo uno `pending` a la vez (índice único parcial) | Con «no» el DER queda 1:1 como está dibujado y se simplifica el modelo, pero un rechazo del banco mata la venta sin recurso |
| **OQ-BE-3** | Vida de la cookie `dsm_order` (ventana para volver de MercadoPago y ver el resultado). | **2 h** | Más corta rompe al comprador que deja el checkout abierto; más larga alarga la ventana de una cookie que da lectura del estado de una orden |
| **OQ-BE-4** | ¿La respuesta de `GET /v1/payments/latest` incluye el **total** y el estado de la orden, o sólo el del pago? | Incluye `order_status` + `total_ars_cents` (la página de éxito los necesita y ya son datos del propio comprador) | Sólo pago: la página tendría que pedir la orden a otro endpoint que hoy no existe |
| **OQ-BE-5** | **Vencimiento de la preferencia** de MercadoPago (`expiration_date_to`). | **24 h** desde la creación | Sin vencimiento, un `init_point` viejo sigue cobrable días después contra una orden que la limpieza de US-010 ya canceló |
| **OQ-BE-6** | ¿El medio simulado queda habilitado en **staging** (no sólo en local/test)? | **Sí** — es lo que habilita la demo al dueño y el E2E de Playwright contra el ambiente desplegado | Con «no», el E2E de la capa L3 (E2E §19) sólo corre en local y la demo necesita una transacción real en el sandbox |

## References

- User story: [`docs/user-stories/US-009-pago-mercadopago.md`](../../../docs/user-stories/US-009-pago-mercadopago.md)
- PRD: [`docs/product/prd.md`](../../../docs/product/prd.md) §2.1 capacidad 4, §5 (nunca custodiar tarjeta), §3.1 (loop)
- E2E: [`docs/product/design-e2e.md`](../../../docs/product/design-e2e.md) §6.1 (`CheckoutModule` / `PaymentsModule`), §8 (DER `PAYMENTS`), §9.2 (secuencia de pago), §12 (FSM de orden), §14 (STRIDE — webhook y simulado), §17 (NFRs), §18 (observabilidad), §18.5 (runbook), §19 (testing), §20 (ADR-0006)
- **ADR-0006** — MercadoPago Checkout Pro hosted + medio simulado «DSM» (**gobierna todo este change**)
- **ADR-0008** — decremento de stock al aprobar el pago (**por qué acá no se toca stock**)
- ADR-0011 — almacén server-side de tokens opacos hasheados (precedente del `order_token`)
- ADR-0010 — namespace de URLs storefront vs admin
- ADR-0007 — monolito modular (`PaymentsModule` como módulo propio)
- Specs vivas: [`openspec/specs/catalogo/`](../../specs/catalogo/) — al archivar, estos
  tres endpoints forman la capacidad nueva `openspec/specs/pagos/`
- Changes de referencia: `US-014-registro-login-backend` (cookies, tokens opacos
  hasheados, throttler nombrado, config fail-fast en producción),
  `US-007-carrito-compra-backend` (superficie pública de escritura, identidad por
  token fuera de la URL), `US-003-ficha-producto-pdp-backend` (anti-enumeración,
  `no-store`)
- Contratos draft de este change: [`contracts/openapi/`](contracts/openapi/)
