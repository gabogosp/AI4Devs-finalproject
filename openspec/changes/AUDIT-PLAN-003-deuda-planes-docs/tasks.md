## Traceability matrix

| Finding ID | Title | Task IDs | Status |
|---|---|---|---|
| AUDIT-PLAN-003 | REV-001: US-004 T6.2 Verify no prueba calibración | T1.1 | in this change |
| AUDIT-PLAN-004 | REV-002: US-004 T7.2 Verify no prueba contenido README | T1.2 | in this change |
| AUDIT-PLAN-005 | REV-003: US-007 FE T0.2 rg redundante | T2.1 | in this change |
| AUDIT-PLAN-006 | REV-004: US-008 T6.2 Verify no prueba contenido README | T1.3 | in this change |
| AUDIT-PLAN-007 | REV-005: US-010 T7.2 Verify no prueba utilidad runbook | T1.4 | in this change |
| AUDIT-PLAN-010 | REV-006: US-007 FE T6.1/T6.2 idem patrón | T2.2 | in this change |
| AUDIT-PLAN-011 | REV-007: US-004 design §D6 seam sin verify de DI | T3.1 | in this change |
| AUDIT-PLAN-012 | REV-009: US-010 T2.4 wiring inter-módulos sin task | T4.1 | in this change |
| AUDIT-PLAN-013 | REV-010: US-004 deviación POST→GET no declarada | T5.1 | in this change |
| AUDIT-PLAN-015 | REV-011: US-009 timeout de request del host | T5.2 | in this change |
| AUDIT-PLAN-016 | REV-012: US-010 runners duplicados con >1 instancia | T5.3 | in this change |
| AUDIT-PLAN-017 | REV-013: US-010 T0.1 no declara edición de spec US-008 | T5.4 | in this change |

---

## Fase 1 — F50: Verify de documentación operativa (patrón recurrente)

Patrón de fix: reemplazar el `Verify:` que usa `rg -q` por la declaración explícita: "Verify: revisión humana en el PR — el grep prueba presencia, no utilidad" (como ya hace US-009 T7.2).

- [ ] T1.1 US-004 T6.2: fix Verify de tabla de calibración

En `openspec/changes/US-004-busqueda-semantica-backend/tasks.md`, task T6.2: reemplazar el `Verify:` actual por uno que ejecute el arnés de calibración (`pnpm --filter @dsm/api test -- --testPathPattern calibration`) o, si es revisión humana, declararlo explícitamente.

  - **Exit criterion**: T6.2 tiene un `Verify:` que ejecuta el arnés O declara "revisión humana".
  - **Verify**: `grep -A2 "T6.2" openspec/changes/US-004-busqueda-semantica-backend/tasks.md | grep -qi "revisión humana\|calibration\|run.*arn"`

- [ ] T1.2 US-004 T7.2: fix Verify de README operativo

Agregar la aclaración "el grep prueba presencia, no utilidad — la utilidad la firma quien revisa el PR" al Verify de T7.2.

  - **Exit criterion**: T7.2 contiene la aclaración de revisión humana.
  - **Verify**: `grep -A5 "T7.2" openspec/changes/US-004-busqueda-semantica-backend/tasks.md | grep -qi "revisión humana\|utilidad.*PR"`

- [ ] T1.3 US-008 T6.2: fix Verify de README

Misma enmienda que T1.2, aplicada a `openspec/changes/US-008-checkout-guest-backend/tasks.md` T6.2.

  - **Exit criterion**: T6.2 de US-008 contiene aclaración de revisión humana.
  - **Verify**: `grep -A5 "T6.2" openspec/changes/US-008-checkout-guest-backend/tasks.md | grep -qi "revisión humana\|utilidad.*PR"`

- [ ] T1.4 US-010 T7.2: fix Verify de runbook

Misma enmienda, aplicada a `openspec/changes/US-010-orden-webhook-stock-backend/tasks.md` T7.2.

  - **Exit criterion**: T7.2 de US-010 contiene aclaración de revisión humana.
  - **Verify**: `grep -A5 "T7.2" openspec/changes/US-010-orden-webhook-stock-backend/tasks.md | grep -qi "revisión humana\|utilidad.*PR"`

---

## Fase 2 — F50: Frontend-web plans

- [ ] T2.1 US-007 FE T0.2: eliminar rg redundante

En `openspec/changes/US-007-carrito-compra-frontend-web/tasks.md` T0.2: eliminar la primera parte del Verify (el `rg -q "codegen"`) que es redundante respecto a la prueba de mutación que le sigue.

  - **Exit criterion**: T0.2 no tiene `rg -q "codegen"` como primera parte del Verify.
  - **Verify**: `! grep -A3 "T0.2" openspec/changes/US-007-carrito-compra-frontend-web/tasks.md | grep -q 'rg -q "codegen"'`

- [ ] T2.2 US-007 FE T6.1/T6.2: añadir aclaración de revisión humana

Agregar la línea de aclaración a los Verify de T6.1 y T6.2.

  - **Exit criterion**: T6.1 y T6.2 contienen la aclaración.
  - **Verify**: `grep -c "revisión humana\|utilidad.*PR" openspec/changes/US-007-carrito-compra-frontend-web/tasks.md` devuelve ≥2

---

## Fase 3 — F51: Seam sin verify de DI

- [ ] T3.1 US-004 design §D6: agregar verify de sustituibilidad del caché

En `openspec/changes/US-004-busqueda-semantica-backend/tasks.md` T1.3 (o nueva subtask T1.3b): agregar una aserción de que `SearchService` recibe el caché por token de DI (`SEARCH_CACHE`), no por instanciación directa. O declarar explícitamente como Deferred a US-019.

  - **Exit criterion**: T1.3 (o nueva subtask) tiene Exit+Verify que prueba inyección por DI, O la tabla de trazabilidad declara la sustituibilidad como deferred.
  - **Verify**: `grep -qi "SEARCH_CACHE\|DI.*inject\|deferred.*US-019\|sustituib" openspec/changes/US-004-busqueda-semantica-backend/tasks.md`

---

## Fase 4 — Wiring inter-módulos (REV-009, High)

- [ ] T4.1 US-010 T2.4: declarar wiring y resolver potencial circular

En `openspec/changes/US-010-orden-webhook-stock-backend/tasks.md`: extender T2.4 (o agregar T2.4b) con exit criterion que declare cómo se resuelve la dependencia (`forwardRef`, módulo compartido, o Verify con `moduleRef.get(PAYMENT_CONFIRMATION)`) y un Verify que lo pruebe (`pnpm --filter @dsm/api typecheck` + test de resolución de DI).

  - **Exit criterion**: T2.4 (o subtask nueva) declara explícitamente la estrategia de wiring y tiene Verify que incluye resolución de DI.
  - **Verify**: `grep -qi "forwardRef\|moduleRef\|circular\|wiring" openspec/changes/US-010-orden-webhook-stock-backend/tasks.md`

---

## Fase 5 — Mejoras menores (Low)

- [ ] T5.1 US-004: anotar deviación POST→GET en proposal

En `openspec/changes/US-004-busqueda-semantica-backend/proposal.md`: agregar nota de que el endpoint es `GET /v1/search` (no `POST /search` como dice §4 del readme raíz). Justificación: búsqueda idempotente = GET.

  - **Exit criterion**: El proposal menciona la deviación respecto al readme.
  - **Verify**: `grep -qi "GET.*POST\|POST.*GET\|readme.*devia\|devia.*readme" openspec/changes/US-004-busqueda-semantica-backend/proposal.md`

- [ ] T5.2 US-009: declarar presupuesto de timeout vs Railway

En `openspec/changes/US-009-pago-mercadopago-backend/design.md`: agregar nota indicando el timeout del host de Railway (30s default) y que el peor caso (~12.75s) encaja, o declarar que se agrega un abort controller con presupuesto total.

  - **Exit criterion**: El design menciona el timeout del host y la relación con el peor caso del breaker.
  - **Verify**: `grep -qi "Railway\|timeout.*host\|30.*s\|abort" openspec/changes/US-009-pago-mercadopago-backend/design.md`

- [ ] T5.3 US-010: nota sobre runners con >1 instancia

En `openspec/changes/US-010-orden-webhook-stock-backend/tasks.md` T7.2 (o en design): agregar una línea al contenido del runbook exigido indicando "con >1 instancia, deshabilitar runners y usar endpoints admin desde cron externo".

  - **Exit criterion**: El plan menciona el escenario multi-instancia en runbook/readme.
  - **Verify**: `grep -qi "instancia\|instance\|cron\|deshabilitar.*runner" openspec/changes/US-010-orden-webhook-stock-backend/tasks.md`

- [ ] T5.4 US-010 T0.1: declarar edición de spec de US-008

En `openspec/changes/US-010-orden-webhook-stock-backend/tasks.md` T0.1: agregar al Exit criterion que `order-schema.spec.ts` se actualiza para incluir `confirmed_at` y `cancelled_at`.

  - **Exit criterion**: T0.1 menciona la actualización de `order-schema.spec.ts` con las columnas nuevas.
  - **Verify**: `grep -qi "order-schema.*spec\|confirmed_at.*cancelled_at" openspec/changes/US-010-orden-webhook-stock-backend/tasks.md`
