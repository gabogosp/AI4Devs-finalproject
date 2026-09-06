# Capacidad: Retención y anonimización de datos personales (CAP-13)

**Estado**: entregada parcialmente — sólo backend (2 endpoints admin de
US-021 + `DELETE /me` de autoservicio del cliente de US-020). Sin panel de
lectura para el flujo admin y sin disparador externo real (cron)
provisionado; el panel de lectura de `anonymized_at`/`anonymization_reason`
en el DTO admin de órdenes **ya está resuelto** (2026-09-05, ver
`decisions.md` — corrección de una nota de esta misma sección que había
quedado desactualizada).

Estado declarado del sistema para la capacidad CAP-13 del PRD §2.1 (partida
de CAP-10 el 2026-08-23: la protección de datos personales es su propia
capacidad, no una extensión de checkout). Este directorio es el
**acumulado** de los changes archivados: se extiende en cada
`/archive-change`, nunca se reescribe.

## Por qué esta capacidad no existía todavía

El PRD §6 fija la política desde el principio ("historial de órdenes: se
conserva hasta 12 meses") y el E2E §8 la traduce en datos concretos ("job
mensual que purga/anonimiza órdenes > 12 meses"), pero ninguna US la
implementaba. US-020 cubre el borrado de **cuentas registradas**; el
comprador **invitado** de US-008 (el camino principal del PRD §2.1 cap. 4)
no tiene cuenta que borrar — su nombre, email y teléfono quedan en `orders`
sin ningún mecanismo de supresión. El PO abrió `US-021-retencion-datos-ordenes`
como condición previa a producción al resolver `OQ-BE-5` de US-008
(2026-08-22).

## Qué está vivo hoy

Extiende `checkout/` (no abre un módulo `orders` admin dedicado — `US-012`
sigue sin backend al momento de este change):

- **Anonimizar, no borrar**: la orden y sus ítems nunca se eliminan (AC-6);
  sólo se sobrescriben `buyer_name`/`buyer_email`/`buyer_phone` por un valor
  fijo no reversible. El historial comercial, los importes, el estado y el
  registro de consentimiento quedan intactos (AC-7).
- **`POST /admin/orders/{id}/anonymize`** (AC-3, AC-9): a pedido del
  comprador (vía email/WhatsApp al dueño, que ejecuta la acción desde el
  panel/API). `reason` fijo en `requested`, nunca del body — sin superficie
  de tampering sobre el motivo.
- **`POST /admin/orders/retention-sweep`** (AC-1): barrido manual/bajo
  demanda de todas las órdenes con el plazo cumplido (`ORDER_RETENTION_MONTHS`,
  default 12). Síncrono a propósito — un único `UPDATE` de conjunto, no
  `202`+polling (el volumen esperado no lo justifica).
- **`OrdersRetentionRunner.onApplicationBootstrap()`**: el mismo barrido
  corre oportunistamente al arrancar la API (mismo patrón que `ImportRunner`,
  ADR-0012) — cubre el hueco de un redeploy que se salta el disparador
  externo mensual.
- **Idempotencia estructural** (AC-8): `UPDATE ... WHERE anonymized_at IS
  NULL` — repetir la anonimización sobre una orden ya anonimizada responde
  `200` idéntico, nunca un error. No hay forma de recuperar la PII original.
- **Auditoría** (AC-4): `anonymized_at` + `anonymization_reason` (`retention_policy`
  vs `requested`) — un `CHECK` hace estructuralmente imposible una orden con
  fecha de anonimización pero sin motivo (o viceversa).
- **`access_token_hash` fuera de alcance, a propósito**: no es PII (hash de
  un token aleatorio, no derivado de datos personales) y revocarlo rompería
  la consulta de estado que ningún AC pide tocar — el invitado sigue
  pudiendo consultar su orden después de la supresión de sus datos de
  contacto.
- **Observabilidad sin PII**: `orders_retention.swept` (uno por corrida, con
  `anonymized_count`) y `orders_retention.anonymized_on_request` (uno por
  acción) — la firma nunca acepta más que `orderId | null`.

## Qué agregó US-020 (borrado de cuenta, autoservicio)

- **`DELETE /me`** (AC-1, AC-2, AC-3): a diferencia de las dos rutas
  anteriores (acción del dueño sobre un comprador invitado), esta la
  dispara el propio CLIENTE sobre su propia cuenta, con su propia sesión
  (`sessionCookie`, no `adminBearer`). Anonimiza `customers` (name/email/
  phone sobrescritos, `deleted_at` sellado, email liberado para
  re-registro), revoca sesiones y resets pendientes, desvincula carritos, y
  anonimiza las órdenes históricas del titular reusando el mecanismo de
  arriba con un tercer valor de `reason`: `account_deletion`.
- **Bloqueo por órdenes en curso** (AC-4, AC-9): si el titular tiene una
  orden sin pagar o pagada y sin entregar, el borrado se rechaza (409) con
  el detalle — verificado al ejecutar, dentro de la misma transacción.
- **Idempotente** (AC-15): mismo idioma `WHERE ... IS NULL`, ahora también
  sobre `customers.deleted_at`.
- Detalle completo:
  [`US-020-borrado-cuenta-datos-personales-backend`](../../changes/archive/US-020-borrado-cuenta-datos-personales-backend/).

## Qué NO está vivo todavía

- **Panel de lectura** para el flujo ADMIN (mostrar "datos anonimizados" en
  vez del nombre/email/teléfono real de un comprador invitado) — el DTO ya
  expone los campos (ver arriba, resuelto 2026-09-05); falta el componente
  de FE que los consuma en el panel del dueño.
- **Disparador externo real** (cron de Railway u operación manual
  documentada en el runbook) para la cadencia mensual de AC-1 — el barrido
  al arrancar cubre sólo el caso de redeploy, no reemplaza un disparador
  mensual real. Responsabilidad de `/plan-deployment` u operaciones.
- **Ejecutor BullMQ real** para el barrido periódico — `Deferred:
  operaciones/US-019`, condicionado a que `REDIS_URL` se aprovisione
  (ADR-0004). El contrato HTTP no cambia cuando eso ocurra.
- **Flujo de exportación / derecho de acceso** (otro derecho de la Ley
  25.326) — fuera de alcance de este change.

## Contratos

El contrato vivo de la superficie REST está en [`contracts/openapi.yaml`](contracts/openapi.yaml)
+ un archivo por endpoint bajo [`contracts/openapi/paths/`](contracts/openapi/paths/).
Tres endpoints vivos:

| Endpoint | Métodos | Seguridad | AC |
|---|---|---|---|
| `/admin/orders/{id}/anonymize` | POST | `adminBearer` | AC-3, AC-4, AC-8, AC-9 (US-021) |
| `/admin/orders/retention-sweep` | POST | `adminBearer` | AC-1, AC-4, AC-8 (US-021) |
| `/me` | DELETE | `sessionCookie` | AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-9, AC-10, AC-12, AC-13, AC-14, AC-15 (US-020) |

Seeded desde los contratos draft del propio change (`contracts/openapi/anonymize-order.yaml`
+ `retention-sweep.yaml`) — el spec publicado de `apps/api/docs/api/openapi.yaml`
**no** llegó a incluir esos 2 endpoints (el `tasks.md` de US-021 no tuvo una
task equivalente a "mergear al spec publicado"; queda como brecha conocida
de esos 2, no de la capacidad entera). `DELETE /me` (US-020) es distinto:
**sí** se publicó en `apps/api/docs/api/openapi.yaml` en el mismo change
(su propia Fase 6 sí tuvo esa task) — no hereda la misma brecha.

## Changes que formaron esta capacidad

| Change | Disciplina | Aporte |
|---|---|---|
| [`US-021-retencion-datos-ordenes-backend`](../../changes/archive/US-021-retencion-datos-ordenes-backend/) | BE | Migración aditiva (`anonymized_at`/`anonymization_reason` + 2 `CHECK`), `OrdersRetentionService`/`Controller`/`Runner`, 2 endpoints admin, idempotencia estructural |
| [`US-020-borrado-cuenta-datos-personales-backend`](../../changes/archive/US-020-borrado-cuenta-datos-personales-backend/) | BE | `DELETE /me` (autoservicio del cliente), `AccountModule`/`AccountDeletionService`, tercer valor de `anonymization_reason` (`account_deletion`), reuso íntegro del mecanismo de anonimización de órdenes de US-021 |

Sin disciplinas FE/QA propias todavía para ninguno de los 2 changes.
`US-021-retencion-datos-ordenes-qa` está en desarrollo (otra sesión);
`US-020-borrado-cuenta-datos-personales-frontend-web`/`-qa` tampoco existen
como change todavía (la US-020 declara `[BE, FE, QA]` — el backend es la
primera disciplina en cerrar).

## Estado de la provisión

Corre hoy en **entorno local** (`docker-compose`, Postgres). La provisión de
nube es US-019, igual que el resto del sistema.
