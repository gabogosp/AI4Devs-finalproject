---
type: user-story
id: US-004
slug: busqueda-semantica
parent-prd: docs/product/prd.md
parent-e2e: docs/product/design-e2e.md
status: Ready
priority: High
estimate-tshirt: M
story_points_traditional: 8
story_points_ai_assisted: 4
estimation_basis: "BE búsqueda vectorial (embed consulta + kNN pgvector + umbral + fallback + degradación full-text) (Cohn 2005 §9, 8) + FE SearchBar + resultados (Cohn 2005 §8, 5), tomado el dominante × 0.45 (Peng 2023)"
language: es
created: 2026-06-15
updated: 2026-06-15
ready-at: 2026-06-15
authored-by: Gabriel Suarez
disciplines: [BE, FE, QA]
linear-issue-id: null
figma-frames: []
---

# US-004: Búsqueda semántica en lenguaje natural + fallback

## 1. La historia (formato Connextra)

**Como** cliente,
**quiero** describir lo que necesito en lenguaje natural (ej. "algo para colgar un cuadro en pared dura") y recibir productos relevantes,
**para** encontrar lo que busco sin conocer el nombre técnico del producto.

## 2. Por qué importa (Valuable)

Es el **diferenciador** del producto (PRD §1.1). Habilita el KPI de **relevancia ≥70%** del PRD §1.4; cuando la señal no alcanza, el fallback a categorías evita el "cero resultados" frustrante.

## 3. Criterios de aceptación (Gherkin / Given-When-Then)

### AC-1: Búsqueda en lenguaje natural devuelve candidatos relevantes
```gherkin
Given un catálogo con productos publicados y embebidos (US-005)
When el cliente escribe "algo para colgar un cuadro en pared dura"
Then recibe una lista de productos candidatos ordenados por relevancia
And cada resultado enlaza a su ficha (US-003)
```

### AC-2: Relevancia mínima (batería de prueba)
```gherkin
Given una batería de ~30 consultas representativas en lenguaje natural
When se ejecutan contra el catálogo enriquecido
Then al menos el 70% devuelve un producto correcto dentro del top-5
```

### AC-3: Fallback a navegación por categorías (alternative path)
```gherkin
Given una consulta para la que no hay resultados sobre el umbral de relevancia
When el cliente la ejecuta
Then el sistema muestra un estado vacío con la sugerencia de navegar por categoría
And ofrece acceso directo a los rubros (red de seguridad)
```

### AC-4: Degradación si el proveedor IA no está disponible (alternative path)
```gherkin
Given el proveedor de IA no responde o agota el tiempo de espera
When el cliente busca
Then la búsqueda degrada a una búsqueda por texto (full-text) sobre el catálogo
And la navegación no se rompe
```

### AC-5: Consulta vacía o demasiado corta (alternative path)
```gherkin
Given el cliente envía una consulta vacía o de muy pocos caracteres
When intenta buscar
Then el sistema no ejecuta una búsqueda costosa
And invita a escribir una descripción de lo que busca
```

### AC-6: Solo productos publicados (negative space)
```gherkin
Given productos en estado "borrador" o "archivado"
When un cliente busca
Then esos productos NO aparecen en los resultados
```

### AC-7: Productos sin stock aparecen marcados (negative space)
```gherkin
Given un producto publicado relevante que está sin stock
When aparece en los resultados de búsqueda
Then se muestra con el indicador "Sin stock" (no se oculta silenciosamente)
And no ofrece la acción de agregar al carrito
```

### AC-8: La consulta no ejecuta acciones (negative space)
```gherkin
Given un cliente que escribe texto con instrucciones embebidas en la consulta
When el sistema procesa la búsqueda
Then el texto se usa únicamente para generar el embedding y buscar
And no ejecuta ninguna acción ni comando a partir del contenido de la consulta
```

### AC-9: Productos sin embedding no rompen la búsqueda (negative space)
```gherkin
Given productos publicados que todavía no fueron enriquecidos/embebidos (US-005)
When un cliente busca
Then esos productos simplemente no aparecen por la vía semántica
And la búsqueda funciona con los productos que sí tienen embedding
And siguen siendo accesibles por browse (US-002)
```

### AC-10: Control de abuso de búsqueda (negative space)
```gherkin
Given un cliente (o bot) que dispara búsquedas en exceso
When supera el límite de tasa configurado
Then el sistema limita las solicitudes
And protege el costo del proveedor de IA y los recursos del servidor
```

## 4. Out of scope explícito

- **Enriquecimiento y generación de embeddings** — US-005 (acá se consumen).
- **Navegación / listado por categoría** — US-002 (acá solo el fallback enlaza a ella).
- **Ficha de producto** — US-003 (los resultados enlazan a ella).
- **Filtros avanzados** (atributo, marca, precio) y **chatbot conversacional** — roadmap (PRD §2.2).

## 5. INVEST self-check

| Letra | Criterio | Cumple? | Notas |
|---|---|---|---|
| **I** | Independent | ✅ | Depende de US-005 (embeddings), que está Ready. |
| **N** | Negotiable | ✅ | AC refinables; el umbral, el blend y el cache los deciden E2E + dev. |
| **V** | Valuable | ✅ | El diferenciador del producto (PRD §1.1/§1.4). |
| **E** | Estimable | ✅ | 8 SP tradicional / 4 SP AI-asistido. |
| **S** | Small | ✅ | Completable en un cycle; alcance acotado a buscar + fallback. |
| **T** | Testable | ✅ | 10 AC en Gherkin, incluida la batería de relevancia medible. |

## 6. Dependencias

- **Bloqueada por**: US-005 (la búsqueda necesita los embeddings generados). US-005 está `Ready`.
- **Relacionada**: US-002 (fallback a navegación por categorías), US-003 (los resultados enlazan a la ficha).

## 7. Tasks asociadas (gruesas, una por disciplina afectada)

| Disciplina | Task id | Estimado (h) | Owner | Estado |
|---|---|---|---|---|
| BE | BE-US-004 | 12-16h | TBD | Todo |
| FE | FE-US-004 | 8-12h | TBD | Todo |
| QA | QA-US-004 | 8h | TBD | Todo |

- BE: endpoint de búsqueda (embedding de la consulta vía proveedor IA + kNN sobre pgvector/HNSW + umbral de relevancia + fallback + degradación a full-text + cache de consultas frecuentes + rate-limit).
- FE: SearchBar prominente + dropdown/resultados + estados (buscando con IA, vacío/fallback a categorías) según design-system.
- QA: batería de relevancia (~30 consultas, ≥70% top-5) + E2E (happy, fallback, degradación, rate-limit).

> Las tasks code-generating (BE/FE) abren su openspec change en `openspec/changes/US-004-busqueda-semantica-{discipline}/`. La task QA vive en `tasks/US-004/qa-deliverable.md`.

## 8. Diseño

- **Tiene Figma**: no. Hereda de `docs/product/design-system.md` — SearchBar con placeholder ejemplificador (§7.2), dropdown/resultados con `shadow-md`, estado "buscando con IA" (skeleton), estado vacío con fallback a categorías (§10.1), ProductCard + badge "Sin stock".

## 9. NFRs específicos de esta US

- Latencia p95 de búsqueda < 1.5s (incluye el embedding de la consulta) — PRD §4.
- Relevancia ≥ 70% (≥1 correcto en top-5 sobre la batería) — PRD §1.4.
- Degradación a full-text cuando el proveedor IA no responde; fallback a categorías cuando no hay señal.
- Cache de consultas frecuentes (Redis) + rate-limit (E2E §14/§17).
- Accesibilidad WCAG 2.1 AA del SearchBar (role searchbox, navegación por teclado del dropdown).
- Observabilidad: registrar búsquedas con/sin resultado (insumo directo para medir relevancia, KPI PRD §1.4).

## 10. Notas / contexto adicional

- Reglas heredadas: solo productos **publicados** aparecen; **sin stock** se muestra marcado (consistente con US-002/US-003); precios en ARS con IVA.
- El umbral de relevancia y la posible combinación con full-text (búsqueda híbrida) son decisiones técnicas que cierran el E2E/dev; los AC fijan el comportamiento observable (resultados relevantes, fallback, degradación).
- Proveedor IA y modelo de embeddings fijados en ADR-0003 (Gemini `text-embedding-004`).

---

## Definition of Ready (gate Triage → Ready)

- [x] §1 Historia escrita en formato Connextra
- [x] §2 Por qué importa explicado
- [x] §3 Al menos 1 AC en Gherkin (10 AC: 2 happy + 3 alternative + 5 negative-space)
- [x] §5 INVEST con todas las letras OK
- [x] §7 Tasks por disciplina identificadas con estimado en horas
- [x] §8 Diseño resuelto (design-system referenciado)
- [x] Dependencias chequeadas (US-005 Ready)

## Definition of Done (gate QA → Done)

- [ ] Todas las tasks de la US en estado Done
- [ ] Regression suite del producto verde en staging
- [ ] AC manuales verificados por QA
- [ ] PO firma acceptance
