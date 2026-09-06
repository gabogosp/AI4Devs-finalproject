# Design — US-025 QA: reseñas y calificaciones de productos

## Contexto

Igual que `US-024-edicion-perfil-cliente-qa`: US-025 no tiene todavía ningún
change de BE/FE — este plan se escribe contra los 9 AC de la US, Modo B
standalone.

## D-QA1 — Escenarios derivados de los AC, no re-inventados

Cada escenario Gherkin de `qa-plan.md` §3 mapea 1:1 a un AC de la US. La
decisión de negocio más sensible de esta US (¿qué cuenta como "comprado"?)
ya la fijó el enrich: **orden en estado `delivered`**, no sólo pagada — este
plan la toma tal cual, no la reabre.

## D-QA2 — Elegibilidad se prueba con una orden real en `delivered`, no con un flag

El seed que este plan necesita **ya existe**: `qa/support/seed-ordenes.ts`
expone `crearOrdenEnEstado(..., 'delivered')`, que hace el checkout real +
`simulate-payment` + los `PATCH` de avance de estado hasta `delivered` (no
un `UPDATE` directo a la tabla — mismo principio de "todo vía la API real"
que el resto de `qa/`, ver `seed-carrito.ts`). Los escenarios de elegibilidad
(SC-025-H1, SC-025-N1) reusan esa función en vez de escribir un seed nuevo.

## D-QA3 — Carga (K6) es opcional y de scope chico

La US no declara un NFR numérico propio de volumetría de reseñas (§9 de la
US es sobre timing de cálculo del promedio, no throughput). Este plan agrega
un smoke de K6 muy chico (§ "Carga", opcional) sólo para confirmar que
`GET /v1/products/:slug/reviews` no colapsa con un catálogo de reseñas
realista (decenas por producto, per la propia US §9) — no es un gate de
merge, es una verificación de sanidad, per `performance-standards.md` §7
("todo NFR necesita un número" — acá no hay uno declarado, así que no se
inventa un threshold estricto, se corre y se reporta).

## D-QA4 — Moderación se prueba como transparencia, no como censura silenciosa

AC-8 exige que el cliente autor vea su reseña marcada "oculta por
moderación" si vuelve a la ficha, no que desaparezca sin explicación. El
escenario correspondiente (SC-025-H5) verifica AMBAS superficies: la pública
(ya no cuenta en el promedio) y la del propio autor (sigue viéndola, con el
estado explícito) — omitir la segunda daría un falso verde a una regresión
de "moderación = borrado silencioso".

## Trade-offs

- Mismo trade-off que US-024-qa: el plan puede necesitar ajuste menor cuando
  el `design.md` real de BE-US-025 fije la forma exacta del endpoint/schema.
  Se acepta a cambio de tener el plan listo el día que BE/FE cierren.
- El scope de la US es L (grande) — este `qa-plan.md` cubre los 9 AC tal
  como están, sin dividir en fases; si el arquitecto divide BE-US-025 en
  fases (ej. reseñar+listar primero, moderación después), este plan puede
  necesitar dividirse en paralelo — se anota como riesgo, no se decide acá.

## Open questions

Ninguna sin resolver — ver `proposal.md`.

## Referencias

- US: `docs/user-stories/US-025-resenas-calificaciones-productos.md`
- Seeds reusados: `qa/support/seed-ordenes.ts` (`crearOrdenEnEstado`),
  `qa/support/customer-auth.ts`
- Precedente D-QA: `openspec/changes/US-024-edicion-perfil-cliente-qa/design.md`
