# Sprint MVP-2 — 2 días × 4 devs (modo startup)

> Objetivo: pasar el MVP de "catálogo navegable" a un **e-commerce con flujo de compra completo
> + búsqueda IA** (el diferenciador del PRD). Ritmo startup: cada dev es dueño de una **cadena de
> valor** de punta a punta (BE→FE→QA), con handoffs por contrato (contract-first).

## Punto de partida (hoy)

- **Done:** US-001 (admin), US-003 (ficha).
- **A cerrar (chico):** US-002 (browse), US-018 (WhatsApp footer/header).
- **En vuelo:** US-006 BE (import, parcial), US-007 BE (carrito, plan), US-014 (login: BE ✅, FE plan), US-019 (infra).

## Objetivo del MVP-2 (qué queda resuelto al terminar)

**Core transaccional (must):**
| US | Qué habilita |
|---|---|
| US-002 · US-018 | Catálogo navegable cerrado + CTA WhatsApp completa |
| US-014 | Registro / login / sesión de cliente |
| US-007 | Carrito (guest) |
| US-008 | Checkout guest (datos, consentimiento, retiro) |
| US-009 | Pago MercadoPago (hosted) + medio simulado "DSM" |
| US-010 | Webhook de pago → orden registrada → decremento de stock |
| US-017 | Páginas legales + consentimiento (requisito del checkout) |

**Diferenciador IA (high):**
| US | Qué habilita |
|---|---|
| US-006 | Import masivo CSV/Excel (carga catálogo real) |
| US-005 | Enriquecimiento IA de descripciones + embeddings |
| US-004 | Búsqueda semántica en lenguaje natural + fallback |

**Gestión (si sobra tiempo — stretch):**
| US | Qué habilita |
|---|---|
| US-011 | Email de confirmación (Resend) |
| US-012 | Panel de órdenes del dueño |

**Fuera de este sprint:** US-013 (cancelación/reembolso), US-015 (historial), US-016 (métricas), US-020 (borrado de cuenta).

## El demo al terminar

Cliente busca *"heladera para kiosco chica"* (IA) → entra a la ficha → agrega al carrito → checkout con sus datos + consentimiento → paga (medio simulado "DSM" o MP sandbox) → recibe email → el dueño ve la orden y el stock ya decrementado. **Eso es un e-commerce, no un catálogo.**

## Las 4 lanes (1 dev cada una)

| Lane | Dueño | Cadena | Notas |
|---|---|---|---|
| **A — Carrito & Checkout** | Dev A | US-007 → US-008 | La columna del flujo; define contratos que consume B, C, D |
| **B — Pagos & Órdenes** | Dev B | US-009 → US-010 → US-011 | Depende del checkout de A; arranca planeando contra su contrato |
| **C — Búsqueda IA** | Dev C | US-006 → US-005 → US-004 | Cadena independiente; el diferenciador. Necesita GEMINI_API_KEY |
| **D — Cuentas · Legal · Cierres · QA** | Dev D | US-014 FE · US-017 · cerrar US-002/018 · US-012 · QA sweep | Casi todo independiente; sostiene la integración |

> **Regla de oro del paralelo:** cada lane en **worktree aislado** sobre `feature-entrega2-GOSP`.
> Superficies distintas (`apps/api/src/orders`, `.../payments`, `.../search`, `apps/web/...`)
> minimizan choques. El contrato OpenAPI de cada BE (que sale en el `/plan`) **destraba** su FE.

---

## DÍA 1

### Mañana — arrancar las 4 cadenas
```
# Lane A (Carrito):   US-007 ya tiene plan (draft) → a desarrollar
/develop-backend US-007

# Lane B (Pagos):     planear contra el contrato de checkout que definirá A
/plan-backend-ticket US-009

# Lane C (IA):        cerrar el import (base del catálogo real) y encadenar enrichment
/develop-backend US-006      # terminar (estaba parcial)
/plan-backend-ticket US-005  # enrichment + embeddings

# Lane D (Cuentas/Legal): login FE (BE ya está) + cerrar catálogo + legal
/develop-frontend-web US-014
/develop-frontend-web US-018   # cerrar footer/header WhatsApp
```

### Tarde — FE del carrito + avanzar cadenas
```
# Lane A: contrato de carrito listo → FE del carrito
/plan-frontend-web-ticket US-007  &&  /develop-frontend-web US-007

# Lane B: US-009 aprobado → desarrollar pago
/develop-backend US-009

# Lane C: US-005 aprobado → desarrollar enrichment/embeddings
/develop-backend US-005

# Lane D: legal (requisito del checkout) + cerrar QA de US-002
/plan-frontend-web-ticket US-017  &&  /develop-frontend-web US-017
/develop-qa US-002
```

### Cierre Día 1 (audit + commit de lo verde)
```
# por cada US que cerró su vertical, audit aislado + commit
/audit-change US-007-...   (o /audit-backend)   →   /commit
/archive-change US-002-*   /archive-change US-018-*   /archive-change US-014-*
```

---

## DÍA 2

### Mañana — checkout, orden, búsqueda
```
# Lane A: checkout (consume US-007 + US-017 consentimiento)
/plan-backend-ticket US-008  &&  /develop-backend US-008
/plan-frontend-web-ticket US-008  &&  /develop-frontend-web US-008

# Lane B: webhook + orden + decremento de stock (consume el pago de US-009)
/plan-backend-ticket US-010  &&  /develop-backend US-010

# Lane C: búsqueda semántica (consume los embeddings de US-005)
/plan-backend-ticket US-004  &&  /develop-backend US-004
/plan-frontend-web-ticket US-004  &&  /develop-frontend-web US-004

# Lane D: panel de órdenes del dueño (consume US-010) — arranca cuando B libere contrato
/plan-backend-ticket US-012
```

### Tarde — email, panel de órdenes, QA cross-stack e integración
```
# Lane B: email de confirmación
/plan-backend-ticket US-011  &&  /develop-backend US-011

# Lane D: FE del panel de órdenes + QA de todo el flujo
/develop-backend US-012  &&  /plan-frontend-web-ticket US-012  &&  /develop-frontend-web US-012
/plan-qa US-007  &&  /develop-qa US-007      # E2E del flujo de compra completo
/develop-qa US-004                            # E2E de la búsqueda IA

# Lane A/C: QA de sus verticales
/develop-qa US-008     /develop-qa US-005
```

### Cierre Día 2 — el gran merge
```
# audit aislado de cada cadena → commit → archive
/audit-change ...   →   /commit
/archive-change US-007-*  US-008-*  US-009-*  US-010-*  US-004-*  US-005-*  US-006-*  US-017-*  ...
# QA visual manual del flujo completo end-to-end (humano)
# push + PR final de la Entrega/MVP-2
```

---

## Coordinación (no negociable en modo startup)

1. **Worktree por lane** — evita el clobbering del `git add -A` cruzado.
2. **Contract-first** — el FE de una US NO arranca hasta que su BE cierre el contrato OpenAPI (sale en el `/plan`). Por eso A/B/C planean temprano.
3. **Re-seed tras correr tests** — la suite e2e hace `TRUNCATE` de la DB compartida. Después de `pnpm -r test`, correr `pnpm --filter @dsm/db seed`.
4. **Gate humano por US** — cada `/develop` para antes de push; se revisa el diff y el audit aislado antes de `/commit`.
5. **US-009 (MercadoPago)** — necesita credenciales sandbox + test users. Usar el MCP de MercadoPago para crearlas. El medio simulado "DSM" es el fallback si MP no está listo — el demo no depende de MP real.
6. **Secrets** — `GEMINI_API_KEY` (US-005/004), `RESEND_API_KEY` (US-011), `MP_*` (US-009) en `.env`. Sin clave, cada adapter cae a su modo dev/log (no rompe el arranque), pero la feature no es real.

## Riesgos / dónde puede reventar

- **La cadena de pago es secuencial** (007→008→009→010): si el carrito (A) se atrasa, todo B corre detrás. Mitigación: A es la prioridad #1 del Día 1; B planea contra contrato para no quedar ocioso.
- **La cadena IA es profunda** (006→005→004): 3 US encadenadas. Si no llega, el fallback de US-004 (búsqueda por keywords) igual da un demo decente. La búsqueda semántica es lo ambicioso.
- **Realismo:** ~13 US en 2 días es agresivo. Prioridad si hay que recortar: **flujo de compra > login > IA > gestión**. Un MVP con compra real + login ya es un salto enorme; la IA es el bonus que impresiona.
