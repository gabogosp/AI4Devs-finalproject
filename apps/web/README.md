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
| Storefront (público, indexable) | `/` (home mínima; la real es US-002), `/productos/{slug}` (ficha) |
| Panel del dueño (privado, `noindex`) | `/admin/acceso`, `/admin/productos`, `/admin/productos/nuevo`, `/admin/productos/{id}`, `/admin/categorias` |

El panel responde con `X-Robots-Tag: noindex, nofollow` sobre `/admin/:path*`.
Es defensa en profundidad contra indexación, **no** control de acceso: eso lo
siguen haciendo el `AdminGuard` en el cliente y el backend en el servidor.

> **Cuidado al agregar rutas públicas**: un `loading.tsx` en un segmento cuyo
> 404 deba ser real hace que Next transmita el shell con status 200, y el
> `notFound()` posterior ya no puede cambiarlo (queda un soft-200 indexable).
> Ver `design.md` D1.bis del change de US-003.

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
