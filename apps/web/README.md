# @dsm/web — Storefront + panel del dueño (Next.js)

Un solo deployable con **dos audiencias**: el storefront público indexable
(US-003 en adelante) y el panel de administración del catálogo (US-001).
Consume la API del backend (`@dsm/api`).

## Mapa de rutas

El espacio de URLs raíz es **público** y el panel vive bajo `/admin/*`. La
convención la fija **ADR-0010**
(`docs/architecture/decisions/0010-url-namespace-storefront-vs-admin.md`) y la
heredan US-002/US-004/US-007/US-016 — no se re-decide por US.

| Superficie | Rutas |
|---|---|
| Storefront (público, indexable) | `/` (home: rubros y subrubros), `/categorias/{slug}` (grilla paginada), `/productos/{slug}` (ficha), `/sitemap.xml`, `/robots.txt` |
| Panel del dueño (privado, `noindex`) | `/admin/acceso`, `/admin/productos`, `/admin/productos/nuevo`, `/admin/productos/{id}`, `/admin/categorias` |

El panel responde con `X-Robots-Tag: noindex, nofollow` sobre `/admin/:path*`.
Es defensa en profundidad contra indexación, **no** control de acceso: eso lo
siguen haciendo el `AdminGuard` en el cliente y el backend en el servidor.

> **Prohibido `loading.tsx` en TODO el route group `(storefront)`**, no sólo en
> el segmento de la ficha. Un `loading.tsx` crea una boundary de Suspense, Next
> transmite el shell con status 200 **ya comprometido**, y el `notFound()`
> posterior no puede cambiarlo: queda un soft-200 indexable. Rompe el 404 de la
> ficha (US-003) **y** el de la categoría (US-002 AC-9). Puesto en el route
> group los rompe a los dos de una vez. Medido aislando archivo por archivo;
> ver `design.md` D1.bis de US-003, D10 de US-002, y el gap F59. Hay un gate en
> la verificación suite-level de US-002 que falla si aparece uno.

## Caché del catálogo e invalidación

El storefront cachea sus fetches con **un único tag, `catalog`** (design.md D2
de US-002), más un safety-net de 1 h. La frescura real no la da el TTL sino la
invalidación on-demand:

| Qué | Quién lo invalida |
|---|---|
| Árbol de categorías, detalle, listados, sitemap | `revalidateCatalog()` — tag `catalog` |
| Página de una categoría (incluye 404 cacheados) | `revalidateCatalog()` — `revalidatePath('/categorias/[slug]', 'page')` |
| Home y `sitemap.xml` | `revalidateCatalog()` — `revalidatePath` |
| Ficha de un producto | `revalidateProduct(slug)` — tag `product:{slug}` |

**Toda mutación del panel debe pasar por el puente** `revalidateSafely.ts`
(`revalidateProductSafely` para productos, `revalidateCatalogSafely` para
categorías). Es fire-and-forget: cuando se invoca, el backend ya confirmó la
mutación, así que un fallo de purga se reporta a observabilidad y no rompe el
feedback al dueño. Agregar una llamada suelta en un sitio de mutación en vez de
usar el puente es el error que el diseño busca evitar: una acción futura puede
olvidarse de invalidar el listado, y la grilla queda mintiendo hasta el TTL.

**Cero variables de entorno nuevas**: se reusan las públicas existentes.

## Requisitos

- Node 22, pnpm 9.15.9 (raíz del monorepo).
- Backend `@dsm/api` corriendo (o mockeado en tests).

## Variables de entorno

- `NEXT_PUBLIC_API_BASE_URL` — base URL de la API de administración
  (default `http://localhost:3000`). Validada al arranque con Zod. **Sin
  secretos server-only con prefijo `NEXT_PUBLIC_`.**
- `NEXT_PUBLIC_SITE_URL` — origen público del sitio. Construye las URLs
  **absolutas** de `canonical`, Open Graph y JSON-LD.
- `NEXT_PUBLIC_WHATSAPP_PHONE` — teléfono del local en formato internacional sin
  `+` ni separadores (lo que espera `wa.me`), para el CTA de producto sin stock.
  El número real es dato pendiente del cliente (OQ-FE-3): el default es un
  **placeholder que no debe llegar a producción**.
- `NEXT_PUBLIC_IMAGE_CDN_HOST` — host permitido en `images.remotePatterns`. Sin
  comodín universal: eso volvería al optimizador de Next un proxy abierto.
- `NEXT_PUBLIC_SENTRY_DSN` — (opcional) habilita observabilidad.

> Las `NEXT_PUBLIC_*` se **inlinean en el build**, no se leen en runtime: tienen
> que estar definidas en el paso de build del pipeline. Si faltan, el modo de
> falla es silencioso (canonical y OG apuntando a `localhost` en producción).

Ver `.env.example`.

## Correr

```bash
pnpm --filter @dsm/web dev        # desarrollo (:3000)
pnpm --filter @dsm/web build      # build de producción
pnpm --filter @dsm/web start      # servir el build
```

## Testear

```bash
pnpm --filter @dsm/web test -- --run     # unit + component + integration (Vitest + RTL + MSW)
pnpm --filter @dsm/web test:e2e          # smoke E2E (Playwright, contra next build/start)
pnpm --filter @dsm/web lint
pnpm --filter @dsm/web typecheck
```

### Canal de contacto (WhatsApp — US-018)

- **Fuente única del enlace**: `src/features/contact/whatsapp.ts`. **Ningún otro archivo
  compone una URL `wa.me`** (AC-5); si hace falta un enlace nuevo, se usa `whatsappHref()`.
- **Superficies**: header y footer del storefront (`app/(storefront)/layout.tsx`, montados en
  el layout para que estén en toda página pública) y la ficha de producto. El panel
  `/admin/*` **no lo lleva** a propósito: es la superficie privada del dueño (ADR-0010).
- **Forma canónica `wa.me`**, no `api.whatsapp.com`: es la que resuelve sola el desvío a la
  app móvil, a WhatsApp Web o a la de escritorio, sin ninguna detección de dispositivo.
- **Sin backend**: el contacto no hace ni una llamada de red, y un guard lo verifica espiando
  `globalThis.fetch` por debajo del cliente HTTP (`src/features/contact/noBackend.test.tsx`).
- ⚠ **Bloqueo de despliegue**: el default `5491100000000` es un **placeholder**. Publicar así
  ofrece un canal que no existe —el visitante escribe y nadie contesta—, que es peor que no
  ofrecerlo. El gate es `scripts/check-whatsapp-configured.mjs`, para enganchar al job de
  deploy (`Deferred: US-019`).

## Cuenta del cliente (US-014)

Cinco pantallas públicas, todas `noindex` — una pantalla de auth no le aporta
nada a un buscador:

| Ruta | Qué hace |
|---|---|
| `/crear-cuenta` | Alta con sesión activa inmediata, sin verificación de email |
| `/ingresar` | Login; respeta `?next=` **saneado a ruta relativa del mismo origen** |
| `/recuperar` | Solicita el link de recuperación |
| `/recuperar/confirmar` | Fija la contraseña nueva. **La ruta la fija el backend**: el mailer arma `${PASSWORD_RESET_URL_BASE}/recuperar/confirmar?token=…`, así que renombrarla rompe la recuperación en producción sin romper un solo test |
| `/mi-cuenta` | Destino de la sesión, detrás de `CustomerGuard` |

### Dos modelos de sesión que conviven

El panel usa **Bearer desde memoria** (ADR-0009) y el cliente usa **cookies**
que maneja el navegador. Conviven en un solo punto de red: el mutator acepta
`session: 'customer'`, y sin esa marca el camino del panel no cambia en nada.

Con la marca pasan tres cosas: la URL queda relativa, la llamada va con
`credentials: 'include'`, y **en servidor lanza**. Esto último no es celo: un
Server Component que renderizara contenido personalizado lo dejaría en la Data
Cache de Next, que se lo serviría después a otra persona.

### Por qué la sesión y el carrito viajan por el origen del sitio (ADR-0013)

Las cookies que emite el API son host-only y `up.railway.app` está en la Public
Suffix List, así que el navegador trata al sitio y al API como **sitios
distintos**: una cookie emitida por el API no vuelve nunca, y no hay `SameSite`
ni `Domain` que lo arregle. Por eso `next.config.mjs` reescribe `/v1/auth/*`
hacia `API_INTERNAL_ORIGIN` (server-only, sin `NEXT_PUBLIC_`) y el navegador ve
un solo origen. `e2e/auth-topology.spec.ts` lo prueba contra la app construida.

**Desde US-007 la variable gobierna DOS superficies same-origin**: `/v1/auth/*`
(sesión, cookies `dsm_session`/`dsm_csrf`) y `/v1/cart/*` (carrito del invitado,
cookies `dsm_cart`/`dsm_cart_csrf`). Consecuencia operativa: un deploy sin
`API_INTERNAL_ORIGIN` rompe **el login y el carrito**, y con el mismo síntoma
—404 en las rutas reescritas— que no dice nada sobre su causa. El arranque falla
ruidoso a propósito, con un mensaje que nombra las dos. `e2e/cart-topology.spec.ts`
cubre el carrito con el mismo método que el de auth.

### La marca `dsm.session`

Un booleano en `localStorage`, **no una credencial**: sólo evita que todo
visitante anónimo pague un `GET /auth/me` y un 401 por carga. Escribirla a mano
no da acceso a nada — el backend responde 401 y el estado cae a anónimo.

### Lo que el backend tiene que tener configurado

Este frontend **asume** tres cosas del lado del API, y las tres fallan de
formas que no se parecen a su causa:

- **`CORS_ALLOWED_ORIGINS` debe incluir el origen del storefront.** Si no,
  `/logout` y `/refresh` responden **403** porque el backend exige un `Origin`
  declarado en las escrituras autenticadas por cookie.
- **`PASSWORD_RESET_URL_BASE` debe apuntar al origen del storefront.** Si no, el
  link del email va a ninguna parte y la recuperación se rompe **sólo en
  producción**.
- **`AUTH_COOKIE_SECURE=true` fuera de local**, o las cookies de sesión viajan
  sin protección de transporte.

**API y web se despliegan juntas**: el contrato de sesión es compartido.

## Auth admin (seam, ADR-0009)

El panel obtiene un JWT `role=admin` vía una **página de acceso mínima**
(`/acceso`) que postea al seam del backend
(`POST /v1/admin/auth/login { bootstrapToken }`). El route group `(admin)` está
gated (UX); la autoridad es el guard server-side del backend. **US-014** endurece
la emisión (login real, cookie `httpOnly`, refresh rotado, 2FA) **sin reescribir**
el guard ni los servicios.

> Gap de integración conocido: el backend tiene el service
> (`AdminAuthService.loginWithBootstrap`) pero aún no expone el endpoint
> `POST /v1/admin/auth/login` — falta un controller (follow-up de backend).

## Estructura

- `app/(auth)/acceso` — acceso admin.
- `app/(admin)/{categorias,productos}` — panel (gated).
- `src/lib/http` — cliente HTTP centralizado + mapeo RFC 7807.
- `src/features/{auth,categories,products}` — servicios + pantallas.
- `src/components/ui` — componentes base del design-system.
