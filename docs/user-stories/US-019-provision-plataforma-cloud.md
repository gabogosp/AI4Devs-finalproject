---
type: user-story
id: US-019
slug: provision-plataforma-cloud
parent-prd: docs/product/prd.md
parent-e2e: docs/product/design-e2e.md
status: Ready
priority: Medium
estimate-tshirt: M
story_points_traditional: 8
story_points_ai_assisted: 4
estimation_basis: "INFRA provisioning multi-proveedor (Railway compute+Redis, Neon Postgres+pgvector, Cloudflare DNS/R2) + secretos + autodeploy + observabilidad + runbook (Cohn 2005 §11 infra setup, 8) × 0.45 (Peng 2023)"
language: es
created: 2026-08-09
updated: 2026-08-09
ready-at: 2026-08-09
authored-by: Gabriel Suarez
disciplines: [INFRA]
linear-issue-id: null
figma-frames: []
---

# US-019 — Provisión de la plataforma cloud

> **Origen (2026-08-09)**: esta US **no nace del PRD**; extrae la pista paralela de infra que
> `railway-baseline` §0 obliga a separar del bootstrap local. El change
> `US-001-…-platform-cloud-infrastructure` vivía bajo US-001 y, al estar *gated* en dependencias
> externas (cuentas Railway/Neon/Cloudflare, billing en ARS), impedía que US-001 pasara a `Done`
> y mantenía bloqueadas a las 17 US que dependen de ella — esperando un trámite de facturación,
> no trabajo de producto. Se le da US propia para que la pista local cierre y el DAG se libere.
> El trabajo **no se reduce ni se cancela**: cambia de unidad de planificación.

## 1. La historia (formato Connextra)

**Como** responsable técnico de DSM,
**quiero** la plataforma cloud aprovisionada (compute, base gestionada, objetos, DNS/TLS, secretos,
autodeploy y observabilidad),
**para** poder desplegar el catálogo en un entorno accesible desde internet y operar el servicio con
un runbook, en vez de sólo correrlo en la máquina de un dev.

## 2. Por qué importa (Valuable)

Sin esta US el producto sólo existe en local: no hay demo para el dueño, no hay entorno prod-shaped
donde re-medir los NFR de carga (hoy los umbrales de k6 corren en local con números `[propuesto]`),
y no hay dónde ejecutar el primer deploy. Es habilitante, no funcional: ninguna capacidad del PRD
depende de ella para estar *construida*, pero todas dependen de ella para estar *entregadas*.

## 3. Criterios de aceptación (Gherkin / Given-When-Then)

Los AC operativos detallados viven en el change de infra (`tasks.md`, 5 fases). Acá el gate de US:

```gherkin
Scenario: AC-1 — La plataforma queda aprovisionada y accesible
  Given las cuentas de Railway, Neon y Cloudflare con billing activo
  When se ejecuta el change de provisión
  Then existen los servicios de compute, la base gestionada con pgvector y el bucket de objetos
  And el dominio resuelve por DNS con TLS válido

Scenario: AC-2 — El esquema del catálogo queda aplicado en staging
  Given el esquema autorizado y validado en bootstrap-local (fuente única de verdad)
  When se aplica a la base gestionada
  Then las migraciones corren sin error y el esquema en la nube coincide con el local

Scenario: AC-3 — Los secretos no viven en el repo
  Given las credenciales de los proveedores y de las integraciones
  When se configuran en la plataforma
  Then están en variables de entorno cifradas del proveedor
  And ningún secreto real aparece en git ni en la imagen

Scenario: AC-4 — El servicio tiene runbook operativo
  Given el servicio desplegado
  When un operador necesita atender un incidente
  Then existe el runbook con tareas day-2, respuesta a alertas y procedimiento de rollback
```

## 4. Out of scope explícito

- **El primer deploy vivo y su checklist pre-prod**: lo planifica `/plan-deployment` cuando exista
  una app scaffoldeada — así lo declara el proposal del change.
- **Re-medición de los NFR de carga en entorno prod-shaped**: es el `revisit` de OQ-QA-2 del change
  de QA; se dispara cuando esta US cierra, pero el trabajo es de QA.
- **Multi-región / multi-AZ**: el E2E §despliegue lo descarta explícitamente para el plan económico.

## 5. INVEST self-check

- **Independent**: sí — no depende de ninguna otra US; sólo de dependencias externas.
- **Negotiable**: sí — el alcance por fase es ajustable según qué cuentas estén listas.
- **Valuable**: habilitante (ver §2): sin ella nada se entrega, aunque todo esté construido.
- **Estimable**: sí — 5 fases ya desglosadas en el change existente.
- **Small**: M — 22 tasks, acotadas a INFRA.
- **Testable**: sí — cada AC es verificable contra la plataforma aprovisionada.

## 6. Dependencias

- **Bloqueada por**: ninguna US. **Gated en dependencias externas**: cuentas Railway / Neon /
  Cloudflare con billing en ARS. Ése es el único motivo por el que no arranca hoy.
- **Bloquea a**: ninguna US en su construcción. Bloquea la **entrega** (deploy, demo al dueño,
  re-medición de NFR en prod-shaped).
- **Relación con US-001**: el esquema del catálogo es fuente única de verdad, autorizado y validado
  en `bootstrap-local` (US-001); esta US lo **aplica** a la nube, no lo redefine.

## 7. Tasks asociadas (gruesas, una por disciplina afectada)

| Disciplina | Task gruesa | Estimado |
|---|---|---|
| INFRA | Provisión de plataforma + secretos/DNS/TLS + esquema en staging + autodeploy/observabilidad + runbook | 8-10 h |

El openspec change ya existe y conserva su historia (se movió con `git mv`, no se recreó): `openspec/changes/US-019-provision-plataforma-cloud-infrastructure/` — 5 fases, 22 tasks, antes bajo US-001 como `…-platform-cloud-infrastructure`. Se re-parenta; **no se reescribe**.

## 8. Diseño

Sin superficie de UI. La topología está fijada en el E2E §despliegue (Cloudflare → Railway
{web, api, worker, redis} → Neon) y en ADR-0001 (Railway/Neon/R2 como desviación del baseline
AWS Lightsail).

## 9. NFRs específicos de esta US

- Disponibilidad objetivo del servicio desplegado: 99.5% mensual (E2E §17), sin multi-AZ.
- TLS gestionado por la plataforma, HTTPS extremo a extremo.
- Secretos únicamente en variables cifradas del proveedor.

## 10. Notas / contexto adicional

Esta US es el **workaround de un gap del framework** (F53): el baseline obliga a separar
`platform-cloud` como pista paralela fuera del camino crítico, pero el modelo de cierre no tiene un
status `deferred` — `/archive-change` deja la US en `In Progress` mientras cualquier change de
disciplina siga abierto. Si el framework incorpora `deferred`, esta US puede reabsorberse en US-001
sin pérdida.

## Definition of Ready (gate Triage → Ready)

- [x] Historia en formato Connextra con valor explícito.
- [x] AC observables en Gherkin.
- [x] Dependencias declaradas (incluidas las externas, que son el gate real).
- [x] Out of scope explícito.
- [x] Tasks gruesas por disciplina con estimado.
- [x] NFRs específicos.
- [x] INVEST self-check pasado.

## Definition of Done (gate QA → Done)

- [ ] Las 5 fases del change de infra cerradas con sus `Verify`.
- [ ] Esquema aplicado en staging y verificado contra el local.
- [ ] Sin secretos en git; auditado.
- [ ] Runbook publicado y revisado por el responsable de operación.
