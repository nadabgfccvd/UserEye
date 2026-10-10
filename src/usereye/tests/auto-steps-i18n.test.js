'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { runAuto } = require('../usereye-auto');
const { catalog, section, t, format } = require('../i18n');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function browserReady() {
  if (process.env.USEREYE_SKIP_BROWSER_TESTS === '1') return false;
  try {
    const { chromium } = require('playwright');
    return fs.existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

const skipBrowser = { skip: !browserReady() && 'Chromium not installed (npx playwright install chromium)' };

// ---------------------------------------------------------------------------
// Roadmap 7.5.0 item 3.3: the auto-flow step names and run-gate labels used to
// be hard-coded English ("Open target application", "Initial state observed")
// even under --report-locale pt. They must come from the catalogs now.
// ---------------------------------------------------------------------------

test('stepNames/gateLabels: every pack carries the same keys and the {mode}/{target} templates', () => {
  const enSteps = Object.keys(catalog('en').stepNames).sort();
  const enGates = Object.keys(catalog('en').gateLabels).sort();
  assert.deepEqual(Object.keys(catalog('en').stepNames).sort(), [
    'adaptiveExploration',
    'codeQualityFloor',
    'concurrentProtocols',
    'openTarget',
  ]);
  for (const pack of ['pt', 'es', 'fr']) {
    assert.deepEqual(Object.keys(catalog(pack).stepNames).sort(), enSteps, `${pack} stepNames parity`);
    assert.deepEqual(Object.keys(catalog(pack).gateLabels).sort(), enGates, `${pack} gateLabels parity`);
  }
  // The template placeholder is what the engine interpolates.
  assert.match(catalog('en').stepNames.adaptiveExploration, /{mode}/);
  assert.match(catalog('en').gateLabels.budgetCoverage, /{target}/);
  const pt = format(t(section('pt', 'stepNames'), 'adaptiveExploration'), { mode: 'quick' });
  assert.equal(pt, 'Exploração adaptativa — quick');
});

test('auto with --report-locale pt produces pt step names and gate labels', skipBrowser, async () => {
  const out = tmpDir('usereye-steps-pt-');
  const output = await runAuto([
    '--project',
    path.join(__dirname, 'fixtures', 'static'),
    '--mode',
    'quick',
    '--out',
    out,
    '--no-video',
    '--report-locale',
    'pt',
  ]);
  assert.equal(output.exitCode, 0);
  const stepNames = (output.result.steps || []).map(step => step.name);
  assert.ok(stepNames.includes('Abrir aplicação-alvo'), `steps: ${JSON.stringify(stepNames)}`);
  assert.ok(
    !stepNames.some(name => /Open target application|Adaptive exploration|Concurrent protocols/.test(name)),
  );
  const gateLabels = (output.result.adaptive?.quality?.gates || []).map(gate => gate.label);
  assert.ok(gateLabels.includes('Estado inicial observado'), `gate labels: ${JSON.stringify(gateLabels)}`);
  assert.ok(!gateLabels.some(label => /Initial state observed|Browser telemetry active/.test(label)));
});
