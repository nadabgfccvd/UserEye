# Auditorias, evidências e relatórios históricos

**Créditos:** Revisor Anônimo

Fusão de docs/audits, docs/history e docs/evidence. Relatórios independentes em ordem de ficheiro.

## Índice de origens

1. `docs/audits/2026-09-05-audit-7.1.0-fix-report.md` — 2026-09-05-audit-7.1.0-fix-report
2. `docs/audits/2026-09-05-independent-audit-and-fixes.md` — 2026-09-05-independent-audit-and-fixes
3. `docs/audits/2026-09-05-vela-live-test-7.1.0.md` — 2026-09-05-vela-live-test-7.1.0
4. `docs/audits/2026-09-05-verification-7.0.0-audit-fixed.md` — 2026-09-05-verification-7.0.0-audit-fixed
5. `docs/audits/2026-09-06-audit-7.4.0-second-independent.md` — 2026-09-06-audit-7.4.0-second-independent
6. `docs/audits/2026-09-06-extension-runs-7.4-summary.md` — 2026-09-06-extension-runs-7.4-summary
7. `docs/audits/2026-09-06-independent-verification-7.4.1.md` — 2026-09-06-independent-verification-7.4.1
8. `docs/audits/2026-09-06-remediation-r1-r2-r3-r6.md` — 2026-09-06-remediation-r1-r2-r3-r6
9. `docs/audits/2026-09-06-verification-report-7.4.0.md` — 2026-09-06-verification-report-7.4.0
10. `docs/audits/2026-09-07-arena-review-and-fix.md` — 2026-09-07-arena-review-and-fix
11. `docs/history/2026-09-05-audit-fix-report-7.0.0.md` — 2026-09-05-audit-fix-report-7.0.0
12. `docs/history/2026-09-05-implementation-report-7.0.0.md` — 2026-09-05-implementation-report-7.0.0
13. `docs/evidence/after-en-report.md` — after-en-report
14. `docs/evidence/after-pt-report.md` — after-pt-report
15. `docs/evidence/before-pt-report.md` — before-pt-report

---

## 2026-09-05-audit-7.1.0-fix-report

<!-- origem: docs/audits/2026-09-05-audit-7.1.0-fix-report.md -->

## UserEye 7.1.0 — Independent Audit, Fix Report & Function Guide

**Date:** 2026-09-05
**Package audited:** `UserEye-7.1.0-ROADMAP-COMPLETE-VERIFIED.zip`
**Environment:** Node v20.20.2 · npm 10.8.2 · Playwright 1.63.0 (Chrome Headless Shell 153.0.8010.12) · Linux sandbox
**Method:** **Instrumented verification only. Nothing was guessed.** Every statement below is the
output of actually executing your code — `node --check`, `npm run verify`, and live CLI runs of
`usereye auto` against your own fixture servers with a real Chromium.

---

### 1. Bottom line

**Your project is in excellent shape — but it was NOT bug-free.**

The previous `CHANGES.md` in the archive claimed _"Your project is not broken"_ and rated it 9.3/10.
That conclusion was **wrong on one important point**: the single most common code path in the whole
tool — _a successful `usereye auto` run_ — was broken.

I found and fixed **one real, reproducible, high-severity bug** that the shipped test suite did not
cover. It is fixed, proven by a revert-test, and the entire verification pipeline is green.

**My rating: 9.0 / 10** (breakdown in §6). It would be 9.5 with the bug never present; the deduction
is for a critical happy path shipping untested in a release labelled `VERIFIED`.

---

### 2. What was verified, and with which instrument

| Check                                     | Instrument                                     | Result                                                                              |
| ----------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| Syntax of all 72 first-party JS files     | `node --check` on each                         | **PASS**                                                                            |
| Unit/integration suite (no browser)       | `npm test`                                     | 144 tests, **133 pass / 0 fail**, 11 skipped                                        |
| Unit/integration suite (real Chromium)    | `npx playwright install chromium` + `npm test` | **142 pass / 0 fail**, 2 skipped (firefox/webkit)                                   |
| Lint                                      | `npm run lint` (eslint 10)                     | **PASS**, zero warnings                                                             |
| Formatting                                | `npm run format:check` (prettier)              | **PASS**                                                                            |
| Types                                     | `npm run typecheck` (`tsc --noEmit`)           | **PASS**                                                                            |
| Repo checks                               | `npm run checks`                               | **PASS** (version sync, API surface, README examples, Playwright pin, package size) |
| Coverage gates                            | `npm run test:coverage`                        | **PASS** — all floors satisfied (overall 55.31% vs floor 45%)                       |
| Full pipeline                             | `npm run verify`                               | **PASS** — 146 tests, **144 pass / 0 fail** after my fix + new tests                |
| `auto` on static fixture (quick)          | live run, real browser                         | **FAIL before fix → PASS after fix** (§3)                                           |
| `auto` on SPA fixture + `--min-score 100` | live run                                       | **PASS** — gates FAIL, exit **1** (correct)                                         |
| `auto` on english fixture (standard)      | live run                                       | **PASS** — score 83, exit 1, full artifacts                                         |
| Startup-failure path (django stub)        | live run                                       | **PASS** — exit **2** + `startup-error.json`                                        |
| Invalid CLI flag                          | live run                                       | **PASS** — exit **2** with clear message                                            |
| Exit-code contract 0 / 1 / 2              | all runs above                                 | **PASS** (after fix)                                                                |
| Dashboard HTTP server                     | live server + `curl`                           | **PASS** — HTTP 200, all 3 runs listed                                              |
| Package integrity                         | `npm pack` via `check-package.js`              | **PASS** — 58 files, 119.1 kB packed                                                |

---

### 3. THE BUG — successful `auto` runs exited 2 and produced no report

**Severity: high.** This affected _every successful run_ of your flagship command.

#### Symptom (reproduced live, before any edit)

```text
$ node bin/usereye.js auto --project tests/fixtures/static --mode quick --out /tmp/run1
Project: static · stack: Static HTML · confidence: 95%
Application ready: http://127.0.0.1:45933/
[PASS] 01 Open target application (159 ms)
[PASS] 02 Adaptive exploration — quick (2777 ms)
[PASS] 03 Concurrent protocols — quick (1236 ms)
[PASS] 04 Code quality and final quality floor (0 ms)
$ echo $?
2
```

All four steps **PASS**, yet the process exited **2** — your documented code for a _setup/usage
failure_. Worse, the output directory contained a bogus `startup-error.json` and was **missing
`result.json`, `report.md`, `report.html`, `usereye.sarif`, `recommendations.md`** — the actual
deliverables. In CI this means every green run is reported as a broken setup and no report is
published.

#### Root cause (found by reading the code, not guessing)

`usereye-auto.js` decided _"did the browser ever start?"_ by testing `eye.browser` **after** the
`finally` block had already called `eye.close()`.

But `closeEye()` in `artifact-store.js:123-128` deliberately nulls that field:

```js
async function closeEye(eye) {
  if (!eye.browser) return;
  const browser = eye.browser;
  eye.browser = null; // repeated close() calls become no-ops
```

So after a **successful** run `eye.browser` is always `null`, and this branch fired
unconditionally:

```js
if (!eye.browser) {                       // always true post-close
  fs.writeFileSync(path.join(artifactDir, 'startup-error.json'), …);
  return { exitCode: 2, … };              // success reported as setup failure
}
```

Two correct behaviours collided: `close()`'s idempotency guard and `auto`'s launch detection. The
bug is invisible in the dry-run/`analyze` tests (no browser) and in the startup-failure test (where
exit 2 _is_ correct), which is exactly why the suite missed it.

#### The fix — minimal, 3 lines of logic

In `usereye-auto.js`, track the launch explicitly instead of inferring it from mutable state:

```js
let browserVersion = '';
// `eye.close()` intentionally nulls `eye.browser` so repeated calls are
// no-ops, so it cannot be used after the finally block to decide whether the
// browser ever started. Track the successful launch explicitly instead.
let launched = false;
…
await eye.launch();
launched = true;
…
} catch (error) {
  fatal = error;
  if (launched) {            // was: if (eye.browser)
    eye.addIssue({ severity: 'blocker', title: 'Universal run interrupted', … });
…
if (!launched) {             // was: if (!eye.browser)
  fs.writeFileSync(path.join(artifactDir, 'startup-error.json'), …);
  return { exitCode: 2, … };
}
```

`launched` is set only after `await eye.launch()` resolves, so a launch that throws still leaves it
`false` and the genuine failure path is untouched.

#### Proof it works

```text
$ node bin/usereye.js auto --project tests/fixtures/static --mode quick --out /tmp/run2
[PASS] 01 … [PASS] 02 … [PASS] 03 … [PASS] 04 …

=== UserEye ===
Quality: 100/100 · states: 2 · URLs: 2
Coverage: 100% · protocols failed: 0
Issues: 0 · unexpected browser errors: 0
Quality gates: PASS
Artifacts: /tmp/run2
$ echo $?
0
```

`result.json`, `report.md`, `report.html` are now written; `startup-error.json` is gone.

#### Proof the other paths did NOT regress

| Scenario                                  | Expected                                        | Observed      |
| ----------------------------------------- | ----------------------------------------------- | ------------- |
| Static fixture, clean run                 | exit 0 + report                                 | **exit 0** ✅ |
| SPA fixture with `--min-score 100`        | exit 1, gates FAIL                              | **exit 1** ✅ |
| English fixture, standard mode (3 issues) | exit 1 + full artifacts                         | **exit 1** ✅ |
| Django stub (dies at startup)             | exit 2 + `startup-error.json`, no `result.json` | **exit 2** ✅ |
| Unknown flag `--dir`                      | exit 2                                          | **exit 2** ✅ |

---

### 4. Guardrail added — two regression tests

Appended to your existing `tests/regressions.test.js`, in the file's own style (reusing its
`tmpDir()` helper and the `browserReady()` skip-guard pattern copied from `tests/benchmark.test.js`,
so machines without Chromium skip rather than fail).

**Test 1 — `regression: a successful auto run exits 0 and writes a report, not startup-error.json`**
Runs `runAuto()` against the static fixture and asserts `exitCode === 0`, that `result.json` and
`report.md` exist, and that `startup-error.json` does **not**. This is the test that was missing.

**Test 2 — `regression: a genuine startup failure still exits 2 and writes startup-error.json`**
Runs the django stub and asserts `exitCode === 2`, `startup-error.json` exists, `result.json` does
not — locking the failure path so nobody "fixes" test 1 by deleting the branch.

#### Revert-test (proof the tests have teeth)

I reverted `if (!launched)` back to `if (!eye.browser)` and re-ran:

```text
not ok 8 - regression: a successful auto run exits 0 and writes a report, not startup-error.json
## pass 8
## fail 1
```

Restored the fix:

```text
## pass 9
## fail 0
```

The test fails on the buggy code and passes on the fixed code — it genuinely guards the behaviour.

---

### 5. Every function I created or edited — what it means

#### Edited: `usereye-auto.js` → `runUniversal()` (the `auto` command's engine)

The orchestrator behind `usereye auto`: detects the stack, boots the app, launches the browser, runs
the four steps (open → adaptive exploration → concurrent protocols → code quality), then writes
artifacts and returns the exit code.

- **`let launched = false;` (new local)** — a one-way latch meaning _"the browser really started"_.
  Needed because `eye.browser` is mutable state that `close()` resets, whereas `launched` records a
  historical fact that stays true. Immune to the ordering trap that caused the bug.
- **`launched = true;` after `await eye.launch()`** — placed _after_ the `await` so it only becomes
  true if the launch actually succeeded; a throwing launch leaves it `false`.
- **`if (launched)` in `catch`** — decides whether a mid-run crash is recorded as a _blocker issue_
  inside the report. Only meaningful if a browser existed to produce a report; semantics preserved,
  now read from the reliable flag.
- **`if (!launched)` after `finally`** — the startup-failure branch that writes `startup-error.json`
  and returns exit 2. Now fires **only** when the browser never started, which is what it always
  intended.

Nothing else in the function changed: no step, gate, artifact, score, or message was altered.

#### Created: two tests in `tests/regressions.test.js`

- **`browserReady()` (new local helper)** — returns whether Chromium is actually installed, by
  checking `fs.existsSync(playwright.chromium.executablePath())` and honouring
  `USEREYE_SKIP_BROWSER_TESTS=1`. Copied from your `tests/benchmark.test.js` so behaviour is
  consistent across the suite.
- **`skipBrowserRun` (new local constant)** — the `{ skip: … }` options object handed to
  `node:test` so the browser-dependent test reports as _skipped with a reason_ instead of failing on
  a machine with no browser.
- The two `test(...)` cases described in §4.

#### Files I did NOT touch

Verified with a full recursive `diff` against the original archive: **exactly two files differ** —
`usereye-auto.js` and `tests/regressions.test.js`. Your 70 other source files, configs, docs,
protocols, patterns, locales, types, and CI workflows are byte-identical. Your code was not broken
by this audit.

---

### 6. Rating — 9.0 / 10

| Dimension                 | Score | Notes                                                                                                   |
| ------------------------- | ----- | ------------------------------------------------------------------------------------------------------- |
| Architecture & modularity | 9.5   | Clean separation: engine (`user-eye.js`), artifacts, protocols, patterns, adapters. Good `exports` map. |
| Correctness               | 8.0   | One high-severity bug on the most common path, shipped in a build labelled `VERIFIED`.                  |
| Test suite                | 8.5   | 144 tests, real browser coverage, coverage gates — but missed the happy path of the flagship command.   |
| Tooling & CI hygiene      | 10    | lint + prettier + tsc + API-surface + README-example + version-sync + package-size gates. Exemplary.    |
| Documentation             | 9.5   | README, HISTORY, CONTRIBUTING, SECURITY, PLUGINS, roadmap, typed `.d.ts`.                               |
| DX & CLI design           | 9.5   | Clear help, disciplined exit codes, dry-run, matrix mode, plugins, SARIF, dashboard.                    |
| Honesty of self-reporting | 7.0   | The bundled `CHANGES.md` asserted "not broken" while a headline path was broken.                        |

**Strengths:** genuinely project-agnostic detection, a thoughtful safety model (no writes/destructive
actions/downloads by default), reproducible evidence (trace, video, screenshots, SARIF), and a
verification pipeline stricter than most commercial projects.

**Recommended next steps (not done — outside "fix what's broken"):**

1. Add an end-to-end CI job asserting `exit 0` on a clean fixture. The bug survived because CI only
   ever ran fixtures that legitimately exit 1.
2. Raise coverage on `browser-*.js` (0.8–1.6% today); they run in-page, so consider extending the
   jsdom harness in `tests/helpers/browser-env.js`.
3. Consider having `close()` keep a `this.launched` flag on the engine itself, so no caller can ever
   repeat this mistake.

---

### 7. Live server

The dashboard was served during the audit, bound to `0.0.0.0`, with three real runs I generated:

```bash
cd UserEye-7.0.0-audit-fixed/UserEye
npm install
npx playwright install chromium
node bin/usereye.js dashboard ./live-runs --host 0.0.0.0 --port 4174
```

Verified with `curl`: `/` → HTTP 200 listing `static-quick`, `spa-gatefail`, `english-standard`;
`/static-quick/report.html` → HTTP 200.

Reproduce the fix verification yourself:

```bash
npm run verify                                                    # 146 tests, 144 pass, 0 fail
node bin/usereye.js auto --project tests/fixtures/static --mode quick --out /tmp/ok; echo $?   # 0
node bin/usereye.js auto --project tests/fixtures/django --mode quick --out /tmp/bad; echo $?  # 2
```

## 2026-09-05-independent-audit-and-fixes

<!-- origem: docs/audits/2026-09-05-independent-audit-and-fixes.md -->

## UserEye 7.1.1 — Independent Audit, Fixes & Function Guide

**Date:** 2026-09-05
**Package audited:** `UserEye-7.1.0-VELA-LIVE-TESTED.zip`
**Delivered as:** `UserEye-7.1.1-FIXED-VERIFIED.zip`
**Environment:** Node v20.20.2 · npm 10.8.2 · Playwright 1.63.0 (Chrome Headless Shell 153.0.8010.12) · Debian 13 sandbox
**Method:** instrumented verification only — every claim below is the output of a real command
(`node --check`, `npm test`, `npm run verify`, live CLI runs against the shipped fixtures and the
shipped Vela site, jsdom regression tests). Nothing was guessed.

**Resumo em português:** o seu código **não estava quebrado** nos contratos principais (testes,
CI, exit codes, install-browsers). Encontrei e corrigi **3 defeitos reais e reproduzíveis**:
(1) o achado `occluded-controls` tratava modal aberto como bug de layout (falso positivo "major");
(2) um filtro de deduplicação `aria-hidden` que era comprovadamente inútil (no-op);
(3) o `reportLocale` era descartado no construtor do `UserEye`, então `--report-locale pt/en`
não traduzia achados, planos e paciência — só o cabeçalho do relatório. Tudo foi corrigido sem
mudar comportamento dos testes existentes (157 testes, 155 passam, 0 falham), e cada correção tem
teste de regressão novo. Avaliação: **9.4 / 10**.

---

### 1. Bottom line

Your project was **not broken** in any of its contracts: 144/144 tests passed on arrival, the full
`verify` pipeline was green, the CI fixture matrix passed 5/5 live, exit codes honored 0/1/2, and
`install-browsers` worked. What I found were three **real, reproducible defects of the
precision/localization class** — one false positive that polluted every standard-mode run against
modal-using sites, one provably dead filter, and one wiring bug that silently disabled report
localization for everything except the report chrome. All three are fixed, each with a regression
test, and no existing behavior was changed beyond the fixes themselves.

**Rating: 9.4 / 10** (breakdown in §6).

---

### 2. What was verified, and with which instrument

| Check                                 | Instrument                                                                                               | Result                                                                                                                        |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Syntax of all 72 first-party JS files | `node --check` each                                                                                      | PASS, 0 errors                                                                                                                |
| Fresh install                         | `npm install`                                                                                            | 161 packages, `npm audit` 0 vulnerabilities                                                                                   |
| Browser install path                  | `node bin/usereye.js install-browsers`                                                                   | PASS exit 0 (Chromium headless 153)                                                                                           |
| System libs note                      | `npx playwright install-deps chromium`                                                                   | needed on bare Linux (10 tests failed with `libnspr4.so` before it) — now documented in README                                |
| Test suite, no browser                | `npm test`                                                                                               | 134 pass / 0 fail / 12 skipped                                                                                                |
| Test suite, real Chromium             | `npm test` after deps                                                                                    | **144 pass / 0 fail / 2 skipped** (7.1.0 baseline)                                                                            |
| Test suite after my fixes             | `npm test`                                                                                               | **155 pass / 0 fail / 2 skipped** (157 total, +11 new tests)                                                                  |
| Full pipeline after fixes             | `npm run verify`                                                                                         | PASS exit 0 — lint, format, typecheck, tests, 5 repo checks, coverage floors (overall 66.67% vs floor 45%)                    |
| CI fixture matrix                     | exact reproduction of `.github/workflows/ci.yml` (static, spa, english, portuguese, sso)                 | **5/5 PASS**, exit 0, gates PASS — re-run after fixes                                                                         |
| Exit-code contract                    | `--min-score 101` (gate fail) → 1; django stub (startup fail) → 2 + `startup-error.json`; bogus flag → 2 | all exact                                                                                                                     |
| `observe` + `--axe`                   | live vs fixtures and Vela                                                                                | PASS, exit 1 with findings (documented contract)                                                                              |
| Vela site, standard mode              | live run, 7.1.0 vs 7.1.1                                                                                 | 7.1.0: 1 issue (FP) · 7.1.1: **0 issues**, 100/100, exit 0                                                                    |
| Vela site, deep mode                  | live run, 7.1.0 vs 7.1.1                                                                                 | 7.1.0: 4 issues (documented FPs) · 7.1.1: **1 issue** (the documented focus-blur misclick FP), 100/100, coverage 100%, exit 0 |
| Localization en                       | `observe --report-locale en` + artifact scan                                                             | findings/plan/patience/narrative fully English                                                                                |
| Localization pt                       | `observe --report-locale pt`                                                                             | findings/plan/patience/narrative fully Portuguese (exact legacy strings)                                                      |
| Package integrity                     | `npm run checks`                                                                                         | 59 files, 127.7 kB packed (ceiling 150 kB)                                                                                    |

Evidence for every row is shipped in `evidence/` and served by the live server (§7).

---

### 3. Bugs found & fixed

#### BUG #1 — dialog-context-blind occlusion (false positive, severity major)

**Reproduced live (7.1.0):** `usereye auto` on the shipped Vela site (standard mode) reported
`major: Visual adaptation: Controles visíveis estão bloqueados por outros elementos` —
13 controls "occluded" by `div.modal-backdrop`. The screenshot
(`evidence/vela-standard-en/screenshots/observation-04-after-book-a-demo.jpg` in the 7.1.0 archive;
my run reproduced it) shows the explorer had **opened the "Book a live demo" modal itself**: the
background controls were blocked by a modal backdrop, which is the designed APG modal behavior.
The snapshot already recorded `dialogs: […]` — the context existed and was ignored.

**Fix (`browser-perception.js`):** rendered dialog elements (`dialog`, `[role="dialog"]`,
`[aria-modal="true"]`) are now queried before the control sweep; each occlusion hit checks whether
the occluder belongs to an open dialog context (the dialog, an element inside it, or the wrapper
containing it) while the occluded control sits outside it. Such hits are recorded as
`occludedByOpenDialog` (surfaced in `counts.occludedByOpenDialog`) instead of becoming findings.
**Genuine occlusion is untouched:** a stray always-on backdrop (the classic
`hidden`-overridden-by-CSS bug class) has no rendered dialog context, still produces
`occluded-controls`, and still trips `visible-hidden-elements` — proven by a regression test.

**Proof:** same site/config: 7.1.0 standard = 1 major issue → 7.1.1 standard = **0 issues**;
deep = 4 → **1** (the three removed were occlusion FPs; the survivor is the documented
focus-blur misclick FP, §5).

#### BUG #2 — aria-hidden dedup filter was provably a no-op

`browser-perception.js` filtered nested hidden subtrees with
`!element.closest('[aria-hidden="true"]') || element.matches('[aria-hidden="true"]')`.
Every element queried by `[aria-hidden="true"]` matches the second clause by construction, so the
filter never removed anything and nested `aria-hidden` nodes were counted once per level.
**Fix:** keep only the outermost rendered element of each subtree:
`!(element.parentElement && element.parentElement.closest('[aria-hidden="true"]'))`.
Regression test asserts one subtree = one evidence entry.

#### BUG #3 — `reportLocale` was dropped by the `UserEye` constructor (localization silently off)

`--report-locale pt` translated only the report chrome (headings/labels in `report.js`); every
finding title, gaze narrative, user-plan step and patience reason stayed Portuguese in en runs
(the "i18n leak" documented since 7.0.0), and — as I measured — stayed **English in pt runs**,
because `new UserEye({...})` never kept `reportLocale` in `this.options` and neither CLI passed it
to the constructor (only to the report writer).

**Fix, in four coordinated pieces:**

1. **`i18n.js` (new module)** — single source for runtime catalogs: `catalog()`, `section()`,
   `findingStrings()`, `format()`, `t()`, `packName()`.
2. **`locales/en.json` / `locales/pt.json`** — new sections `findings` (all 32 finding
   title/actual templates), `scan`, `gaze`, `plan`, `patience`, `misclick`. Portuguese keeps the
   exact strings shipped since 7.0.0; English is a full translation. Key parity is test-enforced.
3. **Browser collectors accept strings via `page.evaluate` arguments** — `collectBrowserPerception`,
   `collectHumanSignals`, `collectUserGaze` take a `strings` setting injected by `perception.js`,
   `user-human.js`, `protocols/human.js`, `protocols/experience.js`, `protocols/input.js`,
   `adaptive-explorer.js` and `user-eye.js` from `reportLocale`. Without strings they degrade
   gracefully (code as title) instead of crashing.
4. **Constructor + CLI wiring** — `UserEye` keeps `reportLocale` in `this.options` (typed in
   `types/index.d.ts`), and `usereye-observe.js` / `usereye-auto.js` pass `config.reportLocale`
   into the constructor. Node-side generators (`user-gaze.js`, `user-plan.js`, `patience.js`,
   `misclick-engine.js`) read the locale from their input/owner.

**Proof:** minimal pair in `evidence/vela-observe-en` vs `evidence/vela-observe-pt` — identical
findings, titles `Controls partially clipped by the viewport` vs `Controles parcialmente cortados
pelo viewport`; plan `Read "…"` vs `Ler "…"`; patience mood `Calm` vs `Tranquilo`.

---

### 4. What each created or edited function means

#### New module `i18n.js`

| Function                   | Meaning                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `packName(locale)`         | Normalizes a locale tag to a shipped pack: anything starting with `pt` → `pt`, else `en`.                                |
| `catalog(locale)`          | Loads+memoizes `locales/<pack>.json` (the whole dictionary).                                                             |
| `section(locale, name)`    | Returns one nested dictionary (`findings`, `scan`, `gaze`, `plan`, `patience`, `misclick`).                              |
| `findingStrings(locale)`   | The JSON-serializable `{code:{title,actual}}` map that crosses the `page.evaluate` boundary into the browser collectors. |
| `format(template, params)` | `{placeholder}` substitution; unknown placeholders survive untouched.                                                    |
| `t(cat, key, params)`      | Flat lookup + format with graceful fallback to the key — a missing translation can never crash a run.                    |

#### New test suite `tests/i18n-context.test.js` (11 tests)

En/pt key parity across all six sections; localized perception findings in jsdom for both locales;
dialog-context suppression **and** its negative case (stray backdrop still reported); aria-hidden
dedup; localized user-plan, patience moods/reasons/disclaimer end-to-end; constructor keeps
`reportLocale`; scan templates exist in both packs.

#### Edited engine functions

| File → function                                                                                                                                                                                                                                             | What changed and why                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `browser-perception.js` → `collectBrowserPerception({…, strings})`                                                                                                                                                                                          | Now receives localized finding strings; new locals `fmtLocal/titleFor/actualFor` render titles/actuals from them.                                                                                                                            |
| `browser-perception.js` → control sweep (inside `collectBrowserPerception`)                                                                                                                                                                                 | New per-control fields `occludedByOpenDialog` + helper `dialogContextFor(element)`: decides whether an occluder belongs to an open dialog context. `counts.occludedByOpenDialog` exposes how many hits were classified as designed modality. |
| `browser-perception.js` → aria-hidden filter                                                                                                                                                                                                                | Outermost-subtree dedup (BUG #2).                                                                                                                                                                                                            |
| `browser-human.js` → `collectHumanSignals({…, strings})`                                                                                                                                                                                                    | Same localization pattern for its 17 findings.                                                                                                                                                                                               |
| `browser-gaze.js` → `collectUserGaze({…, strings})` + `scanLine()`                                                                                                                                                                                          | The 4 "3-second scan" lines (`Title:`, `Obvious action:`…) come from the `scan` locale section, English fallback inline.                                                                                                                     |
| `perception.js` → `capturePerception(page, options)`                                                                                                                                                                                                        | Injects `strings: findingStrings(options.locale)` into the evaluate settings.                                                                                                                                                                |
| `user-human.js` → `captureHuman(page, options)`                                                                                                                                                                                                             | Same injection for human signals.                                                                                                                                                                                                            |
| `protocols/human.js`, `protocols/experience.js`, `protocols/input.js`, `adaptive-explorer.js`, `user-eye.js` (observe/_attachGaze/_attachHuman/patienceReport)                                                                                              | Pass `reportLocale` down to every collector/generator call site.                                                                                                                                                                             |
| `user-eye.js` → `UserEye` constructor                                                                                                                                                                                                                       | Keeps `reportLocale` in `this.options` (BUG #3 root cause) + JSDoc property.                                                                                                                                                                 |
| `usereye-observe.js` / `usereye-auto.js` → `runObserve` / `runAuto`                                                                                                                                                                                         | Pass `config.reportLocale` into the `UserEye` constructor, not only into the report writer.                                                                                                                                                  |
| `user-gaze.js` → `scoreCognitiveLoad(gaze, locale)`, `buildNarrative(gaze, load, locale)`, `inferPurpose(…, locale)`, `captureGaze(page, options)`, `buildJourney(input)`                                                                                   | Cognitive-load reasons, load labels, narrative sentences and purpose/goal labels rendered from the `gaze` locale section.                                                                                                                    |
| `user-plan.js` → `buildUserPlan(input)`                                                                                                                                                                                                                     | Plan step actions/whys from the `plan` locale section (`input.locale`).                                                                                                                                                                      |
| `patience.js` → `moodFor(score, locale)`, `interactionContext`, `addFeedbackPenalty`, `addSettlePenalty`, `evaluateInteractionLatency`, `detectRageClicks`, `penalizeBrowserErrors`, `penalizeMisclicks`, `buildMoodTimeline`, `buildPatienceReport(input)` | Moods, penalty reasons and the disclaimer rendered from the `patience` locale section; scores unchanged (asserted by test).                                                                                                                  |
| `misclick-engine.js` → `MisclickEngine.locale()`, effect builder, `saveEvidence`                                                                                                                                                                            | Misclick effect sentences, issue title/expected and the destructive-neighbor note from the `misclick` locale section.                                                                                                                        |
| `report.js` → `catalog` removed                                                                                                                                                                                                                             | Now shares `i18n.catalog` (single loader, no drift).                                                                                                                                                                                         |
| `types/index.d.ts`                                                                                                                                                                                                                                          | `reportLocale?: 'en'                                                                                                                                                                                                                         | 'pt'`on`UserEyeOptions`+ added to the`Required<Pick<…>>` options surface. |
| `HISTORY.md`, `package.json`                                                                                                                                                                                                                                | 7.1.1 entry (required by the project's own `sync-version` gate) + version bump single-sourced.                                                                                                                                               |
| `README.md`                                                                                                                                                                                                                                                 | One-sentence bare-Linux note: `npx playwright install-deps chromium` (the `libnspr4.so` scare I hit myself).                                                                                                                                 |
| `probes/results-server.js` → `MOUNTS`                                                                                                                                                                                                                       | Mounts resolved relative to the file instead of one sandbox's absolute paths — the evidence server now runs from any checkout.                                                                                                               |
| `tests/browser-gaze.test.js`                                                                                                                                                                                                                                | Scan-line assertions made locale-explicit (en default + explicit pt pack).                                                                                                                                                                   |

#### Added out-of-band (not part of the npm package)

| File                             | Meaning                                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `live-server.js` (delivery root) | Read-only verification server: index, the Vela site with clean URLs, every live-run artifact folder, and the docs. Traversal-guarded. |
| `evidence/`                      | Raw artifacts of the live 7.1.1 runs (videos/traces trimmed to keep the zip light).                                                   |
| `CHANGES-7.1.1.patch`            | Unified diff of every change inside `UserEye/`, generated with `diff -ruN` against your original zip.                                 |

---

### 5. Known limitations deliberately NOT changed (documented, with reasons)

1. **Consent-wall regex breadth** (`browser-human.js`): any panel ≥18% of the fold containing
   "gdpr/cookie/consent" counts as a consent wall — marketing copy about GDPR can trip it.
   Changing the threshold/semantics is a product decision; evidence stays precise (selector+rect).
2. **Zoom check technique** (`protocols/experience.js` uses `style.zoom`, which does not
   re-evaluate media queries). A real-zoom implementation (CDP page-scale or viewport halving)
   changes cross-run comparability; left as-is, documented.
3. **Misclick probes blur focus-revealed UI** (skip links, hover toolbars): the surviving `deep`
   issue on the Vela site is exactly this class. Fixing requires probe-order redesign.
4. Heuristic findings remain heuristics: every one ships selector + rect + screenshot + SARIF so
   you can judge it in seconds — that contract was verified intact.

None of these block gates or exit codes.

---

### 6. Rating: 9.4 / 10

| Axis                       | Score | Why                                                                                                                                        |
| -------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Correctness & stability    | 9.6   | 155/155 runnable tests green after fixes; `verify` fully green; exit-code contract exact; zero browser errors across 9 live runs           |
| Real-world detection power | 9.5   | Found planted bugs in fixtures and in the Vela site in earlier rounds; true positives untouched by my fixes (negative-case tests prove it) |
| Evidence quality           | 9.6   | Every finding ships selector + rect + screenshot + SARIF + trace; my own evidence folder follows the same discipline                       |
| Heuristic precision        | 9.0   | Dialog-context blindness fixed and regression-tested; 3 documented precision trade-offs remain (§5)                                        |
| Localization               | 9.3   | en/pt complete and parity-tested across findings/scan/gaze/plan/patience/misclick; es/fr remain detection packs only (by design)           |
| Packaging & DX             | 9.2   | `sync-version`/package gates green at 7.1.1; README now warns about bare-Linux deps; evidence server portable                              |

It becomes 9.7+ when §5 items get product decisions and the misclick probe learns focus-revealed UI.

---

### 7. Reproduce everything / live server map

```bash
cd UserEye && npm install && sudo npx playwright install-deps chromium   # deps: bare Linux only
node bin/usereye.js install-browsers && npm run verify                    # exit 0, 155 pass
cd ../vela-site && PORT=3000 node serve.js &                              # demo target
cd ../UserEye && node bin/usereye.js auto --config ../vela-site/usereye.config.js
node ../delivery/live-server.js                                           # or: PORT=4200 node live-server.js
```

Live server mounts: `/` index · `/vela/` demo site · `/evidence/…` live-run artifacts
(`vela-standard-en`, `vela-deep-en`, `vela-observe-en`, `vela-observe-pt`, `matrix-quick`,
`contracts`) · `/docs/…` this report and previous audits.

`evidence/contracts/` holds the exit-code proofs: gate-fail log (exit 1), `startup-error.json`
(exit 2), invalid-flag log (exit 2) and the full `npm run verify` log of the delivered build.

## 2026-09-05-vela-live-test-7.1.0

<!-- origem: docs/audits/2026-09-05-vela-live-test-7.1.0.md -->

## UserEye 7.1.0 — Live-Tested Against a Purpose-Built Complex Website

**Date:** 2026-09-05
**Tester environment:** Node v20.20.2 · npm 10.8.2 · Playwright 1.63.0 (Chromium Headless Shell 153.0.8010.12) · Linux sandbox
**Method:** instrumented verification only — every claim below is the output of actually running
commands (`node --check`, `npm run verify`, `npm test`, live `usereye observe`/`auto` runs, and
custom Playwright probes). Nothing was guessed.

---

### 1. Bottom line

**Your project is not broken. It works — and it works impressively well.**

To prove it the way you asked, I built a complex, high-quality, multi-page website from scratch
(**Vela Analytics**, 9 pages, ~2,400 lines of CSS design system, ~680 lines of JS across two
modules, dark mode, modal dialogs, tabs, live SVG charts, filterable blog, validated forms,
cookie consent, 404 handling), served it live, and pointed UserEye at it.

**UserEye found real bugs in my brand-new, carefully-built site** — including one blocker-class
bug I had shipped (a `display:grid` rule overriding the `hidden` attribute, leaving a modal
backdrop permanently covering every page). It also found 8 axe contrast violations, a skip-link
focus-landing defect, hover-only information, and a consent-wall heuristic hit. I fixed the site,
re-ran, and iterated to:

| Run                                        | Quality                        | Protocols failed | Browser errors | Issues                            | Gates    | Exit  |
| ------------------------------------------ | ------------------------------ | ---------------- | -------------- | --------------------------------- | -------- | ----- |
| `observe` (site as first built)            | —                              | —                | 0              | **8** (1 blocker, 2 major)        | —        | 0     |
| `observe` (after fix round 1)              | —                              | —                | 0              | **1** (documented false positive) | —        | 0     |
| `auto --mode standard` (round 1, unseeded) | 83/100                         | 1                | 0              | 11                                | PASS     | 0     |
| `auto --mode standard` (final)             | **100/100**                    | **0**            | **0**          | **1** (documented FP)             | **PASS** | **0** |
| `auto --mode deep` (final)                 | **100/100**, coverage **100%** | **0**            | **0**          | **4** (documented FPs)            | **PASS** | **0** |

**My rating of UserEye 7.1.0: 9.2 / 10** (breakdown in §7).

---

### 2. What was verified, with which instrument

#### 2.1 Your tool, from scratch, in a fresh sandbox

| Check                                          | Instrument                             | Result                                                                                                          |
| ---------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Download + extract of your Filebin zip         | `curl` + `unzip`                       | 374 files, intact                                                                                               |
| Syntax of all 72 first-party JS files          | `node --check` each                    | **PASS**, 0 errors                                                                                              |
| Fresh dependency install                       | `npm install`                          | 161 packages, playwright 1.63.0, axe-core 4.13.0, `npm audit` **0 vulnerabilities**                             |
| Browser install path (previous audit's fix)    | `node bin/usereye.js install-browsers` | **PASS**, exit 0, Chromium + headless shell downloaded                                                          |
| Full test suite, real Chromium                 | `npm test`                             | **146 tests: 144 pass / 0 fail / 2 skipped** (firefox+webkit matrix)                                            |
| Full pipeline                                  | `npm run verify`                       | **PASS, exit 0** — lint, format, typecheck, tests, 5 repo checks, coverage floors (overall 65.43% vs floor 45%) |
| Package checks                                 | `npm run checks`                       | 5/5 OK (version sync, API surface 21 exports, README examples, Playwright pin, package 58 files / 119.1 kB)     |
| `observe` against live site                    | real browser run                       | 8 issues found round 1 → 1 after fixes (see §4)                                                                 |
| `auto` standard ×3 + deep ×1 against live site | real browser runs                      | final: 100/100, gates PASS, exit 0 (see §1)                                                                     |
| Exit-code contract                             | every run                              | 0 on success, correct throughout                                                                                |

**Important environment note:** on the very first `npm test` in _this_ sandbox, 10 browser tests
failed with `libnspr4.so: cannot open shared object file`. That is the sandbox missing Chromium's
system libraries, **not your code**. After `sudo npx playwright install-deps chromium` (Playwright's
official mechanism), all 144 tests passed. Your README's separate `install-browsers` step is correct;
you may want to document `install-deps` for bare Linux environments (see §6, suggestion only).

#### 2.2 The one defect found in your delivery (and the only change I made to your project)

The zip as delivered **fails its own `npm run verify`**: `prettier --check .` flags **62 files**
inside `live-runs/` — the proof artifacts a previous audit bundled into the archive — because
`live-runs/` was never added to the ignore lists (`artifacts/` was). Reproduced live:
`npm run verify` → exit 1 at `format:check`.

**Fix (2 lines, zero code touched):**

- `UserEye/.prettierignore` — appended `artifacts/` and `live-runs/`
- `UserEye/.gitignore` — appended `live-runs/` (generated output, consistent with `artifacts/`)

After the fix: `npm run verify` → **exit 0**, everything green. Rationale: reformatting the
evidence files would alter proof artifacts; generated run outputs belong in ignore lists — the
same reasoning already applied to `artifacts/` in your `.gitignore`. No `.js` file in your
project was modified by me. (`git diff`-equivalent proof: the two files above are the only
edits under `UserEye/`.)

---

### 3. The test website: Vela Analytics (`vela-site/`)

A fictional SaaS marketing site built specifically to exercise everything UserEye probes:

- **9 pages:** home, product (interactive demo dashboard), pricing (billing switch + comparison
  table + FAQ), blog (tag filters + search + `?tag=` deep links), full article (TOC, reading
  progress, code blocks, SVG diagram), about (timeline, team, careers table), contact (validated
  form + success state), legal (anchored sections), real 404 page (404 status + friendly page).
- **Interaction surface for the engine:** light/dark theme toggle (persisted), mobile nav,
  modal dialog with focus trap + Escape + form protection, ARIA tablist with arrow-key roving,
  SVG chart with dataset switching + series toggles + a polite live ticker (updates every 4 s),
  count-up stats, cookie consent banner, newsletter + contact + demo forms with inline
  `aria-describedby` validation errors, scroll-reveal animations.
- **Accessibility craft:** skip link (zero-box until focused, lands focus on `<main tabindex="-1">`),
  landmarks, one `h1`/page, WCAG AA contrast in both themes (recomputed after axe findings),
  `:focus-visible` rings, `prefers-reduced-motion` support, `inert` background when the modal is
  open (APG pattern), semantic tables with `caption`/`scope`, `aria-pressed`/`aria-expanded`/
  `aria-current` throughout, no external requests at all (system fonts, inline SVG).
- **Progressive enhancement:** every page works without JS; JS adds the reveal layer, filters,
  charts and validation.

Run it: `cd vela-site && PORT=3000 node serve.js` (live preview in this session: port 3000).

---

### 4. Iteration story — what UserEye found, what I changed in the site

Round numbers refer to `usereye observe` / `auto` runs; artifacts for every run are on the
results server (port 5000) and inside `vela-usereye-artifacts/` in this zip.

| #   | UserEye finding (severity)                                         | Root cause in my site                                                                                                                                                                                                          | Fix                                                                                                                                                 |
| --- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `Elementos marcados hidden estão visíveis` (**blocker**)           | `.modal-backdrop{display:grid}` and `.cookie-banner{display:flex}` overrode the `hidden` attribute → backdrop covered **every page** permanently, blocking 13 controls (findings 2 & 6 were collateral damage of the same bug) | `[hidden]{display:none !important}` in tokens.css — the standard guard                                                                              |
| 2   | axe `color-contrast` (**major**, 8 elements)                       | coral `#c8511f` on `#f1f5f9` = 4.12:1; amber `#9a6400` on `#fbeed2` = 4.35:1; `.logo-item` opacity .72 → effective 4.48:1                                                                                                      | darkened tokens to `#a8431a` / `#7f5300` (5.2–5.8:1), opacity → .8 (5.3:1)                                                                          |
| 3   | `Muro de cookies/consentimento cobre a primeira dobra` (**major**) | consent regex matches `gdpr`; my features section said “GDPR-ready” in a panel >18% of the fold → heuristic hit (banner itself was below threshold)                                                                            | reworded marketing copy (“DPA-ready”); banner kept                                                                                                  |
| 4   | `Informação essencial só aparece no hover` (minor)                 | `title` attribute on the theme toggle                                                                                                                                                                                          | removed `title`; `aria-label` only                                                                                                                  |
| 5   | `Texto visível está cortado` (minor)                               | classic 1px-clip `.visually-hidden` trips the `overflow:hidden`+`scrollWidth` heuristic                                                                                                                                        | switched to the clip-path sr-only technique (no overflow/nowrap)                                                                                    |
| 6   | `skip-link` protocol (warning)                                     | focus stayed on `BODY` after activation                                                                                                                                                                                        | `<main id="main" tabindex="-1">` on all 9 pages → focus lands correctly (verified by probe)                                                         |
| 7   | `touch-pointer` protocol (**failed**)                              | first DOM control = skip link parked off-screen (`top:-48px`) → `elementFromPoint` returned `null` → “occluded by null”                                                                                                        | skip link is now a **zero-box** element (height 0, no border/padding) until `:focus` → invisible to pointer hit-tests, fully keyboard/AT accessible |
| 8   | `zoom-200` protocol (warning, 364 px overflow)                     | CSS `zoom:2` doesn't re-fire media queries; fixed-column grids overflowed                                                                                                                                                      | all grids converted to `repeat(auto-fit, minmax(min(100%, Xpx), 1fr))` + wrapping header → **0 overflow on all 8 pages** (measured by probe)        |
| 9   | `Elementos clicáveis sem papel de controle` (**major**)            | pricing “Monthly/Annual” were `cursor:pointer` **spans** with no role/handler                                                                                                                                                  | converted to real `<button>`s that set the switch deterministically                                                                                 |
| 10  | `A página parece presa … overflow bloqueado` (**major**)           | modal locked scroll via `body{overflow:hidden}` → matched the scroll-trap heuristic                                                                                                                                            | scroll lock via `position:fixed` body technique (computed overflow stays `visible`, no scrollbar jump)                                              |
| 11  | misclick cascade around theme toggle (**major**+2 minor)           | probes hit the open modal's backdrop → backdrop-click closed the dialog → “dialog changed”                                                                                                                                     | backdrop click no longer closes (form-data protection — APG-aligned); explicit Close + Escape only                                                  |
| 12  | `very-large-files` (code quality)                                  | `styles.css` 2,240 lines > 1,000-line source limit                                                                                                                                                                             | split into 6 files under `assets/css/` (219–561 lines each); `app.js` (668) split into `app.js` 546 + `charts.js` 137                               |
| 13  | probe-caught regression (mine)                                     | shared tabpanel was re-hidden by the last loop iteration of `selectTab`                                                                                                                                                        | hide-all-then-reveal-active + `aria-labelledby` sync — caught by my own Playwright probe before UserEye re-ran                                      |
| 14  | probe-caught bug (mine)                                            | `$$29` double-dollar on pricing (markup `$` + JS `'$'+v`)                                                                                                                                                                      | JS owns the full string now                                                                                                                         |

After the fixes, my independent 29-check Playwright probe (`probes/probe-site.js`) passes 29/29:
skip-link semantics, cookie flow, theme, modal (focus, lock, Escape, restore, form protection,
validation), charts/tabs/series, pricing switch, FAQ, blog filters + deep link, contact form
success state, 404 status, zero console errors across all 8 pages.

---

### 5. Every function/file I created or edited — what it means

#### 5.1 In YOUR project (the only changes)

- **`.prettierignore` / `.gitignore`** — 3 appended lines total (§2.2). No function created or
  edited; no behavior changed; `npm run verify` went red → green.

#### 5.2 `vela-site/serve.js` (static server for the test site)

- **`send(res, status, body, type)`** — writes a response with correct MIME + `no-store` +
  `X-Content-Type-Options: nosniff` (so UserEye's `security-headers` protocol sees hardening).
- **`resolveFile(urlPath)`** — maps a URL to a file: exact match → directory `index.html` →
  clean-URL fallback (`/product` → `product.html`) → special map
  (`/blog/scaling-observability-to-10-trillion-events` → `blog-post.html`), with a path-traversal
  guard; `null` ⇒ caller serves `404.html` with a real 404 status.

#### 5.3 `vela-site/assets/app.js` (progressive-enhancement layer; each function is an IIFE module)

- **`systemTheme()` / `applyTheme(theme)`** — resolve + apply light/dark on `<html data-theme>`,
  sync the toggle's `aria-label` (no `title` — hover-only info is a finding, see §4.4).
- **`initTheme()`** — reads persisted choice (`localStorage`) else system preference; wires the toggle.
- **`initNav()`** — mobile menu (`aria-expanded`/`aria-controls`, Escape restores focus to the
  toggle), sticky-header scroll shadow (`data-scrolled`) and the article reading-progress bar.
- **`initReveal()`** — adds `html.js-reveal` (so no-JS users never see invisible content) and
  IntersectionObserver-driven `data-reveal` → `.in` transitions; fully disabled under
  `prefers-reduced-motion`.
- **`initCookieBanner()`** — shows the consent region only until a choice is stored; Accept/Decline persist.
- **`initModal()`** — builds the demo dialog from a template string once. Contains:
  - **`focusables()`** — live list of tabbable elements inside the dialog (focus trap data).
  - **`openModal(event)`** — remembers the opener, unhides backdrop, sets `inert` on every other
    body child (APG modal pattern — browser-level background blocking), locks scroll, focuses
    the first field.
  - **`closeModal()`** — reverses all of the above and **returns focus to the opener**.
  - **`lockScroll()` / `unlockScroll()`** — the `position:fixed`-body scroll lock with scrollbar
    compensation and scroll-position restore; deliberately avoids `overflow:hidden` on body/html
    (§4.10).
  - keydown layer — Escape closes; Tab/Shift+Tab wrap inside the dialog.
  - submit handler — validates; on success shows a `role="status"` message and auto-closes after 2.6 s.
- **`fieldRules(input)` / `validateField(input)` / `validateForm(form)`** — tiny rule engine
  (required / email regex / minLength) writing messages into each field's `aria-describedby`
  error slot, toggling `aria-invalid`, focusing the first invalid input on submit.
- **`initForms()`** — wires blur/input re-validation for `form[data-validate]` (contact) and the
  success-panel swap (`form.hidden` → `[data-form-success]` + first-name personalization);
  separately wires `form[data-newsletter]` inline status.
- **`initTabs()`** — ARIA tablist: click + Arrow/Home/End key handling, `aria-selected`, roving
  `tabindex`, panel hide-all/reveal-active (bug #13 fix), `aria-labelledby` sync, and dataset
  hand-off to the chart module via `window.__velaCharts`.
- **`initCounters()`** — eased count-up for `[data-count]` stats when they scroll into view;
  instant final value under reduced motion.
- **`initBlogFilter()`** — tag chips (`aria-pressed`) + live search + `?tag=` deep link; hides
  non-matching cards via `hidden` and announces counts through a `role="status"` region.
- **`initPricing()`** — billing `role="switch"` + the two label **buttons** (bug #9 fix):
  clicking “Annual” checks the switch, updates every `[data-monthly]/[data-annual]` price and note.
- **`initMisc()`** — footer year; `data-copy-link` clipboard button with polite status + auto-clear.
- **`boot()`** — runs every initializer on `DOMContentLoaded` (or immediately if already parsed).

#### 5.4 `vela-site/assets/charts.js` (extracted chart engine)

- **`CHART_DATA`** — three 24-point datasets (latency/errors/traffic × web/API/mobile) of fictional telemetry.
- **`initCharts()`** — renders the SVG chart: 5 gridlines + y labels, 5 x labels, 3 polylines
  scaled to the data; **`draw(animate)`** rebuilds it (with stroke-dashoffset draw-in animation
  unless reduced motion); **`window.__velaCharts.setDataset(name)`** is the tab-facing API;
  series-toggle buttons flip `aria-pressed` + `polyline.hidden`; the 4-second random-walk
  **ticker** updates a `role="status"` value (fixed-width, tabular-nums → zero layout shift).

#### 5.5 `vela-site/assets/css/*.css` (6 files, split by concern — §4.12)

`tokens.css` (custom properties for both themes + base + a11y utilities incl. the zero-box
`.skip-link` and clip-path `.visually-hidden` + `[hidden]` guard) · `layout.css` (container,
sections, grids — all `auto-fit/minmax` — buttons, header) · `components.css` (hero, mocks, logo
cloud, cards, steps, stats, quotes, CTA, newsletter, forms, badges) · `pricing-blog.css` (switch,
tiers, comparison table, FAQ, blog toolbar/cards, article typography, TOC, code blocks) ·
`product-pages.css` (tabs, chart, dash stats, ticker, integrations, timeline, team, contact
cards, cookie banner, modal, footer, 404) · `responsive.css` (breakpoints, reduced motion, print).

#### 5.6 Evidence & probe tooling (mine, outside your package)

- **`probes/probe-site.js`** — 29 functional assertions with Playwright (mirrors and extends what
  UserEye checks, so my fixes were verified independently before re-running your tool).
- **`probes/probe-zoom.js`** — reproduces the `zoom-200` protocol (`documentElement.style.zoom='2'`)
  and reports `scrollWidth` overflow + offending elements per page.
- **`probes/results-server.js`** — read-only evidence server (port 5000): index linking both final runs
  (report.html, result.json, SARIF, session video), the two before/after observe runs, and docs.
- **`usereye.config.js`** (vela) — the site's project policy per your README: `seedPaths` for all
  8 URLs, `allowWrite: true` (forms are demo-only), en pattern pack, gates.

---

### 6. Heuristic false positives found while testing (documented, NOT “fixed” by gaming)

These are tool-side observations with exact locations — no engine code was touched:

1. **`visible-aria-hidden` counts decorative icons** (`browser-perception.js:289-292`). The
   dedup filter `!element.closest('[aria-hidden="true"]') || element.matches(...)` is always true
   (the second clause matches every selected element), so every rendered `aria-hidden` element is
   flagged — including the _recommended_ pattern of decorative SVG icons. My clean site keeps
   exactly 1 minor issue because of this. Suggested one-liner for you (not applied):
   `!element.parentElement?.closest('[aria-hidden="true"]')` plus skipping `<svg>`/`.dot`-class
   decorations, or exempting elements with no focusable descendants.
2. **`occluded-controls` is dialog-context-blind** (`browser-perception.js:353,406-410`). When the
   explorer leaves a modal open, the _same snapshot_ records `dialogs:[…]` (the tool sees the
   dialog!) yet still flags background controls as occluded by the backdrop — which is the
   designed behavior of every modal dialog (APG). This produced the single “major” issue in the
   final standard run and 2 of 4 in deep. Suggested refinement (not applied): skip/downgrade
   occlusion findings when `occludedBy` is inside (or is) a detected dialog's backdrop.
3. **misclick probes blur focus-revealed elements** — in deep mode the engine sampled the
   _focused_ skip link (visible only during `:focus`); the adjacent probe click blurred it, the
   chip vanished, and “visual state changed” was recorded as confusing. Any focus-revealed UI
   (skip links, hover toolbars) can trip this.
4. **consent-wall regex matches marketing copy** (`browser-human.js:100-117`): any panel ≥18% of
   the fold containing “gdpr”/“cookie”/“consent” etc. counts as a consent wall — my
   “SOC 2 Type II and GDPR-ready” feature card was flagged as a cookie wall. Area is raw element
   area, not fold intersection.
5. **`zoom-200` uses `documentElement.style.zoom`** (`protocols/experience.js:28`), which — unlike
   real browser zoom — does not re-evaluate media queries. Sites relying purely on breakpoints
   (the overwhelmingly common pattern) get flagged; only container-relative layouts pass. Worth a
   doc note or using CDP `Emulation.setPageScaleFactor`/viewport halving instead.
6. **i18n leak:** `--report-locale en` still yields Portuguese finding titles in
   `browser-perception.js`/`browser-human.js` and a Portuguese `user-plan.json` (e.g. “Entender o
   produto…”). Known from your previous audit (“press() default label”); confirmed still present.
7. **Environment doc suggestion:** on bare Linux, browser tests need
   `npx playwright install-deps chromium` (system libs) in addition to `install-browsers`. Ten
   tests failed with `libnspr4.so` missing before I ran it; a README note would save users a scare.

None of these blocked anything: gates passed, exit codes were correct, and every finding came with
precise, actionable evidence (selectors, rects, screenshots) — which is exactly what the tool promises.

---

### 7. Rating: 9.2 / 10

| Axis                       | Score | Why                                                                                                                                                                                            |
| -------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Correctness & stability    | 9.5   | 144/144 tests, `verify` green (after the 2-line packaging fix), 0 browser errors across 6 real runs against a complex site, exit-code contract exact                                           |
| Real-world detection power | 9.5   | Found a blocker-class CSS bug, 8 contrast violations, focus-landing, hover-only info, scroll-trap lock, clickable non-controls in a site built by an experienced hand specifically to be clean |
| Evidence quality           | 9.5   | Every finding ships selector + rect + screenshot + SARIF + trace + video; fully reproducible                                                                                                   |
| Heuristic precision        | 8.0   | The 7 context-blindness FPs in §6 (aria-hidden dedup dead code, dialog-blind occlusion, consent regex, zoom method) cost a point — all documented, none blocking                               |
| Packaging/delivery hygiene | 8.5   | The delivered zip failed its own `verify` (live-runs not ignored); i18n leak in en reports                                                                                                     |
| Docs & DX                  | 9.5   | README examples all parse (your own gate proves it), config discovery + precedence excellent, `--config` flow worked first try                                                                 |

**It would be 9.5+** with the §6 heuristics made context-aware and the delivery zipped with
`verify` green.

---

### 8. Reproduce everything

```bash
## 1. tool health
cd UserEye && npm install && sudo npx playwright install-deps chromium   # deps: bare Linux only
node bin/usereye.js install-browsers && npm run verify                   # → exit 0

## 2. site
cd ../vela-site && PORT=3000 node serve.js &

## 3. my independent probes
node ../probes/probe-site.js                                             # → ALL PROBES PASSED (29)
node ../probes/probe-zoom.js http://127.0.0.1:3000/                      # → overflow: 0

## 4. UserEye against the site
cd .. && node UserEye/bin/usereye.js observe http://127.0.0.1:3000 --axe --out out/observe
node UserEye/bin/usereye.js auto --config usereye.config.js --out out/standard
node UserEye/bin/usereye.js auto --config usereye.config.js --mode deep --out out/deep
## → Quality 100/100 · gates PASS · exit 0 (both)

## 5. browse the evidence
PORT=5000 node probes/results-server.js   # index: runs, reports, SARIF, session videos, before/after
```

## 2026-09-05-verification-7.0.0-audit-fixed

<!-- origem: docs/audits/2026-09-05-verification-7.0.0-audit-fixed.md -->

## Independent Re-Verification of the "UserEye-7.0.0-audit-fixed" delivery

Date: 2026-09-05
Performed by: Agent Mode, in a fresh Linux sandbox (Node v20.20.2, npm 10.8.2), with no
trust extended to the claims already written in `CHANGES.md`. Every item below was re-run from
scratch, live, with real commands, and I confirm what I could confirm and note what changed.

**Your code was NOT modified further by me.** I only added two files, both clearly out-of-band:

- `UserEye/verify-server.js` — a tiny static file server (not part of the npm package, not
  referenced by `package.json`, not in `files:`) that exposes the live artifacts below in a browser
  so you (or any LLM) can inspect them without re-running anything.
- `MY-VERIFICATION.md` (this file).

Nothing inside the actual UserEye tool (`bin/usereye.js`, `usereye-auto.js`, `user-eye.js`, etc.)
was touched by me. The two fixes already present in the delivery (see `CHANGES.md`) were left as-is
because I independently reproduced and confirmed both of them (details below).

---

### 1. What I did, step by step

1. Downloaded your zip from the Filebin link, extracted it, ran `npm install` fresh (82 packages,
   0 vulnerabilities per `npm audit`).
2. Ran `node --check` against all 45 `.js` files in the project (outside `node_modules`) — 0 syntax
   errors.
3. Ran `npm test` — **20/20 tests passed**, matching the report.
4. Independently reproduced the one real bug described in `CHANGES.md`:
   - Confirmed `require.resolve('playwright/cli')` throws
     `ERR_PACKAGE_PATH_NOT_EXPORTED` against the actual installed `playwright` package by running it
     myself in a plain `node -e` script (not by reading the report).
   - Printed `node_modules/playwright/package.json`'s real `exports` map and `bin` field myself —
     confirmed `./cli` is absent and `bin.playwright` is `cli.js`, exactly as the report states.
   - Ran the _current_ (fixed) `bin/usereye.js install-browsers` live — it downloaded Chromium,
     ffmpeg and Chrome Headless Shell and exited **0**. This proves the fix in the delivered code
     actually works end-to-end, not just in theory.
5. Started the project's own fixture app (`tests/fixtures/static`) on `127.0.0.1:4173` and ran, live:
   - `node bin/usereye.js observe http://localhost:4173 --axe --report-locale en` → exit 0, 2
     controls, 2 findings — matches the report.
   - `node bin/usereye.js auto --url http://localhost:4173 --mode standard` → quality 100/100,
     coverage 100%, quality gates PASS, exit 0.
   - `node bin/usereye.js auto --url ... --min-score 100` (deliberately impossible gate) → quality
     93/100, quality gates **FAIL**, exit code **1** (checked via `$?`, not just the printed text) —
     confirms the exit-code contract really works, not just that the tool prints "FAIL".
6. Reproduced the **exact 5 CI fixture-matrix commands** from `.github/workflows/ci.yml`
   (`static`, `spa`, `english`, `portuguese`, `sso`) by hand, one at a time, starting
   `tests/fixture-server.js` for each and running the same `usereye auto --mode quick` command your
   CI runs. **5/5 passed**, exit 0 each.
7. Ran the Django "startup failure" fixture (`tests/fixtures/django`, a stub that exits immediately)
   through `usereye auto` — got exit code **2** and a `startup-error.json` artifact with the real
   stack trace, matching the documented setup-failure contract.
8. Parsed the generated `usereye.sarif` with Python's `json` module and checked
   `version == "2.1.0"` and the schema URL — valid SARIF, not just "looks like JSON".
9. Ran `npm pack --dry-run` — 51 files, 98.0 kB packed / 371.2 kB unpacked, matching the report's
   numbers almost exactly (kB rounding aside).
10. Ran `npm audit` — 0 vulnerabilities. Ran `npm outdated` — nothing flagged.
11. Independently re-checked the report's five "intentionally not changed" notes by grepping the
    actual source, not by trusting the text:
    - `press()`'s default label really is `` `Pressionar ${key}` `` (Portuguese) while the sibling
      default at the same call site pattern uses English — confirmed at `user-eye.js:503`.
    - The `video-raw/` directory really is created unconditionally in the constructor via
      `fs.mkdirSync(this.videoDir, { recursive: true })` at `user-eye.js:100`, regardless of a
      `--no-video` flag — confirmed.
    - `nextDialog()` really does register a `this.page.once('dialog', ...)` listener that is not
      explicitly removed if the timeout fires first — confirmed by reading `user-eye.js:938-960`.
    - No `eslint.config.*` / `.eslintrc*` file exists anywhere in the project, despite `eslint`,
      `prettier`, and `globals` being listed in `devDependencies` — confirmed by directory listing.
    - `package.json` version and `TOOL_VERSION` (`user-eye.js`) are both `7.0.0`, and
      `tests/smoke.test.js` asserts the CLI prints `7.0.0` — confirmed, so bumping the version
      without also updating the test would break `npm test`.

### 2. Conclusion of my independent re-audit

Every technical claim I could test, I tested myself with live commands and direct inspection of the
installed `playwright` package and your source files — I did not take the existing `CHANGES.md` on
faith. All of it held up:

- The project has **no syntax errors**, **20/20 tests pass**, **0 known vulnerabilities**.
- The one real bug that shipped (`install-browsers` crashing under modern Playwright's `exports`
  map restrictions) **was real, was reproducible, and the fix in this delivery genuinely resolves
  it** — I ran the fixed command live and it downloaded browsers successfully (exit 0).
- The `--command`/`--url` warning is a pure `console.warn` addition with no control-flow change —
  confirmed by reading the diff context in `usereye-auto.js`.
- Every "left alone" item is a real, minor, low-risk observation, not a hidden defect.

**I did not find any additional bug beyond the one already fixed in this delivery.** I therefore did
not touch any file inside `UserEye/` other than adding the read-only `verify-server.js` used only to
expose already-generated evidence over HTTP.

### 3. Rating

I concur with the **9.3 / 10** rating already in `CHANGES.md`, arrived at independently rather than
copied: architecture is clean and layered, correctness is backed by a real, passing test suite and
CI fixture matrix, safety defaults (read-only exploration, destructive-action blocklists, secret
redaction) are genuinely implemented (I read the redaction code, not just the docs), and the only
things holding it back from a 10 are cosmetic/packaging nits (dead lint devDependencies, one
Portuguese-language default string, no automated regression test for the exact bug that shipped).

### 4. How to see this yourself right now

A live server is running in this sandbox (see the "Live Preview" the platform shows you) exposing:

- `/` — an index page (`UserEye/verify-server.js`)
- `/demo-app/` — the fixture web app UserEye was pointed at
- `/report/report.html` — the actual HTML report from a live `usereye auto --mode standard` run
- `/report/usereye.sarif`, `/report/result.json`, `/report/screenshots/...` — raw evidence
- `/CHANGES.md` — the original fix report bundled with your delivery

### 5. What each changed/added file does (plain-language function guide)

This section explains, in your own project's terms, what the modified/added code actually does —
so you don't have to take "it's fixed" on faith.

#### `bin/usereye.js` → function `dispatch(argv)`

This is the command-line entry point. When you type `usereye <something>`, this function decides
what to do: print help, print the version, run an "observe" (single-URL inspection), run "auto"
(full exploration + protocols + quality gate), or run "install-browsers" (download the headless
Chromium binary Playwright needs). The bug fix changes **only** the `install-browsers` branch: it
used to ask Node for a file path (`playwright/cli`) that newer Playwright versions no longer expose
publicly, causing an immediate crash; now it derives the same file's location through
`playwright/package.json` (which _is_ public) and Playwright's own declared `bin` entry (`cli.js`).
No other command, flag, or return value changed.

#### `usereye-auto.js` → function `runAuto(argv, runtime)`

This is the orchestrator for the `auto`/`analyze` commands: it loads your config, decides whether to
run in "matrix" mode (multiple apps) or single-app mode, starts or connects to your app via
`ProjectAdapter`, then runs the four-step pipeline (open target → adaptive exploration → protocol
suite → code-quality floor), and finally computes quality gates and the process exit code. The only
change here is one added `console.warn(...)` line, triggered only when you pass both `--command`
and `--url`/`baseURL` at once — it tells you `--command` is being ignored (because a live URL always
wins), instead of leaving you to guess why your custom start command never ran. No return value,
control flow, or exit-code logic was touched.

#### `UserEye/verify-server.js` (new, added by me, not part of your package)

A ~90-line plain Node `http` server with no dependencies. It serves three read-only views: the demo
fixture app, the live report I generated, and your `CHANGES.md`. It is not referenced anywhere in
`package.json`, `bin/`, or `files:`, so it ships zero risk of being pulled into your published npm
package — it exists purely so this delivery is easy to click through in a browser.

## 2026-09-06-audit-7.4.0-second-independent

<!-- origem: docs/audits/2026-09-06-audit-7.4.0-second-independent.md -->

## UserEye 7.4.0 — Second Independent Audit, Rating & Function Guide

**Date:** 2026-09-06
**Package audited:** `usereye-7.4.0-verified.zip` (inner folder `UserEye-7.1.1-BALANCED`, package.json `7.4.0`)
**Delivered as:** `usereye-7.4.0-verified.zip`
**Environment:** Debian 13 sandbox · Node v20.20.2 · npm 10.8.2 · Playwright 1.63.0 (Chrome Headless Shell 153.0.8010.12) · app served live at `http://0.0.0.0:4200` via the shipped `live-server.js`
**Method:** instrumented verification only — every number below is the output of a real command (`node --check`, `npm install`, `npm test`, each `npm run verify` stage, live CLI runs against the shipped Vela site, a `curl` URL matrix against the live server, the shipped probes). Nothing was guessed.

**Resumo em português:** o seu projeto **não estava quebrado**. Confirmei por instrumentos que tudo o que importa fica verde: 201 testes → **199 passam / 0 falham / 2 skips** (firefox/webkit não instalados), lint/format/typecheck OK, 5 release checks OK, coverage floors OK, `auto` ao vivo contra `/vela/` sai 0 com 100/100 e 0 erros de navegador, `observe` + axe + pt localiza achados, probes passam (29/29), contrato de exit codes exato (0/1/2), e as 3 correções do relatório anterior (`touchPointer`, redirects do `live-server`, `loadPlaywright` dos probes) estão presentes e corretas no código. O que eu **achei de novo** foi **um vazamento de localização** (mesma classe dos bugs 7.1.1 #3): a coluna **“Esperado”** e o prefixo **“Visual perception”** do relatório continuavam em inglês mesmo com `--report-locale pt`. Corrigi isso em **7 arquivos** (4 catálogos de idioma + `user-eye.js` + `usereye-observe.js` + 1 teste novo), **sem alterar nenhum teste existente** (204 testes no total, 202 passam, 0 falham — antes e depois), e cada função alterada está explicada no §4. Avaliação: **9.3 / 10**.

---

### 1. Bottom line

Your project was **not broken** on arrival. Every contract re-checked green:

| Check                               | Instrument                                                                      | Result                                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Syntax, all 88 first-party JS files | `node --check` each                                                             | PASS, 0 errors                                                                                       |
| Fresh install                       | `npm install`                                                                   | 216 packages, OK                                                                                     |
| Browser install                     | `node bin/usereye.js install-browsers` + `npx playwright install-deps chromium` | OK (Chrome Headless Shell 153)                                                                       |
| Test suite                          | `npm test`                                                                      | **201 tests · 199 pass · 0 fail · 2 skip** (firefox/webkit not installed — graceful skips by design) |
| Lint / format / types               | `npm run lint` · `format:check` · `typecheck`                                   | PASS ×3                                                                                              |
| Release checks                      | `npm run checks`                                                                | 5/5 OK (version single-sourced, API surface, README examples, playwright pin, 179.5 kB < 200 kB)     |
| Coverage gates                      | `npm run test:coverage`                                                         | OK — all floors satisfied                                                                            |
| Live `auto`                         | `auto --url http://127.0.0.1:4200/vela/ --mode quick`                           | exit 0 · 100/100 · 0 unexpected browser errors · `touch-pointer` passes (~1 s)                       |
| Live `observe` + axe + pt           | `observe …/vela/ --axe --report-locale pt`                                      | exit 1 (documented contract: findings present) · findings/patience fully PT                          |
| Exit-code contract                  | gate fail / usage error / startup failure                                       | 1 / 2 / 2 — exact                                                                                    |
| Live server                         | `curl` URL matrix vs `live-server.js`                                           | redirects 301→200, guard intact                                                                      |
| Probes                              | `probe-site.js` / `probe-zoom.js`                                               | ALL PROBES PASSED (29 checks) / exit 0, 0 offenders                                                  |

The previous audit's three fixes were all verified present and correct in this delivery:
`touchPointer()` reads `targetText` **before** the tap (protocols/input.js), `live-server.js` redirects root-absolute demo links with a guarded 301, and both probes resolve `playwright` portably via `loadPlaywright()`.

**What I did find** was one **real, reproducible minor defect** of the localization class the project has been closing since 7.1.1: the _issue model_ (title prefixes and expected/actual strings) still leaked English into localized reports. Fixed in 7 files, 0 existing tests modified, suite identical before/after (199/0/2 → 202/0/2 with the 3 new regression tests).

**Rating: 9.3 / 10** (breakdown in §6).

---

### 2. How the app was checked live (as requested)

The delivery was served by its own server, exactly as `README-DELIVERY.txt` documents:

```bash
node live-server.js        # http://0.0.0.0:4200  → /  ·  /vela/…  ·  /docs/…
```

Then, all against the live server:

1. `curl` URL matrix (assets, clean URLs, sitemap, traversal attempts) — see §3 table.
2. `usereye auto --url http://127.0.0.1:4200/vela/ --mode quick` — exit 0, 100/100, 0 browser errors.
3. `usereye observe http://127.0.0.1:4200/vela/ --axe --report-locale pt` — ran twice (before/after my fix) and the two reports are shipped in `evidence/`.
4. Shipped probes against `vela-site/serve.js` (port 3000).
5. Exit-code probes (`--min-score 101`, bogus flag, startup failure).

The defect was found by instrument (not guesswork): I ran `observe --report-locale pt`, opened the generated `report.md`, and saw the table header localized to **“Esperado”** while the cell under it still said **“The rendered interface does not present this problem.”** Grep traced the string to a hard-coded literal in `user-eye.js` (and the observation label `'First impression'` in `usereye-observe.js`).

---

### 3. What was broken — summary (one item, minor)

| #   | Severity     | Where                                | Symptom                                                                                                                                                                                                                  | Root cause                                                                                                                                                                                                                                                                                                                                    |
| --- | ------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | minor (i18n) | `user-eye.js` + `usereye-observe.js` | In `--report-locale pt` reports, the findings table's “Esperado” column and the “Achado” title prefix stay English (“The rendered interface does not present this problem.” / “Visual perception (First impression): …”) | The issue **model** was never localized — `addIssue` call sites hard-coded `expected`/`actual` literals and title prefixes; only the report _chrome_ (headers/labels in `report.js`) used the catalog. Same class as 7.1.1 BUG #3 (findings/titles/patience), which stopped at the findings payload and never reached the issue-model strings |

Everything else was verified intact (see §1) and left untouched.

---

### 4. What changed — function by function

Exactly **7 files** were changed. Nothing else. (`+ NEW` = created by this audit; `~ EDITED` = your function, minimally patched. No existing test was modified.)

#### 4.1 `locales/en.json`, `locales/pt.json`, `locales/es.json`, `locales/fr.json` — new `issue` section

**+ NEW `issue` section** — one nested dictionary with the ten strings the issue model needs. All four packs declare the **same keys** (a new regression test enforces it), so a missing translation can never crash a run (`i18n.t` falls back to the key). The ten keys and what they mean:

| Key                        | Meaning                                                       | pt (example)                                                          |
| -------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------- |
| `visualPerceptionExpected` | The “expected” sentence for every visual-perception finding   | “A interface renderizada não apresenta este problema.”                |
| `elementVisibleExpected`   | Default `expected` in `UserEye.see()`                         | “Elemento visível para o usuário.”                                    |
| `elementVisiblePass`       | `actual` when `see()` confirms visibility                     | “Elemento está visível.”                                              |
| `elementVisibleFail`       | `actual` when `see()` finds it missing/invisible              | “Elemento ausente ou invisível.”                                      |
| `flowExpected`             | Default `expected` for a failed `step()` (automation-failure) | “O fluxo é concluído sem exceção de automação nem erro de interface.” |
| `verificationExpected`     | Default `expected` in `verify()`                              | “A verificação passa.”                                                |
| `verificationFailed`       | Default `actual` in `verify()`                                | “A verificação falhou.”                                               |
| `axeExpected`              | `expected` for an axe violation, `{id}` = rule id             | “Nenhuma violação da regra do axe “{id}”.”                            |
| `axeAffected`              | `actual` for an axe violation, `{count}` = node count         | “{count} elemento(s) afetado(s).”                                     |
| `firstImpression`          | The observation/step label used by `usereye observe`          | “Primeira impressão”                                                  |

#### 4.2 `user-eye.js` — the issue model now reads the catalog

**~ EDITED import block** — adds `const { catalog, section, t } = require('./i18n');` (the engine now shares the single string loader the report already used; no drift).

**~ EDITED `see(target, label, options)`** — the default `expected`/`actual` for the visibility check now come from `issue.elementVisibleExpected / elementVisiblePass / elementVisibleFail` via `t(section(this.options.reportLocale, 'issue'), …)`. A caller-supplied `options.expected` still wins (behavior unchanged).

**~ EDITED `observe(name, options)` → issue-building loop** — the visual-perception issue title now uses the catalog's `perception` label (`Percepção visual` in pt) instead of the literal `Visual perception`, and its `expected` uses `issue.visualPerceptionExpected`. Finding `title`/`actual` themselves were already localized by the 7.1.1 work; this closes the last two English fragments in that issue.

**~ EDITED `step(name, fn, options)` → automation-failure branch** — `expected` now uses `issue.flowExpected`.

**~ EDITED `verify(title, condition, details)` → failed branch** — the fallback `expected`/`actual` now use `issue.verificationExpected / issue.verificationFailed`; explicit `details.expected`/`details.actual` still win.

**~ EDITED `runAxe(label, …)` → violation loop** — the issue title now uses the catalog's `accessibility` label (`Acessibilidade` in pt), `expected` uses `issue.axeExpected` (formatted with `{id}`), and `actual` uses `issue.axeAffected` (formatted with `{count}`). The axe `help`/`description` text itself is axe-core's own (English) data and is deliberately left as-is — it is a third-party string, not a UserEye catalog string.

#### 4.3 `usereye-observe.js` — the observation label is localized

**~ EDITED import block** — adds `const { section, t } = require('./i18n');`.

**~ EDITED `runObserve()`** — computes `firstImpressionLabel = t(section(config.reportLocale, 'issue'), 'firstImpression')` once and passes it to **both** `eye.scanVisualHealth(...)` and `eye.runAxe(...)`, replacing the hard-coded `'First impression'`. File/observation slugs are unaffected (`safeName` strips diacritics, so `primeira-impressao` keeps the same safe-slug shape as `first-impression`).

#### 4.4 `tests/i18n-issue-model.test.js` — new regression suite (3 tests)

**+ NEW** — pins the fix the same way `i18n-context.test.js` pins the 7.1.1 work:

1. _“every pack declares the issue-model section with the same keys”_ — en/pt/es/fr × 10 keys.
2. _“pt issue-model strings are translated, not the en text”_ — guards against a future copy-paste of the English pack.
3. _“issue-model templates format their placeholders”_ — asserts `axeExpected`/`axeAffected` substitute `{id}`/`{count}`.

#### 4.5 What was deliberately NOT changed

- **Zero existing test edits.** Result before == result after (199/0/2 → 202/0/2, the +3 being the new file).
- `package.json` / lockfile / version (`7.4.0`) — untouched, all 5 release checks still OK.
- The auto-flow step names (`Open target application`, `Adaptive exploration — …`) remain English — they are step/plan identifiers, same as every previous delivery, and renaming them is a product decision.
- The two graceful skips (firefox/webkit not installed).
- All docs, the Vela site, `live-server.js`, `verify-server.js`, `results-server.js`, config, types, CI, and the three fixes from the 7.4.0 report.

---

### 5. Minor observations (NOT fixed — deliberately left as-is)

1. `types/index.d.ts` types `reportLocale?: 'en' | 'pt'` while `config.js` accepts `en/pt/es/fr/auto`. Cosmetic type-only gap; the runtime is correct. Left alone.
2. Folder says `7.1.1-BALANCED` while `package.json` says `7.4.0` — naming drift only; `sync-version` confirms 7.4.0 is single-sourced where the checks look.
3. `README-DELIVERY.txt` says `verify-server.js` was excluded but the file is present and works. Harmless.
4. `vela-site/usereye.config.js` header comment references `/home/user/vela/…` — comment only, not executable.
5. es/fr packs translate the `findings`/`scan`/`misclick`/… sections but the _whole_ catalog is not a full es/fr translation of every leaf — by design (“detection packs”), and the new `issue` section is fully translated in all four packs regardless.
6. Auto-flow top-level step names remain English (§4.5) — the only remaining visible English in a `--report-locale pt` **auto** report; the **observe** report is now fully Portuguese.

---

### 6. Rating: 9.3 / 10

| Dimension                            | Score   | Why                                                                                                                                                                                            |
| ------------------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engineering rigor (tests, CI, gates) | 10      | 204 tests (202 pass / 0 fail / 2 graceful skips), self-auditing release checks, coverage floors, regression gates — rare discipline.                                                           |
| Architecture & product design        | 9.5     | Project-agnostic engine, policy in the target repo, plugin/protocol registry, parallel scheduler with destructive-queue, SARIF/dashboard/i18n.                                                 |
| Code quality                         | 9.5     | Prettier/eslint/tsc clean; `node --check` 88/88. The only defect found this round was a localization wiring gap, not logic.                                                                    |
| Delivery / portability               | 9.0     | The 7.4.0 delivery fixes (probes `loadPlaywright`, `live-server` redirects) verified working on a fresh machine; a few cosmetic nits remain (§5).                                              |
| Localization                         | 9.3     | en/pt complete and parity-tested through the issue model now; es/fr are detection packs (by design); auto-flow step names remain English.                                                      |
| Documentation & honesty              | 9.5     | Bilingual function-by-function guides, honest-limits sections, audit trail across 7.1.0 → 7.4.0 → this report.                                                                                 |
| **Overall**                          | **9.3** | Core is excellent and the previous delivery defects are closed; the remaining deductions are one minor i18n edge I just closed, the auto-flow step-name decision, and cosmetic packaging nits. |

Up from the previous **9.2**: the delivery/portability and localization deductions in the 7.4.0 report are now addressed and re-verified. To reach 9.7+: product decisions on the documented heuristics (misclick focus-revealed UI, consent-wall regex breadth, zoom technique) and localizing the auto-flow step names.

---

### 7. Reproduce everything

```bash
## inside UserEye/
npm install
sudo npx playwright install-deps chromium      # bare Linux only
node bin/usereye.js install-browsers
npm test                                       # 204 tests · 202 pass · 0 fail · 2 skip
npm run verify                                 # lint + format + types + tests + checks + coverage — exit 0

## live demo (delivery root)
node live-server.js                            # http://0.0.0.0:4200 (/vela/)

## observe, localized — the fixed report
cd UserEye && node bin/usereye.js observe http://127.0.0.1:4200/vela/ --axe --report-locale pt --out /tmp/pt
grep -n "Esperado\|Percepção" /tmp/pt/report.md
## → "… Percepção visual (Primeira impressão) … | A interface renderizada não apresenta este problema. …"

## probes (standalone site first: node vela-site/serve.js)
node probes/probe-site.js                      # ALL PROBES PASSED
node probes/probe-zoom.js                      # exit 0, overflowPx 0
```

`evidence/` in this delivery holds the before/after PT reports and the EN report, plus the full instrument log (`run-log.txt`).

— Agent Mode · 2026-09-06 · every number above is a paste of real command output.

## 2026-09-06-extension-runs-7.4-summary

<!-- origem: docs/audits/2026-09-06-extension-runs-7.4-summary.md -->

## UserEye 7.4 — Bateria de extensões vs. 10 sites reais

Data: 2026-09-06 · Probes: 8 categorias de extensão (ad-blocker, dark-reader, password-manager,
translator, coupon-helper, full-page-capture, react-devtools, volume-booster).

Cada probe simula o **efeito líquido** da categoria (bloqueio de rede, tema escuro forçado, texto
alongado por tradução, presença de DOM p/ injetores/gerenciadores, etc.) e mede a reação do app.
Nenhuma senha é enviada (`lockout:false`); `axe` desligado (CSP/TrustedScript de sites públicos).

> ⚠️ **Leitura honesta:** sites grandes (Amazon, Mercado Livre, Reddit, webnovel, comick, mangahub,
> olhardigital, Google Translate) servem _shell/consentimento/CAPTCHA_ a navegador headless. Os
> resultados abaixo refletem o **DOM acessível ao teste**, não necessariamente o app completo real.

### Resultado por site

| Site                    | ad-blocker        | dark-reader                               | password-mgr       | translator         | coupon-helper                   | full-page-capture | react-devtools         | volume-booster            |
| ----------------------- | ----------------- | ----------------------------------------- | ------------------ | ------------------ | ------------------------------- | ----------------- | ---------------------- | ------------------------- |
| webnovel.com/pt         | ✅ passed         | ✅ passed                                 | ⏭ skip (sem login) | ✅ passed          | ⏭ skip (sem e-commerce)         | ✅ passed         | ✅ passed (não-React)  | ✅ passed (sem mídia)     |
| reddit.com/r/Ultrakill  | ✅ passed         | ✅ passed                                 | ⏭ skip (sem login) | ✅ passed          | ⏭ skip                          | ✅ passed         | ✅ passed (não-React)  | ✅ passed (sem mídia)     |
| ultrakill.wiki.gg       | ✅ passed (1 blq) | ✅ passed                                 | ⏭ skip             | ✅ passed          | ⏭ skip                          | ✅ passed         | ✅ passed (não-React)  | ✅ passed (sem mídia)     |
| comick.dev              | ✅ passed         | ✅ passed                                 | ⏭ skip             | ✅ passed          | ⏭ skip                          | ✅ passed         | ✅ passed (não-React)  | ✅ passed (sem mídia)     |
| mangahub.io             | ✅ passed         | ✅ passed                                 | ⏭ skip             | ✅ passed          | ⏭ skip                          | ✅ passed         | ✅ passed (não-React)  | ✅ passed (sem mídia)     |
| olhardigital.com.br     | ✅ passed (6 blq) | ⚠️ **warning** (1 trecho baixo contraste) | ⏭ skip             | ✅ passed          | ✅ **passed** (preços DOM)      | ✅ passed         | ✅ passed (não-React)  | ✅ passed (sem mídia)     |
| amazon.com.br           | ✅ passed (shell) | ✅ passed                                 | ⏭ skip             | ⏭ skip (sem texto) | ⏭ skip (shell)                  | ✅ passed         | ✅ passed              | ✅ passed                 |
| mercadolivre.com.br     | ✅ passed         | ✅ passed                                 | ⏭ skip             | ✅ passed          | ⚠️ **warning** (preços não DOM) | ✅ passed         | ✅ **passed (React!)** | ✅ passed (sem mídia)     |
| translate.google.com.br | ✅ passed         | ✅ passed                                 | ⏭ skip             | ✅ passed          | ⏭ skip                          | ✅ passed         | ✅ passed              | ✅ passed                 |
| serpro.gov.br           | ✅ passed         | ✅ passed                                 | ⏭ skip             | ✅ passed          | ⏭ skip                          | ✅ passed         | ✅ passed (não-React)  | ✅ **passed (tem mídia)** |

### Achados relevantes

- **Mercado Livre** é **React**: `react-devtools` detectou mount root/árvore React → inspecionável.
- **olhardigital** é o único com **modo escuro problemático** (`dark-reader` warning: 1 trecho de
  baixo contraste sob tema escuro forçado) e é o único com superfície de e-commerce/preços em DOM
  que um injetor de cupom (Honey) conseguiria atuar.
- **Mercado Livre**: `coupon-helper` warning — há comércio, mas preços não aparecem como texto DOM
  claro na superfície acessada (sem o que o Honey escanear).
- **serpro.gov.br** tem `<audio>/<video>` na página (volume-booster com o que agir).
- Nenhum app colapsou ao bloquear anúncios/rastreadores (ad-blocker passed em todos) — conteúdo
  principal sobreviveu ao bloqueio de rede.

### Sobre os skips (comportamento correto)

`password-manager`, `coupon-helper` e `volume-booster` só rodam quando a superfície é relevante
(existe login / e-commerce / mídia). Nos sites que não expõem login na home ao headless, a probe
auto-pula (`skip`) — igual ao gating do `userJourney`; não é erro.

## 2026-09-06-independent-verification-7.4.1

<!-- origem: docs/audits/2026-09-06-independent-verification-7.4.1.md -->

## Independent verification — UserEye 7.4.1

**Date:** 2026-09-06
**Scope:** the shipped artifact `usereye-7.4.1-balanced.zip`, downloaded from the public
link and graded as a stranger would receive it — not a working tree, not a git checkout.
**Verdict:** the product is **not broken**. Every runtime gate passes. Two real defects
were found in the **release tooling**, both fixed, both now covered by regression tests.
**Rating: 9.4 / 10.**

---

### 1. Headline

| Question                                       | Answer                                                                |
| ---------------------------------------------- | --------------------------------------------------------------------- |
| Is the product broken?                         | **No.** 280/280 tests pass. 0 lint, 0 type, 0 format errors.          |
| Did the shipped zip pass its own release gate? | **Yes** as downloaded — 65 PASS · 0 FAIL · 1 SKIP.                    |
| Did I find real bugs?                          | **Yes — 2**, both in `scripts/pack-delivery.js`, both now fixed.      |
| Were they visible in the shipped bundle?       | One was: the zip you distributed contains a **duplicated entry**.     |
| Did I change runtime/product code?             | **No.** Not one byte of the `usereye` runtime was touched.            |
| Did I modify any existing test?                | **No.** Two new tests were appended; all 280 originals are untouched. |
| Known vulnerabilities in runtime deps?         | **0** (`npm audit --omit=dev`).                                       |

---

### 2. Environment actually used

Measured, not assumed — and it matches the environment `DELIVERY.md` claims.

```text
Debian 13 · Node v20.20.2 · npm 10.8.2 · git 2.47.3
Playwright 1.63.0 · Chrome for Testing 153.0.8010.12
Chromium Headless Shell 153.0.8010.12 · Firefox (v1503) · WebKit 26.6
```

`npm ci` installed 216 packages from the committed lockfile with no warnings. All **three**
browser engines were installed so that no suite would skip for environmental reasons, and
the tree was committed to git so the reproducibility gate could actually execute.

---

### 3. Every gate, and what it returned

| #   | Gate                              | Command                     | Result                                        |
| --- | --------------------------------- | --------------------------- | --------------------------------------------- |
| 1   | Tests (all 3 engines, clean tree) | `npm test`                  | **280 total · 280 pass · 0 fail · 0 skipped** |
| 2   | Lint                              | `npm run lint`              | clean — exit 0                                |
| 3   | Formatting                        | `npm run format:check`      | clean — exit 0                                |
| 4   | Types                             | `npm run typecheck`         | clean — exit 0                                |
| 5   | Repo/packaging checks             | `npm run checks`            | 6/6 OK — exit 0                               |
| 6   | Coverage floors                   | `npm run test:coverage`     | all floors satisfied — exit 0                 |
| 7   | Full pipeline                     | `npm run verify`            | **exit 0**                                    |
| 8   | Release gate on the real zip      | `scripts/verify-release.js` | **65 PASS · 0 FAIL · 1 SKIP** (as downloaded) |
| 9   | Security                          | `npm audit --omit=dev`      | **0 vulnerabilities**                         |

**Your documented claim of `280 total · 280 pass · 0 fail · 0 skipped` is exactly right.**
I reproduced it precisely once I gave the suite what it asks for. With Chromium only I saw
`277 pass · 3 skipped`; every skip named its own reason and its own remedy:

```text
## SKIP firefox not installed (npx playwright install firefox)
## SKIP webkit not installed (npx playwright install webkit)
## SKIP tree is dirty (null); reproducibility is not claimed
```

That is the "a gate that could not run never reports green" policy working as designed.

#### 3.1 A red result that was mine, not yours

My first `npm test` reported **10 failures**. That run is void — I had started the browser
download in parallel and the browser suites raced a half-written binary. The identical
command returned 0 failures once the download finished. Recording it because omitting a red
result I caused would be dishonest.

#### 3.2 Byte-reproducibility — claimed, doubted, then confirmed

`DELIVERY.md` §7 claims "the same commit packs to the same bytes". My first attempt
produced **two different hashes** and I initially suspected a false claim. It was not:
`pack:delivery` rewrites the `**Tests:**` line, which dirties the tree, and the tool
_documents_ that a dirty tree falls back to wall-clock time and drops the reproducibility
claim. It even prints `commit those docs and re-run`. Packing twice from a genuinely clean
tree:

```text
run1 = ee34f0bb7cc3298a6758aab69ef1e9a37ab1511b458116042f3110444156907d
run2 = ee34f0bb7cc3298a6758aab69ef1e9a37ab1511b458116042f3110444156907d
```

**Identical. The claim holds.**

#### 3.3 Coverage, read honestly

```text
core   config.js 95.27% · report.js 93.85% · sarif.js 93.94% · bin/usereye.js 77.33%  (floor 70%)
engine aggregate 62.35%  (floor 40%)   ·   overall first-party 73.13%  (floor 45%)
```

The near-0% files (`browser-perception.js` 0.79%, `browser-human.js` 0.90%) are **not
untested** — they are serialised into the page and run inside `page.evaluate`, where V8
coverage in the Node process cannot see them by construction. Tiered floors model that
honestly instead of hiding behind one flattering global number.

---

### 4. Behavioural verification — the product actually run

```text
live-server.js :4200  ->  200 on / and /vela/
path traversal ../../../etc/passwd  ->  404  (guard holds)
```

| Command                                                 | Outcome                                                 |
| ------------------------------------------------------- | ------------------------------------------------------- |
| `usereye --version`                                     | `7.4.1`                                                 |
| `usereye auto --url .../vela/ --mode quick`             | exit 0 · Quality 100/100 · gates PASS · video discarded |
| `usereye observe ... --axe --report-locale pt`          | exit **1** · 2 findings · report fully in Portuguese    |
| `usereye analyze --project ../demo/vela-site --dry-run` | exit 0 · 26 protocols planned · no browser launched     |
| `usereye export-issues result.json --format github`     | exit 0 · `[]` with a clear explanation                  |
| `usereye dashboard artifacts/vela-quick`                | serves the run · safe `127.0.0.1` default               |
| `probe-site.js` (29 checks)                             | **ALL PROBES PASSED**                                   |
| `probe-zoom.js`                                         | exit 0 · `overflowPx: 0` · `offenders: []`              |

Three behaviours that are easy to get wrong and that you got right:

- **`observe` exiting 1 is correct**, not a bug: it found 2 findings, and the contract is
  `0 | 1 | 2`. A tool that exits 0 when it found something is useless in CI.
- **The calm defaults are real, and they announce themselves.** The bare run printed
  `Video: discarded — clean run (recordVideo: 'on-failure')` and
  `held below medium confidence: 1`. Suppression **without** concealment: `result.json`
  still carries every finding in `issuesAll`.
- **The Portuguese report is genuinely localised** — headers, severities and finding prose
  (`Achados priorizados`, `Severidade`, `Confiança`, `Baixo`, `Alta`), not string-swapped
  English.

#### 4.1 The release gate, run against your actual download

```text
1. archive integrity   CRC-32 for all 194 files · usable modes · 0 symlinks · 0 unsafe paths
2. manifest honesty    fileCount/bytes recomputed · contentsSha256 recomputed · zipSha256 correctly absent
3. packaging clarity   7.4.1 agrees across package.json, CLI, CURRENT.md, DELIVERY.md
4. calm defaults       read from the EXTRACTED config.js — on-failure / stable-only / medium
5. live runs           extracted CLI vs extracted server, calm AND loud profile
6. exit codes          usage 2 · missing URL 2 · --help 0
7. definition of done  6/6
==== 65 PASS · 0 FAIL · 1 SKIP ====
```

The lone SKIP was `no side DELIVERY-MANIFEST.json beside the archive` — correct, because I
downloaded the bare zip without its `dist/` sidecar. It skipped rather than inventing a pass.

---

### 5. Defects found, and every change I made

Five files changed: two delivery docs, one release script, one test file (append-only), and
this report. **No product/runtime code was modified.**

#### 5.1 BUG 1 — the manifest miscounted, and the archive shipped a duplicate entry

**Severity: real. Present in the zip you distributed.**

**How I found it.** I repacked the bundle with your own `npm run pack:delivery`, then graded
the result with your own `verify-release.js`. It failed:

```text
verify-release: FAIL — manifest bytes (excludes the manifest) — got 1708007, want 1706917
```

The delta was **exactly 1090 bytes — the size of the root `DELIVERY-MANIFEST.json`.**

**Root cause.** `pack-delivery.js` stages the delivery root, then computes:

```js
const files = entries.filter(entry => !entry.directory);   // counts EVERY staged file
…
fileCount: files.length,
bytes: files.reduce((t, f) => t + statSync(...).size, 0),
```

…and only afterwards writes the freshly generated manifest into the staged tree. The
comment directly above those lines says the manifest "is excluded from both numbers", and
`contentsSha256` genuinely does exclude it (`path.basename(...) !== MANIFEST_NAME`) — but
`fileCount` and `bytes` never did.

This is invisible when packing from the **git worktree**, which has no root manifest (it is
generated into `dist/`). It appears the moment you pack from an **extracted bundle** — which
is what a consumer, a re-release, or any CI job that unzips first will do. The stale manifest
is then copied in as an ordinary file and counted.

**A second, worse symptom.** The stale manifest was already in `entries`, and the generated
one was then _pushed as an additional entry for the same path_:

```text
total entries: 234 | duplicate entries: ['usereye-7.4.1-balanced/DELIVERY-MANIFEST.json']
```

A zip carrying the same path twice is ambiguous — which copy an extractor keeps is
implementation-defined. This is precisely the class of "the box is broken even though the
code is fine" defect that `verify-release.js` exists to catch, and it caught it.

**Fix — `scripts/pack-delivery.js`, two edits.**

```js
// 1. counters: never count a manifest left behind by a previous pack
const files = entries.filter(entry => !entry.directory && path.basename(entry.relative) !== MANIFEST_NAME);

// 2. entries: drop any staged manifest before adding the generated one
const manifestEntry = `${wrapper}/${MANIFEST_NAME}`;
for (let i = entries.length - 1; i >= 0; i -= 1) {
  if (entries[i].relative === manifestEntry) entries.splice(i, 1);
}
fs.writeFileSync(path.join(stageRoot, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`);
entries.push({ relative: manifestEntry, directory: false });
```

**Verified after the fix:**

```text
total entries: 233 | duplicates: []
recomputed bytes 1707981 vs manifest 1707981 | match: True
recomputed files 194  vs manifest 194        | match: True
verify-release: ==== 68 PASS · 0 FAIL · 0 SKIP ====
```

#### 5.2 BUG 2 — the release script wrote a false statement into the shipped docs

**Severity: minor, but it lies in your two most important files.**

`pack-delivery.js:180` hardcoded the skip explanation for _any_ skip:

```js
const skipNote = summary.skipped ? ' (firefox/webkit not installed)' : '';
```

With Firefox and WebKit **both installed**, and the only skip being the dirty-tree
reproducibility gate, it still stamped this into `CURRENT.md` and `DELIVERY.md`:

```text
**Tests:** 280 total · 279 pass · 0 fail · 1 skipped (firefox/webkit not installed)
```

That sentence is simply untrue, and it is written by the very mechanism whose purpose is to
guarantee the docs can only quote a real run.

**Fix.** A new `parseSkipReasons(stdout)` reads the reasons Node already prints
(`# SKIP <reason>`), trims each to its headline (dropping the parenthetical hint and any
trailing clause), and `testSummaryLine` uses them. **Backwards compatible on purpose:**
callers that pass counts alone still get the historical wording, so your existing test at
`packaging.test.js:357` keeps passing **unmodified**.

```text
firefox+webkit missing -> 280 total · 278 pass · 0 fail · 2 skipped (firefox not installed; webkit not installed)
dirty tree only        -> 280 total · 279 pass · 0 fail · 1 skipped (tree is dirty)
nothing skipped        -> 280 total · 280 pass · 0 fail · 0 skipped
counts-only caller     -> 230 total · 228 pass · 0 fail · 2 skipped (firefox/webkit not installed)   [unchanged]
```

#### 5.3 DOC 1 — `DELIVERY.md` §3: a stale test count

```diff
- npm test                                     # 246 tests (browser suites skip without engines)
+ npm test                                     # 280 tests (browser suites skip without engines)
```

Line 5 of the same file said `280`. Line 73 said `246`. The suite reports **280 total**
regardless of installed engines (Node counts a skip in the total), so `246` was not "the
number without browsers" — just leftover from an earlier release. It survived because the
preflight only rewrites the `**Tests:**` header line; a count written into prose is
invisible to it.

#### 5.4 DOC 2 — `DELIVERY.md` §4: a command that cannot work as printed

```diff
- node ../demo/probes/probe-site.js                                          # 29 checks against /vela/
+ VELA_BASE=http://127.0.0.1:4200/vela node ../demo/probes/probe-site.js     # 29 checks against /vela/
```

§4's terminal 1 starts `live-server.js` on **:4200** with the demo under **`/vela/`**, but
`probe-site.js` defaults to `http://127.0.0.1:3000` (the _standalone_ server). Copy-pasting
the block as printed dies instantly:

```text
page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:3000/
```

**The code is right and I did not change it.** `probe-site.js:31` is deliberate and its
comment says the probe "is not welded to one port":

```js
const BASE = (process.env.VELA_BASE || process.argv[2] || 'http://127.0.0.1:3000').replace(/\/+$/, '');
```

Changing the default would break the `:3000` workflow, so I corrected the documentation
instead. Verified: **ALL PROBES PASSED** (29/29) against `:4200/vela`.

#### 5.5 New regression tests (append-only)

Your codebase's strongest habit is turning every past mistake into an executable gate, so
both bugs got one. Appended to `tests/packaging.test.js`; **no existing test was edited.**

| Test                                                                                       | Guards |
| ------------------------------------------------------------------------------------------ | ------ |
| `packaging: the skip note reports the reasons the run actually gave`                       | BUG 2  |
| `packaging: repacking an EXTRACTED bundle does not double-count or duplicate the manifest` | BUG 1  |

**Both were proven to be real gates**, not decoration — reverted against the original
`pack-delivery.js`, they fail:

```text
not ok 49 - packaging: the skip note reports the reasons the run actually gave
not ok 50 - packaging: repacking an EXTRACTED bundle does not double-count or duplicate the manifest
```

#### 5.6 Post-change proof

```text
npm test              280 total · 280 pass · 0 fail · 0 skipped
npm run verify        exit 0   (lint + format + typecheck + tests + checks + coverage)
verify-release.js     68 PASS · 0 FAIL · 0 SKIP
pack twice, clean     identical sha256  -> byte-reproducible
```

Test count went 280 → 282 in the source tree (the two new gates). The `**Tests:**` line in
`CURRENT.md` / `DELIVERY.md` is regenerated by your own preflight from a real run, so it
stays truthful automatically.

---

### 6. Rating — 9.4 / 10

Your last audit said 9.3. I arrive at **9.4** independently, and the extra tenth is
specifically for `verify-release.js` — which, notably, is the thing that caught BUG 1.

**What earns it**

1. **It grades the box, not the bench.** Most projects prove "the source is good" and ship
   an unverified artifact. Yours extracts the real zip and re-verifies CRC-32, Unix modes,
   symlinks, traversal, manifest arithmetic, then _runs the extracted CLI against the
   extracted server in both profiles_. Its header comment explains it exists because two
   real defects escaped a green suite. **That machinery found a third defect today, in its
   own packer.** A gate that catches its own author's mistake is the highest compliment I
   can pay a build system.
2. **Refusal to fake green.** Skips carry reasons _and_ remedies. Coverage floors are tiered
   to match the `page.evaluate` reality. `check-delivery-names` _notes_ the missing
   `repository` field instead of ignoring it. `pack:delivery` refuses to package a red suite.
3. **Honest defaults.** The calm profile suppresses noise while `result.json` keeps
   everything and the console states what was withheld.
4. **Docs that survive testing.** I verified rather than trusted, and the environment,
   version agreement, calm defaults, 29-check probe, localisation and reproducibility claims
   all held. Two prose slips in ~1,700 lines.
5. **Supply-chain discipline.** Playwright pinned and cross-checked across `package.json`,
   lockfile and Dockerfile by a dedicated script; 0 vulnerabilities; an enforced size ceiling.

**What holds it back from 10**

| ID  | Sev.  | Finding                                                                                                                                                                                                                                                                                     |
| --- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | minor | Version/count facts in **prose** are not machine-synced — only the `**Tests:**` header is (cause of DOC 1). Have `check-readme-examples.js` assert any `\d+ tests` in a fenced block.                                                                                                       |
| R2  | minor | Docs pair a `:4200` workflow with a `:3000`-defaulting probe (DOC 2). The README-example checker already parses code blocks; it could port-match documented commands.                                                                                                                       |
| R3  | minor | `package-check`: **192.7 kB against a 200 kB ceiling — 96% consumed.** One or two more modules and the release gate fails. Raise it deliberately or trim before it becomes an emergency.                                                                                                    |
| R4  | minor | `probe-site.js` dies on an unreachable target with a raw `triggerUncaughtException` dump. Failing loudly is right; a one-line catch saying "is the server on :3000 running?" would be kinder. **Not changed** — that is demo-harness ergonomics, not a defect.                              |
| R5  | note  | `private: false` with no `repository` / `homepage` / `bugs`. Your own tooling flags it and the reasoning is sound — it just has to be resolved before publishing.                                                                                                                           |
| R6  | note  | `verify-release.js` checks manifest arithmetic but not **duplicate entry names**; that is how BUG 1's second symptom reached a shipped zip. My new test covers it at the packer level — consider asserting it in the verifier too, so the _artifact_ is checked rather than the _producer_. |

**Bottom line: production-quality work with unusually mature release engineering. The
product itself is sound — I did not touch a single line of runtime code. The two bugs I
fixed were both in the machinery that builds and describes the box, and your own tooling
found the more serious one.**

---

### 7. Reproducing this audit

```bash
unzip usereye-7.4.1-balanced.zip && cd usereye-7.4.1-balanced
git init -q && git add -A && git commit -qm baseline     # so the reproducibility gate can run
cd UserEye && npm ci
npx playwright install --with-deps chromium firefox webkit   # wait for it to FINISH
npm run verify                                            # 280/280, exit 0
npm audit --omit=dev

## grade the artifact, not the worktree
npm run pack:delivery && node scripts/verify-release.js ../dist/usereye-7.4.1-balanced.zip

## behavioural, two terminals
node ../demo/live-server.js                               # :4200, demo at /vela/
node bin/usereye.js auto --url http://127.0.0.1:4200/vela/ --mode quick
VELA_BASE=http://127.0.0.1:4200/vela node ../demo/probes/probe-site.js
```

## 2026-09-06-remediation-r1-r2-r3-r6

<!-- origem: docs/audits/2026-09-06-remediation-r1-r2-r3-r6.md -->

## Remediation — R1, R2, R3, R6 from the 2026-09-06 independent verification

**Date:** 2026-09-06
**Follows:** [`2026-09-06-independent-verification-7.4.1.md`](2026-09-06-independent-verification-7.4.1.md)
**Requested:** R1 full · R2 full · R3 raise the ceiling · R4 ignore · R5 ignore · R6 add a note
**Result:** all four actioned. **286 tests · 286 pass · 0 fail · 0 skipped** · `npm run verify`
exit 0 · `verify-release` 68 PASS · 0 FAIL · 0 SKIP.
**No product/runtime code was touched.** Every change is in the release tooling, its tests,
or the delivery docs.

---

### 0. The first thing R1 did was catch a live bug

Before writing a line of the gate I re-read the docs, and the defect I had fixed one turn
earlier had **already gone stale again**:

```text
CURRENT.md:5   **Tests:** 282 total · 282 pass · 0 fail · 0 skipped
DELIVERY.md:73 npm test    # 280 tests (browser suites skip without engines)
```

Adding two regression tests moved the count 280 → 282, the header was refreshed
automatically, and the prose was not — because nothing owned it. That is R1 demonstrating
its own necessity inside a single release cycle, and it is why R1 was implemented as **two
mechanisms, not one**: a gate that fails, _and_ a refresher so the release heals itself
instead of merely stopping.

---

### 1. R1 — documented test counts can no longer rot

#### 1.1 The gate (fails loudly)

`scripts/check-readme-examples.js` now reads the authoritative total from the
`**Tests:**` line of `CURRENT.md` and asserts that **every** test count written anywhere in
the current docs agrees with it — prose, tables and code comments alike.

```text
readme-check: FAIL — ../DELIVERY.md:73 (test-count)
documents "280 tests" but CURRENT.md's **Tests:** line says 282 total.
  A count in prose is not refreshed by anything except this gate — update the sentence,
  or let `npm run pack:delivery` rewrite it from a real run.
```

**Scope is deliberate.** Only the four documents that claim to describe the _current_
release are checked: `CURRENT.md`, `DELIVERY.md`, the delivery `README.md` and
`UserEye/README.md`. `HISTORY.md`, `docs/audits/` and `docs/history/` are **excluded on
purpose** — they are records of past runs and must keep quoting the numbers they were
written with. `HISTORY.md` legitimately says "157 tests" and "10 tests"; flagging those
would be wrong.

#### 1.2 The refresher (heals silently)

`refreshTestSummary()` in `scripts/pack-delivery.js` already rewrote the `**Tests:**`
header from a real run. It now also rewrites `\b\d+ tests\b` in the same two documents,
deriving the total from the line it is already writing. Proven end to end:

```text
BEFORE   DELIVERY.md:73  npm test   # 282 tests
pack-delivery: tests 286 · pass 286 · fail 0 · skipped 0
AFTER    DELIVERY.md:73  npm test   # 286 tests
```

The gate is still the safety net: if a count ever appears in a document the refresher does
not own, the build stops instead of shipping a false number.

---

### 2. R2 — documented commands must point at a server that exists

The original defect: `DELIVERY.md` §4 started `live-server.js` on **:4200**, then told the
reader to run `probe-site.js`, which defaults to **:3000**. Pasting the block produced
`ERR_CONNECTION_REFUSED`.

The new check walks each shell-ish fenced block of the current docs and:

1. records every **harness server** the document starts, honouring `PORT=…` and `--port N`
   (servers started in an earlier block stay up — real workflows read "terminal 1 …
   terminal 2");
2. resolves the **effective target** of every probe invocation — `VELA_BASE=…`, then a
   positional URL, then the probe's own default;
3. fails if any probe target, or any explicit `host:port` URL, is not among the ports the
   document actually starts.

```text
readme-check: FAIL — ../DELIVERY.md:90 (port)
probe-site.js (default :3000) targets :3000, but this document only starts :4200.
  Pasting this block gives the reader ERR_CONNECTION_REFUSED. Start that server,
  or point the command at one that is running (probes accept VELA_BASE=…).
```

**Ports are read from the harness sources at run time, never hardcoded in the gate.**
`live-server.js` is parsed for `process.env.PORT || 4200`, `probe-site.js` for its
`|| 'http://127.0.0.1:3000'` fallback, and so on. Change a default in the code and the gate
moves with it — otherwise the checker would become one more thing that rots.

Three design decisions that keep it free of false positives:

- **Only shell-ish fences are scanned** (`bash`, `sh`, `shell`, `console`, `text`, untagged).
  The GitHub Action example in §6 is a ```yaml block whose `url: http://127.0.0.1:3000` is
  the _user's_ app, not our harness — correctly ignored.
- **The rule only applies once a document starts a server.** `UserEye/README.md` is the
  product manual; its `--url http://127.0.0.1:3000` means "your application" and it never
  starts a harness server, so nothing is asserted there.
- **The dashboard is excluded** from both starts and targets: it is a viewer, never a run
  target.

> A real trap avoided: matching server scripts by suffix makes `usereye-observe.js` match
> `serve.js` (`ob|serve.js`). The regex therefore anchors on a path boundary and compares
> basenames exactly. `UserEye/README.md:172` was a live false positive during development.

---

### 3. R3 — size ceilings raised deliberately

Measured before: the package was **96.3% of the packed ceiling and 97.3% of the unpacked
ceiling**. One new module would have failed a release rather than warned anyone. The
unpacked ceiling was in fact the tighter of the two, which the original finding understated.

| Ceiling    | Was       | Now              | In use   | Headroom   |
| ---------- | --------- | ---------------- | -------- | ---------- |
| packed     | 200 000 B | **260 000 B**    | 192.7 kB | 74.1% used |
| unpacked   | 700 000 B | **950 000 B**    | 681.4 kB | 71.7% used |
| file count | 90        | 90 _(unchanged)_ | 66       | 73.3% used |

The file-count ceiling was left alone: at 73% it already has room, and raising a limit that
is not under pressure only weakens it.

**Two stale comments were fixed while in there** — both `scripts/check-package.js` and
`tests/package-size.test.js` still described a "150 kB" ceiling that had been 200 kB since
7.2. That is the same doc-rot class as R1, in code comments.

**The number is no longer duplicated unsafely.** The ceiling lives in two places by design
(the release gate and the test suite), so a new test reads the literal out of
`check-package.js` and fails if the two disagree — the same cross-reading technique
`check-playwright-version.js` already uses for the pinned Playwright version. Verified to
fail when one side is changed alone.

---

### 4. R6 — the gap is now documented where it will be read

R6 was the observation that `verify-release.js` grades the artifact thoroughly but never
asserts that **entry names are unique** — which is exactly how the duplicate
`DELIVERY-MANIFEST.json` reached a shipped zip. Per instruction this is recorded as a note
rather than implemented.

The note sits **inside section 1 of `verify-release.js`**, immediately after the top-level
checks, so anyone extending archive integrity reads it before adding code — not buried in a
report. It states plainly that CRC-32, lengths, modes, paths and the top-level count all
pass on a duplicated entry; that the shipped 7.4.1 zip carried one; that it was caught by
manifest arithmetic rather than by design; where the producer-side regression gate lives;
and what closing the gap would mean. A one-line pointer was added to the file's header
docblock so the gap is visible from the summary:

```text
 * NOT checked here (known gap, R6): duplicate entry names. See the note in section 1.
```

**R4 and R5 were left untouched as instructed** — `probe-site.js` still fails loudly on an
unreachable target, and `package.json` still declares no `repository`.

---

### 5. Every function created or edited, and what it means

#### `UserEye/scripts/check-readme-examples.js` — the bulk of R1 and R2

| Function                                       | Status     | What it means                                                                                                                                                                                                                      |
| ---------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `extractBlocks(markdown)`                      | **edited** | Was hardwired to return only `js`/`ts` blocks. Now returns **every** fenced block with its language and starting line, so all three checks share one parser instead of three drifting ones.                                        |
| `checkFile(filePath)`                          | **edited** | Unchanged behaviour: it now applies the `js`/`ts` filter itself. Still `node --check` for JS and `tsc --noEmit` for TS.                                                                                                            |
| `detectDeliveryRoot(explicit)`                 | **new**    | Finds the delivery bundle (`CURRENT.md` + `demo/` + `UserEye/package.json`). Returns `null` in a standalone package checkout so checks 2–3 **skip with a reason** rather than pass silently. Accepts an explicit root for testing. |
| `currentDocs(deliveryRoot)`                    | **new**    | The allow-list of documents that claim to be current. Encodes the decision to exclude histories.                                                                                                                                   |
| `authoritativeTestTotal(deliveryRoot)`         | **new**    | Reads `**Tests:** N total` from `CURRENT.md` — the single source of truth R1 compares against.                                                                                                                                     |
| `checkTestCounts(docs, total, failures)`       | **new**    | **R1.** Scans every line for `N tests` / `N total ·` and reports each disagreement with file, line and remedy.                                                                                                                     |
| `collectHarnessSources(demoDir)`               | **new**    | Walks `demo/` and loads the source of the four harness servers and two probes.                                                                                                                                                     |
| `defaultPortOf(source)`                        | **new**    | Extracts a server's default port from its own code (`process.env.PORT \|\| N`, else `port: N`). Why the gate cannot go stale.                                                                                                      |
| `defaultBaseOf(source)`                        | **new**    | Extracts a probe's default base URL from its `\|\| 'http://…'` fallback.                                                                                                                                                           |
| `portOfUrl(url)`                               | **new**    | Pulls the port out of a URL; the common currency between "started" and "targeted".                                                                                                                                                 |
| `buildRegistry(demoDir)`                       | **new**    | Assembles `{servers, probes}` → port maps, read from source at run time.                                                                                                                                                           |
| `checkPortCoherence(docs, registry, failures)` | **new**    | **R2.** Two passes per block (starts, then targets), accumulating started ports across a document.                                                                                                                                 |
| `parseArgv(argv)`                              | **new**    | Adds `--root <deliveryRoot>`, mirroring `check-delivery-names.js`, so the gates can be pointed at synthetic bundles and proven to fail.                                                                                            |
| `main()`                                       | **edited** | Orchestrates the three checks; preserves the historical contract that explicit file arguments run **only** the parse check.                                                                                                        |

#### `UserEye/scripts/pack-delivery.js`

| Function                                 | Status     | What it means                                                                                                                                                                                                     |
| ---------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `refreshTestSummary(deliveryRoot, line)` | **edited** | Second half of **R1**. Still rewrites the `**Tests:**` header; now also rewrites `N tests` in the same two docs, deriving the total from the line it is already writing. Signature unchanged, so no caller moved. |

#### `UserEye/scripts/check-package.js`

| Function | Status     | What it means                                                                                                                                                                 |
| -------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main()` | **edited** | **R3.** `maxPackedBytes` 200 000 → 260 000, with a comment recording the measurement that justified it. Stale "150 kB" docblock corrected. `--max-packed-kb` still overrides. |

#### `UserEye/scripts/verify-release.js`

| Change                       | Status                             | What it means                                                                                                            |
| ---------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Section-1 note + header line | **note only, no behaviour change** | **R6.** Documents that duplicate entry names are not asserted, why that matters, and where the producer-side gate lives. |

#### `UserEye/tests/package-size.test.js`

| Item                                                                        | Status       | What it means                                                                       |
| --------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------- |
| `PACKED_CEILING_BYTES`, `UNPACKED_CEILING_BYTES`                            | **edited**   | **R3**, raised to 260 000 / 950 000 with the measurements recorded.                 |
| `FILE_COUNT_CEILING`                                                        | unchanged    | Left at 90 on purpose; commented so the omission reads as a decision.               |
| `fs` import                                                                 | **added**    | Needed by the new cross-read test.                                                  |
| `packaging: the packed ceiling is not duplicated into two drifting numbers` | **new test** | Reads the literal out of `check-package.js` and fails if the two ceilings disagree. |

#### `UserEye/tests/repo-hygiene.test.js`

| Item                                                                      | Status         | What it means                                                                                                                   |
| ------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `docBundle({current, delivery})`                                          | **new helper** | Builds a synthetic delivery bundle — docs plus a stub `live-server.js` and `probe-site.js` carrying real default-port syntax.   |
| `runDocGate(bundle)`                                                      | **new helper** | Runs the checker against that bundle via `--root`.                                                                              |
| `…a test count typed into prose must match the **Tests:** header (R1)`    | **new test**   | Proves the R1 gate fails on `246 tests` vs a 282 header, and passes when corrected.                                             |
| `…a documented command must target a server the doc starts (R2)`          | **new test**   | Reproduces the exact §4 defect (live-server on :4200, probe defaulting to :3000) and proves the fixed form passes.              |
| `…the port gate follows the harness source instead of a hardcoded number` | **new test**   | Moves `live-server.js` to :8080 and asserts a previously-green doc now fails — proving the gate reads the code, not a constant. |

**No existing test was modified in this round.** Four were added (286 total, up from 282).

#### Delivery documents

| File                            | Change                                                       |
| ------------------------------- | ------------------------------------------------------------ |
| `DELIVERY.md:73`                | `280 tests` → `282` → auto-refreshed to `286` by the packer. |
| `CURRENT.md:5`, `DELIVERY.md:5` | `**Tests:**` refreshed from a real run, as always.           |

---

### 6. Verification

Every gate, after all changes:

```text
npm test                    286 total · 286 pass · 0 fail · 0 skipped
npm run lint                clean
npm run format:check        all files match Prettier
npm run typecheck           clean
npm run checks              6/6 OK
  readme-check: OK — 16 code block(s) parse cleanly.
  readme-check: OK — 3 documented test count(s) agree with CURRENT.md (286 total).
  readme-check: OK — 9 documented command target(s) match the servers the docs start.
  package-check: OK — 66 files, packed 192.7 kB (ceiling 260 kB), unpacked 681.4 kB.
npm run test:coverage       all floors satisfied
npm run verify              exit 0
verify-release.js           68 PASS · 0 FAIL · 0 SKIP
```

Each new gate was proven to **fail** before being trusted:

| Gate | Injected defect                            | Result                                                |
| ---- | ------------------------------------------ | ----------------------------------------------------- |
| R1   | restore `# 280 tests` against a 282 header | FAIL `(test-count)` at `DELIVERY.md:73`               |
| R2   | restore the original `probe-site.js` line  | FAIL `(port)` at `DELIVERY.md:90`, `:3000` vs `:4200` |
| R2   | point a documented URL at `:9999`          | FAIL `(port)` at `DELIVERY.md:87`                     |
| R2   | move `live-server.js` to `:8080`           | FAIL — stale doc caught, gate follows the code        |
| R3   | set the two ceilings to different values   | FAIL — drift guard                                    |

Backwards compatibility was checked explicitly, since `check-readme-examples.js` has an
existing caller in `npm run checks` and an existing assertion in the suite:

```text
node scripts/check-readme-examples.js            -> 3 OK lines, exit 0
node scripts/check-readme-examples.js README.md  -> legacy contract, parse check only, exit 0
node scripts/check-readme-examples.js --root ..  -> full run against an explicit bundle
node scripts/check-readme-examples.js --root /tmp-> FAIL, not a delivery bundle
```

The `16 code block(s)` figure is unchanged, so the pre-existing behaviour is bit-for-bit
intact.

---

### 7. Rating — unchanged at 9.4 / 10

Nothing here changes the product; it hardens the machinery that describes and ships it.
Three of the six findings are now enforced by executable gates rather than by discipline,
one is documented where it will be read, and two were deliberately left open.

The remaining distance to 10 is no longer about defects. It is R5: the package declares
`private: false` with no `repository`, `homepage` or `bugs`. Your own tooling has been
saying so on every run. Everything else in this bundle now proves itself.

## 2026-09-06-verification-report-7.4.0

<!-- origem: docs/audits/2026-09-06-verification-report-7.4.0.md -->

## UserEye 7.4.0 — Verification, Fixes & Function Guide

**Date:** 2026-09-06
**Package audited:** `usereye-7.4.0.zip` (inner folder `UserEye-7.1.1-BALANCED`, package.json `7.4.0`)
**Delivered as:** `usereye-7.4.0-verified.zip`
**Environment:** Node v20.20.2 · npm 10.8.2 · Playwright 1.63.0 (Chrome Headless Shell 153.0.8010.12) · Debian 13 sandbox · app served live at `http://127.0.0.1:4200` via the shipped `live-server.js`
**Method:** instrumented verification only — every claim below is the output of a real command (`node --check`, `npm install`, `npm test`, full `npm run verify` stages, live CLI runs against the shipped Vela site, `curl` URL matrix, in-process timing instrumentation). Nothing was guessed.

**Resumo em português:** o núcleo do seu projeto **não estava quebrado** — 201 testes, 199 passam, 0 falham (2 skips legítimos: firefox/webkit não instalados), e o pipeline `verify` inteiro fica verde. Mas a verificação ao vivo achou **3 defeitos reais e reproduzíveis** fora e dentro do pacote:
(1) o protocolo `touch-pointer` congelava por 15 s e falhava **falsamente** sempre que o toque navegava para outra página (bug de engine, corrigido em `protocols/input.js`);
(2) o site demo montado em `/vela/` pelo `live-server.js` carregava **sem CSS/JS e com todos os links de navegação quebrados** (54 referências a `/assets/*` e ~150 links raiz davam 404 — corrigido com redirects 301 no servidor);
(3) `probes/probe-site.js` e `probe-zoom.js` tinham `require` com **caminho absoluto da sua máquina** (`/home/user/usereye-work/...`) e crashavam em qualquer outro computador.
Foram 4 arquivos editados, **zero mudanças de comportamento nos testes existentes** (199/0/2 antes e depois), e cada correção está explicada função por função no §4. Avaliação: **9.2 / 10**.

---

### 1. Bottom line

Your project was **not broken** in any of its contracts:

| Check                                 | Instrument                                                     | Result on arrival                                                                                                             |
| ------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Syntax of all 88 first-party JS files | `node --check` each                                            | PASS, 0 errors                                                                                                                |
| Dependencies resolve on npm           | `npm install`                                                  | OK (216 packages; `playwright@1.63.0` and `axe-core@4.13.0` verified to exist on the registry)                                |
| Test suite                            | `npm test`                                                     | **201 tests · 199 pass · 0 fail · 2 skip** (firefox/webkit not installed — the tests skip gracefully by design)               |
| Lint                                  | `npm run lint` (eslint)                                        | PASS                                                                                                                          |
| Formatting                            | `npm run format:check` (prettier)                              | PASS                                                                                                                          |
| Types                                 | `npm run typecheck` (tsc)                                      | PASS                                                                                                                          |
| Release checks                        | `npm run checks`                                               | 5/5 OK (version single-sourced, API surface, README examples, playwright version pin, package size 178.7 kB < 200 kB ceiling) |
| Coverage gates                        | `npm run test:coverage`                                        | OK — all floors satisfied                                                                                                     |
| Live run (auto)                       | `node bin/usereye.js auto --url …/vela/ --mode quick`          | exit 0, full artifacts                                                                                                        |
| Live run (observe + axe + pt)         | `node bin/usereye.js observe …/vela/ --axe --report-locale pt` | exit 0, 18 artifact files (report.html/md, trace.zip, webm, screenshots, JSON)                                                |

What the live verification **did** find were three real, reproducible defects — one of them inside the
npm package (engine), two in the delivery harness around it. All three are fixed, function by
function, in §4. No existing test was modified; the suite result is identical before and after
(199 pass / 0 fail / 2 skip).

**Rating: 9.2 / 10** (breakdown in §6).

---

### 2. How the app was checked live (as requested)

The delivery was served by its own server, exactly as `README-DELIVERY.txt` documents:

```bash
node live-server.js        # http://127.0.0.1:4200  → /  ·  /vela/…  ·  /docs/…
```

Then the tool was run against its own demo site (both quick auto and full observe), the shipped
probes were executed, and the server was probed with a `curl` URL matrix (before/after the fix —
see §4.2). The engine bug was isolated by temporarily instrumenting `touchPointer()` and
`withContext()` with `Date.now()` timestamps (instrumentation fully reverted afterwards;
`protocols/input.js` and `protocol-runner.js` were restored byte-identical to your zip before the
real fix was applied — verified with `diff` against the original archive).

---

### 3. What was broken — summary

| #   | Severity           | Where                                           | Symptom                                                                                                                                                                                    | Root cause                                                                                                                                                                                                                                                                                                         |
| --- | ------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **major (engine)** | `UserEye/protocols/input.js` → `touchPointer()` | Protocol `touch-pointer` dies with `Timeout after 15000 ms` and records a false `major` issue ("Concurrent protocol failed") whenever the first visible touch target navigates away on tap | `await target.textContent()` evaluated **after** `target.tap()` inside the `return` statement: the tap navigates (e.g. logo → home), the locator re-resolves against the new page where the element no longer exists, and Playwright waits its default 30 s element timeout — the scheduler kills the task at 15 s |
| 2   | major (delivery)   | `live-server.js`                                | Demo at `/vela/` renders unstyled, JS dead, **every** nav link 404s — the documented quick start ships a broken demo; also flooded reports with 49 console errors + 12 HTTP 404 per run    | The Vela site is authored with root-absolute URLs (`/assets/…`, `/product`, `/pricing`… — it is built to be mounted at `/` by `vela-site/serve.js`), but `live-server.js` mounts it under `/vela/` with no mapping for root-absolute paths                                                                         |
| 3   | minor (delivery)   | `probes/probe-site.js`, `probes/probe-zoom.js`  | Both crash with `MODULE_NOT_FOUND` on any machine but the original dev box                                                                                                                 | `require('/home/user/usereye-work/UserEye/node_modules/playwright')` — a hardcoded absolute path from the development machine, shipped inside the zip                                                                                                                                                              |

Why #1 never showed before: it only triggers when the first _visible_, _safe_ touch target
navigates on tap. Unstyled (asset-broken) pages happened to expose a skip-link first, whose tap
stays on the same page — so the bug was masked by bug #2. Fixing #2 unmasked #1. That is also why
your own probe runs (via `vela-site/serve.js`, where the first target differs) never saw it.

---

### 4. What changed — function by function

Exactly **4 files** were edited. Nothing else. (`+ NEW` = function created by this audit;
`~ EDITED` = your function, minimally patched.)

#### 4.1 `UserEye/protocols/input.js` — the engine fix (the only change inside the npm package)

**~ EDITED `touchPointer(runner)`** — _mobile touch-target protocol: finds the first visible,
non-dangerous tappable control, hit-tests it for occlusion, taps it, and reports whether the tap
changed app state._

The edit (one line moved, one comment added):

```js
// BEFORE (inside the return statement, AFTER the tap):
return { status: 'passed', details: {
  target: await target.textContent(),   // ← hangs if the tap navigated away
  …
// AFTER (captured BEFORE the tap):
const targetText = await target.textContent();   // element still attached here
await target.tap({ timeout: 5000 });
…
return { status: 'passed', details: { target: targetText, … } };
```

Measured effect (same site, same mode, same machine):

| metric                         | before                                          | after            |
| ------------------------------ | ----------------------------------------------- | ---------------- |
| `touch-pointer` status         | failed                                          | **passed**       |
| `touch-pointer` duration       | 15000 ms (killed)                               | **1037 ms**      |
| Step 03 "Concurrent protocols" | FAIL (15.0 s)                                   | **PASS (2.3 s)** |
| Overall quality score          | 90/100                                          | **100/100**      |
| False "major" issue in report  | 1 ("Concurrent protocol failed: touch-pointer") | **0**            |

Everything else in `touchPointer` (dangerous-pattern filter, occlusion hit-test, before/after
state hashing via `fnv`) is untouched.

#### 4.2 `live-server.js` — demo server fix (delivery harness, not the npm package)

**+ NEW `sendRedirect(res, location)`** — sends an HTTP `301` with a `Location` header and
`Cache-Control: no-store`. Small helper so the redirect logic below stays one line, mirroring the
style of the existing `send()`.

**~ EDITED request handler (final `else` branch, right before the old `404`)** — keeps every
existing route identical (`/` home, `/vela…`, `/docs…` all handled earlier and untouched) and adds
one fallback: if a root-level path (`/product`, `/assets/css/tokens.css`, `/sitemap.xml`, …) maps
to a **real file** (or clean URL) inside `vela-site/site/`, the server answers `301 → /vela/<same
path + query string>` instead of `404`. The existence check doubles as a traversal guard
(`velaTarget.startsWith(VELA)`), consistent with the guard already used in `serve()`; unknown
paths (`/wp-admin`, `/etc/passwd`…) still get `404` exactly as before.

Why this shape of fix: the demo's HTML legitimately uses root-absolute URLs because it was
designed to be mounted at `/` by `vela-site/serve.js`. Redirecting at the server keeps the site's
HTML byte-identical (your code), keeps `/` as the delivery home, and repairs the `/vela/` mount
documented in `README-DELIVERY.txt`.

Measured effect — `curl` matrix, before → after:

| URL                                                                                 | before                | after                                                               |
| ----------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------- |
| `/vela/`                                                                            | 200                   | 200 (unchanged)                                                     |
| `/product` `/pricing` `/about` `/blog` `/contact` `/legal` `/blog/scaling-…-events` | 404 ×7                | **301 → 200** (query strings preserved, e.g. `/blog?tag=changelog`) |
| `/assets/css/tokens.css` (+53 more asset refs)                                      | 404, CSS never loaded | **301 → 200 `text/css`** (JS → `text/javascript`)                   |
| `/sitemap.xml` `/robots.txt`                                                        | 404 ×2                | **301 → 200**                                                       |
| `/docs/…`, `/`                                                                      | 200                   | 200 (unchanged)                                                     |
| `/wp-admin`, `/etc/passwd`                                                          | 404                   | 404 (unchanged — guard intact)                                      |

End-to-end effect on the tool's own report against `/vela/`: **unexpected browser errors 98 → 0**,
quality gates **FAIL → PASS**, and a Playwright-driven page check now logs **0 console errors**
on `/vela/`.

#### 4.3 `probes/probe-site.js` and `probes/probe-zoom.js` — portability fix

**+ NEW `loadPlaywright()`** (identical in both files) — resolves the `playwright` module by
trying, in order: (1) the original dev-machine absolute path (so nothing changes on the machine
the path came from), (2) `../UserEye/node_modules/playwright` relative to the probe file (this
delivery), (3) a plain `require('playwright')` (CWD/`NODE_PATH`). If all fail it throws a
helpful message ("run `npm install` inside UserEye/ first") instead of a raw `MODULE_NOT_FOUND`
stack. The one-line `const { chromium } = …` at the top of each probe now calls this helper; every
other line of both probes is untouched.

Measured effect: `node probes/probe-site.js` crashed before, now runs its full battery against
`vela-site/serve.js` (port 3000) — **ALL PROBES PASSED** (23 checks: modal a11y, focus management,
charts, tabs, pricing toggle, blog filter/search, contact form validation, 404 semantics, zero
console errors). `node probes/probe-zoom.js` exits 0 and reports `overflowPx: 0, offenders: []`
at zoom 200%.

#### 4.4 What was deliberately NOT changed

- **Zero test edits.** The suite is byte-identical; result before == result after (199/0/2).
- `package.json` / lockfile / version numbering — untouched (`7.4.0`, all 5 release checks still OK).
- The two legitimate skips (firefox/webkit browsers not installed in this sandbox; the tests skip
  gracefully by design — run `npx playwright install firefox webkit` to execute them).
- All docs, the Vela site HTML/CSS/JS, `verify-server.js`, `results-server.js`, config, types, CI.

---

### 5. Minor observations (NOT fixed — deliberately left as-is)

1. `live-server.js` matches the `/vela` prefix with `p.startsWith('/vela')`, so a URL like
   `/velafoo` is also routed into the demo. Pre-existing, harmless, one-line quirk — left alone.
2. The demo's logo links (`href="/"`) land on the delivery home, not `/vela/`. That is a content
   choice in the site HTML (your code); the redirect fix intentionally does not touch `/`.
3. Folder says `7.1.1-BALANCED` while `package.json` says `7.4.0` — cosmetic naming drift only;
   `sync-version` confirms 7.4.0 is correctly single-sourced everywhere the checks look.
4. `vela-site/usereye.config.js` header comment still references `/home/user/vela/…` — comment
   only, not executable.
5. `README-DELIVERY.txt` says `verify-server.js` was excluded from BALANCED, but the file is
   present. It works (starts on :4200-style static serving); harmless inconsistency.
6. `browser-perception.js` / `browser-human.js` / `browser-gaze.js` etc. show ~1–3% unit coverage —
   they are exercised by the live browser tests instead; your coverage gates already account for
   this (aggregate floors are satisfied).

---

### 6. Rating: **9.2 / 10**

| Dimension                            | Score   | Why                                                                                                                                                                           |
| ------------------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engineering rigor (tests, CI, gates) | 10      | 201 tests, self-auditing release checks (API surface, README examples, version pinning, package-size ceiling), coverage floors, regression gates. Rare discipline.            |
| Architecture & product design        | 9.5     | Project-agnostic engine, policy in the target repo, plugin/protocol registry, parallel scheduler with serial queue for destructive ops, SARIF/dashboard/i18n.                 |
| Code quality                         | 9       | Clean, commented, prettier/eslint/tsc clean; the one engine bug found was an ordering subtlety (await-after-navigation), not sloppiness.                                      |
| Delivery/portability                 | 7.5     | The shipped zip crashed its own probes on any other machine and its documented demo quick-start was broken (unstyled, dead links). This is where both delivery defects lived. |
| Documentation & honesty              | 9.5     | Bilingual function-by-function change guides, honest limits ("Leitura honesta…" in the 7.4 extension-runs summary), roadmap, audit trail across versions.                     |
| **Overall**                          | **9.2** | Core is excellent; the gaps were at the edges (delivery harness + one protocol edge case). All closed now.                                                                    |

Deducted from the previous 9.4: the `touchPointer` false-failure is a user-facing engine defect
(any site whose first visible mobile control is a logo/home link gets a false `major` issue), and
two of three defects were "works on my machine" portability issues — exactly the class a
delivered zip must not contain.

---

### 7. Reproduce everything

```bash
npm install                                        # inside UserEye/
sudo npx playwright install-deps chromium          # bare Linux only (README says so)
node bin/usereye.js install-browsers
npm test                                           # 201 tests · 199 pass · 0 fail · 2 skip
npm run lint && npm run format:check && npm run typecheck && npm run checks && npm run test:coverage

## live demo (delivery root)
node live-server.js                                # http://127.0.0.1:4200 (/vela/)
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" -L http://127.0.0.1:4200/assets/css/tokens.css
## → 200 text/css  (was 404)

## engine fix proof
cd UserEye
node bin/usereye.js auto --url http://127.0.0.1:4200/vela/ --mode quick --out /tmp/q
## → step 03 PASS, touch-pointer passed ~1s, quality 100/100, 0 unexpected browser errors

## probes (needs the standalone site: node vela-site/serve.js in another terminal)
node probes/probe-site.js                          # ALL PROBES PASSED
node probes/probe-zoom.js                          # exits 0, 0 overflow offenders
```

— Agent Mode · 2026-09-06 · every number above is a paste of real command output.

## 2026-09-07-arena-review-and-fix

<!-- origem: docs/audits/2026-09-07-arena-review-and-fix.md -->

## 2026-09-07 — Independent review, one fix, and the evidence behind both

**Reviewer:** Arena.ai agent · **Subject:** `usereye` 7.5.1 (`usereye-7.5.1-balanced`)
**Method:** nothing in this document is inferred from reading the code. Every claim below is
the recorded output of a command that was actually executed against the extracted bundle.

**Verdict:** every gate the repository ships was green on a clean checkout except **one**, in
the release grader. A second pass, prompted by the author asking whether the newly added
**review modes** were tested, found that they had **no automated coverage at all** and shipped
**two real defects**. All three problems are fixed and gated here.

**Rating: 8.9 / 10 as received · 9.4 / 10 after the fixes in this report.**

> Revised down from an initial 9.4 once §7 established that ~1 100 lines of new
> `review-modes/` code carried zero tests and that the untested path silently audited the
> wrong page. The engineering discipline described in §5 is real; it simply had not been
> extended to the newest feature.

---

### 1. Environment the measurements were taken on

| Item       | Value                                                                                  |
| ---------- | -------------------------------------------------------------------------------------- |
| OS         | Debian (sandbox), x86-64                                                               |
| Node       | v20.20.2 (`engines: >=20.11`)                                                          |
| npm        | 10.8.2                                                                                 |
| Playwright | 1.63.0 (pinned in `package.json` **and** `package-lock.json`)                          |
| Browser    | Chrome Headless Shell 153.0.8010.12 (`chromium-headless-shell` v1243)                  |
| Install    | `npm ci` — 216 packages, no build errors, no audit blockers                            |
| git        | 2.47.3 present, but **the extracted tree is not a checkout** (`.git` is never shipped) |

That last row is not trivia. It is the exact condition that exposed the defect in §3.

### 2. What was measured, and what it returned

Every command below was run from the extracted bundle, in the order shown.

| #   | Command                                                  | Result                                                |
| --- | -------------------------------------------------------- | ----------------------------------------------------- |
| 1   | `npm ci`                                                 | OK — 216 packages                                     |
| 2   | `npx playwright install --with-deps chromium`            | OK — 153.0.8010.12                                    |
| 3   | `npm test`                                               | **425 total · 422 pass · 0 fail · 3 skipped**         |
| 4   | `npm run lint` (eslint)                                  | clean, zero findings                                  |
| 5   | `npm run format:check` (prettier)                        | "All matched files use Prettier code style!"          |
| 6   | `npm run typecheck` (`tsc --noEmit`)                     | clean                                                 |
| 7   | `npm run checks` (9 sub-gates)                           | all OK                                                |
| 8   | `npm run test:coverage`                                  | **all floors satisfied**; overall first-party 89.39 % |
| 9   | `node bin/usereye.js doctor`                             | all required checks passed                            |
| 10  | `node bin/usereye.js auto --url … --mode quick`          | exit 0 · Quality 100/100 · gates PASS                 |
| 11  | `node bin/usereye.js observe … --axe --report-locale pt` | exit 1 (2 findings — documented contract)             |
| 12  | `node demo/probes/probe-site.js`                         | **29/29 PASS** — "ALL PROBES PASSED"                  |
| 13  | `npm run pack:delivery`                                  | OK — 791.6 kB, 247 files + manifest                   |
| 14  | `npm run verify:release`                                 | **67 PASS · 1 FAIL · 0 SKIP** ← the only defect       |

#### On the three skips in step 3

The shipped docs quote _2_ skipped; this run produced _3_. That is **not** a regression, and
the extra skip is self-describing:

```
## SKIP firefox not installed (npx playwright install firefox)
## SKIP webkit not installed (npx playwright install webkit)
## SKIP tree is dirty (null); reproducibility is not claimed
```

Only chromium was installed, and the extracted tree has no `.git`. All three are
environment-dependent by design. `fail` is **0** in every run.

#### On the exit code 1 in step 11

`observe` exiting 1 when it finds issues is the documented default contract
(`fail-on: default (null) keeps the historical contract — any issue exits 1`), and there is a
test asserting exactly that. It is correct behaviour, not a failure. The two findings are real
observations about the demo site (a clipped control, 29 `aria-hidden` elements still painting),
and the report rendered them in correct Portuguese, confirming the localization path works
end-to-end:

> `| Baixo | Alta | ISSUE-001 — Percepção visual (Primeira impressão): Controles parcialmente cortados pelo viewport |`

---

### 3. The one real defect — and the fix

#### Symptom

On a clean, correct, freshly built archive, the project's own release grader failed:

```
FAIL  manifest git.dirty — got null, want false
==== 67 PASS · 1 FAIL · 0 SKIP ====
verify-release: FAIL — manifest git.dirty — got null, want false
```

#### Root cause

`scripts/pack-delivery.js` → **`gitDirty()`** is deliberately **tri-state**:

```js
function gitDirty() {
  const result = run('git', ['status', '--porcelain']);
  return result.status === 0 ? (result.stdout || '').trim().length > 0 : null;
}
```

- `false` → git answered: the tree is clean
- `true` → git answered: there are uncommitted changes
- `null` → **git could not be asked at all** (no `.git`, or git absent from `PATH`)

`scripts/verify-release.js` line 362 collapsed those three states into two:

```js
eq('manifest git.dirty', inside.git.dirty, false);
```

`eq()` stringifies and compares, so `null` ("provenance unknown") was graded identically to
`true` ("tree was dirty"). Since `.git` is **never staged into the archive**, this is not an
edge case — it is the guaranteed outcome for every person who extracts the zip and follows
**DELIVERY.md §7, "Reproducing this zip"**. They get a red release gate on a flawless artifact.

It also contradicts the bundle's own stated contract, in DELIVERY.md §7:

> Sections needing a browser or an installed dependency tree **SKIP with a reason** rather than
> fail or silently pass, so a gate that could not run never reports green.

And the repository already models this field correctly elsewhere —
`tests/packaging.test.js` guards with `if (a.manifest.git.dirty !== false)` and calls
`t.skip('tree is dirty (…); reproducibility is not claimed')`. Only the grader disagreed.

#### The change

**File:** `UserEye/scripts/verify-release.js` — one statement replaced, inside section 2
("Manifest says what the archive actually is"). No function was added, removed or renamed; no
signature changed.

```diff
-    eq('manifest git.dirty', inside.git.dirty, false);
+    const packedDirty = inside.git ? inside.git.dirty : undefined;
+    if (packedDirty === null || packedDirty === undefined) {
+      skip('manifest git.dirty — packed outside a git checkout, so provenance cannot be graded');
+    } else {
+      eq('manifest git.dirty', packedDirty, false);
+    }
```

**What the touched identifiers mean**

| Identifier             | Pre-existing?           | Meaning                                                                                                                                                                                                         |
| ---------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packedDirty`          | **new** (local `const`) | The `git.dirty` value read from the manifest _inside_ the archive, guarded so a manifest with no `git` object yields `undefined` instead of throwing `TypeError`. Purely a local binding — nothing is exported. |
| `skip(message)`        | existing                | Already defined at line 70. Increments the `skipped` tally and prints a yellow `SKIP` line. **Skips do not affect the exit code**, which is what makes "could not grade" different from "graded and failed".    |
| `eq(label, got, want)` | existing                | Existing two-valued assertion (line 74). Still used verbatim for the case where git _did_ answer, so a dirty tree is still a hard failure.                                                                      |
| `inside`               | existing                | The parsed `DELIVERY-MANIFEST.json` extracted from within the zip. Unchanged.                                                                                                                                   |

**Behaviour table after the fix**

| `git.dirty` in manifest | Meaning                | Before  | After                     |
| ----------------------- | ---------------------- | ------- | ------------------------- |
| `false`                 | clean checkout         | PASS    | PASS (unchanged)          |
| `true`                  | uncommitted changes    | FAIL    | **FAIL (unchanged)**      |
| `null` / missing        | git could not be asked | FAIL ❌ | **SKIP with a reason** ✅ |

#### The regression gate

**File:** `UserEye/tests/packaging.test.js` — one test appended, nothing modified.

**`test('verify-release: unknown git provenance skips, only a dirty tree fails')`** — reads the
grader's own source and asserts four properties: that the two-valued `eq()` on `git.dirty` is
gone; that an explicit `null`/`undefined` guard exists; that the unknown branch calls `skip()`
with a reason; and that the remaining branch still hard-fails a dirty tree. It is a source
assertion rather than a live pack because reproducing the state end-to-end means packing from a
non-git tree and re-extracting — which the suite already exercises — and would add a minute to
every run for no extra signal.

#### Proof the fix works _and_ that the gate can still fail

A gate that cannot fail is not a gate, so both directions were tested.

**Unknown provenance now skips** (real archive, non-git tree):

```
SKIP  manifest git.dirty — packed outside a git checkout, so provenance cannot be graded
==== 67 PASS · 0 FAIL · 1 SKIP ====
verify-release: OK — usereye-7.5.1-balanced.zip extracts, verifies and behaves as documented.
```

**A genuinely dirty tree is still rejected.** The archive was rebuilt with `git.dirty` forced to
`true` in the inner manifest (and the side manifest's `zipSha256`/`zipBytes` recomputed so every
_other_ gate still passed), then graded:

```
FAIL  manifest git.dirty — got true, want false
==== 67 PASS · 1 FAIL · 0 SKIP ====   exit 1
```

Exactly the intended discrimination: unknown → skip, dirty → fail.

---

### 4. Regression check — nothing else moved

Re-run after the change:

| Gate                     | Before                           | After                                                    |
| ------------------------ | -------------------------------- | -------------------------------------------------------- |
| `npm test`               | 425 · 422 pass · 0 fail · 3 skip | **426 · 423 pass · 0 fail · 3 skip** (+1 = the new test) |
| `npm run lint`           | clean                            | clean                                                    |
| `npm run format:check`   | clean                            | clean (both files were already Prettier-clean)           |
| `npm run typecheck`      | clean                            | clean                                                    |
| `npm run checks`         | all OK                           | all OK                                                   |
| `npm run test:coverage`  | floors satisfied                 | floors satisfied                                         |
| `npm run verify:release` | 67 P · **1 F**                   | **67 P · 0 F · 1 SKIP → OK**                             |

Two files touched in total. No runtime/published code was modified: `scripts/` and `tests/` are
excluded from the npm package by the `files` whitelist, so **the shipped npm artifact is
byte-identical to what you sent.** The fix is confined to the release toolchain.

---

### 5. Rating — 9.4 / 10

**Where it earns the score.** This is unusually disciplined engineering. The project does not
merely test its code, it tests _its own claims about itself_: the `**Tests:**` line in the docs
is rewritten from a real run and the suite rejects a hand-edited count; the archive is graded
after extraction rather than trusting the packer; `contentsSha256` is recomputed from extracted
bytes; a zip is correctly reasoned about as unable to contain its own hash, so `zipSha256` lives
in a side manifest; packs are byte-reproducible from a commit; the code-execution boundary is
default-deny with `shell: true` removed and an auditable `commandAudit`. Coverage floors are
_per-file and tiered_ — 85 % on perception modules, 40 % on the engine aggregate — rather than
one flattering global number. The negative gates are real: `check-delivery-names.js` is proven
to fail on a deliberately stale bundle. And the comments are honest about known gaps rather than
silent — the duplicate-entry note in `verify-release.js` documents an open weakness instead of
hiding it. 29/29 demo probes and a 100/100 live run confirm the tool genuinely works, not just
that it compiles.

**What holds it back from 10.**

1. **The defect fixed above.** Not severe, but it landed in the very script whose stated purpose
   is closing the gap between "the code works" and "the box works" — and it fired on the exact
   path the docs tell a recipient to walk.
2. **`protocols/file.js` sits at 9.80 % line coverage.** It clears the 40 % _aggregate_ floor by
   being averaged against better-covered siblings. The tiered-floor design is the right idea;
   this file is the hole in it.
3. **Self-acknowledged open gap:** `verify-release.js` does not assert entry-name uniqueness, so
   a duplicated zip entry is caught only incidentally by manifest arithmetic. The comment says so
   plainly, which is to its credit, but the gap is still open.
4. **Not actually published.** No repository/homepage/bugs metadata, no npm entry, and the
   GitHub Action cannot be consumed as `uses:` yet. The bundle is candid about this, and the
   `init --workflow` fallback is a good mitigation, but the distribution story is incomplete.
5. **Only chromium is exercised in practice.** The firefox/webkit paths skip honestly rather than
   pretending, which is correct — but they remain unverified in this environment.

None of these are correctness bugs in the product. The tool does what it says, on a live target,
with evidence. That is why the score is high.

---

### 6. How to reproduce every number above

```bash
cd UserEye
npm ci
npx playwright install --with-deps chromium
npm test && npm run lint && npm run format:check && npm run typecheck
npm run checks && npm run test:coverage
node bin/usereye.js doctor

## terminal 2, from the delivery root
node demo/live-server.js                    # 0.0.0.0:4200, demo at /vela/

## back in UserEye/
node bin/usereye.js auto --url http://127.0.0.1:4200/vela/ --mode quick --out artifacts/vela-quick
node bin/usereye.js observe http://127.0.0.1:4200/vela/ --axe --report-locale pt --out artifacts/vela-observe
VELA_BASE=http://127.0.0.1:4200/vela node ../demo/probes/probe-site.js
npm run pack:delivery && npm run verify:release
```

---

### 7. Second pass — the review modes (`perf-seo`, `flows`, `a11y-strict`)

Prompted by a direct question from the author: _"were the new modes tested?"_

#### 7.1 The measured answer: no

| Instrument                                                                                        | Result                                                       |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `ls tests/ \| grep -i "review\|mode\|a11y\|perf\|seo\|flow"`                                      | no dedicated test file                                       |
| `grep -rl "review-modes\|reviewMode\|runPerformanceSeo\|runFlows\|runStrictAccessibility" tests/` | **zero files**                                               |
| `node --test --experimental-test-coverage`                                                        | `review-modes/*` **absent from the coverage table entirely** |

Absence from the coverage table is the strongest evidence available: V8 lists every file the
process _loads_. The four runner modules — **1 104 lines** — never executed once during a
426-test run. They were also invisible to the coverage gate, because `scripts/check-coverage.js`
grades a hardcoded `ENGINE_FILES` list that does not mention them, and computes "overall
first-party" only over files that appear in the report. The advertised 89.39 % was therefore
measured over a codebase that excluded the newest feature.

They were, however, fully wired: `config.js` validates `reviewMode` against
`normal | perf-seo | flows | a11y-strict` (lines 874, 1009, 1104), `--review-mode` and
`USEREYE_REVIEW_MODE` both resolve, `usereye-auto.js:356` dispatches, and `review-modes/` is in
the npm `files` whitelist. Shipped to users, executed by no test.

#### 7.2 BUG 1 — the requested URL's path was silently discarded

**Severity: high.** Both audit runners defaulted their target list to the origin root:

```js
// perf-seo-runner.js:240   and   strict-a11y-runner.js:95
const urls = (config.performanceSeo.urls.length ? config.performanceSeo.urls : ['/']).map(
  u => absoluteUrl(baseURL, u), // absoluteUrl = new URL(target || '/', baseURL).href
);
```

`new URL('/', 'http://host/vela/')` → `http://host/`. The path is thrown away.

Proven, not inferred — running `--url http://127.0.0.1:4200/vela/`:

```
resolved-config.json      -> http://127.0.0.1:4200/vela/     (what was asked for)
accessibility-strict.json -> http://127.0.0.1:4200/          (what was actually audited)
network-summary.json      -> http://127.0.0.1:4200/  bytes 0
```

The reports never said so. They looked entirely plausible while describing a page nobody
requested — and were wrong in **both** directions:

| Mode          | Before (audited `/` by mistake)      | After (audits `/vela/`)               |
| ------------- | ------------------------------------ | ------------------------------------- |
| `perf-seo`    | SEO **50 %**, 6 findings, **exit 1** | SEO **100 %**, 0 findings, **exit 0** |
| `a11y-strict` | **2** checks, 2 findings             | **73** checks, **28** findings        |

So `perf-seo` invented six SEO failures (missing title/viewport/h1/lang) that belong to the demo
server's placeholder index, while `a11y-strict` reported near-perfect health by running 2 checks
instead of 73 — **hiding 26 genuine accessibility findings**. False alarms on one side, false
confidence on the other. For an auditing tool, silently grading the wrong page is close to the
worst failure mode available.

**Fix** — the default target becomes the URL the user actually gave. Explicit
`performanceSeo.urls` / `seedPaths` entries still resolve relative to `baseURL`, unchanged:

```diff
-  : ['/']).map(u => absoluteUrl(baseURL, u));
+  : [baseURL]).map(u => absoluteUrl(baseURL, u));
```

#### 7.3 BUG 2 — the modes ran completely silently

**Severity: medium.** `perf-seo` and `a11y-strict` wrote their reports and exited with **empty
stdout and empty stderr**, exit code 1. A gate failure was indistinguishable from a crash, and
the non-zero exit carried no stated reason — while the `normal` path has always printed an
`=== UserEye ===` block.

**Fix** — a new **`reportOutcome(config, outcome)`** in `review-modes/index.js`, called from the
dispatcher so all three modes get it from one place. It prints the mode, the audited target, the
step/check/finding counts, the severity split, the mode's headline number (SEO score,
LCP/FCP/CLS), the gate verdict, and — when non-zero — the reason for the exit code and the
artifact directory. It builds its logger with `createLogger({ level: config.logLevel, json:
config.logJson })`, so `--log-level silent` stays silent and `--log-json` stays machine-readable.

`runReviewMode` was refactored from three early `return`s into capturing `outcome`, reporting,
then returning it. Its signature, arguments and return value are unchanged.

Real output after the fix:

```
=== UserEye — review mode: a11y-strict ===
Target: http://127.0.0.1:4200/vela/
Steps: 1 (passed 0 · failed 1 · warnings 0)
Checks: 73 · findings: 28
Severity: blocker 0 · critical 0 · major 28 · minor 0
Review gates: FAIL
Exit 1 — 3 gate finding(s); see the report for the breakdown.
Artifacts: …/artifacts/fix-a11y-strict
```

#### 7.4 The regression gates — `tests/review-modes.test.js` (new, 7 tests)

| Test                                                              | Guards                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `perf-seo audits the requested URL, not the origin root`          | BUG 1, behaviourally. Serves a deliberately poor page at `/` and a well-formed one at `/deep/`, runs the real CLI, and asserts every fetched document URL keeps `/deep/` and that no `seo-title/viewport/h1/lang` failure (the origin's defects) appears. |
| `a11y-strict audits the requested URL, not the origin root`       | BUG 1 for the second runner, via `accessibility-strict.json`.                                                                                                                                                                                             |
| `no runner defaults its target list to the origin root`           | BUG 1 at source level, in both runners — cheap and precise.                                                                                                                                                                                               |
| `the dispatcher prints a summary and explains a non-zero exit`    | BUG 2 — captures `process.stdout.write` and asserts mode, target, counts, verdict, exit reason and artifact path.                                                                                                                                         |
| `a passing run reports PASS and no exit-code explanation`         | BUG 2 — the clean path, incl. SEO/LCP headlines.                                                                                                                                                                                                          |
| `the dispatcher rejects an unsupported mode`                      | dispatcher contract.                                                                                                                                                                                                                                      |
| `flows refuses to run without a flow file, with a usable message` | `flows` exits **2** with an actionable message (verified correct as shipped).                                                                                                                                                                             |

**These gates were proven to fail on the original code.** With the two runners and the dispatcher
reverted to their shipped state: **5 of 7 fail**; with the fixes applied: **7 of 7 pass**.

> Note for whoever reads the test file: `runCli()` uses async `spawn`, not `spawnSync`. The
> targets are served from an in-process http server, and a synchronous spawn blocks this
> process' event loop, so the server never answers and the run dies on "URL did not respond".

#### 7.5 Coverage after — the modes are now measured

They enter the report for the first time:

| File                                 | Before     | After        |
| ------------------------------------ | ---------- | ------------ |
| `review-modes/index.js`              | not loaded | **100.00 %** |
| `review-modes/common.js`             | not loaded | **95.95 %**  |
| `review-modes/perf-seo-runner.js`    | not loaded | **81.77 %**  |
| `review-modes/result-schema.js`      | not loaded | **73.53 %**  |
| `review-modes/strict-a11y-runner.js` | not loaded | **54.96 %**  |
| `review-modes/flow-runner.js`        | not loaded | **13.89 %**  |

Overall first-party moves from _56 files / 89.39 %_ to _62 files / 87.68 %_. **The lower number
is the more honest one** — the earlier figure simply did not count this code.

#### 7.6 Still open (deliberately, and stated rather than hidden)

1. **`flows` is effectively untested at 13.89 %** — only its argument-validation path runs. It
   needs a fixture flow file and a live journey; that is a feature-sized piece of work, and the
   author asked for regression gates only.
2. **`review-modes/*` are still not in `ENGINE_FILES`** in `scripts/check-coverage.js`, so they
   have no dedicated floor and cannot _regress_ into a red gate. Adding floors — once `flows`
   has real tests — would close this properly.
3. **`reviewMode` is absent from `types/`, `docs/CONFIG.md` and the README.** The feature is
   undocumented for consumers, even though the config layer validates it.

#### 7.7 Files touched in this second pass

| File                                 | Change                                                                           |
| ------------------------------------ | -------------------------------------------------------------------------------- |
| `review-modes/perf-seo-runner.js`    | 1 expression + comment — default target                                          |
| `review-modes/strict-a11y-runner.js` | 1 expression + comment — default target                                          |
| `review-modes/index.js`              | added `reportOutcome()`; `runReviewMode` captures/reports/returns; both exported |
| `tests/review-modes.test.js`         | **new** — 7 regression tests                                                     |

Suite after: **433 total · 430 pass · 0 fail · 3 skipped.** Lint, format, typecheck, `checks`,
coverage floors and `verify:release` all green.

## 2026-09-05-audit-fix-report-7.0.0

<!-- origem: docs/history/2026-09-05-audit-fix-report-7.0.0.md -->

## UserEye 7.0.0 — Audit, Fix Report & Function Guide

Date: 2026-09-05
Auditor environment: Node v20.20.2, npm 10.8.2, Playwright 1.63.0 (Chromium headless shell 153), Linux sandbox.
Method: **instrumented verification only — nothing was guessed.** Every claim below was produced by
running your own code (`npm test`, `node --check`, live CLI runs against local fixture servers) and by
reading the modules involved.

---

### 1. Bottom line

**Your project is not broken. It is in excellent shape.** Out of everything I exercised, exactly
**one real, reproducible bug** was found and fixed, plus one silent-confusion guardrail added.
Everything else passed, including paths your CI does not cover.

**Rating: 9.3 / 10** (breakdown in §6).

---

### 2. What was verified (and how)

| Check                                                              | Instrument                                                | Result                                                       |
| ------------------------------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------ |
| Syntax of all 39 JS modules                                        | `node --check` on every file                              | PASS                                                         |
| Unit tests                                                         | `npm test` (node:test, your 4 suites)                     | **20/20 PASS** (re-run after fixes)                          |
| Package integrity                                                  | `npm pack --dry-run`                                      | PASS — 51 files, 97.8 kB                                     |
| `usereye observe` (with `--axe`, `--mobile`, `--report-locale pt`) | live run vs fixture server                                | PASS, exit 1 when findings exist (correct per your contract) |
| `usereye auto` quick / **standard** / **deep**                     | live runs vs static + SPA fixtures                        | PASS — full artifacts incl. trace, video, SARIF              |
| CI fixture matrix (static, spa, english, portuguese, sso)          | exact reproduction of `.github/workflows/ci.yml` commands | **5/5 PASS**                                                 |
| Matrix mode (`apps: [...]` config)                                 | live run, 2 apps                                          | PASS — `matrix-summary.json` + `matrix-report.html` correct  |
| `--compare` run diff                                               | second run vs first `result.json`                         | PASS — 3 persisted / 0 introduced                            |
| Plugins (`afterRun`) + hooks                                       | demo plugin writing `plugin-proof.json`                   | PASS                                                         |
| BYO launch (`--command "node …"`)                                  | live run, port auto-detection                             | PASS                                                         |
| Startup failure handling                                           | django stub fixture (exits immediately)                   | PASS — exit 2 + `startup-error.json`                         |
| Quality-gate failure path                                          | `--min-score 100` vs 93-scoring run                       | PASS — gates FAIL, exit 1                                    |
| `install-browsers`                                                 | live invocation                                           | **FAIL before fix → PASS after fix** (see §3)                |
| SARIF validity                                                     | JSON parse + schema/version fields                        | PASS — valid SARIF 2.1.0                                     |
| Exit-code contract (0 / 1 / 2)                                     | every command above                                       | PASS                                                         |

Note on `[FAIL] 02 Adaptive exploration`: this is **not** a bug. Your `step()` design marks a step
FAIL when it _surfaces_ blocker/critical/major findings about the target app (e.g. the fixtures'
intentional low-contrast text). Quality gates then evaluate severity thresholds separately, which is
why gates can PASS while a step shows FAIL. Verified against `user-eye.js` step semantics and the
issue lists in `result.json`.

---

### 3. Bug found & fixed #1 — `usereye install-browsers` crashed (REAL BUG)

**File:** `bin/usereye.js` — inside `dispatch(argv)` (the CLI command router).

**Symptom (reproduced live):**

```text
$ node bin/usereye.js install-browsers
Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath './cli' is not defined
by "exports" in .../node_modules/playwright/package.json
```

This is the **first command your README tells every user to run** after
`npm install --save-dev usereye`, so it is the most user-visible defect in the package.

**Root cause:** the code used `require.resolve('playwright/cli')`. Modern Playwright (1.62/1.63 —
the versions your `^1.62.1` range installs) restricts importable subpaths through its `exports`
map, which exposes only `"."` and `"./package.json"` (verified by printing the map at runtime).
`./cli` is not in it, so Node throws before the browser installer ever starts.

**Fix (the only behavioral change in this delivery):**

```js
// before
const cli = require.resolve('playwright/cli');

// after
const cli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
```

`playwright/package.json` _is_ an exported subpath, so it resolves on every modern release;
`cli.js` next to it is exactly the file Playwright's own `"bin"` entry points to (verified:
`bin: {"playwright": "cli.js"}`), so spawning it runs the official installer.
A `const path = require('path')` import was added at the top of the file for this.

**Verified after fix:** `node bin/usereye.js install-browsers` → exit 0.

#### Functions involved (what each one means)

- **`dispatch(argv)`** — `bin/usereye.js`. The CLI entry point. Reads `argv`, prints help/version,
  and routes to the right runner: `observe` → `runObserve()`, `auto`/`analyze` → `runAuto()`
  (analyze just appends `--analyze`), `install-browsers` → spawns Playwright's installer, anything
  else → throws (caught below and mapped to exit code 2). It returns the process exit code, so the
  shell contract (0 = clean, 1 = quality failures, 2 = setup/usage) lives here.
- **`path.dirname(require.resolve('playwright/package.json'))`** — a standard, exports-safe way to
  locate a package's install directory when its internals are not publicly exported.

---

### 4. Guardrail added #2 — `--command` silently ignored when `--url` is present

**File:** `usereye-auto.js` — inside `runAuto(argv, runtime)`.

**What I hit live:** `usereye auto --url http://… --command "node server.js"` never starts the
command — by design, `ProjectAdapter` treats `--url` as an _already-running_ target and only probes
it. That matches your docs, but the run then fails with "URL did not respond" and nothing explains
that `--command` was dropped. I burned a real run on this before reading `project-adapter.js`.

**Change:** one warning line, **no behavioral change**:

```js
if (config.command && (config.baseURL || config.url)) {
  console.warn('Warning: a URL was provided; --command is ignored and the URL is used directly.');
}
```

**Functions involved:**

- **`runAuto(argv, runtime)`** — the orchestrator of the `auto` command. It loads/normalizes config,
  runs matrix mode when `apps:` is configured, analyzes or starts the target (`ProjectAdapter`),
  then executes four numbered steps through `UserEye.step()`: open target → `AdaptiveExplorer`
  exploration → concurrent browser protocols (`ProtocolRunner`) → code-quality floor. Finally it
  evaluates quality gates, writes `result.json` + reports, and maps gates to the exit code.
- The new condition only inspects already-parsed config fields (`config.command`,
  `config.baseURL`, `config.url`) — no logic paths change.

---

### 5. Deliberately NOT changed (your rule: don't break the code)

These are observations, not fixes. Each is minor and changing it carries more risk than value:

1. **Dead devDependencies:** `eslint`, `globals`, `prettier` are declared but there is no
   `eslint.config.*`, no `lint`/`format` script, and CI never lints. Either add a flat config or
   drop the deps — your call.
2. **`press()` default label is Portuguese** (`Pressionar ${key}`) while sibling defaults are
   English (`Open ${url}`). Cosmetic; appears in `actions.json` labels.
3. **`video-raw/` directory is created even with `--no-video`** (constructor always mkdirs it).
   Leaves an empty dir in artifacts.
4. **`nextDialog()` leaves a one-shot `dialog` listener registered after its timeout fires.** In
   practice harmless (the promise is already rejected), but a stray dialog later in a session would
   be consumed by the stale listener.
5. **Version bump:** I kept `7.0.0` because your tests assert the version string
   (`smoke.test.js` expects `7.0.0`) and a release bump is your decision. When you ship this,
   bump to `7.0.1` in `package.json` + `TOOL_VERSION` + the test assertions together.

---

### 6. Rating: 9.3 / 10

| Area                 | Score | Why                                                                                                                                                                                                                                              |
| -------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Architecture         | 9.5   | Clean separation: perception (browser-evaluated collectors) / engine (`UserEye`) / exploration (`AdaptiveExplorer`) / protocols (`ProtocolRunner` + scheduler) / reporting. The v5-compat contract enforced by tests is a genuinely mature move. |
| Correctness          | 9     | 20/20 tests, 5/5 fixture matrix, all CLI paths exit-code-correct. One shipped crash (`install-browsers`) — the only real bug found — costs this category.                                                                                        |
| Safety design        | 9.5   | Read-only by default, destructive-action blocklists, empty-submit-only auth probing, secret redaction everywhere artifacts are written, resolved config redacted.                                                                                |
| Evidence & reporting | 9.5   | Trace, video, screenshots, SARIF, HTML/MD reports in two locales, run diffs, matrix reports — reproducible and CI-friendly.                                                                                                                      |
| Docs & packaging     | 8.5   | README/HISTORY are strong; dead lint devDeps and the README's first command being broken (now fixed) hold this back.                                                                                                                             |

**What would make it a 10:** add the missing lint config (or remove the devDeps), an integration
test for `install-browsers` (mock/spawn-level), and an e2e smoke in CI that runs `observe` against a
fixture (the matrix covers `auto` only).

---

### 7. Exact diff (complete — nothing else was touched)

```diff
--- a/bin/usereye.js
+++ b/bin/usereye.js
@@ -1,6 +1,7 @@
 #!/usr/bin/env node
 'use strict';

+const path = require('path');
 const { spawnSync } = require('child_process');
 const pkg = require('../package.json');
@@ -37,7 +38,11 @@
   if (command === 'install-browsers') {
-    const cli = require.resolve('playwright/cli');
+    // playwright's "exports" map only exposes "." and "./package.json", so
+    // require.resolve('playwright/cli') fails on modern playwright releases.
+    // Resolve through the exported package.json and use the package's own bin
+    // entry (cli.js) instead.
+    const cli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
     const output = spawnSync(process.execPath, [cli, 'install', 'chromium'], { stdio: 'inherit' });
     return output.status === 0 ? 0 : 2;
   }

--- a/usereye-auto.js
+++ b/usereye-auto.js
@@ -172,6 +172,9 @@
   const analysis = adapter.analyze();
+  if (config.command && (config.baseURL || config.url)) {
+    console.warn('Warning: a URL was provided; --command is ignored and the URL is used directly.');
+  }
   fs.writeFileSync(path.join(artifactDir, 'project-analysis.json'), `${JSON.stringify(analysis, null, 2)}\n`);
```

---

### 8. Note: the live verification server

During this audit, the fixed tool was also verified against a live static hub (demo target apps
served on `0.0.0.0:4173`), with UserEye re-run against that origin:
`auto --mode standard` → quality 100/100, coverage 100%, 2 genuine low-contrast findings on the
demo page, quality gates PASS, exit 0. The hub files are not part of this delivery; the package
contents are exactly:

Files added by this delivery (none of them inside the `UserEye/` runtime package):
`CHANGES.md` — plus the `UserEye/` project tree with the two documented fixes.

## 2026-09-05-implementation-report-7.0.0

<!-- origem: docs/history/2026-09-05-implementation-report-7.0.0.md -->

## UserEye 7.0.0 — project-agnostic roadmap implementation

**Completed:** 2026-09-05  
**Baseline:** 6.1.0 fixed deliverable  
**Result:** All implementation tiers A–E are represented in runnable code, tests, packaging, and CI assets. Optional Docker, SARIF, plugins, profiles, and matrix capabilities were also implemented.

### Executive result

UserEye is now a public-package-ready, product-neutral tool that can be consumed as `usereye`, configured by the application repository, run against either a URL or a source repository, extended without a fork, and gated deterministically in CI.

- npm identity: `usereye@7.0.0`
- CLI: `usereye observe`, `auto`, `analyze`, `install-browsers`, `--version`
- browser defaults: `en-US`, `UTC`, light color scheme
- mutation defaults: write, destructive actions, and downloads all disabled
- config precedence: defaults < file < environment < CLI
- auth: form, Playwright storage state, or project-owned login hook
- control language: built-in English/Portuguese pattern packs plus project packs
- report language: English/Portuguese catalogs
- distribution: bounded npm tarball, typed exports, composite GitHub Action, publish workflow, Dockerfile
- CI outputs: stable exit codes, configurable gates, HTML/Markdown/JSON/SARIF
- fixtures: eight distinct application fixtures

### Tier A — neutral identity and defaults

- [x] Renamed the package to `usereye`, marked it publishable, and moved the version to 7.0.0 for the default changes.
- [x] Added generic repository metadata, keywords, exports, license, and package file allowlist.
- [x] Removed legacy product and runner paths from JavaScript/report templates.
- [x] Changed browser defaults to `en-US`, `UTC`, and `light`.
- [x] Added browser CLI/config controls for locale, timezone, color scheme, viewport, HTTPS behavior, and user agent.
- [x] Replaced the report implementation with product-neutral `UserEye — <app>` templates.
- [x] Added a generic README and retained the old line only in `HISTORY.md`.

### Tier B — application-owned config and policy

- [x] Added `config.js` with JS, MJS, CJS, JSON, and `package.json#usereye` discovery.
- [x] Added `--config` and `USEREYE_CONFIG` support.
- [x] Implemented and tested precedence: built-ins < config < environment < CLI.
- [x] Wired the same loader into both `observe` and `auto`.
- [x] Added redacted `resolved-config.json` output.
- [x] Added `blockPaths` and `blockNamePatterns` checks before actions, post-navigation recovery for dynamic routes, and blocked seed handling.
- [x] Added seed paths, query-param normalization, exploration budget overrides, and hints.
- [x] Added `--env KEY=VALUE` and app environment propagation.

### Tier C — real package and CLI

- [x] Added executable `bin/usereye.js` dispatcher.
- [x] Added a browser installer wrapper and post-install browser reminder.
- [x] Added CommonJS exports plus TypeScript declarations.
- [x] Restricted package contents to code, protocols, patterns, locales, types, docs, action, and Docker assets.
- [x] Added consumer installation and `require('usereye')` smoke validation.
- [x] Added npm provenance publishing automation.

### Tier D — extensibility and hard applications

- [x] Generic form authentication remains the default.
- [x] `storageState` is passed directly to Playwright browser contexts.
- [x] Login, before-explore, and after-explore hooks are supported from JS config.
- [x] English and Portuguese pattern packs are external JSON resources.
- [x] Project-owned pattern packs and custom regular expressions merge into explorer and protocol behavior.
- [x] English and Portuguese report catalogs are selectable with `reportLocale`.
- [x] Monorepo `appDir` is honored by the project adapter.
- [x] Named profiles merge into config and can be selected with `--profile`.
- [x] Primary-CTA hints can boost exploration priority without replacing DOM discovery.
- [x] Plugin API supports isolated protocols, `afterObservation`, and `afterRun`.
- [x] Multi-app `apps` config produces child reports plus `matrix-summary.json` and `matrix-report.html`.

### Tier E — CI/CD and productization

- [x] Exit code contract implemented: 0 pass, 1 completed/quality failure, 2 setup or usage failure, 130/143 signals.
- [x] Quality thresholds moved from magic values into `gates` config.
- [x] Composite GitHub Action installs dependencies/browser, runs UserEye, uploads evidence, then applies the UserEye exit code.
- [x] CI workflow runs unit/package checks and a five-app browser matrix, with a standard nightly run.
- [x] Publish workflow supports npm provenance and GHCR image publication.
- [x] Dockerfile uses the matching Playwright browser image.
- [x] SARIF 2.1.0 generation covers UserEye and axe findings.

### Test fixtures

| Fixture      | Coverage purpose                                                 |
| ------------ | ---------------------------------------------------------------- |
| `static`     | Marketing page and first impression                              |
| `spa`        | Hash router, delayed auth transition, write/destructive controls |
| `english`    | Default control-language pack and block paths                    |
| `portuguese` | Portuguese pattern and report locale                             |
| `sso`        | Project-owned login hook and storage state                       |
| `consent`    | Consent-wall protocol                                            |
| `next-app`   | Next.js adapter/monorepo detection                               |
| `django`     | Django adapter and form marker detection                         |

### Verification completed

#### Automated suite

- **20/20 tests passed** with Node’s built-in test runner.
- Coverage includes neutral defaults, all config discovery forms, precedence, redaction, patterns, page classification, blocklists, adapters, plugins, locales, SARIF, quality gates, v5 compatibility, package contents, CLI exits, and matrix mode.

#### Live browser acceptance

Playwright Chromium and its system dependencies were installed, then the following local-browser runs completed:

1. **Observe:** generated result, trace, screenshot, localized HTML/Markdown, and SARIF. It returned exit 1 because the visual analyzer intentionally found two fixture issues; setup and artifact generation succeeded.
2. **Quick auto:** returned exit 0 with **100/100 adaptive quality**, two unique states, 100% candidate accounting, and ten selected protocols with no protocol failure.
3. **Blocklist:** returned exit 0; `/settings` never appeared in explored states and a `config-block` skip was recorded.
4. **SSO hook:** returned exit 0 with `authenticated-by-hook`.
5. **Storage state:** returned exit 0; the authenticated page loaded immediately and no auth wall was detected.

Evidence is under `artifacts/acceptance-*` in this source deliverable. Generated run artifacts are excluded from the npm package.

#### Package acceptance

- npm tarball: approximately **98 kB compressed**, **371 kB unpacked**, 51 package files.
- Empty consumer project installation succeeded.
- Consumer `usereye --version`, `usereye analyze`, and `require('usereye')` succeeded.
- No tests, browser recordings, application fixtures, `node_modules`, or generated artifacts entered the tarball.

### External release boundary

The source is release-ready, but no credentialed `npm publish`, GitHub release, Action marketplace listing, or GHCR push was attempted because repository ownership and publishing credentials were not supplied. `.github/workflows/publish.yml` performs those operations once maintainers configure `NPM_TOKEN` and run a release.

## after-en-report

<!-- origem: docs/evidence/after-en-report.md -->

## UserEye — 127.0.0.1

**Run:** 2026-09-06T05:47:01.100Z

- Steps: **0** (Passed: 0; Failed: 0; Warnings: 0)
- Checks: **0**
- Findings: **2**
- Unexpected browser errors: **0**

### Prioritized findings

| Severity | Confidence | Finding                                                                                      | Expected                                              | Observed                                                                |
| -------- | ---------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------- |
| Minor    | High       | ISSUE-001 — Visual perception (First impression): Controls partially clipped by the viewport | The rendered interface does not present this problem. | 1 control(s) partially outside the visible area.                        |
| Minor    | High       | ISSUE-002 — Visual perception (First impression): aria-hidden elements remain visible        | The rendered interface does not present this problem. | 29 element(s) hidden from assistive technology still occupy the screen. |

### Executed journey

### Reproducible artifacts

- Tool: `usereye`
- Result: `result.json`
- HTML: `report.html`

## after-pt-report

<!-- origem: docs/evidence/after-pt-report.md -->

## UserEye — 127.0.0.1

**Execução:** 2026-09-06T05:46:53.668Z

- Etapas: **0** (Aprovadas: 0; Falhas: 0; Alertas: 0)
- Verificações: **0**
- Achados: **2**
- Erros inesperados do navegador: **0**

### Achados priorizados

| Severidade | Confiança | Achado                                                                                           | Esperado                                             | Observado                                                         |
| ---------- | --------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------- | ----------------------------------------------------------------- |
| Baixo      | Alta      | ISSUE-001 — Percepção visual (Primeira impressão): Controles parcialmente cortados pelo viewport | A interface renderizada não apresenta este problema. | 1 controle(s) parcialmente fora da área visível.                  |
| Baixo      | Alta      | ISSUE-002 — Percepção visual (Primeira impressão): Elementos aria-hidden continuam visíveis      | A interface renderizada não apresenta este problema. | 29 elemento(s) ocultos para leitores de tela ainda ocupam a tela. |

### Jornada executada

### Artefatos reproduzíveis

- Tool: `usereye`
- Result: `result.json`
- HTML: `report.html`

## before-pt-report

<!-- origem: docs/evidence/before-pt-report.md -->

## UserEye — 127.0.0.1

**Execução:** 2026-09-06T05:38:03.571Z

- Etapas: **0** (Aprovadas: 0; Falhas: 0; Alertas: 0)
- Verificações: **0**
- Achados: **2**
- Erros inesperados do navegador: **0**

### Achados priorizados

| Severidade | Confiança | Achado                                                                                          | Esperado                                              | Observado                                                         |
| ---------- | --------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------- |
| Baixo      | Alta      | ISSUE-001 — Visual perception (First impression): Controles parcialmente cortados pelo viewport | The rendered interface does not present this problem. | 1 controle(s) parcialmente fora da área visível.                  |
| Baixo      | Alta      | ISSUE-002 — Visual perception (First impression): Elementos aria-hidden continuam visíveis      | The rendered interface does not present this problem. | 29 elemento(s) ocultos para leitores de tela ainda ocupam a tela. |

### Jornada executada

### Artefatos reproduzíveis

- Tool: `usereye`
- Result: `result.json`
- HTML: `report.html`
