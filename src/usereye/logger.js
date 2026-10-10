'use strict';

/**
 * Structured logger + phase timer (roadmap M7, Phase 6).
 *
 * UserEye used to write everything with bare `console.log`, which meant a CI
 * job could neither quieten it nor parse it. This module adds:
 *   - five levels (`error warn info debug trace`), default `info` — at `info`
 *     the human-facing output is exactly what 7.4.1 printed;
 *   - `--log-json`, which emits one JSON object per line (ndjson) instead;
 *   - a phase timer whose durations land in `result.json` under `timings`
 *     when `--timings` is set.
 *
 * It never buffers: a crashed run keeps whatever was already written.
 */

const LEVELS = ['error', 'warn', 'info', 'debug', 'trace'];

class Logger {
  /**
   * @param {{level?: string, json?: boolean, timings?: boolean, sink?: object, now?: () => number}} [options]
   */
  constructor(options = {}) {
    this.level = LEVELS.includes(options.level) ? options.level : 'info';
    this.json = options.json === true;
    this.trackTimings = options.timings === true;
    this.sink = options.sink || console;
    this.now = options.now || (() => Date.now());
    this._phases = [];
    this._open = new Map();
  }

  /** @returns {boolean} Whether `level` is loud enough to be emitted. */
  enabled(level) {
    return LEVELS.indexOf(level) <= LEVELS.indexOf(this.level);
  }

  _write(level, message, fields) {
    if (!this.enabled(level)) return;
    const target = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
    if (this.json) {
      this.sink[target](
        JSON.stringify({ ts: new Date(this.now()).toISOString(), level, message, ...(fields || {}) }),
      );
      return;
    }
    const suffix = fields && Object.keys(fields).length ? ` ${JSON.stringify(fields)}` : '';
    // At info level the prefix is omitted so existing human output is unchanged.
    const prefix = level === 'info' ? '' : `${level}: `;
    this.sink[target](`${prefix}${message}${suffix}`);
  }

  error(message, fields) {
    this._write('error', message, fields);
  }
  warn(message, fields) {
    this._write('warn', message, fields);
  }
  info(message, fields) {
    this._write('info', message, fields);
  }
  debug(message, fields) {
    this._write('debug', message, fields);
  }
  trace(message, fields) {
    this._write('trace', message, fields);
  }

  /**
   * 7.5.1 (roadmap 7.5.0 item 2.4): the engine's per-step line. At `info` with the
   * console sink this is byte-identical to what `UserEye.step()` used to write
   * straight to stdout (`[PASS] 01 Open app (375 ms)`); `--log-level error` now
   * silences it and `--log-json` carries the step as structured fields.
   * @param {{number:number,name:string,status:string,durationMs:number}} step
   */
  step(step) {
    const icon = step.status === 'passed' ? 'PASS' : step.status === 'warning' ? 'WARN' : 'FAIL';
    const line = `[${icon}] ${String(step.number).padStart(2, '0')} ${step.name} (${step.durationMs} ms)`;
    if (this.json) {
      this._write('info', line, {
        event: 'step',
        step: { number: step.number, name: step.name, status: step.status, durationMs: step.durationMs },
      });
      return;
    }
    this._write('info', line);
  }

  /** Start timing a named phase. */
  startPhase(name) {
    this._open.set(name, this.now());
    this.debug(`phase start: ${name}`);
  }

  /** Finish a named phase; no-op when it was never started. */
  endPhase(name, extra) {
    const started = this._open.get(name);
    if (started === undefined) return null;
    this._open.delete(name);
    const durationMs = this.now() - started;
    const row = { name, durationMs, ...(extra || {}) };
    this._phases.push(row);
    this.debug(`phase end: ${name}`, { durationMs });
    return row;
  }

  /** Time an async function as one phase. */
  async phase(name, fn) {
    this.startPhase(name);
    try {
      return await fn();
    } finally {
      this.endPhase(name);
    }
  }

  /** @returns {{phases: object[], totalMs: number}} Recorded phase durations. */
  timings() {
    return {
      phases: [...this._phases],
      totalMs: this._phases.reduce((sum, phase) => sum + phase.durationMs, 0),
    };
  }
}

function createLogger(options) {
  return new Logger(options);
}

module.exports = { LEVELS, Logger, createLogger };
