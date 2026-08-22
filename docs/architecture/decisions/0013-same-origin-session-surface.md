# ADR 0013: The browser talks only to the site origin for the session surface

> **Status**: Accepted
> **Date**: 2026-08-22
> **Decision-makers**: Gabriel Suarez (Arquitecto)
> **Supersedes**: —
> **Superseded by**: —
> **Amends**: —
> **Related**: ADR 0011 (server-side refresh-token store — the cookies this ADR routes),
> ADR 0010 (URL namespace: storefront at the root, panel under `/admin/*`),
> ADR 0001 (Railway), ADR 0007 (modular monolith)

## Context

US-014 puts the customer session in cookies: `dsm_access` (HttpOnly), `dsm_refresh`
(HttpOnly, scoped to `/v1/auth`) and `dsm_csrf` (readable by design — it is half of the
double-submit check).

Cookies only work if they come back. The API issues **host-only** cookies, and on Railway the
site and the API live on different `*.up.railway.app` subdomains. **`up.railway.app` is on the
Public Suffix List**, which means the browser treats those two subdomains as *different sites*,
not as siblings under a shared parent. A cookie set by the API host is therefore never sent
back to the site host, and no `SameSite` or `Domain` value fixes it: the PSL entry exists
precisely to stop one tenant from setting cookies for another.

That premise was load-bearing for the whole frontend of US-014, and it had never been tested.

## Decision

**The browser never addresses the API directly for the session surface.** The Next app rewrites
`/v1/auth/:path*` to the API origin, read from a **server-only** `API_INTERNAL_ORIGIN` (no
`NEXT_PUBLIC_` prefix — the browser has no business knowing the API's address for this).

From the browser's point of view there is one origin: the site's. `Set-Cookie` therefore lands
on the site's host, and the cookie is returned on subsequent requests.

The rewrite is declarative Next configuration, not a hand-rolled proxy: it adds no `fetch` and
no route handler, so the "one HTTP client" rule stays intact.

**This applies to the session surface only.** Public catalog reads (product, categories) keep
going to the API origin directly — they carry no credentials and benefit from being cacheable
at the edge by the API's own headers.

## Consequences

**Positive**

- Works identically in local development, on Railway today, and behind a custom domain later.
  No environment needs a different cookie strategy, and no future domain change reopens it.
- The API's address stops being public information for this surface.
- Same-origin requests avoid CORS preflight on the auth calls entirely.

**Negative**

- Auth traffic goes through the Next server, which adds a hop and makes the web process part of
  the login path. For an owner-scale storefront this is immaterial; at high volume it would need
  measuring.
- `API_INTERNAL_ORIGIN` becomes a required production variable. It fails loud at boot if absent,
  because a rewrite pointing at `undefined` returns 404 on login — a symptom that says nothing
  about its cause.

**Neutral**

- The custom domain that US-019 will eventually provision would also solve the PSL problem by
  putting site and API under a registrable parent. This ADR does not become obsolete then: the
  rewrite keeps the API address private and keeps one code path across environments.

## Alternatives considered

- **Cookies scoped to a shared parent domain.** Impossible today: `up.railway.app` is on the
  PSL, so there is no usable shared parent. It would become possible with a custom domain, which
  does not exist yet and is gated on US-019.
- **A Route Handler acting as a proxy.** Rejected: it reintroduces a hand-written HTTP client
  for a problem that configuration already solves, and it would break the single-client rule the
  frontend standards enforce.
- **Tokens in `localStorage` instead of cookies.** Rejected outright: it makes the session token
  readable by any script on the page, which is exactly what US-014 AC-9 forbids.

## Verification

Not a paper decision — `apps/web/e2e/auth-topology.spec.ts` proves it against the **built** app:
the login POST from the site origin returns 200, `context.cookies()` shows `dsm_access` as
`httpOnly` on the **site's** host, `dsm_csrf` readable, and a subsequent `/v1/auth/me` returns
200 (the cookie came back) while the same call without a session returns 401 (the 200 was not a
false positive). Every assertion is on `response.status()` and `context.cookies()`, never on the
DOM.

## References

- US-014 — `openspec/changes/US-014-registro-login-frontend-web/` §OQ-FE-1, T0.3.
- Public Suffix List — the `up.railway.app` entry, verified independently before ratifying.
- ADR 0011 — the refresh-token store whose cookies this decision routes.
- Inherited by: US-007 (cart, if it moves to a cookie-authenticated surface) and US-015.
