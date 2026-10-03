# Canonical source and deployment

This folder is the **single Git repository** for the panel and controller.
`controller/` is the canonical controller source. The installed Hermes skill
scripts remain a deployment copy at:

`C:/Users/hal/AppData/Local/hermes/skills/den-lights/scripts/`

The panel intentionally continues invoking that installed CLI. This preserves
its existing dependency installation, private device config, snapshot location,
and exclusive lock; do not run a second configured controller from this repo.
There is no second Git repository in the skill directory.

## Offline checks

- `npm test` runs all panel/UI/controller tests, without bulbs or credentials.
- `npm run test:controller` runs just canonical controller tests.
- `node controller/lights.cjs help` works without device config or dependencies.

## Deploy controller changes

1. Edit and test **controller/** here, not the installed skill copy.
2. Stop any active effect cooperatively and wait for verified restoration.
   Also check the installed `state/control.lock` is absent; do not delete it.
3. Copy only `lights.cjs`, `*.test.cjs`, `package.json`, `package-lock.json`
   from `controller/` to the installed scripts directory. Never copy/delete
   `devices.json`, `state/`, or `node_modules/` during a source deployment.
4. If dependencies changed, run `npm ci --ignore-scripts --no-audit --no-fund`
   in the installed scripts directory while no controller is active.
5. Run the installed `*.test.cjs` suite, compare deployed source bytes against
   the canonical files, and run CLI help. Any live test requires user consent.
6. For catalogue/server changes, wait for restoration, restart the panel and
   reload the page (a new per-instance CSRF token is issued). Verify real GET
   `/`, `/api/health`, and `/api/bootstrap` without printing the token.

Actual device addresses/MACs, snapshots, state, dependencies, logs, and secrets
are excluded by `.gitignore`. `controller/devices.example.json` uses reserved
TEST-NET addresses and dummy MACs only; it is not a live configuration.

On another machine, install/configure the controller separately and update the
fixed controller path in `server.cjs` and its corresponding assertion in tests.
Keep it loopback-only; this panel is not intended for LAN/proxy exposure.

## Known controller limitations

Canonical `enroll` is unsupported, removed from help, and rejected before device
configuration or network access. Individual `set lamp2` remains unsupported.
Group effects include all configured bulbs; Blue pulse affects only `lamp`.
Canonical `restore <path>` accepts nonempty subsets (including lamp-only pulse
snapshots) with unique MACs exactly matching unambiguous configured entries.
It preserves snapshot order and uses configured hosts, not snapshot hosts;
unselected bulbs are not contacted. Empty, duplicate, and unknown identities
are rejected before network access.

These controller fixes are source-only until a separately authorized deployment;
the installed skill copy has not been modified. Do not assume it supports subset
restore until its source has been deployed and verified.

After snapshot readiness, an unverified effect exit leaves the panel blocked:
new runs receive HTTP 409 and the failed snapshot/output remain available.
There is no automatic timeout release or recovery API. Preserve diagnostics,
confirm no controller is active, resolve the failure, manually restore and verify
the saved state, then explicitly restart the panel and reload the page. Do not
delete a stale lock without checking its recorded PID. The block is in-memory:
restart clears it but does not constitute recovery. Startup/spawn failures with
no snapshot remain retryable. See README's recovery procedure.
