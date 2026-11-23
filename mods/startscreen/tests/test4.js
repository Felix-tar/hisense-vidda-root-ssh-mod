// flex.js v7: Hintergrund-Apps beim Kodi-Start freigeben (Wunsch 1, "alle Apps schließen") und
// Kachel-Menü "App schließen" über die Einstellungstaste (Wunsch 2). Attrappe aus harness.js, dazu
// MainTiles-Instanz, Tasten-Weitergabe wie UI.js (Capture-Listener -> Komponente -> Dispatcher,
// genau eine Quittung je Taste; Wiederholungen außerhalb KEYSET_REPEAT erreichen keine Komponente,
// app.js L9729-9731). Nach dem Review vom 29.10. ergänzt: R1-R9.
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

// ---------- W1-A: Kodi-Kachel mit pausiertem Netflix (gemessener Zustand) ----------
(function () {
  console.log('--- W1-A: Kodi-Start gibt pausiertes Netflix frei, kodiPlay nimmt an, LAST nach Kodi');
  const env = boot();
  netflixPaused(env);
  focus(env, 0);
  const r = press(env, 13);
  check(r.keydown === 'tiles' && env.flexAcks.length === 0, 'OK auf Kodi: von der Hülle verbraucht, keine eigene Quittung');
  check(hasLog(env, /Kodi: Netflix im Hintergrund pausiert, TV-Player wird vor dem Start freigegeben/), 'Log: wird vor dem Start freigegeben');
  check(commits(env, 'DMP') === 1, 'DMP angefordert (Schließen)');
  check(!env.files.has('flexkodi/start'), 'noch keine Startanforderung');
  check(toast(env) === 'Netflix pausiert: TV-Player wird für Kodi freigegeben …', 'Hinweis: wird freigegeben: ' + toast(env));
  check(env.ctx.__flex.bgState().closing && env.ctx.__flex.bgState().closing.kodi === true, 'bgState: Schließen läuft');
  // zweites OK auf Kodi während der Freigabe (auch gehalten: Wiederholungen sieht nur onKey): kein
  // Abbruch, kein zweiter Start
  env.advance(300);
  press(env, 13);
  check(press(env, 13, { repeat: true }).keydown === 'dropped', 'Wiederholung erreicht MainTiles nicht (wie UI.js)');
  env.advance(400);
  check(env.src.name === 'dmp' || env.src.name === 'hdmi1', 'Quelle: ' + env.src.name);
  env.advance(2000);
  check(hasLog(env, /Schließen: DMP aktiv nach \d+ ms/), 'Log: DMP aktiv nach … ms');
  check(hasLog(env, /Hintergrund-Apps freigegeben: Netflix pausiert, TV-Player frei/), 'Log: Hintergrund-Apps freigegeben: Netflix');
  check(!env.logs.some(l => /geschlossen/.test(l) && !/Kachel-Menü geschlossen|Seite Bilder geschlossen/.test(l)), 'kein Log behauptet "geschlossen"');
  check(env.files.has('flexkodi/start'), 'Startanforderung geschrieben nach dem Schließen');
  check(hasLog(env, /Kodi: Start angefordert \(Netflix freigegeben\)/) && !hasLog(env, /TV-Player gesperrt/), 'Log: Start angefordert (Netflix freigegeben), kein E1');
  check(toast(env) === 'Kodi startet … (TV-Player frei)', 'Hinweis ohne E1: ' + toast(env));
  check(logIdx(env, /Hintergrund-Apps freigegeben/) < logIdx(env, /Kodi: Start angefordert/), 'Reihenfolge: erst freigeben, dann Kodi');
  const bs = env.ctx.__flex.bgState();
  check(bs.rel && bs.rel.done === true && bs.rel.robn === true && !bs.closing, 'Freigabe done für robn');
  check(env.store.state.AppControl.runningOnBackForNetflix === true, 'Launcher-Merker unangetastet (nur der Launcher schreibt sie)');
  // Kodi läuft, Auftrag -> angenommen, benutzt unser DMP ohne zweiten Wechsel
  const k = kodiSim(env);
  kodiUp(env, k);
  check(hasLog(env, /Kodi läuft/), 'Kodi läuft');
  k.play('a1b2c3d4e5f60718');
  env.advance(1500);
  check(!hasLog(env, /abgelehnt \(app\)/), 'Auftrag nicht wegen app abgelehnt');
  check(hasLog(env, /kodiPlay: Auftrag a1b2c3d4e5f60718 angenommen/), 'kodiPlay: Auftrag angenommen');
  check(commits(env, 'DMP') === 1, 'kein zweites DMP (unser DMP steht)');
  env.advance(4000);
  const s = k.status();
  check(s && (s.st === 'playing' || s.st === 'preparing'), 'player.json: ' + (s && s.st));
  k.writeCtl({ seq: 1, stop: 1 });
  env.advance(1000);
  env.files.delete('flexkodi/rt/play.json');
  k.stop();
  env.advance(8000);
  check(hasLog(env, /Kodi beendet/), 'Kodi beendet');
  check(commits(env, 'LAST') === 1 && env.src.name === 'hdmi1', 'LAST nach Kodis Ende (Ausstieg mit Freigabe)');
  check(hasLog(env, /DMP verlassen \(Kodi beendet\)/), 'Log: DMP verlassen (Kodi beendet)');
  check(env.flexAcks.length === 0, 'flex.js hat nie selbst quittiert');
})();

// ---------- W1-B: Kodi ohne Hintergrund-App: wie bisher ----------
(function () {
  console.log('--- W1-B: ohne pausierte App startet Kodi sofort, ohne DMP');
  const env = boot();
  focus(env, 0);
  press(env, 13);
  check(env.files.has('flexkodi/start') && commits(env, 'DMP') === 0, 'sofort Startanforderung, kein DMP');
  check(toast(env) === 'Kodi startet …', 'Hinweis unverändert: ' + toast(env));
  check(!hasLog(env, /freigegeben|Schließen/), 'nichts freigegeben');
})();

// ---------- W1-C: DMP kommt nicht: Kodi trotzdem, E1-Hinweis wie bisher ----------
(function () {
  console.log('--- W1-C: Zeitlimit -> Kodi mit E1-Hinweis, kodiPlay streng, DMP gehört der Kodi-Sitzung');
  const env = boot({ dmpMs: 600000 });
  netflixPaused(env);
  focus(env, 0);
  press(env, 13);
  env.advance(4500);
  check(!env.files.has('flexkodi/start'), 'nach 4,5 s noch kein Start (wartet höchstens 5 s)');
  env.advance(1000);
  check(hasLog(env, /Schließen ohne Ergebnis: Netflix \(DMP nicht bestätigt\), nur DMP-Ausstieg freigegeben/), 'Log: ohne Ergebnis, nur DMP-Ausstieg freigegeben');
  check(env.files.has('flexkodi/start'), 'Kodi trotzdem gestartet');
  check(/Filme spielt Kodi selbst/.test(toast(env)) && hasLog(env, /TV-Player gesperrt, E1/), 'E1-Hinweis wie bisher');
  const rel = env.ctx.__flex.bgState().rel;
  check(rel && rel.done === false && rel.exit === true, 'nur Ausstiegs-Freigabe: ' + JSON.stringify(rel));
  const k = kodiSim(env);
  kodiUp(env, k);
  k.play('b1b2c3d4e5f60718');
  env.advance(1500);
  check(hasLog(env, /Auftrag b1b2c3d4e5f60718 abgelehnt \(app\)/), 'kodiPlay lehnt ab (app), streng');
  k.stop();
  env.advance(8000);
  check(commits(env, 'LAST') === 0 && hasLog(env, /DMP schon verlassen \(Kodi beendet\)/), 'DMP kam nie: nach Kodi nichts umgeschaltet');
})();

// ---------- W1-D: fremde Taste während des Schließens: kein Kodi, DMP wieder verlassen ----------
(function () {
  console.log('--- W1-D: Taste (Rechts) während der Freigabe bricht ab (Schutzregel 3)');
  const env = boot();
  netflixPaused(env);
  focus(env, 0);
  press(env, 13);
  env.advance(1500);            // DMP steht (900 ms), Ruhezeit läuft
  press(env, 39);
  env.advance(300);
  check(hasLog(env, /Schließen abgebrochen: Netflix \(Taste\)/), 'Log: abgebrochen (Taste)');
  check(hasLog(env, /Kodi: Start abgebrochen \(Taste\)/) && toast(env) === 'Kodi-Start abgebrochen', 'Hinweis: Kodi-Start abgebrochen');
  check(!env.files.has('flexkodi/start'), 'kein Kodi-Start');
  check(env.ctx.__flex.bgState().rel && env.ctx.__flex.bgState().rel.done, 'Freigabe bleibt (DMP war bestätigt)');
  env.advance(4000);
  check(commits(env, 'LAST') === 1 && env.src.name === 'hdmi1', 'DMP wieder verlassen (LAST, nach Ruhe geprüft)');
})();

// ---------- W1-E: Wechsel innerhalb des Launchers (Alle Apps, keine App) während der Freigabe ----------
// z. B. Stopp-Ereignis einer per Alle Apps gestarteten App (AppControl.js:986): kein Kodi, Hinweis
// "noch einmal wählen", DMP wieder verlassen (beim Feuern geprüft)
(function () {
  console.log('--- W1-E: Alle Apps nach vorne (ohne App) während der Freigabe');
  const env = boot();
  netflixPaused(env);
  focus(env, 0);
  press(env, 13);
  env.advance(500);
  env.UI.sub = 'AllApps';
  env.advance(500);
  check(hasLog(env, /Schließen abgebrochen: Netflix \(Modulwechsel\), nur DMP-Ausstieg freigegeben/), 'Log: abgebrochen (Modulwechsel), nur DMP-Ausstieg');
  check(!env.files.has('flexkodi/start'), 'kein Kodi-Start');
  check(toast(env) === 'Kodi-Start abgebrochen: bitte Kodi noch einmal wählen', 'Hinweis: ' + toast(env));
  env.advance(5000);
  check(commits(env, 'LAST') === 1 && env.src.name === 'hdmi1' && hasLog(env, /DMP verlassen \(Kodi-Start abgebrochen\)/), 'DMP wieder verlassen (LAST)');
})();

// ---------- W1-E2: App per Cast während der Freigabe: Quelle nicht angefasst ----------
(function () {
  console.log('--- W1-E2: App kommt per Cast (AppControl) während der Freigabe');
  const env = boot();
  netflixPaused(env);
  focus(env, 0);
  press(env, 13);
  env.advance(500);
  env.UI.mod = 'AppControl'; env.UI.sub = 'AppControl';
  env.UI.isSubModuleExist = function (a, b) { return a === 'AppControl' && b === 'AppControl'; };
  env.store.state.AppControl.currentAMState = 'starting';
  env.advance(500);
  check(hasLog(env, /Schließen abgebrochen: Netflix \(App gestartet\), keine Freigabe/), 'Log: abgebrochen (App gestartet), keine Freigabe');
  check(hasLog(env, /DMP bleibt \(Kodi-Start abgebrochen: App gestartet\)/), 'DMP bleibt (gehört der App)');
  env.advance(6000);
  check(commits(env, 'LAST') === 0 && !env.files.has('flexkodi/start'), 'kein LAST, kein Kodi');
})();

// ---------- W1-F: AppControl im Stapel, App aber nicht 'started' (hier 'stopped'): abgelehnt ----------
// Seit v10 beendet die Kodi-Kachel eine App unter der Startseite (Besitzer 08.11.2026), aber nur im
// Zustand 'started' (uhApp); den Normalfall mit echtem Modul-Stapel prüft test6.js (S7b auch für
// 'stopped'/'stopping'). AppControl hier als Modul UND Untermodul, sonst lehnte uhApp schon mit
// "kein AppControl" ab, bevor es den Zustand liest.
(function () {
  console.log('--- W1-F: AppControl im Stapel, Zustand stopped -> kein Start, nichts geschlossen');
  const env = boot();
  netflixPaused(env);
  env.UI.isSubModuleExist = function (a, b) { return a === 'AppControl' && b === 'AppControl'; };
  env.UI.isModuleExist = function (m) { return m === 'AppControl'; };
  focus(env, 0);
  press(env, 13);
  check(!env.files.has('flexkodi/start') && commits(env, 'DMP') === 0, 'kein Start, kein DMP');
  check(toast(env) === 'Bitte zuerst die App mit Zurück/Exit beenden', 'Hinweis wie bisher');
  check(hasLog(env, /App unter der Startseite nicht beendbar \(App im Zustand stopped\)/), 'Grund: stopped');
})();

// ---------- W1-G: STR während des Schließens ----------
(function () {
  console.log('--- W1-G: STR_SUSPENDING während der Freigabe');
  const env = boot();
  netflixPaused(env);
  focus(env, 0);
  press(env, 13);
  env.advance(400);
  env.UI.isReady = false;
  env.subs.STR_SUSPENDING();
  env.advance(3000);
  check(hasLog(env, /Schließen abgebrochen \(STR_SUSPENDING\)/), 'Log: Schließen abgebrochen (STR_SUSPENDING)');
  check(!env.files.has('flexkodi/start') && env.ctx.__flex.bgState().rel === null, 'kein Start, keine Freigabe');
  check(env.ctx.__flex.ownsDmp() === false, 'DMP gilt nicht mehr als unseres');
})();

// ---------- W1-H: Kodi von Hand gestartet: nichts wird geschlossen ----------
(function () {
  console.log('--- W1-H: Kodi von Hand (ohne Kachel) mit pausiertem Netflix');
  const env = boot();
  netflixPaused(env);
  const k = kodiSim(env);
  kodiUp(env, k);
  k.play('c1b2c3d4e5f60718');
  env.advance(1500);
  check(commits(env, 'DMP') === 0 && !hasLog(env, /Schließen/), 'kein DMP, kein Schließen');
  check(hasLog(env, /Auftrag c1b2c3d4e5f60718 abgelehnt \(app\)/), 'kodiPlay streng (E1 a)');
})();

// ---------- W1-I: Freigabe verfällt, sobald wieder eine App benutzt wird ----------
(function () {
  console.log('--- W1-I: Freigabe verfällt bei App im Stapel');
  const env = boot();
  netflixPaused(env);
  focus(env, 1);
  press(env, 567);
  press(env, 13);              // App schließen
  env.advance(2500);
  check(env.ctx.__flex.bgState().rel && env.ctx.__flex.bgState().rel.done, 'Freigabe done');
  env.advance(4000);
  env.UI.isSubModuleExist = function (a, b) { return a === 'AppControl' && b === 'AppControl'; };
  env.advance(1100);
  check(hasLog(env, /Freigabe der Hintergrund-Apps verfällt \(App im Modul-Stapel\)/), 'Log: Freigabe verfällt (App im Modul-Stapel)');
  check(env.ctx.__flex.bgState().rel === null, 'keine Freigabe mehr');
})();

// ---------- W1-J: Startseite wird während der Ruhezeit neu aufgebaut ----------
(function () {
  console.log('--- W1-J: Launcher baut die Startseite neu auf (homeIdle kurz false)');
  const env = boot();
  netflixPaused(env);
  focus(env, 0);
  press(env, 13);
  env.advance(1000);
  env.launcherDom = false;
  env.advance(600);
  env.launcherDom = true;
  env.advance(1500);
  check(env.files.has('flexkodi/start') && hasLog(env, /Hintergrund-Apps freigegeben/), 'trotzdem freigegeben und gestartet');
})();

// ---------- W2-A: Einstellungstaste auf Netflix (pausiert) -> App schließen ----------
(function () {
  console.log('--- W2-A: Kachel-Menü auf Netflix, App schließen (= TV-Player freigeben)');
  const env = boot();
  netflixPaused(env);
  focus(env, 1);
  const r = press(env, 567);
  check(r.keydown === 'tiles' && r.keyup === 'dispatcher', '567 von der Hülle verbraucht, keyup normal');
  check(!env.calls.some(c => c[0] === 'openSettings'), 'TV-Einstellungen nicht geöffnet');
  const bs = env.ctx.__flex.bgState();
  check(bs.menu && bs.menu.app === 'Netflix' && bs.menu.st === 'paused' && bs.menu.can[0] === true && bs.menu.idx === 0,
    'Menü offen: Netflix, paused, App schließen aktiv: ' + JSON.stringify(bs.menu));
  const el = menuEl(env);
  check(el && el.childNodes[0].textContent === 'Netflix' && el.childNodes[1].childNodes[0].textContent === 'App schließen' &&
    el.childNodes[2].childNodes[0].textContent === 'Abbrechen', 'Inhalt: Titel, App schließen, Abbrechen');
  check(el && el.childNodes[1].childNodes[1].textContent === 'pausiert', 'Notiz: pausiert');
  check(el && el.childNodes[1].className === 'ftm-item focus' && el.childNodes[2].className === 'ftm-item', 'Fokus auf App schließen');
  check(el && el.style.left === '100px', 'über der Kachel 1 (Mitte 360 px): left ' + (el && el.style.left));
  check(hasLog(env, /Kachel-Menü offen: Netflix \(paused\)/), 'Log: Kachel-Menü offen');
  press(env, 40);
  check(env.ctx.__flex.bgState().menu.idx === 1 && el.childNodes[2].className === 'ftm-item focus', 'Runter: Abbrechen');
  press(env, 38);
  check(env.ctx.__flex.bgState().menu.idx === 0, 'Hoch: App schließen');
  press(env, 39); press(env, 37);
  check(env.vm.componentFocus === 'LauncherMainTile-1' && env.ctx.__flex.bgState().menu, 'Links/Rechts verbraucht, Fokus bleibt, Menü bleibt');
  press(env, 13);
  check(!env.ctx.__flex.bgState().menu && !menuEl(env), 'OK: Menü zu');
  check(hasLog(env, /Kachel-Menü geschlossen \(App schließen\)/) && hasLog(env, /Schließen: Netflix \(DMP angefordert, Kachel-Menü\)/), 'Log: App schließen über Kachel-Menü');
  check(toast(env) === 'Netflix: TV-Player wird freigegeben …', 'Hinweis: wird freigegeben: ' + toast(env));
  env.advance(2500);
  check(hasLog(env, /Hintergrund-Apps freigegeben: Netflix/) && toast(env) === 'Netflix pausiert, TV-Player frei', 'freigegeben, Hinweis: ' + toast(env));
  check(!/geschlossen/.test(toast(env)), 'Hinweis behauptet kein "geschlossen"');
  check(env.ctx.__flex.bgState().menu === null, 'Menü zu');
  env.advance(2500);
  check(commits(env, 'LAST') === 1 && hasLog(env, /DMP verlassen \(App freigegeben\)/), 'LAST zurück zur letzten Quelle');
  // jede Taste genau einmal quittiert (vom Launcher), nie von flex.js, nichts per Capture verschluckt
  check(env.flexAcks.length === 0 && env.swallowed.length === 0, 'keine eigene Quittung, nichts verschluckt');
  check(env.uiAcks.length === 2 * 6, 'je Taste genau eine Quittung keydown + keyup: ' + env.uiAcks.length);
  check(env.uiAcks.filter(a => a[1] === 'keydown').every(a => a[0] === true), 'alle keydowns als behandelt quittiert');
  check(!env.origKeys.some(k => k === 13 || k === 40 || k === 38 || k === 567), 'Original-MainTiles sah keine Menü-Taste');
  // danach: schon freigegeben -> kein Menü, ein Druck öffnet die TV-Einstellungen, kurzer Hinweis
  const r2 = press(env, 567);
  check(r2.keydown === 'dispatcher' && env.calls.some(c => c[0] === 'openSettings') && !env.ctx.__flex.bgState().menu,
    'zweites Mal: kein Menü, TV-Einstellungen öffnen sofort');
  check(toast(env) === 'Netflix pausiert, TV-Player schon frei', 'Hinweis: ' + toast(env));
  // Bildschirmschoner bleibt streng (v6): Merker stehen noch -> keine Diashow
  env.files.set('flexss/list.json', JSON.stringify(['/APPS/flexss/a.jpg']));
  env.advance(95000);
  check(hasLog(env, /Bildschirmschoner: App vorhanden, keine Diashow/), 'Bildschirmschoner unverändert streng');
  press(env, 39);
  env.advance(3000);
  focus(env, 0);
  const before = commits(env, 'DMP');
  press(env, 13);
  check(env.files.has('flexkodi/start') && commits(env, 'DMP') === before, 'Kodi startet sofort, keine zweite Freigabe');
  check(toast(env) === 'Kodi startet …', 'Hinweis ohne E1: ' + toast(env));
})();

// ---------- W2-B: nichts zu schließen: der erste Druck öffnet die TV-Einstellungen ----------
(function () {
  console.log('--- W2-B: 567 auf einer App, die nicht läuft -> TV-Einstellungen wie ohne Mod');
  const env = boot();
  [6, 2, 3, 4, 5].forEach(function (n) {      // YouTube, Prime Video, Disney+, DAZN, UFC
    focus(env, n);
    const before = env.calls.filter(c => c[0] === 'openSettings').length;
    const r = press(env, 567);
    check(r.keydown === 'dispatcher' && env.calls.filter(c => c[0] === 'openSettings').length === before + 1 &&
      !env.ctx.__flex.bgState().menu, 'Kachel ' + n + ': erster Druck öffnet die TV-Einstellungen');
  });
  check(toast(env) === '', 'kein Hinweis: ' + toast(env));
  check(hasLog(env, /Kachel-Menü nicht geöffnet: YouTube \(läuft nicht\)/), 'Log: nicht geöffnet (läuft nicht)');
  // mit offenem Menü: zweiter Druck schließt es und geht an den Launcher
  netflixPaused(env);
  focus(env, 1);
  press(env, 567);
  check(!!env.ctx.__flex.bgState().menu, 'Netflix pausiert: Menü offen');
  const r = press(env, 567);
  check(r.keydown === 'dispatcher' && !env.ctx.__flex.bgState().menu, 'zweiter Druck: Menü zu, an den Launcher (Einstellungen)');
  check(env.flexAcks.length === 0, 'keine eigene Quittung');
})();

// ---------- W2-C: eigene Kacheln und App unter der Startseite ----------
(function () {
  console.log('--- W2-C: 567 auf Kodi/Quellen/Alle Apps; Netflix unter der Startseite');
  const env = boot();
  [0, 7, 8].forEach(function (n) {
    focus(env, n);
    const r = press(env, 567);
    check(r.keydown === 'dispatcher' && !env.ctx.__flex.bgState().menu, 'Kachel ' + n + ': 567 geht an den Launcher');
  });
  netflixPaused(env);
  env.store.state.AppControl.currentAMState = 'started';
  env.UI.isSubModuleExist = function (a, b) { return a === 'AppControl' && b === 'AppControl'; };
  focus(env, 1);
  let r = press(env, 567);
  check(r.keydown === 'dispatcher' && !env.ctx.__flex.bgState().menu, 'Netflix unter der Startseite: kein Menü, Einstellungen');
  check(toast(env) === 'Netflix läuft noch: Exit beendet die App', 'Hinweis: ' + toast(env));
  r = press(env, 27);
  check(r.keydown === 'launcher' && env.calls.some(c => c[0] === 'launcherExit'), 'Exit geht an den Launcher (der beendet die App)');
  // Disney+ als Browser-App vorne
  env.store.state.AppControl.currentAppName = 'browser';
  env.store.state.AppControl.currentLocalAppName = 'disney+';
  focus(env, 3);
  r = press(env, 567);
  check(r.keydown === 'dispatcher' && toast(env) === 'Disney+ läuft noch: Exit beendet die App', 'Disney+ (browser, disney+) erkannt: ' + toast(env));
  focus(env, 4);
  r = press(env, 567);
  check(r.keydown === 'dispatcher' && hasLog(env, /Kachel-Menü nicht geöffnet: DAZN \(läuft nicht\)/), 'DAZN läuft nicht (andere Browser-App vorne)');
})();

// ---------- W2-H: pausiertes Netflix, während eine andere App unter der Startseite liegt ----------
(function () {
  console.log('--- W2-H: Netflix pausiert, YouTube unter der Startseite (Befund 12)');
  const env = boot();
  netflixPaused(env);
  const ac = env.store.state.AppControl;
  ac.currentAMState = 'started'; ac.currentAppName = 'youtube';
  env.UI.isSubModuleExist = function (a, b) { return a === 'AppControl' && b === 'AppControl'; };
  focus(env, 1);
  const r = press(env, 567);
  check(r.keydown === 'dispatcher' && !env.ctx.__flex.bgState().menu, 'kein Menü, Einstellungen');
  check(hasLog(env, /Kachel-Menü nicht geöffnet: Netflix \(paused, App im Modul-Stapel\)/), 'Zustand paused, gerade nicht (App im Modul-Stapel)');
  check(toast(env) === 'Netflix lässt sich gerade nicht schließen (erst die offene App mit Exit beenden)', 'Hinweis: ' + toast(env));
})();

// ---------- W2-G: bei offenem Menü gehen fremde Tasten unverändert weiter (Befund 4) ----------
(function () {
  console.log('--- W2-G: App-/Systemtasten bei offenem Menü');
  const env = boot();
  netflixPaused(env);
  focus(env, 1);
  [620, 689, 556, 405, 1010, 50, 406].forEach(function (k) {   // Rakuten, DAZN, Live-TV, EPG, DISMATCH1, Ziffer 2, Farbtaste
    press(env, 567);
    check(!!env.ctx.__flex.bgState().menu, 'Menü offen vor Taste ' + k);
    const r = press(env, k);
    check(r.keydown !== 'tiles' && !env.ctx.__flex.bgState().menu && env.origKeys.indexOf(k) >= 0,
      'Taste ' + k + ': Menü zu, unverändert an MainTiles/Launcher');
  });
  press(env, 567);
  press(env, 411);
  check(!!env.ctx.__flex.bgState().menu && env.origKeys.indexOf(411) >= 0, 'Lauter: Menü bleibt, Taste geht weiter');
  press(env, 8);
  check(!env.ctx.__flex.bgState().menu && !env.calls.some(c => c[0] === 'launcherBack'), 'Zurück schließt nur das Menü');
  check(env.flexAcks.length === 0 && env.uiAcks.filter(a => a[1] === 'keydown').length === 17, 'jede Taste genau einmal quittiert');
})();

// ---------- W2-D: Dialog bzw. Modulwechsel schließen das Menü (Schutzregel 6) ----------
(function () {
  console.log('--- W2-D: Dialog und Modulwechsel');
  const env = boot();
  netflixPaused(env);
  focus(env, 1);
  press(env, 567);
  env.UI.dialog = true;
  const r = press(env, 13);
  check(!env.ctx.__flex.bgState().menu && r.keydown !== 'tiles' && commits(env, 'DMP') === 0, 'Dialog: Menü zu, OK geht weiter, kein Schließen');
  env.UI.dialog = false;
  press(env, 567);
  check(!!env.ctx.__flex.bgState().menu, 'wieder offen');
  env.UI.sub = 'AllInputs';
  env.advance(1100);
  check(!env.ctx.__flex.bgState().menu && hasLog(env, /Kachel-Menü geschlossen \(Startseite nicht mehr frei\)/), '1-s-Takt: Modulwechsel schließt');
  env.UI.sub = 'LauncherHis';
  press(env, 567);
  env.subs.INIT_LOADING();
  check(!env.ctx.__flex.bgState().menu, 'INIT_LOADING schließt');
  // Bildschirmschoner schließt das Menü
  env.advance(3000);
  press(env, 567);
  check(!!env.ctx.__flex.bgState().menu, 'offen');
  env.advance(62000);
  check(!env.ctx.__flex.bgState().menu && hasLog(env, /Kachel-Menü geschlossen \(Bildschirmschoner\)/), 'Bildschirmschoner schließt das Menü');
})();

// ---------- W2-E: Kodi läuft bzw. startet: kein Menü ----------
(function () {
  console.log('--- W2-E: kein Menü während Kodi startet');
  const env = boot();
  focus(env, 0);
  press(env, 13);
  focus(env, 1);
  const r = press(env, 567);
  check(r.keydown === 'dispatcher' && !env.ctx.__flex.bgState().menu, 'Kodi angefordert: 567 geht an den Launcher');
})();

// ---------- W2-F: App schließen, aber Zustand änderte sich (App gestartet) ----------
(function () {
  console.log('--- W2-F: Zustand beim OK neu geprüft');
  const env = boot();
  netflixPaused(env);
  focus(env, 1);
  press(env, 567);
  env.store.state.AppControl.runningOnBackForNetflix = false;   // z. B. Netflix per Cast gestartet
  press(env, 13);
  check(commits(env, 'DMP') === 0 && toast(env) === 'Netflix lässt sich gerade nicht schließen', 'nicht geschlossen, Hinweis');
})();

// ---------- R1: OK auf Kodi gehalten (Wiederholungen nur im Capture-Listener, wie UI.js) ----------
(function () {
  console.log('--- R1: gehaltenes OK auf Kodi mit pausiertem Netflix (Befunde 1/7)');
  const env = boot();
  netflixPaused(env);
  focus(env, 0);
  const ev = { type: 'keydown', keyCode: 13, which: 13, repeat: false, stopped: false, stopImmediatePropagation() {}, preventDefault() {} };
  env.capture.forEach(h => { if (h.type === 'keydown') h.fn(ev); });
  check(env.vm.keydown(ev) === true, 'erstes keydown: Hülle verbraucht');
  for (let i = 0; i < 6; i++) { env.advance(i ? 100 : 330); press(env, 13, { repeat: true }); }   // ~0,8 s gehalten
  press(env, 13);              // loslassen (keyup) und noch ein kurzer Druck
  env.advance(4000);
  check(!hasLog(env, /abgebrochen/), 'kein Abbruch');
  check(env.files.has('flexkodi/start') && hasLog(env, /Kodi: Start angefordert \(Netflix freigegeben\)/), 'Kodi gestartet, TV-Player frei');
})();

// ---------- R2: Taste vor der DMP-Bestätigung: DMP wird trotzdem wieder verlassen ----------
(function () {
  console.log('--- R2: Rechts 200 ms nach OK auf Kodi (Befunde 3/8, Testplan T3), DMP nach 1,5 s');
  const env = boot({ dmpMs: 1500 });
  netflixPaused(env);
  focus(env, 0);
  press(env, 13);
  env.advance(200);
  press(env, 39);
  env.advance(400);
  check(hasLog(env, /Schließen abgebrochen: Netflix \(Taste\), nur DMP-Ausstieg freigegeben/), 'Log: abgebrochen (Taste), nur DMP-Ausstieg');
  check(toast(env) === 'Kodi-Start abgebrochen' && !env.files.has('flexkodi/start'), 'kein Kodi');
  env.advance(600);            // 1,2 s: 1-s-Takt lief, DMP noch nicht da, Ausstieg steht aus
  check(env.ctx.__flex.ownsDmp() === true && env.src.name !== 'dmp', 'DMP gilt als unseres, solange der Ausstieg aussteht');
  env.advance(4000);
  check(commits(env, 'LAST') === 1 && env.src.name === 'hdmi1' && hasLog(env, /DMP verlassen \(Kodi-Start abgebrochen\)/), 'DMP verlassen: ' + env.src.name);
  // kodiPlay bleibt streng (nur Ausstiegs-Freigabe)
  const k = kodiSim(env);
  kodiUp(env, k);
  k.play('d1b2c3d4e5f60718');
  env.advance(1500);
  check(hasLog(env, /Auftrag d1b2c3d4e5f60718 abgelehnt \(app\)/), 'kodiPlay nach Abbruch streng (E1 a)');
})();

// ---------- R3: Reihenfolge wie nach einem Hot-Reload (Launcher-Handler vor onKey) ----------
(function () {
  console.log('--- R3: OK auf Kodi, Komponente vor onKey (Befund 7)');
  const env = boot();
  netflixPaused(env);
  focus(env, 0);
  press(env, 13, { hot: true });
  press(env, 13, { hot: true, repeat: true });
  env.advance(4000);
  check(!hasLog(env, /abgebrochen/) && env.files.has('flexkodi/start'), 'Kodi gestartet, kein Abbruch');
})();

// ---------- R4: Kachel-Menü, DMP kommt erst nach dem Zeitlimit ----------
(function () {
  console.log('--- R4: App schließen, DMP nach 7 s (Zeitlimit 5 s)');
  const env = boot({ dmpMs: 7000 });
  netflixPaused(env);
  focus(env, 1);
  press(env, 567);
  press(env, 13);
  env.advance(5500);
  check(hasLog(env, /Schließen ohne Ergebnis: Netflix \(DMP nicht bestätigt\), nur DMP-Ausstieg freigegeben/), 'Zeitlimit, nur DMP-Ausstieg');
  check(toast(env) === 'Netflix: TV-Player nicht freigegeben', 'Hinweis: ' + toast(env));
  check(env.src.name !== 'dmp' && commits(env, 'LAST') === 0, 'noch kein DMP, kein LAST');
  env.advance(6000);
  check(commits(env, 'LAST') === 1 && env.src.name === 'hdmi1' && hasLog(env, /DMP verlassen \(App schließen ohne Ergebnis\)/), 'spätes DMP wieder verlassen');
})();

// ---------- R5: Kodi-Start, DMP kommt erst nach dem Zeitlimit; nach Kodis Ende LAST ----------
(function () {
  console.log('--- R5: Kodi-Start, DMP nach 7 s; Kodi beendet -> DMP verlassen');
  const env = boot({ dmpMs: 7000 });
  netflixPaused(env);
  focus(env, 0);
  press(env, 13);
  env.advance(5500);
  check(env.files.has('flexkodi/start') && hasLog(env, /TV-Player gesperrt, E1/), 'Kodi mit E1-Hinweis gestartet');
  const k = kodiSim(env);
  kodiUp(env, k);
  env.advance(3000);
  check(env.src.name === 'dmp' && env.ctx.__flex.ownsDmp() === true, 'spätes DMP gehört der Kodi-Sitzung');
  k.stop();
  env.advance(8000);
  check(commits(env, 'LAST') === 1 && env.src.name === 'hdmi1' && hasLog(env, /DMP verlassen \(Kodi beendet\)/), 'nach Kodis Ende verlassen');
})();

// ---------- R6: Hot-Reload, während Kodi nach der Freigabe läuft ----------
(function () {
  console.log('--- R6: Hot-Reload nach der Freigabe: kodiPlay nimmt weiter an (Befund 10)');
  const env = boot();
  netflixPaused(env);
  focus(env, 0);
  press(env, 13);
  env.advance(2500);
  const k = kodiSim(env);
  kodiUp(env, k);
  env.files.set('flexkodi/rt/key', KEY + '\n');
  env.load(FLEX);              // Hot-Reload
  env.advance(1100);
  env.files.delete('flexkodi/rt/key');
  check(hasLog(env, /Freigabe der Hintergrund-Apps übernommen \(voll\)/), 'Freigabe übernommen');
  k.play('e1b2c3d4e5f60718');
  env.advance(1500);
  check(!hasLog(env, /e1b2c3d4e5f60718 abgelehnt/) && hasLog(env, /Auftrag e1b2c3d4e5f60718 angenommen/), 'Auftrag nach Hot-Reload angenommen');
  k.writeCtl({ seq: 1, stop: 1 });
  env.advance(1000);
  env.files.delete('flexkodi/rt/play.json');
  k.stop();
  env.advance(8000);
  check(commits(env, 'LAST') === 1 && env.src.name === 'hdmi1', 'nach Kodis Ende DMP verlassen (Freigabe übernommen)');
})();

// ---------- R7: Hot-Reload mitten in der Freigabe ----------
(function () {
  console.log('--- R7: Hot-Reload während der Freigabe: ohne Folgen beendet');
  const env = boot();
  netflixPaused(env);
  focus(env, 0);
  press(env, 13);
  env.advance(300);
  env.load(FLEX);
  env.advance(6000);
  check(hasLog(env, /Schließen abgebrochen \(Hot-Reload\)/), 'Log: abgebrochen (Hot-Reload)');
  check(!env.files.has('flexkodi/start'), 'kein Kodi-Start aus der alten Instanz');
  const rel = env.ctx.__flex.bgState().rel;
  check(rel && rel.done === false && rel.exit === true && !env.ctx.__flex.bgState().closing, 'neue Instanz: nur Ausstiegs-Freigabe: ' + JSON.stringify(rel));
  // nächster Druck auf Kodi: DMP steht schon (unseres) -> sofort frei, Kodi startet
  press(env, 13, { hot: true });
  env.advance(500);
  check(env.files.has('flexkodi/start') && hasLog(env, /Hintergrund-Apps freigegeben: Netflix pausiert, TV-Player frei \(DMP stand schon\)/), 'zweiter Druck: Kodi startet');
})();

// ---------- R8: Bildschirmschoner nach Ausstiegs-Freigabe bleibt streng ----------
(function () {
  console.log('--- R8: nach Abbruch keine Diashow (Ausstiegs-Freigabe gilt nur für den Ausstieg)');
  const env = boot();
  netflixPaused(env);
  env.files.set('flexss/list.json', JSON.stringify(['/APPS/flexss/a.jpg']));
  focus(env, 0);
  press(env, 13);
  env.advance(200);
  press(env, 39);
  env.advance(6000);
  check(commits(env, 'LAST') === 1, 'DMP verlassen');
  env.advance(95000);
  check(hasLog(env, /Bildschirmschoner: App vorhanden, keine Diashow/) && commits(env, 'DMP') === 1, 'Diashow gesperrt, kein weiteres DMP');
})();

// ---------- R9: gehaltenes OK auf Netflix im Kachel-Menü ----------
(function () {
  console.log('--- R9: Menü-OK gehalten: genau eine Freigabe');
  const env = boot();
  netflixPaused(env);
  focus(env, 1);
  press(env, 567);
  press(env, 13);
  press(env, 13, { repeat: true });
  env.advance(3000);
  check(commits(env, 'DMP') === 1 && hasLog(env, /Hintergrund-Apps freigegeben: Netflix/), 'eine Freigabe');
})();

// ---------- R10: abgebrochen und sofort wieder Kodi: kein zweiter DMP-Befehl ----------
(function () {
  console.log('--- R10: OK, Rechts, Links, OK auf Kodi innerhalb von 0,6 s');
  const env = boot();
  netflixPaused(env);
  focus(env, 0);
  press(env, 13);
  env.advance(200);
  press(env, 39);
  env.advance(200);
  press(env, 37);
  env.advance(200);
  check(env.vm.componentFocus === 'LauncherMainTile-0' && env.src.name !== 'dmp', 'Fokus wieder auf Kodi, DMP noch unterwegs');
  press(env, 13);
  check(hasLog(env, /Schließen: Netflix \(DMP schon angefordert, Kodi-Start\)/), 'Log: DMP schon angefordert');
  env.advance(3000);
  check(commits(env, 'DMP') === 1, 'genau ein DMP-Befehl: ' + commits(env, 'DMP'));
  check(env.files.has('flexkodi/start') && commits(env, 'LAST') === 0, 'Kodi startet, kein LAST');
  check(env.ctx.__flex.bgState().rel.done === true, 'volle Freigabe');
})();

console.log(fails ? fails + ' Prüfung(en) fehlgeschlagen' : 'alle Prüfungen bestanden');
process.exit(fails ? 1 : 0);
