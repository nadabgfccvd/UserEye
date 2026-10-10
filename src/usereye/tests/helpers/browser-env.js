'use strict';

/**
 * Simulated browser environment for unit-testing the `collect*` functions that
 * normally run inside Chromium via page.evaluate (roadmap item 1.1).
 *
 * jsdom has no layout engine, so geometry is made explicit and deterministic:
 *   - `data-rect="x,y,w,h"` gives an element a bounding box;
 *   - `data-scroll="w,h"` / `data-client="w,h"` set scroll/client sizes;
 *   - document.elementFromPoint returns the LAST element in DOM order whose
 *     rect contains the point (painter's algorithm), which is enough to
 *     exercise occlusion logic;
 *   - colors must be written as rgb()/rgba() in inline styles, mirroring how
 *     Chromium's getComputedStyle normalizes them.
 *
 * The collectors are executed the same way Playwright would: their source text is
 * run inside the window (they are self-contained by design). Since 7.5.1 that text is
 * compiled with `vm.runInContext` against the jsdom context, using the collector's
 * REAL file URL as `filename` and padding the source so every line/column offset
 * matches the original file. V8 therefore attributes the executed ranges to
 * `browser-perception.js` & co. instead of to an anonymous eval, and the coverage
 * report tells the truth about these files (roadmap 7.5.0 item 1.1 / A2). Before,
 * they showed 0.8–2.6% while being exercised by ~60 tests.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');
const { JSDOM } = requireWithoutSourceMapCache('jsdom');

/**
 * Load a dependency without letting Node register its `//# sourceMappingURL`
 * comments in the per-process source-map cache.
 *
 * Why: under `--experimental-test-coverage` the runner exports NODE_V8_COVERAGE to
 * the worker, and the CJS loader then caches the source-map URL of every module
 * that carries one (several jsdom dependencies do). When that cache is non-empty,
 * Node's coverage reader keys the process' scripts by URL and keeps only the LAST
 * script per URL (`mapCoverageWithSourceMap`, node ≥ 20 through current main). The
 * harness compiles one script per attributed function, all under the collector's
 * real URL, so with the cache present only one function per file survived per
 * process — and its whole-file top-level range credited every line of the file.
 * The measurement was wrong in both directions. With no source-map cache, all
 * scripts of a URL are merged range by range, which is the honest result.
 *
 * The variable is restored immediately: child processes spawned later by the same
 * test file (e.g. the CLI) must keep reporting coverage.
 */
function requireWithoutSourceMapCache(id) {
  const saved = process.env.NODE_V8_COVERAGE;
  if (saved !== undefined) delete process.env.NODE_V8_COVERAGE;
  try {
    return require(id);
  } finally {
    if (saved !== undefined) process.env.NODE_V8_COVERAGE = saved;
  }
}

const PACKAGE_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Files whose functions are serialized into the page by the engine — whole exported
 * collectors (`browser-*.js`, `adaptive-browser.js`) and the inline `page.evaluate`
 * callbacks of the Node-side modules listed after them.
 */
const BROWSER_INJECTED_FILES = [
  'browser-perception.js',
  'browser-human.js',
  'browser-gaze.js',
  'browser-recorder.js',
  'browser-vitals.js',
  'adaptive-browser.js',
  'misclick-engine.js',
];

const sourceCache = new Map();
const locationCache = new WeakMap();

function readSource(relative) {
  if (!sourceCache.has(relative)) {
    sourceCache.set(relative, fs.readFileSync(path.join(PACKAGE_ROOT, relative), 'utf8'));
  }
  return sourceCache.get(relative);
}

/**
 * Locate the file and offset a browser-context function was declared at, by
 * matching its exact source text (V8 preserves it verbatim). Returns null for
 * functions defined inline in a test, which fall back to a plain eval.
 */
function locateFunction(fn) {
  if (locationCache.has(fn)) return locationCache.get(fn);
  const text = fn.toString();
  let found = null;
  for (const relative of BROWSER_INJECTED_FILES) {
    const source = readSource(relative);
    const start = source.indexOf(text);
    if (start === -1) continue;
    if (source.indexOf(text, start + 1) !== -1) break; // ambiguous — do not guess
    found = { relative, source, start, end: start + text.length, text };
    break;
  }
  locationCache.set(fn, found);
  return found;
}

const blank = chunk => chunk.replace(/[^\n]/g, ' ');

/**
 * Build a script that contains ONLY `fn`, at the exact offsets it has in its file
 * (everything else is whitespace), wrapped in parentheses so the script's completion
 * value is the function itself. The parentheses overwrite a blank character on each
 * side (never a newline, so line numbers stay exact); this works for declarations
 * and for the anonymous arrow callbacks of `page.evaluate(...)` alike.
 * `'use strict'` is preserved when the module starts with it so the collector keeps
 * the semantics it has both under `require` and inside Chromium.
 */
function attributedScript(location) {
  const { source, start, end, text } = location;
  const prefix = source.slice(0, start);
  const strict = prefix.startsWith("'use strict';") ? "'use strict';" : '';
  const before = blank(prefix.slice(strict.length)).split('');
  const after = blank(source.slice(end)).split('');
  const open = before
    .map((char, index) => (char === ' ' ? index : -1))
    .filter(index => index >= 0)
    .pop();
  const close = after.findIndex(char => char === ' ');
  if (open === undefined || open < 0 || close < 0) {
    throw new Error(`browser-env: cannot attribute ${location.relative}:${start} — no room for the wrapper`);
  }
  before[open] = '(';
  after[close] = ')';
  return `${strict}${before.join('')}${text}${after.join('')}`;
}

function compileAttributed(dom, fn) {
  const location = locateFunction(fn);
  if (!location) return null;
  const context = dom.getInternalVMContext();
  return vm.runInContext(attributedScript(location), context, {
    filename: pathToFileURL(path.join(PACKAGE_ROOT, location.relative)).href,
  });
}

function parseNumbers(attribute, fallback) {
  if (!attribute) return fallback;
  const parts = String(attribute)
    .split(',')
    .map(part => Number.parseFloat(part.trim()));
  return parts.every(Number.isFinite) ? parts : fallback;
}

function createBrowserEnv(html, options = {}) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: options.url || 'http://localhost/',
  });
  const { window } = dom;

  // --- viewport -----------------------------------------------------------
  Object.defineProperty(window, 'innerWidth', {
    value: options.width ?? 1440,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(window, 'innerHeight', {
    value: options.height ?? 900,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(window, 'devicePixelRatio', {
    value: options.devicePixelRatio ?? 1,
    writable: true,
    configurable: true,
  });

  // --- innerText (jsdom lacks it; Chromium semantics approximated) ---------
  if (!Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'innerText')) {
    Object.defineProperty(window.HTMLElement.prototype, 'innerText', {
      configurable: true,
      get() {
        return this.textContent;
      },
      set(value) {
        this.textContent = value;
      },
    });
  }

  // --- geometry ------------------------------------------------------------
  window.Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    const [x, y, width, height] = parseNumbers(this.getAttribute?.('data-rect'), [0, 0, 0, 0]);
    return {
      x,
      y,
      width,
      height,
      top: y,
      left: x,
      right: x + width,
      bottom: y + height,
      toJSON() {
        return { x, y, width, height };
      },
    };
  };

  // Scroll/client sizes: `data-scrollwidth`, `data-scrollheight`,
  // `data-clientwidth`, `data-clientheight` override; otherwise fall back to
  // the data-rect dimensions. On <html> the fallback is the viewport, so
  // horizontal overflow stays 0 unless explicitly stubbed.
  const sizeProperty = (name, attribute, axis) => {
    Object.defineProperty(window.Element.prototype, name, {
      configurable: true,
      get() {
        const attr = this.getAttribute?.(attribute);
        if (attr !== null && attr !== undefined) {
          return Number.parseFloat(attr) || 0;
        }
        const rect = this.getBoundingClientRect();
        const fromRect = axis === 0 ? rect.width : rect.height;
        if (this === window.document.documentElement) {
          return fromRect || (axis === 0 ? window.innerWidth : window.innerHeight);
        }
        return fromRect;
      },
    });
  };
  sizeProperty('scrollWidth', 'data-scrollwidth', 0);
  sizeProperty('scrollHeight', 'data-scrollheight', 1);
  sizeProperty('clientWidth', 'data-clientwidth', 0);
  sizeProperty('clientHeight', 'data-clientheight', 1);

  // --- hit testing (painter's algorithm over data-rect elements) -----------
  window.document.elementFromPoint = function elementFromPoint(x, y) {
    const candidates = [...window.document.querySelectorAll('*')].filter(element => {
      if (element.getAttribute('data-nohit') !== null) return false;
      const rect = element.getBoundingClientRect();
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        x >= rect.left &&
        x <= rect.right &&
        y >= rect.top &&
        y <= rect.bottom
      );
    });
    return candidates.length ? candidates[candidates.length - 1] : null;
  };

  // --- CSS.escape ----------------------------------------------------------
  if (!window.CSS || typeof window.CSS.escape !== 'function') {
    window.CSS = window.CSS || {};
    window.CSS.escape = function escape(value) {
      return String(value).replace(/[^a-zA-Z0-9_-]/g, character => `\\${character}`);
    };
  }

  // --- readyState override -------------------------------------------------
  if (options.readyState) {
    Object.defineProperty(window.document, 'readyState', {
      configurable: true,
      get: () => options.readyState,
    });
  }

  /**
   * Execute a self-contained browser-context function (the `collect*` family)
   * inside the window, exactly like page.evaluate would. The argument crosses the
   * boundary as JSON, as it does with Playwright, so a collector cannot accidentally
   * depend on a live Node object. Functions that live in one of the browser-injected
   * modules are compiled against their real file (see header); anything else — e.g. a
   * helper declared inline in a test — is eval'd as before.
   */
  function evaluate(fn, arg) {
    const payload = JSON.parse(JSON.stringify(arg ?? null));
    const attributed = compileAttributed(dom, fn);
    const result = attributed
      ? attributed(payload)
      : window.eval(`(${fn.toString()})(${JSON.stringify(payload)})`);
    // Playwright hands the result back as structured data; mirror that so the value
    // the tests see is realm-neutral (no jsdom prototypes leaking into strict deepEqual).
    return result === undefined ? undefined : JSON.parse(JSON.stringify(result));
  }

  /** Install a self-contained init-script style function (no args). */
  function evaluateInit(fn) {
    const attributed = compileAttributed(dom, fn);
    if (attributed) return attributed();
    return window.eval(`(${fn.toString()})()`);
  }

  /**
   * Compile a browser-context function against this window and hand it back as a
   * callable, for callbacks that take more than one argument (e.g. Playwright's
   * `locator.evaluate((element, arg) => …)`). Attributed when possible, eval otherwise.
   */
  function compile(fn) {
    return compileAttributed(dom, fn) || window.eval(`(${fn.toString()})`);
  }

  return { dom, window, document: window.document, evaluate, evaluateInit, compile };
}

module.exports = { createBrowserEnv, BROWSER_INJECTED_FILES, locateFunction, attributedScript };
