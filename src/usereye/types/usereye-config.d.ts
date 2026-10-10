import type { Page } from 'playwright';
import type { UserEye } from './index';

export type UserEyeMode = 'quick' | 'standard' | 'deep';
export type UserEyeReviewMode = 'normal' | 'perf-seo' | 'flows' | 'a11y-strict';
export type UserEyeAuthStrategy = 'form' | 'storageState' | 'hook';
export type UserEyeReportLocale = 'en' | 'pt' | 'pt-BR' | 'es' | 'fr' | 'auto';
export type UserEyePattern = RegExp | string;
export type UserEyeConfidence = 'low' | 'medium' | 'high';
export type UserEyeMisclickPolicy = 'stable-only' | 'aggressive';

export interface UserEyePlugin {
  id: string;
  protocols?: Array<{
    id: string;
    category?: string;
    modes?: UserEyeMode[];
    serial?: boolean;
    run(runner: unknown): Promise<unknown>;
  }>;
  beforeRun?(context: unknown): Promise<void> | void;
  afterObservation?(observation: unknown, context: unknown): Promise<void> | void;
  afterState?(state: unknown, context: unknown): Promise<void> | void;
  afterRun?(result: unknown, context: unknown): Promise<void> | void;
}

export interface UserEyeConfig {
  baseURL?: string;
  url?: string;
  appName?: string;
  projectDir?: string;
  appDir?: string;
  command?: string | null;
  install?: boolean;
  env?: Record<string, string>;
  startupTimeoutMs?: number;
  mode?: UserEyeMode;
  /** Review runner. Keeps `mode` as budget/depth and selects the audit type. Default `normal`. */
  reviewMode?: UserEyeReviewMode;
  headed?: boolean;
  workers?: number;
  outDir?: string;
  keepArtifacts?: boolean;
  compareWith?: string;
  locale?: string;
  timezoneId?: string;
  colorScheme?: 'light' | 'dark' | 'no-preference';
  viewport?: { width: number; height: number };
  userAgent?: string;
  recordVideo?: boolean | 'on-failure';
  /** Local retention (7.5.1): keep the newest n previous runs under `<outDir>-history/`. Default 0. */
  keepLast?: number;
  /** Playwright trace: `on-failure` (default, discarded on a clean run), `always` or `never`. */
  trace?: 'on-failure' | 'always' | 'never';
  ignoreHTTPSErrors?: boolean;
  /** Near-miss policy. `stable-only` reserves "harmful" for URL/dialog changes. */
  misclick?: { policy?: UserEyeMisclickPolicy };
  /** 200% zoom simulation strategy: `css` (style.zoom, default) | `viewport` | `cdp` (reserved). */
  zoomMode?: 'css' | 'viewport' | 'cdp';
  /** Consent-wall detection tuning (Phase 2.2). */
  consent?: {
    /** When true, only flag a wall that exposes an interactive accept/reject control. */
    strict?: boolean;
    /** Extra layer selectors to treat as consent candidates. */
    selectors?: string[];
    /** Minimum fraction of the fold an overlay must cover to be a wall (default 0.18). */
    minWallArea?: number;
  };
  /** Host allow-list safety net (explorer won't navigate outside these hosts). */
  allowedHosts?: UserEyePattern[];
  /** When true, obey `robots.txt` on observe-of-public-prod targets. */
  respectRobots?: boolean;
  credentials?: { email?: string; username?: string; password?: string };
  storageState?: string;
  auth?: {
    strategy?: UserEyeAuthStrategy;
    /** Opt-in: when true, a run that detects auth but cannot sign in exits 2 and writes auth-required.json. */
    required?: boolean;
    /** Post-auth assertions to prove login on complex shells (Phase 5.2). */
    successAssert?: {
      urlNotMatch?: RegExp | string;
      selector?: string;
      noSelector?: string;
    };
  };
  allowWrite?: boolean;
  allowDestructive?: boolean;
  allowDownloads?: boolean;
  blockPaths?: UserEyePattern[];
  blockNamePatterns?: UserEyePattern[];
  seedPaths?: string[];
  ignoreQueryParams?: boolean;
  /** Treat URL hashes as the same state for dedupe/coverage (large SPA control). */
  ignoreHash?: boolean;
  /** Optional wall-clock exploration cap in ms; stop reason is reported. */
  maxWallClockMs?: number;
  /** Ready policy for app shells that can't be inferred from mutation quiet. */
  ready?: {
    strategy?: 'quiet' | 'selector' | 'load' | 'network-almost-idle';
    selector?: string;
    timeoutMs?: number;
  };
  /** Same-origin frame inventory (evidence). 'same-origin' currently inventories only. */
  diveIntoIframes?: 'same-origin' | 'off';
  /**
   * Opt-in "user journey" battery (7.3). Adds resilience and accessibility/device
   * probes to standard/deep runs. Default OFF — never changes existing runs.
   */
  userJourney?: {
    enabled?: boolean;
    /** Probes that reason about app state across tabs/close/auth. Login-only
     *  probes (password recovery, temp-mail) auto-skip when there is no login form. */
    resilience?: {
      backgroundTab?: boolean;
      unsavedClose?: boolean;
      passwordRecovery?: boolean;
      /** Intentionally submits wrong credentials — enable only on sandboxed targets. */
      lockout?: boolean;
      languageSwitch?: boolean;
    };
    a11y?: {
      permissions?: boolean;
      fastScroll?: boolean;
      keyboardShortcuts?: boolean;
      mobileLayout?: boolean;
      rightClick?: boolean;
      deadLinks?: boolean;
      textResize?: boolean;
      highContrast?: boolean;
      colorblind?: boolean;
    };
    /** Wrong-password submissions made by the lockout probe (default 1). */
    lockoutAttempts?: number;
    /** Reserved: disposable-inbox provider descriptor for the temp-mail login probe. */
    tempMail?: Record<string, unknown> | null;
    /** Answer to "does your app have a login system?" — `false` skips all
     *  login-only probes (password-recovery, lockout, temp-mail); `true` runs
     *  them; `null`/undefined auto-detects a login form. */
    hasLogin?: boolean | null;
  };
  /**
   * Opt-in "browser-extension effect" battery (7.4). Simulates the net effect of
   * popular Chrome extension categories (ad/content blocker, dark mode, password
   * manager, translator, coupon helper, full-page capture, React devtools, per-tab
   * audio) on the running app and reports how it reacts. Default OFF.
   */
  extensions?: {
    enabled?: boolean;
    categories?: {
      adBlocker?: boolean;
      darkReader?: boolean;
      passwordManager?: boolean;
      translator?: boolean;
      couponHelper?: boolean;
      fullPageCapture?: boolean;
      reactDevtools?: boolean;
      volumeBooster?: boolean;
    };
  };
  maxDepth?: number;
  maxStates?: number;
  maxActions?: number;
  actionsPerState?: number;
  patternPack?: string[];
  patterns?: Partial<Record<'auth' | 'authPage' | 'setupPage' | 'dangerous' | 'write' | 'navigation' | 'utility' | 'skipLink' | 'copy' | 'errorPage' | 'emptyPage', UserEyePattern | UserEyePattern[]>>;
  hints?: Record<string, unknown> & { primaryCta?: { role?: string; name?: UserEyePattern } };
  protocols?: 'auto' | 'core' | 'v5' | 'all' | string | string[];
  /**
   * Browser engine to launch (CLI: `--browser`, env: `USEREYE_BROWSER`).
   * Chromium is the default; firefox and webkit require
   * `usereye install-browsers firefox webkit`.
   */
  browser?: 'chromium' | 'firefox' | 'webkit';
  /**
   * Extra attempts for transient navigation failures (timeouts, connection
   * resets). Each retry is recorded in `result.json → retriedOperations`.
   * Default 1; set 0 to disable. CLI: `--retries`.
   */
  retries?: number;
  /** Base backoff in ms between retries; grows linearly per attempt. Default 400. */
  retryBackoffMs?: number;
  /**
   * Per-navigation timeout in ms for `goto()` and responsive audits.
   * Default 15000. CLI: `--navigation-timeout`.
   */
  navigationTimeoutMs?: number;
  /** Default timeout in ms for `nextDialog()`. Default 5000. CLI: `--dialog-timeout`. */
  dialogTimeoutMs?: number;
  /**
   * Minimum delay in ms between engine-issued actions — politeness for
   * third-party targets so a run never looks like a brute-force burst.
   * Default 0. CLI: `--min-delay`.
   */
  minActionDelayMs?: number;
  /** Per-protocol timeout in ms (parallel scheduler). Default 15000. CLI: `--protocol-timeout`. */
  protocolTimeoutMs?: number;
  /**
   * How long to wait for the project's start command / URL to respond.
   * Default 30000. CLI: `--startup-timeout`.
   */
  // startupTimeoutMs is declared above; grouped here for timeout discoverability.
  axe?: boolean;
  codeQuality?: boolean;
  codeQualityTimeoutMs?: number;
  reportLocale?: UserEyeReportLocale;
  reportFormat?: Array<'html' | 'md' | 'markdown' | 'md-pr' | 'markdown-pr' | 'sarif'> | string;
  /**
   * SARIF export options (7.4.1). SARIF feeds GitHub code scanning, so it has its
   * own confidence floor; `result.json.issuesAll` always keeps every finding.
   */
  /** HTML report options (7.5.1). */
  report?: {
    /** Bytes of screenshots embedded as data URIs before the rest are linked to files. Default 204800; `'unlimited'` embeds everything. */
    embedLimit?: number | 'unlimited';
  };
  sarif?: {
    /** Findings below this confidence are omitted from `usereye.sarif`. Default `medium`. */
    minConfidence?: UserEyeConfidence;
  };
  findings?: {
    /** Issues below this confidence are hidden from the primary issue list. */
    minConfidence?: UserEyeConfidence;
    /** Severity gates count only findings at/above this confidence. */
    gateConfidence?: UserEyeConfidence;
    /** Finding codes / sources / fingerprint prefixes to drop entirely. */
    suppress?: string[];
    /** Codes/sources to force to high confidence. */
    elevate?: string[];
    /** Codes/sources to treat as informational signals. */
    treatAsSignal?: string[];
  };
  performanceSeo?: {
    engine?: 'native' | 'lighthouse';
    urls?: string[];
    formFactor?: 'mobile' | 'desktop' | 'both';
    runs?: number;
    aggregation?: 'median' | 'mean';
    budgets?: { lcpMs?: number; inpMs?: number; cls?: number; totalByteWeightKb?: number; scriptKb?: number; imageKb?: number; seoScore?: number };
    seo?: { checkRobotsTxt?: boolean; checkSitemap?: boolean; requireCanonical?: boolean; requireMetaDescription?: boolean; requireDescriptiveLinks?: boolean };
  };
  flows?: {
    files?: string[];
    projects?: Array<'chromium' | 'firefox' | 'webkit'>;
    timeoutMs?: number;
    retries?: number;
    trace?: 'on-failure' | 'always' | 'never';
    video?: boolean | 'on-failure';
    failOnConsoleError?: boolean;
    runAxeAfterSteps?: boolean;
  };
  accessibilityStrict?: {
    standard?: 'WCAG2A' | 'WCAG2AA' | 'WCAG2AAA';
    axe?: { runOnly?: string[]; resultTypes?: Array<'violations' | 'incomplete' | 'passes' | 'inapplicable'> };
    incomplete?: 'off' | 'needs-review' | 'fail';
    pa11y?: { enabled?: boolean; runners?: string[]; includeWarnings?: boolean; includeNotices?: boolean; threshold?: number };
    baseline?: string | null;
  };
  gates?: {
    minAdaptiveScore?: number;
    maxBlocker?: number;
    maxCritical?: number;
    maxUnexpectedBrowserErrors?: number;
    /** Optional cap on surfaced majors (counted at gateConfidence). */
    maxMajor?: number | null;
    /** Fail the run when `--compare` shows any new blocker/critical/major. */
    failOnNewMajor?: boolean;
    /** Fail the run when `--compare` shows a new high-confidence major. */
    failOnNewHighConfidence?: boolean;
  };
  hooks?: {
    login?: (page: Page, context: { credentials?: UserEyeConfig['credentials']; baseURL: string; eye: UserEye }) => Promise<void>;
    beforeExplore?: (eye: UserEye) => Promise<void>;
    afterExplore?: (eye: UserEye, result: unknown) => Promise<void>;
  };
  plugins?: Array<string | UserEyePlugin>;
  profiles?: Record<string, Partial<UserEyeConfig>>;
  profile?: string;
  apps?: Array<Partial<UserEyeConfig> & { name: string }>;
  dryRun?: boolean;
}
