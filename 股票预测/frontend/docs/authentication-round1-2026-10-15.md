# Orivane Authentication — Round 1 (local only)

Date: 2026-10-15. Base: `aee719e6aec0ededdd7000d34807c8250708994e`.
Branch: `codex/authentication-round1`.
Worktree: `/Users/icehacker/.codex/worktrees/orivane-auth-round1/Market Analysis`.

This is a local implementation, not hosted acceptance or a public-launch approval. No plan upgrade, billing change, deployment, remote KV write, real-user inspection or production credential use occurred. The UI checkout and old frozen auth branch were not used as implementation sources. Google/Apple callbacks, administrator authorization, user-state/research logic, Snapshot and forecasting were not changed. Password signup now rejects administrator-reserved addresses before creating an account; authorization itself is unchanged.

## Selected scheme and actual runtime evidence

- Production dependency pinned to `@noble/hashes@2.4.0`: PBKDF2-HMAC-SHA256, **600000 iterations**, 16 random salt bytes, 32 derived bytes. No custom password algorithm, no iteration reduction, no chained 100000-iteration workaround. New password minimum: 15 Unicode code points. Login retains shorter historical passwords. Passwords are not trimmed or Unicode-normalized.
- `hash-wasm@4.12.0` is a **development-only benchmark dependency**. Its normal Argon2id API at m=19456 KiB/t=2/p=1 fails in actual local workerd with `WebAssembly.compile(): Wasm code generation disallowed by embedder`. This does NOT mean Argon2id is impossible on Workers: a static WASM adapter is possible, but would need an independently maintained bundling integration and concurrency/memory validation. This round chooses the unmodified pure-JS implementation that works through the existing generated Pages entry.
- Current standalone workerd accepts native WebCrypto PBKDF2 at both 210000 and 600000. This differs from the previously recorded hosted iteration-cap error. Cloudflare's workerd issue documents that the limit is configurable; local success cannot establish the hosted setting. The selected JS implementation does not invoke WebCrypto PBKDF2 at all (WebCrypto SHA-256 remains for legacy SHA verification and throttle-key hashing).
- [OWASP password guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [noble-hashes](https://github.com/paulmillr/noble-hashes), [Cloudflare workerd PBKDF2 limit discussion](https://github.com/cloudflare/workerd/issues/1346), [static WASM support](https://developers.cloudflare.com/workers/runtime-apis/webassembly/javascript/).

Reproducible command: `npm run benchmark:password`. It launches only local Miniflare with outbound networking disabled. Benchmark routes exist solely in this script's temporary Worker, never in the generated application. The numeric [benchmark report](authentication-round1-benchmark-2026-10-15.json) contains no passwords, password hashes or session tokens.

| Measurement | This run |
| --- | --- |
| Runtime | Miniflare 4.20260630.0, workerd 1.20260630.1, compatibility date 2026-07-01, Apple arm64 |
| First selected-KDF request | 570 ms; runtime was already started for probes (not a platform cold-start measurement) |
| Five sequential hashes | 540–615 ms/request, 2807 ms total |
| Four concurrent local requests | 2197 ms total; request latency 555–2197 ms; synchronous KDF work queues within one isolate |
| V8 non-idle CPU sampling | About 566 ms/hash over five hashes; sampling overhead included |
| Retained benchmark JS heap | About 0.86 MiB before and 1.06 MiB after; allocated heap 3.75–4 MiB |
| KDF module minified / gzip | 10350 / 4340 bytes, server-only; not total application bundle |
| Correctness | Correct password accepted, wrong password rejected, independent salts; generated-Worker tests independently compare against Node crypto fixtures |

These are **local workerd** measurements, not Node KDF timing, hosted billed CPU, peak isolate memory, or a guarantee of production throughput. Full API tests run the generated Worker with real local Miniflare KV; Turnstile responses are synthetic. Peak application memory and hosted CPU/outcomes still need Preview measurement. No lower-security fallback activates on runtime errors.

## Stored formats and safe migration

New `password_credential` object: `{scheme: "pbkdf2-sha256", version: 1, iterations, dklen: 32, salt, hash}`. Salt/hash use canonical base64. New records have empty legacy `salt`/`password_hash`; unverified email does not receive a fabricated `confirmedAt`.

1. Explicit current credential: validate scheme/version/parameters/lengths. A malformed explicit field NEVER falls back to legacy data.
2. Historical `pbkdf2_sha256$iterations$salt$hash`: parse the complete format, verify at **its own iterations**, including 210000, 600000 and 1000000 tests. The salt must agree with the old record. Never substitute another iteration count to try to obtain a match.
3. Historical salted SHA-256: only canonical 32-byte base64 with a nonempty salt is accepted, verifying exactly SHA256(`salt:password`). Unknown formats, empty hashes and provider-only records reject.
4. Only a successful verification permits upgrade. Preserve account UUID, created_at, provider metadata, existing sessions, and `users/${user.id}.json` byte contents. New salt and explicit credential are written to the same auth record. Historical iterations above 600000 are preserved in the new format, never lowered.
5. Wrong password and malformed/unknown records do not overwrite account data. Upgrade write failure returns generic 503, issues no new session, and leaves the legacy verifier available for retry. No bulk migration.

Resource bounds: request body 16 KiB; password at most 4096 UTF-8 bytes; legacy salt at most 256 characters; legacy iteration count 1–2000000; current version accepts 600000–2000000. These cover the formats generated by this repository. Records outside these bounds are not reinterpreted or rewritten. Such an account would require explicit compatibility investigation before release, not a guessed algorithm or silent reset; no real records were inspected to assert universal population coverage.

Rollback: once a test or future user upgrades, the product baseline does not understand the new credential. Do not deploy an old password verifier over upgraded accounts or restore an entire old user KV snapshot. A compatible rollback must retain the new verifier (or temporarily disable new password entry while preserving existing sessions) until a reviewed forward fix. No rollback migration has been executed.

## Endpoint behavior and safeguards

- `/auth/config` reports password/registration availability and the public Turnstile site key. Both the server and UI default to disabled when configuration is missing. No Wrangler or remote configuration was changed.
- Required opt-in: `ORIVANE_PASSWORD_AUTH_ENABLED=true`, nonempty `ORIVANE_TURNSTILE_SITE_KEY`, `ORIVANE_TURNSTILE_SECRET_KEY`. Separate `ORIVANE_PASSWORD_SIGNUP_ENABLED=true` is necessary to allow controlled registration tests.
- Password signup/login and logout reject absent/mismatched Origin and cross-site Fetch Metadata. Password requests must be bounded JSON. Other endpoints' semantics are unchanged.
- Signup/login require server-side Turnstile verification **before account lookup or KDF**, validate hostname and login/signup action, reject invalid/replayed tokens, and fail closed on provider failure/timeout. The actual widget provider, challenge success, expiry and replay must still be tested in Preview. [Turnstile validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).
- Additional account throttle: 10 attempts/15 minutes, including successes, stored under a SHA-256 email key in `auth/attempts/`, with a 900-second KV TTL in the generated Cloudflare adapter. Reset only after expiry. Storage failures fail closed. This adds one KV read and one write per admitted attempt; it is a **best-effort KV counter, not an atomic/global rate limiter**. Parallel requests/regions can overshoot. Turnstile is independently required; edge abuse rules and hosted quota/error observation remain prerequisites for public exposure.
- Unknown account, wrong password, damaged record: same 401 body. Duplicate registration: generic failure without an `account_exists` response. Missing account work uses the current KDF to reduce a simple fast-miss timing difference; this is not a claim of identical timing across all legacy schemes or KV states.
- Raw storage/provider exceptions are not returned or logged by the authentication boundary. No credentials, hashes, challenge tokens or session tokens are deliberately logged. Cloudflare observability must also exclude request bodies/authorization/cookies during future acceptance.
- Session IDs, cookies, 30-day lifetime and KV record structure are unchanged. Logout no longer reports success after a failed session deletion; the UI reports failure and permits retry. KV's eventual consistency/revocation delay is unchanged, not advertised as immediate global invalidation.
- Registration checks for existing accounts before and after hashing. **KV does not provide globally atomic email uniqueness.** Cross-region simultaneous new registrations remain a public-launch gate; this round does not invent a lock protocol or claim to solve it. Keep registration closed outside explicitly authorized synthetic Preview tests until ownership verification and uniqueness are addressed.
- Email verification, recovery/reset and Google/Apple hardening remain separate launch work. This round does not pretend that successful password signup establishes email ownership or that mail was sent.

## Tests and build

Actual 2026-10-15 local verification:

- Full suite: **54 files / 346 tests passed**.
- Includes generated Worker security/session/account isolation regressions plus actual workerd signup/login/current-scheme/legacy upgrade, exact historical iteration use, malformed credentials, failure immutability, reserved-admin signup refusal, disabled gates, body/origin validation, challenge errors/replay, throttle expiry, storage failures, session restoration/logout and unchanged research state.
- UI tests cover disabled entry, challenge token plumbing/expiry/retry/unmount, failed-login feedback, no invented verification email, and failed logout feedback.
- `npm run typecheck`: passed.
- `ORIVANE_SKIP_SEO_REFRESH=1 npm run build:cloudflare`: passed, with Preview site URLs; no remote SEO generation.
- `wrangler pages functions build --outdir .qa/pages-worker`: local Pages packaging check; no deployment.
- Generated Worker is recreated from the maintenance source and generator, not edited as the sole source.
- Local transient evidence is under `.qa/`; no real user fixtures or production secrets.

## Next authorized Preview acceptance prerequisites

1. User separately upgrades/enables Workers Paid, then verify the effective CPU configuration. No upgrade was performed here. The local ~0.57s KDF cost is incompatible with treating Free's nominal 10ms budget as sufficient.
2. Deploy only this reviewed authentication commit to the existing isolated Preview after explicit authorization; recheck all six KV namespaces, credentials, `ORIVANE_SKIP_SEO_REFRESH=1`, source SHA and branch. No optimizer deployment.
3. Configure an isolated Turnstile widget for the exact Preview hostname, and its Preview-only site/secret keys. Initial password gate stays off; enable the controlled test gates only after configuration checks. No built-in bypass token or test-only endpoint exists in the app.
4. Use disposable synthetic accounts through actual registration/login, not prewritten sessions. Verify old-format upgrade only against synthetic records, preserved UUID/research data, refresh/expiry/logout, failed writes, challenge replay/outage, rate-limit response, and account A/B isolation.
5. Capture real Worker CPU Time/outcome, end-to-end latency including Turnstile and KV, concurrency behavior and quota cost. Local workerd results do not substitute for hosted acceptance. Disable gates on errors and clean up synthetic accounts/data afterward.
6. Do not open public registration merely because these smoke tests pass: email ownership/recovery, globally safe duplicate creation and final OAuth hardening remain launch gates from the readiness review.
