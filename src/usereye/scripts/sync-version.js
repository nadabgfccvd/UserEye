#!/usr/bin/env node
'use strict';

/**
 * Version single-source-of-truth check (roadmap items 0.8 / 5.2).
 *
 * package.json is the ONLY place a version number may live:
 *   - user-eye.js must derive TOOL_VERSION from package.json (no literal);
 *   - tests/smoke.test.js must assert against package.json (no literal);
 *   - HISTORY.md must document the current version;
 *   - publish.yml major container tag must match the current major.
 *
 * Usage: node scripts/sync-version.js
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const problems = [];

function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const version = pkg.version;
  if (!/^\d+\.\d+\.\d+/.test(version)) {
    problems.push(`package.json version "${version}" is not semver.`);
  }

  const engine = fs.readFileSync(path.join(root, 'user-eye.js'), 'utf8');
  if (!/TOOL_VERSION = require\('\.\/package\.json'\)\.version/.test(engine)) {
    problems.push('user-eye.js must derive TOOL_VERSION from package.json.');
  }
  if (new RegExp(`TOOL_VERSION = '${version.replace(/\./g, '\\.')}'`).test(engine)) {
    problems.push('user-eye.js contains a hardcoded TOOL_VERSION literal.');
  }

  const smoke = fs.readFileSync(path.join(root, 'tests', 'smoke.test.js'), 'utf8');
  if (new RegExp(`'${version.replace(/\./g, '\\.')}'`).test(smoke)) {
    problems.push(`tests/smoke.test.js hardcodes version "${version}"; read it from package.json.`);
  }
  if (!/require\('\.\.\/package\.json'\)/.test(smoke)) {
    problems.push('tests/smoke.test.js should assert the CLI version against ../package.json.');
  }

  // Changesets writes CHANGELOG.md; hand-rolled releases document HISTORY.md.
  // Either file satisfies the "current version is documented" rule (item 5.2).
  const changelogPath = path.join(root, 'CHANGELOG.md');
  const history =
    fs.readFileSync(path.join(root, 'HISTORY.md'), 'utf8') +
    (fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, 'utf8') : '');
  if (!history.includes(`## ${version}`) && !history.includes(`# ${version}`)) {
    problems.push(`Neither HISTORY.md nor CHANGELOG.md has an entry for the current version ${version}.`);
  }

  const publish = fs.readFileSync(path.join(root, '.github', 'workflows', 'publish.yml'), 'utf8');
  const major = version.split('.')[0];
  if (!publish.includes(`usereye:${major},`) && !publish.includes(`usereye:${major}\n`)) {
    problems.push(`publish.yml must tag the container with the current major (:${major}).`);
  }

  if (problems.length) {
    for (const problem of problems) {
      console.error(`sync-version: FAIL — ${problem}`);
    }
    process.exit(1);
  }
  console.log(`sync-version: OK — ${version} is single-sourced from package.json.`);
}

main();
