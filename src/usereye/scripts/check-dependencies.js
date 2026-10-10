#!/usr/bin/env node
'use strict';

/**
 * Dependency hygiene gate (roadmap M3, Phase 2).
 *
 * Three rules, all learned from real drift in the 7.4.x line:
 *
 *   1. **Runtime dependencies are pinned exactly.** `playwright` was pinned to
 *      `1.63.0` while `axe-core` floated on `^4.13.0`. A caret on a runtime
 *      dependency means two installs of the same UserEye version can produce
 *      different findings — which destroys the whole premise of `--compare`.
 *
 *   2. **Every declared dependency actually resolves,** and the installed
 *      version satisfies what package.json says. Catches a lockfile that
 *      drifted from the manifest.
 *
 *   3. **`engines.node` agrees with `@types/node`.** Declaring `>=18.18` while
 *      typechecking against `@types/node@26` type-checks code that cannot run
 *      on the minimum supported runtime.
 *
 * Usage: node scripts/check-dependencies.js
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const problems = [];
const notes = [];

// --- 1. runtime dependencies must be exact -----------------------------------
const EXACT = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/;
for (const [name, range] of Object.entries(pkg.dependencies || {})) {
  if (!EXACT.test(range)) {
    problems.push(
      `runtime dependency "${name}" is "${range}" — runtime deps must be pinned exactly for reproducible findings.`,
    );
  } else {
    notes.push(`${name}@${range} (pinned)`);
  }
}

// --- 2. installed versions must exist and satisfy the manifest ---------------
function installedVersion(name) {
  try {
    return JSON.parse(fs.readFileSync(require.resolve(`${name}/package.json`, { paths: [root] }), 'utf8'))
      .version;
  } catch {
    return null;
  }
}

const skipResolution = process.argv.includes('--no-resolve');
if (!skipResolution) {
  for (const [name, range] of Object.entries(pkg.dependencies || {})) {
    const version = installedVersion(name);
    if (!version) {
      problems.push(`runtime dependency "${name}" is not installed — run npm ci.`);
      continue;
    }
    if (EXACT.test(range) && version !== range) {
      problems.push(`"${name}" resolves to ${version} but package.json pins ${range}.`);
    }
  }
  for (const name of Object.keys(pkg.devDependencies || {})) {
    if (!installedVersion(name)) {
      notes.push(`devDependency "${name}" is not installed (fine for a consumer install).`);
    }
  }
}

// --- 3. engines.node must agree with @types/node -----------------------------
const engineRange = pkg.engines?.node || '';
const engineMajor = Number.parseInt(/(\d+)/.exec(engineRange)?.[1] || '0', 10);
const typesRange = pkg.devDependencies?.['@types/node'] || '';
const typesMajor = Number.parseInt(/(\d+)/.exec(typesRange)?.[1] || '0', 10);
if (engineMajor && typesMajor && typesMajor !== engineMajor) {
  problems.push(
    `engines.node is "${engineRange}" (major ${engineMajor}) but @types/node is "${typesRange}" (major ${typesMajor}). ` +
      'Type-check against the MINIMUM supported runtime, otherwise APIs newer than that runtime type-check clean and crash in production.',
  );
}

// A LTS Node line must be a real one.
const SUPPORTED_NODE_MAJORS = [20, 22, 24];
if (engineMajor && !SUPPORTED_NODE_MAJORS.includes(engineMajor)) {
  problems.push(
    `engines.node minimum major ${engineMajor} is not one of the supported lines ${SUPPORTED_NODE_MAJORS.join('/')}.`,
  );
}

if (problems.length) {
  for (const problem of problems) console.error(`dependency-check: FAIL — ${problem}`);
  process.exit(1);
}
console.log(
  `dependency-check: OK — ${Object.keys(pkg.dependencies || {}).length} runtime dep(s) pinned, ` +
    `engines.node "${engineRange}" matches @types/node "${typesRange}".`,
);
for (const note of notes) console.log(`  · ${note}`);
