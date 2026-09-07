---
type: user-story
id: US-025
slug: resenas-calificaciones-productos
parent-prd: docs/product/prd.md
prd-capacity: null   # no nace del PRD §2.1: hallazgo de la prueba visual del dueño — quiere
# "copiar de Mercado Libre" (descripción rica + reseñas + estrellas). La descripción ya
# existía en código (US-005, sólo faltaba dato de demo — resuelto aparte); reseñas/
# calificaciones es la parte que genuinamente nunca estuvo en el PRD ni en el roadmap
# §2.2. Mismo patrón que US-009/US-022/US-024 (`prd-capacity: null`).
parent-e2e: docs/product/design-e2e.md
status: Done
priority: Medium
estimate-tshirt: L
story_points_traditional: 13
story_points_ai_assisted: 6
estimation_basis: "Disciplina dominante BE: schema nuevo (reviews) + regla de elegibilidad por compra entregada (join contra orders/order_items, no un simple 'está logueado') + agregado de rating promedio con caché/recalculo + endpoint de moderación admin (Cohn 2005 §10, 10 SP). FE: form de reseña + estrellas + lista paginada + estado de moderación (Cohn 2005 §8, 6 SP). Se toma el dominante × 0.6 (feature nueva de scope grande, no acotada como US-024) = 6, mismo criterio de agregado que otras US de este proyecto."
language: es
created: 2026-09-06
updated: 2026-09-07
ready-at: 2026-09-06
in-progress-at: 2026-09-06
done-at: 2026-09-07
authored-by: Gabriel Suarez
disciplines: [BE, FE, QA]
linear-issue-id: null
figma-frames: []
---

# US-025: Reseñas y calificaciones de productos

## 1. La historia (formato Connextra)

**Como** cliente que compró un producto,
**quiero** poder calificarlo con estrellas y dejar un comentario,
**para** ayudar a otros compradores a decidir, como hago en Mercado Libre.

**Como** cliente navegando el catálogo,
**quiero** ver la calificación promedio y las reseñas de un producto en su ficha,
**para** decidir si comprarlo con más confianza.

**Como** dueño del local,
**quiero** poder ocultar una reseña ofensiva o falsa,
**para** que el catálogo no muestre contenido que dañe la reputación del negocio sin motivo real.

## 2. Por qué importa (Valuable)

Hoy la ficha de producto no tiene ninguna señal social — ni estrellas, ni reseñas, ni cantidad de compradores. Es la brecha que el propio dueño señaló comparando con Mercado Libre: la prueba social es lo que convierte a un cliente indeciso. Sin reseñas, cada decisión de compra depende sólo de la descripción y el precio.

## 3. Criterios de aceptación (Gherkin / Given-When-Then)

### AC-1: Dejar una reseña de un producto comprado y entregado
```gherkin
Given un cliente autenticado con una orden en estado "delivered" que incluye el producto "Taladro X"
When entra a la ficha de "Taladro X", elige 4 estrellas y escribe "Anduvo bien, tardó lo esperado"
Then la reseña se guarda asociada a su cliente y a ese producto
And aparece en la lista de reseñas del producto (pendiente de moderación según AC-8, si aplica)
```

### AC-2: Calificar sin comentario (el texto es opcional)
```gherkin
Given un cliente elegible para reseñar un producto (AC-1)
When elige 5 estrellas y no escribe ningún comentario
Then la reseña se guarda igual, sólo con la calificación
```

### AC-3: Ver el promedio y el conteo en la ficha
```gherkin
Given un producto con 3 reseñas visibles de 5, 4 y 3 estrellas
When cualquier persona (autenticada o no) entra a la ficha del producto
Then ve el promedio "4.0" y "3 reseñas"
```

### AC-4: Producto sin reseñas
```gherkin
Given un producto sin ninguna reseña todavía
When cualquier persona entra a su ficha
Then ve un estado "Sin reseñas todavía" en vez de un promedio o una lista vacía sin explicación
```

### AC-5: Editar la propia reseña
```gherkin
Given un cliente que ya dejó una reseña de un producto
When vuelve a la ficha y cambia su calificación de 3 a 5 estrellas
Then se actualiza la MISMA reseña (no se crea una segunda) — una reseña por cliente por producto
```

### AC-6 (negative-space): no comprado → no puede reseñar
```gherkin
Given un cliente autenticado que nunca compró el producto "Taladro X" (o cuya orden con ese producto no llegó a "delivered")
When entra a la ficha de "Taladro X"
Then NO ve ningún control para dejar una reseña
And si intenta un POST directo a la API, el sistema lo rechaza (403) sin importar lo que envíe el cliente
```

### AC-7 (negative-space): invitado no puede reseñar
```gherkin
Given una persona sin sesión iniciada (incluye quien compró como invitado, checkout guest de US-008)
When entra a la ficha de un producto
Then NO ve ningún control para dejar una reseña
And se le explica que necesita una cuenta (registrarse) para reseñar
```

### AC-8: El dueño oculta una reseña
```gherkin
Given una reseña visible con contenido ofensivo/falso
When el dueño la oculta desde el panel admin
Then la reseña deja de contarse en el promedio y deja de listarse en la ficha pública
And el cliente que la escribió, si vuelve a la ficha, ve que su reseña sigue existiendo pero marcada como "oculta por moderación" (no se le borra en silencio sin explicación — transparencia, no censura invisible)
```

### AC-9 (negative-space): calificación fuera de rango es rechazada
```gherkin
Given un cliente elegible dejando una reseña
When envía una calificación de 0 o de 6 estrellas (fuera de 1-5)
Then el sistema la rechaza con un mensaje claro
And no se guarda ninguna reseña
```

## 4. Out of scope explícito

- **Reseñas con foto/video adjunta** — sólo texto + estrellas en v1. Si se justifica después, es una US aparte (probablemente reusa la decisión de US-024 sobre URLs vs. upload real).
- **Respuesta del dueño a una reseña** (como "responder al comentario" de Mercado Libre) — el dueño sólo puede ocultarla (AC-8), no responder públicamente. CR futuro si se pide.
- **Votar "esto te sirvió" en una reseña ajena** — funcionalidad de ranking social, fuera de v1.
- **Notificar al cliente cuando su reseña es ocultada** — se ve reflejado si vuelve a la ficha (AC-8), pero no se dispara un email. Reusa el criterio de US-013/US-021 de notificar sólo lo que el negocio ya declaró crítico.
- **Reseñar sin cuenta / como invitado** — decisión explícita del dueño (AC-7): sólo clientes registrados con compra entregada, igual criterio de confianza que Mercado Libre.

## 5. INVEST self-check

| Letra | Criterio | Cumple? | Notas |
|---|---|---|---|
| **I** | Independent | ⚠️ | Depende de que `Order`/`OrderItem`/`Customer` existan (US-008/US-014, ambas Done) y de que haya órdenes reales en estado `delivered` (US-013, Done) para poder ejercitar el camino feliz — no bloquea código, sí requiere datos de prueba con ese estado. |
| **N** | Negotiable | ✅ | Los AC fijan el comportamiento; forma del schema/endpoint queda al equipo. |
| **V** | Valuable | ✅ | Prueba social directa, pedida por el dueño. |
| **E** | Estimable | ✅ | T-shirt L — mayor incertidumbre que US-024 por el join de elegibilidad + moderación, pero acotado. |
| **S** | Small | ⚠️ | L es grande para un ciclo — considerar dividir en un futuro `/plan-backend-ticket` si el arquitecto lo ve necesario (ej. fase 1: reseñar + listar + promedio; fase 2: moderación admin). Se deja entera acá porque el dueño la pidió como una sola pieza de valor ("copiar de Mercado Libre"); la división en tasks/fases queda para el plan técnico. |
| **T** | Testable | ✅ | Los 9 AC son verificables sin ambigüedad. |

## 6. Dependencias

- **Bloqueada por**: US-008 (checkout, Done), US-013 (cancelación/estado `delivered`, Done), US-014 (cuentas, Done) — necesita que las tres piezas existan para que la regla de elegibilidad (compra entregada) sea verificable.
- **Bloquea a**: ninguna conocida.

## 7. Tasks asociadas (gruesas, una por disciplina afectada)

| Disciplina | Task id | Estimado (h) | Owner | Estado |
|---|---|---|---|---|
| BE | BE-US-025 | 10h | claude-code | Todo |
| FE | FE-US-025 | 6h | claude-code | Todo |
| QA | QA-US-025 | 4h | claude-code | Todo |

> BE: migración `Review` (`id`, `customer_id`, `product_id`, `rating` 1-5, `comment` nullable, `hidden_at` nullable — moderación por soft-flag, no borrado — `created_at`/`updated_at`, `@@unique([customer_id, product_id])` per AC-5); endpoint elegibilidad (join `Order.customer_id` + `OrderItem.product_id` + `Order.status = 'delivered'`); `POST/PATCH /v1/me/reviews/:productId` (upsert, AC-5); `GET /v1/products/:slug/reviews` (público, excluye `hidden_at` no-null); agregado de promedio (recalculado on-read con `AVG`/`COUNT` filtrado por `hidden_at IS NULL` — sin caché en v1, volumetría chica); `PATCH /v1/admin/reviews/:id` (ocultar/mostrar). FE: control de estrellas + textarea en la ficha (sólo si elegible, AC-6/7); sección de reseñas con promedio + lista paginada; vista admin de moderación (reusa patrones de tabla del panel de órdenes, US-012). QA vive dentro de FE/BE (mismo criterio que US-014/US-017/US-024).

## 8. Diseño

- **Tiene Figma**: no.
- Hereda de `docs/product/design-system.md`. El componente de estrellas es nuevo (no existe ninguno reusable hoy) — 5 iconos clickeables/hover, accesible por teclado (AC de accesibilidad: rol `radiogroup`, cada estrella `radio`, anunciado como "N de 5 estrellas").

## 9. NFRs específicos de esta US

- El cálculo de promedio se hace **on-read**, no incremental/cacheado — a la volumetría esperada (catálogo de ~100-1000 productos, reseñas en las decenas por producto en el horizonte de este proyecto) un `AVG` con índice en `product_id` no es un problema de latencia. Si el catálogo creciera órdenes de magnitud, se revisita (no es un NFR de esta US, es una nota de escala futura).
- La regla de elegibilidad (AC-6) se aplica **siempre server-side**, nunca confiando en lo que el FE oculta — el FE ocultar el control es UX, el 403 del backend es la garantía real (mismo criterio que el resto del proyecto: el servidor es la autoridad).

## 10. Notas / contexto adicional

- El dueño confirmó explícitamente (2026-09-06) las 3 decisiones clave: (1) sólo quien compró puede reseñar (no cualquier logueado), (2) estrellas 1-5 + comentario opcional (no sólo estrellas), (3) moderación básica del dueño (ocultar, no editar el contenido).
- "Comprado" se interpreta como **orden en estado `delivered`** (no sólo `pending_payment` o `confirmed`) — la reseña llega después de recibir el producto, igual que en Mercado Libre. Si el dueño quisiera permitir reseñar antes de la entrega, es una reconsideración de este AC, no un bug.
- El campo `buyer_name`/`name` del cliente (US-024, si se aprueba) es lo que se muestra junto a cada reseña — no se duplica ahí, se referencia.

---

## Definition of Ready (gate Triage → Ready)

- [x] §1 Historia escrita en formato Connextra
- [x] §2 Por qué importa explicado
- [x] §3 9 AC en Gherkin (5 happy/alternative + 4 negative-space)
- [x] §5 INVEST con todas las letras OK (S con nota — L es grande, se deja entera per pedido del dueño, división de fases queda para el plan técnico)
- [x] §7 Tasks por disciplina identificadas con estimado en horas
- [x] §8 Diseño resuelto (design-system + componente nuevo declarado)
- [x] Dependencias chequeadas (US-008/US-013/US-014 Done, sin bloqueantes)

## Definition of Done (gate QA → Done)

- [ ] Todas las tasks de la US en estado Done
- [ ] Regression suite del producto verde en staging
- [ ] AC manuales verificados por QA
- [ ] PO firma acceptance
