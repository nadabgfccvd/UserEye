'use strict';

const fs = require('fs');
const path = require('path');
const { launcher, prepareTarget, writeStandardArtifacts, absoluteUrl } = require('./common');
const { blankResult, issue, finalizeResult } = require('./result-schema');

function slug(value) {
  return (
    String(value || 'flow')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'flow'
  );
}

function loadFlows(files) {
  if (!files.length) throw new Error('review-mode flows requires --flows <file> or flows.files in config.');
  const flows = [];
  for (const file of files) {
    if (!fs.existsSync(file)) throw new Error(`Flow file not found: ${file}`);
    delete require.cache[require.resolve(file)];
    const exported = require(file);
    const list = Array.isArray(exported) ? exported : exported?.default || exported?.flows || [];
    for (const flow of list) {
      if (!flow || typeof flow.name !== 'string' || typeof flow.run !== 'function') {
        throw new Error(`Invalid flow in ${file}: expected { name, run }.`);
      }
      flows.push({ ...flow, file });
    }
  }
  return flows;
}

function target(page, descriptor) {
  if (typeof descriptor !== 'object' || descriptor === null)
    return page.getByText(String(descriptor), { exact: false });
  if (descriptor.role)
    return page.getByRole(descriptor.role, { name: descriptor.name, exact: descriptor.exact });
  if (descriptor.label) return page.getByLabel(descriptor.label, { exact: descriptor.exact });
  if (descriptor.placeholder)
    return page.getByPlaceholder(descriptor.placeholder, { exact: descriptor.exact });
  if (descriptor.text) return page.getByText(descriptor.text, { exact: descriptor.exact });
  if (descriptor.testId) return page.getByTestId(descriptor.testId);
  if (descriptor.css) return page.locator(descriptor.css);
  return page.getByText(String(descriptor));
}

function timeoutOf(options, fallback) {
  const value = Number(options?.timeout);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function textMatches(actual, expected, contains = false) {
  if (expected instanceof RegExp) {
    expected.lastIndex = 0;
    return expected.test(actual);
  }
  return contains ? actual.includes(String(expected)) : actual === String(expected);
}

async function pause(page, ms = 50) {
  if (page && typeof page.waitForTimeout === 'function') return page.waitForTimeout(ms);
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitLocatorText(page, locator, expected, options = {}, defaultTimeout = 30000) {
  const timeout = timeoutOf(options, defaultTimeout);
  const contains = options.contains === true;
  const deadline = Date.now() + timeout;
  let actual = '';
  let lastError;
  do {
    try {
      actual = String((await locator.first().textContent()) ?? '').trim();
      if (textMatches(actual, expected, contains)) return actual;
    } catch (error) {
      lastError = error;
    }
    if (Date.now() >= deadline) break;
    await pause(page, Math.min(50, Math.max(1, deadline - Date.now())));
  } while (Date.now() <= deadline);
  const relation = contains ? 'to contain' : 'to equal';
  throw new Error(
    `Expected text ${relation} ${JSON.stringify(String(expected))}, received ${JSON.stringify(actual)}${
      lastError ? ` (${lastError.message})` : ''
    }`,
  );
}

async function waitLocatorCount(page, locator, expected, options = {}, defaultTimeout = 30000) {
  const wanted = Number(expected);
  if (!Number.isInteger(wanted) || wanted < 0)
    throw new Error(`Expected count must be a non-negative integer.`);
  const timeout = timeoutOf(options, defaultTimeout);
  const deadline = Date.now() + timeout;
  let actual = 0;
  do {
    actual = await locator.count();
    if (actual === wanted) return actual;
    if (Date.now() >= deadline) break;
    await pause(page, Math.min(50, Math.max(1, deadline - Date.now())));
  } while (Date.now() <= deadline);
  throw new Error(`Expected count ${wanted}, received ${actual}`);
}

/**
 * Tiny assertion surface for dependency-free flow files. Existing
 * `expect(locator).toHaveText(...)` calls keep working; the page-scoped additions
 * make the most frequent assertions explicit:
 *   await expect(page).text('#clock', '25:00')
 *   await expect(page).count('.task', 3)
 */
function makeExpect(page, defaultTimeout = 30000) {
  const expect = actual => {
    const scopedPage = actual && typeof actual.locator === 'function' ? actual : page;
    return {
      async text(descriptor, expected, options) {
        if (!scopedPage) throw new Error('expect(page).text requires a Playwright page.');
        return waitLocatorText(scopedPage, target(scopedPage, descriptor), expected, options, defaultTimeout);
      },
      async count(descriptor, expected, options) {
        if (!scopedPage) throw new Error('expect(page).count requires a Playwright page.');
        return waitLocatorCount(
          scopedPage,
          target(scopedPage, descriptor),
          expected,
          options,
          defaultTimeout,
        );
      },
      async toBeVisible(options) {
        if (!actual || typeof actual.waitFor !== 'function')
          throw new Error('toBeVisible requires a Playwright locator.');
        await actual.first().waitFor({ state: 'visible', ...(options || {}) });
      },
      async toContainText(text, options) {
        return waitLocatorText(page, actual, text, { ...(options || {}), contains: true }, defaultTimeout);
      },
      async toHaveText(text, options) {
        return waitLocatorText(page, actual, text, options, defaultTimeout);
      },
      toBe(expected) {
        if (actual !== expected) throw new Error(`Expected ${actual} to be ${expected}`);
      },
      toEqual(expected) {
        if (JSON.stringify(actual) !== JSON.stringify(expected))
          throw new Error(`Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`);
      },
      toBeTruthy() {
        if (!actual) throw new Error(`Expected ${actual} to be truthy`);
      },
    };
  };
  // Direct aliases are convenient when the closure already belongs to one page.
  expect.text = (descriptor, expected, options) =>
    waitLocatorText(page, target(page, descriptor), expected, options, defaultTimeout);
  expect.count = (descriptor, expected, options) =>
    waitLocatorCount(page, target(page, descriptor), expected, options, defaultTimeout);
  return expect;
}

function makeEye(page, flowResult, result, artifactDir, config, flowSlug) {
  return {
    async step(name, fn) {
      const step = { name, status: 'passed', durationMs: 0, screenshot: null };
      const globalStep = {
        number: result.steps.length + 1,
        name: `${flowResult.name}: ${name}`,
        status: 'passed',
        durationMs: 0,
      };
      const t0 = Date.now();
      try {
        await fn();
      } catch (error) {
        step.status = 'failed';
        globalStep.status = 'failed';
        const shot = `screenshots/${flowSlug}-${slug(name)}.png`;
        fs.mkdirSync(path.join(artifactDir, 'screenshots'), { recursive: true });
        await page.screenshot({ path: path.join(artifactDir, shot), fullPage: true }).catch(() => {});
        step.screenshot = shot;
        globalStep.screenshot = shot;
        throw error;
      } finally {
        step.durationMs = Date.now() - t0;
        globalStep.durationMs = step.durationMs;
        flowResult.steps.push(step);
        result.steps.push(globalStep);
      }
    },
    async goto(url, options) {
      await page.goto(absoluteUrl(config.baseURL || page.url(), url), options);
    },
    /**
     * Correctly forwards timeout/polling as Playwright's third argument. Calling
     * page.waitForFunction(fn, { timeout }) directly passes that object as ARG;
     * this wrapper prevents the silent 30-second-timeout trap.
     */
    async waitFor(fn, options = {}) {
      const { arg, timeout, polling } = options || {};
      const waitOptions = {
        timeout: timeoutOf({ timeout }, config.flows.timeoutMs),
      };
      if (polling !== undefined) waitOptions.polling = polling;
      return page.waitForFunction(fn, arg, waitOptions);
    },
    async waitText(descriptor, expected, options = {}) {
      return waitLocatorText(page, target(page, descriptor), expected, options, config.flows.timeoutMs);
    },
    async click(descriptor, options) {
      await target(page, descriptor).click(options);
    },
    async fill(descriptor, value, options) {
      await target(page, descriptor).fill(value, options);
    },
    async see(descriptor, message, options) {
      const timeout = options?.timeout || config.flows.timeoutMs;
      const selectorish =
        typeof descriptor === 'string' &&
        (/^[#.\[]/.test(descriptor) || /^[a-z][a-z0-9-]*$/i.test(descriptor));
      if (selectorish) {
        try {
          await page
            .locator(descriptor)
            .first()
            .waitFor({ state: 'visible', timeout: Math.min(timeout, 1500) });
          return message;
        } catch {}
      }
      try {
        await target(page, descriptor).first().waitFor({ state: 'visible', timeout });
      } catch (error) {
        if (typeof descriptor !== 'string' || selectorish) throw error;
        await page.locator(descriptor).first().waitFor({ state: 'visible', timeout });
      }
      return message;
    },
    async upload(descriptor, file, options) {
      await target(page, descriptor).setInputFiles(file, options);
    },
    locator(descriptor) {
      return target(page, descriptor);
    },
  };
}

async function runFlowOnce({ flow, browserName, browser, baseURL, result, artifactDir, config, attempt }) {
  const flowSlug = slug(`${flow.name}-${browserName}`);
  const contextOptions = { ignoreHTTPSErrors: config.ignoreHTTPSErrors, viewport: config.viewport };
  if (config.flows.video) {
    contextOptions.recordVideo = { dir: path.join(artifactDir, 'videos') };
  }
  const context = await browser.newContext(contextOptions);
  if (config.flows.trace !== 'never')
    await context.tracing.start({ screenshots: true, snapshots: true }).catch(() => {});
  const page = await context.newPage();
  page.setDefaultTimeout(config.flows.timeoutMs);
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  const flowResult = {
    name: flow.name,
    tags: flow.tags || [],
    status: 'passed',
    durationMs: 0,
    browser: browserName,
    attempt,
    steps: [],
    artifacts: { trace: null, video: null, screenshots: [] },
  };
  const t0 = Date.now();
  try {
    await page
      .goto(baseURL, { waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs })
      .catch(() => {});
    const eye = makeEye(page, flowResult, result, artifactDir, config, flowSlug);
    await flow.run({
      eye,
      page,
      context,
      browser,
      expect: makeExpect(page, config.flows.timeoutMs),
      baseURL,
    });
    if (config.flows.failOnConsoleError && consoleErrors.length)
      throw new Error(`Console errors during flow: ${consoleErrors.join('\n')}`);
  } catch (error) {
    flowResult.status = 'failed';
    flowResult.error = error.message;
    flowResult.stack = error.stack;
    const shot = `screenshots/${flowSlug}-failure.png`;
    fs.mkdirSync(path.join(artifactDir, 'screenshots'), { recursive: true });
    await page.screenshot({ path: path.join(artifactDir, shot), fullPage: true }).catch(() => {});
    flowResult.artifacts.screenshots.push(shot);
    result.issues.push(
      issue({
        id: `flow:${slug(flow.name)}:${browserName}`,
        severity: 'critical',
        title: `Critical flow failed: ${flow.name}`,
        expected: 'Manual critical flow completes all steps.',
        actual: error.message,
        technical: error.stack,
        evidence: shot,
        source: 'flows',
      }),
    );
  } finally {
    flowResult.durationMs = Date.now() - t0;
    if (config.flows.trace !== 'never') {
      const trace = `traces/${flowSlug}-attempt-${attempt}.zip`;
      fs.mkdirSync(path.join(artifactDir, 'traces'), { recursive: true });
      const keep = config.flows.trace === 'always' || flowResult.status === 'failed';
      if (keep) {
        await context.tracing.stop({ path: path.join(artifactDir, trace) }).catch(() => {});
        flowResult.artifacts.trace = trace;
      } else {
        await context.tracing.stop().catch(() => {});
      }
    }
    const video = page.video
      ? await page
          .video()
          .path()
          .catch(() => null)
      : null;
    await context.close().catch(() => {});
    if (video && (config.flows.video === true || flowResult.status === 'failed')) {
      const rel = `videos/${flowSlug}-attempt-${attempt}.webm`;
      fs.mkdirSync(path.join(artifactDir, 'videos'), { recursive: true });
      fs.renameSync(video, path.join(artifactDir, rel));
      flowResult.artifacts.video = rel;
    } else if (video) fs.rmSync(video, { force: true });
  }
  return flowResult;
}

async function runFlows(config, runtime = {}) {
  const startedAt = new Date().toISOString();
  const prepared = await prepareTarget(config, runtime);
  const { artifactDir, adapter, baseURL, analysis } = prepared;
  const result = blankResult({
    mode: 'flows',
    baseURL,
    appName: config.appName || analysis.projectName,
    artifactDir,
    browser: config.flows.projects.join(','),
    startedAt,
  });
  result.reportLocale = config.reportLocale;
  result.reportFormat = config.reportFormat;
  result.scopeDescription =
    'Critical manual flows runner: project-declared JavaScript flows executed with Playwright-style helpers.';
  const flows = loadFlows(config.flows.files);
  result.flows = [];
  try {
    for (const browserName of config.flows.projects) {
      const browser = await launcher(browserName).launch({ headless: !config.headed });
      try {
        for (const flow of flows) {
          let flowResult;
          for (let attempt = 1; attempt <= config.flows.retries + 1; attempt += 1) {
            flowResult = await runFlowOnce({
              flow,
              browserName,
              browser,
              baseURL,
              result,
              artifactDir,
              config,
              attempt,
            });
            if (flowResult.status === 'passed') break;
          }
          result.flows.push(flowResult);
        }
      } finally {
        await browser.close().catch(() => {});
      }
    }
  } finally {
    await adapter.stop().catch(() => {});
  }
  result.qualityGates.checks = [
    {
      id: 'flows-all-pass',
      passed: result.flows.every(flow => flow.status === 'passed'),
      actual: result.flows.filter(flow => flow.status === 'failed').length,
      expected: '0 failed flows',
    },
  ];
  result.summary.checks = result.flows.length;
  fs.writeFileSync(path.join(artifactDir, 'flows.json'), `${JSON.stringify(result.flows, null, 2)}\n`);
  result.artifacts.flows = 'flows.json';
  finalizeResult(result);
  const reports = await writeStandardArtifacts(result, artifactDir, config, ['flows']);
  return { exitCode: result.review.passed ? 0 : 1, artifactDir, result, reports };
}

module.exports = {
  runFlows,
  // Exported for focused unit tests and advanced embedders; the CLI contract is
  // still the flow scope passed to `run`.
  makeExpect,
  makeEye,
  target,
  waitLocatorText,
  waitLocatorCount,
};
