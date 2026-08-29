# ADR 0012: In-process executor for bulk catalog import, with an asynchronous contract from day one

> **Status**: Accepted
> **Date**: 2026-08-20
> **Decision-makers**: Gabriel Suarez (Arquitecto)
> **Supersedes**: —
> **Superseded by**: —
> **Amends**: ADR 0004 (Redis + BullMQ for async processing) — its assumption that every
> background workload runs in the worker process from the start
> **Related**: ADR 0004 (Redis/BullMQ — amended here), ADR 0007 (modular monolith), ADR 0003
> (Gemini for AI jobs — the enrichment consumer this import feeds), ADR 0001 (Railway)

## Context

ADR 0004 chose Redis + BullMQ for asynchronous processing and named **bulk catalog import** as
its first workload: durable queuing, retries with backoff, progress tracking, and a dedicated
worker process so the job does not compete with the API for resources.

US-006 is the US that actually builds that import. Two facts block the ADR 0004 path today:

- **The Redis add-on is not provisioned.** US-019 (cloud platform) is gated on external
  accounts; its Redis task is pending and there is no `REDIS_URL` in any environment.
- **`apps/worker` is a one-line README.** There is no worker process to deploy a processor to.

US-014 hit the same wall from the other side and deferred its scheduled token purge for exactly
this reason, so this is a recurring constraint rather than a one-off.

The import cannot wait for that unblocking: it is the mechanism by which the owner loads the
initial catalog, and the catalog is the precondition for the storefront US that are already
built. But a synchronous import is not an option either — the target catalog is ~5.000 SKUs
(E2E §21), and AC-7 requires the owner to watch progress rather than hold a request open.

The real question is therefore not "queue or no queue". It is **which decisions must be made
now and which can be deferred without being paid for twice**.

## Decision

**Separate the contract from the executor.**

The HTTP surface is asynchronous from day one, exactly as it would be with BullMQ:

- `POST` accepts the file and returns **202** with a job id. It never processes inline.
- `GET` endpoints report status, progress and the per-row report.
- Job state — status, counters, per-row outcomes — lives **durably in Postgres**
  (`import_jobs`, `import_job_rows`), not in memory.

The **executor** is in-process for now: the API process picks the job up and works it in
batches, with a single concurrent job (a second upload gets 409), a heartbeat per batch, and a
reaper at start-up that recovers jobs orphaned by a restart.

**Migration criterion (the load-bearing part of this ADR):** when `REDIS_URL` exists and the
worker process is deployed, the runner becomes a BullMQ processor reading **the same
`import_jobs` table**. The HTTP contract does not change and the schema does not change — only
who calls the runner. No consumer, no test and no stored row has to be migrated.

## Consequences

**Positive**

- The import ships now, and the owner can load the catalog without waiting on external accounts.
- Nothing gets paid for twice: the contract, the schema, the per-row report and the client are
  written once. The deferred work is the executor swap, which is the smallest replaceable part.
- Durability does not depend on the queue. A restart mid-import does not lose the record of
  what happened — the reaper marks the orphan and the owner re-uploads, which is safe because
  reconciliation is by SKU (re-running the same file converges to the same state).

**Negative**

- **The import competes with the request path for CPU.** This is the real cost and the reason
  the row/size caps exist (5.000 rows / 4 MiB). Raising those caps without re-measuring moves
  the problem onto storefront latency.
- **A deploy kills the running import.** Mitigated, not solved: the reaper marks it failed and
  the owner re-uploads. Acceptable while imports are an occasional owner-initiated action, not
  a scheduled pipeline.
- **One job at a time.** A second upload is rejected with 409 rather than queued. With a single
  operator this is a non-issue; it stops being acceptable the moment imports are automated.
- No retries with backoff, no per-provider rate limiting — the capabilities ADR 0004 bought
  from BullMQ. The AI enrichment that needs them is **not** in this US: US-006 only marks rows
  with `enrichment_done=false`, and US-005 consumes that marker once the queue exists.

**Neutral**

- This is deliberately close to the "queue implemented with timers" anti-pattern, and it is
  worth stating why it is not: durability comes from Postgres rather than from process memory,
  and the executor boundary is explicit so that swapping it is a substitution rather than a
  rewrite. What makes that anti-pattern harmful is state living in a process that can die; here
  it does not.

## Alternatives considered

- **Synchronous import with a small cap (≤500 rows).** Rejected: it does not reach the ~5.000
  SKU target and it eliminates AC-7's progress view. It would also have to be replaced entirely
  later — the contract, the client and the tests would all be thrown away.
- **Wait for Redis and implement BullMQ properly.** Rejected as a schedule decision, not a
  technical one: it blocks the catalog — and therefore the storefront's usefulness — on
  external account provisioning with no committed date. This ADR keeps that path open at a cost
  of one executor swap.
- **A separate lightweight queue (in-memory, or a DB-polling library).** Rejected: it adds a
  dependency that would itself be removed when BullMQ arrives, which is the "paid for twice"
  outcome this decision exists to avoid.

## References

- ADR 0004 — Redis + BullMQ for async processing (amended by this ADR).
- US-006 — `docs/user-stories/US-006-import-masivo-inventario.md` (AC-7 progress, AC-11 limits).
- Change — `openspec/changes/US-006-import-masivo-inventario-backend/design.md`
  §Modo de ejecución, §Persistencia, §NFRs cuantificados.
- US-019 — cloud provisioning; the Redis task that unblocks the migration criterion.
