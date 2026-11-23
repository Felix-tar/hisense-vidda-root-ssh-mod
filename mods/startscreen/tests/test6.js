// flex.js v10: Kodi-Kachel beendet auch die App unter der Startseite (Entscheidung des Besitzers
// 08.11.2026: "sobald Kodi gestartet wird, alle anderen beenden"; Ausnahme von Schutzregeln 4/7 nur
// für OK auf der Kodi-Kachel). Attrappe aus harness.js mit Modul-Stapel und App-Lebenszyklus
// (makeEnv({ stack: true })): HOME/EXIT des Launchers, AppControl.vue beforeDestroy, AppStatus nach
// dem Quellwechsel, Reaktion des Launchers je Startweg. Kopf (Tasten-Weitergabe, Kodi-Attrappe) wie
// test4.js. Erwarteter Ablauf: popAllModule('app') + DMP im selben Schritt, warten auf 'stopped' und
// DMP, 1 s Ruhe, dann Freigabe ("DMP stand schon") und Kodi.
// Nach der Durchsicht (13.11.2026) zusätzlich: openFromNetflix auch nach einem Abbruch gelöscht (S13),
// Zeitlimit UH_MAX_MS + Ruhezeit (S14, S15c, S15f), Hinweis bei 'stopping' ohne AppControl (S10b/c),
// erneutes OK während des passiven Wartens (S5b-d), weitere Abbrüche und Ablehnungen (S7b/c, S11b, S15).
'use strict';
const { makeEnv, frame, unframe } = require('./harness');
const FLEX = process.argv[2] || require('path').join(__dirname, '../flex/flex.js');
const KEY = '00112233445566778899aabbccddeeff'; // Synthetic HMAC test vector
let fails = 0;
function check(c, msg) { console.log((c ? 'OK   ' : 'FAIL ') + msg); if (!c) fails++; }
function hasLog(env, re) { return env.logs.some(l => re.test(l)); }
function srcVal(v) { return Array.isArray(v) ? v[0] : v; }
function commits(env, v) { return env.commits.filter(c => c[0] === 'Source/setCurrentSource' && srcVal(c[1]) === v).length; }
// LAST von flex.js (Zeichenkette); der Launcher schickt ['LAST', 60] bzw. ['LAST', 2]
function flexLast(env) { return env.commits.filter(c => c[0] === 'Source/setCurrentSource' && c[1] === 'LAST').length; }

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

function mainTiles(env) {
  return {
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
      if (e.keyCode === 13) env.calls.push(['ORIG MainTiles ENTER', this.componentFocus]);   // startThirdPartyApp
      return undefined;
    }
  };
}

function boot(opts) {
  const env = makeEnv(Object.assign({ stack: true }, opts));
  env.files.set('flexdbg/enable', '');
  env.subs = {};
  env.UI.subscribeMessage = function (n, f) { env.subs[n] = f; };
  env.capture = [];
  env.ctx.addEventListener = function (type, fn, cap) { if (cap) env.capture.push({ type, fn }); };
  env.ctx.removeEventListener = function (type, fn) { env.capture = env.capture.filter(h => h.fn !== fn); };
  env.ctx.CONST = { KEY: { VK_ENTER: 13, VK_UP: 38, VK_DOWN: 40, VK_LEFT: 37, VK_RIGHT: 39, VK_SETTINGS: 567, VK_TOOLS: 567,
    VK_MENU: 409, VK_BACK: 8, VK_EXIT: 27, VK_HOME: 36 } };
  const st = env.store._modulesNamespaceMap['LauncherHis/'].context.state;
  st.mainTileData = JSON.parse(JSON.stringify(TILES));
  st.currentRowIndex = 1;
  st.openFromNetflix = false;
  env.lstate = st;
  env.origKeys = [];
  env.vm = mainTiles(env);
  env.launcherDom = true;
  // Commits zusätzlich in env.calls (Reihenfolge gegenüber popAllModule prüfbar), auch die der
  // Launcher-Attrappe (openLauncher, EXIT)
  const commit1 = env.store.commit;
  env.store.commit = function (name, v) { env.calls.push(['commit', name, srcVal(v)]); return commit1.call(this, name, v); };
  // env.rebuildHome: popAllModule() + pushSubModule('LauncherHis') baut die Startseite neu auf
  // (neue, noch nicht umhüllte MainTiles-Instanz, DOM 300 ms weg); ob keep-alive das am TV verhindert, ist offen
  env.onPush = function (m, s) {
    if (!env.rebuildHome || m !== 'LauncherHis' || s !== 'LauncherHis') return;
    const f = env.vm.componentFocus;
    env.vm = mainTiles(env);
    env.vm.componentFocus = f;
    env.launcherDom = false;
    env.calls.push(['rebuildHome']);
    env.ctx.setTimeout(function () { env.launcherDom = true; }, 300);
  };
  const q = env.ctx.document.querySelector;
  env.ctx.document.querySelector = function (s) {
    if (s === '.mainTiles') return env.launcherDom ? { __vue__: env.vm } : null;
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

// Weitergabe wie UI.js ve() (siehe test4.js); EXIT und ZURÜCK führt hier die Stapel-Attrappe aus
// (92.js L1939-1941 bzw. L1938: nach HOME aus Netflix öffnet ZURÜCK Netflix wieder)
const KEYSET_REPEAT = [38, 40, 37, 39, 415, 416, 607, 606, 411, 412, 609, 608, 427, 428];
function press(env, code, o) {
  o = o || {};
  const out = {};
  const types = o.repeat ? ['keydown'] : ['keydown', 'keyup'];
  types.forEach(function (type) {
    const ev = { type, keyCode: code, which: code, repeat: type === 'keydown' && !!o.repeat, stopped: false,
      stopImmediatePropagation() { this.stopped = true; }, preventDefault() {} };
    const dropped = ev.repeat && KEYSET_REPEAT.indexOf(code) < 0;
    let rHot;
    if (o.hot && type === 'keydown' && !dropped) rHot = env.vm.keydown(ev);
    env.capture.forEach(h => { if (h.type === type && !ev.stopped) h.fn(ev); });
    let handled = false, via = '';
    if (ev.stopped && !o.hot) { env.swallowed.push([type, code]); out[type] = 'swallowed'; return; }
    if (dropped) { env.uiAcks.push([false, type, code]); out[type] = 'dropped'; return; }
    if (o.hot && type === 'keydown') { handled = rHot === true; via = handled ? 'tiles' : 'none'; env.uiAcks.push([handled, type, code]); out[type] = via; return; }
    if (type === 'keydown') {
      const r = env.vm.keydown(ev);
      if (r === true) { handled = true; via = 'tiles'; }
      else if (code === 567) { env.calls.push(['openSettings']); handled = true; via = 'dispatcher'; }
      else if (code === 27) { env.calls.push(['launcherExit']); env.ctx.setTimeout(env.launcherExit, 0); handled = true; via = 'launcher'; }
      else if (code === 8) { env.calls.push(['launcherBack']); env.launcherBack(); handled = true; via = 'launcher'; }
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
function kodiUp(env, k) {
  k.start();
  env.advance(1500);
  env.files.set('flexkodi/rt/key', KEY + '\n');
  env.advance(1100);
  env.files.delete('flexkodi/rt/key');
}

// App per Kachel (Startweg 1) bzw. Alle Apps (3) starten, 5 s laufen lassen, HOME
function appUnderHome(env, name, o) {
  env.appStart(name, o);
  env.advance(5000);
  env.homeFromApp();
  env.advance(1100);           // 1-s-Takt: MainTiles wieder umhüllt, Startseite gilt als frei
  focus(env, 0);
  return { calls: env.calls.length, commits: env.commits.length };
}
function since(env, m) { return env.calls.slice(m.calls); }
function stackCalls(env, m) { return since(env, m).filter(c => /^(push|pop)/.test(c[0])); }
function liveTv(env, m) { return since(env, m).some(c => (c[0] === 'pushModule' && c[1] === 'LiveTV') || c[0] === 'openLiveTVModule'); }
function acCommits(env, m) { return env.commits.slice(m.commits).filter(c => /^AppControl\//.test(c[0])); }
// nur Aufrufe, die der Launcher selbst mit genau diesen Werten benutzt: popAllModule('app') (MainTiles
// bei AccuWeather, AppControl.js:986), DMP/LAST, setOpenFromNetflix(false) (openLauncher); dazu
// popSubModule('AppControl') aus dem AppStatus-Handler des Launchers. Nie eine AppControl-Mutation.
function ownCallsOnly(env, m) {
  const okStack = stackCalls(env, m).every(c => (c[0] === 'popAllModule' && c[1] === 'app') ||
    (c[0] === 'popSubModule' && c[1] === 'AppControl'));
  const okCommits = env.commits.slice(m.commits).every(c => (c[0] === 'Source/setCurrentSource' && (c[1] === 'DMP' || c[1] === 'LAST')) ||
    (c[0] === 'LauncherHis/setOpenFromNetflix' && c[1] === false));
  return okStack && okCommits && acCommits(env, m).length === 0;
}
function pops(env, m) { return stackCalls(env, m).filter(c => c[0] === 'popAllModule').length; }
function homeOnly(env) { return env.stack.str() === 'LauncherHis(LauncherHis)'; }
function closing(env) { return env.ctx.__flex.bgState().closing; }

// ---------- S0: Selbstprüfung der Attrappe: EXIT auf der Startseite endet auf Live-TV ----------
(function () {
  console.log('--- S0: Attrappe: YouTube (Kachel) -> HOME -> EXIT = Live-TV, runningOnBack (Pfad 1 in close-apps)');
  const env = boot();
  const m = appUnderHome(env, 'youtube');
  check(env.stack.str() === 'AppControl(AppControl) > LauncherHis(LauncherHis)' && env.UI.isSubModuleExist('AppControl', 'AppControl'),
    'nach HOME: AppControl unter der Startseite: ' + env.stack.str());
  press(env, 27);
  env.advance(3000);
  check(env.stack.str() === 'LiveTV(LiveTV)' && liveTv(env, m), 'EXIT endet auf Live-TV: ' + env.stack.str());
  check(env.store.state.AppControl.runningOnBack === true && env.store.state.AppControl.currentAMState === 'stopped', 'YouTube pausiert (runningOnBack)');
})();

// ---------- S1: YouTube per Kachel unter der Startseite, OK auf Kodi ----------
(function () {
  console.log('--- S1: YouTube (Startweg 1) unter der Startseite -> Kodi-Kachel beendet sie, Kodi startet');
  const env = boot();
  const m = appUnderHome(env, 'youtube');
  const r = press(env, 13);
  check(r.keydown === 'tiles' && env.flexAcks.length === 0, 'OK auf Kodi: von der Hülle verbraucht, keine eigene Quittung');
  check(!hasLog(env, /Kodi: App im Hintergrund, kein Start/) && toast(env) === 'YouTube wird beendet, Kodi startet …', 'keine Ablehnung, Hinweis: ' + toast(env));
  check(hasLog(env, /Kodi: YouTube liegt unter der Startseite \(youtube, Startweg 1\), wird beendet/), 'Log: liegt unter der Startseite, wird beendet');
  const seq = since(env, m).filter(c => c[0] === 'popAllModule' || c[0] === 'AppControl.beforeDestroy' || (c[0] === 'commit' && c[1] === 'Source/setCurrentSource'));
  check(JSON.stringify(seq) === JSON.stringify([['popAllModule', 'app'], ['commit', 'Source/setCurrentSource', 'DMP']]),
    'im selben Schritt: erst popAllModule(\'app\'), dann DMP (beforeDestroy erst danach): ' + JSON.stringify(seq));
  check(pops(env, m) === 1 && ownCallsOnly(env, m), 'genau ein popAllModule, nur eigene Aufrufe des Launchers: ' + JSON.stringify(stackCalls(env, m)));
  check(closing(env) && closing(env).app === true && closing(env).kodi === true, 'bgState: Beenden läuft (app)');
  env.advance(300);
  check(hasLog(env, /App beenden: AppControl weg \(stopping\) nach \d+ ms/), 'Log: beforeDestroy lief (stopping)');
  // OK auf Kodi samt Wiederholungen (gehalten) bricht nicht ab
  press(env, 13, { repeat: true });
  env.advance(100);
  press(env, 13, { repeat: true });
  env.advance(2600);
  const ac = env.store.state.AppControl;
  check(ac.currentAMState === 'stopped' && ac.appIsOn === false && homeOnly(env), 'App beendet, nur die Startseite im Stapel: ' + env.stack.str());
  check(!liveTv(env, m) && !since(env, m).some(c => c[0] === 'rebuildHome' || c[0] === 'ORIG MainTiles ENTER'), 'nie Live-TV, kein Neuaufbau, nie der originale Startpfad');
  check(commits(env, 'DMP') === 1 && env.files.has('flexkodi/start'), 'ein DMP-Befehl, Kodi angefordert');
  check(hasLog(env, /App beenden: AppStatus verarbeitet nach \d+ ms/) && hasLog(env, /App beenden: DMP aktiv nach \d+ ms/) &&
    hasLog(env, /App beenden: YouTube beendet nach \d+ ms/), 'Logzeilen: AppStatus, DMP, beendet');
  check(hasLog(env, /Hintergrund-Apps freigegeben: YouTube pausiert, TV-Player frei \(DMP stand schon\)/) &&
    hasLog(env, /Kodi: Start angefordert \(YouTube freigegeben\)/), 'Log: Freigabe (DMP stand schon), Start angefordert');
  check(/^Kodi startet …/.test(toast(env)) && !/Filme spielt Kodi selbst/.test(toast(env)), 'Hinweis ohne E1: ' + toast(env));
  check(ac.runningOnBack === true && ac.stopAppCallBackFun === 0 && acCommits(env, m).length === 0, 'Merker so, wie der Launcher sie setzt (YouTube paused), keine AppControl-Mutation');
  check(!hasLog(env, /Start abgebrochen/) && closing(env) === null, 'nicht abgebrochen, nichts läuft mehr');
  // kodiPlay nimmt an: die Freigabe deckt auch den erst durch das Beenden gesetzten Merker
  const k = kodiSim(env);
  kodiUp(env, k);
  k.play('a6b2c3d4e5f60701');
  env.advance(1500);
  check(hasLog(env, /kodiPlay: Auftrag a6b2c3d4e5f60701 angenommen/), 'kodiPlay nimmt an (nicht abgelehnt (app))');
  k.writeCtl({ seq: 1, stop: 1 });
  env.advance(1000);
  env.files.delete('flexkodi/rt/play.json');
  k.stop();
  env.advance(8000);
  check(flexLast(env) === 1 && homeOnly(env) && !liveTv(env, m), 'nach Kodis Ende LAST, Startseite bleibt vorne');
  check(env.flexAcks.length === 0 && ownCallsOnly(env, m), 'flex.js hat nie selbst quittiert, nur eigene Aufrufe des Launchers');
})();

// ---------- S2: Netflix unter der Startseite ----------
(function () {
  console.log('--- S2: Netflix (Startweg 1) unter der Startseite, openFromNetflix steht');
  const env = boot();
  const m = appUnderHome(env, 'netflix');
  check(env.lstate.openFromNetflix === true, 'Attrappe: HOME aus Netflix setzt openFromNetflix');
  press(env, 13);
  check(toast(env) === 'Netflix wird beendet, Kodi startet …', 'Hinweis: ' + toast(env));
  env.advance(3000);
  check(pops(env, m) === 1 && ownCallsOnly(env, m) && homeOnly(env) && !liveTv(env, m), 'beendet, Startseite vorne, nie Live-TV');
  check(env.store.state.AppControl.runningOnBackForNetflix === true && env.files.has('flexkodi/start'), 'Netflix paused, Kodi angefordert');
  // openLauncher() des Launchers löscht openFromNetflix; bleibt es stehen, startet ZURÜCK bzw. HOME
  // auf der Startseite Netflix neu (92.js L1938, app.js L1187)
  check(env.lstate.openFromNetflix === false && hasLog(env, /App beenden: openFromNetflix gelöscht/), 'openFromNetflix gelöscht (wie openLauncher, OA:7605)');
  check(hasLog(env, /Hintergrund-Apps freigegeben: Netflix pausiert/) && /^Kodi startet … \(TV-Player frei\)$/.test(toast(env)), 'Freigabe Netflix, Hinweis: ' + toast(env));
})();

// ---------- S3: Browser-App bzw. Prime Video unter der Startseite ----------
[['browser', 'disney+', 'Disney+'], ['amazon', '', 'Prime Video']].forEach(function (a) {
  console.log('--- S3: ' + a[0] + (a[1] ? ' (' + a[1] + ')' : '') + ' unter der Startseite');
  const env = boot();
  const m = appUnderHome(env, a[0], { local: a[1] });
  press(env, 13);
  check(toast(env) === a[2] + ' wird beendet, Kodi startet …', 'Name aus der Kachel: ' + toast(env));
  env.advance(3000);
  const ac = env.store.state.AppControl;
  check(pops(env, m) === 1 && ownCallsOnly(env, m) && homeOnly(env) && !liveTv(env, m) && ac.currentAMState === 'stopped', 'beendet ohne Live-TV: ' + env.stack.str());
  check(!ac.runningOnBack && !ac.runningOnBackForNetflix && env.files.has('flexkodi/start') && toast(env) === 'Kodi startet … (TV-Player frei)',
    'keine Merker, Kodi startet: ' + toast(env));
  // DMP gehört der Kodi-Sitzung: nach Kodis Ende verlassen
  const k = kodiSim(env);
  kodiUp(env, k);
  k.stop();
  env.advance(8000);
  check(flexLast(env) === 1 && homeOnly(env), 'nach Kodis Ende LAST');
});

// ---------- S4: App aus Alle Apps (Startweg 3) ----------
(function () {
  console.log('--- S4a: YouTube aus Alle Apps, beforeDestroy setzt stopping (Normalfall)');
  const env = boot();
  const m = appUnderHome(env, 'youtube', { method: 3 });
  press(env, 13);
  env.advance(3000);
  check(homeOnly(env) && env.files.has('flexkodi/start') && !liveTv(env, m) && pops(env, m) === 1, 'Launcher navigiert nicht, Kodi startet');
})();
(function () {
  console.log('--- S4b: ... ohne stopping: der Launcher öffnet Alle Apps (AppControl.js:986) -> Abbruch');
  const env = boot();
  env.apm.stopping = false;
  const m = appUnderHome(env, 'youtube', { method: 3 });
  press(env, 13);
  env.advance(3000);
  check(env.UI.getCurrentSubModuleId() === 'AllApps' && !env.files.has('flexkodi/start'), 'Alle Apps vorne, kein Kodi: ' + env.stack.str());
  check(toast(env) === 'Kodi-Start abgebrochen: bitte Kodi noch einmal wählen' && hasLog(env, /App beenden: AppControl weg, Zustand started/), 'Hinweis: ' + toast(env));
  env.advance(5000);
  check(flexLast(env) === 1 && !liveTv(env, m), 'DMP wieder verlassen (LAST), nie Live-TV');
  env.UI.popSubModule();         // ZURÜCK in Alle Apps
  env.advance(1100);
  focus(env, 0);
  press(env, 13);
  env.advance(3000);             // YouTube ist jetzt pausiert: normale Freigabe (zweiter DMP-Befehl), kein Stapel-Aufruf von uns
  check(env.files.has('flexkodi/start') && pops(env, m) === 2 && commits(env, 'DMP') === 2,
    'zweiter Druck: Kodi startet (2. popAllModule kam vom Launcher, AppControl.js:986)');
})();

// ---------- S5: Taste während des Ablaufs ----------
(function () {
  console.log('--- S5: Rechts 300 ms nach OK: Abbruch, Startseite bleibt, kein Kodi, DMP erst nach dem AppStatus verlassen');
  const env = boot();
  const m = appUnderHome(env, 'youtube');
  press(env, 13);
  env.advance(300);
  press(env, 39);
  env.advance(400);
  check(!env.files.has('flexkodi/start') && toast(env) === 'Kodi-Start abgebrochen', 'kein Kodi, Hinweis: ' + toast(env));
  check(hasLog(env, /App beenden: warte auf das AppStatus, dann DMP verlassen/) && closing(env) && closing(env).kodi === false, 'wartet passiv auf das AppStatus');
  env.advance(6000);
  check(homeOnly(env) && !liveTv(env, m) && pops(env, m) === 1, 'Startseite vorne, nie Live-TV, kein zweites popAllModule');
  check(flexLast(env) === 1 && hasLog(env, /DMP verlassen \(Kodi-Start abgebrochen\)/) && closing(env) === null, 'DMP nach Ruhe wieder verlassen (LAST)');
  // Bildschirmschoner läuft wie immer an (YouTube pausiert: nur Hintergrund, E1 streng)
  env.advance(62000);
  check(hasLog(env, /Bildschirmschoner: Oberfläche aus/), 'Bildschirmschoner startet');
})();
// Befund 4: OK auf Kodi während des passiven Wartens (nach dem Abbruch, vor dem AppStatus)
function passiveWait(env) {
  press(env, 13);
  env.advance(300);
  press(env, 39);                // Abbruch 'Taste' im Takt bei 500 ms
  env.advance(250);
  press(env, 37);                // zurück auf die Kodi-Kachel
  env.advance(100);
}
(function () {
  console.log('--- S5b: Rechts, Links, OK während des passiven Wartens: Ablauf wieder als Kodi-Start, Kodi startet');
  const env = boot();
  const m = appUnderHome(env, 'youtube');
  passiveWait(env);
  check(closing(env) && closing(env).kodi === false && !hasLog(env, /App beenden: AppStatus verarbeitet/), 'passives Warten nach dem Abbruch, AppStatus fehlt noch');
  press(env, 13);
  check(hasLog(env, /Kodi: erneut gewählt, YouTube wird weiter beendet/) && closing(env).kodi === true &&
    toast(env) === 'YouTube wird beendet, Kodi startet …', 'erneut gewählt, Hinweis: ' + toast(env));
  env.advance(3000);
  check(env.files.has('flexkodi/start') && flexLast(env) === 0 && pops(env, m) === 1 && commits(env, 'DMP') === 1 &&
    homeOnly(env) && !liveTv(env, m), 'Kodi angefordert, kein LAST, ein popAllModule, ein DMP-Befehl, nie Live-TV');
  check(ownCallsOnly(env, m) && closing(env) === null && hasLog(env, /Kodi: Start angefordert \(YouTube freigegeben\)/), 'nur eigene Aufrufe des Launchers, Freigabe wie S1');
})();
(function () {
  console.log('--- S5c: ... und danach noch eine Taste: wieder Abbruch, DMP nach dem AppStatus verlassen');
  const env = boot();
  const m = appUnderHome(env, 'youtube');
  passiveWait(env);
  press(env, 13);
  env.advance(100);
  press(env, 40);
  env.advance(6000);
  check(!env.files.has('flexkodi/start') && flexLast(env) === 1 && homeOnly(env) && !liveTv(env, m) && closing(env) === null,
    'kein Kodi, LAST, Startseite vorne');
  check(hasLog(env, /App beenden abgebrochen: YouTube \(Taste\), DMP wird verlassen/), 'Log: abgebrochen (Taste), DMP wird verlassen');
})();
(function () {
  console.log('--- S5d: OK während des passiven Wartens, aber Sonderzustand des Launchers: Hinweis, kein Kodi');
  const env = boot();
  const m = appUnderHome(env, 'youtube');
  passiveWait(env);
  env.store.state.AppControl.restartFlag = true;
  press(env, 13);
  check(toast(env) === 'Kodi-Start abgebrochen – bitte gleich noch einmal wählen' && closing(env).kodi === false &&
    hasLog(env, /Kodi: YouTube wird noch beendet, kein erneuter Start \(Sonderzustand des Launchers\)/), 'Hinweis: ' + toast(env));
  env.advance(6000);
  check(!env.files.has('flexkodi/start') && flexLast(env) === 1 && pops(env, m) === 1 && closing(env) === null, 'kein Kodi, DMP nach dem AppStatus verlassen');
})();

// ---------- S6: Systemdialog während des Ablaufs ----------
(function () {
  console.log('--- S6: Dialog 500 ms nach OK');
  const env = boot();
  const m = appUnderHome(env, 'youtube');
  press(env, 13);
  env.advance(500);
  env.UI.dialog = true;
  env.advance(3000);
  check(!env.files.has('flexkodi/start') && flexLast(env) === 0 && !liveTv(env, m), 'kein Kodi, kein LAST (Quelle gehört dem Dialog), nie Live-TV');
  check(hasLog(env, /DMP bleibt \(Kodi-Start abgebrochen: Systemdialog\)/) && homeOnly(env), 'DMP bleibt, Startseite im Stapel: ' + env.stack.str());
})();

// ---------- S7: App-Modul (hiMedia, DLNA) bzw. startende App / DIAL / Dialog: weiter abgelehnt ----------
[['hiMedia/deviceBrowser', 'LauncherHis/LauncherHis'], ['DLNA/DLNA', 'LauncherHis/LauncherHis'],
  ['hiMedia/deviceBrowser', 'AppControl/AppControl', 'LauncherHis/LauncherHis']].forEach(function (spec) {
  console.log('--- S7: ' + spec.join(' > '));
  const env = boot();
  if (spec.length === 3) env.appStart('youtube');
  env.stack.set(spec);
  env.src.name = 'dmp';
  env.advance(1100);
  focus(env, 0);
  const m = { calls: env.calls.length, commits: env.commits.length };
  press(env, 13);
  env.advance(3000);
  check(stackCalls(env, m).length === 0 && commits(env, 'DMP') === 0 && !env.files.has('flexkodi/start'), 'nichts angefasst, kein Kodi');
  check(hasLog(env, /Kodi: App im Hintergrund, kein Start/) && toast(env) === 'Bitte zuerst die App mit Zurück/Exit beenden', 'abgelehnt wie bisher');
  if (spec.length === 3) check(hasLog(env, /App unter der Startseite nicht beendbar \(App-Modul hiMedia\)/), 'Grund im Log: App-Modul hiMedia');
});
// nur 'started' wird beendet: bei 'stopped'/'stopping' setzte beforeDestroy kein 'stopping' und der
// Launcher navigierte nach dem Startweg (Alle Apps, Live-TV, AppControl.js:1084)
[['starting', function (env) { env.store.state.AppControl.currentAMState = 'starting'; }, /App im Zustand starting/],
  ['stopped', function (env) { env.store.state.AppControl.currentAMState = 'stopped'; }, /App im Zustand stopped/],
  ['stopping', function (env) { env.store.state.AppControl.currentAMState = 'stopping'; }, /App im Zustand stopping/],
  ['DIAL (stopMethod 10)', function (env) { env.store.state.AppControl.stopMethod = 10; }, /\(DIAL\)/],
  ['stopAppCallBackFun', function (env) { env.store.state.AppControl.stopAppCallBackFun = 1; }, /Sonderzustand des Launchers/],
  ['restartFlag', function (env) { env.store.state.AppControl.restartFlag = true; }, /Sonderzustand des Launchers/],
  ['browserFlag', function (env) { env.store.state.AppControl.browserFlag = true; }, /Sonderzustand des Launchers/],
  ['settingRestoreStartFlag', function (env) { env.store.state.AppControl.settingRestoreStartFlag = true; }, /Sonderzustand des Launchers/],
  ['messageProcessBySTR false', function (env) { env.store.state.AppControl.messageProcessBySTR = false; }, /Sonderzustand des Launchers/],
  ['DMP gehört anderen (z. B. DLNA umgeschaltet)', function (env) { env.src.name = 'dmp'; }, /\(DMP gehört anderen\)/],
  ['Systemdialog', function (env) { env.UI.dialog = true; }, /\(Startseite nicht frei\)/]].forEach(function (v) {
  console.log('--- S7b: AppControl unter der Startseite, aber ' + v[0]);
  const env = boot();
  const m = appUnderHome(env, 'youtube');
  v[1](env);
  press(env, 13);
  env.advance(3000);
  check(stackCalls(env, m).length === 0 && commits(env, 'DMP') === 0 && !env.files.has('flexkodi/start'), 'nichts angefasst, kein Kodi');
  check(hasLog(env, v[2]) && hasLog(env, /Kodi: App im Hintergrund, kein Start/), 'abgelehnt, Grund im Log');
});
(function () {
  // kodiPending ist sonst kaum erreichbar (der 1-s-Takt beendet ein angefordertes Kodi, sobald ein
  // Modul nach vorne kommt): App-Start und HOME im selben Takt wie das OK
  console.log('--- S7c: Kodi angefordert, noch ohne Lebenszeichen (kodiPending), App unter der Startseite: abgelehnt (beschäftigt)');
  const env = boot();
  focus(env, 0);
  press(env, 13);                // ohne App: Kodi sofort angefordert
  check(env.files.has('flexkodi/start'), 'Kodi angefordert');
  env.advance(10500);            // 10-s-Sperre vorbei, kodiPending (bis 25 s) noch wahr
  env.appStart('youtube');
  env.homeFromApp();
  focus(env, 0);
  const m = { calls: env.calls.length, commits: env.commits.length };
  press(env, 13);
  check(hasLog(env, /App unter der Startseite nicht beendbar \(beschäftigt\)/) && hasLog(env, /Kodi: App im Hintergrund, kein Start/), 'abgelehnt, Grund im Log: beschäftigt');
  check(stackCalls(env, m).length === 0 && commits(env, 'DMP') === 0 && closing(env) === null, 'nichts angefasst');
})();

// ---------- S8: nichts unter der Startseite: unverändert ----------
(function () {
  console.log('--- S8: keine App: Kodi sofort, kein Stapel-Aufruf, kein DMP');
  const env = boot();
  focus(env, 0);
  const m = { calls: env.calls.length, commits: env.commits.length };
  press(env, 13);
  check(env.files.has('flexkodi/start') && commits(env, 'DMP') === 0 && stackCalls(env, m).length === 0, 'sofort Startanforderung');
  check(toast(env) === 'Kodi startet …', 'Hinweis unverändert: ' + toast(env));
})();

// ---------- S9: Hot-Reload mitten im Ablauf ----------
(function () {
  console.log('--- S9: Hot-Reload 300 ms nach OK');
  const env = boot();
  const m = appUnderHome(env, 'youtube');
  press(env, 13);
  env.advance(300);
  env.load(FLEX);
  env.advance(6000);
  check(hasLog(env, /App beenden abgebrochen \(Hot-Reload\)/) && !env.files.has('flexkodi/start') && pops(env, m) === 1, 'alte Instanz startet nichts, kein zweites popAllModule');
  check(homeOnly(env) && !liveTv(env, m) && env.store.state.AppControl.currentAMState === 'stopped' && closing(env) === null, 'Startseite vorne, App beendet, neue Instanz setzt nichts fort');
  press(env, 13, { hot: true });
  env.advance(3000);
  check(env.files.has('flexkodi/start') && pops(env, m) === 1, 'nächster Druck: Kodi startet');
})();

// ---------- S10: APM meldet nie (App bleibt 'stopping') ----------
(function () {
  console.log('--- S10: kein AppStatus nach dem Beenden');
  const env = boot();
  env.apm.status = 'none';
  const m = appUnderHome(env, 'youtube');
  press(env, 13);
  env.advance(15000);
  check(!env.files.has('flexkodi/start') && toast(env) === 'Kodi-Start abgebrochen: YouTube meldet ihr Ende nicht', 'Zeitlimit: kein Kodi, Hinweis: ' + toast(env));
  check(homeOnly(env) && !liveTv(env, m) && flexLast(env) === 0 && closing(env) === null, 'Startseite vorne, nie Live-TV, kein LAST neben einer App im Beenden');
})();
(function () {
  console.log('--- S10b: Taste und kein AppStatus: passives Warten endet ohne LAST');
  const env = boot();
  env.apm.status = 'none';
  const m = appUnderHome(env, 'youtube');
  press(env, 13);
  env.advance(300);
  press(env, 39);
  env.advance(15000);
  check(!env.files.has('flexkodi/start') && flexLast(env) === 0 && closing(env) === null && !liveTv(env, m), 'kein Kodi, kein LAST, nichts läuft mehr');
  check(hasLog(env, /App beenden abgebrochen: YouTube \(Taste, App meldet ihr Ende nicht\)/), 'Log: Taste, App meldet ihr Ende nicht');
  focus(env, 0);
  press(env, 13);
  check(toast(env) === 'YouTube hat ihr Ende nicht gemeldet: Kodi geht erst nach dem nächsten App-Start' &&
    hasLog(env, /Kodi: App-Ende nie gemeldet \(stopping ohne AppControl\)/), 'nächstes OK: passender Hinweis: ' + toast(env));
})();
// Befund 2: nach "meldet ihr Ende nicht" bleibt 'stopping' ohne AppControl; "Zurück/Exit beenden" hülfe nicht
['youtube', 'netflix'].forEach(function (name) {
  const label = name === 'youtube' ? 'YouTube' : 'Netflix';
  console.log('--- S10c: ' + label + ' meldet nie, danach noch einmal OK: passender Hinweis, nichts angefasst');
  const env = boot();
  env.apm.status = 'none';
  const m = appUnderHome(env, name);
  press(env, 13);
  env.advance(15000);
  check(env.store.state.AppControl.currentAMState === 'stopping' && homeOnly(env), 'stopping ohne AppControl bleibt stehen');
  const m2 = { calls: env.calls.length, commits: env.commits.length };
  press(env, 13);
  env.advance(1000);
  check(toast(env) === label + ' hat ihr Ende nicht gemeldet: Kodi geht erst nach dem nächsten App-Start', 'Hinweis: ' + toast(env));
  check(hasLog(env, /Kodi: App unter der Startseite nicht beendbar \(kein AppControl\)/) &&
    hasLog(env, /Kodi: App-Ende nie gemeldet \(stopping ohne AppControl\)/), 'Log: Grund (kein AppControl), App-Ende nie gemeldet');
  check(stackCalls(env, m2).length === 0 && env.commits.length === m2.commits && acCommits(env, m).length === 0 &&
    !env.files.has('flexkodi/start'), 'nichts angefasst (keine AppControl-Mutation, Schutzregel 7), kein Kodi');
  // der nächste App-Start löst den Zustand im Launcher: der Merker verfällt
  env.appStart(name);
  env.advance(1100);
  check(hasLog(env, /App beenden: Zustand stopping erledigt/), 'App-Start: Merker verfällt');
});

// ---------- S11: Launcher baut die Startseite neu auf (ohne stopping, Startweg 1, AppControl.js:1036) ----------
(function () {
  console.log('--- S11: ohne stopping: popAllModule() + openLauncher(), neue MainTiles-Instanz, zweites OK');
  const env = boot();
  env.apm.stopping = false;
  env.rebuildHome = true;
  const m = appUnderHome(env, 'youtube');
  press(env, 13);
  env.advance(1350);             // AppStatus nach 1 s -> Neuaufbau, DOM nach 300 ms zurück
  check(since(env, m).some(c => c[0] === 'rebuildHome') && !env.vm.__flexInst, 'Startseite neu aufgebaut, neue MainTiles-Instanz noch ohne Hülle');
  const r = press(env, 13);      // zweites OK gleich nach dem Neuaufbau
  check(r.keydown === 'tiles' && !since(env, m).some(c => c[0] === 'ORIG MainTiles ENTER'), 'zweites OK: von der Hülle verbraucht, nie der originale Startpfad');
  env.advance(3000);
  check(env.files.has('flexkodi/start') && homeOnly(env) && !liveTv(env, m) && !hasLog(env, /Start abgebrochen/), 'Kodi startet trotz Neuaufbau');
  check(pops(env, m) === 2 && env.lstate.openFromNetflix === false, 'zweites popAllModule kam vom Launcher (openLauncher)');
})();
(function () {
  console.log('--- S11b: OK gehalten, während MainTiles beim Neuaufbau fehlt: zählt als eigene Taste, Kodi startet');
  const env = boot();
  env.apm.stopping = false;
  env.rebuildHome = true;
  const m = appUnderHome(env, 'youtube');
  press(env, 13);
  env.advance(1100);             // AppStatus nach 1 s -> Neuaufbau, DOM erst nach 300 ms zurück
  check(!env.launcherDom, 'MainTiles fehlt gerade');
  press(env, 13, { repeat: true });
  env.advance(3000);
  check(env.files.has('flexkodi/start') && !hasLog(env, /Start abgebrochen/) && homeOnly(env) && !liveTv(env, m), 'kein Abbruch (Taste), Kodi startet');
})();

// ---------- S12: Kachel-Menü und EXIT/STR während des Ablaufs ----------
(function () {
  console.log('--- S12: Einstellungstaste auf YouTube, solange es unter der Startseite liegt: wie bisher');
  const env = boot();
  const m = appUnderHome(env, 'youtube');
  focus(env, 6);
  const r = press(env, 567);
  check(r.keydown === 'dispatcher' && toast(env) === 'YouTube läuft noch: Exit beendet die App' && stackCalls(env, m).length === 0, 'kein Menü, Hinweis, Taste an den Launcher');
  focus(env, 0);
  press(env, 13);
  env.advance(3000);
  check(env.files.has('flexkodi/start'), 'danach startet die Kodi-Kachel Kodi');
})();
(function () {
  console.log('--- S12b: EXIT 500 ms nach OK: Live-TV des Launchers, kein Kodi, flex.js schaltet nichts');
  const env = boot();
  const m = appUnderHome(env, 'youtube');
  press(env, 13);
  env.advance(500);
  press(env, 27);
  env.advance(3000);
  check(env.stack.str() === 'LiveTV(LiveTV)' && !env.files.has('flexkodi/start') && flexLast(env) === 0, 'Live-TV (EXIT des Nutzers), kein Kodi, kein LAST von flex.js');
  check(hasLog(env, /DMP bleibt \(Kodi-Start abgebrochen: Modulwechsel\)/) && closing(env) === null && acCommits(env, m).every(c => c[1] === 0),
    'DMP bleibt, nichts läuft mehr; AppControl-Commit nur vom EXIT des Launchers (0)');
})();
(function () {
  console.log('--- S12c: STR_SUSPENDING 500 ms nach OK');
  const env = boot();
  const m = appUnderHome(env, 'youtube');
  press(env, 13);
  env.advance(500);
  env.UI.isReady = false;
  env.subs.STR_SUSPENDING();
  env.advance(3000);
  check(hasLog(env, /App beenden abgebrochen \(STR_SUSPENDING\)/) && !env.files.has('flexkodi/start') && flexLast(env) === 0 && closing(env) === null,
    'abgebrochen ohne Folgen, kein Kodi, kein LAST');
  check(env.ctx.__flex.ownsDmp() === false && pops(env, m) === 1, 'DMP gehört dem Launcher');
})();

// ---------- S13: openFromNetflix nach einem Abbruch (Befund 0) ----------
(function () {
  console.log('--- S13a: Netflix, Rechts 300 ms nach OK: Abbruch, openFromNetflix trotzdem gelöscht, ZURÜCK startet Netflix nicht');
  const env = boot();
  const m = appUnderHome(env, 'netflix');
  press(env, 13);
  env.advance(300);
  press(env, 39);
  env.advance(8000);
  check(!env.files.has('flexkodi/start') && env.lstate.openFromNetflix === false &&
    hasLog(env, /App beenden: openFromNetflix gelöscht \(Netflix beendet, wie openLauncher\)/), 'kein Kodi, openFromNetflix beim AppStatus gelöscht');
  check(homeOnly(env) && flexLast(env) === 1 && pops(env, m) === 1 && ownCallsOnly(env, m) && closing(env) === null,
    'Startseite vorne, DMP verlassen (LAST), nur eigene Aufrufe des Launchers');
  const m2 = { calls: env.calls.length, commits: env.commits.length };
  press(env, 8);
  env.advance(1000);
  check(!since(env, m2).some(c => c[0] === 'startThirdPartyApp') && !env.UI.isModuleExist('AppControl'), 'ZURÜCK auf der Startseite startet Netflix nicht');
})();
(function () {
  console.log('--- S13b: ... dann noch einmal OK: Kodi (Freigabe wie v9), nach Kodis Ende bleibt openFromNetflix gelöscht');
  const env = boot();
  const m = appUnderHome(env, 'netflix');
  press(env, 13);
  env.advance(300);
  press(env, 39);
  env.advance(8000);
  focus(env, 0);
  press(env, 13);
  env.advance(3000);
  check(env.files.has('flexkodi/start') && hasLog(env, /Hintergrund-Apps freigegeben: Netflix pausiert/) && env.lstate.openFromNetflix === false,
    'zweites OK: Freigabe, Kodi angefordert, openFromNetflix gelöscht');
  const k = kodiSim(env);
  kodiUp(env, k);
  k.stop();
  env.advance(8000);
  check(homeOnly(env) && !liveTv(env, m) && env.lstate.openFromNetflix === false && pops(env, m) === 1, 'nach Kodis Ende: Startseite vorne, openFromNetflix gelöscht');
  const m2 = { calls: env.calls.length, commits: env.commits.length };
  press(env, 8);
  env.advance(1000);
  check(!since(env, m2).some(c => c[0] === 'startThirdPartyApp'), 'ZURÜCK auf der Startseite startet Netflix nicht');
})();
(function () {
  console.log('--- S13c: ZURÜCK 300 ms nach OK: der Launcher öffnet Netflix wieder (openFromNetflix), flex.js löscht nichts');
  const env = boot();
  env.apm.statusMs = 3000;
  const m = appUnderHome(env, 'netflix');
  press(env, 13);
  env.advance(300);
  press(env, 8);
  env.advance(500);
  check(since(env, m).some(c => c[0] === 'startThirdPartyApp') && hasLog(env, /App beenden abgebrochen: Netflix \(App gestartet\)/) && closing(env) === null,
    'Netflix wieder geöffnet (Launcher), Ablauf abgebrochen (App gestartet)');
  check(!since(env, m).some(c => c[0] === 'commit' && c[1] === 'LauncherHis/setOpenFromNetflix') && !hasLog(env, /openFromNetflix gelöscht/) &&
    !env.files.has('flexkodi/start') && flexLast(env) === 0, 'openFromNetflix nicht angefasst, kein Kodi, kein LAST');
})();

// ---------- S14: späte Apps (Befund 1/3): UH_MAX_MS für AppStatus und DMP, danach noch BG_SETTLE_MS Ruhe ----------
[['amazon', 7300, 'Prime Video'], ['netflix', 7500, 'Netflix']].forEach(function (a) {
  console.log('--- S14a: ' + a[2] + ' meldet ihr Ende erst nach ' + a[1] + ' ms: Kodi startet trotzdem');
  const env = boot();
  env.apm.statusMs = a[1];
  const m = appUnderHome(env, a[0]);
  press(env, 13);
  env.advance(8000);
  check(!env.files.has('flexkodi/start') && !hasLog(env, /Start abgebrochen/) && closing(env) && closing(env).kodi === true,
    'bei 8 s: AppStatus da, Ruhezeit läuft noch, kein Abbruch');
  env.advance(2000);
  check(env.files.has('flexkodi/start') && !hasLog(env, /Start abgebrochen/) && flexLast(env) === 0 && homeOnly(env) && !liveTv(env, m),
    'Kodi angefordert, kein LAST, nie Live-TV');
  if (a[0] === 'netflix') check(env.lstate.openFromNetflix === false, 'openFromNetflix gelöscht');
});
(function () {
  console.log('--- S14b: Netflix meldet ihr Ende erst nach 8,3 s: Abbruch "meldet ihr Ende nicht", DMP bleibt');
  const env = boot();
  env.apm.statusMs = 8300;
  const m = appUnderHome(env, 'netflix');
  press(env, 13);
  env.advance(8100);
  check(!env.files.has('flexkodi/start') && toast(env) === 'Kodi-Start abgebrochen: Netflix meldet ihr Ende nicht', 'Zeitlimit: kein Kodi, Hinweis: ' + toast(env));
  check(hasLog(env, /DMP bleibt \(Kodi-Start abgebrochen: App meldet ihr Ende nicht\)/) && closing(env) === null, 'DMP bleibt, nichts läuft mehr');
  env.advance(3000);
  check(flexLast(env) === 0 && homeOnly(env) && !liveTv(env, m) && env.store.state.AppControl.currentAMState === 'stopped',
    'spätes AppStatus: kein LAST, nie Live-TV');
  check(hasLog(env, /App beenden: Zustand stopping erledigt/), 'Merker "Ende nicht gemeldet" verfällt mit dem späten AppStatus');
  // bekannte, im Kopf von "App unter der Startseite beenden" dokumentierte Lücke
  check(env.lstate.openFromNetflix === true && !hasLog(env, /openFromNetflix gelöscht/), 'dokumentierte Lücke: openFromNetflix bleibt stehen');
})();

// ---------- S15: Abbrüche und Bedingungen ohne bisherigen Test (Befund 6) ----------
(function () {
  console.log('--- S15a: Taste, dann App-Start während des passiven Wartens: DMP bleibt (gehört der App), kein LAST');
  const env = boot();
  env.apm.statusMs = 3000;
  const m = appUnderHome(env, 'youtube');
  press(env, 13);
  env.advance(300);
  press(env, 39);
  env.advance(500);
  env.appStart('netflix');
  env.advance(1000);
  check(hasLog(env, /App beenden abgebrochen: YouTube \(Taste, dann App gestartet\)/) &&
    hasLog(env, /DMP bleibt \(Kodi-Start abgebrochen: Taste, dann App gestartet\)/) && closing(env) === null, 'Abbruch: Taste, dann App gestartet; DMP bleibt');
  env.advance(8000);
  check(flexLast(env) === 0 && !env.files.has('flexkodi/start') && !liveTv(env, m), 'kein LAST, kein Kodi');
})();
(function () {
  console.log('--- S15b: DMP kommt erst nach 12 s: Abbruch "DMP nicht bestätigt", LAST erst, wenn DMP steht');
  const env = boot({ dmpMs: 12000 });
  const m = appUnderHome(env, 'youtube');
  press(env, 13);
  env.advance(8100);
  check(hasLog(env, /Kodi: Start abgebrochen \(DMP nicht bestätigt\)/) && toast(env) === 'Kodi-Start abgebrochen' &&
    hasLog(env, /App beenden abgebrochen: YouTube \(DMP nicht bestätigt\), DMP wird verlassen/), 'Abbruch nach UH_MAX_MS, DMP-Ausstieg geplant');
  env.advance(3000);
  check(flexLast(env) === 0 && !env.files.has('flexkodi/start'), 'bei 11 s: noch kein LAST (DMP nicht aktiv)');
  env.advance(4000);
  check(flexLast(env) === 1 && hasLog(env, /DMP verlassen \(Kodi-Start abgebrochen\)/) && homeOnly(env) && !liveTv(env, m), 'LAST genau einmal, sobald DMP steht');
})();
(function () {
  console.log('--- S15c: Startseite nach AppStatus und DMP nicht frei: Abbruch erst nach UH_MAX_MS + Ruhezeit, DMP verlassen');
  const env = boot();
  const m = appUnderHome(env, 'youtube');
  press(env, 13);
  env.advance(1500);
  check(hasLog(env, /App beenden: AppStatus verarbeitet/) && hasLog(env, /App beenden: DMP aktiv/), 'AppStatus und DMP da');
  env.launcherDom = false;       // .launcher fehlt: homeIdle() false, Modul-Stapel unverändert
  env.advance(7000);             // 8,5 s
  check(!hasLog(env, /Start abgebrochen/) && closing(env) && closing(env).kodi === true, 'bei 8,5 s noch kein Abbruch');
  env.advance(600);              // 9,1 s
  check(hasLog(env, /Kodi: Start abgebrochen \(Startseite nicht frei\)/) && !env.files.has('flexkodi/start') &&
    hasLog(env, /App beenden abgebrochen: YouTube \(Startseite nicht frei\), DMP wird verlassen/), 'Abbruch "Startseite nicht frei", kein Kodi');
  env.launcherDom = true;
  env.advance(5000);
  check(flexLast(env) === 1 && homeOnly(env) && !liveTv(env, m), 'DMP verlassen (LAST), nie Live-TV');
})();
// Ruhezeit: Zeitpunkte der Logzeilen und der Startanforderung auf der virtuellen Uhr
[[{}, 1000], [{}, 2600], [{ dmpMs: 3100 }, 1000]].forEach(function (v) {
  console.log('--- S15f: Ruhezeit (AppStatus nach ' + v[1] + ' ms, DMP nach ' + (v[0].dmpMs || 900) + ' ms): Kodi erst BG_SETTLE_MS nach dem letzten');
  const env = boot(v[0]);
  env.apm.statusMs = v[1];
  appUnderHome(env, 'youtube');
  const tlog = [];
  let startAt = 0;
  const push0 = env.logs.push, set0 = env.files.set;
  env.logs.push = function (l) { tlog.push([env.now, l]); return push0.call(this, l); };
  env.files.set = function (k, val) { if (k === 'flexkodi/start' && !startAt) startAt = env.now; return set0.call(this, k, val); };
  const at = re => { const e = tlog.find(x => re.test(x[1])); return e ? e[0] : 0; };
  press(env, 13);
  env.advance(6000);
  const ac = at(/App beenden: AppStatus verarbeitet/), dmp = at(/App beenden: DMP aktiv/), last = Math.max(ac, dmp);
  check(ac > 0 && dmp > 0 && startAt > 0, 'AppStatus, DMP und Startanforderung kamen');
  check(startAt - last >= 1000 && startAt - last <= 1250, 'Startanforderung ' + (startAt - last) + ' ms nach dem letzten von beiden (1000-1250)');
});
(function () {
  console.log('--- S15h: popAllModule wirkt nicht: kein DMP, Hinweis wie bis v9');
  const env = boot();
  appUnderHome(env, 'youtube');
  env.UI.popAllModule = function (o) { env.calls.push(['popAllModule', o]); };
  press(env, 13);
  env.advance(3000);
  check(hasLog(env, /Kodi: AppControl nicht entfernt, kein Start/) && toast(env) === 'Bitte zuerst die App mit Zurück/Exit beenden', 'abgelehnt: ' + toast(env));
  check(commits(env, 'DMP') === 0 && !env.files.has('flexkodi/start') && closing(env) === null && env.store.state.AppControl.currentAMState === 'started',
    'kein DMP, kein Kodi, App läuft weiter');
})();
(function () {
  console.log('--- S15j: beforeDestroy sofort (apm.destroySync): Ablauf wie S1');
  const env = boot();
  env.apm.destroySync = true;
  const m = appUnderHome(env, 'youtube');
  press(env, 13);
  const seq = since(env, m).filter(c => c[0] === 'popAllModule' || c[0] === 'AppControl.beforeDestroy' || (c[0] === 'commit' && c[1] === 'Source/setCurrentSource'));
  check(JSON.stringify(seq) === JSON.stringify([['popAllModule', 'app'], ['AppControl.beforeDestroy', 'started'], ['commit', 'Source/setCurrentSource', 'DMP']]),
    'beforeDestroy schon in popAllModule, dann DMP: ' + JSON.stringify(seq));
  env.advance(3000);
  check(hasLog(env, /App beenden: AppControl weg \(stopping\)/) && env.files.has('flexkodi/start') && homeOnly(env) && !liveTv(env, m) &&
    pops(env, m) === 1 && ownCallsOnly(env, m), 'Kodi startet, nie Live-TV, nur eigene Aufrufe des Launchers');
})();

(function () {
  console.log('--- S15k: Kodi läuft schon (von Hand gestartet), während die App beendet wird: uhDone prüft neu');
  const env = boot();
  appUnderHome(env, 'youtube');
  press(env, 13);
  env.advance(1300);
  check(hasLog(env, /App beenden: AppStatus verarbeitet/) && hasLog(env, /App beenden: DMP aktiv/), 'AppStatus und DMP da, Ruhezeit läuft');
  const beat = () => env.files.set('flexkodi/running', Math.floor(env.ctx.Date.now() / 1000) + ' 0 1');
  beat();
  env.advance(1500);
  check(hasLog(env, /Kodi: Startseite nach dem Beenden nicht frei, kein Start \(Kodi\)/) && !env.files.has('flexkodi/start'),
    'keine zweite Startanforderung unter laufendem Kodi');
  check(toast(env) === 'Kodi kann gerade nicht starten' && closing(env) === null, 'Hinweis, Ablauf beendet: ' + toast(env));
  for (let i = 0; i < 6; i++) { beat(); env.advance(1000); }
  check(flexLast(env) === 0 && !env.files.has('flexkodi/start'), 'kein LAST unter laufendem Kodi, weiter keine Startanforderung');
})();

console.log(fails ? fails + ' Prüfung(en) fehlgeschlagen' : 'alle Prüfungen bestanden');
process.exit(fails ? 1 : 0);
