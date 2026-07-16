# Security policy

## Supported versions

Lumenwake is a single-player MVP. Only the current repository version is supported for security fixes; older snapshots and independently modified deployments do not receive backports. Operators should deploy from a reviewed revision using the locked dependencies and the Node.js and npm versions declared in `package.json`.

## Reporting a vulnerability

Report suspected vulnerabilities privately and include a concise description, affected revision or deployment, reproduction steps, impact, and any suggested mitigation. Remove secrets, personal data, and unnecessary exploit payloads from the report.

> **Repository owner action required:** insert an appropriate private security-reporting contact method here before publishing or deploying the project.

Until that private channel is configured, do not open a public issue containing vulnerability details. Contact the repository owner through an already established private channel. Do not disclose a vulnerability publicly before the owner has acknowledged the report and coordinated a remediation or disclosure timeline.

## Security boundary

This application serves public static files and runs the game entirely in the browser. It has:

- No authentication, accounts, authorization, or sessions.
- No cookies, server-side saves, database, user uploads, or server-side personal data.
- No API or state-changing HTTP endpoint; the server accepts only `GET` and `HEAD` for static content and health checks.
- No runtime cross-origin API call or production secret.

The server's security boundary is the `public/` directory. Relevant threats include accidental repository-file exposure, path traversal and symlink escape, malformed URLs and HTTP requests, MIME confusion, DOM injection and cross-site scripting, executable SVG content, clickjacking, mixed content, unsafe browser capabilities, inappropriate caching, slow or malformed requests, unclean dyno shutdown, dependency/build reproducibility failures, and leakage through files or logs.

Deployment controls include strict static-root containment, an explicit MIME allowlist, generic non-reflective errors, browser security headers, bounded HTTP parsing and timeouts, optional exact-host validation, minimal logging, deterministic production-file checks, and graceful process shutdown. These controls do not make untrusted forwarding headers authoritative: `X-Forwarded-*` values are not used for authentication, authorization, host allowlisting, client identity, rate limiting, or construction of trusted absolute URLs.

## Client-side save trust and anti-cheat

The active run and meta progression are stored in browser-controlled `localStorage`. A player can inspect, replace, or delete that state. Scores, inventory, levels, drops, gold, equipment, and progression are therefore **not tamper-proof**, and this phase provides no anti-cheat.

That trust model is acceptable for the current single-player MVP. Client state must not later be treated as authoritative for competitive rankings, trading, purchases, subscriptions, rewards with monetary value, multiplayer state, or server-side entitlements. Any such feature requires a separately designed authoritative server model and threat review.

Because saves remain local, the application server does not receive them. Local device users, browser extensions, developer tools, browser-profile compromise, storage clearing, and loss or corruption of a player's local save are outside the guarantees of this server-side deployment hardening.

## Dependency updates

Review dependency updates deliberately and keep `package-lock.json` current. For each proposed update:

1. Review the advisory, affected package, runtime versus development reachability, remediation, and compatibility impact.
2. Prefer the smallest supported update; do not make an unrelated major-version change solely to obtain a zero advisory count.
3. Run `npm ci`, `npm test`, `npm run check:security`, `npm run build`, and `npm audit --audit-level=high` from a clean checkout.
4. Review the lockfile diff and production output before merging or deploying.

Do not run `npm audit fix --force` as an automatic remedy. If a high- or critical-severity issue cannot be fixed without an architectural upgrade, document the package, whether it is runtime or development-only, deployed reachability, available remediation, and the reason the upgrade is deferred.

## Out of scope

The following are outside this phase's security promises:

- Preventing a player from modifying their own local save or gaining an advantage in this noncompetitive game.
- Recovery or synchronization of deleted, corrupted, private-browsing, browser-specific, or device-specific saves.
- Security properties for hypothetical accounts, authentication, payments, trading, rankings, multiplayer, APIs, databases, uploads, subscriptions, or server-side entitlements that do not exist in this MVP.
- CSRF, session fixation, database authorization, and upload validation controls for endpoints or systems the application does not have.
- An IP-based application rate limiter or treating Heroku forwarding headers as authenticated client identity.
- Volumetric denial-of-service protection and vulnerabilities in Heroku, DNS providers, browsers, operating systems, extensions, or other third-party infrastructure outside this repository.

Reports showing that public game assets can be downloaded, that a player can edit their own `localStorage`, or that local progress is not synchronized are expected behavior. Reports demonstrating static-root escape, script execution, unsafe DOM insertion, executable SVG content, malformed-request handling failures, secret leakage, security-header bypasses, or dependency vulnerabilities affecting this deployed application remain in scope.
