---
parent-us: US-014
discipline: qa
language: es
---

# US-014 — Plan de QA (capas QA-owned)

## 1. Alcance: qué es de QA y qué ya es del dev

Per la matriz de ownership (`qa-frontend`/`qa-backend` §2.1). **Nada de la columna
dev-owned se planifica acá**; se lista para que no se duplique.

| Capa | Dueño | Estado en US-014 |
|---|---|---|
| Unit / component | dev (TDD) | **hecho**: `password-policy`, `password-hasher`, `cookies`, `csrf`, `opaque-token`, `sessionState`, formularios FE |
| Integration (Postgres real) | dev (TDD) | **hecho**: `customers.repository`, `refresh-tokens.repository`, `password-reset-tokens.repository` |
| e2e-nest (un servicio) | dev (TDD) | **hecho**: `e2e-auth-{register,login,session,csrf,enumeration,ratelimit,password-reset,observability}` |
| E2E de navegador **contra el stub** | dev (TDD) | **hecho**: `apps/web/e2e/auth-{topology,journey,recuperacion}.spec.ts` |
| **E2E de navegador contra la API REAL** | **QA** | **este plan** |
| **Propiedades de seguridad observables** | **QA** | **este plan** |
| **Accesibilidad (axe + teclado)** | **QA** | **este plan** |
| **Carga** | **QA** | **este plan** |
| **Exploratorio** | **QA** | **este plan** |

> La distinción que justifica la capa nueva: los E2E del FE corren contra
> `api-stub.mjs`, cuyo bcrypt es una comparación de strings, cuyo rate-limit se
> dispara con un header y cuya rotación de refresh vive en un `Map`. Un desacuerdo
> entre el stub y el backend real pasa verde en las dos suites.

## 2. Matriz AC × capa

`D` = ya cubierto dev-owned · `Q` = cubierto por este plan · `—` = no aplica.

| AC | Unit/Int | e2e-nest | E2E navegador (stub) | **E2E API real (Q)** | **a11y (Q)** | **Carga (Q)** |
|---|---|---|---|---|---|---|
| AC-1 registro con sesión inmediata | D | D | D | **TC-140** | **TC-150** | — |
| AC-2 login | D | D | D | **TC-141** | **TC-150** | **TC-160** |
| AC-3 logout invalida | D | D | D | **TC-142** | — | — |
| AC-4 recuperación completa | D | D | D | **TC-143** | **TC-151** | — |
| AC-5 login inválido genérico | D | D | — | **TC-144** | — | — |
| AC-6 registro con email existente | D | D | — | **TC-144** | — | — |
| AC-7 token expirado o usado | D | D | D | **TC-145** | — | — |
| AC-8 contraseña nunca expuesta | D | D | — | **TC-147** | — | — |
| AC-9 sesión por cookie + refresh rotado | D | D | D (topología) | **TC-148** | — | — |
| AC-10 límite de intentos | D | D | — | **TC-146** | — | — |
| AC-11 reset de email inexistente | D | D | — | **TC-144** | — | — |

**Sin huecos**: los 11 AC tienen al menos una capa QA-owned o una nota explícita de
por qué la dev-owned alcanza.

## 3. Escenarios (Gherkin)

### TC-140 — Registro con sesión inmediata (AC-1) · happy

```gherkin
Given un email que no está registrado en la API real
When me registro desde el formulario del sitio con nombre y contraseña válida
Then quedo con sesión iniciada sin ningún paso de verificación
And puedo abrir "mi cuenta" sin volver a autenticarme
And la contraseña no aparece en ninguna respuesta de la API
```

### TC-141 — Login (AC-2) · happy

```gherkin
Given una cuenta creada por la API real
When inicio sesión desde el formulario con las credenciales correctas
Then accedo a las secciones de mi cuenta
And la sesión sobrevive una recarga completa de la página
```

### TC-142 — Logout invalida de verdad (AC-3) · happy

```gherkin
Given una sesión activa en el navegador
When cierro sesión
Then las secciones de cuenta vuelven a pedirme autenticación
And el refresh que tenía deja de servir contra la API real
```

### TC-143 — Recuperación de punta a punta (AC-4) · happy

```gherkin
Given una cuenta registrada que olvidó su contraseña
When pido recuperarla y abro el enlace con el token que la API expone en test
And fijo una contraseña nueva válida
Then puedo iniciar sesión con la nueva
And no puedo iniciar sesión con la anterior
```

### TC-144 — Anti-enumeración en las tres superficies (AC-5, AC-6, AC-11) · negative

```gherkin
Given un email registrado y otro que no existe
When pruebo login, registro y solicitud de recuperación con cada uno
Then el status y el cuerpo de la respuesta son indistinguibles entre los dos casos
And el caso inexistente no responde en un orden de magnitud menos tiempo
```

### TC-145 — Token de reset usado y expirado (AC-7) · alternative

```gherkin
Given un token de recuperación ya utilizado
When abro el enlace de nuevo
Then no puedo cambiar la contraseña
And la pantalla me indica pedir un enlace nuevo
```

### TC-146 — Límite de intentos con el rate-limit REAL (AC-10) · negative

```gherkin
Given el rate-limit de la API en su valor de producción
When supero el límite de intentos de login desde la misma IP
Then las solicitudes siguientes se rechazan con 429
And la respuesta indica cuánto esperar
```

### TC-147 — La contraseña no se filtra por ningún canal (AC-8) · negative

```gherkin
Given un registro y un login contra la API real
When reviso las respuestas de la API y los logs del proceso
Then la contraseña no aparece en texto plano en ninguno
And tampoco aparece su hash en las respuestas
```

### TC-148 — Cookies y rotación del refresh (AC-9) · negative

```gherkin
Given una sesión recién iniciada contra la API real
Then la cookie de sesión es httpOnly y no es legible desde JavaScript
And la de CSRF sí es legible, porque el double-submit la necesita
When uso el mismo refresh token dos veces
Then el segundo uso es rechazado y la familia queda revocada
```

### TC-150 — Accesibilidad de registro y login (US §9) · a11y

```gherkin
Given los formularios de registro y de login
Then axe no encuentra violaciones WCAG 2.1 AA
And puedo completarlos y enviarlos sólo con teclado
And cada error de validación queda asociado a su campo por nombre accesible
```

### TC-151 — Accesibilidad de recuperación y confirmación (US §9) · a11y

```gherkin
Given las pantallas de pedir recuperación y de fijar la nueva contraseña
Then axe no encuentra violaciones WCAG 2.1 AA
And el mensaje de resultado se anuncia en una región viva
```

### TC-160 — Login bajo carga (PRD §4) · performance

```gherkin
Given la API con el rate-limit elevado para medir latencia y no el límite
When 10 usuarios virtuales inician sesión durante 30 segundos
Then el p95 de la operación se mantiene por debajo de 500 ms
And ninguna respuesta es 5xx
```

## 4. Stubs de casos de prueba

| id | execution_mode | test_layer | target_tooling | gherkin_scenario |
|---|---|---|---|---|
| TC-140 | automated | e2e | playwright | Registro con sesión inmediata |
| TC-141 | automated | e2e | playwright | Login |
| TC-142 | automated | e2e | playwright | Logout invalida de verdad |
| TC-143 | automated | e2e | playwright | Recuperación de punta a punta |
| TC-144 | automated | security | playwright (API context) | Anti-enumeración en las tres superficies |
| TC-145 | automated | e2e | playwright | Token de reset usado y expirado |
| TC-146 | automated | security | playwright (API context) | Límite de intentos con el rate-limit real |
| TC-147 | automated | security | playwright (API context) | La contraseña no se filtra por ningún canal |
| TC-148 | automated | security | playwright (API context) | Cookies y rotación del refresh |
| TC-150 | automated | a11y | playwright + axe-core | Accesibilidad de registro y login |
| TC-151 | automated | a11y | playwright + axe-core | Accesibilidad de recuperación y confirmación |
| TC-160 | automated | load | k6 | Login bajo carga |
| TC-170 | **manual** | exploratory | charter | Fuerza bruta y ventana de lockout: ¿el bloqueo se comunica sin revelar si el email existe? |
| TC-171 | **manual** | exploratory | charter | El correo de recuperación como canal: enlace en un cliente real, expiración a la vista, reuso |

Los dos `manual` quedan como checklist humano: `/develop-qa` no los scaffoldea.

## 5. Entorno

Idéntico al de US-007 QA, y por los mismos motivos:

```bash
pnpm --filter @dsm/api build
QA_WEB_BASE_URL=http://localhost:3220 QA_API_PORT=3009 pnpm --filter @dsm/qa api:up
# el web se CONSTRUYE con el mismo puerto con el que se sirve: las NEXT_PUBLIC_* se
# inlinean en build, y servir en otro puerto rompe canonical y specs de SEO
NEXT_PUBLIC_API_BASE_URL=http://localhost:3009 NEXT_PUBLIC_SITE_URL=http://localhost:3220 \
  API_INTERNAL_ORIGIN=http://localhost:3009 pnpm --filter @dsm/web build
QA_API_BASE_URL=http://localhost:3009 QA_WEB_BASE_URL=http://localhost:3220 \
  pnpm --filter @dsm/qa test:e2e
```

`api:up` ya eleva `AUTH_RATE_LIMIT_MAX` y pone `AUTH_COOKIE_SECURE=false` — sin eso,
cada escenario que hace login real se autobloquea al sexto y las cookies `Secure` no
vuelven por http. **TC-146 necesita lo contrario**: se levanta con el límite de
producción, en su propio proceso.

## 6. Riesgos del plan

| Riesgo | Mitigación |
|---|---|
| Base compartida: emails sembrados por otras corridas colisionan | prefijo único por corrida en el email (como `builders` ya hace con SKU/slug). OQ-QA-1 propone base propia |
| El lockout de una corrida deja la cuenta bloqueada para la siguiente | cada escenario siembra **su** cuenta; ninguno reusa la del anterior |
| Medir tiempo para anti-enumeración es flaky | banda amplia (no un orden de magnitud), nunca un umbral fino (OQ-QA-3) |
| TC-146 y el resto se estorban por el rate-limit | proceso aparte con el límite real; el resto corre con el elevado |
