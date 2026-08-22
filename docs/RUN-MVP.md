# Cómo correr el MVP localmente — Entrega 2

> **Entrega 2 — Código funcional (primer MVP ejecutable).** Este documento tiene los pasos
> **reales y verificados** para levantar el MVP en local y recorrerlo. (El quickstart del
> README raíz describe la topología completa *prevista*; esto es lo que corre hoy.)

## Qué incluye el MVP

Un **catálogo navegable de punta a punta** para la ferretería/refrigeración:

- **Panel admin** (US-001): crear/editar productos y categorías, publicar/archivar.
- **Storefront público** (US-002 + US-003): navegación por categorías con SSR/SEO + ficha de
  producto indexable (JSON-LD, metadatos), con estados **con stock / sin stock / sin imagen** y
  **404** real para productos ocultos o inexistentes.
- **CTA "Consultar por WhatsApp"** en la ficha (US-018 Fase 1): el camino de compra del MVP
  (todavía sin carrito).

**Fuera del MVP (próximos 10 días):** login/registro de cliente (US-014 FE), carrito y checkout
(US-007+), búsqueda IA (US-004/005), import masivo (US-006), infra cloud (US-019).

## Requisitos

- Node 20+ (el repo corre en 23 con un WARN de engine, no fatal), `pnpm`, Docker + Docker Compose.

## Pasos

```bash
# 1. Dependencias
pnpm install

# 2. Postgres (pgvector) + Redis
docker compose up -d

# 3. Variables de entorno (crear .env en la raíz)
cat > .env <<'ENV'
DATABASE_URL=postgresql://dsm:dsm@localhost:55432/dsm?schema=public
JWT_SECRET=dev-secret-cambiar
ADMIN_BOOTSTRAP_TOKEN=demo-admin-token
CORS_ALLOWED_ORIGINS=http://localhost:3200
ENV

# 4. Esquema + datos de demo (3 productos publicados + 1 draft)
pnpm --filter @dsm/db exec prisma migrate deploy
pnpm --filter @dsm/db seed

# 5. Build de producción (verifica que es "ejecutable")
pnpm --filter @dsm/api build
pnpm --filter @dsm/web build

# 6a. Levantar la API (puerto 3000) — nest build deja el output anidado:
node apps/api/dist/apps/api/src/main.js
#    → en otra terminal:
# 6b. Levantar el storefront (puerto 3200)
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000 PORT=3200 pnpm --filter @dsm/web start
```

> **Puertos:** la API usa 3000 y el web 3200. Evitamos 3100 porque suele estar ocupado por
> contenedores de otros proyectos (p.ej. un Loki). Si el 3000 ya tiene la API corriendo, saltá 6a.
>
> **CORS:** el storefront es SSR (los fetch salen del server, sin CORS). Si vas a usar el **panel
> admin** (llamadas desde el browser), arrancá la API con `CORS_ALLOWED_ORIGINS=http://localhost:3200`.
>
> Alternativa rápida en modo dev (sin build): `pnpm --filter @dsm/api start:dev` y
> `NEXT_PUBLIC_API_BASE_URL=http://localhost:3000 PORT=3200 pnpm --filter @dsm/web dev`.

## URLs

| Superficie | URL |
|---|---|
| Storefront (home) | http://localhost:3200 |
| Ficha de producto | http://localhost:3200/productos/compresor-1-4-hp |
| Navegación por categoría | http://localhost:3200/categorias/refrigeracion |
| Panel admin (login) | http://localhost:3200/admin/acceso |
| API | http://localhost:3000/v1/products/compresor-1-4-hp |

## Recorrido de demo (lo que se ve)

1. **Storefront** → home → categoría **Refrigeración** → lista de productos publicados.
2. **Ficha con stock** → `/productos/compresor-1-4-hp` → nombre, precio ARS, categoría, **botón
   "Consultar por WhatsApp"**. "Ver código fuente" → metadatos + JSON-LD `schema.org/Product`.
3. **Ficha SIN stock** → `/productos/taladro-percutor-650w` → visible pero marcada sin stock (AC-4).
4. **Sin imagen** → cualquiera de los sembrados → placeholder del FE (AC-6).
5. **404 real** → `/productos/cable-unipolar-2-5mm-x100m` (está en `draft`) o un slug inexistente.
6. **Panel admin** → `/admin/acceso` → ingresar el `ADMIN_BOOTSTRAP_TOKEN` → gestionar productos;
   podés **publicar** el producto draft y verlo aparecer en el storefront (el loop completo).

## Datos sembrados

| SKU | Slug | Estado | Stock |
|---|---|---|---|
| REF-001 | compresor-1-4-hp | published | 12 |
| REF-002 | gas-refrigerante-r134a-1kg | published | 30 |
| FER-001 | taladro-percutor-650w | published | **0** (sin stock) |
| ELE-001 | cable-unipolar-2-5mm-x100m | **draft** (→ 404) | 20 |

## Estado de calidad (verificado)

- Tests: **499** (API) + **233** (web) verdes.
- `pnpm --filter @dsm/api build` y `pnpm --filter @dsm/web build`: OK.
- `pnpm -r lint && pnpm -r typecheck`: limpio.
