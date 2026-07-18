# ADR 0001: Adopt Railway + Neon + Cloudflare R2 as the platform

> **Status**: Accepted
> **Date**: 2026-06-15
> **Decision-makers**: Gabriel Suarez (Arquitecto)
> **Supersedes**: —
> **Superseded by**: —
> **Related**: ADR 0002 (Neon + pgvector for transactional data and embeddings), ADR 0004 (Redis + BullMQ on Railway)

## Context

DSM Refrigeración y Ferretería is a real, single-location hardware store in CABA (Buenos Aires, Argentina) with no prior digital presence. The project delivers its first e-commerce: online catalog (≥5,000 SKUs), customer base, MercadoPago checkout, and an AI-powered natural-language product search. Operating constraints are those of a brick-and-mortar "ferretería": a tight budget priced in ARS, no appetite for hyperscaler spend at launch, low expected concurrency (~50 sustained), and a solo / small engineering team that cannot afford to operate self-managed infrastructure.

The organization ships a default infrastructure baseline (`AWS Lightsail baseline`) that the architect is normally instructed not to redecide. This project's needs diverge from that default on three load-bearing points: (1) the AI search requires managed PostgreSQL with the `pgvector` extension and an HNSW index (see ADR 0002), which is a first-class managed feature on Neon but additional operational surface on Lightsail/RDS; (2) the workload includes a long-running worker plus a Redis-backed job queue (BullMQ — see ADR 0004) that benefits from a single-project compute model; and (3) the team size makes developer experience and managed services a primary cost driver, not a secondary nicety. The platform is fixed for this project (`platform: railway, db: neon-postgres-pgvector, storage: cloudflare-r2`) and described end-to-end in the approved E2E (§13 Deployment, §16 stack, §17 NFRs). Because this contradicts a documented org standard, it requires an ADR.

The question this ADR answers: **what platform do we run on, given a hardware-store budget, a solo team, a managed-`pgvector` requirement, and an explicit deviation from the org's `AWS Lightsail baseline`?**

A coupled observability sub-decision falls in the same scope: the org default is the OSS Grafana stack (Loki/Tempo/Prometheus). Self-hosting and operating that stack is disproportionate for this budget and team, so the E2E (§18) specifies Railway-native observability plus Sentry instead.

## Decision

We will adopt **Railway** for compute (a single project hosting `web`, `api`, and `worker` services plus a managed Redis add-on), **Neon** for managed PostgreSQL with the `pgvector` extension, and **Cloudflare** for DNS/CDN and **R2** object storage (product images), for the DSM Refrigeración y Ferretería e-commerce. This is an explicit, documented deviation from the org's `AWS Lightsail baseline`.

As part of the same decision, for observability we will use **Railway-native logs/metrics + Sentry** (errors and tracing for frontend and backend) instead of operating a self-managed Grafana (Loki/Tempo/Prometheus) stack.

## Consequences

### Positive

- **Fits the budget and team size**: fully managed compute, database, queue, and storage on economical plans keep both monthly cost (ARS-sensitive) and operational load low — no clusters, no node patching, no self-hosted observability to run.
- **Managed `pgvector` out of the box**: Neon supports the `pgvector` extension with an HNSW index on the chosen plan, so transactional data and product embeddings live in one datastore (ADR 0002) with no separate search engine to operate.
- **Single-project compute model**: Railway hosts `web` + `api` + `worker` + Redis in one project, which cleanly accommodates the long-running worker and BullMQ queue (ADR 0004) and simplifies deploy/rollback (GitHub Actions → Railway; rollback = redeploy of the previous green commit).
- **Strong fit for the NFRs**: Next.js SSR for SEO/LCP, Cloudflare CDN for static assets and R2-hosted images, Redis-cached listings, and Neon PITR + daily snapshots (RPO ≤ 24h) map directly onto the E2E §17 targets without bespoke infrastructure.
- **Fast, low-friction setup**: managed TLS (Railway/Cloudflare), encrypted Railway env vars for secrets, and Railway health checks with automatic restart give a working 99.5%-availability posture with minimal configuration.

### Negative

- **Deviation from the org baseline**: we lose the shared tooling, runbooks, and institutional knowledge built around `AWS Lightsail baseline`. Future maintainers familiar with the org default must learn Railway/Neon specifics; cross-project portability of ops practice is reduced. This cost is borne by whoever operates and hands over the system.
- **No multi-AZ**: the economical Railway/Neon plans run single-AZ, so the platform has a single point of failure. This is accepted for the stated 99.5% monthly availability target, but a zone/provider outage means downtime with no automatic failover (mitigation is restart/redeploy and Neon restore within RTO ≤ 4h).
- **Vendor lock-in**: coupling to Railway (compute + Redis add-on) and Neon (managed Postgres + `pgvector`) makes a future migration non-trivial — Railway service/topology config and Neon-specific operational features would have to be re-platformed. R2 (S3-compatible) is the least locked-in of the three.
- **Data-residency open question**: Railway and Neon run in **US-East**. Argentine PII under **Ley 25.326** may require local residency; this is an open legal question (E2E §23 Q-3) carried as an accepted risk, not a resolved constraint. If the law forces AR residency, the chosen region (and possibly the provider) must change.
- **Reduced observability depth**: choosing Railway-native metrics + Sentry over the Grafana stack means coarser metrics and no self-owned long-term metric/trace retention or custom dashboards beyond what Railway and Sentry provide. Accepted as proportionate to budget and scale.

### Neutral

- **US-East region choice** is currently driven by cost and acceptable latency to MercadoPago AR; it is adjustable and defaults to US-East only until the residency question (Q-3) is resolved.
- **Secrets live in Railway encrypted env vars** (MercadoPago, Gemini, Resend, JWT secret, DB/Redis URLs) — never in the repo or image. Secret rotation is a Railway env change + redeploy.
- **Backups are provider-native**: Neon PITR + daily snapshots and R2 image versioning replace any self-managed backup pipeline; the restore runbook (E2E §19) depends on Neon and Railway tooling.
- **Sentry becomes the primary error/alerting surface** for both frontend and backend, with `pino` structured logs shipped to Railway logs.

## Alternatives considered

### Alternative A: AWS Lightsail baseline (the org default)

- **What it would have meant**: follow `AWS Lightsail baseline` — Lightsail Container/Instance for compute, Lightsail/RDS managed PostgreSQL, S3 for images, SES/SMTP for email, Cloudflare free tier at the edge.
- **Why rejected**: heavier operational footprint and cost than this budget and team need. Managed `pgvector` + HNSW and a managed Redis queue are more turnkey on Neon + Railway than on the Lightsail stack, and Railway's developer experience and single-project model better fit a solo team. The baseline's value (shared org tooling) does not outweigh the ops/cost overhead here.
- **What it would have required to change our minds**: an org mandate to standardize on AWS, a need for the shared Lightsail runbooks/tooling, or a hard requirement (e.g., compliance) only satisfiable on AWS.

### Alternative B: AWS enterprise (RDS Multi-AZ, EKS)

- **What it would have meant**: production-grade AWS — RDS Multi-AZ Postgres, EKS for compute, full HA and scaling headroom.
- **Why rejected**: far over budget for a single-location hardware store at ~50 concurrent users and ~5,000 SKUs. The operational complexity (Kubernetes, multi-AZ data) is unjustifiable for a solo team and the current scale; it solves problems this project does not yet have.

### Alternative C: Vercel + Supabase

- **What it would have meant**: Vercel for the Next.js frontend (and serverless functions) and Supabase for managed Postgres (`pgvector` supported), with separate handling for the long-running worker and queue.
- **Why rejected**: viable and competitive, but Railway provides a simpler single-project model that hosts the SSR app, API, a **long-running worker**, and **Redis** together. Vercel's serverless model is a poor fit for a persistent BullMQ worker (ADR 0004), and splitting compute across Vercel + a separate worker host adds coordination overhead that Railway avoids. Not rejected on quality — rejected on fit for the worker + queue topology.

### Do nothing (status quo)

- **What this would have meant**: ship no platform — keep the store without an e-commerce, or stall on the org baseline decision.
- **Why rejected**: no platform means no product. The store has no prior digital presence; "do nothing" forfeits the entire engagement and the AI-search differentiator. The decision to build is already made; a platform must be chosen.

## Implementation notes

Detailed topology, NFR mapping, and runbooks live in the E2E (§13 Deployment, §17 NFRs, §18 Observability, §19 Runbooks) and in the OpenSpec infrastructure change, not here. High-level pointers:

- One Railway project with `web` (Next.js SSR), `api` (NestJS), `worker` (BullMQ consumer), and a Redis add-on.
- Neon PostgreSQL with `pgvector` + HNSW (see ADR 0002 for the datastore decision and ADR 0004 for the Redis/BullMQ decision).
- Cloudflare for DNS/CDN and R2 for product images (public URLs consumed by `web`; uploaded by `worker` during import).
- Secrets in Railway encrypted env vars; TLS managed by Railway/Cloudflare; deploys via GitHub Actions → Railway with redeploy-the-previous-commit rollback.
- Confirm the concrete Neon/Railway plans that guarantee `pgvector` + HNSW and PITR backups (E2E §23 Q-2) before provisioning.

## Validation criteria

- We expect the platform to sustain the E2E §17 NFRs at launch scale: 99.5% monthly availability, p95 catalog/detail reads < 300ms, LCP < 2.5s, RPO ≤ 24h, RTO ≤ 4h.
- **We will revisit this decision if** sustained traffic exceeds ~50 concurrent users (the point at which the economical single-AZ plans and the no-replica assumption stop holding — E2E §21), **or** if **Ley 25.326** is determined to require Argentine data residency for PII (E2E §23 Q-3), which would force a region and possibly provider change.

## References

- E2E: [`docs/product/design-e2e.md`](../../product/design-e2e.md) §13 (Deployment), §16 (Stack), §17 (NFRs → infrastructure), §18 (Observability — OSS deviation note), §20 (Decisions needing an ADR — ADR-001 trigger)
- Org baseline deviated from: the organization's default infrastructure baseline (`AWS Lightsail baseline`).
- Platform configuration (fixed for this project): `platform: railway · db: neon-postgres-pgvector · storage: cloudflare-r2`
- Related ADRs: ADR 0002 (Neon + `pgvector`), ADR 0004 (Redis + BullMQ on Railway)

---

> **Last updated**: 2026-06-15
> **Author**: Gabriel Suarez (Arquitecto)
