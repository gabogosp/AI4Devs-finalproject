---
parent-us: null
discipline: frontend-web
variant: null
language: es
audit-derived: true
---

# Endurecimiento del panel — frontend · Design

## Context

El JWT del panel vive en `sessionStorage` (`adminSession.ts:12`) contra lo que el E2E §14
exige. El change par de backend ya dejó al guard aceptando cookie **o** `Bearer`, así que
acá se puede apagar el header sin ventana de caída.

Lo que hay que decidir es poco, pero una de las decisiones es la que hace que esto funcione
o no en producción.

## Goals

- Que el token deje de ser legible por JS.
- Que la cookie **vuelva** en producción, no sólo en local.
- Que las escrituras del panel queden protegidas contra CSRF en el mismo movimiento.

## Non-goals

- Tocar el guard o el emisor de cookies (change de backend, ya hecho).
- Sacar el `{ token }` del cuerpo de la respuesta (contracción, follow-up).
- Cambiar el método de login (`bootstrapToken` sigue).

## Approach

### D1 — El rewrite es el gate, no un detalle de configuración

ADR-0013 existe porque `up.railway.app` está en la **Public Suffix List**: el navegador
trata al sitio y al API como **sitios distintos**, así que una cookie emitida por el host
del API nunca vuelve al host del sitio. Ningún valor de `SameSite` ni de `Domain` lo
arregla — la entrada en la PSL existe precisamente para impedirlo.

Hoy el rewrite cubre `/v1/auth/*` (US-014) y `/v1/cart/*` (US-007). **No cubre
`/v1/admin/*`.** Sin extenderlo:

- en local funciona (mismo host, distinto puerto → mismo sitio),
- en producción **el panel queda inaccesible**, y el síntoma es 401 en todo el panel sin
  ninguna pista de por qué.

Por eso la prueba no es un unit test: es un E2E contra la app **construida**, asertando
sobre `context.cookies()`, calcado de `auth-topology.spec.ts` que ADR-0013 dejó como
precedente. Es el único tipo de test que detecta este defecto.

### D2 — Qué desaparece

| Pieza | Qué pasa |
|---|---|
| `authToken.ts` | **se elimina**. Existía para sostener el token en memoria; sin token en la app no tiene función |
| `adminSession.persist()` / `STORAGE_KEY` | **se eliminan** |
| `adminSession.restore()` | **se elimina**: no hay nada que rehidratar, la cookie viaja sola en cada request |
| `adminSession.isAuthenticated()` | deja de mirar memoria. Ver D3 |
| `client.ts` → `getAuthToken()` + header `Authorization` | se reemplaza por `credentials: 'include'` + CSRF, el modelo que `session: 'customer'` ya usa |

Que un módulo del borde HTTP **desaparezca** es la señal de que la migración está bien
hecha: si `authToken.ts` sobreviviera, seguiría habiendo un token en la app.

### D3 — `isAuthenticated()` sin token: el problema honesto

Con el token en una cookie `httpOnly`, **el frontend no puede saber si hay sesión
leyéndola**. Tres salidas:

| Opción | Problema |
|---|---|
| Mirar la cookie legible `dsm_csrf` como marca | Es una heurística: la cookie puede existir con el access ya expirado. Pero es lo que el área de cliente **ya hace** (`sessionState.ts` usa un `SESSION_HINT_KEY` en `localStorage`) |
| Pedir `GET /v1/auth/me` al montar el panel | Autoritativo, pero agrega un round-trip en cada carga y un estado de carga en el guard del panel |
| **Optimista + reacción al 401** ← elegida | El panel asume sesión y el interceptor del cliente ya mapea 401 → `unauthorized`; el guard del panel redirige a `/admin/acceso` cuando eso pasa |

Se elige la tercera porque **el mecanismo ya existe**: `AppError` tiene `kind:
'unauthorized'` y los boundaries del panel ya lo manejan. Las otras dos agregan
infraestructura para responder una pregunta que el primer 401 responde solo. Costo
asumido: al entrar con sesión vencida se ve el chrome del panel un instante antes del
redirect. Para un operador único es aceptable; queda dicho.

### D4 — CSRF entra en la misma task que apaga el header

No es una task aparte, y es a propósito. En el instante en que la autorización pasa a
viajar en una cookie ambiente, `security-standards.md` §7.5 se vuelve *Mandatory*. Si el
CSRF entrara después, habría un commit —y potencialmente un deploy— con el panel
autorizando por cookie y sin double-submit: **estrictamente peor que el estado actual**,
donde el `Bearer` no es ambiente y CSRF no aplica.

`csrf.ts` gana el tercer sujeto (`admin` → `dsm_csrf`, la misma cookie que emite el login),
siguiendo el patrón que US-007 estableció al agregar el segundo. Sigue habiendo **un solo
lector** de `document.cookie` en toda la app.

## Trade-offs

**Optimista vs consultar `/auth/me`.** Ver D3. Se prefiere no agregar un round-trip por
carga del panel para una pregunta que el 401 contesta.

**Eliminar `authToken.ts` vs dejarlo vacío.** Dejarlo sería más "seguro" ante un rollback,
pero un módulo sin función es una invitación a volver a usarlo. Se elimina; el rollback es
`git revert`.

**Extender el rewrite vs un Route Handler.** ADR-0013 ya rechazó el handler: reintroduce un
cliente HTTP escrito a mano para un problema que la configuración resuelve. Se extiende el
rewrite, que es una línea.

## Deployment considerations

**Orden obligatorio**: el change de backend **primero**. Si esto se despliega antes, el
panel manda cookie contra un guard que sólo lee `Bearer` → 401 en todo el panel.

`API_INTERNAL_ORIGIN` pasa a gobernar **tres** superficies same-origin (`/v1/auth/*`,
`/v1/cart/*`, `/v1/admin/*`): un deploy sin ella rompe login, carrito **y** panel. Ya falla
ruidoso al arrancar, así que no hay trabajo nuevo — pero el plan de despliegue debería
nombrarlo.

**Rollback**: `git revert` del deploy del web. El backend sigue aceptando `Bearer`, así que
la versión anterior del panel funciona sin tocar nada. Esa es la ventaja de haber hecho la
fase expand primero.

## Open questions

| Id | Pregunta | Default implementado |
|---|---|---|
| **OQ-1** | ¿`isAuthenticated()` optimista o autoritativo? | **Optimista** (D3), reaccionando al 401 con el mecanismo que ya existe |
| **OQ-2** | ¿Se elimina `authToken.ts` o se deja vacío? | **Se elimina** |

## References

- **ADR-0013** (rewrite same-origin — el gate), ADR-0009 (seam de admin), E2E §14
- Par de backend (**va primero**): [`../AUDIT-dsm-web-007-endurecimiento-panel-backend/design.md`](../AUDIT-dsm-web-007-endurecimiento-panel-backend/design.md)
- Precedentes: `e2e/auth-topology.spec.ts` (cómo se prueba la topología),
  `US-007-carrito-compra-frontend-web` (cómo se agregó el segundo sujeto de CSRF)
- Standards: `frontend-standards.md` §11.1, §11.2, §12 · `security-standards.md` §7.4, §7.5
