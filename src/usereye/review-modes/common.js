'use strict';

const fs = require('fs');
const path = require('path');
const { chromium, firefox, webkit } = require('playwright');
const { ProjectAdapter } = require('../project-adapter');
const { CommandAudit } = require('../command-runner');
const { rotateArtifactDir, writeResultJson } = require('../artifact-store');
const { writeResolvedConfig } = require('../config');
const { writeReports } = require('../report');

function launcher(name) {
  return { chromium, firefox, webkit }[name || 'chromium'] || chromium;
}

async function prepareTarget(config, runtime = {}) {
  const artifactDir = config.outDir;
  if (!config.keepArtifacts && !runtime.matrixChild) rotateArtifactDir(artifactDir, config.keepLast);
  else if (!config.keepArtifacts) fs.rmSync(artifactDir, { recursive: true, force: true });
  fs.mkdirSync(artifactDir, { recursive: true });
  writeResolvedConfig(config, artifactDir);
  const audit = new CommandAudit();
  const adapter = new ProjectAdapter({
    projectDir: config.projectDir,
    appDir: config.appDir,
    command: config.command,
    url: config.baseURL || config.url,
    install: config.install,
    env: config.env,
    codeExecution: config.codeExecution,
    audit,
  });
  const analysis = config.urlOnlyTarget
    ? {
        projectName: config.appName || safeHost(config.baseURL || config.url),
        stack: 'web',
        urlOnly: true,
        warnings: [],
      }
    : adapter.analyze();
  if (config.urlOnlyTarget) adapter.analysis = analysis;
  const baseURL = await adapter.start({ timeoutMs: config.startupTimeoutMs });
  return { artifactDir, adapter, audit, analysis, baseURL };
}

function safeHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return 'Web application';
  }
}

async function writeStandardArtifacts(result, artifactDir, config, extraNames = []) {
  fs.writeFileSync(path.join(artifactDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  const reports = writeReports(result, artifactDir, {
    locale: config.reportLocale,
    formats: config.reportFormat,
    sarif: config.sarif,
    report: config.report,
  });
  for (const name of extraNames) {
    if (reports.htmlPath) fs.copyFileSync(reports.htmlPath, path.join(artifactDir, `${name}.html`));
    if (reports.mdPath) fs.copyFileSync(reports.mdPath, path.join(artifactDir, `${name}.md`));
  }
  writeResultJson(result, artifactDir);
  return reports;
}

function absoluteUrl(baseURL, target) {
  return new URL(target || '/', baseURL).href;
}

module.exports = { launcher, prepareTarget, writeStandardArtifacts, absoluteUrl, safeHost };
