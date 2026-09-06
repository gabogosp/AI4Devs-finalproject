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
#   LOG_LEVEL              el token de recuperación se escribe en `debug` (es el único
#                          canal: la tabla guarda sólo el hash). Con el default `info` la
#                          línea no se emite y el flujo de recuperación no se puede
#                          verificar ni a mano.
#   TRUST_PROXY_HOPS       el rate-limit cuenta por IP y en producción el default es 0
#                          (no confiar en `X-Forwarded-For`, o cualquiera evade el límite).
#                          En QA se pone en 1 para que cada escenario pueda hablar desde su
#                          propia IP: sin esto TODOS comparten un cubo, el contador se agota
#                          y no se puede registrar ni una cuenta — con la ventana de 15 min,
#                          la suite queda bloqueada aunque `AUTH_RATE_LIMIT_MAX` esté alto.
#                          Mismo mecanismo que usa `apps/api/test/e2e-app.ts` y por el mismo
#                          motivo.
#   IMPORT_RATE_LIMIT_MAX  US-006: 20 de los 24 casos de `@importar` hacen un POST; el
#                          presupuesto de producción (3/hora/IP) autoenvenenaría la suite a
#                          la cuarta corrida. El límite real IGUAL se prueba — TC-613 lo baja
#                          por su propia variable de proceso, sólo para ese escenario — así
#                          que elevarlo acá no deja el límite sin cobertura en ningún lado.
#   PAYMENTS_SIMULATE_RATE_LIMIT_MAX  US-010 (`@us-010`): `pago-webhook.feature` hace
#                          VARIAS confirmaciones reales por `POST /v1/checkout/simulate-payment`
#                          por escenario (SC-010-H1/H2/N3/N4 una c/u, SC-010-C1 dos
#                          concurrentes sobre la misma orden, SC-010-C2 tres concurrentes
#                          sobre órdenes distintas) — el presupuesto de producción
#                          (`PAYMENTS_SIMULATE_RATE_LIMIT_MAX=10` cada 10 min, por IP) se
#                          agota a mitad de la suite de aceptación y el resto ve 429 en vez
#                          del 200/409 que el escenario realmente prueba (visto en la
#                          primera corrida: SC-010-C1/C2 con `[429,429]`/0 éxitos). El
#                          límite real sigue cubierto dev-owned
#                          (`simulate-payment.controller.spec.ts`), sin cambios por elevarlo acá.
#   CHECKOUT_RATE_LIMIT_MAX  US-023 (`@pagos`): cada escenario de `pago-manual.feature` siembra
#                          su propia orden `pending_payment` vía `POST /v1/checkout` real (nunca
#                          INSERT directo) — 10+ checkouts en una sola corrida de la suite de
#                          aceptación. El presupuesto de producción (10, `CHECKOUT_RATE_LIMIT_MAX`
#                          default) se agota antes de terminar y el resto de los escenarios ve un
#                          429 que no tiene nada que ver con el guard de idempotencia que están
#                          probando (`qa/support/seed-pending-payment-order.ts`). Mismo motivo en
#                          US-012: `seed-ordenes.ts` hace UN checkout real por orden sembrada, y
#                          casi todos los escenarios de `ordenes.feature` siembran al menos una —
#                          el mismo presupuesto de producción autobloquea esa suite a partir del
#                          tercer o cuarto escenario. Mismo criterio que `AUTH_RATE_LIMIT_MAX`: el
#                          límite real se sigue probando en la capa que sí lo ejercita (dev-owned,
#                          `e2e-checkout-ratelimit.spec.ts`).
#   ORDER_RETENTION_SWEEP_RATE_LIMIT_MAX  US-021 (`@retencion-ordenes`): el presupuesto de
#                          producción es angosto a propósito (5/hora, `orders-retention.controller.ts`)
#                          para que un disparador externo mal configurado no pueda convertirlo en
#                          carga recurrente. Pero la suite de aceptación llama
#                          `POST retention-sweep` al menos 4 veces por corrida completa (SC-021-H1,
#                          H2, N1, N4×2) — y cada re-corrida de la suite durante el desarrollo de
#                          los tests suma sobre el mismo contador en memoria del proceso, agotando
#                          el budget real antes de terminar. El límite real igual se prueba
#                          (dev-owned, `orders-retention.controller.spec.ts` T4.2).
#   ORDER_ANONYMIZE_RATE_LIMIT_MAX  Mismo motivo, para `POST :id/anonymize` (30/min default —
#                          más holgado, pero varios escenarios llaman este endpoint dos y tres
#                          veces por idempotencia, y se acumula entre corridas de la suite).
#   ENRICHMENT_ENABLED     US-005 (QA-005-F1, hallazgo de higiene de entorno): `ai.providers.ts`
#                          sólo mira si `GEMINI_API_KEY` está *presente*, no si es *válida* —
#                          con el placeholder de `.env` ("replace-me"), la instancia arranca
#                          igual con `GeminiHttpClient` real. Como el enriquecimiento se
#                          dispara solo tras cada import (`EnrichmentQueue.enqueue` →
#                          `setImmediate`, US-006), CUALQUIER sesión que corra
#                          `importar.feature`/`seed-import.ts` contra esta instancia
#                          compartida dispara, sin que nadie lo pida, llamadas HTTP reales a
#                          Google con una clave inválida — quemando `enrichment_attempts`/
#                          `enrichment_error_code` sobre productos reales de OTRAS sesiones.
#                          Se fija en `false` acá: la instancia larga y compartida NUNCA llama
#                          a Gemini. Los escenarios que sí necesitan el proveedor "encendido"
#                          (`SC-005-C1/C2/C4/N4/N5`) levantan su propia instancia temporal vía
#                          `qa/support/spawn-api.ts` (`design.md` §D-QA4), nunca esta.
#   ENRICHMENT_RATE_LIMIT_MAX  Mismo criterio que el resto de los `*_RATE_LIMIT_MAX` de este
#                          archivo: se eleva por consistencia, aunque con `ENRICHMENT_ENABLED=
#                          false` casi ningún escenario de esta instancia compartida llama
#                          `POST /runs` (y `GET /status` no consume este presupuesto).
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
  TRUST_PROXY_HOPS=1 \
  LOG_LEVEL=debug \
  AUTH_RATE_LIMIT_MAX=100000 \
  CART_RATE_LIMIT_MAX=100000 \
  CART_WRITE_RATE_LIMIT_MAX=100000 \
  STOREFRONT_RATE_LIMIT_MAX=100000 \
  IMPORT_RATE_LIMIT_MAX=100000 \
  CHECKOUT_RATE_LIMIT_MAX=100000 \
  PAYMENTS_SIMULATE_RATE_LIMIT_MAX=100000 \
  ORDER_RETENTION_SWEEP_RATE_LIMIT_MAX=100000 \
  ORDER_ANONYMIZE_RATE_LIMIT_MAX=100000 \
  ENRICHMENT_ENABLED=false \
  ENRICHMENT_RATE_LIMIT_MAX=100000 \
  node "$MAIN"
