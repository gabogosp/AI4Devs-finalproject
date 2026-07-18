---
type: user-story
id: US-005
slug: enriquecimiento-ia-embeddings
parent-prd: docs/product/prd.md
parent-e2e: docs/product/design-e2e.md
status: Ready
priority: High
estimate-tshirt: L
story_points_traditional: 13
story_points_ai_assisted: 6
estimation_basis: "Worker consumer con reintentos/backoff/idempotencia (Cohn 2005 §10, 8) + integración Gemini (enriquecimiento + embeddings) + persistencia pgvector/HNSW (Cohn 2005 §9-10), agregado × 0.45 (Peng 2023)"
language: es
created: 2026-06-15
updated: 2026-06-15
ready-at: 2026-06-15
authored-by: Gabriel Suarez
disciplines: [BE, QA, INFRA]
linear-issue-id: null
figma-frames: []
---

# US-005: Enriquecimiento IA de descripciones + generación de embeddings

## 1. La historia (formato Connextra)

**Como** dueño,
**quiero** que las descripciones pobres de mis productos se enriquezcan con IA y se generen sus embeddings automáticamente,
**para** que la búsqueda semántica entienda las consultas en lenguaje natural de los clientes.

## 2. Por qué importa (Valuable)

Sub-objetivo **crítico** (riesgo clave del PRD): sin descripciones enriquecidas + embeddings, la búsqueda semántica (US-004) no funciona. Habilita la **relevancia ≥70%** y la **cobertura de catálogo enriquecido ≥90%** del PRD §1.4.

## 3. Criterios de aceptación (Gherkin / Given-When-Then)

### AC-1: Enriquecer y generar embedding de un producto
```gherkin
Given un producto con descripción pobre (base) encolado para enriquecer
When el worker procesa el trabajo
Then genera una descripción enriquecida con IA y la guarda (auto-aplicada)
And genera su embedding (768 dimensiones) y lo almacena para la búsqueda vectorial
And marca el producto como enriquecido con la versión del modelo usada
```

### AC-2: El producto queda elegible para la búsqueda semántica
```gherkin
Given un producto que ya fue enriquecido y embebido
When un cliente hace una búsqueda en lenguaje natural relacionada (US-004)
Then ese producto puede aparecer como candidato según su similitud
```

### AC-3: Cobertura del catálogo importado
```gherkin
Given un catálogo importado de miles de SKUs
When el worker termina de procesar la cola
Then al menos el 90% de los productos quedan con descripción enriquecida + embedding
And la cobertura es medible/observable
```

### AC-4: Reintento ante fallo transitorio del proveedor (alternative path)
```gherkin
Given el proveedor de IA responde con rate-limit o un error transitorio
When el worker procesa un trabajo
Then reintenta con backoff sin perder el trabajo
And respeta el límite de tasa del proveedor
```

### AC-5: Fallo persistente — degradación elegante (alternative path)
```gherkin
Given un producto cuyo enriquecimiento falla tras agotar los reintentos
When el worker abandona ese trabajo
Then el producto conserva su descripción base y queda sin embedding
And sigue visible en el browse por categoría (US-002), aunque no en la búsqueda semántica
And el fallo queda registrado para reintentar luego
```

### AC-6: Re-enriquecer solo si cambió la descripción base (alternative path)
```gherkin
Given un producto ya enriquecido cuya descripción base no cambió
When se vuelve a disparar el procesamiento
Then NO se vuelve a llamar a la IA para ese producto (control de costo)
And solo se reprocesa si su descripción base cambió
```

### AC-7: No sobreescribir descripciones curadas por el dueño (negative space)
```gherkin
Given un producto cuya descripción fue editada manualmente por el dueño (curada)
When el enriquecimiento se vuelve a disparar
Then la IA NO sobreescribe la descripción curada
And el embedding se regenera sobre el texto curado si éste cambió
```

### AC-8: Versionado de embeddings (negative space)
```gherkin
Given embeddings ya generados con una versión del modelo
When se procesa un producto nuevo
Then su embedding registra la versión del modelo usada
And un cambio de modelo no corrompe ni invalida silenciosamente los embeddings existentes
```

### AC-9: No exponer secretos ni datos sensibles (negative space)
```gherkin
Given el worker llama al proveedor de IA
When registra logs o métricas del procesamiento
Then NO expone claves de API ni datos sensibles
And solo registra identificadores y resultados necesarios para operar
```

### AC-10: El enriquecimiento no publica productos (negative space)
```gherkin
Given un producto en estado "borrador" que se enriquece
When termina el enriquecimiento
Then el producto sigue en "borrador" (no se publica solo)
And la publicación sigue siendo una acción explícita del dueño (US-001)
```

## 4. Out of scope explícito

- **La búsqueda semántica en sí** (consulta → resultados) — US-004 (acá solo se prepara el dato).
- **El import / encolado** — US-006 (acá se consume la cola).
- **La elección del proveedor de IA** — ya decidida (ADR-0003: Google Gemini).
- **Edición manual de la descripción** — US-001 (acá solo se respeta el resultado curado).
- **Chatbot conversacional** — roadmap (PRD §2.2).

## 5. INVEST self-check

| Letra | Criterio | Cumple? | Notas |
|---|---|---|---|
| **I** | Independent | ✅ | Depende de US-001 (catálogo + plataforma/Redis) y US-006 (encola). Ambas Ready. |
| **N** | Negotiable | ✅ | AC refinables; el "cómo" (prompts, índice) lo deciden E2E + dev. |
| **V** | Valuable | ✅ | Habilita el diferenciador (búsqueda IA); riesgo clave del PRD. |
| **E** | Estimable | ✅ | 13 SP tradicional / 6 SP AI-asistido. |
| **S** | Small | ⚠️✅ | En el extremo alto (worker + integración IA + vector). Completable en un cycle; si se ajusta, separar "embeddings/pgvector" de "enriquecimiento". |
| **T** | Testable | ✅ | 10 AC en Gherkin; el proveedor IA se mockea en tests + medición de cobertura. |

## 6. Dependencias

- **Bloqueada por**: US-001 (modelo de catálogo + bootstrap de plataforma/Redis) y US-006 (encola los trabajos por SKU). Ambas `Ready`.
- **Bloquea a**: US-004 (la búsqueda semántica necesita los embeddings).

## 7. Tasks asociadas (gruesas, una por disciplina afectada)

| Disciplina | Task id | Estimado (h) | Owner | Estado |
|---|---|---|---|---|
| INFRA | INFRA-US-005 | 8-12h | TBD | Todo |
| BE | BE-US-005 | 16-24h | TBD | Todo |
| QA | QA-US-005 | 8h | TBD | Todo |

- INFRA: despliegue del proceso worker (BullMQ) + secrets del proveedor IA + tabla de embeddings con índice vectorial (HNSW) en pgvector.
- BE: consumer de trabajos + integración con Gemini (enriquecimiento de descripción + generación de embeddings) + persistencia + reintentos/backoff/rate-limit + idempotencia (re-enriquecer solo si cambia la base) + respeto de descripciones curadas + versionado de modelo.
- QA: tests del pipeline (proveedor IA mockeado, reintentos, idempotencia, no-pisar-curadas, degradación) + medición de cobertura (≥90%) e insumo para la relevancia (≥70%, US-004).

> Las tasks code-generating (INFRA/BE) abren su openspec change en `openspec/changes/US-005-enriquecimiento-ia-embeddings-{discipline}/`. La task QA vive en `tasks/US-005/qa-deliverable.md`.

## 8. Diseño

- **Tiene Figma**: no. Mayormente backend/worker (sin UI propia). El **estado/progreso del enriquecimiento** se muestra dentro del flujo de import (US-006) y del panel del dueño, según `docs/product/design-system.md` (estados de progreso async, badges de cobertura).

## 9. NFRs específicos de esta US

- Procesamiento **asíncrono** (Redis + BullMQ) con reintentos + backoff que respetan el rate-limit del proveedor IA (hereda E2E §9.3).
- **Idempotencia**: re-enriquecer solo si cambió la descripción base (control de costo).
- **Cobertura** ≥ 90% del catálogo enriquecido + embebido (PRD §1.4); contribuye a relevancia ≥ 70% (medida en US-004).
- Embeddings de 768 dimensiones, con índice vectorial HNSW (E2E §8); versión de modelo registrada.
- Seguridad: claves del proveedor IA solo en secrets; nunca en logs (E2E §14).
- Observabilidad: trabajos ok/fallidos/reintentados, cobertura del catálogo, costo aproximado de IA.

## 10. Notas / contexto adicional

- Reglas de negocio confirmadas: (1) la descripción enriquecida se **auto-aplica** (el dueño puede editarla luego en US-001); (2) una descripción **curada por el dueño no se sobreescribe** por la IA, pero su embedding sí se regenera sobre el texto curado si cambia.
- Degradación: si el proveedor IA no está disponible, el producto queda con descripción base + sin embedding → aparece en browse pero no en búsqueda semántica (red de seguridad del PRD §3.2). La búsqueda (US-004) también degrada a full-text.
- Proveedor y modelos fijados en ADR-0003 (Gemini: `gemini-1.5-flash` + `text-embedding-004`).

---

## Definition of Ready (gate Triage → Ready)

- [x] §1 Historia escrita en formato Connextra
- [x] §2 Por qué importa explicado
- [x] §3 Al menos 1 AC en Gherkin (10 AC: 3 happy + 3 alternative + 4 negative-space)
- [x] §5 INVEST con todas las letras OK (S en extremo alto, aceptable)
- [x] §7 Tasks por disciplina identificadas con estimado en horas
- [x] §8 Diseño resuelto (sin UI propia; progreso vía design-system)
- [x] Dependencias chequeadas (US-001 y US-006 Ready)

## Definition of Done (gate QA → Done)

- [ ] Todas las tasks de la US en estado Done
- [ ] Regression suite del producto verde en staging
- [ ] AC manuales verificados por QA
- [ ] PO firma acceptance
