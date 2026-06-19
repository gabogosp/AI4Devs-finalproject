---
type: user-story
id: US-010
slug: orden-webhook-stock
parent-prd: docs/product/prd.md
parent-e2e: docs/product/design-e2e.md
status: Ready
priority: High
estimate-tshirt: M
story_points_traditional: 8
story_points_ai_assisted: 4
estimation_basis: "BE webhook idempotente con verificación + reconciliación + decremento atómico de stock transaccional (Cohn 2005 §10 consumer dedup/retry, 8) × 0.45 (Peng 2023)"
language: es
created: 2026-06-15
updated: 2026-06-15
ready-at: 2026-06-15
authored-by: Gabriel Suarez
disciplines: [BE, QA]
linear-issue-id: null
figma-frames: []
---

# US-010: Webhook de pago + registro de orden + decremento de stock

## 1. La historia (formato Connextra)

**Como** sistema,
**quiero** confirmar la orden al recibir un pago aprobado y verificado, y decrementar el stock de forma atómica e idempotente,
**para** registrar la venta correctamente con el stock como única fuente de verdad, sin sobrevender ni doble-procesar.

## 2. Por qué importa (Valuable)

Es el corazón transaccional del loop: sin esto no hay orden registrada ni stock correcto. Maneja los riesgos clave del PRD (webhook duplicado/tardío, oversell) y sostiene "stock = única fuente de verdad".

## 3. Criterios de aceptación (Gherkin / Given-When-Then)

### AC-1: Pago aprobado confirma la orden y decrementa stock
```gherkin
Given una orden "pendiente de pago" con un pago iniciado (US-009)
When llega el webhook de un pago aprobado y verificado
Then la orden se registra como confirmada (estado "nueva")
And el stock de cada ítem se decrementa de forma atómica
```

### AC-2: La confirmación dispara las notificaciones
```gherkin
Given una orden recién confirmada por un pago aprobado
When se completa el procesamiento
Then se disparan las notificaciones de confirmación al comprador y aviso al dueño (US-011)
```

### AC-3: Pago rechazado no confirma ni toca el stock (alternative path)
```gherkin
Given una orden "pendiente de pago"
When llega el webhook de un pago rechazado
Then la orden NO se confirma
And el stock no se ve afectado
```

### AC-4: Pago aprobado pero sin stock → reembolso automático (alternative path)
```gherkin
Given un ítem de la orden que quedó sin stock suficiente entre el carrito y la aprobación del pago
When se procesa la confirmación de un pago ya aprobado
Then el decremento atómico falla (no se decrementa por debajo de cero) y la transacción se revierte
And la orden pasa a "cancelada", se reembolsa el pago aprobado y se avisa al comprador (E2E §9.2, ADR-0008)
```

### AC-5: Webhook duplicado no decrementa dos veces (negative space)
```gherkin
Given un pago ya procesado (mismo identificador de pago)
When llega un webhook duplicado o reenviado para ese pago
Then la orden no se vuelve a confirmar ni el stock se decrementa otra vez (idempotente)
```

### AC-6: Webhook tardío o fuera de orden (negative space)
```gherkin
Given webhooks que llegan tarde o en orden inesperado para un mismo pago
When se procesan
Then el resultado final es consistente (procesamiento idempotente)
And el estado de la orden y el stock reflejan el pago una sola vez
```

### AC-7: Webhook no verificado se rechaza (negative space)
```gherkin
Given un webhook con firma inválida o que no se puede verificar contra MercadoPago
When el sistema lo recibe
Then NO confía en el contenido recibido
And no confirma la orden ni decrementa stock a partir de ese webhook
```

### AC-8: El stock nunca queda negativo (negative space)
```gherkin
Given dos confirmaciones concurrentes que afectan el stock del mismo producto
When se procesan
Then el decremento es atómico y condicionado a stock suficiente
And el stock del producto nunca queda por debajo de cero
```

### AC-9: El medio simulado pasa por el mismo camino (negative space)
```gherkin
Given un pago aprobado mediante el medio simulado "DSM" (US-009)
When se procesa la aprobación
Then sigue el mismo flujo de confirmación, decremento atómico e idempotencia que un pago real
```

### AC-10: Reconciliación de webhook faltante (negative space)
```gherkin
Given un pago aprobado en MercadoPago cuyo webhook nunca llegó
When corre la reconciliación (consulta el estado del pago a MercadoPago)
Then la orden se confirma (o resuelve) sin depender solo de la entrega del webhook (E2E §13/§22)
```

### AC-11: Limpieza de órdenes "pendiente de pago" abandonadas (negative space)
```gherkin
Given una orden "pendiente de pago" cuyo pago nunca se completó tras un período definido
When corre el job de limpieza
Then la orden se cancela y deja de aparecer en la cola del dueño (E2E §12 FSM)
```

## 4. Out of scope explícito

- **Las notificaciones por email en sí** — US-011 (acá solo se disparan).
- **El panel de órdenes del dueño** — US-012.
- **Cancelación / reembolso / reintegro de stock** — US-013.
- **Iniciar el pago / crear la preferencia** — US-009.

## 5. INVEST self-check

| Letra | Criterio | Cumple? | Notas |
|---|---|---|---|
| **I** | Independent | ✅ | Depende de US-009 (pago iniciado), que está Ready. |
| **N** | Negotiable | ✅ | AC refinables; el "cómo" (lock, transacción) lo deciden E2E + dev. |
| **V** | Valuable | ✅ | Núcleo del loop: orden registrada + stock correcto. |
| **E** | Estimable | ✅ | 8 SP tradicional / 4 SP AI-asistido. |
| **S** | Small | ✅ | Acotado al procesamiento de la confirmación; completable en un cycle. |
| **T** | Testable | ✅ | 11 AC en Gherkin (idempotencia, concurrencia, firma, reembolso-sin-stock, reconciliación, limpieza — verificables). |

## 6. Dependencias

- **Bloqueada por**: US-009 (el pago se inicia y se configura el webhook ahí). `Ready`.
- **Bloquea a**: US-011 (notificaciones), US-012 (panel de órdenes), US-013 (cancelación), US-016 (métricas).

## 7. Tasks asociadas (gruesas, una por disciplina afectada)

| Disciplina | Task id | Estimado (h) | Owner | Estado |
|---|---|---|---|---|
| BE | BE-US-010 | 16-24h | TBD | Todo |
| QA | QA-US-010 | 8h | TBD | Todo |

- BE: handler del webhook de MercadoPago (verificación de firma + reconciliación consultando el estado del pago) + procesamiento idempotente (por identificador de pago) + confirmación de la orden + decremento atómico de stock transaccional (`stock >= cantidad`, CHECK ≥ 0) + disparo de notificaciones; mismo camino para el medio simulado.
- QA: automatización de AC (aprobado, rechazado, duplicado, tardío, firma inválida, stock insuficiente, concurrencia, medio simulado).

> Las tasks code-generating (BE) abren su openspec change en `openspec/changes/US-010-orden-webhook-stock-{discipline}/`. La task QA vive en `tasks/US-010/qa-deliverable.md`.

## 8. Diseño

- **Tiene Figma**: no. Backend puro (procesamiento de webhook + transacción). Sin UI propia.

## 9. NFRs específicos de esta US

- **Idempotencia**: un pago se aplica una sola vez (identificador de pago único) — riesgo clave del PRD.
- **Decremento atómico**: UPDATE condicional `stock >= cantidad` + CHECK (stock ≥ 0); nunca stock negativo (ADR-0008).
- **Verificación + reconciliación**: validar la firma del webhook y re-consultar el estado del pago a MercadoPago antes de decrementar (anti-spoofing, E2E §14).
- Procesamiento robusto ante reintentos / reentrega de webhooks (E2E §22).
- Observabilidad: tasa de pagos aprobados/rechazados, intentos de doble-procesamiento evitados, oversell bloqueados por el CHECK (E2E §18).

## 10. Notas / contexto adicional

- Decisión fijada en ADR-0008: decremento de stock **al aprobar el pago**, con UPDATE atómico condicional + idempotencia por identificador de pago. Sin reservas ni jobs de expiración.
- La verdad del pago es el **webhook verificado** (no la URL de retorno de US-009).
- El reintegro de stock ante cancelación/reembolso vive en US-013.

---

## Definition of Ready (gate Triage → Ready)

- [x] §1 Historia escrita en formato Connextra
- [x] §2 Por qué importa explicado
- [x] §3 Al menos 1 AC en Gherkin (11 AC: 2 happy + 2 alternative + 7 negative-space)
- [x] §5 INVEST con todas las letras OK
- [x] §7 Tasks por disciplina identificadas con estimado en horas
- [x] §8 Diseño resuelto (backend puro, sin UI)
- [x] Dependencias chequeadas (US-009 Ready)

## Definition of Done (gate QA → Done)

- [ ] Todas las tasks de la US en estado Done
- [ ] Regression suite del producto verde en staging
- [ ] AC manuales verificados por QA
- [ ] PO firma acceptance
