---
type: user-story
id: US-016
slug: panel-metricas
parent-prd: docs/product/prd.md
parent-e2e: docs/product/design-e2e.md
status: Ready
priority: Medium
estimate-tshirt: M
story_points_traditional: 8
story_points_ai_assisted: 4
estimation_basis: "BE endpoints de agregación sobre órdenes (serie temporal + top productos + resumen) (Cohn 2005 §8, 5) + FE dashboard con Recharts + filtros + export (Cohn 2005 §9 backoffice, 8), tomado el dominante × 0.45 (Peng 2023)"
language: es
created: 2026-06-15
updated: 2026-06-15
ready-at: 2026-06-15
authored-by: Gabriel Suarez
disciplines: [BE, FE, QA]
linear-issue-id: null
figma-frames: []
---

# US-016: Panel de métricas / gráficos del dueño

## 1. La historia (formato Connextra)

**Como** dueño,
**quiero** ver gráficos sobre mis órdenes (ventas, productos más pedidos, evolución) con histórico de 12 meses,
**para** medir cómo va el negocio y tomar decisiones.

## 2. Por qué importa (Valuable)

Le da al dueño visibilidad para decidir; aprovecha el historial de órdenes (retención de 12 meses, PRD §6) y operacionaliza la idea de "medir las cosas" del PRD.

## 3. Criterios de aceptación (Gherkin / Given-When-Then)

### AC-1: Evolución de ventas en el tiempo
```gherkin
Given el dueño autenticado en el panel
When abre las métricas
Then ve un gráfico de la evolución de ventas (monto y/o cantidad de órdenes) en el período seleccionado
```

### AC-2: Productos más pedidos
```gherkin
Given el dueño en el panel de métricas
When consulta el ranking de productos
Then ve los productos más pedidos del período (por cantidad vendida)
```

### AC-3: Resumen del período
```gherkin
Given el dueño en el panel de métricas
When mira el resumen
Then ve totales del período: cantidad de órdenes, monto facturado (ARS) y desglose por estado de orden
```

### AC-4: Elegir el rango temporal
```gherkin
Given el dueño en el panel
When selecciona un rango de fechas dentro de los últimos 12 meses
Then los gráficos y el resumen se recalculan para ese rango
```

### AC-5: Período sin datos (alternative path)
```gherkin
Given un rango temporal sin órdenes
When el dueño lo selecciona
Then el panel muestra un estado vacío con un mensaje claro
And no muestra un error
```

### AC-6: Exportar los datos crudos (alternative path)
```gherkin
Given un gráfico o tabla del panel
When el dueño solicita los datos detrás del gráfico
Then puede descargar los datos crudos (ej. CSV) del período mostrado
```

### AC-7: Acceso restringido (negative space)
```gherkin
Given un visitante sin sesión de administrador
When intenta acceder al panel de métricas
Then el sistema deniega el acceso
```

### AC-8: Solo órdenes pagadas cuentan (negative space)
```gherkin
Given órdenes en estado "pendiente de pago"
When se calculan las métricas
Then esas órdenes no se contabilizan como ventas
And solo se consideran las órdenes confirmadas por pago aprobado (US-010)
```

### AC-9: Histórico limitado a 12 meses (negative space)
```gherkin
Given la política de retención de órdenes (12 meses, PRD §6)
When el dueño consulta períodos anteriores
Then el panel no muestra datos más antiguos que el período de retención vigente
```

## 4. Out of scope explícito

- **Analítica de tráfico / sesiones / conversión web** (Google Analytics o similar) — fuera de v1.
- **Pronósticos / forecasting** — fuera de v1.
- **Exportación contable / AFIP** — roadmap (PRD §2.2).
- **Métricas de calidad de búsqueda IA** (relevancia) — se miden en QA (US-004), no en este panel del dueño en v1.

## 5. INVEST self-check

| Letra | Criterio | Cumple? | Notas |
|---|---|---|---|
| **I** | Independent | ✅ | Depende de US-010 (órdenes como fuente), que está Ready. |
| **N** | Negotiable | ✅ | El set exacto de métricas es refinable (ver §10). |
| **V** | Valuable | ✅ | Visibilidad de negocio para el dueño (PRD cap. 9). |
| **E** | Estimable | ✅ | 8 SP tradicional / 4 SP AI-asistido. |
| **S** | Small | ✅ | Acotado a agregaciones + dashboard; completable en un cycle. |
| **T** | Testable | ✅ | 9 AC en Gherkin (agregaciones y autorización verificables). |

## 6. Dependencias

- **Bloqueada por**: US-010 (órdenes confirmadas son la fuente de datos). `Ready`.
- **Relacionada**: US-012 (estados de orden alimentan el desglose por estado).

## 7. Tasks asociadas (gruesas, una por disciplina afectada)

| Disciplina | Task id | Estimado (h) | Owner | Estado |
|---|---|---|---|---|
| BE | BE-US-016 | 6-10h | TBD | Todo |
| FE | FE-US-016 | 8-12h | TBD | Todo |
| QA | QA-US-016 | 4-6h | TBD | Todo |

- BE: endpoints de agregación sobre órdenes confirmadas (serie temporal de ventas, top productos, resumen por estado) + filtro de rango temporal dentro de la retención.
- FE: dashboard con Recharts (gráficos + resumen + selector de rango + export de datos crudos) según design-system (data-viz palette).
- QA: automatización de AC (agregaciones correctas, solo-pagadas, rango, estado vacío, export, autorización).

> Las tasks code-generating (BE/FE) abren su openspec change en `openspec/changes/US-016-panel-metricas-{discipline}/`. La task QA vive en `tasks/US-016/qa-deliverable.md`.

## 8. Diseño

- **Tiene Figma**: no. Hereda de `docs/product/design-system.md` — Recharts + data-viz palette (§9, accesible/daltonismo), tarjetas de resumen, selector de rango, botón de export, estado vacío (§10.1).

## 9. NFRs específicos de esta US

- Autorización: panel exclusivo del rol admin (E2E §14).
- Agregaciones eficientes (apoyadas en índices sobre órdenes); histórico de 12 meses (PRD §6).
- Solo órdenes confirmadas (pagadas) se contabilizan como ventas.
- Accesibilidad WCAG 2.1 AA en los gráficos (no depender solo del color; etiquetas + export de datos).
- Observabilidad: registrar uso del panel.

## 10. Notas / contexto adicional

- Set de métricas propuesto para v1 (ajustable): (1) evolución de ventas en el tiempo, (2) productos más pedidos, (3) resumen del período (órdenes, facturado, desglose por estado). Basado en el PRD ("ventas, productos más pedidos, evolución temporal").
- Todas las métricas se calculan sobre órdenes confirmadas por pago aprobado (US-010); el histórico respeta la retención de 12 meses.

---

## Definition of Ready (gate Triage → Ready)

- [x] §1 Historia escrita en formato Connextra
- [x] §2 Por qué importa explicado
- [x] §3 Al menos 1 AC en Gherkin (9 AC: 4 happy + 2 alternative + 3 negative-space)
- [x] §5 INVEST con todas las letras OK
- [x] §7 Tasks por disciplina identificadas con estimado en horas
- [x] §8 Diseño resuelto (design-system referenciado)
- [x] Dependencias chequeadas (US-010 Ready)

## Definition of Done (gate QA → Done)

- [ ] Todas las tasks de la US en estado Done
- [ ] Regression suite del producto verde en staging
- [ ] AC manuales verificados por QA
- [ ] PO firma acceptance
