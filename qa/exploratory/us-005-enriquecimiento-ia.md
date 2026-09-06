# Charters exploratorios — US-005 Enriquecimiento IA de descripciones + embeddings

> Exploración con **tiempo acotado**, no scripts (`qa-plan.md` §11, `QA-005-EXP-1`,
> `execution_mode: manual`). Lo que se busca es lo que la suite automatizada
> (aceptación/contract/k6) no puede afirmar: comportamiento real del proveedor fuera
> de los casos ya cubiertos, ambigüedades del contrato admin, y ruido cross-sesión
> sobre el catálogo compartido. Los hallazgos se registran acá abajo, con fecha.

## Charter: comportamiento real del proveedor con una clave que cambia a mitad de corrida · 30 min

**Riesgo que explora**: `SC-005-C1`/`SC-005-C2`/`SC-005-N4` ya prueban el camino de una
clave real INVÁLIDA de forma estable (siempre el mismo tipo de rechazo de Google). Lo
que no está cubierto es qué pasa si, a mitad de una corrida activa (perfil B,
`design.md` §D-QA4), la clave configurada cambia de "inválida con un formato" a
"también inválida pero con OTRO formato" — el `design.md` de backend predice que la
clasificación transitorio/permanente (`gemini-http.client.ts`, `postDirecto`) depende
enteramente del status HTTP que Google devuelve (400 → permanente, 429/5xx →
transitorio), y eso podría no ser tan estable como el código asume.

Recorrido sugerido:

1. Levantar una instancia temporal (perfil B) con `GEMINI_API_KEY=replace-me` y
   disparar una corrida sobre 2-3 productos sembrados con `sembrarLotePendiente`.
2. Observar en el log (`LOG_LEVEL=debug`) el status HTTP exacto que devuelve
   `https://generativelanguage.googleapis.com` para esa clave — ¿es siempre 400, o
   varía (401/403) según el endpoint (`embedContent` vs `generateContent`)?
3. Repetir con una clave de otro formato inválido (por ejemplo, una cadena vacía de
   longitud distinta, o con caracteres no-ASCII) — ¿el status HTTP cambia? Si cambia a
   un 429/5xx, ¿el código realmente lo trata como transitorio y reintenta *dentro* del
   mismo request (`withRetry`, T1.3 del backend) antes de contarlo como una falla del
   backoff durable?
4. Documentar cualquier status HTTP inesperado (no 400/401/403) — sería una rama que
   la matriz `AiTransientError`/`AiPermanentError` no está clasificando como se pensó.

**Hallazgos** · _(pendiente de ejecución)_

## Charter: interacción de `force` con `product_ids` en el mismo cuerpo · 20 min

**Riesgo que explora**: el contrato (`openspec/specs/enriquecimiento-ia/contracts/
openapi.yaml`, `StartEnrichmentRun`) no dice explícitamente qué pasa si `force: true`
y `product_ids` llegan JUNTOS en el mismo `POST /runs`. Leyendo `enrichment.runner.ts`
(`start()`), `rehabilitateAbandoned(opciones.productIds)` sí respeta el filtro de ids
cuando está presente — pero esto no está probado negro-caja, ni el contrato lo aclara
para un futuro cliente (la UI de curación diferida, D-1).

Recorrido sugerido:

1. Sembrar un lote de productos: algunos abandonados (agotar intentos como en
   `SC-005-C2`) y otros pendientes normales, mezclados.
2. Disparar `POST /runs` con `{ force: true, product_ids: [<sólo los abandonados>] }`
   — ¿rehabilita SÓLO esos ids, o el código de `rehabilitateAbandoned` interpreta algo
   distinto?
3. Disparar `POST /runs` con `{ force: true, product_ids: [<sólo pendientes, ningún
   abandonado>] }` — ¿qué responde? ¿Es un 202 que no rehabilita nada (comportamiento
   correcto, sólo que el nombre "force" podría sugerir más) o pasa algo inesperado?
4. Si el comportamiento observado sorprende, es candidato a una aclaración explícita
   en `StartEnrichmentRun.description` (contrato vivo) — documentar la propuesta de
   redacción concreta, no sólo "esto es confuso".

**Hallazgos** · _(pendiente de ejecución)_

## Charter: ruido cross-sesión sobre el catálogo compartido tras el fix de QA-005-F1 · 20 min

**Riesgo que explora**: T0.1 corrigió la instancia compartida para que nunca dispare
enriquecimiento real, pero el fix es de higiene de ENTORNO, no un test automatizado
por sí solo — vale la pena confirmar a mano que ninguna OTRA suite del harness
(`carrito`, `importar`, `ordenes`, etc.) ve su catálogo tocado por un enriquecimiento
de fondo durante una corrida completa sin filtro de tags.

Recorrido sugerido:

1. Con la instancia compartida arriba (`qa/scripts/api-up.sh`, ya con el fix aplicado),
   correr `pnpm --filter @dsm/qa test:acceptance` SIN ningún filtro de `--tags` (la
   suite completa, todas las features).
2. Antes y después, comparar `SELECT count(*) FROM products WHERE enrichment_attempts
   > 0 OR enrichment_error_code IS NOT NULL` — debería ser idéntico salvo por lo que la
   propia suite de `enriquecimiento.feature` sembró y tocó explícitamente (perfiles B/C,
   instancias propias) — ningún producto de OTRA feature debería aparecer tocado.
3. Revisar el log de la instancia compartida (`LOG_LEVEL=debug`) buscando cualquier
   línea que mencione `GeminiHttpClient`/`enrichment.run_started` durante la corrida de
   `importar.feature` — no debería haber ninguna (US-006 dispara el `kick()` tras cada
   import, pero con `ENRICHMENT_ENABLED=false` el runner nunca pasa de `disabled`).
4. Si aparece cualquier rastro de actividad de enriquecimiento fuera de
   `enriquecimiento.feature`, es un hallazgo crítico: el fix de T0.1 no cerró
   completamente QA-005-F1.

**Hallazgos** · _(pendiente de ejecución)_

---

> Los tres charters son **manuales a propósito** (`execution_mode: manual`,
> `QA-005-EXP-1` en `qa-plan.md` §5/§11): lo que exploran es comportamiento real del
> proveedor fuera de la matriz ya probada, ambigüedad de contrato, y verificación
> operativa de un fix de entorno — ninguno de los tres se beneficia de scaffoldearse
> como test automatizado (el primero depende de qué status devuelva Google en el
> momento; el segundo es exploración de diseño de contrato; el tercero es una
> auditoría puntual del fix de T0.1, no un comportamiento repetible del producto).
