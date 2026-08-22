---
tracker-id: null
tracker-source: null
parent-us: US-007
discipline: backend
variant: null
language: es
---

# US-007 Backend — Carrito de compra guest

## Why

US-003 dejó la ficha de producto pública y navegable. Lo que falta para que el
loop de compra del PRD arranque es el paso intermedio: **poder juntar productos
antes de pagar**. US-008 (checkout) está `blocked_by: [US-007]`, así que esta US
es el cuello de botella del resto del loop comercial.

El backend de esta US es más chico de lo que parece — cuatro operaciones sobre
dos tablas — y su dificultad está concentrada en **tres invariantes que son
fáciles de romper y caros de detectar**:

1. **El carrito no reserva stock** (AC-8, ADR-0008). Es contraintuitivo: la
   lectura natural de "agregar al carrito" es "apartar la unidad". ADR-0008
   decidió lo contrario a propósito —el stock se descuenta recién al aprobarse el
   pago— y el precio de esa decisión es que **dos clientes pueden tener el último
   tornillo en su carrito y sólo uno se lo lleva**. El backend tiene que aceptar
   eso sin disimularlo: nada de reservas, nada de contadores intermedios.

2. **Los precios son siempre los vigentes** (AC-9). Un carrito que muestra el
   precio de la semana pasada es una promesa que el mostrador no puede cumplir, y
   en una ferretería —donde los precios se mueven con la inflación— eso pasa de
   ser un caso raro a ser el caso normal.

3. **El carrito es una capacidad al portador**. Quien tiene la cookie tiene el
   carrito. No hay contraseña que lo proteja, así que el token tiene que ser
   impredecible y no filtrarse — el mismo estándar que un token de sesión.

Ninguno de los tres se ve al mirar la UI. Los tres se rompen en silencio.

## What changes

### Migración (aditiva)

Dos tablas nuevas, `carts` y `cart_items`, exactamente como las declara el DER
del E2E §8. **Ninguna tabla existente se toca**: `products` no gana columnas de
reserva ni contadores, que es la contracara concreta de AC-8 y ADR-0008.

### Superficie HTTP — módulo `cart` nuevo (E2E §6 lo declara)

| Ruta | Código | AC |
|---|---|---|
| `GET /v1/cart` | 200 | AC-1, AC-6, AC-7, AC-9 |
| `POST /v1/cart/items` | 201 | AC-1, AC-5, AC-10 |
| `PATCH /v1/cart/items/{itemId}` | 200 | AC-2, AC-5 |
| `DELETE /v1/cart/items/{itemId}` | 204 | AC-3 |

Superficie **pública** (sin auth): el carrito es guest por definición. La
identidad es la cookie `dsm_cart`, un token opaco reusado de la primitiva que
construyó US-014 (`auth/tokens/opaque-token.ts`).

### Cálculo de importes

El total y los subtotales se calculan **contra el precio vivo** del producto en
cada lectura. `cart_items.unit_price_ars_cents` guarda el precio **al agregar** y
se usa sólo para señalar que cambió (`price_changed: true`), nunca para calcular.

### Disponibilidad por ítem

Cada ítem se devuelve con su estado: `available`, `unpublished` o `out_of_stock`
(AC-6). El carrito **no borra solo** los ítems que dejaron de estar disponibles —
sacarle algo del carrito a alguien sin avisarle es peor que mostrárselo tachado.

## ACs de US-007 cubiertos

| AC | Cobertura backend | Nota |
|---|---|---|
| **AC-1** agregar producto | `POST /cart/items` + `GET /cart` | |
| **AC-2** editar cantidad | `PATCH /cart/items/{id}` | |
| **AC-3** quitar producto | `DELETE /cart/items/{id}` | |
| **AC-4** persistencia entre visitas | Cookie `dsm_cart` + fila `carts` | TTL **7 días** (OQ-BE-2) |
| **AC-5** cantidad limitada al stock | Validación en agregar y editar | Revalidación en checkout: US-008 |
| **AC-6** producto no disponible | `availability` por ítem en `GET /cart` | El bloqueo de avanzar al pago es US-008 |
| **AC-7** carrito vacío | `GET /cart` → `items: []`, totales en 0 | El estado vacío visual es FE |
| **AC-8** no reserva ni descuenta stock | **Negative space** — test que lo prueba | |
| **AC-9** precios vigentes | Cálculo contra el precio vivo | |
| **AC-10** no se agregan no publicados | Validación en agregar + `GET` marca | |

## Out of scope

- **Checkout, datos del comprador y pago** — US-008 / US-009. Acá el carrito se
  arma; nadie avanza a nada.
- **Bloquear el avance al pago con ítems no disponibles** — el backend **marca**
  la indisponibilidad (AC-6); impedir el checkout es de US-008, que es quien tiene
  el endpoint donde impedirlo.
- **Descuento de stock** — US-010, al aprobarse el pago (ADR-0008).
- **Fusión del carrito guest con la cuenta al loguearse** — fuera de alcance por
  decisión de la US y ratificado en OQ-BE-3.
- **Cupones y descuentos** — fuera de v1.
- **Purga programada de carritos vencidos** — necesita BullMQ y Redis no está
  provisionado (ADR-0004). Se hace limpieza oportunista acotada, igual que en
  US-014. `Deferred: US-019 / operaciones — owner: Arquitecto`.

## Standards consultados

- `backend-node-standards.md` §2 (controller fino), §4 (DTO en el borde), §5
  (repositorio como único punto de ORM; transacción para casos multi-escritura),
  §6 (errores de dominio → RFC 7807), §7 (fail-fast de config).
- `security-standards.md` §3.7 (token opaco ≥128 bits de un CSPRNG), §7.3
  (rate-limit), §7.4 (atributos de cookie).
- `api-standards.md` §5 (el contrato declara todo lo que la API expone), §8
  (RFC 7807), §12 (429 con `Retry-After` y `RateLimit-*`).
- `observability-standards.md` §9 (sin PII en logs ni métricas).
- E2E §6 (módulo `cart`), §8 (DER), §17 (p95 escritura < 500 ms), §18 (eventos).
- ADR-0008 (el stock se descuenta al aprobar el pago, nunca antes).

## Open questions

- **OQ-BE-1 — El DER guarda `unit_price_ars_cents` pero AC-9 exige precios
  vigentes.** `[Resolved: 2026-08-20 — decisión del PO: se guarda como "precio al
  agregar" y los importes se calculan SIEMPRE contra el precio vivo. El valor
  guardado no participa del cálculo; sirve para devolver `price_changed: true` y
  que el cliente se entere de que el precio se movió. Cumple el DER y AC-9 a la
  vez, y agrega un aviso que ninguno de los dos pedía pero que evita la peor
  versión del problema: enterarse del precio nuevo recién en el checkout.]`

- **OQ-BE-2 — AC-4 pide "un período definido" de persistencia sin dar el
  número.** `[Resolved: 2026-08-20 — decisión del PO: 7 días.` Se planteó el
  trade-off: 7 días deja la tabla chica y con menos carritos fantasma, pero en una
  ferretería la compra suele postergarse —esperar el cobro, consultar medidas,
  comparar— y un carrito que se vence antes de que la persona vuelva cuesta
  conversión. **Si la métrica de "carritos recuperados" de US-016 muestra caída,
  éste es el primer número a revisar.**`]`

- **OQ-BE-3 — `carts.customer_id` existe en el DER pero la fusión guest→cuenta
  está fuera de alcance.** `[Resolved: 2026-08-20 — decisión del PO: US-007 no
  mira la sesión en absoluto. El carrito se identifica ÚNICAMENTE por la cookie, y
  `customer_id` queda creado y sin escribir, con el diferimiento documentado —
  mismo patrón que US-014 usó con `deleted_at`. Loguearse no cambia nada del
  carrito. Consecuencia a no perder de vista: un cliente que arma el carrito
  deslogueado y después entra a su cuenta **sigue viendo el mismo carrito** (la
  cookie no cambia), que es el comportamiento deseable; lo que no existe todavía
  es reconciliar DOS carritos.]`

- **OQ-BE-4 — ¿Qué pasa si el mismo producto se agrega dos veces?**
  `[Resolved: 2026-08-20 — se suma la cantidad sobre la fila existente en vez de
  crear una segunda, con un UNIQUE (cart_id, product_id) que lo hace imposible de
  violar. Dos filas del mismo producto obligarían al FE a decidir cuál mostrar y
  harían ambiguo el PATCH por `itemId`.]`

## Referencias

- US: `docs/user-stories/US-007-carrito-compra.md`
- E2E: `docs/product/design-e2e.md` §6 (componentes), §8 (DER), §17 (NFR)
- ADR-0008: `docs/architecture/decisions/0008-decrement-inventory-on-approved-payment.md`
- Contrato vivo de la capacidad: `openspec/specs/catalogo/contracts/openapi.yaml`
- Primitiva de token reusada: `apps/api/src/auth/tokens/opaque-token.ts` (US-014)
