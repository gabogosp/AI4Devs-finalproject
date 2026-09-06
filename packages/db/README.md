# @dsm/db

Paquete del esquema Prisma — única fuente de verdad del modelo de datos (se completa en Fase 4 de este change).

## Seeds

Ambos son idempotentes (upsert por clave natural — slug de categoría, sku de producto):
correrlos de nuevo no duplica ni falla, y no colisionan entre sí (SKUs distintos).

- `pnpm --filter @dsm/db seed` — seed canónico: 3 categorías, 4 productos (uno sin
  stock, uno en borrador) + cuenta admin si `ADMIN_SEED_EMAIL`/`ADMIN_SEED_PASSWORD`
  están seteadas. Es el mínimo que las suites y los smoke tests asumen presente.
- `pnpm --filter @dsm/db seed:demo-rich` — catálogo "rico" para la fase de prueba
  visual/local: 8 categorías, 100 productos con variedad real (precio, stock
  0/bajo/alto, published/draft, nombres que pegan con términos de búsqueda comunes
  del rubro). Pensado para ejercitar búsqueda, filtro por categoría, paginación y
  los estados de la ficha mucho mejor que los 4 productos del seed canónico.
  Corré primero `seed`, después `seed:demo-rich` (comparten las categorías base).
