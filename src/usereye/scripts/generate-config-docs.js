#!/usr/bin/env node
'use strict';

/**
 * Config documentation + JSON Schema generator (roadmap M4, Phase 5).
 *
 * The README's configuration table was maintained by hand, so it drifted the
 * moment anyone added a knob. Both artifacts are now derived from
 * `DEFAULT_CONFIG`, which makes drift impossible:
 *
 *   docs/CONFIG.md              human reference, one row per key
 *   docs/usereye.config.schema.json   editor completion + validation
 *
 * `--check` regenerates in memory and fails when the committed files differ,
 * so CI catches a forgotten regeneration.
 *
 * Usage: node scripts/generate-config-docs.js [--check]
 */

const fs = require('fs');
const path = require('path');
const { DEFAULT_CONFIG, configSchema, KNOWN_CONFIG_KEYS } = require('../config');

const root = path.resolve(__dirname, '..');
const docsPath = path.join(root, 'docs', 'CONFIG.md');
const schemaPath = path.join(root, 'docs', 'usereye.config.schema.json');

/** One-line description per key. Missing keys are reported, never guessed. */
const DESCRIPTIONS = {
  projectDir: 'Target project directory.',
  command: 'Explicit start command for the app under test.',
  install: 'Request dependency installation (also needs `codeExecution.install`).',
  mode: 'Exploration budget: `quick`, `standard` or `deep`.',
  reviewMode: 'Review runner: `normal`, `perf-seo`, `flows` or `a11y-strict`.',
  headed: 'Run the browser headed instead of headless.',
  workers: 'Parallel protocol workers (0 = auto).',
  outDir: 'Artifact output directory.',
  keepArtifacts: 'Keep the previous artifact directory instead of clearing it.',
  keepLast:
    'Local retention (7.5.1): move the previous run to `<outDir>-history/<stamp>` and keep the newest n. `0` (default) clears `outDir` per run.',
  failOn:
    '`observe` gate (7.5.1): minimum severity that exits 1 — `never`, `minor`, `major`, `critical`, or `blocker`. Default (`null`) is the historical contract: any issue exits 1. Unexpected browser errors always exit 1. `auto` ignores it.',
  locale: 'Browser locale for the run.',
  timezoneId: 'Browser timezone.',
  colorScheme: '`light`, `dark` or `no-preference`.',
  viewport: 'Desktop viewport size.',
  recordVideo: 'Session video: `false`, `true`, or `on-failure` (default).',
  trace: 'Playwright trace: `on-failure` (default, discarded on a clean run), `always`, or `never`.',
  ignoreHTTPSErrors: 'Accept invalid TLS certificates on the target.',
  credentials: 'Login credentials (redacted from every artifact).',
  storageState: 'Playwright storage-state JSON for a pre-authenticated session.',
  auth: 'Authentication strategy: `form`, `storageState` or `hook`.',
  allowWrite: 'Permit form submissions and other mutations.',
  allowDestructive: 'Permit actions matched as dangerous (delete, revoke…).',
  allowDownloads: 'Permit file downloads.',
  blockPaths: 'URL paths the explorer must never visit.',
  blockNamePatterns: 'Control names the explorer must never activate.',
  seedPaths: 'Extra paths to seed the exploration frontier.',
  ignoreQueryParams: 'Treat URLs that differ only by query string as one state.',
  patternPack: 'Language packs used to classify controls and pages.',
  patterns: 'Per-category pattern overrides.',
  hints: 'Project-specific hints handed to the explorer.',
  protocols: '`auto`, `core`, `v5`, `all`, or comma-separated protocol IDs.',
  browser: '`chromium` (default), `firefox` or `webkit`.',
  retries: 'Retries for transient navigation failures.',
  retryBackoffMs: 'Backoff between retries.',
  navigationTimeoutMs: 'Per-navigation timeout.',
  dialogTimeoutMs: 'Default `nextDialog()` timeout.',
  minActionDelayMs: 'Minimum delay between actions (politeness for shared targets).',
  protocolTimeoutMs: 'Per-protocol timeout.',
  startupTimeoutMs: 'How long to wait for the app to become ready.',
  axe: 'Run axe-core accessibility audits.',
  codeQuality: 'Run the code-quality analyzer (static by default — see `codeExecution`).',
  codeQualityTimeoutMs: 'Timeout for each code-quality command.',
  codeExecution:
    '**Security boundary.** Which commands originating from the TARGET repository UserEye may execute. All false by default: project analysis is static-only. See SECURITY.md.',
  reportLocale: 'Report language: `en`, `pt`, `pt-BR`, `es`, `fr` or `auto`.',
  reportFormat: 'Report formats to write: `html`, `md`, `md-pr`, `sarif`.',
  sarif: 'SARIF export options (its own confidence floor).',
  report:
    'HTML report options: `embedLimit` — bytes of screenshots inlined as data URIs before the rest are linked (default 204800; `unlimited` restores full embedding).',
  findings: 'Finding policy: confidence floors, suppression, elevation.',
  gates: 'Deterministic quality gates that decide exit code 0 vs 1.',
  misclick: 'Near-miss policy: `stable-only` (default) or `aggressive`.',
  userJourney: 'Opt-in resilience + accessibility probe battery.',
  extensions: 'Opt-in browser-extension effect battery.',
  allowedHosts: 'Hosts the explorer may navigate to besides the base URL host.',
  respectRobots: 'Honour the target’s robots.txt.',
  hooks: 'Lifecycle hooks (e.g. a custom login).',
  plugins: 'Plugin module paths.',
  profiles: 'Named config overlays selectable with `--profile`.',
  dryRun: 'Detection only: write `plan.json`, launch nothing.',
  logLevel: 'Log verbosity: `error`, `warn`, `info` (default), `debug`, `trace`.',
  logJson: 'Emit newline-delimited JSON logs instead of human text.',
  timings: 'Record per-phase durations in `result.json`.',
  performanceSeo: 'Configuration for the native Lighthouse-like Performance + SEO runner.',
  flows: 'Configuration for declared manual critical flows.',
  accessibilityStrict: 'Configuration for strict axe/Pa11y accessibility review.',
};

function renderValue(value) {
  if (value === null) return '`null`';
  if (typeof value === 'object') return `\`${JSON.stringify(value)}\``;
  return `\`${JSON.stringify(value)}\``;
}

function typeOf(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function renderDocs() {
  const missing = Object.keys(DEFAULT_CONFIG).filter(key => !DESCRIPTIONS[key]);
  if (missing.length) {
    console.error(
      `config-docs: FAIL — no description for: ${missing.join(', ')}. Add one in scripts/generate-config-docs.js.`,
    );
    process.exit(1);
  }
  const rows = Object.entries(DEFAULT_CONFIG)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([key, value]) => `| \`${key}\` | ${typeOf(value)} | ${renderValue(value)} | ${DESCRIPTIONS[key]} |`,
    );
  return `<!-- GENERATED by scripts/generate-config-docs.js — do not edit by hand. -->

# UserEye configuration reference

Every key below is accepted in \`usereye.config.{js,mjs,cjs,json}\`, in the
\`usereye\` property of \`package.json\`, or inside a named \`profiles\` entry.

Precedence is deterministic: **defaults < config file < environment < CLI flags**.
The fully resolved, secret-redacted result of that merge is written to
\`resolved-config.json\` in the artifact directory on every run.

Unknown keys are reported as warnings. Set \`USEREYE_STRICT_CONFIG=1\` (or
\`strictConfig: true\`) to turn them into a usage error (exit 2) instead.

A JSON Schema for editor completion lives beside this file:
[\`usereye.config.schema.json\`](./usereye.config.schema.json).

| Key | Type | Default | Description |
| --- | --- | --- | --- |
${rows.join('\n')}

## Keys materialized during normalization

These are accepted but have no entry in the defaults table because they are only
meaningful when set: ${KNOWN_CONFIG_KEYS.filter(key => !(key in DEFAULT_CONFIG))
    .map(key => `\`${key}\``)
    .join(', ')}.

## The code-execution boundary

\`codeExecution\` is the one block worth reading twice.

| Mode | Executes code from the target? |
| --- | --- |
| \`--url\` (URL mode) | **Never.** UserEye only drives a browser against a running app. |
| \`--project\` (project mode) | Only what \`codeExecution\` authorizes. All of \`npmScripts\`, \`binaries\` and \`install\` default to **false**, so a bare \`--project\` run performs static analysis only. |

Authorize categories explicitly:

\`\`\`bash
usereye auto --project . --allow-project-commands lint,typecheck
\`\`\`

Every command UserEye runs — or refuses to run — is recorded in
\`result.json\` under \`commandAudit\`. No command is ever passed through a
shell; see [\`SECURITY.md\`](../SECURITY.md).
`;
}

/**
 * Format generated output with the repository's own Prettier config, so the
 * generator and `npm run format:check` can never disagree about the file they
 * both own. Prettier is a devDependency; if it is absent (consumer install)
 * the raw text is returned unchanged.
 *
 * @param {string} content
 * @param {string} filepath Used by Prettier to infer the parser.
 * @returns {Promise<string>}
 */
async function formatGenerated(content, filepath) {
  let prettier;
  try {
    prettier = require('prettier');
  } catch {
    return content;
  }
  const options = (await prettier.resolveConfig(filepath)) || {};
  return prettier.format(content, { ...options, filepath });
}

async function main() {
  const check = process.argv.includes('--check');
  const docs = await formatGenerated(renderDocs(), docsPath);
  const schema = await formatGenerated(`${JSON.stringify(configSchema(), null, 2)}\n`, schemaPath);
  fs.mkdirSync(path.dirname(docsPath), { recursive: true });
  if (check) {
    const problems = [];
    for (const [file, expected] of [
      [docsPath, docs],
      [schemaPath, schema],
    ]) {
      const actual = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
      if (actual !== expected) {
        problems.push(`${path.relative(root, file)} is out of date — run npm run docs:config.`);
      }
    }
    if (problems.length) {
      for (const problem of problems) console.error(`config-docs: FAIL — ${problem}`);
      process.exit(1);
    }
    console.log('config-docs: OK — generated config docs and schema match the defaults.');
    return;
  }
  fs.writeFileSync(docsPath, docs);
  fs.writeFileSync(schemaPath, schema);
  console.log(`config-docs: wrote ${path.relative(root, docsPath)} and ${path.relative(root, schemaPath)}.`);
}

main().catch(error => {
  console.error(`config-docs: FAIL — ${error.message}`);
  process.exit(1);
});
