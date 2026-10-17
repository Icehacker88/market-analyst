# Authentication security: phase 2 backlog

Status: deferred. The first phase only establishes session-only application identity, request-local Worker dependencies, and browser data isolation. The items below are **not implemented in that phase**. No production deployment or historical data migration is included.

| Area | Remaining work | Acceptance boundary |
| --- | --- | --- |
| Apple OAuth | Verify the ID token signature with Apple's trusted keys; validate the permitted algorithm, issuer, audience, required expiry and nonce before using `email` or `sub`. | Decoding a token payload or obtaining it through the token endpoint is not a substitute for signature verification. Reject unsigned, tampered, expired and incorrectly targeted tokens. |
| Google OAuth | Require a verified email before email-based account linking; review provider-subject linking rules. | `email_verified: false` or a missing verification claim must not create a confirmed email identity or link an existing account by email. |
| Email signup | Add proof of email ownership and define confirmation requirements for email delivery and administrative access. | Do not treat a successful password signup or a populated `confirmedAt` as proof of mailbox ownership. |
| OAuth transaction binding | Bind state to the initiating browser; add and verify nonce, and PKCE where supported. Retain one-time use and expiry checks. | A callback from another browser or a replayed, mismatched or expired transaction must fail. |
| CSRF | Define origin checks and/or CSRF tokens for cookie-authenticated state-changing routes, including account deletion and auth endpoints; account for OAuth callback requirements. | `SameSite=Lax` is one existing mitigation, not the complete CSRF policy. |
| Cloudflare Access | Configure and independently validate protection for admin/staging/internal surfaces only; define application roles or permissions separately. | Ordinary API identity must continue to come only from a verified application session. Access claims must not become a fallback for public users. |
| KV consistency and revocation | Document and test eventual-consistency effects on session creation, lookup, logout and revocation, plus concurrent state writes. Decide stronger coordination separately if required. | Phase 1 retains KV, existing UUIDs, session records and user-state paths; it does not provide globally immediate revocation or atomic state updates, or introduce Durable Objects. |
| Account deletion and pagination | Enumerate every page of sessions and all intended account-owned records; record failures and define retry and completion behavior. | A single KV list page or suppressed deletion error must not be reported as proof that every session and record was removed. |

Phase 2 must receive its own implementation scope and tests. Removing the old request authentication fallback does not, by itself, complete these OAuth, authorization, storage or account-lifecycle controls.
