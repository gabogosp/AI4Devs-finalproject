#!/usr/bin/env bash
#
# Levanta una API **apta para correr la suite QA** y la deja en foreground.
#
# No es un atajo cómodo: cada variable de acá corrige un modo de fallo que ya nos
# costó tiempo, y con la API arrancada con valores de producción la suite falla de
# formas que parecen defectos del producto.
#
#   CORS_ALLOWED_ORIGINS   el cliente QA escribe con `Origin` del web; sin él la
#                          PRIMERA escritura del carrito pasa y la SEGUNDA muere en
#                          403 → cinco escenarios acusando asserts de negocio.
#   AUTH_RATE_LIMIT_MAX    cada escenario hace un login admin REAL; el presupuesto
#                          de producción (5 / 15 min) autobloquea la suite al sexto.
#   CART_*_RATE_LIMIT_MAX  el carrito de producción admite 30 escrituras/min/IP;
#                          una suite —y el k6— lo superan de inmediato.
#   AUTH_COOKIE_SECURE     en http local, una cookie `Secure` no vuelve al cliente.
#
# Uso:
#   pnpm --filter @dsm/qa api:up                    # puerto 3009
#   QA_API_PORT=4000 pnpm --filter @dsm/qa api:up   # otro puerto
#
# Deliberadamente NO usa el 3000: ahí suele estar la API de desarrollo de otra
# sesión, y reiniciarla para correr tests le rompe el trabajo a alguien.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PUERTO="${QA_API_PORT:-3009}"
WEB_ORIGIN="${QA_WEB_BASE_URL:-http://localhost:3200}"
MAIN="$RAIZ/apps/api/dist/apps/api/src/main.js"

if [[ ! -f "$MAIN" ]]; then
  echo "No existe $MAIN — compilá primero: pnpm --filter @dsm/api build" >&2
  exit 1
fi

echo "API para QA en http://localhost:$PUERTO  (origen permitido: $WEB_ORIGIN)"
echo "Apuntá la suite con: QA_API_BASE_URL=http://localhost:$PUERTO"

cd "$RAIZ"
exec env \
  PORT="$PUERTO" \
  CORS_ALLOWED_ORIGINS="$WEB_ORIGIN" \
  AUTH_COOKIE_SECURE=false \
  AUTH_RATE_LIMIT_MAX=100000 \
  CART_RATE_LIMIT_MAX=100000 \
  CART_WRITE_RATE_LIMIT_MAX=100000 \
  STOREFRONT_RATE_LIMIT_MAX=100000 \
  node "$MAIN"
