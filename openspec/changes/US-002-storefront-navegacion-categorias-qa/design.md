---
parent-us: US-002
discipline: qa
language: es
---

# US-002 QA — Diseño de la suite

## Context

El paquete `@dsm/qa` existe desde US-001 y US-003 lo extendió con la primera superficie pública.
US-002 lo extiende de nuevo, con dos cosas que la suite todavía no tiene: **verificación de sitemap**
y **navegación por teclado**. El resto —fixtures, seed, thresholds, CI— se reusa.

## Goals

- Certificar los 10 AC de punta a punta contra el stack real.
- Cubrir lo que ninguna capa dev-owned ve: el HTML servido, el sitemap, los Core Web Vitals con
  catálogo real y la operabilidad por teclado.
- Dejar la regresión del browse lista para que la hereden US-004 (búsqueda) y US-007 (carrito).

## Non-goals

- Re-testear la agregación rubro+subrubros, la paginación o la exclusión de no-publicados a nivel
  API: el backend ya las cubre con Postgres real.
- Testear la ficha de producto (US-003) más allá de que el enlace llegue bien.

## Approach

### SSR — misma técnica que US-003, mismo motivo

Las aserciones de AC-10 corren sobre el HTML **con JavaScript deshabilitado**. Con JS activo,
Playwright hidrata y una grilla renderizada en cliente se ve idéntica a una renderizada en servidor:
el test pasaría y el AC seguiría incumplido. Si los productos no están en el HTML crudo, no hay SSR.

### Sitemap — lo nuevo de esta US

El sitemap no es un endpoint del backend: es un artefacto del sitio (FE-owned, per el split
declarado en el proposal del backend). Se verifica pidiéndolo al sitio servido y asertando dos cosas
complementarias:

- **inclusión**: las categorías publicadas están,
- **exclusión**: una categoría inexistente **no** está.

La segunda es la que importa y se olvida: un sitemap generado desde una lista mal filtrada publica
URLs fantasma que Google indexa y después hay que despublicar.

### Carga — recorrer páginas, no martillar una

El listado tiene `Cache-Control: max-age=60`. Un k6 que pida siempre el mismo offset mide la caché,
no la base — daría un p95 excelente y falso. El escenario **varía el offset** para recorrer páginas
distintas del catálogo sembrado, que es el patrón de acceso real de alguien navegando.

### Accesibilidad — axe no alcanza

axe-core detecta contraste, `alt` faltante y jerarquía de headings, pero **no** detecta que un
control sea inalcanzable con `Tab` o que el foco no sea visible. El árbol de navegación y la
paginación son los controles de mayor tráfico del storefront, así que se agrega un recorrido
explícito por teclado (`Tab`/`Enter`) asertando orden lógico y foco visible.

### Datos de test

Se extiende el seed con la topología que esta US necesita y que el de US-003 no produce: un rubro
con **subrubros**, productos repartidos entre rubro y subrubro (para verificar la agregación D1),
una categoría **sin productos publicados**, y productos en `draft`/`archived` dentro de una
categoría poblada (para AC-8). Todo vía API admin, como el resto.

### La costura con US-003 (X-1)

Es el escenario que justifica la capa: la grilla arma un enlace con un identificador y la ficha lo
resuelve con otro. Si esos dos divergen —exactamente lo que pasaría hoy con `sku` vs `slug`, ver
proposal §OQ-QA-2— ningún test de US-002 ni de US-003 por separado lo detecta. Sólo el que hace clic.

## Trade-offs

| Decisión | Alternativa descartada | Por qué |
|---|---|---|
| SSR con JS deshabilitado | Asertar sobre la página hidratada | No distingue SSR de CSR, que es exactamente AC-10 |
| k6 recorriendo offsets | Martillar un offset fijo | Con `max-age=60` mediría la caché y daría un p95 falso |
| Recorrido de teclado explícito | Confiar en axe | axe no ve alcanzabilidad ni foco visible |
| Sitemap: inclusión **y** exclusión | Sólo verificar que existan las publicadas | El fallo caro es la URL fantasma indexada, no la ausente |
| Extender `@dsm/qa` | Paquete por US | La regresión se acumula en un solo lugar |

## Open questions

Ver `proposal.md` §Open questions — OQ-QA-1 (ejecución espera FE + backend desarrollado) y
**OQ-QA-2** (propagar D-1 al plan de backend: el enlace debe ser por `slug`, no por `sku`).

## References

- `qa-three-layer-regression` · `playwright-stability` · `accessibility-audit` · `k6-load-scaffolding`
- Suite base: `qa/` (`@dsm/qa`)
- Split BE/FE de AC-4 y AC-10: proposal del change de backend de US-002
