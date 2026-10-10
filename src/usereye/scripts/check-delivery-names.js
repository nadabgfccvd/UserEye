#!/usr/bin/env node
'use strict';

/**
 * Delivery naming & version-agreement gate
 * (ROADMAP-PACKAGING-AND-DEFAULTS Phases A3 / F3, acceptance §6).
 *
 * The 7.4.0 bundle shipped a zip and folders labelled 7.1.1 around a package.json
 * that said 7.4.0, double-nested, with a delivery README describing "157 tests".
 * This script makes that class of mistake unshippable:
 *
 *   1. version agreement — package.json === CLI --version === CURRENT.md === DELIVERY.md
 *   2. no stale generation — the delivery root docs and the package README must not
 *      advertise an older release than the package (docs/audits and docs/history are
 *      exempt on purpose: history is allowed to name old versions)
 *   3. flat layout — `UserEye/package.json` at exactly one level, and no
 *      version-named wrapper directory anywhere in the bundle
 *   4. one obvious "start here" doc at the root
 *   5. package metadata points nowhere dead (Phase B5) — the earlier releases sent
 *      repository / homepage / bugs to a GitHub org that 404s
 *
 * Runs green both inside a delivery bundle and in a standalone checkout of the
 * package (layout checks are skipped with a note when there is no bundle), so it is
 * safe to wire into `npm run checks` and therefore into CI.
 *
 * Usage: node scripts/check-delivery-names.js [--root <deliveryRoot>] [--strict]
 *   --strict  fail instead of skip when no delivery bundle is detected
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const packageDir = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
const VERSION = pkg.version;

/** Versions older than the current one that must not appear in "current" docs. */
const STALE_GENERATION = /\b7\.[0-3]\.\d+\b/;
// action.yml and Dockerfile: `#` comments, no regex literals, no /* */ blocks.
const NON_JS_COMMENTS = {
  lineComment: null,
  blockComment: false,
  hashComment: true,
  regexLiterals: false,
};

/**
 * Returns the source with comments removed and string literals left intact.
 *
 * The stale-version rule has to look inside code, not prose: this package
 * legitimately says things like "keeps the exact 7.1.1 shape" in a comment to
 * document a compatibility promise, and failing on that would train people to
 * ignore the gate. What must never appear is a version number in a *value* —
 * that is how bin/usereye-init.js came to pin generated workflows to a
 * hardcoded 7.2.0 while the package said 7.4.1.
 *
 * Regex literals are tracked so `/https?:\/\//` is not mistaken for a comment.
 */
function stripComments(
  source,
  { lineComment = '//', blockComment = true, hashComment = false, regexLiterals = true } = {},
) {
  const out = [];
  let mode = 'code';
  let quote = '';
  let inClass = false;
  let lastSignificant = '';
  const regexAllowed = new Set([
    '',
    '(',
    ',',
    '=',
    ':',
    '[',
    '!',
    '&',
    '|',
    '?',
    '{',
    '}',
    ';',
    '+',
    '-',
    '*',
    '%',
    '~',
    '^',
    '<',
    '>',
  ]);
  const keywords = new Set([
    'return',
    'typeof',
    'instanceof',
    'in',
    'of',
    'new',
    'delete',
    'void',
    'case',
    'do',
    'else',
    'yield',
    'await',
  ]);
  let word = '';

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];

    if (mode === 'line') {
      if (char === '\n') {
        mode = 'code';
        out.push(char);
      }
      continue;
    }
    if (mode === 'block') {
      if (char === '*' && next === '/') {
        mode = 'code';
        i += 1;
      }
      continue;
    }
    if (mode === 'string') {
      out.push(char);
      if (char === '\\') {
        if (next !== undefined) out.push(next);
        i += 1;
        continue;
      }
      if (char === quote) {
        mode = 'code';
        lastSignificant = '"';
      }
      continue;
    }
    if (mode === 'regex') {
      out.push(char);
      if (char === '\\') {
        if (next !== undefined) out.push(next);
        i += 1;
        continue;
      }
      if (char === '[') inClass = true;
      else if (char === ']') inClass = false;
      else if (char === '/' && !inClass) {
        mode = 'code';
        lastSignificant = '"';
      }
      continue;
    }

    // code
    if (char === "'" || char === '"' || char === '`') {
      mode = 'string';
      quote = char;
      out.push(char);
      word = '';
      continue;
    }
    if (hashComment && char === '#') {
      mode = 'line';
      continue;
    }
    if (lineComment && source.startsWith(lineComment, i)) {
      mode = 'line';
      i += lineComment.length - 1;
      continue;
    }
    if (blockComment && char === '/' && next === '*') {
      mode = 'block';
      i += 1;
      continue;
    }
    if (regexLiterals && char === '/' && (regexAllowed.has(lastSignificant) || keywords.has(word))) {
      mode = 'regex';
      inClass = false;
      out.push(char);
      word = '';
      continue;
    }
    out.push(char);
    if (/[A-Za-z0-9_$]/.test(char)) word += char;
    else {
      word = '';
      if (!/\s/.test(char)) lastSignificant = char;
    }
  }
  return out.join('');
}

/**
 * Rule 5 — no shipped source file may freeze or fabricate a version number.
 *
 * Comments are stripped first: this package legitimately says "keeps the exact
 * 7.1.1 shape" to document a compatibility promise, and failing on prose would
 * train people to ignore the gate. Values are what matter — that is how
 * bin/usereye-init.js came to pin generated workflows to a hardcoded 7.2.0.
 */
function checkShippedSourceVersions() {
  const files = shippedCodeFiles();
  const offenders = [];
  for (const relative of files) {
    const text = fs.readFileSync(path.join(packageDir, relative), 'utf8');
    const isYamlish = /\.(ya?ml)$/.test(relative) || relative === 'Dockerfile';
    const code = stripComments(text, isYamlish ? NON_JS_COMMENTS : {});
    const hit = code.match(STALE_GENERATION);
    if (hit) {
      offenders.push(
        `${relative} hardcodes a superseded generation "${hit[0]}" in code (package is ${VERSION})`,
      );
    }
  }
  for (const problem of offenders) problems.push(problem);
  if (!offenders.length) notes.push(`${files.length} shipped source files carry no stale version value`);
}

/**
 * Rule 6 — the release notes must describe the release that actually shipped.
 *
 * Two ways this goes wrong, both of which happened here. A released version with
 * no HISTORY.md entry leaves consumers with nothing to read. And a changeset left
 * pending after its version shipped makes `changeset version` emit the *next*
 * patch carrying a duplicate changelog — the 7.4.1 changeset also still claimed
 * `"private": true` after that decision was reverted, so the duplicate would have
 * been a false one.
 */
function checkReleaseNotes() {
  const historyPath = path.join(packageDir, 'HISTORY.md');
  if (!fs.existsSync(historyPath)) {
    problems.push('HISTORY.md is shipped by package.json "files" but is missing.');
    return;
  }
  const history = fs.readFileSync(historyPath, 'utf8');
  const newest = /^## (\d+\.\d+\.\d+)/m.exec(history);
  if (!newest) {
    problems.push('HISTORY.md has no "## <version>" entry to read the newest release from.');
  } else if (newest[1] !== VERSION) {
    problems.push(
      `HISTORY.md's newest entry is ${newest[1]} but package.json says ${VERSION} — the release is not recorded.`,
    );
  }

  const changesetDir = path.join(packageDir, '.changeset');
  if (!fs.existsSync(changesetDir)) return;
  const pending = fs.readdirSync(changesetDir).filter(name => name.endsWith('.md') && name !== 'README.md');
  for (const name of pending) {
    const body = fs.readFileSync(path.join(changesetDir, name), 'utf8');
    if (new RegExp(`\\b${VERSION.replace(/\./g, '\\.')}\\b`).test(body)) {
      problems.push(
        `.changeset/${name} is still pending but describes ${VERSION}, which HISTORY.md already records — consume it, or \`changeset version\` will re-emit it as a duplicate under the next patch.`,
      );
    }
  }
  if (newest && newest[1] === VERSION) {
    notes.push(
      pending.length
        ? `release notes: HISTORY.md records ${VERSION}; ${pending.length} changeset(s) still pending`
        : `release notes: HISTORY.md records ${VERSION}; no stale pending changeset`,
    );
  }
}

/** Files a consumer actually installs, per package.json "files". */
function shippedCodeFiles() {
  const roots = ['bin', 'protocols', 'patterns', 'locales', 'types'];
  const found = [];
  for (const name of fs.readdirSync(packageDir)) {
    if (name.endsWith('.js')) found.push(name);
  }
  for (const extra of ['action.yml', 'Dockerfile']) {
    if (fs.existsSync(path.join(packageDir, extra))) found.push(extra);
  }
  for (const root of roots) {
    const absolute = path.join(packageDir, root);
    if (!fs.existsSync(absolute)) continue;
    const stack = [absolute];
    while (stack.length) {
      const dir = stack.pop();
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (/\.(js|mjs|cjs|json|ya?ml)$/.test(entry.name)) found.push(path.relative(packageDir, full));
      }
    }
  }
  return found.sort();
}

/** A wrapper folder that embeds a version, e.g. `usereye-7.4.1-balanced`. */
const WRAPPER_VERSION = /^usereye-(\d+\.\d+\.\d+)/i;

const IGNORED_DIRS = new Set(['.git', 'node_modules', 'artifacts', 'live-runs', 'coverage', 'dist']);

const problems = [];
const notes = [];

function parseArgv(argv) {
  const out = { root: null, strict: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--root') out.root = argv[++index];
    else if (token === '--strict') out.strict = true;
  }
  return out;
}

/** A delivery bundle is a directory that contains this package as `UserEye/`. */
function detectDeliveryRoot(explicit) {
  if (explicit) {
    const resolved = path.resolve(explicit);
    if (!fs.existsSync(resolved)) return { root: null, reason: `--root not found: ${resolved}` };
    // An explicit --root that holds neither the package nor the start-here doc is
    // not a bundle at all, so there is nothing to police — say so and skip (unless
    // --strict). A directory that has *either* marker IS treated as a bundle and
    // then held to every rule, so a half-built bundle still fails loudly.
    const looksLikeBundle =
      fs.existsSync(path.join(resolved, 'UserEye', 'package.json')) ||
      fs.existsSync(path.join(resolved, 'CURRENT.md'));
    return looksLikeBundle
      ? { root: resolved, reason: null }
      : {
          root: null,
          reason: `--root ${resolved} is not a delivery bundle (no UserEye/package.json or CURRENT.md)`,
        };
  }
  const parent = path.resolve(packageDir, '..');
  const looksLikeBundle =
    path.basename(packageDir) === 'UserEye' &&
    fs.existsSync(path.join(parent, 'UserEye', 'package.json')) &&
    fs.existsSync(path.join(parent, 'CURRENT.md'));
  return looksLikeBundle
    ? { root: parent, reason: null }
    : { root: null, reason: 'no delivery bundle detected (expected ../UserEye + ../CURRENT.md)' };
}

function walk(relativeRoot, absoluteRoot, files = []) {
  for (const entry of fs.readdirSync(absoluteRoot, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const absolute = path.join(absoluteRoot, entry.name);
    const relative = path.join(relativeRoot, entry.name);
    if (entry.isDirectory()) walk(relative, absolute, files);
    else files.push({ relative, absolute });
  }
  return files;
}

function cliVersion() {
  const run = spawnSync(process.execPath, [path.join(packageDir, 'bin', 'usereye.js'), '--version'], {
    encoding: 'utf8',
  });
  return run.status === 0 ? (run.stdout || '').trim() : null;
}

/** `**Version:** 7.4.1 …` / `**Package:** \`usereye\` **7.4.1**` */
function versionFromDoc(file) {
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  const match = text.match(/\*\*(?:Version|Package):\*\*[^\n]*?(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

function main() {
  const options = parseArgv(process.argv.slice(2));
  const detected = detectDeliveryRoot(options.root);

  // --- 1. version agreement -------------------------------------------------
  const cli = cliVersion();
  if (cli !== VERSION) {
    problems.push(`CLI --version reports "${cli}" but package.json says "${VERSION}".`);
  }

  // --- 1b. package metadata must not point anywhere dead (Phase B5) ---------
  // Verified by HTTP on 2026-09-06: github.com/usereye/usereye is a 404 and the
  // `usereye` name is not on the npm registry. Shipping those links sent every
  // reader to a dead page. A network probe does not belong in an offline CI gate,
  // so the known-dead origin is listed explicitly; the general rule is that a
  // publishable package either declares a real remote or declares none at all.
  const DEAD_METADATA = [/^https?:\/\/(?:www\.)?github\.com\/usereye\//i];
  for (const field of ['repository', 'homepage', 'bugs']) {
    const declared = pkg[field];
    const url = typeof declared === 'string' ? declared : declared?.url;
    if (url && DEAD_METADATA.some(pattern => pattern.test(url))) {
      problems.push(`package.json "${field}" points at a verified-404 URL: ${url}`);
    }
  }
  if (pkg.private === false && !pkg.repository) {
    notes.push(
      'package.json is publishable (private: false) but declares no repository — add the real remote, plus homepage/bugs, in the same commit that publishes.',
    );
  }

  if (!detected.root) {
    notes.push(detected.reason);
    // Still police the package's own README: it is the doc a stranger reads first.
    const readme = fs.readFileSync(path.join(packageDir, 'README.md'), 'utf8');
    const stale = readme.match(STALE_GENERATION);
    if (stale) {
      problems.push(`UserEye/README.md advertises a stale generation "${stale[0]}" (package is ${VERSION}).`);
    }
    if (options.strict) {
      problems.push('--strict was passed but no delivery bundle was found.');
    }
    // Rules 5 and 6 are about the package itself, so they run with or without a bundle.
    checkShippedSourceVersions();
    checkReleaseNotes();

    report(notes, { bundleChecked: false });
    return;
  }

  const root = detected.root;
  const current = versionFromDoc(path.join(root, 'CURRENT.md'));
  const delivery = versionFromDoc(path.join(root, 'DELIVERY.md'));
  if (current !== VERSION) {
    problems.push(`CURRENT.md declares version "${current}" but package.json says "${VERSION}".`);
  }
  if (delivery !== VERSION) {
    problems.push(`DELIVERY.md declares version "${delivery}" but package.json says "${VERSION}".`);
  }

  // --- 2. no stale generation in the docs that claim to be current ----------
  // docs/audits, docs/history and HISTORY.md are exempt: history legitimately
  // names older releases (risk register: "check-delivery too strict on HISTORY").
  const currentDocs = ['CURRENT.md', 'DELIVERY.md', 'README.md']
    .map(name => path.join(root, name))
    .filter(file => fs.existsSync(file))
    .concat(
      fs
        .readdirSync(root)
        .filter(name => /^README-DELIVERY/i.test(name))
        .map(name => path.join(root, name)),
      [path.join(packageDir, 'README.md')],
    );
  for (const file of currentDocs) {
    const text = fs.readFileSync(file, 'utf8');
    const stale = text.match(STALE_GENERATION);
    if (stale) {
      problems.push(
        `${path.relative(root, file)} advertises a stale generation "${stale[0]}" while the package is ${VERSION}.`,
      );
    }
  }
  for (const name of fs.readdirSync(root)) {
    if (/^README-DELIVERY\.txt$/i.test(name)) {
      problems.push(`${name} is the pre-7.4.1 delivery note; it must be replaced by DELIVERY.md.`);
    }
  }

  // --- 3. flat layout ------------------------------------------------------
  if (!fs.existsSync(path.join(root, 'UserEye', 'package.json'))) {
    problems.push('UserEye/package.json must be reachable at exactly one level below the zip root.');
  }
  // The original defect was two identically-named, version-labelled folders nested
  // around a package.json that already declared a newer release. So the rules are:
  // a wrapper may exist, but its version must equal package.json's; and no folder
  // other than UserEye/ may itself contain the package (that is double nesting).
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || IGNORED_DIRS.has(entry.name)) continue;
    const wrapper = WRAPPER_VERSION.exec(entry.name);
    if (wrapper && wrapper[1] !== VERSION) {
      problems.push(
        `wrapper directory at the root is labelled ${wrapper[1]} but the package is ${VERSION}: ${entry.name}/`,
      );
    }
    if (entry.name !== 'UserEye' && fs.existsSync(path.join(root, entry.name, 'UserEye', 'package.json'))) {
      problems.push(
        `nested delivery bundle inside the bundle: ${entry.name}/UserEye/package.json — the archive must have exactly one top level`,
      );
    }
  }
  const allFiles = walk('', root);
  for (const file of allFiles) {
    const parent = path.basename(path.dirname(file.relative)) || '';
    const wrapper = WRAPPER_VERSION.exec(parent);
    if (wrapper && wrapper[1] !== VERSION) {
      problems.push(`version-labelled folder in path disagrees with package.json: ${file.relative}`);
    }
    // The zip name is generated from package.json, so the superseded label the old
    // bundle carried is always a leftover when it appears in a path.
    if (/\b7\.1\.1\b/.test(file.relative)) {
      problems.push(`path still carries the superseded 7.1.1 label: ${file.relative}`);
    }
  }

  // --- 4. one obvious start-here doc ---------------------------------------
  for (const required of ['CURRENT.md', 'DELIVERY.md']) {
    if (!fs.existsSync(path.join(root, required))) {
      problems.push(`${required} is missing from the delivery root.`);
    }
  }
  const strayRootDocs = fs
    .readdirSync(root)
    .filter(name => name.endsWith('.md') && !['CURRENT.md', 'DELIVERY.md', 'README.md'].includes(name));
  if (strayRootDocs.length) {
    problems.push(
      `delivery root must only carry CURRENT.md / DELIVERY.md / README.md; move to docs/: ${strayRootDocs.join(', ')}`,
    );
  }

  // --- 5 + 6. the package's own version truth and release notes ------------
  checkShippedSourceVersions();
  checkReleaseNotes();

  notes.push(`delivery root: ${root}`);
  notes.push(`${allFiles.length} files scanned (excluding ${[...IGNORED_DIRS].join(', ')})`);
  report(notes, { bundleChecked: true });
}

function report(extraNotes, { bundleChecked }) {
  if (problems.length) {
    for (const problem of problems) console.error(`delivery-names: FAIL — ${problem}`);
    process.exit(1);
  }
  for (const note of extraNotes) console.log(`delivery-names: note — ${note}`);
  // Be precise about what was actually verified: in a standalone package checkout
  // there are no delivery docs to agree with, and claiming otherwise would be the
  // exact kind of overstatement this gate exists to prevent.
  console.log(
    bundleChecked
      ? `delivery-names: OK — ${VERSION} agrees across package.json, CLI --version, CURRENT.md and DELIVERY.md; the tree has one top level, no nested bundle, and no superseded generation labels.`
      : `delivery-names: OK — ${VERSION} agrees across package.json and CLI --version; package README carries no stale generation (delivery layout not present, so not checked).`,
  );
}

if (require.main === module) main();
module.exports = {
  VERSION,
  STALE_GENERATION,
  stripComments,
  shippedCodeFiles,
  checkShippedSourceVersions,
  checkReleaseNotes,
  parseArgv,
};
