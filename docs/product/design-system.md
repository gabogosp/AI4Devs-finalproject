---
type: design-system-baseline
cliente: dsm-ferreteria
parent-prd: docs/product/prd.md
status: Approved                       # Draft → Approved (aprueba arquitecto + PO)
language: es
target_stacks: [web]                  # stacks activos del proyecto: BE, WEB, INFRA, QA
created: 2026-06-14
updated: 2026-06-15
generated-by: design-system-baseline
authored-by: Gabriel Suarez
approved-by:
  product-owner: Pedro Suarez
  arquitecto: Gabriel Suarez
approved-at: 2026-06-15
brand_inputs_captured:
  logo: placeholder (wordmark "DSM")
  primary_color: "#1A56DB"
  accent_color: "#EA580C"
  typography: Inter
  voice_tone: práctico y confiable
inspired-by:
  - MercadoLibre (familiaridad de patrones e-commerce para el comprador argentino)
  - Retailers de ferretería/hardware (alta densidad de catálogo, foco en precio y disponibilidad)
---

# Design System Baseline — DSM Refrigeración y Ferretería (E-commerce)

> **Cuándo se usa este doc**: el proyecto NO tiene Figma (PRD §8 declara `design source: design-system`). Este doc reemplaza el Figma como fuente de verdad de la identidad visual + componentes core.
>
> **Audiencia**: equipo FE web (Next.js). Los devs consumen los tokens + componentes definidos acá para construir UI sin mockups por pantalla.
>
> **No reemplaza el diseño por pantalla**: cada US/task UI tendrá su propia composición específica. Este doc define la PALETA y los BLOQUES que se combinan.
>
> **Idioma de la UI**: español (AR). Los ejemplos de copy están en el idioma del producto.

---

## 1. Dirección visual (tono general)

- **Mood**: moderno + confiable + industrial-limpio. Funcional sobre decorativo: el comprador viene a resolver ("necesito algo para X"), no a explorar.
- **Industria de referencia**: e-commerce de ferretería / retail de productos para el hogar y oficios (refrigeración, plomería, electricidad).
- **Referencias visuales / inspiración**:
  - **MercadoLibre** — patrones de e-commerce que el comprador argentino ya conoce (card de producto, precio destacado, CTA claro). Tomamos: jerarquía precio + disponibilidad, checkout simple.
  - **Retailers de hardware (Sodimac / Easy / Leroy Merlin)** — densidad de catálogo y navegación por rubros. Tomamos: browse por categoría robusto, búsqueda prominente.
- **Lo que NO queremos parecernos a**:
  - Landing "startup" minimalista con poco contenido — acá el contenido (productos, precios, stock) es el protagonista.
  - Sitios saturados de banners/popups que tapan el catálogo.
  - Estética "lujo/boutique" — DSM es accesible y práctico.

## 2. Paleta de colores (tokens)

### 2.1 Brand

| Token | Valor (hex) | Uso |
|---|---|---|
| `brand-primary` | #1A56DB | Color principal. Botones primarios, links activos, header, focus ring. Transmite confianza + "refrigeración". |
| `brand-primary-dark` | #1E40AF | Hover/active del primary. |
| `brand-primary-subtle` | #EFF4FE | Fondo de chips/estados seleccionados, badges informativos suaves. |
| `accent` | #EA580C | Acento ferretero (naranja). Bordes, badges, iconos, **texto grande** y detalles de energía/CTA. **No** usar con texto blanco a tamaño normal (ver §2.4). |
| `accent-strong` | #C2410C | Variante del acento para **botones naranja con texto blanco** y texto de acento a tamaño body (cumple 4.5:1). |
| `accent-subtle` | #FFF3EC | Fondo suave de destacados con acento (ofertas, "nuevo"). |

### 2.2 Neutros

| Token | Valor | Uso |
|---|---|---|
| `gray-50` | #F9FAFB | Background general de página. |
| `gray-100` | #F3F4F6 | Cards, fondos de sección. |
| `gray-200` | #E5E7EB | Bordes, divisores, borde de inputs. |
| `gray-300` | #D1D5DB | Borde hover de inputs, estados disabled. |
| `gray-500` | #6B7280 | Texto secundario (cumple 4.5:1 sobre blanco y gray-50). |
| `gray-700` | #374151 | Texto de cuerpo enfatizado, labels. |
| `gray-900` | #111827 | Texto primario / títulos. |
| `white` | #FFFFFF | Superficie de cards elevadas, fondo de inputs. |

### 2.3 Semánticos

| Token | Valor | Uso |
|---|---|---|
| `success` | #15803D | Pago aprobado, "en stock", orden entregada. Texto blanco encima OK. |
| `success-subtle` | #ECFDF3 | Fondo de banners de éxito. |
| `warning` | #B45309 | Stock bajo, avisos no críticos. Texto sobre blanco OK. |
| `warning-subtle` | #FEF7EC | Fondo de banners de advertencia. |
| `error` | #DC2626 | Pago rechazado, sin stock, errores de validación. Texto blanco encima OK. |
| `error-subtle` | #FEF2F2 | Fondo de banners de error. |
| `info` | #0E7490 | Información neutra, tooltips. Cyan/teal, **distinto del azul de marca** para no confundir "info" con acción primaria. |

### 2.4 Contraste (WCAG 2.1 AA — verificado)

Mínimos: **4.5:1** texto normal · **3:1** texto grande (≥18px, o ≥14px bold) y elementos UI no-textuales (focus ring, iconos).

| Combinación | Ratio | OK? |
|---|---|---|
| `gray-900` sobre `gray-50` | 16.98:1 | ✅ texto normal |
| `gray-700` sobre `white` | 10.4:1 | ✅ texto normal |
| `gray-500` sobre `white` | 4.83:1 | ✅ texto normal |
| `gray-500` sobre `gray-50` | 4.63:1 | ✅ texto normal |
| `white` sobre `brand-primary` (#1A56DB) | 6.18:1 | ✅ texto normal (botón primario) |
| `white` sobre `brand-primary-dark` (#1E40AF) | 8.72:1 | ✅ texto normal (hover) |
| `brand-primary` sobre `white` (links) | 6.18:1 | ✅ texto normal |
| `white` sobre `accent` (#EA580C) | 3.56:1 | ⚠️ **solo texto grande / UI no-textual** — NO body |
| `white` sobre `accent-strong` (#C2410C) | 5.18:1 | ✅ texto normal (botón naranja) |
| `accent-strong` sobre `white` (texto de acento) | 5.18:1 | ✅ texto normal |
| `white` sobre `success` (#15803D) | 5.02:1 | ✅ texto normal |
| `white` sobre `error` (#DC2626) | 4.83:1 | ✅ texto normal |
| `warning` (#B45309) sobre `white` | 5.02:1 | ✅ texto normal |
| `white` sobre `info` (#0E7490) | ~4.9:1 | ✅ texto normal (re-verificar en build) |
| `brand-primary` focus ring sobre `gray-50` | 5.9:1 | ✅ UI no-textual (≥3:1) |

> **Regla de uso del acento**: `accent` (#EA580C) nunca lleva texto blanco a tamaño body. Para CTAs naranja con texto, usar `accent-strong` (#C2410C). El acento puro queda para iconos, bordes, badges y texto ≥18px.

## 3. Typography

### 3.1 Fuentes

- **Sans-serif principal**: **Inter** vía `next/font/google` (Next la self-hostea en build — sin request a Google en runtime), con `display: swap` y `adjustFontFallback` para minimizar **CLS**. Fallback: `system-ui, -apple-system, Segoe UI, Roboto, sans-serif`.
- **Números tabulares**: usar `font-variant-numeric: tabular-nums` en precios (ARS) y tablas de stock para alineación.
- **Mono** (SKU, IDs de orden): `ui-monospace, "JetBrains Mono", monospace`.
- **Display**: misma Inter en peso `bold`/`extrabold`; no se incorpora una fuente display aparte.

### 3.2 Escala tipográfica (base 16px)

> Escala práctica alineada a la de Tailwind (no es una progresión modular 1.250 estricta).

| Token | Tamaño | Line height | Uso |
|---|---|---|---|
| `text-xs` | 12px | 16px | Captions, labels chicos, "IVA incluido". |
| `text-sm` | 14px | 20px | Body secundario, metadata de producto. |
| `text-base` | 16px | 24px | Body principal, descripciones. |
| `text-lg` | 18px | 28px | Subtítulos, nombre de producto en card. |
| `text-xl` | 20px | 28px | Headings de sección. |
| `text-2xl` | 24px | 32px | Título de página / ficha de producto. |
| `text-3xl` | 30px | 36px | Precio destacado en ficha, hero de categoría. |
| `text-4xl` | 36px | 40px | Display / home hero. |

### 3.3 Pesos

`font-normal` (400) body · `font-medium` (500) labels/botones · `font-semibold` (600) headings · `font-bold` (700) precios y títulos de página.

## 4. Spacing (escala de 4px)

| Token | Valor | Uso |
|---|---|---|
| `space-1` | 4px | Gap mínimo (icono+texto). |
| `space-2` | 8px | Padding interno chico, gap en chips. |
| `space-3` | 12px | Padding de inputs. |
| `space-4` | 16px | Padding default de cards/botones. |
| `space-6` | 24px | Separación entre bloques. |
| `space-8` | 32px | Separación entre secciones. |
| `space-12` | 48px | Márgenes de página, separación de grandes bloques. |
| `space-16` | 64px | Hero / espaciados de landing. |

> **Grilla de catálogo**: grid responsive con `gap: space-4` (mobile) / `space-6` (desktop). Columnas: 2 (mobile) → 3 (tablet) → 4 (desktop).

### 4.1 Responsive & breakpoints (mobile-first)

Estrategia **mobile-first**: se diseña primero para el teléfono (el grueso del tráfico en AR) y se progresa hacia desktop. Los estilos base son mobile; los breakpoints **suman**, no reemplazan.

| Token | Min-width | Target |
|---|---|---|
| `bp-sm` | 640px | Teléfono grande / landscape |
| `bp-md` | 768px | Tablet |
| `bp-lg` | 1024px | Desktop chico |
| `bp-xl` | 1280px | Desktop |
| `bp-2xl` | 1536px | Desktop ancho |

**Patrones mobile de los componentes clave:**
- **Top-nav** → en mobile colapsa a: logo + ícono buscador + carrito; el resto (categorías, cuenta) va en menú hamburguesa o **bottom-bar** (Inicio · Buscar · Carrito · Cuenta).
- **SearchBar** → full-width; en mobile puede abrir una **vista de búsqueda full-screen** en lugar de dropdown.
- **ProductCard grid** → 2 columnas en mobile (§4 grilla).
- **Ficha de producto** → **CTA "Agregar al carrito" sticky** al fondo del viewport en mobile.
- **CategoryNav** → bottom-sheet o acordeón en mobile, no barra horizontal.
- **Table del Backoffice** (§7.9) → en mobile **colapsa a cards apiladas** (las tablas densas no entran en pantalla chica).
- **Checkout** → una sección por pantalla (stepper vertical), nunca multi-columna en mobile.

> Áreas táctiles ≥ 44×44px (§11). Acciones primarias en la zona inferior alcanzable con el pulgar.

### 4.2 Layout & containers

- **Container** centrado, `max-width: 1280px` (`bp-xl`), gutters `space-4` (mobile) / `space-6` (desktop).
- **Catálogo/categoría**: container + grilla de productos.
- **Ficha**: 1 columna en mobile (imagen → info → CTA sticky); 2 columnas en desktop (imagen | info+compra).
- **Checkout**: 1 columna en mobile (stepper); en desktop, formulario + **resumen de orden lateral sticky**.

## 5. Border radius

| Token | Valor | Uso |
|---|---|---|
| `radius-sm` | 4px | Inputs, badges, chips. |
| `radius-md` | 8px | Cards de producto, botones. |
| `radius-lg` | 12px | Modales, contenedores destacados. |
| `radius-full` | 9999px | Pills (estado de orden), avatar, botón de ícono. |

## 6. Sombras, layering y motion

| Token | Valor | Uso |
|---|---|---|
| `shadow-sm` | 0 1px 2px rgba(0,0,0,0.05) | Card de producto en reposo. |
| `shadow-md` | 0 4px 6px rgba(0,0,0,0.10) | Card hover, dropdown del buscador, menú de usuario. |
| `shadow-lg` | 0 10px 15px rgba(0,0,0,0.10) | Modales, carrito flotante. |
| `shadow-focus` | 0 0 0 3px rgba(26,86,219,0.40) | Focus ring (brand-primary al 40%). |

### 6.1 Z-index / layering

| Token | Valor | Uso |
|---|---|---|
| `z-base` | 0 | Contenido normal. |
| `z-sticky` | 100 | Header sticky, CTA sticky mobile, encabezado de tabla. |
| `z-dropdown` | 200 | Dropdown del buscador, menús, selects. |
| `z-overlay` | 300 | Fondo oscuro de modal / bottom-sheet. |
| `z-modal` | 400 | Modal / dialog / bottom-sheet. |
| `z-toast` | 500 | Toasts / notificaciones (siempre encima). |

> Una sola escala — nada de `z-index: 9999` arbitrarios. Todo lo que se superpone usa estos tokens.
>
> **Coexistencia en mobile**: la **bottom-bar de nav** y el **CTA "Agregar" sticky** comparten la zona inferior. Regla: en la ficha de producto el CTA sticky va **encima** de la bottom-bar (o la bottom-bar se oculta en la ficha); nunca se tapan. Bottom-sheet (`z-modal`) y toast (`z-toast`) siempre por encima de ambos.

### 6.2 Motion (tokens)

| Token | Valor | Uso |
|---|---|---|
| `motion-fast` | 150ms | Hover, focus, cambios de color. |
| `motion-base` | 200ms | Dropdown, toast (entrada/salida). |
| `motion-slow` | 300ms | Modal / bottom-sheet, transición de página. |
| `ease-out` | cubic-bezier(0,0,0.2,1) | Entradas (aparecer). |
| `ease-in` | cubic-bezier(0.4,0,1,1) | Salidas (desaparecer). |

> Respetar `prefers-reduced-motion`: cuando está activo, reducir a fade simple o sin animación.

## 7. Componentes core (catálogo)

Cada componente con anatomía + variantes + estados. Implementación web: Tailwind + ShadCN UI (§9).

### 7.1 Button
- **Variantes**: `primary` (fondo `brand-primary`, texto blanco), `secondary` (borde `gray-300`, texto `gray-900`), `accent` (fondo `accent-strong`, texto blanco — CTAs de compra/"agregar al carrito"), `ghost` (sin fondo, texto `brand-primary`), `destructive` (fondo `error`, texto blanco — cancelar orden).
- **Tamaños**: `sm` (h 32px), `md` (h 40px, default), `lg` (h 48px — CTA principal de checkout).
- **Estados**: default, hover (primary→`brand-primary-dark`), active, disabled (`gray-300` fondo + `gray-500` texto), loading (`aria-busy`, spinner + texto, botón no clickeable).
- **A11y**: navegable por teclado, focus ring (`shadow-focus`) visible, área táctil mínima 44×44px.

### 7.2 Input / Search
- **Tipos**: text, email, password, number, tel, textarea, select.
- **Estados**: default (borde `gray-200`), hover (`gray-300`), focus (borde `brand-primary` + `shadow-focus`), error (borde `error` + mensaje con `aria-describedby`), disabled.
- **SearchBar (clave del producto)**: input prominente con ícono de lupa, placeholder ejemplificador ("Describí lo que buscás: ej. 'algo para colgar un cuadro en pared dura'"). Dropdown de sugerencias con `shadow-md`. Estado "buscando con IA…" (skeleton) y fallback visible a navegación por categoría cuando no hay resultados sobre el umbral.
- **A11y**: label asociado siempre (visible u `aria-label`), `role="searchbox"`, navegación por teclado del dropdown (↑/↓/Enter/Esc).

### 7.3 Card
- **Variantes**: `default` (`shadow-sm`), `elevated` (`shadow-md` en hover), `bordered` (borde `gray-200`, sin sombra).
- **ProductCard**: imagen (con fallback si falta), nombre (`text-lg`/semibold, máx 2 líneas), precio (`PriceTag`), badge de stock/disponibilidad, botón "Agregar". Padding `space-4`, `radius-md`.
  - **Jerarquía de lectura** (fija): imagen → nombre → precio → disponibilidad → CTA.
  - **CTA desde la grilla**: "Agregar" directo en la card (sube conversión mobile); si el producto necesita elegir cantidad/variante, la card lleva a la ficha en lugar de agregar.
  - **Sin stock**: el botón "Agregar" se reemplaza por **"Avisame por WhatsApp"** (no un botón disabled mudo).

### 7.4 PriceTag (ARS)
- Monto en `text-3xl`/bold (ficha) o `text-lg`/bold (card), `tabular-nums`, formato `$ 12.500` (separador de miles `.`).
- **Helper de formato (fuente de verdad)**: `Intl.NumberFormat('es-AR', { style:'currency', currency:'ARS', maximumFractionDigits:0 })` → `$ 12.500` (sin decimales en MVP; precios de ferretería enteros). **El mismo helper en server y client** para evitar *hydration mismatch* en SSR. Si en el futuro hacen falta centavos, se cambia `maximumFractionDigits` en un solo lugar.
- Subtexto `text-xs` `gray-500`: "IVA incluido".
- Variante "precio anterior" tachada (`gray-500`, line-through) si aplica oferta futura.

### 7.5 Modal / Dialog
- `radius-lg`, `shadow-lg`, overlay `rgba(0,0,0,0.5)`.
- **A11y**: focus trap, `Escape` cierra, foco vuelve al trigger al cerrar, `role="dialog"` + `aria-modal`.
- Usos: confirmación de "cancelar orden" (destructive, dos pasos), detalle rápido de producto.

### 7.6 Toast / Notification
- **Variantes**: success, error, info, warning (color del borde izquierdo + ícono).
- **Duración default**: 4s; **sticky** para errores y para "orden confirmada".
- **A11y**: `role="status"` (no error) / `role="alert"` (error), `aria-live`.

### 7.7 Badge / OrderStatusBadge
- Pills `radius-full`, `text-xs`/medium. Estados de orden: **Nueva** (`info`/`brand-primary-subtle`), **Preparada / lista para retirar** (`warning`/`warning-subtle`), **Entregada** (`success`/`success-subtle`), **Cancelada** (`error`/`error-subtle`).
- Stock: "En stock" (`success`), "Pocas unidades" (`warning`), "Sin stock" (`gray-500`).

### 7.8 Tabs
- Línea inferior `brand-primary` en el tab activo; inactivos `gray-500`. Navegable por teclado (←/→).

### 7.9 Table (panel del dueño — Backoffice)
- **TanStack Table** para la grilla de órdenes y de productos (densidad alta, paginación/orden/filtro). Filas con hover `gray-50`, encabezado sticky, acciones por fila.
- **Densidad**: altura de fila **40px**, padding de celda `space-2`/`space-3`, `text-sm` (denso, distinto del storefront).
- **Acciones por fila**: botones inline para 1–2 acciones frecuentes; menú kebab (`⋮`) para el resto.
- Paginación obligatoria cuando > 50 filas (catálogo de miles de SKUs).
- **A11y**: `<table>` semántica, headers con `scope`, orden anunciado por `aria-sort`. En mobile (colapso a cards, §4.1), mantener la relación dato↔encabezado.

### 7.10 Navigation
- **Top-nav** (web): logo "DSM" + SearchBar central (protagonista) + acceso a carrito + menú de usuario (login / mi cuenta) + enlace WhatsApp.
- **CategoryNav**: navegación por rubros (refrigeración, plomería, electricidad…) — desplegable o barra secundaria; load-bearing para SEO (links indexables).
- **Footer**: enlaces legales (política de privacidad, términos), datos del local (dirección, horarios), WhatsApp.

### 7.11 Cart / CartItem
- Listado de ítems (imagen, nombre, precio unitario, cantidad con stepper, subtotal), resumen con total en ARS, CTA `accent` "Ir al pago", selección de **retiro en sucursal** (única).
- **Feedback al agregar**: **mini-cart** que baja desde arriba (o bottom-sheet en mobile) con "Agregado ✓" + "Ir al carrito"; el badge del carrito incrementa con micro-animación. **No interrumpe** la navegación (no redirige).
- **Stepper de cantidad**: acotado al stock disponible ("Pocas unidades" → máximo = stock); no permite superarlo.

### 7.12 SearchExperience (búsqueda IA — componente estrella)

El **diferenciador** del producto (PRD §3.2). Más que un input: es un flujo con composición propia. *(Profundiza y reemplaza el bullet de §7.2.)*

- **Entrada (SearchBar)**: prominente y persistente en el top-nav (full-width en mobile). Placeholder ejemplificador (§10.2); en mobile abre **vista de búsqueda full-screen**.
- **Sugerencias en vivo (dropdown)**: autocompletado de productos/categorías mientras escribe (`shadow-md`, `z-dropdown`), navegable por teclado (↑/↓/Enter/Esc).
- **Estado "buscando con IA…"**: **skeleton** de resultados (no spinner), con microcopy que indica que se interpreta la consulta.
- **Página de resultados** (la composición clave):
  - **Eco de la consulta** en lenguaje natural arriba ("Resultados para: '…'").
  - **Interpretación visible**: mostrar cómo entendió la IA la necesidad ("Buscamos: tarugos + tornillos para hormigón") con opción de **refinar** ("¿no era esto? describilo distinto"). Da confianza en el diferenciador.
  - Grid de `ProductCard` ordenado por **relevancia semántica** (más relevante primero).
  - Opcional: chip "sugerido / match alto" en los primeros; **nunca color como único indicador**.
  - Acceso visible a **filtrar/navegar por categoría** (red de seguridad).
- **Estado "pocos / baja confianza"** (el más común con catálogo recién enriquecido): se muestran candidatos pero con aviso honesto ("No estamos seguros, ¿quisiste decir…?") + chips de refinamiento + acceso a categorías. **No presentarlos como certeza.**
- **Empty / pocos resultados**: mensaje + CTA a navegar por categoría (§10.1; PRD §3.2). Nunca un "0 resultados" desnudo.
- **Degradado**: si el proveedor de IA cae, degrada a búsqueda por texto/categoría sin romper (PRD §3.2 + resiliencia del E2E).
- **A11y**: `role="searchbox"`, cantidad de resultados anunciada (`aria-live="polite"`), foco gestionado al abrir/cerrar la vista full-screen en mobile.

### 7.13 CheckoutStepper / Form

El checkout es un flujo **Must multi-paso** (PRD cap. 4–5–6); necesita patrón propio.

- **Stepper**: **1) Datos de contacto (guest)** → **2) Retiro en sucursal** → **3) Pago** → **4) Confirmación**. Progreso horizontal en desktop, vertical/numerado en mobile (`aria-current`).
- **Form**: labels siempre visibles, validación inline (`aria-describedby`), **resumen de errores** arriba al intentar avanzar, CTAs claros (`accent`).
- **Paso 1 — Datos de contacto (guest)**: solo 3 campos — **nombre**, **email** (canal de confirmación, obligatorio) y **teléfono** (formato AR `+54 9 11 …`, validado). Sin crear cuenta. Al final, opción **no bloqueante** de "guardá tus datos creando una cuenta" (cap. 8 Should).
- **Selección de pago**: MercadoPago (hosted) y, **solo en test/demo**, el **pago simulado «DSM»** (PRD §5) como opción visible.
- **Consentimiento**: checkbox de privacidad + términos antes de pagar (PRD cap. 10; copy §10.2).
- **Resumen de orden**: ítems + total ARS (`PriceTag`, `tabular-nums`) + sucursal de retiro; sticky lateral en desktop, colapsable en mobile.
- **Estados**: "procesando pago" (overlay de bloqueo + spinner + copy de espera), éxito (toast sticky → pantalla de confirmación), **rechazo** (mensaje accionable, **carrito y datos intactos** para reintentar sin recargar — PRD §3.1).
- **A11y**: cada paso es región con heading; foco al primer campo del paso.

### 7.14 TrustSignals (confianza — tienda sin reputación)

DSM arranca con **cero presencia digital ni reputación** (PRD §1.2); el comprador argentino, habituado a la reputación de MercadoLibre, necesita señales explícitas de que es real y seguro. Bloque reutilizable, **no decorativo — es conversión**.

- **Sello de pago seguro**: "Pagás con MercadoPago" + candado; refuerza que DSM no toca la tarjeta (PRD §5).
- **Local físico verificable**: dirección (esquina Av. Córdoba y Av. Pueyrredón) + **mini-mapa** + horarios. Prueba de que existe.
- **Retiro sin riesgo**: "Retirás y revisás en el local antes de llevarlo" — baja el miedo a comprar a ciegas.
- **Canal humano**: botón WhatsApp directo ("Hablá con nosotros").
- **Ubicación**: home (bloque de confianza), ficha (cerca del CTA) y checkout (junto al pago). Discreto pero presente.
- **A11y**: texto + ícono, nunca solo ícono.

## 8. Iconografía y brand assets

- **Sistema**: **Lucide** (open-source, consistente con ShadCN).
- **Tamaño default**: 20×20px (`space-5`). 16px en contextos densos (tablas), 24px en headers.
- **Stroke width**: 1.5px.
- Iconos clave: `search` (buscador), `shopping-cart`, `store`/`map-pin` (retiro en sucursal), `package` (orden), `message-circle` (WhatsApp), `upload` (import CSV).

### 8.1 Brand assets, favicon, social/OG e imágenes de producto

Crítico para los objetivos de **SEO y "ser encontrado"** del PRD (§1, §4).

- **Logo**: placeholder wordmark "DSM" hasta que el cliente provea el SVG. Área de protección ≈ altura de la "D"; tamaño mínimo legible 24px de alto. Versión monocroma para fondos claros/oscuros.
- **Favicon**: set completo (16/32, `apple-touch-icon` 180, `favicon.svg`, `site.webmanifest` con `theme-color` = `brand-primary`).
- **Social / OG image**: imagen Open Graph **1200×630** por defecto (logo + claim) para que los links a home/categoría/producto se vean bien al compartir (WhatsApp/redes). Por producto: imagen del producto + nombre + precio.
- **Imágenes de producto (estándar)**: **aspect ratio fijo 1:1** sobre fondo `white`/`gray-50`. Servidas vía `next/image` con **`sizes` por contexto** (card grid: `(max-width:768px) 50vw, 25vw`; ficha hero: `(max-width:1024px) 100vw, 50vw`) para no bajar imágenes gigantes en mobile (catálogo de miles de SKUs). La **imagen LCP de la ficha** lleva `priority`; el resto, lazy + `placeholder="blur"`. **Fallback** consistente (ícono `package` sobre `gray-100`) cuando falta la foto — habitual en ferretería.
- **Alt text**: descriptivo y útil para SEO (no "imagen"); idealmente nombre + atributo clave.

## 9. Tooling / libs sugeridas

| Stack | Lib recomendada (default) | Notas |
|---|---|---|
| Web (Next.js) | **Tailwind CSS + ShadCN UI** | Tokens de este doc mapeados a `tailwind.config` (theme.extend) + CSS variables. SSR-friendly para SEO (PRD §4). |
| Panel del dueño (dentro del web) | misma base + **TanStack Table** | Densidad de datos, paginación, orden/filtro (PRD §9: no es app separada). |
| Charts (panel de métricas, cap. 9) | **Recharts** | Paleta de data-viz abajo; export de datos crudos disponible. **Client-only**: cargar con `dynamic(ssr:false)` + skeleton, no debe bloquear LCP. Acompañar cada chart con una **tabla de datos accesible** (no solo el gráfico). |

**Data-viz palette (categórica, accesible)**: `#1A56DB` (azul), `#EA580C` (naranja), `#15803D` (verde), `#9333EA` (violeta), `#0891B2` (cyan), `#B45309` (ámbar). Usar con etiquetas/patrones, no solo color, para daltonismo.

> Una vez elegida la lib, no se cambia mid-proyecto sin ADR.

## 10. Patrones de interacción + Voz / tono

### 10.1 Patrones
- **Loading**: skeleton screens en catálogo, ficha y resultados de búsqueda IA (no spinners gigantes). Spinner solo en acciones puntuales (>1s, ej. procesar pago).
- **Empty states**: ícono + mensaje + CTA. Ej. búsqueda sin resultados → "No encontramos productos para eso. Probá navegar por categoría 👇" + acceso a rubros (red de seguridad del PRD §3.2).
- **Error states**: explican qué pasó y ofrecen acción (reintentar, contactar por WhatsApp).
- **Animaciones**: sutiles, 150–300ms, `ease-out` (entradas) / `ease-in` (salidas). Respetar `prefers-reduced-motion`.

### 10.2 Voz / tono — "práctico y confiable"
Claro, directo y útil. Sin jerga técnica innecesaria. Tratamiento informal argentino (vos). Foco en ayudar a resolver.

| Contexto | Ejemplo |
|---|---|
| CTA compra | "Agregar al carrito" · "Ir al pago" · "Retirar en el local" |
| Placeholder buscador | "Describí lo que buscás: ej. 'algo para colgar un cuadro en pared dura'" |
| Búsqueda sin resultados | "No encontramos productos para esa búsqueda. Probá con otras palabras o navegá por categoría." |
| Sin stock | "Sin stock por ahora. Escribinos por WhatsApp y te avisamos cuando vuelva." |
| Pago aprobado | "¡Listo! Tu compra está confirmada. Te enviamos el detalle por email." |
| Pago rechazado | "El pago no se pudo procesar. Revisá los datos o probá otro medio." |
| Orden lista | "Tu pedido está listo para retirar en el local (Córdoba y Pueyrredón)." |
| Error genérico | "Algo salió mal de nuestro lado. Probá de nuevo en un momento." |
| Confirmar cancelación | "¿Seguro que querés cancelar esta orden? Esta acción no se puede deshacer." |
| Consentimiento checkout | "Al comprar aceptás nuestra [política de privacidad](#) y [términos](#). Usamos tus datos solo para gestionar tu pedido (Ley 25.326)." |
| Procesando pago | "Estamos confirmando tu pago… no cierres ni recargues esta página." |
| Confirmación post-pago | "¡Compra confirmada! Pasá a retirar por el local (Av. Córdoba y Av. Pueyrredón, [horarios]). Mostrá tu nombre o el N° de orden. Te lo enviamos por email." |
| Aviso "lista para retirar" | "Tu pedido #{orden} está listo. Retiralo en Av. Córdoba y Av. Pueyrredón, [horarios]. Llevá tu DNI o el N° de orden." |

## 11. Accesibilidad — checklist baseline (WCAG 2.1 AA)

- [x] Contraste AA verificado en todas las combinaciones de tokens (§2.4) — 0 fallos a tamaño body.
- [ ] Todos los componentes interactivos navegables por teclado (Button, Input, SearchBar dropdown, Modal, Tabs, Table).
- [ ] Focus ring visible y consistente (`shadow-focus`) en todo elemento focusable.
- [ ] `prefers-reduced-motion` respetado.
- [ ] Labels en todos los inputs (visibles o `aria-label`); buscador con `role="searchbox"`.
- [ ] Headings en orden jerárquico (h1 único por página → h2 → h3); páginas de categoría/producto con estructura semántica para SEO.
- [ ] Imágenes de producto con `alt` descriptivo (no "imagen"); fallback visual si falta la imagen.
- [ ] Targets táctiles ≥ 44×44px en mobile.
- [ ] Color nunca como único portador de información (estado de orden/stock con texto + ícono además de color).
- [ ] `<html lang="es-AR">` declarado (lectores de pantalla + SEO AR).
- [ ] **Foco gestionado al cambiar de ruta/paso** (SPA Next): mover el foco al `<h1>`/heading del nuevo contenido.
- [ ] Tabla→cards en mobile (§4.1): al colapsar, **mantener la semántica** (cada card como grupo con sus labels), sin perder la relación dato↔encabezado.

## 12. Stack-specific notes (web)

- **Tokens → Tailwind**: definir en `tailwind.config.ts` (`theme.extend.colors`, `spacing`, `borderRadius`, `boxShadow`) + CSS variables en `:root` para consumo desde componentes ShadCN.
- **Fuentes**: `next/font/google` (Inter) self-hosted; `display: swap`; precarga para LCP.
- **SSR/SEO** (PRD §4): páginas de categoría y producto renderizadas en servidor, metadatos + sitemap. Los componentes del design-system no deben depender de JS para el contenido indexable.
- **JSON-LD (shape mínimo)**: producto → `schema.org/Product` + `Offer` (`priceCurrency:"ARS"`, `price`, `availability` mapeado del stock: `InStock`/`OutOfStock`, `image`, `sku`). Categorías → `BreadcrumbList`. Load-bearing para "ser encontrado en Google" (PRD §1.2).
- **Modo oscuro**: **no incluido en MVP** (ver §14). La extensión a dark sin reescribir componentes **requiere la capa de alias semánticos** (§12.1): los componentes consumen tokens semánticos (`surface`, `text-primary`, `border`), no primitivos; el dark se logra re-mapeando los alias.
- **Sin secciones iOS/Android/Backoffice-app**: fuera de alcance (no están entre los stacks activos del proyecto). El "backoffice" es una sección del web.

### 12.1 Contrato de tokens (CSS vars + alias semánticos)

Para que dos devs no inventen dos sistemas, el contrato es **único**. Arquitectura en 3 capas: **primitivos** (hex de §2) → **alias semánticos** (lo que consumen los componentes) → **componentes**. Los componentes **nunca** referencian un primitivo directo (eso habilita dark-mode sin reescribir).

**Convención de naming (estilo ShadCN):** los componentes consumen alias, no primitivos.

```css
:root {
  /* Alias semánticos. Valor = el primitivo de §2 (convertir a HSL en build si se usa la convención ShadCN). */
  --background: /* gray-50 #F9FAFB */;   --foreground: /* gray-900 #111827 */;
  --surface:    /* white #FFFFFF */;     --muted-foreground: /* gray-500 #6B7280 */;
  --border:     /* gray-200 #E5E7EB */;  --ring: /* brand-primary #1A56DB */;
  --primary: /* #1A56DB */;              --primary-foreground: /* white */;
  --accent:  /* accent-strong #C2410C */; --accent-foreground: /* white */;
  --success: /* #15803D */; --warning: /* #B45309 */; --error: /* #DC2626 */; --info: /* #0E7490 */;
  --radius: 0.5rem; /* radius-md */
}
/* .dark { … } → solo re-mapea estos alias; los componentes no cambian. */
```

**Tailwind**: `theme.extend` referencia las vars — `colors` (`primary: 'hsl(var(--primary))'`…), `borderRadius` (var(--radius)), `boxShadow` (§6), `spacing` (§4), `screens` (breakpoints §4.1), `zIndex` (§6.1), `transitionDuration` (§6.2).

> Idealmente el generador emite este `tokens.css` + `tailwind.config` como artefacto, no solo la tabla markdown (ver **F13** del tracker de framework).

## 13. Prompts listos para herramientas downstream

### Prompt base para v0 / Lovable / Bolt
```
Build a {component} component for an e-commerce hardware store (Spanish AR UI) using:
- Next.js + Tailwind CSS + ShadCN UI
- Colors: primary #1A56DB (hover #1E40AF), accent #C2410C (orange CTAs), text #111827, secondary text #6B7280, surface #F9FAFB
- Typography: Inter, base 16px, Tailwind-like type scale, tabular-nums for prices (ARS, "$ 12.500", "IVA incluido")
- Border radius: 8px (md), shadow-sm cards
- WCAG 2.1 AA compliant: visible focus ring rgba(26,86,219,0.40), labels on inputs, color never the only signal
- Tone: práctico y confiable, informal argentino (vos)

The component should: …
```

---

## 14. Registro de decisiones (Decisions log)

**Inputs del cliente capturados (vía PO):**
- Logo: **placeholder de fábrica** (wordmark "DSM") — el cliente provee el SVG/PNG luego.
- Color primario: **#1A56DB** (azul) + acento **#EA580C** (naranja). Combo "azul + naranja" elegido por el PO.
- Tipografía: **Inter**.
- Voz/tono: **práctico y confiable**, WCAG 2.1 AA.

**Defaults de fábrica aplicados (no eran identidad de marca):**
- Escala de spacing (grilla 4px), escala de border-radius, escala de sombras, motion (150–300ms, ease-out/ease-in), breakpoints implícitos en la grilla (2/3/4 columnas), iconografía (Lucide), data-viz palette.

**Iteración WCAG (Step 5):**
- `white` sobre `accent` (#EA580C) daba **3.56:1** → falla texto normal. **Resuelto** introduciendo `accent-strong` (#C2410C → 5.18:1) para botones/texto de acento; `accent` queda para iconos/bordes/badges/texto grande. Sin otros fallos.

**Revisión crítica posterior (humana, 2026-06-14):**
- **Agregado**: responsive + breakpoints + mobile-first (§4.1) con patrones mobile por componente; layout/containers (§4.2).
- **Agregado**: `SearchExperience` como componente estrella con página de resultados (§7.12); `CheckoutStepper/Form` (§7.13).
- **Agregado**: tokens de **z-index/layering** (§6.1) y **motion** (§6.2); **brand assets + favicon + OG + estándar de imágenes** (§8.1).
- **Corregido**: `info` #2563EB → **#0E7490** (cyan) para no confundirse con el azul de marca; etiqueta de escala tipográfica (no es modular 1.250 estricta).
- **Decisión mobile**: el MVP es **web responsive (mobile-first)**, no app nativa (PRD §9). Una **especificación de experiencia mobile nativa** (futura app iOS/Android) **NO** se genera ahora por estar fuera de alcance; queda como capacidad de framework (ver F12 del tracker), gatillable si se declaran los stacks `-IOS`/`-AND`.

**2ª ronda — auditoría UI/UX + Frontend Architect (humana, 2026-06-14):**
- **Producto**: `TrustSignals` (§7.14, tienda sin reputación); profundidad del buscador IA (interpretación visible + estado baja-confianza + refinamiento, §7.12); checkout guest con campos + recovery (§7.13); feedback "agregar al carrito" (§7.11); jerarquía y CTA-vs-stock de la card (§7.3); microcopy de momentos de ansiedad (§10.2).
- **Código**: contrato de tokens (CSS vars + alias semánticos, §12.1); helper de formato ARS (§7.4); JSON-LD Product/Offer (§12); `next/image` `sizes`/`priority` (§8.1); Recharts SSR (§9); densidad de tabla (§7.9); coexistencia z-index mobile (§6.1); fuente Inter reconciliada (§3.1); a11y `lang`/foco-en-ruta/tabla-cards (§11).
- Gaps sistémicos del generador → tracker de framework **F13–F17**.

**Preguntas abiertas:**
- Logo final de DSM (placeholder hasta entonces) — no bloquea desarrollo.
- Modo oscuro: excluido del MVP por decisión; reconfirmar si se quiere en una iteración futura.
- Contraste del nuevo `info` (#0E7490): re-verificar el ratio exacto en el build (estimado ~4.9:1).
- **Campos del checkout guest**: confirmados nombre/email/teléfono (§7.13) — validar con el PO si quiere alguno más (¿CUIT? hoy no, AFIP es roadmap).
- **Contenido de TrustSignals**: horarios reales del local y número de WhatsApp a confirmar con el dueño.

---

## Aprobación

- [x] PO: **Pedro Suarez**  Fecha: **2026-06-15**
- [x] Arquitecto: **Gabriel Suarez**  Fecha: **2026-06-15**

> Aprobado → este doc se convierte en input obligatorio para toda task UI/FE downstream. Cambios al design system mid-proyecto requieren mini-ADR. El E2E §10 (arquitectura frontend) no se firma hasta que este doc esté `Approved`.
