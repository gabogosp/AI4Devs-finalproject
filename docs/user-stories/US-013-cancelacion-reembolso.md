---
type: user-story
id: US-013
slug: cancelacion-reembolso
parent-prd: docs/product/prd.md
parent-e2e: docs/product/design-e2e.md
status: Ready
priority: Medium
estimate-tshirt: S
story_points_traditional: 5
story_points_ai_assisted: 2
estimation_basis: "BE cancelación + reintegro de stock + reembolso MercadoPago + notificación (Cohn 2005 §8, 5) + FE acción de cancelación con confirmación de dos pasos (Cohn 2005 §8, 3), tomado el dominante × 0.45 (Peng 2023)"
language: es
created: 2026-06-15
updated: 2026-06-15
ready-at: 2026-06-15
authored-by: Gabriel Suarez
disciplines: [BE, FE, QA]
linear-issue-id: null
figma-frames: []
---

# US-013: Cancelación de orden + reembolso + reintegro de stock

## 1. La historia (formato Connextra)

**Como** dueño,
**quiero** cancelar una orden pagada (antes de entregarla) y gestionar su reembolso por MercadoPago, reintegrando el stock,
**para** resolver el camino post-venta cuando una compra no se concreta.

## 2. Por qué importa (Valuable)

Cierra el ciclo post-venta (PRD §2.1 cap. 11) y evita stock "perdido" en órdenes que no se entregan.

## 3. Criterios de aceptación (Gherkin / Given-When-Then)

### AC-1: Cancelar una orden no entregada
```gherkin
Given una orden confirmada que aún no fue entregada (nueva, preparando o lista para retirar)
When el dueño la cancela
Then la orden pasa al estado "cancelada"
```

### AC-2: El stock se reintegra
```gherkin
Given una orden que se cancela
When se aplica la cancelación
Then el stock de cada ítem de la orden se reintegra al catálogo
```

### AC-3: Reembolso del pago real
```gherkin
Given una orden cancelada cuyo pago fue real y aprobado (MercadoPago)
When se procesa la cancelación
Then se gestiona el reembolso del pago por MercadoPago
And el pago queda marcado como "reembolsado"
```

### AC-4: Aviso al comprador
```gherkin
Given una orden que el dueño cancela
When se completa la cancelación
Then el comprador recibe un aviso por email de la cancelación (reutiliza la integración de email)
```

### AC-5: Cancelación de una orden con pago simulado (alternative path)
```gherkin
Given una orden pagada con el medio simulado "DSM"
When el dueño la cancela
Then la orden se marca "cancelada" y el stock se reintegra
And el reembolso es un no-op externo (no hay transacción real que revertir)
```

### AC-6: Confirmación de dos pasos (alternative path)
```gherkin
Given el dueño en el panel de órdenes
When elige cancelar una orden
Then el sistema pide una confirmación explícita (dos pasos) antes de ejecutar
And solo cancela si el dueño confirma
```

### AC-7: No se cancela una orden entregada (negative space)
```gherkin
Given una orden en estado "entregada"
When se intenta cancelarla
Then el sistema lo rechaza (estado terminal)
And la orden permanece "entregada"
```

### AC-8: Reintegro de stock idempotente (negative space)
```gherkin
Given una orden ya cancelada con su stock reintegrado
When la operación de cancelación se reintenta o reprocesa
Then el stock no se reintegra dos veces (idempotente)
```

### AC-9: Solo el dueño puede cancelar (negative space)
```gherkin
Given un visitante sin sesión de administrador (incluido el cliente)
When intenta cancelar o reembolsar una orden
Then el sistema deniega la acción
```

### AC-10: Trazabilidad de la cancelación/reembolso (negative space)
```gherkin
Given una orden que se cancela y reembolsa
When se ejecuta la operación
Then queda registrado quién canceló, cuándo, y el resultado del reembolso
```

## 4. Out of scope explícito

- **Cancelación iniciada por el cliente** — fuera de v1 (la cancelación es una acción del dueño).
- **Reembolso parcial / por ítem** — fuera de v1 (se cancela la orden completa con reembolso total).
- **Devoluciones físicas / RMA** — roadmap.
- **El panel de órdenes en sí** — US-012 (acá se agrega la acción de cancelar).

## 5. INVEST self-check

| Letra | Criterio | Cumple? | Notas |
|---|---|---|---|
| **I** | Independent | ✅ | Depende de US-010 (orden/pago) y US-012 (panel), ambas Ready. |
| **N** | Negotiable | ✅ | AC refinables; el "cómo" (refund API) lo deciden E2E + dev. |
| **V** | Valuable | ✅ | Cierra el post-venta y evita stock perdido. |
| **E** | Estimable | ✅ | 5 SP tradicional / 2 SP AI-asistido. |
| **S** | Small | ✅ | Acotado a la cancelación + reembolso + reintegro; completable en un cycle. |
| **T** | Testable | ✅ | 10 AC en Gherkin (FSM, idempotencia, autorización verificables). |

## 6. Dependencias

- **Bloqueada por**: US-010 (orden confirmada + pago) y US-012 (panel del dueño). Ambas `Ready`.
- **Relacionada**: US-009 (el reembolso usa MercadoPago), US-011 (el aviso reutiliza la integración de email).

## 7. Tasks asociadas (gruesas, una por disciplina afectada)

| Disciplina | Task id | Estimado (h) | Owner | Estado |
|---|---|---|---|---|
| BE | BE-US-013 | 8-12h | TBD | Todo |
| FE | FE-US-013 | 4-6h | TBD | Todo |
| QA | QA-US-013 | 4-6h | TBD | Todo |

- BE: endpoint de cancelación (guard de FSM: solo si no entregada) + reintegro atómico de stock (idempotente) + reembolso por MercadoPago (no-op para el medio simulado) + disparo del aviso al comprador + trazabilidad.
- FE: acción de cancelar en el panel de órdenes (US-012) con confirmación destructiva de dos pasos.
- QA: automatización de AC (cancelar por estado válido/inválido, reintegro idempotente, reembolso real vs simulado, autorización, confirmación).

> Las tasks code-generating (BE/FE) abren su openspec change en `openspec/changes/US-013-cancelacion-reembolso-{discipline}/`. La task QA vive en `tasks/US-013/qa-deliverable.md`.

## 8. Diseño

- **Tiene Figma**: no. Hereda de `docs/product/design-system.md` — acción destructiva con confirmación de dos pasos (Modal §7.5), OrderStatusBadge "Cancelada" (§7.7), Toast de resultado.

## 9. NFRs específicos de esta US

- Guard de FSM: cancelar solo desde estados no terminales (nueva / preparando / lista); "entregada" y "cancelada" son terminales (E2E §12).
- Reintegro de stock **idempotente** (no inflar stock por reintentos).
- Reembolso por MercadoPago para pagos reales; no-op para el medio simulado.
- Autorización: cancelar/reembolsar es exclusivo del rol admin (E2E §14).
- El aviso al comprador es best-effort (reutiliza la integración de email, US-011).
- Observabilidad: registrar cancelaciones y resultado de reembolsos.

## 10. Notas / contexto adicional

- Default MVP confirmado: se cancela la **orden completa** con **reembolso total** (sin reembolsos parciales ni por ítem).
- La cancelación se ejerce desde el panel del dueño (US-012); el reembolso real usa MercadoPago (US-009) y es no-op para el medio simulado.
- El reintegro de stock complementa el decremento de US-010 (ADR-0008): stock sigue siendo la única fuente de verdad.

---

## Definition of Ready (gate Triage → Ready)

- [x] §1 Historia escrita en formato Connextra
- [x] §2 Por qué importa explicado
- [x] §3 Al menos 1 AC en Gherkin (10 AC: 4 happy + 2 alternative + 4 negative-space)
- [x] §5 INVEST con todas las letras OK
- [x] §7 Tasks por disciplina identificadas con estimado en horas
- [x] §8 Diseño resuelto (design-system referenciado)
- [x] Dependencias chequeadas (US-010 y US-012 Ready)

## Definition of Done (gate QA → Done)

- [ ] Todas las tasks de la US en estado Done
- [ ] Regression suite del producto verde en staging
- [ ] AC manuales verificados por QA
- [ ] PO firma acceptance
