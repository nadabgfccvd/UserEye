#!/usr/bin/env node
'use strict';

/**
 * API surface check (roadmap items 0.2 / 2.1): every runtime export of the
 * package must be declared in types/index.d.ts with a real signature, and
 * every declared value export must exist at runtime. Also verifies that all
 * public UserEye prototype methods are declared on the UserEye class type.
 *
 * Usage: node scripts/check-api-surface.js
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const problems = [];

function exportedNamesFromDts(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const values = new Set();
  const types = new Set();
  const re = /export\s+(?:declare\s+)?(const|let|var|function|class|type|interface|enum)\s+([A-Za-z0-9_$]+)/g;
  let match;
  while ((match = re.exec(source))) {
    const [, kind, name] = match;
    if (kind === 'type' || kind === 'interface') {
      types.add(name);
    } else {
      values.add(name);
    }
  }
  const reExport = /export\s*\{([^}]+)\}\s*from/g;
  while ((match = reExport.exec(source))) {
    for (const raw of match[1].split(',')) {
      const name = raw
        .trim()
        .split(/\s+as\s+/)
        .pop()
        .trim();
      if (!name) continue;
      // `export type { X }` or names known to be interfaces/types elsewhere.
      if (/^type\s/.test(raw.trim())) {
        types.add(name);
      } else {
        values.add(name);
      }
    }
  }
  return { values, types, source };
}

function classMembers(source, className) {
  const start = source.indexOf(`export class ${className}`);
  if (start < 0) return null;
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  let end = bodyStart;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }
  const body = source.slice(bodyStart + 1, end);
  const members = new Set();
  const memberRe = /^\s*(?:readonly\s+)?([A-Za-z0-9_$]+)\s*(?:<[^<(]*>)?\s*[(:?]/gm;
  let match;
  while ((match = memberRe.exec(body))) {
    members.add(match[1]);
  }
  return members;
}

function main() {
  const runtime = require(path.join(root, 'index.js'));
  const runtimeNames = new Set(Object.keys(runtime));
  const {
    values: declaredValues,
    types: declaredTypes,
    source,
  } = exportedNamesFromDts(path.join(root, 'types', 'index.d.ts'));
  const configDts = exportedNamesFromDts(path.join(root, 'types', 'usereye-config.d.ts'));
  for (const name of configDts.types) declaredTypes.add(name);
  for (const name of configDts.values) declaredValues.add(name);

  // Re-exports from usereye-config via `export *` are types-only in this package.
  const starExport = /export\s*\*\s*from\s*'\.\/usereye-config'/.test(source);
  if (!starExport) {
    problems.push('types/index.d.ts should re-export ./usereye-config.');
  }

  for (const name of runtimeNames) {
    if (!declaredValues.has(name) && !declaredTypes.has(name)) {
      problems.push(`runtime export "${name}" is missing from types/index.d.ts.`);
    }
  }
  for (const name of declaredValues) {
    if (!runtimeNames.has(name) && !declaredTypes.has(name)) {
      problems.push(`types/index.d.ts declares value export "${name}" that runtime does not export.`);
    }
  }

  // UserEye public prototype members must be declared on the class type.
  const declaredMembers = classMembers(source, 'UserEye');
  if (!declaredMembers) {
    problems.push('types/index.d.ts has no `export class UserEye` block.');
  } else {
    const proto = Object.getOwnPropertyNames(runtime.UserEye.prototype).filter(
      name => name !== 'constructor' && !name.startsWith('_'),
    );
    for (const member of proto) {
      if (!declaredMembers.has(member)) {
        problems.push(`UserEye#${member}() is public at runtime but missing from the UserEye type.`);
      }
    }
  }

  // classifyPage / mergeBudget must have real signatures, not `unknown` stubs.
  for (const fn of ['classifyPage', 'mergeBudget']) {
    const signature = new RegExp(`export function ${fn}\\(([^)]*)\\)\\s*:`);
    const match = source.match(signature);
    if (!match) {
      problems.push(`types/index.d.ts must declare \`export function ${fn}(...): ...\`.`);
    } else if (!match[1].trim()) {
      problems.push(`${fn} declaration has no parameters; mirror the real signature.`);
    }
  }

  if (problems.length) {
    for (const problem of problems) console.error(`api-surface: FAIL — ${problem}`);
    process.exit(1);
  }
  console.log(
    `api-surface: OK — ${runtimeNames.size} runtime exports fully declared; UserEye type covers ${
      declaredMembers ? declaredMembers.size : 0
    } members.`,
  );
}

main();
