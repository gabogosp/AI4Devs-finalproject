---
type: user-story
id: US-009
slug: pago-mercadopago
parent-prd: docs/product/prd.md
parent-e2e: docs/product/design-e2e.md
status: In Progress
priority: High
estimate-tshirt: M
story_points_traditional: 8
story_points_ai_assisted: 4
estimation_basis: "BE integración MercadoPago Checkout Pro (crear preferencia + manejo de retorno) + medio simulado tras feature flag (Cohn 2005 §8-10, 8) + INFRA secrets/credenciales (Cohn 2005 §11, 3), agregado × 0.45 (Peng 2023)"
language: es
created: 2026-06-15
updated: 2026-08-22
ready-at: 2026-06-15
in-progress-at: 2026-08-22
authored-by: Gabriel Suarez
disciplines: [BE, QA, INFRA]
linear-issue-id: null
figma-frames: []
---

# US-009: Pago con MercadoPago (hosted) + medio simulado "DSM"

## 1. La historia (formato Connextra)

**Como** cliente,
**quiero** pagar mi pedido con MercadoPago (checkout hosted) o, en modo demo, con un medio simulado "DSM",
**para** completar la compra de forma segura (sin exponer datos de tarjeta) o probar el flujo de punta a punta.

## 2. Por qué importa (Valuable)

Habilita el **cobro real** del loop (PRD §2.1 cap. 4) manteniendo a DSM **fuera de alcance PCI** (ADR-0006); el medio simulado habilita demos al cliente y el test E2E sin transacción real.

## 3. Criterios de aceptación (Gherkin / Given-When-Then)

### AC-1: Iniciar el pago real
```gherkin
Given una orden en estado "pendiente de pago" (US-008)
When el cliente inicia el pago
Then el sistema crea una preferencia de pago en MercadoPago asociada a la orden
And redirige al cliente al checkout hosted de MercadoPago
```

### AC-2: Retorno tras pagar
```gherkin
Given un cliente que completó el pago en el checkout hosted de MercadoPago
When MercadoPago lo devuelve al sitio
Then el cliente ve una página de resultado (éxito o "en proceso")
And la confirmación definitiva de la orden ocurre por webhook (US-010)
```

### AC-3: Medio de pago simulado "DSM" (modo test/demo)
```gherkin
Given el sistema en un entorno de test/demo con el medio simulado habilitado
When el cliente paga con el medio "DSM"
Then la compra se aprueba sin una transacción real
And se dispara el mismo flujo de confirmación que un pago real (US-010)
```

### AC-4: Pago rechazado o cancelado (alternative path)
```gherkin
Given un cliente en el checkout hosted de MercadoPago
When el pago es rechazado o el cliente cancela
Then vuelve al sitio a una página de pago no completado
And la orden permanece "pendiente / no confirmada"
And el stock no se ve afectado
```

### AC-5: Pago pendiente de aprobación (alternative path)
```gherkin
Given un pago que MercadoPago deja en estado "pendiente"
When el cliente vuelve al sitio
Then ve un estado "pago en proceso"
And la orden se confirmará (o no) cuando llegue la resolución por webhook (US-010)
```

### AC-6: No se almacenan datos de tarjeta (negative space)
```gherkin
Given el pago real
When el cliente paga
Then los datos de tarjeta se ingresan únicamente en el checkout hosted de MercadoPago
And DSM no recibe ni almacena datos de tarjeta (fuera de alcance PCI)
```

### AC-7: El medio simulado está deshabilitado en producción (negative space)
```gherkin
Given el entorno de producción
When un cliente intenta usar el medio simulado "DSM"
Then no está disponible (feature flag deshabilitado)
And solo el pago real con MercadoPago está habilitado
```

### AC-8: La verdad del pago no se confía a la URL de retorno (negative space)
```gherkin
Given un cliente que regresa a la URL de éxito del sitio
When llega a la página de retorno
Then la orden NO se da por confirmada solo por esa URL
And la confirmación se basa en el webhook verificado de MercadoPago (US-010)
```

### AC-9: La intención de pago es trazable a su orden (negative space)
```gherkin
Given un intento de pago
When se crea la preferencia o se simula el pago
Then queda asociado a una orden existente del propio flujo
And no es posible pagar una orden inexistente o de otro cliente
```

## 4. Out of scope explícito

- **Webhook de pago + confirmación de orden + decremento de stock** — US-010 (acá solo se inicia el pago y se maneja el retorno).
- **Reembolsos** — US-013.
- **Formulario y datos del comprador** — US-008.
- **Notificaciones por email** — US-011.

## 5. INVEST self-check

| Letra | Criterio | Cumple? | Notas |
|---|---|---|---|
| **I** | Independent | ✅ | Depende de US-008 (orden pendiente), que está Ready. La confirmación se aísla en US-010. |
| **N** | Negotiable | ✅ | AC refinables; el "cómo" (SDK, back_urls) lo deciden E2E + dev. |
| **V** | Valuable | ✅ | Habilita el cobro y las demos/test (medio simulado). |
| **E** | Estimable | ✅ | 8 SP tradicional / 4 SP AI-asistido. |
| **S** | Small | ✅ | Acotado a iniciar pago + retorno + medio simulado. |
| **T** | Testable | ✅ | 9 AC en Gherkin; sandbox de MercadoPago + medio simulado para test. |

## 6. Dependencias

- **Bloqueada por**: US-008 (orden en "pendiente de pago"). `Ready`. Requiere credenciales de MercadoPago (INFRA/secrets).
- **Bloquea a**: US-010 (el webhook confirma el pago iniciado acá).

## 7. Tasks asociadas (gruesas, una por disciplina afectada)

| Disciplina | Task id | Estimado (h) | Owner | Estado |
|---|---|---|---|---|
| BE | BE-US-009 | 10-16h | TBD | Todo |
| INFRA | INFRA-US-009 | 3-5h | TBD | Todo |
| QA | QA-US-009 | 6-8h | TBD | Todo |

- BE: integración con MercadoPago (crear preferencia asociada a la orden + redirección al checkout hosted + manejo del retorno success/failure/pending) + medio de pago simulado "DSM" detrás de feature flag.
- INFRA: provisión de credenciales/secrets de MercadoPago + configuración de la URL pública del webhook (HTTPS) que consumirá US-010.
- QA: flujos de pago en sandbox de MercadoPago (aprobado/rechazado/pendiente) + flujo del medio simulado + verificación de que el simulado está off en producción.

> Las tasks code-generating (BE/INFRA) abren su openspec change en `openspec/changes/US-009-pago-mercadopago-{discipline}/`. La task QA vive en `tasks/US-009/qa-deliverable.md`.

## 8. Diseño

- **Tiene Figma**: no. El pago real ocurre en el checkout hosted de MercadoPago. Las páginas de retorno (éxito / en proceso / no completado) y el selector de medio (real vs simulado en demo) heredan de `docs/product/design-system.md` (estados, Toast/Alert, tono §10.2).

## 9. NFRs específicos de esta US

- Sin custodia de datos de tarjeta (hosted, fuera de PCI — ADR-0006).
- Credenciales de MercadoPago solo en secrets; nunca en repo ni logs (E2E §14).
- Medio simulado "DSM" controlado por feature flag, deshabilitado en producción.
- La confirmación de pago se basa en el webhook verificado (US-010), no en la URL de retorno.
- Observabilidad: registrar inicio de pago y resultado de retorno; tasa aprobado/rechazado (E2E §18).

## 10. Notas / contexto adicional

- Proveedor y modo fijados en ADR-0006: **MercadoPago Checkout Pro (hosted)** + medio simulado "DSM" para test/demo y el test E2E.
- La idempotencia del procesamiento del pago y el decremento de stock se resuelven en US-010 (al consumir el webhook), no acá.
- El medio simulado es **load-bearing** para el test E2E automatizado (permite ejercer pago→confirmación sin transacción real).

---

## Definition of Ready (gate Triage → Ready)

- [x] §1 Historia escrita en formato Connextra
- [x] §2 Por qué importa explicado
- [x] §3 Al menos 1 AC en Gherkin (9 AC: 3 happy + 2 alternative + 4 negative-space)
- [x] §5 INVEST con todas las letras OK
- [x] §7 Tasks por disciplina identificadas con estimado en horas
- [x] §8 Diseño resuelto (hosted + design-system para retornos)
- [x] Dependencias chequeadas (US-008 Ready)

## Definition of Done (gate QA → Done)

- [ ] Todas las tasks de la US en estado Done
- [ ] Regression suite del producto verde en staging
- [ ] AC manuales verificados por QA
- [ ] PO firma acceptance
