---
tracker-id: null
tracker-source: null
parent-us: null
discipline: backend
variant: null
language: es
audit-derived: true
---

# Endurecimiento del panel — backend: el guard acepta cookie y el bootstrap la emite

## Why

`AUDIT-DSM-WEB-007` es válido: `adminSession.ts:12` persiste el JWT de admin en
`sessionStorage`, y el E2E §14 es explícito en lo contrario — «**JWT en cookie
`httpOnly`+`secure`+`SameSite` (NO localStorage)**». Un token legible por JS es tomable
por cualquier script inyectado en el panel.

No se remedió inline porque **US-014 FE ya lo defirió a propósito**: «panel del dueño
migrado a cookies → `Deferred: change de endurecimiento del panel — owner: Arquitecto`».
Este es ese change. Y hay una razón concreta para respetar el deferral: US-014 tiene un
task **cerrado** que asserta que estos archivos no se movieron
(`git diff --quiet HEAD -- apps/web/src/features/auth apps/web/src/lib/http/authToken.ts`),
así que tocarlos por la ventana equivocada rompe la verificación de un change ya
entregado.

**Este change es la mitad de backend, y es deliberadamente aditiva.** No cambia el
contrato de nadie: al terminar, el guard acepta **cookie o `Bearer`** y los dos caminos
de login emiten cookies. El panel sigue funcionando exactamente igual con su
`Authorization` header. Recién el change de frontend apaga el header. Es
expand-and-contract sobre el borde de autenticación, que es el único lugar del sistema
donde un despliegue a medias no se puede permitir dejar a nadie afuera.

Y hay una parte del trabajo que ya está hecha y conviene saberlo: el camino de
credenciales (`loginWithCredentials`) **ya emite las tres cookies** vía
`setSessionCookies`, y el seed ya crea la cuenta admin. Lo que falta es que el guard las
lea y que el camino de `bootstrapToken` las emita también.

## What changes

**`AdminGuard` acepta dos portadores.** Hoy sólo lee `Bearer` (`extractBearer`). Se
agrega la lectura de la cookie de acceso, con **precedencia de la cookie** sobre el
header: cuando los dos vienen, la cookie manda, porque es la que no puede leer un script.

**El camino de `bootstrapToken` emite cookies.** Hoy sólo el de credenciales lo hace. Sin
esto, el panel no puede migrar sin cambiar primero su forma de loguearse — y el
`bootstrapToken` es el camino que ADR-0009 dejó como seam interino y sigue en uso.

**El contrato de respuesta no cambia.** `POST /v1/admin/auth/login` sigue devolviendo
`{ token }` en el cuerpo. Quitarlo es del change de frontend, cuando ya nadie lo lea.

**`Cache-Control: no-store`** ya cubre `/v1/admin/*` desde US-001; no hay trabajo ahí.

## Out of scope

- **Dejar de emitir el token en el cuerpo** y **apagar `Authorization`** — es la fase de
  contracción, y va en el change de frontend + un follow-up de backend cuando el panel
  ya no lo use. `Deferred: AUDIT-dsm-web-007-endurecimiento-panel-frontend-web`
- **El rewrite same-origin de `/v1/admin/*`** (ADR-0013) — es `next.config.mjs`, o sea
  frontend. **Sin él la cookie no vuelve en producción**, así que es el gate real de la
  migración. `Deferred: el change de frontend`
- **Refresh rotado y 2FA para el admin** — ADR-0005 los nombra; siguen fuera.
- **Unificar el admin con `customers`** — el panel usa el seam de ADR-0009; unificarlo es
  otra decisión.

## Standards consultados

| Standard | Secciones |
|---|---|
| `security-standards.md` | §3 authn/authz · **§7.4 cookies** · §7.5 CSRF (por qué acá todavía no cambia) |
| `backend-node-standards.md` | §2 capas · §3 DI · §6 errores de dominio · §7 config |
| `api-standards.md` | §8 RFC 7807 · §11 esquemas de seguridad en OpenAPI |
| `testing-standards.md` / `qa-backend-standards.md` | §14 pirámide |
| **ADR-0009** | seam de auth admin — lo que este change endurece sin reemplazar |
| **ADR-0011** | almacén server-side de refresh; el mecanismo de cookies que se reusa |
| **ADR-0013** | rewrite same-origin — **la razón por la que la mitad de frontend es obligatoria** |

## References

- Finding: `AUDIT-DSM-WEB-007` en `docs/audits/dsm-web/2026-08-22/audit.md`
- Deferral que lo originó: [`US-014-registro-login-frontend-web/tasks.md`](../US-014-registro-login-frontend-web/tasks.md) §Diferidos declarados
- E2E §14 (la regla que hoy se incumple), ADR-0009, ADR-0011, ADR-0013
- Par de frontend: [`AUDIT-dsm-web-007-endurecimiento-panel-frontend-web`](../AUDIT-dsm-web-007-endurecimiento-panel-frontend-web/proposal.md)
