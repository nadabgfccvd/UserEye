# Operação do bundle (install, ports, pack)

**Créditos:** Revisor Anônimo

Fusão de CURRENT.md, DELIVERY.md e README da raiz do zip. Os três ficheiros da raiz do zip mantêm-se como ponteiros curtos para os gates de empacotamento.

## Índice de origens

1. `CURRENT.md` — CURRENT — começar aqui
2. `DELIVERY.md` — DELIVERY — inventário e runbook
3. `README.md` — README do bundle

---

## CURRENT — começar aqui

<!-- origem: CURRENT.md -->

## UserEye 7.5.1 — start here

**Version:** 7.5.1 · single source of truth: `UserEye/package.json` (also `usereye --version`)
**License / runtime:** MIT · Node >= 20.11 · Playwright 1.63.0 (pinned, checked in CI)
**Tests:** 446 total · 443 pass · 0 fail · 3 skipped (firefox not installed; webkit not installed; tree is dirty)
**Rating:** 9.3 / 10 — latest independent audit, 2026-09-06 → [`docs/audits/`](docs/audits/)

> The `**Tests:**` line is **written by `npm run verify:delivery` from a real run**, never
> typed. Skips are environment-dependent (firefox/webkit absent, dirty tree); `fail` 0.

### What changed in 7.5.1

The 7.5.0 zip **failed its own gates** (a hand-bolded `**4 skipped**` broke the
`**Tests:**` regex; `DELIVERY.md` quoted the 7.4.1 count). Fixed in the docs **and** the
process: `verify:delivery` rewrites them from a real run; the packaging gate rejects
edited counts. The same line carries roadmap Fases 1–3 — measurement honesty (attributed
coverage, run-diff/auth/misclick tests), artifact economy (`trace` policy,
`report.embedLimit`, `keepLast`, `artifacts.totalBytes`), URL-only `--url` (pass
`--project` to opt back in), complete es/fr catalogs, localized steps/gates,
`observe --fail-on`, shell-free Windows `install-browsers`. See `UserEye/HISTORY.md`.

### What changed in 7.5.0

**The code-execution boundary.** `usereye auto --project .` executes nothing from the
target repo unless you pass `--allow-project-commands …`; `shell: true` is gone; every
executed/blocked command lands in `result.json#commandAudit`. Plus Core Web Vitals,
`--log-level`/`--log-json`/`--timings`, `usereye doctor`, Node matrix 20/22/24 — the
contract `0 | 1 | 2` is unchanged.

### 60-second quick start

```bash
cd UserEye && npm ci && npx playwright install chromium   # bare Linux: + sudo npx playwright install-deps chromium
node bin/usereye.js doctor && npm test                    # npm run verify adds lint/format/types/checks/coverage
node ../demo/live-server.js                               # terminal 2 -> http://127.0.0.1:4200, demo at /vela/
node bin/usereye.js auto --url http://127.0.0.1:4200/vela/ --mode quick
```

Next: [`DELIVERY.md`](DELIVERY.md) (inventory, runbook) · [`UserEye/README.md`](UserEye/README.md) (manual) · [`UserEye/HISTORY.md`](UserEye/HISTORY.md) · [`docs/audits/`](docs/audits/)

## DELIVERY — inventário e runbook

<!-- origem: DELIVERY.md -->

## DELIVERY — what is in this zip, and how to run it

**Package:** `usereye` **7.5.1** · zip name is generated from `UserEye/package.json`
(`usereye-7.5.1-balanced.zip`) — never hand-typed.
**Tests:** 446 total · 443 pass · 0 fail · 3 skipped (firefox not installed; webkit not installed; tree is dirty)
**Verified on:** Debian 13 · Node v20.20.2 · npm 10.8.2 · Playwright 1.63.0
(Chrome Headless Shell 153.0.8010.12)

Start with [`CURRENT.md`](CURRENT.md) if you only read one file. This file is the
inventory and the runbook.

> **Latest review:** [`docs/audits/2026-09-07-arena-review-and-fix.md`](docs/audits/2026-09-07-arena-review-and-fix.md)
> — independent re-verification on a clean checkout, and the three fixes it produced:
> `verify-release.js` now SKIPs instead of failing when a pack was made outside a git checkout
> (the state every recipient of this zip is in); and the **review modes** — which shipped with
> no tests at all — no longer discard the path of `--url` (they were auditing the origin root)
> and no longer exit silently. New gate: `tests/review-modes.test.js`.
> Rating: 8.9 / 10 as received, 9.4 / 10 after the fixes.

---

### 1. Layout — one generated top-level folder, one version, no stale labels

`unzip -l usereye-7.5.1-balanced.zip` shows exactly one nesting level, and its name is
generated from `UserEye/package.json` by `npm run pack:delivery` — never hand-typed:

```text
usereye-7.5.1-balanced/     <- generated from package.json; the ONLY nesting level
├── CURRENT.md              <- start here: version, rating, quick start
├── DELIVERY.md             <- this file
├── README.md               <- delivery index
├── DELIVERY-MANIFEST.json  <- version, git sha, test summary, file count, sha256
├── UserEye/                <- THE npm package (runtime, tests, CI, types, docs)
├── demo/                   <- harness: demo site + servers + probes (NOT published)
│   ├── live-server.js      <- serves /vela/ and the delivery docs
│   ├── verify-server.js    <- audit-only static server for evidence folders
│   ├── vela-site/          <- Vela Analytics: 9 pages, modals, tabs, charts, forms
│   └── probes/             <- probe-site.js, probe-zoom.js, results-server.js
└── docs/                   <- delivery documentation (NOT published)
    ├── audits/             <- every historical audit / verification report, dated
    ├── evidence/           <- thin text evidence from the 7.4.0 localization runs
    ├── history/            <- superseded change reports + the previous release patch
    └── ROADMAP-*.md        <- the roadmaps, incl. the one 7.5.0 implements
```

So `UserEye/package.json` is reachable at `usereye-7.5.1-balanced/UserEye/package.json`,
and the folder name, the zip name, `package.json`, `CURRENT.md`, `DELIVERY.md` and
`usereye --version` all state the same number.

The previous bundle nested two identically-named folders labelled with a superseded
release around a `package.json` that already declared a newer one. `UserEye/scripts/
check-delivery-names.js` now fails the release if that ever comes back: it rejects a
superseded generation in any path or in the docs that claim to be current, rejects a
version-named wrapper that disagrees with `package.json`, and rejects version
disagreement between `package.json`, the CLI, `CURRENT.md` and `DELIVERY.md`.

### 2. npm package vs. delivery harness

|                | Published by `npm pack`                                                                                                                   | Delivery only                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **Where**      | `UserEye/`                                                                                                                                | `demo/`, `docs/`, root `*.md`                                 |
| **What**       | runtime `*.js`, `bin/`, `protocols/`, `patterns/`, `locales/`, `types/`, `action.yml`, `Dockerfile`, `README.md`, `HISTORY.md`, `LICENSE` | demo site, static servers, probes, audits, evidence, roadmaps |
| **Guarded by** | `scripts/check-package.js` (forbidden/required lists + size ceiling)                                                                      | `scripts/check-delivery-names.js`                             |

`tests/`, `scripts/`, `examples/`, `.github/`, `.changeset/` ship in the **zip** (so the
suite is runnable) but are excluded from the **npm package** by the `files` whitelist.

> **Not published to npm yet.** There is no public GitHub remote and no npm registry entry
> (both verified 404 on 2026-09-06), so `package.json` declares no `repository` /
> `homepage` / `bugs` at all rather than pointing at a dead org. The package stays
> publishable (`"private": false`); install it from the directory or a tarball — see
> `UserEye/README.md` → **Install**.

### 3. Install and verify

```bash
cd UserEye
npm ci
npx playwright install chromium
sudo npx playwright install-deps chromium    # bare Linux only; CI images already have them
npm test                                     # 433 tests (browser suites skip without engines)
npm run verify                               # lint + format + typecheck + tests + checks + coverage
```

### 4. Run it live against the demo site

**Ports:** `4200` demo/docs server · `3000` standalone Vela server · `5000` evidence server.
All three read `PORT` from the environment.

```bash
## terminal 1 — from the delivery root
node demo/live-server.js                     # http://127.0.0.1:4200  (demo at /vela/)

## terminal 2 — from UserEye/
node bin/usereye.js auto    --url http://127.0.0.1:4200/vela/ --mode quick --out artifacts/vela-quick
node bin/usereye.js observe        http://127.0.0.1:4200/vela/ --axe --report-locale pt --out artifacts/vela-observe
node bin/usereye.js analyze --project ../demo/vela-site --dry-run          # plan only, no browser
VELA_BASE=http://127.0.0.1:4200/vela node ../demo/probes/probe-site.js     # 29 checks against /vela/
```

Bare `auto` needs **no config file** since 7.4.1: video is kept only on failure, misclick
uses the `stable-only` policy, and the report lists medium+ confidence findings. Add
`--video --misclick-policy aggressive` for the pre-7.4.1 forensic profile.

### 5. Commands (7.4+)

```text
usereye auto [options]        explore a URL or a repository; write evidence + gates
usereye observe [url]         single-page observation (fast, --axe for a11y)
usereye analyze [options]     detection + plan.json only (--dry-run)
usereye init [dir] [--workflow] [--no-gitignore]
                              scaffold usereye.config.js (+ git-ignore, + CI workflow)
usereye auth save --url <app> --out .auth/user.json [--headed]
                              log in once (2FA/SSO friendly) and reuse in CI
usereye dashboard [run-dir] [--port <n>]
usereye export-issues <result.json|dir> --format github|jira|linear
usereye install-browsers [chromium|firefox|webkit|all]
usereye --version
```

New in 7.5.0: `--allow-project-commands <categories>` (the code-execution boundary —
without it, project mode is static-only), `--log-level`, `--log-json`, `--timings`, and
the `usereye doctor` command. Carried over from 7.4.1: `--video`,
`--video-on-failure`, `--misclick-policy stable-only|aggressive`.

### 6. CI one-liners

**GitHub Action** (`UserEye/action.yml`, composite, v2). Calm defaults are built in —
`video: on-failure` and `misclick-policy: stable-only` — so the minimal form is enough:

```yaml
- uses: <your-org>/usereye@v7
  with:
    url: http://127.0.0.1:3000
    mode: standard
    soft-fail: 'true' # first sprint: report on the PR without failing the job
```

Gradual adoption: start with `soft-fail: 'true'`, read the job summary
(`Actionable / Review / Signals`), then flip it to `'false'`. For a forensic run use
`video: always` and `misclick-policy: aggressive`. The Action is not yet published to a
public repository — until it is, `usereye init --workflow` generates the equivalent
plain-CLI workflow, which runs anywhere today.

**Docker** (`UserEye/Dockerfile`, base image pinned to the exact Playwright version):

```bash
cd UserEye
docker build -t usereye:7.5.1 .
docker run --rm -v "$PWD/artifacts:/work/artifacts" usereye:7.5.1 \
  auto --url http://host.docker.internal:4200/vela/ --mode quick --out artifacts/docker-quick
```

### 7. Reproducing this zip

```bash
cd UserEye
npm run verify:delivery    # -> runs the suite, writes the REAL summary into CURRENT.md,
                           #    DELIVERY.md, DELIVERY-MANIFEST.json and the tarball name
                           #    in UserEye/README.md — commit the result
npm run pack:delivery      # -> ../dist/usereye-7.5.1-balanced.zip + DELIVERY-MANIFEST.json
npm run pack:npm           # -> the publishable tarball only (files whitelist)
npm run verify:release     # -> grades the zip that was just built (see below)
npm run release            # -> verify + verify:delivery + pack:delivery + verify:release
```

**Why `verify:delivery` exists (7.5.1).** The 7.5.0 zip shipped a `CURRENT.md` whose
`**Tests:**` line had been hand-bolded and a `DELIVERY.md` still quoting the 7.4.1 count
(286 against a 327-test suite), so `npm test` and `npm run checks` failed on a clean
checkout of the box. Both numbers are now a _consequence_ of the run: `verify:delivery`
refreshes them, and `tests/packaging.test.js` rejects markdown inside the numbers, a
total that does not equal pass + fail + skipped, two docs that disagree with each other,
or docs that disagree with the manifest. Hand-editing that line is no longer possible
without a red suite.

`npm run verify` proves the **source** is good; it cannot prove the **artifact** is.
An earlier bundle passed its own suite while shipping a zip labelled with a superseded
release around a package that already declared a newer one, and 7.5.0 first shipped a
byte-valid archive whose directories extracted with mode 000 — then shipped delivery docs
that failed the suite. All three defects live in the gap between "the code works" and "the box works", so
`scripts/verify-release.js` extracts the box and grades that:

- archive integrity, using the same dependency-free reader as the writer — every entry's
  CRC-32 and length verified, every Unix mode checked, no absolute paths, no `..`
  traversal, no symlink entries, exactly one top-level folder;
- manifest honesty — `fileCount` / `bytes` recomputed from the archive, `contentsSha256`
  recomputed from the extracted bytes, the side manifest's `zipSha256` compared against
  the real file, and `zipSha256` asserted absent from the copy inside the archive;
- the §6 acceptance list and §10 definition of done from
  `docs/ROADMAP-PACKAGING-AND-DEFAULTS.md`, evaluated against the extracted tree — version
  agreement, layout, calm defaults read from the extracted `config.js`, the shipped
  `.d.ts` compiled with `tsc`, and live runs of the **extracted** CLI against the
  **extracted** `demo/live-server.js` for both the calm and the loud profile;
- exit codes `0 | 1 | 2`.

Sections needing a browser or an installed dependency tree **SKIP with a reason** rather
than fail or silently pass, so a gate that could not run never reports green.

`pack:delivery` runs preflight first: it fails if the version in `package.json`,
`CURRENT.md` and `DELIVERY.md` disagree, if a superseded generation appears in a path or
in the delivery docs, or if the test suite is not green. It then writes the real test
summary into the `**Tests:**` line of both docs (so the shipped numbers cannot be stale),
stages the bundle without `node_modules` / `.git` / `artifacts` / `.webm` / tarballs, and
emits the manifest.

The archive is deterministic: entries are sorted, entry timestamps are fixed
(`SOURCE_DATE_EPOCH` honoured, otherwise 2020-01-01), and the manifest's `generatedAt` is
taken from the commit's committer date whenever the tree is clean. So **the same commit
packs to the same bytes** — `zipSha256` identifies a release instead of recording the
moment someone happened to run a script. A dirty tree has no commit to derive a time from
and falls back to the wall clock; reproducibility is then not claimed, and `git.dirty: true`
in the manifest says so.

`contentsSha256` covers the staged files but excludes the manifest, which would otherwise
have to hash itself. A zip cannot contain its own hash either, so `zipSha256` lives in the
manifest copy **beside** the archive in `dist/`; the copy inside the zip carries everything
else.

### 8. What is deliberately NOT in this bundle

`evidence/` dumps (~18 MB of screenshots, traces, `.webm`, run JSON), `UserEye/artifacts/`,
`UserEye/live-runs/`, `node_modules/`. The thin text evidence from the 7.4.0 localization
fix is kept under `docs/evidence/`. Regenerate any of it with the commands in §4.

## README do bundle

<!-- origem: README.md -->

## UserEye 7.5.1 — delivery bundle

**Start here → [`CURRENT.md`](CURRENT.md).**

This zip contains the `usereye` npm package (7.5.1), a demo site to run it against, and
the delivery documentation. One version number, one folder level, one "current" doc.

| Read this                                              | For                                                               |
| ------------------------------------------------------ | ----------------------------------------------------------------- |
| [`CURRENT.md`](CURRENT.md)                             | Version, rating, test status, what changed, 60-second quick start |
| [`DELIVERY.md`](DELIVERY.md)                           | Full inventory, ports, commands, CI/Docker one-liners, repacking  |
| [`UserEye/README.md`](UserEye/README.md)               | The product manual (see **Defaults** for the calm profile)        |
| [`UserEye/CLI_REFERENCE.md`](UserEye/CLI_REFERENCE.md) | Every command, flag, example and expected output                  |
| [`UserEye/ARCHITECTURE.md`](UserEye/ARCHITECTURE.md)   | File tree, dependencies, internal execution flow                  |
| [`UserEye/CHANGELOG.md`](UserEye/CHANGELOG.md)         | Version history (credits: Revisor Anônimo)                        |
| [`UserEye/HISTORY.md`](UserEye/HISTORY.md)             | Packaging-gated mirror of the changelog                           |
| [`docs/audits/`](docs/audits/)                         | Historical audits and verification reports, newest first          |
| [`docs/`](docs/)                                       | Roadmaps (incl. `ROADMAP-USEREYE-7.5.0.md`) and execution reports |

```text
UserEye/   the npm package — runtime, tests, CI, types, action.yml, Dockerfile
demo/      harness, not published — Vela demo site, live-server.js, verify-server.js, probes/
docs/      delivery docs, not published — audits/, evidence/, history/, roadmaps
```

Quick start:

```bash
cd UserEye && npm ci && npx playwright install chromium && npm test
node ../demo/live-server.js                                  # terminal 2 -> :4200, demo at /vela/
node bin/usereye.js auto --url http://127.0.0.1:4200/vela/ --mode quick
```

MIT licensed. Requires Node.js >= 20.11. The package is not published to npm yet — install
it from this directory or from `npm run pack:npm` (details in `UserEye/README.md`).
