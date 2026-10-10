'use strict';

/**
 * Release-packaging gates (ROADMAP-PACKAGING-AND-DEFAULTS Phases A / F).
 *
 * The 7.4.0 bundle was hand-assembled and shipped a 7.1.1 label around a 7.4.0
 * package. These tests cover the machinery that makes that unshippable:
 *
 *   - `scripts/check-delivery-names.js` passes on the real bundle and FAILS on a
 *     deliberately stale one (a gate that cannot fail is not a gate);
 *   - the dependency-free ZIP writer produces archives that are structurally
 *     valid, round-trip their contents and are byte-deterministic;
 *   - staging excludes exactly the heavy/regenerable material it promises to;
 *   - the `**Tests:**` line in the delivery docs can only come from a real run.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const deliveryRoot = path.resolve(root, '..');
const pack = require('../scripts/pack-delivery.js');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runScript(script, args = [], options = {}) {
  return spawnSync(process.execPath, [path.join(root, 'scripts', script), ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: options.timeout ?? 120_000,
    env: { ...process.env, ...(options.env || {}) },
  });
}

const isBundle =
  path.basename(root) === 'UserEye' &&
  fs.existsSync(path.join(deliveryRoot, 'UserEye', 'package.json')) &&
  fs.existsSync(path.join(deliveryRoot, 'CURRENT.md'));

// ---------------------------------------------------------------------------
// Minimal ZIP reader — enough to prove the writer emits a valid archive without
// depending on an `unzip` binary being installed.
// ---------------------------------------------------------------------------

function readZip(buffer) {
  let eocd = -1;
  for (let index = buffer.length - 22; index >= 0; index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) {
      eocd = index;
      break;
    }
  }
  assert.notEqual(eocd, -1, 'archive must end with an end-of-central-directory record');
  const count = buffer.readUInt16LE(eocd + 10);
  let cursor = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let index = 0; index < count; index += 1) {
    assert.equal(buffer.readUInt32LE(cursor), 0x02014b50, 'central directory signature');
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');

    assert.equal(buffer.readUInt32LE(localOffset), 0x04034b50, 'local file header signature');
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const payload = buffer.subarray(dataStart, dataStart + compressedSize);
    const data = method === 0 ? Buffer.from(payload) : zlib.inflateRawSync(payload);
    assert.equal(data.length, uncompressedSize, `${name}: uncompressed size matches the header`);
    entries.set(name, data);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

// ---------------------------------------------------------------------------
// A3 / F3 — the delivery naming gate
// ---------------------------------------------------------------------------

test('packaging: the delivery naming gate passes on this bundle', () => {
  const run = runScript('check-delivery-names.js');
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /delivery-names: OK/);
  if (isBundle) {
    assert.match(run.stdout, /delivery root:/, 'it really inspected the bundle, not just the package');
  }
});

test('packaging: the gate FAILS on a stale generation (a gate that cannot fail is not a gate)', () => {
  const bundle = tmpDir('usereye-stale-bundle-');
  fs.mkdirSync(path.join(bundle, 'UserEye'), { recursive: true });
  fs.writeFileSync(
    path.join(bundle, 'UserEye', 'package.json'),
    JSON.stringify({ name: 'usereye', version: require('../package.json').version }),
  );
  fs.writeFileSync(path.join(bundle, 'CURRENT.md'), '# UserEye\n\n**Version:** 7.1.1\n');
  fs.writeFileSync(path.join(bundle, 'DELIVERY.md'), '# Delivery\n\n**Version:** 7.1.1\n');
  fs.mkdirSync(path.join(bundle, 'UserEye-7.1.1-BALANCED'), { recursive: true });

  const run = runScript('check-delivery-names.js', ['--root', bundle]);
  assert.equal(run.status, 1, 'a 7.1.1-labelled bundle must be rejected');
  assert.match(run.stderr, /stale generation "7\.1\.1"/);
  assert.match(run.stderr, /wrapper directory at the root is labelled 7\.1\.1 but the package is/);
});

test('packaging: the gate FAILS when CURRENT.md and package.json disagree', () => {
  const bundle = tmpDir('usereye-mismatch-bundle-');
  const version = require('../package.json').version;
  fs.mkdirSync(path.join(bundle, 'UserEye'), { recursive: true });
  fs.writeFileSync(
    path.join(bundle, 'UserEye', 'package.json'),
    JSON.stringify({ name: 'usereye', version }),
  );
  fs.writeFileSync(path.join(bundle, 'CURRENT.md'), `# UserEye\n\n**Version:** ${version}\n`);
  fs.writeFileSync(path.join(bundle, 'DELIVERY.md'), '# Delivery\n\n**Version:** 9.9.9\n');
  const run = runScript('check-delivery-names.js', ['--root', bundle]);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /DELIVERY\.md declares version "9\.9\.9"/);
});

test('packaging: the gate skips layout checks (green) for a standalone package checkout', () => {
  const standalone = tmpDir('usereye-standalone-');
  const run = runScript('check-delivery-names.js', ['--root', standalone]);
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /is not a delivery bundle|no delivery bundle detected|--root not found/);
  const strict = runScript('check-delivery-names.js', ['--root', standalone, '--strict']);
  assert.equal(strict.status, 1, '--strict must fail when there is nothing to verify');
});

test('packaging: a half-built bundle still fails loudly instead of being skipped', () => {
  const half = tmpDir('usereye-half-bundle-');
  fs.writeFileSync(path.join(half, 'CURRENT.md'), '# UserEye\n\n**Version:** 7.4.1\n');
  const run = runScript('check-delivery-names.js', ['--root', half]);
  assert.equal(run.status, 1, 'a bundle with a start-here doc but no package is broken, not absent');
  assert.match(run.stderr, /UserEye\/package\.json must be reachable at exactly one level/);
  assert.match(run.stderr, /DELIVERY\.md is missing from the delivery root/);
});

test('packaging: package metadata points nowhere dead (Phase B5)', () => {
  const pkg = require('../package.json');
  for (const field of ['repository', 'homepage', 'bugs']) {
    const declared = pkg[field];
    const url = typeof declared === 'string' ? declared : declared?.url;
    assert.doesNotMatch(
      String(url || ''),
      /github\.com\/usereye\//i,
      `${field} must not point at the verified-404 org`,
    );
  }
  // The gate itself must catch a regression, not just the current state.
  const source = fs.readFileSync(path.join(root, 'scripts', 'check-delivery-names.js'), 'utf8');
  assert.match(source, /points at a verified-404 URL/, 'the dead-link rule is implemented');
  assert.match(source, /nested delivery bundle inside the bundle/, 'the double-nesting rule is implemented');
  const run = runScript('check-delivery-names.js');
  assert.equal(run.status, 0, run.stderr || run.stdout);
});

test('packaging: npm scripts wire the gate into checks and expose both pack targets (F1/F4)', () => {
  const scripts = require('../package.json').scripts;
  assert.match(scripts.checks, /check-delivery-names\.js/);
  assert.equal(scripts['pack:delivery'], 'node scripts/pack-delivery.js');
  assert.equal(scripts['pack:npm'], 'node scripts/pack-delivery.js --npm-only');
  // 7.5.1 (roadmap 0.4): the docs' test summary is a consequence of a run, and the
  // release chain refreshes it BEFORE packing so the shipped numbers cannot be stale.
  assert.equal(scripts['verify:delivery'], 'node scripts/pack-delivery.js --refresh-only');
  assert.match(scripts.release, /npm run verify:delivery && npm run pack:delivery/);
});

test('packaging: refreshTarballName derives the README tarball from package.json (0.3)', () => {
  const dir = tmpDir('usereye-tarball-');
  const readme = path.join(dir, 'README.md');
  fs.writeFileSync(
    readme,
    '# x\n\n```bash\nnpm install --save-dev ./usereye-7.4.1.tgz\n```\n\nor `usereye-1.0.0-beta.1.tgz`, but never usereye-7.4.1.zip\n',
  );
  assert.equal(pack.refreshTarballName(readme, '9.9.9'), true);
  const text = fs.readFileSync(readme, 'utf8');
  assert.match(text, /npm install --save-dev \.\/usereye-9\.9\.9\.tgz/);
  assert.match(text, /`usereye-9\.9\.9\.tgz`/, 'pre-release suffixes are replaced too');
  assert.match(text, /usereye-7\.4\.1\.zip/, 'only tarballs are touched');
  assert.equal(pack.refreshTarballName(readme, '9.9.9'), false, 'idempotent');
  assert.equal(pack.refreshTarballName(path.join(dir, 'missing.md')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('packaging: --refresh-only refuses --skip-tests (a refresh must come from a run)', () => {
  assert.throws(() => pack.parseArgv(['--refresh-only', '--skip-tests']), /cannot be combined/);
  assert.equal(pack.parseArgv(['--refresh-only']).refreshOnly, true);
  assert.equal(pack.parseArgv([]).refreshOnly, false);
});

test('packaging: the shipped-docs gate rejects a hand-formatted **Tests:** line (C1)', () => {
  // Re-run the exact assertions of the bundle gate against the 7.5.0 line that slipped
  // through, so the regression is pinned even in a standalone checkout.
  const shipped = '**Tests:** 327 total · 323 pass · 0 fail · **4 skipped**';
  const header = shipped.match(/^\*\*Tests:\*\*(.*)$/m);
  assert.ok(header);
  assert.match(header[1], /[*_`]/, 'the bold that broke 7.5.0 is detected as markdown');
  assert.equal(
    shipped.match(/^\*\*Tests:\*\* (\d+) total · (\d+) pass · (\d+) fail · (\d+) skipped/m),
    null,
    'and the machine-shaped regex does not accept it',
  );
  const generated = pack.testSummaryLine({ tests: 327, pass: 325, fail: 0, skipped: 2 });
  assert.doesNotMatch(generated, /[*_`]/, 'the generator never emits markdown');
  const ok = `**Tests:** ${generated}`.match(
    /^\*\*Tests:\*\* (\d+) total · (\d+) pass · (\d+) fail · (\d+) skipped/m,
  );
  assert.ok(ok);
  assert.equal(Number(ok[1]), Number(ok[2]) + Number(ok[3]) + Number(ok[4]));
});

// ---------------------------------------------------------------------------
// F1 — staging rules
// ---------------------------------------------------------------------------

test('packaging: staging excludes dependency caches and heavy regenerable evidence', () => {
  const stats = { isDirectory: () => false };
  const dirStats = { isDirectory: () => true };

  for (const excluded of ['node_modules', '.git', 'artifacts', 'live-runs', 'coverage', 'dist']) {
    assert.equal(pack.shouldInclude(path.join(excluded, 'x.js'), stats), false, `${excluded}/ excluded`);
    assert.equal(
      pack.shouldInclude(path.join('UserEye', excluded), dirStats),
      false,
      `${excluded}/ excluded`,
    );
  }
  for (const excluded of ['session.webm', 'run.trace', 'bundle.zip', 'usereye.tgz', 'clip.mp4']) {
    assert.equal(pack.shouldInclude(excluded, stats), false, `${excluded} excluded`);
  }
  assert.equal(pack.shouldInclude('UserEye/config.js', stats), true);
  assert.equal(pack.shouldInclude(path.join('demo', 'vela-site', 'site', 'index.html'), stats), true);
  assert.equal(pack.shouldInclude(path.join('docs', 'evidence', 'run-log.txt'), stats), true);
  assert.equal(pack.shouldInclude('UserEye', dirStats), true);
});

test('packaging: stageTree copies the bundle flat and drops everything excluded', () => {
  const source = tmpDir('usereye-stage-src-');
  const target = tmpDir('usereye-stage-dst-');
  fs.mkdirSync(path.join(source, 'UserEye', 'node_modules', 'left-pad'), { recursive: true });
  fs.mkdirSync(path.join(source, 'demo', 'vela-site'), { recursive: true });
  fs.mkdirSync(path.join(source, 'docs', 'audits'), { recursive: true });
  fs.writeFileSync(path.join(source, 'CURRENT.md'), '# start here\n');
  fs.writeFileSync(path.join(source, 'UserEye', 'package.json'), '{"version":"7.4.1"}\n');
  fs.writeFileSync(path.join(source, 'UserEye', 'node_modules', 'left-pad', 'index.js'), 'nope\n');
  fs.writeFileSync(path.join(source, 'demo', 'session.webm'), 'heavy\n');
  fs.writeFileSync(path.join(source, 'demo', 'vela-site', 'index.html'), '<html></html>\n');
  fs.writeFileSync(path.join(source, 'docs', 'audits', '2026-09-06-audit.md'), '# audit\n');

  const entries = pack.stageTree(source, target);
  const names = entries.map(entry => entry.relative).sort();
  assert.deepEqual(names, [
    'CURRENT.md',
    'UserEye/',
    'UserEye/package.json',
    'demo/',
    'demo/vela-site/',
    'demo/vela-site/index.html',
    'docs/',
    'docs/audits/',
    'docs/audits/2026-09-06-audit.md',
  ]);
  assert.equal(fs.readFileSync(path.join(target, 'CURRENT.md'), 'utf8'), '# start here\n');
  assert.ok(!fs.existsSync(path.join(target, 'demo', 'session.webm')), 'no webm in the bundle');
  assert.ok(!fs.existsSync(path.join(target, 'UserEye', 'node_modules')), 'no node_modules in the bundle');
});

test('packaging: stageTree can nest everything under one generated top-level folder', () => {
  const source = tmpDir('usereye-stage-prefix-src-');
  const target = tmpDir('usereye-stage-prefix-dst-');
  fs.mkdirSync(path.join(source, 'UserEye'), { recursive: true });
  fs.writeFileSync(path.join(source, 'CURRENT.md'), '# start here\n');
  fs.writeFileSync(path.join(source, 'UserEye', 'config.js'), 'module.exports = {};\n');

  const wrapper = 'usereye-7.4.1-balanced';
  const entries = pack.stageTree(source, target, wrapper);
  assert.deepEqual(entries.map(entry => entry.relative).sort(), [
    `${wrapper}/CURRENT.md`,
    `${wrapper}/UserEye/`,
    `${wrapper}/UserEye/config.js`,
  ]);
  assert.ok(fs.existsSync(path.join(target, wrapper, 'UserEye', 'config.js')));
  assert.ok(!fs.existsSync(path.join(target, 'UserEye')), 'nothing leaks outside the wrapper');

  // The archive must therefore answer to the release gate's `*\/UserEye/package.json`.
  const archive = pack.createZip(entries, target);
  const names = [...readZip(archive).keys()];
  assert.ok(names.includes(`${wrapper}/CURRENT.md`));
  assert.ok(
    names.every(name => name.startsWith(`${wrapper}/`)),
    'exactly one nesting level',
  );
});

// ---------------------------------------------------------------------------
// F1/F2 — the ZIP writer
// ---------------------------------------------------------------------------

test('packaging: crc32 matches the standard check vector', () => {
  assert.equal(pack.crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(pack.crc32(Buffer.alloc(0)), 0);
});

test('packaging: createZip emits a valid archive whose contents round-trip', () => {
  const stage = tmpDir('usereye-zip-');
  const text = 'UserEye delivery — ünïcödé ✓\n'.repeat(50);
  fs.mkdirSync(path.join(stage, 'UserEye'), { recursive: true });
  fs.writeFileSync(path.join(stage, 'CURRENT.md'), text);
  fs.writeFileSync(path.join(stage, 'UserEye', 'package.json'), '{"version":"7.4.1"}\n');
  fs.writeFileSync(path.join(stage, 'tiny.txt'), 'x'); // incompressible-ish -> stored

  const entries = [
    { relative: 'UserEye/', directory: true },
    { relative: 'CURRENT.md', directory: false },
    { relative: 'UserEye/package.json', directory: false },
    { relative: 'tiny.txt', directory: false },
  ];
  const archive = pack.createZip(entries, stage);
  const read = readZip(archive);

  assert.deepEqual([...read.keys()].sort(), ['CURRENT.md', 'UserEye/', 'UserEye/package.json', 'tiny.txt']);
  assert.equal(read.get('CURRENT.md').toString('utf8'), text);
  assert.equal(read.get('UserEye/package.json').toString('utf8'), '{"version":"7.4.1"}\n');
  assert.equal(read.get('tiny.txt').toString('utf8'), 'x');
  assert.equal(read.get('UserEye/').length, 0, 'directory entries are empty');
});

test('packaging: the archive is byte-deterministic for a given tree', () => {
  const stage = tmpDir('usereye-zip-determinism-');
  fs.writeFileSync(path.join(stage, 'a.txt'), 'aaa\n');
  fs.writeFileSync(path.join(stage, 'b.txt'), 'bbb\n');
  const entries = [
    { relative: 'b.txt', directory: false },
    { relative: 'a.txt', directory: false },
  ];
  const env = { SOURCE_DATE_EPOCH: '1700000000' };
  const withEpoch = process.env.SOURCE_DATE_EPOCH;
  try {
    Object.assign(process.env, env);
    const first = pack.createZip(entries, stage);
    // Reversed input order must produce the same bytes (entries are sorted).
    const second = pack.createZip([...entries].reverse(), stage);
    assert.equal(pack.sha256(first), pack.sha256(second));
  } finally {
    if (withEpoch === undefined) delete process.env.SOURCE_DATE_EPOCH;
    else process.env.SOURCE_DATE_EPOCH = withEpoch;
  }
});

test('packaging: contentsSha256 is stable and ignores the manifest itself', () => {
  const stage = tmpDir('usereye-contents-hash-');
  fs.writeFileSync(path.join(stage, 'a.txt'), 'aaa\n');
  const entries = [{ relative: 'a.txt', directory: false }];
  const first = pack.contentsSha256(stage, entries);
  assert.equal(first, pack.contentsSha256(stage, entries), 'same tree -> same hash');

  fs.writeFileSync(path.join(stage, pack.MANIFEST_NAME), '{"generatedAt":"later"}\n');
  const withManifest = pack.contentsSha256(stage, [
    ...entries,
    { relative: pack.MANIFEST_NAME, directory: false },
  ]);
  assert.equal(first, withManifest, 'the timestamped manifest must not perturb the content hash');

  fs.writeFileSync(path.join(stage, 'a.txt'), 'changed\n');
  assert.notEqual(first, pack.contentsSha256(stage, entries), 'content changes are detected');
});

// ---------------------------------------------------------------------------
// B2 — the docs may only quote a real test run
// ---------------------------------------------------------------------------

const TAP_TAIL = `
not ok 1 - placeholder
ok 2 - another
1..230
# tests 230
# suites 0
# pass 228
# fail 0
# cancelled 0
# skipped 2
# todo 0
# duration_ms 61000
`;

test('packaging: parseTapSummary reads the counts npm test actually prints', () => {
  const summary = pack.parseTapSummary(TAP_TAIL);
  assert.deepEqual(summary, { tests: 230, pass: 228, fail: 0, skipped: 2 });
  assert.equal(pack.parseTapSummary('no tap here'), null);
  assert.equal(
    pack.testSummaryLine(summary),
    '230 total · 228 pass · 0 fail · 2 skipped (firefox/webkit not installed)',
  );
  assert.equal(
    pack.testSummaryLine({ tests: 10, pass: 10, fail: 0, skipped: 0 }),
    '10 total · 10 pass · 0 fail · 0 skipped',
  );
});

test('packaging: refreshTestSummary rewrites only the **Tests:** line', () => {
  const bundle = tmpDir('usereye-refresh-');
  fs.writeFileSync(
    path.join(bundle, 'CURRENT.md'),
    '# UserEye\n\n**Version:** 7.4.1\n**Tests:** 157 total · STALE\n\nBody mentions **Tests:** inline.\n',
  );
  fs.writeFileSync(path.join(bundle, 'DELIVERY.md'), '# Delivery\n\n**Tests:** 157 total · STALE\n');
  fs.writeFileSync(path.join(bundle, 'README.md'), '# untouched\n');

  const touched = pack.refreshTestSummary(bundle, '230 total · 228 pass · 0 fail · 2 skipped');
  assert.deepEqual(touched.sort(), ['CURRENT.md', 'DELIVERY.md']);

  const current = fs.readFileSync(path.join(bundle, 'CURRENT.md'), 'utf8');
  assert.match(current, /^\*\*Tests:\*\* 230 total · 228 pass · 0 fail · 2 skipped$/m);
  assert.doesNotMatch(current, /157 total/, 'the stale "157 tests" claim is gone');
  assert.match(current, /Body mentions \*\*Tests:\*\* inline\./, 'prose is left alone (only line starts)');
  assert.match(current, /^\*\*Version:\*\* 7\.4\.1$/m);
  assert.equal(fs.readFileSync(path.join(bundle, 'README.md'), 'utf8'), '# untouched\n');
});

test(
  'packaging: the shipped delivery docs carry a real, current test summary',
  { skip: !isBundle && 'not a delivery bundle' },
  () => {
    const lines = {};
    for (const name of ['CURRENT.md', 'DELIVERY.md']) {
      const text = fs.readFileSync(path.join(deliveryRoot, name), 'utf8');
      const header = text.match(/^\*\*Tests:\*\*(.*)$/m);
      assert.ok(header, `${name} must state a **Tests:** line`);
      // 7.5.0 shipped `… · **4 skipped**`: a hand-added bold that broke this very regex.
      // Markdown inside the numbers is the fingerprint of a hand edit — the line is
      // written by pack-delivery.js and must stay machine-shaped.
      assert.doesNotMatch(
        header[1],
        /[*_`]/,
        `${name}: the **Tests:** line is generated by pack:delivery and must not be hand-formatted (found markdown in "${header[1].trim()}")`,
      );
      const match = header[0].match(/^\*\*Tests:\*\* (\d+) total · (\d+) pass · (\d+) fail · (\d+) skipped/m);
      assert.ok(match, `${name} must state a **Tests:** summary line`);
      assert.equal(Number(match[3]), 0, `${name} must not advertise a failing suite`);
      assert.equal(
        Number(match[1]),
        Number(match[2]) + Number(match[3]) + Number(match[4]),
        `${name}: total must equal pass + fail + skipped (a typed number rarely adds up)`,
      );
      assert.doesNotMatch(text, /157 tests|157 total/, 'the stale 7.1.1-era count must not come back');
      lines[name] = match.slice(1, 5).map(Number);
    }
    // Agreement checks are skipped while pack-delivery itself is running the suite: that
    // run exists precisely to REWRITE the docs and the manifest, so holding it to the
    // stale copies would make the refresh impossible to bootstrap. Every other invocation
    // (npm test, CI, a consumer unzipping the box) enforces them.
    if (process.env.USEREYE_PACK_DELIVERY === '1') return;
    assert.deepEqual(
      lines['DELIVERY.md'],
      lines['CURRENT.md'],
      'the two delivery docs must quote the same run',
    );

    // The manifest is written by the same pack that refreshed the docs, so the two
    // must agree. When they do not, one of them was edited after the pack — which is
    // exactly how the 7.5.0 zip shipped "286 total" next to a suite of 327.
    const manifestFile = path.join(deliveryRoot, pack.MANIFEST_NAME);
    if (fs.existsSync(manifestFile)) {
      const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
      if (manifest.tests && Number.isFinite(manifest.tests.tests)) {
        assert.equal(
          lines['CURRENT.md'][0],
          manifest.tests.tests,
          `CURRENT.md says ${lines['CURRENT.md'][0]} total but ${pack.MANIFEST_NAME} recorded ${manifest.tests.tests} — the docs were edited after the pack`,
        );
      }
    }
  },
);

// ---------------------------------------------------------------------------
// F1/F2/F3 — end to end: build a synthetic bundle and pack it for real
// ---------------------------------------------------------------------------

function syntheticBundle(version) {
  const bundle = tmpDir('usereye-pack-e2e-');
  fs.mkdirSync(path.join(bundle, 'UserEye'), { recursive: true });
  fs.mkdirSync(path.join(bundle, 'demo', 'vela-site'), { recursive: true });
  fs.mkdirSync(path.join(bundle, 'docs', 'audits'), { recursive: true });
  fs.writeFileSync(
    path.join(bundle, 'UserEye', 'package.json'),
    `${JSON.stringify({ name: 'usereye', version }, null, 2)}\n`,
  );
  fs.writeFileSync(path.join(bundle, 'UserEye', 'config.js'), 'module.exports = {};\n');
  fs.writeFileSync(
    path.join(bundle, 'CURRENT.md'),
    `# UserEye ${version} — start here\n\n**Version:** ${version}\n**Tests:** 157 total · 157 pass · STALE\n`,
  );
  fs.writeFileSync(
    path.join(bundle, 'DELIVERY.md'),
    `# Delivery\n\n**Version:** ${version}\n**Tests:** 157 total · 157 pass · STALE\n`,
  );
  fs.writeFileSync(path.join(bundle, 'README.md'), '# index\n');
  fs.writeFileSync(path.join(bundle, 'demo', 'session.webm'), 'heavy regenerable video');
  fs.writeFileSync(path.join(bundle, 'demo', 'vela-site', 'index.html'), '<html></html>\n');
  fs.writeFileSync(path.join(bundle, 'docs', 'audits', '2026-09-06-audit.md'), '# audit\n');
  return bundle;
}

test('packaging: pack:delivery builds a valid one-level archive with an honest manifest', () => {
  const version = require('../package.json').version;
  const bundle = syntheticBundle(version);
  const out = path.join(bundle, 'dist');
  const run = runScript('pack-delivery.js', ['--root', bundle, '--out', out, '--skip-tests'], {
    timeout: 180_000,
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);

  const wrapper = `usereye-${version}-balanced`;
  const zipPath = path.join(out, `${wrapper}.zip`);
  assert.ok(fs.existsSync(zipPath), 'the zip is named from package.json');

  const archive = readZip(fs.readFileSync(zipPath));
  const names = [...archive.keys()];
  assert.ok(names.length > 0);
  assert.ok(
    names.every(name => name.startsWith(`${wrapper}/`)),
    'exactly one generated top-level folder',
  );
  assert.ok(names.includes(`${wrapper}/UserEye/package.json`), 'acceptance §6: */UserEye/package.json');
  assert.ok(names.includes(`${wrapper}/CURRENT.md`), 'the start-here doc ships');
  assert.ok(names.includes(`${wrapper}/docs/audits/2026-09-06-audit.md`));
  assert.ok(!names.some(name => name.endsWith('.webm')), 'no heavy video in the bundle');
  assert.ok(!names.some(name => name.includes('node_modules')));
  assert.ok(!names.some(name => /\b7\.1\.1\b/.test(name)), 'no superseded label in any path');

  // --- F2 manifest: the numbers must describe the archive that was actually built
  const side = JSON.parse(fs.readFileSync(path.join(out, pack.MANIFEST_NAME), 'utf8'));
  const inner = JSON.parse(archive.get(`${wrapper}/${pack.MANIFEST_NAME}`).toString('utf8'));
  const realFiles = names.filter(name => !name.endsWith('/'));
  const manifestEntry = `${wrapper}/${pack.MANIFEST_NAME}`;
  const staged = realFiles.filter(name => name !== manifestEntry);
  assert.equal(side.version, version);
  assert.equal(side.bundle, wrapper);
  assert.equal(side.layout.topLevel, wrapper);
  assert.equal(side.layout.nesting, 1);
  assert.equal(side.manifestShippedInside, true);
  // fileCount/bytes describe the staged bundle; the manifest cannot count itself.
  assert.equal(side.fileCount, staged.length, 'fileCount matches the staged bundle');
  assert.equal(realFiles.length, side.fileCount + 1, 'the archive is the bundle plus the manifest');
  assert.equal(
    side.bytes,
    staged.reduce((total, name) => total + archive.get(name).length, 0),
    'bytes matches the staged bundle',
  );
  assert.match(side.zipSha256, /^[0-9a-f]{64}$/, 'zipSha256 recorded beside the archive');
  assert.equal(inner.zipSha256, undefined, 'a zip cannot contain its own hash');
  assert.equal(inner.contentsSha256, side.contentsSha256);

  // --- --skip-tests must leave the docs alone rather than invent a summary
  assert.match(fs.readFileSync(path.join(bundle, 'CURRENT.md'), 'utf8'), /157 total/);
  assert.match(side.tests.line, /not run for this package/);
});

test('packaging: pack:delivery refuses to ship a bundle whose versions disagree (F3)', () => {
  const version = require('../package.json').version;
  const bundle = syntheticBundle(version);
  fs.writeFileSync(
    path.join(bundle, 'DELIVERY.md'),
    '# Delivery\n\n**Version:** 9.9.9\n**Tests:** 1 total\n',
  );
  const run = runScript('pack-delivery.js', ['--root', bundle, '--skip-tests'], { timeout: 180_000 });
  assert.equal(run.status, 1, 'preflight must block the release');
  assert.match(run.stderr, /preflight rejected the delivery/);
  assert.match(run.stderr, /DELIVERY\.md declares version "9\.9\.9"/);
});

test('packaging: archive entries carry real Unix modes (regression: mode-000 dirs)', () => {
  const stage = tmpDir('usereye-zip-modes-');
  fs.mkdirSync(path.join(stage, 'UserEye'), { recursive: true });
  fs.writeFileSync(path.join(stage, 'CURRENT.md'), '# start here\n');
  const entries = [
    { relative: 'UserEye/', directory: true },
    { relative: 'CURRENT.md', directory: false },
  ];
  const archive = pack.createZip(entries, stage);

  // Read the external-attributes field straight out of the central directory:
  // "version made by" declares UNIX, so the high 16 bits are the st_mode.
  let eocd = -1;
  for (let index = archive.length - 22; index >= 0; index -= 1) {
    if (archive.readUInt32LE(index) === 0x06054b50) {
      eocd = index;
      break;
    }
  }
  let cursor = archive.readUInt32LE(eocd + 16);
  const modes = {};
  for (let index = 0; index < archive.readUInt16LE(eocd + 10); index += 1) {
    assert.equal((archive.readUInt16LE(cursor + 4) >>> 8) & 0xff, 3, 'version made by = UNIX');
    const nameLength = archive.readUInt16LE(cursor + 28);
    const name = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    modes[name] = (archive.readUInt32LE(cursor + 38) >>> 16) & 0xffff;
    cursor += 46 + nameLength + archive.readUInt16LE(cursor + 30) + archive.readUInt16LE(cursor + 32);
  }
  assert.equal(modes['UserEye/'] & 0o170000, 0o040000, 'directory bit set');
  assert.equal(modes['UserEye/'] & 0o777, 0o755, 'directories are traversable, not mode 000');
  assert.equal(modes['CURRENT.md'] & 0o170000, 0o100000, 'regular file bit set');
  assert.equal(modes['CURRENT.md'] & 0o777, 0o644, 'files are readable');
});

test(
  'packaging: the built archive extracts with `unzip` into readable directories',
  {
    skip: (() => {
      try {
        return require('node:child_process').spawnSync('unzip', ['-v'], { encoding: 'utf8' }).status !== 0;
      } catch {
        return 'unzip not installed';
      }
    })(),
  },
  () => {
    const version = require('../package.json').version;
    const bundle = syntheticBundle(version);
    const out = path.join(bundle, 'dist');
    const built = runScript('pack-delivery.js', ['--root', bundle, '--out', out, '--skip-tests'], {
      timeout: 180_000,
    });
    assert.equal(built.status, 0, built.stderr || built.stdout);

    const destination = tmpDir('usereye-unzip-');
    const { spawnSync } = require('node:child_process');
    const extract = spawnSync(
      'unzip',
      ['-q', path.join(out, `usereye-${version}-balanced.zip`), '-d', destination],
      {
        encoding: 'utf8',
      },
    );
    assert.equal(extract.status, 0, extract.stderr || extract.stdout);

    const wrapper = path.join(destination, `usereye-${version}-balanced`);
    const readable = spawnSync('find', [wrapper, '-type', 'd', '!', '-readable'], { encoding: 'utf8' });
    assert.equal(readable.stdout.trim(), '', `unreadable directories: ${readable.stdout}`);
    // The acceptance path from §6, resolved for real on disk.
    assert.ok(fs.existsSync(path.join(wrapper, 'UserEye', 'package.json')));
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(wrapper, 'UserEye', 'package.json'), 'utf8')).version,
      version,
    );
    assert.ok(fs.existsSync(path.join(wrapper, 'CURRENT.md')));
  },
);

// ---------------------------------------------------------------------------
// Phase A, enforced mechanically: shipped source may never carry a version
// number of its own. This is how bin/usereye-init.js came to pin generated
// workflows to a hardcoded 7.2.0 while package.json said 7.4.1 — the gate only
// read the delivery docs, so nothing in code was ever checked.
// ---------------------------------------------------------------------------

const gate = require('../scripts/check-delivery-names.js');
const STALE = /\b7\.[0-3]\.\d+\b/;
const YAML_OPTS = { lineComment: null, blockComment: false, hashComment: true, regexLiterals: false };

// [source, should-a-stale-literal-be-detected, label]
const SCANNER_CASES = [
  ['// keeps the exact 7.1.1 shape\nconst x = 1;', false, 'line comment is prose, not a value'],
  ['/* pinned 7.0.0 */\nconst y = 2;', false, 'block comment is prose, not a value'],
  ["const u = 'https://example.com/7.1.1/x';", true, 'a version inside a string is a value'],
  ['const u = `tag ${v}-7.2.0`;', true, 'a version inside a template literal is a value'],
  [
    "const r = /https?:\\/\\//; const s = '7.3.0';",
    true,
    'a regex containing // does not eat the rest of the line',
  ],
  ['const r = /\\b7\\.[0-3]\\.\\d+\\b/;', false, 'the detection pattern itself is not a version value'],
  ['// note: see 7.1.1\nconst r = /7\\.1\\.1/;', false, 'comment plus regex, no string value'],
  ["'use strict'; // trailing 7.2.0\nconst z = 3;", false, 'trailing comment'],
  ["const a = 1 / 2; const b = '7.0.0';", true, 'division is not a regex, so the string survives'],
  ["const o = { v: '7.1.0' }; // documented", true, 'object value'],
  ["if (a) /* 7.0.1 */ return '7.2.2';", true, 'inline block comment then a value'],
  ["const s = 'don\\'t 7.1.0';", true, 'escaped quote inside a string'],
  ['# pinned 7.1.0\nversion: 7.2.0', true, 'yaml: hash comment stripped, value kept'],
  ['uses: docker://x/7.1.0  # comment', true, 'yaml: // is not a comment marker'],
  ['# Calm CI profile (7.4.1)\nname: x', false, 'yaml: prose only'],
];

for (const [source, expected, label] of SCANNER_CASES) {
  test(`phase A scanner: ${label}`, () => {
    // The last five cases are the non-JS comment dialects.
    const options = SCANNER_CASES.findIndex(entry => entry[0] === source) >= 12 ? YAML_OPTS : undefined;
    assert.equal(STALE.test(gate.stripComments(source, options)), expected);
  });
}

test('phase A: no shipped source file carries a stale version value', () => {
  const result = runScript('check-delivery-names.js', isBundle ? ['--root', deliveryRoot] : []);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /shipped source files carry no stale version value/);
});

test('phase A: the gate FAILS when shipped code fabricates a version', () => {
  // Against a copy, so the real tree is never touched.
  const copy = tmpDir('usereye-gate-copy-');
  fs.cpSync(root, copy, {
    recursive: true,
    filter: source => !/(^|\/)(node_modules|dist|artifacts|coverage|\.git)(\/|$)/.test(source),
  });
  const victim = path.join(copy, 'bin', 'usereye-auth.js');
  const original = fs.readFileSync(victim, 'utf8');
  const runGate = () =>
    spawnSync(process.execPath, [path.join(copy, 'scripts', 'check-delivery-names.js')], {
      encoding: 'utf8',
      cwd: copy,
      timeout: 120_000,
    });

  fs.writeFileSync(victim, `${original}\nconst FABRICATED = '7.2.0';\nmodule.exports.fab = FABRICATED;\n`);
  const bad = runGate();
  assert.equal(bad.status, 1, `expected a hard failure, got ${bad.status}: ${bad.stdout}${bad.stderr}`);
  assert.match(bad.stderr, /usereye-auth\.js hardcodes a superseded generation "7\.2\.0"/);

  // The same mention in a comment must stay legal, or the gate trains people to
  // ignore it.
  fs.writeFileSync(victim, `${original}\n// history: this module shipped in 7.2.0 and kept its shape.\n`);
  const fine = runGate();
  assert.equal(fine.status, 0, `a comment must not fail the gate: ${fine.stdout}${fine.stderr}`);
});

test('phase A: generated CI workflows pin the real package version', () => {
  const { WORKFLOW_TEMPLATE, CONFIG_TEMPLATE } = require('../bin/usereye-init.js');
  const version = require('../package.json').version;
  const workflow = WORKFLOW_TEMPLATE(version);
  assert.ok(workflow.includes(version), 'the workflow must name the shipping version');
  assert.ok(!STALE.test(workflow), 'the workflow must not name a superseded generation');
  // Comment-stripped, for the same reason the gate strips comments: this file
  // legitimately *explains* that it once hardcoded a version. Prose may name
  // history; a value may not.
  const initSource = gate.stripComments(fs.readFileSync(path.join(root, 'bin', 'usereye-init.js'), 'utf8'));
  assert.ok(
    !/['"`]\d+\.\d+\.\d+['"`]/.test(initSource),
    'usereye-init.js must hold no quoted version literal — it reads package.json',
  );
  assert.ok(
    /require\(['"]\.\.\/package\.json['"]\)\.version/.test(initSource),
    'usereye-init.js must read its version from package.json',
  );
  assert.ok(/recordVideo: 'on-failure'/.test(CONFIG_TEMPLATE), 'init still teaches the calm profile');
});

test('phase A: usereye init refuses a missing directory instead of doing nothing', () => {
  const missing = path.join(tmpDir('usereye-init-missing-'), 'nope');
  const result = spawnSync(process.execPath, [path.join(root, 'bin', 'usereye-init.js'), missing], {
    encoding: 'utf8',
    timeout: 60_000,
  });
  assert.equal(result.status, 2, 'a bad target directory is a usage error');
  assert.match(result.stderr + result.stdout, /not found/i);
});

/**
 * Runs the delivery-names gate against a throwaway copy of the package, so a
 * negative test can break something without touching the real tree.
 */
function gateOnCopy(mutate) {
  const copy = tmpDir('usereye-gate-copy-');
  fs.cpSync(root, copy, {
    recursive: true,
    filter: source => !/(^|\/)(node_modules|dist|artifacts|coverage|\.git)(\/|$)/.test(source),
  });
  mutate(copy);
  return spawnSync(process.execPath, [path.join(copy, 'scripts', 'check-delivery-names.js')], {
    encoding: 'utf8',
    cwd: copy,
    timeout: 120_000,
  });
}

test('phase A: HISTORY.md must record the version that package.json ships', () => {
  const version = require('../package.json').version;
  const result = gateOnCopy(() => {});
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(
    result.stdout,
    new RegExp(`release notes: HISTORY\\.md records ${version.replace(/\./g, '\\.')}`),
  );

  const stale = gateOnCopy(copy => {
    const history = path.join(copy, 'HISTORY.md');
    fs.writeFileSync(history, fs.readFileSync(history, 'utf8').replace(/^## \d+\.\d+\.\d+/m, '## 7.4.0'));
  });
  assert.equal(stale.status, 1, `expected failure: ${stale.stdout}${stale.stderr}`);
  assert.match(stale.stderr, /newest entry is 7\.4\.0 but package\.json says/);
});

test('phase A: a changeset left pending after its release must fail the build', () => {
  const version = require('../package.json').version;
  const result = gateOnCopy(copy => {
    fs.mkdirSync(path.join(copy, '.changeset'), { recursive: true });
    fs.writeFileSync(
      path.join(copy, '.changeset', 'already-shipped.md'),
      `---\n'usereye': patch\n---\n\nNotes for ${version}, which HISTORY.md already records.\n`,
    );
  });
  assert.equal(result.status, 1, `expected failure: ${result.stdout}${result.stderr}`);
  assert.match(result.stderr, /already-shipped\.md is still pending but describes/);
  assert.match(result.stderr, /consume it/);

  // A changeset for a FUTURE release must stay legal.
  const fine = gateOnCopy(copy => {
    fs.mkdirSync(path.join(copy, '.changeset'), { recursive: true });
    fs.writeFileSync(
      path.join(copy, '.changeset', 'next-release.md'),
      "---\n'usereye': minor\n---\n\nSomething not yet released.\n",
    );
  });
  assert.equal(fine.status, 0, `a pending future changeset must pass: ${fine.stdout}${fine.stderr}`);
});

test('packaging: a clean pack is byte-reproducible, so zipSha256 identifies a release', t => {
  if (!isBundle) return t.skip('no delivery bundle to pack');

  const first = tmpDir('usereye-repro-a-');
  const second = tmpDir('usereye-repro-b-');
  const packOnce = out => {
    const result = runScript('pack-delivery.js', ['--root', deliveryRoot, '--out', out, '--skip-tests'], {
      timeout: 300_000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const version = require('../package.json').version;
    return {
      zip: fs.readFileSync(path.join(out, `usereye-${version}-balanced.zip`)),
      manifest: JSON.parse(fs.readFileSync(path.join(out, 'DELIVERY-MANIFEST.json'), 'utf8')),
    };
  };

  const a = packOnce(first);
  if (a.manifest.git.dirty !== false) {
    // Reproducibility is only claimed for a clean tree; a dirty pack honestly
    // falls back to the wall clock, and git.dirty records that.
    assert.ok(
      Math.abs(Date.parse(a.manifest.generatedAt) - Date.now()) < 10 * 60_000,
      'a dirty pack should stamp the wall clock',
    );
    return t.skip(`tree is dirty (${a.manifest.git.sha}); reproducibility is not claimed`);
  }

  // Sleep past a second boundary so a wall-clock timestamp could not accidentally
  // produce the same archive.
  const waitUntil = Date.now() + 1500;
  while (Date.now() < waitUntil) {
    /* spin */
  }
  const b = packOnce(second);

  assert.equal(
    b.manifest.generatedAt,
    a.manifest.generatedAt,
    'generatedAt must come from the commit, not the clock',
  );
  assert.equal(
    pack.sha256(b.zip),
    pack.sha256(a.zip),
    'the same commit must produce the same bytes — otherwise zipSha256 records when a script ran, not what shipped',
  );
  assert.equal(b.zip.length, a.zip.length);
  assert.equal(b.manifest.contentsSha256, a.manifest.contentsSha256);
});

// ---------------------------------------------------------------------------
// verify-release.js — the gate that grades the artifact needs its own tests, or
// a reader has no way to know whether its 68 PASSes mean anything.
// ---------------------------------------------------------------------------

const VERSION = require('../package.json').version;
const release = require('../scripts/verify-release.js');

function buildArchive(files) {
  const stage = tmpDir('usereye-reader-src-');
  const entries = [];
  for (const [name, contents] of Object.entries(files)) {
    const target = path.join(stage, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
    entries.push({ relative: name, directory: false });
  }
  return pack.createZip(entries, stage);
}

test('verify-release: the reader round-trips what the writer produced', () => {
  const payload = 'a'.repeat(5000); // long enough to take the deflate path
  const archive = buildArchive({
    'wrapper/CURRENT.md': '# start here\n',
    'wrapper/UserEye/package.json': `{"version":"${VERSION}"}`,
    'wrapper/big.txt': payload,
  });
  const { entries, claimedCount } = release.readZip(archive);
  assert.equal(entries.length, claimedCount);
  assert.equal(entries.length, 3);
  const byName = new Map(entries.map(entry => [entry.name, entry]));
  assert.equal(
    byName.get('wrapper/big.txt').data.toString('utf8'),
    payload,
    'deflated payload inflates exactly',
  );
  assert.equal(byName.get('wrapper/CURRENT.md').data.toString('utf8'), '# start here\n');
  for (const entry of entries) {
    assert.equal(pack.crc32(entry.data), entry.crc, `CRC of ${entry.name} must verify`);
    assert.equal(entry.data.length, entry.size);
    assert.equal(entry.mode & 0o170000, 0o100000, `${entry.name} is a regular file`);
    assert.equal(entry.mode & 0o777, 0o644);
  }
});

test('verify-release: the reader detects a corrupted payload instead of trusting the archive', () => {
  const archive = buildArchive({ 'wrapper/data.txt': 'x'.repeat(4000) });
  const { entries } = release.readZip(archive);
  assert.equal(entries[0].data.toString('utf8'), 'x'.repeat(4000));

  // Flip a byte inside the deflated payload: the CRC check must catch it. A gate
  // that cannot notice corruption is grading a file it did not read.
  const damaged = Buffer.from(archive);
  // Local header layout: 30 fixed bytes, then the name, then any extra field.
  // nameLen is at 26 and extraLen at 28 — reading them is the only way to land
  // inside the payload rather than inside the filename.
  const nameLength = damaged.readUInt16LE(26);
  const extraLength = damaged.readUInt16LE(28);
  const compressedSize = damaged.readUInt32LE(18);
  const payloadStart = 30 + nameLength + extraLength;
  assert.ok(compressedSize < 4000, 'the payload should have taken the deflate path');
  damaged[payloadStart + Math.floor(compressedSize / 2)] ^= 0xff;
  let caught = null;
  try {
    const corrupt = release.readZip(damaged);
    if (pack.crc32(corrupt.entries[0].data) !== corrupt.entries[0].crc) caught = 'crc mismatch';
  } catch (error) {
    caught = error.message;
  }
  assert.ok(caught, 'a flipped byte must surface as either an inflate error or a CRC mismatch');
});

test('verify-release: the reader refuses a malformed archive', () => {
  assert.throws(
    () => release.readZip(Buffer.from('this is not a zip file at all')),
    /no end-of-central-directory/,
  );
  const truncated = buildArchive({ 'wrapper/a.txt': 'hello' }).subarray(0, 40);
  assert.throws(() => release.readZip(truncated), /no end-of-central-directory|bad signature|truncated/);
});

test('verify-release: extraction refuses paths that escape the destination', () => {
  const dest = tmpDir('usereye-reader-dest-');
  const attempts = [
    [{ name: '../escaped.txt', isDir: false, data: Buffer.from('x'), mode: 0o100644 }],
    [{ name: '/etc/absolute.txt', isDir: false, data: Buffer.from('x'), mode: 0o100644 }],
    [{ name: 'ok/../sneaky.txt', isDir: false, data: Buffer.from('x'), mode: 0o100644 }],
  ];
  for (const entries of attempts) {
    assert.throws(
      () => release.extract(entries, dest),
      /unsafe path|escapes the destination/,
      entries[0].name,
    );
  }
  assert.equal(fs.existsSync(path.join(dest, '..', 'escaped.txt')), false, 'nothing was written outside');
});

test('verify-release: extraction reproduces the archive modes on disk', () => {
  const dest = tmpDir('usereye-reader-modes-');
  release.extract(
    [
      { name: 'wrapper/', isDir: true, data: Buffer.alloc(0), mode: 0o40755 },
      { name: 'wrapper/UserEye/', isDir: true, data: Buffer.alloc(0), mode: 0o40755 },
      { name: 'wrapper/UserEye/package.json', isDir: false, data: Buffer.from('{}'), mode: 0o100644 },
    ],
    dest,
  );
  const dirMode = fs.statSync(path.join(dest, 'wrapper', 'UserEye')).mode & 0o777;
  const fileMode = fs.statSync(path.join(dest, 'wrapper', 'UserEye', 'package.json')).mode & 0o777;
  assert.equal(dirMode, 0o755, 'directories must be traversable — the mode-000 regression');
  assert.equal(fileMode, 0o644, 'files must be readable');
  assert.ok(fs.readdirSync(path.join(dest, 'wrapper', 'UserEye')).includes('package.json'));
});

// ---------------------------------------------------------------------------
// Regressions found by the 2026-09-06 independent verification.
// See docs/audits/2026-09-06-independent-verification-7.4.1.md.
// ---------------------------------------------------------------------------

test('packaging: the skip note reports the reasons the run actually gave', () => {
  const tap = [
    'ok 173 - multi-browser: firefox # SKIP firefox not installed (npx playwright install firefox)',
    'ok 174 - multi-browser: webkit # SKIP webkit not installed (npx playwright install webkit)',
  ].join('\n');
  assert.deepEqual(pack.parseSkipReasons(tap), ['firefox not installed', 'webkit not installed']);

  // The reason that used to be mislabelled: nothing here is about a browser.
  const dirty = 'ok 219 - byte-reproducible # SKIP tree is dirty (null); reproducibility is not claimed';
  assert.deepEqual(pack.parseSkipReasons(dirty), ['tree is dirty']);
  assert.equal(
    pack.testSummaryLine({ tests: 280, pass: 279, fail: 0, skipped: 1, skipReasons: ['tree is dirty'] }),
    '280 total · 279 pass · 0 fail · 1 skipped (tree is dirty)',
    'the docs must not blame firefox/webkit for a skip that had nothing to do with them',
  );

  // Counts-only callers keep the historical wording, and a green run stays clean.
  assert.equal(
    pack.testSummaryLine({ tests: 230, pass: 228, fail: 0, skipped: 2 }),
    '230 total · 228 pass · 0 fail · 2 skipped (firefox/webkit not installed)',
  );
  assert.equal(pack.parseSkipReasons('ok 1 - nothing skipped here').length, 0);
});

test('packaging: repacking an EXTRACTED bundle does not double-count or duplicate the manifest', () => {
  const version = require('../package.json').version;
  const bundle = syntheticBundle(version);
  // Exactly what a consumer has after `unzip`: a delivery root that already
  // carries the manifest emitted by the previous pack.
  fs.writeFileSync(
    path.join(bundle, pack.MANIFEST_NAME),
    `${JSON.stringify({ name: 'usereye', version, bundle: `usereye-${version}-balanced`, stale: true }, null, 2)}\n`,
  );
  const out = path.join(bundle, 'dist');
  const run = runScript('pack-delivery.js', ['--root', bundle, '--out', out, '--skip-tests'], {
    timeout: 180_000,
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);

  const wrapper = `usereye-${version}-balanced`;
  const manifestEntry = `${wrapper}/${pack.MANIFEST_NAME}`;
  const raw = fs.readFileSync(path.join(out, `${wrapper}.zip`));
  const archive = readZip(raw);
  const names = [...archive.keys()];

  // A zip may not carry the same path twice: which copy wins is extractor-defined.
  assert.equal(
    names.filter(name => name === manifestEntry).length,
    1,
    'the manifest appears exactly once in the archive',
  );

  const inner = JSON.parse(archive.get(manifestEntry).toString('utf8'));
  assert.notEqual(inner.stale, true, 'the generated manifest replaces the stale one');
  const staged = names.filter(name => !name.endsWith('/') && name !== manifestEntry);
  assert.equal(inner.fileCount, staged.length, 'fileCount excludes the stale manifest');
  assert.equal(
    inner.bytes,
    staged.reduce((total, name) => total + archive.get(name).length, 0),
    'bytes excludes the stale manifest',
  );
});

// ---------------------------------------------------------------------------
// verify-release grades provenance as tri-state
// ---------------------------------------------------------------------------

/**
 * Regression gate for the one defect the 7.5.1 box still shipped.
 *
 * `pack-delivery.js#gitDirty()` returns `false` / `true` / `null`, where `null`
 * means "git could not be asked" — no `.git`, or git absent from PATH. The
 * release grader compared that field against `false` with a two-valued `eq()`,
 * so "provenance unknown" was reported exactly like "tree was dirty".
 *
 * That is not a corner case: `.git` is deliberately never staged into the
 * archive, so every reader who extracts the zip and follows DELIVERY.md §7
 * ("Reproducing this zip") repacks outside a checkout and saw a red gate on an
 * otherwise perfect artifact. DELIVERY.md §7 promises the opposite — a gate that
 * could not run SKIPs with a reason rather than failing or silently passing.
 *
 * This asserts the source of the grader, not a live run: reproducing the failure
 * end-to-end would mean packing from a non-git tree and re-extracting, which the
 * suite already does elsewhere and which costs a browser-less minute here.
 */
test('verify-release: unknown git provenance skips, only a dirty tree fails', () => {
  const source = fs.readFileSync(path.join(root, 'scripts', 'verify-release.js'), 'utf8');

  assert.ok(
    !/eq\(\s*'manifest git\.dirty',\s*inside\.git\.dirty,\s*false\s*\)/.test(source),
    'git.dirty must not be graded with a two-valued eq() — null means unknown, not dirty',
  );

  const guard = /packedDirty === null \|\| packedDirty === undefined/.test(source);
  assert.ok(guard, 'the grader must special-case an unknown (null/undefined) git.dirty');

  const skipsOnUnknown =
    /packedDirty === null[\s\S]{0,200}?skip\(\s*'manifest git\.dirty[\s\S]{0,160}?\)/.test(source);
  assert.ok(skipsOnUnknown, 'an ungradable provenance must SKIP with a reason');

  const failsOnDirty = /else\s*\{\s*eq\('manifest git\.dirty', packedDirty, false\)/.test(source);
  assert.ok(failsOnDirty, 'a tree git reports as dirty must still fail the gate');
});
