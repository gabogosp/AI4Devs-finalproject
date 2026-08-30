---
tracker-id: null
tracker-source: null
parent-us: US-007
discipline: qa
variant: null
language: es
---

# US-007 QA — Suite cross-stack del carrito del invitado

## Why

US-007 cierra el eslabón que faltaba en el loop de compra del PRD (§3.1): el carrito.
Es, además, **la primera superficie pública de escritura** del producto — cookie propia,
CSRF sobre una identidad que no es la de sesión, throttler propio, `no-store` — y el
lugar donde se apoya la invariante de inventario que gobierna todo lo que viene después.

El change de backend cubre su capa con una densidad poco común: 7 archivos de e2e-nest
(`e2e-cart-crud`, `-availability`, `-stock`, `-persistence`, `-security`, `-ratelimit`,
`-events`) que ejercitan los 10 AC contra Postgres real, más unit e integration. **Nada
de eso se re-autora acá.** Lo que ninguna capa dev-owned puede ver es otra cosa:

- **La invariante de AC-8 vista desde el dueño.** El e2e del backend prueba que el
  carrito no toca `products` *dentro de su propio proceso y su propia fixture*. Lo que
  silenciosamente se vuelve falso es otra cosa: que **el stock que el dueño ve en su
  panel** no cambie porque haya carritos vivos. US-008 y US-009 ya están planificándose
  en esta misma rama; el día que alguien "mejore" el checkout reservando stock al
  agregar, el test que se pone rojo tiene que ser uno que mire el inventario por la
  superficie del dueño, no por el repositorio del carrito.
- **La costura entre el panel (US-001), la ficha (US-003) y el carrito.** El dueño cambia
  el precio o despublica desde el panel; el carrito tiene que reflejarlo en la lectura
  siguiente **aunque la ficha pública siga sirviendo el valor anterior desde su caché**.
  Son dos módulos con dos políticas de caché opuestas (`max-age=60` contra `no-store`) y
  ningún test de un solo módulo compara las dos.
- **La identidad pública del producto.** El carrito acepta `slug`; la ficha publica
  `slug`. Si esos dos divergen —exactamente lo que casi pasa en US-002 con `sku`— el
  botón «Agregar al carrito» de la ficha deja de funcionar y ninguna suite de un solo
  módulo lo nota.
- **La configuración real del borde.** El e2e-nest arma la app en proceso con env de
  test. Que el `PUT`/`DELETE` del carrito sobrevivan al preflight con la allowlist de
  CORS real, y que `CART_TTL_DAYS` valga lo que el PO decidió en el entorno donde se
  prueba, sólo se ve contra el proceso arrancado.
- **Toda la mitad de UI de los 10 AC**: stepper acotado al stock, estado vacío con
  invitación, avisos de no disponible, y los dos requisitos de accesibilidad que la US
  §9 pide por su nombre (stepper por teclado, anuncio del cambio de total). El plan de FE
  —escrito hoy en paralelo— cubre la a11y **a nivel componente** (`axe(container)`,
  `aria-live`); lo que queda para QA es la **página servida** en un browser real.

## What changes

- **Extensión del paquete `@dsm/qa`** — no se crea infraestructura: se reusan el world de
  aceptación, el fixture de auth admin real, los builders, `apiCall`, `thresholds.js` y
  los dos configs de Playwright. Se agregan **dos archivos de soporte propios** de esta
  US: un seed hermano (`seed-carrito.ts`) y un cliente de carrito con manejo de cookies y
  CSRF (`cart-client.ts`).
- **Aceptación BDD API-level** (Cucumber + Playwright `APIRequestContext`): 12 escenarios
  en las 4 categorías canónicas — 4 happy, 3 corner, 2 negative-space, 3 cross-feature.
  **Ejecutables hoy** contra el contrato publicado.
- **E2E de navegador** (Playwright): 6 recorridos de la UI del carrito. **Bloqueados**: el
  change de FE (`US-007-carrito-compra-frontend-web`) se planificó el 2026-08-22 en una
  sesión paralela y todavía **no está desarrollado**.
- **Accesibilidad**: axe-core sobre las tres variantes del carrito + recorrido de teclado
  con anuncio del total. **Bloqueados** por lo mismo.
- **Carga** (k6): un escenario de **escritura** contra el presupuesto `p95 < 500 ms` que
  el PRD §4 fija por su nombre para «carrito/orden». El escenario de **lectura** se
  **rechaza a propósito**: no existe un número ratificado para `GET /v1/cart` (ver
  §Open questions).
- **Charters de exploratorio**: el carrito frente a navegadores reales (incógnito,
  cookies bloqueadas, el techo de vida de cookie de Safari/ITP justo en los 7 días) y la
  ventana de retención contra el ciclo real de compra de un gremio.

## ACs de US-007 cubiertos (capa 3)

Los **10 AC tienen escenario QA**, y **los 10 tienen al menos un escenario ejecutable
hoy** a nivel API. Ninguno queda diferido en su totalidad.

| AC | Cobertura QA ejecutable hoy | Cobertura QA bloqueada por el FE | Nota de cobertura dev |
|---|---|---|---|
| **AC-1** agregar | H-1, X-3 | E-1 | `e2e-cart-crud` |
| **AC-2** editar cantidad | H-2 | E-1, A-2 | `e2e-cart-crud` |
| **AC-3** quitar | H-3 | E-1 | `e2e-cart-crud` |
| **AC-4** persistencia | H-4 | E-2 | `e2e-cart-persistence` |
| **AC-5** tope de stock | C-1 | E-4 | `e2e-cart-stock` |
| **AC-6** dejó de estar disponible | X-1, C-3 | E-5 | `e2e-cart-availability` |
| **AC-7** carrito vacío | C-2 | E-3 | `e2e-cart-persistence` |
| **AC-8** no reserva ni descuenta | **N-2** | — | `e2e-cart-stock` |
| **AC-9** precios vigentes | X-2 | E-6 | `e2e-cart-availability` |
| **AC-10** no publicados | N-1 | — | `e2e-cart-availability` |
| **NFR** WCAG 2.1 AA + teclado + anuncio de total | — | A-1, A-2 | — |
| **NFR** p95 escritura < 500 ms | L-1 | — | — |

**Alcance real de AC-6**: el AC pide dos cosas —señalar el ítem y **no permitir avanzar
al pago**—. El carrito entrega la señal (`has_blocking_issues`), que es lo que X-1 y C-3
verifican; **impedir el avance lo ejecuta el checkout de US-008**. Se declara acá para
que nadie lea la US como cerrada por el lado equivocado (ver OQ-QA-3).

## Out of scope

- **Re-autoría de las capas dev-owned** (unit, integration, e2e-nest, contract, smoke):
  son la TDD del backend. Acá se referencian como cobertura consciente, nunca se repiten.
- **CSRF, rate-limit, `no-store`, atributos de cookie y aislamiento de throttlers** como
  *objeto de test*: los cubre `e2e-cart-security` / `e2e-cart-ratelimit`. Esta suite los
  **usa** (el cliente tiene que hablar CSRF para escribir), no los vuelve a probar.
- **El checkout y el pago** — US-008 / US-009. Acá se verifica la señal que el checkout
  consume, no el bloqueo.
- **El decremento de stock al aprobar el pago** — US-010 / ADR-0008. Acá se verifica
  justamente lo contrario: que **antes** del pago nada se mueva.
- **La fusión del carrito invitado con la cuenta** — fuera de v1 (US §4, OQ-BE-3).
- **La purga programada de carritos vencidos** — diferida por OQ-BE-6.

## Open questions

- **OQ-QA-1 — No hay presupuesto ratificado para `GET /v1/cart`, así que el stub de
  carga de lectura no se emite.** `[Resolved: 2026-08-22 — no se emite el stub; se mide sin umbral dentro de L-1]` Ratificado por el usuario: un umbral inventado que pasa da falsa sensación de cobertura. El dato queda disponible para el día que el Arquitecto firme el número. El PRD §4 acota los `p95 < 300 ms` a «catálogo/ficha»,
  y el `design.md` del backend marca el número del carrito como
  `[propuesto — confirma Arquitecto]`. Inventar el umbral en el script sería exactamente
  el teatro que `k6-load-scaffolding` prohíbe. Opciones y recomendación en `design.md`
  §Decisiones abiertas.
- **OQ-QA-2 — El presupuesto de escritura (30/min/IP) hace estructuralmente imposible
  medir el NFR de escritura desde un generador.** `[Resolved: 2026-08-22 — elevar CART_WRITE_RATE_LIMIT_MAX sólo en el entorno de carga]` Ratificado por el usuario, con la condición declarada en el reporte. El script aborta ante un 429 en vez de reportar un p95 falso. 30 req/min es 0,5 rps: un k6 contra
  `PUT /v1/cart/items/{slug}` mide el throttler, no la latencia. Requiere decidir cómo se
  corre el escenario de carga.
- **OQ-QA-3 — ¿AC-6 se cierra en US-007 con la señal verificada, o espera a US-008?**
  `[Resolved: 2026-08-22 — opción (a): se cierra con la señal verificada]` Ratificado por el usuario. El carrito emite `has_blocking_issues` y eso se prueba acá; impedir el avance al pago lo ejecuta US-008 cuando exista — cobertura parcial declarada, no silenciosa.
  `[Resolved: 2026-08-22 — se cierra con la señal verificada]` Ratificado por el usuario: se prueba `has_blocking_issues`; impedir el avance al pago lo ejecuta US-008. Cobertura parcial declarada, no silenciosa.
- **OQ-QA-4 — La ventana de 7 días no es observable de punta a punta sin manipular
  `carts.expires_at` por fuera de la API.** `[Resolved: 2026-08-22 — no se re-testea; el charter TC-751 cubre el costo declarado]` Ratificado por el usuario: el vencimiento ya lo cubren los tests del backend, que sí pueden manipular el reloj.

## Referencias

- US: `docs/user-stories/US-007-carrito-compra.md`
- Change de backend: `openspec/changes/US-007-carrito-compra-backend/` (36/37 cerradas)
- Contrato publicado: `apps/api/docs/api/openapi.yaml` (`getCart`, `setCartItem`, `removeCartItem`)
- ADR-0008 — el stock se descuenta al aprobar el pago (**gobierna AC-5 y AC-8**)
- Suite que se extiende: `qa/` (`@dsm/qa`, desde US-001)
- Change de QA de referencia (misma forma): `openspec/changes/US-002-storefront-navegacion-categorias-qa/`
