---
type: user-story
id: US-006
slug: import-masivo-inventario
parent-prd: docs/product/prd.md
parent-e2e: docs/product/design-e2e.md
status: Ready
priority: Medium
estimate-tshirt: M
story_points_traditional: 8
story_points_ai_assisted: 4
estimation_basis: "BE batch import con validación por fila + upsert + encolado async (Cohn 2005 §10, 8) + FE upload con progreso + reporte (Cohn 2005 §8, 5), agregado y tomado el dominante × 0.45 (Peng 2023)"
language: es
created: 2026-06-15
updated: 2026-06-15
ready-at: 2026-06-15
authored-by: Gabriel Suarez
disciplines: [BE, FE, QA]
linear-issue-id: null
figma-frames: []
---

# US-006: Importación masiva de inventario (CSV/Excel)

## 1. La historia (formato Connextra)

**Como** dueño,
**quiero** subir un archivo CSV/Excel para dar de alta o actualizar miles de SKUs (incluido precio y stock) de una vez,
**para** cargar y mantener el catálogo real sin hacerlo a mano.

## 2. Por qué importa (Valuable)

Una ferretería real tiene miles de SKUs; el alta manual no escala. Es la precondición práctica para poblar el catálogo (US-001) y habilitar el enriquecimiento IA (US-005) y la búsqueda — aporta a la **cobertura de catálogo ≥90%** del PRD §1.4.

## 3. Criterios de aceptación (Gherkin / Given-When-Then)

### AC-1: Importar un archivo válido (alta + actualización por SKU)
```gherkin
Given el dueño autenticado con un archivo CSV/Excel con columnas SKU, nombre, precio, stock y categoría
When sube el archivo
Then los SKUs nuevos se crean y los SKUs existentes se actualizan (precio, stock, nombre, categoría)
And cada producto se identifica y reconcilia por su SKU
```

### AC-2: Categoría inexistente se crea automáticamente
```gherkin
Given una fila que referencia la categoría "Plomería" que aún no existe
When se procesa el import
Then la categoría "Plomería" se crea automáticamente (con nombre normalizado para evitar duplicados)
And el producto queda asignado a esa categoría
```

### AC-3: Tras el import se encola el enriquecimiento + embeddings
```gherkin
Given un import que creó o cambió la descripción base de N productos
When el import finaliza correctamente
Then se encolan los trabajos de enriquecimiento de descripción y generación de embeddings para esos productos
And el catálogo queda listo para que la búsqueda semántica los incluya cuando los trabajos terminen
```

### AC-4: Actualización masiva de precios (inflación)
```gherkin
Given un catálogo ya cargado
When el dueño re-importa un archivo con precios actualizados para SKUs existentes
Then los precios se actualizan en ARS (IVA incluido) sin crear productos duplicados
```

### AC-5: Filas con error — importa válidas, reporta inválidas (alternative path)
```gherkin
Given un archivo donde algunas filas tienen errores (precio ≤ 0, SKU vacío, stock negativo) y otras son válidas
When se procesa el import
Then las filas válidas se importan
And el sistema devuelve un reporte con las filas rechazadas y el motivo de cada una
And ninguna fila válida queda a medio importar (cada fila es atómica)
```

### AC-6: Archivo con formato/columnas inválidas (alternative path)
```gherkin
Given un archivo con formato no soportado o sin las columnas requeridas
When el dueño lo sube
Then el sistema rechaza el archivo completo con un mensaje claro sobre qué falta
And no impacta el catálogo
```

### AC-7: Procesamiento asíncrono con progreso (alternative path)
```gherkin
Given un archivo grande con miles de SKUs
When el dueño lo sube
Then el import se procesa en segundo plano sin bloquear la interfaz
And el dueño ve el estado/progreso y puede descargar el reporte al finalizar
```

### AC-8: Solo el admin puede importar (negative space)
```gherkin
Given un visitante sin sesión de administrador
When intenta invocar la importación de inventario
Then el sistema deniega el acceso
And no procesa ningún archivo
```

### AC-9: Producto nuevo importado no se publica solo (negative space)
```gherkin
Given un SKU nuevo creado por el import
When el import finaliza
Then el producto queda en estado "borrador" (no visible en el storefront)
And el dueño debe publicarlo explícitamente (consistente con US-001)
```

### AC-10: Re-importar no duplica (idempotencia por SKU) (negative space)
```gherkin
Given un catálogo donde ya existe el SKU "REF-001"
When el dueño importa de nuevo un archivo que contiene "REF-001"
Then el producto se actualiza, no se crea un segundo producto con ese SKU
```

### AC-11: Límite de tamaño/filas (negative space)
```gherkin
Given un archivo que excede el límite de tamaño o de cantidad de filas permitido
When el dueño intenta subirlo
Then el sistema lo rechaza antes de procesar
And no compromete recursos del servidor (protección anti-DoS)
```

## 4. Out of scope explícito

- **Enriquecimiento IA y generación de embeddings en sí** — US-005 (acá solo se encolan los trabajos).
- **Mapeo de columnas configurable / plantillas personalizadas** — v1 usa un esquema de columnas fijo y documentado.
- **Carga de imágenes desde el archivo** — si el archivo trae `image_url` se referencia; la gestión avanzada de imágenes queda fuera de v1.
- **Programación de imports recurrentes / sincronización automática** — fuera de v1 (relacionado al roadmap MercadoLibre).

## 5. INVEST self-check

| Letra | Criterio | Cumple? | Notas |
|---|---|---|---|
| **I** | Independent | ✅ | Depende de US-001 (modelo de catálogo), que está Ready. |
| **N** | Negotiable | ✅ | AC refinables; la implementación la deciden E2E + dev. |
| **V** | Valuable | ✅ | Permite poblar el catálogo real a escala (PRD §1.4). |
| **E** | Estimable | ✅ | 8 SP tradicional / 4 SP AI-asistido. |
| **S** | Small | ✅ | Completable en un cycle; alcance acotado al import. |
| **T** | Testable | ✅ | 11 AC en Gherkin, observables (incluye archivos de prueba con filas válidas/inválidas). |

## 6. Dependencias

- **Bloqueada por**: US-001 (modelo de catálogo: productos, categorías, SKU único). US-001 está `Ready`.
- **Bloquea a**: US-005 (el import encola el enriquecimiento + embeddings por SKU nuevo/cambiado).

## 7. Tasks asociadas (gruesas, una por disciplina afectada)

| Disciplina | Task id | Estimado (h) | Owner | Estado |
|---|---|---|---|---|
| BE | BE-US-006 | 12-16h | TBD | Todo |
| FE | FE-US-006 | 8-12h | TBD | Todo |
| QA | QA-US-006 | 6-8h | TBD | Todo |

- BE: parser CSV/Excel + validación por fila + upsert (productos/categorías/stock) + auto-creación de categorías + encolado de trabajos de enriquecimiento (BullMQ) + generación del reporte de errores + límite de tamaño/filas.
- FE: pantalla de importación (upload, estado/progreso async, descarga del reporte de filas rechazadas) según design-system.
- QA: automatización de las AC (válidas/inválidas, idempotencia, autorización, límite) + archivos de prueba representativos.

> Las tasks code-generating (BE/FE) abren su openspec change en `openspec/changes/US-006-import-masivo-inventario-{discipline}/`. La task QA vive en `tasks/US-006/qa-deliverable.md`.

## 8. Diseño

- **Tiene Figma**: no. Hereda de `docs/product/design-system.md` — flujo de import: Input/upload, estado de progreso (skeleton/estado async), banner de resultado (success/warning con conteo) y descarga del reporte de errores. Tono de copy según §10.2.

## 9. NFRs específicos de esta US

- Procesamiento **asíncrono** (Redis + BullMQ): el import no bloquea el request; maneja miles de filas.
- **Idempotencia por SKU**: re-importar no duplica.
- Reintentos/backoff al encolar el enriquecimiento (respeta rate-limit del proveedor IA — hereda E2E §9.3).
- Límite de tamaño/filas configurable (protección anti-DoS, E2E §14).
- Autorización: importación exclusiva del rol admin.
- Observabilidad: registrar filas importadas / rechazadas y trabajos encolados (alimenta cobertura de catálogo, PRD §1.4).

## 10. Notas / contexto adicional

- Reglas de negocio confirmadas: (1) errores parciales → **importa filas válidas y reporta las inválidas** (cada fila atómica); (2) categoría inexistente → **se crea automáticamente** con nombre normalizado; (3) productos nuevos importados nacen **borrador** (consistente con US-001).
- Esquema de columnas v1 (a documentar en la task BE): SKU, nombre, descripción base, precio (ARS), stock, categoría, [image_url opcional].

---

## Definition of Ready (gate Triage → Ready)

- [x] §1 Historia escrita en formato Connextra
- [x] §2 Por qué importa explicado
- [x] §3 Al menos 1 AC en Gherkin (11 AC: 4 happy + 3 alternative + 4 negative-space)
- [x] §5 INVEST con todas las letras OK
- [x] §7 Tasks por disciplina identificadas con estimado en horas
- [x] §8 Diseño resuelto (design-system referenciado)
- [x] Dependencias chequeadas (US-001 Ready)

## Definition of Done (gate QA → Done)

- [ ] Todas las tasks de la US en estado Done
- [ ] Regression suite del producto verde en staging
- [ ] AC manuales verificados por QA
- [ ] PO firma acceptance
