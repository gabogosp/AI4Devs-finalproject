---
type: user-story
id: US-023
slug: pago-manual-offline
parent-prd: docs/product/prd.md
parent-e2e: docs/product/design-e2e.md
prd-capacity: 4   # CAP-4 «Checkout y pago» — adaptador de pago que NO depende de MercadoPago
status: Backlog
priority: High
estimate-tshirt: TBD
language: es
created: 2026-08-30
updated: 2026-08-30
authored-by: Gabriel Suarez
disciplines: [BE, FE, QA]
linear-issue-id: null
figma-frames: []
---

# US-023: Pago manual / offline (confirmación del dueño)

> **Skeleton en `Backlog`** — pendiente de `/enrich-user-story US-023` para completar
> AC en Gherkin, edge cases, NFRs y tasks por disciplina, y pasar el gate DoR → `Ready`.

## 1. La historia (formato Connextra)

**Como** dueño de DSM,
**quiero** poder marcar una orden como pagada cuando el comprador abona por un medio
offline (transferencia bancaria o efectivo, coordinado por WhatsApp),
**para** completar la venta y disparar el descuento de stock **sin depender de una pasarela
de pago online**.

## 2. Por qué importa (Valuable)

- El modelo de venta principal de DSM ya es **coordinar por WhatsApp** (US-018): el pago
  por transferencia/efectivo es la contracara natural, no un stub descartable — queda como
  **método de pago real en producción**, junto a MercadoPago cuando exista.
- Desbloquea el vertical **checkout → pago → orden** de punta a punta **sin credenciales de
  MercadoPago**, que hoy no tenemos (US-009 queda on hold por dependencia externa).
- Habilita a US-010 (descuento de stock al confirmarse el pago) a construirse contra un
  evento real de pago, sin webhook de MP.

## 3. Decisión de arquitectura (contexto para el enrich)

- **US-023 es dueña del `PaymentConfirmationPort`** — el puerto que hoy vive en el diseño de
  US-009 (`design.md` §: `PaymentConfirmationPort.confirm()`, el mismo método que iban a
  invocar el webhook de MP y US-010/011/013). Se **extrae** de US-009 a esta US para que el
  puerto no dependa de MercadoPago.
- **MercadoPago pasa a ser un adaptador** del mismo puerto (US-009), enchufable cuando haya
  credenciales. US-009 → **on hold**.
- El adaptador de esta US (`ManualPaymentProvider` o equivalente) transiciona la orden de
  `pending_payment` → `paid` cuando el dueño confirma, e invoca `confirm()` — idéntico
  contrato que un pago aprobado real.
- La acción "Confirmar pago" del dueño **vive en el panel de órdenes (US-012)**.

## 4. Criterios de aceptación (Gherkin)

> **[Pendiente del enrich]** — bosquejo de dirección; `/enrich-user-story` los formaliza
> (happy + alternative + negative-space) y agrega los que falten.

- Happy: el dueño confirma el pago de una orden `pending_payment` → pasa a `paid` y se
  descuenta stock (vía US-010).
- Negative-space (candidatos a confirmar en el enrich): sólo el dueño autenticado puede
  confirmar; no se puede confirmar dos veces (idempotencia); no se confirma una orden ya
  pagada/cancelada; queda registro auditable de quién confirmó y cuándo.

## 5. Dependencias

- **Bloqueada por**: **US-008** (checkout guest — crea la orden en `pending_payment`; su BE
  ya está hecho).
- **Relacionada**: US-012 (panel del dueño donde vive la acción), US-010 (descuento de stock
  al confirmar), US-009 (adaptador MercadoPago del mismo puerto, on hold).

## 6. Out of scope

- Integración con MercadoPago u otra pasarela online (US-009).
- Conciliación de webhooks / reintentos de pasarela (US-010, parte MP).
- Facturación fiscal / comprobantes AFIP (roadmap).

---

## Definition of Ready (gate Backlog → Ready) — pendiente del enrich

- [ ] §1 Historia escrita en formato Connextra
- [ ] §2 Por qué importa explicado
- [ ] §4 Al menos 1 AC en Gherkin (happy + negative-space)
- [ ] §5 INVEST con todas las letras OK
- [ ] §7 Tasks por disciplina identificadas con estimado
- [ ] §8 Diseño resuelto (design-system referenciado)
- [ ] Dependencias chequeadas
