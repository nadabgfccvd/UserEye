'use strict';

/** Tests for the quality-tool issue connectors (roadmap item 6.4). */

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const {
  buildIssuePayloads,
  loadResult,
  parseExportArgv,
  runExportIssues,
  selectIssues,
} = require('../issue-export');

function sampleResult() {
  return {
    toolVersion: '7.1.0',
    application: { name: 'Demo App', baseURL: 'http://127.0.0.1:4173' },
    finishedAt: '2026-09-05T12:00:00.000Z',
    issues: [
      {
        id: 'ISSUE-001',
        severity: 'blocker',
        title: 'Login form returns 500',
        step: 'Authenticate',
        expected: 'The login succeeds.',
        actual: 'HTTP 500 on submit',
        technical: 'Error: boom\n    at …',
        evidence: 'screenshots/01-authenticate.jpg',
        occurrences: 2,
      },
      {
        id: 'ISSUE-002',
        severity: 'minor',
        title: 'Typo in footer',
        step: null,
        expected: 'Correct copy.',
        actual: '“Copyrght”',
        technical: '',
        evidence: null,
        occurrences: 1,
      },
      {
        id: 'ISSUE-003',
        severity: 'critical',
        title: 'Text below WCAG AA contrast',
        step: 'Explore',
        expected: 'Contrast ≥ 4.5:1.',
        actual: '2.3:1 on 4 elements',
        technical: '',
        evidence: null,
        occurrences: 1,
      },
    ],
  };
}

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('export: default selection is blocker+critical, severity-sorted', () => {
  const selected = selectIssues(sampleResult());
  assert.deepEqual(
    selected.map(issue => issue.id),
    ['ISSUE-001', 'ISSUE-003'],
  );
  const minors = selectIssues(sampleResult(), ['minor']);
  assert.deepEqual(
    minors.map(issue => issue.id),
    ['ISSUE-002'],
  );
});

test('export: github payloads are gh-cli ready', () => {
  const payload = buildIssuePayloads(sampleResult(), { format: 'github' });
  assert.equal(payload.length, 2);
  assert.equal(payload[0].title, '[blocker] ISSUE-001: Login form returns 500');
  assert.match(payload[0].body, /HTTP 500 on submit/);
  assert.match(payload[0].body, /\*\*Occurrences:\*\* 2/);
  assert.match(payload[0].body, /Reported by UserEye 7\.1\.0 against Demo App/);
  assert.deepEqual(payload[0].labels, ['usereye', 'blocker']);
});

test('export: jira payloads use the bulk issueUpdates shape with ADF descriptions', () => {
  const payload = buildIssuePayloads(sampleResult(), { format: 'jira', projectKey: 'QA' });
  assert.equal(payload.issueUpdates.length, 2);
  const blocker = payload.issueUpdates[0].fields;
  assert.deepEqual(blocker.project, { key: 'QA' });
  assert.deepEqual(blocker.issuetype, { name: 'Bug' });
  assert.deepEqual(blocker.priority, { name: 'Highest' });
  assert.equal(blocker.description.type, 'doc');
  assert.match(blocker.description.content[0].content[0].text, /Login form returns 500|HTTP 500/);
  assert.ok(blocker.labels.includes('blocker'));
  const critical = payload.issueUpdates[1].fields;
  assert.deepEqual(critical.priority, { name: 'High' });
});

test('export: linear payloads map severity to Linear priorities', () => {
  const payload = buildIssuePayloads(sampleResult(), { format: 'linear' });
  assert.equal(payload.issues.length, 2);
  assert.equal(payload.issues[0].priority, 1, 'blocker → Urgent');
  assert.equal(payload.issues[1].priority, 2, 'critical → High');
  assert.ok(payload.issues[0].description.includes('UserEye'));
});

test('export: loadResult accepts a file or a directory and rejects junk', () => {
  const dir = tmpDir('usereye-export-');
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(sampleResult()));
  assert.equal(loadResult(dir).result.issues.length, 3);
  assert.equal(loadResult(path.join(dir, 'result.json')).resultPath, path.join(dir, 'result.json'));
  assert.throws(() => loadResult(path.join(dir, 'missing.json')), /not found/);
  fs.writeFileSync(path.join(dir, 'junk.json'), '{"hello":1}');
  assert.throws(() => loadResult(path.join(dir, 'junk.json')), /Not a UserEye result/);
  assert.throws(() => loadResult(null), /required/);
});

test('export: argv parsing validates formats and severities', () => {
  const options = parseExportArgv([
    'out',
    '--format',
    'linear',
    '--severity',
    'major,minor',
    '--labels',
    'qa,ux',
  ]);
  assert.equal(options.format, 'linear');
  assert.deepEqual(options.severities, ['major', 'minor']);
  assert.deepEqual(options.labels, ['qa', 'ux']);
  assert.throws(() => parseExportArgv(['x', '--format', 'asana']), /Unknown --format/);
  assert.throws(() => parseExportArgv(['x', '--severity', 'apocalyptic']), /Invalid --severity/);
  assert.throws(() => parseExportArgv(['x', '--bogus']), /Unknown export-issues option/);
});

test('export: runExportIssues writes the payload file and reports zero matches', async () => {
  const dir = tmpDir('usereye-export-run-');
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(sampleResult()));
  const outFile = path.join(dir, 'out', 'issues.json');

  const run = await runExportIssues([dir, '--format', 'jira', '--project', 'SEC', '--out', outFile]);
  assert.equal(run.exitCode, 0);
  assert.equal(run.count, 2);
  const written = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  assert.equal(written.issueUpdates.length, 2);
  assert.equal(written.issueUpdates[0].fields.project.key, 'SEC');

  const quiet = await runExportIssues([dir, '--severity', 'minor', '--out', path.join(dir, 'minor.json')]);
  assert.equal(quiet.exitCode, 0);
  assert.equal(quiet.count, 1);

  const badUsage = await runExportIssues(['--format', 'nope']);
  assert.equal(badUsage.exitCode, 2);
  const missingTarget = await runExportIssues([path.join(dir, 'nope')]);
  assert.equal(missingTarget.exitCode, 2);
  const help = await runExportIssues(['--help']);
  assert.equal(help.exitCode, 0);
});
