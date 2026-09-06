# Capacidad: Retención y anonimización de datos personales (CAP-13)

**Estado**: entregada parcialmente — sólo el backend. Sin panel de lectura
(el DTO admin de órdenes de `US-012-panel-ordenes-dueno` debe exponer
`anonymized_at`/`anonymization_reason` para que esto sea visible; ver Open
question) y sin disparador externo real (cron) provisionado.

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

## Qué NO está vivo todavía

- **Panel de lectura** que muestre `anonymized_at`/`anonymization_reason` —
  depende de `US-012-panel-ordenes-dueno-backend`, que debe exponerlos en su
  DTO de orden (ver Open question abajo).
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
Dos endpoints vivos:

| Endpoint | Métodos | AC |
|---|---|---|
| `/admin/orders/{id}/anonymize` | POST | AC-3, AC-4, AC-8, AC-9 |
| `/admin/orders/retention-sweep` | POST | AC-1, AC-4, AC-8 |

Seeded desde los contratos draft del propio change (`contracts/openapi/anonymize-order.yaml`
+ `retention-sweep.yaml`) — el spec publicado de `apps/api/docs/api/openapi.yaml`
**no** llegó a incluirlos (el `tasks.md` de este change no tuvo una task
equivalente a "mergear al spec publicado" que sí tuvieron otros changes
archivados; queda como brecha conocida, no de esta capacidad).

## Changes que formaron esta capacidad

| Change | Disciplina | Aporte |
|---|---|---|
| [`US-021-retencion-datos-ordenes-backend`](../../changes/archive/US-021-retencion-datos-ordenes-backend/) | BE | Migración aditiva (`anonymized_at`/`anonymization_reason` + 2 `CHECK`), `OrdersRetentionService`/`Controller`/`Runner`, 2 endpoints admin, idempotencia estructural |

Sin disciplinas FE/QA propias todavía. `US-021-retencion-datos-ordenes-qa`
está en desarrollo (otra sesión); `US-021-retencion-datos-ordenes-frontend-web`
no existe como change — la acción "anonimizar" en el panel del dueño
depende de que `US-012-panel-ordenes-dueno-frontend-web` (ya construido)
exponga el estado de anonimización, lo que a su vez depende de que el
backend de US-012 exponga esos campos (ver Open question).

## Open question heredada (para quien planifique US-012 backend/frontend)

El futuro DTO de lectura de una orden **debe** exponer `anonymized_at` y
`anonymization_reason` — es lo que el AC-5 de esta US necesita para que el
panel muestre la indicación de "datos anonimizados" en vez del
nombre/email/teléfono. `US-012-panel-ordenes-dueno-backend` ya está
archivado (ver `openspec/specs/ordenes/`) — su `AdminOrderDetail` **no**
declara estos campos todavía; quien lo extienda debe leer esto primero.

## Estado de la provisión

Corre hoy en **entorno local** (`docker-compose`, Postgres). La provisión de
nube es US-019, igual que el resto del sistema.
