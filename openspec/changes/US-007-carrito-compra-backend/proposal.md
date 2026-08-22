---
tracker-id: null
tracker-source: null
parent-us: US-007
discipline: backend
variant: null
language: es
---

# US-007 Backend — Carrito de compra del invitado (identidad por cookie, sin reserva de stock)

## Why

El catálogo ya se puede navegar y leer: US-001 dio el panel del dueño, US-002 la
navegación por categorías y US-003 la ficha pública. Pero el loop de compra del PRD
(§3.1) se corta justo ahí: **hoy no hay forma de acumular lo que el cliente quiere
comprar**. `packages/db/prisma/schema.prisma` no conoce `carts` ni `cart_items`, y
`apps/api` no tiene ninguna superficie pública de **escritura** — todo lo que escribe
está detrás de `AdminGuard` o del seam de auth.

US-007 introduce la primera de esas dos cosas nuevas: un **carrito que funciona sin
cuenta**. El PRD trata el guest checkout como el camino principal (§2.1 capacidad 4,
§7 rol «Invitado») y las cuentas de US-014 como retención, no como requisito. Así que
el carrito no puede colgar de la sesión de cliente: necesita **su propia identidad**,
persistente entre visitas (AC-4), no adivinable y no enumerable.

La segunda cosa nueva es más delicada: es la **primera superficie pública con
escritura** del proyecto que no es auth. Eso arrastra la lista completa de §7 de
`security-standards` — rate-limit propio, CSRF sobre una cookie que no es la de
sesión, `Cache-Control: no-store`, cotas de tamaño — y un threat model de una
frontera que hasta ahora no existía.

Lo que el carrito **no** hace también es load-bearing: **no reserva ni descuenta
stock** (AC-8). ADR-0008 ya decidió que el inventario se decrementa sólo al aprobarse
el pago, con un `UPDATE` condicional atómico, y descartó explícitamente la
alternativa de reservar con TTL. Este change respeta esa decisión sin enmendarla: el
carrito **mira** el stock para no dejar pedir más de lo que hay (AC-5), y lo vuelve a
mirar cada vez que se lee (AC-6), pero nunca lo toca.

## What changes

**Modelo de datos** — dos tablas nuevas, aditivas, ninguna existente se modifica:

- `carts` — el carrito, identificado por el **hash** de un token opaco que viaja en
  una cookie `httpOnly` propia (`dsm_cart`). Con `expires_at` (ventana de retención
  deslizante de **7 días**, OQ-BE-1) y `customer_id` nullable del DER (E2E §8), creada
  pero sin escritor en esta US.
- `cart_items` — una línea por producto (`UNIQUE (cart_id, product_id)`), con
  `quantity` (`CHECK >= 1`) y `unit_price_ars_cents` como **instantánea** del precio
  al momento de tocar la línea — usada sólo para detectar cambios de precio, nunca
  para calcular importes.

**Superficie HTTP** — tres endpoints públicos bajo `/v1/cart`, todos **naturalmente
idempotentes** (`api-standards.md` §10.5), sin máquina de `Idempotency-Key`:

| Endpoint | Qué hace | AC |
|---|---|---|
| `GET /v1/cart` | Devuelve el carrito con precios **vigentes**, subtotales, total y el estado de disponibilidad por línea. Nunca crea carrito. | AC-4, AC-6, AC-7, AC-9 |
| `PUT /v1/cart/items/{slug}` | Fija la cantidad **absoluta** de un producto (crea la línea si no existe). Crea el carrito y emite la cookie si no había. | AC-1, AC-2, AC-5, AC-10 |
| `DELETE /v1/cart/items/{slug}` | Quita la línea. Idempotente: quitar lo que no está devuelve el carrito igual. | AC-3 |

El producto se identifica por **`slug`**, no por UUID: es la convención pública ya
establecida por US-002/US-003, cuyos DTO deliberadamente no exponen `id` para no
filtrar identificadores internos.

**Identidad del carrito invitado**:

- Token opaco de 256 bits (CSPRNG), guardado **hasheado** (SHA-256) — misma
  disciplina que ADR-0011 para los refresh tokens: una fuga de base no entrega
  carritos usables.
- Cookie `dsm_cart` (`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`) + cookie
  legible `dsm_cart_csrf` = HMAC del token, para el double-submit de §7.5.
- El id del carrito **nunca** viaja en la URL: la superficie es estructuralmente
  inmune a IDOR, no depende de un chequeo de propiedad que alguien pueda olvidar.

**Reglas de negocio**:

- **Stock**: se valida contra `products.stock` al escribir (AC-5, rechazo 409 con la
  cantidad disponible) y se re-evalúa al leer (AC-6). **Nunca** se reserva ni
  decrementa (AC-8, ADR-0008).
- **Precio**: todos los importes se calculan con el precio **vigente** de `products`
  en cada lectura (AC-9). La instantánea guardada sólo alimenta un flag
  `price_changed` para que el cambio sea **visible**, no silencioso.
- **Disponibilidad**: un producto despublicado, archivado o sin stock suficiente deja
  la línea marcada y prende `has_blocking_issues` a nivel carrito (AC-6). La línea
  **no** se borra sola.
- **Agregar lo no publicado** devuelve exactamente el **mismo 404** que un slug
  inexistente (AC-10) — la misma indistinguibilidad que US-003 fijó para la ficha, o
  el carrito se vuelve un oráculo de enumeración del catálogo oculto.

**Controles de borde** (`security-standards.md` §7): tercer throttler nombrado
`cart` por IP (lecturas y escrituras con presupuestos distintos), `CartCsrfGuard`
(double-submit firmado + `Origin` de la allowlist), `Cache-Control: no-store` en toda
la superficie del carrito, `PUT`/`DELETE` agregados a la allowlist de métodos CORS,
cota de líneas por carrito y de cantidad por línea.

**Observabilidad**: `CartEventsService` con 6 eventos de negocio sin PII
(`cart.item_added`, `cart.item_quantity_changed`, `cart.item_removed`, `cart.viewed`,
`cart.stock_limit_rejected`, `cart.item_unavailable`) — insumo de conversión para
US-016 y señal de demanda por encima del stock para el dueño.

## ACs de US-007 cubiertos (capa backend)

| AC | Cubierto | Nota |
|---|---|---|
| AC-1 agregar producto | ✅ | `PUT /v1/cart/items/{slug}`; la respuesta trae cantidad, precio unitario vigente, subtotal y total |
| AC-2 editar cantidad | ✅ | mismo endpoint, semántica absoluta |
| AC-3 quitar producto | ✅ | `DELETE`, idempotente |
| AC-4 persistencia entre visitas | ✅ | cookie persistente + fila en Postgres, ventana deslizante de **7 días desde la última escritura** (OQ-BE-1); el costo —volver a las dos semanas y encontrarlo vacío— está declarado en `design.md` |
| AC-5 cantidad limitada al stock | ✅ | rechazo 409 con la cantidad disponible; revalidación en checkout es de US-008 |
| AC-6 producto no disponible | ✅ (backend) | la lectura marca la línea y prende `has_blocking_issues`; **impedir el avance al pago** lo ejecuta US-008 con esa señal |
| AC-7 carrito vacío | ✅ | `GET` sin cookie → 200 con carrito vacío, sin crear nada |
| AC-8 no reserva ni descuenta | ✅ | verificado por test: el `stock` del producto no cambia en todo el ciclo |
| AC-9 precios vigentes | ✅ | recálculo en cada lectura + `no-store` + flag `price_changed` |
| AC-10 no se agregan no publicados | ✅ | 404 idéntico al de un slug inexistente |

La parte de **UI** de todos ellos (stepper, estado vacío, avisos) es de la capa FE.

## Out of scope

- **Checkout, datos del comprador y pago** — US-008 / US-009. Este change no crea
  órdenes ni toca `orders`.
- **Decremento y reintegro de stock** — US-010 (ADR-0008). El carrito sólo lee stock.
- **Fusión del carrito invitado con la cuenta al iniciar sesión** — fuera de v1 por
  decisión de la US (§4). La columna `carts.customer_id` se crea (está en el DER)
  pero **ningún endpoint la escribe** en esta US.
  `Deferred: US futura de fusión — owner: PO` (ver OQ-BE-3).
- **Descuentos, cupones, envío** — fuera de v1 (US §4).
- **Reserva de stock con expiración** — descartada en ADR-0008, alternativa A.
- **Vaciar el carrito entero** (`DELETE /v1/cart`) — ningún AC lo pide; se agrega
  cuando exista la necesidad.
- **Job programado de purga de carritos vencidos** — Redis/BullMQ no está
  aprovisionado (mismo estado que en US-006/ADR-0012). Esta US hace purga
  **oportunista** al resolver un carrito vencido.
  `Deferred: US-019 / operaciones — owner: Arquitecto`.
- **Tests de carga (k6) y E2E cross-service (Playwright)** — de `/plan-qa`, no
  dev-owned (`qa-backend-standards.md` §2.1).

## Standards consultados

| Standard | Secciones aplicadas |
|---|---|
| `base-standards.md` | §1 KISS/YAGNI (sin máquina de idempotencia, sin reserva, sin cola) |
| `backend-standards.md` | capas handler→service→repository, errores, validación |
| `backend-node-standards.md` | §2 capas · §3 DI por token · §4 DTO + ValidationPipe whitelist · §5 Prisma + repositorio + `$transaction` + migración aditiva · §6 errores de dominio + filtro RFC 7807 · §7 config validada fail-fast · §9 logs pino |
| `api-standards.md` | §2 URLs (recurso plural, sub-recurso a un nivel) · §5 formato de respuesta (dinero en centavos, snake_case) · §8 errores RFC 7807 · §10.5 operaciones naturalmente idempotentes · §12 headers de rate-limit |
| `security-standards.md` | §2 STRIDE · §6 validación de entrada · §7.1 headers + `no-store` · §7.2 CORS (métodos) · §7.3 rate-limit de escritura pública · §7.4 cookies · §7.5 CSRF con auth por cookie |
| `observability-standards.md` | §9 sin PII en logs/métricas; cardinalidad de contadores |
| `testing-standards.md` / `qa-backend-standards.md` | §14 pirámide, AAA; suites dev-owned vs QA |
| `documentation-standards.md` | §11.1 README del servicio + OpenAPI publicado + runbook |

## Decisiones cerradas (ex-open questions)

Las seis preguntas que este plan escaló están **resueltas por el PO el 2026-08-22**.
No queda ninguna abierta: el plan se ejecuta completo desde T0.1. El fundamento de
cada una vive en `design.md` §Decisiones cerradas.

| Id | Pregunta | Decisión | Estado |
|---|---|---|---|
| OQ-BE-1 | Ventana de persistencia del carrito invitado | **7 días** deslizantes desde la última escritura (`CART_TTL_DAYS = 7`) — **distinta de la recomendación** de este plan (proponía 30). Costo aceptado y declarado en `design.md`: quien vuelve a las dos semanas encuentra el carrito vacío | `[Resolved: 2026-08-22]` |
| OQ-BE-2 | ¿El carrito muestra cuántas unidades quedan? | Sí, **sólo** en la superficie del carrito (`available_quantity` cuando pide de más, `max_quantity` para el stepper). La ficha y el listado siguen con el booleano de US-003 | `[Resolved: 2026-08-22]` |
| OQ-BE-3 | Fusión invitado ↔ cuenta | En v1 **no pasa nada**: el carrito del invitado sigue accesible por su cookie. Política registrada para la US futura: **sumar cantidades** con tope al stock. No se implementa acá | `[Resolved: 2026-08-22]` |
| OQ-BE-4 | ¿El total incluye las líneas no comprables? | **No**: `total_ars_cents` suma sólo lo comprable; el ítem sigue visible y marcado, fuera de la suma | `[Resolved: 2026-08-22]` |
| OQ-BE-5 | Semántica de agregar | **`PUT` que fija la cantidad**, idempotente por `api-standards.md` §10.5 — sin `Idempotency-Key` | `[Resolved: 2026-08-22]` |
| OQ-BE-6 | Purga de carritos vencidos | **Oportunista** en esta US + job programado diferido. Con 7 días la purga oportunista alcanza y el job pierde urgencia | `[Resolved: 2026-08-22]` |

## References

- User story: [`docs/user-stories/US-007-carrito-compra.md`](../../../docs/user-stories/US-007-carrito-compra.md)
- PRD: [`docs/product/prd.md`](../../../docs/product/prd.md) §2.1 capacidad 4, §3.1 (loop y casos borde), §6 (retención), §7 (rol Invitado)
- E2E: [`docs/product/design-e2e.md`](../../../docs/product/design-e2e.md) §6.1 (`CartModule`), §8 (DER `CARTS`/`CART_ITEMS`), §14 (trust boundaries), §17 (NFRs), §18 (observabilidad), §20 (ADR)
- ADR-0008 — decremento de stock al aprobar el pago (**gobierna AC-5 y AC-8**)
- ADR-0002 — Postgres único (el carrito vive en Postgres, no en Redis)
- ADR-0011 — almacén server-side de tokens hasheados (precedente del token de carrito)
- ADR-0010 — namespace de URLs storefront vs admin
- Specs vivas: [`openspec/specs/catalogo/`](../../specs/catalogo/) — al archivar, estos
  tres endpoints forman la capacidad nueva `openspec/specs/carrito/`
- Changes de referencia: `US-003-ficha-producto-pdp-backend` (superficie pública,
  anti-enumeración, caché), `US-014-registro-login-backend` (cookies, CSRF,
  throttler, tokens opacos hasheados)

> **Plan regenerado el 2026-08-20 — colisión de sesiones. Ratificado por el PO el
> 2026-08-22.** Una sesión paralela ya había commiteado un plan para este mismo change
> (18 tasks, commit **`cf1f011`** — *"docs(openspec): US-007 backend — plan del carrito
> guest (18 tasks, 7 h)"*); al planificar de nuevo se sobrescribió. **El plan anterior
> está intacto en git y respaldado** en
> [`openspec/changes/_backups/2026-08-20-US-007-carrito-compra-backend/`](../_backups/2026-08-20-US-007-carrito-compra-backend/)
> — se conserva, no se borra.
>
> Los dos convergen en lo esencial (token opaco hasheado en la cookie, `expires_at`
> agregado al DER, creación perezosa del carrito, precios vigentes, AC-8 probado como
> invariante, purga oportunista). El PO se quedó con **este** por tres brechas
> verificadas contra el backup y contra el código: (a) el plan anterior **no
> contemplaba CSRF** sobre la cookie del carrito, y `security-standards.md` §7.5 es
> *Mandatory* cuando la autenticación viaja en cookies; (b) **no declaraba
> `Cache-Control: no-store`**, del que depende AC-9; (c) **no agregaba `DELETE` a la
> allowlist de métodos CORS** — `bootstrap.ts` declara hoy
> `methods: ['GET','POST','PATCH','OPTIONS']`, así que el `DELETE` que ese plan
> proponía habría fallado el preflight en el navegador. Además, este plan usa `PUT` de
> cantidad absoluta en vez de `POST` relativo (idempotente por §10.5, sin
> `Idempotency-Key`) y escaló seis decisiones al PO en vez de fijarlas — las seis
> quedaron resueltas el 2026-08-22 (ver §Decisiones cerradas). Coincidencia notable:
> la retención de **7 días** que el plan anterior fijaba por su cuenta es la que el PO
> terminó eligiendo.
