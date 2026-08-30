---
type: user-story
id: US-023
slug: pago-manual-offline
parent-prd: docs/product/prd.md
parent-e2e: docs/product/design-e2e.md
prd-capacity: 4   # CAP-4 «Checkout y pago» — adaptador de pago que NO depende de MercadoPago
status: In Progress
priority: High
estimate-tshirt: M
story_points_traditional: 8
story_points_ai_assisted: 4
estimation_basis: "BE extracción de PaymentConfirmationPort + adaptador ManualPaymentProvider con idempotencia y auditoría (Cohn 2005 §8, 5 — admin endpoint con RBAC + audit log) + FE acción 'Confirmar pago' con vista de pendientes en el panel (Cohn 2005 §8, 3 — integración con nuevo endpoint REST), agregado × 0.45 (Peng 2023)"
language: es
created: 2026-08-30
updated: 2026-08-30
ready-at: 2026-08-30
in-progress-at: 2026-08-30
authored-by: Gabriel Suarez
disciplines: [BE, FE, QA]
linear-issue-id: null
figma-frames: []
---

# US-023: Pago manual / offline (confirmación del dueño)

## 1. La historia (formato Connextra)

**Como** dueño de DSM,
**quiero** poder marcar una orden como pagada cuando el comprador abona por un medio
offline (transferencia bancaria o efectivo, coordinado por WhatsApp),
**para** completar la venta y disparar el descuento de stock **sin depender de una pasarela
de pago online**.

## 2. Por qué importa (Valuable)

- El modelo de venta principal de DSM ya es **coordinar por WhatsApp** (US-018): el pago
  por transferencia/efectivo es la contracara natural, no un stub descartable — queda como
  **método de pago real en producción**, junto a MercadoPago cuando exista.
- Desbloquea el vertical **checkout → pago → orden** de punta a punta **sin credenciales de
  MercadoPago**, que hoy no tenemos (US-009 queda `Blocked` por dependencia externa).
- Habilita a US-010 (descuento de stock al confirmarse el pago) a construirse contra un
  evento real de pago, sin webhook de MP.

## 3. Criterios de aceptación (Gherkin / Given-When-Then)

### AC-1: El dueño confirma el pago y la orden pasa a "new" (happy path)
```gherkin
Given una orden en estado "pending_payment" cuyo comprador coordinó el pago por
  transferencia o efectivo fuera del sistema (por WhatsApp, US-018)
When el dueño autenticado confirma el pago de esa orden
Then la orden pasa a estado "new" (E2E §12 FSM)
And queda registrado que el pago se confirmó por un medio manual/offline (no MercadoPago)
```

### AC-2: El panel muestra las órdenes pendientes de confirmar pago (happy path, cross-feature con US-012)
```gherkin
Given una o más órdenes en estado "pending_payment"
When el dueño abre el panel de órdenes
Then las ve en una vista separada de "pendientes de confirmar pago", distinta de la cola
  operativa (nueva / preparando / lista para retirar / entregada)
And desde esa vista puede iniciar la confirmación de cada una
```

### AC-3: Solo el dueño autenticado puede confirmar (alternative path)
```gherkin
Given una orden en estado "pending_payment"
When alguien sin sesión de dueño autenticada (role=admin) intenta confirmar su pago
Then el sistema rechaza la acción (401/403)
And la orden permanece en "pending_payment"
```

### AC-4: No se puede confirmar una orden que no está pendiente de pago (alternative path)
```gherkin
Given una orden que ya está en "new", "cancelled" o cualquier estado distinto de "pending_payment"
When el dueño intenta confirmar su pago
Then el sistema rechaza la acción con un mensaje claro sobre el estado actual
And el estado de la orden no cambia
```

### AC-5: No se puede confirmar una orden dos veces (negative space)
```gherkin
Given una orden ya confirmada (estado "new") por pago manual
When el dueño repite la acción de confirmar (doble click, reintento de red)
Then el sistema no vuelve a disparar la confirmación de pago ni a decrementar el stock una
  segunda vez (idempotente — mismo contrato que un pago aprobado real, E2E §9)
And la orden permanece en "new" sin efectos duplicados
```

### AC-6: El registro auditable de quién y cuándo confirmó queda disponible (negative space)
```gherkin
Given una orden confirmada por pago manual
When se consulta su detalle
Then queda registrado qué dueño confirmó el pago y en qué momento (marca temporal)
And ese registro es trazable para auditoría, junto al consentimiento ya registrado en el
  checkout (US-008 AC-8)
```

## 4. Out of scope explícito

- **Integración de pago con MercadoPago u otra pasarela online** — US-009 (queda `Blocked`,
  ver §10).
- **Conciliación de webhooks / reintentos de pasarela** — US-010, parte MP.
- **Conciliación automática de transferencias bancarias** (matching por monto/CBU/comprobante)
  — la confirmación es 100% manual, a criterio del dueño.
- **Recordatorios automáticos al comprador para que pague** — la coordinación es manual por
  WhatsApp (US-018).
- **Facturación fiscal / comprobantes AFIP** — roadmap.
- **Limpieza de órdenes `pending_payment` abandonadas** — ya cubierta de forma genérica por
  US-010 AC-11 (aplica igual a órdenes que iban a pagarse manualmente y nunca se confirmaron).

## 5. INVEST self-check

| Letra | Criterio | Cumple? | Notas |
|---|---|---|---|
| **I** | Independent | ✅ | Depende de US-008 (BE ya hecho, crea la orden `pending_payment`) y de US-012 (el panel donde vive la acción — `Ready`, aún no planificado; ver §6). Ambos bloqueantes están `Ready` o más avanzados, no `Backlog`. |
| **N** | Negotiable | ✅ | AC refinables; el "cómo" (nombre del puerto, adaptador) lo decide backend-developer al planificar. |
| **V** | Valuable | ✅ | Destraba el loop de venta completo sin depender de credenciales externas (MercadoPago). |
| **E** | Estimable | ✅ | 8 SP tradicional / 4 SP AI-asistido (ver `estimation_basis`). |
| **S** | Small | ✅ | Acotado a la confirmación manual + su visibilidad en el panel; t-shirt M. |
| **T** | Testable | ✅ | 6 AC en Gherkin, observables (2 happy + 2 alternative + 2 negative-space). |

## 6. Dependencias

- **Bloqueada por**: **US-008** (checkout guest — crea la orden en `pending_payment`; su BE
  ya está hecho). `In Progress`.
- **Bloqueada por (parcial, FE)**: **US-012** (panel de órdenes del dueño — ahí vive la acción
  "Confirmar pago" y la nueva vista de pendientes de AC-2). `Ready`, aún sin plan de
  implementación. Cuando se planifique `US-012-panel-ordenes-dueno-frontend-web` /
  `-backend`, su AC-1 (listado) debe incorporar la vista separada de `pending_payment` que
  define el AC-2 de esta US — **este US-023 es quien fija ese requisito antes de que US-012
  se construya**.
- **Relacionada**: US-009 (adaptador MercadoPago del mismo puerto de confirmación de pago —
  pasa a **`Blocked`** por esta decisión, ver §10), US-010 (implementa la transición
  `pending_payment → new` + decremento de stock que esta US invoca; en desarrollo), US-018
  (coordinación del pago por WhatsApp — contexto de por qué el pago es offline).

## 7. Tasks asociadas (gruesas, una por disciplina afectada)

| Disciplina | Task id | Estimado (h) | Owner | Estado |
|---|---|---|---|---|
| BE | BE-US-023 | 6-10h | TBD | Todo |
| FE | FE-US-023 | 4-6h | TBD | Todo |
| QA | QA-US-023 | 4-6h | TBD | Todo |

- BE: extraer el puerto de confirmación de pago del diseño de US-009 (si aún no está
  extraído) + adaptador para el medio manual/offline + endpoint de confirmación (RBAC
  `role=admin`, idempotente por orden, rechaza estados distintos de `pending_payment`,
  persiste quién y cuándo confirmó).
- FE: acción "Confirmar pago" en el panel de órdenes (US-012) + vista de órdenes
  `pending_payment` pendientes de confirmar, separada de la cola operativa + estados de
  carga/error y guard contra doble click.
- QA: automatización de AC (confirmación exitosa, permiso denegado, estado inválido,
  idempotencia, registro auditable, visibilidad separada en el panel).

> Las tasks code-generating (BE/FE) abren su openspec change en
> `openspec/changes/US-023-pago-manual-offline-{discipline}/`. La task QA vive en
> `tasks/US-023/qa-deliverable.md`.

> **Para quien planifique `FE-US-023`**: si al momento de planificar todavía no existe
> `US-012-panel-ordenes-dueno-frontend-web`, este change necesita al menos un host mínimo
> (la vista de `pending_payment` de AC-2) o coordinarse con la planificación de US-012 — ver
> §6 Dependencias. No dupliques el listado completo de US-012 (AC-1/AC-2 de esa US); solo la
> sección de pendientes de confirmar pago que introduce este US-023.

## 8. Diseño

- **Tiene Figma**: no. Hereda de `docs/product/design-system.md` y del patrón de tabla +
  acción por fila que usará US-012 (TanStack Table, botón de acción, confirmación con
  estado de carga — §11.bis si el panel se trata como backoffice).

## 9. NFRs específicos de esta US

- Latencia p95 de escritura (confirmar pago) < 500ms (hereda PRD §4).
- **Idempotencia**: confirmar una orden ya confirmada no debe re-disparar el descuento de
  stock ni duplicar efectos (mismo contrato que `PaymentConfirmationPort`, E2E §9).
- **RBAC**: solo `role=admin` (AdminGuard, seam introducido en US-001 y endurecido por
  US-014) puede confirmar.
- **Auditoría**: se persiste quién confirmó (referencia al admin) y cuándo (marca temporal),
  trazable junto al consentimiento ya registrado en la orden (US-008 AC-8).
- Observabilidad: evento de "pago confirmado — medio manual" distinto de "pago aprobado —
  MercadoPago", para poder medir qué proporción de ventas corre por cada canal (insumo de
  US-016).

## 10. Notas / contexto adicional

- **Decisión de arquitectura (ya tomada por el PO, contexto para quien planifique)**:
  US-023 es dueña del puerto de confirmación de pago que hoy vive en el diseño de US-009
  (`PaymentConfirmationPort.confirm()`), el mismo método que iban a invocar el webhook de MP
  y US-010/011/013. Se extrae de US-009 a esta US para que el puerto no dependa de
  MercadoPago. MercadoPago pasa a ser un adaptador más del mismo puerto (US-009),
  enchufable cuando haya credenciales; US-009 pasa a **`Blocked`**. El adaptador de esta US
  transiciona la orden de `pending_payment` → `new` cuando el dueño confirma, invocando el
  mismo contrato que un pago aprobado real. **Esto cambia el supuesto implícito del E2E de
  "un solo proveedor de pago online"** — se recomienda formalizarlo con `/write-adr` cuando
  el arquitecto tenga disponibilidad; no bloquea el DoR de esta US porque la decisión ya está
  tomada y es funcionalmente observable en los AC de arriba.
- **US-009 → `Blocked` (pendiente de confirmar fuera de esta US)**: esta enriquecimiento NO
  actualiza el `status` ni el frontmatter de US-009 ni su entrada en `us-status.yaml` —
  eso es una decisión de scope que excede enriquecer US-023. El PO/dev lead debe confirmar
  el cambio de estado de US-009 explícitamente (su BE tiene 40 tasks pendientes / 1 hecha,
  así que el costo de pausarlo ahora es bajo).
- **Visibilidad en el panel (decisión tomada con el PO, 2026-08-30)**: el E2E (§12, nota bajo
  el FSM) dice que "el panel del dueño no muestra `pending_payment`". Esta US la amplía: el
  panel agrega una vista separada de "pendientes de confirmar pago" (AC-2) — no se mezcla con
  la cola operativa. Cuando se planifique US-012, su AC-1 debe incorporar esto (ver §6).
- La limpieza/expiración de órdenes `pending_payment` abandonadas (con o sin intención de
  pago manual) ya está cubierta por US-010 AC-11 — no se agrega una AC redundante acá.

---

## Definition of Ready (gate Triage → Ready)

- [x] §1 Historia escrita en formato Connextra
- [x] §2 Por qué importa explicado
- [x] §3 Al menos 1 AC en Gherkin (6 AC: 2 happy + 2 alternative + 2 negative-space)
- [x] §5 INVEST con todas las letras OK
- [x] §7 Tasks por disciplina identificadas con estimado en horas
- [x] §8 Diseño resuelto (design-system + patrón de tabla de US-012 referenciados)
- [x] Dependencias chequeadas (US-008 In Progress; US-012 Ready — requisito de AC-2 fijado
  antes de su planificación)

## Definition of Done (gate QA → Done)

- [ ] Todas las tasks de la US en estado Done
- [ ] Regression suite del producto verde en staging
- [ ] AC manuales verificados por QA
- [ ] PO firma acceptance
