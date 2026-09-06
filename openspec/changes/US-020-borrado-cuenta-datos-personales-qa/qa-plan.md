# QA Plan — US-020 Borrado de cuenta y datos personales (derecho al olvido)

> **Ticket**: US-020 — Borrado de cuenta y datos personales (Ley 25.326)
> **Author**: qa-engineer agent (assisted by @gosp)
> **Date**: 2026-09-06
> **Status**: Planned, pre-implementation — ver §0 "Estado de bloqueo" (ningún test
> case corrió todavía; el backend de esta US no existe en `main`)
> **Affected platform(s)**: backend (superficie única planeada por ahora — no hay
> `US-020-...-frontend-web` en `openspec/changes/` ni en el índice)
> **Service tier(s)**: 2 (`docs/services/dsm-ecommerce/runbook.md` frontmatter —
> única fuente de tier de este repo, mismo criterio que
> `US-013-cancelacion-reembolso-qa`/`US-021-...-backend/qa-plan.md`) **con AC-2,
> AC-10, AC-11 y AC-14 tratados como Tier 1**: ninguno es de alto volumen, pero
> los cuatro protegen la exposición legal directa de la Ley 25.326 que el PRD §6
> compromete por escrito — mismo patrón que `US-013-...-qa` aplicó a sus AC que
> protegen dinero real.
> **Companion files**: este `qa-plan.md` vive en su propio change **sibling**
> (`openspec/changes/US-020-borrado-cuenta-datos-personales-qa/`, sin
> `proposal.md`/`tasks.md`/`design.md` propios — Modo A no los requiere; la rama
> de esta disciplina, `feat/US-020-borrado-cuenta-datos-personales-qa`, no
> coincidiría con el nombre de ningún directorio embebido de código —
> `check-pr-scope.sh` exige que el directorio del change coincida con la
> rama/PR — mismo motivo exacto documentado por `US-016-panel-metricas-qa` y
> `US-013-cancelacion-reembolso-qa`). **No consume ningún `proposal.md`/
> `design.md` de backend como contexto** porque **no existe todavía** — ver §0.

---

## 0. Por qué este plan se escribe antes de que exista el backend, y qué implica

**Excepción explícita, con precedente en este repo**: al momento de escribir este
plan, `openspec/changes/US-020-borrado-cuenta-datos-personales-backend/` **no
existe** en este worktree (verificado: `find openspec/changes -maxdepth 1
-iname "US-020-*"` no devuelve nada más que este propio directorio de QA). El
backend de US-020 se está planificando/construyendo en paralelo, en otro
worktree, sobre su propia rama — no en `main` todavía. Este plan **no espera**
ese merge: se deriva directamente de los 15 AC de
`docs/user-stories/US-020-borrado-cuenta-datos-personales.md` (ya `Ready`,
sin preguntas de producto abiertas — las 5 decisiones de su §10 están
cerradas) más la tabla de consecuencias operativas de su §10 (qué hace el
flujo con cada relación `onDelete` que el esquema no dispara solo) y sus NFR
§9 (todos cuantificados, ninguno `TBD`).

**Consecuencia directa, declarada sin ambigüedad**: **todos** los test cases
automatizados de este plan quedan `blocked_by: US-020-backend (no planificado
ni mergeado en este worktree)`. Ninguno corrió. Este plan es ejecutable
íntegramente el día que ese backend llegue a `main` — es la superficie de
entrada de `/develop-qa`, no una simulación de resultados. Mismo criterio que
`US-021-retencion-datos-ordenes-backend/qa-plan.md` aplicó cuando se
planificó contra un `tasks.md` de 0/16 tareas ejecutadas, sólo que acá el
change de backend ni siquiera tiene `design.md` propio en este worktree
todavía — de ahí que las referencias a "el backend" en este plan citen
exclusivamente la US y la nota de orientación de diseño recibida (ver
referencias, §17), nunca un `design.md` que no existe acá.

### Supuestos de diseño a reconciliar cuando el `design.md` real llegue

Este plan asume (nota de orientación del coordinador, **no verificado contra
código real**) que el endpoint de borrado:

1. Vive en un `AccountModule` nuevo, reutiliza `CustomerGuard` + `CsrfGuard` —
   el mismo doble-submit CSRF por cookie legible (`dsm_csrf`) que
   `qa/support/customer-auth.ts` ya sabe satisfacer para `logout`/`refresh`.
   **Si el `design.md` real usa un nombre de cookie o un guard distinto, los
   escenarios de este plan no cambian de forma — sólo el helper que agrega el
   header CSRF.**
2. Sobrescribe `customers.name`/`email`/`phone` con un valor **único por
   fila** (a diferencia del placeholder fijo de US-021, porque
   `customers.email` sí tiene restricción de unicidad) y sella
   `deleted_at`, en una única transacción con la revocación de tokens y la
   anonimización de órdenes. **Si el `design.md` real cambia el mecanismo de
   unicidad (UUID vs timestamp vs hash), AC-6/SC-020-A3 no cambia — sigue
   siendo "dos borrados simultáneos, cero colisión", verificable sin conocer
   el mecanismo interno.**
3. Agrega el valor de enum `account_deletion` a la misma columna
   `orders.anonymization_reason` que US-021 ya usa (`retention_policy`,
   `requested`), ensanchando el `CHECK` de 2 a 3 valores. **Si el nombre
   exacto del enum difiere, SC-020-H3 lo reconcilia sustituyendo el string
   literal, sin rediseñar el escenario.**
4. Revoca `refresh_tokens` y `password_reset_tokens` pendientes reusando los
   repositorios de US-014 — el mismo mecanismo que ya prueba
   `qa/support/customer-auth.ts` (`logout`, `pedirReset`,
   `tokenDeResetDesde`). **Este punto es el de mayor confianza de los
   cuatro**: US-014 ya está archivado y esos helpers ya corren contra la API
   real hoy.

Ninguno de estos cuatro supuestos cambia el **comportamiento observable** que
los AC fijan — cambiarían, a lo sumo, el nombre de un campo interno o un
helper de siembra. Se declaran acá para que quien ejecute este plan cuando el
`design.md` real exista sepa exactamente qué reconciliar primero.

---

## 1. Perfil de riesgo

| Riesgo | Por qué importa acá |
|---|---|
| **Es la primera superficie del proyecto que un cliente activa contra sí mismo, con efecto irreversible por diseño** (US §10, decisión 3) | US-021 anonimiza a pedido del dueño o por barrido automático — nunca lo dispara la propia persona. Acá el disparador es autoservicio: un bug deja a un cliente real sin cuenta y sin forma de recuperarla, en producción, sin ventana de gracia (AC-11). |
| **AC-6 (colisión del placeholder único) es el caso borde que más se diferencia de US-021 y el que más fácil es de no probar** | `customers.email` tiene restricción de unicidad; `orders.buyer_email` no. Un test que borra una sola cuenta nunca ejercitaría esta restricción — hace falta borrar dos cuentas reales, en secuencia y en paralelo, para que la unicidad del valor de reemplazo se ponga a prueba de verdad. |
| **AC-9 es una condición de carrera declarada explícitamente en el AC, no una preocupación de QA añadida después** | El propio AC-9 exige verificar "al ejecutar, no sólo al mostrar la pantalla" — dos sub-casos con dirección opuesta (una orden entra entre que se ve la pantalla y se confirma → debe rechazar; una orden se resuelve mientras tanto → debe proceder sin recargar). Un test que sólo verifica "con orden activa rechaza" y "sin orden activa permite" en aislamiento no prueba la propiedad que el AC realmente exige: el momento de la verificación. |
| **AC-10 son tres puertas de acceso, cada una con su propio mecanismo, y las tres tienen que fallar IGUAL que "el email nunca existió"** | Login con credenciales viejas, una sesión que quedó abierta en otro dispositivo (refresh token vivo), y un link de recuperación de contraseña pendiente son tres código-paths distintos en el backend (`login`, `refresh`, `password-reset/confirm`). Verificar sólo una de las tres deja las otras dos sin evidencia — y la disciplina de anti-enumeración (misma respuesta que un email inexistente) es fácil de romper accidentalmente en cualquiera de las tres sin que ningún test de un solo módulo lo note, porque cada handler la implementa por separado. |
| **AC-12 es el mismo patrón que ya rompió una vez en la industria de "borrar PII" sin ese cuidado: el negocio deja de cuadrar sus propias ventas** | Mismo riesgo exacto que AC-2 de `US-021-...-qa` ya cubrió para las órdenes ancianas; acá el disparador es distinto (autoservicio del cliente, no barrido ni pedido del dueño) — el mecanismo que protege el agregado (mantener el vínculo `customer_id`, anonimizar sólo la PII) es el mismo, pero nunca se ejercitó desde ESTE disparador. |
| **AC-14 (sin PII en observabilidad) es la obligación que más fácil es de romper sin que ningún assert HTTP lo detecte** | Un log de auditoría bien intencionado ("se borró la cuenta de Juan Pérez, juan@mail.com") pasaría cualquier test que sólo mire la respuesta HTTP. Sólo un grep explícito contra el log real, después del borrado, puede detectar esta clase de fuga — y es exactamente la misma disciplina que ya aplicaron `US-021`/`US-011` a sus propias operaciones de anonimización. |
| **AC-15 (doble confirmación, un solo efecto) es idempotencia bajo escritura real, con dos disparadores realistas (doble clic, dos pestañas) que un solo POST no reproduce** | Sin un disparo verdaderamente concurrente (dos requests que lleguen dentro de la misma ventana de transacción), un test secuencial de "llamo, y después llamo otra vez" prueba idempotencia post-hoc, no la ausencia de una carrera real en la transacción — que es lo que "doble clic" y "dos pestañas" describen literalmente. |

Journeys críticos identificados:

1. Un cliente con sesión iniciada y sin órdenes en curso entra a su cuenta,
   confirma el borrado, y queda de inmediato como visitante anónimo, con las
   tres puertas de reingreso cerradas (AC-1, AC-2, AC-10).
2. Un cliente con historial de compras entregadas borra su cuenta: el
   historial sobrevive anonimizado, las métricas del dueño no se mueven, y
   nadie puede reconstruir quién fue el comprador (AC-2, AC-3, AC-12, AC-14).
3. Un cliente con una orden en curso intenta borrar y es bloqueado con una
   explicación accionable — y el sistema vuelve a evaluar esa condición en el
   instante exacto de la confirmación, no antes (AC-4, AC-9).
4. Dos clientes reales, distintos, borran su cuenta uno después del otro (o
   los dos a la vez) sin que ninguno falle por el otro (AC-6, AC-15).

### 1.1 Ownership — capas dev-owned (coverage-awareness, no se re-planifican acá)

Per `qa-backend-standards.md` §2.1: cuando `US-020-...-backend/tasks.md`
exista, las capas siguientes son responsabilidad del desarrollador (TDD) y
**no se re-autoran en este plan** — sólo se anota la expectativa general,
porque hoy no hay `tasks.md` real contra el cual mapear IDs de tarea:

- **Unit**: la lógica transaccional completa del borrado (orquestación de los
  4 efectos: anonimizar cuenta, revocar tokens, desvincular carritos,
  anonimizar órdenes históricas); la función de generación del valor único de
  anonimización; el guard de órdenes en curso evaluado con Postgres real
  (mock o integration directa); el mapeo de errores.
- **Integration**: la migración que ensancha el `CHECK` de
  `orders.anonymization_reason` a 3 valores, contra Postgres real; el
  repositorio de revocación de tokens (reuso de US-014).
- **Smoke / contract staging**: validación del YAML de OpenAPI del nuevo
  endpoint contra Spectral, si el change de backend publica uno.

Este plan (`qa-plan.md`) cubre exclusivamente lo QA-owned: aceptación BDD
(§4-§5), regresión persistente (§9, tags `@regression`), performance k6 (§8),
y exploratorio (§9.6) — todo contra la API real corriendo, nunca contra
Postgres directo ni contra el proceso interno del backend.

### 1.2 Gap FE — explícito, no rellenado en silencio

`US-020-...-frontend-web` no existe como change (ni en `openspec/changes/`
ni en el índice). La US §8 pide: sección "borrar mi cuenta" en `/mi-cuenta`,
confirmación destructiva de dos pasos, manejo de rechazo por órdenes en
curso, cierre de sesión y retorno como visitante. Nada de esto tiene tarea ni
código hoy.

**Consecuencia para este plan**: todo escenario redactado en la US como "el
cliente entra a la sección de su cuenta y confirma" se escopea acá a **nivel
API únicamente** — se llama al endpoint real (cuando exista) con el método
HTTP correcto, nunca se simula una UI que no existe. Cuando exista
`/plan-frontend-web-ticket US-020` (o el change que materialice esa FE), ese
plan de QA de frontend/E2E debe cubrir:

1. La confirmación destructiva de dos pasos como interacción de UI
   (Playwright, Layer 2/3) — AC-1, AC-7 (el "arrepentirse antes de
   confirmar" de AC-7 es, en rigor, un comportamiento 100% de UI: "no
   disparar la llamada" no tiene una superficie API que probar por sí sola —
   ver nota en §5.2).
2. Accesibilidad del flujo (WCAG 2.1 AA, foco gestionado, `aria-live`) — US
   §9, último punto. Ninguna capa de este plan la cubre (backend puro).
3. El texto de la explicación de bloqueo (AC-4) renderizado como lo ve el
   cliente — este plan sólo verifica que la API devuelve los datos
   necesarios (cantidad y detalle de órdenes bloqueantes), no el copy final.

---

## 2. Mapeo de la pirámide (capas QA en negrita)

| Capa | Dueño | Estado |
|---|---|---|
| Unit backend (transacción, generador de valor único, guard de órdenes en curso) | dev | ⏳ no planificado en este worktree (backend sin `tasks.md` acá) |
| Integration backend (migración del `CHECK`, repositorios de revocación) | dev | ⏳ no planificado |
| **Aceptación BDD (API-level, contra Postgres real)** | **QA** | este plan — **`blocked_by` el backend** |
| **Regresión persistente** (AC-6, AC-9, AC-10, AC-13, AC-15) | **QA** | este plan — **`blocked_by`** |
| **Performance (k6)** | **QA** | este plan — **`blocked_by`** — ver §8, decisión explícita: SÍ se arma |
| **E2E de navegador / accesibilidad** | **QA** | diferido — no hay FE planificado, ver §1.2 |
| **Exploratorio** | **QA** | este plan (manual) — 3 charters, ver §9.6 |

---

## 3. Matriz de trazabilidad: AC × escenario × capa

Leyenda: **QA-ACC** = aceptación BDD API-level, este plan · **QA-PERF** =
carga k6, este plan · **TC-E** = charter exploratorio · **FE (diferido)** =
cubierto por el futuro `qa-plan.md` de frontend, no acá.

| AC | Escenario(s) | **QA-ACC** | **QA-PERF** | **TC-E** | Nota |
|---|---|---|---|---|---|
| **AC-1** self-delete inmediato, sesión cerrada | SC-020-H1 | **H-1** | — | — | — |
| **AC-2** PII fuera de toda superficie | SC-020-H2 | **H-2** | — | — | incluye el check de exportación CSV existente (§4.1) |
| **AC-3** historial sobrevive anonimizado | SC-020-H3 | **H-3** | — | — | reusa el mecanismo de US-021 |
| **AC-4** bloqueado por órdenes en curso | SC-020-A1 | **A-1** | — | — | Esquema, 4 estados bloqueantes |
| **AC-5** email liberado, re-registro limpio | SC-020-A2 | **A-2** | — | — | — |
| **AC-6** colisión de placeholder único | SC-020-A3 | **A-3** | — | **TC-020-E1** (parcial) | secuencial + concurrente |
| **AC-7** arrepentirse antes de confirmar | — | **diferido a FE** | — | — | ver §1.2/§5.2 — no hay superficie API que probar sola |
| **AC-8** sin órdenes / ya anonimizadas | SC-020-A4 | **A-4** | — | — | Esquema, 2 casos |
| **AC-9** verificación al ejecutar (carrera) | SC-020-N1 | **N-1** | — | **TC-020-E2** | 2 sub-casos de dirección opuesta |
| **AC-10** tres puertas cerradas, anti-enumeración | SC-020-N2 | **N-2** | — | — | Esquema, 3 puertas |
| **AC-11** sin vuelta atrás ni ventana de gracia | SC-020-N3 | **N-3** | — | — | ausencia estructural, no un flujo positivo |
| **AC-12** métricas del dueño no se mueven | SC-020-N4 | **N-4** | — | — | cross-feature con US-016 |
| **AC-13** nadie borra la cuenta de otro | SC-020-N5 | **N-5** | — | — | Esquema, 3 actores |
| **AC-14** sin PII en observabilidad | SC-020-N6 | **N-6** | — | — | grep contra el log real |
| **AC-15** doble confirmación, un solo efecto | SC-020-N7 | **N-7** | — | **TC-020-E3** | automatizado (best-effort) + charter (real) |
| **NFR** p95 < 500ms, cuenta con hasta 50 órdenes | — | — | **QA-020-PERF-1** | — | `design.md` §9, `[propuesto — confirma Arquitecto]` en la propia US |

**Las 15 AC tienen ≥1 tratamiento QA explícito.** AC-7 es la única marcada
`diferido a FE` sin equivalente API — se explica en §5.2, no se fuerza un
test API-level artificial para una propiedad que es, por definición, "la
llamada nunca se disparó".

---

## 4. Escenarios Gherkin

`Feature: qa/acceptance/features/borrado-cuenta.feature`, tag de feature
`@borrado-cuenta`. Gherkin en español (`# language: es`), mismo criterio que
el resto de la suite. Los pasos correrán contra `Playwright.request`
(`APIRequestContext`), convención real del repo — nunca `supertest`.

**Siembra planeada**: reusa sin modificar `qa/support/customer-auth.ts`
(`nuevaCuenta`, `login`, `logout`, `me`, `refresh`, `pedirReset`,
`marcaDeLog`, `tokenDeResetDesde` — las tres puertas de AC-10 ya tienen su
helper real, construido para US-014) y `qa/support/seed-order-history.ts`
(`compraLogueada`, `compraLogueadaPendiente`, `compraLogueadaConSesion` — una
cuenta CON sesión que compra y confirma queda con `customer_id` real,
exactamente el dataset que AC-3/AC-4/AC-8/AC-9/AC-12 necesitan) más
`avanzarEstado`/`cancelarOrden` (de `seed-metricas.ts`/`cancelar-orden.ts`,
US-016/US-013) para alcanzar `delivered`/`cancelled`. **Ningún seeding nuevo
de infraestructura hace falta para llegar a los estados de partida** — sólo
un helper de una función para la acción bajo prueba (`borrarCuenta`, ver §7).

### 4.1 Happy path

```gherkin
@happy @critical-path
Escenario: H-1 — El cliente borra su cuenta y queda como visitante anónimo (AC-1)
  Dado un cliente registrado con sesión iniciada y sin órdenes en curso
  Cuando confirma el borrado de su cuenta
  Entonces el borrado se ejecuta de inmediato, en la misma respuesta
  Y su sesión (cookie de acceso y de refresco) queda cerrada
  Y una llamada siguiente con esa misma sesión ya no lo identifica como cliente

@happy @critical-path
Esquema del escenario: H-2 — Los datos personales dejan de existir en toda superficie consultada (AC-2)
  Dado un cliente registrado, con nombre, email y teléfono reales, que compró al menos una vez
  Cuando borra su cuenta
  Entonces "<superficie>" ya no muestra su nombre, su email ni su teléfono reales
  Y en su lugar aparece una indicación de que los datos fueron suprimidos

  Ejemplos:
    | superficie                                                        |
    | el detalle de esa orden en el panel del dueño (GET admin/orders)  |
    | el listado de órdenes del panel del dueño (GET admin/orders)      |
    | la exportación CSV existente que incluya datos de comprador, si la hay |

@happy
Escenario: H-3 — El historial comercial sobrevive anonimizado, igual que en US-021 (AC-3)
  Dado un cliente con una orden ya entregada y otra ya cancelada
  Cuando borra su cuenta
  Entonces ambas órdenes conservan sus ítems, cantidades, importes, estado y fechas
  Y ninguna orden ni ninguno de sus ítems desaparece
  Y cada orden queda con motivo de anonimización "account_deletion" y su fecha
```

### 4.2 Alternative path

```gherkin
@alternative @critical-path
Esquema del escenario: A-1 — Órdenes en curso bloquean el borrado, con el detalle que ya ve en su historial (AC-4)
  Dado un cliente con una orden real en estado "<estado>"
  Cuando intenta borrar su cuenta
  Entonces la solicitud se rechaza y ningún dato de la cuenta cambia
  Y la respuesta indica cuántas y cuáles son las órdenes que lo bloquean

  Ejemplos:
    | estado          |
    | pending_payment |
    | new             |
    | preparing       |
    | ready           |

@alternative
Escenario: A-2 — El email queda libre y el re-registro empieza de cero (AC-5)
  Dado una cuenta que borró su titular
  Cuando alguien se registra de nuevo con el mismo email
  Entonces el registro se completa como si fuera la primera vez
  Y esa cuenta nueva no expone historial, carrito ni dato alguno de la cuenta anterior

@alternative @critical-path @regression
Escenario: A-3 — Borrar dos cuentas distintas nunca colisiona por el valor de anonimización (AC-6)
  Dado dos clientes registrados distintos, cada uno con email real propio
  Cuando el primero borra su cuenta
  Y el segundo borra la suya inmediatamente después
  Entonces los dos borrados terminan sin error
  Y el valor que reemplaza el email de cada cuenta es distinto entre sí

@alternative @critical-path @regression
Escenario: A-3b — Borrar dos cuentas AL MISMO TIEMPO nunca colisiona (AC-6, concurrente)
  Dado dos clientes registrados distintos, cada uno con email real propio
  Cuando ambos disparan el borrado de su cuenta al mismo tiempo
  Entonces los dos borrados terminan sin error
  Y el valor que reemplaza el email de cada cuenta es distinto entre sí

@alternative
Esquema del escenario: A-4 — Cuenta sin compras, o con compras ya anonimizadas por retención, se borra igual (AC-8)
  Dado "<condición de partida>"
  Cuando el cliente borra su cuenta
  Entonces el borrado se completa sin error
  Y ninguna orden ya anonimizada cambia su motivo ni su fecha de anonimización

  Ejemplos:
    | condición de partida                                                          |
    | un cliente que nunca compró                                                   |
    | un cliente con una orden ya anonimizada por el barrido de retención de US-021 |
```

### 4.3 Negative space (lo que NO tiene que pasar)

```gherkin
@negative @critical-path @regression
Escenario: N-1a — Una orden que entra en curso justo antes de confirmar bloquea el borrado en la ejecución (AC-9)
  Dado un cliente sin órdenes en curso al momento de ver la pantalla de borrado
  Y una orden nueva sin pagar que se crea después, antes de confirmar
  Cuando confirma el borrado
  Entonces la solicitud se rechaza con la misma explicación que en AC-4
  Y ningún dato de la cuenta cambia

@negative @critical-path @regression
Escenario: N-1b — Una orden bloqueante que se resuelve justo antes de confirmar permite el borrado sin recargar (AC-9)
  Dado un cliente con una orden en curso al momento de ver la pantalla de borrado
  Y esa orden se entrega o se cancela después, antes de confirmar
  Cuando confirma el borrado con la misma solicitud original (sin recargar el estado)
  Entonces el borrado procede y se completa

@negative @critical-path @regression
Esquema del escenario: N-2 — Ninguna de las tres puertas de acceso vuelve a entrar, y las tres responden igual que un email inexistente (AC-10)
  Dado una cuenta que borró su titular, con "<estado previo>"
  Cuando "<intento>"
  Entonces la respuesta es indistinguible de la de un email que nunca existió
  Y no revela que la cuenta existió ni que fue borrada

  Ejemplos:
    | estado previo                                     | intento                                                          |
    | conocía email y contraseña originales             | intenta iniciar sesión con esas credenciales                     |
    | tenía una sesión abierta en otro dispositivo antes del borrado | esa sesión intenta refrescar su token de acceso     |
    | había pedido un enlace de recuperación de contraseña, sin usarlo, antes de borrar | intenta confirmar ese enlace pendiente |

@negative @regression
Escenario: N-3 — No existe ninguna vía para deshacer, recuperar ni consultar un borrado pendiente (AC-11)
  Dado una cuenta borrada
  Cuando se buscan endpoints de recuperación, deshacer o estado de borrado pendiente
  Entonces ninguno existe en la superficie pública ni en la admin
  # Verificación estructural (§9.6, TC-020-E-doc): se documenta contra el
  # OpenAPI publicado del backend cuando exista, no se "prueba" un endpoint
  # inexistente — la ausencia ES la aserción.

@negative @critical-path
Escenario: N-4 — El panel de métricas del dueño no se mueve por el borrado (AC-12)
  Dado un conjunto de órdenes de un cliente, ya contabilizadas en el resumen de métricas (US-016)
  Cuando ese cliente borra su cuenta
  Entonces el resumen de métricas para el período que las incluye trae los mismos totales, cantidades y productos vendidos que antes

@negative @critical-path @regression
Esquema del escenario: N-5 — Nadie más puede borrar la cuenta de otro (AC-13)
  Dado la cuenta real de un cliente, con sesión iniciada
  Cuando "<actor>" intenta borrarla
  Entonces la operación se rechaza
  Y ni la cuenta ni ninguna de sus órdenes cambia

  Ejemplos:
    | actor                                                    |
    | un visitante sin ninguna sesión                          |
    | otro cliente registrado, con su propia sesión válida     |
    | el dueño, con su token admin, desde el panel             |

@negative @critical-path
Escenario: N-6 — La PII borrada no sobrevive en los registros operativos (AC-14)
  Dado un cliente con nombre, email y teléfono reales y conocidos
  Cuando borra su cuenta
  Entonces ningún registro del proceso de la API contiene ese nombre, ese email ni ese teléfono, ni siquiera transformados
  Y el registro operativo permite saber que hubo un borrado y cuándo, sin identificar a la persona

@negative @critical-path @regression
Escenario: N-7 — Confirmar dos veces casi al mismo tiempo produce un solo efecto (AC-15)
  Dado un cliente con sesión iniciada y sin órdenes en curso
  Cuando dispara dos confirmaciones de borrado casi simultáneas para la misma cuenta
  Entonces el borrado se aplica una sola vez
  Y ninguna de las dos respuestas es un error de servidor
  Y no queda un segundo registro de auditoría ni una segunda pasada de anonimización sobre las mismas órdenes
```

**Tooling**: Cucumber-js + Playwright `request` fixture (mismo stack que
`retencion-ordenes.feature`/`cancelacion-ordenes.feature`).

**Location**: `qa/acceptance/features/borrado-cuenta.feature` +
`qa/acceptance/steps/borrado-cuenta.steps.ts`.

**Reuses**: `qa/support/customer-auth.ts` (íntegro, sin modificar —
`nuevaCuenta`, `login`, `logout`, `me`, `refresh`, `pedirReset`, `marcaDeLog`,
`tokenDeResetDesde`), `qa/support/seed-order-history.ts` (`compraLogueada`,
`compraLogueadaPendiente`, `compraLogueadaConSesion`,
`sembrarProductoPublicado`), `qa/support/seed-metricas.ts` (`avanzarEstado`,
`catalogoParaMetricas`), `qa/support/admin-auth.ts` (token admin real, para
N-5 y para leer `GET /v1/admin/reports/summary` en N-4).

---

## 5. Test cases owned-by-QA

### 5.0 Índice

| Test case | Escenario(s) | Herramienta | Layer | Bloqueado por |
|---|---|---|---|---|
| QA-020-ACC-1 | H-1, H-2, H-3 | Cucumber+Playwright | 3 | backend (no existe) |
| QA-020-ACC-2 | A-1, A-2, A-3, A-3b, A-4 | Cucumber+Playwright | 3 | backend (no existe) |
| QA-020-ACC-3 | N-1a, N-1b | Cucumber+Playwright | 3 | backend (no existe) |
| QA-020-ACC-4 | N-2 | Cucumber+Playwright | 3 | backend (no existe) |
| QA-020-ACC-5 | N-3 | documental (contra OpenAPI publicado) | 3 | backend (no existe) |
| QA-020-ACC-6 | N-4 | Cucumber+Playwright | 3 | backend (no existe) |
| QA-020-ACC-7 | N-5 | Cucumber+Playwright | 3 | backend (no existe) |
| QA-020-ACC-8 | N-6 | Cucumber+Playwright + grep de log | 3 | backend (no existe) |
| QA-020-ACC-9 | N-7 | Cucumber+Playwright (concurrente) | 3 | backend (no existe) |
| QA-020-PERF-1 | NFR p95 < 500ms | k6 | 3 | backend (no existe) |
| TC-020-E1 | AC-6 (charter) | manual | 3 | backend (no existe) |
| TC-020-E2 | AC-9 (charter) | manual | 3 | backend (no existe) |
| TC-020-E3 | AC-15 (charter) | manual | 3 | backend (no existe) |

**Por herramienta**: Cucumber+Playwright 7 · documental 1 · k6 1 · charter
manual 3. **12 test cases automatizados, 0 corridos** (todos `blocked_by` el
backend) **+ 3 charters manuales documentados, sin fecha de ejecución**.

### 5.1 Aceptación BDD — happy path

```yaml
- id: QA-020-ACC-1
  scenario: H-1, H-2, H-3
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "borrado-cuenta.feature — happy"
  name: BorradoDeCuenta_HappyPath_EjecutaInmediatoCierraSesionYAnonimizaHistorial
  blocked_by: US-020-backend (no planificado/mergeado en este worktree)
```

- Exit criterion: H-1, los 3 ejemplos de H-2 y H-3 pasan contra la API real +
  Postgres real, con cuentas y órdenes 100% nacidas de
  `nuevaCuenta`/`compraLogueada`/`avanzarEstado` reales — nunca de un
  `INSERT`/`UPDATE` directo.
- Verify: `pnpm --filter @dsm/qa test:acceptance -- --tags "@borrado-cuenta and @happy"` (exit 0)
- **Estado**: no corrido — `blocked_by` backend inexistente.

### 5.2 Aceptación BDD — alternative path

```yaml
- id: QA-020-ACC-2
  scenario: A-1, A-2, A-3, A-3b, A-4
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "borrado-cuenta.feature — alternative"
  name: BorradoDeCuenta_OrdenesEnCursoBloqueanYElPlaceholderUnicoNoColisiona
  blocked_by: US-020-backend (no planificado/mergeado en este worktree)
```

- Exit criterion: los 4 ejemplos de A-1, A-2, A-3 (secuencial), A-3b
  (`Promise.all` de 2 requests reales), y los 2 ejemplos de A-4 pasan. A-3/A-3b
  verifican explícitamente que el valor de reemplazo de `email` de las dos
  cuentas **difiere entre sí** — leído por `GET /v1/admin/orders/:id` de una
  orden de cada cuenta (proxy real, sin acceso directo a `customers`).
- Verify: `pnpm --filter @dsm/qa test:acceptance -- --tags "@borrado-cuenta and @alternative"` (exit 0)
- **Estado**: no corrido — `blocked_by` backend inexistente.
- **Nota sobre AC-7 (deliberadamente sin test case acá)**: "cancela, cierra la
  confirmación o abandona la página sin confirmar" describe una propiedad
  100% de UI — la ausencia de una llamada HTTP. No hay ningún request que
  disparar ni ninguna respuesta que verificar a nivel API: probar "no pasó
  nada" sin haber llamado a nada no es un test, es una tautología. Se
  documenta acá como `diferido a FE` (§1.2) en vez de fabricar un test API
  artificial para una propiedad que la US describe puramente en términos de
  interacción de UI.

### 5.3 Aceptación BDD — la carrera de AC-9 (negative space, verificación al ejecutar)

```yaml
- id: QA-020-ACC-3
  scenario: N-1a, N-1b
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "N-1a/N-1b — verificación al ejecutar, no al mostrar"
  name: BorradoDeCuenta_LaVerificacionDeOrdenesEnCursoSeHaceAlEjecutarNoAlMostrar
  blocked_by: US-020-backend (no planificado/mergeado en este worktree)
```

- Exit criterion: N-1a — una cuenta que no tenía órdenes en curso al momento
  de "ver la pantalla" (simulado: se lee el estado antes de crear la orden
  bloqueante) es rechazada si confirma DESPUÉS de que una orden entra en
  curso. N-1b — una cuenta con una orden en curso al "ver la pantalla" cuya
  orden se resuelve (`avanzarEstado` hasta `delivered`, o `cancelarOrden`)
  ANTES de confirmar, es aceptada, con la misma solicitud original (sin
  releer el estado del lado del test antes de confirmar — el test dispara la
  confirmación con el estado que tenía al principio, y es el backend quien
  debe re-evaluar).
- Verify: `pnpm --filter @dsm/qa test:acceptance -- --tags "@borrado-cuenta and @negative and not @regression"` (parte de la corrida completa; ver ACC-4/6/7/8/9 para el resto de `@negative`) (exit 0)
- **Estado**: no corrido — `blocked_by` backend inexistente.
- **Advertencia de diseño (a resolver cuando el `design.md` real exista)**:
  N-1a/N-1b son "carrera simulada por orden de operaciones", no una carrera
  real de dos procesos concurrentes — son deterministas y automatizables
  porque el test controla el orden temporal explícito (crear la orden ANTES
  de confirmar, no en simultáneo). La carrera VERDADERA (crear la orden
  exactamente durante la ventana de ejecución de la transacción de borrado)
  es responsabilidad de `TC-020-E2` (§9.6), que sí necesita timing real.

### 5.4 Aceptación BDD — las tres puertas de AC-10

```yaml
- id: QA-020-ACC-4
  scenario: N-2
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "N-2 — tres puertas cerradas, respuesta indistinguible de email inexistente"
  name: BorradoDeCuenta_LasTresPuertasDeAccesoQuedanCerradasYSonIndistinguiblesDeUnEmailInexistente
  blocked_by: US-020-backend (no planificado/mergeado en este worktree)
```

- Exit criterion: los 3 ejemplos de N-2 pasan. Puerta 1 — `login()` con el
  email/password originales de una cuenta ya borrada devuelve el MISMO status
  y forma de body que `login()` con un email que nunca existió (comparación
  explícita entre ambas respuestas en el mismo test, no un valor hardcodeado
  — así un cambio futuro en el mensaje de "credenciales inválidas" no rompe
  el test por el motivo equivocado). Puerta 2 — una sesión con `refresh_token`
  vivo ANTES del borrado (via `nuevaCuenta`) intenta `refresh()` después del
  borrado de esa misma cuenta y recibe rechazo. Puerta 3 —
  `pedirReset()`/`tokenDeResetDesde()` obtiene un token real ANTES del
  borrado; después de borrar, confirmar ese token con la nueva contraseña
  falla igual que confirmar un token nunca emitido.
- Verify: `pnpm --filter @dsm/qa test:acceptance -- --tags "@borrado-cuenta and @us-020-ac10"` (exit 0)
- **Estado**: no corrido — `blocked_by` backend inexistente.
- **Nota de reuso exacto**: las tres puertas usan, sin modificar, funciones
  que `qa/support/customer-auth.ts` YA expone y ya prueba contra la API real
  hoy para otros propósitos (US-014) — `login`, `refresh`, `pedirReset` +
  `tokenDeResetDesde`. Ningún helper nuevo de bajo nivel hace falta; sólo la
  orquestación puntual de "obtener el estado antes de borrar, borrar, volver
  a intentar".

### 5.5 Aceptación BDD — ausencia estructural de recuperación (AC-11)

```yaml
- id: QA-020-ACC-5
  scenario: N-3
  execution_mode: manual (documental)
  test_layer: 3
  target_tooling: revisión del OpenAPI publicado
  gherkin_scenario: "N-3 — no existe ninguna vía de recuperación"
  name: BorradoDeCuenta_NoExisteNingunEndpointDeRecuperacionNiDeConsultaDeBorradoPendiente
  blocked_by: US-020-backend (no planificado/mergeado en este worktree)
```

- Exit criterion: el `openapi.yaml` publicado del backend (cuando exista) no
  declara ningún endpoint de "deshacer borrado", "cancelar solicitud de
  borrado" ni "estado de borrado pendiente"; `design.md` de ese change no
  menciona ningún job diferido ni cola para esta operación.
- Verify: revisión manual del contrato publicado — no automatizable como
  aserción HTTP porque probar la ausencia de un endpoint inexistente contra
  un servidor real no distingue "no implementado todavía" de "deliberadamente
  ausente"; el contrato declarado es la única fuente que sí distingue las
  dos cosas.
- **Estado**: no corrido — `blocked_by` backend inexistente. `execution_mode:
  manual` es la elección correcta acá, no un default — no hay ninguna
  automatización razonable para "probar que algo no existe en el diseño".

### 5.6 Aceptación BDD — cross-feature con métricas (AC-12)

```yaml
- id: QA-020-ACC-6
  scenario: N-4
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "N-4 — el panel de métricas del dueño no se mueve"
  name: BorradoDeCuenta_ElResumenDeMetricasDelDuenoQuedaIdenticoAntesYDespues
  blocked_by: US-020-backend (no planificado/mergeado en este worktree)
```

- Exit criterion: `GET /v1/admin/reports/summary` para el período que incluye
  las órdenes del cliente, leído ANTES y DESPUÉS del borrado, trae
  `orders_count`/`total_ars_cents`/productos vendidos idénticos en ambas
  lecturas — mismo patrón que `SC-021-H2` de `US-021-...-backend/qa-plan.md`
  aplicó al barrido de retención.
- Verify: `pnpm --filter @dsm/qa test:acceptance -- --tags "@borrado-cuenta and @us-020-ac12"` (exit 0)
- **Estado**: no corrido — `blocked_by` backend inexistente.

### 5.7 Aceptación BDD — autorización (AC-13)

```yaml
- id: QA-020-ACC-7
  scenario: N-5
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "N-5 — nadie borra la cuenta de otro"
  name: BorradoDeCuenta_NingunActorDistintoDelTitularPuedeBorrarLaCuenta
  blocked_by: US-020-backend (no planificado/mergeado en este worktree)
```

- Exit criterion: los 3 ejemplos de N-5 son rechazados (visitante sin sesión,
  otra cuenta de cliente real con su propia sesión — via `Invitado`/2da
  `nuevaCuenta` —, y el token admin real intentando la misma ruta), y en los
  3 casos la cuenta objetivo sigue existiendo y consultable después del
  intento.
- Verify: `pnpm --filter @dsm/qa test:acceptance -- --tags "@borrado-cuenta and @us-020-ac13"` (exit 0)
- **Estado**: no corrido — `blocked_by` backend inexistente.
- **Nota de diseño**: el tercer ejemplo (el dueño con su token admin) es el
  más importante de probar explícitamente — es el único de los tres donde el
  actor SÍ tiene un token válido y con privilegios reales en el sistema; la
  US §10 decisión 4 lo excluye a propósito ("no es una acción del dueño desde
  el panel"), y es exactamente el tipo de guard que un `RolesGuard` mal
  configurado dejaría pasar sin que ningún test de "sin sesión" lo detecte.

### 5.8 Aceptación BDD — sin PII en observabilidad (AC-14)

```yaml
- id: QA-020-ACC-8
  scenario: N-6
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright + grep contra el log real del proceso
  gherkin_scenario: "N-6 — la PII borrada no sobrevive en los registros operativos"
  name: BorradoDeCuenta_NingunRegistroDelProcesoContieneElNombreElEmailNiElTelefonoBorrados
  blocked_by: US-020-backend (no planificado/mergeado en este worktree)
```

- Exit criterion: se toma `marcaDeLog()` antes de borrar (mismo patrón que
  `tokenDeResetDesde`); tras el borrado, se lee el log del proceso desde esa
  marca y se verifica, con `expect(log).not.toContain(...)`, que **no**
  aparece el nombre real, el email real ni el teléfono real de la cuenta
  borrada — ni en texto plano, ni en ninguna variante hasheada trivial
  (`sha256`/`md5` del valor original, calculado por el test y buscado
  también). El mismo log SÍ debe contener evidencia de que un borrado
  ocurrió (un `customer_id` interno o un evento nombrado), para no convertir
  "sin PII" en "sin observabilidad".
- Verify: `pnpm --filter @dsm/qa test:acceptance -- --tags "@borrado-cuenta and @us-020-ac14"` (exit 0)
- **Estado**: no corrido — `blocked_by` backend inexistente.
- **Mismo patrón que**: la disciplina de log-grep ya aplicada por US-021/
  US-011 a sus propias operaciones de anonimización — no se inventa un
  mecanismo nuevo.

### 5.9 Aceptación BDD — idempotencia de la doble confirmación (AC-15, best-effort automatizado)

```yaml
- id: QA-020-ACC-9
  scenario: N-7
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright (Promise.all)
  gherkin_scenario: "N-7 — confirmar dos veces casi al mismo tiempo produce un solo efecto"
  name: BorradoDeCuenta_DosConfirmacionesCasiSimultaneasProducenUnSoloEfecto
  blocked_by: US-020-backend (no planificado/mergeado en este worktree)
```

- Exit criterion: `Promise.all([borrarCuenta(ctx), borrarCuenta(ctx)])`
  (mismo `APIRequestContext`, misma cookie de sesión) contra una cuenta real
  sin órdenes en curso: ninguna de las dos respuestas es `5xx`; una orden
  histórica de esa cuenta (si tiene) queda con exactamente un registro de
  anonimización, no dos.
- Verify: `pnpm --filter @dsm/qa test:acceptance -- --tags "@borrado-cuenta and @us-020-ac15"` (exit 0)
- **Estado**: no corrido — `blocked_by` backend inexistente.
- **Límite honesto de este test (por qué también hay charter)**: `Promise.all`
  desde un solo proceso Node dispara los dos requests HTTP casi
  simultáneamente, pero no garantiza que ambos lleguen a la transacción de
  Postgres en la ventana exacta que produciría la corrida real más
  desfavorable — es "best-effort", no una prueba determinística de ausencia
  de carrera bajo cualquier interleaving posible. `TC-020-E3` (§9.6) es el
  complemento manual que explora variantes de timing que este test no
  controla (dos pestañas reales de navegador, con la latencia de red real
  entre ellas).

---

## 6. Contract testing — diferido, no ausente

No hay `qa/contract/borrado-cuenta.contract.ts` en este plan porque el
backend no publica todavía ningún `openapi.yaml` con este endpoint —
escribir un contract test contra un contrato que no existe fabricaría un
esquema propio y lo validaría contra sí mismo, que es teatro, no un test de
contrato. **Se agrega en la primera revisión de este plan que corra con el
`design.md`/contrato real del backend disponibles** — mismo criterio que
`US-021-...-backend/qa-plan.md` §5 aplicó (contract test contra el servidor
real, nunca contra el YAML estático en aislamiento).

---

## 7. Infraestructura de test

### Se reusa de `qa/` (sin modificar)

| Pieza | Para qué |
|---|---|
| `qa/support/customer-auth.ts` (`nuevaCuenta`, `login`, `logout`, `me`, `refresh`, `pedirReset`, `marcaDeLog`, `tokenDeResetDesde`) | identidad real de cliente para TODOS los escenarios; las tres puertas de AC-10 ya tienen su primitiva |
| `qa/support/seed-order-history.ts` (`sembrarProductoPublicado`, `compraLogueada`, `compraLogueadaPendiente`, `compraLogueadaConSesion`) | órdenes reales con `customer_id`, en `new`/`pending_payment`, para AC-3/AC-4/AC-8/AC-9/AC-12 |
| `qa/support/seed-metricas.ts` (`avanzarEstado`, `catalogoParaMetricas`) | avanzar una orden a `preparing`/`ready`/`delivered` |
| `qa/support/cancelar-orden.ts` (`cancelarOrden`) | llevar una orden a `cancelled` real (US-013), para AC-8/N-1b |
| `qa/support/admin-auth.ts` | token admin real, para N-4 (leer métricas) y N-5 (el dueño intentando borrar) |
| `qa/e2e/playwright.config.ts` | runner ya configurado, si en algún momento se agrega un E2E de navegador tras el FE |
| `qa/exploratory/charters.md` | se le agrega un apéndice, no se reescribe lo anterior |
| `qa/performance/lib/thresholds.js` | se le suma `delete_account` |

### Se agrega (dueño: este change, cuando se ejecute)

| Archivo | Qué hace |
|---|---|
| `qa/support/borrar-cuenta.ts` | Helper de una sola función (`borrarCuenta(ctx: APIRequestContext)`), llama al endpoint real de borrado con el header CSRF (mismo patrón `csrf()` interno de `customer-auth.ts`) — la acción bajo prueba, nunca un bridge de siembra |
| `qa/acceptance/features/borrado-cuenta.feature` | los 15+ escenarios de §4 |
| `qa/acceptance/steps/borrado-cuenta.steps.ts` | steps propios; reusa `customer-auth`/`seed-order-history`/`seed-metricas`/`cancelar-orden`/`admin-auth` sin modificarlos |
| `qa/performance/delete-account.js` | QA-020-PERF-1 |

---

## 8. Performance (k6) — decisión explícita: SÍ se arma la suite

**A diferencia de precedentes recientes de este repo que declararon "no k6"
(p. ej. `US-011-...-qa`, `US-021-...-backend/qa-plan.md` §6), acá SÍ se
justifica**: la propia US fija un NFR numérico y cuantificado, sin `TBD` —
"**p95 < 500 ms** para una cuenta con hasta 50 órdenes"
(`[propuesto — confirma Arquitecto]`, US §9) — a diferencia de US-021 (sin
NFR de latencia propio, sólo "no degrada el storefront") o US-011 (endpoint
de bajo volumen sin presupuesto explícito). Un NFR numérico explícito, atado
a un volumen concreto (hasta 50 órdenes), es exactamente el caso que
`k6-load-scaffolding` (§Threshold discipline) exige cubrir con un threshold
— la ausencia de este script dejaría el único NFR cuantificado de toda la US
sin ninguna medición.

**Diseño del script** (per `k6-load-scaffolding` §Data and correlation —
`setup()`/`SharedArray`, nunca credenciales/IDs hardcodeados):

- `setup()` pre-siembra N cuentas reales (`nuevaCuenta` + login), cada una
  con exactamente 50 órdenes reales `delivered` (checkout real +
  `simulate-payment` + `avanzarEstado` × 3, reusando
  `seed-order-history.ts`/`seed-metricas.ts`) — el costo de sembrar 50
  órdenes por cuenta se paga UNA VEZ en `setup()`, nunca dentro de la
  iteración medida (mismo criterio que `cancel-order-write.js` de
  `US-013-...-qa`: la acción bajo prueba es de un solo uso, así que cada
  iteración consume una cuenta pre-sembrada distinta, nunca reusada).
- Ejecutor `constant-vus` con `SharedArray` de credenciales de sesión
  pre-autenticadas (cookies de sesión ya obtenidas en `setup()`, per
  `k6-load-scaffolding` — correlacionar el token dinámico, nunca
  hardcodearlo).
- `checks`: status 200/204 esperado **y** que la sesión quede efectivamente
  cerrada (un `GET /v1/auth/me` inmediato posterior con la misma cookie
  responde "no identificado") — cerrar la sesión es parte del contrato
  observable del NFR, no sólo el código de status.
- `thresholds`: `http_req_duration{endpoint:delete_account}: ['p(95)<500']`
  + `http_req_failed: ['rate<0.01']` + `checks: ['rate>0.99']` — el único
  número que la US propone, sin inventar un p99 que la US no fija.

```yaml
- id: QA-020-PERF-1
  scenario: NFR p95 < 500ms, cuenta con hasta 50 órdenes (US §9)
  execution_mode: automated
  test_layer: 3
  target_tooling: k6
  gherkin_scenario: "NFR — p95 < 500ms, cuenta real con 50 órdenes delivered, sesión efectivamente cerrada"
  name: BorrarCuenta_ConCincuentaOrdenesReales_P95MenorAQuinientosMsYSesionCerrada
  blocked_by: US-020-backend (no planificado/mergeado en este worktree)
```

- Exit criterion: `qa/performance/delete-account.js` ejercita el endpoint de
  borrado contra cuentas reales pre-sembradas con 50 órdenes `delivered`
  cada una (una cuenta distinta por iteración — borrar es de un solo uso),
  con `checks` de status **y** de sesión efectivamente cerrada.
- Verify: `k6 run qa/performance/delete-account.js --summary-trend-stats="p(95)" 2>&1 | grep -q "✓"` (exit 0)
- **Estado**: no corrido — `blocked_by` backend inexistente.

---

## 9. Estrategia de datos de test

- **Cuentas y órdenes sintéticas nacidas del ciclo real** (`nuevaCuenta` →
  `compraLogueada`/`compraLogueadaPendiente` → `avanzarEstado`/
  `cancelarOrden`), nunca `INSERT`/`UPDATE` directo por Prisma — mismo
  criterio que `US-013-...-qa`/`US-021-...-backend/qa-plan.md`.
- **Una cuenta real por escenario que borra** — nunca se reusa una cuenta ya
  borrada para otro escenario (borrar es de un solo uso, literal).
- **Identidad de cliente real** para N-5 (otra cuenta intentando borrar la
  ajena), vía una segunda `nuevaCuenta()` — nunca un JWT minteado a mano.
- **Defaults deterministas**; el único valor no determinista es el prefijo de
  corrida (reusa `CORRIDA`/`contador` de `customer-auth.ts`), nunca aserido
  (`testing-standards.md` §5).
- **Aislamiento**: cada escenario crea su propia cuenta y sus propias
  órdenes; ningún escenario depende del residuo de otro
  (`qa-three-layer-regression` §Cross-layer rules) — crítico acá porque A-3/
  A-3b (colisión de placeholder) necesitan que las dos cuentas involucradas
  sean exclusivas de ese escenario.
- **Sintético únicamente**: ningún dato de producción; ningún email real de
  persona en ningún fixture.

### 9.6 Exploratorio (manual, justificado)

```yaml
- id: TC-020-E1
  execution_mode: manual
  test_layer: 3
  target_tooling: charter
  gherkin_scenario: "—"
  name: Charter_BorrarMuchasCuentasEnRafagaBuscandoUnaColisionDeValorUnico
```

- **Misión**: sondear AC-6 más allá de "dos cuentas" — disparar el borrado de
  decenas de cuentas reales en ráfaga rápida (más de lo que un test
  automatizado de 2 cuentas puede ejercitar razonablemente) buscando
  cualquier patrón de colisión en el valor de reemplazo del email, y revisar
  a simple vista la forma de esos valores (¿parecen timestamps predecibles?
  ¿un contador que un atacante podría enumerar?).
- **Áreas**: la fuente de aleatoriedad/unicidad del valor de reemplazo (una
  vez que el `design.md` real la revele); si dos borrados llegan en el mismo
  milisegundo, ¿el mecanismo de unicidad sigue sosteniéndose?
- **Riesgos**: un mecanismo de unicidad basado sólo en `Date.now()` sin un
  componente aleatorio o secuencial adicional podría colisionar bajo carga
  real, algo que un test de 2 cuentas secuenciales nunca revelaría.
- **Justificación manual**: explorar "¿hay un patrón visible en N valores?"
  es un juicio humano, no una aserción determinista de un solo caso.

```yaml
- id: TC-020-E2
  execution_mode: manual
  test_layer: 3
  target_tooling: charter
  gherkin_scenario: "—"
  name: Charter_LaCarreraRealDeUnaOrdenQueCambiaDeEstadoDuranteLaVentanaDeLaTransaccionDeBorrado
```

- **Misión**: el día que el `design.md` real exista y se conozca el mecanismo
  exacto de bloqueo por transacción, intentar reproducir la carrera real de
  AC-9 con dos procesos verdaderamente concurrentes (no `Promise.all` desde
  un solo test) — idealmente inyectando una demora artificial en el
  checkout/confirmación de pago (vía un breakpoint o un delay de desarrollo)
  para ensanchar la ventana de la carrera y hacerla observable de forma
  confiable.
- **Áreas**: si la transacción de borrado usa un nivel de aislamiento que
  permita a una orden nueva "colarse" entre la lectura de "sin órdenes en
  curso" y el `COMMIT` final.
- **Riesgos**: sin este charter, la única evidencia de que la carrera está
  cerrada es el análisis del código (dev-owned) — QA-020-ACC-3 (N-1a/N-1b) la
  aproxima por orden de operaciones, no por concurrencia real.
- **Justificación manual**: requiere control fino de timing que un test
  automatizado normal no tiene sin herramientas de inyección de latencia que
  este entorno no tiene todavía.

```yaml
- id: TC-020-E3
  execution_mode: manual
  test_layer: 3
  target_tooling: charter
  gherkin_scenario: "—"
  name: Charter_DosPestanasRealesDeUnNavegadorConfirmandoElBorradoAlMismoTiempo
```

- **Misión**: el día que exista el frontend de esta US, reproducir
  literalmente el escenario que el propio AC-15 describe — "la misma sesión
  abierta en dos pestañas" — con un navegador real, dos pestañas reales,
  confirmando el diálogo destructivo casi al mismo tiempo, y observar qué ve
  el usuario en la pestaña que "pierde" la carrera (¿un error genérico
  confuso, o un mensaje que reconoce que la otra pestaña ya lo hizo?).
- **Áreas**: la experiencia de usuario del perdedor de la carrera (además del
  comportamiento del servidor, que QA-020-ACC-9 ya prueba); el estado de la
  UI de la pestaña que pierde (¿queda colgada, muestra un error, redirige
  igual que la que ganó?).
- **Riesgos**: sin este charter, nadie observó nunca la experiencia real de
  usuario del caso "dos pestañas" — sólo el efecto en el servidor.
- **Justificación manual**: depende del frontend (no planificado todavía,
  §1.2) y de timing/percepción humana, no de una aserción de API.

**Apéndice**: se agregan a `qa/exploratory/charters.md` (sección "US-020 —
Borrado de cuenta") en la fase de ejecución (`/develop-qa`), no en este plan.

---

## 10. Quality gates

| Gate | Cuándo | Bloquea |
|---|---|---|
| Aceptación BDD (QA-020-ACC-1..9) | PR y nightly, una vez desbloqueada | sí — hoy: `blocked_by` backend |
| Regresión persistente (`@regression`: AC-6, AC-9, AC-10, AC-13, AC-15) | cada release que toque `AccountModule`, `checkout`, `orders` o `auth` | sí — hoy: `blocked_by` backend |
| Carga p95 < 500ms (QA-020-PERF-1) | pre-release | sí — hoy: `blocked_by` backend |
| Contract testing | pre-release, una vez que exista el contrato publicado | sí — diferido, ver §6 |
| Charters exploratorios | pre-release | no (informan) |

---

## 11. Anti-patrones evitados a propósito

- ❌ **Autorar capas dev-owned** (`qa-backend-standards.md` §2.1): cero stubs
  de unit/integration en este plan — §1.1 sólo anota la expectativa general.
- ❌ **Fingir que el backend existe**: cada test case declara
  `blocked_by: US-020-backend (no planificado/mergeado en este worktree)` en
  su propia frontmatter, no un estado optimista.
- ❌ **Inventar un contract test contra un contrato que no existe** (§6): se
  difiere explícitamente, con la razón declarada, en vez de fabricar un
  schema propio y validarlo contra sí mismo.
- ❌ **Forzar un test API-level para AC-7**, que describe una propiedad
  puramente de UI ("la llamada nunca se disparó") — se documenta como
  `diferido a FE` en vez de escribir una tautología (§5.2).
- ❌ **Confundir "best-effort concurrente" con "prueba de ausencia de
  carrera"**: QA-020-ACC-9 declara su propio límite honesto y lo complementa
  con `TC-020-E3`, en vez de presentar `Promise.all` como si cerrara AC-15
  por completo.
- ❌ **Un k6 sin threshold atado a un NFR** (`k6-load-scaffolding`): el único
  threshold de QA-020-PERF-1 es el número que la propia US propone (§9), sin
  inventar un p99 que nadie pidió.
- ❌ **Sembrar el costo de 50 órdenes DENTRO de la iteración medida**: el
  seeding vive en `setup()`, nunca en el bucle que produce el p95 (§8).
- ❌ **Reinventar un anonimizador de PII propio para probar AC-3/AC-8**: los
  escenarios reusan el mismo vocabulario (`anonymization_reason`,
  `anonymized_at`) que US-021 ya estableció, sin inventar un mecanismo nuevo.
- ❌ **Log-grep superficial**: N-6/QA-020-ACC-8 busca también variantes
  hasheadas triviales del dato original, no sólo el texto plano — un `sha256`
  del email real en un log seguiría siendo información recuperable si el
  espacio de valores es chico (email conocido).

---

## 12. Standards consultados

`testing-standards.md` (§2 pirámide, §5 datos, §14 patrones, §14.9
negative-space, §18 anti-patterns) · `qa-backend-standards.md` (§2.1
ownership, §13 performance, §15 datos, §21 BDD) · `performance-standards.md`
(§7 diseño del load test, §8 budgets en CI) · `base-standards.md` (§1
KISS/YAGNI) · `observability-standards.md` §9 (clasificación PII, consultado
para N-6/AC-14) · skills `qa-three-layer-regression`, `bdd-scenario-quality`,
`k6-load-scaffolding`, `nfr-quantification` (consultado para confirmar que el
NFR de QA-020-PERF-1 ya viene propuesto por la propia US §9, sin necesidad de
proponer un número nuevo — `[propuesto — confirma Arquitecto]` se mantiene
igual, no se resuelve acá), `threat-modeling-lite` (consultado para AC-10 —
la disciplina de anti-enumeración de N-2 es exactamente el control "Info
disclosure" de la Superficie 3/4 del catálogo de esa skill, aplicado a un
endpoint de borrado en vez de a uno de lectura), `openspec-workflow`
(convención Modo A + sibling change + traceability matrix),
`flakiness-detection` (consultado — ninguna espera fija propuesta; N-1a/N-1b
usan orden de operaciones explícito, nunca un `sleep`).

---

## 13. Bloqueos y hallazgos declarados

| # | Qué | Estado | Efecto |
|---|---|---|---|
| **QA-020-F1** | El backend de US-020 no existe en este worktree — ningún test case de este plan corrió | Bloquea toda ejecución | Ninguno de los 12 test cases automatizados ni los 3 charters tiene evidencia de corrida; ver §0/§5.0 |
| **QA-020-F2** | Sin `design.md` real del backend, 4 supuestos de mecanismo interno quedan sin verificar (§0, "Supuestos de diseño a reconciliar") | Informativo, no bloquea el plan | Ninguno de los 4 supuestos cambia el comportamiento observable que los escenarios verifican — sólo nombres de campo/enum a reconciliar |
| **QA-020-F3** | No hay `US-020-...-frontend-web` planificado — AC-7 y la accesibilidad del flujo quedan sin cobertura de este plan | Diferido, no oculto (§1.2/§5.2) | El futuro `qa-plan.md` de frontend hereda AC-7 y accesibilidad como su responsabilidad explícita |
| **QA-020-F4** | No hay contrato OpenAPI publicado del endpoint de borrado — sin contract test posible hoy | Diferido, no oculto (§6) | Se agrega en la primera revisión de este plan que corra con el backend real |

---

## 14. Open questions

- **OQ-QA-020-1**: ¿El mecanismo de unicidad del valor de reemplazo de
  `email` va a ser determinístico y visible externamente (p. ej.
  `deleted-{uuid}@...`) o completamente opaco? Afecta si TC-020-E1 puede
  siquiera "mirar la forma" del valor, o si sólo puede verificar unicidad por
  comparación, nunca por inspección.
- **OQ-QA-020-2**: ¿El endpoint de borrado responde `200` con body o `204`
  sin body? Afecta el exit criterion exacto de H-1/QA-020-ACC-1 — se
  reconcilia al primer intento de ejecución, sin bloquear la planificación.
- **OQ-QA-020-3**: cuando exista `design.md` real, ¿el guard de "órdenes en
  curso" corre dentro de la misma transacción SQL que el resto del borrado, o
  como un chequeo previo separado? Determina si TC-020-E2 (la carrera real)
  es siquiera físicamente posible de estrechar/ensanchar por inyección de
  latencia, o si el diseño ya la hace imposible por construcción (ideal,
  pero a confirmar).

---

## 15. Dependencias declaradas

| Dependencia | Estado | Efecto |
|---|---|---|
| `US-020-borrado-cuenta-datos-personales-backend` | **No existe en este worktree** — en planificación/construcción en otro worktree, otra rama | Bloquea el 100% de la ejecución de este plan |
| `US-020-borrado-cuenta-datos-personales-frontend-web` | No planificado | Bloquea AC-7 y accesibilidad — diferido a un futuro plan de QA de frontend (§1.2) |
| `US-014-registro-login-backend` | Archivado | Resuelto — origen de `customer-auth.ts` (las tres puertas de AC-10 ya corren contra este mecanismo hoy, para otros propósitos) |
| `US-015-historial-compras-backend` | Backend mergeado (PR #70) | Resuelto — origen de `orders.customer_id`, sin el cual AC-3/AC-4/AC-8/AC-9/AC-12 no tendrían sobre qué operar |
| `US-021-retencion-datos-ordenes-backend` | Archivado | Resuelto — origen del mecanismo de anonimización de órdenes que AC-3/AC-8 reusan, y del vocabulario (`anonymization_reason`, `anonymized_at`) que este plan hereda sin reinventar |
| `US-016-panel-metricas-backend` | Archivado | Resuelto — `GET /v1/admin/reports/summary` real, usado como proxy de AC-12 |
| `US-013-cancelacion-reembolso-backend` | Mergeado a `main` | Resuelto — `cancelarOrden` real, usado para llevar una orden a `cancelled` en AC-8/N-1b |

---

## 16. References

- User story: `docs/user-stories/US-020-borrado-cuenta-datos-personales.md`
  (15 AC, §9 NFR cuantificados, §10 decisiones de producto cerradas + tabla
  de consecuencia operativa por relación `onDelete`)
- PRD: `docs/product/prd.md` §6 (promesa de borrado a pedido), capacidad 13
- E2E: `docs/product/design-e2e.md` §14 (auth), §17 (NFR), §18
  (observabilidad)
- Precedente directo del mecanismo de anonimización reusado:
  `openspec/changes/archive/US-021-retencion-datos-ordenes-backend/{design,qa-plan}.md`
- Precedentes Modo A / sibling de este repo (formato y contenido):
  `openspec/changes/archive/US-013-cancelacion-reembolso-qa/qa-plan.md`
  (formato de índice de test cases, frontmatter, quality gates),
  `openspec/changes/archive/US-016-panel-metricas-qa/qa-plan.md` (precedente
  de sibling change por conflicto de nombre de rama)
- Infraestructura reusada, verificada por lectura directa: `qa/support/customer-auth.ts`,
  `qa/support/seed-order-history.ts`, `qa/support/seed-metricas.ts`,
  `qa/support/cancelar-orden.ts`, `qa/support/admin-auth.ts`
