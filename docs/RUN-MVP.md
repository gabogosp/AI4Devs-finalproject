# Cómo correr el MVP localmente — Entrega 2

> **Entrega 2 — Código funcional (primer MVP ejecutable).** Este documento tiene los pasos
> **reales y verificados** para levantar el MVP en local y recorrerlo. (El quickstart del
> README raíz describe la topología completa *prevista*; esto es lo que corre hoy.)

## Qué incluye el MVP

Un **e-commerce navegable de punta a punta** para la ferretería/refrigeración:

- **Panel admin** (US-001): crear/editar productos y categorías, publicar/archivar.
- **Storefront público** (US-002 + US-003): navegación por categorías con SSR/SEO + ficha de
  producto indexable (JSON-LD, metadatos), con estados **con stock / sin stock / sin imagen** y
  **404** real para productos ocultos o inexistentes.
- **Búsqueda en lenguaje natural** (US-004 + US-005): caja de búsqueda que consulta el endpoint
  semántico (kNN sobre embeddings) con **fallback full-text**; descripciones **enriquecidas por IA**.
  *(La búsqueda semántica requiere `GEMINI_API_KEY`; sin ella degrada a full-text — igual funciona.)*
- **Registro / login / sesión de cliente** (US-014): cookies HttpOnly + refresh rotado + CSRF.
- **Carrito** (US-007): agregar/editar/quitar, badge en el top-nav, y **"Coordinar compra por
  WhatsApp"** como cierre (el checkout con pago llega en la próxima entrega).
- **Import masivo** de inventario CSV/Excel (US-006) + **CTA WhatsApp** en toda página (US-018) +
  **páginas legales + consentimiento** (US-017).

**Roadmap (planeado, no en esta entrega):** checkout guest (US-008), pago MercadoPago (US-009),
webhook + orden + stock (US-010), infra cloud (US-019). Sus planes viven en `openspec/changes/`.

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
# En http local la cookie de sesión/carrito NO puede ser Secure (no volvería al
# browser → el carrito se vería siempre vacío). En producción (https) va en true.
AUTH_COOKIE_SECURE=false
ENV

# 4. Generar el cliente Prisma (tipos Customer/Cart/… que consume la API)
pnpm --filter @dsm/db exec prisma generate

# 5. Esquema + datos de demo (3 productos publicados + 1 draft)
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

## Correr la suite de QA (aceptación, E2E, carga)

La suite necesita una API **apta para QA**, que no es la misma que la de la demo: con los
valores de producción la mayoría de los escenarios falla **por el entorno y con síntomas que
parecen defectos del producto**. Hay un script que la levanta con todo puesto:

```bash
# 1. API para QA (deja la de la demo en 3000 intacta)
pnpm --filter @dsm/qa api:up                    # queda en http://localhost:3009

# 2. Suites, apuntadas a esa API
QA_API_BASE_URL=http://localhost:3009 pnpm --filter @dsm/qa test:acceptance
QA_API_BASE_URL=http://localhost:3009 pnpm --filter @dsm/qa test:load:cart
```

Qué corrige cada variable del script, con el síntoma que produce su ausencia:

| Variable | Sin ella |
|---|---|
| `CORS_ALLOWED_ORIGINS` con el origen del web | La **primera** escritura del carrito pasa y la **segunda** muere en 403: los escenarios acusan asserts de negocio («la línea quitada sigue en el carrito») cuando el carrito está perfecto. |
| `AUTH_RATE_LIMIT_MAX` elevado | Cada escenario hace un login admin **real**; con 5 cada 15 minutos, la suite se autobloquea con 429 en el sexto. |
| `CART_*_RATE_LIMIT_MAX` elevado | El carrito de producción admite 30 escrituras/min/IP: la suite y el k6 lo superan de inmediato. En la carga, además, el p95 medido sería el del throttler. |
| `AUTH_COOKIE_SECURE=false` | En `http` local una cookie `Secure` no vuelve al cliente, así que cada escritura crearía un carrito nuevo. |
| `IMPORT_RATE_LIMIT_MAX` elevado | US-006: el import admite 3 POST/hora/IP en producción; 20 de los 24 casos de `@importar` hacen un POST, así que la suite se autoenvenenaría a la cuarta corrida. El límite real igual se prueba — TC-613 lo baja por su propia variable de proceso, sólo para ese escenario. |

Los puertos del cliente QA salen de `qa/support/qa-env.ts` (**una** fuente: API 3000, web
3200) y la suite **verifica el entorno antes del primer escenario**: si la API no está o no
admite su `Origin`, falla con un mensaje que dice qué levantar en lugar de dejar que reviente
más tarde como un problema de dominio.

### US-006 — Importación masiva de inventario

```bash
QA_API_BASE_URL=http://localhost:3009 pnpm --filter @dsm/qa test:acceptance:import   # 16 casos, API-level
QA_API_BASE_URL=http://localhost:3009 pnpm --filter @dsm/qa test:throughput:import   # TC-622, sin navegador
# test:e2e:import y test:a11y:import (TC-617..TC-621) necesitan además el web apuntando
# a esa misma API — ver el defecto de CORS abierto abajo antes de correrlos.
```

**Defecto abierto (bloquea TC-617/618/619/620/621 parcial)**: el frontend manda el header
`idempotency-key` en cada `POST /v1/admin/imports` (`importsService.ts`, `api-standards` §10),
pero `CORS_ALLOWED_ORIGINS`/`allowedHeaders` de `bootstrap.ts` no lo incluye — el preflight del
navegador lo rechaza y el import es **inalcanzable desde cualquier browser real**, aunque
`curl`/Node (sin CORS) funcionen perfecto. Ningún test dev-owned (RTL+MSW, sin CORS real) ni
`curl` lo detecta — sólo un E2E de navegador contra el stack real. Fix: agregar
`'Idempotency-Key'` a `allowedHeaders` en `apps/api/src/bootstrap.ts`.

## Recorrido de demo (lo que se ve)

1. **Storefront** → home → categoría **Refrigeración** → lista de productos publicados.
2. **Búsqueda** → caja del top-nav → *"compresor"* / *"refrigerante"* / *"cable"* → resultados
   rankeados (semántico con `GEMINI_API_KEY`, full-text sin ella). *(Con el seed de demo, buscar
   términos que existen: compresor, gas/refrigerante, taladro, cable — no "heladera".)*
3. **Ficha con stock** → `/productos/compresor-1-4-hp` → nombre, precio ARS, categoría, descripción
   (enriquecida por IA si hubo enrichment), **agregar al carrito** + **WhatsApp**. "Ver código
   fuente" → metadatos + JSON-LD `schema.org/Product`.
4. **Carrito** → agregar varios → badge en el top-nav → `/carrito` → editar cantidades → **"Coordinar
   compra por WhatsApp"**.
5. **Registro / login** → `/ingresar` → crear cuenta / iniciar sesión (sesión con cookie HttpOnly).
6. **Ficha SIN stock** → `/productos/taladro-percutor-650w` (AC-4) · **sin imagen** → placeholder (AC-6)
   · **404 real** → `/productos/cable-unipolar-2-5mm-x100m` (draft) o slug inexistente.
7. **Panel admin** → `/admin/acceso` → `ADMIN_BOOTSTRAP_TOKEN` → gestionar/publicar productos (loop completo).

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
