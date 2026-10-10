'use strict';

const path = require('path');
const { pathToFileURL } = require('url');

/**
 * 7.5.1 (roadmap 7.5.0 item 5.2): the plugin hook contract. Every hook is
 * optional; a hook that throws, hangs or returns a rejected promise must never
 * break the run — it is recorded and reported via `result.json#pluginDiagnostics`.
 */
const HOOKS = Object.freeze(['beforeRun', 'afterObservation', 'afterState', 'afterRun']);

/** Default time budget per hook (a hung plugin cannot hang the run). */
const HOOK_TIMEOUT_MS = 30_000;

async function loadPlugin(reference, baseDir) {
  if (reference && typeof reference === 'object') {
    // Artifacts are keyed plugin-<id>-*, so inline objects need an id too.
    reference.id ||= 'inline-plugin';
    return reference;
  }
  const id = String(reference);
  const resolved =
    id.startsWith('.') || id.startsWith('/')
      ? path.resolve(baseDir, id)
      : require.resolve(id, { paths: [baseDir] });
  let plugin;
  try {
    plugin = require(resolved);
  } catch (error) {
    if (error.code !== 'ERR_REQUIRE_ESM') throw error;
    plugin = await import(pathToFileURL(resolved).href);
  }
  plugin = plugin.default || plugin;
  if (typeof plugin === 'function') plugin = await plugin();
  if (!plugin || typeof plugin !== 'object') throw new Error(`Invalid UserEye plugin: ${id}`);
  plugin.id ||= path.basename(id, path.extname(id));
  return plugin;
}

async function loadPlugins(references = [], baseDir = process.cwd()) {
  return Promise.all(references.map(reference => loadPlugin(reference, baseDir)));
}

/**
 * Validate the *runtime contract* of a loaded plugin. Load-time shape errors
 * (not an object, no id) already fail loud in `loadPlugin`; this flags things
 * the engine would otherwise ignore silently, e.g. a misspelled hook name.
 * @returns {string[]} Human-readable problems (empty when the plugin is clean).
 */
function validatePluginHooks(plugin) {
  const problems = [];
  if (!plugin || typeof plugin !== 'object') return ['not an object'];
  for (const key of Object.keys(plugin)) {
    if (HOOKS.includes(key)) {
      if (typeof plugin[key] !== 'function') problems.push(`hook "${key}" must be a function`);
    } else if (key !== 'id' && key !== 'protocols' && !key.startsWith('__')) {
      problems.push(`unknown plugin member "${key}" (known hooks: ${HOOKS.join(', ')})`);
    }
  }
  return problems;
}

/** Keep per-plugin runtime diagnostics on the plugin object (non-enumerable). */
function runtimeState(plugin) {
  if (!plugin.__usereyeRuntime) {
    Object.defineProperty(plugin, '__usereyeRuntime', {
      value: { errors: [] },
      enumerable: false,
      configurable: true,
    });
  }
  return plugin.__usereyeRuntime;
}

/**
 * Run one hook of one plugin with isolation and a time budget.
 *
 * @param {object} plugin
 * @param {string} hook One of HOOKS.
 * @param {object|any[]} args Object payload (or array passed as positional args).
 * @param {{timeoutMs?: number}} [options]
 * @returns {Promise<{ok:boolean, skipped:boolean, durationMs:number, error?:string}>}
 *   `skipped: true` when the plugin does not implement the hook.
 */
async function runPluginHook(plugin, hook, args = {}, options = {}) {
  const fn = plugin && typeof plugin === 'object' ? plugin[hook] : null;
  if (typeof fn !== 'function') return { ok: true, skipped: true, durationMs: 0 };
  const timeoutMs =
    Number.isFinite(Number(options.timeoutMs)) && Number(options.timeoutMs) > 0
      ? Number(options.timeoutMs)
      : HOOK_TIMEOUT_MS;
  const started = Date.now();
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${hook} timed out after ${timeoutMs} ms`)), timeoutMs);
  });
  try {
    // Hooks keep the historical calling convention: afterObservation and afterRun
    // received positional (observation, context) / (result, ctx).
    await Promise.race([fn.call(plugin, ...(Array.isArray(args) ? args : [args])), timeout]);
    return { ok: true, skipped: false, durationMs: Date.now() - started };
  } catch (error) {
    const message = error && error.message ? String(error.message) : String(error);
    runtimeState(plugin).errors.push({ hook, error: message, durationMs: Date.now() - started });
    return { ok: false, skipped: false, durationMs: Date.now() - started, error: message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Diagnostics of every hook that failed at runtime, for `result.json`:
 * `[{ id, hook, error, durationMs }]` — empty when nothing went wrong.
 */
function pluginDiagnostics(plugins = []) {
  return plugins.flatMap(plugin => {
    const state = plugin && plugin.__usereyeRuntime ? plugin.__usereyeRuntime : null;
    if (!state) return [];
    return state.errors.map(entry => ({ id: plugin.id, ...entry }));
  });
}

module.exports = {
  HOOKS,
  HOOK_TIMEOUT_MS,
  loadPlugin,
  loadPlugins,
  validatePluginHooks,
  runPluginHook,
  pluginDiagnostics,
};
