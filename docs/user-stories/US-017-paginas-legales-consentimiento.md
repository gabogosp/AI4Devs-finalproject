---
type: user-story
id: US-017
slug: paginas-legales-consentimiento
parent-prd: docs/product/prd.md
parent-e2e: docs/product/design-e2e.md
status: In Progress
priority: High
estimate-tshirt: S
story_points_traditional: 3
story_points_ai_assisted: 1
estimation_basis: "FE páginas de contenido SSR + footer legal (Cohn 2005 §8, 3-5) + BE servir contenido + versionado de términos aceptados (Cohn 2005 §8, 3), tomado el dominante × 0.45 (Peng 2023)"
language: es
created: 2026-06-15
updated: 2026-08-22
ready-at: 2026-06-15
in-progress-at: 2026-08-22
authored-by: Gabriel Suarez
disciplines: [FE, BE, QA]
linear-issue-id: null
figma-frames: []
---

# US-017: Páginas legales + consentimiento

## 1. La historia (formato Connextra)

**Como** negocio (y sus clientes),
**quiero** publicar la política de privacidad y los términos, y que el consentimiento del comprador quede vinculado a ellos,
**para** cumplir con la Ley 25.326 (protección de datos personales) al recolectar datos personales y cobrar.

## 2. Por qué importa (Valuable)

Requisito **legal** para salir a producción en Argentina recolectando PII y cobrando (PRD §2.1 cap. 10). Sin esto el checkout (US-008) no puede ir a producción.

## 3. Criterios de aceptación (Gherkin / Given-When-Then)

### AC-1: Página de política de privacidad
```gherkin
Given el sitio en producción
When un visitante abre la política de privacidad
Then ve la página con el contenido provisto, en una URL pública e indexable
```

### AC-2: Página de términos y condiciones
```gherkin
Given el sitio en producción
When un visitante abre los términos y condiciones
Then ve la página con el contenido provisto, en una URL pública e indexable
```

### AC-3: Enlaces desde el footer
```gherkin
Given cualquier página del sitio
When el visitante mira el footer
Then encuentra enlaces a la política de privacidad y a los términos
```

### AC-4: Enlace + consentimiento desde el checkout
```gherkin
Given el checkout (US-008)
When el cliente revisa el consentimiento
Then el checkbox de aceptación enlaza a las páginas de privacidad y términos
And al aceptar, la orden registra el consentimiento (mecanismo de captura en US-008)
```

### AC-5: Contenido acorde a la Ley 25.326 (alternative path)
```gherkin
Given las páginas legales publicadas
When se revisa su contenido
Then incluyen los datos del responsable del tratamiento, la finalidad del uso de datos, los derechos del titular y un canal de contacto
```

### AC-6: No se opera sin las páginas (negative space)
```gherkin
Given el sitio en producción
When un cliente realiza un checkout
Then el consentimiento referencia páginas legales reales y existentes
And no es posible operar en producción sin que estén publicadas y enlazadas
```

### AC-7: Páginas públicas sin login (negative space)
```gherkin
Given un visitante sin cuenta
When abre la política de privacidad o los términos
Then accede sin necesidad de iniciar sesión
```

### AC-8: Trazabilidad de la versión aceptada (negative space)
```gherkin
Given un comprador que acepta los términos en el checkout
When se crea la orden
Then queda registrada la versión de los términos aceptada (con su marca temporal)
And ese registro permite saber qué versión consintió cada comprador
```

## 4. Out of scope explícito

- **La redacción del texto legal en sí** — la provee el dueño / asesoría legal (es contenido, no desarrollo). Ver §10.
- **El mecanismo de captura del consentimiento en el checkout** — US-008 (acá se garantiza el enlace y la existencia de las páginas + el versionado).
- **Derecho al olvido / borrado de cuenta** — relacionado a cuentas (US-014) y a la política de retención (PRD §6); fuera de esta US.
- **Banner de cookies / gestión de consentimiento de cookies** — fuera de v1 (el MVP no usa tracking de terceros).

## 5. INVEST self-check

| Letra | Criterio | Cumple? | Notas |
|---|---|---|---|
| **I** | Independent | ✅ | Se puede construir de forma autónoma; US-008 la referencia. |
| **N** | Negotiable | ✅ | AC refinables; el contenido lo provee el negocio. |
| **V** | Valuable | ✅ | Habilita el lanzamiento legal a producción. |
| **E** | Estimable | ✅ | 3 SP tradicional / 1 SP AI-asistido. |
| **S** | Small | ✅ | Páginas de contenido + versionado; completable en un cycle. |
| **T** | Testable | ✅ | 8 AC en Gherkin (accesibilidad, enlaces, versionado verificables). |

## 6. Dependencias

- **Relacionada**: US-008 (el checkbox de consentimiento enlaza a estas páginas y captura la aceptación). No bloquea: ambas pueden avanzar en paralelo.
- **Dependencia de contenido (no bloquea el desarrollo)**: el texto legal final lo provee el dueño / asesoría legal antes del lanzamiento a producción.

## 7. Tasks asociadas (gruesas, una por disciplina afectada)

| Disciplina | Task id | Estimado (h) | Owner | Estado |
|---|---|---|---|---|
| FE | FE-US-017 | 4-6h | AI-assisted | **Done** (2026-08-23) |
| BE | ~~BE-US-017~~ | ~~3-5h~~ | — | **Absorbida por US-008** (OQ-FE-18 (a)) |
| QA | QA-US-017 | 3-4h | AI-assisted | **Automatización Done** dentro del change de FE; queda la verificación manual del DoD |

- FE: páginas SSR de política de privacidad y términos (indexables) + enlaces en el footer (y referencia desde el checkout de US-008).
- BE: ~~servir el contenido legal + versionado de términos~~.
- QA: automatización de AC (páginas públicas/indexables, enlaces en footer y checkout, versión registrada).

> **Resolución de OQ-FE-18 (2026-08-23) — `BE-US-017` no tiene trabajo propio.** Las dos mitades
> que la §7 le asignaba desaparecieron por decisiones de diseño ya tomadas, no por recorte:
>
> - **Servir el contenido legal** → no hay nada que servir. El `design.md` de US-017 fija el
>   contenido como **módulo tipado en el frontend** (D1) y la versión **en el código** (D5,
>   ratificada como OQ-FE-16 (b)), en línea con el E2E §3 que ya definía estas páginas como
>   estáticas SSR. Un endpoint para dos documentos que cambian una vez por año le agregaría una
>   dependencia de red a una página cuya razón de ser es estar disponible siempre — y el guard
>   `noBackendNoTracking.test.tsx` lo prohíbe explícitamente. Si algún día el negocio necesita
>   editar los textos sin deploy, ese es el disparador para reabrir esto con un CR del E2E.
> - **Versionado de términos** → se lo quedó **US-008 backend**: `LEGAL_TERMS_VERSION` +
>   `orders.consent_terms_version` + su `CHECK`. No es una cesión de este documento: los propios
>   **AC-4 y AC-8** dicen «mecanismo de captura en US-008». El frontend **verifica** ese contrato
>   en `versionContract.test.ts` —falla si las versiones divergen o si el backend no la declara—
>   en vez de construirlo.
>
> Se descartó dejar la task abierta «por si aparece algo»: sería una task fantasma que nadie
> cierra y que aparece en cada auditoría de flujo como disciplina sin cobertura.

> **Sobre `QA-US-017`: la automatización existe, no lleva change propio.** Es la convención del
> repo —15 de 20 US con `QA` en `disciplines` no tienen change `-qa`; US-004/005/008/009/010
> llevan su `qa-plan.md` dentro del change de backend—. Acá vive dentro del change de FE:
> **T5.1** (8 casos E2E sobre el HTML servido: 200, sin login, sin cookies, enlazadas, en el
> sitemap, y el panel sin enlazarlas), **T3.2** (16 casos de a11y con axe), **T4.3** (contrato de
> versión con el backend) y **T4.2** (15 casos del guard sin red ni telemetría). La trazabilidad
> AC→task, que es lo que un `qa-deliverable.md` aportaría, está en la matriz del `tasks.md`.
> Lo que **no** cubre ninguna disciplina de esta US es el enlace y el checkbox **en el checkout**
> (AC-4) y la versión registrada en la orden end-to-end: los dos son de US-008, cuyo `qa-plan.md`
> ya existe. Lo que queda de QA es la parte **manual** del DoD.

> Las tasks code-generating (FE/BE) abren su openspec change en `openspec/changes/US-017-paginas-legales-consentimiento-{discipline}/`. La task QA vive en `tasks/US-017/qa-deliverable.md`.

## 8. Diseño

- **Tiene Figma**: no. Hereda de `docs/product/design-system.md` — páginas de contenido (tipografía/spacing), footer con enlaces legales (§7.10).

## 9. NFRs específicos de esta US

- Páginas con SSR e indexables (consistente con el objetivo SEO; aunque legales, deben ser accesibles públicamente).
- Versionado de términos: la versión aceptada queda registrada por orden (trazabilidad legal).
- Accesibilidad WCAG 2.1 AA (contenido legible, jerarquía de headings).
- Sin tracking de terceros en estas páginas.

## 10. Notas / contexto adicional

- **Contenido legal**: lo provee el dueño / asesoría legal (datos del responsable, finalidad, derechos del titular, contacto), acorde a la Ley 25.326. El desarrollo entrega el mecanismo (páginas + enlaces + versionado); el texto es un insumo de negocio (análogo a las descripciones de producto). Esto no bloquea el desarrollo: se puede construir con un texto provisional y reemplazarlo antes del lanzamiento.
- El registro del consentimiento por orden (flag + versión + marca temporal) se materializa junto con US-008.

---

## Definition of Ready (gate Triage → Ready)

- [x] §1 Historia escrita en formato Connextra
- [x] §2 Por qué importa explicado
- [x] §3 Al menos 1 AC en Gherkin (8 AC: 4 happy + 1 alternative + 3 negative-space)
- [x] §5 INVEST con todas las letras OK
- [x] §7 Tasks por disciplina identificadas con estimado en horas
- [x] §8 Diseño resuelto (design-system referenciado)
- [x] Dependencias chequeadas (US-008 relacionada no bloqueante; texto legal como insumo de negocio)

## Definition of Done (gate QA → Done)

- [ ] Todas las tasks de la US en estado Done
- [ ] Regression suite del producto verde en staging
- [ ] AC manuales verificados por QA
- [ ] PO firma acceptance
- [ ] Texto legal final provisto y revisado por el dueño / asesoría legal (gate de producción)
