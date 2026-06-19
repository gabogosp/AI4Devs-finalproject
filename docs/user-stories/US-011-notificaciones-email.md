---
type: user-story
id: US-011
slug: notificaciones-email
parent-prd: docs/product/prd.md
parent-e2e: docs/product/design-e2e.md
status: Ready
priority: High
estimate-tshirt: S
story_points_traditional: 5
story_points_ai_assisted: 2
estimation_basis: "BE integración de email transaccional (Resend) + 3 plantillas + envío asíncrono con reintentos/idempotencia (Cohn 2005 §8, 5) × 0.45 (Peng 2023)"
language: es
created: 2026-06-15
updated: 2026-06-15
ready-at: 2026-06-15
authored-by: Gabriel Suarez
disciplines: [BE, QA]
linear-issue-id: null
figma-frames: []
---

# US-011: Notificaciones por email (Resend)

## 1. La historia (formato Connextra)

**Como** comprador y como dueño,
**quiero** recibir un email de confirmación de la compra (comprador), un aviso de nueva orden (dueño) y un aviso de "pedido listo para retirar" (comprador),
**para** estar informados en cada paso del pedido.

## 2. Por qué importa (Valuable)

Cierra el círculo de comunicación del loop: el comprador sabe que su compra se confirmó y cuándo retirarla; el dueño se entera de cada venta. Es parte de la capacidad de notificaciones del PRD (cap. 6).

## 3. Criterios de aceptación (Gherkin / Given-When-Then)

### AC-1: Confirmación al comprador
```gherkin
Given una orden confirmada por un pago aprobado (US-010)
When se procesa la confirmación
Then el comprador recibe un email de confirmación con el detalle de su orden (ítems, total, retiro en sucursal)
```

### AC-2: Aviso de nueva orden al dueño
```gherkin
Given una orden confirmada por un pago aprobado (US-010)
When se procesa la confirmación
Then el dueño recibe un email avisando que hay una nueva orden
```

### AC-3: Aviso "listo para retirar" al comprador
```gherkin
Given una orden que el dueño marca como "lista para retirar" (US-012)
When se aplica la transición
Then el comprador recibe un email avisando que su pedido está listo para retirar en el local
```

### AC-4: Reintento ante fallo transitorio del proveedor (alternative path)
```gherkin
Given el proveedor de email responde con un error transitorio
When se intenta enviar una notificación
Then el envío se reintenta de forma asíncrona
And el flujo de la orden no se bloquea por el reintento
```

### AC-5: Fallo persistente no revierte la orden (alternative path)
```gherkin
Given una notificación que falla tras agotar los reintentos
When se abandona el envío
Then la orden y su estado NO se revierten (el email es best-effort)
And el fallo queda registrado para revisión
```

### AC-6: El envío no bloquea la confirmación (negative space)
```gherkin
Given el procesamiento de una orden confirmada (US-010)
When se disparan las notificaciones
Then el envío de emails ocurre de forma asíncrona
And no demora ni bloquea la confirmación de la orden ni el decremento de stock
```

### AC-7: No se envían emails duplicados (negative space)
```gherkin
Given un evento que ya generó su notificación (ej. una orden ya confirmada)
When el evento se reintenta o se reprocesa
Then no se envía un segundo email para el mismo evento (idempotencia de envío)
```

### AC-8: Los emails no exponen datos sensibles (negative space)
```gherkin
Given cualquiera de los emails enviados
When se compone el contenido
Then NO incluye datos de pago/tarjeta ni información sensible innecesaria
And solo incluye lo necesario para informar al destinatario
```

## 4. Out of scope explícito

- **Notificaciones por WhatsApp / SMS** — fuera de v1 (el contacto por WhatsApp es US-018; la notificación transaccional es por email).
- **Email marketing / campañas** — fuera de alcance.
- **Las transiciones de estado y el panel** — US-012 (acá solo se reacciona al evento "lista para retirar").
- **La confirmación de pago y el decremento de stock** — US-010 (acá solo se reacciona a la orden confirmada).

## 5. INVEST self-check

| Letra | Criterio | Cumple? | Notas |
|---|---|---|---|
| **I** | Independent | ✅ | Depende de US-010 y US-012 (eventos disparadores), ambas Ready. |
| **N** | Negotiable | ✅ | AC refinables; plantillas/proveedor lo deciden E2E + dev. |
| **V** | Valuable | ✅ | Comunicación del loop; el comprador sabe cuándo retirar. |
| **E** | Estimable | ✅ | 5 SP tradicional / 2 SP AI-asistido. |
| **S** | Small | ✅ | Acotado a 3 emails + envío async; completable en un cycle. |
| **T** | Testable | ✅ | 8 AC en Gherkin (proveedor de email mockeable). |

## 6. Dependencias

- **Bloqueada por**: US-010 (dispara confirmación al comprador + aviso al dueño) y US-012 (dispara "listo para retirar"). Ambas `Ready`. Requiere cuenta/credenciales de Resend (secrets).
- **Relacionada**: US-008 (el email del comprador usa el contacto capturado en el checkout).

## 7. Tasks asociadas (gruesas, una por disciplina afectada)

| Disciplina | Task id | Estimado (h) | Owner | Estado |
|---|---|---|---|---|
| BE | BE-US-011 | 8-12h | TBD | Todo |
| QA | QA-US-011 | 4-6h | TBD | Todo |

- BE: integración con Resend + tres plantillas (confirmación comprador, aviso dueño, "listo para retirar") + envío asíncrono (cola) con reintentos/backoff + idempotencia de envío + suscripción a los eventos de US-010 y US-012.
- QA: automatización de AC (los tres emails se disparan en su evento, reintentos, idempotencia, envío no bloqueante) con el proveedor de email mockeado.

> Las tasks code-generating (BE) abren su openspec change en `openspec/changes/US-011-notificaciones-email-{discipline}/`. La task QA vive en `tasks/US-011/qa-deliverable.md`.

## 8. Diseño

- **Tiene Figma**: no. Plantillas de email simples; el tono y el copy siguen `docs/product/design-system.md` §10.2 (ej. "¡Listo! Tu compra está confirmada…", "Tu pedido está listo para retirar en el local…").

## 9. NFRs específicos de esta US

- Envío **asíncrono** (Redis + BullMQ): no bloquea la confirmación de la orden (US-010).
- Reintentos con backoff ante fallos transitorios; el email es best-effort (no revierte la orden).
- Idempotencia de envío (un evento → un email).
- Credenciales de Resend solo en secrets; sin datos de pago en el contenido.
- Observabilidad: emails enviados / fallidos por tipo (E2E §18).

## 10. Notas / contexto adicional

- Proveedor de email confirmado: **Resend** (PRD §5).
- Disparadores: confirmación al comprador + aviso al dueño al aprobarse el pago (US-010); "listo para retirar" al pasar la orden a ese estado (US-012, modelo de 4 estados).
- El email es **best-effort**: un fallo de envío no compromete la orden ni el stock.

---

## Definition of Ready (gate Triage → Ready)

- [x] §1 Historia escrita en formato Connextra
- [x] §2 Por qué importa explicado
- [x] §3 Al menos 1 AC en Gherkin (8 AC: 3 happy + 2 alternative + 3 negative-space)
- [x] §5 INVEST con todas las letras OK
- [x] §7 Tasks por disciplina identificadas con estimado en horas
- [x] §8 Diseño resuelto (plantillas + tono design-system)
- [x] Dependencias chequeadas (US-010 y US-012 Ready)

## Definition of Done (gate QA → Done)

- [ ] Todas las tasks de la US en estado Done
- [ ] Regression suite del producto verde en staging
- [ ] AC manuales verificados por QA
- [ ] PO firma acceptance
