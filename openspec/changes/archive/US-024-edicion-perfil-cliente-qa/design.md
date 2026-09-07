# Design — US-024 QA: edición de perfil del cliente

## Contexto

US-024 no tiene todavía ningún change de BE/FE (ninguna sesión lo construyó
aún) — este plan se escribe **contra el contrato de la US** (sus 7 AC en
Gherkin), no contra código real. Es Modo B (standalone) porque la US declara
disciplinas `[BE, FE, QA]` pero ninguna está planificada — `/plan-qa
--standalone`, edge case documentado en el propio skill.

## D-QA1 — Escenarios derivados de los AC, no re-inventados

Cada escenario Gherkin de `qa-plan.md` §3 mapea 1:1 a un AC de la US (mismo
número, ej. AC-1 → SC-024-H1). No se agregan variantes de producto nuevas
acá — cualquier decisión de negocio adicional que un escenario necesitara
(ej. "¿qué pasa si dos pestañas editan el nombre a la vez?") se marca como
`[Deferred]` en vez de decidirse en silencio, per `openspec-workflow` §3.9.

## D-QA2 — Dependencias declaradas, no asumidas

Todo test-case que necesite código real (E2E Playwright, contract testing
contra un endpoint que no existe) queda con su dependencia explícita en
`qa-plan.md` §7 y **bloqueado** hasta que `/develop-{discipline}` lo
construya — igual criterio que `US-009-pago-mercadopago-backend/qa-plan.md`
(que documentó "Blocked-by: FE-US-008 + FE-US-009" en vez de fingir que el
E2E podía correr). `/develop-qa` NO se invoca sobre este change hasta que al
menos el endpoint `PATCH /v1/me` exista.

## D-QA3 — Sin mocks del backend para BDD de aceptación

La suite de aceptación (Cucumber, `qa/acceptance/`) corre contra la API real
levantada (`qa/scripts/api-up.sh`), nunca contra un mock — mismo principio
que el resto de `qa/` en este repo (mocks sólo del lado de terceros externos,
nunca del propio backend bajo prueba). Esto es una restricción de diseño, no
un test-case: significa que ningún escenario de este plan puede "pasar" antes
de que BE-US-024 exista, sin importar cuánto se automaticen los stubs.

## Trade-offs

- **Costo**: el plan puede necesitar un ajuste menor cuando el `design.md`
  real de BE-US-024 aparezca (ej. si el endpoint no es exactamente
  `PATCH /v1/me`, o si valida la URL de avatar con una regex distinta a la
  asumida acá). Se acepta el costo de un ajuste chico a cambio de tener el
  plan listo el día que el código aterrice (per pedido explícito de la
  coordinadora — paralelizar trabajo que no depende del build).
- **Beneficio**: `/develop-qa` arranca el mismo día que BE+FE cierren, sin
  esperar a que alguien escriba el plan desde cero.

## Open questions

Ninguna sin resolver — ver `proposal.md`.

## Referencias

- US: `docs/user-stories/US-024-edicion-perfil-cliente.md`
- Precedente D-QA (mismo criterio de "revalidar/planificar sin tocar
  producto"): `openspec/changes/archive/US-022-actualizacion-dependencias-qa/design.md`
