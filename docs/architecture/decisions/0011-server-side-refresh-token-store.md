# ADR 0011: Server-side refresh-token store with rotation and reuse detection

> **Status**: Accepted
> **Date**: 2026-08-18
> **Decision-makers**: Gabriel Suarez (Arquitecto)
> **Supersedes**: —
> **Superseded by**: —
> **Amends**: ADR 0005 (first-party JWT auth) — its `Neutral` note on session invalidation
> **Related**: ADR 0005 (first-party JWT auth — amended here), ADR 0009 (phased admin-auth seam — its issuance side is hardened by US-014), ADR 0007 (NestJS monolith), ADR 0004 (Redis — rate-limit on the login surface)

## Context

ADR 0005 chose first-party JWT authentication and recorded, under `Neutral`, that **session
invalidation would be achieved via a short access-token TTL plus refresh-token rotation rather than
a server-side session store** — accepting that logout and revocation are bounded by the access-token
TTL rather than instantaneous.

US-014 (registro, login y sesión) is the US that actually builds that surface, and its **AC-3**
requires that closing the session **revoke the refresh token**, not merely let it expire. A purely
stateless model cannot satisfy that: without server-side state there is nothing to revoke, so a
stolen refresh token stays valid for its whole lifetime no matter what the user does.

`security-standards.md` §3.3 is the second driver. It mandates **reuse detection** on refresh
tokens: if a rotated (already-used) token is presented again, that is the signature of a stolen
token being replayed, and the correct response is to revoke the **entire token family**, not just
the presented one. Reuse detection is, by definition, stateful — it requires remembering which
tokens were issued, which were rotated, and which family they belong to.

The tension is therefore not "stateless vs stateful" in the abstract: ADR 0005's note was a
reasonable default for a scope that had no logout requirement yet. US-014 introduces one, and
§3.3 raises the bar from "bounded exposure" to "detect and contain the theft".

The question this ADR answers: **how does the session model change now that revocation and reuse
detection are required?**

## Decision

We will keep a **server-side store of refresh tokens** — the `refresh_tokens` table in the primary
PostgreSQL (ADR 0002, single datastore) — with three properties:

- **Rotation**: every use of a refresh token issues a new one and marks the presented token
  `rotated_at`. A refresh token is single-use.
- **Reuse detection**: presenting a token that already carries `rotated_at` (or `revoked_at`) is
  treated as theft. The whole **family** (`family_id`, shared by every token descended from one
  login) is revoked, forcing re-authentication.
- **Revocation**: logout sets `revoked_at`, so invalidation is **immediate** and no longer bounded
  by the access-token TTL for the refresh path.

Only the **hash** of the token is stored (`token_hash`, unique), never the token itself: a database
leak must not hand an attacker usable sessions.

The **access token stays stateless and short-lived** (`AUTH_ACCESS_TTL_MIN`, default 15 min). We are
not introducing a session store for every request — the state is confined to the refresh path, which
is low-traffic. This preserves ADR 0005's core benefit (no per-request datastore hit) while removing
the specific limitation its `Neutral` note accepted.

**This amends ADR 0005; it does not supersede it.** Everything else ADR 0005 decided — first-party
auth, bcrypt, JWT, the secret model — stands unchanged, and ADR 0005 remains `Accepted`.

## Consequences

### Positive

- **AC-3 becomes satisfiable**: logout genuinely revokes, instead of leaving a window equal to the
  token TTL.
- **Theft is detected and contained**, not merely time-boxed: replaying a rotated token kills the
  family (`security-standards` §3.3).
- **No new infrastructure**: the table lives in the datastore ADR 0002 already chose. No Redis
  dependency on the auth path, so login keeps working if the cache tier is down.
- **A database leak does not yield sessions**, because only hashes are stored.

### Negative

- **The refresh path now hits the database**, adding a query per refresh. Confined to refresh
  (roughly once per access-token TTL per active session), not per request.
- **A table that grows and needs pruning**: expired and revoked rows accumulate. Requires a cleanup
  job — declared in US-014's design and owned by it, not left implicit.
- **More code to keep correct**: rotation and reuse detection are exactly the kind of logic where a
  subtle bug silently disables the protection. Mitigated by the negative-space tests US-014 declares
  (a rotated token must fail, and must revoke its family).

### Neutral

- **`family_id` is the unit of revocation**, so "log out everywhere" is a family sweep rather than a
  per-device decision. Per-device session management is not in scope for US-014.
- **The admin seam of ADR 0009 is unaffected in contract**: US-014 hardens the *issuance* side while
  preserving `role=admin`, exactly as ADR 0009 anticipated.

## Alternatives considered

| Alternative | Why not |
|---|---|
| **Keep the stateless model of ADR 0005** | Cannot satisfy AC-3 (revoke on logout) nor §3.3 (reuse detection). The gap is functional, not stylistic. |
| **Refresh tokens in Redis** | Adds a hard dependency on the cache tier for authentication: if Redis is down, nobody can refresh a session. ADR 0004 scoped Redis to queues, cache and rate-limit — deliberately not to the auth path. The volume does not justify the coupling. |
| **Store the token in plain text** | A database leak would hand over usable sessions. Storing only the hash costs nothing and removes that class of failure. |
| **Per-token revocation without families** | Detects nothing: revoking only the replayed token leaves the thief's rotated descendants valid. Family revocation is what makes reuse detection meaningful. |

## References

- US-014 `docs/user-stories/US-014-registro-login.md` — AC-3 (revocación al cerrar sesión).
- `security-standards.md` §3.3 — rotación, detección de reuso y revocación de familia.
- ADR 0005 — decisión de auth propia que este ADR enmienda.
- ADR 0009 — seam de auth admin cuya emisión endurece US-014.
