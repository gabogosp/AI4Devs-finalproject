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
