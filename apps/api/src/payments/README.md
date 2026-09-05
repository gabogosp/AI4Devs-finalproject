# Payments (US-023 + US-010)

`ConfirmOrderService.confirm()` es el único punto de confirmación de pago del
sistema. US-023 lo construyó para `provider: 'manual'` (el dueño confirma a
mano desde el panel admin); US-010 lo amplía con `provider: 'mercadopago' |
'simulated_dsm'`, sin tocar una línea de la rama `manual` — es lo que vuelve
AC-9 ("el medio simulado pasa por el mismo camino") estructural y no una
promesa: hay un solo método, con ramas que sólo corren para cada provider.

## Qué reusa de US-023 tal cual

`payment-confirmation.port.ts` (ampliado a unión discriminada, sin renombrar
el literal `provider: 'manual'`), `payments.repository.ts` (gana
`createApprovedPayment`/`createRefundPendingPayment`/`markRefunded`/
`listRefundPending` al lado de `createManualPayment`, sin tocarlo),
`orders.repository.ts` (gana `transitionToCancelledIfPending`/
`cancelAbandonedPending`, y `confirmed_at` en el `data` de
`transitionToNewIfPending`, sin cambiar su firma), `stock.repository.ts`
(sin ningún cambio) y `PaymentsEventsService` (los dos eventos existentes,
`payments.manual_confirmed`/`_rejected`, intactos).

## Qué es nuevo (US-010)

El webhook de MercadoPago (`webhooks/mercadopago-webhook.controller.ts`),
el medio simulado (`simulate-payment.controller.ts`), el cliente HTTP
(`mercadopago/mercadopago-client.ts`) y los tres jobs admin
(`admin-jobs.controller.ts`: reconciliación, limpieza de abandonadas,
reintento de reembolsos) — ninguno existía antes de este change.

## Por qué `MercadoPagoClient` no tiene `createPreference`

La versión anterior de este plan asumía que US-009 construía el cliente
completo (incluyendo `createPreference`, la operación que redirige al
comprador a Checkout Pro) y que este change sólo le agregaba `getPayment`/
`refund`. Esa cadena nunca se materializó: US-009 sigue bloqueada (sin
credenciales de MercadoPago) y el cliente no existía en el repo. Este change
invierte la dependencia y construye el cliente con el alcance mínimo que
sus propias AC necesitan — `getPayment`, `searchByExternalReference` y
`refund` — porque son operaciones de **lectura y reembolso**, verificables
hoy con un `fetch` mockeado contra el contrato documentado de MercadoPago,
sin necesitar la cuenta real.

`createPreference` sigue siendo responsabilidad de **US-009**, cuando esa US
se retome con credenciales reales: en ese momento extiende este mismo
cliente (el mismo archivo, el mismo patrón de timeout/retry/breaker) en vez
de crear uno paralelo. Hasta entonces, el flujo de "iniciar un pago real"
(`POST /v1/payments`) no existe — sólo el de confirmarlo una vez que MP lo
aprobó (este change) y el de simularlo sin MercadoPago (`simulate-payment`).

## Hoy con mocks vs. necesita cuenta real de MercadoPago

| Pieza | Construible y testeable HOY (mocks) | Necesita cuenta MP real |
|---|---|---|
| `getPayment`/`searchByExternalReference`/`refund` (transporte, timeout, retry, mapeo de errores) | ✅ | — |
| Verificación de firma (`webhook-signature.ts`) | ✅ (función pura) | — |
| `ConfirmOrderService` para `mercadopago`/`simulated_dsm` | ✅ (integración con Postgres real + cliente mockeado) | — |
| `POST /v1/checkout/simulate-payment` (AC-9 real, no sólo estructural) | ✅ — nunca llama a MercadoPago | — |
| Reconciliación (AC-10) | ✅ con mock del cliente | Sólo el smoke test en vivo de staging |
| Tráfico real de producción (`POST /v1/webhooks/mercadopago` recibiendo un webhook real) | — | ✅ cuenta MP + `MP_ACCESS_TOKEN`/`MP_WEBHOOK_SECRET` + webhook URL en el dashboard |
| `POST /v1/payments` (crear preferencia, redirigir al comprador) | — | ✅ (US-009) |

Todo el código, los tests unitarios, los de integración con Postgres real y
los del medio simulado se construyen y verifican en este change, hoy. Lo
único detrás de un gate real es el tráfico **en vivo** contra MercadoPago.

## Qué NO hace este módulo

- No crea preferencias de pago ni redirige al comprador a Checkout Pro —
  US-009.
- No envía el email/notificación real — US-011 (`NotificationPort` sólo
  garantiza que el trigger se invoca en el momento correcto).
- No corre un scheduler in-process — los tres jobs admin los dispara un
  cron externo (Railway/GitHub Actions), no código de `apps/api`
  (ADR-0012/0014).
