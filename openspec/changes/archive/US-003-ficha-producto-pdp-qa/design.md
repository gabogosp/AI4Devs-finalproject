---
parent-us: US-003
discipline: qa
language: es
---

# US-003 QA — Diseño de la suite

## Context

El paquete `@dsm/qa` ya existe desde US-001 con su estructura, fixtures y CI. Esta US **lo extiende**,
no lo re-funda: mismo runner, mismo seed, mismos thresholds, misma pipeline. Lo nuevo es una
superficie **anónima y renderizada en servidor**, que trae dos exigencias que la suite todavía no tenía.

## Goals

- Certificar los AC de US-003 de punta a punta contra el stack real.
- Cubrir lo que ninguna capa dev-owned puede ver: el HTML servido y el cruce panel→ficha del AC-9.
- Dejar la regresión de la ficha pública lista para que la hereden US-002, US-004 y US-007.

## Non-goals

- Re-testear la superficie admin (US-001 ya la cubre).
- Verificar el flujo de compra (US-007).
- Automatizar la validación de datos estructurados contra herramientas externas (charter manual).

## Approach

### Lo nuevo respecto de US-001

| Aspecto | US-001 (admin) | US-003 (público) |
|---|---|---|
| Auth | fixture con login real obligatorio | **sin auth** — el visitante es anónimo |
| Qué se aserta | JSON de la API vía UI | **el HTML servido**, antes de que corra JS |
| Cruce de superficies | dentro del panel | **panel admin → ficha pública** (AC-9) |

### Verificación de SSR — el punto delicado

Asertar SEO con un browser normal **no sirve**: Playwright ejecuta JavaScript, así que una página
que se hidrata en el cliente se ve igual que una renderizada en servidor. El test pasaría y Google
seguiría viendo una página vacía — el falso verde exacto que esta suite existe para evitar.

**Decisión**: las aserciones de SSR se hacen sobre el HTML **crudo**, con JavaScript deshabilitado en
el contexto del browser. Si el nombre y el precio no están en ese HTML, el AC-2 no se cumple, sin
importar lo que muestre la página hidratada.

El JSON-LD se extrae del `<script type="application/ld+json">` y se valida como objeto: `@type`
`Product`, y que el precio y la disponibilidad coincidan con los de la API. No se valida contra un
schema externo — eso es el charter TC-340.

### AC-9 — el cruce de superficies

Es el único escenario que necesita **las dos** superficies en un mismo test:

1. leer la ficha pública y registrar el precio,
2. cambiar el precio vía API admin (reusando el fixture de auth de US-001),
3. esperar la ventana de caché declarada,
4. releer la ficha y asertar el precio nuevo.

El paso 3 es deliberado: asertar "inmediatamente después" no probaría nada, porque el backend
declara `max-age=60`. El test respeta el contrato de caché en vez de ignorarlo.

### Datos de test

Se reusa `seed.ts` de US-001 (siembra vía API real, SKU con prefijo por-run). Se agregan los estados
que esta US necesita y que el seed actual no produce: producto **sin stock**, producto **sin imagen**,
producto **archivado**. Todos por la API admin, sin tocar la base directamente — salvo el dataset de
carga, que sigue usando `seed:load`.

### Accesibilidad

Dos corridas de axe sobre la misma ruta: con imagen y con placeholder. La segunda es la que importa
— el `alt` del placeholder es requisito explícito del AC-6 y es donde la a11y se rompe en la práctica.

### Carga

Se agrega el tag `endpoint:storefront_product` a `thresholds.js`, que sigue siendo la **fuente única**
de budgets. El escenario reusa el dataset de `seed:load`. La ficha pública no requiere auth, así que
el `setup()` no hace login — a diferencia del baseline de US-001.

## Trade-offs

| Decisión | Alternativa descartada | Por qué |
|---|---|---|
| Asertar SSR con JS deshabilitado | Asertar sobre la página hidratada | La alternativa da falso verde: no distingue SSR de CSR, que es exactamente el AC-2 |
| Esperar la ventana de caché en AC-9 | Asertar inmediatamente | Asertar inmediato no prueba nada; el backend declara `max-age=60` y el test debe respetar el contrato |
| Extender `@dsm/qa` | Paquete nuevo por US | La regresión debe acumularse en un solo lugar: US-002 y US-007 heredan estos escenarios |
| Planificar antes que exista el FE | Esperar a la implementación | Los AC observables escritos primero hacen que el FE se construya contra ellos, no al revés |

## Open questions

Ver `proposal.md` §Open questions — OQ-QA-1 (ejecución espera FE-US-003) y OQ-QA-2 (la cláusula de
URL amigable del AC-1 espera OQ-BE-1).

## References

- `qa-three-layer-regression` — el modelo de tres capas.
- `playwright-stability` — locators por rol, sin `waitForTimeout`.
- `k6-load-scaffolding` — thresholds derivados del NFR.
- `accessibility-audit` — axe-core sobre Playwright.
- Suite base: `qa/` (`@dsm/qa`).
