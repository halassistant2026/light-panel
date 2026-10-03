# Canonical source and runtime

`C:/Users/hal/light-panel` is the single Git repository and live runtime for the
panel and controller. `controller/lights.cjs` is both canonical source and the
executable used by the panel and Hermes skill. There is no code-copy deployment
step and no second configured controller should be run.

## Offline checks

- `npm test` runs all panel/UI/controller tests, without bulbs or credentials.
- `npm run test:controller` runs just canonical controller tests.
- `node controller/lights.cjs help` works without device config or dependencies.

## Apply controller changes

1. Edit and test **controller/** here.
2. Stop any active effect cooperatively and wait for verified restoration.
   Check `controller/state/control.lock` is absent; do not delete it blindly.
3. If dependencies changed, run `npm ci --ignore-scripts --no-audit --no-fund`
   in `controller/` while no controller is active.
4. Run the complete test suite and CLI help. Any live test requires user consent.
5. For catalogue/server changes, wait for restoration, restart the panel and
   reload the page (a new per-instance CSRF token is issued). Verify real GET
   `/`, `/api/health`, and `/api/bootstrap` without printing the token.

Actual device addresses/MACs, snapshots, state, dependencies, logs, and secrets
are excluded by `.gitignore`. `controller/devices.example.json` uses reserved
TEST-NET addresses and dummy MACs only; it is not a live configuration.

On another machine, create `controller/devices.json` from the example, install
dependencies in `controller/`, and keep the panel loopback-only.

## Known controller limitations

Canonical `enroll` is unsupported, removed from help, and rejected before device
configuration or network access. Individual `set lamp2` remains unsupported.
Group effects include all configured bulbs; Blue pulse affects only `lamp`.
Canonical `restore <path>` accepts nonempty subsets (including lamp-only pulse
snapshots) with unique MACs exactly matching unambiguous configured entries.
It preserves snapshot order and uses configured hosts, not snapshot hosts;
unselected bulbs are not contacted. Empty, duplicate, and unknown identities
are rejected before network access.

Repository controller changes become live after the current effect has restored
and the next controller process starts. Server code changes require a panel restart.

After snapshot readiness, an unverified effect exit leaves the panel blocked:
new runs receive HTTP 409 and the failed snapshot/output remain available.
There is no automatic timeout release or recovery API. Preserve diagnostics,
confirm no controller is active, resolve the failure, manually restore and verify
the saved state, then explicitly restart the panel and reload the page. Do not
delete a stale lock without checking its recorded PID. The block is in-memory:
restart clears it but does not constitute recovery. Startup/spawn failures with
no snapshot remain retryable. See README's recovery procedure.
