# Charters exploratorios — US-010 Webhook de MercadoPago, medio simulado y stock

> Exploración con **tiempo acotado**, no scripts (`qa-plan.md` §10, `QA-010-EXP-1`,
> `execution_mode: manual`). Lo que se busca es lo que la suite automatizada
> (aceptación/contract/k6/E2E) no puede afirmar: cómo se COMUNICA una decisión de
> negocio a un operador humano cuando las cosas salen mal — un rechazo correcto pero
> incomprensible en los logs es tan costoso en producción como un bug. Los hallazgos
> se registran acá abajo, con fecha.

## Charter: ventana de tolerancia de la firma · 30 min

**Riesgo que explora**: `MP_WEBHOOK_TOLERANCE_SEC` (300s por default) separa "firma
inválida por secreto equivocado" de "firma inválida por reloj desincronizado" — dos
causas muy distintas (una es un ataque, la otra es infraestructura) que hoy responden
con el MISMO 401 `dsm:payments/webhook-unverified` (AC-7, `SC-010-N1` ya prueba que las
tres variantes responden 401; este charter explora qué ve un OPERADOR después de ese
401, no el código de estado en sí).

Recorrido sugerido:

1. Reproducir un webhook firmado correctamente con `ts` apenas DENTRO del límite
   (299s) y otro apenas FUERA (301s). Comparar ambas respuestas — ¿son
   indistinguibles para un cliente HTTP?
2. Mirar el log de la API (`LOG_LEVEL=debug`) para cada uno de los tres casos de
   `SC-010-N1` (secreto equivocado / header ausente / fuera de ventana): ¿el mensaje
   distingue los tres casos de forma útil para un operador que debuggea un webhook que
   dejó de confirmar pagos, sin llegar a filtrar `MP_WEBHOOK_SECRET`?
3. Si un proveedor de infraestructura desincroniza el reloj del servidor unos minutos
   (escenario real, no hipotético), ¿cuánto tiempo pasaría hasta que alguien note que
   TODOS los webhooks empiezan a rechazarse? ¿Hay algo en los logs que lo delate rápido
   frente a "alguien está atacando con secretos falsos"?

**Hallazgos** · _(pendiente de ejecución)_

## Charter: reconciliación con muchas órdenes elegibles a la vez · 30 min

**Riesgo que explora**: `SC-010-C4` prueba el camino de CERO órdenes elegibles; el
corte real (`RECONCILE_BATCH_SIZE=50`) sólo importa cuando hay MÁS candidatas que el
batch — ese caso no tiene automatización (correr un batch parcial no cambia ningún
código de estado HTTP, sólo dice cuánto trabajo quedó pendiente).

Recorrido sugerido:

1. Sembrar más de 50 órdenes `pending_payment` backdateadas más allá de
   `RECONCILE_MIN_AGE_MS` (mismo helper que `SC-010-C4`, `qa/support/backdate-order.ts`)
   y correr `POST /admin/payments/reconcile` una sola vez.
2. Leer el resumen (`scanned/confirmed/stillPending`): ¿comunica con claridad que
   quedó trabajo pendiente para la PRÓXIMA corrida del cron externo, o parece que
   "terminó" cuando en realidad cortó en el límite del batch?
3. Correr el mismo endpoint una segunda vez inmediatamente: ¿el segundo `scanned`
   refleja el remanente, o hay algo (orden de `listByStatus`, por ejemplo) que haga que
   las mismas órdenes viejas queden siempre al final de la cola y nunca se procesen?
4. Ponerse en el lugar de quien configura el cron externo (Railway/GitHub Actions,
   `design.md` §D8): ¿la frecuencia razonable del cron alcanza para vaciar un backlog
   de 50+ órdenes en un tiempo aceptable, o hace falta subir `RECONCILE_BATCH_SIZE`?

**Hallazgos** · _(pendiente de ejecución)_

## Charter: comportamiento del circuit-breaker durante retry-refunds · 30 min

**Riesgo que explora**: `SC-010-N6` prueba el camino de CERO pagos `refund_pending`;
el comportamiento real del breaker (`backoff.ts`, T4.2 del backend) ante varios fallos
consecutivos de `MercadoPagoClient.refund` durante una corrida con VARIOS pagos
pendientes no tiene automatización posible sin cuenta sandbox (mismo bloqueo que
`design.md` §D-QA1) — pero SÍ se puede explorar mockeando el cliente HTTP a nivel de
red local (sin llamar a MercadoPago real), reusando el mismo doble que
`confirm-order.service.provider.spec.ts` ya usa dev-owned.

Recorrido sugerido:

1. Sembrar 3-4 pagos `refund_pending` (vía Prisma directo, mismo tipo de excepción
   angosta que `backdate-order.ts` — sólo para alcanzar la precondición) y hacer que el
   cliente de MercadoPago falle consistentemente (mock de red local, nunca la cuenta
   real) durante `POST /admin/payments/retry-refunds`.
2. Observar el resumen (`attempted/succeeded/failed`): cuando el breaker se abre a
   mitad de la corrida, ¿el resto de los pagos queda `refund_pending` intacto, o algún
   camino los marca erróneamente como intentados/fallidos definitivos?
3. Leer el log: ¿un operador que ve `refund_pending` estancado por varias corridas
   seguidas puede distinguir "el breaker está abierto, reintentá más tarde" de
   "MercadoPago está devolviendo error de negocio, revisá el pago a mano"? Confundir
   los dos casos hace perder tiempo de soporte en el camino equivocado.
4. ¿Hay algún indicio (log, métrica) de CUÁNTO tiempo lleva un pago en
   `refund_pending`? Es plata de un cliente esperando — sin esa señal, un pago puede
   quedar invisible durante días.

**Hallazgos** · _(pendiente de ejecución)_

---

> Los tres charters son **manuales a propósito** (`execution_mode: manual`,
> `QA-010-EXP-1` en `qa-plan.md` §5/§10): lo que exploran es JUICIO humano sobre
> claridad operativa y comportamiento bajo fallas parciales — automatizarlos
> costaría más que el valor que dan, y ninguno de los tres necesita la cuenta sandbox
> de MercadoPago que sí bloquea `SC-010-N2` (design.md §D-QA1).
