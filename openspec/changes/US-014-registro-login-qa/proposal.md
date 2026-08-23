---
tracker-id: null
tracker-source: null
parent-us: US-014
discipline: qa
variant: null
language: es
---

# US-014 QA — Cuentas de cliente: lo que sólo se ve cruzando las tres capas

## Why

US-014 tiene la suite dev-owned más densa del repo: el backend cerró con specs de
registro, login, sesión, CSRF, enumeración, rate-limit y recuperación
(`apps/api/src/auth/e2e-auth-*.spec.ts`), y el frontend agregó los suyos —incluido
`e2e/auth-topology.spec.ts`, que probó contra la app construida que la cookie
sobrevive al rewrite de ADR-0013—. **Nada de eso se repite acá.**

Lo que falta es la capa que ninguna de las dos puede cubrir sola: el recorrido
completo **en un navegador real contra la API real**. Los E2E del frontend corren
contra `e2e/support/api-stub.mjs`, que es un doble: su bcrypt es una comparación de
strings, su rate-limit se dispara con un header de fuerza y su rotación de refresh es
un `Map` en memoria. Un contrato que el stub cumple y el backend real no —o al revés—
pasa verde en las dos suites y falla en producción. Esa es la brecha que este plan
cierra, y es exactamente la que ya se cobró un defecto en US-007: el carrito se
escribía y no se podía leer, y sólo lo vio el E2E contra la app construida.

Hay además tres criterios de US-014 que son **propiedades de seguridad**, no features,
y que un test de una sola capa no puede afirmar:

- **Anti-enumeración** (AC-5, AC-6, AC-11): que el mensaje sea genérico en la UI no
  alcanza si el **status**, el **tiempo de respuesta** o un header distinguen los
  casos. Se verifica sobre la respuesta cruzando login, registro y recuperación.
- **Sesión por cookie** (AC-9): `httpOnly` + `secure` + `SameSite` + access corto +
  refresh **rotado**. La rotación sólo se puede afirmar consumiendo un refresh dos
  veces contra el almacén real (ADR-0011: reusar un token rotado revoca la familia).
- **Límite de intentos** (AC-10): con el rate-limit real, no con un header de fuerza.

## What changes

Un change hermano `US-014-registro-login-qa/` con el plan y su ejecución, en el
harness cross-stack que ya existe (`qa/`), **sin tocar código de producción**:

| Capa | Herramienta | Qué cubre |
|---|---|---|
| E2E de navegador | Playwright (`qa/e2e/`) | recorrido de cuenta completo contra la API real: registro con sesión inmediata, login, logout, recuperación de punta a punta |
| Seguridad observable | Playwright (API context) | anti-enumeración comparando **status + cuerpo + latencia** entre caso existente e inexistente; rotación y reuso del refresh; cookies con sus flags |
| Accesibilidad | axe-core + Playwright | los cuatro formularios (registro, login, recuperación, confirmación) en WCAG 2.1 AA + recorrido por teclado |
| Carga | k6 (`qa/performance/`) | login bajo concurrencia contra el presupuesto **p95 < 500 ms** del PRD §4, con el rate-limit elevado para medir latencia y no el límite |
| Exploratorio | charters (`qa/exploratory/`) | fuerza bruta, lockout y su ventana, y el correo de recuperación como canal |

**Lo que este plan NO hace** (ownership matrix, `qa-frontend`/`qa-backend` §2.1): no
escribe unit, component, integration, contract-provider ni smoke. Esas son TDD del
dev en `/develop-backend` y `/develop-frontend-web`, y en US-014 **ya están**. Se
registran como nota de cobertura para que nadie las duplique.

## Out of scope

- **El borrado de cuenta y sus datos** — US-020.
- **El historial de compras** de la cuenta — US-015.
- **La fusión del carrito invitado con la cuenta al iniciar sesión** — fuera de v1
  (OQ-BE-3 de US-007).
- **2FA del admin** — mencionada como opcional en ADR-0005, sin US.
- **El seam de auth del panel** (`/v1/admin/auth/login`) — es de US-001/ADR-0009 y ya
  tiene su cobertura; acá sólo se cubre la cuenta del **cliente**.
- **La entrega real del email** (Resend) — se verifica el flujo con el token que la API
  expone en entorno de test, no la bandeja de entrada. `Deferred: verificación de
  entrega — owner: PO`.

## Standards consultados

| Standard | Secciones aplicadas |
|---|---|
| `qa-frontend-standards.md` | §2.1 ownership · §19 accesibilidad · §23.4 Playwright · §23.6 axe-core |
| `qa-backend-standards.md` | §2.1 ownership · tipos de suite · gates de calidad |
| `testing-standards.md` | §14 pirámide, AAA, dobles de prueba |
| `security-standards.md` | §3/§4 authn · §7.3 rate-limit y lockout · §7.4 cookies · §7.5 CSRF |
| `performance-standards.md` | §7 un test de carga necesita umbral numérico |
| `observability-standards.md` | §9 sin credenciales ni PII en logs |

## Preguntas abiertas

| Id | Pregunta | Default implementado | Estado |
|---|---|---|---|
| OQ-QA-1 | ¿La suite QA usa su propia base de datos? | **No** por ahora: usa la compartida, con prefijo único por corrida en los emails sembrados. Es la causa conocida de la contaminación que ya rompió `TC-204` de US-002 | `[Deferred: base propia para QA — owner: PO/QA, revisar antes de sumar una cuarta suite]` |
| OQ-QA-2 | ¿El umbral de carga se mide con el rate-limit real o elevado? | **Elevado** (`AUTH_RATE_LIMIT_MAX` alto, como ya hace `qa/scripts/api-up.sh`): con el límite de producción, k6 mide el 429 y no la latencia. El límite se prueba aparte en TC-146 | `[Resolved]` |
| OQ-QA-3 | ¿Se mide el tiempo de respuesta para afirmar anti-enumeración? | **Sí, como banda amplia** (el caso inexistente no puede ser un orden de magnitud más rápido). Un umbral fino sería flaky; sin ninguno, el criterio se afirma a medias | `[Resolved]` |
| OQ-QA-4 | ¿La recuperación se prueba con la bandeja real? | **No**: con el token que la API expone en test. Verificar la entrega es del PO | `[Deferred — owner: PO]` |

## References

- User story: [`docs/user-stories/US-014-registro-login.md`](../../../docs/user-stories/US-014-registro-login.md) (AC-1..AC-11, §9 NFRs)
- Changes hermanos: [`US-014-registro-login-backend`](../US-014-registro-login-backend/design.md) (lockout, rotación, throttlers), [`US-014-registro-login-frontend-web`](../US-014-registro-login-frontend-web/design.md) (topología de cookies, single-flight del refresh)
- ADR-0005 (auth propia), **ADR-0011** (almacén server-side de refresh con detección de reuso), **ADR-0013** (rewrite same-origin)
- PRD §4 (p95 de escritura < 500 ms), E2E §14 (STRIDE de la superficie de sesión), §19 (estrategia de testing)
- Precedente de este harness: [`US-007-carrito-compra-qa`](../US-007-carrito-compra-qa/qa-plan.md)
