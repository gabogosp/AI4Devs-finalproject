---
tracker-id: null
tracker-source: null
parent-us: null
discipline: frontend-web
variant: null
language: es
audit-derived: true
---

# Endurecimiento del panel — frontend: el JWT sale de `sessionStorage`

## Why

`AUDIT-DSM-WEB-007`: `adminSession.ts:12` guarda el JWT del panel en `sessionStorage`, y
el E2E §14 exige lo contrario — «**JWT en cookie `httpOnly`+`secure`+`SameSite` (NO
localStorage)**». Un token legible por JS lo puede tomar cualquier script inyectado en el
panel, y el panel es la superficie que da control total del catálogo y las órdenes.

Este es el change que **US-014 FE nombró y defirió**: «panel del dueño migrado a cookies →
`Deferred: change de endurecimiento del panel — owner: Arquitecto`». Su verificación final
incluso asserta que estos archivos no se movieron, así que la migración tenía que llegar
por acá y no de contrabando.

**Hay un detalle de topología que es el gate real de todo esto**, y no es evidente: la
cookie no vuelve en producción si el navegador le habla al API directamente. ADR-0013
existe por eso —`up.railway.app` está en la Public Suffix List, así que el sitio y el API
son **sitios distintos**— y su rewrite hoy cubre `/v1/auth/*` y `/v1/cart/*`, **no
`/v1/admin/*`**. Sin extenderlo, esta migración funciona perfecto en local y **el panel
queda inaccesible en producción**, con el peor perfil de defecto: invisible hasta el
deploy.

## What changes

**El rewrite same-origin se extiende a `/v1/admin/:path*`** (ADR-0013). Es una línea en
`next.config.mjs` y es lo que hace que la cookie aterrice en el host del sitio y vuelva.

**`adminSession` deja de persistir el token.** Se va `sessionStorage`, se va el
`STORAGE_KEY`, se va `restore()` —ya no hay nada que rehidratar: la cookie viaja sola— y
`isAuthenticated()` deja de mirar una variable en memoria. La sesión pasa a ser una
propiedad del navegador, no del estado de la app.

**El cliente HTTP deja de inyectar `Authorization` para el panel** y pasa a
`credentials: 'include'` + header de CSRF, que es el modelo que `session: 'customer'` ya
usa. Se agrega el sujeto `admin` al lector único de CSRF (`csrf.ts`), tercer sujeto después
de `session` y `cart`.

**`authToken.ts` se elimina.** Existía para sostener el token en memoria; sin token en la
app, no tiene función. Es la primera vez en el proyecto que un módulo del borde HTTP
**desaparece** en vez de crecer.

**El CSRF del panel se activa en la misma task que apaga el header.** Cuando la
autorización pasa a viajar en una cookie ambiente, `security-standards.md` §7.5 se vuelve
*Mandatory*. Entra junto con el cambio de portador, no después: una ventana con cookie y
sin CSRF sería estrictamente peor que el estado actual.

## Out of scope

- **Que el backend lea la cookie y el bootstrap la emita** — es el change par, y va
  **primero**. `Depende de: AUDIT-dsm-web-007-endurecimiento-panel-backend`
- **Sacar el `{ token }` del cuerpo de la respuesta de login** — fase de contracción, en un
  follow-up de backend cuando este change confirme que nadie lo lee.
- **Refresh rotado y 2FA para el admin** — ADR-0005 los nombra; siguen fuera.
- **Migrar el panel a login por credenciales** — simplificación natural después (haría
  innecesaria la emisión de cookies en el camino de bootstrap), pero cambiar el portador y
  el método de login en el mismo despliegue mete dos variables a la vez.

## Standards consultados

| Standard | Secciones |
|---|---|
| `frontend-standards.md` | §11.1 cliente HTTP centralizado · §11.2 interceptor de auth · **§12 seguridad cliente (nada de tokens legibles por JS)** |
| `frontend-next-standards.md` | `rewrites`, frontera Server/Client |
| `security-standards.md` | §7.4 cookies · **§7.5 CSRF (acá SÍ aplica, y entra en la misma task)** |
| `qa-frontend-standards.md` | §23.3 MSW · §23.4 Playwright (la prueba de topología) |
| **ADR-0013** | rewrite same-origin — **el gate real de esta migración** |
| ADR-0009 | seam de admin: el `bootstrapToken` no se reemplaza, sólo cambia el transporte del JWT |

## References

- Finding: `AUDIT-DSM-WEB-007` en `docs/audits/dsm-web/2026-08-22/audit.md`
- Deferral que lo originó: [`US-014-registro-login-frontend-web/tasks.md`](../US-014-registro-login-frontend-web/tasks.md) §Diferidos declarados
- Par de backend (**va primero**): [`AUDIT-dsm-web-007-endurecimiento-panel-backend`](../AUDIT-dsm-web-007-endurecimiento-panel-backend/proposal.md)
- E2E §14 · ADR-0013 · ADR-0009 · `e2e/auth-topology.spec.ts` (el precedente de cómo se prueba)
