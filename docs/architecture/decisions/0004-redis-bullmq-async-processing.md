# ADR 0004: Use Redis + BullMQ for asynchronous background processing

> **Status**: Accepted
> **Date**: 2026-06-15
> **Decision-makers**: Gabriel Suarez (Arquitecto)
> **Supersedes**: —
> **Superseded by**: —
> **Amended by**: ADR-0012 (bulk import runs in-process until Redis is provisioned; the async contract and the durable job state are built now, the executor is swapped later)
> **Related**: ADR-0001 (Railway as deployment platform), ADR-0003 (Gemini for AI jobs), ADR-0007 (worker is part of the modular monolith deployment), ADR-0012 (in-process import executor — amends this decision for the first workload named below)

## Context

The platform must perform several units of work that are too heavy or too slow to run inside an HTTP request/response cycle: bulk catalog import from CSV/Excel files containing thousands of SKUs, AI description enrichment, and embedding generation. The bulk import alone fans out into per-SKU AI calls to Gemini (per ADR-0003), each of which is subject to provider rate limits and transient failures. Running this synchronously would exceed HTTP timeouts and tie up API capacity, and naive looping would breach Gemini's rate limits.

These workloads therefore require: durable job queuing, automatic retries with backoff, configurable concurrency, rate limiting against the AI provider, and progress tracking so the admin UI can report import status. They must be decoupled from request latency and run in a dedicated worker process (deployed as part of the modular monolith per ADR-0007) rather than competing with the API for resources.

The project is budget-conscious but a small managed Redis add-on is acceptable, and the deployment platform is Railway (ADR-0001), where Redis is available as a first-class add-on. Beyond queuing, the same Redis instance can serve double duty as the API's cache and rate-limit store (see E2E §5, §9.3).

The question this ADR answers: **how do we run durable, rate-limited, retryable background work for bulk import and AI enrichment without coupling it to the HTTP request lifecycle?**

## Decision

We will adopt **Redis (Railway add-on) + BullMQ** to run all asynchronous background work in a dedicated worker process — bulk catalog import (CSV/Excel, thousands of SKUs), AI description enrichment, and embedding generation — with retries, exponential backoff, rate limiting, concurrency control, and progress tracking. The same Redis instance also serves as the API's **cache and rate-limit store**.

## Consequences

### Positive

- **Robust failure handling**: BullMQ provides retries, exponential backoff, and dead-letter handling out of the box, so transient Gemini failures and rate-limit responses are absorbed without bespoke code.
- **Provider rate-limit compliance**: BullMQ's rate-limiter and concurrency controls let the worker respect Gemini's quotas while still draining large import batches.
- **Decoupled from request latency**: bulk import and AI enrichment run in a dedicated worker, so HTTP requests never block on multi-minute jobs and API capacity is not consumed by background work.
- **Progress tracking**: job progress is observable, enabling the admin UI to report import status (E2E §9.3).
- **Redis pulls double duty**: the same managed instance backs the queue, the API cache, and the rate-limit store, maximizing value from a single add-on (E2E §5).

### Negative

- **Extra managed service**: introduces a small recurring cost and a stateful dependency that must be provisioned and configured on Railway.
- **Separate worker deployment to operate**: the worker process is an additional deployable unit with its own lifecycle, scaling, and observability concerns.
- **New failure point**: Redis becomes a critical dependency; if it is unavailable, queuing, cache, and rate limiting all degrade simultaneously.

### Neutral

- **Queue depth and lag become operational signals**: queue backlog, failed-job rate, and retry rate must be monitored and alerted on (E2E §18), adding to the observability surface.

## Alternatives considered

### Alternative A: In-process DB-backed job queue (Postgres `jobs` table)

- **What it would have meant**: a `jobs` table in Postgres polled by an in-process worker running inside the API, with no additional infrastructure.
- **Why rejected**: zero extra infra, but retries, backoff, rate limiting, and concurrency control would all have to be hand-coded and maintained; the in-process worker competes with the API for CPU and connections, reintroducing the resource-contention problem we are trying to avoid.
- **What it would have required to change our minds**: a hard constraint forbidding any new managed service, combined with volumes low enough that hand-rolled retry/rate-limit logic stayed simple.

### Alternative B: Synchronous processing inside the request

- **What it would have meant**: performing import parsing and per-SKU AI calls directly within the HTTP request handler.
- **Why rejected**: infeasible at the required scale — importing thousands of SKUs with per-SKU Gemini calls would exceed HTTP timeouts and lock up API capacity, and offers no retry or rate-limit story.

### Alternative C: Cloud queue (e.g., AWS SQS)

- **What it would have meant**: offloading queuing to a managed cloud queue service such as SQS.
- **Why rejected**: not aligned with the Railway/Neon platform (ADR-0001); it adds an external cloud dependency, separate credentials, and cross-provider operational overhead without a benefit over a Railway-native Redis add-on at this scale.

### Status quo (do nothing)

- **What this would have meant**: no asynchronous processing layer; import and AI enrichment would have to happen inline or not at all.
- **Why rejected**: without async processing, bulk import plus AI enrichment is simply not viable at scale — the core "thousands of SKUs" use case cannot be served.

## Implementation notes

- The worker is deployed as part of the modular monolith deployment (ADR-0007), as a separate Railway process consuming BullMQ queues backed by the Redis add-on.
- Job families: catalog import, AI description enrichment (Gemini, ADR-0003), and embedding generation.
- Configure BullMQ rate-limiter and concurrency to respect Gemini provider limits; use exponential backoff with a dead-letter path for exhausted retries.
- Reuse the same Redis instance for API cache and rate-limit store; namespace keys to keep queue, cache, and rate-limit concerns separate.

## Validation criteria

- We expect bulk imports of thousands of SKUs with per-SKU AI enrichment to complete reliably without HTTP timeouts and without breaching Gemini rate limits.
- We will revisit this decision if queue volume or cost grows materially, or conversely if a single in-process worker proves sufficient and the managed Redis dependency is no longer justified.

## References

- E2E design: `docs/product/design-e2e.md` §5 (async processing principle), §9.3 (import/enrichment worker flow), §18 (observability / queue monitoring), §20 (ADR registry — ADR-004 trigger)
- ADR-0001 — Railway as deployment platform
- ADR-0003 — Gemini for AI description and embedding jobs
- ADR-0007 — Worker as part of the modular monolith deployment
- BullMQ: https://docs.bullmq.io/
- MADR (Markdown Any Decision Records): https://adr.github.io/madr/

---

> **Last updated**: 2026-06-15
> **Author**: Gabriel Suarez (Arquitecto)
