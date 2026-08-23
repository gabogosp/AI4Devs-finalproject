---
type: user-story
id: US-022
slug: actualizacion-dependencias-frontend
parent-prd: docs/product/prd.md
prd-capacity: null
parent-e2e: docs/product/design-e2e.md
status: Backlog
priority: High
estimate-tshirt: S
language: es
created: 2026-08-23
updated: 2026-08-23
authored-by: Gabriel Suarez
disciplines: [FE, QA]
linear-issue-id: null
figma-frames: []
---

# US-022: Actualización de dependencias del frontend (vulnerabilidades críticas)

## 1. La historia (formato Connextra)

**Como** dueño de DSM Ferretería,
**quiero** que el sitio no corra sobre versiones de sus dependencias con vulnerabilidades críticas conocidas y ya parcheadas,
**para** que una falla pública y con exploit disponible no exponga el sitio ni los datos de mis clientes.

## 2. Por qué importa (Valuable)

Esta US **no nace del PRD** sino de un hallazgo: al cerrar el gate de seguridad de
US-006 se midió `pnpm audit` sobre el monorepo y aparecieron **53 high y 5
critical**. La superficie de `apps/api` se saneó ahí mismo (la DoS de multer, con
un override). Lo que quedó está casi todo en `apps/web`, y **dos de las critical
son de `next`, que es el código que corre de cara al público**:

- **RCE en el protocolo React flight** — ejecución remota de código.
- **Bypass de autorización en el middleware** — el mecanismo sobre el que se apoya
  cualquier control de acceso en el borde.

Los dos son de una versión **publicada y con parche disponible**: `next` está en
`15.1.6` y las correcciones están dentro de la misma línea `15.x`. No es un
problema de arquitectura ni requiere un salto de major: es una actualización
pendiente, y ese es exactamente el motivo por el que vale la pena hacerla ya. Una
vulnerabilidad con parche público es la que más barato le sale explotar a un
atacante, porque el advisory le dice dónde mirar.

El PRD (§1.2) pone "que a DSM se la encuentre en Google" como objetivo. Un sitio
comprometido no sólo pierde ventas: pierde posicionamiento y confianza, y los dos
se recuperan mucho más lento que un deploy.

## 3. Criterios de aceptación (Gherkin / Given-When-Then)

### AC-1: Ninguna dependencia de producción con vulnerabilidad critical
```gherkin
Given el monorepo con sus dependencias instaladas
When se audita el árbol de dependencias que llega a producción
Then no hay ninguna vulnerabilidad de severidad critical
And las que queden están documentadas con su motivo y su dueño
```

### AC-2: `next` en una versión sin critical ni high conocidas
```gherkin
Given que `next` está hoy en 15.1.6 con 2 critical y 11 high
When se actualiza a la versión mínima que las corrige
Then `pnpm audit` no reporta ninguna vulnerabilidad de `next`
And la versión resultante sigue dentro de la línea 15.x
```

### AC-3: El sitio sigue funcionando igual después de actualizar
```gherkin
Given el storefront y el panel funcionando antes de la actualización
When se actualizan las dependencias
Then la suite completa del monorepo sigue verde
And el renderizado en servidor, el sitemap y los metadatos siguen intactos
```

### AC-4: Las dependencias de desarrollo también se sanean
```gherkin
Given que `vitest` y `playwright` tienen vulnerabilidades conocidas
When se actualizan
Then sus suites siguen pasando con la misma cobertura
```

### AC-5: El audit queda como gate ejecutable (alternative path)
```gherkin
Given que hoy `pnpm audit --audit-level=high` devuelve exit 1
When termina esta US
Then existe un comando de auditoría que devuelve exit 0
And lo que se haya excluido está declarado explícitamente, no silenciado por bajar el umbral
```

### AC-6: No se actualiza a ciegas (negative space)
```gherkin
Given una dependencia con vulnerabilidad cuya corrección exige un cambio de major
When ese major introduce cambios incompatibles
Then NO se aplica dentro de esta US
And queda registrado como diferido con su motivo, su dueño y su riesgo residual
```

### AC-7: No se silencia una vulnerabilidad para que el gate pase (negative space)
```gherkin
Given una vulnerabilidad que no se puede corregir en esta US
When se configura el gate de auditoría
Then la exclusión es nominal —ese advisory, con su motivo y fecha de revisión—
And NO se sube el umbral de severidad ni se apaga el audit
```

## 4. Out of scope explícito

- **Actualizar `react` / `react-dom` de major** — hoy en 19.0.0 y sin advisories.
  Tocarlos agrega riesgo sin cerrar ningún hallazgo.
- **Actualizar NestJS a 11** — evaluado y descartado: de los 61 hallazgos
  high/critical sólo 2 eran de `multer`, ya resueltos con un override
  (commit `a4ea348`). El major arrastra Express 5 sin cerrar ningún advisory
  adicional. Si se hace, es por otra razón y en otra US.
- **Vulnerabilidades `moderate` y `low`** — 47 y 12 respectivamente. Fuera del
  umbral que esta US se propone cerrar.
- **Endurecimiento de la CI para que audite en cada PR** — es operaciones
  (US-019); acá se deja el comando ejecutable, no el pipeline que lo corre.

## 5. INVEST self-check

| Letra | Criterio | Cumple? | Notas |
|---|---|---|---|
| **I** | Independent | ✅ | No depende de ninguna US; toca versiones, no features. |
| **N** | Negotiable | ✅ | Qué se actualiza y qué se difiere se decide al planificar. |
| **V** | Valuable | ✅ | Cierra dos RCE/bypass en la superficie pública. |
| **E** | Estimable | ✅ | El delta de versiones está medido (ver §10). |
| **S** | Small | ✅ | Bumps dentro de línea + una suite que revalida. |
| **T** | Testable | ✅ | `pnpm audit` y la suite del monorepo son observables. |

## 6. Dependencias

- **Bloqueada por**: ninguna.
- **Bloquea a**: ninguna US funcional. **Pero no conviene desplegar a producción
  (US-019) sin esto**: sería publicar un sitio con dos critical conocidas.

## 7. Tasks asociadas (gruesas, una por disciplina afectada)

| Disciplina | Task id | Estimado (h) | Owner | Estado |
|---|---|---|---|---|
| FE | FE-US-022 | 3-5h | TBD | Todo |
| QA | QA-US-022 | 2-3h | TBD | Todo |

- FE: subir `next` a la mínima sin advisories dentro de 15.x, más `sharp`,
  `postcss` y `undici`; revisar el changelog por cambios de comportamiento en SSR,
  middleware y optimización de imágenes; actualizar `vitest` y `playwright`.
- QA: revalidar las suites propias (E2E de SSR/SEO, a11y, aceptación) contra las
  versiones nuevas y confirmar que la cobertura no bajó.

## 8. Diseño

No aplica: esta US no cambia ninguna superficie visible. El criterio de éxito es
que **nada cambie** salvo los números de versión.

## 9. NFRs específicos de esta US

- **Cero regresión funcional**: la suite del monorepo verde antes y después, con
  el mismo número de tests.
- **SSR intacto**: el HTML servido sigue trayendo el contenido sin ejecutar
  JavaScript (es la base del SEO que persigue el PRD §1.2).
- **LCP < 2.5s** se mantiene tras actualizar `sharp` y la optimización de imágenes.
- La actualización **no** puede introducir dependencias nuevas con vulnerabilidades
  de severidad ≥ high.

## 10. Notas / contexto adicional

Medición del 2026-08-23 (`pnpm audit --audit-level=high`), tras el override de
multer. **El mínimo seguro es el máximo entre todos los advisories del paquete**,
no el del primero que aparece:

| Paquete | Actual | Mínimo seguro | Salto | Corre en | Hallazgos |
|---|---|---|---|---|---|
| `next` | 15.1.6 | **15.5.21** | minor | **producción** | 2 critical + 11 high |
| `vitest` | 2.1.8 | **3.2.6** | **major** | sólo dev | 2 critical |
| `playwright` | 1.49.1 | 1.55.1 | minor | sólo dev | 1 high |
| `sharp` | — | 0.35.0 | — | producción (imágenes) | 1 high |
| `postcss` | — | 8.5.18 | — | build | 2 high |
| `undici` | — | 6.27.0 | — | transitiva | 3 high |

Dos observaciones para quien planifique:

1. **`vitest` 2 → 3 es el único major**, y es de una dependencia que **no llega a
   producción**. Sus dos critical son de escenarios de desarrollo (abrir un sitio
   malicioso con el servidor de UI escuchando). Riesgo real pero de otra clase: si
   el salto rompe la configuración de tests, es candidato legítimo a diferirse por
   AC-6 sin dejar expuesto al cliente.

2. **El resto de los paquetes de la lista son transitivos** (`handlebars`,
   `node-forge`, `tar-fs`, `brace-expansion`, `js-yaml`, `flatted`, `fast-uri`,
   `picomatch`, `glob`, `tmp`, `lodash`, `underscore`, `nanoid`, `vite`). Muchos
   se arrastran solos al subir sus padres; los que no, se resuelven con
   `pnpm.overrides` —el mismo mecanismo que ya se usó para multer— y ésa es la
   herramienta preferida antes que forzar un major del padre.

---

## Definition of Ready (gate Triage → Ready)

- [x] §1 Historia escrita en formato Connextra
- [x] §2 Por qué importa explicado
- [x] §3 Al menos 1 AC en Gherkin (7 AC: 4 happy + 1 alternative + 2 negative-space)
- [x] §5 INVEST con todas las letras OK
- [x] §7 Tasks por disciplina identificadas con estimado en horas
- [x] §8 Diseño resuelto (no aplica — sin superficie visible)
- [x] Dependencias chequeadas (ninguna)

## Definition of Done (gate QA → Done)

- [ ] Todas las tasks de la US en estado Done
- [ ] Regression suite del producto verde en staging
- [ ] AC manuales verificados por QA
- [ ] PO firma acceptance
