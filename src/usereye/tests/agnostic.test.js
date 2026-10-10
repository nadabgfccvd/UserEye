'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const { loadPatterns, serializePatterns } = require('../patterns');
const { AdaptiveExplorer, classifyPage } = require('../adaptive-explorer');
const { ProjectAdapter } = require('../project-adapter');
const { ProtocolRunner } = require('../protocol-runner');

const root = path.resolve(__dirname, '..');

test('English and Portuguese pattern packs are independently selectable and extensible', () => {
  const english = loadPatterns({ packs: ['en'] });
  const portuguese = loadPatterns({ packs: ['pt'] });
  assert.equal(english.auth.test('Sign in'), true);
  assert.equal(english.auth.test('Entrar'), false);
  assert.equal(portuguese.auth.test('Entrar'), true);
  assert.equal(portuguese.dangerous.test('Excluir conta'), true);
  const custom = loadPatterns({ packs: ['en'], custom: { dangerous: /erase tenant/i } });
  assert.equal(custom.dangerous.test('Erase tenant'), true);
  assert.deepEqual(Object.keys(serializePatterns(custom)).sort(), Object.keys(custom).sort());
});

test('page classification consumes the selected pattern pack', () => {
  const facts = {
    controls: 2,
    passwordInputs: 1,
    forms: 1,
    inputs: 2,
    tables: 0,
    navigation: 0,
    headings: 1,
    cards: 0,
  };
  const observation = { title: 'Acessar', visibleText: 'Digite sua senha' };
  assert.equal(classifyPage(observation, facts, loadPatterns({ packs: ['pt'] })), 'authentication');
  assert.equal(classifyPage(observation, facts, loadPatterns({ packs: ['en'] })), 'form');
});

test('configured paths and control names are blocked before action', () => {
  const explorer = new AdaptiveExplorer(
    { telemetry: {} },
    {
      baseURL: 'https://app.example/',
      blockPaths: ['/billing/cancel', /\/admin\/.+\/delete/],
      blockNamePatterns: [/close account/i],
      patternPack: ['en'],
    },
  );
  assert.equal(
    explorer._candidateSkipReason({ href: '/billing/cancel', name: 'Billing', kind: 'navigation' }),
    'config-block',
  );
  assert.equal(
    explorer._candidateSkipReason({ href: '/admin/a/delete', name: 'Open', kind: 'navigation' }),
    'config-block',
  );
  assert.equal(
    explorer._candidateSkipReason({ href: '/profile', name: 'Close account', kind: 'navigation' }),
    'config-block',
  );
  assert.equal(
    explorer._candidateSkipReason({ href: '/profile', name: 'Profile', kind: 'navigation' }),
    null,
  );
});

test('project adapter detects generic Next and Django fixtures and honors appDir', () => {
  const nextRoot = path.join(root, 'tests', 'fixtures', 'next-app');
  const next = new ProjectAdapter({ projectDir: nextRoot }).analyze();
  assert.equal(next.stack, 'Next.js');
  assert.match(next.startCommand, /npm run dev/);

  const djangoRoot = path.join(root, 'tests', 'fixtures', 'django');
  const django = new ProjectAdapter({ projectDir: djangoRoot }).analyze();
  assert.equal(django.stack, 'Django');

  const monorepo = new ProjectAdapter({
    projectDir: path.join(root, 'tests', 'fixtures'),
    appDir: 'next-app',
  }).analyze();
  assert.equal(monorepo.appDir, nextRoot);
  assert.equal(monorepo.stack, 'Next.js');
});

test('plugin protocols extend the registry without changing core', () => {
  const eye = { options: {} };
  const plugin = {
    id: 'fixture',
    protocols: [{ id: 'fixture-check', run: async () => ({ status: 'passed' }) }],
  };
  const runner = new ProtocolRunner(eye, { baseURL: 'https://example.test', plugins: [plugin] });
  assert.equal(
    runner.registry().some(item => item.id === 'fixture-check'),
    true,
  );
  assert.equal(
    runner.registry().some(item => item.id === 'http-document'),
    true,
  );
});

test('repository contains at least five diverse app fixtures', () => {
  const fixtureRoot = path.join(root, 'tests', 'fixtures');
  const fixtures = fs
    .readdirSync(fixtureRoot)
    .filter(name => fs.statSync(path.join(fixtureRoot, name)).isDirectory());
  assert.ok(fixtures.length >= 5, `expected >=5 fixtures, got ${fixtures.length}`);
  for (const expected of ['static', 'spa', 'english', 'portuguese', 'sso', 'consent', 'next-app', 'django']) {
    assert.ok(fixtures.includes(expected));
  }
});
