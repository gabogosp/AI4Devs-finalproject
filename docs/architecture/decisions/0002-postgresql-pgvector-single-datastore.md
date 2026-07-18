# ADR 0002: PostgreSQL + pgvector as the single datastore for transactional data and product embeddings

> **Status**: Accepted
> **Date**: 2026-06-15
> **Decision-makers**: Gabriel Suarez (Arquitecto)
> **Supersedes**: —
> **Superseded by**: —
> **Related**: ADR 0001 (Neon as the database platform), ADR 0003 (Google Gemini text-embedding-004 for embeddings)

## Context

The product is an e-commerce platform for a hardware store (ferretería). Its core differentiator is **natural-language semantic search**: a shopper types an intent like *"algo para colgar un cuadro en pared dura"* and the system returns relevant products even when the query shares no keywords with the catalog. Delivering this requires storing a vector embedding per product and running approximate k-nearest-neighbour (kNN) similarity queries against those vectors.

The operating envelope is modest and well bounded: a catalog of roughly **5000 SKUs**, low concurrency (around **50** concurrent users), and a tight budget. A primary, explicit goal of the architecture is to **minimize the number of moving parts** — every additional engine adds operational surface, cost, and failure modes that a small team must carry. The embedding provider is already fixed to Google Gemini `text-embedding-004`, which produces **768-dimension** vectors (see ADR 0003).

The platform decision (ADR 0001) already commits us to **PostgreSQL on Neon** as the transactional store. PostgreSQL supports the `pgvector` extension, which adds a native `vector` column type and HNSW indexing for approximate kNN. This raises the question this ADR answers: **should product embeddings live in the same PostgreSQL database as the transactional data, or in a separate dedicated search/vector engine?**

## Decision

We will adopt **PostgreSQL (Neon) with the `pgvector` extension as the single datastore** for both transactional data and product embeddings, for the **entire application scope** — there is no separate search or vector engine.

Embeddings are stored in a `vector(768)` column (matching `text-embedding-004`) on a `product_embeddings` table, indexed with an **HNSW index using `vector_cosine_ops`** for efficient approximate kNN. Semantic search embeds the user query via Gemini and runs a cosine-distance kNN query (`embedding <=> :qvec`) against that index.

## Consequences

### Positive

- **One engine for transactional data and vectors**: catalog writes and their embeddings live in the same database, so updates can be **atomic** and consistency is trivial — no cross-store synchronization or dual-write reconciliation.
- **Lower cost and operational simplicity**: no additional managed service to provision, secure, monitor, back up, or pay for. Backups, point-in-time recovery, and migrations cover the entire data surface (transactional + vectors) in a single pipeline.
- **Right-sized for the volume**: at ~5000 vectors and ~50 concurrent users, HNSW in pgvector comfortably meets the latency and recall needs without a specialized engine.
- **Smaller failure surface and team cognitive load**: one datastore to reason about, one connection pool, one set of credentials and runbooks.

### Negative

- **Tuning burden on pgvector/HNSW**: achieving the desired recall/latency trade-off requires tuning HNSW build and search parameters (e.g., `m`, `ef_construction`, `ef_search`). This is real work that the team owns rather than offloading to a purpose-built engine.
- **Scaling ceiling**: pgvector/HNSW on a shared transactional database is appropriate for tens of thousands of vectors and low QPS. Growth far beyond that (much larger catalog or much higher search throughput) may eventually justify a dedicated vector engine, incurring a future migration cost.
- **Search availability is coupled to the primary database**: because search shares the transactional PostgreSQL instance, heavy transactional load or a primary-DB incident degrades search too. There is no independent search tier to absorb load or fail over separately.

### Neutral

- **Embeddings are regenerated when a product description changes**: each meaningful description change (notably AI enrichment, see ADR 0003) triggers re-embedding for that SKU, keeping vectors in sync with content.
- **Bulk imports incur index-maintenance cost**: large CSV/Excel imports add or update many vectors, which carries HNSW index build/maintenance overhead during the import window. This is handled asynchronously by the worker and is acceptable for an occasional batch operation.
- **kNN queries bypass the ORM**: because pgvector is not a native Prisma type, similarity queries are issued via raw SQL (`$queryRaw`) while the rest of the schema is managed by Prisma migrations.

## Alternatives considered

### Alternative A: Dedicated vector database (Pinecone / Qdrant / Weaviate)

- **What it would have meant**: run a separate managed or self-hosted vector engine alongside PostgreSQL, syncing product embeddings into it and querying it for semantic search.
- **Why rejected**: it adds an extra service, recurring cost, and operational complexity (dual-write/sync, separate backups, separate monitoring) that is **not justified at ~5000 vectors** and low concurrency. The benefits of a specialized engine materialize at far larger scale than this project operates at.
- **What it would have required to change our minds**: a catalog or QPS far beyond the current envelope (see Validation criteria), or recall/latency that pgvector/HNSW provably cannot meet at our scale.

### Alternative B: OpenSearch / Elasticsearch with vector support

- **What it would have meant**: stand up an OpenSearch/Elasticsearch cluster providing both text and vector search, and index products there.
- **Why rejected**: it is **heavy to operate** (cluster sizing, JVM/heap management, index lifecycle) and **overkill for the volume**. The operational cost dwarfs the value at ~5000 SKUs.

### Alternative C: PostgreSQL full-text search only (no vectors)

- **What it would have meant**: rely solely on PostgreSQL `tsvector` full-text search over product names and descriptions, with no embeddings.
- **Why rejected**: it **loses the semantic / natural-language differentiator** — keyword-based full-text search cannot map *"algo para colgar un cuadro en pared dura"* to the right products. This option is **retained only as the resilience fallback**: when the Gemini provider is unavailable or times out, search degrades gracefully to full-text (`tsvector` over `name` + `description_enriched`) so browsing never breaks (E2E §9.1).

### Status quo (do nothing)

- **What it would have meant**: ship no vector store at all.
- **Why rejected**: with no embeddings there is **no semantic search**, which is the product's core differentiator. Doing nothing forfeits the primary reason the product exists.

## Implementation notes

> Detailed implementation belongs in the relevant OpenSpec change and the E2E (§8, §9.1). High-level pointers only:

- `product_embeddings.embedding` is a `vector(768)` column; an HNSW index with `vector_cosine_ops` backs approximate kNN.
- Query path: embed the user query with `text-embedding-004`, then `SELECT ... ORDER BY embedding <=> :qvec LIMIT N` against the HNSW index.
- Schema and migrations are managed by Prisma; the kNN similarity query uses raw SQL (`$queryRaw`) because pgvector is not a native Prisma type.
- Embedding generation, AI enrichment, and bulk-import re-indexing run asynchronously in the worker (Redis + BullMQ) to keep request latency unaffected.

## Validation criteria

- We expect semantic-search **p95 latency to stay under 1.5s** at the current catalog size and concurrency.
- We will **revisit this decision** if the catalog grows past **~50k SKUs**, if search **p95 latency breaches 1.5s**, or if sustained QPS rises materially above the current low-concurrency envelope — any of which may justify migrating to a dedicated vector engine.

## References

- E2E design: `docs/product/design-e2e.md` §8 (data model / `pgvector`), §9.1 (semantic search flow + full-text fallback), §20 (ADR materialization trigger "ADR-002")
- Data standards: `docs/architecture/data-standards.md`
- pgvector HNSW indexing (`vector_cosine_ops`)
- Related ADRs: ADR 0001 (Neon platform), ADR 0003 (Gemini `text-embedding-004` embeddings)

---

> **Last updated**: 2026-06-15
> **Author**: Gabriel Suarez (Arquitecto)
