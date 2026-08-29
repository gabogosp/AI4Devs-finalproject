---
type: user-story
id: US-014
slug: registro-login
parent-prd: docs/product/prd.md
parent-e2e: docs/product/design-e2e.md
status: In Progress
priority: Medium
estimate-tshirt: M
story_points_traditional: 8
story_points_ai_assisted: 4
estimation_basis: "BE auth propia (registro/login/sesión JWT + refresh + reset por email + bcrypt + rate-limit) (Cohn 2005 §8-9, 8) + FE formularios de auth (Cohn 2005 §8, 5), tomado el dominante × 0.45 (Peng 2023)"
language: es
created: 2026-06-15
updated: 2026-06-15
ready-at: 2026-06-15
authored-by: Gabriel Suarez
disciplines: [BE, FE, QA]
linear-issue-id: null
figma-frames: []
---

# US-014: Registro, login y sesión (cliente registrado)

## 1. La historia (formato Connextra)

**Como** cliente,
**quiero** registrarme, iniciar sesión y poder recuperar mi contraseña,
**para** tener una cuenta y acceder a mi historial de compras.

## 2. Por qué importa (Valuable)

Habilita la retención (cuenta + historial, US-015). El guest cubre el loop; las cuentas agregan valor recurrente (PRD §2.1 cap. 8).

## 3. Criterios de aceptación (Gherkin / Given-When-Then)

### AC-1: Registro con login inmediato
```gherkin
Given un visitante con un email no registrado
When se registra con email, nombre y contraseña válida
Then la cuenta se crea con la contraseña hasheada (bcrypt)
And el cliente queda con la sesión iniciada de inmediato (sin verificación bloqueante)
```

### AC-2: Login con credenciales válidas
```gherkin
Given un cliente registrado
When inicia sesión con su email y contraseña correctos
Then obtiene una sesión activa
And puede acceder a las secciones de su cuenta
```

### AC-3: Logout
```gherkin
Given un cliente con sesión activa
When cierra sesión
Then su sesión se invalida
And ya no puede acceder a las secciones de cuenta sin volver a iniciar sesión
```

### AC-4: Recuperación de contraseña
```gherkin
Given un cliente registrado que olvidó su contraseña
When solicita recuperarla y abre el link recibido por email
Then puede fijar una nueva contraseña
And luego puede iniciar sesión con la nueva contraseña
```

### AC-5: Login inválido con mensaje genérico (alternative path)
```gherkin
Given un intento de login con credenciales incorrectas
When se envía el formulario
Then el sistema rechaza el login con un mensaje genérico
And NO revela si el email existe o si fue la contraseña la incorrecta (anti-enumeración)
```

### AC-6: Registro con email ya existente (alternative path)
```gherkin
Given un email que ya tiene cuenta
When alguien intenta registrarse con ese email
Then no se crea una cuenta duplicada
And el mensaje no permite deducir con certeza la existencia del email (anti-enumeración)
```

### AC-7: Token de reset expirado o usado (alternative path)
```gherkin
Given un link de recuperación de contraseña expirado o ya utilizado
When el cliente lo abre
Then el sistema no permite cambiar la contraseña
And le indica solicitar un nuevo link
```

### AC-8: La contraseña nunca se expone (negative space)
```gherkin
Given el almacenamiento y el manejo de credenciales
When se crea o usa una cuenta
Then la contraseña se guarda hasheada (bcrypt) y nunca en texto plano
And no aparece en respuestas de la API ni en logs
```

### AC-9: Sesión segura por cookie (negative space)
```gherkin
Given una sesión iniciada
When se emite el token de sesión
Then viaja en una cookie httpOnly + secure + SameSite (no en almacenamiento accesible por JavaScript)
And usa un access token de corta duración con un refresh token rotado
```

### AC-10: Límite de intentos (negative space)
```gherkin
Given intentos repetidos de login, registro o recuperación
When superan el límite de tasa configurado
Then el sistema limita las solicitudes
And mitiga ataques de fuerza bruta / abuso
```

### AC-11: Solicitud de reset para email inexistente (negative space)
```gherkin
Given una solicitud de recuperación para un email que no está registrado
When se procesa la solicitud
Then la respuesta es la misma que para un email existente ("si el email existe, te enviamos un link")
And no confirma ni niega la existencia del email
```

## 4. Out of scope explícito

- **Historial de compras** — US-015.
- **Fusión del carrito guest con la cuenta al iniciar sesión** — fuera de v1.
- **Login social / SSO** — fuera de v1.
- **2FA para el cliente** — fuera de v1 (el E2E contempla 2FA opcional solo para el admin).
- **Verificación de email bloqueante** — no aplica (decisión: login inmediato; el email de bienvenida/verificación, si se envía, no bloquea).

## 5. INVEST self-check

| Letra | Criterio | Cumple? | Notas |
|---|---|---|---|
| **I** | Independent | ✅ | Auth propia (ADR-0005); no depende de otras US para entregarse. |
| **N** | Negotiable | ✅ | AC refinables; el "cómo" lo deciden E2E + dev. |
| **V** | Valuable | ✅ | Habilita cuentas + retención (PRD cap. 8). |
| **E** | Estimable | ✅ | 8 SP tradicional / 4 SP AI-asistido. |
| **S** | Small | ✅ | Acotado a registro/login/sesión/reset; completable en un cycle. |
| **T** | Testable | ✅ | 11 AC en Gherkin (seguridad + anti-enumeración verificables). |

## 6. Dependencias

- **Bloquea a**: US-015 (historial requiere cuenta/sesión).
- **Relacionada**: US-011 / Resend (el email de recuperación reutiliza la integración de email transaccional).

## 7. Tasks asociadas (gruesas, una por disciplina afectada)

| Disciplina | Task id | Estimado (h) | Owner | Estado |
|---|---|---|---|---|
| BE | BE-US-014 | 12-16h | TBD | Todo |
| FE | FE-US-014 | 8-12h | TBD | Todo |
| QA | QA-US-014 | 6-8h | TBD | Todo |

- BE: registro + login + logout + sesión (JWT en cookie httpOnly + refresh rotado) + hash bcrypt + flujo de recuperación de contraseña (token con expiración, anti-enumeración) + rate-limit.
- FE: formularios de registro, login y recuperación + manejo de sesión según design-system.
- QA: automatización de AC (registro/login/logout/reset, mensajes genéricos, cookie segura, rate-limit, anti-enumeración).

> Las tasks code-generating (BE/FE) abren su openspec change en `openspec/changes/US-014-registro-login-{discipline}/`. La task QA vive en `tasks/US-014/qa-deliverable.md`.

## 8. Diseño

- **Tiene Figma**: no. Hereda de `docs/product/design-system.md` — formularios de login/registro/reset (Input/Button §7.1-7.2), estados de error, tono §10.2.

## 9. NFRs específicos de esta US

- Hash de contraseña con bcrypt (o argon2); nunca texto plano (E2E §14).
- JWT en cookie httpOnly + secure + SameSite; access token corto (~15 min) + refresh token rotado; logout invalida el refresh.
- Rate-limit en login/registro/recuperación (anti-brute-force).
- Anti-enumeración en login, registro y recuperación (mensajes genéricos).
- Accesibilidad WCAG 2.1 AA en los formularios.
- Observabilidad: registrar éxitos/fallos de login (sin exponer credenciales).

## 10. Notas / contexto adicional

- Decisiones de alcance confirmadas: (1) **login inmediato** tras el registro, sin verificación de email bloqueante; (2) **recuperación de contraseña incluida** en esta US.
- Mecánica de auth fijada en ADR-0005 (NestJS + JWT + bcrypt) y E2E §14 (cookie httpOnly, refresh rotado, anti-enumeración, rate-limit).
- **Decisión relacionada**: US-014 **endurece** el seam de auth admin introducido en US-001 (ver [ADR-0009](../architecture/decisions/0009-admin-auth-seam-us001.md) + OQ-1 del change `US-001-admin-catalogo-productos-backend`), **preservando el contrato `role=admin`** — no reimplementar el `AdminGuard` desde cero. US-014 reemplaza solo el lado de emisión (login + cookie httpOnly/Secure/SameSite + refresh rotado + rate-limit + 2FA).
- El email de recuperación reutiliza la integración de email transaccional (Resend, US-011).

---

## Definition of Ready (gate Triage → Ready)

- [x] §1 Historia escrita en formato Connextra
- [x] §2 Por qué importa explicado
- [x] §3 Al menos 1 AC en Gherkin (11 AC: 4 happy + 3 alternative + 4 negative-space)
- [x] §5 INVEST con todas las letras OK
- [x] §7 Tasks por disciplina identificadas con estimado en horas
- [x] §8 Diseño resuelto (design-system referenciado)
- [x] Dependencias chequeadas (sin bloqueantes pendientes)

## Definition of Done (gate QA → Done)

- [ ] Todas las tasks de la US en estado Done
- [ ] Regression suite del producto verde en staging
- [ ] AC manuales verificados por QA
- [ ] PO firma acceptance
