---
type: user-story
id: US-002
slug: storefront-navegacion-categorias
parent-prd: docs/product/prd.md
parent-e2e: docs/product/design-e2e.md
status: Ready
priority: High
estimate-tshirt: M
story_points_traditional: 8
story_points_ai_assisted: 4
estimation_basis: "FE páginas de listado SSR + navegación + SEO (Cohn 2005 §9, 8) + BE endpoints de listado por categoría con paginación (Cohn 2005 §8, 5), agregado y tomado el dominante × 0.45 (Peng 2023)"
language: es
created: 2026-06-15
updated: 2026-06-15
ready-at: 2026-06-15
authored-by: Gabriel Suarez
disciplines: [BE, FE, QA]
linear-issue-id: null
figma-frames: []
---

# US-002: Storefront — navegación por categorías (SSR/SEO)

## 1. La historia (formato Connextra)

**Como** cliente,
**quiero** navegar los productos por rubros y subrubros (refrigeración → compresores, plomería, electricidad, etc.) en páginas indexables,
**para** encontrar lo que busco recorriendo el catálogo y que la tienda aparezca en Google.

## 2. Por qué importa (Valuable)

El browse por categoría es la **red de seguridad** del descubrimiento (cuando la búsqueda IA no alcanza) y la principal vía de **SEO** — un objetivo de negocio central del PRD §1.2/§1.4 (que DSM "se la encuentre en Google").

## 3. Criterios de aceptación (Gherkin / Given-When-Then)

### AC-1: Navegar a un rubro
```gherkin
Given un cliente en el storefront
When entra al rubro "Refrigeración"
Then ve los subrubros de "Refrigeración" y/o los productos publicados de ese rubro
And la URL del rubro es amigable (slug)
```

### AC-2: Navegar rubro → subrubro
```gherkin
Given el rubro "Refrigeración" con el subrubro "Compresores"
When el cliente entra a "Compresores"
Then ve únicamente los productos publicados de ese subrubro
And puede volver al rubro padre desde la navegación
```

### AC-3: Listado de productos de una categoría
```gherkin
Given una categoría con productos publicados
When el cliente la abre
Then cada producto muestra nombre, precio en ARS (IVA incluido), imagen (o placeholder) y disponibilidad
And el listado está paginado
And cada producto enlaza a su ficha (US-003)
```

### AC-4: Página de categoría indexable (SEO)
```gherkin
Given una página de categoría
When un buscador (o el cliente) la solicita
Then el HTML se renderiza en el servidor con los productos visibles
And la página incluye metadatos (title/description) y queda registrada en el sitemap
```

### AC-5: Producto sin stock visible pero no comprable (alternative path)
```gherkin
Given un producto publicado que está sin stock
When aparece en el listado de su categoría
Then se muestra con un indicador "Sin stock"
And no ofrece la acción de agregar al carrito
```

### AC-6: Categoría sin productos (alternative path)
```gherkin
Given una categoría publicada que no tiene productos publicados
When el cliente la abre
Then ve un estado vacío con un mensaje claro
And puede navegar a otros rubros
```

### AC-7: Catálogo grande sin degradación (alternative path)
```gherkin
Given una categoría con cientos de productos (catálogo de ≥5.000 SKUs en total)
When el cliente recorre el listado paginado
Then las páginas cargan dentro del objetivo de latencia/Core Web Vitals
And la navegación entre páginas no recarga el catálogo completo
```

### AC-8: Borradores y archivados no se exponen (negative space)
```gherkin
Given productos en estado "borrador" o "archivado"
When un cliente navega las categorías o ve el HTML de la página
Then esos productos NO aparecen en ningún listado público
```

### AC-9: Categoría inexistente devuelve 404 (negative space)
```gherkin
Given una URL de categoría que no existe
When alguien la solicita
Then el sistema responde 404 (no una página 200 vacía)
And no genera una página indexable fantasma
```

### AC-10: El contenido es server-rendered (negative space)
```gherkin
Given la página de una categoría con productos
When se inspecciona el HTML inicial de la respuesta (sin ejecutar JavaScript)
Then el HTML ya contiene los productos del listado
And la indexación no depende de la ejecución de JavaScript en el cliente
```

## 4. Out of scope explícito

- **Búsqueda semántica en lenguaje natural** — US-004.
- **Filtros avanzados** (por atributo, marca, rango de precio) — PRD §2.2 (roadmap).
- **Ficha de producto (detalle)** — US-003 (el listado enlaza a ella, pero el detalle se construye allí).
- **Carrito / compra** — US-007 en adelante.
- **Administración de categorías** (alta/edición) — US-001.

## 5. INVEST self-check

| Letra | Criterio | Cumple? | Notas |
|---|---|---|---|
| **I** | Independent | ✅ | Depende de US-001 (catálogo), que está Ready. |
| **N** | Negotiable | ✅ | AC refinables; el "cómo" lo deciden E2E + dev. |
| **V** | Valuable | ✅ | Descubrimiento + SEO, objetivo central del PRD. |
| **E** | Estimable | ✅ | 8 SP tradicional / 4 SP AI-asistido. |
| **S** | Small | ✅ | Completable en un cycle; alcance acotado al browse + SEO. |
| **T** | Testable | ✅ | 10 AC en Gherkin (incluye verificación SSR observable). |

## 6. Dependencias

- **Bloqueada por**: US-001 (productos y categorías cargados; jerarquía rubro/subrubro). US-001 está `Ready`.
- **Relacionada**: US-003 (cada item del listado enlaza a la ficha), US-004 (comparte el storefront).

## 7. Tasks asociadas (gruesas, una por disciplina afectada)

| Disciplina | Task id | Estimado (h) | Owner | Estado |
|---|---|---|---|---|
| BE | BE-US-002 | 6-10h | TBD | Todo |
| FE | FE-US-002 | 12-16h | TBD | Todo |
| QA | QA-US-002 | 6-8h | TBD | Todo |

- BE: endpoints de listado por rubro/subrubro (solo productos publicados) + paginación (cursor/offset) + árbol de categorías.
- FE: páginas SSR de rubro y subrubro + CategoryNav (dos niveles) + grilla de productos (ProductCard) + SEO (slugs, metadatos, sitemap, JSON-LD de producto) + estados vacío/sin-stock.
- QA: E2E de navegación (rubro→subrubro→ficha) + verificación de SSR/indexabilidad + 404 + accesibilidad.

> Las tasks code-generating (BE/FE) abren su openspec change en `openspec/changes/US-002-storefront-navegacion-categorias-{discipline}/`. La task QA vive en `tasks/US-002/qa-deliverable.md`.

## 8. Diseño

- **Tiene Figma**: no. Hereda de `docs/product/design-system.md` — CategoryNav (§7.10, dos niveles), ProductCard + grilla (§7.3, §4), PriceTag ARS (§7.4), badge "Sin stock" (§7.7), estado vacío (§10.1).

## 9. NFRs específicos de esta US

- Latencia p95 lectura < 300ms (hereda PRD §4); **LCP < 2.5s** y **SSR** obligatorio (SEO, PRD §4).
- Sitemap + metadatos + JSON-LD de producto en páginas de categoría/producto.
- Paginación (cursor/offset) que soporte ≥5.000 SKUs sin recargar el catálogo completo.
- Accesibilidad WCAG 2.1 AA (navegación por teclado, jerarquía de headings, alt en imágenes).
- Observabilidad: registrar vistas por categoría (insumo de negocio para el panel de métricas US-016).

## 10. Notas / contexto adicional

- Reglas de negocio confirmadas: (1) productos publicados **sin stock se muestran** con indicador "Sin stock" y sin acción de compra; (2) la navegación es de **dos niveles** (rubro → subrubro), aprovechando `parent_id` del modelo (E2E §8).
- Solo se exponen productos en estado "publicado" (consistente con US-001); borradores/archivados nunca aparecen.
- Precios en ARS con IVA incluido (formato local).

---

## Definition of Ready (gate Triage → Ready)

- [x] §1 Historia escrita en formato Connextra
- [x] §2 Por qué importa explicado
- [x] §3 Al menos 1 AC en Gherkin (10 AC: 4 happy + 3 alternative + 3 negative-space)
- [x] §5 INVEST con todas las letras OK
- [x] §7 Tasks por disciplina identificadas con estimado en horas
- [x] §8 Diseño resuelto (design-system referenciado)
- [x] Dependencias chequeadas (US-001 Ready)

## Definition of Done (gate QA → Done)

- [ ] Todas las tasks de la US en estado Done
- [ ] Regression suite del producto verde en staging
- [ ] AC manuales verificados por QA
- [ ] PO firma acceptance
