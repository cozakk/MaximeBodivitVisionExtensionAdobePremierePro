#!/usr/bin/env node
/*
 * Automated checks for the Maxime Bodivit Vision Ext panel (run in CI).
 *
 *  1. Syntax-check the JS sources (js/main.js, jsx/host.jsx).
 *  2. Every data-i18n / data-i18n-title / data-i18n-ph key used in
 *     index.html must exist in the FR table.
 *  3. All language tables (fr/en/es/de) must share the exact same key set.
 *
 * Exits non-zero if any check fails.
 */
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const fail = (m) => { console.error('FAIL : ' + m); failures++; };
const pass = (m) => console.log('ok   : ' + m);

// ---- 1) Syntax checks (parse only, never executed) ----
function syntaxCheck(rel) {
  try {
    // eslint-disable-next-line no-new
    new vm.Script(readFileSync(join(root, rel), 'utf8'), { filename: rel });
    pass('syntaxe ' + rel);
  } catch (e) {
    fail('syntaxe ' + rel + ' : ' + e.message);
  }
}
syntaxCheck('js/main.js');
syntaxCheck('jsx/host.jsx');

// ---- 2 & 3) i18n key coverage / parity ----
const html = readFileSync(join(root, 'index.html'), 'utf8');
const used = new Set();
for (const m of html.matchAll(/data-i18n(?:-title|-ph)?="([^"]+)"/g)) used.add(m[1]);

const mainJs = readFileSync(join(root, 'js/main.js'), 'utf8');
const LANGS = ['fr', 'en', 'es', 'de'];
const tables = {};
let cur = null;
for (const line of mainJs.split('\n')) {
  const open = line.match(/^\s{4}(fr|en|es|de):\s*\{/);
  if (open) { cur = open[1]; tables[cur] = new Set(); continue; }
  if (/^\s{4}\},?\s*$/.test(line)) { cur = null; continue; }
  if (cur) {
    const key = line.match(/^\s+'([A-Za-z0-9_.]+)'\s*:/);
    if (key) tables[cur].add(key[1]);
  }
}

for (const lang of LANGS) {
  if (!tables[lang] || tables[lang].size === 0) fail('table de langue vide ou manquante : ' + lang);
}

const ref = tables.fr || new Set();
for (const k of used) {
  if (!ref.has(k)) fail('cle utilisee dans index.html absente de la table FR : ' + k);
}
for (const lang of LANGS) {
  if (lang === 'fr' || !tables[lang]) continue;
  for (const k of ref) if (!tables[lang].has(k)) fail(`cle absente de ${lang} : ${k}`);
  for (const k of tables[lang]) if (!ref.has(k)) fail(`cle en trop dans ${lang} : ${k}`);
}
if (failures === 0) pass(`i18n : ${ref.size} cles x ${LANGS.length} langues, ${used.size} cles UI verifiees`);

// ---- Result ----
if (failures > 0) {
  console.error(`\n${failures} echec(s).`);
  process.exit(1);
}
console.log('\nTous les controles sont passes.');
