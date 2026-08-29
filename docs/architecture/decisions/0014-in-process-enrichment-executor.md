# ADR 0014: In-process executor for AI enrichment and embedding generation

> **Status**: Accepted
> **Date**: 2026-08-22
> **Decision-makers**: Gabriel Suarez (Arquitecto)
> **Supersedes**: —
> **Superseded by**: —
> **Amends**: ADR 0004 (Redis + BullMQ for async processing) — its assumption that the AI
> enrichment workload runs in the worker process
> **Extends**: ADR 0012 (in-process executor for bulk catalog import) — same pattern, second
> workload, and it revises ADR 0012's own statement that enrichment would wait for the queue
> **Related**: ADR 0003 (Gemini — the provider this executor calls), ADR 0002 (pgvector — where
> the embeddings land), ADR 0007 (modular monolith), ADR 0001 (Railway)

## Context

ADR 0003 chose Google Gemini for the two AI capabilities the product's differentiator needs:
enriching the store's poor product descriptions (`gemini-1.5-flash`) and generating 768-dimension
embeddings (`text-embedding-004`). Both are asynchronous by construction, and ADR 0004 assigned
them to a BullMQ worker with retries, backoff and provider rate limiting.

That worker does not exist. The same two facts that forced ADR 0012 for the import are still
true, three weeks later:

- **The Redis add-on is not provisioned.** US-019 T1.3 is still open — it depends on external
  account provisioning with no committed date, and there is no `REDIS_URL` in any deployed
  environment.
- **`apps/worker` is a one-line README.** There is no process to deploy a queue processor to.

ADR 0012 handled the import by separating the contract from the executor, and was explicit that
this treatment stopped there: *"The AI enrichment that needs them is **not** in this US: US-006
only marks rows with `enrichment_done=false`, and US-005 consumes that marker once the queue
exists."* That sentence is the assumption this ADR revises.

Waiting is not neutral. US-005 is what puts vectors in the database, and US-004 — the natural
language search that the PRD names as the product's core differentiator (§2.1 capability 2) —
has nothing to run kNN against until it does. Waiting for the queue means the differentiator
ships late or degrades permanently to the full-text fallback, and the blocking dependency is an
external account, not an engineering problem.

The question this ADR answers: **which process executes the enrichment and embedding workload,
given that the queue ADR 0004 chose is not available?**

## Decision

**Extend ADR 0012's separation of contract and executor to the enrichment workload.**

The contract is asynchronous and durable from day one, exactly as it would be with BullMQ:

- The work queue **is a query**: `SELECT ... FROM products WHERE enrichment_done = false`. There
  is no queue data structure that can disagree with the database.
- Per-product control state — attempts, next attempt time, last error code, source-text hash —
  lives **durably in Postgres** on the `products` row, next to the `enrichment_done` marker the
  DER already placed there.
- The operational surface is two admin endpoints: `GET /v1/admin/enrichment/status` (coverage +
  runner state) and `POST /v1/admin/enrichment/runs` (202, one concurrent run, 409 otherwise).

The **executor** is in-process in `apps/api` for now: a runner works claimed batches, with
bounded concurrency, a per-provider rate limit, exponential backoff with jitter on transient
failures, and a cooldown after consecutive provider failures.

Work is claimed with a **lease**: the claim query pushes `enrichment_next_attempt_at` into the
future and returns the rows in the same statement, using `FOR UPDATE SKIP LOCKED`. Two concurrent
runs therefore cannot process the same product, and a run that dies mid-batch leaves its rows
claimed only until the lease expires, after which they become eligible again on their own.

**Migration criterion (the load-bearing part of this ADR):** when `REDIS_URL` exists **and** the
`apps/worker` process is deployed, the runner becomes a BullMQ processor reading **the same
`products` rows**. What does **not** change when that happens:

- The **HTTP contract** of both endpoints — same paths, same payloads, same 202/409 semantics.
- The **schema** — no column is added, dropped or retyped by the migration.
- The **queue semantics** — `WHERE enrichment_done = false` remains the source of truth, so no
  row has to be migrated and no in-flight work is lost in the swap.
- The **ports** — `AI_ENRICHER`, `AI_EMBEDDER` and `EnrichmentQueue` keep their contracts; only
  who calls the runner changes.

## Consequences

**Positive**

- The differentiator ships without waiting on external account provisioning. US-004 gets a
  populated `product_embeddings` table with an HNSW index to search against.
- Nothing gets paid for twice. The decision matrix, the cost control, the provider adapter, the
  admin surface, the schema and the tests are written once; the deferred work is the executor
  swap, which is the smallest replaceable part.
- **Durability does not depend on the queue.** A restart, a deploy or a Gemini outage cannot lose
  work: the pending set is recomputed by a query. This is strictly better than the import's
  position in ADR 0012, where an interrupted job needed the owner to re-upload.
- **The backoff survives a restart**, because it is a timestamp in the database rather than a
  timer in memory. ADR 0012 named in-memory retry state as a weakness of the in-process
  approach; the lease-and-timestamp design closes it.
- No reaper job is needed. Orphaned work self-heals when the lease expires.

**Negative**

- **The runner competes with the request path for the API process.** This is the same cost ADR
  0012 accepted, and it is smaller here for a specific reason: the work is **I/O-bound** (waiting
  on Gemini over HTTPS) rather than CPU-bound like parsing a spreadsheet. It is not zero — JSON
  serialization, hashing and the database round-trips are real — so the runner yields the event
  loop between items and the storefront p95 budget (E2E §17) is a gate on the change.
- **A deploy kills the running enrichment.** Mitigated, not solved: the claimed rows return to
  the pending set when their lease expires, and the next run picks them up with no operator
  action. Compared with the import, this is a genuine improvement, but a long initial catalog run
  will still be interrupted by a deploy and take longer to finish.
- **One run at a time.** A second `POST /runs` is rejected with 409 rather than queued. With a
  single operator and an idempotent pending-set query, this is a non-issue.
- **No cross-process fairness or priority.** BullMQ would give per-job priorities and a
  dashboard; here there is a single FIFO-ish order (never-attempted first). Nobody has asked for
  priorities.
- The initial catalog run is bounded by the provider's rate limit, not by our concurrency: at
  15 RPM (the `gemini-1.5-flash` free tier that ADR 0003 chose the provider for) roughly 5.000
  SKUs take about 5,5 hours. Raising that is a quota decision, not a code change. This is the
  open E2E §23 Q-4 question, now quantified.

**Neutral**

- This is deliberately close to the "queue implemented with timers" anti-pattern, and the reason
  it is not one is the same as in ADR 0012, with one addition: state lives in Postgres rather
  than in process memory, the executor boundary is an explicit seam, **and** the pending set is
  derived rather than stored, so there is no queue state to corrupt in the first place.
- Two workloads now share this pattern (import and enrichment). That is a precedent worth
  naming: it is acceptable for owner-initiated, occasional work, and it stops being acceptable
  the moment either workload becomes a scheduled pipeline.

## Alternatives considered

- **Wait for Redis and implement the BullMQ processor properly.** Rejected as a schedule
  decision, not a technical one: it blocks the product's core differentiator on external account
  provisioning with no date. This ADR keeps that path open at the cost of one executor swap.
- **Implement BullMQ now against the local Redis from `docker-compose.yml`.** Rejected: it would
  satisfy ADR 0004 on paper while being **undeployable** — without `REDIS_URL` in Railway the
  feature would not exist in staging or production, which is the opposite of shipping.
- **Stand up `apps/worker` as a separate deployable that polls Postgres.** Rejected for now on
  cost, not on merit: it genuinely isolates the load and needs no Redis, but it adds a Railway
  service, a Dockerfile and CI wiring — infrastructure work that competes with the delivery
  window. It remains the fallback if the runner measurably degrades storefront latency, and it is
  a strictly smaller step than the BullMQ migration.
- **On-demand enrichment at write time (enrich a product when the admin saves it).** Rejected:
  it puts a 1,5–3 s external call inside an admin request, does not solve the bulk import case
  at all, and makes the owner wait for the AI to answer.
- **Lazy enrichment at search time.** Rejected: it moves an expensive, rate-limited call onto the
  customer-facing search path, which the p95 < 1,5 s budget (E2E §17) cannot absorb, and it would
  make the first search for a term permanently slower than the rest.

## Implementation notes

> Detailed wiring lives in the openspec change, not here.

- Claim query, decision matrix and resilience thresholds:
  `openspec/changes/US-005-enriquecimiento-ia-embeddings-backend/design.md` §Ejecución,
  §Matriz de decisión, §Resiliencia.
- The provider API key travels in the `x-goog-api-key` header and never in the URL, so that no
  error log can leak it (US-005 AC-9).
- `ENRICHMENT_ENABLED=false` stops the runner without a deploy; without `GEMINI_API_KEY` the
  runner reports `disabled` rather than fabricating vectors.

## Validation criteria

- Enriched-and-embedded catalog coverage **≥ 90%** (PRD §1.4), observable through
  `GET /v1/admin/enrichment/status`.
- No regression of the storefront read budget (**p95 < 300 ms**, E2E §17) while a run is in
  progress.
- We revisit this decision when **either** migration condition is met (`REDIS_URL` provisioned
  and `apps/worker` deployed), or earlier if the catalog exceeds ~10.000 SKUs, or if imports stop
  being an occasional owner-initiated action and become automated.

## References

- ADR 0004 — Redis + BullMQ for async processing (amended by this ADR).
- ADR 0012 — in-process executor for bulk catalog import (pattern extended; its "US-005 waits for
  the queue" assumption revised here).
- ADR 0003 — Google Gemini as the AI provider (models and rate-limit context).
- ADR 0002 — PostgreSQL + pgvector (`vector(768)` + HNSW).
- US-005 — `docs/user-stories/US-005-enriquecimiento-ia-embeddings.md` (AC-3 coverage, AC-4/AC-5
  resilience, AC-6 cost control).
- Change — `openspec/changes/US-005-enriquecimiento-ia-embeddings-backend/`.
- US-019 — cloud provisioning; T1.3 is the Redis task that unblocks the migration criterion.
- E2E — `docs/product/design-e2e.md` §9.3 (pipeline sequence), §17 (NFRs), §18.5 (runbook),
  §23 Q-4 (initial enrichment window, quantified by this decision).

---

> **Last updated**: 2026-08-22
> **Author**: Gabriel Suarez (Arquitecto)
