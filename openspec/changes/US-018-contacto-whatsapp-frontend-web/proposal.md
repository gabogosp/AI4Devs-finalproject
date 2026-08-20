---
tracker-id: null
tracker-source: null
parent-us: US-018
discipline: frontend-web
variant: null
language: es
created: 2026-08-19
---

# US-018 Frontend Web — Canal de contacto por WhatsApp

> **Este plan es corto a propósito.** Una parte grande de US-018 **ya está construida** por
> US-003 (ficha de producto). El primer trabajo de esta sesión fue **auditar el código
> entregado contra los 5 AC**, no re-planificar lo que existe. El resultado está en
> §"Lo que ya está construido": **AC-2 y AC-3 se dan por satisfechos con evidencia**, AC-5
> está satisfecho **a medias**, y **AC-1 no existe en absoluto**. Este change construye
> solamente el hueco.

## Why

WhatsApp es el canal de contacto dominante en Argentina. El PRD lo declara capacidad 12
(*Should*, "consultas pre y post-venta") y el E2E §55 lo resuelve sin backend: enlace público
`wa.me`, sin API de WhatsApp Business. Para una tienda que arranca con **cero reputación
digital** (PRD §1.2), el canal humano no es un adorno: el `design-system.md` §7.14 lo lista
como una de las cinco señales de confianza (`TrustSignals`) que sostienen la conversión, junto
al sello de pago seguro y el local físico verificable.

Hoy ese canal existe **en un solo punto del recorrido**: la ficha de un producto sin stock
(US-003). Es el momento de máxima intención —el cliente quiso comprar algo puntual y no
pudo— pero es también el **único** momento. Un visitante que llega a la home, navega un
rubro, mira una ficha con stock y quiere preguntar por horarios, disponibilidad o el estado
de un pedido no tiene por dónde. El `design-system.md` §7.10 declara el enlace de WhatsApp
tanto en el **top-nav** como en el **footer** — y **el sitio hoy no tiene footer en absoluto**.

Hay además una deuda estructural que AC-5 obliga a saldar ahora y no después: la URL `wa.me`
se compone **inline dentro de `ProductPurchase.tsx`**. Con un solo consumidor eso pasaba;
con tres (ficha + header + footer) se convierte exactamente en el "duplicado/hardcodeado
disperso por el código" que AC-5 prohíbe. El momento barato de extraerlo es antes de sumar
los dos consumidores nuevos, no después.

## What changes

- **Un único constructor del enlace (AC-5)**: nace `src/features/contact/whatsapp.ts` con
  `whatsappHref(message?)` y el catálogo de mensajes prellenados. Es la **única** parte del
  código que compone una URL `wa.me`; `ProductPurchase` deja de componerla y pasa a
  consumirla (refactor *behavior-preserving*, con los tests de US-003 como red de seguridad).
- **`WhatsAppLink` compartido**: componente presentacional con la forma que US-003 ya validó
  —ícono **+ texto** (nunca sólo ícono, §7.14), `target="_blank"` + `rel="noopener noreferrer"`,
  área táctil ≥44px, focus ring `shadow-focus`— parametrizado por etiqueta, mensaje y variante.
- **`SiteFooter` (nuevo — el sitio no tiene footer)**: montado en el layout del route group
  `(storefront)`, así que aparece en **toda** página pública (home, rubro, ficha) sin tocar
  ninguna de ellas. Lleva el canal de WhatsApp (`"Hablá con nosotros"`, §7.14), el nombre y la
  dirección del local. Los links legales quedan `Deferred: US-017` y los horarios reales
  `Deferred: OQ-FE-14`.
- **Enlace de WhatsApp en el header del storefront** (§7.10 top-nav), a la derecha del
  wordmark, con la misma pieza compartida.
- **El panel del dueño NO lo lleva** (ADR-0010): `(admin)` y `(auth)` son la superficie
  privada del dueño; el canal de atención al cliente no tiene sentido ahí. Es una decisión
  explícita, no un olvido — ver `design.md` D2.
- **AC-4 pasa de "es verdad" a "está probado"**: se construye un guard que **falla** si
  alguien enruta el contacto por la API o filtra datos del comprador al mensaje/URL. Hoy la
  propiedad se cumple pero nada la protege.
- **Guard del número placeholder (OQ-FE-12)**: script de despliegue que impide publicar con
  el `5491100000000` de fábrica. Depende de ratificación — ver §Preguntas abiertas.

## Lo que ya está construido (auditado contra el código, 2026-08-19)

Verificado leyendo los archivos, no asumido:

| Evidencia | Qué cubre |
|---|---|
| `apps/web/src/features/storefront/ProductPurchase.tsx:34-57` | Con `in_stock: false` renderiza un `<a>` a `https://wa.me/{phone}?text=...` con el mensaje **prellenado que referencia el producto** (`Hola! Quería consultar por "{productName}".`, `encodeURIComponent`), ícono Lucide `MessageCircle` **+ texto** ("Avisame por WhatsApp"), `target="_blank"`, `rel="noopener noreferrer"`, `min-h-[44px]`, `focus-visible:shadow-focus` y el copy §10.2 ("Sin stock por ahora. Escribinos por WhatsApp…"). Incluye el fix de contraste `text-gray-600` sobre `bg-gray-100` que la sesión de QA detectó con axe en browser real (4.39:1 < 4.5:1; jsdom no mide contraste). |
| `apps/web/src/lib/env.ts:28-31` | `NEXT_PUBLIC_WHATSAPP_PHONE` declarada, validada con Zod (`/^\d{8,15}$/`, sólo dígitos como espera `wa.me`), documentada como dato público-no-secreto, con default placeholder. |
| `apps/web/.env.example:14` + `apps/web/README.md:67` | La variable está documentada en ambos lugares, con la advertencia de que el número real es OQ-FE-3. |
| `apps/web/src/features/storefront/ProductPurchase.test.tsx:45-70` | Cubre: enlace presente, `href` a `wa.me`, nombre accesible desde el texto, `rel` con `noopener`, mensaje prellenado con el nombre del producto, copy §10.2, y **ausencia** del enlace cuando hay stock. |
| `apps/web/src/features/storefront/a11y.test.tsx:29-79` | axe sin violaciones sobre el estado *sin stock* + assert explícito de nombre accesible del enlace. |
| `apps/web/e2e/pdp-ssr.spec.ts:37-50` | E2E contra el servidor de producción: la ficha sin stock devuelve **200** y su HTML **servido** contiene `wa.me` y no contiene "Agregar al carrito". |

**Conclusión de la auditoría por AC:**

- **AC-2 (consulta desde ficha sin stock) — SATISFECHO.** Construido y probado en tres capas
  (componente, a11y, E2E SSR). Este change **no lo re-construye**: sólo lo preserva a través
  del refactor de T1.3, con los tests existentes como criterio de no-regresión.
- **AC-3 (apertura en escritorio) — SATISFECHO por la forma del enlace, sin task de
  construcción.** `wa.me` resuelve el desvío a WhatsApp Web / app de escritorio del lado del
  servicio: un `<a href="https://wa.me/{digits}">` es *exactamente* el mecanismo que la
  documentación pública define para eso. Cualquier detección de dispositivo del lado nuestro
  sería peor (User-Agent sniffing es frágil, se rompe con cada release de navegador y
  duplicaría una decisión que WhatsApp ya toma mejor que nosotros). Lo que sí se hace es
  **blindar la forma**: los tests de T1.1/T1.2 fijan que el href es la forma canónica
  `https://wa.me/<sólo-dígitos>[?text=]` y el E2E de T4.1 lo verifica sobre el HTML servido.
  Es una verificación, no una construcción.
- **AC-4 (sin backend, sin datos sensibles) — VERDADERO PERO NO PROBADO.** Auditado: no hay
  `fetch` en el camino del contacto (el único `fetch` de la app sigue siendo `customFetch`,
  F48) y el mensaje sólo lleva el nombre del producto. Pero **ningún test falla** si mañana
  alguien lo enruta por la API o le agrega el email del comprador al texto. T3.1 construye
  ese guard.
- **AC-5 (número configurable, fuente única) — SATISFECHO A MEDIAS.** El **número** sí tiene
  fuente única (`env.ts`). La **URL** no: se compone inline en `ProductPurchase`. Con el
  header y el footer serían tres composiciones idénticas del mismo string. T1.1 + T1.3
  cierran la mitad que falta y el gate de T1.1 lo mantiene cerrado.
- **AC-1 (header/footer) — NO EXISTE.** `apps/web/app/(storefront)/layout.tsx` renderiza sólo
  el wordmark + `CategoryNav`; **no hay ningún `<footer>` en toda la app** (verificado con
  grep sobre `apps/web/src` y `apps/web/app`). Es el grueso de este change.

## Out of scope

- **Chatbot / atención automatizada y API de WhatsApp Business** — US §4, roadmap del PRD.
- **Notificaciones transaccionales por WhatsApp** — van por email (US-011).
- **Páginas legales (privacidad / términos)** — `Deferred: US-017`. El footer deja el lugar
  preparado pero no inventa páginas que no existen.
- **Horarios de atención del local** — dato del dueño, ya listado como pregunta abierta del
  propio `design-system.md` §Preguntas abiertas. `Deferred: OQ-FE-14`.
- **Resto del top-nav** (buscador, carrito, cuenta) — `Deferred: US-004 / US-007 / US-014`.
- **`TrustSignals` completo** (sello de pago seguro, mini-mapa, "retirás y revisás") — §7.14
  es un bloque de cinco señales; acá se entrega sólo la del canal humano, que es la que US-018
  pide. `Deferred: US-008 / US-009`.
- **Metadata del `app/layout.tsx` raíz** (hoy dice "DSM — Panel del dueño") — deuda heredada
  de US-001, ajena a esta US.

## Superficies afectadas

| Archivo | Acción |
|---|---|
| `apps/web/src/features/contact/whatsapp.ts` | **nuevo** — único constructor del href + mensajes |
| `apps/web/src/features/contact/whatsapp.test.ts` | **nuevo** |
| `apps/web/src/features/contact/WhatsAppLink.tsx` | **nuevo** — pieza compartida |
| `apps/web/src/features/contact/WhatsAppLink.test.tsx` | **nuevo** |
| `apps/web/src/features/contact/SiteFooter.tsx` | **nuevo** |
| `apps/web/src/features/contact/SiteFooter.test.tsx` | **nuevo** |
| `apps/web/src/features/contact/contactA11y.test.tsx` | **nuevo** — axe sobre header + footer |
| `apps/web/src/features/contact/noBackend.test.tsx` | **nuevo** — guard AC-4 |
| `apps/web/app/(storefront)/layout.tsx` | **modificado** — enlace en header + `<SiteFooter />` |
| `apps/web/src/features/storefront/ProductPurchase.tsx` | **modificado** — refactor a la pieza compartida |
| `apps/web/e2e/site-contact.spec.ts` | **nuevo** — enlace SSR en toda página pública |
| `apps/web/scripts/check-whatsapp-configured.mjs` | **nuevo** (gated OQ-FE-12) |
| `apps/web/README.md` | **modificado** — sección del canal de contacto |

## Consumo de API

**Ninguno.** Este change no agrega ni una sola llamada de red — es la propiedad central de
AC-4 y T3.1 la convierte en un invariante chequeable. No toca `apps/api/docs/api/openapi.yaml`
ni el cliente generado, así que el gate `frontend-codegen-fresh` no puede verse afectado.

## Criterios de aceptación (mapeo)

- [ ] **AC-1** — Header y footer del storefront ofrecen el enlace de WhatsApp en toda página
      pública, y activarlo abre la conversación con el número del local. → **construido acá**
- [x] **AC-2** — Consulta desde ficha sin stock con mensaje que referencia el producto.
      → **ya satisfecho** (US-003); preservado por T1.3
- [x] **AC-3** — Apertura en escritorio (WhatsApp Web / app). → **ya satisfecho** por la forma
      del enlace; verificado acá, no construido
- [ ] **AC-4** — Sin llamada al backend y sin exponer datos sensibles. → **verdadero hoy;
      probado acá**
- [ ] **AC-5** — Número (y ahora enlace) de fuente única, sin duplicación dispersa.
      → **medio satisfecho; completado acá**

## Estándares consultados

- `spekode/docs/base-standards.md` — KISS/YAGNI (§1): el enlace `wa.me` es la solución más
  simple que funciona; nada de device detection ni de API de WhatsApp Business.
- `spekode/docs/code/frontend-standards.md` §2.1 (package-by-feature), §7 (observabilidad),
  §10 (testing), §11.9 (composición de estados), **§12** (seguridad: sin secretos en el
  bundle, sin `dangerouslySetInnerHTML`, headers de seguridad ya cableados en `next.config`).
- `spekode/docs/code/frontend-next-standards.md` §1 (App Router / route groups), §2 (Server
  Components por defecto — el footer no lleva JS al cliente), §7 (presupuesto de JS de
  cliente), §8 (env pública vs secreto), §8.bis (headers de seguridad).
- `spekode/docs/quality/qa-frontend-standards.md` §19 (a11y), §23.2 (componente con RTL),
  §23.4 (Playwright), §23.6 (axe).
- `spekode/docs/quality/testing-standards.md` §14 (AAA + naming).
- `docs/product/design-system.md` §7.10 (top-nav + footer), §7.14 (`TrustSignals` — canal
  humano, "texto + ícono, nunca sólo ícono"), §8 (Lucide `message-circle`), §10.2 (voz/tono),
  §11 (checklist WCAG 2.1 AA).
- `docs/architecture/decisions/0010-url-namespace-storefront-vs-admin.md` — qué route group
  es público y cuál privado.
- **No se consultó** `api-standards.md`: este change no consume API (AC-4).

## Preguntas abiertas

> Las tres necesitan ratificación del usuario **antes de ejecutar** las tasks marcadas
> `Gated:` en `tasks.md`. Ninguna bloquea el resto del plan.

- **OQ-FE-3 (heredada de US-003 y US-002)** `[Deferred: dato del cliente — owner: PO/cliente,
  revisit: antes del primer deploy (US-019)]` **El número real de WhatsApp de DSM sigue
  pendiente.** El default `5491100000000` es un placeholder. **No bloquea el desarrollo**
  (todo se cablea contra la env), pero **sí bloquea el despliegue**: publicado con el
  placeholder, el sitio ofrece un canal de contacto que no existe — peor que no ofrecerlo,
  porque el cliente escribe y nadie responde. Ver §"Recomendación de despliegue" del
  `design.md`.

- **OQ-FE-12 — ¿Cómo se impide que el placeholder llegue a producción?**
  `[Resolved: 2026-08-20 — opción (c): script en el job de despliegue]` Ratificado por el usuario.
  El gate va donde está el riesgo real —publicar—, no en el build: un guard en `env.ts` rompería
  hoy la suite E2E, porque el `webServer` de Playwright levanta un build de producción sin esa
  variable definida. El enganche al pipeline queda `Deferred: US-019`.
 El riesgo de OQ-FE-3
  no se mitiga con una nota en un doc; alguien tiene que fallar ruidosamente.
  - **(a) Sólo checklist de despliegue.** Costo 0, protección 0 — depende de que un humano se
    acuerde. Es el estado actual.
  - **(b) Guard en `env.ts`**: `NEXT_PUBLIC_WHATSAPP_PHONE === '5491100000000' && NODE_ENV === 'production'`
    → `throw`. Protege de verdad, pero **rompe la suite E2E hoy mismo**: el `webServer` de
    Playwright corre `pnpm build && pnpm start` (build de producción) sin pasar esa env, así
    que todos los specs morirían en el arranque. Habría que inyectar un número falso en el
    `playwright.config.ts`, que es exactamente el tipo de excepción que después nadie recuerda
    por qué está.
  - **(c) Script de gate en el pipeline de despliegue** — `apps/web/scripts/check-whatsapp-configured.mjs`,
    que falla con exit code ≠ 0 si la env está ausente o es el placeholder, invocado **sólo**
    en el job de deploy (no en `build` local ni en E2E).
  - **Recomendación: (c).** Pone el gate donde está el riesgo real (publicar), sin contaminar
    el build local ni la suite. El cableado al pipeline pertenece a **US-019** (infra), así que
    este change entrega el script + su test y deja el enganche `Deferred: US-019` — declarado,
    no silencioso.

- **OQ-FE-13 — ¿Se instrumenta el click de WhatsApp?**
  `[Resolved: 2026-08-20 — opción (c): sólo desde la ficha sin stock]` Ratificado por el usuario.
  `ProductPurchase` ya es `'use client'`, así que el costo marginal es cero y header/footer siguen
  siendo Server Components puros —sin JavaScript de cliente en toda página pública—. Es además la
  medición que más dice: demanda perdida por falta de stock. El evento `whatsapp_click` entra en
  `PUBLIC_EVENTS` para que no cargue `operator_id: 'admin'`.
 Capacidad 12 es *Should*; sin telemetría
  no se sabrá si se usa y no habrá dato para decidir si vale invertir en el chatbot del roadmap.
  - **(a) Sin evento.** El footer y el header quedan **Server Components puros, cero JS de
    cliente** en toda página pública. Cuesta 0 y no se aprende nada.
  - **(b) Evento en los tres puntos** (header, footer, ficha). Requiere convertir el footer y
    el header en Client Components → JS de cliente en **todas** las páginas públicas, contra
    `frontend-next-standards.md` §7, para medir un click de salida del sitio.
  - **(c) Evento sólo en la ficha sin stock.** `ProductPurchase` **ya es** `'use client'`, así
    que el costo marginal en bytes es **cero**. Y es el punto de intención cualificada: mide
    "cuánta demanda se pierde por falta de stock", que es una pregunta de negocio real; el
    click en el footer es ruido comparado. Evento `whatsapp_click` con `{ context: 'pdp_out_of_stock' }`,
    registrado en `PUBLIC_EVENTS` para que **no** lleve `operator_id: 'admin'`.
  - **Recomendación: (c).**

- **OQ-FE-14 — ¿Qué más lleva el footer además de WhatsApp?**
  `[Resolved: 2026-08-20 — opción (a): mínimo honesto]` Ratificado por el usuario: datos del local,
  dirección y WhatsApp; sólo lo que hoy es cierto. Un enlace legal apuntando a `#` en producción es
  peor que no tenerlo (Ley 25.326). Legales `Deferred: US-017`; horarios `Deferred: a confirmar con
  el dueño`.
 El `design-system.md` §7.10 lo
  define con legales + datos del local + WhatsApp, pero ni los horarios reales (pregunta
  abierta del propio design-system) ni las páginas legales (US-017) existen todavía.
  - **(a) Footer mínimo honesto**: nombre del local + dirección (dato conocido, §7.14) +
    WhatsApp. Los legales y horarios entran cuando existan.
  - **(b) Footer completo con placeholders visibles** ("Horarios: a confirmar", links legales
    a `#`). Un link legal a `#` en producción es peor que no tenerlo: en Argentina la política
    de privacidad es requisito legal (PRD §246), y un link roto sugiere que existe.
  - **(c) Esperar a US-017** y no hacer footer ahora — pero entonces AC-1 no se cumple.
  - **Recomendación: (a).**
</content>
</invoke>
