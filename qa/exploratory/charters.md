# US-001 — Charters de testing exploratorio (manual)

> `execution_mode: manual` — no se automatizan: son sesiones time-boxed guiadas por
> heurísticas, complementarias a la suite automatizada (qa-plan §exploratorio).

## TC-031 — Máquina de transición de estado del producto

- **Misión**: descubrir transiciones de estado inesperadas o inconsistencias entre
  lo que la UI muestra y lo que el backend permite (draft → published → archived).
- **Áreas**: acciones publicar/archivar/despublicar; producto ya archivado;
  publicar dos veces (doble submit); editar mientras se publica; carreras.
- **Riesgos**: cambio optimista falso (UI dice published, backend rechazó);
  reactivar un archivado por una ruta no prevista; estado inconsistente tras 422.
- **Heurísticas**: CRUD-Z (crear/leer/actualizar/borrar + estados), "goldilocks"
  (muy rápido / doble click), interrupción (navegar durante la mutación).
- **Justificación manual**: explora el espacio de estados más allá de las
  transiciones canónicas ya cubiertas por `products.state.spec.ts` (dev L1) y la
  aceptación (L3).

## TC-032 — Autenticación y sesión admin (seam ADR-0009)

- **Misión**: sondear los bordes del seam de auth: expiración, token manipulado,
  rol incorrecto, sesión en múltiples pestañas, logout.
- **Áreas**: `/acceso` (login real), guard del route group, interceptor de token,
  expiración del JWT (1h), token con `role` distinto, `signOut`.
- **Riesgos**: panel accesible con token expirado (guard sólo UX); fuga del token;
  bypass del guard por navegación directa; el backend NO revalida (defensa en
  profundidad server-side es la autoridad — confirmar 401/403 reales).
- **Heurísticas**: "follow the data" (dónde vive el token), boundary (exp ±1s),
  tampering (editar el claim `role` y reenviar → debe dar 403).
- **Justificación manual**: cubre escenarios de sesión/tiempo difíciles de
  automatizar de forma determinista; el barrido RBAC estático ya está en Newman (L3).

---

# US-003 — Ficha pública de producto

## TC-340 — SEO real y preview al compartir

- **Misión**: verificar cómo interpretan la ficha los consumidores externos —
  buscadores y previsualizadores de redes— más allá de que el HTML sea correcto.
- **Áreas**: JSON-LD contra el validador de datos estructurados de Google; Rich
  Results Test; preview de WhatsApp / Facebook / X con el `og:image` real;
  canonical; `title` truncado en resultados; comportamiento con imagen faltante
  (el placeholder no tiene URL pública para el `og:image`).
- **Riesgos**: JSON-LD sintácticamente válido pero rechazado por reglas de
  negocio de Google (falta `priceValidUntil`, `availability` mal mapeada);
  preview sin imagen o con imagen rota en el canal que el dueño más usa
  (WhatsApp, PRD §12); canonical apuntando a `localhost` en un deploy mal
  configurado.
- **Heurísticas**: "follow the consumer" (validar con la herramienta del
  consumidor real, no con la propia); comparar una ficha con imagen contra una
  con placeholder; probar el enlace pegado en un chat real.
- **Justificación manual**: depende de herramientas externas y de juicio sobre
  cómo *se ve* el resultado. Automatizarlo daría **falsa confianza** sobre el
  objetivo de negocio de la US — que a DSM se la encuentre y el enlace se vea
  bien al compartirlo. TC-303 ya cubre que el JSON-LD exista y sea coherente;
  esto cubre que **sirva**.

## TC-341 — Caché de la ficha bajo un CDN real

- **Misión**: sondear el comportamiento de caché de la ficha con un CDN delante,
  que es la topología de producción (Cloudflare → Railway, E2E §despliegue).
- **Áreas**: interacción entre el `Cache-Control` del backend (`max-age=60` sólo
  en 2xx), la Data Cache de Next (1 h) y la caché de borde del CDN;
  `stale-while-revalidate`; qué pasa con un 404 o un 429 (no deben quedar
  cacheados — hallazgo M1 de US-003); purga tras editar el precio en el panel.
- **Riesgos**: el CDN sirve un precio viejo aunque `revalidateProduct` haya
  corrido (la invalidación es del origen, no del borde) — AC-9 se cumple en
  local y se incumple en producción; un 404 cacheado en el borde hace
  desaparecer un producto recién publicado.
- **Heurísticas**: variar el orden (leer → editar → leer desde otra región /
  otro navegador); inspeccionar `age` y `cf-cache-status`; forzar un miss.
- **Justificación manual**: el comportamiento real depende de la configuración
  del CDN, que **no existe hasta US-019** (provisión de la nube). Un test contra
  el origen no lo reproduce, y montar un CDN de mentira mediría otra cosa.
  Se ejecuta como parte del pre-uat, cuando exista el entorno prod-shaped.

---

## TC-240 — Indexación real del árbol de categorías (US-002 AC-4)

- **Misión**: averiguar si un buscador real llega a **todas** las categorías y
  fichas publicadas, y si no indexa ninguna que no deba existir.
- **Áreas**: `sitemap.xml` (cobertura y ausencia de URLs muertas) · `robots.txt`
  · canonical de las páginas 2+ · `rel=prev/next` · JSON-LD `BreadcrumbList` ·
  Search Console (cobertura, exclusiones, "página alternativa con etiqueta
  canónica adecuada").
- **Riesgos**: el canonical auto-referencial de la página N está bien formado
  pero Google decide indexar sólo la 1, y la mayoría del catálogo queda fuera;
  el sitemap anuncia una categoría que devuelve 404 real y el dominio pierde
  reputación de rastreo; una categoría vacía se indexa como página de aterrizaje
  sin contenido.
- **Heurísticas**: comparar el conteo del sitemap contra el de categorías
  publicadas en la API; pedir cada URL del sitemap y verificar 200; buscar
  `site:` sobre el dominio; forzar un re-rastreo y observar qué versión toma.
- **Justificación manual** (`execution_mode: manual`): el criterio de éxito lo
  decide **un tercero** —el crawler—, en su propia ventana de tiempo. Un test
  automatizado sólo puede verificar lo que el sitio *ofrece*, no lo que Google
  *hace*, y eso ya está cubierto por TC-203/TC-204. Además exige un dominio
  público verificado, que **no existe hasta US-019**. Se ejecuta en el pre-uat.

## TC-241 — Coherencia del árbol con datos reales del dueño (US-002 AC-1/AC-2)

- **Misión**: averiguar si la navegación se sostiene cuando el árbol lo arma el
  dueño con nombres, profundidades y volúmenes reales, en vez del fixture
  prolijo que usan los tests.
- **Áreas**: nombres largos, con acentos, con `&`, `/` o emoji · dos categorías
  cuyo nombre deriva al mismo slug · rubro con un solo subrubro y sin productos
  propios · subrubro con más productos que el padre · renombrar una categoría ya
  indexada · mover un producto entre categorías.
- **Riesgos**: la barra de rubros desborda o se vuelve inusable con más de ~15
  categorías (hoy en desarrollo ya se ven decenas acumuladas y el recorrido por
  teclado se hace largo — observado al escribir TC-221); un renombre cambia el
  slug y deja la URL vieja en 404 sin redirección; la agregación rubro→subrubro
  confunde al dueño, que ve un producto "en dos lugares".
- **Heurísticas**: llevar el árbol al extremo por un eje a la vez (ancho,
  profundidad, longitud de nombre); recorrer con teclado y con lector de
  pantalla; mirar la misma categoría como dueño y como visitante.
- **Justificación manual** (`execution_mode: manual`): el criterio es de
  **usabilidad y juicio** —"¿se entiende dónde estoy?"— y no un assert. Un test
  puede verificar que el link exista; no que el árbol resultante sea navegable
  para una persona. Se ejecuta con el dueño antes del UAT.

## TC-750 — El carrito frente a navegadores reales (US-007 AC-4) — **BLOQUEADO**

> **Bloqueado por**: el FE de US-007 (`US-007-carrito-compra-frontend-web`) está en
> construcción — al escribir este charter existen el `cartService` y el hook, pero
> todavía no la pantalla. Sin UI no hay sesión que conducir. Se ejecuta cuando la
> vista del carrito esté navegable.

- **Misión**: descubrir en qué condiciones **reales de navegador** el carrito del
  invitado se pierde, se duplica o se comparte, cuando el servidor está haciendo
  todo bien.
- **Áreas**: modo incógnito y su cierre; cookies de terceros bloqueadas y modo
  "prevención de rastreo" estricto; dos pestañas operando el mismo carrito a la vez;
  volver después de reiniciar el navegador; Safari/iOS con ITP; borrar cookies del
  sitio a mitad de la compra; el sitio abierto en dos perfiles del mismo navegador.
- **Riesgos**: la identidad del carrito **es** una cookie, así que su vida depende
  del navegador y no de `CART_TTL_DAYS`. El techo de vida que ITP impone a las
  cookies escritas por script cae **justo en los mismos 7 días** que el TTL
  configurado, así que el peor caso del navegador y el del producto se superponen y
  nadie los distingue desde el servidor. Dos pestañas pueden pisarse la cantidad
  (la escritura es absoluta: la última gana) y el cliente no tiene forma de
  detectarlo. Un carrito que "reaparece" en incógnito sería una fuga de identidad.
- **Heurísticas**: variar un eje del navegador a la vez (privacidad, perfil,
  pestañas, reinicio); "interrupción" (cerrar durante la escritura); comparar lo que
  muestra la UI contra `GET /v1/cart` en la misma sesión; recorrer el ciclo completo
  en el navegador **más restrictivo** disponible y no en el más cómodo.
- **Justificación manual** (`execution_mode: manual`): ningún runner reproduce ese
  conjunto —Playwright no implementa ITP ni el ciclo de vida de cookies de Safari—,
  y automatizar una aproximación daría **falsa confianza** sobre AC-4, que es
  precisamente el criterio que depende del navegador. Los tests de backend ya cubren
  el vencimiento manipulando el reloj (dev L1/L2); acá se explora lo que el servidor
  no puede ver.

## TC-751 — La ventana de 7 días contra el ciclo real de compra del gremio (US-007 AC-4)

- **Misión**: averiguar si la retención de **7 días** que el PO eligió alcanza para
  el ciclo real de un cliente de ferretería, o si el costo aceptado por escrito es
  mayor que lo estimado.
- **Áreas**: el ciclo del gremio (plomero, electricista, refrigerista) — cotizar,
  juntar materiales de varias obras, comprar al cobrar; el ciclo del particular que
  arma el carrito el sábado y decide con la pareja; el efecto de una quincena o un
  feriado largo en el medio; qué hace hoy el dueño cuando un cliente le pide "lo de
  la semana pasada".
- **Riesgos**: quien vuelve a los diez días encuentra el carrito **vacío, sin aviso
  y sin recuperación** — es el costo que OQ-BE-1 aceptó explícitamente. Si el ciclo
  típico supera la ventana, el efecto no es una molestia: es abandono silencioso que
  el negocio no puede ver, porque un carrito vencido se purga y no deja rastro
  medible. El riesgo inverso también existe: una ventana muy larga muestra precios
  viejos como "lo que había en tu carrito" y erosiona la confianza en el precio.
- **Heurísticas**: entrevistar antes de medir (el dueño conoce el ciclo de sus
  clientes gremiales mejor que cualquier analítica que todavía no tenemos);
  contrastar con los tiempos que él ya observa en el mostrador; buscar el caso
  extremo real —la obra que se pausa— en vez del promedio.
- **Justificación manual** (`execution_mode: manual`): el criterio es **de negocio**,
  no un assert. No hay nada que verificar en el software: el comportamiento con 7
  días ya está probado por los tests del backend, que manipulan el reloj. Lo que hay
  que decidir es si **7 es el número correcto**, y eso sale de una conversación con
  el dueño. La variable se cambia por entorno (`CART_TTL_DAYS`) sin deploy de código,
  así que el resultado de esta sesión es accionable el mismo día.
- **Salida esperada**: una recomendación con número —confirmar 7, o subir a 14/30—
  registrada en OQ-BE-1 del change de backend, con el fundamento del ciclo observado.

---

# US-006 — Importación masiva de inventario

## TC-623 — Excel del mundo real

- **Misión**: descubrir con qué archivos reales se rompe el parser — el espacio de
  variantes que produce una planilla exportada por una persona, no por un test.
- **Áreas**: exports de LibreOffice, Google Sheets y Excel de Windows; números
  guardados como texto (celda con apóstrofe inicial); celdas con formato de moneda
  («$ 1.234,56»); filas vacías al final del archivo; archivos con varias hojas
  (¿cuál lee el parser?); encabezados con espacios extra, mayúsculas o BOM
  agregado por el editor.
- **Riesgos**: el separador de miles ambiguo (`1.234`) — el contrato lo **rechaza**
  a propósito (OQ-BE-2), y es exactamente el formato que exporta Excel en
  configuración regional es-AR, así que el dueño real va a chocar con esto en la
  primera semana de uso; una hoja equivocada leída en silencio (el archivo "parece"
  haberse importado bien, pero fueron los datos de otra pestaña); un número con
  miles de separador que se lee como si fuera dos columnas por el comillado.
- **Heurísticas**: "el usuario real no es el test" (usar archivos hechos a mano en
  cada herramienta, no generados por código); boundary del comillado CSV (comas,
  comillas y saltos de línea dentro de una celda); explorar por herramienta de
  origen, no por caso de error abstracto.
- **Justificación manual**: el espacio de variantes que produce una planilla real
  no se enumera con generadores deterministas — se explora con archivos de verdad.
  Los generadores de `import-files.ts` (T1.1) cubren los `error_code` del
  contrato; este charter cubre lo que el contrato todavía no nombró.
- **Salida esperada**: lista de variantes reales que rompen el parser, clasificadas
  en (a) correctamente rechazadas con mensaje claro — no acción, es el diseño
  funcionando — o (b) aceptadas con datos corruptos o rechazadas con un mensaje que
  no ayuda al dueño a corregir el archivo — candidato a AC nueva o mejora de copy.

## TC-624 — Ciclo de vida del trabajo

- **Misión**: ejercer el runbook de `apps/api/README.md` §Importación masiva de
  inventario contra el sistema real, no contra lo que el runbook dice que debería
  pasar.
- **Áreas**: matar el proceso de la API a mitad de un import (el job queda
  `running` → el barrido de arranque (`reapStale`, `import-runner.ts`) lo tiene
  que marcar `interrupted` al reiniciar); volver a subir el mismo archivo después
  de la interrupción; segundo import mientras el primero sigue corriendo (`409
  already-running`); un trabajo de más de 90 días (`purgeOlderThan`, purga en el
  próximo arranque).
- **Riesgos**: que el `interrupted` deje el catálogo a medias sin que el mensaje
  se lo diga al dueño; que el reintento tras una interrupción duplique en vez de
  reconciliar por SKU; un `pending` que muera **antes** de `markRunning` y quede
  huérfano para siempre — **este último ya se encontró sin necesidad de charter**:
  `reapStale()` sólo reapeaba `running`, nunca `pending`, y un huérfano así
  bloqueaba todos los imports siguientes sin que ningún reinicio lo resolviera
  (corregido durante esta misma US, ver `import-jobs.repository.ts`). El charter
  queda para ejercer el resto del ciclo — interrupted en `running`, reintento,
  concurrencia, purga por retención — que el fix puntual no cubre.
- **Heurísticas**: "romper a propósito" (matar el proceso en el peor momento
  posible: a mitad de un lote); seguir el dato (mirar `import_jobs` en cada paso,
  no sólo la respuesta HTTP); el runbook como hipótesis a falsear, no como verdad.
- **Justificación manual**: requiere matar procesos y manipular la ventana de
  retención — no es una condición que un test determinista deba simular con
  mocks de reloj para un runbook operativo.
- **Salida esperada**: confirmación de que cada paso del runbook hace lo que dice,
  o un defecto puntual por paso que no — con el mismo estándar de evidencia que
  ya se aplicó al hallazgo del `pending` huérfano.

---

# US-012 — Panel de órdenes del dueño

## TC-1250 — El panel de fulfillment en un día real de operación

- **Misión**: sondear el panel bajo el patrón de uso real de una sola sucursal —
  volumen bajo, pero con el dueño manejando varias órdenes a la vez y con
  conectividad intermitente en el local.
- **Áreas**: dos pestañas del mismo panel abiertas a la vez (ADR-0009 es un solo
  dueño, no impide dos pestañas del mismo usuario); avanzar una orden en una
  pestaña mientras la otra sigue mostrando el estado anterior; recargar en medio
  de una transición; conexión que se corta justo después del click (¿la UI queda
  en el estado optimista para siempre, o hay timeout?); filtrar y ordenar
  mientras llegan órdenes nuevas de otro checkout en simultáneo.
- **Riesgos**: una pestaña desactualizada reintroduce el error de una transición
  ya aplicada por la otra, mostrando un mensaje de conflicto confuso en vez de
  simplemente refrescar; el estado optimista queda "colgado" (ni confirmado ni
  revertido) si la respuesta nunca llega; el dueño pierde de vista qué orden
  estaba mirando si la lista se reordena sola por un refetch en curso.
- **Heurísticas**: "dos manos" (dos pestañas, un solo operador); interrupción
  (cortar la red con las devtools a mitad de un click); "sigue el dato" (mirar
  `order_status_history` real después de la sesión, no sólo lo que la UI mostró
  en el momento).
- **Justificación manual**: el volumen real es bajo (unas pocas órdenes por día)
  pero el operador puede tener dos pestañas abiertas del mismo panel (ADR-0009
  es un solo dueño, no impide dos pestañas), con conectividad intermitente en el
  local. Ningún test determinista reproduce ese patrón de uso real; se explora
  con el navegador de verdad.
- **Salida esperada**: confirmación de que el panel se recupera solo de una
  desincronización entre pestañas (releyendo, no mostrando un estado inventado),
  o un defecto puntual por escenario que no — mismo estándar de evidencia que el
  resto de este archivo.

## TC-1251 — Reconciliación del ciclo completo cuando aterrice US-023

- **Misión**: confirmar que el puente de siembra documentado en `design.md` §D2
  (`prisma.order.update` para alcanzar `new`) deja de hacer falta el día que
  `US-023-pago-manual-offline-backend` publique
  `POST /v1/admin/orders/{orderId}/confirm-payment`, repitiendo el ciclo
  completo `pending_payment → new → preparing → ready → delivered` **100% por
  API real**.
- **Áreas**: `POST /v1/checkout` (US-008) → `POST .../confirm-payment` (US-023,
  reemplaza el `UPDATE` directo) → los tres `PATCH` reales de este panel
  (US-012) → el detalle final, comparado campo a campo contra lo que el charter
  fue registrando en cada paso.
- **Riesgos**: que `confirm-payment` deje la orden en un estado distinto de
  `new` (rompería el contrato tácito que este panel asume); que alguna
  invariante que hoy sostiene el puente manual (por ejemplo, que el
  `consent_*` y el snapshot de precio no se toquen) no se sostenga con el
  endpoint real.
- **Heurísticas**: "reemplazar el doble por el original" (mismo camino, otra
  fuente); comparar el resultado final contra una corrida hecha con el puente
  viejo, campo a campo.
- **Justificación manual**: es la salida esperada del puente de siembra de
  `design.md` §D2 — repetir el ciclo completo usando el endpoint real de
  `US-023`, sin el `UPDATE` directo vía `@dsm/db`. No es un assert
  determinista porque su propósito es confirmar que el puente ya no hace
  falta, no verificar una propiedad nueva del producto.
- **Salida esperada**: si el ciclo completo por API real reproduce exactamente
  lo que `seed-ordenes.ts` producía con el puente, **retirar el puente**
  (actualizar `design.md` §D2 y este mismo archivo) y dejar de depender de
  `@dsm/db` en la suite de aceptación de órdenes. Si no reproduce, un defecto
  puntual contra `US-023` o contra este panel, según dónde diverja.
- **Bloqueado por**: `US-023-pago-manual-offline-backend` (0 tasks al momento
  de escribir este charter) — no ejecutable hasta que publique el endpoint.
# US-021 — Retención y anonimización

> Al momento de escribir estos charters (`/develop-qa US-021`), el backend estaba
> en 0/16 tasks (bloqueado). **Actualización**: el backend mergeó a `main` como
> parte de PR #41 (commit `c9bb229`, 30/30 tasks) — estas misiones ya son
> ejecutables contra `OrdersRetentionController`/`Service`/`Runner` reales.

## TC-021-E1 — Carrera entre el barrido oportunista y la acción a pedido

- **Misión**: disparar `POST retention-sweep` y `POST :id/anonymize` sobre la
  misma orden casi al mismo tiempo (dos pestañas / dos requests concurrentes) y
  confirmar que sólo uno "gana".
- **Áreas**: el `WHERE anonymized_at IS NULL` de `OrdersRepository.anonymize`/
  `anonymizeRetentionEligible` (`design.md` §Approach); el evento emitido por
  cada camino (`orders_retention.swept` vs `orders_retention.anonymized_on_request`).
- **Riesgos**: dos eventos para el mismo efecto (doble contabilidad de
  `anonymized_count`); un `reason` final inconsistente con quién ganó realmente
  la carrera; una ventana donde ambos caminos "ganan" y el segundo `UPDATE`
  pisa al primero sin que el guard lo impida.
- **Heurísticas**: "romper a propósito" (concurrencia deliberada, no accidental);
  seguir el dato (leer `anonymized_at`/`anonymization_reason` directo en
  Postgres entre los dos disparos, no sólo las respuestas HTTP).
- **Justificación manual**: reproducir la carrera de forma determinista
  requiere control fino de timing entre dos requests reales — no es la
  invariante estructural que ya prueba el negative-space automatizado
  (SC-021-N3/N4), es el *camino* por el que se llega a la idempotencia.
  Complementa (no duplica) el threat model "Repudiation" de `design.md`.
- **Salida esperada**: confirmación de que exactamente un evento se emite y de
  que el `reason` final es consistente con el camino que efectivamente escribió
  — o un defecto puntual si alguno de los dos no es así.

## TC-021-E2 — Cutoff en el borde de la ventana de retención (timezone/boundary)

- **Misión**: verificar de qué lado del corte cae una orden creada exactamente
  en el límite de `ORDER_RETENTION_MONTHS` (mismo día, mismo segundo del corte
  calculado con `setMonth`), y si ese comportamiento es estable entre corridas.
- **Áreas**: `OrdersRetentionService.cutoffDate()` (`design.md` §Approach —
  `new Date(); d.setMonth(d.getMonth() - retentionMonths)`); zona horaria del
  proceso de la API vs. la de Postgres.
- **Riesgos**: un desfasaje de huso horario entre el `Date` de Node y el
  `TIMESTAMP` de Postgres que corra el borde medio día para un lado u otro sin
  que nadie lo haya decidido; `setMonth` sobre fin de mes (día 31 restando un
  mes que tiene 30) produciendo un corte "sorpresa" un día antes/después de lo
  esperado.
- **Heurísticas**: boundary testing (corte exacto, corte ±1 segundo, ±1 día);
  "el calendario no es aritmética simple" (fin de mes, año bisiesto).
- **Justificación manual**: depende de backdatear `created_at` a un instante
  exacto y de observar cómo se comporta el reloj real del proceso — explorar el
  borde con corridas reales, no con un mock de reloj que ya asume la respuesta.
- **Salida esperada**: documentación de qué lado cae el borde exacto y si es
  estable, o un defecto si el corte se mueve de forma inesperada entre corridas.

## TC-021-E3 — Residuo de PII en logs/errores tras anonimizar

- **Misión**: con centinelas (email/teléfono/nombre reconocibles) en una orden,
  anonimizarla y revisar que ningún log de la API — incluidos los de error
  4xx/5xx sobre esa orden — siga mostrando los valores originales.
- **Áreas**: logs de acceso de Nest por defecto, trazas de excepción no
  manejadas, el log del propio `OrdersRetentionEventsService` (T2.2, ya
  probado en unit, pero acá se explora la ruta completa del proceso, no el
  servicio aislado).
- **Riesgos**: un log de acceso por defecto de Nest serializando el body de un
  request fallido que todavía traía el buyer original; una traza de excepción
  no manejada que incluya el objeto `Order` completo antes de anonimizar.
- **Heurísticas**: "seguir el dato" hasta cada sumidero de logging, no sólo el
  evento de negocio; provocar errores a propósito (payloads inválidos) sobre
  una orden con centinelas, para ver qué queda en el log de la excepción.
- **Justificación manual**: más allá del test unitario ya dirigido de T2.2/T5.6
  (dev-owned), este charter explora rutas de logging no anticipadas por ningún
  test — es exactamente el tipo de hallazgo que un test determinista no busca
  porque no sabe dónde mirar.
- **Salida esperada**: confirmación de que ningún sumidero de logging retiene
  PII post-anonimización, o un hallazgo puntual (con el log exacto) si alguno sí.

## TC-021-E4 — `retention-sweep` bajo rate-limit agotado en operación real

- **Misión**: con el presupuesto angosto (`ORDER_RETENTION_SWEEP_RATE_LIMIT_MAX`,
  5/hora), simular a un operador humano reintentando manualmente tras un 429 y
  verificar que el mensaje de error es comprensible para alguien sin contexto
  técnico (el dueño, per US §10).
- **Áreas**: la respuesta 429 (RFC 7807 + `Retry-After`) de `retention-sweep`;
  la redacción del `detail` que llegaría al dueño si operara el endpoint a
  mano (p. ej. vía un cliente HTTP simple o una automatización de operaciones).
- **Riesgos**: un 429 técnicamente correcto pero con un mensaje que no le dice
  al dueño cuánto tiene que esperar ni por qué; `Retry-After` ausente o con un
  valor que no coincide con la ventana real (`ORDER_RETENTION_SWEEP_RATE_LIMIT_TTL_MS`).
- **Heurísticas**: "el usuario real no es el test" (leer el mensaje como lo
  leería el dueño, no como lo lee quien escribió el código); agotar el
  presupuesto a propósito y seguir intentando, como haría un operador impaciente.
- **Justificación manual**: juzgar si una redacción de error es "comprensible
  para alguien sin contexto técnico" es una evaluación humana, no una
  aserción determinista.
- **Salida esperada**: veredicto de legibilidad del mensaje de 429 para el
  dueño, o una mejora de copy propuesta si no lo es.
