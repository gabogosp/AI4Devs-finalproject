---
parent-us: US-007
discipline: frontend-web
variant: null
language: es
---

# US-007 Frontend Web — Tasks

> Cada task es closure-grade: atómica, con `Exit criterion:` observable y `Verify:` con el
> comando exacto que `/develop-frontend-web` corre. Los comandos asumen la **raíz del
> repo** como cwd. El runner es el de US-002/US-003/US-014:
> `pnpm --filter @dsm/web test -- <patrón>` corre Vitest en su forma **terminante**
> (`"test": "vitest run"` en `package.json` — no watch, F49) y
> `pnpm --filter @dsm/web test:e2e -- <spec>` corre Playwright (one-shot por naturaleza).
> Los E2E necesitan el API y el web levantados según `playwright.config.ts`.
>
> **Corrección al ejecutar (2026-08-23)**: ocho `Verify` de este plan usaban `rg`
> (ripgrep), que **no está instalado** en el entorno de desarrollo y que CI no usa en ningún
> workflow. Se sustituyeron por su equivalente exacto con `grep -r` en vez de instalar una
> herramienta en la máquina del dev; la fuerza del chequeo no cambia. Se corrigieron además
> dos defectos de los `Verify`: el `git diff` de T0.1 llevaba dos pathspecs (una antes del
> `--`, que git ignora) y el pre-requisito de `API_INTERNAL_ORIGIN` miraba el `.env` de la
> raíz cuando Next carga el env desde `apps/web/`.
>
> **Estimación dual**: **10,4 h AI-asistido** / **~20 h tradicional** (24 tasks, suma de las
> fases: 1,6 + 1,4 + 2,6 + 2,0 + 1,2 + 1,0 + 0,6). La US §7 presupuesta `FE-US-007` en
> 8-12 h: el tradicional excede el techo ~8 h por trabajo que la US da por resuelto al
> describirlo como «vista de carrito con stepper y persistencia» —
> (a) la **topología de cookies**: extender el rewrite de ADR-0013 y probarlo contra la app
> construida, sin lo cual el carrito funciona en local y **está roto en producción**;
> (b) el **segundo sujeto de CSRF**, porque el lector único de US-014 está atado a una sola
> cookie y el invitado tiene carrito sin tener sesión;
> (c) que el carrito **no puede renderizarse en servidor** (el guard de `client.ts` lo
> prohíbe), lo que obliga a la isla cliente en un layout servidor y a su E2E;
> (d) tres superficies **ya entregadas** que hay que modificar sin romperlas (layout,
> `ProductPurchase`, `ProductCard`).
> La vista en sí —lista, stepper, totales, vacío— son ~5 h.

## Pre-requisitos

- [x] **`apps/web` limpio en el working tree.** Este change modifica
  `app/(storefront)/layout.tsx`, `ProductPurchase.tsx` y `ProductCard.tsx`, los tres
  compartidos con changes de US-002/US-003/US-018. Con otra sesión escribiendo ahí se
  pisan (precedente: la colisión de US-007 backend).
  **Verify**: `git status --porcelain apps/web` vacío
- [x] **Backend del carrito publicado en el contrato.** Los tres endpoints tienen que estar
  en `apps/api/docs/api/openapi.yaml` o el codegen no puede generar nada.
  **Verify**: `python3 -c "import yaml,sys; d=yaml.safe_load(open('apps/api/docs/api/openapi.yaml')); ops=[(p,m) for p in ('/cart','/cart/items/{slug}') for m in d['paths'].get(p,{})]; assert sorted(ops)==[('/cart','get'),('/cart/items/{slug}','delete'),('/cart/items/{slug}','put')], ops; print('contrato del carrito OK', ops)"`
- [x] **Suite del web verde antes de empezar** (baseline conocido, para no atribuirse fallos ajenos).
  **Verify**: `pnpm --filter @dsm/web typecheck && pnpm --filter @dsm/web test`
- [x] **`API_INTERNAL_ORIGIN` presente en el `.env` local** — sin ella el rewrite apunta a
  `undefined` y el carrito devuelve 404 (el mismo síntoma que describe ADR-0013 para login).
  **Verify**: `grep -q "^API_INTERNAL_ORIGIN=" apps/web/.env.local || grep -q "^API_INTERNAL_ORIGIN=" apps/web/.env`
  *(corregido al ejecutar: Next carga el env desde `apps/web/`, no desde la raíz del repo —
  el `Verify` original miraba `.env` de la raíz y daba falso negativo.)*

> **Estado intermedio declarado (F51).** Al cerrar este change, el CTA «Ir al pago» queda
> **deshabilitado con el motivo a la vista**: `/checkout` no existe hasta que US-008 FE lo
> construya. `Deferred: US-008 — owner: FE`. El resto del carrito es plenamente funcional.

---

## Fase 0: Contrato, topología y borde HTTP — 1,6 h

- [x] T0.1 Regenerar los artefactos derivados del contrato (DTOs + Zod + mocks MSW)
  - **Pattern**: `pnpm --filter @dsm/web codegen` (orval ya configurado con el mutator
    `customFetch` y el generador MSW). **No se escribe a mano ni un DTO, ni un schema Zod,
    ni un handler de mock** — `per frontend-standards.md §3.1/§3.2 — los artefactos
    derivados del contrato se GENERAN; escribirlos a mano reintroduce drift silencioso`.
  - **Exit criterion**: `src/api/generated/model/` contiene los modelos del carrito
    (`cartView`/`cartItem`/`setCartItem` o los nombres que orval derive del contrato),
    `endpoints.ts` expone las tres operaciones y `zod.ts` sus schemas. Volver a correr el
    codegen **no produce diff** (idempotente). Ningún archivo bajo `src/api/generated/` se
    edita a mano.
  - **Verify**: `pnpm --filter @dsm/web codegen && git diff --exit-code -- apps/web/src/api/generated && grep -q "cart" apps/web/src/api/generated/endpoints.ts && ls apps/web/src/api/generated/model | grep -qi "cart"`
    (el `--exit-code` prueba la **idempotencia**: si el codegen no estaba corrido, la
    primera ejecución deja diff y esta línea falla hasta que se commitee)

- [ ] T0.2 El gate de CI de frescura del codegen cubre el carrito
  - **Exit criterion**: el workflow `frontend-codegen-fresh` corre `codegen` y **falla** si
    produce diff, incluidos los modelos del carrito. No hace falta modificarlo si ya es
    genérico; si estuviera acotado a rutas específicas, se generaliza.
  - **Verify**: `grep -q "codegen" .github/workflows/frontend-codegen-fresh.yml && grep -Eq "diff|--exit-code|git status" .github/workflows/frontend-codegen-fresh.yml`
    y, como prueba de que el gate **muerde**: `sed -i.bak '1s/^/\/\/ drift\n/' apps/web/src/api/generated/endpoints.ts && ! (pnpm --filter @dsm/web codegen && git diff --exit-code -- apps/web/src/api/generated) ; mv apps/web/src/api/generated/endpoints.ts.bak apps/web/src/api/generated/endpoints.ts`
    (introduce drift a propósito, comprueba que el chequeo falla, y restaura)

- [ ] T0.3 Extender el rewrite same-origin al carrito (**ADR-0013 heredado**)
  - **Pattern**: agregar una entrada al array de `rewrites()` en `next.config.mjs`, junto a
    la de auth. Declarativo: **no** se agrega un `fetch` ni un route handler — `per
    ADR-0013 — el navegador nunca direcciona al API en la superficie con cookies` y `per
    frontend-standards.md §11.1 — un solo cliente HTTP (F48)`.
    ```js
    { source: '/v1/cart/:path*', destination: `${apiOrigin()}/v1/cart/:path*` },
    ```
  - **Exit criterion**: `/v1/cart` y `/v1/cart/items/*` se resuelven contra
    `API_INTERNAL_ORIGIN` desde el origen del sitio. `API_INTERNAL_ORIGIN` sigue siendo
    **server-only** (sin prefijo `NEXT_PUBLIC_`) y el arranque sigue fallando ruidoso si
    falta. El rewrite de `/v1/auth/:path*` queda **idéntico**.
  - **Verify**: `pnpm --filter @dsm/web test -- next-config` (nuevo
    `apps/web/src/lib/http/rewrites.test.ts`: importa la config y asserta que el array
    contiene **las dos** entradas con el destino derivado de `API_INTERNAL_ORIGIN`, y que
    ninguna lleva `NEXT_PUBLIC_`) — la prueba real de que la cookie viaja es T5.1, contra
    la app construida

- [ ] T0.4 Un solo lector de CSRF, dos sujetos
  - **Pattern**: parametrizar por **sujeto**, no duplicar el parser — `per el comentario
    normativo de `csrf.ts`: «que haya un solo lector importa»` y `per security-standards.md
    §7.5 — double-submit`.
    ```ts
    export const CSRF_COOKIES = { session: 'dsm_csrf', cart: 'dsm_cart_csrf' } as const;
    export type CsrfSubject = keyof typeof CSRF_COOKIES;
    export function readCsrfToken(subject: CsrfSubject = 'session'): string | null { … }
    ```
  - **Exit criterion**: `readCsrfToken()` sin argumento sigue leyendo `dsm_csrf`
    (comportamiento **idéntico** al actual), `readCsrfToken('cart')` lee `dsm_cart_csrf`, y
    sigue existiendo **un solo** `document.cookie.match` en toda la app. Los specs de
    US-014 (`csrf.test.ts`) pasan **sin editarse** — si hay que tocarlos, el
    comportamiento cambió y el refactor está mal.
  - **Verify**: `pnpm --filter @dsm/web test -- csrf` (los casos existentes corren sin
    editar + casos nuevos: `readCsrfToken('cart')` devuelve el valor de `dsm_cart_csrf`
    con ambas cookies presentes; devuelve `null` si sólo está `dsm_csrf`; el default sigue
    siendo `'session'`) **y**
    `test $(grep -rl "document\.cookie" apps/web/src --include='*.ts' --include='*.tsx' | grep -v '\.test\.' | wc -l | tr -d ' ') -eq 1`

---

## Fase 1: Cliente HTTP y repositorio — 1,4 h

- [ ] T1.1 `session: 'cart'` en el cliente centralizado
  - **Pattern**: tercer valor del discriminante existente; hereda same-origin,
    `credentials: 'include'`, header de double-submit **y el throw en servidor** — `per
    frontend-standards.md §11.1` y `per US-014 design.md D3 — la sesión del cliente es
    sólo de navegador, para que un dato personalizado no entre a la Data Cache`.
  - **Exit criterion**: con `session: 'cart'` el cliente (a) usa URL **relativa** (la
    resuelve el rewrite), (b) manda `credentials: 'include'`, (c) en escrituras agrega
    `x-csrf-token` leído con el sujeto `'cart'`, (d) **lanza** si se invoca desde el
    servidor, con el mismo mensaje-clase que `'customer'`. El comportamiento de
    `session: 'customer'` y de las llamadas públicas sin sesión queda **sin cambios**.
  - **Verify**: `pnpm --filter @dsm/web test -- 'client'` (casos nuevos en `client.test.ts`
    y `client.server.test.ts`: `session:'cart'` + `PUT` → el `fetch` espiado recibe URL
    relativa, `credentials:'include'` y el header con el valor de `dsm_cart_csrf`;
    `session:'cart'` + `GET` → **sin** header CSRF; sin la cookie → sale **sin** header y
    el 403 se propaga (fail closed); en entorno servidor → **lanza**; los casos existentes
    de `'customer'` y públicos pasan sin editarse)

- [ ] T1.2 `cartService` — repositorio del feature
  - **Pattern**: la lógica de servicio es lo **único** que se escribe a mano (§3.3); envuelve
    las operaciones **generadas** y mapea errores con el `mapProblemToAppError` existente —
    `per frontend-standards.md §11.5 — repositorio por feature` y `§11.3 — mapeo a AppError
    tipado`. Nunca un `fetch` directo.
  - **Exit criterion**: expone `getCart()`, `setItemQuantity(slug, quantity)` y
    `removeItem(slug)`, las tres pasando por el cliente generado con `session: 'cart'` y
    devolviendo el `CartView` **tipado por el contrato** (no un tipo escrito a mano).
    Traduce 404 → `notFound`, 409 → `conflict` (preservando `available_quantity` del body),
    403 → `forbidden`, 429 → `rateLimited` con `retryAfterSeconds`. **No** hay ningún
    `fetch(` en `src/features/cart/`.
  - **Verify**: `pnpm --filter @dsm/web test -- cartService` (con los handlers **MSW
    generados** en T0.1: happy path de las 3 operaciones; 409 → `conflict` con
    `available_quantity` accesible; 404 → `notFound`; 429 → `rateLimited` con el
    `retryAfterSeconds` del header) **y** `! grep -rq "fetch(" apps/web/src/features/cart` (sin resultados)

---

## Fase 2: Estado y componentes del carrito — 2,6 h

- [ ] T2.1 `useCart` — unión discriminada y reemplazo del estado
  - **Pattern**: `useReducer` con estado como **unión discriminada**, nunca banderas
    booleanas ni campos nulables — `per frontend-standards.md §11.4`. Cada mutación
    **reemplaza** el `CartView` completo (el backend lo devuelve entero), así no hay
    cálculo local de totales que pueda divergir.
    ```ts
    type CartState =
      | { kind: 'idle' } | { kind: 'loading' }
      | { kind: 'ready'; cart: CartView; mutatingSlugs: string[] }
      | { kind: 'error'; error: AppError; cart?: CartView };
    ```
  - **Exit criterion**: expone `state`, `add(slug)`, `setQuantity(slug, n)` y
    `remove(slug)`. `mutatingSlugs` es **por línea**: mutar un ítem no bloquea los otros.
    Un 409 deja el estado en `ready` con el carrito del servidor y el conflicto expuesto por
    línea (no tira el carrito). Un error de red deja `kind: 'error'` **conservando el
    carrito previo** para que la pantalla no quede vacía. Ningún total se calcula en el
    cliente: todos salen del `CartView`.
  - **Verify**: `pnpm --filter @dsm/web test -- useCart` (`useCart.test.ts` con el service
    mockeado: `loading → ready`; dos mutaciones concurrentes en slugs distintos → **ambos**
    en `mutatingSlugs` y ninguna bloquea a la otra; 409 → sigue `ready` y el conflicto es
    legible; error de red → `kind:'error'` **con** `cart` previo presente; y un caso que
    asserta que `total_ars_cents` mostrado es **exactamente** el del `CartView` mockeado,
    incluso si la suma de subtotales de las líneas difiere —prueba que no se recalcula)

- [ ] T2.2 `QuantityStepper` — acotado al stock y operable por teclado
  - **Pattern**: `per design-system §7.11 — stepper acotado al stock disponible; no permite
    superarlo` y `per qa-frontend-standards.md §19 — operable por teclado, nombre accesible
    por control`.
  - **Exit criterion**: el botón «+» se deshabilita al alcanzar `max_quantity`; el «−» al
    llegar a 1 (quitar es una acción aparte, no un stepper en 0). Cada botón tiene
    `aria-label` que **nombra el producto**. El input expone `aria-valuemax = max_quantity`.
    Mientras la línea está mutando, ambos botones quedan deshabilitados (OQ-FE-1:
    pesimista) y los cambios se agrupan con debounce de **400 ms**. Operable con
    `Tab` + `Enter`/`Space` y con flechas ↑/↓ sobre el input.
  - **Verify**: `pnpm --filter @dsm/web test -- QuantityStepper` (RTL + `userEvent`: con
    `max_quantity: 2` el «+» queda `disabled` al llegar a 2; en 1 el «−» está `disabled`;
    los `aria-label` contienen el nombre del producto; 5 clics rápidos producen **una sola**
    llamada al callback (debounce, con timers falsos); con `mutating` ambos `disabled`;
    navegación completa por teclado sin mouse)

- [ ] T2.3 `CartItemRow` — línea con precio, subtotal y avisos del contrato
  - **Pattern**: formato de moneda **sólo** por el helper existente
    `lib/format/currency.ts` (el mismo en server y client, `per design-system §7.4 — evita
    hydration mismatch`); estado de disponibilidad con texto, **nunca color como único
    indicador** (`per design-system §7.7`).
  - **Exit criterion**: renderiza imagen, nombre, precio unitario **vigente**, stepper y
    subtotal. `availability: 'insufficient_stock'` → badge «quedan N» + acciones «ajustar a
    N» y «quitar»; `'unavailable'` → badge «ya no disponible» + «quitar»; ninguna de las dos
    muta el carrito **por su cuenta** (OQ-FE-3). `price_changed` muestra el precio anterior
    y el vigente. Ningún importe se formatea con `toLocaleString` ad-hoc ni con template
    strings.
  - **Verify**: `pnpm --filter @dsm/web test -- CartItemRow` (los 3 estados de
    `availability` renderizan su texto —no sólo una clase de color—; `price_changed:true`
    muestra ambos precios; el importe coincide **carácter por carácter** con
    `formatArs(subtotal_ars_cents)` del helper; «ajustar a N» y «quitar» disparan callbacks
    y **no** mutan solas) **y**
    `! grep -rEq "toLocaleString" apps/web/src/features/cart` (sin resultados)

- [ ] T2.4 `CartSummary` — total, CTA al pago y el bloqueo de AC-6
  - **Exit criterion**: muestra el `total_ars_cents` con el helper, con el subtexto «IVA
    incluido» (§7.4). El CTA «Ir al pago» (botón `accent`, §7.11) está **deshabilitado**
    cuando `has_blocking_issues` es `true`, **con el motivo visible** (AC-6), y **también**
    mientras `/checkout` no exista, con su propio motivo («el pago se habilita en la próxima
    entrega») — los dos motivos son distinguibles. El contenedor del total lleva
    `aria-live="polite"`.
  - **Verify**: `pnpm --filter @dsm/web test -- CartSummary` (`has_blocking_issues:true` →
    CTA `disabled` **y** el motivo presente en el DOM; `false` → CTA `disabled` por el
    motivo de US-008, con texto **distinto** al anterior; el total coincide con el helper;
    el contenedor tiene `aria-live="polite"`)

- [ ] T2.5 `CartEmptyState` (AC-7)
  - **Pattern**: `per design-system §10.1 — estado vacío con invitación a seguir comprando`
    y tono §10.2 (informal argentino, «vos»).
  - **Exit criterion**: con `id: null` e `items: []` muestra un encabezado real
    (`<h1>`/`<h2>`, no un `div`), un texto de invitación y un **enlace navegable** a los
    rubros. No aparece el resumen, ni el total, ni el CTA al pago.
  - **Verify**: `pnpm --filter @dsm/web test -- CartEmptyState` (el encabezado existe con
    `getByRole('heading')`; hay un `link` a la home o a rubros; `queryByRole('button', {
    name: /ir al pago/i })` es `null`)

---

## Fase 3: Integración en el storefront — 2,0 h

- [ ] T3.1 `app/(storefront)/carrito/page.tsx` — vista de cliente, no indexable
  - **Pattern**: Client Component + `export const metadata = { robots: { index: false } }`
    (Metadata API) — `per frontend-next-standards.md — datos personalizados no se
    prerenderizan ni se cachean` y `per el guard de client.ts (US-014 D3)`. Composición
    explícita de los 4 estados, sin un `if (data)` que los cubra a todos (`per
    frontend-standards.md §11.9`).
  - **Exit criterion**: `/carrito` renderiza los cuatro estados —skeleton en `loading`,
    lista en `ready`, vacío cuando no hay ítems, error recuperable con «reintentar»
    conservando el carrito previo—. La página declara `robots: index: false`. **No** existe
    ningún `loading.tsx` en la rama de `carrito` (mismo motivo que US-003 documentó: la
    boundary de Suspense compromete el status 200). Ninguna llamada al carrito se hace desde
    el servidor.
  - **Verify**: `pnpm --filter @dsm/web test -- CartPage` (los 4 estados renderizan su
    marca distintiva; el estado `error` muestra «reintentar» **y** sigue mostrando las
    líneas previas) **y** `pnpm --filter @dsm/web test -- cartMetadata`
    (asserta `robots.index === false`) **y**
    `test ! -f "apps/web/app/(storefront)/carrito/loading.tsx"`

- [ ] T3.2 `CartBadge` + `CartProvider` en el layout del storefront
  - **Pattern**: **isla cliente** dentro de un layout que sigue siendo Server Component
    (`CategoryNav` lo necesita para el SEO de US-002) — `per frontend-next-standards.md —
    frontera Server/Client`. El badge se suscribe al mismo estado que la página, para que
    agregar desde la ficha lo actualice sin recargar.
  - **Exit criterion**: el header del storefront muestra el acceso al carrito con la
    cantidad de **unidades** (`total_quantity`, OQ-FE-4). Antes de resolver se renderiza
    **sin número** —nunca un `0`, que sería incorrecto—. El layout **sigue siendo Server
    Component** (sin `'use client'` en `layout.tsx`) y `CategoryNav` sigue renderizando en
    servidor. El comentario del layout que decía `Deferred: US-004/US-007` se actualiza a
    `Deferred: US-004` (el buscador sigue pendiente).
  - **Verify**: `pnpm --filter @dsm/web test -- CartBadge` (con carrito de 3 unidades en 2
    líneas muestra **3**; en `loading` **no** hay dígito en el DOM; al agregar un ítem el
    número sube sin remontar) **y** `! grep -q "'use client'" "apps/web/app/(storefront)/layout.tsx"`
    **y** `pnpm --filter @dsm/web test -- CategoryNav` (los specs de US-002 pasan sin editarse)

- [ ] T3.3 `AddToCartButton` + `MiniCart` (AC-1, sin redirigir)
  - **Pattern**: `per design-system §7.11 — mini-cart que baja desde arriba (bottom-sheet en
    mobile) con «Agregado ✓» + «Ir al carrito»; NO interrumpe la navegación (no redirige)`.
    `role="status"`, no `alert`: agregar algo no es un error (`per design-system §7.6`).
  - **Exit criterion**: al agregar, aparece el mini-cart con la confirmación y un enlace «Ir
    al carrito», el badge incrementa, y **la navegación no cambia** (la URL es la misma).
    El mini-cart **no roba el foco** (quien está navegando con teclado sigue donde estaba) y
    se cierra solo a los 4 s (§7.6) o con `Escape`. Tiene `role="status"` y `aria-live`.
  - **Verify**: `pnpm --filter @dsm/web test -- 'AddToCartButton|MiniCart'` (tras el clic:
    el mini-cart está en el DOM con `role="status"`; **`document.activeElement` sigue siendo
    el botón** que se clickeó —no el mini-cart—; no hay llamada al router de Next (espía con
    0 llamadas a `push`); a los 4 s con timers falsos desaparece; `Escape` lo cierra)

- [ ] T3.4 Habilitar «Agregar al carrito» en la ficha (US-003)
  - **Pattern**: `ProductPurchase.tsx` hoy renderiza el botón `disabled` como señal de
    roadmap, con un test que lo asserta. Se reemplaza por `AddToCartButton`; el canal de
    WhatsApp **se conserva** (sigue siendo el camino para productos sin stock, US-018).
  - **Exit criterion**: con stock, la ficha muestra «Agregar al carrito» **habilitado** y
    funcional. Sin stock, el botón **no** aparece y queda el CTA de WhatsApp de US-018,
    igual que hoy. El comentario de `ProductPurchase.tsx` que explicaba el `disabled` se
    reemplaza por la razón vigente. **`ProductPurchase.test.tsx` se reescribe** — es la
    **única** excepción al «tests existentes sin editar» de este plan, y es deliberada: ese
    test asserta un cartel de roadmap que este change apaga.
  - **Verify**: `pnpm --filter @dsm/web test -- ProductPurchase` (con stock: el botón está
    **habilitado** y al clickearlo llama al service; sin stock: `queryByRole('button', {
    name: /agregar al carrito/i })` es `null` **y** el enlace de WhatsApp sigue presente —el
    caso de US-018 no se rompió)

- [ ] T3.5 «Agregar» en la card del listado (AC-1 — **OQ-FE-2**)
  - **Exit criterion**: `ProductCard` muestra un «Agregar» que agrega **1 unidad** (sin
    stepper: el stepper vive en el carrito y en la ficha). En una card sin stock el botón no
    aparece. **El enlace a la ficha sigue siendo el elemento principal de la card** y el
    botón no lo intercepta (clic en el botón → no navega; clic en la card → navega).
    Los specs de `ProductCard` de US-002 pasan **sin editarse**.
  - **Verify**: `pnpm --filter @dsm/web test -- ProductCard` (los casos existentes de US-002
    corren sin editar + nuevos: el clic en «Agregar» llama al service y **no** dispara
    navegación —espía del router en 0—; el clic en el título sí navega; card sin stock →
    sin botón)
  - **Nota**: si el PO resuelve OQ-FE-2 como «sólo la ficha», esta task **cae** y con ella
    la mitad del `Verify` de arriba. `Deferred:` en ese caso, no borrada.

---

## Fase 4: Accesibilidad y observabilidad — 1,2 h

- [ ] T4.1 axe-core sin violaciones en el carrito
  - **Pattern**: `per qa-frontend-standards.md §23.6 — axe-core sobre la pantalla`; el repo
    ya tiene el precedente en `features/storefront/a11y.test.tsx` y `categoryA11y.test.tsx`.
  - **Exit criterion**: `CartPage` en sus estados `ready` (con una línea disponible y una
    bloqueada) y vacío no produce **ninguna** violación de axe con el ruleset WCAG 2.1 AA.
    El recorrido completo con teclado —del primer stepper al CTA— no tiene trampas de foco
    ni controles inalcanzables.
  - **Verify**: `pnpm --filter @dsm/web test -- cartA11y` (nuevo
    `features/cart/cartA11y.test.tsx`, espejo de `categoryA11y.test.tsx`:
    `expect(await axe(container)).toHaveNoViolations()` en los dos estados + recorrido de
    `Tab` que llega a **todos** los controles interactivos en orden visual)

- [ ] T4.2 El total se anuncia y los avisos no dependen del color
  - **Exit criterion**: al cambiar una cantidad, el nuevo total queda en una región
    `aria-live="polite"` (se anuncia sin interrumpir). Cada estado de `availability` tiene
    **texto** que lo explica, no sólo una clase de color; verificado quitando las clases y
    comprobando que el motivo sigue siendo legible.
  - **Verify**: `pnpm --filter @dsm/web test -- cartAnnouncements` (la región `aria-live`
    contiene el total nuevo tras la mutación; para los 3 estados de `availability`, el
    `textContent` del row incluye el motivo —el assert se hace sobre texto, no sobre
    `className`)

- [ ] T4.3 Eventos de negocio del carrito, sin PII
  - **Pattern**: usar el módulo `lib/observability` existente; sin dimensión por producto
    (cardinalidad) — `per frontend-standards.md §11.8` y `per observability-patterns §3.3`.
  - **Exit criterion**: se emiten `cart.item_added`, `cart.quantity_changed`,
    `cart.item_removed`, `cart.viewed` y `cart.blocked_checkout` en sus puntos exactos.
    Ninguna carga útil incluye datos personales ni el token del carrito. `cart.blocked_checkout`
    se emite **una sola vez** por visualización con `has_blocking_issues`, no por render.
  - **Verify**: `pnpm --filter @dsm/web test -- cartTelemetry` (los 5 eventos se emiten en
    su escenario; `cart.blocked_checkout` se emite **1** vez tras 3 re-renders;
    `expect(JSON.stringify(todosLosPayloads)).not.toMatch(/dsm_cart|@|\+54/)`)

---

## Fase 5: E2E dev-owned — 1,0 h

- [ ] T5.1 **La topología funciona contra la app construida** (ADR-0013)
  - **Pattern**: espejo exacto de `e2e/auth-topology.spec.ts`, que es el precedente que
    ADR-0013 dejó: se asserta sobre `response.status()` y `context.cookies()`, **nunca sobre
    el DOM** — `per ADR-0013 §Verification`. Es la única prueba que puede detectar el
    defecto que sólo aparece en producción.
  - **Exit criterion**: contra la app **construida**, un `PUT /v1/cart/items/{slug}` desde
    el origen del sitio devuelve 200; `context.cookies()` muestra `dsm_cart` como
    `httpOnly` **en el host del sitio** y `dsm_cart_csrf` legible; un `GET /v1/cart`
    posterior devuelve el ítem (la cookie volvió); y el mismo `GET` en un contexto **nuevo**
    devuelve el carrito vacío (el 200 anterior no fue un falso positivo).
  - **Verify**: `pnpm --filter @dsm/web test:e2e -- cart-topology`
    (`e2e/cart-topology.spec.ts`)

- [ ] T5.2 Persistencia entre visitas (AC-4)
  - **Exit criterion**: con un contexto de navegador **persistido**, se agrega un producto,
    se cierra el contexto y se abre uno nuevo **con el mismo estado de almacenamiento**: el
    carrito sigue teniendo el producto, sin haber creado cuenta. El FE **no escribe ni lee**
    la cookie del carrito en ningún momento (es `httpOnly`): la persistencia la aporta el
    backend.
  - **Verify**: `pnpm --filter @dsm/web test:e2e -- cart-persistence`
    (`e2e/cart-persistence.spec.ts`, con `storageState` guardado y recargado; incluye un
    assert de que `document.cookie` **no** contiene `dsm_cart` —sólo `dsm_cart_csrf`)

- [ ] T5.3 El recorrido del carrito no rompe la indexación del storefront
  - **Exit criterion**: `/carrito` responde con `X-Robots-Tag`/meta `noindex`. Las páginas
    indexables —home, categoría, ficha— **siguen** devolviendo 200 con su contenido en el
    HTML del servidor después de agregar el badge al layout compartido (el badge es una isla
    cliente y no puede haber convertido el layout en client-only).
  - **Verify**: `pnpm --filter @dsm/web test:e2e -- 'cart-noindex|storefront-home|pdp-ssr|category-ssr'`
    (nuevo `cart-noindex.spec.ts` + los tres specs SSR **existentes** corriendo sin editarse
    — si alguno rompe, el layout dejó de renderizar en servidor)

---

## Fase 6: Documentación — 0,6 h

- [ ] T6.1 README del feature
  - **Exit criterion**: `apps/web/src/features/cart/README.md` explica en ≤ 40 líneas: por
    qué el carrito es cliente y no servidor (el guard de `client.ts`), por qué el rewrite de
    ADR-0013 se extendió, los dos sujetos de CSRF, que los totales **vienen del servidor** y
    no se calculan acá, y **qué NO hace** (no reserva stock, no cobra, no confirma — con los
    punteros a US-008/US-009/US-010).
  - **Verify**: `test -f apps/web/src/features/cart/README.md && grep -q "ADR-0013" apps/web/src/features/cart/README.md && grep -q "US-008" apps/web/src/features/cart/README.md && test $(wc -l < apps/web/src/features/cart/README.md) -le 40`

- [ ] T6.2 Actualizar el README de la app con la variable que ahora comparte
  - **Exit criterion**: `apps/web/README.md` dice que `API_INTERNAL_ORIGIN` gobierna **dos**
    superficies same-origin (`/v1/auth/*` y `/v1/cart/*`), y que sin ella el carrito
    devuelve 404 con el mismo síntoma que el login.
  - **Verify**: `grep -q "API_INTERNAL_ORIGIN" apps/web/README.md && grep -q "/v1/cart" apps/web/README.md`

---

## Verification (suite-level)

- [ ] Type-check limpio: `pnpm --filter @dsm/web typecheck`
- [ ] Lint limpio: `pnpm --filter @dsm/web lint`
- [ ] Codegen fresco (sin drift): `pnpm --filter @dsm/web codegen && git diff --exit-code -- apps/web/src/api/generated`
- [ ] Suite de Vitest completa (forma terminante): `pnpm --filter @dsm/web test`
- [ ] Suite del carrito en aislamiento: `pnpm --filter @dsm/web test -- cart`
- [ ] **Sin regresión** en las superficies entregadas que este change modificó:
      `pnpm --filter @dsm/web test -- 'ProductCard|CategoryNav|CategoryPage|ProductPage|csrf|client'`
- [ ] E2E dev-owned verde: `pnpm --filter @dsm/web test:e2e -- 'cart-topology|cart-persistence|cart-noindex'`
- [ ] **Sin regresión** en los E2E de SSR e indexación:
      `pnpm --filter @dsm/web test:e2e -- 'storefront-home|pdp-ssr|category-ssr|admin-noindex|auth-topology'`
- [ ] Sin errores ni warnings de consola al recorrer el carrito en `dev` (verificación
      humana: agregar, cambiar cantidad, quitar, vaciar; queda registrado en el PR)

---

## Trazabilidad AC → tasks

| AC de US-007 | Tasks |
|---|---|
| AC-1 agregar un producto | T0.1, T1.2, T2.1, T3.3, T3.4, T3.5 |
| AC-2 editar la cantidad | T2.1, T2.2, T2.3 |
| AC-3 quitar un producto | T1.2, T2.1, T2.3 |
| AC-4 persistencia entre visitas | T0.3, T1.1, T5.1, T5.2 |
| AC-5 cantidad limitada al stock | T2.2, T2.3 |
| AC-6 producto no disponible | T2.3, T2.4 |
| AC-7 carrito vacío | T2.5, T3.1 |
| AC-8 no reserva ni descuenta stock | T2.3, T2.4 (la UI no promete disponibilidad; el invariante de datos lo probó el backend) |
| AC-9 precios vigentes | T2.1 (no se recalcula nada), T2.3 (`price_changed`), T3.1 (sin caché) |
| AC-10 no se agregan no publicados | T1.2 (404 → `notFound` indistinguible), T2.3 |
| Declaraciones no-AC del design (F51) | T0.2 (gate de CI), T0.3 (rewrite ADR-0013), T0.4 (segundo sujeto CSRF), T1.1 (borde del cliente), T3.2 (isla cliente sin romper el SSR), T4.1/T4.2 (a11y), T4.3 (observabilidad), T5.3 (indexación), T6.1/T6.2 (docs) |
