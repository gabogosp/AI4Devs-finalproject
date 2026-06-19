---
type: user-story
id: US-008
slug: checkout-guest
parent-prd: docs/product/prd.md
parent-e2e: docs/product/design-e2e.md
status: Ready
priority: High
estimate-tshirt: M
story_points_traditional: 8
story_points_ai_assisted: 4
estimation_basis: "BE crear orden pendiente con snapshot de precios + validación + consentimiento (Cohn 2005 §8, 5) + FE formulario de checkout multi-campo + consent + retiro (Cohn 2005 §8, 5), agregado × 0.45 (Peng 2023)"
language: es
created: 2026-06-15
updated: 2026-06-15
ready-at: 2026-06-15
authored-by: Gabriel Suarez
disciplines: [BE, FE, QA]
linear-issue-id: null
figma-frames: []
---

# US-008: Checkout guest — datos, consentimiento y retiro

## 1. La historia (formato Connextra)

**Como** cliente sin cuenta,
**quiero** confirmar mi compra dejando mis datos de contacto, aceptando los términos y confirmando el retiro en la sucursal,
**para** completar el pedido sin tener que registrarme.

## 2. Por qué importa (Valuable)

El guest checkout cierra el loop de compra del MVP sin fricción de cuenta (PRD §2.1 cap. 4) y captura el consentimiento legal necesario para operar en Argentina (PRD §2.1 cap. 10).

## 3. Criterios de aceptación (Gherkin / Given-When-Then)

### AC-1: Checkout válido crea la orden y avanza al pago
```gherkin
Given un carrito con productos disponibles
When el cliente completa nombre, email y teléfono, acepta los términos y confirma el retiro en sucursal
Then se crea una orden en estado "pendiente de pago"
And el cliente avanza al pago (US-009)
```

### AC-2: La orden registra los ítems con precio al momento
```gherkin
Given un checkout que se confirma
When se crea la orden
Then la orden guarda cada ítem con su cantidad y su precio unitario al momento de la compra (snapshot)
And el total queda registrado en ARS (IVA incluido)
```

### AC-3: Validación de los datos del comprador (alternative path)
```gherkin
Given el cliente en el formulario de checkout
When deja un campo requerido vacío o con formato inválido (ej. email mal formado)
Then el sistema bloquea el avance con un mensaje claro por campo
And no crea la orden
```

### AC-4: Consentimiento obligatorio (alternative path)
```gherkin
Given el cliente que no marcó la aceptación de la política de privacidad y los términos
When intenta confirmar el checkout
Then el sistema no permite avanzar al pago
And indica que debe aceptar los términos
```

### AC-5: Carrito inválido bloquea el checkout (alternative path)
```gherkin
Given un carrito vacío o con ítems no disponibles (despublicados o sin stock)
When el cliente intenta iniciar el checkout
Then el sistema no permite continuar
And señala el motivo (carrito vacío o ítem no disponible)
```

### AC-6: No se descuenta stock antes del pago (negative space)
```gherkin
Given una orden creada en el checkout en estado "pendiente de pago"
When el pago aún no se aprobó
Then el stock de los productos NO se descuenta
And el descuento ocurre recién al aprobarse el pago (US-010)
```

### AC-7: No se almacenan datos de tarjeta (negative space)
```gherkin
Given el cliente que va a pagar
When completa el checkout
Then el sistema NO solicita ni almacena datos de tarjeta
And el pago se realiza en el checkout hosted de MercadoPago (US-009)
```

### AC-8: El consentimiento queda registrado en la orden (negative space)
```gherkin
Given un cliente que aceptó los términos al confirmar
When se crea la orden
Then la orden registra que el consentimiento fue otorgado (con su marca temporal)
And ese registro queda disponible para trazabilidad legal
```

## 4. Out of scope explícito

- **Integración de pago con MercadoPago + medio simulado DSM** — US-009.
- **Páginas legales (privacidad / términos)** — US-017 (acá se enlazan y se registra el consentimiento).
- **Confirmación por email** — US-011.
- **Checkout con cuenta registrada / direcciones guardadas** — fuera de v1 (guest cubre el loop; cuentas en US-014).
- **Envío a domicilio** — roadmap (PRD §2.2); el MVP es retiro en sucursal.

## 5. INVEST self-check

| Letra | Criterio | Cumple? | Notas |
|---|---|---|---|
| **I** | Independent | ✅ | Depende de US-007 (carrito), que está Ready. La integración de pago se aísla en US-009. |
| **N** | Negotiable | ✅ | AC refinables; el "cómo" lo deciden E2E + dev. |
| **V** | Valuable | ✅ | Cierra el ingreso de datos del loop de compra + consentimiento legal. |
| **E** | Estimable | ✅ | 8 SP tradicional / 4 SP AI-asistido. |
| **S** | Small | ✅ | Acotado al ingreso de datos + creación de orden pendiente. |
| **T** | Testable | ✅ | 8 AC en Gherkin, observables. |

## 6. Dependencias

- **Bloqueada por**: US-007 (el checkout parte del carrito). `Ready`.
- **Bloquea a**: US-009 (pago) y US-010 (la orden se confirma con el pago).
- **Relacionada**: US-017 (páginas legales que enlaza el consentimiento — puede construirse en paralelo; no bloquea esta US).

## 7. Tasks asociadas (gruesas, una por disciplina afectada)

| Disciplina | Task id | Estimado (h) | Owner | Estado |
|---|---|---|---|---|
| BE | BE-US-008 | 6-10h | TBD | Todo |
| FE | FE-US-008 | 8-12h | TBD | Todo |
| QA | QA-US-008 | 4-6h | TBD | Todo |

- BE: endpoint de checkout (validar carrito disponible + crear orden "pendiente de pago" con ítems y snapshot de precios + datos del comprador + registro de consentimiento) y handoff al inicio de pago.
- FE: formulario de checkout (datos del comprador, confirmación de retiro en sucursal, checkbox de consentimiento con enlace a páginas legales, validación inline) según design-system.
- QA: automatización de AC (datos válidos/inválidos, consentimiento obligatorio, carrito inválido, no-descuento de stock, registro de consentimiento).

> Las tasks code-generating (BE/FE) abren su openspec change en `openspec/changes/US-008-checkout-guest-{discipline}/`. La task QA vive en `tasks/US-008/qa-deliverable.md`.

## 8. Diseño

- **Tiene Figma**: no. Hereda de `docs/product/design-system.md` — formulario de checkout (Input/Select §7.2), selección/confirmación de retiro, checkbox de consentimiento, resumen de orden con PriceTag, CTA "Ir al pago" (botón accent), tono de copy §10.2.

## 9. NFRs específicos de esta US

- Latencia p95 de escritura (crear orden) < 500ms (hereda PRD §4).
- PII mínima (nombre, email, teléfono); sin datos de tarjeta (E2E §14); transmisión sobre TLS.
- Consentimiento registrado con marca temporal en la orden.
- Snapshot de precios al crear la orden (el precio de la orden no cambia si luego cambia el catálogo — consistente con US-001 AC-10).
- Accesibilidad WCAG 2.1 AA (formulario con labels, errores con `aria-describedby`).
- Observabilidad: registrar "checkout iniciado" (insumo de conversión / métricas US-016).

## 10. Notas / contexto adicional

- Campos del comprador requeridos: **nombre, email, teléfono** (email para la confirmación de US-011; teléfono para coordinar el retiro y el contacto por WhatsApp US-018). Decisión por defecto; ajustable si el dueño prefiere teléfono opcional.
- Retiro en **sucursal única** (esquina Córdoba y Pueyrredón): el checkout confirma el retiro, no ofrece elección de sucursal (E2E / PRD).
- La integración de pago (preferencia MercadoPago, redirect, medio simulado DSM) vive en US-009; esta US deja la orden lista en "pendiente de pago".

---

## Definition of Ready (gate Triage → Ready)

- [x] §1 Historia escrita en formato Connextra
- [x] §2 Por qué importa explicado
- [x] §3 Al menos 1 AC en Gherkin (8 AC: 2 happy + 3 alternative + 3 negative-space)
- [x] §5 INVEST con todas las letras OK
- [x] §7 Tasks por disciplina identificadas con estimado en horas
- [x] §8 Diseño resuelto (design-system referenciado)
- [x] Dependencias chequeadas (US-007 Ready; US-017 relacionada no bloqueante)

## Definition of Done (gate QA → Done)

- [ ] Todas las tasks de la US en estado Done
- [ ] Regression suite del producto verde en staging
- [ ] AC manuales verificados por QA
- [ ] PO firma acceptance
