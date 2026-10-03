# Light Panel

Local-only control panel and canonical light controller. No remote fonts, CDN scripts, browser installation, or browser-side device access.

## Start

Requires Node.js 22+. Install the controller's pinned dependencies once with `npm ci --ignore-scripts --no-audit --no-fund` in `controller/`.

```sh
node C:/Users/hal/light-panel/server.cjs
```

Open **http://127.0.0.1:8766/**. The process binds only to `127.0.0.1`, not the LAN. Port 8766 must be free; an occupied port produces an error, not a silent port change. The startup line prints URL and process ID. Opening the page, fetching bootstrap/status, and health checks do not contact or alter the bulbs.

Health: `http://127.0.0.1:8766/api/health`.

Before stopping the server, click **Stop & restore** and wait for **Restored · saved state verified**. Closing the tab does not stop an effect. Keep the computer awake and connected to the LAN. The panel does not install a startup service.

## Operate

Search by stable code or pattern name, filter by category, and select **Pattern default** or **Custom seconds** (whole seconds, 1–120). Duration affects the next run only. The sticky status bar remains available while browsing a longer catalogue.

| Code | Pattern | Controller slug | Default |
|---|---|---|---|
| L01 | Aurora | aurora | 20 seconds |
| L02 | Rainbow | rainbow | 20 seconds |
| L03 | Pride | pride | 20 seconds |
| L04 | Sunset | sunset | 20 seconds |
| L05 | Chase | chase | 30 seconds |
| L06 | Green-blue swap | green-blue | Until stopped (`forever`) |
| L07 | Blue pulse | pulse-blue | Until stopped (`forever`) |
| L08 | Red/Blue Sweep | red-blue | 20 seconds |

Red/Blue Sweep uses 35% brightness and smooth two-second red/blue transitions, with no audio or strobing.

Chase uses **rapid flashing** and requires a confirmation. Blue pulse affects **Den Lamp only**; the other entries affect all configured den bulbs. Pattern defaults for L06 and L07 are intentionally indefinite. Every entry can instead use a bounded duration.

Only one panel-owned effect runs at a time, across all open tabs. The server asynchronously spawns Node with fixed arguments, never a shell command. Each run invokes:

```
process.execPath lights.cjs effect <catalogue slug> <validated duration>
```

Stop requests use only the controller's cooperative `stop` command. The panel waits until the controller has printed its saved snapshot before sending an early stop, because the controller clears old stop requests during startup. Stop responds immediately with a *stopping* state, but keeps the run reserved until **both** the effect process and stop helper exit. It never force-kills a lighting process. Restoration success requires the controller's matching `{effect, restored:true, verified:true}` JSON record **and exit code 0**.

The status endpoint reports this panel's process state, **not live bulb state**. A health check does not establish LAN/bulb connectivity. Do not run another light controller concurrently. The controller's existing lock is the additional protection against outside mutations; the panel cannot adopt or stop an effect launched outside this panel or inherited after a server crash.

## Errors and recovery

Expand **Controller output & recovery** for the latest stdout/stderr and snapshot path. Display output is capped at 32,768 characters; the streaming JSON parser also has a fixed bound. Long-running effects do not accumulate an unlimited history.

A zero exit without the matching restoration record is **not** reported as restored. Once snapshot readiness has been reported, an unverified exit blocks all new `/api/run` requests with HTTP 409 and retains that run's snapshot path and bounded output. There is no timeout or API reset that releases this block. Startup/spawn failures before any snapshot remain retryable.

Recovery is explicitly manual:

1. Preserve the snapshot and copy the displayed diagnostics before restarting anything. Confirm the effect and stop helper have exited; investigate any remaining controller lock and its recorded PID rather than deleting it automatically.
2. Resolve the failure and restore the saved state using a separately authorized, correctly configured controller. The canonical `controller/lights.cjs` supports `restore <path>` for a nonempty subset of unique, exactly matching configured MACs, including Blue pulse's lamp-only snapshot. It preserves snapshot order, uses configured hosts (never snapshot hosts), and leaves other bulbs untouched. Empty, duplicate, unknown or ambiguous identities are rejected before network access.
3. Require successful restoration/readback verification before manually restarting the panel and reloading the page. Restart is the only reset; the block and output are in memory, not durable across server crashes/restarts. Restarting alone does not restore lights or prove recovery.

The panel and Hermes skill both invoke this repository's `controller/lights.cjs`; there is no separate deployed code copy. `controller/devices.json`, `controller/state/`, and `controller/node_modules/` are local and gitignored. Enrollment is unsupported: CLI help does not advertise `enroll`, and the command is rejected before device configuration or network access.

If a cooperative stop request itself fails, the effect remains reserved and **Stop & restore** can be retried. Network failure, abrupt process termination, host shutdown, or loss of power can prevent restoration. There is no force-stop fallback or restoration timeout that releases a still-running child.

After restarting the server, reload the page to acquire its new security token. An offline panel disables new actions and retries status reads every second. A stale status response cannot supersede a newer Run/Stop action.

## Security boundary

- Loopback-only listener; no CORS headers or proxy support.
- Exact local Host validation on all requests.
- Every POST requires matching HTTP Origin, JSON content type, and a random per-instance `X-CSRF-Token` obtained from GET `/api/bootstrap`.
- Only `/api/run` (`id`, optional `duration`) and `/api/stop` (empty object) mutate. Unknown IDs/fields, arbitrary commands, fractional/out-of-range durations, malformed JSON and bodies over 4 KiB are rejected.
- Static allowlist: `/`, `/style.css`, `/app.mjs`. No directory listing or arbitrary file paths.
- CSP, frame denial, no-sniff and no-store headers. Catalogue/output strings are inserted using text nodes, not HTML.
- This is not authentication against other programs already running as your Windows user. Do not expose it through a proxy or port-forward.

## Extend the catalogue

1. Add an object to `patterns.json` with a new stable `id` (e.g. `L09`), `name`, controller-supported `slug`, integer `duration` from 1–120 or `"forever"`, `category`, and short `description`. Optional `warning` produces visible warning text and a confirmation before running.
2. Never renumber or reuse L01–L08. Keep codes/slugs unique. Catalogue entries are trusted local configuration, never supplied by a browser request.
3. The existing controller must already support the slug. Adding a new slug to JSON alone does not implement a lighting effect. Any separately authorized controller extension needs its own offline tests.
4. Update catalogue tests for intentional additions without weakening the stable-code/default assertions. Category options and search are generated from the data; no HTML edits are needed.
5. Stop any active effect, stop/restart the server, reload the page, and run the tests.

## Tests (no live lighting)

From `C:/Users/hal/light-panel`:

```sh
npm test
npm run test:controller
```

Or use `node --test test/panel.test.cjs test/ui.test.mjs`.

The HTTP tests use ephemeral loopback ports and injected fake child processes for mutations. UI tests exercise the actual module through a minimal DOM adapter: search, category filtering, duration validation, flashing confirmation, run/stop requests, disable states, polling, error recovery, and stale-response ordering. Controller tests cover its existing offline functions, safe help/invalid-command invocations, and VM-isolated CLI restoration/enrollment checks with stubbed devices and filesystem. Recovery tests verify subset order, configured-host selection, untouched other bulbs, invalid identities, and the panel's persistent-in-process failed-run block.

Implemented in vertical red/green slices: each new behavior was exercised failing before implementation, then the growing suite was rerun. Browser layout/keyboard/screen-reader verification is separate from the DOM-adapter tests. L08 was exercised through the real panel HTTP API for six seconds; the controller verified restoration of all three bulbs and exited successfully.

## Files

- `server.cjs`: built-in HTTP server and controller lifecycle
- `controller/`: live canonical controller, offline tests, local gitignored configuration/state/dependencies
- `patterns.json`: stable catalogue
- `public/index.html`, `public/style.css`, `public/app.mjs`: responsive dark console
- `test/panel.test.cjs`, `test/ui.test.mjs`: offline automated tests
- `package.json`: startup/test shortcuts, no dependencies
