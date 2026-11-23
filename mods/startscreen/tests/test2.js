// Regression v6-Verhalten mit flex.js v7 (Bildschirmschoner, Kodi-Erkennung, INIT_LOADING, Hot-Reload)
'use strict';
const { makeEnv, frame, unframe } = require('./harness');
const FLEX = process.argv[2] || require('path').join(__dirname, '../flex/flex.js');
const V6 = process.env.FLEX_TEST_BASELINE;
const KEY = '00112233445566778899aabbccddeeff'; // Synthetic HMAC test vector
let fails = 0;
function check(c, msg) { console.log((c ? 'OK   ' : 'FAIL ') + msg); if (!c) fails++; }
function hasLog(env, re) { return env.logs.some(l => re.test(l)); }
function idx(env, re) { return env.logs.findIndex(l => re.test(l)); }

function boot(file, opts, pre) {
  const env = makeEnv(opts);
  env.files.set('flexdbg/enable', '');
  env.subs = {};
  env.UI.subscribeMessage = function (n, f) { env.subs[n] = f; };
  if (pre) pre(env);
  env.load(file || FLEX);
  env.advance(41000);
  return env;
}

// ---------- A: Bildschirmschoner und Diashow wie v6 ----------
(function () {
  console.log('--- A: Bildschirmschoner');
  const env = boot(FLEX, {}, function (e) {
    e.files.set('flexss/list.json', JSON.stringify(['/APPS/flexss/a.jpg', '/APPS/flexss/b.jpg']));
  });
  env.advance(61000);
  check(hasLog(env, /Bildschirmschoner: Oberfläche aus/), 'Schoner nach 60 s');
  env.advance(31000);
  check(hasLog(env, /Diashow mit 2 Bildern/), 'Diashow startet');
  check(env.commits.some(c => c[1] === 'DMP'), 'DMP für die Diashow');
  env.advance(5000);
  check(env.calls.some(c => c[0] === 'PlayMedia' && /^file:\/\/\/APPS\/flexss\//.test(c[1]) && c[2] === 16), 'Foto über PlayMedia Typ 16');
  // Kodi startet von Hand während der Diashow
  env.files.set('flexkodi/running', Math.floor(env.ctx.Date.now() / 1000) + ' 0 1');
  let t = 0;
  const iv = env.ctx.setInterval(function () { t++; env.files.set('flexkodi/running', (Math.floor(env.ctx.Date.now() / 1000)) + ' 0 1'); }, 2000);
  env.advance(1500);
  check(hasLog(env, /Kodi läuft/) && hasLog(env, /Bildschirmschoner beendet \(Kodi läuft\)/), 'Kodi beendet den Schoner ohne Quelle anzufassen');
  check(!env.commits.some(c => c[1] === 'LAST'), 'kein LAST unter Kodi');
  env.ctx.clearInterval(iv);
  env.files.delete('flexkodi/running');
  env.advance(8000);
  check(hasLog(env, /Kodi beendet/), 'Kodi-Ende erkannt');
  // v6-Verhalten (Nebenbefund P8): ohne kodiPlay bleibt DMP vom Schoner stehen
  check(!env.commits.some(c => c[1] === 'LAST'), 'ohne kodiPlay: DMP bleibt wie in v6');
})();

// ---------- B: liegengebliebenes running beim Boot ----------
(function () {
  console.log('--- B: altes running beim Boot');
  const env = boot(FLEX, {}, function (e) { e.files.set('flexkodi/running', '1730000000 0 1'); });
  env.advance(30000);
  check(!hasLog(env, /Kodi läuft/), 'unverändertes running gilt nicht als laufendes Kodi');
  check(env.ctx.__flex.version === 10, 'v10');
})();

// ---------- C: Kodi-Start über die Kachel mit pausiertem YouTube (E1-Hinweis), INIT_LOADING ----------
(function () {
  console.log('--- C: E1-Hinweis, INIT_LOADING');
  const env = boot(FLEX, { rob: true });
  // startKodi ist intern; über eine Taste auf der Kachel nicht erreichbar in der Attrappe -> Debug-Kanal
  // nicht nötig: wir prüfen den Text über den Hinweis-Baustein nach Kodi-Start per Datei
  check(typeof env.ctx.__flex.kpSnap === 'function', 'kpSnap vorhanden');
  // laufendes Kodi mit Wiedergabe, dann INIT_LOADING
  env.store.state.AppControl.runningOnBack = false;
  const iv = env.ctx.setInterval(function () { env.files.set('flexkodi/running', Math.floor(env.ctx.Date.now() / 1000) + ' 0 1'); }, 2000);
  env.files.set('flexkodi/running', Math.floor(env.ctx.Date.now() / 1000) + ' 0 1');
  env.advance(1500);
  env.files.set('flexkodi/rt/key', KEY);
  env.advance(1000);
  const sid = '0123456789abcdef';
  let hb = 1;
  const ctl = { v: 1, sid, seq: 0, hb: 1, pause: 0, seekN: 0, speed: 100, audio: -1, sub: -1, stop: 0 };
  env.files.set('flexkodi/rt/ctl', frame(KEY, 'ctl', ctl));
  env.files.set('flexkodi/rt/play.json', frame(KEY, 'play.json', { v: 1, sid, t: Math.floor(env.ctx.Date.now() / 1000), port: 40000, tok: 'ef'.repeat(16), name: 'media.mp4', resume: 0, dar: 1.7778, ov: 0, fb: 1 }));
  const iv2 = env.ctx.setInterval(function () { ctl.hb = ++hb; env.files.set('flexkodi/rt/ctl', frame(KEY, 'ctl', ctl)); }, 2000);
  env.advance(7000);
  let s = unframe(KEY, 'player.json', env.files.get('flexkodi/rt/player.json'));
  check(s && s.st === 'playing', 'läuft');
  const nStop = env.calls.filter(c => c[0] === 'MpCtrl' && c[1] === '[3,-1,0,"Media"]').length;
  env.subs.STR_SUSPENDING();
  s = unframe(KEY, 'player.json', env.files.get('flexkodi/rt/player.json'));
  check(s && s.st === 'stopped' && s.why === 'kodiGone', 'STR_SUSPENDING: Wiedergabe vergessen (stopped kodiGone)');
  check(env.calls.filter(c => c[0] === 'MpCtrl' && c[1] === '[3,-1,0,"Media"]').length === nStop, 'STR: Player nicht angefasst');
  check(env.files.has('flexkodi/stop'), 'STR: Kodi beenden');
  check(env.ctx.__flex.ownsDmp() === false, 'STR: DMP gilt nicht mehr als unseres');
  env.ctx.clearInterval(iv); env.ctx.clearInterval(iv2);
})();

// ---------- D: Hot-Reload v6 -> v7 und v7 -> v6 ----------
if (V6) (function () {
  console.log('--- D: Hot-Reload zwischen v6 und v7');
  const env = boot(V6);
  check(env.ctx.__flex.version === 6, 'v6 läuft');
  env.load(FLEX);
  env.advance(2000);
  check(env.ctx.__flex.version === 10 && hasLog(env, /flex\.js v10 geladen \(Hot-Reload\)/), 'v6 -> v10');
  env.load(V6);
  env.advance(2000);
  check(env.ctx.__flex.version === 6, 'v10 -> v6');
  // Zeitgeber der alten Instanzen sind weg: tvkTick (100 ms) läuft nicht mehr
  const n = env.timers.filter(t => t.iv === 100).length;
  check(n === 0, '100-ms-Takt nach Rückkehr zu v6 beendet: ' + n);
})();

// ---------- E: optional historical M2 fixture ----------
if (process.env.FLEX_TEST_M2) (function () {
  console.log('--- E: M2-Probe auf v7');
  const env = boot(process.env.FLEX_TEST_M2);
  check(env.ctx.__flex.m2 && typeof env.ctx.__flex.m2.play === 'function', 'M2-Probe eingebunden');
  const r = env.ctx.__flex.m2.play('http://127.0.0.1:18080/dvd-576i.mkv');
  check(r === 'M2 gestartet', 'M2 startet: ' + r);
  env.advance(6000);
  check(env.calls.some(c => c[0] === 'MpCtrl' && c[1] === '[1]'), 'M2: MpCtrl([1]) nach Zustand 2');
  env.ctx.__flex.m2.stop('Test');
})();

console.log(fails ? fails + ' FEHLER' : 'alle Prüfungen bestanden');
process.exit(fails ? 1 : 0);
