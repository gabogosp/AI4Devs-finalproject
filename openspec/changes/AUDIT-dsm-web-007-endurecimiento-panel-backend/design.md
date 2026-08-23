---
parent-us: null
discipline: backend
variant: null
language: es
audit-derived: true
---

# Endurecimiento del panel — backend · Design

## Context

El panel del dueño autentica con un JWT que hoy vive en `sessionStorage`
(`adminSession.ts:12`), contra lo que el E2E §14 exige. La migración a cookie `httpOnly`
toca seis superficies en dos apps, así que se parte en dos changes con una regla de
ordenamiento estricta.

## Goals

- Que `AdminGuard` autorice con la cookie de acceso.
- Que **los dos** caminos de login del panel emitan cookies.
- Que nada de lo que hoy funciona deje de funcionar durante la ventana de convivencia.

## Non-goals

- Apagar el `Authorization` header o sacar el token del cuerpo (fase de contracción).
- El rewrite de `/v1/admin/*` (es `next.config.mjs`, del change de frontend).
- Refresh rotado o 2FA para admin.

## Approach

### D1 — Expand-and-contract, y por qué acá no es opcional

```
estado hoy        →  este change (expand)      →  change de FE        →  contract (follow-up)
Bearer only          Bearer O cookie              el panel manda          se quita Bearer
cookies sólo en      cookies en los dos           cookie y deja de        y el token del
el login por         caminos de login             mandar Bearer           cuerpo
credenciales
```

En cualquier otro módulo se podría hacer de una. Acá no: es **el borde que protege el
panel del dueño**. Un despliegue donde el frontend ya manda cookie y el backend todavía
sólo lee `Bearer` deja al dueño sin poder entrar a su propia tienda, y el síntoma —401 en
todo el panel— no dice por qué. La ventana de convivencia elimina ese estado.

**Precedencia: la cookie gana.** Cuando vienen los dos, se usa la cookie. Es la que un
script inyectado no puede leer, así que ante ambigüedad se prefiere la más fuerte. Y hace
que la fase de contracción sea un no-op de comportamiento: el día que el header desaparece,
nada cambia porque ya no se estaba usando.

### D2 — Qué cookie lee el guard

Se reusa `dsm_access`, la que `setSessionCookies` ya emite (US-014, ADR-0011). **No** se
inventa una cookie de admin aparte: sería un cuarto sujeto de sesión en un proyecto que ya
tiene tres (`dsm_access`, `dsm_refresh`, `dsm_cart`), y el claim `role=admin` dentro del
JWT ya es lo que distingue al admin — que es exactamente el contrato que ADR-0009 prometió
preservar.

Consecuencia asumida: un cliente registrado y un admin comparten el nombre de cookie. No es
un problema de seguridad —el guard verifica el claim `role`, no la presencia de la cookie—
pero sí significa que iniciar sesión como cliente en el mismo navegador **pisa** la sesión
de admin. Para un proyecto de un solo operador es aceptable; queda dicho para que no
sorprenda.

### D3 — CSRF: por qué todavía no cambia nada

Cuando el panel mande cookie en vez de header, sus escrituras pasan a estar autenticadas
por credencial **ambiente**, y ahí `security-standards.md` §7.5 se vuelve *Mandatory*. El
mecanismo ya existe (`CsrfGuard` de US-014, que deriva el double-submit del `jti`) y el
login por credenciales ya emite `dsm_csrf`.

**Pero el guard de CSRF no se agrega en este change.** Hoy el panel manda `Bearer`, que no
es ambiente: agregar la exigencia ahora rompería el panel sin que nada lo pida. Se activa
en el change de frontend, en la misma task que apaga el header — así el cambio de modelo de
autorización y el control que lo protege entran juntos, que es la única forma de no tener
una ventana con cookie y sin CSRF.

### D4 — Capas

| Archivo | Cambio |
|---|---|
| `auth/admin.guard.ts` | `extractBearer` pasa a `extractToken`: cookie primero, header después |
| `auth/admin-auth.controller.ts` | el camino de `bootstrapToken` también llama a `setSessionCookies` |
| `auth/cookies.ts` | sin cambios — el emisor ya existe |

Para el `bootstrapToken` no hay `customer` del cual derivar la sesión (es un token de
plataforma, no una cuenta). Se emite con un sujeto sintético (`sub: 'admin-bootstrap'`,
`role: 'admin'`), **sin** refresh persistido: un refresh de ADR-0011 exige una fila en
`refresh_tokens` con `customer_id`, y no hay cliente. Eso significa que la sesión del
bootstrap **no se renueva** y expira en `AUTH_ACCESS_TTL_MIN`. Es coherente con lo que el
seam es: un camino de arranque, no una sesión de trabajo.

## Trade-offs

**Reusar `dsm_access` vs una cookie de admin propia.** Propia daría aislamiento total
(login de cliente y de admin coexistiendo). Se descarta: cuarto sujeto de cookie, cuarto
lector, cuarta ventana de expiración, para un proyecto con **un** operador. El costo
aceptado está en D2.

**Emitir cookies en el camino de bootstrap vs migrar el panel a credenciales.** Migrar el
panel a `email`+`password` haría innecesario este cambio de backend, porque ese camino ya
emite cookies. Se descarta por ahora: el `bootstrapToken` es el mecanismo que ADR-0009
declaró y el panel lo usa hoy; cambiar **a la vez** el portador del token y el método de
login mete dos variables en el mismo despliegue. Queda como simplificación natural
después.

**Precedencia cookie > header vs lo inverso.** Lo inverso permitiría a un script inyectado
imponer su propio token vía header. Cookie primero.

## Deployment considerations

**Aditivo y sin migración de esquema.** No hay variables nuevas ni secretos nuevos.
**Rollback**: revertir es seguro porque nada dejó de aceptar `Bearer`.

**Orden obligatorio**: este change **antes** del de frontend. Al revés, el panel queda
inaccesible.

## Open questions

| Id | Pregunta | Default implementado |
|---|---|---|
| **OQ-1** | ¿La sesión del bootstrap debería poder renovarse? | **No** (ver D4): sin `customer_id` no hay fila de refresh posible bajo ADR-0011. Expira en `AUTH_ACCESS_TTL_MIN` y el dueño vuelve a loguear. Si molesta, la salida correcta es migrar el panel a credenciales, no inventar un refresh sin sujeto |
| **OQ-2** | ¿Se acepta que el login de cliente pise la sesión de admin en el mismo navegador? | **Sí** (D2), por ser un operador único. Si no, hace falta una cookie de admin propia |

## References

- ADR-0009 (seam de admin), ADR-0011 (cookies y refresh), ADR-0013 (rewrite same-origin),
  E2E §14
- Par de frontend: [`../AUDIT-dsm-web-007-endurecimiento-panel-frontend-web/design.md`](../AUDIT-dsm-web-007-endurecimiento-panel-frontend-web/design.md)
- Standards: `security-standards.md` §3, §7.4, §7.5 · `backend-node-standards.md` §2, §3, §6
