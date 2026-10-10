#!/usr/bin/env node
'use strict';

/**
 * Release gate — grades the SHIPPED ZIP, not the working tree.
 *
 * `npm run verify` proves the source is good. It cannot prove the artifact a
 * stranger downloads is good: the 7.4.0 bundle passed its own suite while shipping
 * a zip labelled 7.1.1 around a 7.4.0 package, and 7.4.1 shipped a byte-valid
 * archive whose directories extracted with mode 000. Both defects live in the gap
 * between "the code works" and "the box works", so this script extracts the box and
 * grades that.
 *
 * It walks the ROADMAP-PACKAGING-AND-DEFAULTS §6 acceptance list and §10 definition
 * of done against the extracted tree, and adds archive-integrity checks that
 * `unzip -q` never reports:
 *
 *   - every entry's CRC-32 and uncompressed length verified against the central
 *     directory, using the same dependency-free reader/writer pair as pack-delivery;
 *   - every entry's Unix mode checked (the mode-000 regression);
 *   - no absolute paths, no `..` traversal, no symlink entries;
 *   - the side manifest's zipSha256 equals the real archive hash, and its
 *     contentsSha256 recomputes from the extracted bytes.
 *
 * NOT checked here (known gap, R6): duplicate entry names. See the note in section 1.
 *
 * Sections that need a browser or an installed dependency tree SKIP with a reason
 * rather than fail — a release gate that cannot run must say so, not go green.
 *
 * Usage:
 *   node scripts/verify-release.js [path/to/usereye-<version>-balanced.zip]
 * Defaults to ../dist/usereye-<version>-balanced.zip. Exit 1 on any FAIL.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const net = require('net');
const { spawn, spawnSync } = require('child_process');

const PACKAGE_DIR = path.resolve(__dirname, '..');
const pack = require('./pack-delivery.js');

const VERSION = pack.VERSION;
const WRAPPER = `usereye-${VERSION}-balanced`;

// ---------------------------------------------------------------------------
// tally
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];

function section(title) {
  process.stdout.write(`\n\x1b[1m${title}\x1b[0m\n`);
}
function ok(message) {
  passed += 1;
  process.stdout.write(`  \x1b[32mPASS\x1b[0m  ${message}\n`);
}
function bad(message) {
  failed += 1;
  failures.push(message);
  process.stdout.write(`  \x1b[31mFAIL\x1b[0m  ${message}\n`);
}
function skip(message) {
  skipped += 1;
  process.stdout.write(`  \x1b[33mSKIP\x1b[0m  ${message}\n`);
}
function eq(label, got, want) {
  if (String(got) === String(want)) ok(`${label} (${got})`);
  else bad(`${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}
function truthy(label, value) {
  if (value) ok(label);
  else bad(label);
}

// ---------------------------------------------------------------------------
// dependency-free ZIP reader (mirror of pack-delivery.createZip)
// ---------------------------------------------------------------------------

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

function findEocd(buffer) {
  const lowest = Math.max(0, buffer.length - 22 - 0xffff);
  for (let index = buffer.length - 22; index >= lowest; index -= 1) {
    if (buffer.readUInt32LE(index) === EOCD) return index;
  }
  return -1;
}

/**
 * Reads every entry, inflating deflated payloads and returning the bytes.
 * Throws on a malformed archive — a release gate must not shrug at one.
 */
function readZip(buffer) {
  const eocd = findEocd(buffer);
  if (eocd < 0) throw new Error('not a zip: no end-of-central-directory record');
  const claimedCount = buffer.readUInt16LE(eocd + 10);
  let cursor = buffer.readUInt32LE(eocd + 16);
  const entries = [];

  for (let index = 0; index < claimedCount; index += 1) {
    if (buffer.readUInt32LE(cursor) !== CENTRAL) {
      throw new Error(`central directory record ${index} has a bad signature at ${cursor}`);
    }
    const madeBy = buffer.readUInt16LE(cursor + 4);
    const method = buffer.readUInt16LE(cursor + 10);
    const crc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const externalAttributes = buffer.readUInt32LE(cursor + 38);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');

    if (buffer.readUInt32LE(localOffset) !== LOCAL) {
      throw new Error(`local header for ${name} has a bad signature at ${localOffset}`);
    }
    // The local header carries its own name/extra lengths, which may legitimately
    // differ from the central directory's — trust the local ones for seeking.
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const localMethod = buffer.readUInt16LE(localOffset + 8);
    const payloadStart = localOffset + 30 + localNameLength + localExtraLength;
    const payload = buffer.subarray(payloadStart, payloadStart + compressedSize);
    if (payload.length !== compressedSize) {
      throw new Error(`truncated payload for ${name}: ${payload.length} of ${compressedSize} bytes`);
    }
    if (localMethod !== method) throw new Error(`compression method disagrees for ${name}`);

    let data = Buffer.alloc(0);
    if (method === 8) data = zlib.inflateRawSync(payload);
    else if (method === 0) data = Buffer.from(payload);
    else throw new Error(`${name}: unsupported compression method ${method}`);

    entries.push({
      name,
      isDir: name.endsWith('/'),
      method,
      crc,
      size,
      data,
      // "version made by" high byte 3 = UNIX, so the high 16 bits are the st_mode.
      unixHost: ((madeBy >>> 8) & 0xff) === 3,
      mode: (externalAttributes >>> 16) & 0xffff,
      msdosDirBit: (externalAttributes & 0x10) !== 0,
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  if (cursor !== eocd) {
    throw new Error(`central directory ends at ${cursor} but the EOCD starts at ${eocd}`);
  }
  return { entries, claimedCount };
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// ---------------------------------------------------------------------------
// extraction
// ---------------------------------------------------------------------------

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Extracts with the archive's own modes, refusing anything that escapes dest. */
function extract(entries, dest) {
  for (const entry of entries) {
    if (path.isAbsolute(entry.name) || entry.name.split('/').includes('..')) {
      throw new Error(`unsafe path in archive: ${entry.name}`);
    }
    const target = path.join(dest, entry.name);
    if (!target.startsWith(dest + path.sep) && target !== dest) {
      throw new Error(`path escapes the destination: ${entry.name}`);
    }
    if (entry.isDir) {
      fs.mkdirSync(target, { recursive: true });
      fs.chmodSync(target, entry.mode & 0o7777);
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, entry.data);
      fs.chmodSync(target, entry.mode & 0o7777);
    }
  }
}

// ---------------------------------------------------------------------------
// environment probes
// ---------------------------------------------------------------------------

function hasNodeModules() {
  return fs.existsSync(path.join(PACKAGE_DIR, 'node_modules'));
}

function browserExecutable() {
  if (!hasNodeModules()) return null;
  try {
    const { chromium } = require(path.join(PACKAGE_DIR, 'node_modules', 'playwright'));
    const exe = chromium.executablePath();
    return exe && fs.existsSync(exe) ? exe : null;
  } catch {
    return null;
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForUrl(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  return false;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const requested = process.argv[2];
  const zipPath = requested
    ? path.resolve(requested)
    : path.join(PACKAGE_DIR, '..', 'dist', `${WRAPPER}.zip`);

  process.stdout.write(`\x1b[1mverify-release\x1b[0m — grading ${zipPath}\n`);
  if (!fs.existsSync(zipPath)) {
    process.stderr.write(`verify-release: FAIL — no archive at ${zipPath}\n`);
    process.stderr.write('Build it first: npm run pack:delivery\n');
    process.exit(1);
  }

  const archive = fs.readFileSync(zipPath);
  let parsed;
  try {
    parsed = readZip(archive);
  } catch (error) {
    process.stderr.write(`verify-release: FAIL — ${error.message}\n`);
    process.exit(1);
  }
  const { entries } = parsed;
  const files = entries.filter(entry => !entry.isDir);
  const dirs = entries.filter(entry => entry.isDir);

  // --- 1. archive integrity -------------------------------------------------
  section('1. Archive integrity (what unzip -q never reports)');
  eq('central directory entry count', entries.length, parsed.claimedCount);

  const crcBad = files.filter(entry => pack.crc32(entry.data) !== entry.crc);
  truthy(
    crcBad.length === 0
      ? `CRC-32 verified for all ${files.length} files`
      : `CRC-32 mismatch in ${crcBad.length} file(s): ${crcBad
          .slice(0, 3)
          .map(e => e.name)
          .join(', ')}`,
    crcBad.length === 0,
  );
  const sizeBad = files.filter(entry => entry.data.length !== entry.size);
  eq('files whose length matches the central directory', files.length - sizeBad.length, files.length);

  const badDirModes = dirs.filter(
    entry => !entry.unixHost || (entry.mode & 0o170000) !== 0o040000 || (entry.mode & 0o777) === 0,
  );
  eq('directories with a usable Unix mode', dirs.length - badDirModes.length, dirs.length);
  const badFileModes = files.filter(
    entry => !entry.unixHost || (entry.mode & 0o170000) !== 0o100000 || (entry.mode & 0o777) === 0,
  );
  eq('files with a readable Unix mode', files.length - badFileModes.length, files.length);

  const unsafe = entries.filter(entry => path.isAbsolute(entry.name) || entry.name.split('/').includes('..'));
  eq('entries with a safe relative path', entries.length - unsafe.length, entries.length);
  // Symlink entries (mode 0o120000) would let an archive write outside itself.
  const links = entries.filter(entry => (entry.mode & 0o170000) === 0o120000);
  eq('symlink entries', links.length, 0);

  const topLevel = [...new Set(entries.map(entry => entry.name.split('/')[0]))];
  eq('top-level entries', topLevel.length, 1);
  eq('top-level name', topLevel[0], WRAPPER);

  // KNOWN GAP (R6, 2026-09-06) — read this before adding a check here.
  //
  // This section does NOT assert that entry names are unique. A zip may legally carry
  // the same path twice, and which copy an extractor keeps is implementation-defined,
  // so a duplicate is a real defect that every check above will happily call green:
  // CRC-32, lengths, modes, paths and the top-level count all pass on a duplicated file.
  //
  // It has happened. `pack-delivery.js` used to push a freshly generated
  // DELIVERY-MANIFEST.json onto the entry list without first removing the stale one
  // staged from the source tree, so repacking an EXTRACTED bundle shipped the manifest
  // twice — and the shipped 7.4.1 zip did exactly that. It was caught by the manifest
  // arithmetic in section 2, not by any integrity check here, i.e. by luck rather than
  // by design.
  //
  // The fix and its regression gate live at the PRODUCER: see
  // `tests/packaging.test.js` -> "repacking an EXTRACTED bundle does not double-count or
  // duplicate the manifest". That gate proves the packer never emits a duplicate; it
  // cannot prove that an ARBITRARY archive handed to this script is free of them.
  // Closing the gap properly means asserting uniqueness over `entries` right here, so
  // the artifact is graded rather than its producer trusted. Deliberately left open for
  // now; documented so the next person does not have to rediscover it from a shipped zip.

  const heavy = files.filter(
    entry => /\.webm$|\.zip$|\.tgz$/.test(entry.name) || entry.name.includes('node_modules/'),
  );
  eq('heavy or regenerable entries shipped by mistake', heavy.length, 0);

  // --- 2. manifest honesty --------------------------------------------------
  section('2. Manifest says what the archive actually is');
  const manifestEntry = files.find(entry => path.basename(entry.name) === pack.MANIFEST_NAME);
  if (!manifestEntry) {
    bad(`no ${pack.MANIFEST_NAME} inside the archive`);
  } else {
    const inside = JSON.parse(manifestEntry.data.toString('utf8'));
    eq('manifest version', inside.version, VERSION);
    eq('manifest bundle folder', inside.bundle, WRAPPER);
    eq('manifest fileCount (excludes the manifest)', inside.fileCount, files.length - 1);
    eq(
      'manifest bytes (excludes the manifest)',
      inside.bytes,
      files
        .filter(entry => entry.name !== manifestEntry.name)
        .reduce((total, entry) => total + entry.size, 0),
    );
    truthy('manifest declares itself shipped inside the archive', inside.manifestShippedInside === true);
    truthy(
      'zipSha256 is NOT inside the archive (a zip cannot contain its own hash)',
      inside.zipSha256 === undefined,
    );
    // `git.dirty` is TRI-state, not boolean: `false` (clean checkout), `true`
    // (uncommitted changes) and `null` when `pack-delivery.js#gitDirty()` could not
    // ask git at all — no `.git`, or git not on PATH. Collapsing that with `eq(…,
    // false)` graded "provenance unknown" as if it were "provenance bad", which is
    // the one case this script is guaranteed to meet: `.git` is never shipped, so
    // anyone who extracts the zip and follows DELIVERY.md §7 repacks outside a
    // checkout and got a red gate on a perfectly good archive. §7 is explicit that a
    // gate which could not run must SKIP with a reason rather than fail or silently
    // pass, and tests/packaging.test.js already treats the same field as tri-state.
    // Only a tree that git actively reports as dirty is a real failure.
    const packedDirty = inside.git ? inside.git.dirty : undefined;
    if (packedDirty === null || packedDirty === undefined) {
      skip('manifest git.dirty — packed outside a git checkout, so provenance cannot be graded');
    } else {
      eq('manifest git.dirty', packedDirty, false);
    }

    // contentsSha256 must recompute from the bytes that actually shipped.
    const lines = files
      .filter(entry => entry.name !== manifestEntry.name)
      // entry.name carries the wrapper prefix, and so does the `relative` path
      // contentsSha256 hashes — stripping it here would recompute a different value.
      .map(entry => `${entry.name}\0${sha256(entry.data)}`)
      .sort();
    const recomputed = sha256(Buffer.from(`${lines.join('\n')}\n`, 'utf8'));
    eq('contentsSha256 recomputed from the extracted bytes', recomputed, inside.contentsSha256);

    const sidePath = path.join(path.dirname(zipPath), pack.MANIFEST_NAME);
    if (fs.existsSync(sidePath)) {
      const side = readJson(sidePath);
      eq('side manifest zipSha256 equals the real archive', sha256(archive), side.zipSha256);
      eq('side manifest zipBytes equals the real archive', archive.length, side.zipBytes);
      eq('side and inner manifests agree on contentsSha256', side.contentsSha256, inside.contentsSha256);
    } else {
      skip(`no side ${pack.MANIFEST_NAME} beside the archive to cross-check zipSha256`);
    }
  }

  // --- extract --------------------------------------------------------------
  const dest = tmpDir('usereye-verify-release-');
  try {
    extract(entries, dest);
  } catch (error) {
    bad(`extraction failed: ${error.message}`);
    return finish(dest);
  }
  const bundle = path.join(dest, WRAPPER);
  const pkgDir = path.join(bundle, 'UserEye');

  // --- 3. §6 packaging clarity ---------------------------------------------
  section('3. §6 packaging clarity');
  const pkg = readJson(path.join(pkgDir, 'package.json'));
  eq('package.json version', pkg.version, VERSION);
  eq('zip filename version', WRAPPER.replace(/^usereye-|-balanced$/g, ''), VERSION);

  // `bundle` IS the wrapper folder, so the roadmap's */UserEye/package.json glob is
  // one level below it. A second hit is the double-nesting defect 7.4.0 shipped.
  const productManifests = files
    .filter(entry => /(^|\/)UserEye\/package\.json$/.test(entry.name))
    .map(entry => entry.name);
  eq('acceptance glob */UserEye/package.json resolves exactly once', productManifests.length, 1);
  eq('the one match sits directly under the wrapper', productManifests[0], `${WRAPPER}/UserEye/package.json`);

  const cliVersion = spawnSync(process.execPath, [path.join(pkgDir, 'bin', 'usereye.js'), '--version'], {
    encoding: 'utf8',
  });
  eq('CLI --version from the extracted tree', (cliVersion.stdout || '').trim(), VERSION);

  for (const doc of ['CURRENT.md', 'DELIVERY.md']) {
    const text = fs.readFileSync(path.join(bundle, doc), 'utf8');
    const stated = /\*\*(?:Version|Package):\*\*[^\n]*?(\d+\.\d+\.\d+)/.exec(text);
    eq(`${doc} states the shipping version`, stated ? stated[1] : '(none found)', VERSION);
    const stale = /\b7\.[0-3]\.\d+\b/.exec(text);
    eq(`${doc} names no superseded generation`, stale ? stale[0] : 'none', 'none');
  }

  const rootDocs = fs
    .readdirSync(bundle)
    .filter(name => name.endsWith('.md'))
    .sort();
  eq(
    'delivery root carries exactly the three start-here docs',
    rootDocs.join(','),
    'CURRENT.md,DELIVERY.md,README.md',
  );
  const currentLines = fs.readFileSync(path.join(bundle, 'CURRENT.md'), 'utf8').split('\n').length;
  truthy(`CURRENT.md is ${currentLines} lines (budget 40)`, currentLines <= 40);
  truthy(
    'CURRENT.md says it is the place to start',
    /start here/i.test(fs.readFileSync(path.join(bundle, 'CURRENT.md'), 'utf8')),
  );

  const testsLine = /\*\*Tests:\*\* ([^\n]+)/.exec(fs.readFileSync(path.join(bundle, 'CURRENT.md'), 'utf8'));
  truthy(
    'CURRENT.md quotes a concrete test run',
    Boolean(testsLine) && /\d+ total · \d+ pass · 0 fail/.test(testsLine[1]),
  );

  // Types must accept the widened locales — compile the shipped .d.ts for real.
  const tsc = path.join(PACKAGE_DIR, 'node_modules', '.bin', 'tsc');
  if (fs.existsSync(tsc)) {
    const probe = tmpDir('usereye-verify-types-');
    const probeFile = path.join(probe, 'probe.ts');
    fs.writeFileSync(
      probeFile,
      [
        `import type { UserEyeOptions, UserEyeReportLocale } from '${path.join(pkgDir, 'types', 'index')}';`,
        "const locales: UserEyeReportLocale[] = ['en', 'pt', 'pt-BR', 'es', 'fr', 'auto'];",
        "const calm: UserEyeOptions = { reportLocale: 'es', recordVideo: 'on-failure' };",
        "const loud: UserEyeOptions = { reportLocale: 'auto', recordVideo: true };",
        'console.log(locales, calm, loud);',
        '',
      ].join('\n'),
    );
    const compiled = spawnSync(
      tsc,
      ['--noEmit', '--skipLibCheck', '--target', 'es2022', '--module', 'commonjs', probeFile],
      {
        encoding: 'utf8',
        cwd: probe,
      },
    );
    truthy(
      compiled.status === 0
        ? "shipped types accept reportLocale 'es' | 'auto' and recordVideo 'on-failure'"
        : `shipped types failed to compile: ${(compiled.stdout || compiled.stderr || '').split('\n')[0]}`,
      compiled.status === 0,
    );
  } else {
    skip('typescript is not installed, so the shipped .d.ts was not compiled');
  }

  // --- 4. §6 calmer defaults ------------------------------------------------
  section('4. §6 calmer defaults (read from the extracted package)');
  // config.js pulls in only fs/path/url/i18n, so this needs no dependency tree.
  let defaults = null;
  try {
    defaults = require(path.join(pkgDir, 'config.js')).DEFAULT_CONFIG;
  } catch (error) {
    bad(`could not read DEFAULT_CONFIG from the extracted tree: ${error.message}`);
  }
  if (defaults) {
    eq('recordVideo', defaults.recordVideo, 'on-failure');
    eq('misclick.policy', defaults.misclick.policy, 'stable-only');
    eq('findings.minConfidence', defaults.findings.minConfidence, 'medium');
    eq('findings.gateConfidence', defaults.findings.gateConfidence, 'high');
    eq('extensions.enabled', defaults.extensions.enabled, false);
    eq('userJourney.enabled', defaults.userJourney.enabled, false);

    const scaffold = require(path.join(pkgDir, 'bin', 'usereye-init.js')).CONFIG_TEMPLATE;
    // The template opens with a COMMENTED opt-back example naming the loud values,
    // so read only the lines a generated config would actually execute.
    const live = scaffold
      .split('\n')
      .filter(line => !line.trim().startsWith('//'))
      .join('\n');
    const knobs = source =>
      [
        /recordVideo: '([^']+)'/.exec(source)?.[1],
        /policy: '([^']+)'/.exec(source)?.[1],
        /minConfidence: '([^']+)'/.exec(source)?.[1],
      ].join('/');
    eq(
      'usereye init teaches the same calm profile the runtime ships',
      knobs(live),
      `${defaults.recordVideo}/${defaults.misclick.policy}/${defaults.findings.minConfidence}`,
    );

    const example = fs.readFileSync(path.join(pkgDir, 'usereye.config.example.js'), 'utf8');
    truthy(
      'the example config mirrors the calm defaults',
      /recordVideo: 'on-failure'/.test(example) && /policy: 'stable-only'/.test(example),
    );
  }

  // --- 5. live runs --------------------------------------------------------
  section('5. §6 live runs against the extracted CLI');
  const exe = browserExecutable();
  if (!exe) {
    skip(
      'no Playwright browser installed — run `npx playwright install chromium` to grade the live sections',
    );
  } else if (!hasNodeModules()) {
    skip('no node_modules beside the package to link into the extracted tree');
  } else {
    // The archive ships no node_modules by design; the extracted package.json and
    // lockfile are identical to the installed tree, so linking it is faithful.
    fs.symlinkSync(path.join(PACKAGE_DIR, 'node_modules'), path.join(pkgDir, 'node_modules'), 'dir');

    const port = await freePort();
    const server = spawn(process.execPath, [path.join(bundle, 'demo', 'live-server.js')], {
      env: { ...process.env, PORT: String(port) },
      cwd: bundle,
      stdio: 'ignore',
    });
    const url = `http://127.0.0.1:${port}/vela/`;
    try {
      if (!(await waitForUrl(url))) {
        bad(`the bundle's own demo server did not come up on :${port}`);
      } else {
        ok(`the extracted demo/live-server.js serves ${url}`);

        const run = async (label, args, cwd) => {
          const out = tmpDir('usereye-verify-run-');
          const result = spawnSync(
            process.execPath,
            [path.join(pkgDir, 'bin', 'usereye.js'), ...args, '--out', out],
            {
              encoding: 'utf8',
              cwd,
              timeout: 300_000,
            },
          );
          return {
            label,
            out,
            code: result.status,
            stdout: result.stdout || '',
            stderr: result.stderr || '',
          };
        };

        // Bare: no config file anywhere, so DEFAULT_CONFIG is what runs.
        const bareCwd = tmpDir('usereye-verify-bare-');
        const bare = await run('bare', ['auto', '--url', url, '--mode', 'quick'], bareCwd);
        eq('bare `auto --mode quick` exits 0', bare.code, 0);
        eq(
          'bare run retains no webm',
          fs.readdirSync(bare.out).filter(name => name.endsWith('.webm')).length,
          0,
        );
        const bareResult = readJson(path.join(bare.out, 'result.json'));
        truthy('bare run passes its quality gates', bareResult.qualityGates.passed === true);
        truthy(
          'bare run records the discard rather than staying silent',
          bareResult.artifacts.videoDiscarded === true,
        );
        truthy('bare result.json carries the full evidence list', Array.isArray(bareResult.issuesAll));
        truthy(
          'bare console prints the Actionable/Signals split',
          /Actionable: \d+ · Signals: \d+/.test(bare.stdout),
        );
        truthy(
          'bare console explains the video outcome',
          /Video: discarded — clean run/.test(bare.stdout) || /Video: kept — /.test(bare.stdout),
        );

        // Opt-back: the pre-7.4.1 loud profile must still be reachable.
        const loudCwd = tmpDir('usereye-verify-loud-');
        fs.writeFileSync(
          path.join(loudCwd, 'usereye.config.cjs'),
          // reportFormat has no CLI flag and defaults to ['html', 'md'], so SARIF is
          // graded here — the forensic profile is where a caller would ask for it.
          'module.exports = {\n' +
            '  recordVideo: true,\n' +
            "  misclick: { policy: 'aggressive' },\n" +
            "  findings: { minConfidence: 'low' },\n" +
            "  reportFormat: ['json', 'sarif'],\n" +
            '};\n',
        );
        const loud = await run(
          'loud',
          ['auto', '--url', url, '--mode', 'quick', '--config', 'usereye.config.cjs'],
          loudCwd,
        );
        eq('loud opt-back exits 0', loud.code, 0);
        eq(
          'loud opt-back retains the webm even on a clean run',
          fs.readdirSync(loud.out).filter(name => name.endsWith('.webm')).length,
          1,
        );
        const resolved = readJson(path.join(loud.out, 'resolved-config.json'));
        eq('resolved recordVideo', resolved.recordVideo, true);
        eq('resolved misclick.policy', resolved.misclick.policy, 'aggressive');
        eq('resolved findings.minConfidence', resolved.findings.minConfidence, 'low');
        truthy(
          'loud console says the video was kept because recordVideo: true',
          /Video: kept — recordVideo: true/.test(loud.stdout),
        );

        // SARIF must carry the shipping version and no dead link.
        const sarifPath = path.join(loud.out, 'usereye.sarif');
        if (fs.existsSync(sarifPath)) {
          const sarif = JSON.parse(fs.readFileSync(sarifPath, 'utf8'));
          eq('SARIF tool version', sarif.runs[0].tool.driver.version, VERSION);
          truthy(
            'SARIF omits informationUri rather than emitting a dead link',
            sarif.runs[0].tool.driver.informationUri === undefined,
          );
        } else {
          bad(`reportFormat asked for sarif but no usereye.sarif was written to ${loud.out}`);
        }
      }
    } finally {
      server.kill('SIGTERM');
    }
  }

  // --- 6. §6 compatibility -------------------------------------------------
  section('6. §6 compatibility — exit codes 0 | 1 | 2');
  if (!exe || !hasNodeModules()) {
    skip('exit-code matrix needs a browser and a dependency tree');
  } else {
    if (!fs.existsSync(path.join(pkgDir, 'node_modules'))) {
      fs.symlinkSync(path.join(PACKAGE_DIR, 'node_modules'), path.join(pkgDir, 'node_modules'), 'dir');
    }
    const cli = path.join(pkgDir, 'bin', 'usereye.js');
    const usage = spawnSync(process.execPath, [cli, 'auto', '--bogus-flag'], { encoding: 'utf8' });
    eq('usage error exits 2', usage.status, 2);
    const missingUrl = spawnSync(process.execPath, [cli, 'observe'], { encoding: 'utf8' });
    eq('missing URL exits 2', missingUrl.status, 2);
    const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
    eq('--help exits 0', help.status, 0);
  }

  // --- 7. §10 definition of done ------------------------------------------
  section('7. §10 definition of done');
  const firstLine = fs.readFileSync(path.join(bundle, 'CURRENT.md'), 'utf8').split('\n')[0];
  eq(
    '1. a reader learns the version from line 1 of the start-here doc',
    /\d+\.\d+\.\d+/.exec(firstLine)?.[0],
    VERSION,
  );
  truthy(
    '2. the runtime defaults equal the calm profile init teaches',
    Boolean(defaults) && defaults.recordVideo === 'on-failure',
  );
  const engine = fs.readFileSync(path.join(pkgDir, 'user-eye.js'), 'utf8');
  truthy(
    '3. JSDoc documents the on-failure mode',
    /@property \{boolean\|'on-failure'\} \[recordVideo/.test(engine),
  );
  truthy(
    '3. JSDoc documents all five report locales',
    /@property \{'en'\|'pt'\|'pt-BR'\|'es'\|'fr'\|'auto'\}/.test(engine),
  );
  truthy(
    '4. pack:delivery derives the archive name from package.json',
    /pack-delivery/.test(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')),
  );
  truthy(
    '4. the release gate ships inside the bundle too',
    fs.existsSync(path.join(pkgDir, 'scripts', 'verify-release.js')),
  );

  return finish(dest);
}

function finish(dest) {
  process.stdout.write(`\n\x1b[1m==== ${passed} PASS · ${failed} FAIL · ${skipped} SKIP ====\x1b[0m\n`);
  if (failed) {
    for (const failure of failures) process.stderr.write(`verify-release: FAIL — ${failure}\n`);
  } else {
    process.stdout.write(
      `verify-release: OK — ${WRAPPER}.zip extracts, verifies and behaves as documented.\n`,
    );
  }
  fs.rmSync(dest, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`verify-release: FAIL — ${error.stack || error.message}\n`);
    process.exit(1);
  });
}

module.exports = { readZip, findEocd, extract, WRAPPER };
