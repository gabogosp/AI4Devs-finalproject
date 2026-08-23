---
tracker-id: null
tracker-source: null
parent-us: US-017
discipline: frontend-web
variant: null
language: es
created: 2026-08-22
---

# US-017 Frontend Web — Páginas legales + consentimiento

> **Lo que este change entrega y lo que no**: entrega las **dos páginas legales** que hoy no
> existen, su **versionado visible** y los **enlaces desde el footer**, más el gate que impide
> publicar con texto provisional. **No** entrega el checkbox de consentimiento del checkout:
> ese vive en la superficie de US-008, que todavía no tiene plan de frontend. Lo que sí
> entrega para él es la **fuente única de rutas legales** que ese checkbox tiene que consumir,
> para que no nazca con un `href="#"` como el que hoy tiene el copy del design-system §10.2.

## Why

La capacidad 10 del PRD es **Must** por una razón que no es de producto: sin política de
privacidad y términos publicados, **el sitio no puede salir a producción cobrando y
recolectando PII** (PRD §246, Ley 25.326 AR). El PRD lo pone en el cycle 4 junto al loop
comprable justamente porque es prerequisito de cobrar, no un adorno de cierre.

Hoy el hueco es literal y está anotado en el código. `apps/web/src/features/contact/SiteFooter.tsx`
(US-018) tiene el lugar reservado con un comentario que explica por qué quedó vacío:

```tsx
{/* Sólo lo que hoy es cierto. Un enlace legal apuntando a `#` en
    producción es PEOR que no tenerlo (Ley 25.326).
    Deferred: US-017 — política de privacidad y términos. */}
```

Ese razonamiento —un enlace legal roto sugiere que la página existe y no cumple nada— es el
que gobierna este change de punta a punta: **no se entregan enlaces sin páginas, ni páginas
con texto de relleno silencioso**. El texto final lo provee el dueño (US §10); lo que el
desarrollo entrega es el mecanismo **y el guard que impide publicarlo antes de que el texto
sea real**.

Hay además un contrato cross-stack que se está definiendo **ahora mismo** en otra disciplina y
que esta US tiene que honrar: el plan de US-008 backend ya decidió que `orders.consent_terms_version`
se llena desde `LEGAL_TERMS_VERSION` (configuración del backend, default `'2026-06-15'`) para
no acoplar el checkout a los textos. Eso convierte a AC-8 en una **igualdad entre dos
sistemas**: la versión que la página publica tiene que ser la misma que la orden registra. Si
divergen, la trazabilidad legal que AC-8 existe para dar se vuelve falsa —la orden dice que el
comprador aceptó la versión X y el sitio publica la Y— y nadie se entera. Este plan hace esa
igualdad **verificable**, no confiada.

## What changes

- **Dos páginas SSR indexables** (AC-1, AC-2, AC-7): `/legales/privacidad` y `/legales/terminos`,
  en el route group `(storefront)`, así que heredan header, `CategoryNav` y footer sin tocar
  ninguna otra página. Sin login, sin JavaScript de cliente, sin una sola llamada a la API.
- **El contenido como módulo tipado** (`src/features/legal/content.ts`): documentos con
  `version`, `effective_date`, `status: 'draft' | 'final'` y secciones. El texto vive en el
  repo —el E2E §3 (capacidad 10) declara «páginas estáticas SSR», no un endpoint— y su
  estructura obliga a que estén los cuatro bloques que exige la Ley 25.326 (AC-5): responsable
  del tratamiento, finalidad, derechos del titular y canal de contacto.
- **Versión visible en la página** (AC-8, mitad FE): cada documento muestra su versión y desde
  cuándo rige. Es la mitad humana de la trazabilidad; la mitad de máquina es el chequeo de
  deriva contra `LEGAL_TERMS_VERSION` del backend.
- **Enlaces en el footer** (AC-3): `SiteFooter` reemplaza el comentario de US-018 por los dos
  enlaces reales, tomados de la **fuente única** `src/features/legal/routes.ts`. Aparecen en
  toda página pública porque el footer ya está montado en el layout del route group.
- **Fuente única de rutas + copy del consentimiento** (seam de AC-4): `routes.ts` exporta las
  dos rutas y el texto del §10.2 del design-system con sus destinos reales. Es lo que US-008
  frontend tiene que consumir para el checkbox; **este change no construye el checkbox** (sería
  UI sin dueño ni pantalla donde vivir).
- **Las páginas entran al sitemap** (AC-1/AC-2, indexabilidad): `buildSitemap` las agrega
  **antes** de su rama de degradación, así siguen listadas incluso cuando el árbol de
  categorías falla — hoy ese camino devuelve sólo la home.
- **Gate de producción del texto provisional** (AC-6): `scripts/check-legal-content.mjs` falla
  si algún documento sigue en `status: 'draft'` o conserva marcadores de relleno. Mismo patrón
  y mismo lugar que el gate del número de WhatsApp (`check-whatsapp-configured.mjs`, OQ-FE-12
  resuelta como «script en el job de despliegue»): el guard va donde está el riesgo —publicar—,
  no en el build local ni en la suite.
- **Guard de no-dependencia** (AC-6, AC-7): un test que **falla** si mañana alguien enruta el
  contenido legal por la API, le agrega telemetría o lo vuelve Client Component. Una página que
  cumple una obligación legal no puede caerse porque la API esté caída, y el §9 de la US
  prohíbe tracking en estas páginas.

## Lo que ya está construido (auditado contra el código, 2026-08-22)

Verificado leyendo los archivos, no asumido:

| Evidencia | Qué aporta |
|---|---|
| `apps/web/app/(storefront)/layout.tsx:26-52` | Header + `CategoryNav` + `<SiteFooter />` montados en el route group. Cualquier página nueva bajo `(storefront)` hereda el chrome **y el footer** sin tocar el layout. |
| `apps/web/src/features/contact/SiteFooter.tsx:24-27` | El lugar de los enlaces legales existe, con el `Deferred: US-017` explícito. AC-3 es completar un hueco preparado, no diseñar un footer. |
| `apps/web/src/features/storefront/CategoryNav.tsx:19-24` | La nav **degrada a `null`** si el árbol de categorías falla (`.catch(captureError)`). Eso es lo que hace posible que una página legal en `(storefront)` sirva 200 con la API caída. |
| `apps/web/app/robots.ts` | `allow: '/'` con `disallow: '/admin/'`: las rutas legales nacen rastreables sin tocar robots. |
| `apps/web/src/features/storefront/sitemap.ts` | `buildSitemap()` ya existe y **degrada a `[home]`** cuando el árbol falla — por eso las URLs legales se agregan antes de ese `return`. |
| `apps/web/src/features/storefront/metadata.ts` | Patrón de metadata a espejar: `SITE_NAME`, `truncate(…, 160)`, canonical **absoluta** desde `NEXT_PUBLIC_SITE_URL`, Open Graph. |
| `apps/web/scripts/check-whatsapp-configured.mjs` | Precedente exacto del gate de despliegue: script con exit ≠ 0, invocado sólo en el job de deploy (enganche `Deferred: US-019`). |
| `apps/web/src/features/contact/noBackend.test.tsx` | Precedente del guard de "sin red": el patrón ya existe en el repo y se replica para legales. |
| `apps/web/tailwind.config.ts:83` | `plugins: []` — **no hay `@tailwindcss/typography`**. El estilo de texto largo se compone con utilidades y tokens; planificar `class="prose"` habría producido una página sin estilos. |
| `openspec/changes/US-008-checkout-guest-backend/design.md:167-169` + `tasks.md:130` | El backend del checkout registra `consent_terms_version` desde `LEGAL_TERMS_VERSION` (default `'2026-06-15'`). Es la contraparte de AC-8. |

## Out of scope

- **El texto legal definitivo** — lo provee el dueño / asesoría legal (US §10 y su DoD). Este
  change entrega el mecanismo, un texto **provisional marcado como tal** y el gate que impide
  publicarlo. `Deferred: PO/cliente — gate de producción`.
- **El checkbox de consentimiento del checkout y su captura** — US-008 (FE + BE). Acá se
  entrega la fuente única de rutas y el copy que ese checkbox consume. `Deferred: US-008`.
- **La columna `orders.consent_terms_version`, su `CHECK` y el registro** — ya planificados en
  `US-008-checkout-guest-backend`. Este change no toca `apps/api`.
- **Banner / gestión de consentimiento de cookies** — fuera de v1 (US §4): el MVP no usa
  tracking de terceros, y estas páginas explícitamente tampoco.
- **Borrado de cuenta y derecho al olvido** — US-014 / US-020.
- **Página de «cambios y devoluciones»** o cualquier tercer documento legal — no lo pide
  ningún AC. Si aparece, la §Decisión D2 del `design.md` explica cuándo conviene promover las
  dos rutas explícitas a una ruta dinámica.
- **Horarios del local en el footer** — sigue siendo `Deferred: OQ-FE-14 (dueño)`, ajeno a esta US.
- **Metadata del `app/layout.tsx` raíz** («DSM — Panel del dueño») — deuda de US-001.

## Superficies afectadas

| Archivo | Acción |
|---|---|
| `apps/web/src/features/legal/content.ts` | **nuevo** — documentos tipados + versión + `status` |
| `apps/web/src/features/legal/content.test.ts` | **nuevo** — los 4 bloques de la Ley 25.326 + forma de la versión |
| `apps/web/src/features/legal/routes.ts` | **nuevo** — fuente única de rutas + copy del consentimiento |
| `apps/web/src/features/legal/routes.test.ts` | **nuevo** — incluye el guard de fuente única |
| `apps/web/src/features/legal/LegalDocument.tsx` | **nuevo** — Server Component presentacional |
| `apps/web/src/features/legal/LegalDocument.test.tsx` | **nuevo** |
| `apps/web/src/features/legal/legalMetadata.ts` | **nuevo** — metadata por documento |
| `apps/web/src/features/legal/legalMetadata.test.ts` | **nuevo** |
| `apps/web/src/features/legal/legalA11y.test.tsx` | **nuevo** — axe sobre las dos páginas |
| `apps/web/src/features/legal/noBackendNoTracking.test.tsx` | **nuevo** — guard AC-6/AC-7/§9 |
| `apps/web/app/(storefront)/legales/privacidad/page.tsx` | **nuevo** |
| `apps/web/app/(storefront)/legales/terminos/page.tsx` | **nuevo** |
| `apps/web/src/features/contact/SiteFooter.tsx` | **modificado** — los dos enlaces reales |
| `apps/web/src/features/contact/SiteFooter.test.tsx` | **modificado** — casos nuevos |
| `apps/web/src/features/storefront/sitemap.ts` | **modificado** — las dos URLs legales |
| `apps/web/src/features/storefront/sitemap.test.ts` | **modificado** — incluidas aun degradando |
| `apps/web/e2e/legal-pages.spec.ts` | **nuevo** — SSR 200, sin login, enlazadas, en el sitemap |
| `apps/web/scripts/check-legal-content.mjs` | **nuevo** — gate de despliegue |
| `apps/web/scripts/check-legal-content.test.mjs` | **nuevo** |
| `apps/web/README.md` | **modificado** — sección de páginas legales + versionado + gate |

## Consumo de API

**Ninguno.** Este change no agrega una sola llamada de red: el contenido legal vive en el
repo (E2E §3, capacidad 10 — «páginas estáticas SSR»). No toca `apps/api/docs/api/openapi.yaml`
ni el cliente generado, así que el gate `frontend-codegen-fresh` no puede verse afectado y no
aplica el mandato de codegen de `frontend-standards.md` §3.1/§3.2 (no hay contrato que
espejar).

El único acoplamiento con el backend es un **valor**, no un endpoint: la versión de términos
que publica la página tiene que ser igual a `LEGAL_TERMS_VERSION` del backend (AC-8). Cómo se
verifica es OQ-FE-16.

## Criterios de aceptación (mapeo)

- [ ] **AC-1** — Política de privacidad en URL pública e indexable. → **construido acá**
- [ ] **AC-2** — Términos y condiciones en URL pública e indexable. → **construido acá**
- [ ] **AC-3** — Enlaces desde el footer en cualquier página. → **construido acá** (el footer
      ya existe: US-018 dejó el hueco marcado)
- [ ] **AC-4** — El checkbox del checkout enlaza a las dos páginas. → **seam acá**
      (`routes.ts` + copy §10.2); el checkbox y la captura son de **US-008**
- [ ] **AC-5** — Contenido con responsable, finalidad, derechos y contacto. → **estructura y
      texto provisional acá**, con test que falla si falta un bloque; **texto final del dueño**
- [ ] **AC-6** — No se opera en producción sin las páginas publicadas y enlazadas. →
      **construido acá** (gate de despliegue + guard de no-dependencia + e2e de los enlaces)
- [ ] **AC-7** — Accesibles sin iniciar sesión. → **construido acá** (route group público,
      verificado en e2e sin cookies)
- [ ] **AC-8** — Queda registrada la versión aceptada. → **mitad FE acá** (versión publicada +
      chequeo de deriva); el registro por orden es de **US-008**

## Estándares consultados

- `spekode/docs/base-standards.md` §1 — KISS/YAGNI: contenido en el repo en vez de CMS o
  endpoint; dos rutas explícitas en vez de ruta dinámica para dos documentos; **no** se
  construye el checkbox de otra US.
- `spekode/docs/code/frontend-standards.md` §2.1 (package-by-feature: `src/features/legal/`),
  §7 (observabilidad — acá se decide **no** instrumentar), §10 (testing), §11.9 (composición de
  estados — no hay estados asíncronos: no hay fetch), **§12** (seguridad: sin secretos en el
  bundle, **sin `dangerouslySetInnerHTML`** para renderizar el texto legal).
- `spekode/docs/code/frontend-next-standards.md` §1 (App Router / route groups), §2 (Server
  Components por defecto — cero JS de cliente), §6 (Metadata API, nunca `<head>` manual;
  sitemap/robots), §7 (presupuesto de JS), §8 (env pública — y por qué acá **no** se agrega una).
- `spekode/docs/quality/qa-frontend-standards.md` §19 (a11y), §23.2 (componente con RTL),
  §23.4 (Playwright), §23.6 (axe).
- `spekode/docs/quality/testing-standards.md` §14 (AAA + naming).
- `docs/product/design-system.md` §7.10 (footer: enlaces legales + datos del local + WhatsApp),
  §10.2 (copy del consentimiento — el que hoy tiene los `(#)` que este change reemplaza),
  §11 (checklist WCAG 2.1 AA: jerarquía de headings, `lang="es-AR"`), §12 (SSR/SEO).
- `docs/architecture/decisions/0010-url-namespace-storefront-vs-admin.md` — la raíz es pública;
  las páginas legales pertenecen a la superficie pública.
- `docs/product/prd.md` §2.1 cap. 10, §6 (retención), §246 (base legal).
- `docs/product/design-e2e.md` §3 fila 10 (capacidad 10 = «Web (páginas estáticas SSR) + flag
  de consentimiento en orden»), §8 (`ORDERS.consent_accepted`), §23 Q-3 (residencia de PII
  resuelta con consentimiento informado + política de privacidad, **esta US**).
- **No se consultó** `api-standards.md`: este change no consume API.

## Preguntas abiertas

> Ninguna bloquea el arranque: las cuatro tienen un default implementado. Las tasks marcadas
> `Gated:` en `tasks.md` esperan ratificación.

- **OQ-FE-15 — ¿Qué URLs llevan las páginas legales?**
  Las URLs de un documento legal son **permanentes en la práctica**: se citan en emails, en el
  checkout y eventualmente en papel; cambiarlas después rompe enlaces que no controlamos.
  - **(a) `/legales/privacidad` + `/legales/terminos`** ← **recomendada**. Agrupa la superficie
    legal bajo un prefijo, deja lugar para un tercer documento sin re-decidir nada, y hace
    trivial una regla de caché o de robots por prefijo si algún día hace falta.
  - **(b) `/privacidad` + `/terminos`** — más cortas y frecuentes en e-commerce AR; a cambio
    ocupan la raíz, que es el namespace de las páginas de producto/categoría de ADR-0010.
  - **(c) Ruta dinámica `/legales/[doc]`** con `generateStaticParams` — DRY, pero agrega una
    rama de `notFound()` y un parámetro validable para dos valores conocidos. Con dos
    documentos, es maquinaria sin uso.

- **OQ-FE-16 — ¿Cómo se garantiza que la versión publicada sea la que registra la orden (AC-8)?**
  El backend de US-008 llena `consent_terms_version` desde `LEGAL_TERMS_VERSION`; la página
  publica la versión del módulo de contenido. Son dos valores en dos sistemas.
  - **(a) Nada: sólo documentarlo.** Costo 0, protección 0 — la deriva es silenciosa y produce
    exactamente el daño que AC-8 quiere evitar (una orden que dice haber aceptado una versión
    que el sitio nunca publicó).
  - **(b) Chequeo de deriva en CI contra `apps/api/.env.example` + gate de deploy** ←
    **recomendada**. El script compara la versión del módulo de contenido con el default
    declarado del backend y **falla** si difieren o si la variable no existe. Cubre el error
    real y frecuente —alguien edita el texto, sube la versión del FE y se olvida del BE— y deja
    la mitad de producción (que el valor de Railway coincida) al gate de despliegue de US-019,
    declarada, no silenciosa. Requiere que US-008 backend haya declarado la variable en su
    `.env.example`: hoy **no existe** (verificado), así que esta task nace `Gated:`.
  - **(c) Fuente única en un archivo raíz** (`legal/version.json`) que consuman los dos apps.
    Es la única que elimina la deriva por construcción, pero mete al backend en la ecuación
    (su config hoy es 100 % env con Zod, y mezclar archivo + env abre la pregunta de cuál gana)
    y toca una disciplina que no es esta. Si el Arquitecto la prefiere, es un cambio chico en
    ambos planes — mejor decidirlo ahora que después de que US-008 esté construida.

- **OQ-FE-17 — ¿Qué hace el sistema mientras el texto legal sea provisional?**
  El texto final es un insumo del dueño (US §10) y puede tardar. El riesgo no es no tenerlo:
  es **publicarlo sin darse cuenta**.
  - **(a) Nada** — el texto provisional puede llegar a producción y el sitio queda incumpliendo
    con apariencia de cumplir. Es el peor de los tres.
  - **(b) `status: 'draft'` bloquea el despliegue** ← **recomendada**. El módulo declara el
    estado del documento y `check-legal-content.mjs` falla mientras sea `draft` o queden
    marcadores de relleno. Local y tests siguen funcionando con el provisional (no bloquea el
    desarrollo, como pide la US §10) y publicar exige un acto explícito: reemplazar el texto y
    cambiar el estado.
  - **(c) Banner visible «borrador»** en la página — honesto con el visitante, pero admite que
    el sitio esté en producción con legales incompletos, que es justo lo que AC-6 prohíbe.

- **OQ-FE-18 — ¿Sigue existiendo `BE-US-017` o queda absorbida?** *(para el Arquitecto)*
  La US §7 le asigna al backend «servir el contenido legal + versionado». Pero el E2E §3 fija
  el contenido como **páginas estáticas SSR** (sin endpoint) y el plan de US-008 backend ya se
  quedó con el versionado (`LEGAL_TERMS_VERSION` + `consent_terms_version` + su `CHECK`). Con
  eso, a `BE-US-017` no le queda trabajo propio. Conviene declararlo —absorbida por US-008— en
  vez de dejar una task fantasma que el flow-auditor va a leer como disciplina sin cobertura.
  Este plan **no depende** de la respuesta.
