#!/usr/bin/env node
'use strict';

/**
 * Release packaging automation
 * (ROADMAP-PACKAGING-AND-DEFAULTS Phase F: F1 pack:delivery, F2 manifest,
 *  F3 preflight, F4 pack:npm).
 *
 * The 7.4.0 bundle was assembled by hand, which is how a zip labelled 7.1.1 came
 * to contain a 7.4.0 package behind two nested folders. This script removes the
 * hand-editing: the zip name, the layout, the test count in the docs and the
 * manifest are all derived from `package.json` and a real test run.
 *
 *   preflight  -> scripts/check-delivery-names.js (version agreement + flat layout)
 *   tests      -> `npm test` must be green; its TAP summary is written into
 *                 CURRENT.md / DELIVERY.md so the shipped docs cannot lie
 *   stage      -> copy the bundle minus node_modules/.git/artifacts/webm/tarballs
 *   manifest   -> DELIVERY-MANIFEST.json (version, git sha, test summary, file
 *                 count, reproducible contents hash)
 *   zip        -> dist/usereye-<version>-balanced.zip
 *
 * Zip layout: exactly ONE generated top-level folder, `usereye-<version>-balanced/`,
 * whose name comes from package.json. So `unzip -l` shows
 * `usereye-7.4.1-balanced/UserEye/package.json` — one level, no stale label, and
 * safe to extract in place. The working tree itself stays flat.
 *
 * The zip writer is dependency-free (zlib + a hand-rolled central directory) and
 * deterministic: entries are sorted and stamped with a fixed DOS timestamp, so
 * `contentsSha256` (which excludes the manifest) is reproducible for a given tree.
 * A zip cannot contain its own hash, so `zipSha256` is written to the manifest copy
 * that sits *beside* the archive in dist/.
 *
 * Usage:
 *   node scripts/pack-delivery.js [--out <dir>] [--skip-tests] [--no-refresh]
 *   node scripts/pack-delivery.js --refresh-only # verify:delivery: run + refresh docs, no zip
 *   node scripts/pack-delivery.js --npm-only     # F4: publishable tarball only
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const packageDir = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
const VERSION = pkg.version;

/** Never shipped: build/dependency caches and heavy or regenerable evidence. */
const EXCLUDED_DIRS = new Set([
  '.git',
  'node_modules',
  'artifacts',
  'live-runs',
  'coverage',
  'dist',
  '.nyc_output',
  'vela-usereye-artifacts',
]);
const EXCLUDED_EXTENSIONS = new Set(['.webm', '.mp4', '.zip', '.tgz', '.trace', '.pack']);
const MANIFEST_NAME = 'DELIVERY-MANIFEST.json';

// ---------------------------------------------------------------------------
// argv
// ---------------------------------------------------------------------------

function parseArgv(argv) {
  const out = {
    out: null,
    root: null,
    skipTests: false,
    refresh: true,
    npmOnly: false,
    refreshOnly: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--out') out.out = argv[++index];
    else if (token === '--root') out.root = argv[++index];
    else if (token === '--skip-tests') out.skipTests = true;
    else if (token === '--no-refresh') out.refresh = false;
    else if (token === '--npm-only') out.npmOnly = true;
    else if (token === '--refresh-only') out.refreshOnly = true;
    else if (token === '--help' || token === '-h') out.help = true;
    else throw new Error(`Unknown option: ${token}`);
  }
  if (out.refreshOnly && out.skipTests) {
    throw new Error('--refresh-only needs a real test run; it cannot be combined with --skip-tests');
  }
  return out;
}

const USAGE = `Usage: npm run pack:delivery -- [options]

  --root <dir>    Delivery root to pack (default: auto-detected parent of the package)
  --out <dir>     Where to write the artifacts (default: <deliveryRoot>/dist)
  --skip-tests    Do not run \`npm test\` (preflight still runs); the docs keep
                  whatever test summary they already carry
  --no-refresh    Do not rewrite the "**Tests:**" line in CURRENT.md / DELIVERY.md
  --refresh-only  (npm run verify:delivery) run the suite, write the real summary into
                  CURRENT.md / DELIVERY.md and the current tarball name into the package
                  README, then exit WITHOUT packing. Commit the result, then pack from a
                  clean tree — this is how the shipped numbers stop being hand-typed.
  --npm-only      Build just the publishable tarball (Phase F4) and exit
`;

// ---------------------------------------------------------------------------
// delivery root detection
// ---------------------------------------------------------------------------

function detectDeliveryRoot(explicit) {
  if (explicit) {
    const resolved = path.resolve(explicit);
    return fs.existsSync(path.join(resolved, 'CURRENT.md')) ? resolved : null;
  }
  const parent = path.resolve(packageDir, '..');
  const isBundle =
    path.basename(packageDir) === 'UserEye' &&
    fs.existsSync(path.join(parent, 'UserEye', 'package.json')) &&
    fs.existsSync(path.join(parent, 'CURRENT.md'));
  return isBundle ? parent : null;
}

function fail(message) {
  console.error(`pack-delivery: FAIL — ${message}`);
  process.exit(1);
}

/**
 * 7.5.1 (roadmap item 3.5): spawn without any shell. `npm` (a .cmd file on
 * Windows) is driven through the npm CLI file via process.execPath; `git` on
 * Windows is git.exe and spawns directly. Nothing here interprets user input.
 */
function npmCliPath() {
  const candidates = [];
  if (process.env.npm_execpath) candidates.push(process.env.npm_execpath);
  const nodeDir = path.dirname(process.execPath);
  candidates.push(
    path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(nodeDir, '..', 'share', 'nodejs', 'npm', 'bin', 'npm-cli.js'),
  );
  return candidates.find(candidate => fs.existsSync(candidate)) || null;
}

function run(command, args, options = {}) {
  if (command === 'npm' || command === 'npx') {
    const npmCli = npmCliPath();
    if (!npmCli) {
      return { status: 1, stdout: '', stderr: 'npm CLI not resolvable without a shell' };
    }
    args = [npmCli, ...args];
    command = process.execPath;
  }
  return spawnSync(command, args, {
    cwd: options.cwd || packageDir,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...(options.env || {}) },
  });
}

// ---------------------------------------------------------------------------
// F3 preflight
// ---------------------------------------------------------------------------

function preflight(deliveryRoot) {
  // Police the tree we are actually about to ship, not whichever bundle happens to
  // be auto-detected from this script's location.
  const args = [path.join(__dirname, 'check-delivery-names.js')];
  if (deliveryRoot) args.push('--root', deliveryRoot);
  const check = run(process.execPath, args);
  if (check.status !== 0) {
    process.stderr.write(check.stderr || '');
    fail('preflight rejected the delivery (scripts/check-delivery-names.js).');
  }
  process.stdout.write(check.stdout || '');
}

// ---------------------------------------------------------------------------
// tests -> the summary line the docs are allowed to print
// ---------------------------------------------------------------------------

function parseTapSummary(stdout) {
  const pick = label => {
    const match = stdout.match(new RegExp(`^# ${label} (\\d+)\\s*$`, 'm'));
    return match ? Number(match[1]) : null;
  };
  const summary = {
    tests: pick('tests'),
    pass: pick('pass'),
    fail: pick('fail'),
    skipped: pick('skipped'),
  };
  if (summary.tests === null || summary.pass === null || summary.fail === null) return null;
  return summary;
}

/**
 * Collect the reasons a TAP run gave for its skips, in first-seen order.
 * Node prints them as `ok 12 - name # SKIP <reason>`. Each reason is trimmed to its
 * headline: the parenthetical remediation hint and any trailing clause are dropped, so
 * `firefox not installed (npx playwright install firefox)` becomes `firefox not installed`
 * and `tree is dirty (null); reproducibility is not claimed` becomes `tree is dirty`.
 */
function parseSkipReasons(stdout) {
  const seen = [];
  const re = /^(?:not )?ok \d+ - .*?# SKIP\s*(.+)$/gm;
  let match;
  while ((match = re.exec(stdout)) !== null) {
    const reason = match[1]
      .replace(/\s*\([^)]*\)/g, '')
      .split(';')[0]
      .trim();
    if (reason && !seen.includes(reason)) seen.push(reason);
  }
  return seen;
}

function runTests() {
  console.log('pack-delivery: running npm test (the docs may only quote a real run)…');
  const result = run('npm', ['test', '--silent'], { env: { USEREYE_PACK_DELIVERY: '1' } });
  const stdout = `${result.stdout || ''}${result.stderr || ''}`;
  const summary = parseTapSummary(stdout);
  if (!summary) {
    process.stdout.write(stdout.slice(-4000));
    fail('could not parse a TAP summary from npm test.');
  }
  if (result.status !== 0 || summary.fail !== 0) {
    process.stdout.write(stdout.slice(-4000));
    fail(`npm test is not green (exit ${result.status}, ${summary.fail} failing). Refusing to package.`);
  }
  console.log(
    `pack-delivery: tests ${summary.tests} · pass ${summary.pass} · fail ${summary.fail} · skipped ${summary.skipped}`,
  );
  summary.skipReasons = parseSkipReasons(stdout);
  return summary;
}

/**
 * The `**Tests:**` line the delivery docs are allowed to print.
 *
 * When the run skipped something, the note must say what was actually skipped: the note
 * used to be hardcoded to `(firefox/webkit not installed)` for every skip, so a run whose
 * only skip was, say, the byte-reproducibility gate stamped a false explanation into
 * CURRENT.md and DELIVERY.md. Real reasons are used whenever they are available
 * (`summary.skipReasons`, filled in by runTests); the historical wording remains the
 * fallback for callers that pass counts alone.
 */
function testSummaryLine(summary) {
  let skipNote = '';
  if (summary.skipped) {
    const reasons = Array.isArray(summary.skipReasons) ? summary.skipReasons : [];
    skipNote = reasons.length ? ` (${reasons.join('; ')})` : ' (firefox/webkit not installed)';
  }
  return `${summary.tests} total · ${summary.pass} pass · ${summary.fail} fail · ${summary.skipped} skipped${skipNote}`;
}

/**
 * Rewrite the `**Tests:**` line of the delivery docs from a real run (Phase B2), and
 * with it any test count written into prose or a code comment in the same documents.
 *
 * The header alone used to be refreshed, so `DELIVERY.md` shipped `# 246 tests` inside a
 * fenced block while its own line 5 said 280 — a number no mechanism owned.
 * `check-readme-examples.js` now fails the build on that disagreement; refreshing the
 * prose here means the release heals itself instead of merely stopping.
 */
function refreshTestSummary(deliveryRoot, line) {
  const touched = [];
  const total = /^(\d+)\s+total\b/.exec(line);
  for (const name of ['CURRENT.md', 'DELIVERY.md']) {
    const file = path.join(deliveryRoot, name);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    let updated = text.replace(/^\*\*Tests:\*\*.*$/m, `**Tests:** ${line}`);
    if (total) updated = updated.replace(/\b\d+ tests\b/g, `${total[1]} tests`);
    if (updated !== text) {
      fs.writeFileSync(file, updated);
      touched.push(name);
    }
  }
  return touched;
}

/**
 * Rewrite every `usereye-<x.y.z>.tgz` mention in the package README to the current
 * version (item 0.3 of the 7.5.0 roadmap). The 7.5.0 README still told readers to
 * `npm install ./usereye-7.4.1.tgz` — a tarball `pack:npm` no longer produces. The
 * tarball name is owned by `npm pack`, which derives it from package.json, so the
 * doc is now derived from the same source instead of being typed.
 */
function refreshTarballName(readmeFile, version = VERSION) {
  if (!fs.existsSync(readmeFile)) return false;
  const text = fs.readFileSync(readmeFile, 'utf8');
  const updated = text.replace(
    /\busereye-\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\.tgz\b/g,
    `usereye-${version}.tgz`,
  );
  if (updated === text) return false;
  fs.writeFileSync(readmeFile, updated);
  return true;
}

// ---------------------------------------------------------------------------
// staging
// ---------------------------------------------------------------------------

function shouldInclude(relativePath, stats) {
  const parts = relativePath.split(path.sep);
  if (parts.some(part => EXCLUDED_DIRS.has(part))) return false;
  if (stats.isDirectory()) return true;
  if (EXCLUDED_EXTENSIONS.has(path.extname(relativePath).toLowerCase())) return false;
  // Belt and braces: the bundle must not carry npm/package manager debris.
  if (/(^|\/)(npm-debug\.log|\.DS_Store|Thumbs\.db)$/.test(relativePath)) return false;
  return true;
}

/**
 * Copy the bundle into a staging directory.
 *
 * @param {string} sourceRoot delivery root to copy from
 * @param {string} targetRoot staging directory to copy into
 * @param {string} [prefix]   optional single top-level folder for the archive.
 *   Entry paths (and therefore zip paths) are prefixed with it, which is how the
 *   bundle ends up as `usereye-<version>-balanced/UserEye/...` — exactly one
 *   nesting level, named from package.json, and safe to extract in place.
 */
function stageTree(sourceRoot, targetRoot, prefix = '') {
  const entries = [];
  const base = prefix ? path.join(targetRoot, prefix) : targetRoot;
  fs.mkdirSync(base, { recursive: true });
  const join = (relative, isDir) =>
    `${prefix ? `${prefix}/` : ''}${relative.split(path.sep).join('/')}${isDir ? '/' : ''}`;
  const walk = relativeDir => {
    const absoluteDir = path.join(sourceRoot, relativeDir);
    for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
      const relative = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
      const absolute = path.join(absoluteDir, entry.name);
      const stats = fs.statSync(absolute);
      if (!shouldInclude(relative, stats)) continue;
      const target = path.join(base, relative);
      if (entry.isDirectory()) {
        fs.mkdirSync(target, { recursive: true });
        entries.push({ relative: join(relative, true), directory: true });
        walk(relative);
      } else {
        fs.copyFileSync(absolute, target);
        entries.push({ relative: join(relative, false), directory: false });
      }
    }
  };
  walk('');
  return entries;
}

// ---------------------------------------------------------------------------
// F2 manifest
// ---------------------------------------------------------------------------

function gitSha() {
  const result = run('git', ['rev-parse', 'HEAD']);
  if (result.status === 0) return (result.stdout || '').trim();
  const describe = run('git', ['rev-parse', '--short', 'HEAD']);
  return describe.status === 0 ? (describe.stdout || '').trim() : null;
}

function gitDirty() {
  const result = run('git', ['status', '--porcelain']);
  return result.status === 0 ? (result.stdout || '').trim().length > 0 : null;
}

/** Committer date of HEAD, ISO-8601, or null outside a git checkout. */
function gitCommittedAt() {
  const result = run('git', ['show', '-s', '--format=%cI', 'HEAD']);
  if (result.status !== 0) return null;
  const stamp = (result.stdout || '').trim();
  return Number.isNaN(Date.parse(stamp)) ? null : stamp;
}

/**
 * When the tree is clean the commit fully describes the content, so the timestamp
 * is taken from the commit as well. That is what makes a pack byte-reproducible:
 * rebuild the same commit next month and `zipSha256` is unchanged, so it can serve
 * as a release identifier rather than a record of the moment someone ran a script.
 * A dirty tree has no commit to derive time from and falls back to the wall clock —
 * reproducibility is then not claimed, and `git.dirty` says so.
 */
function generatedAt(dirty) {
  if (dirty !== true) {
    const committed = gitCommittedAt();
    if (committed) return committed;
  }
  return new Date().toISOString();
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Reproducible hash of the staged tree: sorted `path\0sha256` lines. The manifest is
 * excluded because it would have to hash itself — it is part of the tree it describes.
 */
function contentsSha256(stageRoot, files) {
  const lines = files
    .filter(file => !file.directory && path.basename(file.relative) !== MANIFEST_NAME)
    .map(file => `${file.relative}\0${sha256(fs.readFileSync(path.join(stageRoot, file.relative)))}`)
    .sort();
  return sha256(Buffer.from(`${lines.join('\n')}\n`, 'utf8'));
}

// ---------------------------------------------------------------------------
// deterministic ZIP writer (deflate, no dependencies)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

/** Fixed stamp so the archive is byte-stable for a given tree (SOURCE_DATE_EPOCH honoured). */
function dosTimestamp() {
  const epoch = Number(process.env.SOURCE_DATE_EPOCH);
  const date = Number.isFinite(epoch) && epoch > 0 ? new Date(epoch * 1000) : new Date(Date.UTC(2020, 0, 1));
  const time = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1);
  const day = ((date.getUTCFullYear() - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
  return { time, day };
}

function createZip(entries, stageRoot) {
  const { time, day } = dosTimestamp();
  const locals = [];
  const centrals = [];
  let offset = 0;

  const sorted = [...entries].sort((a, b) =>
    a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0,
  );
  for (const entry of sorted) {
    const nameBuffer = Buffer.from(entry.relative, 'utf8');
    const isDir = entry.directory;
    const data = isDir ? Buffer.alloc(0) : fs.readFileSync(path.join(stageRoot, entry.relative));
    const compressed = isDir || data.length === 0 ? data : zlib.deflateRawSync(data, { level: 9 });
    const useStore = isDir || compressed.length >= data.length;
    const payload = useStore ? data : compressed;
    const method = useStore ? 0 : 8;
    const digest = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(digest, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuffer, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4); // version made by: UNIX, zip 3.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(digest, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    // "Version made by" declares UNIX, so the HIGH 16 bits of the external
    // attributes are the st_mode. Writing only the MS-DOS directory bit left the
    // Unix mode at 0000 and `unzip` faithfully created mode-000 directories —
    // an unreadable delivery. Set real modes: 0755 dirs, 0644 files.
    const unixMode = isDir ? 0o40755 : 0o100644;
    central.writeUInt32LE((((unixMode << 16) >>> 0) | (isDir ? 0x10 : 0)) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuffer);

    offset += local.length + nameBuffer.length + payload.length;
  }

  const centralBuffer = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(sorted.length, 8);
  end.writeUInt16LE(sorted.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBuffer, end]);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function packNpm(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const result = run('npm', ['pack', '--pack-destination', outDir, '--ignore-scripts']);
  if (result.status !== 0) {
    process.stderr.write(result.stderr || '');
    fail(`npm pack exited ${result.status}.`);
  }
  const tarball = (result.stdout || '').trim().split('\n').pop();
  const absolute = path.resolve(outDir, path.basename(tarball || `usereye-${VERSION}.tgz`));
  console.log(`pack-delivery: OK — npm tarball ${path.relative(process.cwd(), absolute) || absolute}`);
  console.log(`pack-delivery: sha256 ${sha256(fs.readFileSync(absolute))}`);
  return absolute;
}

function main() {
  const options = parseArgv(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(USAGE);
    return;
  }

  const deliveryRoot = detectDeliveryRoot(options.root);
  const outDir = path.resolve(
    options.out || (deliveryRoot ? path.join(deliveryRoot, 'dist') : path.join(packageDir, 'dist')),
  );

  if (options.npmOnly) {
    preflight(deliveryRoot);
    packNpm(outDir);
    return;
  }

  if (!deliveryRoot) {
    fail(
      'no delivery bundle detected (expected this package to live at <bundle>/UserEye with <bundle>/CURRENT.md). Use --npm-only to build just the tarball.',
    );
  }

  preflight(deliveryRoot);
  const summary = options.skipTests ? null : runTests();
  if (summary && options.refresh) {
    const touched = refreshTestSummary(deliveryRoot, testSummaryLine(summary));
    if (refreshTarballName(path.join(packageDir, 'README.md'))) touched.push('UserEye/README.md');
    if (touched.length) {
      console.log(`pack-delivery: refreshed **Tests:** / tarball name in ${touched.join(', ')}`);
      // Refreshing dirties the tree *after* staging, so this archive records
      // git.dirty: true and verify:release will (correctly) refuse it. Say so here
      // rather than letting the reader find out at the end of a long chain.
      if (!options.refreshOnly) {
        console.log(
          'pack-delivery: commit those docs and re-run — a release archive must come from a clean tree.',
        );
      }
    } else if (options.refreshOnly) {
      console.log('pack-delivery: delivery docs already quote this run — nothing to refresh.');
    }
  }
  if (options.refreshOnly) {
    // `npm run verify:delivery`: the docs are now a consequence of the run that just
    // happened. Packing is a separate, later step from a clean tree. A manifest left in
    // the tree by a previous pack (we ship one inside the zip, so an extracted bundle
    // always has it) is brought in line too, so `tests/packaging.test.js` can hold the
    // docs and the manifest to the same run.
    const staleManifest = path.join(deliveryRoot, MANIFEST_NAME);
    if (fs.existsSync(staleManifest)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(staleManifest, 'utf8'));
        manifest.tests = { ...summary, line: testSummaryLine(summary) };
        fs.writeFileSync(staleManifest, `${JSON.stringify(manifest, null, 2)}\n`);
        console.log(`pack-delivery: refreshed tests in ${MANIFEST_NAME} (the pack regenerates the rest)`);
      } catch (error) {
        fail(`${MANIFEST_NAME} in the delivery root is not valid JSON: ${error.message}`);
      }
    }
    console.log(`pack-delivery: OK — verify:delivery · ${testSummaryLine(summary)}`);
    return null;
  }

  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'usereye-pack-'));
  const wrapper = `usereye-${VERSION}-balanced`;
  let zipPath;
  try {
    const entries = stageTree(deliveryRoot, stagingRoot, wrapper);
    const stageRoot = path.join(stagingRoot, wrapper);

    // Real files only, and never a DELIVERY-MANIFEST.json that a previous pack left
    // in the source tree. Packing from an EXTRACTED bundle (rather than the git
    // worktree) copies that stale manifest in as an ordinary file; it is overwritten
    // by the generated one below, so counting it here made fileCount and bytes
    // describe a file the archive does not contain. contentsSha256 already filtered
    // it out by the same rule — these two counters now agree with it.
    const files = entries.filter(
      entry => !entry.directory && path.basename(entry.relative) !== MANIFEST_NAME,
    );
    const dirty = gitDirty();
    const manifest = {
      name: 'usereye',
      version: VERSION,
      bundle: wrapper,
      generatedAt: generatedAt(dirty),
      git: { sha: gitSha(), dirty },
      tests: summary
        ? { ...summary, line: testSummaryLine(summary) }
        : { line: 'not run for this package (--skip-tests); see the **Tests:** line in CURRENT.md' },
      layout: {
        // One generated top-level folder, named from package.json, containing
        // exactly the four documented members. `unzip -l` therefore shows
        // `<bundle>/UserEye/package.json` — one nesting level, no stale label.
        topLevel: wrapper,
        nesting: 1,
        zipRootContents: [
          'CURRENT.md',
          'DELIVERY.md',
          'README.md',
          MANIFEST_NAME,
          'UserEye/',
          'demo/',
          'docs/',
        ],
      },
      // Counts describe the staged bundle. This manifest cannot include its own
      // size (that would be circular), so it is excluded from both numbers and
      // declared separately — the archive therefore holds fileCount + 1 files.
      fileCount: files.length,
      bytes: files.reduce(
        (total, file) => total + fs.statSync(path.join(stagingRoot, file.relative)).size,
        0,
      ),
      manifestShippedInside: true,
      contentsSha256: contentsSha256(stagingRoot, entries),
      excluded: {
        directories: [...EXCLUDED_DIRS].sort(),
        extensions: [...EXCLUDED_EXTENSIONS].sort(),
      },
    };

    // stageRoot === path.join(stagingRoot, wrapper); the manifest is the one entry
    // written after staging, so it is added to `entries` with the prefix by hand.
    // Drop any manifest entry staged from the source tree first: when packing from an
    // extracted bundle the stale copy is already in `entries`, and pushing a second
    // record for the same path emitted the manifest TWICE into the archive — a
    // duplicate zip entry whose meaning depends on which one the extractor keeps.
    const manifestEntry = `${wrapper}/${MANIFEST_NAME}`;
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      if (entries[i].relative === manifestEntry) entries.splice(i, 1);
    }
    fs.writeFileSync(path.join(stageRoot, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`);
    entries.push({ relative: manifestEntry, directory: false });

    const zip = createZip(entries, stagingRoot);
    fs.mkdirSync(outDir, { recursive: true });
    zipPath = path.join(outDir, `${wrapper}.zip`);
    fs.writeFileSync(zipPath, zip);

    const zipSha = sha256(zip);
    const sideManifest = {
      ...manifest,
      zipName: path.basename(zipPath),
      zipBytes: zip.length,
      zipSha256: zipSha,
    };
    fs.writeFileSync(path.join(outDir, MANIFEST_NAME), `${JSON.stringify(sideManifest, null, 2)}\n`);

    console.log(`pack-delivery: OK — ${zipPath}`);
    console.log(
      `pack-delivery: ${(zip.length / 1024).toFixed(1)} kB · ${manifest.fileCount} files + manifest · top level ${wrapper}/ · sha256 ${zipSha}`,
    );
    console.log(`pack-delivery: manifest ${path.join(outDir, MANIFEST_NAME)}`);
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
  return zipPath;
}

// Run only as a script, so the pure helpers above stay unit-testable (and so
// requiring this file never triggers a nested `npm test`).
if (require.main === module) {
  main();
}

module.exports = {
  VERSION,
  EXCLUDED_DIRS,
  EXCLUDED_EXTENSIONS,
  MANIFEST_NAME,
  parseArgv,
  parseTapSummary,
  parseSkipReasons,
  testSummaryLine,
  refreshTestSummary,
  refreshTarballName,
  shouldInclude,
  stageTree,
  contentsSha256,
  crc32,
  dosTimestamp,
  createZip,
  detectDeliveryRoot,
  sha256,
  generatedAt,
  gitCommittedAt,
};
