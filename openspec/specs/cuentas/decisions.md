# CAP-6 Cuentas — Decisiones

Decisiones que gobiernan el estado vivo de la capacidad. Los ADR son la
fuente de verdad; acá se registra **cuál aplica a esta capacidad y por qué**.

## ADRs que aplican

| ADR | Decisión | Impacto en esta capacidad |
|---|---|---|
| ADR-0005 | Auth propia (JWT + bcrypt), sin proveedor externo de identidad. | Fija el modelo completo: access JWT + refresh + bcrypt. |
| ADR-0009 | Seam de auth admin (`AdminGuard`, `role=admin`). | Se preserva íntegro — `AdminGuard` no se toca; la Fase 8 sólo extiende la EMISIÓN (`POST /admin/auth/login` acepta credenciales además del bootstrap token). |
| ADR-0010 | Namespace: raíz pública / `/admin/*` panel. | El cliente es público ⇒ `/v1/auth/*`, nunca bajo `/admin`. |
| ADR-0011 (nuevo, materializado por este change) | Almacén server-side de refresh tokens con rotación, detección de reuso y revocación. | **Enmienda** una nota `Neutral` de ADR-0005 que descartaba el almacén server-side — AC-3 (logout real) y `security-standards §3.3` (revocación real) lo exigen. |

## Decisiones de implementación

| Decisión | Motivo |
|---|---|
| Una sola tabla `customers` con `role: customer\|admin`, dos seams de emisión separados (`/v1/auth/login` cliente, `/v1/admin/auth/login` admin). | El E2E §8 modela así el DER; dos tablas de credenciales duplicarían bcrypt/lockout/reset. La separación de privilegios se sostiene en el claim + el guard (server-side, autoritativos), no en tablas separadas. |
| `POST /admin/auth/login` se EXTIENDE (Fase 8) en vez de crear una ruta nueva. | Cero churn en el panel admin ya construido (US-001), que espera `{token}` en el cuerpo vía esa ruta exacta; el criterio de validación de ADR-0009 exige que el guard no cambie. |
| Access token: JWT HS256 en cookie `httpOnly`, 15 min, claims `{sub, role, typ, jti, iss, aud}`. | Pin de algoritmo + validación de `exp`/`iss`/`aud`/`typ` — un refresh nunca puede usarse como access ni viceversa. |
| Refresh token: opaco (256 bits CSPRNG), NO un JWT. | No necesita ser auto-descriptivo; elimina el riesgo de aceptar uno con claims manipulados. |
| Rotación de un solo uso + detección de reuso (revoca la familia entera). | Es la señal canónica de robo de token (`security-standards §3.3`); un reintento con un refresh ya usado nunca debe distinguirse de un token inexistente (mismo 401). |
| CSRF: double-submit **firmado** (`HMAC-SHA256(JWT_SECRET, jti)`), sin estado adicional en DB. | Cubre la segunda capa que `security-standards §7.5` exige sobre `SameSite=Lax`; verificable sin tabla nueva porque el HMAC es recalculable desde el `jti` del access presentado. |
| bcrypt cost 12, no argon2id (que el estándar general prefiere). | AC-8 de la US nombra bcrypt textualmente, ADR-0005 y el E2E §16 lo repiten — cambiar sería una desviación de tres artefactos aprobados sin beneficio proporcional al perfil de riesgo (sin PCI/PHI declarado). |
| Contraseñas > 72 bytes se RECHAZAN (422), nunca se truncan. | bcrypt trunca a 72 bytes; `security-standards §3.1` prohíbe truncar antes de hashear en silencio. |
| Corpus offline de contraseñas filtradas (top 10.000, versionado en el repo) en vez de la API de HIBP. | Sin dependencia de red en el camino de registro; costo aceptado: cobertura menor, candidato a refresco anual. |
| Anti-timing: `bcrypt.compare` contra un hash señuelo constante cuando el email no existe. | Iguala el costo de CPU entre "cuenta existe" y "cuenta no existe" — cierra el vector de timing de AC-5. |
| Tokens de reset/refresh hasheados con SHA-256 (no bcrypt) en reposo. | Son secretos de alta entropía generados por el servidor (256 bits), no contraseñas humanas — no hay diccionario que atacar, y la búsqueda por hash exige determinismo (bcrypt saltea por diseño). |
| **Adapter Resend adelantado a este change** (decisión del PO, 2026-08-19) — reabre y resuelve de nuevo OQ-BE-1. | La resolución original (adapter de log, Resend en US-011) dejaba AC-4 inalcanzable en producción por varios ciclos: US-011 depende de todo el loop de compra (US-003/007/008/009/010/012). Consecuencia: el alcance de US-011 se reduce — ya no enchufa el adapter, sólo consume el puerto para sus propias notificaciones. |
| Puerto `PasswordResetMailer` con dos adapters seleccionados por `RESEND_API_KEY` (presente → Resend; ausente → log). | En producción, si falta la key, el arranque FALLA (fail-fast) — mismo criterio que `GEMINI_API_KEY` de US-005; no degrada en silencio a un adapter que no envía nada. |
| `409` genérico en registro duplicado, no indistinguibilidad total (OQ-BE-5). | AC-1 exige sesión inmediata al registrarse — eso hace imposible ocultar por completo que el email ya existe sin cambiar el flujo a uno mediado por confirmación de email. |
| Sin prefijos `__Host-`/`__Secure-` en las cookies (OQ-BE-6). | Decisión de ingeniería consciente, no un placeholder — nombres fijos + `Secure` gobernado por config (`AUTH_COOKIE_SECURE`) para no romper el loop local en HTTP. |

## Riesgo de reconciliación con `catalogo`

`POST /admin/auth/login` vivía en el contrato de `catalogo` (creado por
US-001). Este change lo EXTIENDE (mismo endpoint, `requestBody` ampliado a
`oneOf: [{bootstrapToken}, {email, password}]`) y, por decisión del PO
(2026-08-19), su contrato **se muda** acá al archivar — es un endpoint de
autenticación, no de catálogo. `catalogo/README.md` queda con una nota que
apunta a esta capacidad; no se declara en las dos specs (evita drift entre
copias).

## Desviaciones conscientes registradas

- **`refresh_tokens` y `password_reset_tokens` no están en el DER del E2E §8**
  — son extensión declarada de este change (ADR-0011 las autoriza como
  consecuencia del almacén server-side de refresh).
- **El `409` del throttler global sigue con el `type` heredado
  `dsm:catalog/http-429`** (prefijo de US-001) en vez de uno propio de
  `auth` — renombrar el prefijo genérico rompería el contrato publicado y los
  tests de US-001/US-003 sin ganancia funcional; documentado como limpieza
  transversal pendiente, no como bug de esta capacidad.
- **AC-4 (recuperación de contraseña) se completó en este change**, no
  parcialmente como preveía el `design.md` original — ver la decisión del
  adapter Resend arriba. El `Deferred: US-011` de la sección "Puerto de
  email" quedó anulado por la decisión del PO del 2026-08-19; el AS-BUILT es
  la fuente de verdad, no el `design.md` original.
