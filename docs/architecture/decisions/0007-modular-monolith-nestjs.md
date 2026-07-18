# ADR 0007: Build the backend as a modular monolith in NestJS

> **Status**: Accepted
> **Date**: 2026-06-15
> **Decision-makers**: Gabriel Suarez (Arquitecto)
> **Supersedes**: —
> **Superseded by**: —
> **Related**: ADR 0001 (Railway as the deployment platform), ADR 0004 (Redis + BullMQ worker for asynchronous processing)

## Context

The product is an e-commerce platform for a single-location hardware store (ferretería). It must close the full commercial loop — discover (browse + semantic search), buy (cart + guest checkout via MercadoPago), and fulfil (owner's order panel) — with **stock as the single source of truth**. The backend therefore spans a broad set of domains: catalog, search, enrichment, cart, checkout, payments, orders, stock, auth/customers, import, metrics, and notifications (see the C4 component view in `docs/product/design-e2e.md` §6.1).

The operating envelope is deliberately modest: a **solo / small team**, a **hardware-store budget**, and an **MVP** scope. Operational simplicity is an explicit, first-class priority — every additional deployable, network hop, and distributed-transaction boundary is a cost the team must carry indefinitely, with no platform team to absorb it. This shapes the decision more than raw scalability does.

At the same time, the PRD roadmap (`docs/product/prd.md` §2.2) includes **MercadoLibre stock synchronization**, where the e-commerce remains the authoritative source of truth and MercadoLibre becomes a **downstream channel**. The architecture must not preclude that: the stock domain has to stay decoupled enough to later expose a clean seam for a downstream-channel adapter, without forcing a service-extraction effort today.

This raises the question this ADR answers: **how do we structure the backend so it is the simplest thing to build, deploy, and operate for a solo team at MVP scale, while preserving clean domain boundaries and a future path to the MercadoLibre channel?**

## Decision

We will build the backend as a **modular monolith in NestJS**: a **single deployable API** organized into **domain modules** — catalog, search, enrichment, cart, checkout, payments, orders, stock, auth/customers, import, metrics, and notifications — that communicate through explicit in-process module boundaries rather than network calls.

A **separate worker process** (defined in ADR 0004) runs asynchronous jobs (import, AI enrichment, embedding generation) over Redis + BullMQ, **sharing the same codebase** as the API. The **stock domain is kept decoupled** behind its own module boundary so that a future MercadoLibre integration can consume it as a downstream channel, with the e-commerce remaining the authoritative source of truth — without requiring the stock module to be extracted into a separate service.

## Consequences

### Positive

- **Simplest to build, deploy, and operate**: one API deployable plus one worker process — a single CI/CD pipeline, one set of secrets, one runtime to monitor. This is the lowest operational surface for a solo team on a hardware-store budget.
- **Clear module boundaries**: domain logic is organized into NestJS modules with explicit imports/exports, preventing the catalog, payments, and stock concerns from bleeding into one another.
- **Low cost**: no inter-service infrastructure (service mesh, API gateways, per-service databases), no per-service hosting cost.
- **Easy local development**: the whole backend runs in a single process; a developer can boot the full API locally without orchestrating multiple services.
- **A clean seam for the MercadoLibre channel**: keeping the stock domain decoupled means the future downstream channel can be added as an adapter against a stable internal boundary, with the e-commerce staying authoritative — the roadmap is preserved at near-zero present cost.

### Negative

- **No independent scaling per domain**: the single deployable scales as a unit. A spike in one domain (for example, search) forces scaling the entire API, even domains that are idle.
- **Decoupling requires discipline**: module boundaries are enforced by convention and code review, not by network separation. Without sustained discipline, modules can grow hidden coupling and the boundaries erode toward a big ball of mud.
- **Future service extraction is still work**: if a domain ever genuinely needs to become its own service, the modular structure reduces but does not eliminate the extraction effort (splitting data ownership, introducing a network contract, handling partial failure).

### Neutral

- **The worker is a second process** (per ADR 0004) but shares the codebase with the API; it is an operational consequence of asynchronous processing, not a move toward microservices.
- **Module boundaries are an internal contract**, not a public one — they can be refactored freely as long as in-process callers are updated, unlike a network contract between services.

## Alternatives considered

### Microservices (one service per domain)

**What it is**: Decompose the backend into independently deployable services, one (or a few) per domain — catalog service, search service, payments service, stock service, and so on — communicating over the network.

**Pros**: Independent scaling and deployment per domain; strong physical boundaries that resist coupling; failure isolation between services.

**Cons**: Large operational overhead — many deploy pipelines, service-to-service networking and auth, distributed transactions and eventual-consistency handling, and far more failure modes to reason about. All of this must be carried by a solo team.

**Why rejected**: The operational overhead is unjustified for a solo team at MVP scale. The benefits (independent scaling, failure isolation) solve problems this product does not yet have, while the costs are paid every day.

### Serverless functions (one function per endpoint)

**What it is**: Implement each endpoint (or small group of endpoints) as an independently deployed serverless function.

**Pros**: Pay-per-use scaling to zero; no servers to manage; fine-grained deployment.

**Cons**: Cold starts hurt latency; long-running and stateful work (the import/enrichment/embedding worker, plus persistent connections to pgvector and Redis) maps poorly onto ephemeral functions; operations become fragmented across many function units, increasing — not reducing — the operational surface for a small team.

**Why rejected**: Cold starts and the poor fit for a long-running worker with persistent connections (pgvector, Redis) make this both worse for the workload and harder to operate than a single deployable.

### Do nothing (non-modular monolith)

**What it is**: Continue with the simplest possible structure — a single NestJS application with no enforced internal module boundaries.

**Pros**: No upfront structuring effort; the absolute fastest path to a first running API.

**Cons**: Without module boundaries the domains entangle into a big ball of mud, making the codebase hard to reason about and **closing off** the future MercadoLibre downstream-channel seam that depends on the stock domain staying decoupled.

**Why rejected**: A modular structure preserves clean domain boundaries and a future extraction path at near-zero additional cost over an unstructured monolith. Giving that up to save a small amount of upfront structuring is a poor trade, especially given the MercadoLibre roadmap.

## Implementation notes

- Each domain is a NestJS module with explicit `imports`/`exports`; cross-domain access goes through a module's exported providers, never by reaching into another module's internals.
- The stock domain exposes a narrow, stable interface so a future MercadoLibre downstream-channel adapter can consume it without the e-commerce ceding authority over stock.
- The worker (ADR 0004) is a separate process built from the same codebase, consuming BullMQ jobs over Redis.
- Detailed per-endpoint API contracts are produced during backend ticket planning, not in this ADR (see `docs/product/design-e2e.md` §6.1 note).

## Validation criteria

- We will revisit this decision only if a specific domain develops a genuine need for **independent scaling** that the single deployable cannot meet, or if the **team grows substantially** enough to absorb the operational cost of multiple services.
- Absent those triggers, the modular monolith is expected to remain the right structure through the MVP and the MercadoLibre-channel roadmap item.

## References

- `docs/product/design-e2e.md` §5 (C4 Container view — API + worker), §6.1 (C4 Component view — API backend modules), §20 (ADR triggers — this ADR is ADR-007)
- `docs/product/prd.md` §2.2 (MercadoLibre stock-sync roadmap — e-commerce authoritative, ML downstream)
- ADR 0001 (Railway as the deployment platform)
- ADR 0004 (Redis + BullMQ worker for asynchronous processing)

---

> **Last updated**: 2026-06-15
> **Author**: Gabriel Suarez (Arquitecto)
