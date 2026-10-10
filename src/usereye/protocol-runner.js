'use strict';

const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
const { ParallelScheduler } = require('./parallel-scheduler');
const {
  cacheStorage,
  historyNavigation,
  multiTabSession,
  parallelInternalNavigation,
  popupProtocol,
  refreshPersistence,
} = require('./protocols/browser');
const { downloadProtocol, uploadProtocol } = require('./protocols/file');
const {
  clipboardProtocol,
  formValidation,
  keyboardNavigation,
  renderingPreference,
  touchPointer,
} = require('./protocols/input');
const {
  httpDocument,
  offlineRecovery,
  pwaServiceWorker,
  realtimeProtocols,
  slowNetwork,
} = require('./protocols/network');
const {
  brokenMedia,
  firstImpressionProtocol,
  rtlMirror,
  securityHeaders,
  tabOrderMap,
  zoomUsability,
} = require('./protocols/experience');
const {
  skipLinkProtocol,
  reducedMotionAnimations,
  printPreview,
  screenReaderProtocol,
  consentWallProtocol,
} = require('./protocols/human');
const {
  backgroundTabProbe,
  unsavedCloseProbe,
  passwordRecoveryProbe,
  lockoutBackoffProbe,
  languageSwitchProbe,
  tempMailLoginProbe,
  permissionsAuditProbe,
  fastScrollProbe,
  keyboardShortcutsProbe,
  mobileLayoutProbe,
  rightClickProbe,
  deadLinksProbe,
  textResizeProbe,
  highContrastProbe,
  colorblindProbe,
} = require('./protocols/user-journey');
const {
  adBlockerProbe,
  darkReaderProbe,
  passwordManagerProbe,
  translatorProbe,
  couponHelperProbe,
  fullPageCaptureProbe,
  reactDevtoolsProbe,
  volumeBoosterProbe,
} = require('./protocols/extensions');
const { V5_PROTOCOL_IDS } = require('./v5-compat');
const { loadPatterns } = require('./patterns');

class ProtocolRunner {
  constructor(eye, options = {}) {
    this.eye = eye;
    this.baseURL = options.baseURL;
    this.mode = options.mode || 'standard';
    this.workers = options.workers;
    this.timeoutMs = options.timeoutMs || 15_000;
    this.allowWrite = options.allowWrite === true;
    this.allowDownloads = options.allowDownloads === true;
    this.selection = options.protocols || 'auto';
    this.plugins = options.plugins || [];
    this.patterns =
      options.compiledPatterns ||
      loadPatterns({
        packs: options.patternPack || ['en'],
        custom: options.patterns || {},
        baseDir: options.projectDir || process.cwd(),
      });
    this.results = null;
    this.storageState = null;
    this.executionContext = new AsyncLocalStorage();
  }

  registry() {
    const registry = [
      {
        id: 'http-document',
        category: 'network',
        modes: ['quick', 'standard', 'deep'],
        run: () => httpDocument(this),
      },
      {
        id: 'multi-tab-session',
        category: 'browser',
        modes: ['quick', 'standard', 'deep'],
        run: () => multiTabSession(this),
      },
      {
        id: 'refresh-persistence',
        category: 'navigation',
        modes: ['quick', 'standard', 'deep'],
        run: () => refreshPersistence(this),
      },
      {
        id: 'offline-recovery',
        category: 'resilience',
        modes: ['quick', 'standard', 'deep'],
        run: () => offlineRecovery(this),
      },
      {
        id: 'keyboard-navigation',
        category: 'input',
        modes: ['quick', 'standard', 'deep'],
        retries: 0,
        run: () => keyboardNavigation(this),
      },
      {
        id: 'touch-pointer',
        category: 'input',
        modes: ['quick', 'standard', 'deep'],
        retries: 0,
        run: () => touchPointer(this),
      },
      {
        id: 'pwa-service-worker',
        category: 'browser-protocol',
        modes: ['quick', 'standard', 'deep'],
        run: () => pwaServiceWorker(this),
      },
      {
        id: 'realtime-websocket-sse',
        category: 'network-protocol',
        modes: ['quick', 'standard', 'deep'],
        run: () => realtimeProtocols(this),
      },
      {
        id: 'first-impression',
        category: 'experience',
        modes: ['quick', 'standard', 'deep'],
        run: () => firstImpressionProtocol(this),
      },
      {
        id: 'zoom-200',
        category: 'experience',
        modes: ['standard', 'deep'],
        run: () => zoomUsability(this),
      },
      {
        id: 'security-headers',
        category: 'security',
        modes: ['standard', 'deep'],
        run: () => securityHeaders(this),
      },
      {
        id: 'broken-media',
        category: 'experience',
        modes: ['standard', 'deep'],
        run: () => brokenMedia(this),
      },
      {
        id: 'tab-order-map',
        category: 'accessibility-protocol',
        modes: ['standard', 'deep'],
        run: () => tabOrderMap(this),
      },
      {
        id: 'rtl-mirror',
        category: 'experience',
        modes: ['deep'],
        run: () => rtlMirror(this),
      },
      {
        id: 'skip-link',
        category: 'accessibility-protocol',
        modes: ['standard', 'deep'],
        run: () => skipLinkProtocol(this),
      },
      {
        id: 'reduced-motion-animations',
        category: 'accessibility-protocol',
        modes: ['standard', 'deep'],
        run: () => reducedMotionAnimations(this),
      },
      {
        id: 'print-preview',
        category: 'experience',
        modes: ['standard', 'deep'],
        run: () => printPreview(this),
      },
      {
        id: 'screen-reader-preview',
        category: 'experience',
        modes: ['quick', 'standard', 'deep'],
        run: () => screenReaderProtocol(this),
      },
      {
        id: 'consent-wall',
        category: 'experience',
        modes: ['standard', 'deep'],
        run: () => consentWallProtocol(this),
      },
      {
        id: 'slow-network',
        category: 'performance',
        modes: ['standard', 'deep'],
        run: () => slowNetwork(this),
      },
      {
        id: 'history-back-forward',
        category: 'navigation',
        modes: ['standard', 'deep'],
        run: () => historyNavigation(this),
      },
      {
        id: 'parallel-internal-navigation',
        category: 'concurrency',
        modes: ['standard', 'deep'],
        run: () => parallelInternalNavigation(this),
      },
      {
        id: 'dark-color-scheme',
        category: 'rendering',
        modes: ['standard', 'deep'],
        run: () => renderingPreference(this, 'dark'),
      },
      {
        id: 'reduced-motion',
        category: 'rendering',
        modes: ['standard', 'deep'],
        run: () => renderingPreference(this, 'reduced-motion'),
      },
      {
        id: 'forced-colors',
        category: 'accessibility-protocol',
        modes: ['standard', 'deep'],
        run: () => renderingPreference(this, 'forced-colors'),
      },
      {
        id: 'clipboard',
        category: 'browser-api',
        modes: ['standard', 'deep'],
        run: () => clipboardProtocol(this),
      },
      {
        id: 'form-validation',
        category: 'forms',
        modes: ['standard', 'deep'],
        run: () => formValidation(this),
      },
      { id: 'popup-window', category: 'browser', modes: ['deep'], run: () => popupProtocol(this) },
      { id: 'cache-storage', category: 'storage', modes: ['deep'], run: () => cacheStorage(this) },
      {
        id: 'download',
        category: 'file-protocol',
        modes: ['deep'],
        serial: true,
        retries: 0,
        run: () => downloadProtocol(this),
      },
      {
        id: 'upload-input',
        category: 'file-protocol',
        modes: ['deep'],
        serial: true,
        retries: 0,
        run: () => uploadProtocol(this),
      },
    ];
    // 7.3 opt-in "user journey" battery. Registers only the probes the config
    // turns on; each probe still self-gates on absent login/auth surfaces. The
    // dry-run/plan path builds a ProtocolRunner with a stub eye that has no
    // options, so guard defensively.
    const uj = (this.eye && this.eye.options && this.eye.options.userJourney) || { enabled: false };
    if (uj.enabled) {
      const resilience = uj.resilience || {};
      const a11y = uj.a11y || {};
      const entry = (id, category, active, run) => {
        if (!active) return;
        registry.push({
          id,
          category,
          modes: ['standard', 'deep'],
          retries: 0,
          run: () => run(this),
        });
      };
      entry(
        'uj-background-tab',
        'user-journey-resilience',
        resilience.backgroundTab !== false,
        backgroundTabProbe,
      );
      entry(
        'uj-unsaved-close',
        'user-journey-resilience',
        resilience.unsavedClose !== false,
        unsavedCloseProbe,
      );
      entry(
        'uj-password-recovery',
        'user-journey-resilience',
        resilience.passwordRecovery !== false,
        passwordRecoveryProbe,
      );
      entry(
        'uj-lockout-backoff',
        'user-journey-resilience',
        resilience.lockout === true,
        lockoutBackoffProbe,
      );
      entry(
        'uj-language-switch',
        'user-journey-resilience',
        resilience.languageSwitch !== false,
        languageSwitchProbe,
      );
      entry('uj-temp-mail-login', 'user-journey-resilience', true, tempMailLoginProbe);
      entry('uj-permissions', 'user-journey-a11y', a11y.permissions !== false, permissionsAuditProbe);
      entry('uj-fast-scroll', 'user-journey-a11y', a11y.fastScroll !== false, fastScrollProbe);
      entry(
        'uj-keyboard-shortcuts',
        'user-journey-a11y',
        a11y.keyboardShortcuts !== false,
        keyboardShortcutsProbe,
      );
      entry('uj-mobile-layout', 'user-journey-a11y', a11y.mobileLayout !== false, mobileLayoutProbe);
      entry('uj-right-click', 'user-journey-a11y', a11y.rightClick !== false, rightClickProbe);
      entry('uj-dead-links', 'user-journey-a11y', a11y.deadLinks !== false, deadLinksProbe);
      entry('uj-text-resize', 'user-journey-a11y', a11y.textResize !== false, textResizeProbe);
      entry('uj-high-contrast', 'user-journey-a11y', a11y.highContrast !== false, highContrastProbe);
      entry('uj-colorblind', 'user-journey-a11y', a11y.colorblind !== false, colorblindProbe);
    }
    // 7.4 opt-in browser-extension effect battery. Simulates the net effect of the
    // most popular Chrome extension categories; registers only when enabled.
    const ext = (this.eye && this.eye.options && this.eye.options.extensions) || { enabled: false };
    if (ext.enabled) {
      const cats = ext.categories || {};
      const entry = (id, active, run) => {
        if (!active) return;
        registry.push({
          id,
          category: 'extension-effect',
          modes: ['standard', 'deep'],
          retries: 0,
          run: () => run(this),
        });
      };
      entry('ext-ad-blocker', cats.adBlocker !== false, adBlockerProbe);
      entry('ext-dark-reader', cats.darkReader !== false, darkReaderProbe);
      entry('ext-password-manager', cats.passwordManager !== false, passwordManagerProbe);
      entry('ext-translator', cats.translator !== false, translatorProbe);
      entry('ext-coupon-helper', cats.couponHelper !== false, couponHelperProbe);
      entry('ext-full-page-capture', cats.fullPageCapture !== false, fullPageCaptureProbe);
      entry('ext-react-devtools', cats.reactDevtools !== false, reactDevtoolsProbe);
      entry('ext-volume-booster', cats.volumeBooster !== false, volumeBoosterProbe);
    }
    for (const plugin of this.plugins) {
      for (const protocol of plugin.protocols || []) {
        if (!protocol?.id || typeof protocol.run !== 'function') continue;
        registry.push({
          category: 'plugin',
          modes: ['quick', 'standard', 'deep'],
          ...protocol,
          run: () => protocol.run(this),
        });
      }
    }
    return registry;
  }

  selectedProtocols() {
    const registry = this.registry();
    if (Array.isArray(this.selection)) {
      return registry.filter(item => this.selection.includes(item.id));
    }
    if (typeof this.selection === 'string' && !['auto', 'all', 'core', 'v5'].includes(this.selection)) {
      const names = this.selection
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);
      return registry.filter(item => names.includes(item.id));
    }
    if (this.selection === 'all') {
      return registry;
    }
    if (this.selection === 'v5') {
      return registry.filter(item => V5_PROTOCOL_IDS.includes(item.id));
    }
    if (this.selection === 'core') {
      return registry.filter(item => item.modes.includes('quick'));
    }
    return registry.filter(item => item.modes.includes(this.mode));
  }

  async run() {
    this.storageState = await this.eye.context.storageState();
    const protocols = this.selectedProtocols();
    const scheduler = new ParallelScheduler({
      workers: this.workers,
      mode: this.mode,
      timeoutMs: this.timeoutMs,
      retries: 1,
    });
    const scheduled = await scheduler.run(protocols, (protocol, execution) =>
      this.executionContext.run(execution, () => protocol.run()),
    );
    const results = scheduled.results.map((result, index) => ({
      id: protocols[index].id,
      category: protocols[index].category,
      serial: Boolean(protocols[index].serial),
      ...result,
    }));
    for (const result of results) {
      if (result.status === 'failed') {
        this.eye.addIssue({
          fingerprint: `protocol:${result.id}`,
          severity: result.id === 'http-document' ? 'blocker' : 'major',
          title: `Concurrent protocol failed: ${result.id}`,
          expected: 'The isolated scenario completes without error.',
          actual: result.error || 'Failure without a message.',
        });
      }
    }
    const counts = results.reduce(
      (out, result) => {
        out[result.status || 'unknown'] = (out[result.status || 'unknown'] || 0) + 1;
        return out;
      },
      { passed: 0, warning: 0, skipped: 0, failed: 0 },
    );
    const completed = results.filter(result => result.status !== 'failed').length;
    const qualityScore = protocols.length
      ? Math.round(
          (results.filter(result => ['passed', 'skipped'].includes(result.status)).length /
            protocols.length) *
            100,
        )
      : 100;
    this.results = {
      mode: this.mode,
      selection: this.selection,
      summary: {
        selected: protocols.length,
        completed,
        ...counts,
        qualityScore,
        configuredWorkers: scheduled.metrics.configuredWorkers,
        peakConcurrency: scheduled.metrics.peakConcurrency,
        parallelTasks: scheduled.metrics.parallelTasks,
        serializedTasks: scheduled.metrics.serializedTasks,
        durationMs: scheduled.metrics.durationMs,
      },
      scheduler: scheduled.metrics,
      protocols: results,
    };
    const outputPath = path.join(this.eye.artifactDir, 'protocol-results.json');
    fs.writeFileSync(outputPath, JSON.stringify(this.eye._sanitize(this.results), null, 2));
    this.eye.artifacts.protocols = path.relative(this.eye.artifactDir, outputPath).replace(/\\/g, '/');
    return this.results;
  }

  async withContext(options, callback) {
    const context = await this.eye.browser.newContext({
      storageState: this.storageState,
      viewport: options.viewport || { width: 1280, height: 800 },
      locale: this.eye.options.locale,
      timezoneId: this.eye.options.timezoneId,
      colorScheme: options.colorScheme || this.eye.options.colorScheme,
      reducedMotion: options.reducedMotion,
      forcedColors: options.forcedColors,
      isMobile: options.isMobile,
      hasTouch: options.hasTouch,
      acceptDownloads: this.allowDownloads,
      ignoreHTTPSErrors: this.eye.options.ignoreHTTPSErrors,
    });
    const execution = this.executionContext.getStore();
    const abortContext = () => context.close().catch(() => {});
    if (execution?.signal.aborted) {
      await abortContext();
      throw execution.signal.reason || new Error('Protocol execution aborted');
    }
    execution?.signal.addEventListener('abort', abortContext, { once: true });

    const telemetry = {
      consoleErrors: [],
      pageErrors: [],
      requestFailures: [],
      httpErrors: [],
      requests: 0,
      methods: {},
      websockets: [],
    };
    context.on('request', request => {
      telemetry.requests += 1;
      telemetry.methods[request.method()] = (telemetry.methods[request.method()] || 0) + 1;
    });
    context.on('requestfailed', request =>
      telemetry.requestFailures.push({ url: request.url(), error: request.failure()?.errorText }),
    );
    context.on('response', response => {
      if (response.status() >= 400) {
        telemetry.httpErrors.push({ url: response.url(), status: response.status() });
      }
    });
    const page = await context.newPage();
    page.on('console', message => {
      if (message.type() === 'error') {
        telemetry.consoleErrors.push(message.text());
      }
    });
    page.on('pageerror', error => telemetry.pageErrors.push(error.message));
    page.on('websocket', socket => telemetry.websockets.push(socket.url()));
    try {
      return await callback({ context, page, telemetry });
    } finally {
      execution?.signal.removeEventListener('abort', abortContext);
      await context.close().catch(() => {});
    }
  }
}

module.exports = { ProtocolRunner };
