# Arquitectura, heurísticas e matrix

**Créditos:** Revisor Anônimo

Estrutura de ficheiros, fluxo interno, heurísticas de percepção e modo matrix.

## Índice de origens

1. `UserEye/ARCHITECTURE.md` — Arquitectura do runtime
2. `UserEye/docs/HEURISTICS.md` — Heurísticas
3. `UserEye/docs/MATRIX.md` — Matrix de apps

---

## Arquitectura do runtime

<!-- origem: UserEye/ARCHITECTURE.md -->

## UserEye 7.5.1 — architecture

**Créditos:** Revisor Anônimo

Documento de estrutura, dependências e fluxo interno para operadores e developers. A referência de configuração gerada continua em `docs/CONFIG.md` + `docs/usereye.config.schema.json`. A API pública gerada continua em `docs/API.md`. O modelo de ameaça permanece em `SECURITY.md`.

### Runtime

- Node.js `>= 20.11` (matriz CI 20 / 22 / 24)
- Dependências de produção: `playwright@1.63.0`, `axe-core@4.13.0` (pinadas)
- Binário: `bin/usereye.js` (`package.json#bin.usereye`)
- Biblioteca: `index.js` + `types/index.d.ts`
- Contrato de saída `0 | 1 | 2` e `result.json` (`schemaVersion` ≥ 5) inalterados nesta revisão de CLI

### Árvore (pacote `UserEye/`)

```text
bin/usereye.js              dispatcher CLI + HELP + install-browsers
bin/usereye-self-test.js    usereye --self-test | self-test | diag
bin/usereye-doctor.js       usereye doctor
bin/usereye-init.js         usereye init
bin/usereye-auth.js         usereye auth save
bin/postinstall.js          aviso pós-install (browsers à parte)
usereye-observe.js          comando observe
usereye-auto.js             comandos auto / analyze
user-eye.js                 motor de browser (Passos, evidência, close com timeout)
adaptive-explorer.js        exploração segura + auth
adaptive-browser.js         callbacks injectados na página
config.js                   defaults calmos, flags, load/merge/validate
command-runner.js           spawn sem shell; commandAudit
project-adapter.js          análise estática / arranque do alvo
protocol-runner.js          protocolos paralelos
protocols/                  browser, experience, human, input, network, file,
                            user-journey, extensions, helpers
review-modes/               normal dispatch → perf-seo | flows | a11y-strict
findings.js                 confiança / kind / política de superfície
report.js / sarif.js        HTML, MD, md-pr, SARIF
artifact-store.js           rotação, totalBytes, keepLast
dashboard.js / issue-export.js
logger.js                   níveis + ndjson + timings
i18n.js + locales/ + patterns/
plugins.js                  hooks isolados (30 s)
action.yml / Dockerfile
```

O zip de entrega envolve `UserEye/` com `demo/` (não publicado) e `docs/` de auditoria (não publicado). `CURRENT.md` / `DELIVERY.md` no raiz do zip são artefactos de empacotamento; **não** foram apagados porque `check-delivery-names.js`, `pack-delivery.js` e `verify-release.js` exigem-nos.

### Fluxo `usereye auto --url`

1. `bin/usereye.js#dispatch` → `usereye-auto.js#runAuto`
2. `loadConfig` — defaults < ficheiro < `USEREYE_*` < flags
3. Se `urlOnlyTarget`: não analisa o cwd; não corre code-quality
4. `ProjectAdapter.start` só se houver project/command; senão usa o URL
5. `UserEye.launch` → passo `openTarget` → `AdaptiveExplorer.explore`
6. `ProtocolRunner.run` (orçamento do `--mode`)
7. `applyFindingsPolicy` → `evaluateQualityGates` → `writeReports` → `writeResultJson`
8. Exit 0/1/2 conforme gates, `auth.required`, fatal

### Fluxo `usereye observe`

`runObserve` → launch → `goto` → `scanVisualHealth` → opcional `runAxe` → `observeExitCode(result, failOn)`.

### Fronteira de execução de código

| Modo        | Executa código do alvo?                                            |
| ----------- | ------------------------------------------------------------------ |
| `--url`     | Nunca                                                              |
| `--project` | Só o autorizado por `--allow-project-commands` / `codeExecution.*` |
| `start`     | Arrancar a app sob teste permanece o propósito de `--project`      |

Nenhum comando passa por `shell: true`. Bloqueados e executados vão para `result.json#commandAudit`.

### Review modes

`--review-mode` ≠ `--mode`. Runners em `review-modes/`. O default de URL é o `baseURL` pedido (não a origem `/` — regressão 7.5.1). `flows` recusa correr sem ficheiro de flow (exit 2).

### Plugins

`beforeRun`, `afterObservation`, `afterState`, `afterRun`, `protocols`. Falha/hang isolados; `pluginDiagnostics` no resultado.

### Testes

`npm test` = `node --test tests/*.test.js`. `usereye --self-test` **não** substitui a suíte; transporta asserções de sanidade (HELP, carga de módulos, defaults, contrato observe). Testes de motor, cobertura e empacotamento permanecem na suíte.

### Dependências de documentação gerada

`scripts/generate-config-docs.js` e `scripts/generate-api-docs.js` regeneram `docs/CONFIG.md` e `docs/API.md` a partir de `DEFAULT_CONFIG` e da superfície exportada. Não editar esses dois à mão.

## Heurísticas

<!-- origem: UserEye/docs/HEURISTICS.md -->

## Heuristics — decided behavior (7.5.1, roadmap item 5.1)

Every heuristic below is a **decision with an owner**: a fixture under
`tests/fixtures/heuristics/`, a test in `tests/heuristics-stability.test.js` and
this page change **in the same commit**. A behavior change is a reviewable
decision, not an accident.

### 1. Misclick on a focus-revealed UI

**Decision.** A click that lands outside its target and changes only _material_
(text repaint, lazy panel) is **`harmful` under `misclickPolicy: 'aggressive'`
(the default) and `confusing` under `'stable-only'`**. Hard signals — URL change,
dialog change, or a destructive activation (`delete`, `logout`, `buy`, …) that
changed state — are `harmful` under both policies.

- Why: `aggressive` is the historical default; real users _do_ get lost when a
  skip link or hidden menu appears under the pointer (`misclick-engine.js`
  `outcome()`). `stable-only` exists for CI environments where a repaint is
  acceptable noise (Phase 2.1 of the 7.5.0 audit).
- Fixture: `tests/fixtures/heuristics/focus-reveal.html` — a skip link whose
  `focus` event inserts a helper panel (material-only change, URL/dialog/alert
  stable).
- Test: `heuristics-stability.test.js` → "a focus-revealed control is harmful
  (aggressive) but confusing (stable-only)".

### 2. Consent-wall regex

**Decision.** `browser-human.js` carries two regexes:

- `CONSENT_TEXT` — `cookie|consentimento|consent|aceitar todos|accept all|
aceitar|privacidade|gdpr|lgpd|we use cookies|usamos cookies|privacy`
- `CONSENT_ACTION` — `accept all|aceitar|accept|customize|configurar|reject|
recusar|manage|gerir|agree|concordo|allow all|permitir|save preferences|
salvar prefer|settings`

A candidate is a wall **only if it is a rendered layer** (fixed/absolute/sticky,
`<dialog>`, `role=dialog`, `aria-modal`) covering ≥ `consent.minWallArea`
(0.18 of the fold by default) **and** matching `CONSENT_TEXT`. With
`consent.strict === true` the layer must also expose a control matching
`CONSENT_ACTION`. Static copy in normal document flow (a footer saying "this
site uses cookies") is **never** a wall.

- Why: the old regex flagged marketing copy; gating by layer + area kills the
  false positives while keeping every real banner (audit Phase 2.2).
- Fixtures: `consent-wall.html` (real fixed layer + actions, `strict` matches)
  and `consent-copy-not-layer.html` (footer copy, must not match).
- Test: the two consent tests in `heuristics-stability.test.js`.

### 3. 200% zoom technique

**Decision.** `zoomUsability` (`protocols/experience.js`) simulates 200% zoom with:

- `zoomMode: 'css'` (**default**, back-compat) — `documentElement.style.zoom = '2'`;
- `zoomMode: 'viewport'` (opt-in) — a context whose viewport is halved
  (640×400), approximating the effective layout viewport of a desktop page at
  200% zoom, and **reveals the same horizontal-overflow failures** as CSS zoom
  without depending on Chromium's page-scale internals;
- `zoomMode: 'cdp'` — reserved, not shipped.

In both modes the protocol warns when `horizontalOverflow > 80px` or when
blocker/critical perception findings exist. The outcome is a `warning`
(`zoom-200` protocol), never a run failure.

- Why: CSS zoom is a good proxy but mismeasures pages that use `vw`-based
  layouts; the halved-viewport mode is the honest simulation for those, at the
  cost of a smaller layout surface (audit Phase 2.3).
- Fixtures: `zoom-overflow.html` (deliberately 1800px wide at a 640px page →
  warning under both modes) and `zoom-fit.html` (control → passed).
- Tests: the runtime protocol test (real browser, `zoomMode: 'viewport'`) and
  the perception-level test, both in `heuristics-stability.test.js`.

### Changing any of this

1. Edit the fixture(s) and this page in the same commit as the code change.
2. The stability tests must move with them — they are the regression gate.
3. Bump the affected section in `HISTORY.md` (a heuristic change is
   user-visible behavior).

## Matrix de apps

<!-- origem: UserEye/docs/MATRIX.md -->

## Multi-app matrix (`config.apps`) — 7.5.1, roadmap item 5.3

A single `auto` run can analyze several applications and aggregate them into one
summary. This is the recommended shape for a multi-service repo (marketing site +
admin dashboard, web + API client, …).

### Config shape

`apps` is a top-level array; every other option is inherited and may be
overridden per app:

```js
module.exports = {
  outDir: 'artifacts/usereye-matrix',
  mode: 'standard',
  apps: [
    // URL mode: the app must already be reachable.
    { name: 'Marketing', url: 'http://127.0.0.1:3000' },
    // Project mode: UserEye starts the app itself (adapter auto-detection).
    { name: 'Dashboard', projectDir: 'apps/dashboard', command: 'npm run dev' },
    // Any option can be overridden per app.
    { name: 'Checkout', projectDir: 'apps/checkout', mode: 'deep', failOn: ['minor'] },
  ],
};
```

- `name` is used for the artifact directory name (sanitized:
  `[^a-zA-Z0-9._-]` → `-`, lowercased) and in the summary/report.
- A `projectDir`/`command` app is a project run regardless of what the parent
  config carried (7.5.1, item 3.1): `--url` isolation applies per app.
- Apps run **sequentially**, each with its own fresh browser context, port and
  artifact directory.

### Outputs

```
<outDir>/
  matrix-summary.json     # schemaVersion 1 — aggregated result (see below)
  matrix-report.html      # human-readable table with per-app links
  <name>/                # exactly the artifact layout of a single run
    result.json
    report.html
    …
```

`matrix-summary.json`:

```json
{
  "schemaVersion": 1,
  "tool": "UserEye matrix",
  "apps": [
    {
      "name": "Marketing",
      "exitCode": 0,
      "artifactDir": "marketing",
      "score": 94,
      "issues": 1,
      "qualityGatesPassed": true
    }
  ],
  "passed": 1,
  "failed": 0,
  "exitCode": 0
}
```

**Exit code** = the worst app exit code (`0` clean, `2` setup/usage, `1` gates
or findings). A failing app does not abort its siblings; every app always runs.

### Tips and limits

- `keepLast` rotation applies to the whole matrix root (`<outDir>` →
  `<outDir>-history/<stamp>`), not per app.
- `dryRun: true` builds `execution-plan.json` for all apps without launching a
  browser — useful in CI to smoke-test the config.
- Chrome-extension/environment-specific options apply to every app; override
  per app when they differ (e.g. `consent`, `credentials`).
- The matrix root is truncated by the normal per-run retention rules; a single
  app's artifacts are not rotated individually.

### Fixture and tests

`tests/fixtures/matrix/` holds the worked example (two static apps served by
the project adapter, in-page anchors so exploration stays on one page):

```bash
node bin/usereye.js auto --config tests/fixtures/matrix/usereye.config.cjs
```

`tests/matrix-apps.test.js` covers the happy path (two apps, aggregated
summary, per-app evidence) and the failure path (unreachable app does not abort
its sibling and the matrix reports the worst exit code).
