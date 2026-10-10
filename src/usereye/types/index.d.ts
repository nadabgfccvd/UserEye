export * from './usereye-config';
export type { UserEyeConfig } from './usereye-config';

import type { Browser, BrowserContext, Locator, Page } from 'playwright';
import type { UserEyeConfig, UserEyeMode, UserEyeReportLocale } from './usereye-config';

export const TOOL_VERSION: string;
export const SUPPORTED_BROWSERS: ReadonlyArray<'chromium' | 'firefox' | 'webkit'>;
export const DEFAULT_CONFIG: Readonly<Record<string, unknown>>;

/** Exploration budget attached to each mode (`quick`/`standard`/`deep`). */
export interface ExplorationBudget {
  maxStates: number;
  maxActions: number;
  maxDepth: number;
  actionsPerState: number;
  coverageTarget: number;
  screenshots: number;
  axeStates: number;
  misclickTargets: number;
  misclickPoints: string[];
  viewports: Array<{ name: string; width: number; height: number }>;
}

export const MODES: Record<'quick' | 'standard' | 'deep', ExplorationBudget>;

/** Compiled pattern pack: one case-insensitive RegExp per category. */
export type UserEyePatterns = Record<
  'auth' | 'authPage' | 'setupPage' | 'dangerous' | 'write' | 'navigation' | 'utility' | 'skipLink' | 'copy' | 'errorPage' | 'emptyPage',
  RegExp
>;

/** Facts counted on a page before classification. */
export interface PageFacts {
  controls: number;
  passwordInputs: number;
  forms: number;
  inputs: number;
  tables: number;
  navigation: number;
  headings: number;
  cards: number;
}

export type PageKind =
  | 'error'
  | 'registration/setup'
  | 'authentication'
  | 'form'
  | 'table/list'
  | 'dashboard/content'
  | 'collection/empty'
  | 'content';

/** Classify a perceived page using the active pattern pack (pure function). */
export function classifyPage(
  observation: { title: string; visibleText: string },
  facts: PageFacts,
  patterns?: UserEyePatterns,
): PageKind;

/** Merge a mode budget with numeric overrides (pure function). */
export function mergeBudget(mode: UserEyeMode | string, override?: Partial<ExplorationBudget>): ExplorationBudget;

/** Locator descriptor accepted by `click`/`fill`/`see`/`upload`. */
export type TargetDescriptor =
  | string
  | { role: string; name?: string | RegExp; exact?: boolean }
  | { label: string; exact?: boolean }
  | { placeholder: string; exact?: boolean }
  | { text: string; exact?: boolean }
  | { testId: string }
  | { css: string };

export interface FlowTextOptions {
  timeout?: number;
  /** Use substring matching instead of trimmed equality. */
  contains?: boolean;
}

/** Assertion helper injected into `--review-mode flows` files. */
export interface UserEyeFlowExpect {
  (actual: Page): {
    text(descriptor: TargetDescriptor, expected: string | RegExp, options?: FlowTextOptions): Promise<string>;
    count(descriptor: TargetDescriptor, expected: number, options?: { timeout?: number }): Promise<number>;
  };
  (actual: Locator | unknown): {
    toBeVisible(options?: { timeout?: number }): Promise<void>;
    toContainText(expected: string | RegExp, options?: { timeout?: number }): Promise<string>;
    toHaveText(expected: string | RegExp, options?: FlowTextOptions): Promise<string>;
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toBeTruthy(): void;
  };
  text(descriptor: TargetDescriptor, expected: string | RegExp, options?: FlowTextOptions): Promise<string>;
  count(descriptor: TargetDescriptor, expected: number, options?: { timeout?: number }): Promise<number>;
}

/** Browser helpers injected into a declared critical flow. */
export interface UserEyeFlowHelpers {
  waitText(descriptor: TargetDescriptor, expected: string | RegExp, options?: FlowTextOptions): Promise<string>;
  /** Safe wrapper for page.waitForFunction(fn, arg, options); timeout is never mistaken for ARG. */
  waitFor<T = unknown>(
    predicate: (...args: unknown[]) => T,
    options?: { timeout?: number; polling?: number | 'raf'; arg?: unknown },
  ): Promise<unknown>;
}

export interface UserEyeOptions {
  artifactDir?: string;
  headless?: boolean;
  browser?: 'chromium' | 'firefox' | 'webkit';
  viewport?: { width: number; height: number };
  locale?: string;
  timezoneId?: string;
  colorScheme?: 'light' | 'dark' | 'no-preference';
  storageState?: string;
  ignoreHTTPSErrors?: boolean;
  acceptDownloads?: boolean;
  userAgent?: string;
  /** `'on-failure'` records a video but discards it when the run is clean. */
  recordVideo?: boolean | 'on-failure';
  /** Sink for the per-step `[PASS]/[WARN]/[FAIL]` lines (7.5.1). Default: console logger at `info`. */
  logger?: { info(message: string, fields?: Record<string, unknown>): void; step?(step: { number: number; name: string; status: string; durationMs: number }): void };
  /** Playwright trace policy (7.5.1). Engine default `'always'`; config/CLI default `'on-failure'`. */
  trace?: 'on-failure' | 'always' | 'never';
  autoObserve?: 'off' | 'step' | 'failure';
  visualAuditIssues?: boolean;
  touchTarget?: number;
  patienceEnabled?: boolean;
  /**
   * Language of findings, gaze narratives, user-plan steps, patience reasons and
   * generated reports. `'auto'` derives the pack from the run `locale`; unknown
   * tags fall back to `'en'`. Matches the shipped `locales/` packs.
   */
  reportLocale?: UserEyeReportLocale;
  misclickDistance?: number;
  /** Near-miss policy: `aggressive` (any side effect) or `stable-only` (hard signals only). */
  misclickPolicy?: 'stable-only' | 'aggressive';
  /** 200% zoom simulation strategy: `css` (default) | `viewport`. */
  zoomMode?: 'css' | 'viewport' | 'cdp';
  /** 7.3 opt-in user-journey battery (resilience + accessibility/device). Default off. */
  userJourney?: {
    enabled?: boolean;
    resilience?: { backgroundTab?: boolean; unsavedClose?: boolean; passwordRecovery?: boolean; lockout?: boolean; languageSwitch?: boolean };
    a11y?: { permissions?: boolean; fastScroll?: boolean; keyboardShortcuts?: boolean; mobileLayout?: boolean; rightClick?: boolean; deadLinks?: boolean; textResize?: boolean; highContrast?: boolean; colorblind?: boolean };
    lockoutAttempts?: number;
    tempMail?: Record<string, unknown> | null;
    hasLogin?: boolean | null;
  };
  /** 7.4 opt-in browser-extension effect battery (resilience to popular extensions). Default off. */
  extensions?: {
    enabled?: boolean;
    categories?: { adBlocker?: boolean; darkReader?: boolean; passwordManager?: boolean; translator?: boolean; couponHelper?: boolean; fullPageCapture?: boolean; reactDevtools?: boolean; volumeBooster?: boolean };
  };
  /** Timeout (ms) for `goto()` navigations. Default 15000. */
  navigationTimeoutMs?: number;
  /** Default timeout (ms) for `nextDialog()`. Default 5000. */
  dialogTimeoutMs?: number;
  /** Extra attempts for transient navigation failures. Default 1; 0 disables. */
  retries?: number;
  /** Base backoff (ms), grows linearly per attempt. Default 400. */
  retryBackoffMs?: number;
  /** Minimum delay (ms) between engine-issued actions. Default 0. */
  minActionDelayMs?: number;
  screenshotMaskSelectors?: string[];
}

export interface StepOptions {
  critical?: boolean;
  screenshot?: boolean;
  fullPage?: boolean;
  observeBefore?: boolean;
  observeAfter?: boolean;
  profile?: string;
}

export interface ObserveOptions {
  profile?: string;
  screenshot?: boolean;
  fullPage?: boolean;
  addIssues?: boolean;
  gaze?: boolean;
  human?: boolean;
  touchTarget?: number;
  maxText?: number;
  maxControls?: number;
}

export interface VerifyDetails {
  severity?: 'blocker' | 'critical' | 'major' | 'minor';
  expected?: string;
  actual?: string;
  technical?: string;
  fingerprint?: string;
}

export type FindingConfidence = 'high' | 'medium' | 'low';
export type FindingKind = 'defect' | 'risk' | 'signal' | 'opinion';
export type FindingTriage = 'accepted-pattern' | string;

/**
 * Aliases for the `findings` vocabulary, so both naming families resolve from the
 * package root: `UserEyeConfidence` / `UserEyeMisclickPolicy` are declared in
 * `./usereye-config` and re-exported by the `export *` above; the two aliases here
 * cover the issue-model names. Kept as type aliases (not new unions) so the
 * runtime classifier in `findings.js` remains the single source of truth.
 */
export type UserEyeFindingKind = FindingKind;
export type UserEyeFindingConfidence = FindingConfidence;

export interface UserEyeIssue {
  id: string;
  fingerprint: string;
  severity: 'blocker' | 'critical' | 'major' | 'minor';
  title: string;
  step: string | null;
  steps: string[];
  expected: string;
  actual: string;
  technical: string;
  evidence: string | null;
  occurrences: number;
  /** Confidence that the finding is real (Phase 1). Optional; derived when absent. */
  confidence?: FindingConfidence;
  /** defect = breakage, risk = likely, signal = informational, opinion = accepted intentional pattern. */
  kind?: FindingKind;
  /** Triage lane; `accepted-pattern` is reported separately and never fails CI. */
  triage?: FindingTriage;
  /** Stable name of the recognized pattern (for example screen-reader-only-clipping). */
  acceptedPattern?: string;
  /**
   * Presentation/gating flag (7.4.1). `false` means the finding was held back from
   * the primary list by `findings.minConfidence` / `findings.suppress`, but it is
   * still recorded in `result.json.issuesAll` for forensics. Absent on results
   * written by earlier versions.
   */
  surfaced?: boolean;
  /** Provenance: a11y | perception | misclick | engine | code-quality. */
  source?: string;
  /** Stable rule/finding code (e.g. an axe rule id, a perception code, misclick outcome). */
  code?: string;
}

export class UserEye {
  constructor(options?: UserEyeOptions);
  options: Required<Pick<UserEyeOptions, 'artifactDir' | 'headless' | 'browser' | 'viewport' | 'locale' | 'timezoneId' | 'colorScheme' | 'recordVideo' | 'trace' | 'autoObserve' | 'visualAuditIssues' | 'touchTarget' | 'patienceEnabled' | 'reportLocale' | 'misclickDistance' | 'navigationTimeoutMs' | 'dialogTimeoutMs' | 'retries' | 'retryBackoffMs' | 'minActionDelayMs' | 'screenshotMaskSelectors'>> & UserEyeOptions;
  artifactDir: string;
  screenshotDir: string;
  observationDir: string;
  videoDir: string;
  tracePath: string;
  browser: Browser | null;
  context: BrowserContext | null;
  page: Page | null;
  steps: unknown[];
  issues: UserEyeIssue[];
  actions: unknown[];
  observations: unknown[];
  retriedOperations: Array<{
    operation: string;
    attempt: number;
    maxAttempts: number;
    backoffMs: number;
    at: string;
    step: string | null;
    error: string;
    succeededOnAttempt?: number;
  }>;
  registerSecret(...values: Array<string | number | Array<string | number>>): this;
  allowTelemetry(rule?: { type?: string; status?: number; url?: string | RegExp; message?: string | RegExp; reason?: string }): this;
  allowHttpError(status: number, url?: string | RegExp, reason?: string): this;
  launch(): Promise<this>;
  perform<T>(kind: string, label: string | null, locator: Locator | null, fn: () => Promise<T>, metadata?: Record<string, unknown>): Promise<T>;
  locate(target: TargetDescriptor, page?: Page): Locator;
  click(target: TargetDescriptor | Locator, label?: string, options?: Record<string, unknown>): Promise<unknown>;
  fill(target: TargetDescriptor | Locator, value: string, label?: string, options?: { sensitive?: boolean; waitForStable?: boolean } & Record<string, unknown>): Promise<unknown>;
  press(key: string, label?: string, options?: Record<string, unknown>): Promise<unknown>;
  upload(target: TargetDescriptor | Locator, files: string | string[] | Buffer | object | Array<string | Buffer | object>, label?: string, options?: Record<string, unknown>): Promise<unknown>;
  see(target: TargetDescriptor | Locator, label?: string, options?: { severity?: string; expected?: string }): Promise<boolean>;
  testMisclicks(target: TargetDescriptor | Locator, options?: Record<string, unknown>): Promise<unknown>;
  testRapidClicks(target: TargetDescriptor | Locator, options?: Record<string, unknown>): Promise<unknown>;
  waitForStableUI(idleMs?: number): Promise<void>;
  grantClipboard(origin: string): Promise<void>;
  goto(url: string, options?: { timeout?: number; waitUntil?: string; retries?: number }): Promise<unknown>;
  observe(name: string, options?: ObserveOptions): Promise<Record<string, unknown>>;
  scanVisualHealth(name: string, options?: ObserveOptions): Promise<Record<string, unknown>>;
  step(name: string, fn: () => Promise<void>, options?: StepOptions): Promise<Record<string, unknown>>;
  verify(title: string, condition: unknown, details?: VerifyDetails): boolean;
  require(title: string, condition: unknown, details?: VerifyDetails): void;
  addIssue(issue: Partial<UserEyeIssue> & { title?: string }): UserEyeIssue;
  screenshot(name: string, fullPage?: boolean): Promise<string>;
  clipboardText(): Promise<string>;
  recordDownload(filePath: string, label: string): string;
  recordDialog(dialog: import('playwright').Dialog, action: string): void;
  nextDialog(action?: 'accept' | 'dismiss', options?: { timeout?: number; expectedText?: string; promptText?: string }): Promise<string>;
  runAxe(label: string, axeSourcePath: string): Promise<Record<string, unknown>>;
  collectVitals(): Promise<Record<string, unknown> | null>;
  patienceReport(): Record<string, unknown>;
  close(): Promise<void>;
  thirdParties(): { pageOrigin: string; origins: Array<{ origin: string; count: number; types: Record<string, number> }> };
  result(extra?: Record<string, unknown>): Record<string, unknown>;
}

export class AdaptiveExplorer {
  constructor(eye: UserEye, options?: Record<string, unknown>);
  waitForQuiet(): Promise<void>;
  captureState(name: string, options?: Record<string, unknown>): Promise<Record<string, unknown>>;
  auditMisclickSample(): Promise<unknown>;
  auditResponsive(): Promise<unknown[]>;
  qualityReport(): Record<string, unknown>;
  explore(): Promise<Record<string, unknown>>;
  result(): Record<string, unknown>;
}

export class ProjectAdapter {
  constructor(options?: { projectDir?: string; appDir?: string; command?: string | null; url?: string | null; install?: boolean; env?: Record<string, string> });
  analyze(): Record<string, unknown> & { projectName: string; stack: string; confidence: number; startCommand: string | null; warnings: string[] };
  install(): Promise<{ skipped: boolean; command: string; output?: string }>;
  start(options?: { timeoutMs?: number }): Promise<string>;
  stop(): Promise<void>;
  writeLogs(filePath: string): void;
}

export interface ProtocolRegistryEntry {
  id: string;
  category: string;
  modes?: UserEyeMode[];
  serial?: boolean;
  retries?: number;
  run(): Promise<unknown>;
}

export class ProtocolRunner {
  constructor(eye: UserEye | Record<string, never>, options?: Record<string, unknown>);
  registry(): ProtocolRegistryEntry[];
  selectedProtocols(): ProtocolRegistryEntry[];
  run(): Promise<Record<string, unknown>>;
  withContext<T>(options: Record<string, unknown>, callback: (handle: { context: BrowserContext; page: Page; telemetry: Record<string, unknown> }) => Promise<T>): Promise<T>;
}

export class CodeQualityAnalyzer {
  constructor(options?: { projectDir?: string; appDir?: string; stack?: string; mode?: string; timeoutMs?: number });
  staticAnalysis(): Record<string, unknown>;
  commands(): Array<{ id: string; command: string }>;
  run(): Promise<Record<string, unknown>>;
}

export function loadConfig(options?: { argv?: string[]; cwd?: string; env?: NodeJS.ProcessEnv }): Promise<UserEyeConfig>;
export function sanitizeConfig(value: unknown): unknown;
export function writeResolvedConfig(config: unknown, artifactDir: string): string;
export function loadPatterns(options?: { packs?: string[]; custom?: Record<string, unknown>; baseDir?: string }): UserEyePatterns;
export function writeReports(result: unknown, artifactDir: string, options?: { locale?: string; formats?: string[] | string; embedLimit?: number | 'unlimited'; report?: { embedLimit?: number | 'unlimited' } }): Record<string, string>;
export function buildSarif(result: unknown): Record<string, unknown>;
export function writeSarif(result: unknown, filePath: string): string;
export function safeName(value: unknown): string;
export function buildExecutionPlan(config: UserEyeConfig, analysis?: { startCommand?: string | null; stack?: string | null }, plugins?: unknown[]): Record<string, unknown>;
export function buildIssuePayloads(result: Record<string, unknown>, options?: { format?: 'github' | 'jira' | 'linear'; severities?: string[]; projectKey?: string; labels?: string[] }): unknown;
