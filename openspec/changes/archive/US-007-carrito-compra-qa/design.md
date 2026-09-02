---
parent-us: US-007
discipline: qa
language: es
---

# US-007 QA — Diseño de la suite

## Context

El paquete `@dsm/qa` existe desde US-001 y ya acumula la regresión de US-001, US-002 y
US-003: aceptación (Cucumber + Playwright), E2E de navegador, a11y con axe, funcional con
Newman y carga con k6. US-007 lo extiende con **la primera superficie de escritura** que
la suite toca, y eso trae dos cosas que ninguna suite anterior necesitó: un **cliente con
estado** (cookie de identidad + double-submit de CSRF + `Origin`) y una noción de
**invitado**, que hasta ahora no existía —todo lo público era anónimo y de sólo lectura,
y todo lo que escribía era el admin.

El backend está construido (36/37; el único ítem abierto es el gate de CI del monorepo) y
su contrato está publicado. El frontend está **planificado y sin construir**: el change
`US-007-carrito-compra-frontend-web` lo escribió una sesión paralela el mismo 2026-08-22 y
tiene 0 tasks cerradas. Esa asimetría —contrato vivo de un lado, ninguna UI del otro— es
el hecho que ordena todo el diseño.

## Goals

- Certificar los 10 AC con al menos un escenario **ejecutable hoy**, sin esperar al FE.
- Dejar armada, escrita y trazada la capa que espera al FE, para que el FE se construya
  contra criterios observables ya redactados y no al revés.
- Ser la red que detecta, en las US que vienen (US-008 checkout, US-009 pago, US-010
  stock), que alguien reintrodujo reserva de inventario en el carrito.
- No repetir una sola aserción de la capa dev-owned.

## Non-goals

- Re-probar CSRF, rate-limit, `no-store`, atributos de cookie ni la purga oportunista:
  el backend los cubre con Postgres real en `e2e-cart-security`, `e2e-cart-ratelimit` y
  `e2e-cart-persistence`.
- Probar el checkout (US-008): acá termina en la señal `has_blocking_issues`.

## Approach

### Qué agrega la capa QA sobre la capa dev-owned

Es la pregunta que decide si esta suite existe. La respuesta es cuatro cosas concretas, y
cada escenario de §Escenarios declara cuál de las cuatro aporta:

1. **El proceso y la configuración reales.** El e2e-nest arma la app en memoria con env de
   test. Acá se habla con la API arrancada: allowlist de CORS de verdad, `CART_TTL_DAYS`
   de verdad, throttlers de verdad. El `PUT` del carrito puede funcionar perfecto por
   supertest y fallar el preflight en el navegador.
2. **El cruce de superficies.** Los productos se siembran y se mutan por la **API de
   admin** (US-001) y se leen por la **ficha pública** (US-003) mientras el carrito los
   tiene. El e2e del backend usa sus propias fixtures dentro de su proceso.
3. **La perspectiva del dueño.** AC-8 no dice «el repositorio no escribe `products`»;
   dice que el stock **no se reserva ni se descuenta**. Lo que hay que mirar es el
   inventario tal como lo ve el dueño en su panel, con carritos vivos apuntándole.
4. **El contrato legible.** Los escenarios en Gherkin español son la regresión que
   sobrevive a la US y que el dueño puede leer.

### El cliente de carrito — la pieza nueva de infraestructura

Escribir en el carrito no es un `fetch`: el guard exige, cuando ya hay cookie de carrito,
un `Origin` de la allowlist **y** el header `X-CSRF-Token` con el valor de la cookie
legible `dsm_cart_csrf` (`cart-csrf.guard.ts`, `security-standards.md` §7.5). La primera
escritura de un cliente nuevo no lleva cookie y por eso pasa sin CSRF — el guard corta
antes.

`qa/support/cart-client.ts` encapsula eso una sola vez:

- Cada **invitado** es un `APIRequestContext` propio de Playwright, que ya trae su propio
  almacén de cookies. Dos contextos = dos invitados independientes, sin trucos.
- Antes de cada escritura, lee `dsm_cart_csrf` del contexto y lo manda como header, con
  `Origin` fijado al origen web de la allowlist.
- «Cerrar el navegador y volver» se modela con `storageState()`: se serializan las
  cookies del contexto, se descarta el contexto y se abre uno **nuevo** con ese estado.
  Es la única forma honesta de probar AC-4 sin un browser: prueba que la identidad viaja
  en una cookie **persistente** y que el servidor la resuelve desde cero.

**Anti-patrón evitado**: pasar el token de carrito a mano entre requests. Eso probaría
que el servidor acepta un token, no que un invitado real conserva su carrito.

### Los datos de test — un seed **hermano**, no una extensión

`qa/support/seed-categorias.ts` (US-002) siembra 21 productos publicados para forzar la
paginación, un sin stock, un draft, un archivado y una categoría vacía. El carrito
necesita otra cosa: **pocos productos con stock exacto y conocido** (uno con stock 3 para
el tope de AC-5 y para la invariante de AC-8; uno para despublicar en vuelo; uno para
cambiarle el precio en vuelo; un draft y un archivado).

Se agrega un **hermano**, `qa/support/seed-carrito.ts`, y no se extiende el de US-002:

- Extenderlo haría que cada corrida de US-002 pague la fixture del carrito y viceversa;
  el seed de US-002 ya crea 25 productos por corrida contra la base compartida.
- Acoplaría las fixtures de dos suites: cambiar el stock que el carrito necesita movería
  aserciones de la grilla de US-002.
- `seed-categorias.ts` lo escribió otra sesión sobre esta misma rama. Tocarlo es
  exactamente el riesgo de working tree compartido que este repo ya pagó una vez.

**Dueño del archivo nuevo**: este change (US-007 QA). Reusa `adminAuth`, `apiCall`,
`nuevaCategoria` y `nuevoProducto` sin modificarlos, y siembra **por la API real**
respetando la máquina de estados —igual que el hermano— porque un `INSERT` directo
produciría filas que la aplicación nunca habría aceptado.

### AC-8 — cómo se diseña un test que se ponga rojo si alguien reserva stock

Es el escenario de mayor valor de la US y merece el razonamiento explícito, porque la
versión obvia no sirve.

**La versión que no sirve**: un invitado agrega 2 unidades, se lee el stock, sigue igual.
Pasa también si el sistema reservara stock con un contador aparte, o si reservara sólo
al segundo carrito, o si descontara al confirmar. Es un test que no distingue.

**La versión que sirve** (N-2) ataca la propiedad por la que la reserva es *detectable*:
si hubiera reserva, **el inventario dejaría de alcanzar para todos a la vez**.

1. El dueño siembra un producto con **stock 3** por el panel.
2. **Tres invitados independientes** ponen **las 3 unidades cada uno** en su carrito. Los
   tres tienen que quedar `available`, con `max_quantity: 3`. Con reserva, el segundo ya
   habría recibido 409 o habría quedado `insufficient_stock`.
3. El **dueño** consulta su panel: el stock sigue siendo **3**. No 0, no 3 con un campo
   «reservado» al lado. La aserción se hace sobre la superficie del dueño porque es la
   que miente si alguien agrega reserva en otro módulo.
4. La **ficha pública** sigue anunciando el producto como disponible: la reserva que sólo
   afectara el browse también se ve acá.
5. Se **relee** después de un ciclo completo de escritura (subir y bajar cantidades,
   quitar una línea): el stock sigue en 3. Descarta un decremento diferido.

Se pone rojo si alguien introduce reserva **en cualquier capa** —carrito, checkout,
webhook— porque la aserción no mira la implementación del carrito sino la consecuencia
observable. Y es exactamente el escenario que hay que tener escrito **antes** de que
US-008 y US-009 se desarrollen, que es ahora.

### AC-9 y AC-6 — el cruce que ninguna capa ve: dos cachés opuestas

La ficha pública se sirve con `Cache-Control: public, max-age=60` y el storefront cachea
el catálogo. El carrito se sirve con `no-store`. Eso significa que, después de que el
dueño cambia un precio, existe una ventana en la que **la ficha muestra el precio viejo y
el carrito tiene que mostrar el nuevo**.

X-2 verifica esa asimetría a propósito: el importe del carrito es el vigente **en la
lectura siguiente al cambio**, sin esperar ninguna ventana, y viene marcado como cambiado.
Un carrito que se apoyara en la lectura cacheada del catálogo pasaría todos los tests del
backend (que no cachea nada dentro de su proceso) y fallaría acá.

X-1 hace lo propio con la disponibilidad: el dueño despublica desde el panel, y la lectura
siguiente del carrito marca la línea, la saca del total, **no la borra**, y prende la
señal que el checkout consume. Verifica además que la línea bloqueada **se puede quitar**
— el callejón sin salida clásico: un ítem que no se puede comprar y tampoco sacar.

### Carga — qué se mide, qué no, y por qué

El PRD §4 fija **`p95 < 500 ms` para «latencia p95 escritura (carrito/orden)»**: es un
número ratificado, con nombre propio para esta superficie, y la US §9 lo repite. El
escenario **L-1** lo ejercita sobre `PUT` + `DELETE`.

Dos condiciones lo gobiernan, y las dos van escritas en el script:

- **El throttler hace imposible la medición tal como está configurado.**
  `CART_WRITE_RATE_LIMIT_MAX = 30` por minuto y por IP es 0,5 rps: un k6 desde un
  generador satura el presupuesto en el primer segundo y a partir de ahí mide 429. El
  escenario corre con el límite elevado **sólo en el entorno de carga**, y el script
  aborta si detecta 429 en vez de reportar un p95 falso (OQ-QA-2).
- **Cada iteración necesita su propio invitado o su propio CSRF.** Un k6 que reusa el
  mismo carrito mide el upsert de una fila caliente; el patrón real es «muchos invitados,
  pocas líneas cada uno».

**El escenario de lectura no se emite.** No hay número ratificado para `GET /v1/cart`: el
PRD acota sus 300 ms a «catálogo/ficha» y el propio `design.md` del backend marca el valor
del carrito como `[propuesto — confirma Arquitecto]`. Escribir `p(95)<300` copiándolo de
otra fila del PRD sería inventar un presupuesto y darle apariencia de gate. Se mide en la
misma corrida **sin threshold**, como dato informativo, para que el número exista el día
que haya que ratificarlo.

### Lo que espera al FE, y por qué se escribe igual

Seis recorridos de navegador y dos de accesibilidad quedan escritos y **sin ejecutar**
(el plan de FE existe desde hoy; la UI, no).
No es trabajo muerto: la US §9 pide por su nombre «stepper navegable por teclado» y
«anuncios de cambios de total», y axe no detecta ninguna de las dos —ni la alcanzabilidad
por `Tab` ni la existencia de una región viva que anuncie el total—. Escribirlos ahora
hace que el FE se construya contra un criterio observable en vez de descubrirlo en el
audit.

## Trade-offs

| Decisión | Alternativa descartada | Por qué |
|---|---|---|
| Aceptación a **nivel API** con el stack arrancado | Esperar al FE para toda la capa QA | 10 de 10 AC tienen escenario ejecutable hoy; esperar dejaría la US sin red justo mientras US-008/US-009 se desarrollan encima |
| **Tres** invitados con el stock completo cada uno (AC-8) | Un invitado y releer el stock | La versión de un invitado pasa igual con reserva implementada; la de tres no |
| Aserción de AC-8 contra el **panel del dueño** y la ficha | Aserción contra la base con Prisma | Lo que se rompe en silencio es lo que el dueño ve; y una aserción por Prisma no distingue reserva en otro módulo |
| Seed **hermano** (`seed-carrito.ts`) | Extender `seed-categorias.ts` | Fixtures acopladas entre suites + archivo de otra sesión en la misma rama |
| Un `APIRequestContext` por invitado | Pasar el token del carrito a mano | Pasar el token prueba que el servidor acepta un token, no que el invitado conserva su carrito |
| `storageState()` para «cerrar y volver» | Reusar el mismo contexto | Reusar el contexto no prueba que la cookie sea persistente ni que el servidor resuelva desde cero |
| k6 sólo de **escritura**, con umbral del PRD | Emitir también el de lectura con 300 ms | El 300 ms del PRD está acotado a catálogo/ficha; copiarlo sería inventar el gate |
| No re-probar CSRF / rate-limit / cookies | Cubrirlos «por las dudas» también acá | Duplicación L1/L3 explícitamente prohibida (`qa-three-layer-regression` §Anti-patterns) |

## Decisiones abiertas (requieren ratificación del PO)

**OQ-QA-1 — Presupuesto de latencia de `GET /v1/cart`.**
- (a) Adoptar `p95 < 300 ms` por analogía con la fila de lectura del PRD.
- (b) **No emitir el stub** hasta que el Arquitecto ratifique, midiendo mientras tanto sin
  umbral dentro de la corrida de L-1 ← **recomendada**. El número existe cuando haya que
  firmarlo, y ningún gate finge estar cubierto.
- (c) Medir sin umbral y no volver sobre el tema.

**OQ-QA-2 — Cómo se corre L-1 contra un presupuesto de 30 escrituras/min/IP.**
- (a) Correr el k6 con `CART_WRITE_RATE_LIMIT_MAX` elevado **sólo en el entorno de
  carga**, declarándolo en el reporte de la corrida ← **recomendada**. Es la única que
  mide el NFR; el rate-limit ya lo prueba `e2e-cart-ratelimit`.
- (b) Dejar el límite productivo y cambiar el criterio a «el 429 llega con
  `Retry-After`». Mide el throttler, no el NFR, y ya está cubierto.
- (c) Generar carga desde varias IP. No disponible en local ni en Railway sin costo.

**OQ-QA-3 — Alcance de AC-6 en esta US.**
- (a) Cerrarlo con la señal verificada (X-1, C-3) y anotar que **impedir el avance al
  pago** lo cubre US-008 ← **recomendada**. Es lo que el backend entrega y lo único
  verificable hoy.
- (b) Diferir AC-6 entero hasta que exista el checkout. Deja la mitad construida sin red.
- (c) Escribir hoy el escenario contra el checkout. Sería un stub muerto: no existe.

**OQ-QA-4 — Verificación de la ventana de 7 días.**
- (a) No re-testear el vencimiento (dev ya lo cubre manipulando la fila) y cubrir en QA
  sólo la propiedad observable —que la identidad persiste entre «cierres de navegador»—
  más un charter sobre el costo declarado de los 7 días ← **recomendada**.
- (b) Manipular `carts.expires_at` con `@dsm/db` desde la suite QA. Rompe la disciplina de
  sembrar por API real y duplica el e2e del backend.
- (c) Esperar 7 días de calendario. No es una opción seria en CI.

## Hechos del entorno de ejecución (descubiertos corriendo las suites, no memoria de nadie)

Van acá porque la suite **no arranca** sin ellos y ya costaron diagnósticos caros:

1. **CORS**: la API sólo admite `http://localhost:3000` (su propio puerto) por defecto.
   Hay que arrancarla con `CORS_ALLOWED_ORIGINS=<origen web>`, o **ningún navegador puede
   usar el panel ni el storefront** — y, para esta suite, el guard de CSRF del carrito
   rechaza con 403 toda escritura posterior a la primera, porque el `Origin` que manda el
   cliente no está en la allowlist.
2. **`ADMIN_BOOTSTRAP_TOKEN`**: sin él, el fixture de auth degrada a un JWT minteado y el
   login del panel falla (el formulario espera el bootstrap token, no el JWT). Todos los
   seeds pasan por ahí.
3. **Rate limits**: `AUTH_RATE_LIMIT_MAX` = 5 cada 15 min y `STOREFRONT_RATE_LIMIT_MAX` =
   60 por minuto. Una corrida completa los agota. Síntoma ya visto: la API responde 429 y
   la página lo mostraba como 5xx (mapeado a `rateLimited` en `b718b2b`), lo que parecía
   un producto roto y no lo era. Para esta suite se suma `CART_RATE_LIMIT_MAX` = 120
   lecturas/min y `CART_WRITE_RATE_LIMIT_MAX` = 30 escrituras/min por IP.
4. **El entrypoint de la API es `apps/api/dist/apps/api/src/main.js`** (layout de
   monorepo); `nest start` falla con `MODULE_NOT_FOUND`. Env requerido: `DATABASE_URL`,
   `REDIS_URL`, `JWT_SECRET`, `NODE_ENV`.
5. **Sembrar por la API no invalida la caché del frontend** (el storefront cachea el
   catálogo 3600 s y la invalidación está cableada a las mutaciones de la UI del panel).
   Un test que siembra y asserta enseguida corre contra la caché: `expect.poll`
   re-navegando, **nunca** una espera fija. Aplica a los E2E de navegador (fase bloqueada)
   y **no** al carrito, que es `no-store`.
6. **Puerto de Playwright**: `E2E_PORT` / `QA_WEB_BASE_URL` por defecto **3210**; el 3100
   que el config trae por defecto colisiona con Grafana Loki en esta máquina.

## References

- `qa-three-layer-regression` (L3 cross-stack, 4 categorías) · `bdd-scenario-quality` ·
  `playwright-stability` · `k6-load-scaffolding` · `flakiness-detection` ·
  `nfr-quantification`
- `docs/quality/testing-standards.md` §2, §5, §14, §14.9, §18
- `docs/quality/qa-backend-standards.md` §2.1 (ownership), §13 (performance), §15 (datos)
- `docs/quality/qa-frontend-standards.md` §19 (a11y), §23 (Playwright), §24 (BDD web)
- `docs/cross-cutting/performance-standards.md` §7, §8
- Backend: `openspec/changes/US-007-carrito-compra-backend/design.md` (decisiones 1-4,
  STRIDE, NFRs, OQ-BE-1..6)
- ADR-0008 (stock al aprobar el pago), ADR-0011 (tokens hasheados)
