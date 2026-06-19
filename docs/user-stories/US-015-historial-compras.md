---
type: user-story
id: US-015
slug: historial-compras
parent-prd: docs/product/prd.md
parent-e2e: docs/product/design-e2e.md
status: Ready
priority: Medium
estimate-tshirt: S
story_points_traditional: 5
story_points_ai_assisted: 2
estimation_basis: "BE endpoint listar/detallar órdenes del usuario autenticado (Cohn 2005 §8, 3) + FE página de historial + detalle (Cohn 2005 §8, 5), tomado el dominante × 0.45 (Peng 2023)"
language: es
created: 2026-06-15
updated: 2026-06-15
ready-at: 2026-06-15
authored-by: Gabriel Suarez
disciplines: [BE, FE, QA]
linear-issue-id: null
figma-frames: []
---

# US-015: Historial de compras del cliente registrado

## 1. La historia (formato Connextra)

**Como** cliente registrado,
**quiero** ver el historial de mis compras,
**para** consultar qué compré y el estado de cada pedido.

## 2. Por qué importa (Valuable)

Da continuidad a la relación con el cliente y refuerza el valor de registrarse (PRD §2.1 cap. 8).

## 3. Criterios de aceptación (Gherkin / Given-When-Then)

### AC-1: Ver el listado de mis compras
```gherkin
Given un cliente registrado con sesión activa que realizó compras estando logueado
When abre su historial de compras
Then ve sus órdenes con fecha, estado y total (ARS)
And el listado está ordenado de la más reciente a la más antigua
```

### AC-2: Ver el detalle de una compra
```gherkin
Given una orden en el historial del cliente
When la abre
Then ve sus ítems (con cantidades y precios), el estado actual y el retiro en sucursal
```

### AC-3: Cliente sin compras (alternative path)
```gherkin
Given un cliente registrado que aún no compró estando logueado
When abre su historial
Then ve un estado vacío con una invitación a comprar
```

### AC-4: Solo ve sus propias órdenes (negative space)
```gherkin
Given un cliente registrado con sesión activa
When consulta su historial
Then solo ve las órdenes asociadas a su propia cuenta
And no puede ver órdenes de otros clientes
```

### AC-5: Requiere sesión (negative space)
```gherkin
Given un visitante sin sesión iniciada
When intenta acceder al historial de compras
Then el sistema le pide iniciar sesión
And no expone ninguna orden
```

### AC-6: Las compras guest no se vinculan automáticamente (negative space)
```gherkin
Given compras realizadas como invitado con el mismo email de una cuenta
When el cliente abre su historial
Then esas compras guest NO aparecen automáticamente en el historial de la cuenta
And solo se listan las órdenes hechas estando logueado (decisión de privacidad)
```

### AC-7: Retención del historial (negative space)
```gherkin
Given la política de retención de órdenes (12 meses, PRD §6)
When el cliente abre su historial
Then ve las órdenes dentro del período de retención vigente
```

## 4. Out of scope explícito

- **Re-comprar / reordenar** desde el historial — fuera de v1.
- **Vincular compras guest a la cuenta** — fuera de v1 (decisión de privacidad; requeriría verificación de email).
- **Cancelar / reembolsar desde el historial** — la cancelación es una acción del dueño (US-013).
- **Facturación / comprobantes** — roadmap (AFIP, PRD §2.2).

## 5. INVEST self-check

| Letra | Criterio | Cumple? | Notas |
|---|---|---|---|
| **I** | Independent | ✅ | Depende de US-014 (cuenta/sesión) y US-010 (órdenes), ambas Ready. |
| **N** | Negotiable | ✅ | AC refinables; el "cómo" lo deciden E2E + dev. |
| **V** | Valuable | ✅ | Retención + valor de la cuenta (PRD cap. 8). |
| **E** | Estimable | ✅ | 5 SP tradicional / 2 SP AI-asistido. |
| **S** | Small | ✅ | Lectura acotada; completable en un cycle. |
| **T** | Testable | ✅ | 7 AC en Gherkin (autorización y privacidad verificables). |

## 6. Dependencias

- **Bloqueada por**: US-014 (cuenta/sesión) y US-010 (órdenes confirmadas). Ambas `Ready`.
- **Relacionada**: la asociación de la orden a la cuenta (`customer_id`) ocurre en el checkout/confirmación cuando el cliente está logueado (US-008/US-010); este historial consume esa asociación.

## 7. Tasks asociadas (gruesas, una por disciplina afectada)

| Disciplina | Task id | Estimado (h) | Owner | Estado |
|---|---|---|---|---|
| BE | BE-US-015 | 3-5h | TBD | Todo |
| FE | FE-US-015 | 5-8h | TBD | Todo |
| QA | QA-US-015 | 3-4h | TBD | Todo |

- BE: endpoint para listar y detallar las órdenes del usuario autenticado (autorización: solo las propias) + paginación dentro del período de retención.
- FE: página de historial (listado + detalle) según design-system, con estado vacío.
- QA: automatización de AC (listado/detalle, solo-propias, requiere-sesión, guest-no-vinculado, retención).

> Las tasks code-generating (BE/FE) abren su openspec change en `openspec/changes/US-015-historial-compras-{discipline}/`. La task QA vive en `tasks/US-015/qa-deliverable.md`.

## 8. Diseño

- **Tiene Figma**: no. Hereda de `docs/product/design-system.md` — listado de órdenes (TanStack Table o lista), OrderStatusBadge (§7.7), vista de detalle, estado vacío (§10.1).

## 9. NFRs específicos de esta US

- Autorización: el cliente solo accede a sus propias órdenes (E2E §14).
- Paginación del historial; muestra el período de retención (12 meses, PRD §6).
- Latencia p95 lectura < 300ms (hereda PRD §4).
- Accesibilidad WCAG 2.1 AA.
- Observabilidad: registrar accesos al historial (uso de cuentas).

## 10. Notas / contexto adicional

- Decisión confirmada: el historial muestra **solo órdenes de la cuenta** (realizadas estando logueado); las compras guest no se vinculan automáticamente (privacidad).
- La asociación orden ↔ cuenta se establece al comprar logueado (`customer_id` en la orden, E2E §8); esta US no la crea, la consume.

---

## Definition of Ready (gate Triage → Ready)

- [x] §1 Historia escrita en formato Connextra
- [x] §2 Por qué importa explicado
- [x] §3 Al menos 1 AC en Gherkin (7 AC: 2 happy + 1 alternative + 4 negative-space)
- [x] §5 INVEST con todas las letras OK
- [x] §7 Tasks por disciplina identificadas con estimado en horas
- [x] §8 Diseño resuelto (design-system referenciado)
- [x] Dependencias chequeadas (US-014 y US-010 Ready)

## Definition of Done (gate QA → Done)

- [ ] Todas las tasks de la US en estado Done
- [ ] Regression suite del producto verde en staging
- [ ] AC manuales verificados por QA
- [ ] PO firma acceptance
