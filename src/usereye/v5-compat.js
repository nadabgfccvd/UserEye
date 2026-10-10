'use strict';

/**
 * UserEye 5.0 public surface. Version 6+ must keep every id and export here.
 * The compatibility test fails if any item disappears.
 */

const V5_USER_EYE_METHODS = [
  'registerSecret',
  'allowTelemetry',
  'allowHttpError',
  'launch',
  'perform',
  'locate',
  'click',
  'fill',
  'press',
  'upload',
  'see',
  'testMisclicks',
  'testRapidClicks',
  'waitForStableUI',
  'grantClipboard',
  'goto',
  'observe',
  'scanVisualHealth',
  'step',
  'verify',
  'require',
  'addIssue',
  'screenshot',
  'clipboardText',
  'recordDownload',
  'recordDialog',
  'nextDialog',
  'runAxe',
  'patienceReport',
  'close',
  'result',
];

const V5_EXPLORER_METHODS = [
  'waitForQuiet',
  'captureState',
  'auditMisclickSample',
  'auditResponsive',
  'qualityReport',
  'explore',
  'result',
];

const V5_PROTOCOL_IDS = [
  'http-document',
  'multi-tab-session',
  'refresh-persistence',
  'offline-recovery',
  'keyboard-navigation',
  'touch-pointer',
  'pwa-service-worker',
  'realtime-websocket-sse',
  'slow-network',
  'history-back-forward',
  'parallel-internal-navigation',
  'dark-color-scheme',
  'reduced-motion',
  'forced-colors',
  'clipboard',
  'form-validation',
  'popup-window',
  'cache-storage',
  'download',
  'upload-input',
];

const V5_QUICK_PROTOCOL_IDS = [
  'http-document',
  'multi-tab-session',
  'refresh-persistence',
  'offline-recovery',
  'keyboard-navigation',
  'touch-pointer',
  'pwa-service-worker',
  'realtime-websocket-sse',
];

const V5_QUALITY_GATES = [
  'initial-state',
  'browser-telemetry',
  'state-dedup',
  'responsive',
  'accessibility',
  'safety',
  'auth',
  'misclick',
  'budget-accounting',
];

const V5_MODULE_EXPORTS = {
  'user-eye.js': ['UserEye', 'safeName', 'TOOL_VERSION'],
  'adaptive-explorer.js': ['AdaptiveExplorer', 'MODES', 'classifyPage', 'mergeBudget'],
  'adaptive-browser.js': ['collectAdaptiveFacts', 'collectActionCandidates', 'collectFormFields'],
  'artifact-store.js': ['buildResult', 'closeEye', 'persistMetadata'],
  'browser-perception.js': ['collectBrowserPerception'],
  'browser-recorder.js': ['installUserEyeRecorder'],
  'code-quality.js': ['CodeQualityAnalyzer', 'inspectFile', 'isTestPath', 'walkSourceFiles'],
  'misclick-engine.js': ['MisclickEngine'],
  'parallel-scheduler.js': ['ParallelScheduler', 'adaptiveWorkerCount'],
  'patience.js': ['buildPatienceReport', 'moodFor'],
  'perception.js': ['capturePerception'],
  'project-adapter.js': ['ProjectAdapter'],
  'protocol-runner.js': ['ProtocolRunner'],
  'report.js': ['writeReports'],
  'protocols/helpers.js': ['DANGER', 'fnv'],
  'protocols/network.js': [
    'httpDocument',
    'offlineRecovery',
    'pwaServiceWorker',
    'realtimeProtocols',
    'slowNetwork',
  ],
  'protocols/browser.js': [
    'multiTabSession',
    'refreshPersistence',
    'historyNavigation',
    'parallelInternalNavigation',
    'popupProtocol',
    'cacheStorage',
  ],
  'protocols/input.js': [
    'keyboardNavigation',
    'touchPointer',
    'renderingPreference',
    'clipboardProtocol',
    'formValidation',
  ],
  'protocols/file.js': ['downloadProtocol', 'uploadProtocol'],
};

module.exports = {
  V5_USER_EYE_METHODS,
  V5_EXPLORER_METHODS,
  V5_PROTOCOL_IDS,
  V5_QUICK_PROTOCOL_IDS,
  V5_QUALITY_GATES,
  V5_MODULE_EXPORTS,
};
