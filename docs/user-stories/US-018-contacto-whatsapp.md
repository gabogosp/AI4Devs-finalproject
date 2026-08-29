---
type: user-story
id: US-018
slug: contacto-whatsapp
parent-prd: docs/product/prd.md
parent-e2e: docs/product/design-e2e.md
status: Done
priority: Medium
estimate-tshirt: XS
story_points_traditional: 2
story_points_ai_assisted: 1
estimation_basis: "FE integración de enlace simple (wa.me) en header/footer + ficha (Cohn 2005 §8 trivial, 2-3) × 0.45 (Peng 2023)"
language: es
created: 2026-06-15
updated: 2026-08-29
ready-at: 2026-06-15
in-progress-at: 2026-08-19
authored-by: Gabriel Suarez
disciplines: [FE]
linear-issue-id: null
figma-frames: []
---

# US-018: Canal de contacto por WhatsApp

## 1. La historia (formato Connextra)

**Como** cliente,
**quiero** un botón/enlace de WhatsApp para consultas pre y post venta,
**para** preguntar por un producto o por mi pedido por el canal que más uso.

## 2. Por qué importa (Valuable)

WhatsApp es el canal dominante en Argentina; baja la fricción de contacto y soporte sin desarrollar un chat propio (PRD §2.1 cap. 12).

## 3. Criterios de aceptación (Gherkin / Given-When-Then)

### AC-1: Enlace de WhatsApp accesible
```gherkin
Given un cliente navegando el sitio
When mira el header o el footer
Then encuentra un botón/enlace de WhatsApp
And al activarlo se abre una conversación con el número del local
```

### AC-2: Consulta desde un producto sin stock
```gherkin
Given un producto publicado sin stock (ficha, US-003)
When el cliente usa el contacto por WhatsApp desde esa ficha
Then se abre WhatsApp con un mensaje inicial que referencia el producto consultado
```

### AC-3: Apertura en escritorio (alternative path)
```gherkin
Given un cliente en una computadora de escritorio
When activa el enlace de WhatsApp
Then se abre WhatsApp Web (o la app de escritorio) hacia el número del local
```

### AC-4: Sin dependencia de backend (negative space)
```gherkin
Given el enlace de WhatsApp
When el cliente lo usa
Then el contacto se resuelve mediante el enlace estándar (wa.me) sin llamar al backend
And no expone datos sensibles
```

### AC-5: Número configurable (negative space)
```gherkin
Given el número de WhatsApp del local
When se publica en el sitio
Then proviene de una configuración única
And no está duplicado/hardcodeado disperso por el código
```

## 4. Out of scope explícito

- **Chatbot conversacional / atención automatizada** — roadmap (PRD §2.2, evolución del buscador).
- **Notificaciones transaccionales por WhatsApp** — fuera de v1 (las notificaciones son por email, US-011).
- **Integración con la API de WhatsApp Business** — fuera de v1 (se usa el enlace público `wa.me`).

## 5. INVEST self-check

| Letra | Criterio | Cumple? | Notas |
|---|---|---|---|
| **I** | Independent | ✅ | Enlace autónomo; no depende de otras US para entregarse. |
| **N** | Negotiable | ✅ | AC refinables (ubicación, mensaje prellenado). |
| **V** | Valuable | ✅ | Canal de contacto dominante en AR, sin desarrollar chat. |
| **E** | Estimable | ✅ | 2 SP tradicional / 1 SP AI-asistido. |
| **S** | Small | ✅ | Mínima; completable en horas. |
| **T** | Testable | ✅ | 5 AC en Gherkin, observables. |

## 6. Dependencias

- **Bloqueada por**: — (enlace `wa.me`, sin backend).
- **Relacionada**: US-003 (CTA de contacto en la ficha sin stock), US-002 (header/footer del storefront).

## 7. Tasks asociadas (gruesas, una por disciplina afectada)

| Disciplina | Task id | Estimado (h) | Owner | Estado |
|---|---|---|---|---|
| FE | FE-US-018 | 2-4h | TBD | Todo |

- FE: botón/enlace de WhatsApp en header y footer + CTA desde la ficha sin stock (mensaje prellenado con el producto), con el número tomado de una configuración única. Incluye la verificación de los AC (la US es FE-only; el testeo del enlace forma parte de la task).

> La task code-generating (FE) abre su openspec change en `openspec/changes/US-018-contacto-whatsapp-frontend-web/`.

## 8. Diseño

- **Tiene Figma**: no. Hereda de `docs/product/design-system.md` — botón/ícono de WhatsApp (Lucide `message-circle`, §7.10) en header/footer; CTA en la ficha (§7.10/§10.2).

## 9. NFRs específicos de esta US

- Sin backend ni datos sensibles (enlace estándar `wa.me`).
- Número de WhatsApp configurable (fuente única).
- Accesibilidad WCAG 2.1 AA (enlace con etiqueta accesible, foco visible, área táctil ≥ 44×44px).

## 10. Notas / contexto adicional

- Se usa el enlace público `wa.me` (no la API de WhatsApp Business) — alcance v1.
- El mensaje prellenado desde la ficha es un plus de UX (referencia el producto); ajustable.

---

## Definition of Ready (gate Triage → Ready)

- [x] §1 Historia escrita en formato Connextra
- [x] §2 Por qué importa explicado
- [x] §3 Al menos 1 AC en Gherkin (5 AC: 2 happy + 1 alternative + 2 negative-space)
- [x] §5 INVEST con todas las letras OK
- [x] §7 Tasks por disciplina identificadas con estimado en horas
- [x] §8 Diseño resuelto (design-system referenciado)
- [x] Dependencias chequeadas (sin bloqueantes)

## Definition of Done (gate QA → Done)

- [ ] Todas las tasks de la US en estado Done
- [ ] Regression suite del producto verde en staging
- [ ] AC manuales verificados
- [ ] PO firma acceptance
