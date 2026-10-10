'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const playwright = require('playwright');
const { buildResult, closeEye, persistMetadata } = require('./artifact-store');
const { installUserEyeRecorder } = require('./browser-recorder');
const { installUserEyeVitals, rateVitals } = require('./browser-vitals');
const { MisclickEngine } = require('./misclick-engine');
const { createLogger } = require('./logger');
const { capturePerception } = require('./perception');
const { buildPatienceReport } = require('./patience');
const { captureGaze, buildJourney } = require('./user-gaze');
const { captureHuman, thirdPartyInventory } = require('./user-human');
const { buildUserPlan } = require('./user-plan');
const { catalog, section, t } = require('./i18n');
const { annotateAxeContrastOverlays } = require('./axe-hints');

// Single source of truth for the version: package.json. The published package
// always contains package.json, and tests assert against it too, so the three
// historical copy sites can never diverge again (roadmap items 0.8 / 5.2).
const TOOL_VERSION = require('./package.json').version;

/** Browser engines supported by `--browser` (roadmap item 3.3). Chromium stays the default. */
const SUPPORTED_BROWSERS = ['chromium', 'firefox', 'webkit'];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Transient network/timeout failures that are worth one more attempt.
 * Deliberately conservative: real bugs must not be masked by retries.
 */
const RETRIABLE_ERROR =
  /timeout \d+ms exceeded|net::err_(?:connection|network_changed|empty_response|internet_disconnected|timed_out|name_not_resolved|proxy|socket)|nspixi|ns_error_offline|ERR_TUNNEL_CONNECTION_FAILED/i;

function isRetriableError(error) {
  return Boolean(error) && RETRIABLE_ERROR.test(String(error.message || error));
}

function safeName(value) {
  return (
    String(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 90) || 'step'
  );
}

function serializeError(error) {
  if (!error) {
    return { message: 'Unknown error' };
  }
  return {
    name: error.name || 'Error',
    message: error.message || String(error),
    stack: error.stack || '',
  };
}

function isNullish(value) {
  return value === null || value === undefined;
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 20);
}

function patternMatches(pattern, value) {
  if (isNullish(pattern)) {
    return true;
  }
  if (pattern instanceof RegExp) {
    pattern.lastIndex = 0;
    return pattern.test(String(value || ''));
  }
  return String(value || '').includes(String(pattern));
}

/**
 * @typedef {object} UserEyeOptions
 * @property {string} [artifactDir] Directory for screenshots, observations, trace and video.
 * @property {boolean} [headless=true] Run the browser headless.
 * @property {'chromium'|'firefox'|'webkit'} [browser='chromium'] Browser engine to launch.
 * @property {{width:number,height:number}} [viewport] Emulated viewport size.
 * @property {string} [locale='en-US'] Browser locale (BCP-47).
 * @property {string} [timezoneId='UTC'] Browser timezone.
 * @property {'light'|'dark'|'no-preference'} [colorScheme='light'] Preferred color scheme.
 * @property {string} [storageState] Path to a Playwright storage state JSON file.
 * @property {boolean} [ignoreHTTPSErrors=false] Accept invalid TLS certificates.
 * @property {boolean} [acceptDownloads=false] Allow file downloads.
 * @property {string} [userAgent] Override the user agent.
 * @property {boolean|'on-failure'} [recordVideo=true] Session video policy. `true` keeps
 *   `user-eye-session.webm`; `false` never records (and never creates `video-raw/`);
 *   `'on-failure'` records but discards the video when the run is clean (no
 *   blocker/critical/major issue, no harmful misclick, no unexpected telemetry).
 *   NOTE the two layers differ on purpose: this **engine** default stays `true` so
 *   direct `new UserEye()` callers keep their 7.4.0 behaviour, while the **config /
 *   CLI** default (`DEFAULT_CONFIG.recordVideo`) is `'on-failure'` since 7.4.1.
 *   Every CLI path (`auto`, `observe`, the GitHub Action) goes through config, so
 *   bare `usereye auto` is calm. Force video from the CLI with `--video`.
 * @property {'on-failure'|'always'|'never'} [trace='always'] Playwright trace policy
 *   (7.5.1). `'always'` keeps `user-eye-trace.zip`; `'never'` does not start tracing;
 *   `'on-failure'` records, then discards the zip when the run is clean — the same
 *   clean-run test `recordVideo: 'on-failure'` uses. As with video, the **engine**
 *   default stays `'always'` (7.5.0 behaviour for `new UserEye()`), while the **config /
 *   CLI** default (`DEFAULT_CONFIG.trace`) is `'on-failure'`: the trace was the largest
 *   artifact of a clean run (1.8 MB for a 7-second demo).
 * @property {{step?: Function, info: Function}} [logger] Where the per-step `[PASS]/[WARN]/[FAIL]`
 *   lines go (7.5.1). Defaults to a console logger at `info`, whose output is byte-identical
 *   to the stdout lines of earlier versions; the CLI passes its own so `--log-level` and
 *   `--log-json` apply to steps too.
 * @property {'off'|'step'|'failure'} [autoObserve='off'] When to attach automatic observations.
 * @property {boolean} [visualAuditIssues=false] Promote visual findings to issues automatically.
 * @property {number} [touchTarget=44] Minimum touch target edge in px for mobile findings.
 * @property {'en'|'pt'|'pt-BR'|'es'|'fr'|'auto'} [reportLocale='en'] Language of findings, gaze
 *   narratives, user-plan steps, patience reasons and generated reports. `'auto'`
 *   derives the pack from `locale`; unknown tags fall back to `'en'`.
 * @property {boolean} [patienceEnabled=true] Compute the patience report.
 * @property {number} [misclickDistance=6] Pixel offset used by the misclick engine.
 * @property {string[]} [screenshotMaskSelectors] Selectors masked in screenshots.
 * @property {number} [navigationTimeoutMs=15000] Timeout (ms) for `goto()` navigations.
 * @property {number} [dialogTimeoutMs=5000] Default timeout (ms) for `nextDialog()`.
 * @property {number} [retries=1] Extra attempts for transient navigation failures (0 disables).
 * @property {number} [retryBackoffMs=400] Base backoff (ms); grows linearly per attempt.
 * @property {number} [minActionDelayMs=0] Minimum delay between engine-issued actions (politeness / rate limiting).
 */

/**
 * UserEye v2
 *
 * A browser-first testing agent. It sees rendered geometry and visible states,
 * records real DOM interactions, correlates browser telemetry with each step,
 * redacts registered secrets and emits reproducible visual evidence.
 */
class UserEye {
  /** @param {UserEyeOptions} [options] */
  constructor(options = {}) {
    const browserName = options.browser || options.browserName || 'chromium';
    if (!SUPPORTED_BROWSERS.includes(browserName)) {
      throw new Error(`Unsupported browser: ${browserName}. Use one of: ${SUPPORTED_BROWSERS.join(', ')}.`);
    }
    this.options = {
      artifactDir: options.artifactDir || path.resolve('artifacts/latest'),
      headless: options.headless !== false,
      browser: browserName,
      viewport: options.viewport || { width: 1440, height: 900 },
      locale: options.locale ?? 'en-US',
      timezoneId: options.timezoneId ?? 'UTC',
      colorScheme: options.colorScheme ?? 'light',
      storageState: options.storageState || undefined,
      ignoreHTTPSErrors: options.ignoreHTTPSErrors === true,
      acceptDownloads: options.acceptDownloads === true,
      userAgent: options.userAgent || undefined,
      recordVideo: options.recordVideo !== false,
      // Preserve the tri-state so closeEye can discard a clean-run video.
      recordVideoSetting:
        options.recordVideo === 'on-failure' ? 'on-failure' : options.recordVideo === false ? false : true,
      // 7.5.1: trace policy mirrors the video tri-state. Unknown values fall back to
      // the engine default ('always'), never to silently dropping the trace.
      trace: ['on-failure', 'always', 'never'].includes(options.trace) ? options.trace : 'always',
      autoObserve: options.autoObserve || 'off', // off | step | failure
      visualAuditIssues: options.visualAuditIssues === true,
      touchTarget: options.touchTarget || 44,
      patienceEnabled: options.patienceEnabled !== false,
      // Language of findings, plans, patience reasons and reports (en|pt|pt-BR|es|fr|auto).
      // Kept in `options` so every engine sub-module (perception, gaze, plan,
      // patience, misclicks, protocols, adaptive explorer) reads one source.
      reportLocale: options.reportLocale || 'en',
      consent: options.consent || {},
      zoomMode: options.zoomMode || 'css',
      // 7.3 opt-in user-journey battery (resilience + accessibility/device probes).
      userJourney: options.userJourney || { enabled: false },
      // 7.4 opt-in browser-extension effect battery (default off).
      extensions: options.extensions || { enabled: false },
      misclickDistance: options.misclickDistance || 6,
      // 'aggressive' reports any near-miss side effect; 'stable-only' (Phase 2.1)
      // reserves "harmful" for hard signals (URL/dialog change) so focus-revealed
      // controls and skip-links don't raise majors on healthy pages.
      misclickPolicy: options.misclickPolicy || 'aggressive',
      navigationTimeoutMs: Number.isFinite(Number(options.navigationTimeoutMs))
        ? Number(options.navigationTimeoutMs)
        : 15_000,
      dialogTimeoutMs: Number.isFinite(Number(options.dialogTimeoutMs))
        ? Number(options.dialogTimeoutMs)
        : 5_000,
      retries: Number.isFinite(Number(options.retries)) ? Math.max(0, Number(options.retries)) : 1,
      retryBackoffMs: Number.isFinite(Number(options.retryBackoffMs))
        ? Math.max(0, Number(options.retryBackoffMs))
        : 400,
      minActionDelayMs: Number.isFinite(Number(options.minActionDelayMs))
        ? Math.max(0, Number(options.minActionDelayMs))
        : 0,
      screenshotMaskSelectors: options.screenshotMaskSelectors || [
        '[data-usereye-mask="true"]:visible',
        '[data-sensitive="true"]:visible',
      ],
    };

    this.logger =
      options.logger && typeof options.logger.info === 'function' ? options.logger : createLogger();

    this.artifactDir = this.options.artifactDir;
    this.screenshotDir = path.join(this.artifactDir, 'screenshots');
    this.observationDir = path.join(this.artifactDir, 'observations');
    this.videoDir = path.join(this.artifactDir, 'video-raw');
    this.tracePath = path.join(this.artifactDir, 'user-eye-trace.zip');
    fs.mkdirSync(this.screenshotDir, { recursive: true });
    fs.mkdirSync(this.observationDir, { recursive: true });
    // Only create video-raw/ when a recording will actually happen (roadmap item 0.5).
    if (this.options.recordVideo) {
      fs.mkdirSync(this.videoDir, { recursive: true });
    }

    this.browser = null;
    this.context = null;
    this.page = null;
    this.currentStep = null;
    this.stepNumber = 0;
    this.issueNumber = 0;
    this.actionNumber = 0;
    this.observationNumber = 0;
    this.steps = [];
    this.checks = [];
    this.issues = [];
    this.actions = [];
    this.experienceEvents = [];
    this.misclicks = [];
    this.observations = [];
    this.observationTransitions = [];
    this.visualFindings = [];
    this.gazes = [];
    this.vitalsSnapshots = [];
    this.firstImpression = null;
    this.journey = null;
    this.userPlan = null;
    this.humanSignals = [];
    this.axeRuns = [];
    this.secrets = new Set();
    this.expectedTelemetryRules = [];
    this.issueFingerprints = new Map();
    this._observedPages = new WeakSet();
    this._lastObservation = null;
    this._lastExplicitAction = null;
    this._lastAction = null;
    this._lastActionFinishedAt = 0;
    this.retriedOperations = [];

    this.telemetry = {
      consoleErrors: [],
      consoleWarnings: [],
      pageErrors: [],
      requestFailures: [],
      httpErrors: [],
      requests: [],
      dialogs: [],
    };
    this.startedAt = new Date().toISOString();
    this.artifacts = {
      screenshots: [],
      observations: [],
      downloads: [],
      actions: null,
      experience: null,
      misclicks: null,
      patience: null,
      perceptionSummary: null,
      trace: null,
      video: null,
    };
    this.misclickEngine = new MisclickEngine(this);
  }

  /**
   * Register values that must never appear in artifacts. Every string written
   * to reports, actions, telemetry or observations is redacted.
   * @param {...(string|number|string[])} values Secret values (flattened, >= 3 chars each).
   * @returns {this}
   */
  registerSecret(...values) {
    for (const value of values.flat(Infinity)) {
      if (isNullish(value)) {
        continue;
      }
      const string = String(value);
      if (string.length >= 3) {
        this.secrets.add(string);
      }
    }
    return this;
  }

  _redactString(value) {
    let output = String(value ?? '');
    const secrets = [...this.secrets].sort((a, b) => b.length - a.length);
    for (const secret of secrets) {
      output = output.split(secret).join('[REDACTED]');
    }
    return output;
  }

  _sanitize(value, seen = new WeakSet()) {
    if (typeof value === 'string') {
      return this._redactString(value);
    }
    if (isNullish(value) || typeof value !== 'object') {
      return value;
    }
    if (value instanceof RegExp) {
      return value.toString();
    }
    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);
    if (Array.isArray(value)) {
      const output = value.map(item => this._sanitize(item, seen));
      seen.delete(value);
      return output;
    }
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = this._sanitize(item, seen);
    }
    seen.delete(value);
    return output;
  }

  allowTelemetry(rule = {}) {
    this.expectedTelemetryRules.push({
      type: rule.type || 'any',
      status: rule.status,
      url: rule.url,
      message: rule.message,
      reason: rule.reason || 'Planned negative scenario',
    });
    return this;
  }

  allowHttpError(status, url, reason) {
    this.allowTelemetry({ type: 'http', status, url, reason });
    // Chromium also writes a console error for an intentionally failed resource.
    this.allowTelemetry({ type: 'console', url, reason });
    return this;
  }

  _expectedTelemetry(type, item) {
    const rule = this.expectedTelemetryRules.find(candidate => {
      if (candidate.type !== 'any' && candidate.type !== type) {
        return false;
      }
      if (!isNullish(candidate.status) && Number(candidate.status) !== Number(item.status)) {
        return false;
      }
      const eventUrl = type === 'console' ? item.location?.url || item.url : item.url || item.location?.url;
      if (!patternMatches(candidate.url, eventUrl)) {
        return false;
      }
      if (!patternMatches(candidate.message, item.message || item.text)) {
        return false;
      }
      return true;
    });
    return rule ? { expected: true, expectedReason: rule.reason } : { expected: false };
  }

  /**
   * Launch the configured browser engine, create the instrumented context and
   * the first page.
   * @returns {Promise<this>}
   */
  async launch() {
    const browserType = playwright[this.options.browser] || playwright.chromium;
    const launchOptions = { headless: this.options.headless };
    if (this.options.browser === 'chromium') {
      // Chromium-only flags: /dev/shm in containers, and hide the most obvious
      // headless automation bits so first-party pages (search, social, news)
      // do not immediately close the tab before perception can run.
      launchOptions.args = ['--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'];
    }
    this.browser = await browserType.launch(launchOptions);
    const contextOptions = {
      viewport: this.options.viewport,
      locale: this.options.locale,
      timezoneId: this.options.timezoneId,
      acceptDownloads: this.options.acceptDownloads,
      colorScheme: this.options.colorScheme,
      storageState: this.options.storageState,
      ignoreHTTPSErrors: this.options.ignoreHTTPSErrors,
      userAgent: this.options.userAgent,
      reducedMotion: 'no-preference',
    };
    if (this.options.recordVideo) {
      fs.mkdirSync(this.videoDir, { recursive: true });
      contextOptions.recordVideo = {
        dir: this.videoDir,
        size: { width: 1280, height: 720 },
      };
    }

    this.context = await this.browser.newContext(contextOptions);
    await this.context.exposeBinding('__userEyeRecord', (source, event) => {
      this._recordDomAction(source.page, event);
    });
    await this.context.addInitScript(installUserEyeRecorder);
    await this.context.addInitScript(installUserEyeVitals);

    this.context.on('page', page => this._attachObservers(page));
    if (this.options.trace !== 'never') {
      await this.context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    }
    this.page = await this.context.newPage();
    this._attachObservers(this.page);
    return this;
  }

  _stepContext() {
    return {
      step: this.currentStep?.name || null,
      stepNumber: this.currentStep?.number || null,
      lastAction: this._lastAction?.label || this._lastAction?.target?.name || this._lastAction?.kind || null,
    };
  }

  _attachObservers(page) {
    if (!page || this._observedPages.has(page)) {
      return;
    }
    this._observedPages.add(page);
    page.on('console', message => {
      const raw = {
        at: new Date().toISOString(),
        type: message.type(),
        text: message.text(),
        location: message.location(),
        url: page.url(),
        ...this._stepContext(),
      };
      const item = this._sanitize({ ...raw, ...this._expectedTelemetry('console', raw) });
      if (message.type() === 'error') {
        this.telemetry.consoleErrors.push(item);
      }
      if (message.type() === 'warning') {
        this.telemetry.consoleWarnings.push(item);
      }
    });
    page.on('pageerror', error => {
      const raw = {
        at: new Date().toISOString(),
        url: page.url(),
        ...serializeError(error),
        ...this._stepContext(),
      };
      this.telemetry.pageErrors.push(
        this._sanitize({ ...raw, ...this._expectedTelemetry('pageerror', raw) }),
      );
    });
    page.on('request', request => {
      this.telemetry.requests.push(
        this._sanitize({
          method: request.method(),
          url: request.url(),
          resourceType: request.resourceType(),
          pageUrl: page.url(),
          ...this._stepContext(),
        }),
      );
    });
    page.on('requestfailed', request => {
      const raw = {
        method: request.method(),
        url: request.url(),
        failure: request.failure(),
        pageUrl: page.url(),
        ...this._stepContext(),
      };
      this.telemetry.requestFailures.push(
        this._sanitize({ ...raw, ...this._expectedTelemetry('request', raw) }),
      );
    });
    page.on('response', response => {
      if (response.status() >= 400) {
        const raw = {
          status: response.status(),
          method: response.request().method(),
          url: response.url(),
          pageUrl: page.url(),
          ...this._stepContext(),
        };
        this.telemetry.httpErrors.push(this._sanitize({ ...raw, ...this._expectedTelemetry('http', raw) }));
      }
    });
  }

  _recordDomAction(page, event) {
    const isExperience = String(event?.kind || '').startsWith('ux-');
    const value = this._sanitize({
      number: isExperience ? this.experienceEvents.length + 1 : ++this.actionNumber,
      source: isExperience ? 'experience-monitor' : 'dom',
      url: page?.url?.() || '',
      step: this.currentStep?.name || null,
      stepNumber: this.currentStep?.number || null,
      ...event,
    });
    if (isExperience) {
      this.experienceEvents.push(value);
      return;
    }
    this.actions.push(value);
    this._lastAction = value;
  }

  async _describeLocator(locator) {
    try {
      return await locator.first().evaluate(element => {
        const rect = element.getBoundingClientRect();
        const text = String(
          element.getAttribute('aria-label') ||
            element.textContent ||
            element.getAttribute('placeholder') ||
            '',
        )
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 180);
        const centerX = Math.min(Math.max(rect.left + rect.width / 2, 0), innerWidth - 1);
        const centerY = Math.min(Math.max(rect.top + rect.height / 2, 0), innerHeight - 1);
        const top = document.elementFromPoint(centerX, centerY);
        return {
          tag: element.tagName.toLowerCase(),
          id: element.id || '',
          role: element.getAttribute('role') || '',
          name: text,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          visible:
            rect.width > 0 &&
            rect.height > 0 &&
            getComputedStyle(element).visibility !== 'hidden' &&
            getComputedStyle(element).display !== 'none',
          occluded: Boolean(top && top !== element && !element.contains(top)),
          occludedBy: top
            ? { tag: top.tagName.toLowerCase(), id: top.id || '', classes: [...top.classList].slice(0, 5) }
            : null,
        };
      });
    } catch (error) {
      return { unavailable: true, error: error.message };
    }
  }

  /**
   * Enforce the configured minimum delay between engine-issued actions so
   * UserEye never hammers a third-party target (roadmap item 4.4).
   */
  async _throttleActions() {
    const minimum = this.options.minActionDelayMs;
    if (!minimum || !this._lastActionFinishedAt) {
      return;
    }
    const wait = this._lastActionFinishedAt + minimum - Date.now();
    if (wait > 0) {
      await sleep(wait);
    }
  }

  async perform(kind, label, locator, fn, metadata = {}) {
    await this._throttleActions();
    const action = {
      number: ++this.actionNumber,
      source: 'usereye',
      kind,
      label: label || kind,
      at: new Date().toISOString(),
      step: this.currentStep?.name || null,
      stepNumber: this.currentStep?.number || null,
      url: this.page?.url() || '',
      target: locator ? await this._describeLocator(locator) : null,
      metadata: this._sanitize(metadata),
      status: 'running',
      durationMs: 0,
    };
    this._lastExplicitAction = action;
    this._lastAction = action;
    const started = Date.now();
    this.actions.push(action);
    try {
      const result = await fn();
      action.status = 'passed';
      action.durationMs = Date.now() - started;
      if (metadata.waitForStable !== false) {
        await this.waitForStableUI();
      }
      return result;
    } catch (error) {
      action.status = 'failed';
      action.durationMs = Date.now() - started;
      action.error = this._sanitize(serializeError(error));
      throw error;
    } finally {
      this._lastActionFinishedAt = Date.now();
    }
  }

  locate(target, page = this.page) {
    if (typeof target === 'string') {
      return page.locator(target);
    }
    if (!target || typeof target !== 'object') {
      throw new Error('A locator descriptor is required');
    }
    if (target.role) {
      return page.getByRole(target.role, { name: target.name, exact: target.exact });
    }
    if (target.label) {
      return page.getByLabel(target.label, { exact: target.exact });
    }
    if (target.placeholder) {
      return page.getByPlaceholder(target.placeholder, { exact: target.exact });
    }
    if (target.text) {
      return page.getByText(target.text, { exact: target.exact });
    }
    if (target.testId) {
      return page.getByTestId(target.testId);
    }
    if (target.css) {
      return page.locator(target.css);
    }
    throw new Error(`Unsupported locator descriptor: ${JSON.stringify(target)}`);
  }

  /**
   * Click a target described by a selector string, a locator descriptor
   * (`{role,name}`, `{label}`, `{text}`, `{testId}`, `{css}`) or a Playwright Locator.
   * @param {string|object|import('playwright').Locator} target
   * @param {string} [label] Human label recorded in the action log.
   * @param {object} [options] Playwright click options plus `waitForStable`.
   */
  async click(target, label, options = {}) {
    const locator = typeof target?.click === 'function' ? target : this.locate(target);
    const { waitForStable, ...clickOptions } = options;
    return this.perform('click', label, locator, () => locator.click(clickOptions), { waitForStable });
  }

  /**
   * Fill a field. With `{sensitive:true}` the value is registered as a secret
   * and the field is masked in screenshots.
   * @param {string|object|import('playwright').Locator} target
   * @param {string} value
   * @param {string} [label]
   * @param {{sensitive?: boolean, waitForStable?: boolean}} [options]
   */
  async fill(target, value, label, options = {}) {
    const locator = typeof target?.fill === 'function' ? target : this.locate(target);
    const { sensitive, waitForStable, ...fillOptions } = options;
    if (sensitive) {
      this.registerSecret(value);
      await locator.first().evaluate(element => element.setAttribute('data-usereye-mask', 'true'));
    }
    return this.perform('fill', label, locator, () => locator.fill(value, fillOptions), {
      valueLength: String(value).length,
      sensitive: Boolean(sensitive),
      waitForStable,
    });
  }

  async press(key, label, options = {}) {
    return this.perform(
      'keypress',
      label || `Press ${key}`,
      null,
      () => this.page.keyboard.press(key, options),
      { key },
    );
  }

  async upload(target, files, label, options = {}) {
    const locator = typeof target?.setInputFiles === 'function' ? target : this.locate(target);
    const listed = (Array.isArray(files) ? files : [files]).map(file =>
      typeof file === 'string' ? path.basename(file) : file.name || 'buffer',
    );
    const { waitForStable, ...uploadOptions } = options;
    return this.perform('upload', label, locator, () => locator.setInputFiles(files, uploadOptions), {
      files: listed,
      waitForStable,
    });
  }

  async see(target, label, options = {}) {
    const locator = typeof target?.isVisible === 'function' ? target : this.locate(target);
    const visible = await locator.first().isVisible();
    this.verify(label, visible, {
      severity: options.severity || 'major',
      expected: options.expected || t(section(this.options.reportLocale, 'issue'), 'elementVisibleExpected'),
      actual: visible
        ? t(section(this.options.reportLocale, 'issue'), 'elementVisiblePass')
        : t(section(this.options.reportLocale, 'issue'), 'elementVisibleFail'),
    });
    return visible;
  }

  async _quickUserState() {
    return this.misclickEngine.quickUserState();
  }

  async testMisclicks(target, options = {}) {
    return this.misclickEngine.test(target, options);
  }

  async testRapidClicks(target, options = {}) {
    return this.misclickEngine.testRapid(target, options);
  }

  async waitForStableUI(idleMs = 35) {
    if (!this.page || this.page.isClosed()) {
      return;
    }
    try {
      await this.page.evaluate(
        () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
    } catch {
      return;
    }
    if (idleMs > 0) {
      try {
        await this.page.waitForTimeout(idleMs);
      } catch {
        return;
      }
    }
  }

  async grantClipboard(origin) {
    await this.context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  }

  /**
   * Run `fn` with the configured retry policy for transient network/timeout
   * failures. Every retry is recorded in `retriedOperations` and surfaced in
   * `result.json`, so a flaky network never fails silently (roadmap item 4.1).
   */
  async _withRetries(operation, fn, override = {}) {
    const retries = Number.isFinite(Number(override.retries))
      ? Math.max(0, Number(override.retries))
      : this.options.retries;
    let attempt = 0;
    for (;;) {
      try {
        const result = await fn();
        if (attempt > 0) {
          this.retriedOperations[this.retriedOperations.length - 1].succeededOnAttempt = attempt + 1;
        }
        return result;
      } catch (error) {
        attempt += 1;
        if (attempt > retries || !isRetriableError(error)) {
          if (attempt > 1) {
            // Not retriable or out of attempts: propagate with attempt context.
            error.usereyeAttempts = attempt;
          }
          throw error;
        }
        const backoffMs = this.options.retryBackoffMs * attempt;
        this.retriedOperations.push({
          operation,
          attempt,
          maxAttempts: retries + 1,
          backoffMs,
          at: new Date().toISOString(),
          step: this.currentStep?.name || null,
          error: this._redactString(String(error.message || error).split('\n')[0]),
        });
        await sleep(backoffMs);
      }
    }
  }

  /**
   * Navigate the active page. Timeout is configurable via
   * `navigationTimeoutMs` (roadmap item 4.2); transient failures are retried
   * per the `retries` policy (roadmap item 4.1).
   * @param {string} url
   * @param {{timeout?: number, waitUntil?: string, retries?: number}} [options]
   */
  async goto(url, options = {}) {
    const timeout = Number.isFinite(Number(options.timeout))
      ? Number(options.timeout)
      : this.options.navigationTimeoutMs;
    const retries = Number.isFinite(Number(options.retries))
      ? Math.max(0, Number(options.retries))
      : this.options.retries;
    return this.perform(
      'navigate',
      `Open ${url}`,
      null,
      () =>
        this._withRetries(
          `goto ${url}`,
          () =>
            this.page.goto(url, {
              waitUntil: options.waitUntil || 'domcontentloaded',
              timeout,
            }),
          { retries },
        ),
      {
        url,
        timeout,
        retries,
        waitForStable: true,
      },
    );
  }

  /**
   * Capture a full perception snapshot of the current page (geometry, visible
   * text, controls, dialogs, findings, gaze and human signals).
   * @param {string} name
   * @param {{profile?: string, screenshot?: boolean, fullPage?: boolean, addIssues?: boolean, gaze?: boolean, human?: boolean, touchTarget?: number, maxText?: number, maxControls?: number}} [options]
   */
  async observe(name, options = {}) {
    if (!this.page || this.page.isClosed()) {
      throw new Error('Cannot observe a closed page');
    }
    const number = ++this.observationNumber;
    const slug = `${String(number).padStart(2, '0')}-${safeName(name)}`;
    const raw = await capturePerception(this.page, {
      profile: options.profile || (this.page.viewportSize()?.width <= 600 ? 'mobile' : 'desktop'),
      touchTarget: options.touchTarget || this.options.touchTarget,
      maxText: options.maxText || 5000,
      maxControls: options.maxControls || 300,
      locale: options.locale || this.options.reportLocale,
    });
    const sanitized = this._sanitize(raw);
    sanitized.id = `OBS-${String(number).padStart(3, '0')}`;
    sanitized.label = name;
    sanitized.step = this.currentStep?.name || null;
    sanitized.stepNumber = this.currentStep?.number || null;
    sanitized.controls = Array.isArray(sanitized.controls) ? sanitized.controls : [];
    sanitized.dialogs = Array.isArray(sanitized.dialogs) ? sanitized.dialogs : [];
    sanitized.alerts = Array.isArray(sanitized.alerts) ? sanitized.alerts : [];
    sanitized.findings = Array.isArray(sanitized.findings) ? sanitized.findings : [];
    sanitized.counts = sanitized.counts || { controls: 0, dialogs: 0, alerts: 0, controlsInViewport: 0 };
    sanitized.stateHash = hash(
      JSON.stringify({
        url: sanitized.url,
        title: sanitized.title,
        text: sanitized.visibleText,
        controls: sanitized.controls.map(control => [
          control.role,
          control.name,
          control.disabled,
          control.inViewport,
        ]),
        dialogs: sanitized.dialogs.map(dialog => dialog.name),
        alerts: sanitized.alerts.map(alert => alert.text),
      }),
    );

    await this._attachGaze(sanitized, name, options);
    await this._attachHuman(sanitized, name, options);

    if (options.screenshot) {
      try {
        sanitized.screenshot = await this.screenshot(`observation-${slug}`, Boolean(options.fullPage));
      } catch (error) {
        sanitized.screenshotError = this._redactString(error.message);
      }
    }
    const filePath = path.join(this.observationDir, `${slug}.json`);
    fs.writeFileSync(filePath, JSON.stringify(sanitized, null, 2));
    sanitized.path = path.relative(this.artifactDir, filePath).replace(/\\/g, '/');
    this.artifacts.observations.push(sanitized.path);

    for (const finding of sanitized.findings) {
      const enriched = {
        ...finding,
        observationId: sanitized.id,
        observation: name,
        profile: sanitized.profile,
        step: sanitized.step,
        url: sanitized.url,
      };
      this.visualFindings.push(enriched);
      if (options.addIssues ?? this.options.visualAuditIssues) {
        this.addIssue({
          fingerprint: `visual:${finding.code}:${sanitized.url}:${sanitized.profile}`,
          source: 'perception',
          code: finding.code,
          severity: finding.severity,
          title: `${t(catalog(this.options.reportLocale), 'perception')} (${name}): ${finding.title}`,
          expected: t(section(this.options.reportLocale, 'issue'), 'visualPerceptionExpected'),
          actual: finding.actual,
          technical: [finding.technical, JSON.stringify(finding.evidence || [], null, 2)]
            .filter(Boolean)
            .join('\n'),
          evidence: sanitized.screenshot || null,
          confidence: finding.confidence,
          kind: finding.kind,
          triage: finding.triage,
          acceptedPattern: finding.acceptedPattern,
        });
      }
    }

    if (this._lastObservation) {
      this.observationTransitions.push({
        from: this._lastObservation.id,
        to: sanitized.id,
        fromLabel: this._lastObservation.label,
        toLabel: sanitized.label,
        stateChanged: this._lastObservation.stateHash !== sanitized.stateHash,
        urlChanged: this._lastObservation.url !== sanitized.url,
        titleChanged: this._lastObservation.title !== sanitized.title,
        controlsDelta: sanitized.counts.controls - this._lastObservation.counts.controls,
        dialogsDelta: sanitized.counts.dialogs - this._lastObservation.counts.dialogs,
        alertsDelta: sanitized.counts.alerts - this._lastObservation.counts.alerts,
      });
    }
    this._lastObservation = sanitized;
    this.observations.push(sanitized);
    return sanitized;
  }

  async _attachGaze(sanitized, name, options = {}) {
    if (options.gaze === false) {
      return sanitized;
    }
    try {
      const gaze = await captureGaze(this.page, {
        profile: options.profile || sanitized.profile,
        locale: this.options.reportLocale,
      });
      sanitized.gaze = this._sanitize(gaze);
      this.gazes.push({
        observationId: sanitized.id,
        label: name,
        narrative: gaze.narrative,
        cognitiveLoad: gaze.cognitiveLoad,
        headline: gaze.headline?.text || null,
        primaryCta: gaze.primaryCta?.name || gaze.primaryCta?.text || null,
        fold: gaze.fold,
      });
      if (!this.firstImpression) {
        this.firstImpression = sanitized.gaze;
        this.journey = buildJourney({
          gaze: sanitized.gaze,
          facts: {
            passwordInputs: sanitized.controls.filter(item => item.type === 'password').length,
          },
          locale: this.options.reportLocale,
        });
      }
    } catch (error) {
      sanitized.gazeError = this._redactString(error.message);
    }
    return sanitized;
  }

  async _attachHuman(sanitized, name, options = {}) {
    if (options.human === false) {
      return sanitized;
    }
    try {
      const human = this._sanitize(
        await captureHuman(this.page, {
          profile: options.profile || sanitized.profile,
          locale: this.options.reportLocale,
          consent: this.options.consent,
        }),
      );
      sanitized.human = human;
      this.humanSignals.push({ observationId: sanitized.id, label: name, ...human });
      if (Array.isArray(human.findings) && human.findings.length) {
        sanitized.findings = [...(sanitized.findings || []), ...human.findings];
      }
      if (this.firstImpression && !this.userPlan) {
        this.userPlan = buildUserPlan({
          gaze: this.firstImpression,
          human,
          journey: this.journey,
          locale: this.options.reportLocale,
        });
      }
    } catch (error) {
      sanitized.humanError = this._redactString(error.message);
    }
    return sanitized;
  }

  async scanVisualHealth(name, options = {}) {
    return this.observe(name, { ...options, addIssues: options.addIssues ?? true });
  }

  /**
   * Run a named step. Failures are converted into issues; `critical: true`
   * rethrows after recording.
   * @param {string} name
   * @param {() => Promise<void>} fn
   * @param {{critical?: boolean, screenshot?: boolean, fullPage?: boolean, observeBefore?: boolean, observeAfter?: boolean, profile?: string}} [options]
   */
  async step(name, fn, options = {}) {
    const step = {
      number: ++this.stepNumber,
      name,
      slug: `${String(this.stepNumber).padStart(2, '0')}-${safeName(name)}`,
      startedAt: new Date().toISOString(),
      durationMs: 0,
      status: 'passed',
      screenshot: null,
      error: null,
      issueIds: [],
      actionStart: this.actions.length,
      actionEnd: null,
      observationIds: [],
    };
    const issueStart = this.issues.length;
    const observationStart = this.observations.length;
    const started = Date.now();
    this.currentStep = step;
    let thrown = null;

    try {
      if (this.options.autoObserve === 'step' || options.observeBefore) {
        await this.observe(`${step.slug}-before`, {
          screenshot: false,
          addIssues: false,
          profile: options.profile,
        });
      }
      await fn();
    } catch (error) {
      thrown = error;
      step.error = this._sanitize(serializeError(error));
      this.addIssue({
        source: 'engine',
        code: 'automation-failure',
        severity: options.critical ? 'blocker' : 'major',
        title: `Unexpected failure: ${name}`,
        expected: t(section(this.options.reportLocale, 'issue'), 'flowExpected'),
        actual: error.message || String(error),
        technical: error.stack || '',
      });
    }

    step.durationMs = Date.now() - started;
    if (options.screenshot !== false && this.page && !this.page.isClosed()) {
      try {
        step.screenshot = await this.screenshot(step.slug, options.fullPage === true);
      } catch (error) {
        step.screenshotError = this._redactString(error.message);
      }
    }

    const hasNewIssue = this.issues.length > issueStart;
    if (
      this.options.autoObserve === 'step' ||
      options.observeAfter ||
      (this.options.autoObserve === 'failure' && hasNewIssue && this.observations.length === observationStart)
    ) {
      try {
        const observation = await this.observe(`${step.slug}-after`, {
          screenshot: false,
          addIssues: false,
          profile: options.profile,
        });
        step.observationIds.push(observation.id);
      } catch (error) {
        step.observationError = this._redactString(error.message);
      }
    }

    const newIssues = this.issues.slice(issueStart);
    if (newIssues.length) {
      step.status = newIssues.some(issue => ['blocker', 'critical', 'major'].includes(issue.severity))
        ? 'failed'
        : 'warning';
      step.issueIds = newIssues.map(issue => issue.id);
      for (const issue of newIssues) {
        if (!issue.evidence && step.screenshot) {
          issue.evidence = step.screenshot;
        }
      }
    }
    step.observationIds.push(
      ...this.observations
        .slice(observationStart)
        .map(observation => observation.id)
        .filter(id => !step.observationIds.includes(id)),
    );
    step.actionEnd = this.actions.length;
    step.finishedAt = new Date().toISOString();
    this.steps.push(step);
    this.currentStep = null;

    // 7.5.1 (item 2.4): through the logger, not straight to stdout — same bytes at info.
    if (typeof this.logger.step === 'function') {
      this.logger.step(step);
    } else {
      const icon = step.status === 'passed' ? 'PASS' : step.status === 'warning' ? 'WARN' : 'FAIL';
      this.logger.info(
        `[${icon}] ${String(step.number).padStart(2, '0')} ${step.name} (${step.durationMs} ms)`,
      );
    }

    if (thrown && options.critical) {
      throw thrown;
    }
    return step;
  }

  /**
   * Record a verification check; failing checks create an issue.
   * @param {string} title
   * @param {unknown} condition
   * @param {{severity?: string, expected?: string, actual?: string, technical?: string, fingerprint?: string}} [details]
   * @returns {boolean}
   */
  verify(title, condition, details = {}) {
    const passed = Boolean(condition);
    const check = this._sanitize({
      title,
      passed,
      step: this.currentStep ? this.currentStep.name : null,
      expected: details.expected,
      actual: details.actual,
    });
    this.checks.push(check);
    if (!passed) {
      this.addIssue({
        fingerprint: details.fingerprint,
        severity: details.severity || 'major',
        title,
        expected: details.expected || t(section(this.options.reportLocale, 'issue'), 'verificationExpected'),
        actual: details.actual || t(section(this.options.reportLocale, 'issue'), 'verificationFailed'),
        technical: details.technical || '',
      });
    }
    return passed;
  }

  require(title, condition, details = {}) {
    if (!this.verify(title, condition, { ...details, severity: details.severity || 'blocker' })) {
      throw new Error(`${title}: ${details.actual || 'critical condition was false'}`);
    }
  }

  /**
   * Add a finding. Issues with the same fingerprint are deduplicated and their
   * `occurrences` counter grows instead.
   * Optional provenance/classification fields (`source`, `code`, `confidence`,
   * `kind`, `triage`, `acceptedPattern`) are additive; when omitted, report time
   * derives confidence/kind from the fingerprint and severity so older callers
   * keep working unchanged.
   * @param {{severity?: string, title?: string, expected?: string, actual?: string, technical?: string, evidence?: string|null, fingerprint?: string, step?: string, source?: string, code?: string, confidence?: 'high'|'medium'|'low', kind?: 'defect'|'risk'|'signal'|'opinion', triage?: string, acceptedPattern?: string}} issue
   */
  addIssue(issue) {
    const sanitized = this._sanitize(issue);
    const fingerprint =
      sanitized.fingerprint ||
      hash(
        JSON.stringify({
          title: sanitized.title,
          step: this.currentStep?.name || sanitized.step || null,
          actual: sanitized.actual,
        }),
      );
    if (this.issueFingerprints.has(fingerprint)) {
      const existing = this.issueFingerprints.get(fingerprint);
      existing.occurrences = (existing.occurrences || 1) + 1;
      const step = this.currentStep?.name || sanitized.step;
      if (step && !existing.steps.includes(step)) {
        existing.steps.push(step);
      }
      return existing;
    }
    const value = {
      id: `ISSUE-${String(++this.issueNumber).padStart(3, '0')}`,
      fingerprint,
      severity: sanitized.severity || 'major',
      title: sanitized.title || 'Untitled finding',
      step: this.currentStep ? this.currentStep.name : sanitized.step || null,
      steps: [this.currentStep ? this.currentStep.name : sanitized.step].filter(Boolean),
      expected: sanitized.expected || '',
      actual: sanitized.actual || '',
      technical: sanitized.technical || '',
      evidence: sanitized.evidence || null,
      occurrences: 1,
      // Optional provenance/classification (Phase 1). Undefined = derive later.
      source: sanitized.source,
      code: sanitized.code,
      confidence: sanitized.confidence,
      kind: sanitized.kind,
      triage: sanitized.triage,
      acceptedPattern: sanitized.acceptedPattern,
    };
    this.issues.push(value);
    this.issueFingerprints.set(fingerprint, value);
    return value;
  }

  /**
   * Take a masked JPEG screenshot into `screenshots/`.
   * @param {string} name
   * @param {boolean} [fullPage]
   * @returns {Promise<string>} Artifact-relative path.
   */
  async screenshot(name, fullPage = false) {
    const filename = `${safeName(name)}.jpg`;
    const absolute = path.join(this.screenshotDir, filename);
    const mask = this.options.screenshotMaskSelectors.length
      ? [this.page.locator(this.options.screenshotMaskSelectors.join(','))]
      : [];
    await this.page.screenshot({
      path: absolute,
      type: 'jpeg',
      quality: 76,
      fullPage,
      animations: 'disabled',
      mask,
      maskColor: '#7c3aed',
    });
    const relative = path.relative(this.artifactDir, absolute).replace(/\\/g, '/');
    if (!this.artifacts.screenshots.includes(relative)) {
      this.artifacts.screenshots.push(relative);
    }
    return relative;
  }

  async clipboardText() {
    return this.page.evaluate(() => navigator.clipboard.readText());
  }

  recordDownload(filePath, label) {
    const relative = path.relative(this.artifactDir, filePath).replace(/\\/g, '/');
    this.artifacts.downloads.push({ label, path: relative });
    return relative;
  }

  recordDialog(dialog, action) {
    this.telemetry.dialogs.push(
      this._sanitize({
        at: new Date().toISOString(),
        type: dialog.type(),
        message: dialog.message(),
        defaultValue: dialog.defaultValue(),
        action,
        ...this._stepContext(),
      }),
    );
  }

  nextDialog(action = 'accept', options = {}) {
    return new Promise((resolve, reject) => {
      const onDialog = async dialog => {
        clearTimeout(timer);
        try {
          const message = dialog.message();
          this.recordDialog(dialog, action);
          if (options.expectedText && !message.includes(options.expectedText)) {
            throw new Error(`Dialog did not contain “${options.expectedText}”: ${message}`);
          }
          if (action === 'dismiss') {
            await dialog.dismiss();
          } else {
            await dialog.accept(options.promptText);
          }
          resolve(this._redactString(message));
        } catch (error) {
          reject(error);
        }
      };
      const timer = setTimeout(
        () => {
          // Remove the pending listener so a dialog that arrives later does not
          // resolve a dead promise or leak into the next wait (roadmap item 0.6).
          this.page.off('dialog', onDialog);
          reject(new Error('Expected browser dialog did not appear'));
        },
        Number.isFinite(Number(options.timeout)) ? Number(options.timeout) : this.options.dialogTimeoutMs,
      );
      this.page.once('dialog', onDialog);
    });
  }

  /**
   * Inject axe-core (if not present) and run an accessibility audit; violations
   * become issues mapped by impact.
   * @param {string} label
   * @param {string} axeSourcePath Absolute path to `axe.min.js`.
   */
  async runAxe(label, axeSourcePath) {
    const skip = message => {
      const compact = this._sanitize({
        label,
        skipped: true,
        error: message,
        url: this.page && !this.page.isClosed() ? this.page.url() : '',
        timestamp: new Date().toISOString(),
        passes: 0,
        incomplete: [],
        violations: [],
      });
      this.axeRuns.push(compact);
      this.addIssue({
        fingerprint: `axe:${label}:unavailable`,
        source: 'a11y',
        code: 'axe-unavailable',
        kind: 'signal',
        severity: 'minor',
        title: `${t(catalog(this.options.reportLocale), 'accessibility')} (${label}): audit skipped`,
        expected: 'axe-core runs in the page.',
        actual: message,
      });
      return compact;
    };
    if (!this.page || this.page.isClosed()) {
      return skip('page already closed');
    }
    try {
      const present = await this.page.evaluate(() => Boolean(window.axe));
      if (!present) {
        await this.page.addScriptTag({ path: axeSourcePath });
      }
    } catch (error) {
      return skip(error.message || String(error));
    }
    let result;
    try {
      result = await this.page.evaluate(async () =>
        window.axe.run(document, {
          resultTypes: ['violations', 'incomplete', 'passes'],
        }),
      );
    } catch (error) {
      return skip(error.message || String(error));
    }
    if (!result || !Array.isArray(result.violations)) {
      return skip('axe-core returned no result');
    }
    // Add a cause-oriented hint when a transparent text control is visually
    // backed by a positioned sibling (sliding pills/indicators). axe reports the
    // correct contrast symptom but measures the ancestor, not that sibling.
    await annotateAxeContrastOverlays(this.page, result, this.options.reportLocale);
    const compact = this._sanitize({
      label,
      url: result.url,
      timestamp: result.timestamp,
      passes: result.passes.length,
      incomplete: result.incomplete.map(value => ({
        id: value.id,
        impact: value.impact,
        nodes: value.nodes.length,
      })),
      violations: result.violations.map(value => ({
        id: value.id,
        impact: value.impact,
        help: value.help,
        helpUrl: value.helpUrl,
        description: value.description,
        nodes: value.nodes.map(node => ({
          target: node.target,
          html: node.html,
          failureSummary: node.failureSummary,
          usereyeHint: node.usereyeHint || null,
        })),
      })),
    });
    this.axeRuns.push(compact);
    for (const violation of compact.violations) {
      const severity =
        {
          critical: 'critical',
          serious: 'major',
          moderate: 'minor',
          minor: 'minor',
        }[violation.impact] || 'minor';
      this.addIssue({
        fingerprint: `axe:${label}:${violation.id}`,
        source: 'a11y',
        code: violation.id,
        severity,
        title: `${t(catalog(this.options.reportLocale), 'accessibility')} (${label}): ${violation.help}`,
        expected: t(section(this.options.reportLocale, 'issue'), 'axeExpected', { id: violation.id }),
        actual: t(section(this.options.reportLocale, 'issue'), 'axeAffected', {
          count: violation.nodes.length,
        }),
        technical: `${violation.description}\n${violation.nodes
          .map(
            node =>
              `${node.target.join(' ')} — ${node.failureSummary}${
                node.usereyeHint?.technical ? `\nHint: ${node.usereyeHint.technical}` : ''
              }`,
          )
          .join('\n')}`,
      });
    }
    return compact;
  }

  _unexpectedTelemetry() {
    return {
      consoleErrors: this.telemetry.consoleErrors.filter(item => !item.expected),
      pageErrors: this.telemetry.pageErrors.filter(item => !item.expected),
      requestFailures: this.telemetry.requestFailures.filter(item => !item.expected),
      httpErrors: this.telemetry.httpErrors.filter(item => !item.expected),
    };
  }

  async collectVitals() {
    if (!this.page || this.page.isClosed()) {
      return null;
    }
    try {
      const raw = await this.page.evaluate(() =>
        window.__userEyeCollectVitals ? window.__userEyeCollectVitals() : null,
      );
      if (!raw) {
        return null;
      }
      const rated = rateVitals(raw);
      const snapshot = this._sanitize({ ...raw, rated });
      this.vitalsSnapshots.push(snapshot);
      return snapshot;
    } catch {
      return null;
    }
  }

  patienceReport() {
    return buildPatienceReport({
      locale: this.options.reportLocale,
      experienceEvents: this.experienceEvents,
      actions: this.actions,
      steps: this.steps,
      issues: this.issues,
      unexpectedTelemetry: this._unexpectedTelemetry(),
      misclicks: this.misclicks,
      firstImpression: this.firstImpression,
    });
  }

  _persistMetadata() {
    return persistMetadata(this);
  }

  async close() {
    return closeEye(this);
  }

  thirdParties() {
    return thirdPartyInventory(
      this.telemetry.requests,
      this.page?.url?.() || this.firstImpression?.url || '',
    );
  }

  /**
   * Build the final `result.json` payload (schema version 4).
   * @param {Record<string, unknown>} [extra] Additional top-level fields.
   */
  result(extra = {}) {
    return buildResult(this, TOOL_VERSION, extra);
  }
}

module.exports = { UserEye, safeName, TOOL_VERSION, SUPPORTED_BROWSERS };
