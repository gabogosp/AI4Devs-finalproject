---
type: user-story
id: US-012
slug: panel-ordenes-dueno
parent-prd: docs/product/prd.md
parent-e2e: docs/product/design-e2e.md
status: In Progress
priority: High
estimate-tshirt: M
story_points_traditional: 8
story_points_ai_assisted: 4
estimation_basis: "FE panel de órdenes con TanStack Table + acciones de estado (Cohn 2005 §9 backoffice, 8) + BE listado/detalle + transiciones FSM validadas (Cohn 2005 §8, 5), agregado × 0.45 (Peng 2023)"
language: es
created: 2026-06-15
updated: 2026-09-05
ready-at: 2026-06-15
in-progress-at: 2026-08-30
authored-by: Gabriel Suarez
disciplines: [BE, FE, QA]
linear-issue-id: null
figma-frames: []
---

# US-012: Panel de órdenes del dueño + gestión de estados

## 1. La historia (formato Connextra)

**Como** dueño,
**quiero** ver las órdenes y avanzar su estado (nueva → preparando → lista para retirar → entregada),
**para** preparar y entregar los pedidos que se retiran en el local.

## 2. Por qué importa (Valuable)

Es la mitad "el dueño prepara y entrega" del loop E2E del PRD. Sin esto la venta queda sin gestión de fulfillment.

## 3. Criterios de aceptación (Gherkin / Given-When-Then)

### AC-1: Ver el listado de órdenes
```gherkin
Given el dueño autenticado en el panel
When abre la lista de órdenes
Then ve cada orden con cliente, total (ARS), estado y fecha
And la lista es paginable, ordenable y filtrable
```

### AC-2: Ver el detalle de una orden
```gherkin
Given una orden en el listado
When el dueño la abre
Then ve sus ítems (con cantidades y precios), los datos de contacto del comprador y el retiro en sucursal
```

### AC-3: Avanzar el estado de una orden
```gherkin
Given una orden en estado "nueva"
When el dueño la avanza
Then puede pasarla a "preparando", luego a "lista para retirar" y luego a "entregada"
And cada transición queda registrada
```

### AC-4: "Lista para retirar" avisa al cliente
```gherkin
Given una orden que el dueño marca como "lista para retirar"
When se aplica la transición
Then se dispara el aviso al cliente de que su pedido está listo (US-011)
```

### AC-5: Filtrar por estado (alternative path)
```gherkin
Given un conjunto de órdenes en distintos estados
When el dueño filtra por "nuevas"
Then la lista muestra solo las órdenes en ese estado
```

### AC-6: Transición inválida bloqueada (negative space)
```gherkin
Given una orden en estado "nueva"
When se intenta una transición inválida (por ejemplo saltar directo a "entregada")
Then el sistema la rechaza
And el estado de la orden no cambia
```

### AC-7: Acceso restringido al panel (negative space)
```gherkin
Given un visitante sin sesión de administrador (cliente o anónimo)
When intenta acceder al panel de órdenes o cambiar un estado
Then el sistema deniega el acceso
```

### AC-8: Solo aparecen órdenes pagadas (negative space)
```gherkin
Given órdenes en estado "pendiente de pago" (sin pago aprobado)
When el dueño abre el panel de fulfillment
Then esas órdenes no se gestionan acá (solo las confirmadas por pago aprobado — US-010)
```

### AC-9: Trazabilidad de los cambios de estado (negative space)
```gherkin
Given que el dueño cambia el estado de una orden
When se aplica la transición
Then queda registrado el cambio (estado anterior, nuevo y marca temporal)
And ese registro queda disponible para consulta
```

## 4. Out of scope explícito

- **Cancelación / reembolso / reintegro de stock** — US-013.
- **El envío del email en sí** — US-011 (acá solo se dispara el aviso al marcar "lista").
- **Panel de métricas / gráficos** — US-016.
- **Creación / confirmación de la orden** — US-010.
- **Envío a domicilio** — roadmap; el MVP es retiro en sucursal.

## 5. INVEST self-check

| Letra | Criterio | Cumple? | Notas |
|---|---|---|---|
| **I** | Independent | ✅ | Depende de US-010 (órdenes confirmadas), que está Ready. |
| **N** | Negotiable | ✅ | AC refinables; el "cómo" lo deciden E2E + dev. |
| **V** | Valuable | ✅ | Cierra la mitad de fulfillment del loop. |
| **E** | Estimable | ✅ | 8 SP tradicional / 4 SP AI-asistido. |
| **S** | Small | ✅ | Acotado al panel + FSM; completable en un cycle. |
| **T** | Testable | ✅ | 9 AC en Gherkin (FSM, authz, trazabilidad verificables). |

## 6. Dependencias

- **Bloqueada por**: US-010 (las órdenes confirmadas son la fuente de datos). `Ready`.
- **Relacionada**: US-011 (la transición a "lista para retirar" dispara el aviso), US-013 (la cancelación se ejerce desde el panel).

## 7. Tasks asociadas (gruesas, una por disciplina afectada)

| Disciplina | Task id | Estimado (h) | Owner | Estado |
|---|---|---|---|---|
| BE | BE-US-012 | 8-12h | TBD | Todo |
| FE | FE-US-012 | 12-16h | TBD | Todo |
| QA | QA-US-012 | 6-8h | TBD | Todo |

- BE: endpoints de listado (paginado/ordenable/filtrable, solo órdenes pagadas) + detalle + transiciones de estado validadas contra la FSM (nueva → preparando → lista → entregada) + trazabilidad de cambios + disparo del aviso al pasar a "lista".
- FE: panel del dueño (TanStack Table con filtros por estado + vista de detalle + acciones de avance de estado) según design-system.
- QA: automatización de AC (listado/detalle, transiciones válidas e inválidas, filtro, autorización admin, solo-pagadas, trazabilidad).

> Las tasks code-generating (BE/FE) abren su openspec change en `openspec/changes/US-012-panel-ordenes-dueno-{discipline}/`. La task QA vive en `tasks/US-012/qa-deliverable.md`.

## 8. Diseño

- **Tiene Figma**: no. Hereda de `docs/product/design-system.md` — TanStack Table (§7.9), OrderStatusBadge (§7.7: Nueva/Preparando/Lista/Entregada), vista de detalle, acciones de estado, filtros.

## 9. NFRs específicos de esta US

- Latencia p95 lectura < 300ms / escritura (transición) < 500ms (hereda PRD §4).
- Listado paginado que soporte el volumen de órdenes (objetivo ~100 órdenes/mes, histórico 12 meses — PRD §6).
- Autorización: el panel y las transiciones son exclusivas del rol admin (E2E §14).
- FSM: solo transiciones válidas; "entregada" y "cancelada" son terminales.
- Observabilidad: registrar cambios de estado (insumo para métricas US-016).
- Accesibilidad WCAG 2.1 AA (tabla navegable por teclado, `aria-sort`).

## 10. Notas / contexto adicional

- Modelo de estados confirmado (4 activos): **nueva → preparando → lista para retirar → entregada**; "cancelada" se gestiona en US-013. Coincide con la FSM del E2E §12.
- El paso a **"lista para retirar"** es el que dispara el aviso al cliente (US-011).
- Solo se gestionan órdenes confirmadas por pago aprobado (US-010); las pendientes de pago no entran a la cola de fulfillment (nueva/preparando/lista/entregada).
- **Actualización 2026-08-30 (US-023)**: cuando se planifique esta US, su AC-1 (listado) debe
  incorporar una vista separada de órdenes `pending_payment` — el dueño necesita verlas para
  poder confirmarles el pago manual/offline que introduce US-023 AC-2. Esa vista es distinta
  de la cola operativa de arriba (no se mezclan). Ver `US-023-pago-manual-offline.md` §6/§10.

---

## Definition of Ready (gate Triage → Ready)

- [x] §1 Historia escrita en formato Connextra
- [x] §2 Por qué importa explicado
- [x] §3 Al menos 1 AC en Gherkin (9 AC: 4 happy + 1 alternative + 4 negative-space)
- [x] §5 INVEST con todas las letras OK
- [x] §7 Tasks por disciplina identificadas con estimado en horas
- [x] §8 Diseño resuelto (design-system referenciado)
- [x] Dependencias chequeadas (US-010 Ready)

## Definition of Done (gate QA → Done)

- [ ] Todas las tasks de la US en estado Done
- [ ] Regression suite del producto verde en staging
- [ ] AC manuales verificados por QA
- [ ] PO firma acceptance
