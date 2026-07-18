# ADR 0009: Phased admin-authentication seam — ships in US-001, hardened in US-014

> **Status**: Accepted
> **Date**: 2026-07-18
> **Decision-makers**: Gabriel Suarez (Arquitecto)
> **Supersedes**: —
> **Superseded by**: —
> **Related**: ADR 0005 (first-party JWT auth — refined here), ADR 0007 (NestJS monolith), ADR 0004 (Redis rate-limit — relevant to the hardened login in US-014)

## Context

US-001 (admin del catálogo de productos) is the first behaviour-bearing User Story of cycle 1 and the day-1 critical-path US — it blocks US-002/003/005/006. Its **AC-8** requires role-gated access to the admin surface: a visitor without an admin session must be denied, and no catalog-administration operation may be exposed. So US-001's backend Fase 3 needs an admin RBAC guard *now*.

The full authentication surface — customer registration, login, `httpOnly`+`Secure`+`SameSite` cookie, rotated refresh token, bcrypt, login rate-limit, optional 2FA — belongs to **US-014** (registro-login) and is governed by **ADR 0005** (first-party JWT auth). This creates an ordering tension: in the dependency DAG US-014 is `blocked_by: [US-001]`, yet US-001 must gate its admin panel *before* the full login mechanism from US-014 exists. Inverting that dependency would push US-001 — the foundational, critical-path US — behind US-014 and delay the whole cycle.

This tension surfaced as **OQ-1** in the US-001 backend OpenSpec change (`openspec/changes/US-001-admin-catalogo-productos-backend/proposal.md`), resolved on 2026-07-18. The E2E §14 STRIDE baseline requires the admin mutating endpoints (`POST`/`PATCH /v1/admin/*`) to be authoritatively gated server-side; leaving the panel unguarded until US-014 is not an option.

The question this ADR answers: **how do we satisfy US-001's AC-8 admin RBAC requirement without inverting the DAG, while keeping ADR 0005's full auth model intact for US-014?**

## Decision

We will ship a **minimal admin-authentication seam in US-001** and **harden it in US-014 without rewriting the guard**.

Concretely: US-001 delivers an `AdminGuard` that validates a JWT carrying the claim `role=admin`, signed with the platform `JWT_SECRET` (validated env, per ADR 0005's secret model), plus a **scoped admin-token issuance mechanism behind config** (a basic admin login or a bootstrap seed token) — **without** customer registration, refresh rotation, login rate-limit, or 2FA. US-014 later **replaces and hardens the issuance side** (full login, `httpOnly`+`Secure`+`SameSite` cookie, rotated refresh, login rate-limit, 2FA) while **preserving the `role=admin` contract** — the guard itself is not rewritten. The DAG is **not** inverted: US-001 keeps no `blocked_by` and its backend Fase 3 (guard) executes.

## Consequences

### Positive

- **US-001 stays unblocked**: the day-1 critical-path US ships its AC-8 gate without waiting for US-014, so cycle 1's dependency chain (US-002/003/005/006) is not delayed by an auth ordering artifact.
- **DAG integrity preserved**: no dependency inversion — US-014 remains `blocked_by: [US-001]` as designed, and the DAG stays acyclic and truthful.
- **Stable contract across the seam**: US-014 hardens only the token *issuance* side; because the `role=admin` claim contract is fixed in US-001, the guard and all `/v1/admin/*` consumers are untouched when the full AuthModule lands.
- **STRIDE baseline met immediately**: server-side RBAC on the admin mutating endpoints (spoofing/elevation controls per E2E §14) is authoritative from US-001, not deferred.
- **Consistent with ADR 0005**: the seam reuses ADR 0005's platform `JWT_SECRET` and first-party JWT model; no new crypto primitive is invented (the `threat-modeling-lite` escalation rule does not fire).

### Negative

- **Deliberate, bounded double-implementation**: a slice of auth (the token-issuance path of the seam — basic admin login / bootstrap seed token) is built in US-001 and then replaced/hardened in US-014. This is real, accepted rework, borne by the implementing engineer across the two USs. It is bounded to the issuance side; the guard and the `role=admin` contract are written once.
- **Interim issuance is intentionally weak**: until US-014, the admin token has no rotated refresh, no login rate-limit, and no 2FA. If the seam's basic login were exposed prematurely, it would be a softer target than the hardened flow — hence the config gate / feature flag and the expectation that US-014 follows in the same programme.
- **Two places must stay in sync on one contract**: the `role=admin` claim shape is now a contract spanning US-001 (guard + interim issuance) and US-014 (hardened issuance). A change to that claim shape requires touching both; this ADR and the US-014 back-link exist precisely so that coupling is discoverable.

### Neutral

- **A feature flag / config gate governs the interim admin login** so it can be disabled once US-014's hardened issuance is live (per the US-001 backend `design.md` deployment notes).
- **`JWT_SECRET` becomes a required platform variable from US-001's first deploy**, not from US-014 — the secret provisioning moves earlier in the timeline (already anticipated by ADR 0005 and the deployment plan).
- **The guard's ownership is US-001's**; US-014 owns issuance. This split is documented so neither US re-implements the other's part.

## Alternatives considered

### Alternative A: Minimal seam in US-001, hardened in US-014 (chosen)

- **What it would have meant**: exactly the decision above — a thin `AdminGuard` + scoped interim issuance now, full AuthModule replacing the issuance later, guard contract preserved.
- **Why chosen**: it satisfies AC-8 and the E2E §14 STRIDE baseline immediately, keeps the DAG uninverted, and confines the rework to the issuance side while writing the guard and the `role=admin` contract once.
- **Accepted cost**: the bounded double-implementation of the issuance path (see Negative).

### Alternative B: Invert the DAG — move all admin auth to US-014

- **What it is**: relocate every auth concern (including the admin guard) to US-014, make US-001 `blocked_by: [US-014]`, and ship US-001 without AC-8 until US-014 lands.
- **Pros**: auth is implemented exactly once, in one module, with no seam and no interim issuance.
- **Cons**: it inverts the dependency between a foundational critical-path US and a Medium-priority "Should" US; US-001 (and everything it blocks: US-002/003/005/006) waits for US-014.
- **Why rejected**: delaying the day-1 critical-path US behind a later, lower-priority US to avoid a bounded slice of rework is the wrong trade for cycle 1. The DAG would model priority backwards.

### Do nothing — expose the admin panel unguarded until US-014

- **What it is**: ship US-001's admin CRUD with no RBAC gate, relying on US-014 to add the guard later.
- **Pros**: no seam, no interim issuance, no rework — US-001's backend is simpler in the short term.
- **Cons**: the admin mutating endpoints (`POST`/`PATCH /v1/admin/*`) would be open to any caller until US-014, violating AC-8 and the E2E §14 STRIDE controls for spoofing and elevation of privilege.
- **Why rejected**: an unguarded admin surface is a hard security-baseline violation, not a deferrable nicety. AC-8 is an acceptance criterion of US-001 itself.

## Implementation notes

Detailed implementation lives in the OpenSpec change, not here. Pointers:

- The seam lives in `apps/api/src/auth/` (see the US-001 backend `design.md` §Seguridad): `AdminGuard` validates JWT signature + `role=admin` claim; missing session → `401`, insufficient role → `403`.
- `JWT_SECRET` comes from platform variables (never in repo); the interim admin login / bootstrap seed token sits behind config and a feature flag.
- US-014 replaces only the issuance path (login, cookie attributes, refresh rotation, rate-limit backed by Redis per ADR 0004, 2FA) and must preserve the `role=admin` claim contract — the guard is not rewritten.

## Validation criteria

- We expect US-001 to ship AC-8 (admin RBAC) on schedule without acquiring a `blocked_by` on US-014.
- We will consider the seam correctly designed if US-014 lands its hardened AuthModule **without modifying `AdminGuard` or any `/v1/admin/*` consumer** — i.e., the rework is confined to issuance.
- We will revisit this decision if the `role=admin` claim contract needs to change before US-014, or if additional admin roles emerge (which would widen the guard's contract beyond a single claim).

## References

- OpenSpec change (OQ-1, `[Resolved: 2026-07-18]`) + seam spec: `openspec/changes/US-001-admin-catalogo-productos-backend/proposal.md` §Open questions, `design.md` §Seguridad
- User stories: `docs/user-stories/US-001-admin-catalogo-productos.md` (AC-8), `docs/user-stories/US-014-registro-login.md`
- E2E design: `docs/product/design-e2e.md` §14 (STRIDE), §20 (ADRs)
- Standards: `spekode/docs/code/backend-node-standards.md` §7 (config/secrets validated at boot); skill `threat-modeling-lite` (STRIDE of admin mutating endpoints)
- Related ADRs: ADR 0005 (first-party JWT auth — this ADR refines *how/when* the admin portion is delivered; ADR 0005 remains Accepted), ADR 0007 (NestJS monolith), ADR 0004 (Redis rate-limit)

---

> **Last updated**: 2026-07-18
> **Author**: adr-writer agent (assisted by @Gabriel Suarez)
