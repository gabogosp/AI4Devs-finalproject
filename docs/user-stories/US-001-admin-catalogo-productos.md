---
type: user-story
id: US-001
slug: admin-catalogo-productos
parent-prd: docs/product/prd.md
parent-e2e: docs/product/design-e2e.md
status: In Progress
priority: High
estimate-tshirt: L
story_points_traditional: 13
story_points_ai_assisted: 6
estimation_basis: "Agregado: BE full CRUD x2 entidades + estado publish/archive (Cohn 2005 §8, 5) + FE admin CRUD page con RBAC (Cohn 2005 §9, 8) + INFRA bootstrap plataforma + esquema catálogo (Cohn 2005 §11) — × 0.45 (Peng 2023)"
language: es
created: 2026-06-15
updated: 2026-06-15
ready-at: 2026-06-15
authored-by: Gabriel Suarez
disciplines: [BE, FE, QA, INFRA]
linear-issue-id: null
figma-frames: []
---

# US-001: Admin de catálogo — alta y edición de productos y categorías

## 1. La historia (formato Connextra)

**Como** dueño/administrador (Pedro),
**quiero** dar de alta y editar productos y categorías (rubros) desde el panel, y controlar cuándo cada producto se publica,
**para** tener el catálogo cargado y mantenido como base de la tienda online.

## 2. Por qué importa (Valuable)

Sin catálogo no hay tienda: es la base sobre la que se apoyan el browse (US-002), la ficha (US-003), la búsqueda IA (US-004/005) y la compra. Habilita la **cobertura de catálogo enriquecido ≥90%** y el loop E2E del PRD §1.4.

## 3. Criterios de aceptación (Gherkin / Given-When-Then)

### AC-1: Crear categoría (rubro)
```gherkin
Given el dueño autenticado en el panel de administración
When crea una categoría con nombre "Refrigeración"
Then la categoría queda registrada con un slug único
And queda disponible para asignar a productos
```

### AC-2: Alta de producto en borrador
```gherkin
Given el dueño autenticado en el panel
When da de alta un producto con nombre, SKU, precio (ARS), stock y categoría
Then el producto se crea en estado "borrador"
And NO aparece en el storefront ni en la búsqueda hasta publicarlo
```

### AC-3: Editar un producto existente
```gherkin
Given un producto existente en el catálogo
When el dueño modifica su precio, stock, descripción, categoría o imagen
Then los cambios quedan guardados
And el precio se interpreta en ARS con IVA incluido
```

### AC-4: Publicar un producto que cumple los requisitos
```gherkin
Given un producto en borrador con nombre, precio, stock y categoría cargados
When el dueño lo publica
Then el producto pasa a estado "publicado"
And queda visible en el storefront y elegible para el carrito
```

### AC-5: Validación al crear o editar
```gherkin
Given el dueño cargando un producto
When ingresa un precio menor o igual a 0, un stock negativo, o deja vacío un campo requerido
Then el sistema rechaza la operación con un mensaje claro por campo
And el producto no se crea ni se modifica de forma parcial
```

### AC-6: Intentar publicar un producto incompleto (alternative path)
```gherkin
Given un producto en borrador sin categoría asignada (o sin precio, o sin stock)
When el dueño intenta publicarlo
Then el sistema rechaza la publicación indicando qué falta
And el producto permanece en estado "borrador"
```

### AC-7: Archivar un producto (no borrar)
```gherkin
Given un producto publicado que el dueño ya no quiere ofrecer
When lo archiva
Then el producto deja de aparecer en el storefront y la búsqueda
And NO se elimina físicamente (se conserva para el historial de órdenes)
```

### AC-8: Acceso restringido al panel (negative space)
```gherkin
Given un visitante sin sesión de administrador (cliente o anónimo)
When intenta acceder al panel de catálogo o invocar una alta/edición/borrado
Then el sistema deniega el acceso (no autorizado)
And no expone ninguna operación de administración del catálogo
```

### AC-9: SKU único (negative space)
```gherkin
Given un producto existente con SKU "REF-001"
When el dueño intenta crear otro producto con el mismo SKU "REF-001"
Then el sistema rechaza el alta por SKU duplicado
And no crea un segundo producto con ese SKU
```

### AC-10: El cambio de precio no altera ventas pasadas (negative space)
```gherkin
Given un producto que ya fue comprado en una orden registrada
When el dueño cambia el precio del producto en el catálogo
Then el precio del producto en esa orden histórica NO cambia
And el catálogo refleja el precio nuevo solo para ventas futuras
```

## 4. Out of scope explícito

- **Importación masiva CSV/Excel** — cubierto por US-006.
- **Enriquecimiento de descripciones con IA + embeddings** — cubierto por US-005 (acá la descripción se carga/edita manual).
- **Búsqueda semántica y navegación pública** — US-004 / US-002 / US-003.
- **Gestión de imágenes avanzada** (recorte, múltiples imágenes por producto) — fuera de v1; en esta US, una imagen principal opcional subida a object storage.
- **Stock por sucursal** — no aplica (sucursal única, stock único per E2E).

## 5. INVEST self-check

| Letra | Criterio | Cumple? | Notas |
|---|---|---|---|
| **I** | Independent | ✅ | Es la base; no depende de otras US (incluye el bootstrap de plataforma). |
| **N** | Negotiable | ✅ | Los AC son refinables; la implementación la deciden el E2E + dev. |
| **V** | Valuable | ✅ | Habilita todo el catálogo y el loop (PRD §1.4). |
| **E** | Estimable | ✅ | 13 SP tradicional / 6 SP AI-asistido (ver basis). |
| **S** | Small | ⚠️✅ | En el extremo alto: carga el bootstrap one-time del cycle 1 + CRUD de 2 entidades + panel. Completable en un cycle de 2 semanas; si se ajusta, separar el bootstrap INFRA. |
| **T** | Testable | ✅ | 10 AC en Gherkin, observables por construcción. |

## 6. Dependencias

- **Bloquea a**: US-002, US-003, US-005, US-006 (todo el catálogo se apoya en el modelo y los datos de productos/categorías).
- **Bloqueada por**: — (esta US incluye el bootstrap **local** de plataforma: monorepo + `docker-compose` con Postgres/pgvector + Redis + esquema de catálogo + CI — disciplina INFRA).
- **Re-alcance 2026-08-09**: la **provisión de la nube** (Railway/Neon/Cloudflare, secretos, DNS/TLS, autodeploy, observabilidad, runbook) salió de esta US a **US-019**. Motivo: `railway-baseline` §0 la define como pista paralela fuera del camino crítico, *gated* en cuentas y billing; mantenerla acá dejaba a US-001 —y a las 17 US que dependen de ella— esperando un trámite de facturación en vez de trabajo de producto. El trabajo no se reduce: cambia de unidad de planificación. Ver US-019 §10 y el gap F53.

## 7. Tasks asociadas (gruesas, una por disciplina afectada)

| Disciplina | Task id | Estimado (h) | Owner | Estado |
|---|---|---|---|---|
| INFRA | INFRA-US-001 | 16-24h | TBD | Todo |
| BE | BE-US-001 | 10-16h | TBD | Todo |
| FE | FE-US-001 | 12-16h | TBD | Todo |
| QA | QA-US-001 | 6-8h | TBD | Todo |

- INFRA: bootstrap **local** (monorepo + toolchain de workspace, `docker-compose` con Postgres+pgvector y Redis, `.env.example`, targets locales, gate de CI) + esquema de catálogo (tablas `products`, `categories`, migraciones, constraints SKU único / stock ≥ 0) — fuente única de verdad del esquema. La **provisión de la nube** es US-019 (ver §6).
- BE: endpoints CRUD de productos y categorías + transición de estado (borrador → publicado / archivado) + validaciones + tests.
- FE: panel del dueño — listado (TanStack Table) + formularios de alta/edición + acciones publicar/archivar, según design-system.
- QA: plan de pruebas + automatización de AC (CRUD, reglas de publicación, autorización admin).

> Las tasks code-generating (INFRA/BE/FE) abren su openspec change en `openspec/changes/US-001-admin-catalogo-productos-{discipline}/`. La task QA vive en `tasks/US-001/qa-deliverable.md`.

## 8. Diseño

- **Tiene Figma**: no. Hereda de `docs/product/design-system.md` — panel del dueño: TanStack Table (§7.9), formularios (Input/Select/Button §7.1-7.2), confirmación destructiva de dos pasos para archivar, PriceTag ARS.

## 9. NFRs específicos de esta US

- Latencia de escritura (alta/edición) p95 < 500ms (hereda PRD §4).
- Listado de catálogo en el panel paginado/ordenable sin degradación con ≥5.000 SKUs (cursor/offset).
- Autorización: las operaciones de catálogo son exclusivas del rol admin (E2E §14 STRIDE).
- Observabilidad: registrar evento de negocio "producto creado/publicado/archivado" (alimenta cobertura de catálogo, PRD §1.4).
- Accesibilidad WCAG 2.1 AA en los formularios del panel.

## 10. Notas / contexto adicional

- Estado del producto (decisión de negocio confirmada): nace **borrador** (no visible); se publica explícitamente; requisitos para publicar = **nombre, precio, stock, categoría** (imagen y descripción no bloquean — la descripción se enriquece luego en US-005).
- Precios en ARS con IVA incluido; el modelo de datos usa centavos (E2E §8) para evitar redondeo.
- El bootstrap de plataforma se incluye acá por ser la primera US del cycle 1; si el equipo prefiere, puede separarse como tarea INFRA previa sin cambiar las AC funcionales.

---

## Definition of Ready (gate Triage → Ready)

- [x] §1 Historia escrita en formato Connextra
- [x] §2 Por qué importa explicado
- [x] §3 Al menos 1 AC en Gherkin (10 AC: 4 happy + 3 alternative + 3 negative-space)
- [x] §5 INVEST con todas las letras OK (S en extremo alto, aceptable como US fundacional)
- [x] §7 Tasks por disciplina identificadas con estimado en horas
- [x] §8 Diseño resuelto (design-system referenciado)
- [x] Dependencias chequeadas (sin bloqueantes pendientes)

## Definition of Done (gate QA → Done)

- [ ] Todas las tasks de la US en estado Done
- [ ] Regression suite del producto verde en staging
- [ ] AC manuales verificados por QA
- [ ] PO firma acceptance
