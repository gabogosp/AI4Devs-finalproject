---
parent-us: US-008
discipline: frontend-web
variant: null
language: es
created: 2026-08-30
---

# US-008 Frontend Web — Tasks

> Cada task es closure-grade: atómica, con `Pattern:` (snippet mínimo + cita del estándar),
> `Exit criterion:` observable y `Verify:` con el comando exacto — **terminante** (F49: `vitest
> run` vía el script `test`, nunca watch) y que **falla si el criterio no se cumple** (F50: se
> ejercita el comportamiento, no se greppea su presencia). Comandos desde la **raíz del repo**.

## Traceability matrix (AC → tasks)

| AC | Título | Task IDs | Estado |
|---|---|---|---|
| AC-1 | Checkout válido crea la orden y avanza al pago | T2.1, T2.2, T3.5, T3.6, T3.7, T4.1, T4.2 | **construido acá** (la mitad "avanza al pago" queda `Deferred: US-009` en T3.6) |
| AC-2 | Ítems con precio al momento (snapshot) | — | **backend-verificado** (`US-008-checkout-guest-backend` T5.4). Este change sólo muestra `total_ars_cents` del 201 en T3.3/T3.6, nunca lo recalcula |
| AC-3 | Validación de los datos del comprador | T1.1, T1.2, T3.5 | **construido acá** |
| AC-4 | Consentimiento obligatorio | T3.2, T3.5 | **construido acá** (mitad UX; el 422 del servidor es la autoridad) |
| AC-5 | Carrito inválido bloquea el checkout | T3.4, T2.2 (manejo del 409), T3.5 | **construido acá** |
| AC-6 | No se descuenta stock antes del pago | — | **backend-verificado** (`US-008-checkout-guest-backend` T5.1). No observable desde esta UI |
| AC-7 | No se almacenan datos de tarjeta | — | **backend-verificado** (T5.2 del backend). Cierto por construcción acá: el formulario (T3.5) no declara ningún campo de tarjeta |
| AC-8 | El consentimiento queda registrado | T3.2 | **mitad FE**: el checkbox manda `consent: true` wireado al seam de US-017; el registro con marca temporal es 100% backend (T5.3 del backend) |

**Cobertura no-AC del `design.md` (F51 — toda declaración tiene task o `Deferred:`)**:
D1 checkout como vista de cliente forzada, `noindex` → T3.7, T3.8 ·
D2 rewrite same-origin a `/v1/checkout/*` → T0.2 ·
D3 resolver custom sobre el schema generado, sin mirror hand-written → T1.1, T1.2 ·
D4 unión discriminada de 4 casos → T2.2 ·
D5 mapeo de errores sin `kind` nuevo → T2.2, T3.5 ·
D6 retiro como información fija (OQ-FE-21) → T3.5 ·
D7 `order_token` en `sessionStorage`, nunca la URL (OQ-FE-19) → T2.3 (`Deferred: US-009` — nadie lo lee todavía) ·
D8 confirmación in-place sin ruta nueva (OQ-FE-20) → T3.6, T3.7 ·
D9 un-defer del CTA del carrito + excepción nombrada de test → T4.1, T4.2 ·
D10 accesibilidad (foco, `aria-describedby`, botón deshabilitado con motivo visible) → T3.5, T3.6, T6.1 ·
D11 cinco eventos de observabilidad → T5.1 ·
D12 NFRs (same-origin, `no-store` heredado del backend, sin caché) → T0.2 (cubre el mismo mecanismo que garantiza el NFR).

**Diferidos declarados**: pantalla de pago / redirect a MercadoPago → `Deferred: US-009 (FE, sin
plan todavía)` · selección de sucursal → `Deferred: sin AC que lo pida (sucursal única)` ·
recuperación del `order_token` tras cerrar la pestaña → `Deferred: sin AC que lo pida — el
`order_number` queda visible y la orden persiste en el backend`.

---

## Pre-requisitos

- [x] **P1 — BLOQUEANTE: `apps/web` sin cambios sin commitear**

  Precedente repetido en este repo (US-006, US-014, US-017, US-018): sesiones paralelas sobre el
  mismo working tree pisan trabajo sin commitear con un `git add -A` ajeno. Este change toca
  `CartSummary.tsx`, `CartPage.tsx`, `next.config.mjs` y `events.ts` — los cuatro compartidos con
  cualquier otra sesión activa en `apps/web`.
  - **Exit criterion**: `git status --porcelain -- apps/web` no devuelve ninguna línea. Si
    devuelve algo, `/develop-frontend-web` **para acá** y reporta.
  - **Verify**: `test -z "$(git status --porcelain -- apps/web)" && echo "OK"`

- [x] **P2 — El backend de checkout está en `main` y el cliente generado está fresco**

  El PR #11 (`US-008-checkout-guest-backend`) ya mergeó y el cliente ya se regeneró
  (`67c70a3`). Este pre-requisito no "wirea" codegen — verifica que sigue fresco, que es la
  garantía que `frontend-codegen-fresh` promete en cada PR.
  - **Exit criterion**: `pnpm --filter @dsm/web codegen` no produce diff sobre
    `src/api/generated/` y `createGuestCheckout` ya existe en `endpoints.ts`.
  - **Verify**:
    ```bash
    grep -q "createGuestCheckout" apps/web/src/api/generated/endpoints.ts \
      && pnpm --filter @dsm/web codegen \
      && test -z "$(git status --porcelain -- apps/web/src/api/generated)" \
      && echo "OK — codegen fresco"
    ```

- [x] **P3 — `design-system.md` en `Approved`**
  - **Exit criterion**: el doc declara la aprobación de PO y Arquitecto (§7.13 CheckoutStepper/Form
    es la sección que gobierna este change).
  - **Verify**: `grep -q '^- \[x\] PO:' docs/product/design-system.md && grep -q '^- \[x\] Arquitecto:' docs/product/design-system.md && echo OK`

- [x] **P4 — AS-BUILT: el CTA del carrito tiene el marcador exacto que este change cierra**
  - **Exit criterion**: `CartSummary.tsx` declara `checkoutAvailable` con default `false` y el
    comentario `Deferred: US-008`. Si el marcador no está, este plan está planificando sobre una
    suposición vieja.
  - **Verify**:
    ```bash
    grep -q 'Deferred: US-008' apps/web/src/features/cart/CartSummary.tsx \
      && grep -q 'checkoutAvailable' apps/web/src/features/cart/CartSummary.tsx \
      && echo OK
    ```

- [x] **P5 — AS-BUILT: el seam de consentimiento de US-017 existe con la forma esperada**
  - **Exit criterion**: `LEGAL_ROUTES` y `CONSENT_COPY` existen en `features/legal/routes.ts` sin
    ningún `href` igual a `'#'`; `LEGAL_TERMS_VERSION` existe en `features/legal/content.ts`.
  - **Verify**:
    ```bash
    grep -q 'export const LEGAL_ROUTES' apps/web/src/features/legal/routes.ts \
      && grep -q 'export const CONSENT_COPY' apps/web/src/features/legal/routes.ts \
      && grep -q 'export const LEGAL_TERMS_VERSION' apps/web/src/features/legal/content.ts \
      && ! grep -q "href: '#'" apps/web/src/features/legal/routes.ts \
      && echo OK
    ```

- [x] **P6 — Suite y build verdes en el `HEAD` de partida**
  - **Exit criterion**: unit/componente y `next build` pasan antes de tocar nada.
  - **Verify**: `API_INTERNAL_ORIGIN=http://localhost:3000 pnpm --filter @dsm/web test && API_INTERNAL_ORIGIN=http://localhost:3000 pnpm --filter @dsm/web build`

---

## Fase 0: Contrato y plomería — same-origin

- [x] T0.1 Confirmar que el cliente generado cubre el shape exacto del backend (gate, sin código)
  - **Exit criterion**: `CreateGuestCheckoutBody`/`CreateGuestCheckoutResponse` (Zod) y
    `CheckoutCreated`/`CreateCheckoutRequest` (modelo) existen y coinciden campo a campo con
    `openspec/changes/US-008-checkout-guest-backend/contracts/openapi/checkout-create.yaml`. Es el
    mismo chequeo que P2 pero a nivel de forma, no de frescura del build.
  - **Verify**:
    ```bash
    rg -q "buyer" apps/web/src/api/generated/model/createCheckoutRequestBuyer.ts \
      && rg -q "order_token" apps/web/src/api/generated/model/checkoutCreated.ts \
      && echo OK
    ```

- [x] T0.2 Extender el rewrite same-origin a `/v1/checkout/:path*` (ADR-0013, heredado)
  - **Pattern**: una entrada más en el array de `rewrites()` de `next.config.mjs`, mismo patrón
    que `/v1/cart/:path*` (US-007 D2) — `per` `design.md` D2 — `frontend-next-standards.md` §1.
    ```js
    { source: '/v1/checkout/:path*', destination: `${apiOrigin()}/v1/checkout/:path*` },
    ```
    Actualizar también el mensaje de error de `apiOrigin()` que hoy lista sólo `/v1/auth/*` y
    `/v1/cart/*` (evita un mensaje de diagnóstico mentiroso cuando falte `API_INTERNAL_ORIGIN`).
  - **Exit criterion**: una petición a `/v1/checkout` desde el origen del sitio se reenvía al
    origen del API; sin `API_INTERNAL_ORIGIN` en producción, el arranque falla ruidoso mencionando
    las **tres** superficies (auth, cart, checkout).
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/lib/http/next-config.rewrites.test.ts`
    (agregar el caso `/v1/checkout/:path*` al spec existente, que ya cubre auth y cart con el mismo
    patrón — no se reescribe el archivo, se extiende)

---

## Fase 1: Validación — el schema generado, traducido

- [ ] T1.1 `checkoutFieldMessages.ts` — traducción de issues Zod a copy es-AR, sin redeclarar constraints
  - **Pattern**: mapa `path.join('.') → mensaje`, **nunca** un segundo `z.object` con `min`/`max`/
    regex propios — `per frontend-standards.md §3.2 — prohibido hand-write mirrors del contrato`.
    Ver `design.md` D3 para el snippet completo.
  - **Exit criterion**: `friendlyMessage(['buyer', 'email'])` devuelve un mensaje en español
    distinto de `friendlyMessage(['consent'])`; un path desconocido devuelve un fallback genérico
    ("Revisá este campo.") en vez de lanzar. El archivo **no** importa ni declara ninguna
    constraint numérica (`min(`, `max(`, `regex(`) — son del schema generado, no de acá.
  - **Verify**:
    ```bash
    pnpm --filter @dsm/web test -- --run src/features/checkout/checkoutFieldMessages.test.ts \
      && ! rg -q '\.(min|max|regex)\(' apps/web/src/features/checkout/checkoutFieldMessages.ts \
      && echo OK
    ```

- [ ] T1.2 `checkoutResolver.ts` — Resolver de react-hook-form sobre `CreateGuestCheckoutBody`
  - **Pattern**: `Resolver<CheckoutFormValues>` que corre `CreateGuestCheckoutBody.safeParse` y
    traduce con T1.1 — `per design.md D3`. **No** usa `zodResolver` con un schema propio.
  - **Exit criterion**: valores válidos (buyer completo, `consent: true`, `fulfillment: 'pickup'`)
    resuelven sin errores; un `buyer.name` de 1 carácter produce `errors['buyer.name']` con el
    mensaje de T1.1; `consent: false` produce `errors['consent']`; **el schema importado es**
    `CreateGuestCheckoutBody` **de** `@/api/generated/zod` (no uno local).
  - **Verify**:
    ```bash
    pnpm --filter @dsm/web test -- --run src/features/checkout/checkoutResolver.test.ts \
      && rg -q "from '@/api/generated/zod'" apps/web/src/features/checkout/checkoutResolver.ts \
      && echo OK
    ```

---

## Fase 2: Servicio y estado

- [ ] T2.1 `checkoutService.ts` — repositorio del checkout (`frontend-standards.md` §3.3/§11.5)
  - **Pattern**: envuelve `createGuestCheckout` generado con `session: 'cart'` (mismo sujeto de
    CSRF que el carrito — cero cambios en `client.ts`/`csrf.ts`) y valida la respuesta con
    `parseContract` — `per` el precedente exacto de `cartService.ts`.
    ```ts
    import { createGuestCheckout } from '@/api/generated/endpoints';
    import { CreateGuestCheckoutResponse } from '@/api/generated/zod';
    import type { CheckoutCreated, CreateCheckoutRequest } from '@/api/generated/model';
    import { parseContract } from '@/lib/http/contract';

    export const checkoutService = {
      async submit(input: CreateCheckoutRequest): Promise<CheckoutCreated> {
        const res = await createGuestCheckout(input, { session: 'cart' });
        return parseContract(CreateGuestCheckoutResponse, res.data);
      },
    };
    ```
  - **Exit criterion**: `submit` llama a `createGuestCheckout` con `{ session: 'cart' }` (nunca sin
    esa opción — de lo contrario la llamada sale sin `credentials`/CSRF y el backend responde 403);
    devuelve el `CheckoutCreated` validado; un cuerpo de respuesta que no matchea el schema lanza
    `AppErrorException({ kind: 'server' })` en vez de propagar un objeto sin tipar.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/checkout/checkoutService.test.ts`
    (MSW: `getCreateGuestCheckoutMockHandler` para el 201; un handler que devuelve un 201 con
    `order_token` mal formado → `parseContract` lanza `server`)

- [ ] T2.2 `useCheckout.ts` — unión discriminada de 4 casos (`frontend-standards.md` §11.4)
  - **Pattern**: `useReducer` de `idle | submitting | success | error`, sin contexto compartido
    (un solo consumidor) — `per design.md D4`. El error se mapea con `isAppError`/`appErrorDe`
    (mismo helper que `useCart.ts`, no se reescribe).
  - **Exit criterion**: `submit(input)` transiciona `idle → submitting → success` en el camino
    feliz; en fallo transiciona a `error` **conservando** los valores que el formulario ya tenía
    (el estado del form vive en RHF, no en `CheckoutState` — el reducer no lo toca); un segundo
    `submit` mientras `submitting` está en vuelo no dispara una segunda petición (single-flight,
    mismo patrón que `reload()` de `useCart.ts`).
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/checkout/useCheckout.test.ts`
    (reducer puro: los 4 casos + transición de `error` de vuelta a `submitting` en un reintento;
    hook con `checkoutService` mockeado: dos llamadas a `submit` simultáneas → un solo POST)

- [ ] T2.3 `orderToken.ts` — persistencia del token para US-009 (`Deferred: US-009 — owner: FE`)
  - **Pattern**: `sessionStorage`, nunca la URL — `per design.md D7` (razonamiento de seguridad:
    el token es la credencial, no un identificador).
  - **Exit criterion**: `saveOrderToken(token)` escribe en `sessionStorage` bajo la clave
    `dsm_order_token`; el archivo **no** exporta ninguna función que lo ponga en un
    `URLSearchParams`, `router.push` con query, ni en ningún header manual.
  - **Verify**:
    ```bash
    pnpm --filter @dsm/web test -- --run src/features/checkout/orderToken.test.ts \
      && ! rg -q 'order_token.*URLSearchParams|URLSearchParams.*order_token' apps/web/src/features/checkout \
      && echo OK
    ```

---

## Fase 3: Componentes

- [ ] T3.1 `checkoutCopy.ts` — banners por `AppError.kind` (tono §10.2)
  - **Pattern**: constantes, no derivadas de `error.message` crudo — `per` el mismo criterio de
    seguridad de `authCopy.ts` (US-014 D9): el texto de un 409/403 no debe filtrar detalle del
    backend a la UI. Ver la tabla de `design.md` D5 para el texto exacto de cada caso.
  - **Exit criterion**: existe un banner distinto para cada fila de D5 (`validation` genérico,
    `cart-empty`, `cart-not-purchasable`, `forbidden`, `rateLimited` con `retryAfterSeconds`
    opcional, `network`/`server`); los dos textos de conflicto (`cart-empty` vs
    `cart-not-purchasable`) son **strings distintos**.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/checkout/checkoutCopy.test.ts`

- [ ] T3.2 `ConsentCheckbox.tsx` — consume el seam de US-017, no lo reescribe
  - **Pattern**: importa `CONSENT_COPY`/`LEGAL_ROUTES` de `@/features/legal/routes` y renderiza
    los dos `<Link>` con sus `href` tal cual vienen — **cero literales `'/legales/`** en este
    archivo — `per` el guard existente `routes.test.ts` (US-017), que ya recorre todo
    `apps/web/src`/`apps/web/app` y falla si aparece el literal fuera de `routes.ts`.
    ```tsx
    import Link from 'next/link';
    import { CONSENT_COPY } from '@/features/legal/routes';
    ```
  - **Exit criterion**: el checkbox no marcado + intento de submit muestra el mensaje de error de
    T1.1 (`aria-describedby`); marcado, no bloquea; los dos enlaces del label tienen el `href` de
    `CONSENT_COPY.links[].href` (no un literal reconstruido).
  - **Verify**:
    ```bash
    pnpm --filter @dsm/web test -- --run src/features/checkout/ConsentCheckbox.test.tsx \
      && ! rg -q "'/legales/" apps/web/src/features/checkout/ConsentCheckbox.tsx \
      && echo OK
    ```
    (el guard de `routes.test.ts` de US-017 corre igual sobre este archivo nuevo por recorrer todo
    `apps/web/src` — no hace falta duplicar el chequeo, sólo no violarlo)

- [ ] T3.3 `OrderSummary.tsx` — ítems + total del carrito ya cargado, sin recalcular (AC-2)
  - **Pattern**: recibe el `Cart` de `useCartContext()` como prop; usa `formatArs` (el mismo
    helper de `lib/format/currency.ts` que usa `CartSummary`) — `per api-standards.md §5.5`, nunca
    aritmética propia sobre `unit_price_ars_cents`.
  - **Exit criterion**: renderiza cada línea `available` del carrito (nombre, cantidad, subtotal) y
    el `total_ars_cents` del carrito — **no** el que eventualmente devuelva el 201 (ese es post-
    submit, D8); una línea bloqueada no aparece acá (ya la filtró `CheckoutBlocked`, T3.4).
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/checkout/OrderSummary.test.tsx`

- [ ] T3.4 `CheckoutBlocked.tsx` — entrada bloqueada por carrito inválido (AC-5, mitad de entrada)
  - **Pattern**: componente puro; recibe `reason: 'empty' | 'not_purchasable'` y renderiza el
    mensaje + `<Link href="/carrito">` — mismo criterio que `CartEmptyState.tsx` (US-007 §10.1).
  - **Exit criterion**: `reason: 'empty'` y `reason: 'not_purchasable'` producen textos
    **distintos** (mismo criterio de distinguibilidad que `CartSummary`'s `MOTIVO_BLOQUEO`); el
    link vuelve a `/carrito`, donde ya se ve el detalle por línea (D5 — no se duplica acá).
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/checkout/CheckoutBlocked.test.tsx`

- [ ] T3.5 `CheckoutForm.tsx` — el formulario (AC-1, AC-3, AC-4)
  - **Pattern**: RHF + `checkoutResolver` (T1.2) + `Field`/`Input` existentes (`@/components/ui/Field`)
    — mismo patrón que `RegisterForm.tsx` (US-014), pero con el resolver custom de T1.2 en vez de
    `zodResolver` directo. `fulfillment` es un campo **oculto** con valor fijo `'pickup'`
    (`per design.md D6` — información fija, sin control elegible). Banner de error con
    `role="alert"` usando `checkoutCopy.ts` (T3.1) según `AppError.kind`/`problemType`
    (`per design.md D5`).
  - **Exit criterion**: los 3 campos del comprador con `aria-describedby` al error; el checkbox de
    consentimiento (T3.2) integrado; submit deshabilitado mientras `state.kind === 'submitting'`
    (`aria-busy`); un 422 del servidor con `errors: [{ field: 'buyer.email', message: '...' }]`
    marca **ese** campo vía `setError('buyer.email', ...)` (no un banner genérico que no señale
    dónde); un 409 muestra el banner de T3.1 según `problemType`, con link a `/carrito`; foco al
    primer campo con error tras un submit fallido.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/checkout/CheckoutForm.test.tsx`
    (casos: submit vacío → 3 errores inline + el del checkbox; 422 simulado con
    `field: 'buyer.email'` → `buyer.email` queda marcado y NINGÚN otro campo; 409
    `cart-not-purchasable` → banner + link a `/carrito`; 403 → banner "Recargá la página…"; éxito
    → se invoca el callback `onSuccess` con el `CheckoutCreated`)

- [ ] T3.6 `CheckoutConfirmation.tsx` — pantalla post-201, CTA deshabilitado (`Deferred: US-009`)
  - **Pattern**: muestra `order_number`, `total_ars_cents` (vía `formatArs`), `status`; llama a
    `saveOrderToken` (T2.3) al montar; CTA "Continuar al pago" **deshabilitado** con motivo visible
    — mismo patrón textual que `CartSummary`'s `MOTIVO_PENDIENTE` (`per design.md D8`).
    ```tsx
    /** `Deferred: US-009 — owner: FE`. Cuando exista la pantalla de pago, este
     * botón deja de estar disabled y navega/llama a POST /v1/payments. */
    ```
  - **Exit criterion**: heading propio (`<h1>` o `<h2>` consistente con la jerarquía de la página)
    para foco (D10); el CTA está `disabled` con el motivo en texto visible (no sólo un `title`);
    `saveOrderToken` se llama **una sola vez** por confirmación, no en cada render.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/checkout/CheckoutConfirmation.test.tsx`
    (renderiza con un `CheckoutCreated` de ejemplo: `order_number` y total visibles; CTA
    `toBeDisabled()`; `saveOrderToken` mockeado se llama 1 vez en `mount`, 0 veces en un re-render
    con las mismas props)

- [ ] T3.7 `CheckoutPage.tsx` — composición de los 3 estados de entrada (D4/D8, `frontend-standards.md §11.9`)
  - **Pattern**: lee `useCartContext()`; si `cart` está `idle`/`loading` → skeleton (mismo patrón
    que `CartPage.tsx`); si vacío o `has_blocking_issues` → `CheckoutBlocked` (T3.4); si no →
    `CheckoutForm` (T3.5) hasta `success`, entonces `CheckoutConfirmation` (T3.6) — **nunca** un
    `if (cart)` que cubra todos los casos a la vez.
  - **Exit criterion**: los 4 estados (loading / blocked / form / confirmación) son ramas
    explícitas y mutuamente excluyentes; al montar hace `reload()` del carrito (`per design.md
    OQ-FE-22`) igual que `CartPage`; emite `checkout_blocked`/`checkout_started` según corresponda
    (Fase 5).
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/checkout/CheckoutPage.test.tsx`
    (carrito vacío → `CheckoutBlocked`; `has_blocking_issues: true` → `CheckoutBlocked` con
    `reason: 'not_purchasable'`; carrito válido → `CheckoutForm`; tras un submit exitoso simulado →
    `CheckoutConfirmation` y el formulario deja de estar en el DOM)

- [ ] T3.8 `checkoutMetadata.ts` + `app/(storefront)/checkout/page.tsx` — la ruta
  - **Pattern**: mismo patrón que `cartMetadata.ts`/`carrito/page.tsx` — Server Component que sólo
    exporta `metadata` y compone la hoja cliente; `robots: { index: false, follow: true }`
    (`per frontend-next-standards.md §6` — un formulario con PII del comprador no es indexable).
  - **Exit criterion**: `/checkout` responde con `<meta name="robots" content="noindex,follow">`;
    el `page.tsx` no declara `'use client'`; no hay `loading.tsx` bajo `checkout/` (mismo motivo
    que `carrito/` — la boundary de Suspense compromete el 200 antes de tiempo, F59).
  - **Verify**:
    ```bash
    pnpm --filter @dsm/web test -- --run src/features/checkout/checkoutMetadata.test.ts \
      && test ! -e 'apps/web/app/(storefront)/checkout/loading.tsx' \
      && pnpm --filter @dsm/web typecheck
    ```

---

## Fase 4: Un-defer del CTA del carrito

- [ ] T4.1 `CartSummary.tsx` — quita `checkoutAvailable`/`MOTIVO_PENDIENTE`
  - **Pattern**: el CTA se habilita salvo `has_blocking_issues`; se borra el prop
    `checkoutAvailable`, la constante `MOTIVO_PENDIENTE` y el comentario `Deferred: US-008` — la
    excepción nombrada del "tests existentes sin editar" (`per design.md D9`, mismo criterio que
    `ProductPurchase.test.tsx` en US-007).
  - **Exit criterion**: sin `has_blocking_issues`, el CTA está habilitado **sin** necesitar ningún
    prop adicional; con `has_blocking_issues`, sigue deshabilitado con `MOTIVO_BLOQUEO` (sin
    cambios); `onCheckout` sigue siendo el único punto de entrada para la navegación (lo decide
    quien lo monta, T4.2).
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/cart/CartSummary.test.tsx`
    (reescribir los 3 casos que dependían de `checkoutAvailable`/`MOTIVO_PENDIENTE`: ahora "sin
    bloqueos, el CTA está habilitado" reemplaza al caso que probaba lo contrario)

- [ ] T4.2 `CartPage.tsx` — navega de verdad a `/checkout`
  - **Pattern**: `useRouter().push('/checkout')` en `onCheckout`, más `track('checkout_started')`
    (Fase 5) — `per` el precedente de `cambiarCantidad`/`quitar` en el mismo archivo, que ya
    envuelven la mutación con el evento correspondiente.
  - **Exit criterion**: click en "Ir al pago" (sin `has_blocking_issues`) navega a `/checkout` y
    emite `checkout_started` una sola vez por click (no en cada render).
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/cart/CartPage.test.tsx`
    (mock de `next/navigation` `useRouter`: click en el CTA → `router.push` llamado con
    `'/checkout'` exactamente una vez; `track` mockeado recibe `'checkout_started'`)

---

## Fase 5: Observabilidad

- [ ] T5.1 Cinco eventos de checkout en `BusinessEvent` + wiring
  - **Pattern**: extender la unión `BusinessEvent` y el `Set` `PUBLIC_EVENTS` (superficie de
    invitado, sin `operator_id`) — `per observability-patterns` §9.5.2 y el precedente exacto de
    los eventos de carrito en el mismo archivo. Sin PII, sin el `order_token` en ninguna prop
    (`per design.md D11`).
    ```ts
    | 'checkout_started'
    | 'checkout_blocked'
    | 'checkout_submitted'
    | 'checkout_succeeded'
    | 'checkout_failed';
    ```
  - **Exit criterion**: los 5 eventos tipan y están en `PUBLIC_EVENTS`; `checkout_blocked` lleva
    `reason`; `checkout_succeeded` lleva `order_number` (no PII); `checkout_failed` lleva
    `error_kind`; **ninguno** acepta `order_token`, email, nombre o teléfono como prop — un test
    de forma lo verifica igual que hace el archivo con los eventos de auth/carrito.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/lib/observability/events.test.ts`
    (extender el spec existente con los 5 eventos nuevos en `PUBLIC_EVENTS` — no se reescribe el
    archivo)

---

## Fase 6: Accesibilidad

- [ ] T6.1 axe sobre los 4 estados de `/checkout`
  - **Pattern**: `jest-axe`, mismo patrón que `cartA11y.test.tsx`/`legalA11y.test.tsx` — `per
    qa-frontend-standards.md §23.6` + `design-system.md §11`.
  - **Exit criterion**: cero violaciones de axe en `CheckoutBlocked`, `CheckoutForm` (con y sin
    errores visibles), y `CheckoutConfirmation`; un solo `<h1>` por render; los campos del
    formulario tienen nombre accesible distinto del label visual sólo cuando corresponde (no hay
    `aria-label` redundante sobre un `<label>` ya asociado).
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/checkout/checkoutA11y.test.tsx`

---

## Fase 7: E2E sobre la app construida

- [ ] T7.1 Extender `e2e/support/api-stub.mjs` con `POST /v1/checkout`
  - **Pattern**: mismo estilo que el bloque de carrito ya existente en el stub (cookies
    `dsm_cart`/`dsm_cart_csrf`, CSRF por comparación directa, `Cache-Control: no-store`) — `per`
    el bloque `/v1/cart` del propio archivo, sin reinventar el mecanismo de sesión.
    ```js
    if (req.method === 'POST' && path === '/v1/checkout') {
      // CSRF + cookie dsm_cart, mismo patrón que /v1/cart de arriba.
      // Carrito ausente o vacío → 409 dsm:checkout/cart-empty.
      // Body inválido (nombre/email/teléfono/consent/fulfillment) → 422.
      // Éxito → 201 { order_token, order_number, status: 'pending_payment',
      //               total_ars_cents, items_count }, Cache-Control: no-store.
    }
    ```
  - **Exit criterion**: el stub responde 201 para un carrito con ítems y un body válido; 409
    `dsm:checkout/cart-empty` sin carrito; 422 con `errors[]` para `consent: false` o email
    inválido; 403 sin `X-CSRF-Token` correcto — los cuatro casos que `CheckoutForm` (T3.5) mapea.
  - **Verify**: `node -e "require('apps/web/e2e/support/api-stub.mjs')" 2>&1 | grep -qv SyntaxError && echo OK`
    (smoke de sintaxis; el comportamiento real lo prueban T7.2/T7.3)

- [ ] T7.2 `e2e/checkout-topology.spec.ts` — el rewrite contra la app construida
  - **Pattern**: espejo exacto de `cart-topology.spec.ts` (US-007 T5.1) — `per
    playwright-stability` (selectores por rol, sin `waitForTimeout`) y `design.md` D2. Asserta
    sobre `response.status()` y `context.cookies()`, nunca sobre el DOM.
  - **Exit criterion**: un `POST /v1/checkout` disparado desde el origen del sitio devuelve un
    status coherente con el stub (201 o 409, según haya carrito) y **no** un 404 de rewrite
    ausente.
  - **Verify**: `pnpm --filter @dsm/web test:e2e e2e/checkout-topology.spec.ts`

- [ ] T7.3 `e2e/checkout-happy-path.spec.ts` — el flujo completo
  - **Pattern**: agregar un producto al carrito → `/carrito` → click "Ir al pago" → `/checkout` →
    completar el formulario → submit → confirmación visible con `order_number` — `per
    playwright-stability` (locators por rol/label, sin CSS frágil).
  - **Exit criterion**: el flujo completo llega a `CheckoutConfirmation` con el `order_number` del
    stub visible en el HTML; un segundo escenario con `consent` sin marcar **no** avanza (el
    submit no navega ni crea la orden — se queda en el formulario con el error visible).
  - **Verify**: `pnpm --filter @dsm/web test:e2e e2e/checkout-happy-path.spec.ts`

---

## Fase 8: Documentación

- [ ] T8.1 README: la ruta, el seam de US-017 y el `Deferred: US-009`
  - **Pattern**: extiende `## Mapa de rutas` con `/checkout`, agrega una sección hermana de las que
    ya documentan `/carrito` — `per documentation-standards.md §11.1`.
  - **Exit criterion**: documenta (a) que `/checkout` consume `LEGAL_ROUTES`/`CONSENT_COPY` y
    **nunca** debe hardcodear `/legales/*`, (b) dónde vive el `order_token` (`sessionStorage`,
    nunca la URL) y que `Deferred: US-009` lo consume, (c) que el rewrite de `next.config.mjs`
    ahora cubre tres superficies (auth, cart, checkout) y las tres rompen en producción sin
    `API_INTERNAL_ORIGIN`.
  - **Verify**:
    ```bash
    grep -q '/checkout' apps/web/README.md \
      && grep -q 'order_token' apps/web/README.md \
      && grep -q 'sessionStorage' apps/web/README.md \
      && grep -q 'CONSENT_COPY' apps/web/README.md \
      && echo OK
    ```

---

## Verification (suite-level)

- [ ] Type-check limpio: `pnpm --filter @dsm/web typecheck`
- [ ] Lint limpio: `pnpm --filter @dsm/web lint`
- [ ] Codegen sigue fresco (no diff): `pnpm --filter @dsm/web codegen && git diff --exit-code -- apps/web/src/api/generated`
- [ ] Suite unit + componente + a11y verde: `API_INTERNAL_ORIGIN=http://localhost:3000 pnpm --filter @dsm/web test`
- [ ] Build de producción verde: `API_INTERNAL_ORIGIN=http://localhost:3000 pnpm --filter @dsm/web build`
- [ ] E2E completa verde: `pnpm --filter @dsm/web test:e2e`
- [ ] **Sin regresión de US-007** (el carrito es el archivo que este change modifica más allá de su
      propio feature): `pnpm --filter @dsm/web test -- --run src/features/cart` y
      `pnpm --filter @dsm/web test:e2e e2e/cart-topology.spec.ts e2e/cart-persistence.spec.ts e2e/cart-noindex.spec.ts`
- [ ] **Sin regresión de US-017** (el guard de rutas legales corre sobre los archivos nuevos):
      `pnpm --filter @dsm/web test -- --run src/features/legal`
- [ ] **Sin regresión de US-014** (`csrf.ts`/`client.ts` no se tocan, pero su suite es la red de
      seguridad de cualquier cambio cerca de `session: 'cart'`):
      `pnpm --filter @dsm/web test -- --run src/lib/http`
- [ ] PR referencia el ticket US-008 y el path de este change (`openspec/changes/US-008-checkout-guest-frontend-web/`).
