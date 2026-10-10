#!/usr/bin/env node
'use strict';

/**
 * Strict Docker ⇄ npm Playwright alignment check (roadmap items 0.1 / 3.2).
 *
 * Fails when any of these diverge:
 *   1. package.json "playwright" dependency (must be an exact pin)
 *   2. package-lock.json resolved version
 *   3. Dockerfile base image tag (mcr.microsoft.com/playwright:vX.Y.Z-noble)
 *   4. the actually installed node_modules/playwright (when present)
 *
 * Usage: node scripts/check-playwright-version.js
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function fail(message) {
  console.error(`playwright-version-check: FAIL — ${message}`);
  process.exit(1);
}

function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const declared = pkg.dependencies?.playwright;
  if (!declared) {
    fail('package.json has no "playwright" dependency.');
  }
  const exact = /^\d+\.\d+\.\d+$/.test(declared);
  if (!exact) {
    fail(
      `package.json playwright range "${declared}" is not an exact pin. ` +
        'Use the exact version that matches the Dockerfile tag (e.g. "1.63.0").',
    );
  }

  const lockPath = path.join(root, 'package-lock.json');
  let locked = null;
  if (fs.existsSync(lockPath)) {
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    locked =
      lock.packages?.['node_modules/playwright']?.version || lock.dependencies?.playwright?.version || null;
    if (!locked) {
      fail('package-lock.json does not resolve node_modules/playwright.');
    }
    if (locked !== declared) {
      fail(`package-lock resolves playwright ${locked} but package.json pins ${declared}.`);
    }
  }

  const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  const tagMatch = dockerfile.match(/mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)(-\w+)?/);
  if (!tagMatch) {
    fail('Dockerfile does not pin a mcr.microsoft.com/playwright:vX.Y.Z base image.');
  }
  if (tagMatch[1] !== declared) {
    fail(
      `Dockerfile image v${tagMatch[1]} diverges from pinned playwright ${declared}. ` +
        'Update both together (Dependabot groups them; see .github/dependabot.yml).',
    );
  }

  const installedPath = path.join(root, 'node_modules', 'playwright', 'package.json');
  if (fs.existsSync(installedPath)) {
    const installed = JSON.parse(fs.readFileSync(installedPath, 'utf8')).version;
    if (installed !== declared) {
      fail(`installed playwright ${installed} diverges from pinned ${declared}. Run npm install.`);
    }
  }

  console.log(
    `playwright-version-check: OK — package.json=${declared} lock=${locked || '(absent)'} docker=v${tagMatch[1]}${tagMatch[2] || ''}`,
  );
}

main();
