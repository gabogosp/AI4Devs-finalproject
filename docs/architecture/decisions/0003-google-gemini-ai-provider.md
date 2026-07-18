# ADR 0003: Adopt Google Gemini as the AI provider (embeddings + description enrichment)

> **Status**: Accepted
> **Date**: 2026-06-15
> **Decision-makers**: Gabriel Suarez (Arquitecto)
> **Supersedes**: —
> **Superseded by**: —
> **Related**: ADR 0002 (PostgreSQL + pgvector, 768-dim embeddings), ADR 0004 (async worker runs AI jobs)

## Context

The product's core differentiator is **natural-language semantic search** over the store's catalog (PRD §1, capability §2.1 #2). The catalog originates from a physical hardware store and arrives with **weak, terse product descriptions** that an embedding model cannot meaningfully ground in natural-language queries. Two AI capabilities are therefore required and tightly coupled: (1) generating vector **embeddings** for products and queries, and (2) **enriching** the poor source descriptions so that the embeddings actually capture what a customer means when they search in plain Spanish (AR). Enrichment is the critical sub-objective — without it, semantic search degrades to keyword matching over near-empty text.

The decision is constrained by the project's economics and language requirements. DSM is a single-location hardware store with a tight budget, so the AI provider must be **economical** at both inference and indexing time. The catalog has thousands of SKUs, so embedding dimensionality directly affects index size and cost in pgvector. **Spanish (Argentina) language quality** matters for both enrichment and query understanding. The provider must integrate with the chosen datastore: **PostgreSQL + pgvector with a `vector(768)` column and HNSW index** (ADR 0002). All AI calls are I/O-bound, rate-limited, and must never block a request — they run in the **async worker with retries and backoff** (ADR 0004).

This ADR was triggered by the approved End-to-End design (`docs/product/design-e2e.md` §20, trigger "ADR-003") and **closes PRD §12 open question Q-4** ("which AI provider?").

The explicit question answered here: **which AI provider do we adopt for product/query embeddings and for description enrichment?**

## Decision

We will adopt **Google Gemini** as the AI provider for the semantic-search subsystem: **`text-embedding-004` (768 dimensions)** to generate product and query embeddings, and **`gemini-1.5-flash`** to enrich poor product descriptions before embedding. This applies to the `search` and `enrichment` modules, with all calls executed in the async worker (ADR 0004) against the `vector(768)` column defined in ADR 0002.

## Consequences

### Positive

- **Cost fit for the budget**: Gemini's generous free tier plus low per-call pricing on `gemini-1.5-flash` and `text-embedding-004` keeps AI operating cost within a single-store budget, including initial bulk enrichment of thousands of SKUs.
- **Cheaper indexing via lower dimensionality**: 768-dimension embeddings (vs. larger defaults) reduce pgvector storage and HNSW index size/cost, which scales favorably across the full catalog.
- **Good Spanish (AR) quality**: `gemini-1.5-flash` produces usable enriched descriptions in Spanish, and `text-embedding-004` handles Spanish queries well, directly serving the natural-language search differentiator.
- **Clean fit with ADR 0002**: the 768-dim output maps exactly onto the existing `vector(768)` column and HNSW index — no schema rework required.
- **Managed inference**: no model hosting, GPU, or container resources consumed; the constrained Railway/Neon footprint stays lean (ADR 0004 worker only orchestrates calls).

### Negative

- **External dependency on a Google API**: availability, rate limits, and pricing changes are outside our control. *Mitigation*: the search path **falls back to PostgreSQL full-text search** if Gemini is unavailable, so search degrades gracefully rather than failing.
- **Vendor lock-in to embedding dimension 768**: embeddings from different providers are not interchangeable. Switching providers later requires **re-embedding the entire catalog** and reindexing pgvector — a non-trivial, catalog-wide operation.
- **Cost scales with catalog size on (re)enrichment**: every new or changed product incurs an enrichment + embedding call. *Mitigation*: **re-enrich only when `description_raw` changes** (idempotent on content), avoiding redundant calls on unrelated updates.

### Neutral

- **AI work is asynchronous by construction**: enrichment and embedding run in the worker with backoff (ADR 0004); user-facing latency is dominated by the kNN query, not by the provider.
- **Two coupled models, one provider**: embedding and enrichment share a single SDK/credential and billing surface, simplifying configuration but concentrating the integration on one vendor.
- **Query-time embedding cost is small**: each search performs one `text-embedding-004` call; frequent queries can be cached in Redis (E2E §22), bounding this cost independently of catalog size.

## Alternatives considered

### Alternative A: OpenAI (`text-embedding-3-small` + `gpt-4o-mini`)

- **What it would have meant**: use OpenAI for both embeddings (`text-embedding-3-small`) and enrichment (`gpt-4o-mini`).
- **Why rejected**: strong runner-up — very cheap, mature ecosystem, abundant pgvector examples. Rejected in favor of Gemini's **more generous free tier**, its **lower-dimension (768) embeddings that are cheaper to index** at our catalog size, and comparable-or-better **Spanish (AR)** output for enrichment.
- **What it would have required to change our minds**: a measurable Spanish-quality or relevance advantage for OpenAI on our catalog, or Gemini pricing/limits becoming unfavorable at our scale.

### Alternative B: Self-hosted open-source embeddings (`multilingual-e5` / sentence-transformers)

- **What it would have meant**: run an open-source multilingual embedding model ourselves for $0 inference cost.
- **Why rejected**: it consumes the **constrained Railway container CPU/RAM**, complicates the deployment, and **does not solve enrichment** — we would still need a hosted LLM for that, reintroducing an external provider and erasing the supposed savings.

### Alternative C: Cohere / Voyage embeddings

- **What it would have meant**: use a specialized embeddings provider (Cohere or Voyage) for the vector generation.
- **Why rejected**: technically viable and multilingual, but offers **less combined cost/ecosystem advantage** than Gemini at our scale, and still leaves enrichment to a separate LLM, increasing integration surface for no clear gain.

### Status quo (do nothing)

- **What this would have meant**: ship no AI — semantic search and description enrichment are absent; discovery falls back to **category browsing only**.
- **Why rejected**: this **eliminates the product's core differentiator** (PRD §1, capability #2/#3 are Must). With unenriched descriptions, even keyword search is weak. Not a viable option.

## Implementation notes

> Detailed wiring lives in the E2E (§9.1 search, §9.3 enrichment) and the implementation plan, not here.

- Enrichment + embedding pipeline runs in the BullMQ worker (ADR 0004) with retry/backoff for rate limits.
- Re-enrichment is gated on `description_raw` changes to keep cost proportional to real catalog churn.
- Search path: embed query with `text-embedding-004` → HNSW kNN over `product_embeddings.embedding` (ADR 0002); fall back to Postgres full-text search on provider failure.

## Validation criteria

- We expect search relevance of **≥ 70% in top-5 results** (PRD §1.4) once embeddings are generated across the catalog.
- We will revisit this decision if **Gemini cost, Spanish-language quality, or rate limits** become problematic, or if the fallback to full-text search triggers too frequently in production.

## References

- E2E design: `docs/product/design-e2e.md` §9.1 (search), §9.3 (enrichment), §20 (ADR triggers), §22 (caching) — trigger "ADR-003"
- PRD: `docs/product/prd.md` §12 Q-4 (open question closed by this ADR), §1.4 (relevance KPI)
- Related ADRs: ADR 0002 (PostgreSQL + pgvector, `vector(768)` + HNSW), ADR 0004 (async worker runs AI jobs with backoff)

---

> **Last updated**: 2026-06-15
> **Author**: Gabriel Suarez (Arquitecto)
