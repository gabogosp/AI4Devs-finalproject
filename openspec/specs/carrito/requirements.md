# CAP-4 Carrito — Requisitos acumulados

Acumulado de los changes archivados de esta capacidad. Cada requisito es el **estado
declarado del sistema vivo**, no la intención de un change.

## Desde US-007 backend — Carrito de compra del invitado (archivada 2026-08-29)

Superficie cubierta: `GET /v1/cart`, `PUT /v1/cart/items/{slug}`, `DELETE /v1/cart/items/{slug}`.

### Funcionales

| # | Requisito | Origen |
|---|---|---|
| R-1 | `PUT /v1/cart/items/{slug}` agrega el producto con la cantidad dada; el carrito recalculado (ítem, precio unitario vigente, subtotal, total) vuelve completo en la respuesta. | AC-1 |
| R-2 | `PUT` sobre una línea existente fija la cantidad (semántica absoluta, no suma); subtotal y total se recalculan. | AC-2 |
| R-3 | `DELETE /v1/cart/items/{slug}` quita la línea; el total se recalcula. Es idempotente: quitar algo inexistente devuelve el carrito igual, con 200. | AC-3 |
| R-4 | El carrito del invitado persiste **7 días** deslizantes desde la última escritura (`CART_TTL_DAYS`), identificado por la cookie `httpOnly` `dsm_cart` — sin necesitar cuenta. | AC-4 |
| R-5 | Pedir una cantidad mayor al stock disponible se rechaza con `409 dsm:cart/insufficient-stock` y `available_quantity` en el cuerpo; no se permite superar el stock. La revalidación en el checkout es responsabilidad de US-008. | AC-5 |
| R-6 | Una línea cuyo producto quedó despublicado o sin stock suficiente se marca (`unavailable` / `insufficient_stock`) en la lectura, con `has_blocking_issues: true`; no se borra sola ni suma al `total_ars_cents`. | AC-6 |
| R-7 | `GET /v1/cart` sin cookie, con cookie huérfana o con la fila vencida devuelve el carrito vacío (`id: null`, contadores en 0) con **200**, nunca 404. | AC-7 |
| R-8 | Ningún camino de este change escribe `products.stock`: la invariante está cubierta por test dedicado. El descuento ocurre sólo al aprobarse el pago (US-010, ADR-0008). | AC-8 |
| R-9 | Todo importe devuelto (`unit_price_ars_cents`, `subtotal_ars_cents`, `total_ars_cents`) se calcula con el precio **vigente** de `products` leído en la misma request; `Cache-Control: no-store` en toda la superficie evita que una caché sirva un precio viejo. | AC-9 |
| R-10 | `PUT` sobre un producto en `draft`, `archived` o un slug inexistente devuelve **el mismo** `404 dsm:catalog/not-found` — no distingue los dos casos (evita enumerar el catálogo oculto). | AC-10 |

### Negative-space (lo que NO debe pasar)

| # | Requisito |
|---|---|
| N-1 | El carrito no reserva ni descuenta `products.stock` en ningún camino de escritura. |
| N-2 | Un total del carrito nunca incluye líneas `insufficient_stock` o `unavailable`. |
| N-3 | El token del carrito no se loguea jamás, ni en claro ni hasheado. |
| N-4 | Un `PUT`/`DELETE` sin `X-CSRF-Token` válido (cuando la cookie `dsm_cart` ya existe) se rechaza con 403, igual que un `Origin` fuera de la allowlist o ausente. |
| N-5 | El cuerpo del `PUT` sólo acepta `quantity`; `unit_price_ars_cents`, `product_id` o `cart_id` en el body son 422 (`forbidNonWhitelisted`), nunca se ignoran en silencio. |

### No funcionales

| # | Requisito | Verificación |
|---|---|---|
| NFR-1 | Latencia de escritura (`PUT`/`DELETE`) **p95 < 500 ms**. | **Medido** (QA, `US-007-carrito-compra-qa`, 2026-08-23): `qa/performance/cart-write.js`, **p95 4,28 ms**, `rate_limited: 0`, checks 34.794/34.794. Corrida con `CART_WRITE_RATE_LIMIT_MAX` elevado sólo en el entorno de carga — el presupuesto productivo (30/min/IP) hace irrealizable la medición (OQ-QA-2). |
| NFR-2 | Latencia de lectura (`GET /v1/cart`) `[propuesto — confirma Arquitecto]`, sin umbral ratificado. | **Medido informativamente** (QA, misma corrida): **p95 1,61 ms**, sin gate — el PRD §4 acota su `p95 < 300 ms` a catálogo/ficha, no al carrito; adoptarlo por analogía sería inventar el número (OQ-QA-1, decisión (b)). |
| NFR-3 | Retención del carrito invitado: **7 días** deslizantes desde la última escritura. | `CART_TTL_DAYS = 7`; decisión del PO (OQ-BE-1). Variable de entorno, ajustable sin deploy de código. |
| NFR-4 | Cota de 50 líneas distintas por carrito (`CART_MAX_ITEMS`) y 99 unidades por línea (`CART_MAX_QTY_PER_LINE`). | `409 dsm:cart/too-many-items` / `422`. |
| NFR-5 | El borde HTTP cumple los controles §7 de security-standards sobre esta superficie: throttler `cart` nombrado (120/min lectura, 30/min escritura por IP), `no-store` también en 4xx/429, CORS con `PUT`/`DELETE` en la allowlist. | Suite `e2e-cart-*` (dev-owned). |

### Diferidos con dueño

| # | Requisito | Dueño / disparador |
|---|---|---|
| D-1 | Fusión del carrito del invitado con la cuenta al iniciar sesión (política ya decidida: sumar cantidades, tope al stock). | US de fusión, fuera de v1. `carts.customer_id` existe en el esquema sin escritor hasta esa US. |
| D-2 | Job programado de purga de carritos vencidos (hoy sólo purga oportunista al resolver). | Diferido mientras Redis/BullMQ no esté aprovisionado (OQ-BE-6). |

## Desde US-007 frontend-web — Carrito de compra del invitado: UI (archivada 2026-08-30)

Superficie cubierta: `/carrito`, badge del top-nav, `AddToCartButton` en ficha y listado.

### Funcionales

| # | Requisito | Origen |
|---|---|---|
| R-11 | La página `/carrito` muestra las líneas, el total y el estado vacío calculados por el `CartView` del backend, sin recalcular nada localmente. | AC-1, AC-2, AC-3 |
| R-12 | El carrito sobrevive al cierre del navegador y a recargas sin que el frontend administre la cookie `dsm_cart` — persistencia delegada al backend vía el rewrite same-origin. | AC-4 |
| R-13 | Una línea con `availability: 'insufficient_stock'` muestra «quedan N» con acciones «ajustar» / «quitar»; una con `'unavailable'` muestra «ya no disponible» con «quitar»; ninguna de las dos entra en el total mostrado (el backend ya las excluyó). | AC-5, AC-6, AC-8 |
| R-14 | `has_blocking_issues: true` deshabilita el CTA «Ir al pago» con el motivo visible. | AC-6 |
| R-15 | Un cambio de precio (`price_changed` + `previous_unit_price_ars_cents`) se muestra explícitamente («cambió de $X a $Y»), nunca en silencio. | AC-9 |
| R-16 | El stepper de cantidad no permite superar `max_quantity`; es pesimista (espera la respuesta del servidor antes de reflejar el nuevo valor) con debounce de 400 ms. | AC-5 |
| R-17 | El badge del top-nav refleja el conteo de unidades del carrito como isla cliente dentro de un layout que sigue siendo Server Component (lo necesita `CategoryNav` para el SEO de US-002). | AC-1 |
| R-18 | «Agregar al carrito» está habilitado en la ficha de producto (`ProductPurchase`, apaga el cartel de roadmap de US-003) y en la card del listado (`ProductCard`, cantidad 1 sin stepper). | AC-1 |

### No funcionales

| # | Requisito | Verificación |
|---|---|---|
| NFR-6 | `/carrito` es `noindex` — un carrito no es contenido público. | Metadata API; E2E de topología (espejo de `auth-topology.spec.ts`). |
| NFR-7 | Accesibilidad WCAG 2.1 AA: stepper operable por teclado con `aria-label` que nombra el producto, total con `aria-live="polite"`, mini-cart `role="status"` sin robar foco, motivo de bloqueo en texto (nunca sólo color). | Suite a11y dev-owned + `US-007-carrito-compra-qa`. |
| NFR-8 | p95 de escritura del carrito (`PUT`/`DELETE`) `< 500 ms` medido en la operación, no en la pintura — la llamada suma un hop same-origin por el rewrite (costo declarado en ADR-0013). | E2E §17. |

### Diferidos con dueño

| # | Requisito | Dueño / disparador |
|---|---|---|
| D-4 | CTA «Ir al pago» — hoy deshabilitado con el motivo a la vista. | `US-008` (checkout) — owner: FE. |
| D-5 | Carrito sin JavaScript / renderizado en servidor. | No soportado a propósito: exigiría relajar el guard que impide fugar datos personalizados entre personas (OQ-FE-5, design.md D1). |
| D-6 | Verificación manual de consola limpia al recorrer el carrito en `dev` (agregar, cambiar cantidad, quitar, vaciar). | Único ítem sin cerrar de `tasks.md` — lo hace una persona, no el ejecutor; queda registrado en el PR de este archive. |

## Desde US-007 QA — Suite L3 cross-stack (archivada 2026-08-30)

Cobertura: aceptación BDD API-level (14 escenarios), E2E de navegador (6), a11y (2), carga
k6 (1) y exploratorio (2 charters) sobre el carrito descrito arriba.

### Funcionales verificadas

| # | Requisito verificado | Test case |
|---|---|---|
| V-1 | Los 10 AC del backend tienen ≥1 escenario ejecutable a nivel API, sin esperar al FE. | TC-701..712 |
| V-2 | AC-8 (stock nunca reservado) resiste el ataque específico: **tres invitados independientes** agotan el mismo stock de 3 unidades cada uno; los tres quedan `available`; el panel del dueño y la ficha pública siguen mostrando el stock real tras un ciclo completo de escritura. | TC-709 |
| V-3 | El recorrido de compra completo (agregar desde la ficha, ver línea con subtotal, editar con el stepper, quitar) funciona en un navegador real; el carrito persiste entre **contextos de navegador nuevos** (sólo cookies). | TC-720, TC-721 |
| V-4 | El carrito vacío invita a seguir comprando (no sólo ausencia de ítems). | TC-722 |
| V-5 | El stepper no permite superar el stock disponible y muestra el motivo; una línea no disponible se ve marcada sin ofrecer camino al pago; el importe mostrado es siempre el vigente. | TC-723, TC-724, TC-725 |
| V-6 | 0 violaciones axe-core nivel AA en las 3 variantes del carrito (con ítems, vacío, con línea bloqueada). | TC-730 |
| V-7 | El stepper y "quitar" se operan **sólo con teclado** con foco visible y orden lógico; el cambio de cantidad anuncia el nuevo total por una región viva. | TC-731 |

### No funcionales verificadas

Ver NFR-1 y NFR-2 arriba (medidos por esta suite).

### Diferidos con dueño

| # | Requisito | Dueño / disparador |
|---|---|---|
| D-7 | Charter exploratorio TC-750 (carrito bajo navegadores reales: incógnito, cookies bloqueadas, ITP de Safari — su techo de vida cae en los mismos 7 días de `CART_TTL_DAYS`). | Sesión manual con el dueño — ejecutable ahora que la UI existe; no automatizado por diseño. |
| D-8 | Saneamiento de los seeds no idempotentes de US-002/US-003 (H-2) y de los `Verify:` de aceptación sin ancla de conteo (H-1). | Ajenos al carrito, detectados corriendo su suite. Owner: QA — pase de saneamiento pendiente de agendar. |
| D-9 | Aislamiento de fixtures entre specs E2E del carrito (`TC-724`/`TC-725` interfieren con la suite completa por la caché de 3600 s del storefront sobre mutaciones reales del catálogo). | Owner: QA — pasan aislados; no debilita ningún assert existente. |
