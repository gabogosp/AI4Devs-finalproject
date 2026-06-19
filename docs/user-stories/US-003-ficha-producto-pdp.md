---
type: user-story
id: US-003
slug: ficha-producto-pdp
parent-prd: docs/product/prd.md
parent-e2e: docs/product/design-e2e.md
status: Ready
priority: High
estimate-tshirt: S
story_points_traditional: 5
story_points_ai_assisted: 2
estimation_basis: "FE página de detalle SSR + SEO/JSON-LD (Cohn 2005 §8, 5) + BE GET producto por slug/id (Cohn 2005 §8, 3), tomado el dominante × 0.45 (Peng 2023)"
language: es
created: 2026-06-15
updated: 2026-06-15
ready-at: 2026-06-15
authored-by: Gabriel Suarez
disciplines: [BE, FE, QA]
linear-issue-id: null
figma-frames: []
---

# US-003: Ficha de producto (PDP) indexable

## 1. La historia (formato Connextra)

**Como** cliente,
**quiero** ver la ficha de un producto con su descripción, precio (ARS, IVA incluido), imagen y disponibilidad,
**para** decidir la compra; y que esa página sea encontrada por Google.

## 2. Por qué importa (Valuable)

La ficha es el punto de conversión del descubrimiento (browse o búsqueda IA) hacia la compra, y una página clave para **SEO** (objetivo de negocio del PRD §1.2).

## 3. Criterios de aceptación (Gherkin / Given-When-Then)

### AC-1: Ver la ficha de un producto publicado
```gherkin
Given un producto publicado en el catálogo
When el cliente abre su ficha
Then ve su nombre, descripción, precio en ARS (IVA incluido), imagen y categoría
And ve su disponibilidad (en stock / sin stock)
And la URL de la ficha es amigable (slug)
```

### AC-2: Ficha indexable (SEO)
```gherkin
Given la ficha de un producto
When un buscador (o el cliente) la solicita
Then el HTML se renderiza en el servidor con el contenido del producto
And la página incluye metadatos (title/description) y datos estructurados de producto (JSON-LD)
```

### AC-3: Producto con stock permite iniciar la compra
```gherkin
Given un producto publicado con stock disponible
When el cliente ve la ficha
Then se ofrece la acción de agregar al carrito
And esa acción habilita el flujo de compra (detallado en US-007)
```

### AC-4: Producto sin stock — visible pero no comprable (alternative path)
```gherkin
Given un producto publicado que está sin stock
When el cliente abre su ficha
Then la ficha se muestra con el indicador "Sin stock"
And no ofrece la acción de agregar al carrito
And ofrece el canal de contacto (WhatsApp) para consultar (US-018)
```

### AC-5: Descripción enriquecida cuando existe (alternative path)
```gherkin
Given un producto cuya descripción fue enriquecida con IA (US-005)
When el cliente abre la ficha
Then se muestra la descripción enriquecida
And si el producto aún no fue enriquecido, se muestra su descripción base
```

### AC-6: Producto sin imagen (alternative path)
```gherkin
Given un producto publicado sin imagen cargada
When el cliente abre su ficha
Then se muestra una imagen placeholder
And el resto de la ficha se renderiza normalmente
```

### AC-7: Borrador/archivado no es accesible por URL (negative space)
```gherkin
Given un producto en estado "borrador" o "archivado"
When alguien intenta acceder directamente a su URL de ficha
Then el sistema responde 404
And no expone el producto ni lo hace indexable
```

### AC-8: Producto inexistente devuelve 404 (negative space)
```gherkin
Given una URL de ficha que no corresponde a ningún producto
When alguien la solicita
Then el sistema responde 404 (no una página 200 vacía)
```

### AC-9: El precio mostrado es el vigente (negative space)
```gherkin
Given que el dueño actualizó el precio de un producto en el catálogo
When un cliente abre la ficha luego de la actualización
Then la ficha muestra el precio vigente
And no sirve indefinidamente un precio desactualizado por caché
```

## 4. Out of scope explícito

- **Agregar al carrito (la acción y su lógica)** — US-007 (acá la ficha solo ofrece el disparador).
- **Galería de múltiples imágenes / zoom** — fuera de v1 (una imagen principal).
- **Productos relacionados / cross-sell / reseñas** — fuera de v1 (roadmap).
- **Enriquecimiento de la descripción en sí** — US-005 (acá solo se muestra el resultado).
- **Navegación / listado por categoría** — US-002.

## 5. INVEST self-check

| Letra | Criterio | Cumple? | Notas |
|---|---|---|---|
| **I** | Independent | ✅ | Depende de US-001 (productos), que está Ready. Funciona con descripción base aunque US-005 no esté hecha. |
| **N** | Negotiable | ✅ | AC refinables; el "cómo" lo deciden E2E + dev. |
| **V** | Valuable | ✅ | Punto de conversión + SEO (PRD §1.2/§1.4). |
| **E** | Estimable | ✅ | 5 SP tradicional / 2 SP AI-asistido. |
| **S** | Small | ✅ | Página de detalle acotada; completable en un cycle. |
| **T** | Testable | ✅ | 9 AC en Gherkin, observables (incluye 404 y verificación SSR/JSON-LD). |

## 6. Dependencias

- **Bloqueada por**: US-001 (producto publicado con sus datos). US-001 está `Ready`.
- **Relacionada**: US-002 (el listado enlaza a la ficha), US-007 (acción de agregar al carrito), US-005 (descripción enriquecida — no bloqueante: la ficha usa la base si falta).

## 7. Tasks asociadas (gruesas, una por disciplina afectada)

| Disciplina | Task id | Estimado (h) | Owner | Estado |
|---|---|---|---|---|
| BE | BE-US-003 | 3-5h | TBD | Todo |
| FE | FE-US-003 | 8-12h | TBD | Todo |
| QA | QA-US-003 | 4-6h | TBD | Todo |

- BE: endpoint de obtención de producto por slug/id (solo si está publicado; 404 en caso contrario).
- FE: página SSR de ficha + datos estructurados (JSON-LD) + metadatos + disparador de agregar al carrito + estados (sin stock, sin imagen, descripción base/enriquecida).
- QA: E2E de la ficha (publicado, sin stock, 404 borrador/inexistente) + verificación SEO/SSR + accesibilidad.

> Las tasks code-generating (BE/FE) abren su openspec change en `openspec/changes/US-003-ficha-producto-pdp-{discipline}/`. La task QA vive en `tasks/US-003/qa-deliverable.md`.

## 8. Diseño

- **Tiene Figma**: no. Hereda de `docs/product/design-system.md` — ProductCard/ficha (§7.3), PriceTag ARS (§7.4), badge "Sin stock" (§7.7), imagen con fallback (§10.1), botón "Agregar al carrito" (§7.1, variante accent), enlace WhatsApp (§7.10).

## 9. NFRs específicos de esta US

- Latencia p95 lectura < 300ms (hereda PRD §4); **LCP < 2.5s** y **SSR** (SEO).
- Datos estructurados JSON-LD de producto + metadatos por ficha.
- Precio siempre vigente (sin caché de precio de larga duración / invalidación al actualizar).
- Accesibilidad WCAG 2.1 AA (alt descriptivo en imagen, jerarquía de headings).
- Observabilidad: registrar vistas de ficha (insumo para el panel de métricas US-016).

## 10. Notas / contexto adicional

- Reglas heredadas de decisiones previas: solo productos **publicados** son accesibles (US-001); **sin stock** se muestra con indicador y sin acción de compra (US-002); precio en ARS con IVA incluido; descripción **enriquecida si existe**, si no la base (US-005).
- La acción real de agregar al carrito y su lógica viven en US-007; esta US solo expone el disparador en la ficha.

---

## Definition of Ready (gate Triage → Ready)

- [x] §1 Historia escrita en formato Connextra
- [x] §2 Por qué importa explicado
- [x] §3 Al menos 1 AC en Gherkin (9 AC: 3 happy + 3 alternative + 3 negative-space)
- [x] §5 INVEST con todas las letras OK
- [x] §7 Tasks por disciplina identificadas con estimado en horas
- [x] §8 Diseño resuelto (design-system referenciado)
- [x] Dependencias chequeadas (US-001 Ready)

## Definition of Done (gate QA → Done)

- [ ] Todas las tasks de la US en estado Done
- [ ] Regression suite del producto verde en staging
- [ ] AC manuales verificados por QA
- [ ] PO firma acceptance
