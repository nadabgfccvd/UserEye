'use strict';

const fs = require('node:fs');
const path = require('node:path');

const GC_USAGE = `Usage: usereye gc [artifacts-dir] --older-than <age> [--dry-run]

Deletes only directories that contain a UserEye result.json older than the given age.
The root directory itself is never deleted. Examples: 12h, 7d, 4w.

Options:
  --older-than <age>  Required retention age: ms, s, m, h, d, or w
  --dry-run           List matching run directories without deleting them
  -h, --help

Exit codes: 0 completed; 2 invalid usage or unreadable root.
`;

function usageError(message) {
  const error = new Error(message);
  error.name = 'UsageError';
  return error;
}

function parseAge(value) {
  const match = String(value || '')
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w)$/i);
  if (!match) throw usageError(`--older-than must be an age such as 12h, 7d, or 4w (got "${value}").`);
  const unit = match[2].toLowerCase();
  const multiplier = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[unit];
  const milliseconds = Number(match[1]) * multiplier;
  if (!Number.isFinite(milliseconds) || milliseconds <= 0)
    throw usageError('--older-than must be greater than zero.');
  return milliseconds;
}

function directoryBytes(directory) {
  let total = 0;
  const walk = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) total += fs.statSync(absolute).size;
    }
  };
  try {
    walk(directory);
  } catch {}
  return total;
}

function runTimestamp(directory) {
  const resultPath = path.join(directory, 'result.json');
  try {
    const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    const value = result.finishedAt || result.startedAt;
    if (value && Number.isFinite(Date.parse(value))) return Date.parse(value);
  } catch {}
  return fs.statSync(resultPath).mtimeMs;
}

/**
 * Garbage-collect old run directories beneath `root`. A directory is eligible
 * only when it directly contains result.json; arbitrary user directories and
 * symlinks are never removed.
 */
function gcArtifacts(root, { olderThanMs, dryRun = false, now = Date.now() } = {}) {
  const absoluteRoot = path.resolve(root || 'artifacts');
  if (path.dirname(absoluteRoot) === absoluteRoot)
    throw usageError('Refusing to garbage-collect a filesystem root.');
  if (!fs.existsSync(absoluteRoot) || !fs.statSync(absoluteRoot).isDirectory())
    throw usageError(`Artifact root not found: ${absoluteRoot}`);
  if (!Number.isFinite(olderThanMs) || olderThanMs <= 0)
    throw usageError('--older-than is required and must be greater than zero.');
  const cutoff = now - olderThanMs;
  const candidates = [];
  const visit = directory => {
    const isRoot = directory === absoluteRoot;
    const resultPath = path.join(directory, 'result.json');
    if (!isRoot && fs.existsSync(resultPath) && fs.statSync(resultPath).isFile()) {
      const timestamp = runTimestamp(directory);
      if (timestamp < cutoff) {
        candidates.push({
          path: directory,
          relative: path.relative(absoluteRoot, directory).replace(/\\/g, '/'),
          timestamp: new Date(timestamp).toISOString(),
          bytes: directoryBytes(directory),
        });
      }
      return; // a run is an atomic artifact; do not inspect/delete nested paths separately
    }
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      visit(path.join(directory, entry.name));
    }
  };
  visit(absoluteRoot);
  if (!dryRun) {
    for (const candidate of candidates) fs.rmSync(candidate.path, { recursive: true, force: true });
  }
  return {
    root: absoluteRoot,
    dryRun,
    cutoff: new Date(cutoff).toISOString(),
    matched: candidates.length,
    reclaimedBytes: candidates.reduce((sum, item) => sum + item.bytes, 0),
    runs: candidates,
  };
}

async function runGc(argv = process.argv.slice(2), runtime = {}) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(GC_USAGE);
    return { exitCode: 0, help: true };
  }
  let root = runtime.cwd ? path.join(runtime.cwd, 'artifacts') : path.resolve('artifacts');
  let olderThan;
  let dryRun = false;
  let rootSet = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--older-than') {
      if (!argv[index + 1]) throw usageError('--older-than requires a value.');
      olderThan = argv[++index];
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg.startsWith('-')) {
      throw usageError(`Unknown gc option: ${arg}`);
    } else if (rootSet) {
      throw usageError(`Unexpected gc argument: ${arg}`);
    } else {
      root = path.resolve(runtime.cwd || process.cwd(), arg);
      rootSet = true;
    }
  }
  if (!olderThan) throw usageError('gc requires --older-than <age>.');
  const result = gcArtifacts(root, {
    olderThanMs: parseAge(olderThan),
    dryRun,
    now: runtime.now ?? Date.now(),
  });
  const verb = dryRun ? 'would remove' : 'removed';
  console.log(
    `UserEye gc: ${verb} ${result.matched} run(s), ${result.reclaimedBytes} byte(s) · root ${result.root}`,
  );
  for (const run of result.runs) console.log(`- ${run.relative} (${run.timestamp}, ${run.bytes} bytes)`);
  return { exitCode: 0, result };
}

module.exports = { GC_USAGE, parseAge, gcArtifacts, runGc };
