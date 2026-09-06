---
tracker-id: null
tracker-source: null
parent-us: US-021
discipline: backend
variant: null
language: es
archived: true
archived_at: 2026-09-05
merged_commit: c9bb229
pr-url: https://github.com/gabogosp/AI4Devs-finalproject/pull/41
---

# US-021 Backend — Retención y anonimización de PII de órdenes (Ley 25.326)

## Why

El PRD §6 fija la política desde el principio: «historial de órdenes: se conserva
hasta 12 meses», y el E2E §8 la traduce en datos concretos — «órdenes no se borran
(historial 12 meses, métricas)» y «job mensual que purga/anonimiza órdenes > 12
meses». Ninguna US la implementaba. US-020 cubre el borrado de **cuentas
registradas**; el comprador **invitado** de US-008 —el camino principal del PRD
§2.1 cap. 4— no tiene cuenta que borrar. Su nombre, email y teléfono quedan en
`orders` (la primera PII en reposo del proyecto, según el propio plan de backend de
US-008) sin ningún mecanismo de supresión. Eso es exposición legal bajo la Ley
25.326, no deuda técnica cosmética: es la razón por la que el PO abrió esta US como
condición previa a producción al resolver `OQ-BE-5` de US-008 (2026-08-22).

La restricción que gobierna todo el diseño es que **el historial comercial no se
puede perder**: US-016 construye el panel de métricas del dueño sobre las mismas
filas de `orders`, y el E2E es explícito en que las órdenes no se borran. La
respuesta, entonces, es **anonimizar, no borrar**: reemplazar sólo los tres campos
de contacto del comprador por un valor fijo, no reversible, y dejar intactos los
ítems, los importes, el estado, las fechas y — crítico para AC-7 — el registro de
consentimiento (`consent_accepted` + `consent_accepted_at` +
`consent_terms_version`), que es la prueba de que la compra fue consentida y no
puede desaparecer junto con el nombre del comprador.

Este change entrega los dos disparadores que la US pide (AC-1 automático por
plazo, AC-3 a pedido del comprador vía el dueño), la marca de auditoría que los
distingue (AC-4), la idempotencia estructural que impide un doble efecto o un
error al reprocesar (AC-8), y la autorización que limita el disparo a pedido al
dueño autenticado (AC-9). No construye el panel de órdenes (US-012, todavía sin
change de backend) ni el flujo de exportación de datos (otro derecho de la Ley
25.326, fuera de alcance por US §4).

## What changes

- **Migración aditiva sobre `orders`**: dos columnas nuevas, `anonymized_at`
  (`TIMESTAMP NULL`) y `anonymization_reason` (`TEXT NULL`, `CHECK` cerrado a
  `'retention_policy' | 'requested'`), más un `CHECK` de consistencia
  (`anonymized_at IS NULL ⇔ anonymization_reason IS NULL`). Ninguna columna
  existente cambia de tipo ni se borra.
- **`OrdersRepository` (checkout/) gana dos escrituras y una lectura**:
  `findById`, `anonymize(id, reason)` (guardado por `WHERE anonymized_at IS NULL`
  — atómico, sin efecto en una segunda llamada) y
  `anonymizeRetentionEligible(cutoff, reason)` (un único `UPDATE` de conjunto
  sobre todas las órdenes vencidas, sin bucle por fila).
- **`POST /v1/admin/orders/:id/anonymize`** — acción a pedido (AC-3), gateada por
  `AdminGuard` (AC-9) y `AuthThrottlerGuard`. Idempotente por construcción: sobre
  una orden ya anonimizada responde 200 con los mismos datos, sin error ni
  segundo evento (AC-8).
- **`POST /v1/admin/orders/retention-sweep`** — corrida bajo demanda del barrido
  por plazo (AC-1), pensada para un disparador externo (cron de Railway o
  ejecución manual del dueño) mientras no exista infraestructura de colas.
- **Barrido oportunista al arrancar la API** (`OrdersRetentionRunner`,
  `onApplicationBootstrap`), mismo patrón que `ImportRunner` (ADR-0012): cubre el
  hueco de un redeploy que se salta el disparador externo.
- **`OrdersRetentionEventsService`** (observability/) — un evento agregado por
  corrida del barrido (`orders_retention.swept`, con el conteo) y uno por acción
  a pedido (`orders_retention.anonymized_on_request`), sin un solo dato personal
  en el payload.
- **`OrderNotFoundError`** (checkout-errors.ts) — 404 RFC 7807 cuando la acción a
  pedido apunta a una orden inexistente.
- Config nueva, validada al arranque (Zod, fail-fast): `ORDER_RETENTION_MONTHS`
  (default 12), y los presupuestos de rate-limit de las dos rutas nuevas.
- Contrato OpenAPI de los dos endpoints (`api-contract-completeness`).

## Out of scope

- **Panel de órdenes del dueño** (US-012, sin change de backend todavía). Este
  change no construye ningún GET de orden — ver el open question en
  `design.md` sobre lo que ese futuro DTO tiene que exponer.
- **Exportación / derecho de acceso a datos personales** — otro derecho de la
  Ley 25.326, otra US (US §4).
- **Retención de otros datos** (logs, eventos de observabilidad, carritos
  vencidos — ya cubiertos por US-007). Sólo `orders`.
- **Job programado real con BullMQ.** Redis no está aprovisionado (ADR-0004,
  ADR-0012). Ver `design.md` §Trade-offs para la justificación completa del
  patrón elegido y el criterio de migración.
- **Invalidación de `access_token_hash`.** Ver `design.md` §Approach — decisión
  explícita de dejarlo fuera de alcance, con su razón.
- **Facturación AFIP** y sus plazos de conservación fiscal (roadmap, US §4).

## References

- US: `docs/user-stories/US-021-retencion-datos-ordenes.md`
- PRD: `docs/product/prd.md` §6 (política de retención)
- E2E: `docs/product/design-e2e.md` §8 (DER, retención) — ADR-0002 (motor único)
- ADR-0012: `docs/architecture/decisions/0012-in-process-import-executor.md`
  (ejecutor in-process + contrato asíncrono desde el día uno; el patrón que este
  change reusa para el barrido)
- Precedente citado por el propio ADR-0012: `openspec/changes/US-014-registro-login-backend/design.md`
  (purga programada de tokens vencidos, `Deferred: US-011 / operaciones`,
  Redis aún no provisionado, ADR-0004)
- Precedente de código: `apps/api/src/imports/import-runner.ts` (`onApplicationBootstrap`,
  patrón de barrido oportunista) y `apps/api/src/imports/import-jobs.repository.ts`
  (`purgeOlderThan`)
- Origen de esta US: `OQ-BE-5` de `openspec/changes/US-008-checkout-guest-backend/`
  (resuelta 2026-08-22, opción (a): abrir esta US antes de producción)
- Capability futura esperada en `openspec/specs/`: `retencion-datos-personales`
  (CAP-13 «Cumplimiento de datos personales», partida de CAP-10 el 2026-08-23).
  No se crea acá — la materializa el primer `/archive-change` de esta US.
