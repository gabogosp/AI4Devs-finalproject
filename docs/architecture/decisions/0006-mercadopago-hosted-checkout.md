# ADR 0006: Use MercadoPago Checkout Pro (hosted) for guest payments

> **Status**: Accepted
> **Date**: 2026-06-15
> **Decision-makers**: Gabriel Suarez (Arquitecto)
> **Supersedes**: —
> **Superseded by**: —
> **Related**: ADR 0008 (stock decrement on approved payment)

## Context

DSM is an SSR e-commerce for a single-location hardware store in CABA, Argentina, whose buyers check out **as guests** (no account required). The system must close the commercial loop — discover, buy, fulfill — and payment is the gate that converts a cart into a real order. Because the buyer base and the merchant operate in Argentina, the payment experience has to support ARS, local payment methods, and a gateway buyers already trust.

A hard product constraint (PRD §5, §2.1, cap. 4) is that **DSM must never custody card data**: no PAN, no CVV, no card details may transit or rest in our backend or database. Card custody would pull the system into PCI-DSS scope, imposing a compliance, audit, and security burden that is disproportionate for a single-store project and directly contradicts the product's stated security posture. The decision needed here is therefore both *which gateway* and *which integration model* (hosted vs. embedded/transparent).

A second, related force is testability and demonstrability. Stock decrements only on an **approved** payment (ADR 0008), confirmed via an idempotent webhook. The automated end-to-end suite and client demos must be able to exercise the full `pay → decrement → notify` path **deterministically**, without a real charge and without depending on an external sandbox's availability or latency. This makes a controllable "approved payment" signal a load-bearing requirement, not a convenience.

The decision is recorded against the approved E2E design (`docs/product/design-e2e.md`), which assigns this choice the trigger **ADR-006** (§20) and references it across the payment flow (§9.2, §9.5), the STRIDE threat model (§14), and the architecture component view (§19).

## Decision

We will adopt **MercadoPago Checkout Pro (hosted / redirect checkout, token-only)** as the payment gateway for guest checkout, with payment confirmation delivered via an **idempotent webhook**. DSM stores no card data (no PAN, no CVV) and therefore stays **out of PCI-DSS scope**: the backend creates a payment preference, redirects the buyer to MercadoPago's hosted checkout, and reconciles the outcome from the webhook (with re-query to the MercadoPago API before acting).

Additionally, we will provide a **simulated "DSM" payment method** (test/demo mode, behind a feature flag that is **disabled in production**) that marks a payment `approved` without any real transaction, firing the same downstream `pay → decrement → notify` path. This method exists to enable dependency-free client demos and the automated E2E test.

## Consequences

### Positive

- **Out of PCI-DSS scope**: by never touching card data, DSM avoids PCI compliance obligations entirely, removing audit, attestation, and storage-hardening burden.
- **Lower security and compliance surface**: card-handling is the highest-risk data class; delegating it to MercadoPago shrinks the blast radius of any DSM breach.
- **Local buyer trust and payment coverage**: MercadoPago is the dominant Argentine gateway, supports ARS and local payment methods (including installments), and is a recognized, trusted checkout for local buyers.
- **Deterministic demos and E2E tests**: the flagged simulated method gives a controllable `approved` signal, letting the test suite and client demos exercise the full payment path with no external dependency, no real charge, and no flaky sandbox.

### Negative

- **Less seamless UX**: the hosted/redirect flow takes the buyer off-site to MercadoPago and back, which is less smooth than an embedded in-page form. We accept this as the cost of staying out of PCI scope.
- **External dependency and webhook reliability**: payment confirmation depends on MercadoPago availability and on webhook delivery. A missed or delayed webhook can leave orders stuck in `pending_payment`. Mitigated by idempotency (`payment_id` / `idempotency_key`) and state reconciliation by re-querying the MercadoPago API (ADR 0008; E2E §22 recovery path).
- **Simulated method is a risk surface**: a method that approves payments without a charge is dangerous if ever enabled in production. Mitigated by the production-disabled feature flag and the STRIDE control for the payment path (E2E §14); the flag's "off in prod" state must be verified as a release gate.

### Neutral

- **Refunds for real payments go through MercadoPago**: cancellations/refunds of genuine transactions are executed via MercadoPago and reintegrate stock (E2E §9.5); the simulated method has no real money to refund.
- **Webhook signature verification is mandatory**: the integration must validate MercadoPago's `x-signature` and re-query the payment before decrementing stock — a fixed implementation requirement rather than a trade-off.

## Alternatives considered

### Alternative A: MercadoPago transparent / direct API

- **What it would have meant**: collect card data in DSM's own UI and pass PAN/CVV through our backend to MercadoPago's direct API, for a fully embedded checkout.
- **Why rejected**: hard rejection. Card data transiting our backend pulls DSM into **PCI-DSS scope** and violates the non-negotiable no-card-custody rule (PRD §5). The marginal UX gain does not remotely justify the compliance and security cost for a single-store project.
- **What it would have required to change our minds**: a regulatory or business mandate for embedded card capture *and* a willingness to take on full PCI-DSS scope — neither of which applies.

### Alternative B: Stripe or another international gateway

- **What it would have meant**: integrate a global gateway instead of the local incumbent.
- **Why rejected**: MercadoPago is the de facto standard in Argentina — stronger local buyer trust, native ARS handling, and local payment methods/installments. An international gateway would offer weaker local coverage and recognition for guest buyers in CABA.

### Alternative C: No simulated method — real sandbox only for tests

- **What it would have meant**: rely exclusively on MercadoPago's sandbox to drive the payment path in demos and the E2E suite.
- **Why rejected**: sandbox flows are non-deterministic and depend on an external service's availability and latency, making demos and automated tests fragile. A flagged, in-process simulated method yields deterministic, dependency-free runs of the same downstream path.

### Status quo (do nothing)

- **What this would have meant**: ship without an integrated payment gateway.
- **Why rejected**: no payment means no checkout, which means no e-commerce. The product cannot close its core commercial loop without a payment path.

## Implementation notes

- Backend creates a payment **preference** (items, total, back URLs, webhook) and redirects to the hosted checkout; the order is created in `pending_payment` and only advances on an approved, reconciled payment (ADR 0008).
- Webhook handling is **idempotent** (`payments.idempotency_key` UNIQUE + `payments.external_id` = MercadoPago `payment_id`) and verifies the MercadoPago signature, re-querying the API before decrementing stock (E2E §14).
- The simulated method (`POST /checkout/simulate`, provider `simulated_dsm`) is gated by a feature flag that must be **off in production** and fires the same decrement + notification path (E2E §9.2).
- Detailed implementation belongs in the corresponding OpenSpec change, not this ADR.

## Validation criteria

- Monitor MercadoPago **approved/rejected webhook rates**; alert on rejection spikes and on webhook signature-verification failures (E2E §21 observability).
- Verify, as a release gate, that the **simulated-payment feature flag is disabled in production**.
- We will revisit this decision if MercadoPago availability or webhook reliability proves materially insufficient, or if a residency/regulatory constraint forces a different gateway.

## References

- E2E design: `docs/product/design-e2e.md` §9.2, §9.5, §14, §19, §20 (trigger ADR-006)
- PRD: `docs/product/prd.md` §5, §2.1, cap. 4 (hosted, out of PCI scope, never custody card data)
- Related ADR: ADR 0008 — stock decrement on approved payment

---

> **Last updated**: 2026-06-15
> **Author**: Gabriel Suarez (Arquitecto)
