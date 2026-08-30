# CAP-4 Carrito — Decisiones

Decisiones que gobiernan el estado vivo de la capacidad. Los ADR son la fuente de verdad;
acá se registra **cuál aplica a esta capacidad y por qué**.

## ADRs que aplican

| ADR | Decisión | Impacto en esta capacidad |
|---|---|---|
| [ADR-0008](../../../docs/architecture/decisions/) | El stock se descuenta al aprobarse el pago, sin reserva con TTL. | El carrito **lee** `products.stock` para rechazar cantidades imposibles (409) pero nunca lo escribe. Ninguna desviación: el diseño se subordina a la decisión al pie de la letra. |
| [ADR-0002](../../../docs/architecture/decisions/) | Motor de datos único (PostgreSQL). | `carts`/`cart_items` viven en Postgres, no en Redis (no aprovisionado); el volumen esperado (~50 concurrentes) no lo exige. |
| [ADR-0005](../../../docs/architecture/decisions/) | Auth propia con JWT. | No aplica directamente: el carrito **no** usa el seam de sesión de cliente registrado — un invitado no tiene `jti`. Es un mecanismo de identidad paralelo (token opaco en cookie propia), misma familia de controles (`HttpOnly`, hash server-side) que ADR-0011. |
| [ADR-0011](../../../docs/architecture/decisions/) | Tokens sensibles se guardan hasheados, nunca en claro. | `carts.session_token_hash` es SHA-256 del token de la cookie — mismo precedente que `refresh_tokens.token_hash` / `password_reset_tokens.token_hash`. |
| [ADR-0010](../../../docs/architecture/decisions/) | Superficie pública fuera de `/v1/admin`. | El carrito es la **primera escritura pública** del producto, fuera de `AdminGuard` y del seam de cliente registrado. |
| [ADR-0007](../../../docs/architecture/decisions/) | Monolito modular en NestJS. | `CartModule` vive dentro del mismo deployable que `catalog`/`auth`, no como servicio separado. |

## Decisiones de implementación tomadas durante la construcción

| Decisión | Motivo |
|---|---|
| Identidad del carrito: **token opaco en cookie `httpOnly` propia** + fila en Postgres, no `cart_id` en la URL ni el carrito completo en el cliente. | Un UUID en la URL hace que conocerlo **sea** el permiso (IDOR); el contenido en el cliente no evita resolver precio/stock server-side igual. El token hasheado hace la superficie estructuralmente inmune a IDOR (Decisión 1 del design.md). |
| Escritura de cantidad vía **`PUT` absoluto**, no `POST` relativo. | `PUT` es naturalmente idempotente (`api-standards.md` §10.5): un reintento de red nunca duplica unidades, sin necesitar `Idempotency-Key` ni su almacén. El costo (doble clic dejando 1 unidad, no 2) se acepta porque toda respuesta trae el carrito completo. |
| Rechazo (409) en vez de clamp silencioso cuando `quantity > stock`. | AC-5 exige que el sistema "no permita superar el stock"; recortar sin avisar entrega un carrito distinto del pedido. El 409 con `available_quantity` deja que el FE ponga el tope en el stepper. |
| Líneas no disponibles se **marcan**, no se borran. | Un carrito que se vacía solo entre visitas es indistinguible de un bug; AC-6 pide señalar, no quitar. La FK `cart_items.product_id` es `ON DELETE RESTRICT`: un producto con líneas vivas no puede desaparecer, así que no hay líneas huérfanas que manejar. |
| Precio **vigente** en cada lectura; la columna guardada (`unit_price_ars_cents`) sólo alimenta el flag `price_changed`. | AC-9 no deja margen: los importes que ve el cliente son los vigentes. Congelar el precio viejo sería una promesa comercial que el negocio no hizo. |
| Retención de **7 días** deslizantes desde la última **escritura** (no desde la última visita). | Decisión del PO (OQ-BE-1), sobre la recomendación de 30 días de este diseño. Costo aceptado y declarado: un cliente que arma un carrito y vuelve a las dos semanas lo encuentra vacío. Es una variable de entorno — subirla no cuesta un deploy. |
| `max_quantity` (nivel de stock) se expone **sólo en la superficie del carrito**, nunca en el browse público. | El dato ya es sondeable con el 409, así que ocultarlo no protege nada; US-003 mantiene el booleano `in_stock` en la ficha/listado. Divulgación acotada y deliberada (OQ-BE-2), declarada en el threat model. |
| Purga **oportunista** (al resolver una fila vencida), sin job programado. | Redis/BullMQ no está aprovisionado (mismo estado que US-006 / ADR-0012); con `CART_TTL_DAYS = 7` la purga oportunista alcanza de sobra. El job queda diferido con dueño (OQ-BE-6). |
| Sin `Idempotency-Key` en la superficie del carrito. | La semántica `PUT` absoluta ya es idempotente; agregar la maquinaria de idempotencia sería resolver dos veces el mismo problema. |

## Decisiones de la suite QA (US-007-carrito-compra-qa)

| Decisión | Motivo |
|---|---|
| Seed **hermano** (`qa/support/seed-carrito.ts`), no una extensión de `seed-categorias.ts` (US-002). | Extenderlo acoplaría las fixtures de dos suites (cambiar el stock que el carrito necesita movería aserciones de la grilla de US-002) y tocaría un archivo que otra sesión escribía en paralelo sobre la misma rama. |
| AC-8 se prueba con **tres invitados independientes** agotando el mismo stock, no con un invitado releyendo. | La versión de un invitado pasa igual si el sistema reservara con un contador aparte o al segundo carrito. La de tres distingue: con reserva, el segundo ya recibiría 409. La aserción final se hace sobre el **panel del dueño**, no contra la base con Prisma — es la superficie que miente si alguien introduce reserva en otro módulo. |
| `qa/support/cart-client.ts` usa un `APIRequestContext` de Playwright por invitado (no pasar el token a mano entre requests). | Pasar el token prueba que el servidor acepta un token; un contexto propio con su propio almacén de cookies prueba que un invitado real conserva su carrito. `storageState()` simula "cerrar el navegador y volver" sin perder la identidad. |
| El escenario de carga sólo emite el de **escritura**; el de lectura corre sin umbral, informativo. | El PRD §4 acota su `p95 < 300 ms` a catálogo/ficha; copiarlo para `GET /v1/cart` sería inventar un gate con apariencia de rigor (OQ-QA-1, opción (b), recomendada). |
| El k6 de carga corre con `CART_WRITE_RATE_LIMIT_MAX` elevado **sólo en el entorno de carga**, y aborta si detecta 429 en vez de reportar un p95 falso. | El presupuesto productivo (30 escrituras/min/IP) es ~0,5 rps: un generador lo satura en el primer segundo y a partir de ahí mediría el throttler, no el NFR (OQ-QA-2, opción (a)). El rate-limit en sí ya lo prueba `e2e-cart-ratelimit` (dev-owned). |
| El gate de aceptación se **re-scopeó** a lo que esta US controla (`@carrito`, 14/14) en vez de "toda la suite de aceptación sigue verde". | La suite completa incluye escenarios de US-002/US-003 que fallan por seeds no idempotentes contra una base compartida (H-2) — ajeno al carrito. Un lane no debería quedar bloqueado por la higiene de otro (decisión del PO, D-1(c)). |
| AC-6 se cierra con la señal verificada (línea marcada, fuera del total) y la mitad "no permite avanzar al pago" queda para US-008. | Es lo único verificable hoy — el checkout no existía al planificar esta suite (OQ-QA-3, opción (a)). |
| No se re-testea el vencimiento de la ventana de 7 días manipulando la fila; QA cubre sólo la propiedad observable (persistencia entre "cierres de navegador") + un charter sobre el costo de los 7 días. | Manipular `carts.expires_at` desde QA rompería la disciplina de sembrar por API real y duplicaría el e2e del backend (OQ-QA-4, opción (a)). |
| Fuente única de puertos del cliente QA (`qa/support/qa-env.ts`), consumida por `world.ts`, `api.ts`, `admin-auth.ts`, `cart-client.ts` y el k6. | Tres literales en desacuerdo (`3100`, `3210`, el `3200` real) hacían fallar la suite **por entorno con síntomas de dominio** — cinco escenarios acusando asserts de negocio cuando la causa real era un 403 por `Origin` fuera de la allowlist en la segunda escritura (H-3). |
| Preflight de entorno (`verificarEntornoQA()` en un `BeforeAll`) que falla con mensaje de entorno, no con un assert de dominio críptico. | Mismo motivo que el punto anterior — la receta de entorno (CORS, rate limits elevados, puertos) es un prerrequisito no obvio y costó un diagnóstico caro la primera vez. |

## Desviaciones conscientes registradas

| Desviación | Motivo |
|---|---|
| Archivado contra `main` vía PR #3 (rama de integración `feature-entrega2-GOSP`, ya mergeada). | Mismo patrón que [`catalogo`](../catalogo/decisions.md): el producto se integra en una rama compartida antes del cambio a rama-por-change (2026-08-29). Los commits de este change son ancestro de `main`. |
| `session_token` (DER E2E §8) se materializó como `session_token_hash`; se agregaron `expires_at` y `updated_at` (no estaban en el DER). | Ninguna cambia el motor, las relaciones ni un contrato cross-stack — se declara acá en vez de abrir un CR del E2E, mismo tratamiento que US-014 le dio a columnas operativas no modeladas. Ver design.md "Desviación declarada respecto del DER". |
| Sin ADR nuevo para este change. | Verificado contra los 8 ADR vigentes y el E2E §20: ninguna decisión de este change enmienda o bordea un ADR existente (tabla completa en design.md "ADR triggers"). |
| Las Fases 4/5 de la suite QA (E2E de navegador + a11y) se escribieron **bloqueadas** (el FE estaba planificado, sin construir) y se desbloquearon **dentro de la vida del mismo change**, sin volver a `/plan-qa`, cuando `/develop-frontend-web US-007` cerró (25/25) el 2026-08-23. | No es trabajo muerto: los criterios se redactaron contra los AC observables antes de que la UI existiera, para que el FE se construyera contra ellos y no al revés. Al desbloquearse, los `Verify` por task pasaron sin reescritura. |
| Archivado del discipline QA vía este `/archive-change` **partiendo de `main`** (no de `feature-entrega2-GOSP`) — ver [[branch-from-main-not-integration-branch]]. | Los commits de la suite (14/22 en la corrida original, 22/22 al cierre) son ancestro de `main` desde el PR #3, pero el `pr-url` del índice había quedado en `null` — mismo drift que US-004 backend y US-018 FE. |
