---
parent-us: US-017
discipline: frontend-web
variant: null
language: es
created: 2026-08-22
---

# US-017 Frontend Web — Tasks

> Cada task es closure-grade: atómica, con `Pattern:` (snippet mínimo + cita del estándar),
> `Exit criterion:` observable y `Verify:` con el comando exacto — **terminante** (F49: `vitest
> run` vía el script `test`, nunca watch; **macOS no tiene `timeout`**: si hace falta acotar,
> `perl -e 'alarm N; exec @ARGV' -- <cmd>`) y que **falla si el criterio no se cumple** (F50: se
> ejercita el comportamiento, no se greppea su presencia). Comandos desde la **raíz del repo**.
>
> **Estimación dual**: **~3,9 h AI-asistido / ~6,5 h tradicional** (12 tasks + 4 pre-requisitos;
> las horas por task son AI-asistido, ~0,32 h/task — la misma densidad que el plan de US-018,
> 11 tasks en 3,2 h). La US §7 presupuesta `FE-US-017` en **4-6 h tradicional**: **se excede en
> ~0,5-2,5 h**, con causa. Lo que la US presupuestó —«páginas SSR de privacidad y términos +
> enlaces en el footer»— son ~2 h de las 3,9: el footer ya existe (US-018 dejó el hueco
> marcado) y no hay consumo de API ni estados asíncronos que modelar. Lo que **no** presupuestó
> y sí cuesta es lo que convierte los AC de «verdad declarada» en «propiedad verificada»: el
> **chequeo de deriva de la versión contra el backend** (AC-8 es una igualdad entre dos
> sistemas, no un campo), el **guard de no-dependencia y no-tracking** (AC-7 + US §9) y la
> **fuente única de rutas** que el checkout de US-008 va a consumir.
>
> **Decisiones del PO ratificadas el 2026-08-22** (ver `proposal.md` §Preguntas abiertas):
> OQ-FE-15 **(a)** rutas bajo `/legales/` · OQ-FE-16 **(b)** chequeo de deriva de la versión ·
> OQ-FE-17 **(a)** sin gate automático del texto provisional. Consecuencia de la tercera: **cae
> la task del gate de despliegue** (era T4.1, −0,3 h) y con ella el campo `status` del módulo de
> contenido —sin lector, sería dato muerto (`AGENTS.md` §1.2)—. La protección contra publicar el
> texto provisional queda **humana**: el DoD de la US ya la lista («texto legal final provisto y
> revisado por el dueño / asesoría legal — gate de producción») y los marcadores `[PENDIENTE: …]`
> quedan **visibles en la página**, así que cualquiera que la abra ve que está incompleta.

## Matriz de trazabilidad (AC → tasks)

| AC | Título | Task IDs | Estado |
|---|---|---|---|
| AC-1 | Página de privacidad pública e indexable | T0.1, T1.1, T1.2, **T2.1**, T2.2, T5.1 | **construido acá** |
| AC-2 | Página de términos pública e indexable | T0.1, T1.1, T1.2, **T2.1**, T2.2, T5.1 | **construido acá** |
| AC-3 | Enlaces desde el footer | T0.2, **T3.1**, T5.1 | **construido acá** (el footer existe: US-018) |
| AC-4 | Enlace + consentimiento desde el checkout | **T0.2** (seam: `LEGAL_ROUTES` + `CONSENT_COPY`), T6.1 | **seam acá**; el checkbox y la captura son de `Deferred: US-008` |
| AC-5 | Contenido acorde a la Ley 25.326 | **T0.1** (estructura + schema Zod que exige los 4 bloques) | **mecanismo acá**; texto final `Deferred: PO/cliente` |
| AC-6 | No se opera sin las páginas | **T4.2** (guard sin backend), **T5.1** (e2e: existen, 200, enlazadas) | **construido acá** por construcción: las páginas son reales y enlazadas. Que el **texto** no sea el provisional es gate **humano** del DoD (OQ-FE-17 (a)) |
| AC-7 | Páginas públicas sin login | T2.1, **T5.1** (e2e sin cookies), T4.2 | **construido acá** |
| AC-8 | Trazabilidad de la versión aceptada | **T0.1** (versión publicada), **T4.3** (test de deriva vs backend) | **mitad FE acá**; el registro por orden es de `Deferred: US-008` |

**Cobertura no-AC del `design.md` (F51 — toda declaración tiene task o `Deferred:`)**:
D1 contenido como módulo tipado, sin `dangerouslySetInnerHTML` → T0.1, T1.1 ·
D2 dos rutas explícitas bajo `/legales/` (OQ-FE-15 (a)) → T2.1 (disparador de refactor
documentado, sin task) ·
D3 fuente única de rutas con tres consumidores → T0.2, T3.1, T6.1 ·
D4 Server Components puros, sin fetch y **sin telemetría** → T2.1, **T4.2** ·
D5 versión en el código y no en env, verificada contra el backend (OQ-FE-16 (b)) → T0.1, T4.3 ·
jerarquía de headings + ancho de lectura sin plugin `prose` → T1.1, T3.2 ·
metadata con canonical absoluta, sin JSON-LD → T1.2 ·
sitemap que sobrevive la degradación del árbol → T2.2 ·
recomendación de despliegue → T6.1 + `/plan-deployment`.

**Diferidos y descartados declarados**: texto legal definitivo → `Deferred: PO/asesoría legal —
gate de producción (DoD de la US)` · **gate automático del texto provisional → DESCARTADO por
decisión del PO (OQ-FE-17 (a))**: no se construye `check-legal-content.mjs` ni el campo `status`;
la protección es el DoD + los marcadores `[PENDIENTE: …]` visibles en la página, y el checklist de
despliegue de `Deferred: US-019` · checkbox de consentimiento y su captura → `Deferred: US-008
(FE+BE)` · igualdad de la versión en el entorno de producción (Railway) → `Deferred: US-019` ·
horarios del local en el footer → `Deferred: OQ-FE-14 (dueño)` · tercer documento legal →
`Deferred: sin AC que lo pida` · banner de cookies → `Deferred: fuera de v1 (US §4)` ·
`BE-US-017` → `Deferred: OQ-FE-18 (Arquitecto) — probablemente absorbida por US-008`.

---

## Pre-requisitos

- [x] **P1 — BLOQUEANTE: `apps/web` sin cambios sin commitear** *(verde 2026-08-22)* (`design.md` §Riesgos)

  Hay **otras sesiones activas en el mismo working tree** (al planificar: US-006 y US-005 en
  `apps/api`, US-014 en `apps/web`). El modo de falla no es el merge conflict —eso Git lo grita—
  sino el silencioso: un `git add -A` de una sesión barre archivos sin commitear de la otra. **Ya
  pasó tres veces en este repo.** Esta US toca `SiteFooter.tsx`, `sitemap.ts` y el `README.md` de
  `apps/web`, los tres compartidos con trabajo en vuelo.

  - **Exit criterion**: `git status --porcelain -- apps/web` no devuelve ninguna línea. Si
    devuelve algo, `/develop-frontend-web` **para acá** y reporta — no negocia, no scopea
    parcial, no "coordina sobre la marcha".
  - **Verify**:
    ```bash
    test -z "$(git status --porcelain -- apps/web)" \
      && echo "OK — apps/web sin cambios sin commitear"
    ```

- [x] **P2 — Suite verde y build de producción verde en el `HEAD` de partida** *(verde 2026-08-22: 63 archivos / 353 tests; build OK)*
  - ⚠️ **El build exige una env var que el `Verify:` no pasaba**: `next build` setea `NODE_ENV=production` y `next.config.mjs` (US-014) **aborta sin `API_INTERNAL_ORIGIN`**. Está documentada en `apps/web/.env.example:26` pero no se exporta sola, así que el comando tal como está escrito falla en un entorno limpio. Se corrió como `API_INTERNAL_ORIGIN=http://localhost:3000 pnpm --filter @dsm/web build`.
  - **Hallazgo colateral (fuera de alcance de esta US)**: `.github/workflows/ci.yml` corre lint, typecheck, migraciones y tests, **pero no `build`**. Por eso nadie detectó esto: el build de producción no se ejercita en CI. Importa para US-019, donde Railway sí corre `next build` — y ahí la falta de la variable no da un error de configuración legible sino un deploy roto.
  - **Exit criterion**: unit/componente y `next build` pasan antes de tocar nada. Sin red previa
    no se modifica superficie entregada (`SiteFooter`, `sitemap`).
  - **Verify**: `pnpm --filter @dsm/web test && pnpm --filter @dsm/web build`

- [x] **P3 — `design-system.md` en `Approved`** *(verde 2026-08-22)* (gate de `fe-design-without-figma` §5: sin Figma,
  el design-system **es** la autoridad visual)
  - **Exit criterion**: el doc declara la aprobación de PO y Arquitecto.
  - **Verify**: `grep -q '^- \[x\] PO:' docs/product/design-system.md && grep -q '^- \[x\] Arquitecto:' docs/product/design-system.md && echo OK`

- [x] **P4 — AS-BUILT: el footer existe con el hueco de US-017 marcado** *(verde 2026-08-22: montado en el layout, comentario presente, 7 tests del footer verdes)*
  - **Exit criterion**: `SiteFooter` está montado en el layout de `(storefront)` y su comentario
    `Deferred: US-017` sigue ahí — es el hueco que T3.1 cierra. Si el footer no existiera, este
    plan estaría planificando sobre una suposición.
  - **Verify**:
    ```bash
    grep -q '<SiteFooter />' 'apps/web/app/(storefront)/layout.tsx' \
      && grep -q 'Deferred: US-017' apps/web/src/features/contact/SiteFooter.tsx \
      && pnpm --filter @dsm/web test -- --run src/features/contact/SiteFooter.test.tsx
    ```

---

## Fase 0: Contenido y fuente única — 0,9 h

- [x] **T0.1** `content.ts`: los dos documentos como dato tipado, con versión (0,5 h) *(verde 2026-08-22 — 14 tests)*
  - **AS-BUILT**: los cuatro bloques de la Ley 25.326 son **claves obligatorias del tipo**, y el test los ejercita borrando cada uno y exigiendo que el schema rechace — AC-5 se prueba, no se declara. El texto provisional lleva los datos que hoy son ciertos (nombre, domicilio del footer publicado, email de `project-config.yml`) y marca lo que falta con `[PENDIENTE: …]` **visible en la página**. Sin campo `status`, per OQ-FE-17 (a).

  - **Pattern**: los cuatro bloques de la Ley 25.326 van como **claves obligatorias del tipo**,
    no como elementos de un array — así el test exige *cada uno* y no "al menos cuatro
    secciones". Texto plano en `paragraphs`: **nunca** HTML (`frontend-standards.md` §12 —
    `dangerouslySetInnerHTML` es anti-patrón):
    ```ts
    // apps/web/src/features/legal/content.ts
    export interface LegalSection { heading: string; paragraphs: string[] }

    export interface LegalDocumentContent {
      slug: 'privacidad' | 'terminos';
      title: string;
      /** Fecha ISO. MISMA versión que registra `orders.consent_terms_version` (US-008). */
      version: string;
      effective_date: string;
      required: {
        controller: LegalSection;  // responsable del tratamiento
        purpose: LegalSection;     // finalidad del uso de los datos
        rights: LegalSection;      // derechos del titular
        contact: LegalSection;     // canal de contacto
      };
      extra: LegalSection[];
    }

    export const LEGAL_TERMS_VERSION = '2026-06-15'; // ← igual al default del backend (US-008)

    export const LEGAL_DOCUMENTS: Record<'privacidad' | 'terminos', LegalDocumentContent> = { … };
    ```
    **Sin campo `status`** (decisión del PO, OQ-FE-17 (a)): no hay gate que lo lea, y un campo sin
    lector es dato muerto (`AGENTS.md` §1.2). Lo que sí queda es que el texto provisional lleve
    los datos que **hoy son ciertos** (nombre de fantasía, dirección del local, email de contacto
    de `docs/project-config.yml`) y marque lo que falta con `[PENDIENTE: …]` **en el propio
    texto** — así el hueco es visible en la página para cualquiera que la abra, incluido quien
    esté por publicar. La protección real es el gate humano del DoD de la US.

    La validación de forma se exporta como **schema Zod** (`zod` ya es dependencia del app y es
    la convención de `src/lib/env.ts`), para que la usen el test de AC-5 y quien edite el
    contenido:
    ```ts
    export const legalDocumentSchema = z.object({
      slug: z.enum(['privacidad', 'terminos']),
      title: z.string().min(1),
      version: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      required: z.object({
        controller: sectionSchema, purpose: sectionSchema,
        rights: sectionSchema, contact: sectionSchema,
      }),
      extra: z.array(sectionSchema),
    });
    ```
  - **Exit criterion**: existen los dos documentos con los **cuatro** bloques obligatorios no
    vacíos; `version` y `effective_date` son fechas ISO (`YYYY-MM-DD`) y **coinciden entre sí**;
    `LEGAL_TERMS_VERSION` es igual a la `version` del documento de términos. Ningún `paragraphs`
    contiene `<` (si apareciera HTML, el renderizado lo escaparía y el texto legal saldría roto
    en pantalla). El schema Zod **rechaza** un documento al que le falte cualquiera de los cuatro
    bloques o que los tenga vacíos. El texto provisional conserva sus marcadores `[PENDIENTE: …]`
    visibles.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/legal/content.test.ts`
    (casos: los dos documentos **parsean** con `legalDocumentSchema`; una copia con
    `required.rights` borrado **falla** el parse —así AC-5 se ejercita, no se declara—; otra con
    `paragraphs: ['']` también falla; `version === effective_date`;
    `LEGAL_DOCUMENTS.terminos.version === LEGAL_TERMS_VERSION`; ningún párrafo contiene `<`)

- [x] **T0.2** `routes.ts`: fuente única de rutas + `CONSENT_COPY` (seam de US-008) (0,4 h) *(verde 2026-08-22 — 4 tests)*
  - **AS-BUILT**: el guard recorre `apps/web/src` y `apps/web/app` con `node:fs` y falla si el literal `'/legales/` aparece fuera de `routes.ts`. Se descartó una indirección extra (`routes.internal.ts`) que había escrito de más: agregaba una capa sin beneficio y se apartaba del `Pattern:`.

  - **Pattern**: `as const` para que las rutas sean tipos literales y un `href` mal escrito no
    compile. `CONSENT_COPY` materializa el copy del `design-system.md` §10.2 **con sus destinos
    reales** — hoy ese copy tiene dos `(#)`:
    ```ts
    // apps/web/src/features/legal/routes.ts
    export const LEGAL_ROUTES = {
      privacidad: '/legales/privacidad',
      terminos: '/legales/terminos',
    } as const;

    /** Copy del consentimiento (design-system §10.2). Lo consume el checkout (US-008). */
    export const CONSENT_COPY = {
      lead: 'Al comprar aceptás nuestra',
      links: [
        { href: LEGAL_ROUTES.privacidad, label: 'política de privacidad' },
        { href: LEGAL_ROUTES.terminos, label: 'términos' },
      ],
      trailing: 'Usamos tus datos solo para gestionar tu pedido (Ley 25.326).',
    } as const;
    ```
    — per `frontend-standards.md` §2.1 (package-by-feature) y el precedente de US-018 AC-5
    (fuente única del enlace **antes** de sumar consumidores, no después).
  - **Exit criterion**: las dos rutas viven en **un** archivo; `CONSENT_COPY` no contiene ningún
    `href` igual a `'#'` ni vacío; y **ningún otro archivo de `apps/web` escribe la ruta legal
    como literal** — el día que el checkout de US-008 la copie en lugar de importarla, el guard
    falla.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/legal/routes.test.ts`
    (casos: las rutas empiezan con `/legales/`; ningún link de `CONSENT_COPY` es `'#'`; y el
    guard de fuente única recorre `apps/web/src` + `apps/web/app` con `node:fs` buscando el
    literal `'/legales/` y falla si aparece en un archivo que **no** sea `routes.ts` ni un
    `*.test.*` — mismo patrón que el guard de `wa.me` de US-018 T1.1)

---

## Fase 1: Presentación — 0,7 h

- [x] **T1.1** `LegalDocument.tsx`: Server Component presentacional (0,4 h) *(verde 2026-08-22 — 6 tests)*
  - **AS-BUILT**: dos guards del test tuvieron que anclarse al **uso** y no a la mención, porque matcheaban el propio comentario del componente que explica por qué no los lleva —rojo permanente, misma familia que F57—. `'use client'` se verifica como **primera sentencia** del archivo (que es donde Next la reconoce) y `dangerouslySetInnerHTML` como **atributo JSX** (`/dangerouslySetInnerHTML\s*=/`).

  - **Pattern**: Server Component **sin** `'use client'` (`frontend-next-standards.md` §2: cero
    JS de cliente en una página de texto). Ancho de lectura con `max-w-prose`, que es utilidad
    de **Tailwind core** — `class="prose"` NO existe en este proyecto (`tailwind.config.ts`
    declara `plugins: []`). Colores y espaciados por token del design-system, nunca hardcodeados:
    ```tsx
    // apps/web/src/features/legal/LegalDocument.tsx
    export function LegalDocument({ doc }: { doc: LegalDocumentContent }) {
      const sections = [doc.required.controller, doc.required.purpose,
                        doc.required.rights, doc.required.contact, ...doc.extra];
      return (
        <article className="mx-auto max-w-prose px-4 py-8">
          <h1 className="text-2xl font-bold text-foreground">{doc.title}</h1>
          {/* Mitad visible de AC-8: la versión que la orden registra, legible por
              humanos y por máquinas. */}
          <p className="mt-2 text-sm text-muted">
            Versión {doc.version} · vigente desde{' '}
            <time dateTime={doc.effective_date}>{doc.effective_date}</time>
          </p>
          {sections.map((s) => (
            <section key={s.heading} className="mt-6">
              <h2 className="text-lg font-semibold text-foreground">{s.heading}</h2>
              {s.paragraphs.map((p) => (
                <p key={p} className="mt-2 text-sm leading-relaxed text-foreground">{p}</p>
              ))}
            </section>
          ))}
        </article>
      );
    }
    ```
    — per `design-system.md` §11 (headings en orden jerárquico, `h1` único) y §2 (tokens).
  - **Exit criterion**: renderiza **un** `<h1>` con el título, la versión con `<time datetime>`,
    y **un `<h2>` por sección** en el orden «obligatorias primero, extras después». No contiene
    `dangerouslySetInnerHTML`. No declara `'use client'`. Un documento con 0 secciones extra
    renderiza igual (4 `<h2>`).
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/legal/LegalDocument.test.tsx`
    (casos: `getAllByRole('heading', { level: 1 })` tiene largo 1; hay tantos `level: 2` como
    secciones y el **primero** es el del responsable del tratamiento; el `<time>` lleva el
    `dateTime` del documento; un párrafo con `<b>hola</b>` en el contenido aparece **como texto
    literal** en pantalla —prueba de que no se interpreta HTML—; el archivo fuente no contiene
    `'use client'`)

- [x] **T1.2** `legalMetadata.ts`: metadata por documento (0,3 h) *(verde 2026-08-22 — 8 tests)*

  - **Pattern**: espeja `src/features/storefront/metadata.ts` (US-003): `SITE_NAME`, description
    acotada, **canonical absoluta** desde `NEXT_PUBLIC_SITE_URL` — los buscadores la exigen
    absoluta. Metadata API, nunca `<head>` manual (`frontend-next-standards.md` §6):
    ```ts
    // apps/web/src/features/legal/legalMetadata.ts
    export function legalMetadata(doc: LegalDocumentContent): Metadata {
      const url = `${publicEnv.NEXT_PUBLIC_SITE_URL}${LEGAL_ROUTES[doc.slug]}`;
      return {
        title: `${doc.title} — DSM Refrigeración y Ferretería`,
        description: `${doc.title} de DSM Refrigeración y Ferretería. Versión ${doc.version}.`,
        alternates: { canonical: url },
        openGraph: { type: 'website', title: doc.title, url },
      };
    }
    ```
  - **Exit criterion**: `alternates.canonical` es **absoluta** y termina en la ruta del
    documento tomada de `LEGAL_ROUTES` (no un string suelto); el `title` incluye el nombre del
    sitio; la `description` no supera 160 caracteres; **no** se emite `robots: { index: false }`
    — estas páginas son indexables a propósito (US §9).
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/legal/legalMetadata.test.ts`
    (casos: la canonical arranca con `http` y termina en `/legales/privacidad`
    y `/legales/terminos` respectivamente; largo de `description` ≤ 160; el objeto **no** tiene
    la clave `robots`; con `NEXT_PUBLIC_SITE_URL` de test la URL no queda con `//` duplicado)

---

## Fase 2: Rutas e indexabilidad — 0,6 h

- [x] **T2.1** Las dos páginas bajo `app/(storefront)/legales/` (0,3 h) *(verde 2026-08-22 — 4 tests + typecheck; sin `loading.tsx`)*

  - **Pattern**: página trivial que sólo compone — la lógica ya está en `content.ts`,
    `LegalDocument` y `legalMetadata`. Route group `(storefront)` para heredar header + footer
    sin tocar el layout (`frontend-next-standards.md` §1):
    ```tsx
    // apps/web/app/(storefront)/legales/privacidad/page.tsx
    import { LEGAL_DOCUMENTS } from '@/features/legal/content';
    import { LegalDocument } from '@/features/legal/LegalDocument';
    import { legalMetadata } from '@/features/legal/legalMetadata';

    const doc = LEGAL_DOCUMENTS.privacidad;
    export const metadata = legalMetadata(doc);
    export default function PrivacidadPage() { return <LegalDocument doc={doc} />; }
    ```
    Nada de `[doc]` dinámico: dos documentos conocidos no justifican un parámetro validable ni
    una rama `notFound()` (`design.md` D2, `base-standards.md` §1). Nada de `loading.tsx`: la
    boundary de Suspense compromete el status 200 antes de tiempo (deuda F59 documentada por
    US-003) y acá **no hay nada asíncrono que esperar**.
  - **Exit criterion**: las dos rutas existen como `page.tsx` estáticos, exportan `metadata` de
    `legalMetadata` y renderizan `LegalDocument` con su documento. Ninguna declara `'use client'`,
    ninguna hace `fetch`, y no se agrega ningún `loading.tsx` ni `error.tsx` bajo `legales/`.
  - **Verify**:
    ```bash
    pnpm --filter @dsm/web test -- --run src/features/legal/pages.test.tsx \
      && test ! -e 'apps/web/app/(storefront)/legales/privacidad/loading.tsx' \
      && test ! -e 'apps/web/app/(storefront)/legales/terminos/loading.tsx' \
      && pnpm --filter @dsm/web typecheck
    ```
    (`pages.test.tsx` importa los dos módulos de página y los renderiza con RTL: el `<h1>` es el
    título del documento correcto y `metadata.alternates.canonical` apunta a la ruta correcta —
    si alguien cruza los documentos entre las dos páginas, falla)

- [x] **T2.2** Las dos URLs legales en el sitemap, **antes** de la degradación (0,3 h) *(verde 2026-08-22 — 9 tests)*
  - **Desviación del plan, con motivo**: el plan decía que los casos de US-002 seguirían verdes "sin editarse", y no fue posible — uno afirmaba que el sitemap degradado tiene **exactamente** una entrada, y ahora tiene tres. Se ajustó a lo que su **propio nombre** declara ("al menos la home"): se asserta que la home está y que ninguna URL es relativa, en vez de un conteo exacto que ataba el test a cuántas rutas no dependen de la API — número que crece con cada US.

  - **Pattern**: hoy `buildSitemap()` devuelve `[home]` cuando el árbol de categorías falla. Las
    páginas legales **no dependen del árbol**, así que entran antes de ese `return` — si
    entraran después, un 5xx de la API las borraría del sitemap:
    ```ts
    // apps/web/src/features/storefront/sitemap.ts
    const home = { url: base };
    const legales = Object.values(LEGAL_ROUTES).map((path) => ({ url: `${base}${path}` }));

    const rubros = await categoriesStorefrontService.getTree().catch(() => []);
    if (rubros.length === 0) return [home, ...legales];
    …
    return [home, ...legales, ...categorias, ...productos];
    ```
    — per `frontend-next-standards.md` §6 (sitemap por Metadata API) y el patrón de degradación
    que el propio archivo ya documenta.
  - **Exit criterion**: `buildSitemap()` incluye las dos URLs legales **absolutas** en el camino
    feliz **y** en el camino degradado (árbol que rechaza). No se duplican con ninguna otra URL.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/storefront/sitemap.test.ts`
    (casos nuevos: con el servicio mockeado OK, el sitemap contiene las dos URLs legales; con el
    servicio **rechazando**, el sitemap tiene exactamente `[home, privacidad, terminos]`; sin
    duplicados — `new Set(urls).size === urls.length`. Los casos existentes de US-002 siguen
    verdes sin editarse)

---

## Fase 3: Enlaces y accesibilidad — 0,5 h

- [x] **T3.1** `SiteFooter`: los dos enlaces legales reales (AC-3) (0,3 h) *(verde 2026-08-23 — 10 tests: 7 de US-018 sin editar + 3 nuevos)*

  - **Pattern**: se reemplaza el comentario `Deferred: US-017` por los enlaces, tomados de
    `LEGAL_ROUTES` (nunca literales) y con `next/link` como el resto del sitio. Área táctil y
    focus ring como el resto del footer (`design-system.md` §7.10, §11):
    ```tsx
    // apps/web/src/features/contact/SiteFooter.tsx
    import Link from 'next/link';
    import { LEGAL_ROUTES } from '@/features/legal/routes';
    …
    <nav aria-label="Legales" className="mt-2">
      <ul className="flex flex-wrap gap-4">
        <li>
          <Link href={LEGAL_ROUTES.privacidad}
                className="flex min-h-[44px] items-center underline focus:outline-none focus-visible:shadow-focus">
            Política de privacidad
          </Link>
        </li>
        <li>{/* Términos y condiciones — idem */}</li>
      </ul>
    </nav>
    ```
  - **Exit criterion**: el footer ofrece los dos enlaces con nombres accesibles distintos
    («Política de privacidad», «Términos y condiciones») y `href` **tomado de `LEGAL_ROUTES`**;
    el comentario `Deferred: US-017` ya no está; el canal de WhatsApp y los datos del local
    **siguen intactos** (US-018 no se rompe). El panel del dueño no cambia: el footer sólo vive
    en `(storefront)` (ADR-0010).
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/contact/SiteFooter.test.tsx`
    (casos nuevos: `getByRole('link', { name: /política de privacidad/i })` con `href`
    `/legales/privacidad` y su par de términos; los casos existentes de US-018 —WhatsApp,
    nombre y dirección del local— siguen verdes **sin editarse**; y un caso que asserta que
    **ningún** `href` del footer es `'#'`)

- [ ] **T3.2** axe sobre las dos páginas y sobre el footer con enlaces (0,2 h)

  - **Pattern**: `jest-axe` como en `src/features/storefront/a11y.test.tsx` y
    `contactA11y.test.tsx`. Además del `expect(...).toHaveNoViolations()`, se asserta la
    **jerarquía** de headings, que axe en jsdom no siempre marca:
    ```tsx
    const { container } = render(<LegalDocument doc={LEGAL_DOCUMENTS.terminos} />);
    expect(await axe(container)).toHaveNoViolations();
    ```
    — per `qa-frontend-standards.md` §23.6 (axe) y §19 (a11y), `design-system.md` §11.
  - **Exit criterion**: cero violaciones de axe en las dos páginas y en el footer con los
    enlaces; un solo `<h1>` por página; los `<h2>` no saltan niveles; los enlaces del footer
    tienen nombre accesible y área ≥ 44 px declarada por clase.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/legal/legalA11y.test.tsx src/features/contact/contactA11y.test.tsx`

---

## Fase 4: Guards — 0,5 h

> **T4.1 (gate de despliegue del texto provisional) — DESCARTADA por decisión del PO
> (OQ-FE-17 (a), 2026-08-22).** No se construye `check-legal-content.mjs` ni el campo `status`.
> El argumento de la opción (a) es defendible: un script que **nadie invoca** hasta que US-019
> enganche el pipeline es protección de papel, y el DoD de la US ya tiene el gate humano
> («texto legal final provisto y revisado por el dueño / asesoría legal»). El riesgo residual
> queda **escrito y con dueño**: si alguien despliega antes de que llegue el texto final, el
> sitio publica legales incompletos —visibles, porque los `[PENDIENTE: …]` se leen en la
> página— y eso es incumplimiento con apariencia de cumplimiento. Mitigación acordada: el
> checklist de despliegue de `Deferred: US-019` lo lista, y T6.1 lo documenta en el README.

- [ ] **T4.2** Guard: sin backend, sin cliente, sin tracking (AC-6, AC-7, US §9) (0,3 h)

  - **Pattern**: mismo patrón que `src/features/contact/noBackend.test.tsx` (US-018 T3.1): se
    lee el **grafo de imports** del feature y se falla si aparece red o telemetría. Es lo que
    convierte una propiedad verdadera-hoy en un invariante:
    ```ts
    const fuentes = leerArchivos('apps/web/src/features/legal', 'apps/web/app/(storefront)/legales');
    expect(fuentes).not.toMatch(/from '@\/lib\/http/);        // sin cliente HTTP
    expect(fuentes).not.toMatch(/\bfetch\(/);                  // sin fetch directo
    expect(fuentes).not.toMatch(/from '@\/lib\/observability/); // sin telemetría (US §9)
    expect(fuentes).not.toMatch(/'use client'/);               // Server Components puros
    ```
    — per `frontend-standards.md` §12 y `frontend-next-standards.md` §2/§7.
  - **Exit criterion**: el test **falla** si mañana alguien importa el cliente HTTP, llama
    `fetch`, agrega un evento de telemetría o convierte una de las dos páginas en Client
    Component. Es un guard de regresión, no una verificación de una vez: una página que cumple
    una obligación legal no puede caerse porque la API esté caída, y el §9 prohíbe tracking acá.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/legal/noBackendNoTracking.test.tsx`

- [ ] **T4.3** Test de deriva de la versión contra el backend (AC-8) — `OQ-FE-16 (b) ratificada` (0,2 h)

  - **Pattern**: con T4.1 descartada, el chequeo **no** vive en un script de deploy: vive en la
    **suite**, que sí corre en cada CI. Es estrictamente más fuerte que la opción original —el
    script dependía de que US-019 lo enganchara— y no cuesta nada más. El test lee el default
    declarado por el backend y lo compara con la versión publicada:
    ```ts
    // apps/web/src/features/legal/versionContract.test.ts
    const envBackend = readFileSync('../api/.env.example', 'utf8');
    const declarada = envBackend.match(/^LEGAL_TERMS_VERSION=(.+)$/m)?.[1]?.trim();

    it('la versión publicada es la que el backend registra en la orden (AC-8)', () => {
      // Si el backend no la declara, no hay contrato que verificar: es un fallo, no un skip.
      expect(declarada).toBeDefined();
      expect(declarada).toBe(LEGAL_DOCUMENTS.terminos.version);
    });
    ```
    — per `documentation-standards.md` §11 (un contrato entre dos sistemas se verifica, no se
    documenta y se espera).

    **Toca un archivo de otra disciplina, una línea**: hoy `apps/api/.env.example` **no declara**
    `LEGAL_TERMS_VERSION` (verificado al planificar), así que esta task agrega
    `LEGAL_TERMS_VERSION=2026-06-15` con un comentario que apunta a US-008. Es aditivo, sin
    código, y US-008 lo va a necesitar igual; si esa sesión lo agrega en paralelo, el conflicto es
    de una línea. Si el Arquitecto prefiere que US-017 no toque `apps/api`, la alternativa es
    dejar esta task `Gated:` hasta que US-008 declare la variable — pero entonces AC-8 queda sin
    verificación en el medio.
  - **Exit criterion**: el test **falla** si la versión del FE y la declarada por el backend
    difieren, y **también** si el backend no la declara. `apps/api/.env.example` queda con la
    variable y su comentario. Lo que este test **no** cubre —que el valor configurado en Railway
    coincida— queda `Deferred: US-019`, declarado.
  - **Verify**:
    ```bash
    pnpm --filter @dsm/web test -- --run src/features/legal/versionContract.test.ts \
      && grep -q '^LEGAL_TERMS_VERSION=' apps/api/.env.example
    ```
    (y el ejecutor comprueba la fuerza del test —F50— cambiando la versión del `.env.example` a
    otro valor y viendo que **falla**, antes de dejarlo en el correcto)

---

## Fase 5: E2E sobre el HTML servido — 0,4 h

- [ ] **T5.1** `e2e/legal-pages.spec.ts`: 200, sin login, enlazadas y en el sitemap (0,4 h)

  - **Pattern**: se verifica el **HTML servido**, no el DOM hidratado — es lo que ve un crawler
    y un visitante sin JS, y es la mitad de AC-1/AC-2 que un test de componente no puede probar.
    Sin cookies en el contexto: AC-7 es "sin iniciar sesión", así que el spec no debe arrastrar
    estado de otros specs (`playwright-stability`):
    ```ts
    for (const path of ['/legales/privacidad', '/legales/terminos']) {
      test(`${path} responde 200 SSR sin login (AC-1/AC-2/AC-7)`, async ({ page }) => {
        const res = await page.goto(path);
        expect(res!.status()).toBe(200);
        const html = await res!.text();
        expect(html).toContain('Versión');            // versión visible (AC-8)
        expect(html).toMatch(/<h1[^>]*>/);
      });
    }
    ```
  - **Exit criterion**: las dos rutas devuelven **200** con su `<h1>` y su versión en el HTML
    servido, **sin** cookies de sesión en el contexto (AC-7); el footer de una página pública
    cualquiera (`/`) trae los dos `href` legales (AC-3); `/sitemap.xml` los incluye; y el panel
    (`/admin/acceso`) **no** los enlaza en su chrome —el footer es superficie pública
    (ADR-0010)—. Ningún `href="#"` en el HTML de las páginas legales.
  - **Verify**: `pnpm --filter @dsm/web test:e2e e2e/legal-pages.spec.ts`

---

## Fase 6: Documentación — 0,3 h

- [ ] **T6.1** README del app: rutas legales, versionado y gate (0,3 h)

  - **Pattern**: se extiende el `## Mapa de rutas` con las dos rutas nuevas y se agrega una
    sección hermana de `### Canal de contacto (WhatsApp — US-018)`, con el mismo tono operativo
    — per `documentation-standards.md` §11.1.
  - **Exit criterion**: el README documenta (a) las dos rutas y que son públicas e indexables,
    (b) que el contenido vive en `src/features/legal/content.ts` y **cambiarlo es un deploy**,
    (c) que el texto es **provisional** hasta que el dueño entregue el final, que los marcadores
    `[PENDIENTE: …]` se leen en la página y que **no hay gate automático** (decisión del PO,
    OQ-FE-17 (a)): publicar antes de tener el texto final es incumplimiento y la protección es el
    DoD de la US + el checklist de despliegue de US-019, (d) que la `version` tiene que coincidir
    con `LEGAL_TERMS_VERSION` del backend y por qué (la orden registra esa versión — US-008), con
    el test que lo verifica, y (e) que el checkbox del checkout debe consumir `LEGAL_ROUTES` /
    `CONSENT_COPY` y no escribir la ruta a mano.
  - **Verify**:
    ```bash
    grep -q '/legales/privacidad' apps/web/README.md \
      && grep -q '/legales/terminos' apps/web/README.md \
      && grep -q 'LEGAL_TERMS_VERSION' apps/web/README.md \
      && grep -q 'CONSENT_COPY' apps/web/README.md \
      && grep -q 'PENDIENTE' apps/web/README.md \
      && echo OK
    ```

---

## Verification (suite-level)

- [ ] Unit + componente + a11y pasan: `pnpm --filter @dsm/web test`
- [ ] Lint + typecheck limpios: `pnpm --filter @dsm/web lint && pnpm --filter @dsm/web typecheck`
- [ ] Build de producción verde: `pnpm --filter @dsm/web build`
- [ ] E2E completa verde (no sólo el spec nuevo — el footer cambió y lo tocan otros specs):
      `pnpm --filter @dsm/web test:e2e`
- [ ] **Sin regresión de US-018**: `pnpm --filter @dsm/web test -- --run src/features/contact` y
      `pnpm --filter @dsm/web test:e2e e2e/site-contact.spec.ts` (el footer es el archivo que
      este change modifica: si el canal de WhatsApp o los datos del local se rompen, es acá)
- [ ] **Sin regresión de US-002**: `pnpm --filter @dsm/web test -- --run src/features/storefront/sitemap.test.ts`
      (el sitemap es el otro archivo entregado que se modifica)
- [ ] **El contrato de versión con el backend está verificado** (AC-8):
      `pnpm --filter @dsm/web test -- --run src/features/legal/versionContract.test.ts`
- [ ] **Ninguna página legal depende de la API ni lleva tracking**:
      `pnpm --filter @dsm/web test -- --run src/features/legal/noBackendNoTracking.test.tsx`
- [ ] CI del monorepo: `pnpm -r lint && pnpm -r typecheck && pnpm -r test`
      *(al planificar, `pnpm -r lint` y `pnpm -r test` están rojos por trabajo de otras
      disciplinas en vuelo —US-014 frontend en `customerSession.test.ts`, US-006 backend en
      `e2e-imports-upload`— y `apps/api/src/common/e2e-security-edge.spec.ts` falla desde antes
      de US-007. Si al ejecutar siguen rojos por esas causas, se reporta y **no** se toca código
      ajeno; lo que este change controla es `@dsm/web`)*
