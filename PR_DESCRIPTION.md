# PR Title

feat: OIDC single sign-on with IdP role mapping

# PR Description

## Summary

Adds native OpenID Connect authentication so an external identity provider can fully replace umami's local user accounts, with IdP **role grants** controlling umami access levels. Upstream has declined this repeatedly (umami-software/umami#1112, #1477, #1608, #3163), so this implements it in the fork.

The implementation is generic OIDC (discovery-document based, authorization code + PKCE) — any spec-compliant identity provider works.

## How it works

- **`GET /api/auth/oidc/authorize`** builds the authorization URL via [`openid-client`](https://github.com/panva/openid-client) (PKCE S256 + `state` + `nonce`) and stores the transient login state in a short-lived (10 min) `HttpOnly` cookie, sealed with umami's existing AES-256-GCM `encrypt()`/`secret()`.
- **`GET /api/auth/oidc/callback`** validates the code exchange (state, nonce, ID-token signature/issuer/audience via JWKS), resolves the user's role from the roles claim, provisions/syncs the user, and mints a standard umami auth token — then hands it to the SPA via a fragment redirect to `/sso-complete#token=…&sid=…` (fragments never reach servers or `Referer`). The `sid` is a one-time nonce, mirrored in a short-lived cookie set by the callback, that `/sso-complete` must match before storing the token — so a link with a planted token from another browser is rejected (login-CSRF defense). Userinfo is fetched and merged (ID-token claims win) whenever the ID token lacks the roles claim or profile claims.
- **Role mapping**: role keys are read from `OIDC_ROLES_CLAIM` (default `roles`; object-map, array, and delimited-string shapes supported; exact URN/URL-style names match first, with dot notation for nested claims like `realm_access.roles`) and mapped through `OIDC_ROLE_ADMIN` / `OIDC_ROLE_USER` / `OIDC_ROLE_VIEW_ONLY` (comma-separated lists, admin > user > view-only precedence). **No mapped role ⇒ login denied.** Roles re-sync from the IdP on every login, so grant changes in the IdP take effect at next login — and immediately for authorization checks, since `checkAuth` reads the role from the DB per request.
- **JIT provisioning**: users are auto-created on first login, keyed by new nullable `oidc_issuer` / `oidc_subject` columns (+ compound unique index, migration `25_add_oidc`). Username comes from `preferred_username` → `email` → `sub` (lowercased; suffixed on collision). JIT users get a random unusable bcrypt password so the existing password-fingerprint token invalidation stays intact.
- **Local login is disabled when OIDC is enabled** — both the login form and `POST /api/auth/login` (403 `local-login-disabled`). `OIDC_ALLOW_LOCAL_LOGIN=1` is the break-glass that keeps password login available.
- **Session lifetime**: OIDC-minted tokens expire after `OIDC_SESSION_DURATION` (default 24h), unlike local login's non-expiring tokens, bounding access for users de-provisioned at the IdP.
- OIDC logins bypass umami's local 2FA (the IdP owns MFA).

## Configuration

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `OIDC_ISSUER` | yes (enables OIDC) | — | Discovery at `<issuer>/.well-known/openid-configuration` |
| `OIDC_CLIENT_ID` | yes when enabled | — | OAuth client ID |
| `OIDC_CLIENT_SECRET` | no | — | Omit for public client + PKCE |
| `APP_URL` | yes when enabled | — | Public base URL; redirect URI is `<APP_URL><BASE_PATH>/api/auth/oidc/callback` |
| `OIDC_ROLE_ADMIN` / `OIDC_ROLE_USER` / `OIDC_ROLE_VIEW_ONLY` | ≥ 1 of 3 | — | IdP role keys → umami role |
| `OIDC_SCOPES` | no | `openid profile email` | Requested scopes (add provider-specific scopes needed for role claims) |
| `OIDC_ROLES_CLAIM` | no | `roles` | Claim holding role keys (dot notation for nested claims) |
| `OIDC_ALLOW_LOCAL_LOGIN` | no | off | Keep password login (break-glass) |
| `OIDC_PROVIDER_NAME` | no | `SSO` | Login button label |
| `OIDC_RP_LOGOUT` | no | off | End the IdP session on logout |
| `OIDC_AUTO_LINK_USERNAME` | no | off | Adopt an existing local account with matching username on first SSO login |
| `OIDC_SESSION_DURATION` | no | `24h` | Lifetime of SSO-minted umami sessions |

`scripts/check-env.js` validates the combination at build time; the README documents provider setup.

## Changes

- **New**: `src/lib/oidc.ts` (config, cached discovery, role mapping, state sealing, JIT provisioning), `src/app/api/auth/oidc/{authorize,callback,logout}/route.ts`, `src/app/sso-complete/`, `src/app/login/SsoLoginForm.tsx`, `prisma/migrations/25_add_oidc/`, `src/lib/oidc.test.ts`
- **Modified**: `prisma/schema.prisma` (two nullable columns + unique index on `user`), `src/app/api/auth/login/route.ts` (server-side gate), `src/app/login/*` (SSO button, error banner), `src/app/logout/LogoutPage.tsx` (optional RP-initiated logout), `src/app/api/config/route.ts` + `useConfig` (runtime flags), `ProfileSettings.tsx` (hide password change), `src/queries/prisma/user.ts` (identity lookups), `scripts/check-env.js`, `src/components/messages.ts` + `en-US.json`, `README.md`
- **Dependency**: `openid-client` (OpenID Foundation–certified RP library; wraps `oauth4webapi`/`jose`)

> Per `CONTRIBUTING.md`, pull requests should target the `dev` branch, not `master`.

## Notes for reviewers / operators

- Local users who are already logged in keep their (non-expiring) sessions when OIDC-only mode is turned on; rotate `APP_SECRET` to force re-authentication through the IdP.
- Do **not** set `DISABLE_LOGIN` together with OIDC — the login page must render to show the SSO button.
- `OIDC_AUTO_LINK_USERNAME` defaults to off because linking by username is an account-takeover surface if the IdP lets users choose their own `preferred_username`. When enabled, linking only happens from `preferred_username` or from `email` with `email_verified: true` — never from the bare subject id.
- Existing OIDC users are never renamed when a token carries no profile claims (prevents accidental rename to the numeric subject id), and a username-rename race falls back to keeping the old name instead of failing the login.
- Without `REDIS_URL`, umami tokens cannot be revoked server-side before expiry; the 24h default session duration bounds this.
- Team-role mapping from IdP claims is intentionally out of scope (phase 2); only global roles sync.

## Testing

- 29 new unit tests (`src/lib/oidc.test.ts`): role-claim normalization and precedence, state/handoff cookie attributes and round-trip/tamper/expiry, username selection/truncation, JIT provisioning incl. collision suffixing, no-profile-claims rename guard, rename-race fallback, auto-link gating (verified email / preferred_username only), and concurrent-first-login (P2002) recovery. Full suite: **768/768 passing**.
- Audited: independent high-effort code review (6 findings — all fixed) plus a security-focused review of the auth flow (state replay, role-claim confusion, account linking, token leakage, redirect handling, local-login bypass paths — no exploitable findings; the one login-CSRF-class note was hardened via the `sid` handoff nonce).
- `next build` passes; biome lint/format clean on all changed files; `check-env` verified for enabled/disabled/misconfigured combinations.
- Manual E2E against your identity provider is still recommended before production rollout (first-login provisioning, grant change → role re-sync, grant removal → `oidc-no-role`, RP logout round-trip, `BASE_PATH` deployments).
