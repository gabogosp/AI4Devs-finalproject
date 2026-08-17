# ADR 0010: URL namespace — el storefront público se queda con la raíz; el panel del dueño vive bajo `/admin/*`

> **Status**: Accepted
> **Date**: 2026-08-17
> **Decision-makers**: Gabriel Suarez (Arquitecto), Pedro Suarez (PO)
> **Supersedes**: —
> **Superseded by**: —
> **Related**: ADR 0007 (monolito modular / un solo deployable web), ADR 0009 (seam de auth admin — el `AdminGuard` sigue siendo la autoridad de acceso)

## Context

El E2E (§1.3-6, §6.2) decide que el **panel del dueño vive dentro de la misma app Next** que el
storefront público: un solo deployable, un solo build, un solo pipeline. Esa decisión no se
re-abre acá.

Lo que el E2E **no** fijó es **cuál de las dos audiencias se queda con el espacio de URLs raíz**.
US-001 (panel del catálogo) llegó primero y, al no existir la regla, materializó el panel en la
raíz:

| URL | Archivo |
|---|---|
| `/` | `app/page.tsx` ("DSM — Panel del dueño") |
| `/acceso` | `app/(auth)/acceso/page.tsx` |
| `/productos` | `app/(admin)/productos/page.tsx` |
| `/productos/nuevo` | `app/(admin)/productos/nuevo/page.tsx` |
| `/productos/[id]` | `app/(admin)/productos/[id]/page.tsx` |
| `/categorias` | `app/(admin)/categorias/page.tsx` |

El conflicto se materializó en la ejecución de **US-003 FE** (ficha de producto indexable). Al
agregar `app/(storefront)/productos/[slug]/page.tsx`, el build de producción falla de plano:

```
Error: You cannot use different slug names for the same dynamic path ('id' !== 'slug').
```

Y no se arregla igualando el nombre del parámetro: **dos route groups no pueden resolver la misma
ruta**. Los route groups de Next organizan el árbol de archivos, **no** cambian el path — así que
`(admin)` y `(storefront)` compiten por el mismo espacio de URLs.

El conflicto tampoco es local a US-003. **US-002** (catálogo público) necesita `/productos` para la
grilla y `/categorias/{slug}` para la navegación; **US-004** (búsqueda IA) necesita la home. Quien
"gane" `/productos` lo gana para todas las US siguientes.

La pregunta que este ADR responde: **¿qué audiencia es dueña del espacio de URLs raíz, y bajo qué
prefijo vive la otra?**

## Decision

El **storefront público se queda con el espacio raíz**; el **panel del dueño se muda bajo el
prefijo `/admin/*`**.

| Superficie | URLs |
|---|---|
| Storefront (público, indexable) | `/`, `/productos/{slug}` — US-002 sumará `/productos` y `/categorias/{slug}` |
| Panel del dueño (privado, `noindex`) | `/admin/acceso`, `/admin/productos`, `/admin/productos/nuevo`, `/admin/productos/{id}`, `/admin/categorias` |

La mudanza se ejecuta en la Fase 0 del change `US-003-ficha-producto-pdp-frontend-web` como un
refactor **Move** behavior-preserving: cambian ubicaciones de ruta y redirecciones, **no** cambia
ningún componente, copy ni comportamiento del panel.

El `AdminGuard` (ADR 0009) **sigue siendo la autoridad de acceso** y el backend sigue siendo la
autoridad final. El prefijo agrega defensa en profundidad —`X-Robots-Tag: noindex, nofollow` sobre
`/admin/:path*`— pero **no es un control de acceso**: esto no es seguridad por oscuridad.

## Consequences

### Positive

- **El activo de SEO queda donde el negocio lo necesita**: el objetivo del PRD §1.2 es "ser
  encontrado", y AC-1 de US-003 pide explícitamente "URL amigable (slug)". `/productos/{slug}` es la
  URL canónica del producto, sin prefijo que la grave.
- **Un solo modelo mental, API y web**: el E2E ya modela la superficie admin de la API como
  `/admin/*` (§6.1, §14). Ahora web y API comparten la misma convención — *`admin` es el prefijo
  privado; todo lo demás es público*.
- **Postura de seguridad auditable con una regla**: "no exponer panel sin auth" (E2E §14) y el
  `noindex` pasan a ser un matcher único sobre `/admin/:path*`, en vez de una enumeración de rutas
  que hay que acordarse de extender cada vez que el panel crece.
- **Costo cero de migración externa**: nada está desplegado todavía (US-019 en curso) ⇒ cero URLs
  indexadas, cero bookmarks, **cero redirects 301**.
- **Las US siguientes heredan la convención** en vez de re-decidirla: US-002, US-004, US-007 y
  US-016 ya saben dónde va cada superficie.

### Negative

- **Toca superficie ya entregada de US-001**: se mueven 4 carpetas de ruta y se actualizan las
  redirecciones (`router.push` post-login, `router.replace` del guard), 2 asserts de test y 5
  referencias del smoke E2E. Es rework real, aunque acotado y mecánico, absorbido como refactor
  in-scope de US-003 en vez de CR (decisión del PO, 2026-08-17): es behavior-preserving y ningún AC
  de US-001 referencia una URL.
- **La convención hay que sostenerla**: nada en el toolchain impide que una US futura vuelva a
  colgar una pantalla de panel de la raíz. Este ADR es el punto de referencia cuando eso pase.

### Neutral

- **`/` pasa a ser público**: `app/page.tsx` (la home del panel) se elimina y la raíz queda como home
  pública mínima (wordmark). La home real del storefront es `Deferred: US-002`.
- **El `AdminGuard` no cambia**: sigue gateando el subárbol del panel desde el layout de su route
  group. Sólo cambia dónde cuelga ese subárbol.
- **US-019 gana una superficie más simple de proteger**: con un prefijo único, una restricción por
  IP/WAF o basic-auth de borde sobre `/admin/*` es una sola regla, si el equipo decide sumarla.

## Alternatives considered

### Alternative A: Storefront en la raíz, panel bajo `/admin/*` (elegida)

Ver **Decision**. Favorece el activo público, alinea web con la convención de la API y hace la
postura de seguridad auditable con un matcher único. Su costo —tocar rutas de US-001— es mínimo
justamente ahora, y sólo crece con el tiempo.

### Alternative B: Storefront bajo prefijo (`/tienda/*`, `/p/{slug}`)

No toca US-001, que es su único atractivo. Se descarta por dos razones: **degrada el activo que la
US existe para construir** (contradice AC-1 y el objetivo del PRD §1.2, y agrega un segmento inútil
a toda URL indexable), y **ni siquiera resuelve el conflicto** — `/`, la home pública, sigue en
disputa con la home del panel. Además traslada el mismo problema a US-002 y US-004.

### Alternative C: Dos apps Next separadas (storefront y panel)

Aísla los namespaces por completo, pero **contradice el E2E §1.3-6/§6.2** (un solo deployable) y
duplica build, pipeline y configuración para un equipo de este tamaño. Y rompería el mecanismo de
invalidación de caché ratificado para AC-9: `revalidateProduct` es una **Server Action del mismo
app** invocada por el flujo de mutación del panel; con dos apps dejaría de serlo y habría que
inventar un canal entre procesos.

### Alternative D: Renombrar el parámetro del panel de `[id]` a `[slug]`

Haría desaparecer el mensaje de error concreto, pero no el problema: dos route groups siguen sin
poder resolver la misma ruta, y encima el panel pasaría a usar un parámetro llamado `slug` que en
realidad transporta un UUID — confusión gratuita en el código.

### Alternative E: `basePath` o multi-zone de Next

Resuelve el aislamiento a costa de introducir infraestructura de routing (o varios deployables) que
el proyecto no necesita, con la misma tensión contra el E2E §1.3-6 que la Alternative C y sin
beneficio adicional sobre el prefijo simple.

## References

- Change que ejecuta la decisión: `openspec/changes/US-003-ficha-producto-pdp-frontend-web/` (design.md D0, Fase 0 de `tasks.md`).
- E2E: `docs/product/design-e2e.md` §1.3-6, §6.1, §6.2, §14.
- US-003 AC-1: `docs/user-stories/US-003-ficha-producto-pdp.md`.
- Estándar de rutas: `frontend-next-standards.md` §1 (gap registrado como F58 — el estándar no cubre la convivencia de audiencias en una misma app).
