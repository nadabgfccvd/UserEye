'use strict';

const fs = require('fs');
const path = require('path');
const { ParallelScheduler } = require('./parallel-scheduler');
const { CommandAudit, formatCommand, runCommand } = require('./command-runner');

const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'coverage',
  'artifacts',
  '__pycache__',
  '.venv',
  'vendor',
  'usereye-tool',
  'usereye-tool',
]);
const SOURCE_EXTENSIONS = new Set([
  '.js',
  '.cjs',
  '.mjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.rb',
  '.php',
  '.vue',
  '.svelte',
  '.css',
  '.scss',
  '.html',
]);

function walkSourceFiles(root, maxFiles = 5000) {
  const files = [];
  const walk = directory => {
    if (files.length >= maxFiles) {
      return;
    }
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= maxFiles) {
        break;
      }
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name) && !entry.name.startsWith('.')) {
          walk(path.join(directory, entry.name));
        }
        continue;
      }
      const filePath = path.join(directory, entry.name);
      if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(filePath);
      }
    }
  };
  walk(root);
  return files;
}

function isTestPath(relativePath) {
  const normalized = relativePath.replace(/\\/g, '/');
  const segments = normalized.split('/');
  const filename = segments.pop() || '';
  const inTestDirectory = segments.some(segment =>
    ['test', 'tests', '__tests__', 'spec', 'specs'].includes(segment),
  );
  const testFilename =
    /(?:^|[._-])(test|spec)(?:[._-]|$)/i.test(filename) || /(?:^|[._-])e2e(?:[._-]|$)/i.test(filename);
  return inTestDirectory || testFilename;
}

function extractCommentText(source) {
  let state = 'code';
  let escaped = false;
  let output = '';
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    const next = source[index + 1];
    if (state === 'line-comment') {
      output += character;
      if (character === '\n') {
        state = 'code';
      }
      continue;
    }
    if (state === 'block-comment') {
      output += character;
      if (character === '*' && next === '/') {
        output += next;
        index += 1;
        state = 'code';
      }
      continue;
    }
    if (['single-quote', 'double-quote', 'template'].includes(state)) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === '\\') {
        escaped = true;
        continue;
      }
      const closes =
        (state === 'single-quote' && character === "'") ||
        (state === 'double-quote' && character === '"') ||
        (state === 'template' && character === '`');
      if (closes) {
        state = 'code';
      }
      continue;
    }
    if (character === "'") {
      state = 'single-quote';
    } else if (character === '"') {
      state = 'double-quote';
    } else if (character === '`') {
      state = 'template';
    } else if (character === '/' && next === '/') {
      state = 'line-comment';
      output += '//';
      index += 1;
    } else if (character === '/' && next === '*') {
      state = 'block-comment';
      output += '/*';
      index += 1;
    } else if (
      character === '#' &&
      /^\s*$/.test(source.slice(source.lastIndexOf('\n', index - 1) + 1, index))
    ) {
      state = 'line-comment';
      output += '#';
    }
  }
  return output;
}

function inspectFile(filePath, root) {
  let source;
  try {
    source = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  const lines = source.split(/\r?\n/);
  const commentText = extractCommentText(source);
  const commentLines = commentText.split(/\r?\n/).filter(line => line.trim());
  const todoCount = (commentText.match(/\b(?:TODO|FIXME|HACK|XXX)\b/gi) || []).length;
  const relativePath = path.relative(root, filePath).replace(/\\/g, '/');
  return {
    path: relativePath,
    kind: isTestPath(relativePath) ? 'test' : 'source',
    generated: /(?:Code generated|Generated from).*?(?:DO NOT EDIT|Do not edit)/i.test(source.slice(0, 300)),
    extension: path.extname(filePath).toLowerCase(),
    lines: lines.length,
    bytes: Buffer.byteLength(source),
    longLines: lines.filter(line => line.length > 140).length,
    trailingWhitespace: lines.filter(line => /\s+$/.test(line) && line.length).length,
    todos: todoCount,
    comments: commentLines.length,
  };
}

function staticFindings(files, truncated) {
  const findings = [];
  const authoredFiles = files.filter(file => !file.generated);
  const hugeFiles = authoredFiles.filter(file => file.lines > (file.kind === 'test' ? 1500 : 1000));
  const longFiles = authoredFiles.filter(file => {
    const lowerLimit = file.kind === 'test' ? 900 : 600;
    const upperLimit = file.kind === 'test' ? 1500 : 1000;
    return file.lines > lowerLimit && file.lines <= upperLimit;
  });
  const trailing = authoredFiles.reduce((sum, file) => sum + file.trailingWhitespace, 0);
  const longLines = authoredFiles.reduce((sum, file) => sum + file.longLines, 0);
  const todos = authoredFiles.reduce((sum, file) => sum + file.todos, 0);
  if (hugeFiles.length) {
    findings.push({
      severity: 'major',
      code: 'very-large-files',
      message: `${hugeFiles.length} file(s) exceed the contextual limit and should be modularized.`,
      files: hugeFiles.map(file => ({ path: file.path, kind: file.kind, lines: file.lines })),
    });
  }
  if (longFiles.length) {
    findings.push({
      severity: 'minor',
      code: 'large-files',
      message: `${longFiles.length} large file(s) exceed the contextual source/test limit.`,
      files: longFiles.map(file => ({ path: file.path, kind: file.kind, lines: file.lines })),
    });
  }
  if (trailing) {
    findings.push({
      severity: 'minor',
      code: 'trailing-whitespace',
      message: `${trailing} line(s) contain trailing whitespace.`,
    });
  }
  if (longLines) {
    findings.push({
      severity: 'minor',
      code: 'long-lines',
      message: `${longLines} line(s) exceed 140 characters.`,
    });
  }
  if (todos) {
    findings.push({
      severity: 'info',
      code: 'todo-markers',
      message: `${todos} TODO/FIXME/HACK/XXX marker(s).`,
    });
  }
  if (truncated) {
    findings.push({
      severity: 'info',
      code: 'scan-truncated',
      message: 'File limit reached; increase maxFiles.',
    });
  }
  return findings;
}

function executablePath(command, root) {
  const bundledTool = path.join(__dirname, 'node_modules', '.bin', command);
  if (fs.existsSync(bundledTool)) {
    return bundledTool;
  }
  let directory = path.resolve(root);
  while (true) {
    const localTool = path.join(directory, 'node_modules', '.bin', command);
    if (fs.existsSync(localTool)) {
      return localTool;
    }
    const parent = path.dirname(directory);
    if (parent === directory) {
      break;
    }
    directory = parent;
  }
  const pathEntries = String(process.env.PATH || '').split(path.delimiter);
  return pathEntries.map(entry => path.join(entry, command)).find(fs.existsSync) || null;
}

function executableExists(command, root) {
  return Boolean(executablePath(command, root));
}

/**
 * Phase 1: commands are described as argv arrays, never as shell strings, and
 * every entry declares which `codeExecution` switch authorizes it:
 *   - `npmScripts` — a script defined by the TARGET repo's package.json;
 *   - `binaries`   — a tool binary resolved from the TARGET repo's tree.
 */
function packageScriptArgv(root, script) {
  if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) {
    return ['pnpm', 'run', script];
  }
  if (fs.existsSync(path.join(root, 'yarn.lock'))) {
    return ['yarn', script];
  }
  if (fs.existsSync(path.join(root, 'bun.lockb')) || fs.existsSync(path.join(root, 'bun.lock'))) {
    return ['bun', 'run', script];
  }
  return ['npm', 'run', script];
}

function nodeQualityCommands(root, mode) {
  const packagePath = path.join(root, 'package.json');
  let pkg = {};
  if (fs.existsSync(packagePath)) {
    try {
      pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    } catch {
      pkg = {};
    }
  }
  const scripts = pkg.scripts || {};
  const commands = [];
  const addScript = (id, names) => {
    const script = names.find(name => scripts[name]);
    if (script) {
      commands.push({ id, argv: packageScriptArgv(root, script), requires: 'npmScripts', script });
    }
  };
  addScript('lint', ['lint', 'lint:check']);
  addScript('format-check', ['format:check', 'prettier:check']);
  addScript('typecheck', ['typecheck', 'type-check', 'check:types']);
  const hasESLintConfig =
    Boolean(pkg.eslintConfig) ||
    ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', '.eslintrc', '.eslintrc.json'].some(file =>
      fs.existsSync(path.join(root, file)),
    );
  const hasPrettierConfig =
    Boolean(pkg.prettier) ||
    ['.prettierrc', '.prettierrc.json', '.prettierrc.js', 'prettier.config.js'].some(file =>
      fs.existsSync(path.join(root, file)),
    );
  const eslintPath = executablePath('eslint', root);
  const prettierPath = executablePath('prettier', root);
  if (!commands.some(item => item.id === 'lint') && hasESLintConfig && eslintPath) {
    commands.push({ id: 'lint', argv: [eslintPath, '.'], requires: 'binaries' });
  }
  if (!commands.some(item => item.id === 'format-check') && hasPrettierConfig && prettierPath) {
    commands.push({ id: 'format-check', argv: [prettierPath, '--check', '.'], requires: 'binaries' });
  }
  if (mode === 'deep') {
    addScript('unit-tests', ['test:unit', 'test']);
  }
  return commands;
}

function nativeQualityCommands(root, stack, mode) {
  const commands = [];
  if (stack === 'Go' && executableExists('go', root)) {
    // `test -z "$(gofmt -l .)"` needed a shell. `gofmt -l .` prints the offending
    // files and exits 0 either way, so the emptiness check moved into JS
    // (see interpretNativeOutput) instead of into /bin/sh.
    commands.push({ id: 'gofmt', argv: ['gofmt', '-l', '.'], requires: 'binaries', failOnOutput: true });
    if (mode !== 'quick') {
      commands.push({ id: 'go-vet', argv: ['go', 'vet', './...'], requires: 'binaries' });
    }
  }
  if (stack.startsWith('Python') || stack === 'Django' || stack.startsWith('FastAPI') || stack === 'Flask') {
    if (executableExists('ruff', root)) {
      commands.push({ id: 'ruff', argv: ['ruff', 'check', '.'], requires: 'binaries' });
    }
    if (executableExists('black', root)) {
      commands.push({ id: 'black-check', argv: ['black', '--check', '.'], requires: 'binaries' });
    }
  }
  if (stack === 'Rust/Cargo' && executableExists('cargo', root)) {
    commands.push({ id: 'cargo-fmt', argv: ['cargo', 'fmt', '--check'], requires: 'binaries' });
    if (mode !== 'quick') {
      commands.push({
        id: 'cargo-clippy',
        argv: ['cargo', 'clippy', '--', '-D', 'warnings'],
        requires: 'binaries',
      });
    }
  }
  return commands;
}

class CodeQualityAnalyzer {
  constructor(options = {}) {
    this.projectDir = path.resolve(options.projectDir || process.cwd());
    this.appDir = path.resolve(options.appDir || this.projectDir);
    this.stack = options.stack || 'Unknown';
    this.mode = options.mode || 'standard';
    this.maxFiles = options.maxFiles || 5000;
    this.timeoutMs = options.timeoutMs || 120_000;
    this.workers = options.workers || 3;
    // Phase 1 (M1): executing commands that come from the target repository is
    // opt-in per category. The default is STATIC ANALYSIS ONLY.
    this.codeExecution = {
      npmScripts: options.codeExecution?.npmScripts === true,
      binaries: options.codeExecution?.binaries === true,
    };
    this.audit = options.audit || new CommandAudit();
  }

  staticAnalysis() {
    const paths = walkSourceFiles(this.appDir, this.maxFiles);
    const files = paths.map(filePath => inspectFile(filePath, this.appDir)).filter(Boolean);
    const authoredFiles = files.filter(file => !file.generated);
    const generatedFiles = files.filter(file => file.generated);
    const totals = authoredFiles.reduce(
      (summary, file) => {
        summary.lines += file.lines;
        summary.bytes += file.bytes;
        summary.todos += file.todos;
        summary.longLines += file.longLines;
        return summary;
      },
      { files: authoredFiles.length, lines: 0, bytes: 0, todos: 0, longLines: 0 },
    );
    return {
      totals,
      generatedFiles: generatedFiles.map(file => ({ path: file.path, lines: file.lines, bytes: file.bytes })),
      byExtension: authoredFiles.reduce((summary, file) => {
        summary[file.extension] = (summary[file.extension] || 0) + 1;
        return summary;
      }, {}),
      findings: staticFindings(files, paths.length >= this.maxFiles),
      largestFiles: [...authoredFiles].sort((first, second) => second.lines - first.lines).slice(0, 20),
    };
  }

  /** All candidate commands, authorized or not. */
  commands() {
    return [
      ...nodeQualityCommands(this.appDir, this.mode),
      ...nativeQualityCommands(this.appDir, this.stack, this.mode),
    ].filter((command, index, all) => all.findIndex(item => item.id === command.id) === index);
  }

  /**
   * Split candidates into what this run may execute and what it must refuse.
   * Refusals surface as `skipped` checks — visible, never silent, and never
   * counted as failures (a blocked command is not a quality defect).
   */
  partitionCommands(candidates = this.commands()) {
    const allowed = [];
    const blocked = [];
    for (const command of candidates) {
      if (this.codeExecution[command.requires] === true) {
        allowed.push(command);
      } else {
        blocked.push({
          ...command,
          status: 'skipped',
          reason:
            command.requires === 'npmScripts'
              ? 'Target-repo npm script not executed (enable with --allow-project-commands scripts).'
              : 'Target-repo binary not executed (enable with --allow-project-commands binaries).',
        });
      }
    }
    return { allowed, blocked };
  }

  async run() {
    const startedAt = new Date().toISOString();
    const staticResult = this.staticAnalysis();
    const { allowed, blocked } = this.partitionCommands();
    for (const command of blocked) {
      this.audit.record({
        source: 'code-quality',
        id: command.id,
        argv: command.argv,
        cwd: this.appDir,
        decision: 'blocked',
        reason: command.reason,
      });
    }
    const scheduler = new ParallelScheduler({
      workers: this.workers,
      mode: this.mode,
      timeoutMs: this.timeoutMs,
      retries: 0,
    });
    const commandRun = await scheduler.run(allowed, item => this._execute(item));
    const executed = commandRun.results.map((result, index) => ({ ...allowed[index], ...result }));
    const checks = [
      ...executed,
      ...blocked.map(command => ({
        id: command.id,
        command: formatCommand(command.argv),
        requires: command.requires,
        status: 'skipped',
        exitCode: null,
        durationMs: 0,
        output: command.reason,
      })),
    ];
    const failedChecks = checks.filter(check => check.status === 'failed');
    const majorFindings = staticResult.findings.filter(finding => finding.severity === 'major');
    const score = Math.max(0, 100 - failedChecks.length * 20 - majorFindings.length * 8);
    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      projectDir: this.projectDir,
      appDir: this.appDir,
      stack: this.stack,
      mode: this.mode,
      score,
      static: staticResult,
      checks,
      scheduler: commandRun.metrics,
      codeExecution: { ...this.codeExecution },
      commandAudit: this.audit.toJSON(),
      summary: {
        commands: checks.length,
        executed: executed.length,
        skipped: blocked.length,
        passed: checks.filter(check => check.status === 'passed').length,
        failed: failedChecks.length,
        findings: staticResult.findings.length,
        majorFindings: majorFindings.length,
      },
    };
  }

  /** Run one authorized command through the shell-free shared runner. */
  async _execute(item) {
    const result = await runCommand({
      argv: item.argv,
      cwd: this.appDir,
      env: process.env,
      timeoutMs: this.timeoutMs,
    });
    // `failOnOutput` commands (gofmt -l) always exit 0; any printed path IS the
    // failure signal. This used to be `test -z "$(...)"`, i.e. a shell.
    const status =
      item.failOnOutput && result.status === 'passed' && result.output.trim() ? 'failed' : result.status;
    this.audit.record({
      source: 'code-quality',
      id: item.id,
      argv: item.argv,
      cwd: this.appDir,
      decision: 'executed',
      exitCode: result.exitCode,
      durationMs: result.durationMs,
    });
    return {
      id: item.id,
      command: result.command,
      status,
      exitCode: result.exitCode,
      signal: result.signal,
      durationMs: result.durationMs,
      output: result.output,
    };
  }
}

module.exports = {
  CodeQualityAnalyzer,
  inspectFile,
  isTestPath,
  nativeQualityCommands,
  nodeQualityCommands,
  walkSourceFiles,
};
