#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const SUPPORTED_FORMATS = ['github', 'jira', 'linear'];
const DEFAULT_SEVERITIES = ['blocker', 'critical'];
const SEVERITY_ORDER = ['blocker', 'critical', 'major', 'minor'];

const EXPORT_USAGE = `Usage: usereye export-issues <result.json|artifacts-dir> [options]

  <target>            result.json file, or an artifacts directory containing one
  --format <fmt>      github (default), jira, or linear
  --severity <list>   Comma-separated severities to export (default: blocker,critical)
  --project <key>     Jira project key (default: UE)
  --labels <list>     Extra comma-separated labels/tags added to every issue
  --out <file>        Write JSON payload to a file instead of stdout

Emits ready-to-post payloads for quality-management tools so blocker/critical
findings can be turned into issues automatically from CI (roadmap item 6.4):
  - github: array consumable by \`gh issue create --title ... --body-file ...\`
  - jira:   { issueUpdates: [...] } for POST /rest/api/3/issue/bulk
  - linear: { issues: [...] } matching Linear's issue create inputs
`;

function parseExportArgv(argv = []) {
  const options = {
    target: null,
    format: 'github',
    severities: [...DEFAULT_SEVERITIES],
    projectKey: 'UE',
    labels: ['usereye'],
    out: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--format') {
      options.format = String(argv[++index] || '').toLowerCase();
      if (!SUPPORTED_FORMATS.includes(options.format)) {
        throw new Error(`Unknown --format: ${options.format}. Use ${SUPPORTED_FORMATS.join(', ')}.`);
      }
    } else if (token === '--severity') {
      options.severities = String(argv[++index] || '')
        .split(',')
        .map(value => value.trim().toLowerCase())
        .filter(Boolean);
      const unknown = options.severities.filter(value => !SEVERITY_ORDER.includes(value));
      if (!options.severities.length || unknown.length) {
        throw new Error(`Invalid --severity list. Valid values: ${SEVERITY_ORDER.join(', ')}.`);
      }
    } else if (token === '--project') {
      options.projectKey = String(argv[++index] || '');
      if (!options.projectKey) throw new Error('--project requires a Jira project key.');
    } else if (token === '--labels') {
      options.labels = String(argv[++index] || '')
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);
    } else if (token === '--out') {
      options.out = String(argv[++index] || '');
      if (!options.out) throw new Error('--out requires a file path.');
    } else if (token === '--help' || token === '-h') {
      options.help = true;
    } else if (!token.startsWith('--') && !options.target) {
      options.target = token;
    } else {
      throw new Error(`Unknown export-issues option: ${token}`);
    }
  }
  return options;
}

function loadResult(target) {
  if (!target) throw new Error('A result.json file or artifacts directory is required.');
  const resolved = path.resolve(target);
  const resultPath =
    fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()
      ? path.join(resolved, 'result.json')
      : resolved;
  if (!fs.existsSync(resultPath)) {
    throw new Error(`result.json not found: ${resultPath}`);
  }
  const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  if (!result || !Array.isArray(result.issues)) {
    throw new Error(`Not a UserEye result file (no issues array): ${resultPath}`);
  }
  return { result, resultPath };
}

function issueBody(issue, result) {
  const lines = [
    `**Severity:** ${issue.severity}`,
    issue.step ? `**Step:** ${issue.step}` : null,
    issue.occurrences > 1 ? `**Occurrences:** ${issue.occurrences}` : null,
    '',
    `**Expected:** ${issue.expected || '—'}`,
    '',
    `**Observed:** ${issue.actual || '—'}`,
    issue.technical
      ? ['', '**Technical details:**', '', '```', String(issue.technical).slice(0, 4000), '```']
      : null,
    issue.evidence ? ['', `**Evidence:** ${issue.evidence}`] : null,
    '',
    `---`,
    `Reported by UserEye ${result.toolVersion || ''} against ${result.application?.name || result.application?.baseURL || 'the target application'}${result.finishedAt ? ` on ${result.finishedAt}` : ''}.`,
  ].filter(Boolean);
  return lines.join('\n');
}

function selectIssues(result, severities = DEFAULT_SEVERITIES) {
  return (result.issues || [])
    .filter(issue => issue.kind !== 'opinion' && issue.triage !== 'accepted-pattern')
    .filter(issue => severities.includes(String(issue.severity || '').toLowerCase()))
    .sort(
      (first, second) => SEVERITY_ORDER.indexOf(first.severity) - SEVERITY_ORDER.indexOf(second.severity),
    );
}

/**
 * Build tool-specific payloads from a UserEye result (pure; unit-testable).
 * @param {object} result Parsed result.json content.
 * @param {{format?: string, severities?: string[], projectKey?: string, labels?: string[]}} [options]
 */
function buildIssuePayloads(result, options = {}) {
  const format = options.format || 'github';
  const severities = options.severities || DEFAULT_SEVERITIES;
  const labels = options.labels || ['usereye'];
  const projectKey = options.projectKey || 'UE';
  const issues = selectIssues(result, severities);

  if (format === 'github') {
    return issues.map(issue => ({
      title: `[${issue.severity}] ${issue.id}: ${issue.title}`.slice(0, 250),
      body: issueBody(issue, result),
      labels: [...labels, issue.severity],
    }));
  }
  if (format === 'jira') {
    const priorityFor = severity =>
      ({ blocker: 'Highest', critical: 'High', major: 'Medium', minor: 'Low' })[severity] || 'Medium';
    return {
      issueUpdates: issues.map(issue => ({
        fields: {
          project: { key: projectKey },
          issuetype: { name: 'Bug' },
          summary: `[UserEye ${issue.severity}] ${issue.title}`.slice(0, 250),
          description: {
            type: 'doc',
            version: 1,
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: issueBody(issue, result).slice(0, 20000) }],
              },
            ],
          },
          priority: { name: priorityFor(issue.severity) },
          labels: [...labels, issue.severity].map(label => label.replace(/\s+/g, '-').slice(0, 250)),
        },
      })),
    };
  }
  if (format === 'linear') {
    const priorityFor = severity => ({ blocker: 1, critical: 2, major: 3, minor: 4 })[severity] || 3;
    return {
      issues: issues.map(issue => ({
        title: `[UserEye ${issue.severity}] ${issue.title}`.slice(0, 250),
        description: issueBody(issue, result).slice(0, 20000),
        priority: priorityFor(issue.severity),
        labels,
      })),
    };
  }
  throw new Error(`Unknown format: ${format}`);
}

async function runExportIssues(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseExportArgv(argv);
  } catch (error) {
    console.error(`${error.message}\n\n${EXPORT_USAGE}`);
    return { exitCode: 2 };
  }
  if (options.help) {
    console.log(EXPORT_USAGE);
    return { exitCode: 0 };
  }
  let result;
  let resultPath;
  try {
    ({ result, resultPath } = loadResult(options.target));
  } catch (error) {
    console.error(error.message);
    return { exitCode: 2 };
  }
  const payload = buildIssuePayloads(result, options);
  const count = Array.isArray(payload)
    ? payload.length
    : (payload.issueUpdates || payload.issues || []).length;
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  if (options.out) {
    fs.mkdirSync(path.dirname(path.resolve(options.out)), { recursive: true });
    fs.writeFileSync(options.out, serialized);
    console.log(`Wrote ${count} issue payload(s) (${options.format}) to ${options.out}`);
  } else {
    process.stdout.write(serialized);
  }
  if (!count) {
    console.error(`No issues matched severities [${options.severities.join(', ')}] in ${resultPath}.`);
  }
  return { exitCode: 0, payload, count, resultPath };
}

module.exports = {
  EXPORT_USAGE,
  SUPPORTED_FORMATS,
  DEFAULT_SEVERITIES,
  buildIssuePayloads,
  issueBody,
  loadResult,
  parseExportArgv,
  runExportIssues,
  selectIssues,
};
