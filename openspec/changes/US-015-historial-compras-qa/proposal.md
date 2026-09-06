---
tracker-id: null
tracker-source: null
parent-us: US-015
discipline: qa
variant: null
language: es
---

# US-015 QA — Historial de compras del cliente registrado

## Why

El backend de US-015 (mergeado, PR #70 + su follow-up de publicación de contrato PR
#71) construyó, con 26/26 tasks y su propia suite dev-owned verde (235/235 suites,
1927/1927 tests), dos superficies nuevas: el **lector** que la US pedía originalmente
(`GET /v1/me/orders`, `GET /v1/me/orders/{order_number}`) y, por decisión del PO
(2026-09-06, ver `proposal.md` archivado de ese change), el **escritor** que
`US-008-checkout-guest-backend` había dejado explícitamente diferido —
`orders.customer_id` ahora se setea en el checkout cuando el comprador tiene una
sesión de cliente válida, vía `OptionalCustomerGuard` (nunca bloquea) +
`resolveCustomerSession()` (helper compartido con `CustomerGuard`, Extract Method).

Ese cierre dev-owned prueba, con Postgres real, cada unidad y cada endpoint por
separado: `orders.repository.spec.ts` (335 líneas nuevas), `orders-history.service.spec.ts`,
`orders-history.controller.spec.ts`, `e2e-orders-history-list.spec.ts`,
`e2e-orders-history-detail.spec.ts`, `e2e-checkout-customer-link.spec.ts`, y la
regresión completa de los 12 archivos de test de US-008 sin modificar una sola
aserción (AC-6, "cero cambio observable" para el invitado). **Nada de eso se repite
acá.**

Lo que falta es exactamente lo que ese `tasks.md` no cubre por diseño (ownership
matrix, `qa-backend-standards.md` §2.1): una **suite de aceptación persistente**
(BDD, black-box, contra el proceso HTTP real) que sobreviva a la entrega — distinta
de los specs de Jest, que son *dev-owned* y *efímeros* por diseño —, contract
testing formal contra el contrato publicado, un presupuesto de carga para el único
NFR cuantificado de la US (§9, "Latencia p95 lectura < 300ms"), y exploración
manual de los rincones que un test automatizado no ilumina.

**Alcance explícitamente acotado a lo que existe HOY (backend-only).** El frontend
de esta US (`US-015-historial-compras-frontend-web`) está en curso en paralelo, en
otro worktree, y **no se toca ni se asume terminado**: no hay ninguna UI que
ejercitar de punta a punta todavía. Este plan cubre las capas QA-owned alcanzables
**vía API** (aceptación BDD, contract testing, performance, exploratorio) — Layer 1
de `qa-three-layer-regression` (backend-aislado). El E2E cross-stack (Layer 3:
"el cliente abre `/cuenta/pedidos` en el navegador y ve su historial") queda
**diferido explícitamente** a un change QA hermano posterior, una vez que el FE
cierre y el namespace de rutas quede decidido (open question propia de ese change,
no de este). No es una omisión: es la consecuencia directa de que no hay nada que
automatizar en un navegador todavía.

## What changes

Un change hermano `US-015-historial-compras-qa/` con el plan y su ejecución, en el
harness cross-stack que ya existe (`qa/`), **sin tocar código de producción**:

| Capa | Herramienta | Qué cubre |
|---|---|---|
| Aceptación BDD (Layer 1, backend-aislado) | Cucumber-js + Playwright `APIRequestContext` | Contrato de comportamiento persistente para los 7 AC de la US: listado (AC-1), detalle (AC-2), estado vacío (AC-3), sólo-propias/IDOR (AC-4), requiere-sesión (AC-5), guest-no-vinculado (AC-6), retención (AC-7) — más 3 reglas de negocio adyacentes (paginación inválida, exclusión de `pending_payment`, comportamiento con órdenes anonimizadas) |
| Contract testing | Script `tsx` (mismo patrón que `pago-webhook.contract.ts`/`retencion-ordenes.contract.ts`) | Los 2 endpoints nuevos contra el contrato **publicado** (`apps/api/docs/api/openapi.yaml`) — ver `design.md` §D-QA1 para por qué no es el contrato "vivo" de `openspec/specs/` todavía |
| Carga (k6) | k6 | `GET /v1/me/orders` contra el único NFR cuantificado de la US (§9, p95 < 300ms, heredado del PRD §4) |
| Exploratorio | Charters manuales | Paginación con volumen real, husos horarios en el borde de retención, UX del offset/limit sin cursor |

**Lo que este plan NO hace** (ownership matrix, `qa-backend-standards.md` §2.1): no
escribe unit, integration ni e2e-nest — esas son TDD del dev en `/develop-backend`,
y en US-015 **ya están**, verdes. Se registran como nota de cobertura (§2 de
`qa-plan.md`) para que nadie las duplique. Tampoco escribe E2E cross-stack
(Layer 3) ni nada de accesibilidad/regresión visual — no hay UI de esta US
construida todavía (ver "Why").

## Out of scope

- **E2E cross-stack (Layer 3) — el cliente ve su historial en el navegador.**
  `Deferred: US-015-historial-compras-frontend-web (o un change QA hermano
  posterior) — owner: quien retome QA una vez que el FE cierre y el namespace de
  rutas (`/cuenta/pedidos` u otro) quede decidido`. No es una duda de este plan:
  es una dependencia dura de que exista una UI que automatizar.
- **Vincular retroactivamente compras guest a la cuenta.** Explícitamente fuera de
  v1 por la propia US (§4, AC-6) y por el backend (`design.md` Non-goals). Este
  plan verifica que la NO-vinculación se sostenga (SC-015-N3), no reabre la
  decisión de producto.
- **Re-comprar / reordenar desde el historial, cancelar/reembolsar, facturación.**
  Fuera de v1 por la US §4; ninguno tiene superficie que probar todavía.
- **Excluir del historial las órdenes anonimizadas a pedido dentro de los 12
  meses.** Open question ya registrada por el backend (`design.md` Open
  questions) con default implementado (se muestran, con contacto real
  reemplazado pero ítems/importes/estado intactos). Este plan agrega un
  escenario (SC-015-C5) que **verifica el default documentado**, no que
  resuelve la open question — la resolución sigue siendo del PO.
- **Reintentar el desglose sandbox/mock de MercadoPago.** No aplica: esta US no
  toca pagos reales, sólo el medio ya simulado que US-010 dejó disponible
  (`simulate-payment`, reusado tal cual para sembrar datos).

## Standards consultados

| Standard | Secciones aplicadas |
|---|---|
| `qa-backend-standards.md` | §2.1 ownership · §13 performance · §15 datos sintéticos · §21 BDD y Gherkin |
| `testing-standards.md` | §2 pirámide · §4.1 naming · §5 datos de test · §8 coverage · §14 patrones de código de test · §14.9 negative space · §18 anti-patterns |
| `api-standards.md` | §3, §8 RFC 7807, §12 cabeceras de rate-limit |
| `performance-standards.md` | §7 un test de carga necesita umbral numérico |
| `observability-standards.md` | §9 sin PII en logs/eventos |
| `threat-modeling-lite` (skill) | Superficie 4 (GET autenticado, IDOR) — el backend ya la cerró en su `design.md`; este plan la verifica desde afuera, no la reabre |

## Preguntas abiertas

| Id | Pregunta | Default implementado | Estado |
|---|---|---|---|
| OQ-QA-015-1 | ¿Cuándo cierra `US-015-historial-compras-frontend-web` para poder planificar el E2E cross-stack (Layer 3)? | Se documenta el diferimiento y qué queda cubierto mientras tanto (Layer 1 completo) | `[Deferred — owner: quien retome QA de US-015 tras el cierre del FE]` |
| OQ-QA-015-2 | ¿Se excluyen del historial las órdenes anonimizadas a pedido (US-021) dentro de los 12 meses? | Heredado del backend: no se excluyen (default ya implementado); este plan agrega SC-015-C5 para verificar ese default, no lo cuestiona | `[Deferred — owner: PO, ver design.md archivado de US-015-historial-compras-backend §Open questions]` |

## Referencias

- User story: [`docs/user-stories/US-015-historial-compras.md`](../../../docs/user-stories/US-015-historial-compras.md)
- Change de backend (mergeado, pendiente de su propio `/archive-change`):
  [`US-015-historial-compras-backend`](../US-015-historial-compras-backend/design.md)
  — `proposal.md`, `design.md`, `tasks.md` (26/26 tasks, PR #70), más el follow-up de
  publicación de contrato (PR #71, "publica contrato del historial de compras")
- Contrato publicado (fuente para contract testing, ver `design.md` §D-QA1):
  `apps/api/docs/api/openapi.yaml` (paths `/me/orders`, `/me/orders/{order_number}`)
- Capacidad viva esperada tras el primer `/archive-change` del backend:
  `openspec/specs/historial-compras/` (CAP-8) — todavía no existe
- PRD §2.1 cap. 8 (valor de la cuenta), §4 (NFR de latencia), §6 (retención 12 meses)
- E2E §8 (DER — `orders.customer_id`), §14 (autorización/trust boundaries)
- Precedente estructural directo (mismo patrón "backend mergeado, QA hermano,
  sin FE construido todavía en cuenta"): [`US-014-registro-login-qa`](../US-014-registro-login-qa/proposal.md)
- Precedente de contract testing contra el contrato publicado (no el vivo) y de
  formato de change hermano de QA: [`US-010-orden-webhook-stock-qa`](../archive/US-010-orden-webhook-stock-qa/proposal.md)
- Harness reusado sin modificar: `qa/support/customer-auth.ts` (US-014),
  `qa/support/cart-client.ts` (US-007/US-008), `qa/support/builders.ts`,
  `qa/support/backdate-order.ts` (US-010), `qa/support/admin-auth.ts`
- ADR-0011 (topología de sesión de cliente — cookies HttpOnly + refresh rotado),
  ADR-0013 (sesión de cliente en el FE, gobierna el futuro E2E de Layer 3)
