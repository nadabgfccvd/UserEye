# Contributing to UserEye

Thanks for helping make UserEye better! This guide keeps contributions predictable for everyone.

## Ground rules

1. **Additive changes only.** The public contract is stable: the `UserEye` class API, the
   `usereye auto|observe` CLIs, exit codes (`0` pass / `1` quality gates failed / `2` usage or
   setup error) and the `result.json` schema (`schemaVersion: 4`). If a change must break
   something, open an issue first and label the proposal `breaking`.
2. **Do not rewrite the exploration/perception engine.** Improve it in place; big-bang rewrites
   are out of scope.
3. **Every fix ships with a test.** Browser behaviour goes into `tests/engine.test.js` or
   `tests/multi-browser.test.js`; pure logic into the jsdom suites or `tests/pure-logic.test.js`;
   regressions into `tests/regressions.test.js`.
4. **Run the full gate before opening a PR:** `npm run verify` (lint + format + typecheck +
   tests + consistency checks + coverage gate).

## Development setup

```bash
npm ci                              # dependencies (playwright is pinned exactly)
npx playwright install chromium     # engine tests need at least chromium
sudo npx playwright install-deps chromium   # Linux only, first time
npm test                            # full suite (~40 s with a browser present)
```

Useful variants:

| Command                                 | What it does                                                                        |
| --------------------------------------- | ----------------------------------------------------------------------------------- |
| `npm run test:engine`                   | Engine integration + multi-browser tests only                                       |
| `npm run test:coverage`                 | Suite with the coverage gate (core ≥ 70 %, engine ≥ 40 %, per-file `HONEST_FLOORS`) |
| `npm run test:benchmark`                | Quick-mode perf run vs. `tests/benchmarks/` baseline                                |
| `npm run checks`                        | Version/API/README/Playwright/package consistency checks                            |
| `USEREYE_SKIP_BROWSER_TESTS=1 npm test` | Headless-CI mode: browser tests skip                                                |

## Architecture in one paragraph

`bin/usereye.js` parses flags into `config.js`, which layers defaults < `usereye.config.js` <
env < CLI. `usereye-auto.js` / `usereye-observe.js` drive `user-eye.js` (the `UserEye` engine:
steps, actions, observations, secrets, retries, timeouts) and `adaptive-explorer.js` (state
graph, page classification, budget modes `quick|standard|deep`), with parallel protocols from
`protocol-runner.js` + `protocols/*`. Perception runs **inside the page** (`browser-*.js`,
`perception.js`, `user-*.js`), artifacts and teardown live in `artifact-store.js`, and
`report.js`/`sarif.js` render results. `dashboard.js` and `issue-export.js` are post-run tools.
Everything public is re-exported from `index.js` and declared in `types/index.d.ts`
(generated from JSDoc — keep the JSDoc accurate).

## Style

- Prettier decides formatting (`npm run format`); ESLint flat config catches real defects.
  Both run in CI — please keep `npm run lint` and `npm run format:check` clean.
- CommonJS for library code; `.mjs` only in tests/examples.
- JSDoc types on exported functions — `npm run typecheck` compiles `types/` with `tsc`.

## Adding features

- **New CLI flag:** add it to `VALUE_FLAGS`/`BOOLEAN_FLAGS` + `cliConfig` in `config.js`,
  document it in `README.md` (the README examples are compiled by CI), and cover it in
  `tests/config.test.js` or `tests/regressions.test.js`.
- **New pattern pack:** add `patterns/<locale>.json` with every category the other packs have
  (`tests/patterns-i18n.test.js` enforces parity and independence).
- **New protocol:** add it under `protocols/`, register it, and extend the dry-run plan tests —
  `buildExecutionPlan` must stay browser-free.
- **New plugin capability:** document it in `docs/PLUGINS.md` and extend
  `examples/plugins/run-logger.js` or `tests/plugins-example.test.js`.

## Benchmarks

`tests/benchmark.test.js` fails when a quick-mode run against the static fixture regresses more
than **+50 %** versus `tests/benchmarks/quick-baseline.json`. If your change intentionally
alters performance, re-record on a quiet machine:

```bash
USEREYE_UPDATE_BASELINE=1 npm run test:benchmark
```

and include the new baseline file plus a one-line justification in the PR.

## Releases

Releases use [changesets](https://github.com/changesets/changesets) — see `.changeset/README.md`.
Summary: add a changeset with your PR (`npm run changeset`), maintainers run
`npm run version-packages`, and `publish.yml` publishes to npm **with provenance** and builds
the pinned Docker image on tags. `scripts/sync-version.js` guarantees the documented version,
`package.json`, the Docker tag and the lockfile never drift apart.

## Reporting issues

Use the templates: **Bug report** (include `result.json` excerpt + artifacts; secrets are
redacted so it is safe to attach) or **Feature request**. For anything security-sensitive,
follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

Be kind, be concrete, and remember every report is a gift — even the ones that turn out to be
"works on my machine".
