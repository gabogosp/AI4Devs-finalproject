---
parent-us: US-014
discipline: qa
language: es
---

# US-014 QA — Design

## Context

La estrategia de US-014 no se decide en el vacío: las dos disciplinas ya cerraron sus
suites y hay **mucho** cubierto. El riesgo real de este plan no es dejar un AC sin
probar, es **duplicar** lo que ya existe y presentarlo como cobertura nueva. Por eso
`qa-plan.md` §1 arranca con la tabla de quién cubre qué y lo que este plan agrega es
sólo lo que ninguna de las dos capas puede afirmar sola.

## Decisiones

### D1 — La capa nueva se define por el **doble**, no por la herramienta

El frontend ya tiene E2E de Playwright de auth (`auth-topology`, `auth-journey`,
`auth-recuperacion`). Repetirlos acá con otra herramienta sería teatro. Lo que los
distingue es contra **qué** corren: los del FE usan `api-stub.mjs`, donde bcrypt es
`===`, el rate-limit se dispara con `x-force-rate-limit: 1` y la rotación del refresh es
un `Map`. Esta suite corre contra la **API real**, así que puede ver:

- una diferencia de **latencia** entre email existente e inexistente (bcrypt real la
  introduce; el stub no la tiene y por eso su suite no puede detectarla);
- que el refresh **rotado** revoque la familia (ADR-0011) contra el almacén de Postgres;
- que el rate-limit real se dispare por volumen y no por un header de prueba.

### D2 — Tres AC son propiedades, no features, y se prueban distinto

AC-5/6/11 (anti-enumeración), AC-8 (la contraseña no se expone) y AC-9 (cookie +
rotación) **no se ven en la UI**. Se prueban con `APIRequestContext` sobre status,
cuerpo, headers, cookies y —en el caso de AC-8— el **stdout del proceso de la API**,
porque un log con la credencial es el modo de fallo real y es invisible desde el
cliente. Un escenario que los verificara mirando el DOM afirmaría algo más débil que el
criterio.

### D3 — La latencia se acota con una banda amplia, no con un umbral

Afirmar anti-enumeración sin mirar el tiempo deja el criterio a medias: un atacante
distingue los casos cronometrando. Pero un umbral fino en CI es flaky por definición. La
decisión: **un orden de magnitud** (el inexistente no puede responder en menos de un
décimo del existente). Es débil a propósito y detecta el caso que importa —el que
saltea bcrypt por completo cuando el email no existe—.

### D4 — TC-146 corre en su propio proceso

`qa/scripts/api-up.sh` eleva `AUTH_RATE_LIMIT_MAX` a 100.000 porque, con el presupuesto
de producción, cada escenario que hace login real autobloquea la suite al sexto. Pero
TC-146 **es** el test del límite. No se puede tener las dos cosas en un proceso: se
levanta una API aparte con el valor real y sólo ese escenario apunta ahí.

### D5 — Cada escenario siembra su propia cuenta

El lockout de US-014 es progresivo y persiste en `customers.locked_until`. Una cuenta
compartida entre escenarios haría que TC-146 (que la bloquea a propósito) rompa a TC-141
según el orden de ejecución — el mismo modo de fallo que ya se cobró TC-724/TC-725 en
US-007. Cuenta por escenario, con email de prefijo único por corrida.

## Trade-offs

**Base compartida vs base propia para QA.** Se sigue con la compartida (OQ-QA-1) porque
levantar otra Postgres es trabajo de infraestructura que este plan no puede absorber, y
el prefijo único mitiga la colisión de emails. El costo está documentado y ya se cobró
una víctima: `TC-204` de US-002 falla por categorías sembradas por otras sesiones. Con
una cuarta suite en paralelo conviene revisarlo.

**Verificar la entrega del email vs el token de test.** Se usa el token que la API
expone en test. Probar la bandeja real requiere una cuenta de correo de prueba y vuelve
la suite dependiente de un tercero; el flujo de AC-4 se ejerce completo igual. La
entrega queda como verificación del PO.

**Medir carga sobre login vs sobre el recorrido completo.** Sólo login: es la operación
que el PRD §4 acota con un número y la única con costo real (bcrypt). Un escenario de
carga del recorrido entero mediría sobre todo el navegador.

## Open questions

Las cuatro viven en `proposal.md` §Preguntas abiertas con su default. Ninguna bloquea la
ejecución; **OQ-QA-1** (base propia para QA) es la que conviene decidir antes de sumar
más suites en paralelo.

## References

- `qa-plan.md` de este change (matriz, escenarios, stubs, entorno)
- Precedente del harness: [`US-007-carrito-compra-qa`](../US-007-carrito-compra-qa/qa-plan.md) y sus dos hallazgos preexistentes anotados
- ADR-0011 (rotación y detección de reuso del refresh), ADR-0013 (rewrite same-origin), ADR-0005 (auth propia)
- Standards: `qa-frontend-standards.md` §2.1/§19/§23 · `qa-backend-standards.md` §2.1 · `performance-standards.md` §7 · `security-standards.md` §3/§4/§7 · `testing-standards.md` §14
