'use strict';

const path = require('path');
const { mergeBudget } = require('./adaptive-explorer');
const { ProtocolRunner } = require('./protocol-runner');

/**
 * Build the "what would be done" execution plan for --dry-run without opening
 * a browser (roadmap item 4.3). Pure and unit-testable.
 *
 * @param {import('./types/usereye-config').UserEyeConfig} config Resolved configuration.
 * @param {{startCommand?: string|null, stack?: string|null}} [analysis] Project analysis.
 * @param {Array<{protocols?: unknown[]}>} [plugins] Loaded plugins.
 */
function buildExecutionPlan(config, analysis = {}, plugins = []) {
  const budgetKeys = [
    'maxStates',
    'maxActions',
    'maxDepth',
    'actionsPerState',
    'coverageTarget',
    'screenshots',
    'axeStates',
    'misclickTargets',
  ];
  const override = Object.fromEntries(
    budgetKeys
      .filter(key => config[key] !== undefined && config[key] !== null)
      .map(key => [key, Number(config[key])]),
  );
  const budget = mergeBudget(config.mode, override);
  const runner = new ProtocolRunner(
    {},
    {
      baseURL: config.baseURL || config.url || null,
      mode: config.mode,
      workers: config.workers || undefined,
      protocols: config.protocols,
      timeoutMs: config.protocolTimeoutMs,
      allowWrite: config.allowWrite,
      allowDownloads: config.allowDownloads,
      projectDir: config.projectDir,
      patternPack: config.patternPack,
      patterns: config.patterns,
      plugins,
    },
  );
  const selected = runner.selectedProtocols();
  const hasCredentials = Boolean(config.credentials && Object.keys(config.credentials).length);
  const reportFormat = Array.isArray(config.reportFormat)
    ? config.reportFormat
    : String(config.reportFormat || '')
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);
  return {
    schemaVersion: 1,
    dryRun: true,
    generatedAt: new Date().toISOString(),
    target: {
      url: config.baseURL || config.url || null,
      projectDir: config.projectDir,
      startCommand: analysis.startCommand || null,
      stack: analysis.stack || null,
      commandIgnoredBecauseUrlGiven: Boolean(config.command && (config.baseURL || config.url)),
    },
    browser: config.browser || 'chromium',
    mode: config.mode,
    budget: {
      maxStates: budget.maxStates,
      maxActions: budget.maxActions,
      maxDepth: budget.maxDepth,
      actionsPerState: budget.actionsPerState,
      coverageTarget: budget.coverageTarget,
      screenshots: budget.screenshots,
      axeStates: budget.axeStates,
      misclickTargets: budget.misclickTargets,
      viewports: (budget.viewports || []).map(item => `${item.name} ${item.width}x${item.height}`),
    },
    seedPaths: config.seedPaths || [],
    protocols: {
      selection: config.protocols,
      selected: selected.length,
      ids: selected.map(item => ({ id: item.id, category: item.category, serial: Boolean(item.serial) })),
    },
    safety: {
      allowWrite: Boolean(config.allowWrite),
      allowDestructive: Boolean(config.allowDestructive),
      allowDownloads: Boolean(config.allowDownloads),
      blockPaths: (config.blockPaths || []).map(String),
      blockNamePatterns: (config.blockNamePatterns || []).map(String),
      authentication: config.storageState
        ? 'storageState'
        : hasCredentials
          ? config.auth?.strategy || 'form'
          : 'none detected',
      recordVideo: Boolean(config.recordVideo),
      axe: Boolean(config.axe),
      codeQuality: Boolean(config.codeQuality),
    },
    gates: config.gates,
    resilience: {
      retries: config.retries,
      retryBackoffMs: config.retryBackoffMs,
      navigationTimeoutMs: config.navigationTimeoutMs,
      dialogTimeoutMs: config.dialogTimeoutMs,
      minActionDelayMs: config.minActionDelayMs,
    },
    outputs: [
      'result.json',
      'adaptive-result.json',
      'protocol-results.json',
      'recommendations.md',
      'resolved-config.json',
      'project-analysis.json',
      'screenshots/ and observations/',
      ...reportFormat.map(format => `report (${format})`),
    ],
  };
}

/** Print a human-readable dry-run summary. */
function printExecutionPlan(plan, artifactDir) {
  const safety = plan.safety;
  const budget = plan.budget;
  const gates = plan.gates || {};
  console.log('=== UserEye dry run — no browser will be launched ===');
  console.log(
    `Target: ${plan.target.url || '(start command)'}${plan.target.startCommand ? ` ${plan.target.startCommand}` : ''}` +
      (plan.target.commandIgnoredBecauseUrlGiven ? ' · --command ignored because a URL was given' : ''),
  );
  console.log(
    `Engine: ${plan.browser} · mode ${plan.mode} · retries ${plan.resilience.retries} · nav timeout ${plan.resilience.navigationTimeoutMs}ms · min delay ${plan.resilience.minActionDelayMs}ms`,
  );
  if (plan.seedPaths.length) {
    console.log(`Seeds: ${plan.seedPaths.join(', ')}`);
  }
  console.log(
    `Protocols: ${plan.protocols.selected} selected via "${plan.protocols.selection}" -> ${
      plan.protocols.ids.map(item => item.id).join(', ') || '(none)'
    }`,
  );
  console.log(
    `Budget: maxStates ${budget.maxStates} · maxActions ${budget.maxActions} · maxDepth ${budget.maxDepth} · viewports ${budget.viewports.join(', ') || 'default'}`,
  );
  console.log(
    `Safety: writes ${safety.allowWrite ? 'ALLOWED' : 'no'} · destructive ${safety.allowDestructive ? 'ALLOWED' : 'no'} · downloads ${safety.allowDownloads ? 'ALLOWED' : 'no'} · blocks ${safety.blockPaths.length} path(s) + ${safety.blockNamePatterns.length} name pattern(s) · auth: ${safety.authentication}`,
  );
  console.log(
    `Gates: score >= ${gates.minAdaptiveScore} · blocker <= ${gates.maxBlocker} · critical <= ${gates.maxCritical} · unexpected browser errors <= ${gates.maxUnexpectedBrowserErrors}`,
  );
  console.log(`Plan written to: ${path.join(artifactDir, 'plan.json')}`);
}

module.exports = { buildExecutionPlan, printExecutionPlan };
