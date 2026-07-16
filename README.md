# Lumenwake: The Prism Road

Lumenwake is an original, mobile-first JRPG roguelite played through one recurring decision: drag, swipe, click, or press a key to choose the left or right response. A complete run crosses the moonlit Prism Road, builds a small equipment loadout, survives deterministic turn-based encounters, and culminates in a mandatory boss near journey step 20.

The project is intentionally small and local. It uses static HTML, browser-native ES modules, DOM/SVG presentation, locally compiled Tailwind CSS, `localStorage`, and a static server made only with Node's standard library. It has no UI framework, router, game engine, database, API, runtime CDN, or runtime network dependency.

## Architecture

- `server.js` — dependency-free, traversal- and symlink-safe static server with GET/HEAD support, an allowlisted MIME map, conditional caching, strict browser security headers, host validation, a health endpoint, and graceful shutdown.
- `src/input.css` — Tailwind import plus the small authored layer needed for swipe transforms, feedback, safe areas, and reduced motion.
- `public/index.html` — semantic application shell and accessible live regions.
- `public/js/data/` — immutable cards, enemies, and items. Content contains declarative requirements and effects, never executable callbacks.
- `public/js/game/` — deterministic state, selection, effects, progression, equipment, and combat rules with no DOM dependency.
- `public/js/ui/` — rendering, feedback, inventory drawer, and Pointer Events swipe control.
- `public/js/rng.js` — serializable 32-bit pseudo-random generator used by all game randomness.
- `public/js/storage.js` — defensive, versioned local save persistence.
- `tests/` — Node built-in test-runner coverage for the pure rules and persistence.

The engine owns all state mutation. UI handlers submit an intent, the engine resolves it atomically, the new state is saved, and the renderer receives the next engine-produced card. The save includes both the original run seed and current PRNG state, so reloading cannot reroll future outcomes.

## Install and run

Use Node.js 24.x, npm 11.x, and the dependency versions in `package-lock.json`. For a clean, lockfile-reproducible install, use `npm ci`.

```sh
npm ci
npm run build:css
npm start
```

Open `http://localhost:3000` unless `PORT` specifies another port.

Development commands:

```sh
npm run watch:css   # rebuild CSS as source files change
npm run dev         # development server
npm test            # node --test
npm run build       # compile and verify production assets
npm run check:security
npm run verify:production
npm run audit:runs  # replay 256 seeded full runs and report outcomes/soft locks
```

Development responses use `Cache-Control: no-store`. In production, `index.html` uses `no-cache`; unversioned JavaScript and CSS must revalidate; content-hashed assets may be cached as immutable; and other local images and media receive a conservative finite cache lifetime with revalidation.

## Controls

- Drag the central card left or right with touch, pen, or mouse, then pass the visible threshold to commit.
- Use the two large buttons below the card for the same choices.
- Press Left Arrow or `A` for the left choice; Right Arrow or `D` for the right choice.
- Open **Pack** in the HUD to inspect equipment, equip inventory items, or use consumables. `Escape` closes the drawer and returns focus to its opener.

The choice labels, costs, likely effects, enemy HP, and current enemy intent remain visible before commitment. Reduced-motion preferences keep every control functional while removing nonessential movement.

## Content schemas

Exploration storylets use data shaped like:

```js
{
  id, category, speaker, title, text, artId,
  baseWeight, cooldown, oncePerRun, tags,
  requirements: [{ type, ...parameters }],
  left:  { label, resultText, effects: [{ type, ...parameters }] },
  right: { label, resultText, effects: [{ type, ...parameters }] }
}
```

Enemies define identity, level range, HP, attack, defense, XP and gold rewards, weighted intents, drops, and local art. Items define a slot or consumable type, rarity, sell value, modifiers/effects, and local art.

### Add a card

1. Add a unique object to `public/js/data/cards.js`.
2. Reuse supported declarative requirement and effect types from `requirements.js` and `effects.js`; never put a function in content.
3. Give repeatable cards a cooldown and sensible weight. Use `oncePerRun` for discoveries and `queueCard` for authored continuations.
4. Point `artId` at a local file in `public/assets/art/`.
5. Run `npm test` and play far enough to exercise its eligibility and both choices.

### Add an enemy

1. Add the enemy definition in `public/js/data/enemies.js` with a unique ID, level/depth eligibility, stats, intent weights, reward range, and drop table.
2. Add or reuse an encounter-introduction storylet; its choice starts the enemy through a declarative `startEncounter` effect.
3. Add a local SVG silhouette and tests for any new combat mechanic.

### Add an item

1. Add the definition in `public/js/data/items.js`.
2. Equipment must use `weapon`, `armor`, or `charm` and place bonuses under `statModifiers`; consumables use declarative effects.
3. Add it to an enemy drop table or storylet reward and provide a local SVG.
4. Do not apply equipment bonuses directly to base stats. `getDerivedStats` is the single source of truth.

## Save behavior

The active run is saved under `jrpg-swipe-save-v1` after every committed card and inventory action. Defensive normalization recovers old, incomplete, or corrupted values without preventing startup. Reload resumes the exact active card and deterministic random stream. Death and victory preserve the discovery codex and best-run records; **New Run** resets only run progress, while **Reset All Data** removes both run and meta progress after confirmation.

The save is browser-controlled `localStorage`, not authoritative server state. A player can inspect or modify it. That is acceptable for this single-player MVP, but scores, inventory, levels, drops, gold, equipment, and progression are not tamper-proof and must not be trusted for competitive rankings, trading, purchases, subscriptions, rewards with monetary value, multiplayer state, or server-side entitlements. The application has no accounts, authentication, cookies, server-side saves, database, or state-changing HTTP endpoint.

## Heroku deployment

This repository is prepared for deployment as a single Heroku web process. The application does not require a production secret or a manually configured `PORT`: Heroku supplies `PORT` to the dyno at runtime. Do not add Heroku's dynamic port as a config var. `ALLOWED_HOSTS` is optional, but setting it to every public hostname is recommended; the server continues to serve when it is empty and emits one concise production startup warning.

Heroku runs the production asset build once during its build phase. The root `Procfile` contains the single process declaration `web: node server.js`; dyno startup does not compile Tailwind or wrap Node in an npm process, so operating-system shutdown signals reach the server process. There is no release, worker, or migration process.

The commands in this section are operator instructions. Repository preparation does not create an app, change config or DNS, add a Git remote, commit, push, or deploy anything.

### Preflight

From a clean checkout, run the checks in this order:

```sh
npm ci
npm test
npm run check:security
npm run build
npm audit --audit-level=high
NODE_ENV=production PORT=5000 npm start
```

The final command stays in the foreground. In another terminal, check `http://127.0.0.1:5000/` and `http://127.0.0.1:5000/healthz`, then stop the process with `Ctrl-C` and confirm that graceful shutdown completes. `npm audit` is intentionally a pre-deployment check rather than a Heroku build step, so audit-service availability cannot make a reproducible asset build fail. Do not use `npm audit fix --force`; assess and update affected packages conservatively, rerun the complete preflight, and commit the refreshed lockfile through the normal review process.

### Placeholder deployment flow

Replace `<app-name>` with the intended Heroku app name. Run these commands only when the repository owner is ready to create and deploy the app:

```sh
heroku login
heroku create <app-name> --stack heroku-26
heroku config:set ALLOWED_HOSTS=<app-name>.herokuapp.com -a <app-name>
heroku features:enable http-router-no-log-query -a <app-name>
git push heroku main
heroku ps:scale web=1 -a <app-name>
heroku ps -a <app-name>
heroku logs --tail -a <app-name>
heroku open -a <app-name>
```

The query-redaction feature is optional but recommended because Heroku router logs are separate from the application's deliberately minimal logs. Application logs should contain only startup, shutdown, fatal process failures, and unexpected server errors—never query strings, request bodies or headers, authorization values, cookies, environment variables, save data, or `localStorage` data. Review both build and runtime logs for accidental secrets before considering the release verified.

### Deployment verification

Use the HTTPS hostname shown by Heroku:

```sh
curl --fail --silent --show-error https://<app-host>/healthz
curl --head https://<app-host>/
curl --head https://<app-host>/assets/app.css
```

The health response must be exactly the minimal service status, without versions, environment data, hostnames, dyno identifiers, commit hashes, or stack traces. Inspect the response headers returned by the `--head` commands and complete this manual checklist:

- The build succeeded and the root `Procfile` was detected as one `web` process.
- The web dyno is up, `/` returns `200`, and `/healthz` returns `200` with `Cache-Control: no-store`.
- Security headers are present on HTML, assets, health, and error responses. HSTS appears in production responses only.
- The CSP produces no console violations during normal gameplay, and no asset is loaded over HTTP or from an external CDN.
- A complete game run remains playable, and save/reload resumes the current local run.
- Malformed, encoded, dotfile, backslash, and traversal paths cannot expose any file outside `public/`.
- A genuinely missing asset returns `404`; arbitrary missing paths do not receive an SPA fallback or directory listing.
- Heroku build, application, and router logs contain no secrets or query strings.

### Custom domain and TLS

Do not change DNS until the intended domain and app have been approved. Add the custom domain through the Heroku dashboard or CLI, then use the DNS target supplied by Heroku—not an inferred target—when creating the corresponding record with the DNS provider. A representative CLI inspection flow is:

```sh
heroku domains:add www.example.com -a <app-name>
heroku domains -a <app-name>
heroku certs:auto:enable -a <app-name>
heroku certs:auto -a <app-name>
heroku config:set ALLOWED_HOSTS=<app-name>.herokuapp.com,www.example.com -a <app-name>
```

Wait until Heroku Automated Certificate Management reports a valid certificate, then access and test the custom domain over HTTPS. Add every served custom hostname to `ALLOWED_HOSTS` as a comma-separated exact hostname; do not use `X-Forwarded-Host` for validation. Verify HSTS only after HTTPS works correctly. Do not automatically add `includeSubDomains` unless every relevant subdomain supports HTTPS, and do not enable HSTS preload automatically.

The application does not treat `X-Forwarded-Proto` as a security boundary or implement a forwarded-header-based redirect. If strict HTTPS is ever required on the very first request, enforce it at a trusted edge and validate that configuration separately.

### Rollback

Inspect the release history, identify the last known-good release, and then explicitly roll back to that release:

```sh
heroku releases -a <app-name>
heroku releases:rollback <release-version> -a <app-name>
```

Do not guess the release identifier. After rollback, repeat the process, log, curl, header, gameplay, and save/reload verification above. A rollback changes the running release; it does not replace investigation and remediation of the failed release.

## Known MVP limitations

- One region, one boss, and one local save slot.
- Discoveries persist as records but do not yet provide a separate full-screen codex browser.
- Inventory is deliberately compact and has no sorting or stacking controls.
- Balance targets an 8–12 minute run, but individual duration varies with reading speed and combat choices.
- Local save data is device- and browser-specific and is not synchronized.
- Local save data is player-controlled and this phase does not provide anti-cheat.
