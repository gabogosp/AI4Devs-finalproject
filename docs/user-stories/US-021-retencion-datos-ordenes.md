---
type: user-story
id: US-021
slug: retencion-datos-ordenes
parent-prd: docs/product/prd.md
parent-e2e: docs/product/design-e2e.md
prd-capacity: 13   # CAP-13 «Cumplimiento de datos personales», partida de CAP-10 el 2026-08-23
status: Ready
priority: High
estimate-tshirt: S
story_points_traditional: 5
story_points_ai_assisted: 2
estimation_basis: "BE anonimización por lote + acción a pedido + auditoría, sobre un esquema que ya existe (Cohn 2005 §8, 5) + FE acción en el panel de órdenes (Cohn 2005 §8, 2), tomado el dominante × 0.45 (Peng 2023)"
language: es
created: 2026-08-22
updated: 2026-08-22
ready-at: 2026-08-22
authored-by: Gabriel Suarez
disciplines: [BE, FE, QA]
linear-issue-id: null
figma-frames: []
---

# US-021: Retención y anonimización de los datos personales de las órdenes

## 1. La historia (formato Connextra)

**Como** responsable del tratamiento de datos personales de DSM (el dueño),
**quiero** que los datos personales de los compradores se anonimicen cuando se cumple el
plazo de retención, y poder anonimizar una orden puntual si el comprador lo pide,
**para** cumplir con la Ley 25.326 sin perder el historial comercial ni las métricas del
negocio.

## 2. Por qué importa (Valuable)

El PRD §6 fija **retención de órdenes a 12 meses con purga/anonimización**, y **ninguna US
lo implementaba**: US-020 cubre el borrado de *cuentas registradas*, y el comprador
**invitado** —que es el camino principal del PRD §2.1 cap. 4— no tiene cuenta que borrar.

US-008 introduce la primera PII en reposo del proyecto (nombre, email y teléfono de gente
sin cuenta) y su plan de backend dejó el hueco declarado con dueño
(`OQ-BE-5 [Resolved: 2026-08-22 — opción (a)]`). Esta US es ese dueño. **Es exposición
legal, no deuda técnica cosmética**: sin ella, DSM acumula datos personales
indefinidamente y sin vía de supresión a pedido.

La contracara es que el historial comercial **no se puede perder**: el E2E §8 es explícito
en que «las órdenes no se borran (historial 12 meses, métricas)» y US-016 construye los
gráficos del dueño sobre esas filas. De ahí que la respuesta sea **anonimizar, no borrar**.

## 3. Criterios de aceptación (Gherkin / Given-When-Then)

### AC-1: Anonimización automática al cumplirse el plazo
```gherkin
Given una orden cuyos datos personales cumplieron el plazo de retención definido
When corre el proceso de retención
Then los datos personales del comprador de esa orden quedan anonimizados
And la orden sigue existiendo con su historial comercial
```

### AC-2: El valor comercial y las métricas se preservan
```gherkin
Given un conjunto de órdenes anonimizadas
When el dueño consulta las métricas del negocio (US-016)
Then los totales, las cantidades, los productos vendidos y las fechas son los mismos que antes de anonimizar
And ninguna métrica cambia por efecto de la anonimización
```

### AC-3: Anonimización a pedido del comprador (derecho de supresión)
```gherkin
Given un comprador que solicita la supresión de sus datos personales
When el dueño ejecuta la acción de anonimizar esa orden desde el panel
Then los datos personales de esa orden quedan anonimizados de inmediato
And el dueño ve una confirmación de que la acción se aplicó
```

### AC-4: La anonimización queda registrada y es auditable
```gherkin
Given una orden que fue anonimizada
When se consulta esa orden
Then consta que fue anonimizada y en qué momento
And se distingue si fue por plazo cumplido o a pedido del comprador
```

### AC-5: Una orden anonimizada sigue siendo operable para el dueño (alternative path)
```gherkin
Given una orden anonimizada
When el dueño la abre en el panel de órdenes
Then ve sus productos, cantidades, importes, estado y fechas
And en lugar de los datos del comprador ve una indicación de que fueron anonimizados
```

### AC-6: Las órdenes no se borran (negative space)
```gherkin
Given el proceso de retención o la acción a pedido
When se anonimiza una orden
Then no se elimina ninguna orden ni ninguno de sus ítems
And el historial comercial queda íntegro
```

### AC-7: La prueba del consentimiento no se destruye (negative space)
```gherkin
Given una orden anonimizada
When se revisa el registro de consentimiento
Then consta que el consentimiento fue otorgado, cuándo y sobre qué versión de los términos
And ese registro NO se borra al anonimizar los datos personales
```

### AC-8: Anonimizar es idempotente y no reversible (negative space)
```gherkin
Given una orden ya anonimizada
When el proceso de retención o la acción del dueño la alcanzan de nuevo
Then no se produce ningún cambio ni ningún error
And no existe forma de recuperar los datos personales originales desde el sistema
```

### AC-9: Sólo el dueño puede anonimizar a pedido (negative space)
```gherkin
Given la acción de anonimización a pedido
When la intenta alguien que no es el dueño autenticado
Then la operación se rechaza
And no se modifica ninguna orden
```

## 4. Out of scope explícito

- **Borrado de cuentas de clientes registrados** — US-020 (esta US cubre la PII de las
  órdenes, incluidas las de invitados sin cuenta).
- **Retención y purga de otros datos**: logs, eventos de observabilidad, carritos
  vencidos (US-007 ya purga carritos por su propia ventana). Acá sólo órdenes.
- **Exportación de datos personales a pedido** (derecho de acceso/portabilidad): es otro
  derecho de la Ley 25.326 y otra US.
- **Textos legales y aviso de privacidad** — US-017 (esta US ejecuta lo que ese aviso
  promete).
- **Facturación AFIP y sus plazos de conservación fiscal** — roadmap (PRD §2.2). Si en el
  futuro hay comprobantes fiscales, su plazo legal puede ser **más largo** que 12 meses y
  esta política tendrá que convivir con eso.

## 5. INVEST self-check

| Letra | Criterio | Cumple? | Notas |
|---|---|---|---|
| **I** | Independent | ✅ | Depende de US-008 (tiene que existir la orden con PII). No depende de US-020. |
| **N** | Negotiable | ✅ | El plazo, el disparador (job vs acción manual) y qué se escribe en lugar de la PII son negociables; los AC fijan el comportamiento observable. |
| **V** | Valuable | ✅ | Cumplimiento legal (Ley 25.326) + reducción de exposición. Valor para el dueño como responsable del tratamiento, no para el comprador directo. |
| **E** | Estimable | ✅ | 5 SP tradicional / 2 SP AI-asistido: el esquema ya existe, es una transformación acotada. |
| **S** | Small | ✅ | Acotada a órdenes; sin exportación ni otros datasets. |
| **T** | Testable | ✅ | 9 AC en Gherkin, todos observables sobre datos. |

## 6. Dependencias

- **Bloqueada por**: **US-008** (checkout guest — es la US que crea `orders` con los datos
  del comprador). Hoy `In Progress` con su plan de backend escrito.
- **Relacionada**: US-012 (el panel donde vive la acción de AC-3), US-016 (las métricas que
  AC-2 protege), US-017 (el aviso de privacidad que promete esta política), US-020 (el
  equivalente para cuentas registradas).
- **No bloquea a** ninguna US, pero **sí bloquea la salida a producción**: es la condición
  que el PO fijó al resolver OQ-BE-5 de US-008.

## 7. Tasks asociadas (gruesas, una por disciplina afectada)

| Disciplina | Task id | Estimado (h) | Owner | Estado |
|---|---|---|---|---|
| BE | BE-US-021 | 5-8h | TBD | Todo |
| FE | FE-US-021 | 2-3h | TBD | Todo |
| QA | QA-US-021 | 3-4h | TBD | Todo |

- BE: transformación de anonimización sobre `orders` (idempotente, preservando ítems,
  importes, fechas, estado y el registro de consentimiento) + marca de auditoría (cuándo y
  por qué motivo) + proceso por lote que barre las órdenes con plazo cumplido + endpoint
  admin para la acción a pedido.
- FE: acción «anonimizar datos del comprador» en la orden dentro del panel del dueño, con
  confirmación de dos pasos (es irreversible), e indicación visible en las órdenes ya
  anonimizadas.
- QA: automatización de AC (anonimización por plazo y a pedido, idempotencia, métricas
  intactas, consentimiento preservado, órdenes no borradas, autorización).

> Las tasks code-generating (BE/FE) abren su openspec change en
> `openspec/changes/US-021-retencion-datos-ordenes-{discipline}/`. La task QA vive en
> `tasks/US-021/qa-deliverable.md`.

## 8. Diseño

- **Tiene Figma**: no. Hereda de `docs/product/design-system.md` — la acción vive en el
  panel del dueño (§7.9 Table, acciones por fila), la confirmación usa Modal/Dialog
  destructivo de dos pasos (§7.5), la orden anonimizada se marca con Badge (§7.7) y el
  resultado se comunica con Toast (§7.6). Tono §10.2.

## 9. NFRs específicos de esta US

- **Irreversibilidad**: tras anonimizar, el sistema no debe conservar ninguna copia
  recuperable de la PII de esa orden (incluye no haberla dejado en logs — es la regla que
  US-008 ya impuso en su capa de observabilidad).
- **Idempotencia**: el proceso puede correr N veces sobre la misma orden sin efecto ni
  error (AC-8).
- **Preservación del valor comercial**: ninguna métrica de US-016 cambia por anonimizar
  (AC-2). Es el invariante central y hay que probarlo comparando agregados antes y después.
- **Autorización**: la acción a pedido sólo para el dueño autenticado (AC-9).
- **Auditoría**: queda registro del momento y del motivo (plazo vs pedido) — AC-4.
- Observabilidad: registrar cuántas órdenes anonimiza cada corrida y cuántas a pedido, sin
  incluir un solo dato personal en el evento.

## 10. Notas / contexto adicional

- **Anonimizar, no borrar.** El E2E §8 lo fija: «Órdenes no se borran (historial 12 meses,
  métricas)». Borrar la fila rompería US-016 y el historial comercial; borrar sólo la PII
  cumple el objetivo legal y preserva el negocio.
- **El plazo por defecto es 12 meses** (PRD §6). Queda como parámetro: el dueño o su asesor
  legal pueden querer otro, y si más adelante hay comprobantes fiscales el plazo de
  conservación de AFIP puede ser mayor (ver §4).
- **Qué se conserva del consentimiento** (AC-7): que fue otorgado, cuándo y sobre qué
  versión de los términos. Sin eso, DSM pierde la prueba de que la compra fue consentida —
  y el registro sin PII sigue sirviendo como evidencia.
- **El comprador invitado no tiene cuenta**, así que su pedido de supresión llega por
  email o WhatsApp y lo ejecuta el dueño desde el panel (AC-3). No hay autoservicio, y eso
  es una decisión consciente: construir un flujo de autoservicio para alguien sin cuenta
  exigiría un mecanismo de verificación de identidad que el MVP no tiene.
- **Origen de esta US**: el hueco lo detectó el plan de backend de US-008 mientras
  modelaba la PII del checkout (su `OQ-BE-5`), y el PO decidió el 2026-08-22 abrirla como
  condición previa a producción.

---

## Definition of Ready (gate Backlog → Ready)

- [x] §1 Historia escrita en formato Connextra
- [x] §2 Por qué importa explicado
- [x] §3 Al menos 1 AC en Gherkin (9 AC: 3 happy + 1 alternative + 5 negative-space)
- [x] §5 INVEST con todas las letras OK
- [x] §7 Tasks por disciplina identificadas con estimado en horas
- [x] §8 Diseño resuelto (design-system referenciado; sin Figma)
- [x] Dependencias chequeadas (US-008 `In Progress`, con plan de backend escrito)

## Definition of Done (gate QA → Done)

- [ ] Todas las tasks de la US en estado Done
- [ ] Regression suite del producto verde en staging
- [ ] AC manuales verificados por QA
- [ ] PO firma acceptance
