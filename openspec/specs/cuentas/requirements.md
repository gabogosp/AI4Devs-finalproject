# CAP-6 Cuentas — Requisitos acumulados

Acumulado de los changes archivados de esta capacidad. Cada requisito es el
**estado declarado del sistema vivo**, no la intención de un change.

## Desde US-014 backend — Registro, login y sesión del cliente (archivada 2026-09-05)

Superficie cubierta: `POST /auth/register`, `POST /auth/login`,
`POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`,
`POST /auth/password-reset/{request,confirm}`, `POST /admin/auth/login`
(endurecido).

### Funcionales

| # | Requisito | Origen |
|---|---|---|
| R-1 | Un registro válido crea la cuenta con contraseña hasheada (bcrypt cost 12) y deja la sesión iniciada de inmediato — sin verificación de email bloqueante. | AC-1 |
| R-2 | Login con credenciales válidas abre sesión: cookies `dsm_access` (JWT, 15 min), `dsm_refresh` (opaco, 30 días, `Path=/v1/auth`), `dsm_csrf`. | AC-2 |
| R-3 | Logout revoca la familia de refresh del dispositivo actual y borra las tres cookies. La ventana residual del access (≤15 min) es una consecuencia declarada, no un defecto. | AC-3 |
| R-4 | `POST /auth/password-reset/request` siempre responde `202` (cuerpo y cabeceras idénticos exista o no la cuenta); si existe y no superó el cupo de 3/hora, genera un token opaco (SHA-256 en reposo, TTL ≤ 60 min) y despacha el email real vía Resend. | AC-4, AC-11 |
| R-5 | `POST /auth/password-reset/confirm` con token válido y no usado cambia la contraseña, revoca TODAS las sesiones de la cuenta, borra los demás tokens de reset pendientes y resetea el lockout — sin abrir sesión nueva. | AC-4, AC-7 |
| R-6 | Login con contraseña incorrecta, email inexistente o cuenta bloqueada devuelven la MISMA respuesta (`401 dsm:auth/invalid-credentials`), con latencia del mismo orden (hash señuelo). | AC-5 |
| R-7 | Registro con email ya existente devuelve `409 dsm:auth/registration-failed` genérico — no confirma que el email exista (límite documentado, AC-1 impide indistinguibilidad total). | AC-6 |
| R-8 | Ningún log, evento, respuesta ni cuerpo de error expone `password_hash`, `role`, contadores de lockout, `deleted_at`, el token de refresh/reset en claro, ni la contraseña. | AC-8 |
| R-9 | Sesión persistida en cookies `httpOnly`+`Secure`(config)+`SameSite=Lax`; refresh de un solo uso con rotación dentro de la misma familia. | AC-9 |
| R-10 | Throttler `auth` por IP en las 5 rutas sensibles (presupuesto propio por ruta) + lockout por cuenta (`AUTH_LOGIN_MAX_FAILURES=5`, backoff exponencial acotado a 60 min, nunca permanente). | AC-10 |
| R-11 | Reset de contraseña de email inexistente responde exactamente igual (`202`) que uno existente — mismo criterio que el login. | AC-11 |
| R-12 | `POST /admin/auth/login` acepta `{email, password}` además del `bootstrapToken` original, preservando el contrato `role=admin` y sin modificar `AdminGuard`. | AC-8 seam admin (ADR-0009) |

### Negative-space (lo que NO debe pasar)

| # | Requisito |
|---|---|
| N-1 | Un refresh ya rotado (reuso) revoca la familia entera y responde el MISMO `401` que un token inexistente — nunca distingue los dos casos. |
| N-2 | El body de `register` con `role`, `id` o `password_hash` es rechazado con `422` (`forbidNonWhitelisted`) — nunca ignorado en silencio ni aceptado. |
| N-3 | Un access token nunca abre `/v1/admin/*` (claim `role` distinto) y un refresh nunca funciona como access (claim `typ` validado). |
| N-4 | Ninguna cookie de sesión es legible por JavaScript salvo `dsm_csrf` (deliberadamente, para armar el header) — `dsm_access`/`dsm_refresh` son `httpOnly`. |
| N-5 | Las rutas no autenticadas (`register`, `login`, `password-reset/*`) nunca exigen `X-CSRF-Token` — no hay cookie de sesión sobre la que cabalgar todavía. |
| N-6 | Un JWT con `alg: none` o algoritmo distinto de HS256 nunca se acepta (`algorithms: ['HS256']` fijo). |
| N-7 | El lockout nunca es permanente — el backoff está acotado a 60 min por diseño (evita que el lockout se use como arma de DoS contra el usuario legítimo). |

### No funcionales

| # | Requisito | Verificación |
|---|---|---|
| NFR-1 | Latencia `POST /auth/login` p95 < 600 ms / p99 < 1 s `[propuesto — pendiente de confirmar por Arquitecto]` — desviación deliberada del presupuesto genérico de escritura (p95 < 500 ms): bcrypt cost 12 cuesta ~250-350 ms de CPU por diseño; bajarlo debilitaría el control principal. | Suite dev-owned; sin k6 propio de esta disciplina (ver US-014-qa, `[Open]` real sobre este mismo número). |
| NFR-2 | Latencia `POST /auth/register` p95 < 700 ms `[propuesto]`. | Suite dev-owned. |
| NFR-3 | Latencia `GET /auth/me` y `POST /auth/refresh` p95 < 150 ms (sin bcrypt). | Suite dev-owned. |
| NFR-4 | Ventana de invalidación de sesión ≤ 15 min (TTL del access) — consecuencia declarada de un modelo sin denylist por `jti`. | Diseño, no test. |

### Diferidos con dueño

| # | Requisito | Dueño / disparador |
|---|---|---|
| D-1 | 2FA (cliente y admin). | Owner: Arquitecto — follow-up de ADR-0009. |
| D-2 | Borrado de cuenta / RTBF (`deleted_at` existe, sin endpoint que la escriba). | Owner: PO — US futura de gestión de datos. |
| D-3 | Fusión del carrito guest con la cuenta al loguearse. | Fuera de v1 (US §4). |
| D-4 | Historial de compras de la cuenta. | US-015. |
| D-5 | Purga programada (job BullMQ) de tokens de refresh/reset vencidos — hoy sólo limpieza oportunista acotada por cuenta. | Owner: Arquitecto — US-011/operaciones, condicionado a que `REDIS_URL` se aprovisione (ADR-0004). |
| D-6 | Rate-limit de borde (Cloudflare/WAF) sobre `/v1/auth/*`, defensa en profundidad adicional al throttler de aplicación. | Owner: Arquitecto — US-019 (infraestructura). |
| D-7 | Ratificar los 3 NFR de latencia (`[propuesto]`) con datos reales de producción. | Owner: Arquitecto/PO. |
| D-8 | Prefijos `__Host-`/`__Secure-` en las cookies. | Decisión de ingeniería consciente (OQ-BE-6) — no un placeholder. |
