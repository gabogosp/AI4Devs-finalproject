---
type: user-story
id: US-007
slug: carrito-compra
parent-prd: docs/product/prd.md
parent-e2e: docs/product/design-e2e.md
status: In Progress
priority: High
estimate-tshirt: S
story_points_traditional: 5
story_points_ai_assisted: 2
estimation_basis: "BE carrito CRUD con persistencia + chequeo de stock (Cohn 2005 §8, 5) + FE carrito con stepper (Cohn 2005 §8, 5), tomado el dominante × 0.45 (Peng 2023)"
language: es
created: 2026-06-15
updated: 2026-08-20
ready-at: 2026-06-15
in-progress-at: 2026-08-20
authored-by: Gabriel Suarez
disciplines: [BE, FE, QA]
linear-issue-id: null
figma-frames: []
---

# US-007: Carrito de compra (guest)

## 1. La historia (formato Connextra)

**Como** cliente (sin necesidad de cuenta),
**quiero** agregar, editar la cantidad y quitar productos de un carrito que persiste entre visitas,
**para** preparar mi compra antes de pagar.

## 2. Por qué importa (Valuable)

El carrito es el paso intermedio obligatorio del loop de compra del PRD; su persistencia mejora la conversión (el cliente que vuelve retoma donde dejó).

## 3. Criterios de aceptación (Gherkin / Given-When-Then)

### AC-1: Agregar un producto al carrito
```gherkin
Given un producto publicado con stock disponible
When el cliente lo agrega al carrito desde la ficha (US-003) o el listado
Then el carrito muestra el producto con su cantidad, precio unitario y subtotal
And el total del carrito se actualiza
```

### AC-2: Editar la cantidad
```gherkin
Given un producto ya en el carrito
When el cliente cambia su cantidad con el selector
Then el subtotal del ítem y el total del carrito se recalculan
```

### AC-3: Quitar un producto
```gherkin
Given un producto en el carrito
When el cliente lo quita
Then el producto desaparece del carrito
And el total se recalcula
```

### AC-4: Persistencia entre visitas (guest)
```gherkin
Given un cliente invitado que armó un carrito
When cierra el navegador y vuelve dentro del período de persistencia
Then su carrito sigue disponible con los productos que había agregado
And no necesita haber creado una cuenta
```

### AC-5: Cantidad limitada al stock disponible (alternative path)
```gherkin
Given un producto con stock disponible limitado
When el cliente intenta agregar o subir la cantidad por encima del stock actual
Then el sistema no permite superar el stock disponible
And se revalida el stock al confirmar (el stock recién se descuenta al aprobar el pago)
```

### AC-6: Producto del carrito que dejó de estar disponible (alternative path)
```gherkin
Given un producto que estaba en el carrito y luego fue despublicado/archivado o quedó sin stock
When el cliente abre el carrito o va al checkout
Then el sistema señala ese producto como no disponible
And no permite avanzar al pago con ese ítem
```

### AC-7: Carrito vacío (alternative path)
```gherkin
Given un cliente sin productos en el carrito
When abre el carrito
Then ve un estado vacío con una invitación a seguir comprando
```

### AC-8: El carrito no reserva ni descuenta stock (negative space)
```gherkin
Given un producto agregado al carrito por uno o varios clientes
When permanece en el carrito sin pagar
Then el stock del producto NO se reserva ni se descuenta
And el stock recién se descuenta al aprobarse el pago (US-010)
```

### AC-9: Precios vigentes (negative space)
```gherkin
Given que el dueño actualizó el precio de un producto del carrito
When el cliente vuelve a ver el carrito
Then los importes reflejan el precio vigente
And no se mantiene un precio desactualizado por caché
```

### AC-10: No se agregan productos no publicados (negative space)
```gherkin
Given un producto en estado "borrador" o "archivado"
When se intenta agregarlo al carrito (por manipulación directa)
Then el sistema rechaza la operación
And el producto no se incorpora al carrito
```

## 4. Out of scope explícito

- **Checkout, datos del comprador y pago** — US-008 / US-009.
- **Descuentos / cupones** — fuera de v1.
- **Fusión del carrito guest con la cuenta al iniciar sesión** — fuera de v1 (relacionado a US-014; el carrito guest cubre el loop).
- **Reserva de stock con expiración** — no aplica (decisión ADR-0008: descuento al aprobar pago).

## 5. INVEST self-check

| Letra | Criterio | Cumple? | Notas |
|---|---|---|---|
| **I** | Independent | ✅ | Depende de US-003/US-001 (productos), Ready. |
| **N** | Negotiable | ✅ | AC refinables; el "cómo" (cookie/storage) lo deciden E2E + dev. |
| **V** | Valuable | ✅ | Paso obligatorio del loop de compra. |
| **E** | Estimable | ✅ | 5 SP tradicional / 2 SP AI-asistido. |
| **S** | Small | ✅ | Acotado; completable en un cycle. |
| **T** | Testable | ✅ | 10 AC en Gherkin, observables. |

## 6. Dependencias

- **Bloqueada por**: US-003 (agregar desde la ficha) / US-001 (productos). Ambas `Ready`.
- **Bloquea a**: US-008 (checkout parte del carrito).

## 7. Tasks asociadas (gruesas, una por disciplina afectada)

| Disciplina | Task id | Estimado (h) | Owner | Estado |
|---|---|---|---|---|
| BE | BE-US-007 | 6-10h | TBD | Todo |
| FE | FE-US-007 | 8-12h | TBD | Todo |
| QA | QA-US-007 | 4-6h | TBD | Todo |

- BE: endpoints de carrito (agregar/editar/quitar) + persistencia del carrito guest (token/cookie) + chequeo de cantidad contra stock disponible + cálculo de subtotales/total con precios vigentes.
- FE: vista de carrito (CartItem, stepper de cantidad, subtotales/total, estado vacío, avisos de no disponible) según design-system, con persistencia para el invitado.
- QA: automatización de AC (agregar/editar/quitar, persistencia, límite de stock, no-disponible, no descuenta stock).

> Las tasks code-generating (BE/FE) abren su openspec change en `openspec/changes/US-007-carrito-compra-{discipline}/`. La task QA vive en `tasks/US-007/qa-deliverable.md`.

## 8. Diseño

- **Tiene Figma**: no. Hereda de `docs/product/design-system.md` — Cart/CartItem (§7.11), stepper de cantidad, PriceTag ARS (§7.4), CTA "Ir al pago" (botón accent), estado vacío (§10.1), avisos (Toast/Badge).

## 9. NFRs específicos de esta US

- Latencia p95 de escritura (operaciones de carrito) < 500ms (hereda PRD §4).
- Persistencia del carrito guest por un período definido (cookie/token persistente).
- El carrito NO reserva ni descuenta stock (ADR-0008); revalidación de stock al confirmar.
- Precios siempre vigentes (sin caché de larga duración).
- Accesibilidad WCAG 2.1 AA (stepper navegable por teclado, anuncios de cambios de total).
- Observabilidad: registrar eventos de "agregar al carrito" (insumo para conversión / métricas US-016).

## 10. Notas / contexto adicional

- Reglas de negocio confirmadas: (1) el carrito guest **persiste en cookie/token persistente** (sobrevive al cierre del navegador por un período); (2) la cantidad se **limita al stock disponible** al agregar/editar, con **revalidación en el checkout** (el stock recién se descuenta al aprobar el pago, ADR-0008).
- Solo productos publicados pueden estar en el carrito (consistente con US-001/US-002/US-003).
- Precios en ARS con IVA incluido.

---

## Definition of Ready (gate Triage → Ready)

- [x] §1 Historia escrita en formato Connextra
- [x] §2 Por qué importa explicado
- [x] §3 Al menos 1 AC en Gherkin (10 AC: 4 happy + 3 alternative + 3 negative-space)
- [x] §5 INVEST con todas las letras OK
- [x] §7 Tasks por disciplina identificadas con estimado en horas
- [x] §8 Diseño resuelto (design-system referenciado)
- [x] Dependencias chequeadas (US-003 Ready)

## Definition of Done (gate QA → Done)

- [ ] Todas las tasks de la US en estado Done
- [ ] Regression suite del producto verde en staging
- [ ] AC manuales verificados por QA
- [ ] PO firma acceptance
