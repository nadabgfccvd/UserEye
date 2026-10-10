'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const {
  CommandAudit,
  ShellSyntaxError,
  runCommand,
  spawnProcess,
  tokenizeCommand,
} = require('./command-runner');

function exists(root, relative) {
  return fs.existsSync(path.join(root, relative));
}

function readJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function frameworkFromPackage(pkg = {}) {
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const checks = [
    ['next', 'Next.js'],
    ['@remix-run/react', 'Remix'],
    ['vite', 'Vite'],
    ['react-scripts', 'Create React App'],
    ['nuxt', 'Nuxt'],
    ['@sveltejs/kit', 'SvelteKit'],
    ['@angular/core', 'Angular'],
    ['astro', 'Astro'],
    ['express', 'Express'],
    ['fastify', 'Fastify'],
    ['koa', 'Koa'],
    ['hono', 'Hono'],
  ];
  return checks.find(([name]) => deps[name])?.[1] || 'Node.js';
}

function packageManager(root) {
  if (exists(root, 'pnpm-lock.yaml')) {
    return 'pnpm';
  }
  if (exists(root, 'yarn.lock')) {
    return 'yarn';
  }
  if (exists(root, 'bun.lockb') || exists(root, 'bun.lock')) {
    return 'bun';
  }
  return 'npm';
}

function projectMarkers(root) {
  return [
    'package.json',
    'go.mod',
    'pyproject.toml',
    'requirements.txt',
    'manage.py',
    'Cargo.toml',
    'index.html',
  ].filter(marker => exists(root, marker));
}

function discoverProjectRoots(root, maxDepth = 2) {
  const ignored = new Set([
    'node_modules',
    '.git',
    '.next',
    'dist',
    'build',
    'coverage',
    'artifacts',
    '__pycache__',
    'usereye',
    'usereye-tool',
    'user-eye-tool',
  ]);
  const candidates = [];
  const walk = (directory, depth) => {
    const markers = projectMarkers(directory);
    if (markers.length) {
      const pkg = markers.includes('package.json') ? readJSON(path.join(directory, 'package.json')) : null;
      const scriptCount = Object.keys(pkg?.scripts || {}).length;
      const score =
        (directory === root ? 100 : 70 - depth * 5) +
        scriptCount * 3 +
        (markers.includes('package.json') ? 15 : 0) +
        (markers.includes('index.html') ? 5 : 0);
      candidates.push({ directory, markers, score, packageName: pkg?.name || null });
    }
    if (depth >= maxDepth) {
      return;
    }
    let entries = [];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || ignored.has(entry.name) || entry.name.startsWith('.')) {
        continue;
      }
      walk(path.join(directory, entry.name), depth + 1);
    }
  };
  walk(root, 0);
  return candidates.sort((a, b) => b.score - a.score);
}

function stackFromCandidate(candidate) {
  if (!candidate) {
    return null;
  }
  if (candidate.markers.includes('package.json')) {
    return frameworkFromPackage(readJSON(path.join(candidate.directory, 'package.json')) || {});
  }
  if (candidate.markers.includes('go.mod')) {
    return 'Go';
  }
  if (candidate.markers.includes('Cargo.toml')) {
    return 'Rust/Cargo';
  }
  if (
    candidate.markers.some(marker => ['pyproject.toml', 'requirements.txt', 'manage.py'].includes(marker))
  ) {
    return 'Python web';
  }
  if (candidate.markers.includes('index.html')) {
    return 'Static HTML';
  }
  return null;
}

function executableCandidates(root) {
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isFile() && !entry.name.endsWith('.exe'))
      .map(entry => ({
        name: entry.name,
        path: path.join(root, entry.name),
        mode: fs.statSync(path.join(root, entry.name)).mode,
      }))
      .filter(entry => (entry.mode & 0o111) !== 0)
      .filter(entry => {
        try {
          return fs
            .readFileSync(entry.path)
            .subarray(0, 4)
            .equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}

function listeningPorts() {
  const ports = new Set();
  for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
    try {
      const lines = fs.readFileSync(file, 'utf8').trim().split('\n').slice(1);
      for (const line of lines) {
        const columns = line.trim().split(/\s+/);
        if (columns[3] !== '0A') {
          continue;
        }
        const hexPort = columns[1].split(':').pop();
        const port = Number.parseInt(hexPort, 16);
        if (port > 0) {
          ports.add(port);
        }
      }
    } catch {}
  }
  return ports;
}

function requestReady(url, timeout = 1200) {
  return new Promise(resolve => {
    const client = url.startsWith('https:') ? https : http;
    const request = client.get(url, { timeout, rejectUnauthorized: false }, response => {
      response.resume();
      resolve(response.statusCode >= 100 && response.statusCode < 600);
    });
    request.on('timeout', () => {
      request.destroy();
      resolve(false);
    });
    request.on('error', () => resolve(false));
  });
}

async function waitForReady(url, timeoutMs = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await requestReady(url)) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 120));
  }
  return false;
}

function detectProjectFiles(root, pkg) {
  return {
    packageJson: Boolean(pkg),
    goMod: exists(root, 'go.mod'),
    pyproject: exists(root, 'pyproject.toml'),
    requirements: exists(root, 'requirements.txt'),
    managePy: exists(root, 'manage.py'),
    cargo: exists(root, 'Cargo.toml'),
    dockerCompose: ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'].some(file =>
      exists(root, file),
    ),
    staticIndex: exists(root, 'index.html') || exists(root, 'public/index.html'),
  };
}

function emptyLaunchPlan(startCommand) {
  return {
    stack: 'Unknown',
    startCommand,
    installCommand: null,
    selectedScript: null,
    confidence: 0,
    warnings: [],
  };
}

function detectNodePlan({ root, pkg, startCommand, installAllowed }) {
  if (!pkg) {
    return null;
  }
  const manager = packageManager(root);
  const scripts = pkg.scripts || {};
  const selectedScript = ['dev', 'start', 'preview', 'serve'].find(name => scripts[name]);
  const plan = {
    stack: frameworkFromPackage(pkg),
    startCommand: startCommand || (selectedScript ? `${manager} run ${selectedScript}` : null),
    installCommand: null,
    selectedScript,
    confidence: selectedScript ? 0.95 : 0.65,
    warnings: [],
  };
  const dependencyCount =
    Object.keys(pkg.dependencies || {}).length + Object.keys(pkg.devDependencies || {}).length;
  if (dependencyCount && !exists(root, 'node_modules')) {
    plan.installCommand =
      manager === 'npm' && exists(root, 'package-lock.json') ? 'npm ci' : `${manager} install`;
    if (!installAllowed) {
      plan.warnings.push(`Dependencies are missing. Run “${plan.installCommand}” or use --install.`);
    }
  }
  return plan;
}

function readPythonDependencyText(root, files) {
  return [files.pyproject && 'pyproject.toml', files.requirements && 'requirements.txt']
    .filter(Boolean)
    .map(file => fs.readFileSync(path.join(root, file), 'utf8'))
    .join('\n')
    .toLowerCase();
}

function detectPythonPlan({ root, files, startCommand }) {
  if (files.managePy) {
    return {
      stack: 'Django',
      startCommand: startCommand || 'python manage.py runserver 0.0.0.0:0',
      installCommand: files.requirements ? 'python -m pip install -r requirements.txt' : null,
      selectedScript: null,
      confidence: 0.9,
      warnings: [],
    };
  }
  if (!files.pyproject && !files.requirements) {
    return null;
  }
  const dependencies = readPythonDependencyText(root, files);
  const plan = {
    stack: 'Python web',
    startCommand,
    installCommand: files.requirements
      ? 'python -m pip install -r requirements.txt'
      : 'python -m pip install .',
    selectedScript: null,
    confidence: 0.35,
    warnings: [],
  };
  if (dependencies.includes('uvicorn') || dependencies.includes('fastapi')) {
    plan.stack = 'FastAPI/Uvicorn';
    plan.startCommand ||= 'python -m uvicorn app:app --host 0.0.0.0 --port 0';
    plan.confidence = 0.7;
    plan.warnings.push('Pass --command if the ASGI module is not app:app.');
  } else if (dependencies.includes('flask')) {
    plan.stack = 'Flask';
    plan.startCommand ||= 'python -m flask run --host 0.0.0.0 --port 0';
    plan.confidence = 0.7;
  } else {
    plan.warnings.push('A Python stack was detected, but its start command is ambiguous; use --command.');
  }
  return plan;
}

function detectSimplePlan({ files, startCommand }) {
  const candidates = [
    [files.goMod, 'Go', startCommand || 'go run .', 0.85],
    [files.cargo, 'Rust/Cargo', startCommand || 'cargo run', 0.75],
    [files.staticIndex, 'Static HTML', startCommand || 'python -m http.server 0 --bind 0.0.0.0', 0.95],
  ];
  const match = candidates.find(([detected]) => detected);
  if (!match) {
    return null;
  }
  return {
    stack: match[1],
    startCommand: match[2],
    installCommand: null,
    selectedScript: null,
    confidence: match[3],
    warnings: [],
  };
}

function inferLaunchPlan(context) {
  if (context.useBinary) {
    return {
      ...emptyLaunchPlan(`./${context.binaries[0].name}`),
      stack: 'Native Linux executable',
      confidence: 0.92,
    };
  }
  return (
    detectNodePlan(context) ||
    detectPythonPlan(context) ||
    detectSimplePlan(context) ||
    emptyLaunchPlan(context.startCommand)
  );
}

class ProjectAdapter {
  constructor(options = {}) {
    this.projectDir = path.resolve(options.projectDir || process.cwd());
    this.appDir = options.appDir ? path.resolve(this.projectDir, options.appDir) : null;
    this.runDir = this.appDir || this.projectDir;
    this.commandOverride = options.command || null;
    this.urlOverride = options.url || null;
    // Phase 1: `--install` only takes effect when the operator also authorized
    // the `install` code-execution category for this (untrusted) repository.
    this.codeExecution = {
      install: options.codeExecution?.install === true,
      start: options.codeExecution?.start !== false,
    };
    this.installAllowed = options.install === true && this.codeExecution.install;
    this.installRequested = options.install === true;
    this.audit = options.audit || new CommandAudit();
    this.extraEnv = options.env || {};
    this.process = null;
    this.logs = [];
    this.analysis = null;
    this.baseURL = this.urlOverride;
    this._portsBefore = new Set();
  }

  analyze() {
    const originalRoot = this.projectDir;
    const roots = discoverProjectRoots(originalRoot);
    const binaries = executableCandidates(originalRoot);
    const useBinary =
      !this.urlOverride &&
      !this.commandOverride &&
      binaries.length === 1 &&
      !projectMarkers(originalRoot).length;
    const root = this.appDir || (useBinary ? originalRoot : roots[0]?.directory || originalRoot);
    if (this.appDir && !fs.existsSync(this.appDir)) {
      throw new Error(`Configured appDir does not exist: ${this.appDir}`);
    }
    const sourceRoot = useBinary && roots[0] ? roots[0].directory : root;
    this.runDir = root;

    const pkg = readJSON(path.join(root, 'package.json'));
    const files = detectProjectFiles(root, pkg);
    const context = {
      root,
      pkg,
      files,
      binaries,
      useBinary,
      startCommand: this.commandOverride,
      installAllowed: this.installAllowed,
    };
    const plan = inferLaunchPlan(context);

    if (files.dockerCompose && !plan.startCommand) {
      plan.stack = 'Docker Compose';
      plan.startCommand = 'docker compose up';
      plan.confidence = 0.6;
      plan.warnings.push(
        'Docker Compose was detected; review the command before using automatic installation or startup.',
      );
    }
    if (this.urlOverride) {
      plan.startCommand = null;
      plan.confidence = 1;
    } else if (!plan.startCommand) {
      plan.warnings.push('No safe start command was inferred. Use --command or --url.');
    }

    this.analysis = {
      projectDir: originalRoot,
      appDir: root,
      sourceDir: sourceRoot,
      sourceStack: stackFromCandidate(roots[0]) || plan.stack,
      projectName: pkg?.name || path.basename(originalRoot),
      stack: plan.stack,
      executable: useBinary ? binaries[0].name : null,
      discoveredRoots: roots.map(candidate => ({
        directory: candidate.directory,
        markers: candidate.markers,
        score: candidate.score,
        packageName: candidate.packageName,
      })),
      framework: plan.stack,
      packageManager: pkg ? packageManager(root) : null,
      selectedScript: plan.selectedScript,
      startCommand: plan.startCommand,
      installCommand: plan.installCommand,
      needsInstall: Boolean(plan.installCommand && pkg && !exists(root, 'node_modules')),
      confidence: plan.confidence,
      files,
      warnings: plan.warnings,
    };
    return this.analysis;
  }

  async install() {
    const analysis = this.analysis || this.analyze();
    if (!analysis.installCommand) {
      return { skipped: true, reason: 'No installation command is needed.' };
    }
    if (!this.installAllowed) {
      const reason = this.installRequested
        ? "Installation requires --allow-project-commands install (it runs the target repo's package manager)."
        : 'Installation was not authorized.';
      this.audit.record({
        source: 'project-adapter',
        id: 'install',
        command: analysis.installCommand,
        cwd: this.runDir,
        decision: 'blocked',
        reason,
      });
      return { skipped: true, reason };
    }
    return this._runOneShot(analysis.installCommand, 10 * 60_000);
  }

  /**
   * Run a one-shot command (dependency installation) with `shell: false`.
   * A command that would need shell syntax is refused, not "escaped".
   */
  async _runOneShot(command, timeoutMs) {
    let argv;
    try {
      argv = tokenizeCommand(command);
    } catch (error) {
      this.audit.record({
        source: 'project-adapter',
        id: 'install',
        command,
        cwd: this.runDir,
        decision: 'blocked',
        reason: error.message,
      });
      throw error;
    }
    const result = await runCommand({
      argv,
      cwd: this.runDir,
      env: { ...process.env, ...this.extraEnv },
      timeoutMs,
    });
    this.audit.record({
      source: 'project-adapter',
      id: 'install',
      argv,
      cwd: this.runDir,
      decision: 'executed',
      exitCode: result.exitCode,
      durationMs: result.durationMs,
    });
    if (result.status !== 'passed') {
      throw new Error(`Command exited ${result.exitCode}: ${command}\n${result.output.slice(-4000)}`);
    }
    return { skipped: false, command, output: result.output };
  }

  async start(options = {}) {
    const analysis = this.analysis || this.analyze();
    if (this.urlOverride) {
      if (!(await waitForReady(this.urlOverride, options.timeoutMs || 15_000))) {
        throw new Error(`URL did not respond: ${this.urlOverride}`);
      }
      this.baseURL = this.urlOverride;
      return this.baseURL;
    }
    if (!analysis.startCommand) {
      throw new Error('No start command inferred. Pass --command or --url.');
    }
    if (analysis.needsInstall && this.installAllowed) {
      await this.install();
    }
    if (analysis.needsInstall && !this.installAllowed) {
      throw new Error(analysis.warnings.join(' '));
    }

    this._portsBefore = listeningPorts();
    const env = { ...process.env, ...this.extraEnv };
    env.HOST ||= '0.0.0.0';
    env.PORT ||= '0';
    env.BROWSER ||= 'none';
    const command = this.commandOverride || analysis.startCommand;
    if (!this.codeExecution.start) {
      this.audit.record({
        source: 'project-adapter',
        id: 'start',
        command,
        cwd: this.runDir,
        decision: 'blocked',
        reason: 'codeExecution.start is disabled; pass --url to point at an already-running app.',
      });
      throw new Error(
        'Starting the target application is disabled (codeExecution.start=false). Pass --url instead.',
      );
    }
    let startArgv;
    try {
      startArgv = tokenizeCommand(command);
    } catch (error) {
      this.audit.record({
        source: 'project-adapter',
        id: 'start',
        command,
        cwd: this.runDir,
        decision: 'blocked',
        reason: error.message,
      });
      throw new ShellSyntaxError(
        `UserEye never runs commands through a shell. Rewrite the start command without shell syntax, ` +
          `or start the app yourself and pass --url. Command: ${command}`,
        command,
      );
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      let discoveredPort = null;
      const portsBeingChecked = new Set();
      const finish = async port => {
        if (settled || !port || portsBeingChecked.has(port)) {
          return;
        }
        portsBeingChecked.add(port);
        const url = `http://127.0.0.1:${port}/`;
        const ready = await waitForReady(url, 12_000);
        portsBeingChecked.delete(port);
        if (!ready || settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        clearInterval(portProbe);
        this.baseURL = url;
        resolve(url);
      };
      const consume = (stream, chunk) => {
        const text = chunk.toString();
        this.logs.push(`[${stream}] ${text}`);
        const patterns = [
          /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::\]):(\d+)/gi,
          /\bport\s*[=:]?\s*(\d{2,5})\b/gi,
          /\blistening\s+(?:on\s+)?[^\n]*?(\d{2,5})\b/gi,
        ];
        for (const pattern of patterns) {
          let match;
          while ((match = pattern.exec(text))) {
            discoveredPort = Number(match[1]);
            finish(discoveredPort);
          }
        }
      };

      // Phase 1: the app under test is launched WITHOUT a shell. A start
      // command that needs shell syntax is refused with an actionable error
      // rather than handed to /bin/sh.
      try {
        this.process = spawnProcess({
          argv: startArgv,
          cwd: this.runDir,
          env,
          detached: true,
        });
      } catch (error) {
        reject(error);
        return;
      }
      this.audit.record({
        source: 'project-adapter',
        id: 'start',
        argv: startArgv,
        cwd: this.runDir,
        decision: 'executed',
      });
      this.process.stdout.on('data', chunk => consume('stdout', chunk));
      this.process.stderr.on('data', chunk => consume('stderr', chunk));
      this.process.once('error', error => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          clearInterval(portProbe);
          reject(error);
        }
      });
      this.process.once('exit', (code, signal) => {
        this.logs.push(`[process] exit code=${code} signal=${signal}\n`);
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          clearInterval(portProbe);
          reject(new Error(`App exited before becoming ready (code ${code}, signal ${signal}).`));
        }
      });

      const portProbe = setInterval(() => {
        const added = [...listeningPorts()].filter(port => !this._portsBefore.has(port));
        if (discoveredPort) {
          finish(discoveredPort);
        } else if (added.length === 1) {
          finish(added[0]);
        }
      }, 160);
      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        clearInterval(portProbe);
        reject(
          new Error(`Timed out discovering app URL. Command: ${command}\n${this.logs.join('').slice(-5000)}`),
        );
      }, options.timeoutMs || 30_000);
    });
  }

  async stop() {
    if (!this.process || this.process.exitCode !== null) {
      return;
    }
    const child = this.process;
    const exited = new Promise(resolve => child.once('exit', resolve));
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      try {
        child.kill('SIGTERM');
      } catch {}
    }
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 2500))]);
    if (child.exitCode === null) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        try {
          child.kill('SIGKILL');
        } catch {}
      }
    }
    this.process = null;
  }

  writeLogs(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, this.logs.join(''));
  }
}

module.exports = {
  ProjectAdapter,
  ShellSyntaxError,
  frameworkFromPackage,
  discoverProjectRoots,
  executableCandidates,
  listeningPorts,
  waitForReady,
};
