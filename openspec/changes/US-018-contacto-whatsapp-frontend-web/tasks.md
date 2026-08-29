---
parent-us: US-018
discipline: frontend-web
variant: null
language: es
created: 2026-08-19
---

# US-018 Frontend Web — Tasks

> **Plan corto a propósito.** US-003 ya entregó el canal de WhatsApp de la ficha. Este plan
> **no lo re-construye**: lo audita (evidencia en `proposal.md` §"Lo que ya está construido"),
> lo preserva a través de un refactor y construye sólo el hueco — el header/footer que **no
> existen** y los guards que faltan.
>
> Cada task es closure-grade: atómica, con `Pattern:` (snippet mínimo + cita del estándar),
> `Exit criterion:` observable y `Verify:` con el comando exacto — **terminante** (F49:
> `vitest run` vía el script `test`, nunca watch; **macOS no tiene `timeout`**) y que
> **falla si el criterio no se cumple** (F50: se ejercita el comportamiento, no se greppea su
> presencia). Comandos desde la **raíz del repo**.
>
> **Estimación dual**: **~3.2 h AI-asistido / ~5.5 h tradicional** (horas por task =
> AI-asistido). El §7 de la US presupuesta **2-4 h tradicional**. **Se excede en ~1.5 h**, con
> causa: la US asumió "integración de un enlace simple", pero (1) AC-1 exige un **footer que
> no existe en absoluto** —no hay un solo `<footer>` en la app— y el design-system §7.10 lo
> define con contenido propio, y (2) AC-5 obliga a **extraer** la composición del enlace que
> US-003 dejó inline en la ficha, con el refactor y la re-verificación de superficie ya
> entregada que eso implica. En sentido contrario, **AC-2 y AC-3 no cuestan nada** porque ya
> están construidos — sin eso el plan rondaría las 8 h. Si OQ-FE-12 y OQ-FE-13 se ratifican
> como "(a) no hacer nada", caen T5.1 y T5.2 y el total baja a **~2.7 h / ~4.7 h**.

## Matriz de trazabilidad (AC → tasks)

| AC | Título | Task IDs | Estado |
|---|---|---|---|
| AC-1 | Enlace de WhatsApp accesible en header/footer | T1.1, T1.2, **T2.1**, **T2.2**, T3.2, T4.1 | **construido acá** |
| AC-2 | Consulta desde ficha sin stock con mensaje del producto | — (T1.3 sólo lo **preserva**) | ✅ **ya satisfecho por US-003** — `ProductPurchase.tsx:34-57`, 5 tests en `ProductPurchase.test.tsx`, axe en `a11y.test.tsx`, E2E en `pdp-ssr.spec.ts:37-50` |
| AC-3 | Apertura en escritorio (WhatsApp Web / app) | T1.1, T4.1 | ✅ **ya satisfecho** por la forma del enlace (`wa.me` redirige del lado del servicio) — acá se **verifica**, no se construye (`design.md` D4) |
| AC-4 | Sin backend y sin datos sensibles | **T3.1** | verdadero hoy, **probado acá** |
| AC-5 | Número/enlace de fuente única, sin duplicación | **T1.1**, **T1.3** | **medio satisfecho** (el número sí, en `env.ts`; la URL no) — completado acá |

**Cobertura no-AC del `design.md` (F51 — toda declaración tiene task o `Deferred:`)**:
D1 helper + componente → T1.1, T1.2 · D2 layout público / panel excluido → T2.1, T2.2, T4.1 ·
D3 Server Components sin JS de cliente → T2.1 · D4 AC-3 verificado → T1.1, T4.1 · D5 guard de
red → T3.1 · D6 encoding adversarial → T1.1 · D7 refactor con red → T1.3 · D8 sin
`loading.tsx` → Verification suite-level · D9 guard del placeholder → T5.1 · D10 telemetría →
T5.2 · D11 secuencia vs US-002 → P1 · a11y §11 → T3.2 · documentación → T6.1.

**Diferidos declarados**: links legales del footer → `Deferred: US-017` · horarios del local →
`Deferred: OQ-FE-14 (dueño)` · resto del top-nav (buscador/carrito/cuenta) →
`Deferred: US-004 / US-007 / US-014` · `TrustSignals` completo (pago seguro, mini-mapa,
retiro sin riesgo) → `Deferred: US-008 / US-009` · enganche del guard al pipeline de deploy →
`Deferred: US-019` · número real de WhatsApp → `Deferred: OQ-FE-3 (PO/cliente)` · metadata del
`app/layout.tsx` raíz ("Panel del dueño") → `Deferred:` deuda de US-001, ajena a esta US.

---

## Pre-requisitos

- [x] **P1 — BLOQUEANTE: US-002 FE cerrada y el working tree limpio** (`design.md` D11)

  Otra sesión ejecuta `/develop-frontend-web US-002` **en el mismo working tree** y toca dos
  archivos que esta US necesita (`app/(storefront)/layout.tsx`, `apps/web/README.md`) más el
  harness E2E. El modo de falla no es el merge conflict —eso Git lo grita— sino el silencioso:
  un `git add -A` de una sesión barre archivos sin commitear de la otra. **Ya pasó tres veces
  en este repo.**

  - **Exit criterion**: no queda ninguna task abierta en el `tasks.md` de US-002 FE **y**
    `git status --porcelain -- apps/web` no devuelve ninguna línea. Si cualquiera de las dos
    falla, `/develop-frontend-web` **para acá** y reporta — no negocia, no scopea parcial, no
    "coordina sobre la marcha".
  - **Verify**:
    ```bash
    test -z "$(git status --porcelain -- apps/web)" \
      && test -z "$(grep -c '^- \[ \] \*\*T' openspec/changes/US-002-storefront-navegacion-categorias-frontend-web/tasks.md | grep -v '^0$')" \
      && echo "OK — US-002 FE cerrada y apps/web sin cambios sin commitear"
    ```
    *(el grep apunta al `tasks.md` de **otro** change, nunca a los artefactos de este plan — F57)*
  - **Estado al cerrar el planning (2026-08-19, verificado con el comando de arriba)**: la
    condición **ya se cumple** — US-002 FE quedó sin ninguna task abierta y `apps/web` está
    limpio (`9da1e86`). La ventana de colisión se cerró **durante** esta sesión de planning:
    cuando empezó, `git status` mostraba `README.md`, `categorias/[slug]/page.tsx`,
    `CategoryEmptyState.tsx`, `CategoryPage.test.tsx` y `categoryA11y.test.tsx` sin commitear.
    **El gate se conserva igual y se corre de nuevo al empezar**: el árbol es compartido y hay
    otras dos sesiones activas (US-014 y US-006, ambas en `apps/api`); nada garantiza que siga
    limpio dentro de una hora. Un pre-requisito que se da por cumplido "porque lo estaba al
    planificar" es exactamente cómo se pierde trabajo.

- [x] **P2 — Suite verde antes de empezar** (`refactoring-discipline`: T1.3 es un refactor
  sobre superficie ya entregada; sin red previa no se refactoriza)
  - **Exit criterion**: unit/componente y build de producción pasan en el `HEAD` de partida.
  - **Verify**: `pnpm --filter @dsm/web test && pnpm --filter @dsm/web build`

- [x] **P3 — `design-system.md` en `Approved`** (gate de `fe-design-without-figma` §5: sin
  Figma, el design-system **es** la autoridad visual)
  - **Exit criterion**: el doc declara la aprobación de PO y Arquitecto.
  - **Verify**: `grep -q '^- \[x\] PO:' docs/product/design-system.md && grep -q '^- \[x\] Arquitecto:' docs/product/design-system.md && echo OK`

---

## Fase 1: Fuente única del enlace (AC-5, AC-3) — `design.md` D1, D4, D6, D7

- [x] **T1.1** `whatsapp.ts`: el único constructor del href `wa.me` + catálogo de mensajes (0.3 h)

  - **Pattern**: función pura, sin hook y sin estado — así la consume tanto un Server como un
    Client Component (`frontend-next-standards.md` §2). La env ya está tipada y validada con
    Zod (`frontend-next-standards.md` §8 — dato público, no secreto):
    ```ts
    // apps/web/src/features/contact/whatsapp.ts
    import { publicEnv } from '@/lib/env';

    /** Forma canónica de wa.me: sólo dígitos, sin `+` ni separadores.
     *  `api.whatsapp.com/send?phone=` NO es equivalente: wa.me es el que
     *  resuelve el desvío a app móvil / WhatsApp Web / app de escritorio (AC-3). */
    export function whatsappHref(message?: string): string {
      const base = `https://wa.me/${publicEnv.NEXT_PUBLIC_WHATSAPP_PHONE}`;
      // encodeURIComponent SIEMPRE: en ferretería los nombres reales llevan
      // `"` y `&` (`Caño 1/2" & codo #3`) — sin codificar, el `&` inyecta un
      // parámetro de query en la URL de un tercero y el `#` trunca el mensaje.
      return message ? `${base}?text=${encodeURIComponent(message)}` : base;
    }

    export const WHATSAPP_MESSAGES = {
      general: '¡Hola! Quería hacer una consulta.',
      /** Literal idéntico al que US-003 ya usa: el refactor de T1.3 no cambia
       *  nada observable y los tests de la ficha deben pasar sin tocarse. */
      product: (name: string) => `Hola! Quería consultar por "${name}".`,
    } as const;
    ```
    — per `frontend-standards.md` §2.1 (package-by-feature) + `base-standards.md` §1 (KISS:
    el enlace estándar, nada de device detection).
  - **Exit criterion**: `whatsappHref()` devuelve `https://wa.me/{el valor de la env}` sin
    query; con mensaje agrega **exactamente un** parámetro `text` codificado; un nombre con
    `"`, `&` y `#` sobrevive el round-trip `decodeURIComponent` intacto; cambiar la env cambia
    el href (no hay número hardcodeado).
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/contact/whatsapp.test.ts`
    ```ts
    // los 4 asserts que hacen fallar el criterio si no se cumple:
    expect(whatsappHref()).toBe(`https://wa.me/${publicEnv.NEXT_PUBLIC_WHATSAPP_PHONE}`);
    const url = new URL(whatsappHref('Caño 1/2" & codo #3'));
    expect([...url.searchParams.keys()]).toEqual(['text']);          // un solo param
    expect(url.searchParams.get('text')).toBe('Caño 1/2" & codo #3'); // round-trip
    expect(whatsappHref()).not.toMatch(/api\.whatsapp\.com/);         // forma canónica (AC-3)
    ```

- [x] **T1.2** `WhatsAppLink`: la pieza compartida, Server Component (0.3 h)

  - **Pattern**: presentacional puro; **no compone la URL** (la pide a T1.1). Reproduce la
    forma que US-003 ya validó con axe en browser real:
    ```tsx
    // apps/web/src/features/contact/WhatsAppLink.tsx  — SIN "use client" (design.md D3)
    import { MessageCircle } from 'lucide-react';
    import { cn } from '@/lib/cn';
    import { whatsappHref } from './whatsapp';

    export function WhatsAppLink({ label, message, variant = 'accent', className }: {
      label: string;              // obligatorio: ES el nombre accesible
      message?: string;
      variant?: 'accent' | 'ghost';
      className?: string;
    }) {
      return (
        <a
          href={whatsappHref(message)}
          target="_blank"
          rel="noopener noreferrer"   // sin esto, la pestaña destino accede a window.opener
          className={cn(
            'inline-flex min-h-[44px] w-fit items-center justify-center gap-2 rounded-md',
            'px-4 text-sm font-medium focus:outline-none focus-visible:shadow-focus',
            variant === 'accent' ? 'bg-accent-strong text-white' : 'text-foreground hover:bg-gray-100',
            className,
          )}
        >
          {/* Ícono + texto, NUNCA sólo ícono (design-system §7.14). */}
          <MessageCircle className="h-4 w-4" aria-hidden="true" />
          {label}
        </a>
      );
    }
    ```
    — per `design-system.md` §7.14 + §8 (Lucide `message-circle`) + §11 (≥44px, focus ring
    `shadow-focus`); `frontend-next-standards.md` §2 (Server Component por defecto).
  - **Exit criterion**: el enlace expone `label` como **nombre accesible** (el ícono va
    `aria-hidden` y no aporta nombre), lleva `target="_blank"` con `rel` que contiene
    `noopener` **y** `noreferrer`, su `href` es el que devuelve `whatsappHref(message)`, y
    con `message` el href difiere del href sin mensaje.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/contact/WhatsAppLink.test.tsx`
    ```tsx
    render(<WhatsAppLink label="Hablá con nosotros" message="hola" />);
    const link = screen.getByRole('link', { name: 'Hablá con nosotros' }); // nombre exacto:
    // si el ícono aportara nombre accesible, este matcher exacto falla
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toMatch(/noopener/);
    expect(link.getAttribute('rel')).toMatch(/noreferrer/);
    expect(link).toHaveAttribute('href', whatsappHref('hola'));
    ```

- [x] **T1.3** `ProductPurchase` consume la pieza compartida — refactor sin cambio observable (0.2 h)

  - **Pattern**: **Extract + Move** de Fowler (`refactoring-discipline`). Sale el bloque que
    arma `message`/`href` y el `<a>` inline; entra el componente. **No se toca nada más**:
    ```tsx
    // apps/web/src/features/storefront/ProductPurchase.tsx  (sigue siendo 'use client')
    -   const message = `Hola! Quería consultar por "${productName}".`;
    -   const href = `https://wa.me/${publicEnv.NEXT_PUBLIC_WHATSAPP_PHONE}?text=${encodeURIComponent(message)}`;
    ...
    -   <a href={href} target="_blank" rel="noopener noreferrer" className="…">
    -     <MessageCircle className="h-4 w-4" aria-hidden="true" />
    -     Avisame por WhatsApp
    -   </a>
    +   <WhatsAppLink label="Avisame por WhatsApp" message={WHATSAPP_MESSAGES.product(productName)} />
    ```
    **Se conservan intactos** el badge `text-gray-600` sobre `bg-gray-100` **y su comentario**:
    documenta un hallazgo medido (el `-500` daba 4.39:1 y WCAG AA exige 4.5:1; lo detectó axe
    en browser real porque jsdom no mide contraste). Es el "por qué", no el "qué" —
    `refactoring-discipline` §revisión, check 4: los comentarios de por-qué no se borran.
  - **Exit criterion**: los **6 tests de US-003 que cubren la ficha** (`ProductPurchase.test.tsx`
    ×5 + el de nombre accesible en `a11y.test.tsx`) pasan **sin haber sido modificados** —
    ése es el criterio de que fue un refactor y no un cambio de comportamiento. Además, tras
    esta task **ningún archivo fuera de `whatsapp.ts`** construye la URL `https://wa.me/`
    (cierre de AC-5).
  - **Verify**:
    ```bash
    pnpm --filter @dsm/web test -- --run src/features/storefront/ProductPurchase.test.tsx src/features/storefront/a11y.test.tsx \
      && test -z "$(git diff --name-only -- apps/web/src/features/storefront/ProductPurchase.test.tsx apps/web/src/features/storefront/a11y.test.tsx)" \
      && test -z "$(grep -rl 'https://wa\.me' apps/web/src apps/web/app | grep -Ev '\.test\.(ts|tsx)$|features/contact/whatsapp\.ts$')" \
      && echo "OK — refactor sin cambio observable + AC-5 (fuente única)"
    ```
    > El patrón buscado es el **literal de la URL** (`https://wa.me`), no el token suelto
    > `wa.me`: `src/lib/env.ts` lo menciona en un comentario ("lo que espera `wa.me`") y un
    > grep más laxo daría rojo para siempre por un comentario correcto. Dry-run en planning:
    > hoy el grep devuelve exactamente `ProductPurchase.tsx`; tras T1.3 debe devolver vacío —
    > o sea, **el check falla hoy y pasa sólo cuando el refactor está hecho** (F50).
    *(el `git diff` vacío prueba que la red de seguridad no se aflojó para hacer pasar el
    refactor; el grep recorre sólo `apps/web`, nunca los artefactos de este plan — F57)*

---

## Fase 2: El enlace en toda página pública (AC-1) — `design.md` D2, D3

- [x] **T2.1** `SiteFooter` + montaje en el layout `(storefront)` (0.5 h)

  - **Pattern**: el sitio **no tiene footer**; éste es el primero. Server Component, montado
    en el layout del route group para que aparezca en toda página pública **sin tocar ninguna
    página**:
    ```tsx
    // apps/web/src/features/contact/SiteFooter.tsx  — SIN "use client"
    export function SiteFooter() {
      return (
        <footer className="mt-12 border-t border-border">{/* <footer> nativo ⇒ landmark contentinfo */}
          <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4 text-sm text-muted md:flex-row md:items-center md:justify-between">
            <div>
              <p className="font-medium text-foreground">DSM Refrigeración y Ferretería</p>
              <p>Av. Córdoba y Av. Pueyrredón, CABA</p>
              {/* Deferred: US-017 — privacidad y términos. Un link legal a `#` en
                  producción es PEOR que no tenerlo (PRD §246, Ley 25.326). */}
              {/* Deferred: OQ-FE-14 — horarios reales (dato del dueño). */}
            </div>
            <WhatsAppLink variant="accent" label="Hablá con nosotros"
                          message={WHATSAPP_MESSAGES.general} />
          </div>
        </footer>
      );
    }
    ```
    ```tsx
    // apps/web/app/(storefront)/layout.tsx — el footer cierra el flex column existente.
    // ⚠ NO agregar loading.tsx en ningún nivel de (storefront): la boundary de Suspense
    //   compromete el status 200 y mata el 404 real (US-003 design.md D1.bis / F59).
        <main className="flex-1">{children}</main>
    +   <SiteFooter />
      </div>
    ```
    — per `design-system.md` §7.10 (footer: datos del local + WhatsApp) y §7.14 (copy "Hablá
    con nosotros"); `frontend-next-standards.md` §1 (layout por route group) + §2.
  - **Exit criterion**: renderizar `StorefrontLayout` con un hijo cualquiera produce un
    landmark `contentinfo` que contiene el enlace de WhatsApp con su nombre accesible y el
    href de `whatsappHref(WHATSAPP_MESSAGES.general)` — es decir, **toda** página del route
    group lo lleva sin que la página haga nada. Ni `SiteFooter.tsx` ni `WhatsAppLink.tsx`
    llevan `"use client"` (D3: cero JS de cliente en las páginas públicas).
  - **Verify**:
    ```bash
    pnpm --filter @dsm/web test -- --run src/features/contact/SiteFooter.test.tsx \
      && test -z "$(grep -rlE "^[[:space:]]*['\"]use client['\"]" apps/web/src/features/contact)" \
      && echo "OK — footer en el layout y sin JS de cliente"
    ```
    > **Afinado durante la ejecución (2026-08-22)**: el grep buscaba la cadena suelta
    > `use client` y daba rojo por un **comentario correcto** — el JSDoc de `WhatsAppLink`
    > explica precisamente que el archivo NO lleva la directiva (para servir como Server
    > Component en el footer y como cliente en la ficha). Ahora se busca la **directiva**
    > anclada a inicio de línea, que es el criterio real. Mismo defecto que el plan ya había
    > corregido en T1.3 con el literal `https://wa.me`.

    ```tsx
    // SiteFooter.test.tsx — se ejercita el LAYOUT, no sólo el componente suelto:
    // así el test falla si alguien construye el footer pero no lo monta.
    vi.mock('@/features/storefront/CategoryNav', () => ({ CategoryNav: () => null }));
    const { default: StorefrontLayout } = await import('@/app/(storefront)/layout');
    render(StorefrontLayout({ children: <p>contenido</p> }));
    const footer = screen.getByRole('contentinfo');
    const link = within(footer).getByRole('link', { name: 'Hablá con nosotros' });
    expect(link).toHaveAttribute('href', whatsappHref(WHATSAPP_MESSAGES.general));
    ```

- [x] **T2.2** Enlace de WhatsApp en el header del storefront (0.2 h)

  - **Pattern**: mismo componente, variante discreta, junto al wordmark (`design-system.md`
    §7.10: el top-nav lleva el enlace de WhatsApp). El resto del top-nav —buscador, carrito,
    cuenta— sigue `Deferred: US-004 / US-007 / US-014`:
    ```tsx
    // apps/web/app/(storefront)/layout.tsx
      <div className="mx-auto flex max-w-5xl items-center justify-between p-4">
        <Link href="/" …>DSM …</Link>
    +   <WhatsAppLink variant="ghost" label="WhatsApp" message={WHATSAPP_MESSAGES.general} />
      </div>
    ```
  - **Exit criterion**: el header del layout expone un enlace con nombre accesible `WhatsApp`
    y el mismo href genérico, **distinguible** del enlace del footer (nombres accesibles
    distintos ⇒ un lector de pantalla que liste enlaces no muestra dos entradas idénticas).
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/contact/SiteFooter.test.tsx`
    ```tsx
    // mismo archivo (ejercita el layout completo), caso adicional:
    render(StorefrontLayout({ children: <p>contenido</p> }));
    expect(within(screen.getByRole('banner')).getByRole('link', { name: 'WhatsApp' }))
      .toHaveAttribute('href', whatsappHref(WHATSAPP_MESSAGES.general));
    expect(screen.getAllByRole('link', { name: /WhatsApp|Hablá con nosotros/ })).toHaveLength(2);
    ```

---

## Fase 3: Guards y accesibilidad (AC-4) — `design.md` D5

- [x] **T3.1** Guard AC-4: cero red y cero datos sensibles (0.3 h)

  - **Pattern**: el criterio de AC-4 es **comportamental**, así que se prueba con un espía
    sobre `globalThis.fetch` — **por debajo** de `customFetch`, el único choke point de red
    del repo (F48). Un `grep` de `fetch` no serviría: pasaría en verde si alguien importara
    un servicio que internamente llama a `customFetch`, que es exactamente cómo se rompería:
    ```tsx
    // apps/web/src/features/contact/noBackend.test.tsx
    it('el contacto no toca la red en ninguna de sus tres superficies', () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      render(StorefrontLayout({ children: <p>x</p> }));                       // header + footer
      render(<ProductPurchase inStock={false} productName="Heladera exhibidora" />); // ficha
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('no filtra datos sensibles en el mensaje ni en la URL', () => {
      const url = new URL(whatsappHref(WHATSAPP_MESSAGES.product('Heladera exhibidora')));
      expect([...url.searchParams.keys()]).toEqual(['text']);  // sólo `text`, nada más
      const text = url.searchParams.get('text') ?? '';
      // fallaría el día que alguien "mejore" el prellenado con el carrito o el email:
      for (const leak of ['1250000', 'REF-001', '@', 'token', 'email', 'precio'])
        expect(text.toLowerCase()).not.toContain(leak.toLowerCase());
    });
    ```
    — per `frontend-standards.md` §12.3 (nada sensible viaja al cliente) + US §9 (sin backend
    ni datos sensibles).
  - **Exit criterion**: el test **falla** si el contacto se enruta por la API (por `fetch`
    directo, por servicio, por cliente generado o por Server Action) y **falla** si el mensaje
    o la URL ganan precio, SKU, email, token o cualquier parámetro además de `text`.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/contact/noBackend.test.tsx`

- [x] **T3.2** Accesibilidad: axe sobre header y footer (0.3 h)

  - **Pattern**: mismo patrón que `a11y.test.tsx` de US-003 (`qa-frontend-standards.md` §23.6):
    ```tsx
    // apps/web/src/features/contact/contactA11y.test.tsx
    expect.extend(toHaveNoViolations);
    it('header + footer: axe sin violaciones', async () => {
      const { container } = render(StorefrontLayout({ children: <p>contenido</p> }));
      expect(await axe(container)).toHaveNoViolations();
    });
    it('los enlaces cumplen el área táctil de 44px', () => { /* min-h-[44px] presente */ });
    ```
    > **Límite conocido, aprendido en US-003**: jsdom **no calcula contraste** — el fallo
    > `text-gray-500` 4.39:1 lo encontró axe en **browser real**, no este test. Este axe cubre
    > nombres accesibles, landmarks y roles; el contraste de los tokens `accent-strong`/blanco
    > ya está verificado en `design-system.md` §2.4 y la verificación en browser pertenece a QA.
  - **Exit criterion**: axe no reporta violaciones sobre el árbol del layout (header + footer),
    cada enlace tiene nombre accesible propio y área táctil ≥44px.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/contact/contactA11y.test.tsx`

---

## Fase 4: E2E — el enlace en el HTML servido (AC-1, AC-3) — `design.md` D2, D4

- [x] **T4.1** E2E: enlace en toda página pública, ausente en el panel (0.4 h)

  - **Pattern**: asserts contra el **body de la respuesta HTTP**, no contra el DOM hidratado
    (mismo criterio que `pdp-ssr.spec.ts`), y el status contra `response.status()`, nunca
    contra el DOM. Auto-waiting de Playwright; **cero `waitForTimeout`**
    (`playwright-stability`):
    ```ts
    // apps/web/e2e/site-contact.spec.ts
    for (const path of ['/', '/categorias/refrigeracion']) {
      test(`${path} sirve el enlace de WhatsApp en header y footer (AC-1)`, async ({ page }) => {
        const res = await page.goto(path);
        expect(res!.status()).toBe(200);
        const html = await res!.text();
        // forma canónica: wa.me + sólo dígitos ⇒ es lo que hace funcionar el
        // desvío a WhatsApp Web / app de escritorio (AC-3, design.md D4)
        expect(html).toMatch(/https:\/\/wa\.me\/\d{8,15}/);
        expect(html).toContain('Hablá con nosotros');   // footer
        expect(html).toContain('rel="noopener noreferrer"');
      });
    }

    test('el panel del dueño NO ofrece el canal de atención (ADR-0010, design.md D2)', async ({ page }) => {
      const res = await page.goto('/admin/acceso');
      expect(res!.status()).toBe(200);
      expect(await res!.text()).not.toContain('wa.me');
    });
    ```
    > **No se navega a WhatsApp**: es un servicio de terceros; el límite del sistema es el
    > `<a href>` correcto en el HTML servido.
  - **Exit criterion**: la home y una página de rubro devuelven **200** y su HTML **servido**
    (sin hidratación) contiene el href canónico `https://wa.me/<dígitos>`, el copy del footer y
    el `rel` seguro; `/admin/acceso` devuelve 200 y **no** contiene `wa.me`.
  - **Verify**: `pnpm --filter @dsm/web test:e2e e2e/site-contact.spec.ts`
    *(el `webServer` de Playwright ya corre `pnpm build && pnpm start` con `E2E_PORT` por
    defecto 3210 — 3100 es el puerto de Grafana Loki y colisiona)*

---

## Fase 5: Gates de despliegue y telemetría (**gated** — requieren ratificación)

- [x] **T5.1** Guard del número placeholder — `Gated: OQ-FE-12 (recomendación: opción c)` (0.3 h)

  - **Pattern**: gate **fuera** del build. Un guard dentro de `env.ts` mataría la suite E2E,
    porque el `webServer` de Playwright corre un build de producción real sin esa env:
    ```js
    // apps/web/scripts/check-whatsapp-configured.mjs
    const PLACEHOLDER = '5491100000000';
    const phone = process.env.NEXT_PUBLIC_WHATSAPP_PHONE;
    if (!phone || phone === PLACEHOLDER) {
      console.error(
        'NEXT_PUBLIC_WHATSAPP_PHONE ausente o con el placeholder de fábrica.\n' +
        'Publicar así ofrece un canal de contacto que no existe: el visitante escribe y\n' +
        'nadie contesta — peor que no ofrecerlo (OQ-FE-3, owner PO/cliente).',
      );
      process.exit(1);
    }
    console.log('OK — WhatsApp configurado.');
    ```
    — per `frontend-next-standards.md` §8 (validar env; el número es público, no secreto).
  - **Exit criterion**: el script sale **1** con la env ausente y **1** con el placeholder;
    sale **0** con un número real. El enganche al job de deploy queda `Deferred: US-019`
    (infra es dueña del pipeline) — declarado, no silencioso.
  - **Verify**:
    ```bash
    ( NEXT_PUBLIC_WHATSAPP_PHONE=5491100000000 node apps/web/scripts/check-whatsapp-configured.mjs; test $? -eq 1 ) \
      && ( unset NEXT_PUBLIC_WHATSAPP_PHONE; node apps/web/scripts/check-whatsapp-configured.mjs; test $? -eq 1 ) \
      && ( NEXT_PUBLIC_WHATSAPP_PHONE=5491122334455 node apps/web/scripts/check-whatsapp-configured.mjs ) \
      && echo "OK — el guard bloquea el placeholder y deja pasar el número real"
    ```
    *(se ejecuta el script en los tres escenarios y se asserta el exit code — no se greppea
    su contenido: F50)*

- [x] **T5.2** Evento `whatsapp_click` en la ficha sin stock — `Gated: OQ-FE-13 (recomendación: opción c)` (0.2 h)

  - **Pattern**: sólo en `ProductPurchase`, que **ya es** `'use client'` ⇒ costo marginal en
    bytes **cero**. El registro en `PUBLIC_EVENTS` es la parte que importa:
    ```ts
    // apps/web/src/lib/observability/events.ts
      | 'category_shown'
    + // Storefront público: salida hacia el canal humano desde una ficha sin
    + // stock. Mide demanda perdida por falta de stock (capacidad 12 es Should:
    + // sin este dato no hay con qué decidir el chatbot del roadmap).
    + | 'whatsapp_click';
      const PUBLIC_EVENTS = new Set<BusinessEvent>([
    -   'pdp_shown', 'category_shown',
    +   'pdp_shown', 'category_shown', 'whatsapp_click',
      ]);
    ```
    ```tsx
    <WhatsAppLink … onClick={() => track('whatsapp_click', { context: 'pdp_out_of_stock', product_slug: slug })} />
    ```
    — per `observability-patterns` §9.5.2 (evento por acción con dimensiones acotadas) + §8
    (sin PII: nunca el mensaje, ni el número, ni nada del visitante).
  - **Exit criterion**: al activar el enlace de la ficha sin stock se emite `whatsapp_click`
    con `context` y `product_slug` y **sin** `operator_id` — un evento de visitante anónimo
    etiquetado como acción del dueño ensuciaría las métricas de US-016 igual que habría pasado
    con `pdp_shown`.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/lib/observability/events.test.ts src/features/storefront/ProductPurchase.test.tsx`
    ```ts
    const sink = vi.fn(); setEventSink(sink);
    track('whatsapp_click', { context: 'pdp_out_of_stock' });
    expect(sink).toHaveBeenCalledWith('whatsapp_click',
      expect.not.objectContaining({ operator_id: expect.anything() }));
    ```
  - Si OQ-FE-13 se ratifica como **(a) sin evento**, esta task se **elimina** y la matriz de
    trazabilidad se actualiza en el mismo commit — no queda como deuda muda.

---

## Fase 6: Documentación

- [x] **T6.1** README del canal de contacto (0.2 h)

  - **Pattern**: `apps/web/README.md` ya documenta `NEXT_PUBLIC_WHATSAPP_PHONE`. Se agrega el
    mapa de **dónde vive el canal ahora** y el bloqueo de despliegue:
    ```md
    ### Canal de contacto (WhatsApp — US-018)
    - Fuente única del enlace: `src/features/contact/whatsapp.ts`. **Ningún otro archivo
      compone una URL `wa.me`** (AC-5); si necesitás uno nuevo, usá `whatsappHref()`.
    - Superficies: header y footer del storefront (`app/(storefront)/layout.tsx`) y ficha sin
      stock. El **panel `/admin/*` no lo lleva** a propósito (ADR-0010, design.md D2).
    - Sin backend: el contacto no hace ni una llamada de red (AC-4, guard en `noBackend.test.tsx`).
    - ⚠ **Bloqueo de despliegue**: el default `5491100000000` es un placeholder (OQ-FE-3).
      No publicar sin el número real — ver `scripts/check-whatsapp-configured.mjs`.
    ```
    — per `documentation-standards.md` §11.1 (README cuando cambia config/superficie).
  - **Exit criterion**: el README explica la fuente única, las superficies (incluida la
    exclusión del panel) y el bloqueo de despliegue; **no se agrega ninguna env nueva**
    (`.env.example` ya la tiene y no cambia).
  - **Verify**:
    ```bash
    grep -q 'features/contact/whatsapp.ts' apps/web/README.md \
      && grep -q 'check-whatsapp-configured' apps/web/README.md \
      && test -z "$(git diff --name-only -- apps/web/.env.example)" \
      && echo "OK — README actualizado y sin envs nuevas"
    ```
  - **No se requiere ADR** (`documentation-standards.md` §8.1): no hay decisión arquitectónica
    nueva — el namespace de rutas ya lo fijó ADR-0010 y la organización interna de una feature
    es reversible en minutos (`base-standards.md` §1).

---

## Verification (suite-level)

- [x] Unit + componente verdes: `pnpm --filter @dsm/web test`
- [x] Lint limpio: `pnpm --filter @dsm/web lint`
- [x] Typecheck limpio: `pnpm --filter @dsm/web typecheck`
- [x] Build de producción OK: `API_INTERNAL_ORIGIN=http://localhost:3000 pnpm --filter @dsm/web build`
  *(la env la exige el guard que introdujo US-014 FE; sin ella el build falla — ver el hallazgo
  reportado sobre el workflow de CI, que no la define)*
- [x] E2E verde (specs de US-001/002/003 + el nuevo): `pnpm --filter @dsm/web test:e2e`
- [x] **AC-5 — fuente única**: ningún archivo fuera de `whatsapp.ts` (ni de los tests) construye `https://wa.me/`
  ```bash
  test -z "$(grep -rl 'https://wa\.me' apps/web/src apps/web/app | grep -Ev '\.test\.(ts|tsx)$|features/contact/whatsapp\.ts$')" && echo OK
  ```
- [x] **Sin `loading.tsx` en `(storefront)`** (US-003 D1.bis / F59 — una boundary de Suspense
  compromete el 200 y mata el 404 real). El `(admin)` **sí** tiene el suyo y debe conservarlo:
  ```bash
  test -z "$(find 'apps/web/app/(storefront)' -name loading.tsx)" && test -f 'apps/web/app/(admin)/loading.tsx' && echo OK
  ```
- [x] **AC-4 — sin red nueva**: el único `fetch` de la app sigue siendo `customFetch` (F48)
  ```bash
  test -z "$(grep -rln 'fetch(' apps/web/src apps/web/app | grep -Ev '\.test\.(ts|tsx)$|lib/http/client\.ts$')" && echo OK
  ```
- [x] Codegen del contrato sin cambios (este change no toca la API):
  `test -z "$(git diff --name-only -- apps/web/src/api/generated)" && echo OK`
- [x] `dangerouslySetInnerHTML` sólo para JSON-LD (`security-standards` §6 / `frontend-standards` §12.1) — sin usos nuevos
- [x] Reconciliación contra el `design.md` completo (F51): D1–D11 construidas o con `Deferred:` declarado
- [x] Índice actualizado: `docs/_index/openspec-changes.yaml` refleja `status` y `estimate-hours`
- [x] PR describe el ticket US-018 y apunta a `openspec/changes/US-018-contacto-whatsapp-frontend-web/`
  (rama y commits per `git-workflow-standards.md`; este repo integra por
  `feature-entrega2-GOSP`, así que `branch` queda `null` hasta que exista el PR — F42/F45)
</content>
