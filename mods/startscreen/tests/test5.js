// flex.js v9: verwaistes DMP (Testreihe W3). Nachbau des Fehlers vom 05.11.2026: Schoner auf DMP,
// Netflix vor dem Ausstieg, Netflix pausiert, der Launcher schaltet ohne uns auf DMP zurück, danach
// lehnte flex.js die Freigabe beim Kodi-Start ab ("DMP gehört anderen", E1). Kopf (Attrappe, Tasten-
// Weitergabe, Hilfsfunktionen) wie test4.js.
'use strict';
const { makeEnv, frame, unframe, hmac } = require('./harness');
const FLEX = process.argv[2] || require('path').join(__dirname, '../flex/flex.js');
const KEY = '00112233445566778899aabbccddeeff'; // Synthetic HMAC test vector
let fails = 0;
function check(c, msg) { console.log((c ? 'OK   ' : 'FAIL ') + msg); if (!c) fails++; }
function hasLog(env, re) { return env.logs.some(l => re.test(l)); }
function logIdx(env, re) { return env.logs.findIndex(l => re.test(l)); }
function commits(env, v) { return env.commits.filter(c => c[0] === 'Source/setCurrentSource' && c[1] === v).length; }

const TILES = [
  { appId: 'flex-kodi', appName: 'Kodi' },
  { appId: '1', appName: 'Netflix', url: 'netflix' },
  { appId: '2', appName: 'Prime Video', url: 'amazon' },
  { appId: '295', appName: 'Disney+', url: 'https://cd-dmgz.bamgrid.com/bbd/hisense_tv/index.html' },
  { appId: '162', appName: 'DAZN', url: 'https://dazn.example/tv' },
  { appId: '355', appName: 'UFC', url: 'https://ufc.example/tv' },
  { appId: '3', appName: 'YouTube', url: 'youtube' },
  { appId: 'flex-sources', appName: 'Quellen' },
  { appId: '-3', appName: 'MyApps' }
];

function boot(opts) {
  const env = makeEnv(opts);
  env.files.set('flexdbg/enable', '');
  env.subs = {};
  env.UI.subscribeMessage = function (n, f) { env.subs[n] = f; };
  env.capture = [];
  env.ctx.addEventListener = function (type, fn, cap) { if (cap) env.capture.push({ type, fn }); };
  env.ctx.removeEventListener = function (type, fn) { env.capture = env.capture.filter(h => h.fn !== fn); };
  env.ctx.CONST = { KEY: { VK_ENTER: 13, VK_UP: 38, VK_DOWN: 40, VK_LEFT: 37, VK_RIGHT: 39, VK_SETTINGS: 567, VK_TOOLS: 567,
    VK_MENU: 409, VK_BACK: 8, VK_EXIT: 27, VK_HOME: 36 } };
  // Startseite: Kacheln und MainTiles-Instanz
  const st = env.store._modulesNamespaceMap['LauncherHis/'].context.state;
  st.mainTileData = JSON.parse(JSON.stringify(TILES));
  st.currentRowIndex = 1;
  st.openFromNetflix = false;
  env.lstate = st;
  env.origKeys = [];
  const vm = {
    componentFocus: 'LauncherMainTile-0',
    _computedWatchers: { appRecommendList: { getter() { return []; }, dirty: false } },
    $forceUpdate() {},
    keydown(e) {                 // Original (MainTiles.keydown): Links/Rechts verschieben den Fokus
      env.origKeys.push(e.keyCode);
      if (e.keyCode === 37 || e.keyCode === 39) {
        const n = parseInt(this.componentFocus.split('-')[1], 10) + (e.keyCode === 39 ? 1 : -1);
        this.componentFocus = 'LauncherMainTile-' + Math.max(0, Math.min(TILES.length - 1, n));
        return true;
      }
      return undefined;
    }
  };
  env.vm = vm;
  env.launcherDom = true;
  const q = env.ctx.document.querySelector;
  env.ctx.document.querySelector = function (s) {
    if (s === '.mainTiles') return env.launcherDom ? { __vue__: vm } : null;
    if (s === '.launcher') return env.launcherDom ? env.launcher : null;
    return q.call(this, s);
  };
  env.flexAcks = [];
  env.UI.guiService = { sendResult(h, t, k) { env.flexAcks.push([h, t, k]); } };
  env.uiAcks = [];
  env.swallowed = [];
  env.load(FLEX);
  env.advance(41000);
  return env;
}

function focus(env, n) { env.vm.componentFocus = 'LauncherMainTile-' + n; }

// Weitergabe wie UI.js ve(): Capture-Listener (flex.js onKey), dann Komponente (MainTiles, gehüllt),
// dann LauncherHis/KeyEventDispatcher; Ce() quittiert genau einmal mit dem Ergebnis. Eine
// Wiederholung (gehaltene Taste) einer Taste außerhalb KEYSET_REPEAT gibt UI.js an keine Komponente
// weiter (Ce(a,s,false), app.js L9731): nur der Capture-Listener sieht sie, und es gibt kein keyup.
// o.hot: Reihenfolge nach einem Hot-Reload (Launcher-Handler vor onKey, flex.js Kopf).
const KEYSET_REPEAT = [38, 40, 37, 39, 415, 416, 607, 606, 411, 412, 609, 608, 427, 428];   // CONST.KEY (app.js L2027)
function press(env, code, o) {
  o = o || {};
  const out = {};
  const types = o.repeat ? ['keydown'] : ['keydown', 'keyup'];
  types.forEach(function (type) {
    const ev = { type, keyCode: code, which: code, repeat: type === 'keydown' && !!o.repeat, stopped: false,
      stopImmediatePropagation() { this.stopped = true; }, preventDefault() {} };
    const dropped = ev.repeat && KEYSET_REPEAT.indexOf(code) < 0;
    let rHot;
    if (o.hot && type === 'keydown' && !dropped) rHot = env.vm.keydown(ev);   // Komponente zuerst
    env.capture.forEach(h => { if (h.type === type && !ev.stopped) h.fn(ev); });
    let handled = false, via = '';
    if (ev.stopped && !o.hot) { env.swallowed.push([type, code]); out[type] = 'swallowed'; return; }
    if (dropped) { env.uiAcks.push([false, type, code]); out[type] = 'dropped'; return; }
    if (o.hot && type === 'keydown') { handled = rHot === true; via = handled ? 'tiles' : 'none'; env.uiAcks.push([handled, type, code]); out[type] = via; return; }
    if (type === 'keydown') {
      const r = env.vm.keydown(ev);
      if (r === true) { handled = true; via = 'tiles'; }
      else if (code === 567) { env.calls.push(['openSettings']); handled = true; via = 'dispatcher'; }
      else if (code === 27) { env.calls.push(['launcherExit']); handled = true; via = 'launcher'; }
      else if (code === 8) { env.calls.push(['launcherBack']); handled = true; via = 'launcher'; }
      else { handled = false; via = 'none'; }
    } else { handled = true; via = 'dispatcher'; }
    env.uiAcks.push([handled, type, code]);
    out[type] = via;
  });
  if (o.hold) env.advance(o.hold);
  return out;
}

function toast(env) {
  const els = env.ctx.document.body.childNodes.filter(c => c.id === 'flex-kodi-toast');
  return els.length ? els[els.length - 1].textContent : '';
}
function menuEl(env) { return env.ctx.document.body.childNodes.filter(c => c.id === 'flex-tile-menu')[0] || null; }

function kodiSim(env) {
  const k = { on: false, ready: 1, hb: 0, ctl: null };
  k.beat = function () { env.files.set('flexkodi/running', Math.floor(env.ctx.Date.now() / 1000) + ' 0 ' + k.ready); };
  k.start = function () {
    k.on = true;
    k.iv = env.ctx.setInterval(function () {
      if (!k.on) return;
      k.beat();
      if (k.ctl) { k.hb++; k.ctl.hb = k.hb; env.files.set('flexkodi/rt/ctl', frame(KEY, 'ctl', k.ctl)); }
    }, 2000);
    k.beat();
  };
  k.stop = function () { k.on = false; env.ctx.clearInterval(k.iv); env.files.delete('flexkodi/running'); };
  k.play = function (sid) {
    k.ctl = { v: 1, sid, seq: 0, hb: ++k.hb, pause: 0, seekN: 0, seekTo: 0, seekAcc: 0, speed: 100, audio: -1, sub: -1, stop: 0 };
    env.files.set('flexkodi/rt/ctl', frame(KEY, 'ctl', k.ctl));
    env.files.set('flexkodi/rt/play.json', frame(KEY, 'play.json', { v: 1, sid, t: Math.floor(env.ctx.Date.now() / 1000),
      port: 37631, tok: 'ab'.repeat(16), name: 'media.mkv', resume: 0, dar: 1.7778, ov: 0, fb: 1 }));
  };
  k.writeCtl = function (patch) { k.ctl = Object.assign({}, k.ctl, patch); k.hb++; k.ctl.hb = k.hb; env.files.set('flexkodi/rt/ctl', frame(KEY, 'ctl', k.ctl)); };
  k.status = function () { return unframe(KEY, 'player.json', env.files.get('flexkodi/rt/player.json')); };
  return k;
}

function netflixPaused(env) {
  const ac = env.store.state.AppControl;
  ac.currentAMState = 'stopped'; ac.currentAppName = 'netflix'; ac.runningOnBack = false; ac.runningOnBackForNetflix = true;
}

// Kodi läuft (Lebenszeichen), Laufschlüssel übergeben
function kodiUp(env, k) {
  k.start();
  env.advance(1500);
  env.files.set('flexkodi/rt/key', KEY + '\n');
  env.advance(1100);
  env.files.delete('flexkodi/rt/key');
}

// ===================== W3: verwaistes DMP (LOG 05.11.2026, 22:23-22:36) =====================
// Attrappe: env.src.name = 'dmp' ohne unseren Commit = DMP kam ohne uns zurück (z. B. LAST des
// Launchers nach dem Ende einer App). Der Player der Attrappe behält URL/Zustand über Quellwechsel.

function appFront(env, name) {          // App vorne (AppControl im Stapel), Quelle weg von DMP
  const ac = env.store.state.AppControl;
  env.UI.mod = 'AppControl'; env.UI.sub = 'AppControl';
  env.UI.isSubModuleExist = function (a, b) { return a === 'AppControl' && b === 'AppControl'; };
  ac.currentAMState = 'started'; ac.currentAppName = name;
  env.src.name = 'app';
}
function appGoneToDmp(env) {            // App beendet (pausiert), Launcher vorne, DMP ohne uns zurück
  env.UI.mod = 'LauncherHis'; env.UI.sub = 'LauncherHis';
  env.UI.isSubModuleExist = function () { return false; };
  netflixPaused(env);
  env.src.name = 'dmp';
}
function orphanNoApp(env) {             // verwaistes DMP ohne Hintergrund-Merker (z. B. nach Prime Video)
  env.src.name = 'dmp';
}

// ---------- W3-A: der beobachtete Ablauf ----------
(function () {
  console.log('--- W3-A: Schoner -> Taste 39 -> Netflix -> Exit (DMP ohne uns) -> Hot-Reload -> Kodi-Kachel');
  const env = boot();
  env.files.set('flexss/list.json', JSON.stringify(['/APPS/flexss/a.jpg']));
  env.advance(95000);                   // 60 s Leerlauf + 30 s Hintergrund -> Diashow
  check(commits(env, 'DMP') === 1 && env.src.name === 'dmp' && env.ctx.__flex.ownsDmp() === true, 'Diashow auf unserem DMP');
  press(env, 39);
  check(hasLog(env, /Bildschirmschoner beendet \(Taste 39\)/), 'Log: Bildschirmschoner beendet (Taste 39)');
  env.advance(800);
  appFront(env, 'netflix');             // Netflix vor dem Ausstieg (1,6 s)
  env.advance(3000);
  check(hasLog(env, /DMP bleibt \(Modul- oder App-Wechsel\)/) && commits(env, 'LAST') === 0, 'Log: DMP bleibt (Modul- oder App-Wechsel), kein LAST');
  check(env.ctx.__flex.ownsDmp() === false, 'ssTick vergisst dmpOwn, solange die App die Quelle hat');
  appGoneToDmp(env);
  env.advance(2000);
  check(env.ctx.__flex.ownsDmp() === false && env.src.name === 'dmp', 'DMP wieder aktiv, nicht unseres (verwaist)');
  env.load(FLEX);                       // Hot-Reload wie 22:25:46
  env.advance(6000);
  check(hasLog(env, /flex\.js v10 aktiv/) && env.ctx.__flex.ownsDmp() === false, 'neue Instanz hält das DMP nicht für ihres');
  const dmpBefore = commits(env, 'DMP');
  focus(env, 0);
  press(env, 13, { hot: true });
  check(!hasLog(env, /DMP gehört anderen/), 'kein "DMP gehört anderen"');
  check(hasLog(env, /Kodi: Netflix im Hintergrund pausiert, TV-Player wird vor dem Start freigegeben/), 'Log: wird vor dem Start freigegeben');
  check(hasLog(env, /Schließen: Netflix \(verwaistes DMP übernommen, Player-Zustand \d+, URL (leer|gesetzt), DMP angefordert, Kodi-Start\)/), 'Log: verwaistes DMP übernommen, DMP angefordert');
  check(commits(env, 'DMP') === dmpBefore + 1, 'genau ein frischer DMP-Befehl');
  env.advance(2000);
  check(hasLog(env, /Schließen: DMP aktiv nach \d+ ms/) && hasLog(env, /Hintergrund-Apps freigegeben: Netflix pausiert, TV-Player frei$/), 'freigegeben (nach DMP und Ruhe, nicht "DMP stand schon")');
  check(hasLog(env, /Kodi: Start angefordert \(Netflix freigegeben\)/) && !hasLog(env, /TV-Player gesperrt, E1/), 'Kodi ohne E1-Sperre');
  check(env.ctx.__flex.ownsDmp() === true && env.ctx.__flex.bgState().rel.done === true, 'DMP unseres, Freigabe done');
  const k = kodiSim(env);
  kodiUp(env, k);
  k.play('f1b2c3d4e5f60718');
  env.advance(1500);
  check(hasLog(env, /kodiPlay: Auftrag f1b2c3d4e5f60718 angenommen/) && !hasLog(env, /f1b2c3d4e5f60718 abgelehnt/), 'kodiPlay nimmt an (vorher: abgelehnt (app))');
  check(!hasLog(env, /kodiPlay: verwaistes DMP übernommen/) && commits(env, 'DMP') === dmpBefore + 1, 'kodiPlay ohne weiteren DMP-Befehl (gehört schon der Sitzung)');
  k.writeCtl({ seq: 1, stop: 1 });
  env.advance(1000);
  env.files.delete('flexkodi/rt/play.json');
  k.stop();
  env.advance(8000);
  check(commits(env, 'LAST') === 1 && env.src.name === 'hdmi1' && hasLog(env, /DMP verlassen \(Kodi beendet\)/), 'nach Kodis Ende LAST');
  env.advance(1100);
  check(env.ctx.__flex.ownsDmp() === false, 'danach gilt kein DMP mehr als unseres');
})();

// ---------- W3-B: verwaistes DMP ohne Hintergrund-App: der Kodi-Start schaltet selbst neu auf DMP ----------
(function () {
  console.log('--- W3-B: verwaistes DMP, keine Merker, Kodi-Kachel: eigener DMP-Befehl vor dem Start');
  const env = boot();
  orphanNoApp(env);
  env.advance(1100);
  focus(env, 0);
  press(env, 13);
  check(hasLog(env, /Kodi: verwaistes DMP übernommen \(Player-Zustand \d+, URL (leer|gesetzt)\), DMP angefordert/) && commits(env, 'DMP') === 1 &&
    env.files.has('flexkodi/start') && !hasLog(env, /Schließen/), 'frischer DMP-Befehl, Kodi angefordert, keine Freigabe');
  check(env.ctx.__flex.ownsDmp() === true, 'DMP gehört der Kodi-Sitzung');
  const k = kodiSim(env);
  kodiUp(env, k);
  k.play('a2b2c3d4e5f60718');
  env.advance(1500);
  check(hasLog(env, /kodiPlay: Auftrag a2b2c3d4e5f60718 angenommen/) && !hasLog(env, /dmpForeign/) &&
    commits(env, 'DMP') === 1, 'kodiPlay nimmt an, kein weiterer DMP-Befehl');
  env.advance(4000);
  const s = k.status();
  check(s && (s.st === 'playing' || s.st === 'preparing'), 'player.json: ' + (s && s.st));
  k.writeCtl({ seq: 1, stop: 1 });
  env.advance(1000);
  env.files.delete('flexkodi/rt/play.json');
  k.stop();
  env.advance(8000);
  check(commits(env, 'LAST') === 1 && env.src.name === 'hdmi1' && hasLog(env, /DMP verlassen \(Kodi beendet\)/), 'nach Kodis Ende LAST');
})();

// ---------- W3-B2: Startanforderung schlägt fehl: übernommenes DMP wieder verlassen ----------
(function () {
  console.log('--- W3-B2: verwaistes DMP, Startdatei nicht schreibbar');
  const env = boot();
  orphanNoApp(env);
  env.advance(1100);
  const w = env.ctx.hisense.file.write;
  env.ctx.hisense.file.write = function (p, d, x) { return p === 'flexkodi/start' ? 1 : w(p, d, x); };
  focus(env, 0);
  press(env, 13);
  env.advance(4000);
  check(commits(env, 'DMP') === 1 && commits(env, 'LAST') === 1 && hasLog(env, /DMP verlassen \(Kodi nicht gestartet\)/),
    'DMP wieder verlassen: ' + env.logs.slice(-3).join(' | '));
})();

// ---------- W3-B3: Kodi von Hand gestartet: kodiPlay nimmt ein vorgefundenes DMP nie (Schutzregel 2) ----------
(function () {
  console.log('--- W3-B3: verwaistes DMP, Kodi ohne Kachel gestartet: dmpForeign wie bisher');
  const env = boot();
  orphanNoApp(env);
  env.advance(1100);
  const k = kodiSim(env);
  kodiUp(env, k);
  k.play('a6b2c3d4e5f60718');
  env.advance(1500);
  check(hasLog(env, /a6b2c3d4e5f60718 abgelehnt \(dmpForeign\)/) && commits(env, 'DMP') === 0 &&
    env.ctx.__flex.ownsDmp() === false, 'abgelehnt (dmpForeign), kein DMP-Befehl');
})();

// ---------- W3-C: fremd bleibt fremd ----------
(function () {
  console.log('--- W3-C: Player spielt eine fremde URL: nicht verwaist');
  const env = boot();
  appGoneToDmp(env);
  env.player.url = 'http://192.0.2.2:8200/v.mp4'; env.player.state = 3;
  env.advance(1100);
  focus(env, 0);
  press(env, 13);
  check(hasLog(env, /Kodi: Hintergrund-Apps nicht freigebbar \(DMP gehört anderen\)/) && commits(env, 'DMP') === 0, 'wie bisher: DMP gehört anderen, kein DMP-Befehl');
  check(hasLog(env, /TV-Player gesperrt, E1/), 'E1-Hinweis wie bisher');
})();
(function () {
  console.log('--- W3-C2: fremde Wiedergabe ohne Merker: kodiPlay lehnt ab (dmpForeign)');
  const env = boot();
  orphanNoApp(env);
  env.player.url = 'http://192.0.2.2:8200/v.mp4'; env.player.state = 4;
  env.advance(1100);
  focus(env, 0);
  press(env, 13);
  const k = kodiSim(env);
  kodiUp(env, k);
  k.play('a3b2c3d4e5f60718');
  env.advance(1500);
  check(hasLog(env, /Auftrag a3b2c3d4e5f60718 abgelehnt \(dmpForeign\)/) && env.ctx.__flex.ownsDmp() === false, 'abgelehnt (dmpForeign), nicht übernommen');
})();
(function () {
  console.log('--- W3-C3: Player-Zustand unlesbar: nicht verwaist (im Zweifel weniger)');
  const env = boot();
  appGoneToDmp(env);
  env.ctx.modeljs.mpctrl.getMpCtrlStat = function () { throw new Error('weg'); };
  env.advance(1100);
  focus(env, 0);
  press(env, 13);
  check(hasLog(env, /DMP gehört anderen/) && commits(env, 'DMP') === 0, 'DMP gehört anderen, kein DMP-Befehl');
})();
(function () {
  console.log('--- W3-C4: App-Modul (DLNA) im Stapel: wie bisher');
  const env = boot();
  orphanNoApp(env);
  env.UI.extraModule = true;            // isModuleExist('DLNA')
  env.advance(1100);
  focus(env, 0);
  press(env, 13);
  check(!env.files.has('flexkodi/start') && commits(env, 'DMP') === 0 && hasLog(env, /Kodi: App im Hintergrund, kein Start/), 'kein Start, kein DMP');
})();

// ---------- W3-D: Bildschirmschoner bleibt streng ----------
(function () {
  console.log('--- W3-D: verwaistes DMP, keine Merker: Diashow nimmt es nicht');
  const env = boot();
  env.files.set('flexss/list.json', JSON.stringify(['/APPS/flexss/a.jpg']));
  orphanNoApp(env);
  env.advance(95000);
  check(hasLog(env, /Bildschirmschoner: DMP schon von anderer Seite aktiv, keine Diashow/), 'Log: DMP schon von anderer Seite aktiv');
  check(commits(env, 'DMP') === 0 && !env.calls.some(c => c[0] === 'PlayMedia') && env.ctx.__flex.ownsDmp() === false, 'kein DMP-Befehl, kein PlayMedia, nicht unseres');
})();

// ---------- W3-E: Kachel-Menü mit verwaistem DMP ----------
(function () {
  console.log('--- W3-E: App schließen bei verwaistem DMP: neu anfordern, danach LAST');
  const env = boot();
  appGoneToDmp(env);
  env.advance(1100);
  focus(env, 1);
  press(env, 567);
  check(!!env.ctx.__flex.bgState().menu, 'Menü offen (vorher: nicht geöffnet, DMP gehört anderen)');
  press(env, 13);
  check(hasLog(env, /Schließen: Netflix \(verwaistes DMP übernommen, Player-Zustand \d+, URL (leer|gesetzt), DMP angefordert, Kachel-Menü\)/) && commits(env, 'DMP') === 1, 'Log und ein DMP-Befehl');
  env.advance(2500);
  check(hasLog(env, /Hintergrund-Apps freigegeben: Netflix/) && toast(env) === 'Netflix pausiert, TV-Player frei', 'freigegeben');
  env.advance(2500);
  check(commits(env, 'LAST') === 1 && env.src.name === 'hdmi1' && hasLog(env, /DMP verlassen \(App freigegeben\)/), 'LAST zurück zur letzten Quelle');
})();

// ---------- W3-F: Abbruch während der Freigabe: auch das übernommene DMP wird verlassen ----------
(function () {
  console.log('--- W3-F: Rechts während der Freigabe (verwaistes DMP)');
  const env = boot();
  appGoneToDmp(env);
  env.advance(1100);
  focus(env, 0);
  press(env, 13);
  env.advance(500);
  press(env, 39);
  env.advance(300);
  check(hasLog(env, /Schließen abgebrochen: Netflix \(Taste\)/) && !env.files.has('flexkodi/start'), 'abgebrochen, kein Kodi');
  env.advance(4000);
  check(commits(env, 'LAST') === 1 && env.src.name === 'hdmi1' && hasLog(env, /DMP verlassen \(Kodi-Start abgebrochen\)/), 'DMP verlassen (Zustimmung zum Umschalten)');
})();

// ---------- W3-G: Hot-Reload nach der Übernahme ----------
(function () {
  console.log('--- W3-G: Hot-Reload, nachdem der Kodi-Start ein verwaistes DMP übernommen hat');
  const env = boot();
  orphanNoApp(env);
  env.advance(1100);
  focus(env, 0);
  press(env, 13);
  const k = kodiSim(env);
  kodiUp(env, k);
  k.play('a4b2c3d4e5f60718');
  env.advance(1500);
  env.files.set('flexkodi/rt/key', KEY + '\n');
  env.load(FLEX);
  env.advance(1100);
  env.files.delete('flexkodi/rt/key');
  check(env.ctx.__flex.ownsDmp() === true && hasLog(env, /Wiedergabe a4b2c3d4e5f60718 der alten Instanz übernommen/), 'dmpOwn und Wiedergabe übernommen');
  k.writeCtl({ seq: 1, stop: 1 });
  env.advance(1000);
  env.files.delete('flexkodi/rt/play.json');
  k.stop();
  env.advance(8000);
  check(commits(env, 'LAST') === 1 && env.src.name === 'hdmi1', 'nach Kodis Ende LAST');
})();

console.log(fails ? fails + ' Prüfung(en) fehlgeschlagen' : 'alle Prüfungen bestanden');
process.exit(fails ? 1 : 0);
