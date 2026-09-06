# QA Plan — US-024 Edición de perfil del cliente

> **Ticket**: US-024 — Edición de perfil del cliente (nombre + avatar por URL)
> **Author**: qa-engineer (Claude, sesión de cierre de US-022)
> **Date**: 2026-09-06
> **Status**: Proposed — escrito antes de BE/FE (Modo B, standalone, per
> pedido explícito de paralelizar trabajo que no depende del build)
> **Affected platform(s)**: backend + frontend-web
> **Service tier(s)**: 2 (cuenta de cliente, sin dinero involucrado)
> **Companion files**: `proposal.md`, `tasks.md`, `design.md`

---

## 1. Perfil de riesgo

- **`PATCH /v1/me`**: escribe sobre la fila del cliente autenticado — el
  riesgo real es de **autorización** (AC-7: que el endpoint nunca opere
  sobre un `customer_id` distinto al de la sesión), no de negocio/dinero.
- **Avatar por URL**: riesgo de **SSRF** si el backend llegara a hacer un
  fetch server-side de la URL para "validarla" — la US ya lo prohíbe
  explícitamente (§9 NFR de la US: "no se hace un fetch server-side... evita
  SSRF"). Este plan verifica esa ausencia, no la introduce.
- Sin dinero, sin PII sensible nueva (nombre y avatar ya eran visibles desde
  US-014) — tier 2, no crítico.

Journeys críticas identificadas:
1. Cliente edita su nombre → se refleja en "Mi cuenta" y en futuras órdenes.
2. Cliente pega una URL de avatar → reemplaza el placeholder.
3. Cliente intenta (por API directa, no por UI) editar el perfil de otro
   cliente → rechazado siempre, sin importar qué envíe en el body.

---

## 2. Matriz de test (QA-owned)

| Capa | Requerida | Herramienta | Qué cubre |
|---|---|---|---|
| Unit / Integration BE+FE | Dev-owned (TDD) | Jest/Vitest | Validación de DTO, form, repository — **no planificado acá** |
| **Acceptance (BDD)** | ✅ Sí | Cucumber-js + supertest (`qa/acceptance/`) | AC-1..AC-7 a nivel API |
| **E2E cross-stack (Playwright)** | ✅ Sí | Playwright (`qa/e2e/`) | Flujo completo desde "Mi cuenta" en el navegador |
| **Accesibilidad** | ✅ Sí | axe-core (`qa/e2e/*a11y*`) | El form de edición + el placeholder de avatar (iniciales) son navegables por teclado y anunciados |
| **Contract** | ✅ Sí | Spectral + supertest vs OpenAPI | `PATCH /v1/me` matchea el schema publicado |
| **Exploratory** | ✅ Sí | Charters | Confusión con el flujo de cambio de contraseña, avatar con URL que redirige (open redirect del lado del navegador, no del servidor) |

---

## 3. Escenarios BDD (Gherkin)

```gherkin
# language: es
@perfil @us-024
Característica: Edición de perfil del cliente (US-024)
  Como cliente registrado de DSM
  quiero editar mi nombre y mi avatar desde "Mi cuenta"
  para que mi cuenta refleje quién soy

  Antecedentes:
    Dado un cliente autenticado con sesión válida

  # ─── HAPPY PATH ───

  @happy @critical-path
  Escenario: SC-024-H1 — Editar el nombre (AC-1)
    Cuando cambia su nombre a "Ana María Pérez" y guarda
    Entonces el nombre se actualiza de inmediato
    Y una orden creada después usa ese nombre como buyer_name

  @happy
  Escenario: SC-024-H2 — Agregar un avatar por URL (AC-2)
    Dado que no tiene avatar configurado (ve el placeholder)
    Cuando pega "https://ejemplo.com/foto.jpg" y guarda
    Entonces el avatar se actualiza y reemplaza el placeholder

  @happy
  Escenario: SC-024-H3 — Quitar el avatar (AC-3)
    Dado que ya tiene un avatar configurado
    Cuando borra la URL y guarda
    Entonces vuelve a ver el placeholder por defecto

  # ─── NEGATIVE SPACE ───

  @negative
  Escenario: SC-024-N1 — Nombre vacío es rechazado (AC-4)
    Cuando intenta guardar el nombre vacío o sólo espacios
    Entonces recibe un error de validación
    Y su nombre anterior no cambia

  @negative
  Escenario: SC-024-N2 — URL de avatar inválida es rechazada (AC-5)
    Cuando pega "no-es-una-url" como avatar y guarda
    Entonces recibe un error de validación
    Y su avatar anterior (o el placeholder) no cambia

  @negative @critical-path
  Escenario: SC-024-N3 — El email no es editable desde este form (AC-6)
    Cuando abre el formulario de edición de perfil
    Entonces el campo email aparece de sólo lectura
    Y ningún request de este form puede cambiarlo

  @negative @critical-path
  Escenario: SC-024-N4 — No se puede editar el perfil de otro cliente (AC-7)
    Dado el token de sesión del cliente "A"
    Cuando envía un PATCH a /v1/me con datos de "B" en cualquier campo del body
    Entonces el servidor actualiza ÚNICAMENTE al cliente "A" (identificado por el token, nunca por un id del body)
    Y no existe ningún parámetro de la request que permita apuntar a otro customer_id
```

**Tooling**: Cucumber-js con `qa/acceptance/steps/perfil.steps.ts`.
**Location**: `qa/acceptance/features/perfil.feature`.
**Reuses**: `qa/support/customer-auth.ts` (login real de cliente, ya existe
desde US-014/US-020) para obtener la sesión del Antecedentes.

---

## 4. Contract testing

- [ ] **QA-024-CT-1**: Supertest contract test para `PATCH /v1/me`
  - Exit criterion: un spec valida que `PATCH /v1/me` (200, 401, 422) matchee
    el schema declarado en OpenAPI (name string, avatar_url string|null).
  - Verify: `pnpm --filter @dsm/qa test:contract -- --testPathPattern=me` (exit 0, cuando BE-US-024 publique el endpoint en `apps/api/docs/api/openapi.yaml`)
  - **Blocked-by**: BE-US-024 (endpoint no existe todavía).

---

## 5. E2E Playwright (cross-stack)

- [ ] **QA-024-E2E-1**: Spec Playwright — editar nombre y avatar desde "Mi cuenta"
  - Exit criterion: `qa/e2e/perfil.spec.ts` navega a `/mi-cuenta`, edita el
    nombre, pega una URL de avatar válida, guarda, y verifica ambos cambios
    reflejados sin recargar.
  - Verify: `pnpm --filter @dsm/qa exec playwright test perfil.spec.ts --reporter=list` (exit 0, cuando FE-US-024 exista)
  - **Blocked-by**: FE-US-024.

- [ ] **QA-024-A11Y-1**: axe-core sobre el form de edición de perfil
  - Exit criterion: `qa/e2e/perfil-a11y.spec.ts` corre axe (`wcag2a`+`wcag2aa`)
    sobre `/mi-cuenta` en modo edición; 0 violaciones. El placeholder de
    avatar (iniciales) tiene `alt`/`aria-label` describiendo que es un
    avatar por defecto, no una foto real.
  - Verify: `pnpm --filter @dsm/qa test:a11y -- --grep "perfil"` (exit 0, cuando FE-US-024 exista)
  - **Blocked-by**: FE-US-024.

---

## 6. Datos y fixtures

### Seeds requeridos

- Ninguno nuevo — reusa `qa/support/customer-auth.ts` (login real de un
  cliente ya sembrado) para obtener la sesión de cada escenario.

### Builders requeridos

- `buildProfileUpdate(overrides?)`: genera `{ name, avatar_url }` con
  defaults válidos, para no repetir el shape del body en cada step.

---

## 7. Exploratory charters

Agregar a `qa/exploratory/charters.md`:

1. **Charter: Avatar con URL que redirige** — pegar una URL que responde
   `302` hacia otra URL; verificar que el navegador (no el servidor) es
   quien sigue el redirect al renderizar la imagen, y que el servidor nunca
   la siguió (confirma el D-QA/NFR de "sin fetch server-side", US-024 §9).
2. **Charter: Confusión con cambio de contraseña** — verificar que el link
   "Cambiar contraseña" (si existe en la misma pantalla) va al flujo real de
   `recuperar` (US-014), no a un campo de este form (AC-out-of-scope: US-024
   no toca contraseña).
3. **Charter: Nombre con emoji o caracteres RTL** — pegar un nombre con
   emoji/RTL y verificar que se guarda y renderiza sin romper el layout
   (riesgo de UI, no de seguridad).

---

## 8. Quality gates

| Gate | Blocks | Trigger |
|---|---|---|
| Acceptance BDD (API-level) | merge | todo PR de `PATCH /v1/me` |
| Contract (supertest vs OpenAPI) | merge | todo PR que toque el endpoint |
| E2E Playwright | uat promotion | post-deploy staging |
| a11y (axe) | merge | todo PR que toque el form de "Mi cuenta" |

---

## 9. Anti-patterns evitados

- ❌ "Mockear el backend para el E2E" — Playwright corre contra la API real
  levantada (`qa/scripts/api-up.sh`), nunca contra un mock.
- ❌ "Fingir que el contract test pasa" — queda `- [ ]` y `Blocked-by`
  explícito hasta que el endpoint real exista, en vez de un checkbox falso.
- ❌ "QA valida el contenido de la imagen del avatar" — eso sería del lado
  del navegador/CDN externo; QA valida la forma de la URL, no el contenido
  de la imagen que apunta.

---

## 10. Preguntas abiertas

Ninguna — los 7 AC de la US ya resuelven las decisiones de producto
relevantes.

---

## 11. Dependencias declaradas

| Dependencia | Estado | Efecto |
|---|---|---|
| BE-US-024 (`PATCH /v1/me`) | No planificado todavía | **BLOQUEA** acceptance BDD, contract testing |
| FE-US-024 (form en "Mi cuenta") | No planificado todavía | **BLOQUEA** E2E Playwright, a11y |

---

## 12. Standards consultados

- `docs/quality/testing-standards.md` §2, §5, §12
- `docs/quality/qa-backend-standards.md` §2.1, §21
- `docs/quality/qa-frontend-standards.md` §2.1, §19 (a11y), §24 (BDD/E2E)
- `docs/user-stories/US-024-edicion-perfil-cliente.md` (fuente de los 7 AC)
