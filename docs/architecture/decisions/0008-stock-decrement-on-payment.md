# ADR 0008: Decrement inventory only on approved payment, via an atomic conditional UPDATE

> **Status**: Accepted
> **Date**: 2026-06-15
> **Decision-makers**: Gabriel Suarez (Arquitecto)
> **Supersedes**: —
> **Superseded by**: —
> **Related**: ADR 0006 (MercadoPago webhook handling), ADR 0002 (PostgreSQL + pgvector as the single datastore)

## Context

The platform is an e-commerce store for a single hardware shop (ferretería) operating from **one physical location with a single stock pool** — there is no per-branch inventory split. Per the PRD, **stock is the single source of truth** for what can be sold, and it must stay correct even though MercadoPago webhooks can arrive **duplicated or late** (E2E §22). The operating envelope is modest: low concurrency, around **50** concurrent users. The team has explicitly decided **not** to build reservation/expiry machinery for the MVP.

The question this ADR answers is: **at what point in the purchase lifecycle do we decrement inventory, and how do we keep that decrement correct under concurrent buyers and unreliable webhook delivery?** The two coupled risks are (1) **overselling** — two buyers paying for the last unit — and (2) **double application** — the same MercadoPago payment decrementing stock twice because the webhook was redelivered.

The system supports two payment paths that both converge on the same effect: the real **MercadoPago webhook** (asynchronous, at-least-once delivery) and a simulated **"DSM"** method used for demos/testing. Stock is deliberately kept decoupled from any external catalog so a future **MercadoLibre downstream sync** can be layered on without re-architecting inventory (E2E §8). The reintegration path on cancellation/refund is already specified in the E2E (§9.5). This decision is the trigger named **ADR-008** in the approved E2E (§20).

## Decision

We will **decrement inventory only when a payment reaches the APPROVED state** — whether signalled by the MercadoPago webhook or the simulated DSM method — never at cart-add or checkout. The decrement is performed **per line item, inside a single database transaction**, using an **atomic conditional UPDATE**:

```sql
UPDATE products SET stock = stock - :qty WHERE id = :id AND stock >= :qty
```

A row affecting zero rows means insufficient stock and aborts the transaction for that order. The `products.stock` column carries a `CHECK (stock >= 0)` constraint as a final database-level guardrail. Webhook processing is made **idempotent** by a `UNIQUE` constraint on `payments.external_id` (the MercadoPago `payment_id`) combined with order/payment state checks, so a given payment is applied **exactly once** regardless of duplicate or late deliveries. On cancellation or refund, stock is **reintegrated** (E2E §9.5).

## Consequences

### Positive

- **Correct under concurrency without locks**: the `WHERE stock >= :qty` predicate makes the decrement an atomic compare-and-set; concurrent buyers for the last unit are serialized by the row write, and the `CHECK (stock >= 0)` constraint guarantees stock can never go negative even if application logic regresses.
- **Idempotent against unreliable webhooks**: `payments.external_id` UNIQUE plus state checks mean a redelivered or late MercadoPago notification (E2E §22) is recognized and skipped, so a payment is never applied twice.
- **No reservation/expiry machinery**: there is no reservation table, no TTL, and no background expiry job to operate, monitor, or debug — appropriate for the ~50-concurrency MVP.
- **Stock stays authoritative and decoupled**: inventory is decremented by an internal, payment-driven event rather than by any external catalog, preserving the single source of truth and leaving room for the future MercadoLibre downstream sync (E2E §8).

### Negative

- **Sell-out between add-to-cart and payment approval**: because stock is held by no one until payment is approved, the last unit can be sold to a faster-paying buyer while another buyer is mid-payment. The losing buyer is **informed and either not charged (if still mid-payment) or auto-refunded (if their payment was already approved — the conditional UPDATE returns zero rows, so the transaction rolls back, the order is cancelled, and the payment is refunded, per E2E §9.2)** — a deliberate UX trade-off accepted at this concurrency level, not an oversell or a billing error.
- **Dependence on webhook delivery**: the decrement is driven by payment confirmation, so a webhook that never arrives leaves an approved-but-not-decremented gap. This is **mitigated by reconciliation** — querying MercadoPago for payment state — rather than trusting delivery alone.

### Neutral

- **Refund/cancellation reintegrates stock**: the reverse path adds the units back (E2E §9.5); this is symmetric to the decrement and is the expected behaviour rather than a benefit or cost.
- **Two payment paths, one effect**: the real MercadoPago webhook and the simulated DSM method both funnel through the same approved-payment decrement logic, so behaviour is identical in demo and production.

## Alternatives considered

### Alternative A: Reserve stock at checkout with a TTL, confirm on payment

**What it is**: Hold (reserve) the requested quantity when the buyer enters checkout, with an expiry (TTL); convert the reservation to a permanent decrement on payment approval, or release it when the TTL lapses.

**Pros**: Better UX — a buyer who reaches checkout cannot have the item sold out from under them during payment.

**Cons**: Introduces a reservation state, an expiry/cleanup background job, and the associated edge cases (released-too-early, released-too-late, crash between reserve and confirm).

**Why rejected**: The complexity is not justified at ~50 concurrency, where the sell-out-during-payment window is rarely hit, and the team explicitly excluded reservation/expiry machinery from the MVP.

### Alternative B: Pessimistic locking (`SELECT ... FOR UPDATE`) on every checkout

**What it is**: Lock each product row with `SELECT ... FOR UPDATE` before checking and decrementing, holding the lock for the duration of the checkout transaction.

**Pros**: Conceptually straightforward serialization; guarantees no two transactions read stale stock.

**Cons**: Holds locks across the transaction, creating contention and head-of-line blocking on popular SKUs.

**Why rejected**: The atomic conditional UPDATE achieves the same correctness without holding locks — it is a single, short, self-contained write — so the heavier contention of pessimistic locking buys nothing.

### Alternative C: Application-level distributed lock (Redis)

**What it is**: Acquire a Redis lock per product before decrementing, releasing it after the write.

**Pros**: Decouples the mutual-exclusion mechanism from the database.

**Cons**: Adds an extra moving part (lock service availability, lock expiry tuning, split-brain on Redis failover) and makes the database no longer the sole authority for stock correctness.

**Why rejected**: The DB-level `CHECK` constraint plus the atomic conditional UPDATE are simpler and authoritative; an external lock would add operational surface without improving correctness.

### Do nothing (decrement at cart-add or checkout)

**What it is**: Continue with the naive approach of decrementing stock when an item is added to the cart or at checkout, before payment is confirmed.

**Pros**: No payment-event wiring needed; the decrement happens early and synchronously.

**Cons**: Stock is held for **abandoned carts**, and items would be decremented for payments that ultimately **fail**, causing phantom stock-outs and overselling against real inventory.

**Why rejected**: It breaks the "stock is the source of truth" invariant — stock would reflect intent rather than committed sales — which is exactly the failure mode this decision exists to prevent.

## Implementation notes

- The conditional UPDATE and the `payments` insert/state transition execute inside **one transaction per order**; if any line item returns zero affected rows, the transaction rolls back and the order is not marked paid.
- Idempotency hinges on the `payments.external_id` UNIQUE constraint catching duplicate MercadoPago `payment_id` values plus an explicit order/payment **state check** so an already-applied payment is short-circuited before any decrement.
- A **reconciliation** routine should query MercadoPago for payment state to cover webhooks that never arrive (see ADR 0006).
- Detailed sequencing belongs in the corresponding OpenSpec change, not in this ADR.

## Validation criteria

- We expect the `CHECK (stock >= 0)` constraint to **block all oversell attempts**; monitor the count of blocked attempts and duplicate-webhook hits as a health signal.
- We will revisit this decision if **concurrency rises** enough that sell-out-between-add-to-cart-and-payment becomes a recurring buyer complaint — at which point Alternative A (reservation + TTL) becomes the likely successor.

## References

- `docs/product/design-e2e.md` §8 (inventory decoupling / MercadoLibre downstream sync), §9.2 (payment-approval decrement), §9.5 (refund/cancellation reintegration), §20 (ADR-008 trigger), §22 (duplicated/late webhooks)
- `docs/architecture/data-standards.md`
- ADR 0006 — MercadoPago webhook handling
- ADR 0002 — PostgreSQL + pgvector as the single datastore

---

> **Last updated**: 2026-06-15
> **Author**: Gabriel Suarez (Arquitecto)
