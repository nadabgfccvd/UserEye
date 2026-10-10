#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { UserEye } = require('./user-eye');
const { ProjectAdapter } = require('./project-adapter');
const { AdaptiveExplorer } = require('./adaptive-explorer');
const { CodeQualityAnalyzer } = require('./code-quality');
const { ProtocolRunner } = require('./protocol-runner');
const { writeReports, describeVideoOutcome, describeTraceOutcome } = require('./report');
const { rotateArtifactDir, writeResultJson } = require('./artifact-store');
const { compareResults } = require('./run-diff');
const { countSeverityAtConfidence, confidenceRank, applyFindingsPolicy } = require('./findings');
const { loadConfig, mergeConfig, writeResolvedConfig } = require('./config');
const { loadPlugins, runPluginHook, pluginDiagnostics, validatePluginHooks } = require('./plugins');
const { buildExecutionPlan, printExecutionPlan } = require('./execution-plan');
const { CommandAudit } = require('./command-runner');
const { performanceChecks, summarizeVitals } = require('./performance');
const { createLogger } = require('./logger');
const { section, t, format, catalog } = require('./i18n');

const ANALYZE_USAGE = `Usage: usereye analyze [options]

Detection + plan.json only. Does not launch a browser or start the app.
Equivalent to: usereye auto --analyze   (or --dry-run)

  --project <dir>          Target repository (default: current directory)
  --app-dir <dir>          App inside a monorepo
  --url <href>             Already-running target (skips project analysis)
  --config <path>          Per-project configuration
  --mode <mode>            quick, standard, or deep (budget recorded in the plan)
  --out <dir>              Where to write plan.json
  --allow-project-commands <list>
                           Authorize executing commands FROM THE TARGET REPO
                           (default: none — analysis is static only)
  --pattern-pack <list>    en,pt,es,fr or a JSON path
  --profile <name>         Merge a named config profile
  --protocols <spec>       auto, core, v5, all, or comma-separated IDs
  -h, --help

Writes: plan.json, and project-analysis.json unless the run is URL-only.
Exit codes: 0 wrote the plan; 2 usage/setup.
`;

const USAGE = `Usage: usereye auto [options]

  --config <path>          Per-project configuration
  --project <dir>          Target project (default current directory)
  --app-dir <dir>          App inside a monorepo
  --url <href>             Already-running target
  --command <shell>        Bring-your-own start command
  --mode <mode>            quick, standard, or deep (exploration budget)
  --review-mode <mode>     normal, perf-seo, flows, or a11y-strict
  --flows <path[,path]>    Flow file(s) for --review-mode flows
  --install                Permit dependency installation
  --email/--username/--password <value>
  --storage-state <path>   Playwright storage state JSON
  --allow-write            Permit form mutations
  --allow-destructive      Permit dangerous actions
  --allow-downloads        Permit downloads
  --protocols <spec>       auto, core, v5, all, or comma-separated IDs
  --workers <n>            Parallel protocol workers (0 = auto)
  --out <dir>              Artifact directory
  --keep-last <n>          Keep the newest n previous runs under <out>-history/ (default 0)
  --compare <result.json>  Compare with a previous run
  --profile <name>         Merge a named config profile
  --browser <name>         chromium (default), firefox, or webkit
  --retries <n>            Retries for transient navigation failures (default 1)
  --navigation-timeout <ms> Per-navigation timeout (default 15000)
  --dialog-timeout <ms>    Default nextDialog() timeout (default 5000)
  --min-delay <ms>         Minimum delay between actions; politeness for third-party targets
  --analyze / --dry-run    Detection only; write plan.json, do not launch anything
  --no-axe --no-code-quality
  --video                  Always keep the session video (recordVideo: true)
  --video-on-failure       Record, then discard the video on a clean run (default)
  --no-video               Never record a session video
  --trace <policy>         on-failure (default), always, or never — Playwright trace.zip
  --misclick-policy <p>    stable-only (default) or aggressive
  --allow-project-commands <list>
                           Authorize executing commands that come FROM THE TARGET
                           REPO: scripts,binaries,install,lint,format,typecheck,all.
                           Default: none — project analysis is static only.
  --log-level <level>      error|warn|info|debug|trace (default info)
  --log-json               Emit structured JSON logs on stdout
  --timings                Record per-phase durations in result.json
  --headed
  --env KEY=VALUE          Repeatable app environment value
  --locale <tag>           Browser locale (default en-US)
  --timezone <id>          Browser timezone (default UTC)
  --color-scheme <value>   light, dark, or no-preference
  --viewport <WxH>         Explicit viewport, for example 1440x900
  --mobile                 390x844 viewport
  --report-locale <tag>    en | pt | pt-BR | es | fr | auto
  --report-format <list>   html,md,md-pr,sarif
  --startup-timeout <ms>   How long to wait for the app to listen
  --protocol-timeout <ms>  Per-protocol timeout
  --code-quality-timeout <ms>
  --min-score <n>          gates.minAdaptiveScore
  --max-blocker <n>        gates.maxBlocker
  --max-critical <n>       gates.maxCritical
  --max-browser-errors <n> gates.maxUnexpectedBrowserErrors
  --seed <path>            Repeatable seed path
  --block-path <path>      Repeatable blocked path
  --block-name <pattern>   Repeatable blocked control name
  --pattern-pack <list>    en,pt,es,fr or a JSON path
  --keep                   Do not rotate/clear the artifact directory
  --ignore-https-errors
  --no-ignore-query-params
  --axe                    Enable axe-core (default on for auto)
  -h, --help

Calm defaults (7.4.1) — a bare run is CI-safe without a config file:
  recordVideo 'on-failure' · trace 'on-failure' · misclick.policy 'stable-only' ·
  findings.minConfidence 'medium' · findings.gateConfidence 'high'.
  Restore the pre-7.4.1 loud profile with --video --misclick-policy aggressive
  or findings.minConfidence 'low' in config.
`;

function appendQualityGate(adaptiveResult, gate) {
  adaptiveResult.quality.gates.push(gate);
  const total = adaptiveResult.quality.gates.reduce((sum, item) => sum + item.weight, 0);
  const earned = adaptiveResult.quality.gates.reduce((sum, item) => sum + (item.passed ? item.weight : 0), 0);
  adaptiveResult.quality.score = total ? Math.round((earned / total) * 100) : 100;
}

function evaluateQualityGates(result, adaptive, gates, options = {}) {
  // Phase 3: performance checks are appended below; they are `signal` by
  // default and therefore cannot change the exit code unless the operator
  // opted into `gates.performanceMode: 'gate'`.
  // Phase 1 quiet gates: severity counts may be restricted to findings at/above a
  // confidence rank (config `findings.gateConfidence`). Default (no findings
  // policy attached) keeps 7.1.1 behaviour by counting everything.
  const policy = (result.findings && result.findings.policy) || options.findings || null;
  const rawSeverity = result.summary?.severity || { blocker: 0, critical: 0, major: 0, minor: 0 };
  const count = name =>
    policy ? countSeverityAtConfidence(result.issues || [], name, policy) : rawSeverity[name] || 0;
  const maxMajor = Number.isFinite(Number(gates.maxMajor)) ? Number(gates.maxMajor) : null;
  const checks = [
    {
      id: 'min-adaptive-score',
      passed: (adaptive?.quality?.score ?? 0) >= gates.minAdaptiveScore,
      actual: adaptive?.quality?.score ?? 0,
      expected: `>= ${gates.minAdaptiveScore}`,
    },
    {
      id: 'max-blocker',
      passed: count('blocker') <= (gates.maxBlocker || 0),
      actual: count('blocker'),
      expected: `<= ${gates.maxBlocker || 0}`,
    },
    {
      id: 'max-critical',
      passed: count('critical') <= (gates.maxCritical || 0),
      actual: count('critical'),
      expected: `<= ${gates.maxCritical || 0}`,
    },
    {
      id: 'max-unexpected-browser-errors',
      passed: (result.summary?.unexpectedBrowserErrors || 0) <= gates.maxUnexpectedBrowserErrors,
      actual: result.summary?.unexpectedBrowserErrors || 0,
      expected: `<= ${gates.maxUnexpectedBrowserErrors}`,
    },
  ];
  if (maxMajor !== null) {
    checks.push({
      id: 'max-major',
      passed: count('major') <= maxMajor,
      actual: count('major'),
      expected: `<= ${maxMajor}`,
    });
  }
  // Phase 3 regression gates: fail only on *new* majors / high-confidence defects
  // versus the `--compare` baseline, never on the absolute count alone.
  const diff = result.diff || options.diff;
  if (gates.failOnNewMajor) {
    const introduced = (diff?.issues?.introduced || []).filter(entry =>
      ['blocker', 'critical', 'major'].includes(entry.severity),
    );
    checks.push({
      id: 'no-new-major',
      passed: introduced.length === 0,
      actual: introduced.length,
      expected: '0 new majors vs baseline',
      details: introduced.map(item => item.id),
    });
  }
  for (const check of performanceChecks(result.performance || { metrics: {} }, gates)) {
    checks.push(check);
  }
  if (gates.failOnNewHighConfidence) {
    const introduced = (diff?.issues?.introduced || []).filter(
      entry =>
        ['blocker', 'critical', 'major'].includes(entry.severity) &&
        confidenceRank(entry) >= 2 && // rank>=2 == high
        entry.kind !== 'signal',
    );
    checks.push({
      id: 'no-new-high-confidence',
      passed: introduced.length === 0,
      actual: introduced.length,
      expected: '0 new high-confidence majors vs baseline',
      details: introduced.map(item => item.id),
    });
  }
  return { passed: checks.every(check => check.passed), checks };
}

function writeRecommendations(result, adaptive, filePath, locale = 'en') {
  const pt = String(locale).startsWith('pt');
  const lines = pt
    ? [
        `# Recomendações UserEye — ${result.application.name}`,
        '',
        `Qualidade adaptativa: **${adaptive.quality.score}/100**.`,
        '',
        '## Achados confirmados',
        '',
      ]
    : [
        `# UserEye recommendations — ${result.application.name}`,
        '',
        `Adaptive quality: **${adaptive.quality.score}/100**.`,
        '',
        '## Confirmed findings',
        '',
      ];
  if (!result.issues.length) lines.push(pt ? '- Nenhum achado confirmado.' : '- No confirmed findings.');
  for (const issue of result.issues) {
    lines.push(
      `### ${issue.id} — ${issue.severity}: ${issue.title}`,
      '',
      `- ${pt ? 'Esperado' : 'Expected'}: ${issue.expected}`,
      `- ${pt ? 'Observado' : 'Observed'}: ${issue.actual}`,
      '',
    );
  }
  lines.push(pt ? '## Segurança e cobertura' : '## Safety and coverage', '');
  lines.push(`- ${pt ? 'Estados únicos' : 'Unique states'}: ${adaptive.quality.uniqueStates}`);
  lines.push(`- ${pt ? 'URLs únicas' : 'Unique URLs'}: ${adaptive.quality.uniqueURLs}`);
  lines.push(`- ${pt ? 'Cobertura' : 'Coverage'}: ${adaptive.quality.coveragePercent}%`);
  lines.push(`- ${pt ? 'Autenticação' : 'Authentication'}: ${adaptive.auth.reason || 'not detected'}`);
  lines.push('', pt ? '## Próximo ciclo' : '## Next cycle', '');
  lines.push(
    pt ? '1. Corrija bloqueadores e erros críticos primeiro.' : '1. Fix blockers and critical errors first.',
  );
  lines.push(
    pt
      ? '2. Use credenciais descartáveis quando a autenticação limitar a cobertura.'
      : '2. Use disposable credentials when authentication limits coverage.',
  );
  lines.push(
    pt
      ? '3. Habilite escrita somente em ambientes descartáveis.'
      : '3. Enable writes only in disposable environments.',
  );
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

function budgetFromConfig(config) {
  const keys = [
    'maxStates',
    'maxActions',
    'maxDepth',
    'actionsPerState',
    'coverageTarget',
    'screenshots',
    'axeStates',
    'misclickTargets',
  ];
  return Object.fromEntries(
    keys
      .filter(key => config[key] !== undefined && config[key] !== null)
      .map(key => [key, Number(config[key])]),
  );
}

function escapeHTML(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Human-readable byte count for the console summary (7.5.1, item 2.5). */
function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 7.5.1 (item 3.1): hostname of the target URL for the URL-only `projectName`. */
function safeHostname(target) {
  try {
    return new URL(target).hostname || '(url target)';
  } catch {
    return '(url target)';
  }
}

/**
 * 7.5.1 (roadmap item 3.3): localized string from a catalog section, with the
 * English pack as fallback so a missing translation can never surface a literal
 * from the code (steps used to be hard-coded "Open target application", the
 * audit gates "Initial state observed" — English even under --report-locale pt).
 */
function catalogString(locale, name, key, params) {
  const sectionData = section(locale, name);
  const template = t(sectionData, key) || t(section('en', name), key);
  return params ? format(template, params) : template;
}

/** 7.5.1 (item 3.3): localized name of an auto-flow step. */
function stepName(locale, key, params) {
  return catalogString(locale, 'stepNames', key, params);
}

/** 7.5.1 (item 3.3): localized label of a run-quality gate. */
function gateLabel(locale, key, params) {
  return catalogString(locale, 'gateLabels', key, params);
}

/** 7.5.1 (item 2.3): one line when a previous run was retained — silent at keepLast 0. */
function announceRotation(rotation, keepLast) {
  if (rotation?.moved) {
    console.log(
      `Previous run kept: ${rotation.moved} (keepLast: ${keepLast}, ${rotation.kept.length} retained)`,
    );
  }
}

async function runMatrix(config, argv, runtime) {
  const rootDir = config.outDir;
  if (!config.keepArtifacts) announceRotation(rotateArtifactDir(rootDir, config.keepLast), config.keepLast);
  fs.mkdirSync(rootDir, { recursive: true });
  writeResolvedConfig(config, rootDir);
  const runs = [];
  for (let index = 0; index < config.apps.length; index += 1) {
    const app = config.apps[index];
    const name = String(app.name || `app-${index + 1}`)
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .toLowerCase();
    const childConfig = mergeConfig(config, app);
    delete childConfig.apps;
    childConfig.appName = app.name || name;
    childConfig.baseURL = app.baseURL || app.url || childConfig.baseURL;
    if (app.projectDir) childConfig.projectDir = path.resolve(config.projectDir, app.projectDir);
    childConfig.outDir = path.join(rootDir, name);
    // 7.5.1 (item 3.1): an app that points at a project directory/command is a
    // project run again, even when the parent config only carried URLs.
    if (app.projectDir || app.command) childConfig.urlOnlyTarget = false;
    const output = await runAuto(
      argv.filter(value => value !== '--help'),
      { ...runtime, config: childConfig, matrixChild: true },
    );
    runs.push({
      name: childConfig.appName,
      exitCode: output.exitCode,
      artifactDir: path.relative(rootDir, output.artifactDir || childConfig.outDir).replace(/\\/g, '/'),
      score: output.result?.adaptive?.quality?.score ?? null,
      issues: output.result?.summary?.issues ?? null,
      qualityGatesPassed: output.result?.qualityGates?.passed ?? null,
    });
  }
  const summary = {
    schemaVersion: 1,
    tool: 'UserEye matrix',
    generatedAt: new Date().toISOString(),
    apps: runs,
    passed: runs.filter(run => run.exitCode === 0).length,
    failed: runs.filter(run => run.exitCode !== 0).length,
    exitCode: runs.reduce((code, run) => Math.max(code, run.exitCode), 0),
  };
  fs.writeFileSync(path.join(rootDir, 'matrix-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  const rows = runs
    .map(
      run =>
        `<tr><td>${escapeHTML(run.name)}</td><td>${run.exitCode}</td><td>${run.score ?? '—'}</td><td>${run.issues ?? '—'}</td><td><a href="${encodeURI(run.artifactDir)}/report.html">report</a></td></tr>`,
    )
    .join('');
  fs.writeFileSync(
    path.join(rootDir, 'matrix-report.html'),
    `<!doctype html><meta charset="utf-8"><title>UserEye — matrix</title><style>body{font:15px system-ui;max-width:900px;margin:40px auto;padding:20px}table{width:100%;border-collapse:collapse}td,th{padding:10px;border:1px solid #ccc;text-align:left}</style><h1>UserEye — matrix</h1><p>${summary.passed} passed · ${summary.failed} failed</p><table><thead><tr><th>App</th><th>Exit</th><th>Score</th><th>Issues</th><th>Evidence</th></tr></thead><tbody>${rows}</tbody></table>`,
  );
  return { exitCode: summary.exitCode, artifactDir: rootDir, matrix: summary };
}

async function runAuto(argv = process.argv.slice(2), runtime = {}) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(argv.includes('--analyze') ? ANALYZE_USAGE : USAGE);
    return { exitCode: 0 };
  }
  const cwd = runtime.cwd || process.cwd();
  const env = runtime.env || process.env;
  const config = runtime.config || (await loadConfig({ argv, cwd, env }));
  if (!runtime.matrixChild && Array.isArray(config.apps) && config.apps.length) {
    return runMatrix(config, argv, { ...runtime, cwd, env });
  }
  if (config.reviewMode && config.reviewMode !== 'normal') {
    const { runReviewMode } = require('./review-modes');
    return runReviewMode(config, argv, runtime);
  }
  const projectDir = config.projectDir;
  const artifactDir = config.outDir;
  if (!config.keepArtifacts && !runtime.matrixChild) {
    announceRotation(rotateArtifactDir(artifactDir, config.keepLast), config.keepLast);
  } else if (!config.keepArtifacts) {
    fs.rmSync(artifactDir, { recursive: true, force: true });
  }
  fs.mkdirSync(artifactDir, { recursive: true });
  writeResolvedConfig(config, artifactDir);

  const plugins = await loadPlugins(
    config.plugins,
    config.configFile ? path.dirname(config.configFile) : projectDir,
  );
  // 7.5.1 (item 5.2): validate the hook contract up front — a misspelled hook is
  // a config problem to warn about, not a silent no-op later.
  for (const plugin of plugins) {
    for (const problem of validatePluginHooks(plugin)) {
      console.warn(`Warning: plugin ${plugin.id || '(unnamed)'}: ${problem}`);
    }
  }
  const runStartedMs = Date.now();
  const audit = new CommandAudit();
  const logger = createLogger({ level: config.logLevel, json: config.logJson, timings: config.timings });
  const adapter = new ProjectAdapter({
    projectDir,
    appDir: config.appDir,
    command: config.command,
    url: config.baseURL || config.url,
    install: config.install,
    env: config.env,
    codeExecution: config.codeExecution,
    audit,
  });
  // 7.5.1 (roadmap item 3.1): a URL-only run skips the static analysis of the
  // current directory entirely. The placeholder keeps every downstream consumer
  // (result.application, plan.json, startup-error.json, console summary) working,
  // and `adapter.analysis` is seeded so `adapter.start()` never re-runs analyze().
  const analysis = config.urlOnlyTarget
    ? {
        urlOnly: true,
        projectDir: null,
        appDir: null,
        sourceDir: null,
        sourceStack: 'web',
        projectName: config.appName || safeHostname(config.baseURL || config.url),
        stack: 'web',
        framework: null,
        confidence: 1,
        discoveredRoots: [],
        warnings: [],
        startCommand: null,
        installCommand: null,
        selectedScript: null,
        needsInstall: false,
        packageManager: null,
      }
    : adapter.analyze();
  if (config.urlOnlyTarget) {
    adapter.analysis = analysis;
    console.log(
      `Target: ${config.baseURL} · URL-only mode — no project analysis (pass --project to analyse one)`,
    );
    console.log(`Command: (provided URL)`);
  } else {
    if (config.command && (config.baseURL || config.url)) {
      console.warn('Warning: a URL was provided; --command is ignored and the URL is used directly.');
    }
    fs.writeFileSync(
      path.join(artifactDir, 'project-analysis.json'),
      `${JSON.stringify(analysis, null, 2)}\n`,
    );
    console.log(
      `Project: ${analysis.projectName} · stack: ${analysis.stack} · confidence: ${Math.round(analysis.confidence * 100)}%`,
    );
    console.log(`Command: ${analysis.startCommand || '(provided URL)'}`);
    for (const warning of analysis.warnings) console.warn(`Warning: ${warning}`);
  }
  if (config.dryRun) {
    const plan = buildExecutionPlan(config, analysis, plugins);
    plan.commandAudit = audit.toJSON();
    fs.writeFileSync(path.join(artifactDir, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`);
    if (!config.urlOnlyTarget) {
      console.log(`Analysis: ${path.join(artifactDir, 'project-analysis.json')}`);
    }
    printExecutionPlan(plan, artifactDir);
    return { exitCode: 0, artifactDir, analysis, config, plan };
  }

  const codeQualityPromise =
    config.urlOnlyTarget || !config.codeQuality
      ? Promise.resolve(null)
      : new CodeQualityAnalyzer({
          projectDir,
          appDir: analysis.sourceDir || analysis.appDir,
          stack: analysis.sourceStack || analysis.stack,
          mode: config.mode,
          timeoutMs: config.codeQualityTimeoutMs,
          codeExecution: config.codeExecution,
          audit,
        })
          .run()
          .catch(error => ({
            score: 0,
            summary: { commands: 0, passed: 0, failed: 1, findings: 0, majorFindings: 0 },
            static: { totals: {}, findings: [], largestFiles: [] },
            checks: [{ id: 'code-quality-runner', status: 'failed', output: error.message }],
            error: error.message,
          }));

  const credentials = config.credentials || {};
  const eye = new UserEye({
    artifactDir,
    headless: !config.headed,
    browser: config.browser,
    retries: config.retries,
    retryBackoffMs: config.retryBackoffMs,
    navigationTimeoutMs: config.navigationTimeoutMs,
    dialogTimeoutMs: config.dialogTimeoutMs,
    minActionDelayMs: config.minActionDelayMs,
    recordVideo: config.recordVideo,
    trace: config.trace,
    logger,
    autoObserve: 'failure',
    visualAuditIssues: false,
    viewport: config.viewport,
    locale: config.locale,
    timezoneId: config.timezoneId,
    colorScheme: config.colorScheme,
    storageState: config.storageState || undefined,
    ignoreHTTPSErrors: config.ignoreHTTPSErrors,
    acceptDownloads: config.allowDownloads,
    userAgent: config.userAgent,
    reportLocale: config.reportLocale,
    misclickPolicy: config.misclick?.policy,
    consent: config.consent,
    zoomMode: config.zoomMode,
    userJourney: config.userJourney,
    extensions: config.extensions,
  });
  eye.registerSecret(Object.values(credentials));

  let baseURL;
  let adaptiveResult;
  let protocolResult;
  let codeQuality;
  // Always present so downstream steps never touch an undefined `adaptiveResult`
  // even when adaptive exploration itself fails (e.g. an anti-bot wall). Filled
  // with real data when exploration succeeds.
  const emptyAdaptiveResult = {
    mode: config.mode,
    auth: {},
    states: [],
    actions: [],
    skipped: [],
    responsiveAudits: [],
    quality: {
      score: 0,
      gates: [],
      uniqueStates: 0,
      uniqueURLs: 0,
      discoveredCandidates: 0,
      accountedCandidates: 0,
      coveragePercent: 0,
      coverageTarget: 0,
      unaccountedDueToBudget: 0,
      pageTypes: [],
      efficiency: {},
    },
  };
  let fatal = null;
  let browserVersion = '';
  // `eye.close()` intentionally nulls `eye.browser` so repeated calls are
  // no-ops, so it cannot be used after the finally block to decide whether the
  // browser ever started. Track the successful launch explicitly instead.
  let launched = false;
  const cleanup = async () => adapter.stop().catch(() => {});
  const onSignal = code => cleanup().finally(() => process.exit(code));
  const sigintHandler = () => onSignal(130);
  const sigtermHandler = () => onSignal(143);
  process.once('SIGINT', sigintHandler);
  process.once('SIGTERM', sigtermHandler);

  try {
    logger.startPhase('startup');
    // 7.5.1 (item 5.2): hooks are isolated — a throwing/hanging plugin never
    // breaks the run; failures are warned and recorded in pluginDiagnostics.
    for (const plugin of plugins) {
      const outcome = await runPluginHook(plugin, 'beforeRun', { config, artifactDir, projectDir });
      if (!outcome.ok) {
        console.warn(`Warning: plugin ${plugin.id || '(unnamed)'} beforeRun failed: ${outcome.error}`);
      }
    }
    baseURL = await adapter.start({ timeoutMs: config.startupTimeoutMs });
    console.log(`Application ready: ${baseURL}`);
    logger.debug('target ready', { baseURL });
    await eye.launch();
    launched = true;
    logger.endPhase('startup');
    eye.page.setDefaultTimeout(config.mode === 'quick' ? 5000 : config.mode === 'standard' ? 7000 : 9000);
    browserVersion = eye.browser.version();
    adaptiveResult = { ...emptyAdaptiveResult };
    await eye.step(
      stepName(config.reportLocale, 'openTarget'),
      async () => {
        await eye.goto(baseURL);
        await eye.see('body', 'Main document rendered', { severity: 'blocker' });
      },
      { critical: true, fullPage: true },
    );

    const explorer = new AdaptiveExplorer(eye, {
      mode: config.mode,
      baseURL,
      projectDir,
      allowWrite: config.allowWrite,
      allowDestructive: config.allowDestructive,
      credentials: credentials.password ? credentials : null,
      storageState: config.storageState,
      authStrategy: config.auth?.strategy,
      authConfig: config.auth,
      hooks: config.hooks,
      plugins,
      blockPaths: config.blockPaths,
      blockNamePatterns: config.blockNamePatterns,
      allowedHosts: config.allowedHosts,
      respectRobots: config.respectRobots,
      seedPaths: config.seedPaths,
      ignoreQueryParams: config.ignoreQueryParams,
      ignoreHash: config.ignoreHash,
      wallClockMs: config.maxWallClockMs,
      ready: config.ready,
      diveIntoIframes: config.diveIntoIframes,
      patternPack: config.patternPack,
      patterns: config.patterns,
      hints: config.hints,
      budget: budgetFromConfig(config),
      axe: config.axe,
      axeSourcePath: config.axe ? require.resolve('axe-core/axe.min.js') : null,
    });
    await eye.step(
      stepName(config.reportLocale, 'adaptiveExploration', { mode: config.mode }),
      async () => {
        adaptiveResult = await explorer.explore();
      },
      { screenshot: false },
    );

    await eye.step(
      stepName(config.reportLocale, 'concurrentProtocols', { mode: config.mode }),
      async () => {
        const runner = new ProtocolRunner(eye, {
          baseURL,
          mode: config.mode,
          workers: config.workers || undefined,
          protocols: config.protocols,
          timeoutMs: config.protocolTimeoutMs,
          allowWrite: config.allowWrite,
          allowDownloads: config.allowDownloads,
          projectDir,
          patternPack: config.patternPack,
          patterns: config.patterns,
          plugins,
          userJourney: config.userJourney,
          extensions: config.extensions,
        });
        protocolResult = await runner.run();
        adaptiveResult.protocols = protocolResult;
        appendQualityGate(adaptiveResult, {
          id: 'parallel-protocols',
          label: gateLabel(config.reportLocale, 'parallelProtocols'),
          passed: protocolResult.summary.failed === 0,
          weight: 15,
        });
        adaptiveResult.quality.protocolSummary = protocolResult.summary;
      },
      { screenshot: false },
    );

    await eye.step(
      stepName(config.reportLocale, 'codeQualityFloor'),
      async () => {
        codeQuality = await codeQualityPromise;
        if (codeQuality) {
          fs.writeFileSync(
            path.join(artifactDir, 'code-quality.json'),
            `${JSON.stringify(eye._sanitize(codeQuality), null, 2)}\n`,
          );
          eye.artifacts.codeQuality = 'code-quality.json';
          adaptiveResult.codeQuality = {
            score: codeQuality.score,
            summary: codeQuality.summary,
            static: codeQuality.static.totals,
          };
          for (const check of codeQuality.checks.filter(item => item.status === 'failed')) {
            eye.addIssue({
              fingerprint: `code-quality:${check.id}`,
              severity: 'major',
              title: `Code quality failed: ${check.id}`,
              expected: `Command ${check.command || check.id} passes.`,
              actual: check.output || `Exit code ${check.exitCode}`,
            });
          }
          for (const finding of (codeQuality.static.findings || []).filter(
            item => item.severity === 'major',
          )) {
            eye.addIssue({
              fingerprint: `code-quality-static:${finding.code}`,
              severity: 'minor',
              title: `Code structure: ${finding.code}`,
              expected: 'Modular, maintainable source files.',
              actual: finding.message,
              technical: JSON.stringify(finding.files || [], null, 2),
            });
          }
          appendQualityGate(adaptiveResult, {
            id: 'code-quality',
            label: gateLabel(config.reportLocale, 'codeQuality'),
            passed: codeQuality.summary.failed === 0 && codeQuality.score >= config.gates.minAdaptiveScore,
            weight: 10,
          });
        }
      },
      { screenshot: false },
    );
  } catch (error) {
    fatal = error;
    if (launched) {
      eye.addIssue({
        severity: 'blocker',
        title: 'Universal run interrupted',
        expected: 'The project starts and exploration completes.',
        actual: error.message,
        technical: error.stack,
      });
    }
    console.error(error.stack || error);
  } finally {
    try {
      adapter.writeLogs(path.join(artifactDir, 'app.log'));
    } catch {}
    try {
      await eye.close();
    } catch {}
    await cleanup();
    process.removeListener('SIGINT', sigintHandler);
    process.removeListener('SIGTERM', sigtermHandler);
  }

  if (!launched) {
    fs.writeFileSync(
      path.join(artifactDir, 'startup-error.json'),
      `${JSON.stringify({ analysis, error: fatal?.message, stack: fatal?.stack }, null, 2)}\n`,
    );
    return { exitCode: 2, artifactDir, analysis, error: fatal };
  }

  fs.writeFileSync(
    path.join(artifactDir, 'adaptive-result.json'),
    `${JSON.stringify(eye._sanitize(adaptiveResult), null, 2)}\n`,
  );
  Object.assign(eye.artifacts, {
    projectAnalysis: config.urlOnlyTarget ? undefined : 'project-analysis.json',
    adaptive: 'adaptive-result.json',
    remediation: 'recommendations.md',
    appLog: 'app.log',
    resolvedConfig: 'resolved-config.json',
  });
  if (config.urlOnlyTarget) delete eye.artifacts.projectAnalysis;

  const result = eye.result({
    reviewMode: config.reviewMode || 'normal',
    review: {
      mode: config.reviewMode || 'normal',
      startedAt: new Date(runStartedMs).toISOString(),
    },
    application: {
      name: config.appName || analysis.projectName,
      projectName: analysis.projectName,
      stack: analysis.stack,
      projectDir: config.urlOnlyTarget ? null : projectDir,
      appDir: config.urlOnlyTarget ? null : analysis.appDir,
      baseURL,
      startCommand: config.urlOnlyTarget ? null : analysis.startCommand,
    },
    environment: {
      browser: `${String(config.browser || 'chromium')
        .charAt(0)
        .toUpperCase()}${String(config.browser || 'chromium').slice(1)} ${browserVersion}`,
      locale: config.locale,
      timezone: config.timezoneId,
      colorScheme: config.colorScheme,
      desktopViewport: `${config.viewport.width}×${config.viewport.height}`,
      responsiveProfiles: adaptiveResult.responsiveAudits
        .map(item => `${item.name} ${item.width}×${item.height}`)
        .join(', '),
      mode: config.mode,
    },
    adaptive: adaptiveResult,
    codeQuality,
    projectAnalysis: analysis,
    reportLocale: config.reportLocale,
    reportFormat: config.reportFormat,
    scopeDescription: `Project-agnostic ${config.mode} exploration of ${analysis.stack}: safe navigation, responsive viewports, browser protocols, accessibility, telemetry, and reproducible evidence.`,
    fatalError: fatal ? { message: fatal.message, stack: fatal.stack } : null,
  });

  result.schemaVersion = Math.max(Number(result.schemaVersion) || 0, 5);
  result.review = {
    ...(result.review || {}),
    endedAt: result.finishedAt || new Date().toISOString(),
    passed: true,
    summary: {},
  };
  // Phase 1: annotate every finding with confidence/kind, apply the `findings`
  // policy (suppress / minConfidence / elevate / treatAsSignal) and refresh the
  // surfaced issue list + severity summary. Runs before diff + gates so both see
  // only the surfaced, classified findings.
  const findingsResult = applyFindingsPolicy(result, config.findings);
  result.issues = findingsResult.issues;
  // Phase E (7.4.1): `issues` is the *surfaced* list used by reports and gates;
  // `issuesAll` is the complete annotated set (each row carries `surfaced`), so
  // calming the report never destroys forensic evidence. Diff/gates keep reading
  // `issues`, which preserves the 7.4.0 contract.
  result.issuesAll = findingsResult.allAnnotated;
  result.findings = findingsResult.findings;
  result.summary = {
    ...result.summary,
    issues: findingsResult.summary.issues,
    issuesRecorded: findingsResult.allAnnotated.length,
    severity: findingsResult.summary.severity,
  };

  if (config.compareWith && fs.existsSync(config.compareWith)) {
    const previous = JSON.parse(fs.readFileSync(config.compareWith, 'utf8'));
    result.diff = compareResults(previous, result);
    fs.writeFileSync(path.join(artifactDir, 'run-diff.json'), `${JSON.stringify(result.diff, null, 2)}\n`);
    result.artifacts.diff = 'run-diff.json';
  }
  // Phase 3: Core Web Vitals are always summarized — no config needed — so a
  // team can watch the trend before deciding whether to budget it.
  result.performance = summarizeVitals(eye.vitalsSnapshots);
  result.qualityGates = evaluateQualityGates(result, adaptiveResult, config.gates, {
    findings: config.findings,
    diff: result.diff,
  });
  for (const plugin of plugins) {
    const outcome = await runPluginHook(plugin, 'afterRun', [result, { config, artifactDir }]);
    if (!outcome.ok) {
      console.warn(`Warning: plugin ${plugin.id || '(unnamed)'} afterRun failed: ${outcome.error}`);
    }
  }
  logger.startPhase('reporting');
  writeRecommendations(
    result,
    adaptiveResult,
    path.join(artifactDir, 'recommendations.md'),
    config.reportLocale,
  );
  // Phase 1: the audit trail of every command UserEye ran or refused to run on
  // behalf of the target repository. Always present, even when empty.
  result.commandAudit = audit.toJSON();
  result.codeExecution = config.codeExecution;
  // 7.5.1 (item 5.2): hook failures land here so a broken plugin is visible in
  // the evidence even though it never breaks a run.
  result.pluginDiagnostics = pluginDiagnostics(plugins);
  // Phase 6: per-phase durations, opt-in so the default result.json shape is
  // unchanged. The engine already times every step precisely; the logger adds
  // the phases that live outside a step (startup, reporting), so the two
  // together account for the whole run rather than a sampled part of it.
  if (config.timings) {
    logger.endPhase('reporting');
    const own = logger.timings();
    const stepPhases = (result.steps || []).map(step => ({
      name: step.name,
      durationMs: step.durationMs,
      status: step.status,
      source: 'step',
    }));
    const phases = [...own.phases.map(phase => ({ ...phase, source: 'phase' })), ...stepPhases];
    result.timings = {
      phases,
      totalMs: phases.reduce((sum, phase) => sum + (phase.durationMs || 0), 0),
      wallClockMs: Date.now() - runStartedMs,
    };
  }
  result.review.passed = !fatal;
  result.review.summary = {
    issues: result.summary?.issues || 0,
    qualityGates: result.qualityGates?.passed ?? null,
  };
  fs.writeFileSync(path.join(artifactDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  const reports = writeReports(result, artifactDir, {
    locale: config.reportLocale,
    formats: config.reportFormat,
    sarif: config.sarif,
    report: config.report,
  });
  // 7.5.1 (item 2.5): now that every report exists, record what the run costs on
  // disk and rewrite result.json with `artifacts.totalBytes` / `files` / `largest`.
  writeResultJson(result, artifactDir);

  // Phase 5.3 failure UX: when auth is required but the run could not
  // authenticate, surface a machine-readable signal and exit 2 instead of a
  // pile of majors. Opt-in via `auth.required: true`.
  const authRequired =
    config.auth?.required === true && adaptiveResult.auth.detected && !adaptiveResult.auth.succeeded;
  if (authRequired) {
    const payload = {
      auth: adaptiveResult.auth,
      strategy: config.auth?.strategy || 'form',
      hint:
        config.auth?.strategy === 'storageState'
          ? 'Check auth.storageState path or run `usereye auth save` to refresh the session.'
          : config.auth?.strategy === 'hook'
            ? 'Check your hooks.login implementation for the SSO test user.'
            : 'Provide --email/--password or switch to auth.strategy hook/storageState.',
    };
    fs.writeFileSync(
      path.join(artifactDir, 'auth-required.json'),
      `${JSON.stringify(eye._sanitize(payload), null, 2)}\n`,
    );
    result.artifacts.authRequired = 'auth-required.json';
    console.error(`Auth required but not completed — wrote ${path.join(artifactDir, 'auth-required.json')}`);
  }

  logger.info('\n=== UserEye ===');
  logger.info(
    `Quality: ${adaptiveResult.quality.score}/100 · states: ${adaptiveResult.quality.uniqueStates} · URLs: ${adaptiveResult.quality.uniqueURLs}`,
  );
  logger.info(
    `Coverage: ${adaptiveResult.quality.coveragePercent}% · protocols failed: ${protocolResult?.summary.failed || 0}`,
  );
  logger.info(
    `Issues: ${result.summary.issues} · unexpected browser errors: ${result.summary.unexpectedBrowserErrors}`,
  );
  // Phase E (7.4.1): a calm run that exits 0 must not read as "nothing happened".
  // Show the actionable/signal split plus how much evidence was held back from
  // the primary list (still present in result.json under `issuesAll`).
  const findingStats = result.findings || {};
  logger.info(
    `Actionable: ${findingStats.actionable?.total ?? 0} · Signals: ${findingStats.signals ?? 0}` +
      (findingStats.heldBack
        ? ` · held below ${config.findings.minConfidence} confidence: ${findingStats.heldBack}`
        : ''),
  );
  logger.info(
    `${t(catalog(config.reportLocale), 'qualityGates')}: ${result.qualityGates.passed ? 'PASS' : 'FAIL'}`,
  );
  // A kept video next to `Quality gates: PASS` reads as a contradiction unless the
  // reason is stated: the default gates bound blockers and criticals, while
  // on-failure retention also triggers on majors, harmful misclicks and unexpected
  // browser errors. Saying so is cheaper than the reader reverse-engineering it.
  const videoOutcome = describeVideoOutcome(result.artifacts);
  if (videoOutcome) logger.info(`Video: ${videoOutcome}`);
  const traceOutcome = describeTraceOutcome(result.artifacts);
  if (traceOutcome) logger.info(`Trace: ${traceOutcome}`);
  logger.info(
    `Artifacts: ${artifactDir} (${formatBytes(result.artifacts.totalBytes)}, ${result.artifacts.files} files)`,
  );

  const exitCode = authRequired ? 2 : fatal || !result.qualityGates.passed ? 1 : 0;
  return { exitCode, artifactDir, analysis, config, result, reports };
}

async function main() {
  try {
    const output = await runAuto();
    process.exitCode = output.exitCode;
  } catch (error) {
    console.error(error.stack || error);
    process.exitCode = 2;
  }
}

if (require.main === module) main();

module.exports = { USAGE, ANALYZE_USAGE, appendQualityGate, evaluateQualityGates, runAuto };
