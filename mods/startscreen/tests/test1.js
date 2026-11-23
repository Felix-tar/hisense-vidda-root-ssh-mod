// Szenarien für flex.js v7 kodiPlay mit der Attrappe aus harness.js
'use strict';
const { makeEnv, frame, unframe, hmac } = require('./harness');
const FLEX = process.argv[2] || require('path').join(__dirname, '../flex/flex.js');
const KEY = '00112233445566778899aabbccddeeff'; // Synthetic HMAC test vector
let fails = 0;
function check(c, msg) { console.log((c ? 'OK   ' : 'FAIL ') + msg); if (!c) fails++; }
function hasLog(env, re) { return env.logs.some(l => re.test(l)); }
function calls(env, name) { return env.calls.filter(c => c[0] === name); }

function kodiSim(env) {
  const k = { on: false, ready: 1, beat: 0, lastKey: 0, hb: 0, seq: 0, ctl: null, sid: '', hbOn: true };
  k.start = function () {
    k.on = true;
    k.iv = env.ctx.setInterval(function () {
      if (!k.on) return;
      env.files.set('flexkodi/running', Math.floor(env.ctx.Date.now() / 1000) + ' ' + k.lastKey + ' ' + k.ready);
      if (k.ctl && k.hbOn) { k.hb++; k.ctl.hb = k.hb; env.files.set('flexkodi/rt/ctl', frame(KEY, 'ctl', k.ctl)); }
    }, 2000);
    env.files.set('flexkodi/running', Math.floor(env.ctx.Date.now() / 1000) + ' 0 ' + k.ready);
  };
  k.stop = function () { k.on = false; env.ctx.clearInterval(k.iv); env.files.delete('flexkodi/running'); };
  k.writeCtl = function (patch) {
    k.ctl = Object.assign({}, k.ctl, patch); k.hb++; k.ctl.hb = k.hb;
    env.files.set('flexkodi/rt/ctl', frame(KEY, 'ctl', k.ctl));
  };
  k.play = function (sid, extra) {
    k.sid = sid; k.seq = 0;
    k.ctl = { v: 1, sid, seq: 0, hb: 0, pause: 0, seekN: 0, seekTo: 0, seekAcc: 0, speed: 100, audio: -1, sub: -1, stop: 0 };
    k.writeCtl({});
    const p = Object.assign({ v: 1, sid, t: Math.floor(env.ctx.Date.now() / 1000), port: 37631, tok: 'ab'.repeat(16), name: 'media.mkv', resume: 0, dar: 1.7778, ov: 0, fb: 1 }, extra || {});
    env.files.set('flexkodi/rt/play.json', frame(KEY, 'play.json', p));
  };
  k.status = function () { return unframe(KEY, 'player.json', env.files.get('flexkodi/rt/player.json')); };
  return k;
}

function boot(opts) {
  const env = makeEnv(opts);
  env.files.set('flexdbg/enable', '');
  env.load(FLEX);
  env.advance(41000);          // Notnagel gibt die Startseite frei
  return env;
}

// ---------- 1: Normalablauf mit Fortsetzen, Pause, Sprung, Stopp, Kodi-Ende ----------
(function () {
  console.log('--- Szenario 1: Normalablauf');
  const env = boot();
  check(env.ctx.__flex.version === 10, 'version 10');
  check(hasLog(env, /flex\.js v10 geladen/) && hasLog(env, /flex\.js v10 aktiv/), 'Logtexte v10');
  const k = kodiSim(env);
  k.start();
  env.advance(1500);
  check(hasLog(env, /^.{9}Kodi läuft$/), 'Kodi erkannt <= 1,5 s nach Start');
  env.files.set('flexkodi/rt/key', KEY + '\n');
  env.advance(1100);
  check(hasLog(env, /Laufschlüssel übernommen/), 'Laufschlüssel übernommen');
  check(env.files.get('flexkodi/rt/keyok') === hmac(KEY, 'keyok', '1'), 'keyok = HMAC(K, "keyok\\n1")');
  check(!env.logs.some(l => l.indexOf(KEY) >= 0), 'Schlüssel nie im Log');
  env.files.delete('flexkodi/rt/key');   // root löscht nach Quittung
  k.play('3f9a0c1d22e47b10', { resume: 1834, dar: 2.39 });
  env.advance(1000);
  let s = k.status();
  check(s && s.sid === '3f9a0c1d22e47b10' && (s.st === 'switching' || s.st === 'preparing'), 'player.json switching/preparing, HMAC gültig: ' + (s && s.st));
  check(env.commits.some(c => c[0] === 'Source/setCurrentSource' && c[1] === 'DMP'), 'DMP umgeschaltet');
  env.advance(1500);
  check(calls(env, 'PlayMedia').some(c => c[1] === 'http://127.0.0.1:37631/' + 'ab'.repeat(16) + '/media.mkv' && c[2] === 4 && c[3] === 'Media'), 'PlayMedia Typ 4 mit Loopback-URL');
  check(!env.logs.some(l => l.indexOf('ab'.repeat(16)) >= 0), 'Token nie im Log');
  env.advance(3500);
  check(calls(env, 'MpCtrl').some(c => c[1] === '[8,null,1834]'), 'Fortsetzen MpCtrl([8,null,1834])');
  check(calls(env, 'setScreenPosition').some(c => c[1] === '0,277,3840,1607'), 'Fenster 2,39:1 = 0,277,3840,1607');
  env.advance(1500);
  s = k.status();
  check(s && s.st === 'playing' && s.seek === 1 && s.dur === 6904, 'st playing, seek 1, dur: ' + JSON.stringify(s && [s.st, s.seek, s.dur, s.pos]));
  check(env.launcher.className.indexOf('flex-kp-video') < 0, 'Kopier-Modus (ov:0): keine Klasse');
  // Pause
  k.writeCtl({ seq: 1, pause: 1, speed: 100 });
  env.advance(1000);
  check(calls(env, 'MpCtrl').some(c => c[1] === '[2]'), 'Pause MpCtrl([2])');
  s = k.status();
  check(s && s.st === 'paused' && s.ack === 1, 'st paused, ack 1: ' + JSON.stringify(s && [s.st, s.ack]));
  k.writeCtl({ seq: 2, pause: 0 });
  env.advance(1500);
  s = k.status();
  check(s && s.st === 'playing' && s.ack === 2, 'weiter, ack 2');
  // genauer Sprung
  k.writeCtl({ seq: 3, seekN: 1, seekTo: 2400, seekAcc: 100 });
  env.advance(400);
  check(calls(env, 'setMpCtrlSeekFlag').some(c => c[1] === 100) && calls(env, 'setMpCtrlPlaytimeCurrent').some(c => c[1] === 2400), 'Sprung genau auf 2400');
  s = k.status();
  check(s && s.ack === 2, 'ack wartet auf den gesetzten Sprung: ' + (s && s.ack));
  env.advance(2500);
  s = k.status();
  check(s && s.ack === 3 && Math.abs(s.pos - 2400) <= 3, 'Sprung gesetzt, ack 3, pos ' + (s && s.pos));
  check(calls(env, 'setMpctrlFlag').length === 0, 'kein setMpctrlFlag ohne ctl.speed (D21 aus)');
  // Untertitel / Ton
  k.writeCtl({ seq: 4, audio: 2, sub: 0 });
  env.advance(1000);
  check(calls(env, 'setAudioTrack').some(c => c[1] === 2) && calls(env, 'setMpCtrlSubtitleNo').some(c => c[1] === 0), 'Tonspur 2, Untertitel 0');
  env.advance(5000);
  s = k.status();
  check(s && s.ack === 4 && s.acodec === 'Dolby Digital' && s.aud === 2, 'ack 4 nach [31]-Abfrage, acodec ' + (s && s.acodec));
  // Stopp; mit eigenem Fenster kommt der Stopp seit 18.11.2026 erst KP_WIN_STOP_MS (400 ms) nach dem Fenster
  k.writeCtl({ seq: 5, stop: 1 });
  env.advance(250);
  check(!calls(env, 'MpCtrl').some(c => c[1] === '[3,-1,0,"Media"]') && calls(env, 'setScreenPosition').slice(-1)[0][1] === '0,0,3840,2160',
    'Fenster schon zurück, Stopp noch nicht (Pause gegen den Mm_Stop-Hänger)');
  env.advance(750);
  check(calls(env, 'MpCtrl').some(c => c[1] === '[3,-1,0,"Media"]'), 'Stopp MpCtrl([3,-1,0,Media])');
  check(calls(env, 'setScreenPosition').slice(-1)[0][1] === '0,0,3840,2160', 'Fenster zurück auf voll');
  {
    // 17.11.2026: Fenster vor dem Stopp zurücksetzen, nie danach (tvmain-Absturz im Player-Abbau)
    const iWin = env.calls.map(c => c[0] === 'setScreenPosition' && c[1] === '0,0,3840,2160').lastIndexOf(true);
    const iStop = env.calls.map(c => c[0] === 'MpCtrl' && c[1] === '[3,-1,0,"Media"]').lastIndexOf(true);
    check(iWin >= 0 && iStop > iWin, 'Fenster zurück VOR dem Stopp (Fenster ' + iWin + ', Stopp ' + iStop + ')');
  }
  s = k.status();
  check(s && s.st === 'stopped', 'st stopped');
  check(env.src.name === 'dmp', 'DMP bleibt, solange Kodi läuft (D18)');
  env.files.delete('flexkodi/rt/play.json');
  // Kodi beendet
  env.advance(3000);
  k.stop();
  env.advance(2100);
  check(hasLog(env, /Kodi beendet/), 'Kodi-Ende erkannt <= 2,1 s nach Löschen von running');
  check(env.src.name === 'dmp', 'DMP noch da (wartet 3 Takte)');
  env.advance(1000 + 1700);
  check(env.commits.some(c => c[0] === 'Source/setCurrentSource' && c[1] === 'LAST'), 'LAST nach Kodis Ende (scheduleDmpExit -> leaveDmp)');
  check(env.src.name === 'hdmi1', 'zurück auf HDMI1');
})();

// ---------- 2: Uhrsprung, Lebenszeichen steht, Kodi antwortet nicht ----------
(function () {
  console.log('--- Szenario 2: Uhrsprung und stehendes Lebenszeichen');
  const env = boot();
  const k = kodiSim(env);
  k.start();
  env.advance(1500);
  env.files.set('flexkodi/rt/key', KEY);
  env.advance(1000);
  env.files.delete('flexkodi/rt/key');
  k.play('1111222233334444', { dar: 1.7778 });
  env.advance(6000);
  let s = k.status();
  check(s && s.st === 'playing', 'läuft: ' + (s && s.st));
  check(calls(env, 'MpCtrl').some(c => c[1] === '[1]'), 'ohne Fortsetzpunkt MpCtrl([1])');
  env.clockSkew = 3600 * 1000;     // NTP springt eine Stunde
  env.advance(20000);
  s = k.status();
  check(s && s.st === 'playing' && !hasLog(env, /Kodi beendet/), 'Uhrsprung: Film läuft weiter, Kodi bleibt erkannt');
  // Kodi hängt: ctl ohne neues hb
  k.hbOn = false;
  env.advance(16000);
  s = k.status();
  check(s && s.st === 'error' && s.why === 'kodiGone', 'kein neues hb 15 s -> error kodiGone: ' + JSON.stringify(s && [s.st, s.why]));
  check(env.src.name === 'dmp', 'DMP bleibt');
  // Kodi und kodi-run.sh getötet: running bleibt liegen
  k.on = false; env.ctx.clearInterval(k.iv);
  env.advance(17000);
  check(hasLog(env, /Kodi beendet/), 'stehendes running nach 15 Takten = Kodi weg');
  env.advance(5000);
  check(!env.commits.some(c => c[1] === 'LAST'), 'stehendes Lebenszeichen: kein LAST (D18)');
})();

// ---------- 3: E1 streng, fremdes DMP, bad, Wiederholung, D12 ----------
(function () {
  console.log('--- Szenario 3: Ablehnungen und andere Wiedergabe');
  const env = boot({ rob: true });
  const k = kodiSim(env);
  k.start();
  env.advance(1500);
  env.files.set('flexkodi/rt/key', KEY);
  env.advance(1000);
  k.play('aaaabbbbccccdddd');
  env.advance(1000);
  let s = k.status();
  check(s && s.st === 'refused' && s.why === 'app' && s.n === 1, 'pausiertes YouTube -> refused app (E1 a)');
  env.store.state.AppControl.runningOnBack = false;
  k.play('aaaabbbbccccdddd');     // gleiche sid nochmal: Wiederholschutz
  env.advance(1000);
  s = k.status();
  check(s && s.st === 'refused', 'gleiche sid wird nicht noch einmal angenommen');
  k.play('aaaabbbbcccc0001', { port: 80 });
  env.advance(1000);
  s = k.status();
  check(s && s.sid === 'aaaabbbbcccc0001' && s.st === 'refused' && s.why === 'bad', 'unzulässiger Port -> refused bad');
  k.play('aaaabbbbcccc0002', { name: 'Film.MKV' });
  env.advance(1000);
  s = k.status();
  check(s && s.why === 'bad', 'Großbuchstaben im Namen -> bad');
  const old = env.files.get('flexkodi/rt/play.json');
  // zu alter Auftrag
  k.play('aaaabbbbcccc0003', { t: Math.floor(env.ctx.Date.now() / 1000) - 10 });
  env.advance(1000);
  s = k.status();
  check(s && s.sid === 'aaaabbbbcccc0002', 'Auftrag > 3 s alt wird verworfen (keine Antwort)');
  // gefälschte Signatur
  env.files.set('flexkodi/rt/play.json', '0'.repeat(64) + ' {"v":1}\n');
  env.advance(1000);
  check(hasLog(env, /Auftrag verworfen/), 'falsche Signatur verworfen');
  // normale Wiedergabe, dann ctl mit fremder sid (D12)
  k.play('aaaabbbbcccc0004');
  env.advance(7000);
  s = k.status();
  check(s && s.st === 'playing', 'läuft: ' + (s && s.st));
  const ctlB = { v: 1, sid: 'ffffeeeeddddcccc', seq: 0, hb: 1, pause: 0, seekN: 0, speed: 100, audio: -1, sub: -1, stop: 0 };
  env.files.set('flexkodi/rt/ctl', frame(KEY, 'ctl', ctlB));
  env.advance(400);
  s = k.status();
  check(s && s.sid === 'aaaabbbbcccc0004' && s.st === 'stopped' && s.why === 'superseded', 'D12: fremdes ctl beendet sofort');
  check(calls(env, 'MpCtrl').slice(-1)[0][1] === '[3,-1,0,"Media"]', 'D12: Player gestoppt');
  // nächste Folge ohne DMP-Wechsel
  const nDmp = env.commits.filter(c => c[1] === 'DMP').length;
  k.play('aaaabbbbcccc0005');
  env.advance(1100);
  check(env.commits.filter(c => c[1] === 'DMP').length === nDmp, 'nächste Folge ohne Quellenwechsel');
  env.advance(6000);
  s = k.status();
  check(s && s.sid === 'aaaabbbbcccc0005' && s.st === 'playing', 'nächste Folge läuft');
  // direkt: neuer Auftrag, während das alte ctl noch gilt
  k.ctl = null;
  const p6 = { v: 1, sid: 'aaaabbbbcccc0006', t: Math.floor(env.ctx.Date.now() / 1000), port: 40000, tok: 'cd'.repeat(16), name: 'media', resume: 0, dar: 0, ov: 1, fb: 1 };
  env.files.set('flexkodi/rt/play.json', frame(KEY, 'play.json', p6));
  const nStop = calls(env, 'MpCtrl').filter(c => c[1] === '[3,-1,0,"Media"]').length;
  env.advance(1000);
  check(calls(env, 'MpCtrl').filter(c => c[1] === '[3,-1,0,"Media"]').length === nStop, 'direkter Wechsel ohne Stopp (S1/P2)');
  check(env.launcher.className.indexOf('flex-kp-video') >= 0, 'Misch-Modus (ov:1): Klasse gesetzt');
  k.sid = p6.sid; k.ctl = { v: 1, sid: p6.sid, seq: 0, hb: 0, pause: 0, seekN: 0, speed: 100, audio: -1, sub: -1, stop: 0 };
  k.writeCtl({});
  env.advance(5000);
  s = k.status();
  check(s && s.sid === p6.sid && s.st === 'playing', 'Folge 6 läuft: ' + (s && s.st));
  check(s.win === '570x0x2700x2160', 'dar 0: Fenster aus [26]/[27] (720x576, wie Entwurf) -> ' + (s && s.win));
  // Systemdialog
  env.UI.dialog = true;
  env.advance(1000);
  s = k.status();
  check(s && s.st === 'stopped' && s.why === 'dialog', 'Systemdialog: Film sofort gestoppt');
  check(env.files.has('flexkodi/stop'), 'Kodi wird beendet (flexkodi/stop)');
  check(env.launcher.className.indexOf('flex-kp-video') < 0, 'Klasse weg');
})();

// ---------- 4: tvkeys ----------
(function () {
  console.log('--- Szenario 4: Lautstärke über tvkeys');
  const env = boot();
  const k = kodiSim(env);
  k.start();
  env.advance(1500);
  env.files.set('flexkodi/rt/key', KEY);
  env.advance(1000);
  env.files.set('flexkodi/rt/tvkeys', frame(KEY, 'tvkeys', { v: 1, kid: 'run-1', seq: 1, up: 0, down: 0, mute: 0 }));
  env.advance(300);
  let a = unframe(KEY, 'tvack', env.files.get('flexkodi/rt/tvack'));
  check(a && a.kid === 'run-1' && a.seq === 1 && a.vol === 20, 'Anmeldung quittiert: ' + JSON.stringify(a));
  env.files.set('flexkodi/rt/tvkeys', frame(KEY, 'tvkeys', { v: 1, kid: 'run-1', seq: 2, up: 3, down: 0, mute: 1 }));
  env.advance(700);
  a = unframe(KEY, 'tvack', env.files.get('flexkodi/rt/tvack'));
  // echte Tasten wie von der Fernbedienung, auch an den TV-Lautsprechern (der Store-Weg ließ den Ton stumm)
  const keys = calls(env, 'send_key_to_dfb').map(c => c[1]);
  check(keys.filter(x => x === 411).length === 3 && keys.filter(x => x === 413).length === 1, 'drei Stufen lauter und stumm als Taste: ' + JSON.stringify(keys));
  check(a && a.seq === 2, 'tvack quittiert: ' + JSON.stringify(a));
  const vc = env.commits.filter(c => c[0] === 'VolumeBar/setVolume' || c[0] === 'VolumeBar/setMuteState').length;
  check(vc === 0, 'kein Store-Weg mehr: ' + vc);
})();

// ---------- 5: kpDebug, Spulen über ctl.speed, Hot-Reload ----------
(function () {
  console.log('--- Szenario 5: kpDebug, Spulen, Hot-Reload');
  const env = boot();
  const k = kodiSim(env);
  k.start();
  env.advance(1500);
  const r = env.ctx.__flex.kpDebug('http://127.0.0.1:18080/dvd-576i.mkv', 30, 1.7778);
  check(r === 'gestartet', 'kpDebug gestartet ohne Schlüssel: ' + r);
  env.advance(6000);
  check(calls(env, 'MpCtrl').some(c => c[1] === '[8,null,30]'), 'Debug: Fortsetzen ab 30');
  check(!env.files.has('flexkodi/rt/player.json'), 'Debug: kein player.json');
  env.ctx.__flex.kpDebugCtl({ stop: 0, pause: 1, seekN: 0, seq: 1 });
  env.advance(600);
  check(calls(env, 'MpCtrl').some(c => c[1] === '[2]'), 'Debug: Pause');
  env.ctx.__flex.kpDebugCtl({ stop: 0, pause: 0, seekN: 0, speed: 400, seq: 2 });
  env.advance(600);
  check(calls(env, 'setMpctrlFlag').some(c => c[1] === 400), 'Debug: Spulen 4x über ctl.speed');
  const snap = env.ctx.__flex.kpSnap();
  check(snap.sid && snap.url === undefined && snap.playRaw === undefined, 'kpSnap ohne URL/Rohtexte');
  check(env.ctx.__flex.kpDebugStop() === 'ok', 'Debug-Stopp');
  check(calls(env, 'MpCtrl').slice(-1)[0][1] === '[3,-1,0,"Media"]', 'Debug-Stopp stoppt den Player');
  // echte Wiedergabe, dann Hot-Reload
  env.files.set('flexkodi/rt/key', KEY);
  env.advance(1000);
  env.files.delete('flexkodi/rt/key');
  k.play('9999888877776666');
  env.advance(7000);
  let s = k.status();
  check(s && s.st === 'playing', 'läuft vor Hot-Reload');
  const n0 = s.n;
  env.load(FLEX);                 // Hot-Reload
  env.advance(50);
  check(hasLog(env, /Wiedergabe 9999888877776666 der alten Instanz übernommen/), 'Hot-Reload übernimmt Wiedergabe');
  k.writeCtl({ seq: 1, pause: 1 });
  env.advance(1000);
  s = k.status();
  check(s && s.st === 'paused' && s.n > n0, 'neue Instanz steuert und schreibt (Schlüssel per kpKeyOnce): ' + JSON.stringify(s && [s.st, s.n]));
})();

// ---------- 6: nicht spulbar mit Fortsetzpunkt, Fortsetzen ohne Wirkung ----------
(function () {
  console.log('--- Szenario 6: nicht spulbar / Fortsetzen ohne Wirkung');
  let env = boot({ seekable: false });
  let k = kodiSim(env);
  k.start(); env.advance(1500); env.files.set('flexkodi/rt/key', KEY); env.advance(1000);
  k.play('5555666677778888', { resume: 600, fb: 1 });
  env.advance(6000);
  let s = k.status();
  check(s && s.st === 'refused' && s.why === 'noResume', 'nicht spulbar + Fortsetzpunkt + fb:1 -> refused noResume');
  env = boot({ resumeBroken: true });
  k = kodiSim(env);
  k.start(); env.advance(1500); env.files.set('flexkodi/rt/key', KEY); env.advance(1000);
  k.play('5555666677779999', { resume: 600, fb: 1 });
  env.advance(12000);
  check(hasLog(env, /Fortsetzen nicht gewirkt/) && calls(env, 'setMpCtrlPlaytimeCurrent').some(c => c[1] === 600), 'Nachsprung auf 600 nach 4 s');
  // Quelle weg
  env.src.name = 'hdmi1';
  env.advance(2500);
  s = k.status();
  check(s && s.why === 'sourceOut', 'Quelle weg -> sourceOut: ' + (s && s.why));
  // Dateiende
  env = boot();
  k = kodiSim(env);
  k.start(); env.advance(1500); env.files.set('flexkodi/rt/key', KEY); env.advance(1000);
  k.play('5555666677770000', { resume: 6890, fb: 1 });
  env.advance(30000);
  s = k.status();
  check(s && s.st === 'ended' && s.eof === 1, 'Dateiende -> ended mit eof: ' + JSON.stringify(s && [s.st, s.why, s.eof]));
})();

// ---------- ES-Weg: flex.js stellt nur die Quelle bereit, Kodis Helfer spielt ----------
function esJob(env, k, sid) {
  k.start();
  env.advance(1500);
  env.files.set('flexkodi/rt/key', KEY + '\n');
  env.advance(1100);
  env.files.delete('flexkodi/rt/key');
  k.sid = sid;
  k.ctl = { v: 1, sid, seq: 0, hb: 0, pause: 0, seekN: 0, seekTo: 0, seekAcc: 0, speed: 100, audio: 0, sub: -1, stop: 0 };
  k.writeCtl({});
  env.files.set('flexkodi/rt/play.json', frame(KEY, 'play.json', { v: 1, sid, t: Math.floor(env.ctx.Date.now() / 1000), es: 1 }));
}

(function () {
  console.log('--- Szenario ES-Weg');
  const env = boot();
  const k = kodiSim(env);
  esJob(env, k, 'aa11bb22cc33dd44');
  env.advance(1000);
  let s = k.status();
  check(s && s.sid === k.sid && (s.st === 'switching' || s.st === 'esready'), 'Auftrag angenommen: ' + (s && s.st));
  check(env.commits.some(c => c[0] === 'Source/setCurrentSource' && c[1] === 'DMP'), 'DMP umgeschaltet');
  env.advance(1500);
  s = k.status();
  check(s && s.st === 'esready', 'Quelle bereit: esready, ist ' + (s && s.st));
  check(calls(env, 'PlayMedia').length === 0, 'kein PlayMedia auf dem ES-Weg');
  // der Stopp wirkt am TV verzögert und traf sonst das neue Item: nur stoppen, was läuft
  check(!calls(env, 'MpCtrl').some(c => c[1] === '[3,-1,0,"Media"]'), 'freier Medienplayer wird nicht gestoppt');
  const before = calls(env, 'MpCtrl').length;
  k.writeCtl({ seq: 1, pause: 1 });
  env.advance(1000);
  s = k.status();
  check(calls(env, 'MpCtrl').length === before, 'Pause geht nicht an den TV-Player');
  check(s && s.st === 'esready' && s.ack === 1, 'esready bleibt, ack 1: ' + JSON.stringify(s && [s.st, s.ack]));
  // Andere Quelle: Kodi muss aufhören
  env.src.name = 'tv';
  env.advance(2500);
  s = k.status();
  check(s && s.st === 'stopped' && s.why === 'sourceOut', 'Quelle weg -> stopped/sourceOut: ' + JSON.stringify(s && [s.st, s.why]));
})();

(function () {
  console.log('--- Szenario ES-Weg: Hot-Reload und Stopp');
  const env = boot();
  const k = kodiSim(env);
  esJob(env, k, 'aa11bb22cc33dd55');
  env.advance(2500);
  check(k.status().st === 'esready', 'esready');
  env.load(FLEX);
  env.advance(1500);
  check(hasLog(env, /Wiedergabe aa11bb22cc33dd55 der alten Instanz übernommen/), 'Hot-Reload übernimmt den ES-Auftrag');
  check(!hasLog(env, /Auftrag nicht wiederherstellbar/), 'ES-Auftrag braucht keine URL');
  k.writeCtl({ seq: 1, stop: 1 });
  env.advance(800);
  check(k.status().st === 'stopped', 'Stopp beendet den ES-Auftrag');
  check(env.src.name === 'dmp', 'DMP bleibt, solange Kodi läuft');
})();

console.log(fails ? fails + ' FEHLER' : 'alle Prüfungen bestanden');
process.exit(fails ? 1 : 0);
