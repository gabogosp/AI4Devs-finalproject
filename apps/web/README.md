# @dsm/web — Panel del dueño (Next.js)

Frontend del panel de administración del catálogo (US-001): categorías y
productos, alta/edición, publicar/archivar, con RBAC admin. Consume la API
`/v1/admin/*` del backend (`@dsm/api`).

## Requisitos

- Node 22, pnpm 9.15.9 (raíz del monorepo).
- Backend `@dsm/api` corriendo (o mockeado en tests).

## Variables de entorno

- `NEXT_PUBLIC_API_BASE_URL` — base URL de la API de administración
  (default `http://localhost:3000`). Validada al arranque con Zod. **Sin
  secretos server-only con prefijo `NEXT_PUBLIC_`.**
- `NEXT_PUBLIC_SENTRY_DSN` — (opcional) habilita observabilidad.

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
