/** @type {import('usereye').UserEyeConfig} */
module.exports = {
  baseURL: process.env.USEREYE_BASE_URL,
  projectDir: '.',
  appDir: undefined,
  command: null,
  install: false,
  mode: 'standard',
  headed: false,
  workers: 0,
  outDir: 'artifacts/usereye',
  locale: 'en-US',
  timezoneId: 'UTC',
  colorScheme: 'light',
  viewport: { width: 1440, height: 900 },
  recordVideo: 'on-failure',
  trace: 'on-failure', // 7.5.1: Playwright trace.zip kept only when the run is not clean ('always' | 'never')
  credentials: {
    email: process.env.USEREYE_EMAIL,
    username: process.env.USEREYE_USERNAME,
    password: process.env.USEREYE_PASSWORD,
  },
  storageState: process.env.USEREYE_STORAGE_STATE,
  auth: { strategy: 'form' },
  allowWrite: false,
  allowDestructive: false,
  allowDownloads: false,
  blockPaths: [],
  blockNamePatterns: [],
  seedPaths: ['/'],
  ignoreQueryParams: true,
  patternPack: ['en'],
  protocols: 'auto',
  axe: true,
  codeQuality: true,
  reportLocale: 'en',
  reportFormat: ['html', 'md'],
  // --- Calm defaults (7.4.1) -------------------------------------------------
  // The four knobs below are the built-in defaults, written out so they are
  // discoverable. `tests/config.test.js` asserts this file agrees with
  // DEFAULT_CONFIG, so it cannot silently drift.
  misclick: { policy: 'stable-only' }, // hard signals only (URL change / dialog / dangerous)
  findings: {
    minConfidence: 'medium', // primary list is actionable; result.json keeps everything
    gateConfidence: 'high', // CI gates count only high-confidence findings
    suppress: [], // codes/sources to drop entirely
    elevate: [], // codes to force to high confidence
    treatAsSignal: [], // codes to treat as informational signals
  },
  // --- Opt back into the pre-7.4.1 "loud" / forensic profile ----------------
  // recordVideo: true,                   // always keep user-eye-session.webm
  // misclick: { policy: 'aggressive' },  // any side effect counts as harmful
  // findings: { minConfidence: 'low', gateConfidence: 'low' },
  // --- 7.2 roadmap: quiet gates / regression gating (all opt-in) -------------
  // gates: {
  //   minAdaptiveScore: 70,
  //   maxBlocker: 0,
  //   maxCritical: 0,
  //   maxUnexpectedBrowserErrors: 0,
  //   maxMajor: null,               // optional cap on surfaced majors (at gateConfidence)
  //   failOnNewMajor: false,        // with --compare baseline: fail only on regressions
  //   failOnNewHighConfidence: false,
  // },
  // sarif: { minConfidence: 'medium' },  // confidence floor for the SARIF export
  // allowedHosts: [],              // host allow-list the explorer may navigate (safety)
};
