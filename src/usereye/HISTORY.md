# UserEye history

## 7.5.1 feedback hardening — triage, flows, hints, and retention

- Recognized accepted patterns now carry `kind: "opinion"`,
  `triage: "accepted-pattern"`, and a stable `acceptedPattern` ID. Decorative
  aria-hidden graphics in named controls, standard sr-only clipping, and tooltips
  that supplement an accessible name are separated below confirmed findings in
  HTML/Markdown and never fail `observe`.
- `observe` applies the same finding policy as `auto`; the complete audit trail is
  retained in `issuesAll`, while `issues` remains the surfaced list.
- Flow scope adds `expect(page).text/count`, `eye.waitText`, and a documented
  `eye.waitFor` wrapper that sends timeout options as Playwright's third argument.
- axe `color-contrast` nodes gain a root-cause hint when a positioned sibling pill
  paints behind a transparent text target; the hint is emitted by both `observe
  --axe` and `a11y-strict`.
- `eternal-skeleton` now reports the missing acceptance condition, ARIA/visual fill
  percentages, and transform-aware fill geometry.
- Explicit `--report-locale pt-BR` is accepted and covered by the full catalog
  parity tests.
- New `usereye gc [artifacts-dir] --older-than 7d [--dry-run]` safely prunes only
  old run directories containing `result.json`; `--keep-last N` remains the rolling
  retention policy.

## 7.5.1 — the box passes its own gates again, and its numbers tell the truth

### CLI help parity, usage errors, and `usereye --self-test`

Operator-facing CLI contract, no engine or `result.json` schema change:

- Top-level `--help` no longer swallows `doctor`, `init`, `auth`, `dashboard`,
  `export-issues` or `install-browsers` (only `observe` / `auto` / `analyze` used
  to receive their own usage text).
- `usereye auto --help` and `usereye observe --help` run *before* `loadConfig`, so
  a broken `usereye.config.*` or an `apps[]` matrix no longer hides the menu.
- `usereye auth save --help` no longer throws `auth save requires --url`.
- `usereye install-browsers --help` no longer starts a Chromium download.
- Unknown commands print the menu and exit 2 instead of a stack trace.
- Usage errors (unknown option, missing URL, invalid `--fail-on`, …) print the
  message without a stack; unexpected failures still print the stack.
- New command (aliases, same implementation): `usereye --self-test`,
  `usereye self-test`, `usereye diag`. In-process sanity assertions; no browser.
  `usereye doctor` remains the environment preflight.

Patch release executing **Phase 0** (hotfix of the delivery) and **Phase 1**
(measurement honesty) of `docs/ROADMAP-USEREYE-7.5.0.md`. No engine change, no config
change, no change to the `0 | 1 | 2` exit contract or to the `result.json` schema.

### Phase 1 — the coverage report stops lying

The 7.5.0 audit (roadmap §3, item A2) found that five files exercised by ~60 jsdom tests
were reported at **0.8–2.6%**, and three more had no direct test at all. Both were fixed
at the source rather than by relabeling the numbers:

- **Browser-injected collectors are now attributed** (`browser-perception/human/gaze/
  recorder/vitals.js`, `adaptive-browser.js`, and the inline `page.evaluate` callbacks
  of `misclick-engine.js`). `tests/helpers/browser-env.js` no longer `eval`s the
  function text as an anonymous string; it compiles it with `vm.runInContext` against
  the jsdom context under the collector's **real file URL**, with the rest of the file
  blanked out so every line/column offset is exact. Measured: perception 96.8%, human
  97.9%, gaze 96.2%, recorder 89.6%, vitals 84.2%, adaptive-browser 97.7%.
  - A second, subtler defect surfaced while doing this: when the process' source-map
    cache is non-empty (jsdom's dependencies ship `//# sourceMappingURL` comments and
    the CJS loader caches them under `NODE_V8_COVERAGE`), Node's coverage reader keeps
    only the **last** script per URL and credits its whole-file range — the number then
    swung between 32% and 100% depending on test order. The harness loads jsdom with
    the variable temporarily unset, and `tests/coverage-attribution.test.js` inspects
    the raw V8 output to guarantee per-function merging and a `count: 0` for a
    function that did not run.
- **`run-diff.js`** (basis of `--compare`): 11.69% → 100% with `tests/run-diff.test.js`
  — introduced/resolved/persisted by fingerprint, CTA change, `delta: null` without a
  previous score, fallback to `id` when fingerprints are missing, legacy baseline shape.
- **Authentication flow of `adaptive-explorer.js`** (`_attemptAuthentication`,
  `_authSuccessAssert`, `_liveAuthSignals`) was entirely uncovered — the code path that
  types credentials. `tests/explorer-auth.test.js` drives the real explorer in Chromium
  against a local login server: success by URL transition, success by assert on the same
  URL, wrong password (**exactly one** POST, no retry loop, reported as not
  authenticated), `hasLogin: false` never touching the form, missing submit control,
  broken selector → `error:` reason, and a **secret-leak regression** that scans actions,
  steps, `result()` and every artifact for the literal password. File: 46.9% → 68.7%.
- **`misclick-engine.js`**: 52.8% → 99.4% — `stable-only` vs `aggressive` outcome
  branches, `pointMap`, locale, evidence saving, `recover` and the dangerous-target skip,
  driven by a scripted stand-in for the page plus jsdom for the two browser callbacks.
- **Gate:** `scripts/check-coverage.js` adds `HONEST_FLOORS` — a per-file floor for each
  file above (85/75/90/60) so a broken attribution fails CI instead of silently reverting
  to 1%. With `USEREYE_COVERAGE_MARKDOWN=<file>` it also writes a Markdown table.
- **CI (item 1.5):** the `engine` job publishes that table to the job summary and, on pull
  requests, as a single sticky PR comment (updated in place; `pull-requests: write` scoped
  to that job only).

### Phase 0 — the delivery defect

### The defect

The 7.5.0 zip **failed `npm test` and `npm run checks` on a clean checkout**, for two
documentation reasons the gates had been built to catch — but only after packaging:

- `CURRENT.md:5` read `**Tests:** 327 total · 323 pass · 0 fail · **4 skipped**`; the
  hand-added bold broke the `(\d+) skipped` regex in `tests/packaging.test.js`.
- `DELIVERY.md` still quoted the 7.4.1 count (`286 total` / `286 tests`), so
  `scripts/check-readme-examples.js` failed twice.

Consequence: 2 failing tests, `npm run verify` ≠ 0, and the coverage gate failing in
cascade. The root cause was a `CURRENT.md` edited by hand after `pack:delivery` and a
`DELIVERY.md` that was never regenerated.

### The fix — docs *and* process

- **`npm run verify:delivery`** (new; `pack-delivery.js --refresh-only`) runs the suite and
  writes the real summary into `CURRENT.md`, `DELIVERY.md`, `DELIVERY-MANIFEST.json`
  and the tarball name in the package README, then exits without packing. `npm run
  release` is now `verify && verify:delivery && pack:delivery && verify:release`.
- **The packaging gate is stricter.** Besides requiring the `**Tests:**` line, it now
  fails when the line contains markdown (`*`, `_`, `` ` ``) — the fingerprint of a hand
  edit; when `total ≠ pass + fail + skipped`; when `CURRENT.md` and `DELIVERY.md`
  disagree; and when the docs disagree with the `tests.tests` recorded in the manifest.
- `CURRENT.md` is back under the 40-line budget `verify-release` enforces, and explains
  that the skip count is environment-dependent (firefox/webkit not installed; dirty tree
  skips the byte-reproducibility test) instead of asserting a fixed "4".
- `UserEye/README.md` → **Install** names the current tarball (`usereye-7.5.1.tgz`, was
  `7.4.1`); `pack-delivery.js` now derives that name from `package.json` on every
  refresh so it cannot drift again.
- Delivery-root `README.md` still announced 7.4.1 and `Node >= 18.18`; both corrected.
- `usereye-auto.js`: removed the dead ternary `(policy ? 2 : 2)` in the
  `no-new-high-confidence` gate (both branches returned 2).
- `UserEye/IMPLEMENTATION-REPORT.md` (a 7.0.0-era status report) moved to
  `docs/history/2026-09-05-implementation-report-7.0.0.md`.

### Phase 2 — artifact economy & consistent observability

Everything in the 7.5.0 audit's Phase 2, done additively — no contract change, the CI
default remains byte-identical to 7.5.0 for a bare run:

- **`trace` policy** (`trace: 'on-failure' | 'always' | 'never'`, config + `--trace`).
  It mirrors `recordVideo`: the Playwright trace was the largest artifact of a clean run
  (1.8 MB for a 7-second demo) and used to be written unconditionally. The clean-run test
  is now one shared `isCleanRun()` used by *both* the video and the trace, so the two can
  never disagree about whether a run failed. `result.json` records `traceDiscarded` /
  `traceRetainedBecause` and the console says which.
- **`report.embedLimit`** (default 200 KB): screenshots past the budget are linked next
  to the report instead of inlined as data URIs. The same quick demo run went from a
  580 KB report to ~113 KB — under the 250 KB target — and stays self-contained for the
  first N KB. `unlimited` restores the old behaviour.
- **`keepLast: n`** (config + `--keep-last`): optional local retention. The previous run
  rotates to `<outDir>-history/<stamp>` and history prunes to the newest `n`; `0`
  (default, CI) keeps clearing `outDir` exactly as before.
- **Step lines through the logger:** `[PASS]/[WARN]/[FAIL]` go through the phase-6 logger
  — byte-identical at `info`, silenced by `--log-level error`, structured under
  `--log-json` (`event: "step"`).
- **`artifacts.totalBytes` / `files` / `largest`** in `result.json` (fixed-point sizing
  so the number includes `result.json` itself), shown in the console summary and in the
  dashboard's new "Artifacts" column.

### Phase 3 — pending product decisions

The audit's Phase 3, completed as decided there (item 3.3 chosen option (a): localize):

- **3.1 — `--url` no longer analyses the cwd** (⚠ minor break). A URL run without an
  explicit project is now a *target* run: no static analysis of the invocation directory,
  no `project-analysis.json` / `code-quality.json` about files nobody asked about, and a
  clear "URL-only mode" line instead of "Project: usereye". `--project` (or
  `command`/`appDir`/`install`/`codeQuality: true`/`--analyze`, or per-app `projectDir` in
  a matrix) opts back in; the URL-only analysis placeholder keeps `result.json`,
  `dry-run` plans and `startup-error.json` unchanged in shape. **Migration:** code that
  expected `project-analysis.json` from a bare `--url` run must pass `--project`.
- **3.2 — es/fr catalogs complete** (audit M2): `patience.*` was a bare label string in
  es/fr, so those reports leaked raw keys (`moodCalm`, `feedback100…`) in the patience
  section. All four packs now carry the full translated section, plus a `patienceLabel`
  that fixed a pre-existing `[object Object]` report heading in every language. The
  i18n-pack test now requires **total leaf-key parity** across the four packs.
- **3.3 — auto-flow step names localized** (audit B5): steps and run-gate labels moved to
  `stepNames`/`gateLabels` catalog sections — under `--report-locale pt` the run now
  prints/records `Abrir aplicação-alvo`, `Exploração adaptativa — quick`, `Estado inicial
  observado`, `Critérios de qualidade`, etc. The English default is unchanged.
- **3.4 — `observe --fail-on <level>`**: `never | minor | major | critical | blocker`.
  Default is the historical contract (any issue exits 1); `major`+ turns observe into a
  severity gate for CI. Unexpected browser errors always exit 1; `never` means findings
  never fail a run. `auto` ignores the key.
- **3.5 — Windows npx fallback without a shell** (audit M6): `install-browsers` resolves
  the npm CLI as a file and drives it via `process.execPath` (`npm exec --no`, the
  npx --no-install semantics); playwright's own `cli.js` remains the primary path. The
  absolute last resort is `cmd.exe /d /s /c` with a **fixed** argv (allow-listed targets
  only, nothing user-controlled interpreted). `scripts/pack-delivery.js`,
  `check-package.js` and `check-coverage.js` were cleaned the same way, the CI
  `shell:` grep no longer has exceptions and now catches `shell: process.platform`
  conditionals too. There is no shell option enabled anywhere in the codebase.

### Phase 4 — publication prep (blocked only on your accounts)

Everything implementable without credentials is in place (`docs/RELEASE.md` is the
runbook): `.github/workflows/publish.yml` (npm job with `--provenance` and a
`NODE_AUTH_TOKEN`/environment-`npm` pairing; GHCR container job pushing `usereye:7`
+ `:latest`), `npm run verify:release` (68 gates: live run, trace/video policies,
packaging, manifest, docs budget) and `npm run pack:delivery` producing the
versioned zip. `package.json` deliberately omits `repository`/`homepage`/`bugs`
until the repository exists — they go in the same commit that publishes.

### Phase 5 — structural/strategic (5.1–5.6 done)

- **5.1 — decided, fixture-locked heuristics.** The three heuristics the 7.4.0/7.5.0
  audits called out now have a fixture, a test and a decision page that must all move
  together: misclick on a **focus-revealed** control (`aggressive` → harmful,
  `stable-only` → confusing, hard signals harmful under both) in
  `tests/fixtures/heuristics/focus-reveal.html`; the **consent-wall regexes**
  (`CONSENT_TEXT`/`CONSENT_ACTION`, layer + `minWallArea` gating, `strict` needs an
  action) with `consent-wall.html` and `consent-copy-not-layer.html`; the **200% zoom
  technique** (`zoomMode: 'css'` default vs `'viewport'` halved-layout-viewport —
  the same overflow failures without Chromium page-scale internals) with
  `zoom-overflow.html`/`zoom-fit.html` plus a real-browser runtime test of
  `zoom-200` in viewport mode. Decision page: [`docs/HEURISTICS.md`](docs/HEURISTICS.md).
- **5.2 — plugin hook contract.** `plugins.js` now validates the runtime contract
  (unknown members and non-function hooks warn at load), runs each hook with a
  **30 s budget** and **error isolation** (`beforeRun`, `afterObservation`,
  `afterState`, `afterRun`), and records failures in `result.json#pluginDiagnostics`.
  A plugin that throws or hangs can no longer break a run. Docs: `docs/PLUGINS.md`
  (honest: hooks are `auto`-only; observe never loads plugins).
- **5.3 — multi-app matrix made visible.** `config.apps` gets a dedicated fixture
  (`tests/fixtures/matrix/`, two static apps the adapter serves itself), an
  end-to-end test (`tests/matrix-apps.test.js`: happy path + unreachable app not
  aborting its sibling, worst-exit aggregation) and public docs
  ([`docs/MATRIX.md`](docs/MATRIX.md)) with the summary schema, output layout and
  per-app override rules.


- **5.4 — dashboard trends.** `dashboard.js` now groups the discovered runs by
  application and renders, for every app with ≥ 2 runs, a **trend section**: an
  inline SVG line for score (0–100) and for worst LCP (ms, from
  `result.performance.metrics.lcp`), a per-run table with Δ columns (score,
  issues, LCP — colored by direction, lower-is-better for issues/LCP) and a
  "latest vs previous" summary line. The per-run table and read-only file
  serving are unchanged; `tests/dashboard.test.js` covers discovery, grouping,
  sparklines, deltas and the HTTP server.
- **5.5 — the intelligence layer, if it ever returns, is a plugin.** The engine
  core is deterministic (no AI, no network, no hidden state) and stays that way.
  `examples/plugins/result-insights.js` is the sanctioned pattern: an
  `afterRun` plugin that receives the completed payload in memory (the exact
  object later written to `result.json` — which lands *after* the hooks, so
  plugins must not read the file) and writes its own prefixed artifact. An LLM
  layer would be the same shape, opt-in and time-budgeted by the hook contract.
- **5.6 — informal SLA published.** `tests/benchmarks/quick-baseline.json` (the
  committed quick-mode baseline, 2.4 s on Node v20.20.2 linux x64) is now
  referenced from the README as the project's **informal performance SLA**:
  `npm run test:benchmark`, failure only above +50%, deliberate re-record with
  `USEREYE_UPDATE_BASELINE=1`. Explicitly a trend gate, not a promise.


## 7.5.0 — the code-execution boundary, and a tool you can observe

Implements the 7.4.1 evolution roadmap. **No change to the `0 | 1 | 2` exit contract**,
no finding is destroyed (`issuesAll` is still complete), and every new behaviour is either
a safety default or opt-in. Deliberately **no LLM/model layer**: findings and gates remain
fully deterministic.

### Security — the boundary (breaking for `--project` users who relied on it)

Up to 7.4.1, `usereye auto --project .` executed commands that came from the **target**
repository — its `package.json` scripts, the `eslint`/`prettier` binaries in its
`node_modules`, and with `--install` its package manager — via `spawn(..., { shell: true })`.
Pointing UserEye at an untrusted clone therefore ran that clone's code.

- **Static analysis is now the default.** `codeExecution.npmScripts`, `.binaries` and
  `.install` all default to `false`.
- **Opt in per category:** `--allow-project-commands lint,typecheck` (also `scripts`,
  `binaries`, `format`, `unit-tests`, `install`, `all`), or `codeExecution.*` in config.
- **`shell: true` is gone from the entire codebase.** A new shared `command-runner.js`
  tokenizes commands itself and spawns with `shell: false`; anything needing shell syntax
  is **refused**, not escaped. `test -z "$(gofmt -l .)"` became a JS emptiness check.
- **Audit trail:** `result.json` gains `commandAudit` — every command executed or blocked,
  with argv, cwd, decision, reason and exit code. Blocked commands surface as `skipped`
  checks and are never counted as quality failures.
- `--install` alone no longer suffices; installation also requires the `install` category,
  so a committed config cannot trigger a dependency install on someone else's machine.

**Migration:** if you relied on project-mode lint/typecheck results, add
`--allow-project-commands lint,typecheck` (or the `all` category) to your invocation.

### Dependencies and supported runtimes

- `axe-core` pinned exactly (`4.13.0`), matching `playwright`. Runtime dependencies must
  now be exact — a caret meant two installs of the same UserEye could produce different
  findings, which breaks `--compare`.
- `engines.node` corrected to `>=20.11`, and `@types/node` realigned to the **minimum**
  supported runtime (was `^26`, which type-checked APIs that cannot run on the declared
  minimum). CI matrix: Node 20, 22, 24.
- New `scripts/check-dependencies.js` enforces all of the above in `npm run checks`.

### Performance signals

`result.performance` now always summarizes LCP/FCP/INP/CLS/TTFB, aggregated by worst
observed state with the URL that produced it. Optional budgets `gates.maxLcpMs`,
`gates.maxCls`, `gates.maxInpMs` are **signals by default** (reported, never failing);
`gates.performanceMode: 'gate'` makes them blocking and is documented as experimental,
because an explorer is a noisy measurement environment.

### Observability

`--log-level error|warn|info|debug|trace` (default `info` — human output unchanged),
`--log-json` for ndjson, `--timings` to record per-phase durations in `result.json`, and a
new **`usereye doctor`** command that validates Node, Playwright, installed engines,
config, the active code-execution boundary, artifact writability and target reachability
in one pass (`--json`, `--update-check`).

### Config governance

`normalizeConfig` no longer swallows typos: unknown keys are reported with a suggested
correction, and common value types are validated. `USEREYE_STRICT_CONFIG=1` (or
`strictConfig: true`) upgrades warnings to a usage error. `docs/CONFIG.md` and a JSON
Schema are **generated from `DEFAULT_CONFIG`**, so the reference cannot drift.

### CI/CD

The composite Action posts the `md-pr` report as a PR comment, publishes/downloads the
trunk `result.json` baseline as a versioned artifact, and runs `--compare` automatically
on pull requests, so a PR is judged on *new* issues rather than absolute counts.

### Maintainability and docs

`adaptive-explorer.js` (1279 lines) split into `explorer/budget.js`, `explorer/targeting.js`,
`explorer/state.js` and `explorer/audit.js` — all browser-independent and unit-tested
without launching a browser. `code-quality.js` and `project-adapter.js` share one runner.
`docs/API.md` is generated from the `.d.ts` surface and documents the `issue` data model
(`confidence`/`kind`/`source`/`code`/`surfaced`) for downstream automation.

## 7.4.1 — calm by default, and a box that matches the product

Patch release implementing **ROADMAP-PACKAGING-AND-DEFAULTS**. No new protocols, no
explorer rewrites, no LLM features, and no change to the `0 | 1 | 2` exit contract.

### Migration note (the only behaviour change)

> Bare CLI now matches `usereye init`: videos on failure only, stable-only misclick,
> medium `minConfidence` for listing. Restore prior behavior with `recordVideo: true`
> and `misclick.policy: 'aggressive'`.

Until 7.4.0, `usereye init` scaffolded a calm profile while `DEFAULT_CONFIG` still
shipped a loud one — so running `usereye auto` with **no config file** was noisier and
heavier than the documented happy path. The defaults are now the calm profile:

| Knob | 7.4.0 (bare CLI) | 7.4.1 (bare CLI) | Get the old behaviour |
| --- | --- | --- | --- |
| `recordVideo` | `true` | `'on-failure'` | `--video` or `recordVideo: true` |
| `misclick.policy` | `'aggressive'` | `'stable-only'` | `--misclick-policy aggressive` |
| `findings.minConfidence` | `'low'` | `'medium'` | `findings.minConfidence: 'low'` |
| `findings.gateConfidence` | `'high'` | `'high'` (unchanged) | — |
| `extensions.enabled` / `userJourney.enabled` | `false` | `false` (unchanged) | — |

Unchanged and explicitly guaranteed: exit codes stay `0 | 1 | 2`; the public API
(`UserEye`, `loadConfig`, `DEFAULT_CONFIG`, …) keeps its names; the **engine**
constructor default for `new UserEye()` stays `recordVideo: true`, so direct library
callers see no change — only config/CLI paths (`auto`, `observe`, the Action) adopt
the calm profile; configs that already set loud values behave exactly as before.

### New CLI flags

`--video` (always keep the webm) · `--video-on-failure` (the new default, spelled out)
· `--no-video` (existing) · `--misclick-policy stable-only|aggressive`. The three video
flags are mutually exclusive and an invalid `--misclick-policy` is a usage error
(exit 2) rather than a silent fallback.

### Calm reports, complete evidence

- `result.json` now also carries **`issuesAll`** — every annotated finding, each with an
  explicit `surfaced: true | false` flag. `issues` remains the surfaced list that reports
  and gates read, so the 7.4.0 contract is preserved. `summary.issuesRecorded` reports the
  unfiltered count.
- `findings` gains `signals`, `heldBack` and `totalRecorded`.
- The console summary prints `Actionable: N · Signals: M` (plus how many findings were
  held below the confidence floor) so a green run never reads as "nothing happened".
- The console now states what happened to the session video — `Video: discarded — clean
  run (recordVideo: 'on-failure')`, or `Video: kept — recordVideo: 'on-failure' — 1 major
  finding`. Before this, a run could print `Quality gates: PASS`, exit 0 and still leave a
  `.webm` behind, which reads as a contradiction: the default gates bound blockers and
  criticals only, while `on-failure` retention also triggers on majors, harmful misclicks
  and unexpected browser errors. `result.json` records the same reason under
  `artifacts.videoRetainedBecause`. Nothing is printed when no video was configured.
- SARIF gets its own floor, `sarif.minConfidence` (default `medium`), because a wall of
  low-confidence heuristics in GitHub code scanning trains reviewers to ignore the tab.
  The SARIF run records `minConfidence`, `heldBackBelowFloor` and
  `fullEvidence: result.json#issuesAll`. Unclassified authoritative axe violations are
  never filtered out.

### Packaging clarity

- Delivery zip is named from `package.json` (`usereye-7.4.1-balanced.zip`) and contains
  **exactly one generated top-level folder** of that same name, holding `CURRENT.md` /
  `DELIVERY.md` / `README.md` / `DELIVERY-MANIFEST.json` / `UserEye/` / `demo/` / `docs/`.
  So `UserEye/package.json` is reachable at `usereye-7.4.1-balanced/UserEye/package.json`
  — one nesting level, named after the version it contains. The double-nested
  `UserEye-7.1.1-BALANCED/UserEye-7.1.1-BALANCED/` folder is gone.
- `README-DELIVERY.txt` (which still described 7.1.1 and "157 tests") is replaced by
  `DELIVERY.md`; the competing audit reports are archived under `docs/audits/` and
  `CURRENT.md` is the single "start here" pointer.
- New `npm run pack:delivery` reproduces the zip (name, layout, manifest, sha256) with no
  hand-editing, and `npm run checks` now includes `scripts/check-delivery-names.js`, which
  fails a release if the delivery docs advertise a different generation than the package.
  The packer also rewrites the `**Tests:**` line in `CURRENT.md` and `DELIVERY.md` from the
  real `npm test` run it performs first, so the shipped docs can only quote a run that
  actually happened — the previous bundle advertised "157 tests" by hand.
- The manifest reports what it verifies: `fileCount` and `bytes` exclude the manifest
  itself, `zipSha256` lives only in the side manifest (an archive cannot contain its own
  hash), and `git.dirty` is recorded so a pack from an uncommitted tree says so.
- New `npm run verify:release` grades the built zip rather than the source tree: it reads
  the archive with a dependency-free reader (verifying every entry's CRC-32, length and
  Unix mode, and refusing absolute paths, `..` traversal and symlink entries), recomputes
  `contentsSha256` from the extracted bytes, compares the side manifest's `zipSha256`
  against the real file, then walks the roadmap's §6 acceptance list and §10 definition of
  done against the extracted tree — including live runs of the extracted CLI against the
  extracted demo server, calm and loud. Sections needing a browser or a dependency tree
  skip with a reason instead of passing quietly. `npm run release` chains
  `verify` → `pack:delivery` → `verify:release`.
- Packs are byte-reproducible. Entries were already sorted and entry timestamps fixed, but
  the manifest inside the zip stamped `generatedAt` from the wall clock, so the same tree
  packed to different bytes depending on when the script ran — which makes `zipSha256` a
  record of a moment rather than an identifier for a release. On a clean tree it is now
  taken from the commit's committer date; a dirty tree falls back to the clock and says so
  via `git.dirty`. Verified by packing the same commit twice, a second apart, and comparing
  bytes, and by rebuilding from a cold `git clone` + `npm ci`.
- The dependency-free ZIP writer set "version made by = UNIX", which makes the high 16 bits
  of each entry's external attributes an `st_mode` — but wrote only the MS-DOS directory
  bit, leaving the Unix mode at `0000`. `unzip` faithfully produced **mode-000
  directories**: the archive extracted and could not be opened. Entries now carry `0755`
  for directories and `0644` for files, verified both by reading the bits back out of the
  central directory and, when `unzip(1)` is present, by extracting for real and asserting
  every directory is readable.
- `types/index.d.ts`: `UserEyeOptions.reportLocale` widened from `'en' | 'pt'` to the
  shipped packs `'en' | 'pt' | 'es' | 'fr' | 'auto'`; `UserEyeFindingKind` /
  `UserEyeFindingConfidence` aliases added; `UserEyeIssue.surfaced` declared.
- Metadata honesty: `package.json` no longer points `repository` / `homepage` / `bugs` at
  `github.com/usereye/usereye` — that org is a verified 404, and the `usereye` name is not
  on the npm registry (also verified). A missing link beats a dead one, so all three fields
  are simply absent now; the package stays publishable (`"private": false`,
  `publishConfig` intact) and the real remote should be added in the same commit that
  publishes. `scripts/check-delivery-names.js` fails the release if any of them ever points
  back at a dead URL. `sarif.js` derives `informationUri` from `package.json` and omits it
  rather than emitting a dead link, and its version fallback is `package.json` instead of a
  hardcoded `'7.0.0'`. `usereye init --workflow` now generates a workflow that runs the CLI
  directly (works immediately, nothing to publish first) and documents the composite-Action
  one-liner for when the Action has a public home.
- Version truth in code: `bin/usereye-init.js` resolved its version through a `try`/`catch`
  that fell back to a hardcoded `'7.2.0'` — the same class of bug as the `'7.0.0'` in
  `sarif.js` above, and it would have pinned generated workflows to a release that does not
  exist. It now reads `package.json` at module scope like `sarif.js`, `user-eye.js` and
  `bin/usereye.js` already did. The reason nothing caught it: `check-delivery-names.js`
  applied its stale-generation pattern **only to the delivery docs**, never to shipped
  source. A new rule scans the 60 files `npm pack` ships, stripping comments first with a
  string- and regex-literal-aware scanner — so *documenting* a 7.1.1 compatibility promise
  stays legal while *freezing* a version value fails the release.
- `node bin/usereye-init.js` was a silent no-op, because the file is a module and `bin`
  maps only `usereye`. It now behaves exactly like `usereye init` rather than printing
  nothing and exiting 0.

### Changeset housekeeping

`.changeset/calm-by-default.md` was consumed by this release rather than left pending. It
had already been superseded twice: it described the package as `"private": true` (the
released decision is `"private": false` with `publishConfig` intact — only the dead URLs
were dropped), and a pending changeset naming an already-released version makes
`changeset version` emit the *next* patch with a duplicate changelog. That is the same
footgun the stale `calm-tools-roam.md` changeset had (a `minor` bump and 7.4.0 notes for a
release already recorded here), which is why this entry is the single record of 7.4.1.

## 7.4.0 — browser-extension effect battery (how the app reacts to popular Chrome extensions)

Real Chrome extensions cannot be installed in a headless Playwright browser, so this opt-in,
additive battery (`config.extensions`, default **off**) **simulates the net effect** of the most
popular Chrome extension categories and measures how the running app reacts. Each probe navigates
its own isolated context and reports `passed`/`warning`/`skipped` evidence into
`protocol-results.json`. Probes map to the extension families users asked about:

- **`ext-ad-blocker`** → AdBlock / Adblock Plus / uBlock Origin. Intercepts and aborts known
  ad/tracker/analytics third-party requests, then checks the app still renders its main content
  (no collapse when ad-supplied layout is cut).
- **`ext-dark-reader`** → Dark Reader. Runs under a forced dark color scheme and reuses the
  perception contrast pass to see whether text stays legible.
- **`ext-password-manager`** → LastPass / Bitwarden / 1Password. On a login surface, checks the
  credential fields are autofillable (`type=password`, `autocomplete="current-password"`,
  username/email hints, inside a `<form>`). Skips when there is no login form.
- **`ext-translator`** → Google Translate. Simulates translated-text lengthening and measures
  whether the layout tolerates it without horizontal overflow.
- **`ext-coupon-helper`** → PayPal Honey / Capital One Shopping. Detects a commerce surface and
  whether prices are real DOM text a coupon injector could act on. Skips with no commerce.
- **`ext-full-page-capture`** → GoFullPage / Loom. Checks the main content is DOM-rendered (not
  canvas-dominated) so a full-page screenshot/recorder would see it.
- **`ext-react-devtools`** → React Developer Tools. Reports whether a React mount root / fiber is
  present so the component tree is inspectable.
- **`ext-volume-booster`** → Volume Master. Reports whether `<audio>`/`<video>` exist for a
  per-tab volume booster to control.

Config, type declarations and `config.js` normalization added; registration mirrors the 7.3
`userJourney` pattern (opt-in, standard/deep modes). Tests: `tests/extensions.test.js` serves a
fixture (ad/tracker link, a login form *without* autocomplete, a price, an `<audio>` element, tall
DOM content) and asserts the intended statuses on a real browser, plus an off-by-default guard.

Version bumped to **7.4.0** (internal only; nothing published).

## 7.3.0 — user-journey battery (resilience + accessibility/device probes)

New opt-in `userJourney` config adds a family of probes to `standard`/`deep` protocol runs
(`protocols/user-journey.js`). Additive — the battery is **off by default** and never changes
existing runs; when enabled each probe reports `passed`/`warning`/`skipped` evidence in
`protocol-results.json` and the report protocol summary.

- **Resilience (the "sad path")** — `userJourney.resilience`:
  - `backgroundTab` — moves the app to a background tab and checks whether it still progresses
    (throttled timers/rAF vs. a freeze), i.e. does the app load/keep working in the background.
  - `unsavedClose` — detects editable forms and whether an autosave/draft guard protects progress
    if the user closes or navigates away without saving.
  - `passwordRecovery` — only active when a login form is present (per the requested rule); checks
    for a visible "forgot password" recovery path. Skips when there is no login.
  - `lockout` — **opt-in (default false)**: deliberately submits a small, configured number of wrong
    passwords (`lockoutAttempts`, default 1) to observe a cool-down / attempt limit / escalating
    message. Side-effecting — enable only on sandboxed targets.
  - `languageSwitch` — detects a language switcher and reports whether an accidental change is
    guardable/reversible (evidence; does not change the running locale).
  - `tempMail` — **strictly conditional**: an auth-surface probe that stays skipped unless a
    disposable-inbox provider descriptor (`userJourney.tempMail`) is configured and the app shows a
    login/signup — i.e. not activated when there is no login.
- **Accessibility & device** — `userJourney.a11y`:
  - `permissions` — reports which powerful permissions (geolocation, notifications, camera/mic,
    clipboard…) the page exposes and their grant state.
  - `fastScroll` — measures smoothness (dropped frames) of fast programmatic scroll and horizontal
    overflow, i.e. does it freeze/jank or scroll smoothly and correctly.
  - `keyboardShortcuts` — flags a blanket interception of common shortcuts (Ctrl/C, Ctrl/V, …).
  - `mobileLayout` — renders at a 390×844 phone viewport (isMobile/hasTouch) and reports whether the
    layout holds without horizontal overflow / missing mobile viewport meta.
  - `rightClick` — reports whether the native context menu is blocked.
  - `deadLinks` — probes same-origin links + anchors for broken destinations (4xx/5xx / missing anchor).
  - `textResize`, `highContrast`, `colorblind` — report whether the app exposes a font-size control,
    a high-contrast / forced-colors option, and a colour-blind (daltonic) mode.

Config shape, type declarations (`types/index.d.ts`, `types/usereye-config.d.ts`) and
`config.js` normalization added. Tests: `tests/user-journey.test.js` serves a fixture that
implements every scenario and asserts the probes detect it against a real browser, plus a guard
that the battery is off by default.

**Login gating is explicit.** A new shared `userJourney.hasLogin` flag answers "does your app have a
login system?": `false` short-circuits every login-only probe (`passwordRecovery`, `lockout`,
`tempMail`) to `skipped` before a page is touched; `true` runs them; `null` (default) auto-detects a
login form and only then runs. `tempMail` also requires a configured provider. Tested on the fixture
for all three branches (declared no-login, auto no-login, login present).

**Validated against youtube.com** (a real, login-capable site) in `standard` mode with the battery on:
- Login gating held on a real site: because the YouTube home surface exposes no `input[type=password]`,
  `passwordRecovery` and `tempMailLogin` auto-skipped (`no-login-form` / `no-login-or-signup`); the
  `lockout` probe is off by default and was not enabled (never brute-force Google accounts).
- `right-click` and `keyboard-shortcuts` previously measured a blocker *they themselves installed* and
  always warned (false positive). Both now dispatch a cancelable event and read the page's real
  `defaultPrevented` with no self-installed blocker, so youtube.com correctly reports `passed`.
- **Robustness fix (`usereye-auto.js`)**: when adaptive exploration fails (e.g. a transient anti-bot /
  consent wall that yields no rendered `body`), `adaptiveResult` is now always an object, so the
  concurrent-protocols step no longer crashes with "Cannot set properties of undefined". The concurrent
  step completes and reports protocol evidence even when the adaptive explorer is blocked.

Version bumped to **7.3.0** (internal only; nothing published).

## 7.2.0 — consent-wall gating, real zoom modes, ready/iframe policy, full es/fr, one-click issue copy

### Engine (Phase 2.2 · 2.3)

- **Consent-wall geometry gating** (`browser-human.js`): a consent/cookie panel is only flagged when it actually *covers the first fold* — static in-flow cookie copy no longer counts. `collectHumanSignals` accepts a `consent` option normalised in `config.js` (`{ strict, selectors, minWallArea }`, default `minWallArea` 0.18 of the fold). Each wall reports `{ selector, tag, id, name, text, areaRatio, role, hasConsentAction }`; in **strict** mode a wall is only flagged if it also exposes an accept/decline control. Findings keep the historical `major` `consent-wall` signal.
- **Real zoom modes** (`protocols/experience.js`): `zoomMode` now selects how the page is rescaled for reduced-motion, scroll-trap and layout probes. `css` (default) preserves the historical `style.zoom='2'`; `viewport` doubles text by running in a halved 640×400 viewport (`withContext`); `cdp` is accepted for config parity and falls back to `css`. Threaded through `user-eye.js`, `usereye-auto.js`, `config.js` validation and typed in `types/usereye-config.d.ts`.

### Engine (Phase 6)

- **Ready policy for app shells** (`config.js` + `adaptive-explorer.js`): `ready` normalises to a strategy (`quiet` default, or `selector`/`load`/`network-almost-idle`) plus `selector` and `timeoutMs` (10000). The explorer waits via `waitForReady()` before seeding exploration and reports `ready-wait-timeout` as a stop reason on timeout.
- **Same-origin iframe policy**: `diveIntoIframes = 'off' | 'same-origin'`. `_frameInventory()` now inventories same-origin frames (evidence: `src`/`sameOrigin`/`name`/`width`/`height`), surfaced on the explorer `result()` as `frames`. Cross-origin deep-dive remains out of scope; the plan records this deliberately.

### Internationalization (Phase 7)

- `es` and `fr` locale packs now carry the **complete catalog** — all 32 `findings` titles/details, `misclick`, `scan`, and the full `gaze` (reasons, load labels, narratives, purposes, goals) and `plan` sections — matching en/pt. Placeholder parity is enforced across en/pt/es/fr by `tests/i18n-context.test.js`. The few keys that still read identically to English (`control` in es; `Interactions`/`Score`/`Application`/`Mode`/`Violations` in fr) are genuinely same-word translations and are correct as-is.

### Evidence UX (Phase 8)

- **One-click GitHub copy**: every finding row in `report.html` carries a *Copy issue* button that reconstructs the `[severity] id: title` GitHub body (reusing `issue-export.issueBody`, now exported) and copies it to the clipboard (with a legacy `execCommand` fallback), showing a brief ✓/✗ confirmation. Button label is localized (`copyIssue` key added to all four packs).

### Release notes

- Version bumped to **7.2.0**. New findings fields, explorer `frames`, the `copyIssue` locale key and the `ready`/`diveIntoIframes`/`zoomMode`/`consent` config options are additive; no prior outputs or flags break. No package has been published; versioning is internal only.

## 7.1.1 — context-aware occlusion, complete report localization

### Engine fixes

- **Dialog-context-aware occlusion** (`browser-perception.js`): controls behind an *open* dialog failed the center hit-test and produced a `major` `occluded-controls` finding even though a modal backdrop blocking the background is the designed APG behavior. Each occlusion hit is now checked against the rendered dialog context (`dialog`, `[role="dialog"]`, `[aria-modal="true"]`, or the wrapper containing them): hits whose occluder belongs to an open dialog while the control sits outside it are recorded as `occludedByOpenDialog` (visible in `counts.occludedByOpenDialog`) instead of being reported as defects. Genuine layout occlusion (e.g. a stray always-on backdrop, which also trips `visible-hidden-elements`) is still reported.
- **aria-hidden dedup dead filter** (`browser-perception.js`): the nested-subtree filter `!element.closest('[aria-hidden="true"]') || element.matches('[aria-hidden="true"]')` was provably a no-op (every queried element matches the selector by construction), so nested `aria-hidden` nodes were counted once per level. Only the outermost rendered element of each hidden subtree is reported now.

### Internationalization

- **New `i18n.js` module** single-sources the runtime catalogs: `catalog()`, `section()`, `findingStrings()`, `format()` and `t()`. `report.js` now shares it instead of keeping a private loader.
- **Findings are localized**: all 32 finding titles/details of `browser-perception.js` and `browser-human.js` moved to `locales/{en,pt}.json` (`findings` section) and are injected into the browser collectors through `page.evaluate` arguments (`perception.js`, `user-human.js`, `protocols/human.js`, `protocols/experience.js`, `protocols/input.js`, `adaptive-explorer.js`, `user-eye.js` pass `reportLocale`). A run with `--report-locale en` no longer leaks Portuguese titles; `pt` keeps the exact strings shipped since 7.0.0.
- **Gaze scan lines** (`browser-gaze.js`), **cognitive-load reasons/labels, narratives and purpose labels** (`user-gaze.js`), **user-plan steps** (`user-plan.js`), **patience moods/reasons/disclaimer** (`patience.js`) and **misclick effects/titles** (`misclick-engine.js`) follow `reportLocale` through the new `gaze`/`scan`/`plan`/`patience`/`misclick` locale sections.
- New regression suite `tests/i18n-context.test.js` (10 tests): en/pt key parity, localized findings in jsdom, dialog-context suppression plus its negative case (stray backdrop), aria-hidden dedup, and localized plan/patience output.
- **`reportLocale` wiring fix**: the `UserEye` constructor dropped `reportLocale` from its options whitelist, so `this.options.reportLocale` was always `undefined` and every engine string fell back to English regardless of `--report-locale`. The option is now kept in `this.options` (typed in `types/index.d.ts`) and `usereye-observe.js` / `usereye-auto.js` pass `config.reportLocale` into the constructor, not only into the report writer. Verified live: `observe --report-locale pt` now emits Portuguese findings/plan/patience, `en` emits English.

## 7.1.0 — robustness, types and internationalization

### Engine fixes

- **Contrast detection fix**: `opaqueBackground()` treated a transparent `body` background as opaque black, so black-on-white text scored a 1:1 contrast ratio and produced false `insufficient-contrast` findings. A background now only counts as opaque with alpha >= 0.92 (confirmed and verified in Chromium).
- `close()` no longer hangs (~90 s) while a navigation to a never-responding server is still pending: every teardown operation (vitals collection, experience flush, tracing stop, video finalization, context/browser close) is bounded by an explicit timeout, and repeated `close()` calls are no-ops.
- `nextDialog()` removes its `page.on('dialog')` listener when it times out — no leaked listeners.
- The default `press()` label is English (`Press Tab`).
- The `video-raw/` directory is only created when video recording is enabled.

### New capabilities (all additive)

- **Retry policy**: `retries` + `retryBackoffMs`; transient navigation/wait failures are retried with linear backoff and recorded in `result.retriedOperations` and `usereyeAttempts`. Permanent errors (e.g. `ERR_UNSAFE_PORT`) are never retried.
- **Configurable timeouts**: `navigationTimeoutMs` and friends via options or `usereye.config.js`, typed and documented.
- **`--dry-run`**: prints the execution plan (targets, protocols, budget, gates) without launching a browser; `buildExecutionPlan()` is exported.
- **Courtesy throttling**: `minActionDelayMs` rate-limits engine-issued actions.
- **Multi-browser**: `--browser chromium|firefox|webkit` for `usereye auto`, `usereye observe` and `install-browsers` (default chromium).
- **New locale packs**: Spanish (`es`) and French (`fr`) join `en`/`pt`; packs stay independent unless combined.
- **Plugin example**: `examples/plugins/run-logger.js` + `docs/PLUGINS.md`; inline plugin objects derive a fallback `id` so `plugin-<id>-*` artifacts keep working.
- **Run dashboard**: `usereye dashboard` serves past runs with a traversal-guarded static server.
- **Issue export**: `usereye export-issues --format github|jira|linear` turns result.json issues into tool-ready payloads (Jira ADF, Linear priorities, gh-cli JSON).
- `install-browsers` resolves the Playwright CLI through `playwright/package.json` with an `npx --no-install` fallback — more durable across npm layouts.
- `scripts/check-playwright-version.js` keeps the Dockerfile tag and the lockfile in sync; the Docker image moved to `v1.63.0-noble` to match Playwright 1.63.0.

### Types and packaging

- TypeScript declarations generated from JSDoc (`tsc --emitDeclarationOnly --allowJs`); `@types/node` added; types compile standalone under `types/tsconfig.json`.
- The tool version is single-sourced from `package.json` (no more hardcoded copies).
- Package-size regression guard keeps the tarball under 150 kB.

## 7.0.0 — project-agnostic release

- Neutral package identity and browser defaults.
- Per-project configuration, profiles, safety blocklists, auth strategies, pattern packs, report localization, CLI distribution, plugins, SARIF, Docker and CI integration.
- Existing class APIs and command flags remain compatible.

## 6.1.x historical fix log

# What changed (instrumented verification — no guessing)

Date: 2026-09-05  
Project: SecureVault-UserEye (UserEye 6.1.0)  
Method: `node --check` on all modules, live Chromium runs against a real demo app on `http://127.0.0.1:3456`, require-graph resolution, and direct reproduction of failing auth flows.

## Rating

**9.2 / 10** — excellent architecture and breadth. The engine (perception, gaze, patience, parallel protocols, adaptive exploration, secret redaction, artifact/report pipeline) is coherent and production-minded. The only confirmed functional defect was authentication submit selection + post-login wait timing; both are fixed and re-verified live.

## Verdict before fixes

| Check | Result |
|---|---|
| Syntax (`node --check` × 31 files) | PASS |
| Internal `require('./…')` graph | PASS (0 missing) |
| Module load of every export | PASS |
| `npm run observe` against live demo | PASS (with Playwright OS deps) |
| `npm run auto --mode quick/standard` | PASS quality 100, but **auth always failed** |
| Positional URL `node usereye-observe.js http://…` | FAIL (docs/`npm run observe -- <url>` implied it) |

## Confirmed bugs (reproduced with instruments)

### 1. Auth submit clicked the wrong control (functional)

**Evidence**

- Live SPA login at `/#login` has three “auth-ish” controls: `#nav-login` (link “Entrar”), `#login-submit` (button type=submit “Entrar”), `#login-cancel`.
- `collectActionCandidates()` classified **all three** as `kind: 'auth'` because `/login/` matched the id `login-cancel`, and `/entrar/` matched the nav link.
- `_attemptAuthentication` used `candidates.find(c => c.kind === 'auth')`, which returned **`#nav-login` first**.
- Result in `artifacts/auto-live-standard` **before** fix:  
  `auth.succeeded: false`, `reason: 'authentication-did-not-transition'`, only 3 states / 3 URLs.

**Fix**

- `adaptive-browser.js` — name-first auth detection; utility/cancel excluded; submit buttons get higher priority than nav links sharing the same label.
- `adaptive-explorer.js` — new `_pickAuthSubmit()` ranks real submits (`type=submit` / `button` + write) over anchors.

### 2. Post-login transition raced `waitForQuiet` (functional)

**Evidence**

- After clicking the **correct** `#login-submit`, manual fill+click reached `/#vault` successfully.
- Explorer still reported failure: demo delays navigation with `setTimeout(..., 400)` after showing a toast. `waitForQuiet` resolved during that quiet gap and captured the login page again.

**Fix**

- `adaptive-explorer.js` — `_waitForAuthTransition()` + `_liveAuthSignals()` wait up to ~2.5s for URL/state change or disappearance of the password form before capturing the post-auth state.

### 3. Observe CLI rejected positional URLs (DX / docs mismatch)

**Evidence**

- `CHANGES.md` documented `npm run observe -- <target-url>`.
- `usereye-observe.js` only accepted `--url`.
- `node usereye-observe.js http://127.0.0.1:3456` exited 2.

**Fix**

- `usereye-observe.js` accepts `--url` **or** a positional `http(s)://…` argument.

## What was NOT changed (intentionally)

- No drive-by refactors.
- No rewrite of perception/gaze/patience/protocols/report pipelines.
- Path `.replace(/\\/g, '/')` left as-is: Node source `/\\/g` correctly matches a single Windows backslash (verified with a Node harness).
- Demo app under `/home/user/demo-app` is a **test fixture only** (not part of your library zip root beyond reference).

## Live verification after fixes

```
observe: PASS — first impression, axe, patience 92, CTA “Começar agora”
auto standard:
  Quality 100/100
  States 7 · URLs 4  (was 3 / 3)
  Coverage 74% (meta 65%)  (was ~65% on the edge)
  Protocols 26 · failures 0
  auth.succeeded: true · reason: authenticated
  Issues: 2 minor axe findings on the demo page (not tool bugs)
```

## Files created or edited

| File | Action | Meaning |
|---|---|---|
| `adaptive-browser.js` | **edited** `collectActionCandidates` | Browser-side candidate harvest run via `page.evaluate`. Now ranks real auth submits above nav clones and stops tagging cancel buttons as auth. |
| `adaptive-explorer.js` | **edited** auth flow | Node-side adaptive crawler. Added `_pickAuthSubmit`, `_waitForAuthTransition`, `_liveAuthSignals`; `_attemptAuthentication` uses them. |
| `usereye-observe.js` | **edited** CLI argv | Single-page observation entry (`npm run observe`). Accepts positional URL. |
| `WHAT-CHANGED.md` | **created** | This document. |
| `CHANGES.md` | **edited** | Corrected run instructions to match real CLI flags. |

## Function reference (created or edited only)

### `adaptive-browser.js` → `collectActionCandidates()` (edited)

Runs inside the page. Walks visible interactive elements (incl. shadow DOM), labels them (`dangerous` / `auth` / `write` / `navigation` / `utility` / `control`), and sorts by priority.  
**Change:** auth detection is name-first; `type=submit` auth controls get +25 priority; anchors with the same label get −15; cancel/close stay `utility`.

### `adaptive-explorer.js` → `_pickAuthSubmit(candidates)` (**new**)

Chooses the credential-submit control from a state candidate list. Scores `type=submit` ≫ `button` ≫ other, penalizes anchors and cancel-like names.

### `adaptive-explorer.js` → `_liveAuthSignals()` (**new**)

`page.evaluate` snapshot: current URL, visible password inputs, and whether the visible text still looks like a login screen.

### `adaptive-explorer.js` → `_waitForAuthTransition(beforeUrl, beforeHash, timeoutMs)` (**new**)

Polls after an auth click until the URL changes, the material state hash changes away from a login-looking page, or password fields disappear (default 2500 ms).

### `adaptive-explorer.js` → `_attemptAuthentication(node, depth)` (edited)

Fills identity + password from credentials, clicks `_pickAuthSubmit`, waits for transition, captures post-auth state, sets `auth.succeeded` / `auth.reason`.

### `usereye-observe.js` → `main()` (edited)

Resolves target URL from `--url` or first positional `http(s)` argv entry before launching UserEye.

## How to run (verified)

```bash
npm install
npx playwright install chromium
# OS libs once per machine:
npx playwright install-deps chromium

# Single-page first impression
npm run observe -- --url http://127.0.0.1:3456 --axe
# or
npm run observe -- http://127.0.0.1:3456 --axe

# Adaptive exploration of a project / URL
npm run auto -- --project /path/to/app --url http://127.0.0.1:3456 \
  --mode standard --email user@example.test --password 'secret' --allow-write
```

## Unchanged public surface

`UserEye` class API, protocol registry, report HTML/MD writers, patience model, gaze/human collectors, project adapter, parallel scheduler, code-quality analyzer — all behaviorally unchanged aside from the auth candidate inputs they already consumed.

# What changed in this build

This is a **cleaned** copy of the original `SecureVault-UserEye` (UserEye 6.1) project.
No functional code was modified or rewritten — only non-functional files and tests
were removed, and the `package.json` scripts were trimmed to the working entry points.

## Removed (not functional code / tests)
- **Tests (8 files):** `test-code-quality.js`, `test-gaze.js`, `test-human.js`,
  `test-protocols.js`, `test-universal.js`, `test-usereye.js`, `test-v5-compat.js`,
  and `run-securevault-e2e.js` (the `npm test` e2e harness).
- **Output / data (`artifacts/`):** 112 JSON, 53 JPG, 7 ZIP traces, logs, HTML and
  webm files generated by previous runs.
- **Test fixtures (`fixtures/`):** the `universal-app` demo server used only by tests.
- **Docs:** `README.md`, `TODO-24.md`, `remediation.md`.
- **Lint/format config:** `eslint.config.js`, `.prettierrc.json`, `.prettierignore`.

## Kept (main components of the app)
- **Core engine:** `user-eye.js` (the `UserEye` class — package `main`).
- **Browser-side collectors** (run via `page.evaluate`):
  `browser-gaze.js`, `browser-human.js`, `browser-perception.js`,
  `browser-recorder.js`, `browser-vitals.js`, `adaptive-browser.js`.
- **Node-side logic:** `adaptive-explorer.js`, `artifact-store.js`, `code-quality.js`,
  `misclick-engine.js`, `parallel-scheduler.js`, `patience.js`, `perception.js`,
  `project-adapter.js`, `protocol-runner.js`, `report.js`, `run-diff.js`,
  `user-gaze.js`, `user-human.js`, `user-plan.js`, `v5-compat.js`.
- **Protocols (`protocols/`):** `browser.js`, `experience.js`, `file.js`, `helpers.js`,
  `human.js`, `input.js`, `network.js`.
- **CLI entry points:** `usereye-observe.js` (`npm run observe`) and
  `usereye-auto.js` (`npm run auto`).
- **Install config:** `package.json` (scripts trimmed to `observe`/`auto`) +
  `package-lock.json`.

## Verification (no guessing — checked with tools)
- `node --check` passed on all 31 `.js` files (no syntax errors).
- A script confirmed every internal `require('./...')` resolves to a file that
  still exists in this folder.

## How to run
```
npm install
npx playwright install chromium
# (first machine only) npx playwright install-deps chromium

npm run observe -- --url http://127.0.0.1:3000 --axe
# positional URL also works:
npm run observe -- http://127.0.0.1:3000 --axe

npm run auto -- --project <path-to-web-app> --url http://127.0.0.1:3000 --mode standard
# with disposable credentials when the app has a login wall:
#   --email user@example.test --password 'secret' --allow-write
```

See `WHAT-CHANGED.md` for the instrumented fix log (auth submit ranking + post-login wait + observe CLI).
