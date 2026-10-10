# UserEye

**Version 7.5.1** · MIT · Node.js >= 20.11 · Playwright 1.63.0 · [Docs](docs/README.md) · [Changelog](docs/CHANGELOG.md) · [CLI](docs/CLI.md) · [Architecture](docs/ARCHITECTURE.md)

> **Status: not published to npm yet.** The `usereye` name is not on the npm registry and
> there is no public GitHub remote — both verified absent on 2026-09-06 rather than guessed.
> `package.json` therefore declares **no** `repository` / `homepage` / `bugs`: a missing
> link is better than a link that 404s (earlier releases pointed all three at a dead org).
> Install from the delivery bundle or a packed tarball, as below. The package stays
> publishable (`"private": false`); add the real remote — plus `homepage` and `bugs` — in
> the same commit that publishes. `scripts/check-delivery-names.js` fails the release if
> any metadata ever points back at a dead URL.

UserEye is a project-agnostic browser agent that opens a web application, observes what a user can see, explores safe paths, checks accessibility and resilience, and leaves reproducible HTML, Markdown, JSON, trace, screenshot, and optional SARIF evidence.

It works against a live URL with no source access, or against a repository that UserEye can analyze and start. Product policy stays in the target repository through `usereye.config.*`; the engine contains no product names, routes, or credentials.

## Install

From the delivery bundle — install the package directory as a dev dependency:

```bash
npm install --save-dev ./UserEye
npx usereye install-browsers
```

Or from a packed tarball (`npm run pack:npm` inside the package produces it):

```bash
npm install --save-dev ./usereye-7.5.1.tgz
npx usereye install-browsers
```

Once the package is published to npm, the usual form applies (it is not, today):

```bash
npm install --save-dev usereye
npx usereye install-browsers
```

Node.js 20.11 or newer is required (tested on 20, 22 and 24). Browser binaries are intentionally installed separately so CI and local machines can control their cache. On bare Linux machines (no distribution-provided Chromium dependencies) the browser also needs its system libraries once: `npx playwright install-deps chromium` (requires root/sudo). Container images and GitHub runners already include them.

## First report

```bash
# Any already-running application
npx usereye observe https://example.com --axe --out artifacts/usereye

# Explore a URL safely (read-only by default)
npx usereye auto --url http://127.0.0.1:3000 --mode quick

# Analyze and start an application repository
npx usereye auto --project . --mode standard
```

## Per-project config

Create `usereye.config.js` in the application repository:

```js
/** @type {import('usereye').UserEyeConfig} */
module.exports = {
  baseURL: process.env.USEREYE_BASE_URL,
  mode: 'standard',
  outDir: 'artifacts/usereye',
  locale: 'en-US',
  timezoneId: 'UTC',
  colorScheme: 'light',
  viewport: { width: 1440, height: 900 },
  credentials: {
    email: process.env.USEREYE_EMAIL,
    password: process.env.USEREYE_PASSWORD,
  },
  allowWrite: false,
  allowDestructive: false,
  allowDownloads: false,
  blockPaths: ['/billing/cancel', /\/admin\/.+\/delete/],
  blockNamePatterns: [/delete forever/i, /close account/i],
  seedPaths: ['/', '/login', '/app'],
  patternPack: ['en'],
  reportLocale: 'en',
  reportFormat: ['html', 'md', 'sarif'],
  gates: {
    minAdaptiveScore: 70,
    maxBlocker: 0,
    maxCritical: 0,
    maxUnexpectedBrowserErrors: 0,
  },
};
```

Config discovery order:

1. `--config <path>` or `USEREYE_CONFIG`
2. `usereye.config.js`, `.mjs`, or `.cjs` in `--project`
3. `usereye.config.json`
4. the `usereye` key in the target `package.json`

Precedence is deterministic:

```text
built-in defaults < config file < USEREYE_* environment < CLI flags
```

The resolved configuration is written to `resolved-config.json`; passwords, tokens, cookies, authorization values, and API keys are redacted.

## Defaults

Since **7.4.1** the built-in defaults are the _calm_ profile: a bare `usereye auto` with
no config file behaves exactly like the config that `usereye init` scaffolds, so it is
something you can leave on in CI without tuning it first. Before 7.4.1 these two
disagreed — `init` wrote calm settings while `DEFAULT_CONFIG` shipped loud ones.

| Setting                   | Default         | What it means                                                                                                                                       | Get the old (loud / forensic) behaviour                                 |
| ------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `recordVideo`             | `'on-failure'`  | The session is recorded, but the `.webm` is discarded when the run is clean — a green job pays no artifact cost.                                    | `--video`, or `recordVideo: true`                                       |
| `trace`                   | `'on-failure'`  | (7.5.1) The Playwright trace is recorded, but `user-eye-trace.zip` is discarded when the run is clean — it was the largest artifact of a green run. | `--trace always`, or `trace: 'always'` (`never` disables tracing)       |
| `misclick.policy`         | `'stable-only'` | "Harmful" is reserved for hard signals: a URL change, a dialog, or a dangerous control. Repaint-only side effects are downgraded to `confusing`.    | `--misclick-policy aggressive`, or `misclick: { policy: 'aggressive' }` |
| `findings.minConfidence`  | `'medium'`      | The **primary** issue list holds medium + high confidence findings. Low-confidence heuristics are still recorded.                                   | `findings: { minConfidence: 'low' }`                                    |
| `findings.gateConfidence` | `'high'`        | Severity gates count only high-confidence findings, so a heuristic cannot fail a build on its own.                                                  | `findings: { gateConfidence: 'low' }`                                   |
| `sarif.minConfidence`     | `'medium'`      | `usereye.sarif` (GitHub code scanning) gets medium + high only.                                                                                     | `sarif: { minConfidence: 'low' }`                                       |
| `reportFormat`            | `['html','md']` | SARIF stays opt-in.                                                                                                                                 | `--report-format html,md,sarif`                                         |
| `extensions.enabled`      | `false`         | The 7.4 browser-extension effect battery is additive and off.                                                                                       | `extensions: { enabled: true }`                                         |
| `userJourney.enabled`     | `false`         | The 7.3 resilience / a11y-device battery is additive and off.                                                                                       | `userJourney: { enabled: true }`                                        |

Two things never change with these defaults:

- **Exit codes stay `0 | 1 | 2`.** Calm defaults reduce noise, they do not move the goalposts.
- **No evidence is destroyed.** `result.json` always carries `issuesAll` — every annotated
  finding, each flagged `surfaced: true | false` — plus `summary.issuesRecorded`. `issues`
  remains the surfaced list that reports and gates read. The console summary prints
  `Actionable: N · Signals: M` so a green run does not look empty.

Config that already sets loud values keeps behaving exactly as before, and
`new UserEye({...})` (the library, bypassing config) still defaults to `recordVideo: true`.

Two named presets capture the intent if you would rather not list knobs (plain config
sugar — merge whichever you want into `usereye.config.js`, or use `--profile <name>`):

```js
module.exports = {
  profiles: {
    // The default bare run is already this.
    ci: {
      recordVideo: 'on-failure',
      misclick: { policy: 'stable-only' },
      findings: { minConfidence: 'medium', gateConfidence: 'high' },
    },
    // Lab mode: keep everything, judge nothing.
    forensic: {
      recordVideo: true,
      misclick: { policy: 'aggressive' },
      findings: { minConfidence: 'low', gateConfidence: 'low' },
    },
  },
};
```

## Commands

```text
usereye observe [url] [options]
usereye auto [options]
usereye analyze [options]
usereye init [dir] [--workflow] [--no-gitignore]
usereye auth save --url <app> --out .auth/user.json [--headed]
usereye dashboard [run-dir] [options]
usereye export-issues <artifacts-dir> --format github|jira|linear [options]
usereye install-browsers [chromium|firefox|webkit|all ...]
usereye gc [artifacts-dir] --older-than 7d [--dry-run]
usereye doctor [--url <app>] [--json] [--update-check]
usereye --self-test | self-test | diag [--json]
usereye --version
```

`usereye --self-test` (aliases `self-test`, `diag`) runs in-process sanity assertions — help/command parity, module load, calm defaults, observe exit-code contract — without launching a browser. For environment preflight use `usereye doctor`. Full flag lists: [`docs/CLI.md`](docs/CLI.md).

`usereye doctor` validates the whole setup in one pass — Node version, Playwright and
which browser engines are actually installed, config load + unknown keys, the active
code-execution boundary, artifact writability and (with `--url`) target reachability.
It exits `0` when every required check passes and `2` otherwise, so it works as a CI
preflight step.

Run a command with `--help` for its full options. Existing `node usereye-observe.js` and `node usereye-auto.js` entry points remain compatible. Every run command accepts `--browser chromium|firefox|webkit` (default `chromium`) and `--dry-run`, which prints the full execution plan — targets, protocols, budget, safety, gates — and writes `plan.json` without launching a browser.

## Authentication

### Generic form (default)

```js
module.exports = {
  credentials: {
    email: process.env.USEREYE_EMAIL,
    password: process.env.USEREYE_PASSWORD,
  },
  auth: { strategy: 'form' },
};
```

### Playwright storage state

Generate state in the application’s own Playwright setup, then point UserEye at it:

```js
module.exports = {
  storageState: '.auth/user.json',
  auth: { strategy: 'storageState' },
};
```

### Project-owned login hook

```js
module.exports = {
  auth: { strategy: 'hook' },
  hooks: {
    async login(page, { credentials, baseURL }) {
      await page.goto(`${baseURL}/sso-test-login`);
      await page.getByLabel('Email').fill(credentials.email);
      await page.getByRole('button', { name: 'Continue' }).click();
    },
  },
};
```

Hooks receive Playwright objects; the UserEye engine never imports application source.

## Pattern packs and hints

English is the neutral default. Portuguese, Spanish and French are built in (`patternPack: ['en', 'pt', 'es', 'fr']`); packs stay independent unless you combine them:

```js
module.exports = {
  patternPack: ['en', 'pt'],
  patterns: {
    auth: /authenticate|enter workspace/i,
    dangerous: /erase tenant/i,
  },
  hints: {
    primaryCta: { role: 'button', name: /start|get started/i },
  },
};
```

A pattern pack can also be a path to a project-owned JSON file with categories such as `auth`, `dangerous`, `write`, `navigation`, and `utility`.

## Monorepos and profiles

```js
module.exports = {
  projectDir: '.',
  appDir: 'apps/web',
  profiles: {
    mobile: { viewport: { width: 390, height: 844 } },
    staging: {
      baseURL: 'https://staging.example.test',
      ignoreHTTPSErrors: true,
    },
  },
};
```

```bash
npx usereye auto --profile staging
```

A config can also run multiple applications and produce `matrix-summary.json` plus a linked matrix report
(per-app overrides, worst-exit aggregation and worked fixture in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)):

```js
module.exports = {
  outDir: 'artifacts/usereye-matrix',
  apps: [
    { name: 'Marketing', baseURL: 'http://127.0.0.1:3000' },
    { name: 'Dashboard', projectDir: 'apps/dashboard', command: 'npm run dev' },
  ],
};
```

## Plugins

```js
module.exports = {
  plugins: ['./test/usereye-plugin.js'],
};
```

A plugin may expose `{ id, protocols, beforeRun, afterObservation, afterState, afterRun }`. Plugin protocols use the same isolated scheduler as built-in protocols; hooks are optional, **isolated** (a throwing or hanging plugin is cut after 30 s and can never break the run) and their failures are recorded in `result.json#pluginDiagnostics`. Inline plugin objects are supported too and derive a fallback `id`, so `plugin-<id>-*` artifacts keep working. See [`docs/PLUGINS.md`](docs/PLUGINS.md) for the full contract and [`examples/plugins/run-logger.js`](examples/plugins/run-logger.js) for a working `afterRun` plugin.

## Browsers

Chromium is the default engine; Firefox and WebKit are first-class:

```bash
npx usereye install-browsers firefox
npx usereye auto --url https://staging.example.com --browser webkit --mode quick
```

The same lifecycle (steps, observations, retries, traces, artifacts) runs on all three; `tests/multi-browser.test.js` verifies it nightly in CI.

## Resilience: retries, timeouts and throttling

Transient network hiccups are retried with linear backoff; permanent failures (such as `ERR_UNSAFE_PORT`) are never retried. Every retry is recorded in `result.retriedOperations` and on the action as `usereyeAttempts`. All timeouts are configurable and properly cancelled — closing a run never hangs, even when the target stopped responding mid-navigation.

```js
module.exports = {
  retries: 2, // default 1; per-operation retry budget
  retryBackoffMs: 400, // backoff = retryBackoffMs * attempt
  navigationTimeoutMs: 15000,
  dialogTimeoutMs: 5000,
  minActionDelayMs: 250, // courtesy throttle between engine-issued actions
};
```

CLI equivalents: `--retries`, `--navigation-timeout`, `--dialog-timeout`, `--min-delay`.

## Dry runs

`--dry-run` answers "what would UserEye do here?" without a browser — useful in CI review and for auditing a target before touching it:

```bash
npx usereye auto --url https://staging.example.com --mode deep --dry-run
```

It prints the resolved target, engine, protocol selection, budget, safety posture, quality gates and planned outputs, and writes `plan.json` into the artifacts directory.

## Dashboard and issue export

`usereye dashboard` serves your runs (default `artifacts/usereye`) as a local, traversal-guarded web UI listing every run with its issue counts, gate status and adaptive score, linking straight into each `report.html`. `usereye export-issues` turns a finished run into tracker-ready payloads:

```bash
npx usereye dashboard artifacts/usereye --port 4321
npx usereye export-issues artifacts/usereye/run-2026-01-01 --format github   # gh-cli JSON
npx usereye export-issues artifacts/usereye/run-2026-01-01 --format jira --project-key UE
npx usereye export-issues artifacts/usereye/run-2026-01-01 --format linear    # Linear GraphQL JSON
```

Selection defaults to `blocker`+`critical`, severity-sorted; override with `--severities`. Jira payloads use Atlassian Document Format, Linear payloads map severity to priority.

## Safety

### The code-execution boundary

| Mode                       | Executes code from the target?                                  |
| -------------------------- | --------------------------------------------------------------- |
| `--url` (URL mode)         | **Never.** UserEye only drives a browser against a running app. |
| `--project` (project mode) | **Only what you authorize.** Static analysis is the default.    |

Since 7.5, running `usereye auto --project .` against a repository does **not** execute
that repository's npm scripts, its `node_modules` binaries, or its package manager.
Authorize explicitly when you trust the target:

```bash
usereye auto --project . --allow-project-commands lint,typecheck
usereye auto --project . --allow-project-commands all   # scripts + binaries + install
```

No command is ever passed through a shell: commands are tokenized and spawned with
`shell: false`, and anything requiring shell syntax is refused rather than escaped.
Every command executed _or blocked_ is recorded in `result.json` under `commandAudit`.
Full threat model: [`SECURITY.md`](SECURITY.md).

### Defaults

Unknown applications are read-only by default:

- writes, destructive actions, and downloads require separate explicit opt-ins;
- external links are skipped;
- configured path and control-name blocks are always enforced;
- registered secrets are redacted from structured artifacts;
- use write modes only on staging, preview, or disposable environments.

Production observe-only recipe:

```bash
npx usereye observe https://www.example.com --axe
npx usereye auto --url https://www.example.com --mode quick \
  --no-code-quality --no-video
```

Do not pass credentials or mutation flags in production.

## CI and exit codes

|      Code | Meaning                                       |
| --------: | --------------------------------------------- |
|         0 | Completed and configured quality gates passed |
|         1 | Completed with quality/severity failures      |
|         2 | Usage or tool/setup failure                   |
| 130 / 143 | SIGINT / SIGTERM interruption                 |

On pull requests the composite Action posts the `md-pr` report as a PR comment,
downloads the trunk baseline and runs `--compare` automatically, so a PR that breaks the
demo is reported as a list of _new_ issues rather than an absolute count.

A composite GitHub Action is included as `action.yml`. The repository also contains a ready-to-copy workflow and a browser-preinstalled Dockerfile.

## Library API

```js
const { UserEye, AdaptiveExplorer, loadConfig, writeReports } = require('usereye');
```

The historical `require('./user-eye').UserEye` class surface remains available. Artifact schema version 4 remains backward compatible.

## Development

```bash
npm ci
npx playwright install chromium
npm test              # full suite (browser tests skip automatically without engines)
npm run verify        # lint + format + typecheck + tests + checks + coverage gate
```

Other useful scripts: `npm run lint`, `npm run format`, `npm run typecheck`, `npm run checks` (version/API/README/Playwright/package consistency), `npm run test:coverage` (gate: core files >= 70%, browser-engine aggregate >= 40%, plus per-file floors for the browser-injected collectors, `run-diff.js`, `misclick-engine.js` and the explorer's auth flow — see `HONEST_FLOORS` in `scripts/check-coverage.js`; `USEREYE_COVERAGE_MARKDOWN=<file>` also writes a Markdown table), `npm run test:engine`, `npm run test:benchmark` (quick-mode perf vs. committed baseline; re-record with `USEREYE_UPDATE_BASELINE=1`).

The test suite covers the browser engine end-to-end (steps, observations, secrets, dialogs, retries, timeouts, artifacts on real Chromium/Firefox/WebKit), the in-page perception layer via jsdom (gaze, contrast, vitals, human signals), config discovery and precedence, redaction, pattern packs in four locales, blocklists, plugins, the dashboard and issue exporters, report locales, SARIF, package contents and size, the public compatibility surface, and five app fixtures.

Releases use changesets — see [`.changeset/README.md`](.changeset/README.md). npm provenance is configured at publish time, which is pending a public remote (see **Status** above).

## Contributing and security

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR (additive-changes-only rule, test requirements, benchmark policy). Vulnerabilities go through private channels — see [SECURITY.md](SECURITY.md).

## License

MIT

## Credits

Revisor Anônimo

## 7.2 roadmap features

- **Finding confidence & kind** — every issue carries `confidence` (high/medium/low) and `kind` (defect/risk/signal) in reports, JSON and SARIF. Configure via the `findings` block (`minConfidence`, `gateConfidence`, `suppress`, `elevate`, `treatAsSignal`) to run "quiet gates" that only fail on high-confidence findings.
- **CI regression gates** — `gates.maxMajor`, `gates.failOnNewMajor`, `gates.failOnNewHighConfidence`; run with `--compare baselines/usereye.json` to fail only on regressions (report shows New / Resolved / Persistent).
- **Misclick `stable-only`** — reserves "harmful" for URL/dialog changes so focus-revealed controls / skip-links do not raise majors. **Default since 7.4.1**; opt back with `--misclick-policy aggressive`.
- **`recordVideo: "on-failure"`** — records a session but ships no video on a clean run. **Default since 7.4.1**; opt back with `--video`.
- **`trace: "on-failure"`** — same policy for the Playwright trace (`user-eye-trace.zip`). **Default since 7.5.1**; `--trace always` keeps it, `--trace never` disables tracing.
- **`npx usereye init`** — scaffolds `usereye.config.js`, git-ignore entries, and an optional workflow.
- **Action v2** — job summary on PRs, optional SARIF to code scanning, browser cache, `soft-fail`, `browser`, and (7.4.1) `video` / `misclick-policy` inputs.
- **Host safety** — `allowedHosts` allow-list enforced by the explorer.

### Quick verify (clean machine)

```bash
npm ci
sudo npx playwright install-deps chromium   # Linux bare metal
npx playwright install chromium
npm test        # full matrix
npm run verify  # lint + format + types + tests + checks + coverage
```

## Authentication (capture once, reuse in CI)

```bash
# Login once (headed for 2FA/SSO) and persist a Playwright storageState:
npx usereye auth save --url https://app.example.com --out .auth/user.json --headed
```

Then configure the run to start authenticated without embedding credentials:

```js
module.exports = {
  auth: { strategy: 'storageState', storageState: '.auth/user.json' },
};
```

For complex shells, prove the login with post-auth assertions, and make a stuck SSO wall a clear
setup failure (exit 2 + `auth-required.json`) instead of a pile of majors:

```js
module.exports = {
  auth: {
    strategy: 'storageState',
    storageState: '.auth/user.json',
    required: true,
    successAssert: {
      urlNotMatch: /\/login/,
      selector: '[data-testid=app-shell]',
      noSelector: 'input[type=password]',
    },
  },
};
```

## Consent walls, zoom, app-shell readiness and iframes (7.2)

```js
module.exports = {
  consent: { strict: true, selectors: ['#onetrust-banner-sdk', '[class*=cookie]'], minWallArea: 0.18 },
  zoomMode: 'viewport', // 'css' (default) | 'viewport' | 'cdp' (falls back to css)
  ready: { strategy: 'load', selector: 'body', timeoutMs: 10000 }, // or 'quiet' (default) | 'selector' | 'network-almost-idle'
  diveIntoIframes: 'same-origin', // 'off' (default) | 'same-origin'
};
```

- **`consent`** — a cookie/consent panel is only flagged as a `consent-wall` finding when it actually covers
  the first fold (static in-flow cookie copy is ignored). Default `minWallArea` is 0.18 of the fold; with
  `strict: true` a wall must also expose an accept/decline control.
- **`zoomMode`** — how probes rescale the page. `viewport` doubles text by running in a halved 640×400
  viewport; `css` keeps the historical in-page `style.zoom='2'`.
- **`ready`** — how long the explorer waits for a JS app shell before seeding exploration. `quiet` (default)
  infers readiness from mutation quiet; `selector`/`load`/`network-almost-idle` are explicit strategies.
  A timeout is reported as a `ready-wait-timeout` stop reason, not a crash.
- **`diveIntoIframes`** — `same-origin` inventories same-origin frames (evidence only, surfaced as `frames`
  in the result); cross-origin deep-dive is intentionally out of scope.

## User-journey battery (resilience + accessibility/device) — 7.3

Adds opt-in probes (default **off**) that reason about the app's _behaviour across states_, not
just its DOM. Enable per run/profile:

```js
module.exports = {
  mode: 'standard', // user-journey probes run in standard/deep
  userJourney: {
    enabled: true,
    resilience: {
      backgroundTab: true, // does the app keep loading/working in a background tab?
      unsavedClose: true, // editable form without an autosave/draft guard?
      passwordRecovery: true, // login present — is there a "forgot password" path?
      lockout: false, // opt-in ONLY on sandbox targets (sends wrong passwords)
      languageSwitch: true, // accidental language change guard/revert
    },
    a11y: {
      permissions: true, // which powerful permissions does the page ask for?
      fastScroll: true, // fast scroll smoothness + no horizontal overflow
      keyboardShortcuts: true, // Ctrl+C/Ctrl+V not blanket-blocked?
      mobileLayout: true, // usable in a 390×844 phone viewport?
      rightClick: true, // native context menu not blocked?
      deadLinks: true, // broken same-origin links / anchors
      textResize: true, // visible font-size control for low vision
      highContrast: true, // high-contrast / forced-colors option?
      colorblind: true, // daltonic mode in settings?
    },
    lockoutAttempts: 1, // wrong-password tries made by the lockout probe
    tempMail: null, // reserved: disposable-inbox provider for the temp-mail login probe
    hasLogin: null, // null=auto-detect | false=no login (skip) | true=login present
  },
};
```

- **Login-only probes never run when the app has no login system.** Enforced two ways:
  - **Declared:** answer the question "your app has a login system?" with `hasLogin: false`, and
    `passwordRecovery`, `lockout` and `tempMail` short-circuit to `skipped` without touching a page
    ("if there's no login, don't activate these"). Set `hasLogin: true` to force them on a real auth
    surface.
  - **Auto-detected:** with `hasLogin` left `null` (default), each login probe proceeds only when it
    finds an actual login / `input[type=password]` form; otherwise it skips cleanly and passes.
- **`tempMail`** additionally requires a configured `userJourney.tempMail` provider — it stays
  inactive unless there is a login _and_ a provider.
- **`lockout` sends a real (wrong) password** to observe a cool-down/limit. It is off by default and
  must only be enabled against disposable/sandbox targets.
- Results surface per-probe as `passed`/`warning`/`skipped` in `protocol-results.json` and the report
  protocol summary — additive, so enabling the battery never changes the default issue gates of an
  existing project. A `warning` is evidence a reviewer acts on, not an automatic issue.

## Browser-extension effect battery (how the app reacts to popular Chrome extensions) — 7.4

Real Chrome extensions can't be installed in a headless browser, so this opt-in battery (default
**off**) **simulates the net effect** of the most popular extension categories and reports how the
app reacts:

```js
module.exports = {
  mode: 'standard', // extension probes run in standard/deep
  extensions: {
    enabled: true,
    categories: {
      adBlocker: true, // AdBlock / uBlock Origin — app breaks when ads blocked?
      darkReader: true, // Dark Reader — readable under forced dark?
      passwordManager: true, // LastPass/Bitwarden/1Password — autofillable login fields?
      translator: true, // Google Translate — layout tolerates longer text?
      couponHelper: true, // Honey / Capital One — prices are real DOM for injectors?
      fullPageCapture: true, // GoFullPage/Loom — content is DOM (capture-able)?
      reactDevtools: true, // React DevTools — React tree inspectable?
      volumeBooster: true, // Volume Master — <audio>/<video> present?
    },
  },
};
```

- **Every probe simulates the extension's effect** (network blocking, forced dark, text lengthening,
  autofill markers, DOM-text detection) and reports `passed`/`warning`/`skipped` evidence in
  `protocol-results.json` and the report protocol summary — additive, never changing default gates.
- **Gating**: `ext-password-manager` runs only when a login form is present; `ext-coupon-helper` only
  on a commerce surface; `ext-volume-booster` needs a media element. Others report informational
  results regardless.

## Performance signals (Core Web Vitals) — 7.5

Every run summarizes LCP, FCP, INP, CLS and TTFB into `result.performance`, aggregated by
**worst observed state** (a fast page must not hide a slow one) with the URL that produced it.

Budgets are optional and, deliberately, **not gates by default**:

```js
// usereye.config.js
module.exports = {
  gates: {
    maxLcpMs: 2500,
    maxCls: 0.1,
    // performanceMode: 'gate',  // experimental: makes the budget blocking
  },
};
```

With the default `performanceMode: 'signal'` the budget is measured and reported but can
never fail the build. A measurement taken while an explorer clicks through states, runs
audits and records video is noisy by construction; a flaky red build teaches teams to
ignore the report. Flip to `'gate'` only once you know your noise floor.

## Performance SLA (informal) — 7.5.1

The benchmark in `tests/benchmarks/quick-baseline.json` is the project's informal
SLA: a quick-mode adaptive exploration of the static fixture, measured at
**2.4 s** (Node `v20.20.2`, linux x64, chromium headless, video off, axe on). The
test fails only above **+50%** of the recorded baseline, so fast machines and
slow laptops both pass while a real regression is caught:

```bash
npm run test:benchmark          # compare against tests/benchmarks/quick-baseline.json
USEREYE_UPDATE_BASELINE=1 npm run test:benchmark   # re-record (deliberately, with a PR)
```

Points to keep in mind:

- The baseline records the environment it was measured on (`node`, `platform`,
  `usereye` version); machines differ, and CI keeps its own copy.
- This is a **trend gate, not a performance promise** — the quick run of the
  `demo/` app is what a user experiences in CI; a project's own pages are its
  own contract.

## Observability — 7.5

```bash
usereye auto --url http://127.0.0.1:4173 --log-level debug --timings
usereye auto --url http://127.0.0.1:4173 --log-json      # ndjson, one object per line
```

`--log-level error|warn|info|debug|trace` (default `info`, unchanged human output),
`--log-json` for machine-parseable logs, and `--timings` to record per-phase durations in
`result.json`.

## Config governance — 7.5

A mistyped key used to be silently ignored. It is now reported with a suggestion:

```text
Warning: Unknown UserEye config key "recordVido" — did you mean "recordVideo"?
```

Set `USEREYE_STRICT_CONFIG=1` (or `strictConfig: true`) to turn that into a usage error
(exit 2) in CI. The full, always-current reference is generated from the defaults
themselves: [`docs/CONFIG.md`](docs/CONFIG.md) plus a JSON Schema at
[`docs/usereye.config.schema.json`](docs/usereye.config.schema.json) for editor completion.
The public API reference is generated the same way: [`docs/API.md`](docs/API.md).

## Report formats & language

- `reportFormat`: `html`, `md`, `md-pr` (compact PR comment), `sarif`. Add `sarif` to enable GitHub
  code-scanning upload in the Action.
- `reportLocale`: `en`, `pt`, `pt-BR`, `es`, `fr`, or `auto` (derive from `config.locale`).
- HTML reports include a finding **confidence** (high/medium/low), an executive "Actionable vs
  Review" strip, and (with `--compare`) a New / Resolved / Persistent regression section. Every finding
  row also has a **Copy issue** button that puts a ready-to-paste GitHub title+body on the clipboard
  (label localized per report language).
- Full issue-facing strings (findings, misclick, scan) are localized for `en`, `pt`, `es` and `fr`.

## Dashboard

`npx usereye dashboard artifacts/usereye` serves a read-only index of runs, newest-first with
score bars and actionable counts.

## Review modes

UserEye now separates exploration depth from audit type:

- `--mode quick|standard|deep` keeps controlling the budget/depth of the normal explorer.
- `--review-mode normal|perf-seo|flows|a11y-strict` selects the review runner.

Examples:

```bash
usereye auto --url http://localhost:3000
usereye auto --review-mode perf-seo --url http://localhost:3000 --out artifacts/perf-seo
usereye auto --review-mode flows --flows ./usereye.flows.js --url http://localhost:3000
usereye auto --review-mode a11y-strict --url http://localhost:3000 --out artifacts/a11y
```

`perf-seo` uses a native Lighthouse-like Playwright/CDP audit by default and writes `performance-lab.json`, `seo-audits.json` and `network-summary.json`. `flows` only executes explicitly-declared JavaScript flow files. `a11y-strict` runs axe with WCAG tags, reports `incomplete` checks as needs-review by default, and can use Pa11y when that optional package is installed.

Flow files receive dependency-free text/count assertions and wait wrappers:

```js
module.exports = [
  {
    name: 'pomodoro completion',
    run: async ({ eye, page, expect }) => {
      await eye.step('timer and task update', async () => {
        await expect(page).text('#timeDisplay', '25:00'); // trimmed equality
        await expect(page).text('#atMeta', 'complete', { contains: true });
        await expect(page).count('#taskList .task-item', 3);
        await eye.waitText('#statMin', '50', { timeout: 5000 });
        await eye.waitFor(() => document.title.length > 0, { timeout: 90000 });
      });
    },
  },
];
```

`eye.waitFor(fn, { timeout, polling, arg })` calls Playwright with the correct
`page.waitForFunction(fn, arg, options)` signature. This avoids accidentally passing
`{ timeout }` as the function argument and silently retaining Playwright's 30-second
default. See [heuristic triage and accepted patterns](docs/HEURISTICS.md) for the
`opinion` lane, eternal-skeleton criteria, and contrast overlay hints.
