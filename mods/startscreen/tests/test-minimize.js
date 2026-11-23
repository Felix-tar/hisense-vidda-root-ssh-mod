// 18.11.2026: Home in Kodi minimiert Kodi (Besitzer: "dass Kodi minimiert wird und ich dann andere Apps starten kann,
// die dann Kodi beenden"). Kodi blendet sich aus und gibt die Fernbedienung frei; kodi-run.sh meldet das als 4. Feld im
// Lebenszeichen flexkodi/running. Geprüft: kein "Kodi wird beendet …" durch Tasten beim Launcher, die Kodi-Kachel holt
// Kodi zurück (Start-Anforderung, kodi.sh legt dann "restore" an), eine App beendet Kodi, nach 10 min minimiert beendet
// flex.js es, nicht minimiert zählt eine Taste weiter als "Kodi beendet sich". Kopf (Attrappe, Tasten) aus test6.js.
// Aufruf: node mods/startscreen/tests/test-minimize.js [pfad/zu/flex.js]
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


// sichtbarer Hinweis (kodiToast versteckt per className, der Text bleibt stehen)
function shown(env) {
  const els = env.ctx.document.body.childNodes.filter(c => c.id === 'flex-kodi-toast');
  const el = els[els.length - 1];
  return el && el.className === 'show' ? el.textContent : '';
}

function minSim(env) {
  const k = kodiSim(env);
  k.min = 0;
  k.beat = function () { env.files.set('flexkodi/running', Math.floor(env.ctx.Date.now() / 1000) + ' 0 ' + k.ready + ' ' + k.min); };
  return k;
}

// getElementById der Attrappe liefert immer null: hier das zuletzt angelegte Element, damit kodiToast('', 0) den
// Hinweis wirklich ausblendet
function bootM() {
  const env = boot();
  const body = env.ctx.document.body;
  env.ctx.document.getElementById = function (id) { const els = body.childNodes.filter(c => c.id === id); return els[els.length - 1] || null; };
  return env;
}

function kodiFromTile(env) {
  focus(env, 0);
  press(env, 13);
  env.advance(500);
  const k = minSim(env);
  kodiUp(env, k);
  env.advance(2000);
  env.files.delete('flexkodi/start');
  return k;
}

(function () {
  console.log('--- M1: Home -> minimiert, Tasten beim Launcher ohne "Kodi wird beendet"');
  const env = bootM();
  const k = kodiFromTile(env);
  check(hasLog(env, /Kodi läuft/) && shown(env) === '', 'Kodi läuft, kein Hinweis: ' + shown(env));
  k.min = 1; k.beat();
  env.advance(2100);
  check(hasLog(env, /Kodi: minimiert \(Home\)/), 'minimiert erkannt');
  press(env, 39); press(env, 37); env.advance(3000);
  check(shown(env) === '' && !hasLog(env, /Kodi: beendet sich/), 'kein Beenden-Hinweis: ' + shown(env));
  check(!env.files.has('flexkodi/stop'), 'Kodi nicht beendet');

  console.log('--- M2: Kodi-Kachel holt Kodi zurück');
  focus(env, 0);
  press(env, 13);
  env.advance(500);
  check(env.files.has('flexkodi/start') && hasLog(env, /Kodi: zurückholen/), 'Start-Anforderung als Zurückholen');
  check(shown(env) !== 'Kodi läuft schon', 'kein "Kodi läuft schon"');
  k.min = 0; k.beat();
  env.advance(2100);
  check(hasLog(env, /Kodi: wieder vorne/), 'wieder vorne erkannt');

  console.log('--- M3: nicht minimiert: Taste beim Launcher = Kodi beendet sich (wie bisher)');
  press(env, 39);
  env.advance(1100);
  check(shown(env) === 'Kodi wird beendet …' && hasLog(env, /Kodi: beendet sich \(Fernbedienung frei\)/), 'Hinweis wie bisher: ' + shown(env));
})();

(function () {
  console.log('--- M4: Taste kurz vor dem ersten Lebenszeichen mit "minimiert": Hinweis verschwindet wieder');
  const env = bootM();
  const k = kodiFromTile(env);
  k.min = 1;                     // Kodi ist minimiert, kodi-run.sh hat es noch nicht gemeldet
  press(env, 39);
  env.advance(1100);
  const early = shown(env);
  k.beat();
  env.advance(1100);
  check(early === 'Kodi wird beendet …' && shown(env) === '', 'kurzer Hinweis, dann weg: ' + early + ' / ' + shown(env));
  check(!env.files.has('flexkodi/stop'), 'Kodi nicht beendet');
})();

(function () {
  console.log('--- M5: minimiert, App startet -> Kodi wird beendet');
  const env = bootM();
  const k = kodiFromTile(env);
  k.min = 1; k.beat();
  env.advance(2100);
  env.appStart('youtube');
  env.advance(1500);
  check(env.files.has('flexkodi/stop') && hasLog(env, /Kodi: beenden \(Modul vorne/), 'Kodi beenden angefordert');
})();

(function () {
  console.log('--- M6: 10 min minimiert -> flex.js beendet Kodi');
  const env = bootM();
  const k = kodiFromTile(env);
  k.min = 1; k.beat();
  env.advance(9 * 60 * 1000);
  check(!env.files.has('flexkodi/stop'), 'nach 9 min noch nicht');
  env.advance(70 * 1000);
  check(env.files.has('flexkodi/stop') && hasLog(env, /Kodi: beenden \(minimiert seit 10 min\)/), 'nach 10 min beendet');
})();

console.log(fails ? fails + ' Prüfung(en) fehlgeschlagen' : 'alle Prüfungen bestanden');
process.exit(fails ? 1 : 0);
