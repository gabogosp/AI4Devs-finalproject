# US-006 QA — Importación masiva de inventario: suite owned-by-QA

> **Change**: `US-006-import-masivo-inventario-qa` · **US**: `docs/user-stories/US-006-import-masivo-inventario.md`
> **Disciplina**: qa · **Modo**: A con change hermano (las dos disciplinas de código ya existen)
> **Autor**: qa-engineer (asistido por @gosp) · **Fecha**: 2026-08-23 · **Estado**: Draft

## Por qué existe este change

US-006 declara tres disciplinas (`BE`, `FE`, `QA`). Las dos de código están cerradas
—backend 35/35, frontend-web 13/13, con 1.277 tests en `@dsm/api` y 648 en `@dsm/web`— y
la tercera **no tiene plan ni carpeta**. Sin ella, la US no puede cruzar su propio
Definition of Done, que pide «AC verificados por QA» y regresión verde en staging.

Y no es una formalidad de tablero. Hay tres cosas que la suite actual **no puede** ver,
por construcción y no por descuido:

1. **El multipart real de un navegador.** El plan del FE dejó declarado el límite: en
   jsdom el cuerpo de un `FormData` no se puede leer (cuelga tanto con `formData()` como
   con `text()`), así que el test del cliente asserta el **encabezado** y nada más. El
   `POST` con un archivo de verdad, elegido por el diálogo del sistema, sólo ocurre en un
   browser. Es exactamente la costura donde el `content-type: application/json` forzado
   por el mutator ya rompió una vez este mismo flujo.
2. **La descarga del CSV.** El panel autentica con Bearer en memoria, así que el reporte
   se materializa desde un `Blob` con un object URL. En jsdom eso se prueba espiando
   `createObjectURL`; que el navegador **efectivamente baje un archivo con el nombre del
   `Content-Disposition`** es otra afirmación, y hoy nadie la hace.
3. **La invalidación del catálogo después de un ajuste masivo de precios (AC-4).** Es el
   handoff que el PO cerró en OQ-10: el backend no tiene canal hacia el renderizado de
   Next, así que el panel llama a `revalidateCatalogSafely()` al ver `completed`. El test
   del FE prueba que **llama**; que el storefront **muestre el precio nuevo** cruza web,
   API y caché de Next, y ninguna suite de un solo módulo compara las dos superficies. Es
   plata: el import perfecto y el cliente viendo el precio anterior.

## Alcance

**Capas owned-by-QA** (ownership matrix `qa-backend-standards.md` §2.1 ·
`qa-frontend-standards.md` §2.1): aceptación BDD, E2E de navegador (Layer 3 cross-stack),
accesibilidad, presupuesto de throughput y exploratorio.

**Fuera**: unit, component, integration y provider-contract. Son la TDD de los devs, ya
están escritas y **no se re-autoran acá** — hacerlo sería el anti-patrón «QA escribe todos
los tests», con el costo de dos suites que se contradicen.

### Decisiones del PO tomadas antes de escribir el plan (2026-08-23)

| # | Pregunta | Decisión |
|---|---|---|
| OQ-QA-1 | Profundidad, sin `service-catalog.yaml` en el repo | **Tier 2 pragmático**, con AC-8 (autorización) y AC-11 (límites/anti-DoS) tratadas como **Tier 1**: el riesgo alto está concentrado ahí, no repartido en las 11 AC |
| OQ-QA-2 | AC-3, encolado del enriquecimiento, con US-005 sin `GEMINI_API_KEY` ni worker | Probar **sólo la costura observable** —que el import deja los SKUs nuevos y los de descripción cambiada marcados como pendientes— y declarar el resto como cobertura de US-005 |
| OQ-QA-3 | Carga | **Sin k6.** Un k6 de concurrencia choca con el rate-limit de 3/hora/IP y además hay un único dueño: la concurrencia de usuarios no es el riesgo. En su lugar, presupuesto de throughput sobre 5.000 filas + que la API siga respondiendo mientras procesa |
| OQ-QA-4 | a11y y regresión visual | **a11y sí** (`importar-a11y.spec.ts`, el patrón por pantalla del repo), **visual no**: no hay baseline del panel y abrirlo acá es deuda sin dueño |
| OQ-QA-5 | Los archivos de prueba | **Generadores deterministas** en `qa/support`, nada binario en git — ni el Excel: `exceljs@4.4.0` ya está en el workspace y la propia suite del API fabrica su xlsx con la misma librería que lo lee (`detect-format.spec.ts`) |

## Qué se construye

| Entregable | Ruta | Capa |
|---|---|---|
| Generadores de archivos de prueba | `qa/support/import-files.ts` | soporte |
| Cliente y seed del import | `qa/support/import-client.ts`, `qa/support/seed-import.ts` | soporte |
| Aceptación BDD | `qa/acceptance/features/importar.feature` + `steps/importar.steps.ts` | L3 API-level |
| E2E de navegador | `qa/e2e/importar.spec.ts` | L3 cross-stack |
| Accesibilidad | `qa/e2e/importar-a11y.spec.ts` | L3 a11y |
| Presupuesto de throughput | `qa/performance/import-throughput.ts` | NFR |
| Charters exploratorios | `qa/exploratory/charters.md` (se agregan, no se reescriben) | manual |

**24 test cases** (`TC-601`..`TC-624`): 16 automatizados en aceptación, 4 en E2E de
navegador, 1 de a11y, 1 de throughput y 2 charters manuales. Numeración `TC-6NN` porque el
paquete `@dsm/qa` es compartido (US-001 `TC-0NN`, US-002 `TC-2NN`, US-003 `TC-3NN`,
US-007 `TC-7NN`).

## Qué NO se construye, y por qué

- **Regresión visual**: OQ-QA-4.
- **k6**: OQ-QA-3.
- **Prueba del enriquecimiento con IA real**: OQ-QA-2; pertenece a US-005, que además no
  tiene la clave del proveedor cargada.
- **Listado de imports**: el backend no lo expone (diferido a US-016), así que no hay
  superficie que probar y el deep-link por id es lo único que hay.
- **Concurrencia de dos imports simultáneos del mismo dueño**: el backend responde
  `409 dsm:import/already-running` y eso está cubierto por su e2e-nest (dev-owned). Repetirlo
  en L3 no agrega información.

## Riesgo de este change

El único riesgo real es de **entorno**, no de diseño: la suite necesita el stack arriba
(API en `:3000` + web en `:3100`) y una base con datos sembrados. El patrón ya existe
—`qa/scripts/api-up.sh` y los seeds de US-001/002/003/007—, y el spec de a11y del panel ya
hace login por `/admin/acceso`, así que el camino está probado. El límite de **3 imports por
hora y por IP** sí es una restricción nueva para una suite: se administra explícitamente
(ver `design.md` §5), porque una suite que se autoenvenena con su propio rate-limit falla
en amarillo y se termina ignorando.
