'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { resolveReportLocale } = require('./i18n');

const DEFAULT_CONFIG = Object.freeze({
  projectDir: '.',
  command: null,
  install: false,
  mode: 'standard',
  // Review type: keep --mode for exploration budget; reviewMode selects the audit runner.
  reviewMode: 'normal',
  headed: false,
  workers: 0,
  outDir: 'artifacts/usereye',
  keepArtifacts: false,
  // 7.5.1 (roadmap 7.5.0 item 2.3): local retention. 0 = clear outDir per run (CI
  // default, unchanged); n = move the previous run to `<outDir>-history/<stamp>` and
  // keep the newest n of them.
  keepLast: 0,
  // 7.5.1 (roadmap 7.5.0 item 3.4): minimum severity that makes `observe` exit 1.
  // Default null = the historical contract (any issue, or any unexpected browser
  // error). 'never' = findings never fail the run (unexpected browser errors still
  // do). The `auto` command ignores it.
  failOn: null,
  locale: 'en-US',
  timezoneId: 'UTC',
  colorScheme: 'light',
  viewport: { width: 1440, height: 900 },
  // 7.4.1 (calm defaults): bare CLI now matches what `usereye init` scaffolds.
  // 'on-failure' records the session but discards the video on a clean run, so a
  // green CI job pays no artifact cost. Opt back into always-on video with
  // `recordVideo: true` (config) or `--video` (CLI).
  recordVideo: 'on-failure',
  // 7.5.1 (roadmap 7.5.0 item 2.1): the Playwright trace was the largest artifact of a
  // clean run (1.8 MB for a 7-second demo). Same semantics as recordVideo: recorded,
  // discarded when the run is clean; `'always'` keeps it, `'never'` skips tracing.
  trace: 'on-failure',
  ignoreHTTPSErrors: false,
  credentials: {},
  storageState: null,
  auth: { strategy: 'form' },
  allowWrite: false,
  allowDestructive: false,
  allowDownloads: false,
  blockPaths: [],
  blockNamePatterns: [],
  seedPaths: [],
  ignoreQueryParams: true,
  patternPack: ['en'],
  patterns: {},
  hints: {},
  protocols: 'auto',
  browser: 'chromium',
  retries: 1,
  retryBackoffMs: 400,
  navigationTimeoutMs: 15000,
  dialogTimeoutMs: 5000,
  minActionDelayMs: 0,
  protocolTimeoutMs: 15000,
  startupTimeoutMs: 30000,
  axe: true,
  codeQuality: true,
  codeQualityTimeoutMs: 120000,
  // 7.5 (Phase 1 — code-execution boundary): analysing a *project* used to run
  // commands that come from the target repository (its npm scripts, its
  // node_modules binaries, `npm ci`/`pip install`). That is code execution on
  // behalf of an untrusted repo, so it is now OFF by default: `--project`
  // performs STATIC analysis only unless the operator opts in per category via
  // `--allow-project-commands lint,typecheck` or `codeExecution.*`.
  // Nothing is ever run through a shell — see command-runner.js.
  codeExecution: {
    npmScripts: false, // lint / format:check / typecheck / unit-tests from the target package.json
    binaries: false, // eslint / prettier / ruff / black / go / cargo from the target tree
    install: false, // npm ci / pip install (also requires `install: true`)
    start: true, // launching the app under test (the whole point of --project)
  },
  reportLocale: 'en',
  reportFormat: ['html', 'md'],
  // Phase E (7.4.1): the SARIF export has its own confidence floor because it feeds
  // GitHub code scanning. `result.json` always keeps every finding regardless.
  sarif: { minConfidence: 'medium' },
  // 7.5.1 (roadmap 7.5.0 item 2.2): budget (bytes) for screenshots embedded as data
  // URIs in report.html; beyond it screenshots are linked to the files next to the
  // report. A 2-observation quick run used to produce a 580 KB HTML.
  report: { embedLimit: 200 * 1024 },
  findings: {
    // 7.4.1 (calm defaults): the *primary* issue list starts at `medium` so a bare
    // run reads like a to-do list, not a firehose. This is presentation + gating
    // only — `result.json` still carries every annotated finding in `issuesAll`,
    // each flagged `surfaced: true|false`. Restore the old firehose with
    // `findings.minConfidence: 'low'`.
    minConfidence: 'medium',
    gateConfidence: 'high',
    suppress: [],
    elevate: [],
    treatAsSignal: [],
  },
  gates: {
    minAdaptiveScore: 70,
    maxBlocker: 0,
    maxCritical: 0,
    maxUnexpectedBrowserErrors: 0,
    // Optional (opt-in): maxMajor / failOnNewMajor / failOnNewHighConfidence are
    // only materialized into config.gates when the user sets them, so default
    // resolved configs keep the exact 7.1.1 shape.
  },
  // 7.4.1 (calm defaults): `stable-only` reserves "harmful" for hard signals
  // (URL change, dialog, dangerous control) instead of any repaint. Opt back into
  // the old lab behaviour with `misclick.policy: 'aggressive'` or
  // `--misclick-policy aggressive`.
  misclick: { policy: 'stable-only' },
  // 7.3: opt-in "user journey" probes (resilience + accessibility/device battery).
  // Default OFF — additive: enabling it never changes existing runs.
  userJourney: {
    enabled: false,
    resilience: {
      backgroundTab: true,
      unsavedClose: true,
      passwordRecovery: true,
      lockout: false,
      languageSwitch: true,
    },
    a11y: {
      permissions: true,
      fastScroll: true,
      keyboardShortcuts: true,
      mobileLayout: true,
      rightClick: true,
      deadLinks: true,
      textResize: true,
      highContrast: true,
      colorblind: true,
    },
    lockoutAttempts: 1,
    tempMail: null,
    // Answer to "does your app have a login system?". When set to false, every
    // login-only probe (password-recovery, lockout, temp-mail login) short-circuits
    // to `skipped` without touching the page. When left undefined, the probes
    // auto-detect a login form and only run if one is present.
    hasLogin: null,
  },
  // 7.4: opt-in "browser-extension" effect probes. They simulate the *net effect*
  // of the most popular Chrome extension categories (ad/content blockers, dark
  // mode, password managers, machine translation, coupon helpers, screen
  // capture, React devtools, per-tab audio) on the running app and report how it
  // reacts. Default OFF — additive; never changes existing runs.
  extensions: {
    enabled: false,
    categories: {
      adBlocker: true,
      darkReader: true,
      passwordManager: true,
      translator: true,
      couponHelper: true,
      fullPageCapture: true,
      reactDevtools: true,
      volumeBooster: true,
    },
  },
  allowedHosts: [],
  respectRobots: false,
  hooks: {},
  plugins: [],
  profiles: {},
  dryRun: false,
  // 7.5 (Phase 6 — observability). Structured, machine-consumable logging.
  logLevel: 'info', // error | warn | info | debug | trace
  logJson: false,
  timings: false,
  performanceSeo: {
    engine: 'native',
    urls: [],
    formFactor: 'mobile',
    runs: 1,
    aggregation: 'median',
    budgets: {
      lcpMs: 2500,
      inpMs: 200,
      cls: 0.1,
      totalByteWeightKb: 1600,
      scriptKb: 350,
      imageKb: 900,
      seoScore: 0.9,
    },
    seo: {
      checkRobotsTxt: true,
      checkSitemap: false,
      requireCanonical: false,
      requireMetaDescription: true,
      requireDescriptiveLinks: true,
    },
  },
  flows: {
    files: [],
    projects: ['chromium'],
    timeoutMs: 30000,
    retries: 0,
    trace: 'on-failure',
    video: 'on-failure',
    failOnConsoleError: true,
    runAxeAfterSteps: false,
  },
  accessibilityStrict: {
    standard: 'WCAG2AA',
    axe: {
      runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'],
      resultTypes: ['violations', 'incomplete', 'passes'],
    },
    incomplete: 'needs-review',
    pa11y: {
      enabled: false,
      runners: ['axe', 'htmlcs'],
      includeWarnings: true,
      includeNotices: false,
      threshold: 0,
    },
    baseline: null,
  },
});

const VALUE_FLAGS = new Set([
  'config',
  'project',
  'app-dir',
  'url',
  'command',
  'mode',
  'review-mode',
  'flows',
  'email',
  'username',
  'password',
  'protocols',
  'workers',
  'out',
  'compare',
  'profile',
  'locale',
  'timezone',
  'color-scheme',
  'wait',
  'startup-timeout',
  'protocol-timeout',
  'code-quality-timeout',
  'storage-state',
  'env',
  'report-locale',
  'report-format',
  'min-score',
  'max-blocker',
  'max-critical',
  'max-browser-errors',
  'viewport',
  'seed',
  'block-path',
  'block-name',
  'pattern-pack',
  'browser',
  'retries',
  'navigation-timeout',
  'dialog-timeout',
  'min-delay',
  'misclick-policy',
  // 7.5.1 — trace policy (on-failure | always | never)
  'trace',
  // 7.5.1 — local retention of previous runs
  'keep-last',
  // 7.5.1 — observe gate: minimum severity that exits 1 (never | minor | major | critical | blocker)
  'fail-on',
  // Phase 1 — code-execution boundary (comma separated: lint,typecheck,format,install,binaries,all)
  'allow-project-commands',
  // Phase 6 — observability
  'log-level',
]);

const BOOLEAN_FLAGS = new Set([
  'mobile',
  'headed',
  'axe',
  'install',
  'allow-write',
  'allow-destructive',
  'allow-downloads',
  'keep',
  'analyze',
  'no-axe',
  'video',
  'no-video',
  'video-on-failure',
  'no-code-quality',
  'dry-run',
  'help',
  'version',
  'ignore-https-errors',
  'no-ignore-query-params',
  'log-json',
  'timings',
  'update-check',
  'no-update-check',
]);

/**
 * Phase 1: categories accepted by `--allow-project-commands`.
 * Each maps onto one or more `codeExecution.*` switches.
 */
const PROJECT_COMMAND_CATEGORIES = Object.freeze({
  lint: ['npmScripts', 'binaries'],
  format: ['npmScripts', 'binaries'],
  typecheck: ['npmScripts', 'binaries'],
  'unit-tests': ['npmScripts'],
  scripts: ['npmScripts'],
  binaries: ['binaries'],
  install: ['install'],
  all: ['npmScripts', 'binaries', 'install'],
});

/** 7.5.1: accepted values of `trace` (config) / `--trace` (CLI). */
const TRACE_POLICIES = Object.freeze(['on-failure', 'always', 'never']);

/** 7.5.1 (item 3.4): accepted values of `failOn` (config) / `--fail-on` (CLI, observe). */
const FAIL_ON_LEVELS = Object.freeze(['never', 'minor', 'major', 'critical', 'blocker']);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !(value instanceof RegExp);
}

function mergeConfig(base, overlay) {
  if (!isPlainObject(base) || !isPlainObject(overlay)) {
    return overlay === undefined ? base : overlay;
  }
  const output = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    if (value === undefined) continue;
    output[key] =
      isPlainObject(value) && isPlainObject(output[key]) ? mergeConfig(output[key], value) : value;
  }
  return output;
}

function parseArgv(argv = []) {
  const values = {};
  const explicit = new Set();
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const equal = token.indexOf('=');
    const name = token.slice(2, equal > 0 ? equal : undefined);
    if (!VALUE_FLAGS.has(name) && !BOOLEAN_FLAGS.has(name)) {
      throw new Error(`Unknown option: --${name}`);
    }
    explicit.add(name);
    if (BOOLEAN_FLAGS.has(name)) {
      values[name] = true;
      continue;
    }
    const value = equal > 0 ? token.slice(equal + 1) : argv[++index];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Option --${name} requires a value.`);
    }
    if (['env', 'seed', 'block-path', 'block-name'].includes(name)) {
      values[name] ||= [];
      values[name].push(value);
    } else {
      values[name] = value;
    }
  }
  return { values, explicit, positionals };
}

function cliConfig(parsed) {
  const value = parsed.values;
  const out = {};
  const copy = (flag, key = flag) => {
    if (parsed.explicit.has(flag)) out[key] = value[flag];
  };
  copy('project', 'projectDir');
  copy('app-dir', 'appDir');
  copy('url', 'baseURL');
  copy('command');
  copy('mode');
  copy('review-mode', 'reviewMode');
  copy('workers');
  copy('out', 'outDir');
  copy('compare', 'compareWith');
  copy('profile');
  copy('locale');
  copy('timezone', 'timezoneId');
  copy('color-scheme', 'colorScheme');
  copy('startup-timeout', 'startupTimeoutMs');
  copy('browser');
  copy('retries');
  copy('navigation-timeout', 'navigationTimeoutMs');
  copy('dialog-timeout', 'dialogTimeoutMs');
  copy('min-delay', 'minActionDelayMs');
  copy('protocol-timeout', 'protocolTimeoutMs');
  copy('code-quality-timeout', 'codeQualityTimeoutMs');
  copy('storage-state', 'storageState');
  copy('report-locale', 'reportLocale');
  copy('report-format', 'reportFormat');
  copy('protocols');
  if (parsed.explicit.has('flows'))
    out.flows = {
      files: String(value.flows)
        .split(',')
        .map(item => item.trim())
        .filter(Boolean),
    };
  if (parsed.explicit.has('headed')) out.headed = true;
  if (parsed.explicit.has('install')) out.install = true;
  if (parsed.explicit.has('allow-write')) out.allowWrite = true;
  if (parsed.explicit.has('allow-destructive')) out.allowDestructive = true;
  if (parsed.explicit.has('allow-downloads')) out.allowDownloads = true;
  if (parsed.explicit.has('keep')) out.keepArtifacts = true;
  if (parsed.explicit.has('keep-last')) {
    const keepLast = Number(value['keep-last']);
    if (!Number.isInteger(keepLast) || keepLast < 0) {
      throw new Error(`--keep-last must be a non-negative integer (got "${value['keep-last']}").`);
    }
    out.keepLast = keepLast;
  }
  if (parsed.explicit.has('axe')) out.axe = true;
  if (parsed.explicit.has('no-axe')) out.axe = false;
  // 7.4.1: tri-state video opt-back knobs. `--video` forces the webm on,
  // `--video-on-failure` selects the calm default explicitly, `--no-video` turns
  // recording off entirely. They are mutually exclusive so a CI job can never
  // silently contradict itself (usage error -> exit 2).
  const videoFlags = ['video', 'video-on-failure', 'no-video'].filter(flag => parsed.explicit.has(flag));
  if (videoFlags.length > 1) {
    throw new Error(
      `Conflicting video flags: ${videoFlags.map(flag => `--${flag}`).join(', ')}. Pass exactly one.`,
    );
  }
  if (videoFlags.length === 1) {
    out.recordVideo =
      videoFlags[0] === 'video' ? true : videoFlags[0] === 'video-on-failure' ? 'on-failure' : false;
  }
  if (parsed.explicit.has('trace')) {
    const policy = String(value.trace).trim();
    if (!TRACE_POLICIES.includes(policy)) {
      throw new Error(`--trace must be ${TRACE_POLICIES.join(', ')} (got "${policy}").`);
    }
    out.trace = policy;
  }
  // 7.5.1 (item 3.4): observe gate severity. Unrecognized values are a usage error
  // rather than silently keeping the default gate.
  if (parsed.explicit.has('fail-on')) {
    const failOn = String(value['fail-on']).trim();
    if (!FAIL_ON_LEVELS.includes(failOn)) {
      throw new Error(`--fail-on must be ${FAIL_ON_LEVELS.join(', ')} (got "${failOn}").`);
    }
    out.failOn = failOn;
  }
  if (parsed.explicit.has('misclick-policy')) {
    const policy = String(value['misclick-policy']).trim();
    if (!['stable-only', 'aggressive'].includes(policy)) {
      throw new Error(`--misclick-policy must be stable-only or aggressive (got "${policy}").`);
    }
    out.misclick = { policy };
  }
  if (parsed.explicit.has('no-code-quality')) out.codeQuality = false;
  // Phase 1: explicit, category-scoped opt-in to executing target-repo commands.
  if (parsed.explicit.has('allow-project-commands')) {
    const requested = String(value['allow-project-commands'])
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);
    if (!requested.length) {
      throw new Error(
        `--allow-project-commands requires at least one of: ${Object.keys(PROJECT_COMMAND_CATEGORIES).join(', ')}.`,
      );
    }
    const codeExecution = {};
    for (const category of requested) {
      const switches = PROJECT_COMMAND_CATEGORIES[category];
      if (!switches) {
        throw new Error(
          `Unknown --allow-project-commands category "${category}". Use ${Object.keys(PROJECT_COMMAND_CATEGORIES).join(', ')}.`,
        );
      }
      for (const key of switches) codeExecution[key] = true;
    }
    out.codeExecution = codeExecution;
  }
  // Phase 6: observability.
  if (parsed.explicit.has('log-level')) out.logLevel = value['log-level'];
  if (parsed.explicit.has('log-json')) out.logJson = true;
  if (parsed.explicit.has('timings')) out.timings = true;
  if (parsed.explicit.has('update-check')) out.updateCheck = true;
  if (parsed.explicit.has('no-update-check')) out.updateCheck = false;
  if (parsed.explicit.has('dry-run') || parsed.explicit.has('analyze')) out.dryRun = true;
  if (parsed.explicit.has('ignore-https-errors')) out.ignoreHTTPSErrors = true;
  if (parsed.explicit.has('no-ignore-query-params')) out.ignoreQueryParams = false;
  if (parsed.explicit.has('mobile')) out.viewport = { width: 390, height: 844 };
  if (parsed.explicit.has('viewport')) {
    const match = String(value.viewport).match(/^(\d+)x(\d+)$/i);
    if (!match) throw new Error('--viewport must use WIDTHxHEIGHT, for example 1440x900.');
    out.viewport = { width: Number(match[1]), height: Number(match[2]) };
  }
  const credentials = {};
  for (const key of ['email', 'username', 'password']) {
    if (parsed.explicit.has(key)) credentials[key] = value[key];
  }
  if (Object.keys(credentials).length) out.credentials = credentials;
  if (parsed.explicit.has('env')) {
    out.env = Object.fromEntries(
      value.env.map(entry => {
        const separator = entry.indexOf('=');
        if (separator < 1) throw new Error(`Invalid --env value: ${entry}. Use KEY=VALUE.`);
        return [entry.slice(0, separator), entry.slice(separator + 1)];
      }),
    );
  }
  if (parsed.explicit.has('seed')) out.seedPaths = value.seed;
  if (parsed.explicit.has('block-path')) out.blockPaths = value['block-path'];
  if (parsed.explicit.has('block-name')) out.blockNamePatterns = value['block-name'];
  if (parsed.explicit.has('pattern-pack'))
    out.patternPack = String(value['pattern-pack']).split(',').filter(Boolean);
  const gates = {};
  const gateFlags = {
    'min-score': 'minAdaptiveScore',
    'max-blocker': 'maxBlocker',
    'max-critical': 'maxCritical',
    'max-browser-errors': 'maxUnexpectedBrowserErrors',
  };
  for (const [flag, key] of Object.entries(gateFlags)) {
    if (parsed.explicit.has(flag)) gates[key] = Number(value[flag]);
  }
  if (Object.keys(gates).length) out.gates = gates;
  if (parsed.positionals[0] && /^https?:\/\//i.test(parsed.positionals[0]) && !out.baseURL) {
    out.baseURL = parsed.positionals[0];
  }
  return out;
}

function environmentConfig(env = process.env) {
  const out = {};
  const map = {
    USEREYE_BASE_URL: 'baseURL',
    USEREYE_MODE: 'mode',
    USEREYE_REVIEW_MODE: 'reviewMode',
    USEREYE_STORAGE_STATE: 'storageState',
    USEREYE_LOCALE: 'locale',
    USEREYE_TIMEZONE: 'timezoneId',
    USEREYE_COLOR_SCHEME: 'colorScheme',
    USEREYE_REPORT_LOCALE: 'reportLocale',
    USEREYE_OUT_DIR: 'outDir',
    USEREYE_BROWSER: 'browser',
    USEREYE_LOG_LEVEL: 'logLevel',
  };
  for (const [envKey, key] of Object.entries(map)) {
    if (env[envKey] !== undefined) out[key] = env[envKey];
  }
  const credentials = {};
  if (env.USEREYE_EMAIL !== undefined) credentials.email = env.USEREYE_EMAIL;
  if (env.USEREYE_USERNAME !== undefined) credentials.username = env.USEREYE_USERNAME;
  if (env.USEREYE_PASSWORD !== undefined) credentials.password = env.USEREYE_PASSWORD;
  if (Object.keys(credentials).length) out.credentials = credentials;
  return out;
}

function discoverConfig(projectDir, explicitPath, env = process.env, explicitBase = process.cwd()) {
  if (explicitPath || env.USEREYE_CONFIG) {
    const requested = path.resolve(explicitBase, explicitPath || env.USEREYE_CONFIG);
    if (!fs.existsSync(requested)) throw new Error(`UserEye config not found: ${requested}`);
    return { path: requested, packageProperty: false };
  }
  for (const name of [
    'usereye.config.js',
    'usereye.config.mjs',
    'usereye.config.cjs',
    'usereye.config.json',
  ]) {
    const candidate = path.join(projectDir, name);
    if (fs.existsSync(candidate)) return { path: candidate, packageProperty: false };
  }
  const packagePath = path.join(projectDir, 'package.json');
  if (fs.existsSync(packagePath)) {
    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    if (pkg.usereye) return { path: packagePath, packageProperty: true };
  }
  return null;
}

async function importConfig(discovered, context) {
  if (!discovered) return {};
  let loaded;
  if (discovered.packageProperty) {
    loaded = JSON.parse(fs.readFileSync(discovered.path, 'utf8')).usereye;
  } else if (path.extname(discovered.path) === '.json') {
    loaded = JSON.parse(fs.readFileSync(discovered.path, 'utf8'));
  } else {
    try {
      delete require.cache[require.resolve(discovered.path)];
      loaded = require(discovered.path);
    } catch (error) {
      if (error.code !== 'ERR_REQUIRE_ESM') throw error;
      loaded = (await import(`${pathToFileURL(discovered.path).href}?t=${Date.now()}`)).default;
    }
    loaded = loaded?.default || loaded;
  }
  if (typeof loaded === 'function') loaded = await loaded(context);
  if (!isPlainObject(loaded)) throw new Error(`UserEye config must export an object: ${discovered.path}`);
  return loaded;
}

function asNumber(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Expected a number, received: ${value}`);
  return number;
}

function normalizePerformanceSeo(input = {}) {
  const cfg = isPlainObject(input) ? input : {};
  const budgets = isPlainObject(cfg.budgets) ? cfg.budgets : {};
  return {
    engine: cfg.engine === 'lighthouse' ? 'lighthouse' : 'native',
    urls: Array.isArray(cfg.urls) ? cfg.urls : [],
    formFactor: ['mobile', 'desktop', 'both'].includes(cfg.formFactor) ? cfg.formFactor : 'mobile',
    runs: Math.max(1, Math.min(10, asNumber(cfg.runs, 1))),
    aggregation: cfg.aggregation === 'mean' ? 'mean' : 'median',
    budgets: {
      lcpMs: Math.max(0, asNumber(budgets.lcpMs, 2500)),
      inpMs: Math.max(0, asNumber(budgets.inpMs, 200)),
      cls: Math.max(0, asNumber(budgets.cls, 0.1)),
      totalByteWeightKb: Math.max(0, asNumber(budgets.totalByteWeightKb, 1600)),
      scriptKb: Math.max(0, asNumber(budgets.scriptKb, 350)),
      imageKb: Math.max(0, asNumber(budgets.imageKb, 900)),
      seoScore: Math.max(0, Math.min(1, asNumber(budgets.seoScore, 0.9))),
    },
    seo: {
      checkRobotsTxt: cfg.seo?.checkRobotsTxt !== false,
      checkSitemap: cfg.seo?.checkSitemap === true,
      requireCanonical: cfg.seo?.requireCanonical === true,
      requireMetaDescription: cfg.seo?.requireMetaDescription !== false,
      requireDescriptiveLinks: cfg.seo?.requireDescriptiveLinks !== false,
    },
  };
}

function normalizeFlows(input = {}, baseDir = process.cwd()) {
  const cfg = isPlainObject(input) ? input : {};
  return {
    files: (Array.isArray(cfg.files) ? cfg.files : []).map(file => path.resolve(baseDir, String(file))),
    projects: Array.isArray(cfg.projects) && cfg.projects.length ? cfg.projects : ['chromium'],
    timeoutMs: Math.max(1, asNumber(cfg.timeoutMs, 30000)),
    retries: Math.max(0, asNumber(cfg.retries, 0)),
    trace: TRACE_POLICIES.includes(cfg.trace) ? cfg.trace : 'on-failure',
    video: cfg.video === true || cfg.video === false || cfg.video === 'on-failure' ? cfg.video : 'on-failure',
    failOnConsoleError: cfg.failOnConsoleError !== false,
    runAxeAfterSteps: cfg.runAxeAfterSteps === true,
  };
}

function normalizeAccessibilityStrict(input = {}, baseDir = process.cwd()) {
  const cfg = isPlainObject(input) ? input : {};
  const axe = isPlainObject(cfg.axe) ? cfg.axe : {};
  const pa11y = isPlainObject(cfg.pa11y) ? cfg.pa11y : {};
  return {
    standard: ['WCAG2A', 'WCAG2AA', 'WCAG2AAA'].includes(cfg.standard) ? cfg.standard : 'WCAG2AA',
    axe: {
      runOnly:
        Array.isArray(axe.runOnly) && axe.runOnly.length
          ? axe.runOnly
          : ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'],
      resultTypes:
        Array.isArray(axe.resultTypes) && axe.resultTypes.length
          ? axe.resultTypes
          : ['violations', 'incomplete', 'passes'],
    },
    incomplete: ['off', 'needs-review', 'fail'].includes(cfg.incomplete) ? cfg.incomplete : 'needs-review',
    pa11y: {
      enabled: pa11y.enabled === true,
      runners: Array.isArray(pa11y.runners) && pa11y.runners.length ? pa11y.runners : ['axe', 'htmlcs'],
      includeWarnings: pa11y.includeWarnings !== false,
      includeNotices: pa11y.includeNotices === true,
      threshold: Math.max(0, asNumber(pa11y.threshold, 0)),
    },
    baseline: cfg.baseline ? path.resolve(baseDir, String(cfg.baseline)) : null,
  };
}

function normalizeConfig(config, baseDir) {
  const result = { ...config };
  result.projectDir = path.resolve(baseDir, result.projectDir || '.');
  if (result.appDir) result.appDir = path.resolve(result.projectDir, result.appDir);
  result.outDir = path.resolve(result.projectDir, result.outDir || 'artifacts/usereye');
  if (result.storageState) result.storageState = path.resolve(baseDir, result.storageState);
  if (result.compareWith) result.compareWith = path.resolve(result.projectDir, result.compareWith);
  result.workers = asNumber(result.workers, 0);
  result.retries = Math.max(0, asNumber(result.retries, 1));
  result.retryBackoffMs = Math.max(0, asNumber(result.retryBackoffMs, 400));
  result.navigationTimeoutMs = Math.max(0, asNumber(result.navigationTimeoutMs, 15000));
  result.dialogTimeoutMs = Math.max(0, asNumber(result.dialogTimeoutMs, 5000));
  result.minActionDelayMs = Math.max(0, asNumber(result.minActionDelayMs, 0));
  result.startupTimeoutMs = asNumber(result.startupTimeoutMs, 30000);
  result.protocolTimeoutMs = asNumber(result.protocolTimeoutMs, 15000);
  result.codeQualityTimeoutMs = asNumber(result.codeQualityTimeoutMs, 120000);
  const gatesInput = result.gates || {};
  result.gates = {
    minAdaptiveScore: asNumber(gatesInput.minAdaptiveScore, 70),
    maxBlocker: asNumber(gatesInput.maxBlocker, 0),
    maxCritical: asNumber(gatesInput.maxCritical, 0),
    maxUnexpectedBrowserErrors: asNumber(gatesInput.maxUnexpectedBrowserErrors, 0),
  };
  // Optional gate keys are materialized only when the user opts in.
  if (gatesInput.maxMajor !== undefined && gatesInput.maxMajor !== null) {
    result.gates.maxMajor = Math.max(0, asNumber(gatesInput.maxMajor, 0));
  }
  if (gatesInput.failOnNewMajor !== undefined) {
    result.gates.failOnNewMajor = gatesInput.failOnNewMajor === true;
  }
  if (gatesInput.failOnNewHighConfidence !== undefined) {
    result.gates.failOnNewHighConfidence = gatesInput.failOnNewHighConfidence === true;
  }
  // Phase 3 (experimental): Core Web Vitals budgets. Materialized only when the
  // user sets them, so the default resolved config keeps its 7.4.1 shape.
  // `performanceMode` defaults to 'signal' — measured and reported, never
  // failing — because a measurement taken mid-exploration is too noisy to gate.
  for (const key of ['maxLcpMs', 'maxCls', 'maxInpMs']) {
    if (gatesInput[key] !== undefined && gatesInput[key] !== null) {
      result.gates[key] = Math.max(0, asNumber(gatesInput[key], 0));
    }
  }
  if (gatesInput.performanceMode !== undefined) {
    if (!['signal', 'gate'].includes(gatesInput.performanceMode)) {
      throw new Error(`Invalid gates.performanceMode: ${gatesInput.performanceMode}. Use signal or gate.`);
    }
    result.gates.performanceMode = gatesInput.performanceMode;
  }
  result.findings = {
    // Fallbacks mirror DEFAULT_CONFIG (7.4.1 calm profile) so an invalid or
    // missing value degrades to the documented default, not to the loud one.
    minConfidence: ['low', 'medium', 'high'].includes(result.findings?.minConfidence)
      ? result.findings.minConfidence
      : 'medium',
    gateConfidence: ['low', 'medium', 'high'].includes(result.findings?.gateConfidence)
      ? result.findings.gateConfidence
      : 'high',
    suppress: Array.isArray(result.findings?.suppress) ? result.findings.suppress : [],
    elevate: Array.isArray(result.findings?.elevate) ? result.findings.elevate : [],
    treatAsSignal: Array.isArray(result.findings?.treatAsSignal) ? result.findings.treatAsSignal : [],
  };
  result.misclick = {
    policy: result.misclick?.policy === 'aggressive' ? 'aggressive' : 'stable-only',
  };
  result.sarif = {
    minConfidence: ['low', 'medium', 'high'].includes(result.sarif?.minConfidence)
      ? result.sarif.minConfidence
      : DEFAULT_CONFIG.sarif.minConfidence,
  };
  // `recordVideo` is tri-state: `false` (never record), `true` (always keep the
  // webm) and `'on-failure'` (record, then discard on a clean run). Anything
  // unrecognized degrades to the calm default instead of silently enabling video.
  result.recordVideo =
    result.recordVideo === true || result.recordVideo === false
      ? result.recordVideo
      : result.recordVideo === 'on-failure'
        ? 'on-failure'
        : DEFAULT_CONFIG.recordVideo;
  // 7.5.1: keepLast — a non-negative integer; anything else means "no retention".
  result.keepLast =
    Number.isInteger(Number(result.keepLast)) && Number(result.keepLast) >= 0 ? Number(result.keepLast) : 0;
  // 7.5.1: report.embedLimit — a non-negative number of bytes, or 'unlimited'.
  const embedLimit = result.report?.embedLimit;
  result.report = {
    ...(isPlainObject(result.report) ? result.report : {}),
    embedLimit:
      embedLimit === 'unlimited' || embedLimit === Infinity
        ? 'unlimited'
        : Number.isFinite(Number(embedLimit)) && Number(embedLimit) >= 0 && embedLimit !== null
          ? Number(embedLimit)
          : DEFAULT_CONFIG.report.embedLimit,
  };
  // 7.5.1: `trace` mirrors the video policy. Unrecognized values degrade to the calm
  // default ('on-failure') rather than silently disabling or forcing the trace.
  result.trace = TRACE_POLICIES.includes(result.trace) ? result.trace : DEFAULT_CONFIG.trace;
  // 7.5.1 (item 3.4): observe gate level; anything unrecognized degrades to the
  // historical contract (null = any issue fails the run), never to a silent 'never'.
  result.failOn = FAIL_ON_LEVELS.includes(result.failOn) ? result.failOn : null;
  // 7.3 user-journey battery: additive + opt-in. When enabled it adds resilience and
  // accessibility/device probes to standard/deep runs. `lockout` defaults false because
  // it intentionally sends a wrong password — only run it against sandboxed targets.
  const uj = result.userJourney || {};
  result.userJourney = {
    enabled: uj.enabled === true,
    resilience: {
      backgroundTab: uj.resilience?.backgroundTab !== false,
      unsavedClose: uj.resilience?.unsavedClose !== false,
      passwordRecovery: uj.resilience?.passwordRecovery !== false,
      lockout: uj.resilience?.lockout === true,
      languageSwitch: uj.resilience?.languageSwitch !== false,
    },
    a11y: {
      permissions: uj.a11y?.permissions !== false,
      fastScroll: uj.a11y?.fastScroll !== false,
      keyboardShortcuts: uj.a11y?.keyboardShortcuts !== false,
      mobileLayout: uj.a11y?.mobileLayout !== false,
      rightClick: uj.a11y?.rightClick !== false,
      deadLinks: uj.a11y?.deadLinks !== false,
      textResize: uj.a11y?.textResize !== false,
      highContrast: uj.a11y?.highContrast !== false,
      colorblind: uj.a11y?.colorblind !== false,
    },
    lockoutAttempts: Math.max(1, Number(uj.lockoutAttempts) || 1),
    tempMail: uj.tempMail && typeof uj.tempMail === 'object' ? uj.tempMail : null,
    // `hasLogin`: null = auto-detect; false = no login system (skip login probes);
    // true = login present (run them). Stored as-is.
    hasLogin: uj.hasLogin === true ? true : uj.hasLogin === false ? false : null,
  };
  // 7.4 browser-extension effect battery (additive, opt-in).
  const ext = result.extensions || {};
  result.extensions = {
    enabled: ext.enabled === true,
    categories: {
      adBlocker: ext.categories?.adBlocker !== false,
      darkReader: ext.categories?.darkReader !== false,
      passwordManager: ext.categories?.passwordManager !== false,
      translator: ext.categories?.translator !== false,
      couponHelper: ext.categories?.couponHelper !== false,
      fullPageCapture: ext.categories?.fullPageCapture !== false,
      reactDevtools: ext.categories?.reactDevtools !== false,
      volumeBooster: ext.categories?.volumeBooster !== false,
    },
  };
  result.consent = {
    strict: result.consent?.strict === true,
    selectors: Array.isArray(result.consent?.selectors) ? result.consent.selectors : [],
    minWallArea: Number.isFinite(Number(result.consent?.minWallArea))
      ? Number(result.consent.minWallArea)
      : 0.18,
  };
  if (
    Array.isArray(result.consentSelectors) &&
    result.consentSelectors.length &&
    !result.consent.selectors.length
  ) {
    result.consent.selectors = result.consentSelectors;
  }
  if (!Array.isArray(result.allowedHosts)) result.allowedHosts = [];
  result.respectRobots = result.respectRobots === true;
  result.ignoreHash = result.ignoreHash === true;
  result.ready = {
    strategy: ['selector', 'load', 'network-almost-idle', 'quiet'].includes(result.ready?.strategy)
      ? result.ready.strategy
      : result.ready?.selector
        ? 'selector'
        : 'quiet',
    selector: result.ready?.selector || null,
    timeoutMs: Number.isFinite(Number(result.ready?.timeoutMs)) ? Number(result.ready.timeoutMs) : 10000,
  };
  result.diveIntoIframes = result.diveIntoIframes === 'same-origin' ? 'same-origin' : 'off';
  result.maxWallClockMs =
    result.maxWallClockMs === undefined || result.maxWallClockMs === null
      ? null
      : Math.max(0, asNumber(result.maxWallClockMs, 0));
  if (typeof result.reportFormat === 'string')
    result.reportFormat = result.reportFormat.split(',').map(v => v.trim());
  if (typeof result.patternPack === 'string')
    result.patternPack = result.patternPack.split(',').map(v => v.trim());
  if (!Array.isArray(result.patternPack)) result.patternPack = ['en'];
  if (!Array.isArray(result.seedPaths)) result.seedPaths = [];
  if (!Array.isArray(result.blockPaths)) result.blockPaths = [];
  if (!Array.isArray(result.blockNamePatterns)) result.blockNamePatterns = [];
  if (!Array.isArray(result.plugins)) result.plugins = [];
  result.reviewMode = result.reviewMode || 'normal';
  if (!['normal', 'perf-seo', 'flows', 'a11y-strict'].includes(result.reviewMode)) {
    throw new Error(`Invalid reviewMode: ${result.reviewMode}. Use normal, perf-seo, flows, or a11y-strict.`);
  }
  result.performanceSeo = normalizePerformanceSeo(result.performanceSeo);
  result.flows = normalizeFlows(result.flows, baseDir);
  result.accessibilityStrict = normalizeAccessibilityStrict(result.accessibilityStrict, baseDir);
  if (!['quick', 'standard', 'deep'].includes(result.mode)) {
    throw new Error(`Invalid mode: ${result.mode}. Use quick, standard, or deep.`);
  }
  if (!['chromium', 'firefox', 'webkit'].includes(result.browser || 'chromium')) {
    throw new Error(`Invalid browser: ${result.browser}. Use chromium, firefox, or webkit.`);
  }
  result.browser = result.browser || 'chromium';
  if (!['light', 'dark', 'no-preference'].includes(result.colorScheme)) {
    throw new Error(`Invalid colorScheme: ${result.colorScheme}.`);
  }
  if (!['en', 'pt', 'pt-BR', 'es', 'fr', 'auto'].includes(result.reportLocale)) {
    throw new Error(`Unsupported reportLocale: ${result.reportLocale}. Use en, pt, pt-BR, es, fr or auto.`);
  }
  // Phase 7: `auto` derives the report language from the run locale (config.locale).
  if (result.reportLocale === 'auto') {
    result.reportLocale = resolveReportLocale(result.locale);
  }
  if (!['form', 'storageState', 'hook'].includes(result.auth?.strategy || 'form')) {
    throw new Error(`Unsupported auth strategy: ${result.auth?.strategy}.`);
  }
  if (result.zoomMode !== undefined && !['css', 'viewport', 'cdp'].includes(result.zoomMode)) {
    throw new Error(`Invalid zoomMode: ${result.zoomMode}. Use css, viewport, or cdp.`);
  }
  result.zoomMode = result.zoomMode || 'css';
  // ---- Phase 1: code-execution boundary -------------------------------------
  // Everything defaults to `false` (static analysis only). `start` stays true
  // because launching the app under test is the explicit purpose of --project
  // and is already gated behind the user pointing UserEye at that project.
  const codeExecution = isPlainObject(result.codeExecution) ? result.codeExecution : {};
  result.codeExecution = {
    npmScripts: codeExecution.npmScripts === true,
    binaries: codeExecution.binaries === true,
    install: codeExecution.install === true,
    start: codeExecution.start !== false,
  };
  // `--install` is a *request*; it only takes effect when the install category
  // is also authorized. Keeping them separate means a config file cannot
  // silently re-enable dependency installation for an untrusted repo.
  result.install = result.install === true;
  // ---- Phase 6: observability ----------------------------------------------
  if (!LOG_LEVELS.includes(result.logLevel)) {
    if (result.logLevel !== undefined && result.logLevel !== null) {
      throw new Error(`Invalid logLevel: ${result.logLevel}. Use ${LOG_LEVELS.join(', ')}.`);
    }
    result.logLevel = 'info';
  }
  result.logJson = result.logJson === true;
  result.timings = result.timings === true;
  result.updateCheck = result.updateCheck === true;
  return result;
}

/** Accepted log levels, quietest first (Phase 6). */
const LOG_LEVELS = ['error', 'warn', 'info', 'debug', 'trace'];

/**
 * Phase 5 — config governance.
 *
 * `DEFAULT_CONFIG` no longer describes the whole accepted surface: several keys
 * (`baseURL`, `apps`, `consent`, `ready`, …) are only materialized by
 * `normalizeConfig`. This list closes that gap so a typo in a user config file
 * is reported instead of silently ignored.
 */
const EXTRA_KNOWN_KEYS = Object.freeze([
  'appDir',
  'apps',
  'baseURL',
  'url',
  'compareWith',
  'configFile',
  'consent',
  'consentSelectors',
  'diveIntoIframes',
  'env',
  'ignoreHash',
  'maxWallClockMs',
  'profile',
  'ready',
  'strictConfig',
  'updateCheck',
  'zoomMode',
]);

const KNOWN_CONFIG_KEYS = Object.freeze([...Object.keys(DEFAULT_CONFIG), ...EXTRA_KNOWN_KEYS].sort());

/** Levenshtein distance, used only to suggest the intended key. */
function editDistance(a, b) {
  const rows = Array.from({ length: b.length + 1 }, (unused, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = rows[0];
    rows[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const temp = rows[j];
      rows[j] = Math.min(rows[j] + 1, rows[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = temp;
    }
  }
  return rows[b.length];
}

function suggestConfigKey(key) {
  let best = null;
  let bestDistance = Infinity;
  for (const known of KNOWN_CONFIG_KEYS) {
    const distance = editDistance(key.toLowerCase(), known.toLowerCase());
    if (distance < bestDistance) {
      bestDistance = distance;
      best = known;
    }
  }
  return bestDistance <= Math.max(2, Math.floor(key.length / 3)) ? best : null;
}

/**
 * Inspect a *user-authored* config object for keys UserEye does not know.
 *
 * @param {object} userConfig The raw config file / profile object.
 * @returns {{key:string, suggestion:string|null}[]}
 */
function unknownConfigKeys(userConfig) {
  if (!isPlainObject(userConfig)) return [];
  return Object.keys(userConfig)
    .filter(key => !KNOWN_CONFIG_KEYS.includes(key))
    .map(key => ({ key, suggestion: suggestConfigKey(key) }));
}

/** Type expectations for the keys most often mistyped (Phase 5). */
const CONFIG_TYPES = Object.freeze({
  mode: value => ['quick', 'standard', 'deep'].includes(value),
  reviewMode: value => ['normal', 'perf-seo', 'flows', 'a11y-strict'].includes(value),
  browser: value => ['chromium', 'firefox', 'webkit'].includes(value),
  recordVideo: value => value === true || value === false || value === 'on-failure',
  trace: value => TRACE_POLICIES.includes(value),
  failOn: value => value === null || FAIL_ON_LEVELS.includes(value),
  keepLast: value => Number.isInteger(Number(value)) && Number(value) >= 0,
  headed: value => typeof value === 'boolean',
  install: value => typeof value === 'boolean',
  axe: value => typeof value === 'boolean',
  codeQuality: value => typeof value === 'boolean',
  respectRobots: value => typeof value === 'boolean',
  dryRun: value => typeof value === 'boolean',
  allowWrite: value => typeof value === 'boolean',
  allowDestructive: value => typeof value === 'boolean',
  allowDownloads: value => typeof value === 'boolean',
  logLevel: value => LOG_LEVELS.includes(value),
  workers: value => Number.isFinite(Number(value)),
  retries: value => Number.isFinite(Number(value)),
  seedPaths: value => Array.isArray(value),
  blockPaths: value => Array.isArray(value),
  plugins: value => Array.isArray(value),
});

const CONFIG_TYPE_HINTS = Object.freeze({
  recordVideo: "false, true or 'on-failure'",
  trace: "'on-failure', 'always' or 'never'",
  failOn: "'never', 'minor', 'major', 'critical' or 'blocker'",
  mode: "'quick', 'standard' or 'deep'",
  reviewMode: "'normal', 'perf-seo', 'flows' or 'a11y-strict'",
  browser: "'chromium', 'firefox' or 'webkit'",
  logLevel: LOG_LEVELS.map(level => `'${level}'`).join(', '),
});

/**
 * Validate a user config object: unknown keys + wrong value types.
 *
 * @param {object} userConfig
 * @param {{strict?: boolean}} [options] `strict` turns findings into an Error.
 * @returns {string[]} Human-readable diagnostics (empty when clean).
 */
function validateConfig(userConfig, options = {}) {
  const problems = [];
  for (const { key, suggestion } of unknownConfigKeys(userConfig)) {
    problems.push(
      `Unknown UserEye config key "${key}"${suggestion ? ` — did you mean "${suggestion}"?` : ''}`,
    );
  }
  for (const [key, check] of Object.entries(CONFIG_TYPES)) {
    if (userConfig?.[key] === undefined) continue;
    if (!check(userConfig[key])) {
      const hint = CONFIG_TYPE_HINTS[key];
      problems.push(
        `Invalid value for "${key}": ${JSON.stringify(userConfig[key])}${hint ? ` — expected ${hint}` : ''}`,
      );
    }
  }
  if (problems.length && options.strict) {
    throw new Error(`UserEye config is invalid:\n  - ${problems.join('\n  - ')}`);
  }
  return problems;
}

/**
 * JSON Schema generated from DEFAULT_CONFIG (Phase 5). Consumers get editor
 * completion; `scripts/generate-config-docs.js` renders the same source into
 * `docs/CONFIG.md`, so the docs cannot drift from the defaults.
 */
function configSchema() {
  const typeOf = value => {
    if (Array.isArray(value)) return 'array';
    if (value === null) return null;
    return typeof value === 'object' ? 'object' : typeof value;
  };
  const describe = value => {
    const type = typeOf(value);
    if (type === 'object') {
      return {
        type: 'object',
        properties: Object.fromEntries(Object.entries(value).map(([key, v]) => [key, describe(v)])),
        additionalProperties: false,
        default: value,
      };
    }
    if (type === 'array') return { type: 'array', default: value };
    if (type === null) return { default: null };
    return { type, default: value };
  };
  const properties = Object.fromEntries(
    Object.entries(DEFAULT_CONFIG).map(([key, value]) => [key, describe(value)]),
  );
  for (const key of EXTRA_KNOWN_KEYS) {
    properties[key] ||= {};
  }
  // Hand-tightened enums where a bare `typeof` is too permissive.
  properties.mode.enum = ['quick', 'standard', 'deep'];
  properties.reviewMode.enum = ['normal', 'perf-seo', 'flows', 'a11y-strict'];
  properties.browser.enum = ['chromium', 'firefox', 'webkit'];
  properties.recordVideo = { oneOf: [{ type: 'boolean' }, { const: 'on-failure' }], default: 'on-failure' };
  properties.trace.enum = [...TRACE_POLICIES];
  properties.failOn = { enum: [...FAIL_ON_LEVELS], default: null };
  properties.logLevel.enum = [...LOG_LEVELS];
  properties.reportLocale.enum = ['en', 'pt', 'pt-BR', 'es', 'fr', 'auto'];
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://usereye.dev/schema/usereye.config.json',
    title: 'UserEye configuration',
    type: 'object',
    additionalProperties: false,
    properties,
  };
}

async function loadConfig({ argv = [], cwd = process.cwd(), env = process.env } = {}) {
  const parsed = parseArgv(argv);
  const cli = cliConfig(parsed);
  const initialProjectDir = path.resolve(cwd, cli.projectDir || '.');
  // CLI paths are relative to the invocation directory. Config-file paths are
  // normalized later relative to the config/project that owns them.
  if (cli.projectDir) cli.projectDir = initialProjectDir;
  if (cli.outDir) cli.outDir = path.resolve(cwd, cli.outDir);
  if (cli.compareWith) cli.compareWith = path.resolve(cwd, cli.compareWith);
  if (cli.storageState) cli.storageState = path.resolve(cwd, cli.storageState);
  const discovered = discoverConfig(initialProjectDir, parsed.values.config, env, cwd);
  const configDir = discovered ? path.dirname(discovered.path) : initialProjectDir;
  const fileConfig = await importConfig(discovered, { cwd, env, argv: [...argv] });
  // Phase 5: a typo in the config file used to be silently ignored. It is now
  // reported. `USEREYE_STRICT_CONFIG=1` (or `strictConfig: true`) upgrades the
  // warning to a hard usage error (exit 2) for CI.
  const strictConfig = env.USEREYE_STRICT_CONFIG === '1' || fileConfig.strictConfig === true;
  const configProblems = validateConfig(fileConfig, { strict: false });
  if (configProblems.length) {
    if (strictConfig) {
      throw new Error(`UserEye config is invalid:\n  - ${configProblems.join('\n  - ')}`);
    }
    for (const problem of configProblems) {
      console.warn(`Warning: ${problem} (${discovered?.path || 'config'})`);
    }
  }
  let selected = fileConfig;
  const profileName = cli.profile || env.USEREYE_PROFILE || fileConfig.profile;
  if (profileName) {
    const profile = fileConfig.profiles?.[profileName];
    if (!profile) throw new Error(`Unknown UserEye profile: ${profileName}`);
    selected = mergeConfig(fileConfig, profile);
    selected.profile = profileName;
  }
  const merged = mergeConfig(mergeConfig(mergeConfig(DEFAULT_CONFIG, selected), environmentConfig(env)), cli);
  const normalized = normalizeConfig(merged, configDir);
  normalized.configFile = discovered?.path || null;
  normalized.configWarnings = configProblems;
  // 7.5.1 (roadmap 7.5.0 item 3.1): `--url` without an explicit project is a pure
  // target run. Analysing the *invocation directory* is neither asked for nor useful
  // there (it used to print "Project: usereye" and write project-analysis.json +
  // code-quality.json about files the user never asked about). Target-only mode
  // stays OFF whenever anything implies a project: an explicit --project, a start
  // command, appDir/install, or an explicit request for the static analyzers
  // (--analyze / codeQuality: true).
  normalized.urlOnlyTarget =
    Boolean(normalized.baseURL || normalized.url) &&
    !parsed.explicit.has('project') &&
    !parsed.explicit.has('command') &&
    !fileConfig?.command &&
    !fileConfig?.projectDir &&
    !fileConfig?.appDir &&
    fileConfig?.install !== true &&
    fileConfig?.codeQuality !== true &&
    !parsed.explicit.has('analyze');
  return normalized;
}

function sanitizeConfig(value, key = '', seen = new WeakSet()) {
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
  if (value instanceof RegExp) return value.toString();
  if (value === null || value === undefined || typeof value !== 'object') {
    return /password|secret|token|api[-_]?key|authorization|cookie/i.test(key) && value
      ? '[REDACTED]'
      : value;
  }
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map(item => sanitizeConfig(item, key, seen));
  const output = {};
  for (const [childKey, child] of Object.entries(value)) {
    output[childKey] = /password|secret|token|api[-_]?key|authorization|cookie/i.test(childKey)
      ? child === undefined || child === null
        ? child
        : '[REDACTED]'
      : sanitizeConfig(child, childKey, seen);
  }
  return output;
}

function writeResolvedConfig(config, artifactDir) {
  fs.mkdirSync(artifactDir, { recursive: true });
  const filePath = path.join(artifactDir, 'resolved-config.json');
  fs.writeFileSync(filePath, `${JSON.stringify(sanitizeConfig(config), null, 2)}\n`);
  return filePath;
}

module.exports = {
  DEFAULT_CONFIG,
  VALUE_FLAGS,
  BOOLEAN_FLAGS,
  LOG_LEVELS,
  KNOWN_CONFIG_KEYS,
  PROJECT_COMMAND_CATEGORIES,
  configSchema,
  normalizeConfig,
  unknownConfigKeys,
  validateConfig,
  mergeConfig,
  parseArgv,
  loadConfig,
  sanitizeConfig,
  writeResolvedConfig,
};
