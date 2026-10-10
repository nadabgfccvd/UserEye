'use strict';

/** Tests for the built-in language pattern packs, including es/fr (roadmap item 6.1). */

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const { loadPatterns } = require('../patterns');

const PACKS_DIR = path.join(__dirname, '..', 'patterns');
const CATEGORIES = [
  'auth',
  'authPage',
  'setupPage',
  'dangerous',
  'write',
  'navigation',
  'utility',
  'skipLink',
  'copy',
  'errorPage',
  'emptyPage',
];

test('i18n: every built-in pack declares every category', () => {
  const packs = fs
    .readdirSync(PACKS_DIR)
    .filter(file => file.endsWith('.json'))
    .map(file => path.basename(file, '.json'));
  assert.ok(packs.includes('en') && packs.includes('pt'));
  assert.ok(packs.includes('es') && packs.includes('fr'), 'es and fr packs ship built in');
  for (const pack of packs) {
    const compiled = loadPatterns({ packs: [pack] });
    for (const category of CATEGORIES) {
      assert.ok(compiled[category] instanceof RegExp, `${pack}.${category} compiles`);
      const raw = JSON.parse(fs.readFileSync(path.join(PACKS_DIR, `${pack}.json`), 'utf8'));
      assert.ok(
        Array.isArray(raw[category]) && raw[category].length > 0,
        `${pack}.json must populate ${category}`,
      );
    }
  }
});

test('i18n: the Spanish pack recognises Spanish interfaces (and not English ones)', () => {
  const es = loadPatterns({ packs: ['es'] });
  assert.equal(es.auth.test('Iniciar sesión'), true);
  assert.equal(es.auth.test('Acceder a tu cuenta'), true);
  assert.equal(es.dangerous.test('Eliminar cuenta'), true);
  assert.equal(es.dangerous.test('Cerrar sesión'), true);
  assert.equal(es.write.test('Guardar cambios'), true);
  assert.equal(es.setupPage.test('Crear cuenta'), true);
  assert.equal(es.errorPage.test('Página no encontrada'), true);
  assert.equal(es.emptyPage.test('Sin resultados'), true);
  assert.equal(es.utility.test('Cancelar'), true);
  assert.equal(es.skipLink.test('Saltar al contenido'), true);
  assert.equal(es.auth.test('Sign in'), false, 'packs stay independent unless combined');
});

test('i18n: the French pack recognises French interfaces', () => {
  const fr = loadPatterns({ packs: ['fr'] });
  assert.equal(fr.auth.test('Se connecter'), true);
  assert.equal(fr.authPage.test('Mot de passe'), true);
  assert.equal(fr.dangerous.test('Supprimer le compte'), true);
  assert.equal(fr.dangerous.test('Se déconnecter'), true);
  assert.equal(fr.write.test('Enregistrer'), true);
  assert.equal(fr.setupPage.test('Créer un compte'), true);
  assert.equal(fr.errorPage.test('Page introuvable'), true);
  assert.equal(fr.emptyPage.test('Aucun résultat'), true);
  assert.equal(fr.navigation.test('Tableau de bord'), true);
  assert.equal(fr.auth.test('Sign in'), false);
});

test('i18n: packs combine additively for multilingual products', () => {
  const combined = loadPatterns({ packs: ['en', 'es', 'fr'] });
  assert.equal(combined.auth.test('Sign in'), true);
  assert.equal(combined.auth.test('Iniciar sesión'), true);
  assert.equal(combined.auth.test('Se connecter'), true);
  assert.equal(combined.dangerous.test('Delete account'), true);
  assert.equal(combined.dangerous.test('Eliminar cuenta'), true);
  assert.equal(combined.dangerous.test('Supprimer'), true);
});
