# @dsm/api — API de administración del catálogo (US-001)

Backend NestJS del panel del dueño: CRUD de categorías y productos, máquina de
estado (borrador → publicado → archivado), validación por campo (RFC 7807) y
guard RBAC admin (seam ADR-0009). Consume el esquema de `@dsm/db` (Prisma).

## Requisitos

- Node 22, pnpm 9.15.9 (ver raíz del monorepo).
- Postgres + pgvector vía `docker-compose` en la raíz (`make up`).
- Variables (validadas al arranque, fail-fast): `DATABASE_URL`, `JWT_SECRET`,
  `PORT` (opc.), `ADMIN_AUTH_ENABLED`, `ADMIN_BOOTSTRAP_TOKEN`.

## Correr

```bash
# desde la raíz del monorepo
make up                              # Postgres + Redis
pnpm --filter @dsm/db migrate        # aplica el esquema del catálogo
pnpm --filter @dsm/api start:dev     # arranca la API en :3000
```

## Testear

```bash
pnpm --filter @dsm/api test          # unit + integration + e2e-nest (serial, DB compartida)
pnpm --filter @dsm/api test -- <patrón>   # un archivo (p.ej. e2e-products-publish)
pnpm --filter @dsm/api lint
pnpm --filter @dsm/api typecheck
```

Los tests de integración/e2e usan el Postgres de `docker-compose` (misma imagen
pgvector) y hacen `TRUNCATE` entre casos; corren en serie (`maxWorkers: 1`).

## Endpoints (todos bajo `AdminGuard`, requieren JWT `role=admin`)

| Método | Ruta | AC |
|---|---|---|
| POST | `/v1/admin/categories` | AC-1 |
| GET | `/v1/admin/categories` | AC-1 |
| PATCH | `/v1/admin/categories/{id}` | AC-1 |
| POST | `/v1/admin/products` | AC-2, AC-5, AC-9 |
| GET | `/v1/admin/products` | listado paginado (NFR) |
| GET | `/v1/admin/products/{id}` | AC-3 |
| PATCH | `/v1/admin/products/{id}` | AC-3, AC-4, AC-6, AC-7 |
| GET | `/health` · `/ready` | liveness / readiness |

Contrato completo: [`docs/api/openapi.yaml`](./docs/api/openapi.yaml). Errores en
envelope RFC 7807 con `type` `dsm:catalog/*`.

## Auth (seam ADR-0009)

`AdminGuard` valida un JWT `role=admin` firmado con `JWT_SECRET`. La emisión
interina (`AdminAuthService`, detrás de `ADMIN_AUTH_ENABLED` +
`ADMIN_BOOTSTRAP_TOKEN`) es mínima; **US-014** la endurece (login, cookie
httpOnly, refresh rotado, rate-limit, 2FA) preservando el contrato `role=admin`
sin reescribir el guard.
