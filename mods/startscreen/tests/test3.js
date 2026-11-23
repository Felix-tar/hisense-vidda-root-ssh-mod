// Prüfungen zu den Review-Befunden (flex.js v7): Aufwachen nach STR, Player-Übernahme, DMP-Prüfung,
// Hot-Reload, D10-Ausgangswert, tvack-Wiederholung. Attrappe aus harness.js.
'use strict';
const { makeEnv, frame, unframe, hmac } = require('./harness');
const FLEX = process.argv[2] || require('path').join(__dirname, '../flex/flex.js');
const V6 = process.env.FLEX_TEST_BASELINE;
const KEY = '00112233445566778899aabbccddeeff'; // Synthetic HMAC test vector
const TOK = 'ab'.repeat(16);
const URL = 'http://127.0.0.1:37631/' + TOK + '/media.mkv';
let fails = 0;
function check(c, msg) { console.log((c ? 'OK   ' : 'FAIL ') + msg); if (!c) fails++; }
function hasLog(env, re) { return env.logs.some(l => re.test(l)); }
function countLog(env, re) { return env.logs.filter(l => re.test(l)).length; }
function calls(env, name) { return env.calls.filter(c => c[0] === name); }

function kodiSim(env) {
  const k = { on: false, ready: 1, lastKey: 0, hb: 0, ctl: null, sid: '', hbOn: true };
  k.beat = function () { env.files.set('flexkodi/running', Math.floor(env.ctx.Date.now() / 1000) + ' ' + k.lastKey + ' ' + k.ready); };
  k.start = function () {
    k.on = true;
    k.iv = env.ctx.setInterval(function () {
      if (!k.on) return;
      k.beat();
      if (k.ctl && k.hbOn) { k.hb++; k.ctl.hb = k.hb; env.files.set('flexkodi/rt/ctl', frame(KEY, 'ctl', k.ctl)); }
    }, 2000);
    k.beat();
  };
  k.freezeBeat = function () { k.on = false; env.ctx.clearInterval(k.iv); };   // running bleibt liegen
  k.stop = function () { k.freezeBeat(); env.files.delete('flexkodi/running'); };
  k.writeCtl = function (patch) {
    k.ctl = Object.assign({}, k.ctl, patch); k.hb++; k.ctl.hb = k.hb;
    env.files.set('flexkodi/rt/ctl', frame(KEY, 'ctl', k.ctl));
  };
  k.play = function (sid, extra) {
    k.sid = sid;
    k.ctl = { v: 1, sid, seq: 0, hb: 0, pause: 0, seekN: 0, seekTo: 0, seekAcc: 0, speed: 100, audio: -1, sub: -1, stop: 0 };
    k.writeCtl({});
    const p = Object.assign({ v: 1, sid, t: Math.floor(env.ctx.Date.now() / 1000), port: 37631, tok: TOK, name: 'media.mkv', resume: 0, dar: 1.7778, ov: 0, fb: 1 }, extra || {});
    env.files.set('flexkodi/rt/play.json', frame(KEY, 'play.json', p));
  };
  k.status = function () { return unframe(KEY, 'player.json', env.files.get('flexkodi/rt/player.json')); };
  return k;
}

function boot(file, opts) {
  const env = makeEnv(opts);
  env.files.set('flexdbg/enable', '');
  env.subs = {};
  env.UI.subscribeMessage = function (n, f) { env.subs[n] = f; };
  env.load(file || FLEX);
  env.advance(41000);
  return env;
}

// Standby: nichts läuft (Zeitgeber und Skripte eingefroren), danach geht es an derselben Stelle weiter
function freeze(env, ms) {
  env.now += ms;
  env.timers.forEach(t => { t.at += ms; });
  env.player.q.forEach(e => { e.at += ms; });
}

// Kodi läuft und ist bereit, Schlüssel übernommen
function kodiUp(env) {
  const k = kodiSim(env);
  k.start();
  env.advance(1500);
  env.files.set('flexkodi/rt/key', KEY);
  env.advance(1000);
  env.files.delete('flexkodi/rt/key');
  return k;
}

// getMpCtrlStat für die nächsten n Abfragen überschreiben
function statOverride(env) {
  const mp = env.ctx.modeljs.mpctrl, orig = mp.getMpCtrlStat.bind(mp), o = { n: 0, fn: null, polls: 0 };
  mp.getMpCtrlStat = function () { o.polls++; if (o.n > 0 && o.fn) { o.n--; return o.fn(); } return orig(); };
  o.stat = function (patch) {
    const p = env.player;
    const v = Object.assign({ s: p.session, u: p.url, st: p.state }, patch);
    return [v.s, v.u, v.st, p.speed, p.caps, p.flags, 1, 'Media', 0].join(',');
  };
  return o;
}

// ---------- W: Aufwachen nach einem Standby, der Kodi unterbrochen hat ----------
(function () {
  console.log('--- W1: Standby friert ein, bevor Kodi weg ist; Aufwachen nach 60 s');
  const env = boot();
  const k = kodiUp(env);
  check(hasLog(env, /^.{9}Kodi läuft$/), 'Kodi läuft');
  env.subs.STR_SUSPENDING();
  env.advance(300);
  env.subs.STR_SUSPEND();
  freeze(env, 60000);            // kodi-run.sh ebenso eingefroren: running bleibt mit altem Inhalt
  const n0 = countLog(env, /Live-TV abgefangen/);
  env.UI.pushModule('LiveTV');   // startModule() beim Aufwachen, vor STR_RESUME
  check(countLog(env, /Live-TV abgefangen/) === n0 + 1, 'Aufwachen: Startseite statt Live-TV (wie v6)');
  env.subs.STR_RESUME();
  // Kodi wird nach dem Aufwachen beendet (Wächter sieht flexkodi/stop): running verschwindet
  env.advance(1500);
  k.stop();
  env.advance(5000);
  check(!env.commits.some(c => c[1] === 'LAST'), 'kein LAST');
})();

(function () {
  console.log('--- W2: Kodi schreibt nach STR_SUSPEND noch 6 s weiter, dann Standby');
  const env = boot();
  const k = kodiUp(env);
  env.subs.STR_SUSPENDING();
  env.advance(300);
  env.subs.STR_SUSPEND();
  env.advance(6000);             // Kodi beendet sich langsam, kodi-run.sh schreibt weiter
  freeze(env, 60000);
  const n0 = countLog(env, /Live-TV abgefangen/);
  env.UI.pushModule('LiveTV');
  check(countLog(env, /Live-TV abgefangen/) === n0 + 1, 'Aufwachen: Startseite statt Live-TV');
  env.subs.STR_RESUME();
  // Kodi hat den Standby wirklich überlebt und schreibt weiter: wird wieder erkannt
  const nRun = countLog(env, /^.{9}Kodi läuft$/);
  env.advance(5000);
  check(countLog(env, /^.{9}Kodi läuft$/) === nRun + 1, 'überlebendes Kodi nach dem Aufwachen wieder erkannt (<= 5 s)');
  k.stop();
})();

(function () {
  console.log('--- W3: STR_SUSPEND ohne Aufwachen-Nachricht: Kodi-Erkennung kommt zurück');
  const env = boot();
  const k = kodiUp(env);
  env.subs.STR_SUSPENDING();
  env.subs.STR_SUSPEND();
  const nRun = countLog(env, /^.{9}Kodi läuft$/);
  env.advance(70000);
  check(countLog(env, /^.{9}Kodi läuft$/) === nRun + 1, 'nach der Sperrfrist wieder erkannt');
  k.stop();
})();

(function () {
  console.log('--- W4: kurzer Standby ohne Kodi, Aufwachen: Startseite (unverändert)');
  const env = boot();
  env.subs.STR_SUSPENDING();
  env.subs.STR_SUSPEND();
  freeze(env, 30000);
  const n0 = countLog(env, /Live-TV abgefangen/);
  env.UI.pushModule('LiveTV');
  check(countLog(env, /Live-TV abgefangen/) === n0 + 1, 'Startseite');
  env.subs.STR_RESUME();
})();

// ---------- T: Übernahme des Players nur mit Beleg ----------
function playing(env, k, sid, extra) {
  k.play(sid, extra);
  env.advance(8000);
  const s = k.status();
  return s && s.sid === sid && s.st === 'playing';
}

(function () {
  console.log('--- T1: eine einzelne fremde/leere Meldung ist kein Ende und keine Übernahme');
  const env = boot();
  const k = kodiUp(env);
  const o = statOverride(env);
  check(playing(env, k, '7000000000000001'), 'läuft');
  o.fn = () => o.stat({ u: '' }); o.n = 1;
  env.advance(1000);
  let s = k.status();
  check(s && s.st === 'playing', 'leere URL einmal: läuft weiter (' + (s && s.st) + ')');
  o.fn = () => o.stat({ u: 'http://192.0.2.5/x.mp4', s: env.player.session + 1 }); o.n = 1;
  env.advance(1000);
  s = k.status();
  check(s && s.st === 'playing', 'fremde URL einmal: läuft weiter (' + (s && s.st) + ')');
  check(!hasLog(env, /fremd \(Player/), 'nicht fremd markiert');
  // eigene Untertiteldatei derselben Sitzung (gleicher Token-Pfad) eine Weile
  o.fn = () => o.stat({ u: 'http://127.0.0.1:37631/' + TOK + '/media.srt' }); o.n = 8;
  env.advance(2500);
  s = k.status();
  check(s && s.st === 'playing', 'media.srt im Token-Pfad: läuft weiter (' + (s && s.st) + ')');
  check(!env.logs.some(l => l.indexOf(TOK) >= 0 || l.indexOf('192.0.2.5') >= 0), 'keine URL und kein Token im Log');
  // Pause während einer fremden Momentmeldung: erst angewendet, wenn die Meldung wieder unsere ist
  o.fn = () => o.stat({ u: 'http://192.0.2.5/x.mp4', s: env.player.session + 1 }); o.n = 1;
  const nM = calls(env, 'MpCtrl').length;
  k.writeCtl({ seq: 1, pause: 1 });
  env.advance(1000);
  check(calls(env, 'MpCtrl').slice(nM).some(c => c[1] === '[2]') && k.status().st === 'paused', 'Pause danach angewendet');
})();

(function () {
  console.log('--- T2: Dateiende, danach leere URL in derselben Sitzung');
  const env = boot();
  const k = kodiUp(env);
  const o = statOverride(env);
  // Player meldet nach dem Ende die Freigabe ohne URL (Zustand 0), bevor flex.js Zustand 6 sieht
  const p = env.player, step = p.step.bind(p);
  p.step = function () {
    step();
    if (p.state === 6 && p.url) { p.url = ''; p.state = 0; }
  };
  check(playing(env, k, '7000000000000002', { resume: 6880 }), 'läuft kurz vor dem Ende');
  env.advance(30000);
  const s = k.status();
  check(s && s.st === 'ended' && s.why === '', 'Ende mit Beleg (eof) -> ended: ' + JSON.stringify(s && [s.st, s.why, s.eof]));
  check(!hasLog(env, /fremd \(Player/), 'nicht als fremd markiert');
  p.step = step;
  // nächster Film wird angenommen (nicht dmpForeign)
  check(playing(env, k, '7000000000000003'), 'nächster Auftrag läuft (kein dmpForeign)');
})();

(function () {
  console.log('--- T3: echte Übernahme (andere URL, neue Sitzung) über zwei Abfragen');
  const env = boot();
  const k = kodiUp(env);
  const o = statOverride(env);
  check(playing(env, k, '7000000000000004'), 'läuft');
  const nCalls = env.calls.length;
  o.fn = () => o.stat({ u: 'http://192.0.2.20:8200/MediaItems/22.mkv', s: 900 }); o.n = 1000;
  env.advance(1000);
  const s = k.status();
  check(s && s.st === 'stopped' && s.why === 'taken', 'taken: ' + JSON.stringify(s && [s.st, s.why]));
  check(hasLog(env, /fremd \(Player übernommen\)/), 'Quelle/Player fremd');
  check(!env.calls.slice(nCalls).some(c => c[0] === 'MpCtrl' || c[0] === 'setScreenPosition'), 'fremden Player nicht angefasst');
  check(hasLog(env, /Meldung nicht zu unserer URL \(Sitzung \d+ -> 900, Zustand 3, URL fremd\)/), 'Ablauf geloggt (Sitzung, Zustand)');
  check(!env.logs.some(l => l.indexOf('192.0.2.20') >= 0 || l.indexOf(TOK) >= 0), 'keine URL und kein Token im Log');
  o.n = 0;
  k.play('7000000000000005');
  env.advance(1500);
  const r = k.status();
  check(r && r.sid === '7000000000000005' && r.st === 'refused' && r.why === 'dmpForeign', 'bis Kodis Ende gesperrt: ' + JSON.stringify(r && [r.st, r.why]));
})();

(function () {
  console.log('--- T4: leere URL mit neuer Sitzungsnummer = Übernahme');
  const env = boot();
  const k = kodiUp(env);
  const o = statOverride(env);
  check(playing(env, k, '7000000000000006'), 'läuft');
  o.fn = () => o.stat({ u: '', s: env.player.session + 5, st: 1 }); o.n = 1000;
  env.advance(1000);
  const s = k.status();
  check(s && s.why === 'taken', 'taken: ' + JSON.stringify(s && [s.st, s.why]));
})();

(function () {
  console.log('--- T5: leere URL, gleiche Sitzung, Zustand 0 mitten im Film = vorzeitig');
  const env = boot();
  const k = kodiUp(env);
  const o = statOverride(env);
  check(playing(env, k, '7000000000000007'), 'läuft');
  o.fn = () => o.stat({ u: '', st: 0 }); o.n = 1000;
  env.advance(1000);
  const s = k.status();
  check(s && s.st === 'stopped' && s.why === 'early', 'stopped early: ' + JSON.stringify(s && [s.st, s.why]));
  check(!hasLog(env, /fremd \(Player/), 'nicht fremd');
  o.n = 0;
  check(playing(env, k, '7000000000000008'), 'nächster Auftrag läuft');
})();

// ---------- S: DMP-Prüfung beim erneuten PlayMedia und beim ersten Fenster/MpCtrl ----------
function untilCall(env, name, max) {
  const n = calls(env, name).length;
  for (let i = 0; i < (max || 400) && calls(env, name).length === n; i++) env.advance(50);
  return calls(env, name).length > n;
}

(function () {
  console.log('--- S1: Quelle wechselt vor dem erneuten PlayMedia');
  const env = boot();
  const k = kodiUp(env);
  const o = statOverride(env);
  o.fn = () => o.stat({ u: '', s: 499, st: 0 }); o.n = 100000; // Player hat das PlayMedia nicht genommen
  k.play('7100000000000001');
  check(untilCall(env, 'PlayMedia'), 'PlayMedia gesendet');
  const nPm = calls(env, 'PlayMedia').length;
  env.advance(2700);
  env.src.name = 'hdmi2';        // CEC schaltet um, ohne Modulwechsel
  env.advance(600);
  check(calls(env, 'PlayMedia').length === nPm, 'kein zweites PlayMedia ohne DMP: ' + (calls(env, 'PlayMedia').length - nPm));
  env.advance(3000);
  const s = k.status();
  check(s && s.why === 'sourceOut', 'endet mit sourceOut: ' + JSON.stringify(s && [s.st, s.why]));
})();

(function () {
  console.log('--- S2: Quelle wechselt kurz vor Zustand 2');
  const env = boot();
  const k = kodiUp(env);
  k.play('7100000000000002');
  check(untilCall(env, 'PlayMedia'), 'PlayMedia gesendet');
  const n = env.calls.length;
  env.advance(2000);
  env.src.name = 'hdmi2';
  env.advance(1000);
  check(!env.calls.slice(n).some(c => c[0] === 'setScreenPosition' || c[0] === 'MpCtrl'), 'kein Fenster/MpCtrl ohne DMP: ' + JSON.stringify(env.calls.slice(n)));
  const s = k.status();
  check(s && (s.st === 'stopped' || s.st === 'error') && s.why === 'notHome', 'endet: ' + JSON.stringify(s && [s.st, s.why]));
})();

// ---------- H: Hot-Reload ----------
if (V6) (function () {
  console.log('--- H1: v7 -> v6 während einer Wiedergabe mit ov:1');
  const env = boot();
  const k = kodiUp(env);
  check(playing(env, k, '7200000000000001', { ov: 1 }), 'läuft (ov:1)');
  check(env.launcher.className.indexOf('flex-kp-video') >= 0, 'Klasse gesetzt');
  env.load(V6);
  env.advance(2000);
  check(env.ctx.__flex.version === 6, 'v6 läuft');
  check(env.launcher.className.indexOf('flex-kp-video') < 0, 'Klasse nach Rückkehr zu v6 entfernt: "' + env.launcher.className + '"');
})();

(function () {
  console.log('--- H2: v7 -> v7 während ov:1, Klasse bleibt');
  const env = boot();
  const k = kodiUp(env);
  check(playing(env, k, '7200000000000002', { ov: 1 }), 'läuft (ov:1)');
  env.load(FLEX);
  env.advance(10);
  check(env.launcher.className.indexOf('flex-kp-video') >= 0, 'Klasse nach Übernahme sofort wieder gesetzt');
  k.writeCtl({ seq: 1, pause: 1 });
  env.advance(1000);
  const s = k.status();
  check(s && s.st === 'paused', 'neue Instanz steuert: ' + (s && s.st));
})();

(function () {
  console.log('--- H3: v7 -> v7 während der DMP-Umschaltung');
  const env = boot(FLEX, { dmpMs: 3000 });
  const k = kodiUp(env);
  k.play('7200000000000003');
  env.advance(1200);
  let s = k.status();
  check(s && s.st === 'switching', 'umschaltend: ' + (s && s.st));
  check(calls(env, 'PlayMedia').length === 0, 'noch kein PlayMedia');
  env.load(FLEX);
  env.advance(8000);
  check(calls(env, 'PlayMedia').length === 1, 'neue Instanz sendet PlayMedia: ' + calls(env, 'PlayMedia').length);
  s = k.status();
  check(s && s.sid === '7200000000000003' && s.st === 'playing', 'läuft nach Hot-Reload: ' + (s && s.st));
})();

(function () {
  console.log('--- H4: v7 -> v7 während der Umschaltung, DMP kommt nie');
  const env = boot(FLEX, { dmpMs: 1e9 });
  const k = kodiUp(env);
  k.play('7200000000000004');
  env.advance(4000);
  env.load(FLEX);
  env.advance(15000);
  const s = k.status();
  check(s && s.st === 'error' && s.why === 'dmpTimeout', 'dmpTimeout, Versuche laufen weiter: ' + JSON.stringify(s && [s.st, s.why]));
  check(calls(env, 'PlayMedia').length === 0, 'kein PlayMedia');
})();

// ---------- A: D10, Ausgangswert von [31] ----------
(function () {
  console.log('--- A1: Wechsel braucht 2,5 s, [31] zeigt vorher die Standardspur');
  const env = boot();
  const k = kodiUp(env);
  const mp = env.ctx.modeljs.mpctrl;
  let codec = 'UNKNOWN', switchAt = 0;
  mp.getMetadata = function () { const m = []; m[26] = 720; m[27] = 576; m[31] = (switchAt && env.now >= switchAt) ? 'Dolby Digital' : codec; return m; };
  const sat = mp.setAudioTrack.bind(mp);
  mp.setAudioTrack = function (v) { sat(v); switchAt = env.now + 2500; };
  k.play('7300000000000001');
  k.writeCtl({ audio: 1 });
  const acks = [];
  for (let i = 0; i < 200; i++) { env.advance(100); const s = k.status(); if (s && s.ack >= 0) acks.push([s.ack, s.acodec]); }
  check(calls(env, 'setAudioTrack').length === 1, 'setAudioTrack einmal');
  check(acks.length > 0 && acks.every(a => a[1] === 'Dolby Digital'), 'ack erst mit dem neuen Wert: ' + JSON.stringify(acks[0]));
})();

(function () {
  console.log('--- A2: Wechsel ohne Änderung von [31] (gleiche Tonart): ack nach höchstens 5 s');
  const env = boot();
  const k = kodiUp(env);
  check(playing(env, k, '7300000000000002'), 'läuft');
  k.writeCtl({ seq: 1, audio: 2 });
  let ackAt = -1;
  const t0 = env.now;
  for (let i = 0; i < 80; i++) { env.advance(100); const s = k.status(); if (ackAt < 0 && s && s.ack === 1) ackAt = env.now - t0; }
  const s = k.status();
  check(ackAt > 0 && ackAt <= 6000 && s.acodec === 'Dolby Digital', 'ack nach ' + ackAt + ' ms, acodec ' + (s && s.acodec));
})();

// ---------- K: tvack nach einem Schreibfehler wiederholen ----------
(function () {
  console.log('--- K1: erste tvack-Quittung schlägt fehl, tvkeys bleibt gleich');
  const env = boot();
  kodiUp(env);
  const hf = env.ctx.hisense.file, w = hf.write.bind(hf);
  let failN = 1, tries = 0;
  hf.write = function (p, d, x) { if (p === 'flexkodi/rt/tvack') { tries++; if (failN > 0) { failN--; return 13; } } return w(p, d, x); };
  env.files.set('flexkodi/rt/tvkeys', frame(KEY, 'tvkeys', { v: 1, kid: 'run-9', seq: 1, up: 0, down: 0, mute: 0 }));
  env.advance(150);
  check(tries >= 1 && !env.files.has('flexkodi/rt/tvack'), 'erster Versuch fehlgeschlagen');
  env.advance(200);
  const a = unframe(KEY, 'tvack', env.files.get('flexkodi/rt/tvack'));
  check(a && a.kid === 'run-9' && a.seq === 1, 'Quittung im nächsten Takt nachgeholt: ' + JSON.stringify(a));
  const t = tries;
  env.advance(2000);
  check(tries === t, 'danach keine weiteren Schreibversuche ohne neues tvkeys: ' + (tries - t));
  // mehrere Stufen: Quittung schlägt dauerhaft fehl -> höchstens eine Logzeile je Fehlerserie
  failN = 1e9;
  env.files.set('flexkodi/rt/tvkeys', frame(KEY, 'tvkeys', { v: 1, kid: 'run-9', seq: 2, up: 2, down: 0, mute: 0 }));
  env.advance(1500);
  check(calls(env, 'send_key_to_dfb').filter(c => c[1] === 411).length === 2, 'Stufen trotzdem umgesetzt: ' + JSON.stringify(calls(env, 'send_key_to_dfb')));
  check(countLog(env, /tvack nicht schreibbar/) <= 2, 'Log nicht geflutet: ' + countLog(env, /tvack nicht schreibbar/));
  const v0 = env.store.state.VolumeBar.volume;
  failN = 0;
  env.advance(300);
  const b = unframe(KEY, 'tvack', env.files.get('flexkodi/rt/tvack'));
  check(b && b.seq === 2 && b.vol === v0, 'nach dem Fehler wieder quittiert: ' + JSON.stringify(b));
  check(env.store.state.VolumeBar.volume === v0, 'keine Stufe doppelt: ' + env.store.state.VolumeBar.volume);
})();

console.log(fails ? fails + ' FEHLER' : 'alle Prüfungen bestanden');
process.exit(fails ? 1 : 0);
