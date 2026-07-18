# ADR 0005: First-party JWT authentication in the NestJS backend

> **Status**: Accepted
> **Date**: 2026-06-15
> **Decision-makers**: Gabriel Suarez (Arquitecto)
> **Supersedes**: —
> **Superseded by**: —
> **Related**: ADR 0007 (NestJS monolith), ADR 0004 (Redis rate-limit), ADR 0009 (phased admin-auth seam — refines how/when the admin portion of this auth is delivered)

## Context

The DSM ferretería platform needs authentication for two roles: the **customer** (a registered account, optional) and the **admin** (the store owner, Pedro). The primary purchase path is **guest checkout**, which requires no authentication and covers the core loop end-to-end. Registered customer accounts — enabling purchase history and a smoother repeat-purchase experience — are a committed "Should" capability in the PRD, not a "Must". The admin needs an authenticated, role-gated surface to manage the catalog and orders.

The budget is that of a small hardware store, so recurring SaaS costs are a real constraint. The overall authentication scope is deliberately small: two roles, optional customer registration, a single admin, and no near-term requirement for social login, SSO, or organization-level identity management.

The E2E §14 STRIDE analysis sets the security baseline this decision must satisfy: tokens must live in `httpOnly` cookies (never `localStorage`) to mitigate token theft via XSS; login error messages must be generic to prevent account enumeration; and login must be rate-limited (backed by Redis per ADR 0004) to mitigate brute force.

The question this ADR answers: **how do we implement authentication for the customer and admin roles given a small scope, a tight budget, and a defined STRIDE security baseline?**

## Decision

We will implement **first-party authentication in the NestJS backend using Passport + JWT**. The access token is short-lived and delivered in an `httpOnly` + `Secure` + `SameSite` cookie, paired with a rotated refresh token. Passwords are hashed with **bcrypt**. A **role guard** gates the admin/owner surface, with **optional 2FA** available for the admin account.

Registered customer accounts are delivered as a "Should" capability; guest checkout remains the primary, auth-free path for the core loop.

## Consequences

### Positive

- **Zero SaaS cost**: no per-MAU or per-seat billing from an external identity provider, which fits a hardware-store budget at any traffic level.
- **Full control over the auth surface**: token TTLs, cookie attributes, rotation policy, and error-message wording are all ours to tune directly against the E2E §14 STRIDE baseline.
- **Right-sized to the scope**: with two roles, optional registration, and one admin, a managed provider's feature set (orgs, social login, SSO) is largely unused — owning a small amount of auth code is proportionate.
- **No external runtime dependency on the critical path**: login and session validation do not depend on a third-party service's availability or rate limits.

### Negative

- **We own the security surface**: brute force, account enumeration, and token theft become our responsibility to defend (the E2E §14 mitigations are necessary, not optional). A mistake here is our liability, not a vendor's.
- **More code to build and maintain**: password reset, email verification, token rotation/revocation, and 2FA must all be implemented and kept correct — capabilities a managed provider would supply out of the box. This cost is borne by the implementing/maintaining engineer over the life of the project.

### Neutral

- **Session invalidation is achieved via short access-token TTL plus refresh-token rotation** rather than a server-side session store. This is an acceptable trade-off for the scope but means logout/revocation is bounded by the access-token TTL rather than instantaneous.
- **bcrypt cost factor** becomes a tunable operational parameter (CPU vs. resistance) we must choose and revisit.

## Alternatives considered

### Alternative A: Managed SaaS auth (Clerk / Supabase Auth / Auth0)

- **What it would have meant**: delegate identity to a hosted provider, getting password reset, email verification, social login, and token issuance largely for free.
- **Why rejected**: it adds an external dependency and a potential cost at scale. Free tiers would comfortably suffice for the MVP, but the scope is small enough that first-party auth is acceptable and cost-free, and it avoids coupling a core flow to a third party we would not otherwise need.
- **What it would have required to change our minds**: significantly broader auth requirements — social login, SSO, or an MFA mandate — where a provider's built-in features would outweigh the dependency cost.

### Alternative B: Guest-only (do nothing)

- **What it would have meant**: ship only guest checkout and implement no authentication at all; no registered accounts, no admin login.
- **Why rejected**: registered customer accounts with purchase history are a committed "Should" capability in the PRD, and the admin surface requires an authenticated, role-gated entry point. Guest-only cannot satisfy either, so it does not meet scope.

## Implementation notes

- Detailed implementation belongs in the corresponding OpenSpec change, not here.
- Cookie attributes (`httpOnly`, `Secure`, `SameSite`), access-token TTL, and refresh-token rotation policy follow the E2E §14 STRIDE baseline.
- Login rate limiting reuses the Redis mechanism established in ADR 0004.
- The admin role guard protects management endpoints; 2FA is opt-in for the admin account.

## Validation criteria

- We expect guest checkout to remain the dominant, friction-free path, with customer registration adopted incrementally as a "Should" capability.
- We will revisit this decision if authentication requirements grow — specifically SSO, social login, or an external MFA/compliance mandate — at which point a managed SaaS provider may become the better choice.

## References

- E2E design: `docs/product/design-e2e.md` §6.1, §14, §16, §20
- PRD: `docs/product/prd.md` §7
- Related ADRs: ADR 0007 (NestJS monolith), ADR 0004 (Redis rate-limit), ADR 0009 (phased admin-auth seam — refines how/when the admin portion is delivered)

---

> **Last updated**: 2026-06-15
> **Author**: Gabriel Suarez (Arquitecto)
