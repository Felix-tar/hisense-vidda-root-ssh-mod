// 18.11.2026: dmpActive() darf einem veralteten App-Manager-Wert "dmp" nicht glauben, wenn der echte Pfad ein HDMI-Eingang
// ist (am TV gesehen: nach einem Wechsel auf HDMI1 meldete getCurrentAppSource weiter "dmp", kodiPlay schaltete deshalb nicht
// auf DMP und Kodis Film lief hinter dem PS5-Bild). Aufruf: node mods/startscreen/tests/test-dmpactive.js [pfad/zu/flex.js]
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const file = process.argv[2] || __dirname + '/../flex/flex.js';
const src = fs.readFileSync(file, 'utf8');
const a = src.indexOf('  function dmpActive() {');
assert.ok(a >= 0, 'dmpActive nicht gefunden');
const b = src.indexOf('\n  }\n', a);
const fn = src.slice(a, b + 4);
function run(appSource, path) {
  const source = { getCurrentAppSource: () => appSource };
  if (path !== undefined) source.GetCurrentPath = typeof path === 'function' ? path : () => path;
  const c = { window: { modeljs: { source } } };
  vm.createContext(c);
  vm.runInContext(fn + '\nthis.r = dmpActive();', c);
  return c.r;
}
const dmp = JSON.stringify({ sessionId: 'local_app_0', sourceName: 'dmp' });
let n = 0;
function ok(v, want, what) { assert.strictEqual(v, want, what); n++; }
ok(run(dmp, 'dmp'), true, 'DMP mit Pfad dmp');
ok(run(dmp), true, 'ohne GetCurrentPath gilt der App-Manager-Wert (wie bisher)');
ok(run(dmp, ''), true, 'leerer Pfad: App-Manager-Wert');
ok(run(dmp, 'HDMI1'), false, 'veraltetes dmp bei Pfad HDMI1');
ok(run(dmp, 'hdmi2'), false, 'auch klein geschrieben');
ok(run(dmp, 'TV'), false, 'Antenne/Live-TV');
ok(run(dmp, () => { throw new Error('x'); }), true, 'Pfad nicht lesbar: App-Manager-Wert');
ok(run(JSON.stringify({ sourceName: 'hdmi1' }), 'dmp'), false, 'App-Manager sagt nicht dmp');
ok(run({ sourceName: 'dmp' }, 'HDMI1'), false, 'Objekt statt Text, Pfad HDMI1');
ok(run('kein json', 'dmp'), false, 'unlesbarer App-Manager-Wert');
console.log('dmpActive: ' + n + ' Pruefungen bestanden (veraltetes dmp bei HDMI-Pfad = nicht aktiv)');
