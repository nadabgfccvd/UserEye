'use strict';

/**
 * Roadmap 7.5.0 item 5.2 — plugin hook contract: optional hooks with a time
 * budget, error isolation (a broken plugin never breaks a run) and diagnostics
 * surfaced in `result.json#pluginDiagnostics`.
 */

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  HOOKS,
  HOOK_TIMEOUT_MS,
  runPluginHook,
  pluginDiagnostics,
  validatePluginHooks,
} = require('../plugins');

test('hooks: contract lists beforeRun, afterObservation, afterState, afterRun', () => {
  assert.deepEqual([...HOOKS].sort(), ['afterObservation', 'afterRun', 'afterState', 'beforeRun'].sort());
  assert.ok(HOOK_TIMEOUT_MS > 0);
});

test('hooks: a missing hook is skipped, a working hook reports ok', async () => {
  const plugin = { id: 'p1', afterRun: async () => {} };
  const skipped = await runPluginHook(plugin, 'beforeRun', {});
  assert.equal(skipped.skipped, true);
  assert.equal(skipped.ok, true);
  const ok = await runPluginHook(plugin, 'afterRun', [{}]);
  assert.equal(ok.skipped, false);
  assert.equal(ok.ok, true);
  assert.ok(ok.durationMs >= 0);
});

test('hooks: a throwing hook is isolated and recorded in pluginDiagnostics', async () => {
  const plugin = {
    id: 'broken',
    afterRun: async () => {
      throw new Error('boom');
    },
  };
  const outcome = await runPluginHook(plugin, 'afterRun', [{}]);
  assert.equal(outcome.ok, false);
  assert.match(outcome.error, /boom/);
  const diagnostics = pluginDiagnostics([plugin]);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].id, 'broken');
  assert.equal(diagnostics[0].hook, 'afterRun');
  assert.match(diagnostics[0].error, /boom/);
});

test('hooks: a hanging hook is cut by the time budget, not the run', async () => {
  const plugin = {
    id: 'slow',
    afterObservation: () => new Promise(() => {}), // never resolves
  };
  const started = Date.now();
  const outcome = await runPluginHook(plugin, 'afterObservation', [{}], { timeoutMs: 50 });
  assert.equal(outcome.ok, false);
  assert.match(outcome.error, /timed out after 50 ms/);
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 5_000, `hook was cut promptly (took ${elapsed} ms)`);
  assert.equal(pluginDiagnostics([plugin]).length, 1);
});

test('hooks: positional args keep the historical calling convention', async () => {
  const seen = [];
  const plugin = {
    id: 'p2',
    afterObservation: (observation, context) => {
      seen.push({ observation, context });
    },
  };
  const observation = { id: 'OBS-1' };
  const context = { eye: 'eye', explorer: 'explorer' };
  await runPluginHook(plugin, 'afterObservation', [observation, context]);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].observation.id, 'OBS-1');
  assert.equal(seen[0].context.eye, 'eye');
});

test('validatePluginHooks: flags non-functions and misspelled members, accepts the contract', () => {
  assert.deepEqual(validatePluginHooks({ id: 'ok', afterRun() {} }), []);
  assert.deepEqual(validatePluginHooks({ id: 'ok', protocols: [], beforeRun() {} }), []);
  assert.ok(
    validatePluginHooks({ id: 'bad', afterRun: 'nope' }).some(line =>
      /hook "afterRun" must be a function/.test(line),
    ),
  );
  assert.ok(
    validatePluginHooks({ id: 'bad', afterRunn() {} }).some(line => /unknown plugin member/.test(line)),
  );
  assert.ok(validatePluginHooks(null).length > 0, 'not-an-object is a validation problem');
});
