// Mock-Harness für flex.js v7 (kodiPlay): virtuelle Uhr, Dateien, Launcher- und Player-Attrappe.
'use strict';
const vm = require('vm');
const fs = require('fs');
const crypto = require('crypto');

function makeEnv(opts) {
  opts = opts || {};
  const env = { now: 1730140800000, timers: [], tid: 1, files: new Map(), logs: [], calls: [], commits: [] };
  const T = env;
  function setT(fn, ms) { const id = T.tid++; T.timers.push({ id, at: T.now + Math.max(0, ms | 0), fn, iv: 0 }); return id; }
  function setI(fn, ms) { const id = T.tid++; T.timers.push({ id, at: T.now + ms, fn, iv: ms }); return id; }
  function clr(id) { const i = T.timers.findIndex(t => t.id === id); if (i >= 0) T.timers.splice(i, 1); }
  env.advance = function (ms) {
    const end = T.now + ms;
    for (;;) {
      T.timers.sort((a, b) => a.at - b.at || a.id - b.id);
      const t = T.timers[0];
      if (!t || t.at > end) break;
      T.now = t.at;
      if (t.iv) t.at += t.iv; else T.timers.shift();
      t.fn();
      player.step();
    }
    T.now = end;
    player.step();
  };
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(T.now + (env.clockSkew || 0)); }
    static now() { return T.now + (env.clockSkew || 0); }
  }
  const root = '/var/local/applications/UI/';
  const hisense = { file: {
    read(p, w) { const v = env.files.get(p); if (v === undefined) return undefined; return v; },
    write(p, d, w) {
      if (p === 'flexdbg/log.txt') { const l = String(d).split('\n'); env.logs.push(l[l.length - 1]); if (opts.echo) console.log('   LOG', l[l.length - 1]); return 0; }
      env.files.set(p, String(d)); return 0;
    }
  } };
  // Quelle
  const src = { name: opts.src || 'hdmi1', pending: null };
  // Player
  const player = {
    session: 500, url: '', state: 0, speed: 100, caps: 0, flags: 0, pos: 0, total: 6904, q: [], win: null,
    playing: false, lastTick: 0,
    sched(ms, fn) { this.q.push({ at: T.now + ms, fn }); },
    step() {
      const due = this.q.filter(e => e.at <= T.now); this.q = this.q.filter(e => e.at > T.now);
      for (const e of due) e.fn();
      if (this.playing && this.state === 3) {
        const dt = T.now - this.lastTick;
        if (dt >= 1000) { this.pos += Math.floor(dt / 1000) * (this.speed === 100 ? 1 : 1); this.lastTick += Math.floor(dt / 1000) * 1000; }
        if (this.pos >= this.total) { this.pos = this.total; this.flags = 4; this.sched(250, () => { this.state = 6; this.playing = false; }); this.playing = false; }
      } else this.lastTick = T.now;
    }
  };
  const mpctrl = {
    PlayMedia(a) {
      env.calls.push(['PlayMedia', a[0], a[6], a[10]]);
      if (src.name !== 'dmp') return;
      player.session++; player.url = a[0]; player.state = 0; player.caps = 0; player.flags = 0; player.pos = 0; player.playing = false;
      player.q = [];
      const u = a[0];
      player.sched(300, () => { if (player.url === u) player.state = 1; });
      player.sched(opts.prepMs || 2300, () => { if (player.url === u) { player.state = opts.failState || 2; player.caps = opts.seekable === false ? 4 : 5; } });
    },
    MpCtrl(a) {
      env.calls.push(['MpCtrl', JSON.stringify(a)]);
      if (a[0] === 1) player.sched(800, () => { player.state = 3; player.caps |= 2; player.playing = true; player.lastTick = T.now; });
      if (a[0] === 8) player.sched(800, () => { player.state = 3; player.caps |= 2; player.pos = opts.resumeBroken ? 0 : a[2]; player.playing = true; player.lastTick = T.now; });
      if (a[0] === 2) player.sched(200, () => { player.state = 4; player.playing = false; });
      if (a[0] === 3) player.sched(200, () => { player.state = 6; player.playing = false; });
    },
    getMpCtrlStat() { return [player.session, player.url, player.state, player.speed, player.caps, player.flags, 1, 'Media', 0].join(','); },
    getMpCtrlPlaytimeCurrent() { return player.pos; },
    getMpCtrlPlaytimeTotal() { return player.total; },
    setScreenPosition(a) { env.calls.push(['setScreenPosition', a.slice(0, 4).join(',')]); player.win = a; },
    setMpCtrlSeekFlag(v) { env.calls.push(['setMpCtrlSeekFlag', v]); },
    setMpCtrlPlaytimeCurrent(v) { env.calls.push(['setMpCtrlPlaytimeCurrent', v]); player.sched(1500, () => { player.pos = v; player.flags = 8; player.sched(300, () => { player.flags = 0; }); }); },
    setMpctrlFlag(a) { env.calls.push(['setMpctrlFlag', a[0]]); player.speed = a[0]; },
    setAudioTrack(v) { env.calls.push(['setAudioTrack', v]); },
    setMpCtrlSubtitleNo(v) { env.calls.push(['setMpCtrlSubtitleNo', v]); },
    getMetadata() { const m = []; m[26] = 720; m[27] = 576; m[31] = 'Dolby Digital'; return m; },
    setMusicSubtitlePosition() {}, setMpCtrlSubtitleTextSize() {}, setMpCtrlSubtitleEncode() {}, setSubtitleColor() {}, setSubtitleBGColor() {},
    setAnimate() {}
  };
  const modeljs = {
    mpctrl,
    source: {
      getCurrentAppSource() { return JSON.stringify({ sourceName: src.name }); },
      GetLastSourceName() { return { sourceType: 'physical', name: 'HDMI1' }; }
    },
    sound: { getSpeakerArc() { return opts.arc ? 2 : 0; } }
  };
  function el(tag) {
    return { tagName: tag, className: '', style: {}, textContent: '', innerHTML: '', childNodes: [], firstChild: null,
      appendChild(c) { this.childNodes.push(c); c.parentNode = this; this.firstChild = this.childNodes[0]; return c; },
      removeChild(c) { this.childNodes = this.childNodes.filter(x => x !== c); c.parentNode = null; },
      querySelector() { return el('div'); }, parentNode: null };
  }
  const launcher = el('div'); launcher.className = 'launcher';
  const document = {
    head: el('head'), body: el('body'), documentElement: el('html'),
    querySelector(s) { return s === '.launcher' ? launcher : null; },
    querySelectorAll() { return []; },
    getElementById(id) { return null; },
    createElement(t) { return el(t); }
  };
  const store = {
    state: { AppControl: { currentAMState: 'stopped', runningOnBack: !!opts.rob, runningOnBackForNetflix: false },
      VolumeBar: { volume: 20, mute: 0 }, LauncherHis: {} },
    _modulesNamespaceMap: { 'LauncherHis/': { context: { state: { mainTileData: [], allAppsData: [], ListTemplateData: [], appRecommendDataFlag: false } } } },
    commit(name, v) {
      env.commits.push([name, v]);
      if (name === 'Source/setCurrentSource') {
        if (v === 'DMP') setTimeout(() => {}, 0), player.sched(opts.dmpMs || 900, () => { src.name = 'dmp'; });
        if (v === 'LAST') src.name = 'hdmi1';
      }
      if (name === 'VolumeBar/setVolume') store.state.VolumeBar.volume = v;
      if (name === 'VolumeBar/setMuteState') store.state.VolumeBar.mute = v;
    },
    watch() { return function () {}; }
  };
  const UI = {
    store, isReady: true, guiService: { sendResult() {} },
    mod: 'LauncherHis', sub: 'LauncherHis', dialog: false, extraModule: false,
    getCurrentModuleId() { return this.mod; }, getCurrentSubModuleId() { return this.sub; },
    isSubModuleExist() { return false; }, isModuleExist(m) { return this.extraModule && m === 'DLNA'; },
    isDialogShowing() { return this.dialog; }, isDialogInQueue() { return false; },
    subscribeMessage() {}, unsubscribeMessage() {}, pushModule() {}, pushSubModule() {},
    refreshGlobalTimer() {}, clearGlobalTimer() {},
    send_key_to_dfb(k) { env.calls.push(['send_key_to_dfb', k]); }
  };
  const ctx = {
    console, JSON, Math, Object, Array, String, Number, RegExp, parseInt, isNaN, Error,
    Date: FakeDate, setTimeout: setT, setInterval: setI, clearTimeout: clr, clearInterval: clr,
    document, hisense, modeljs, UI,
    Image: function () { this.src = ''; },
    localStorage: { getItem() { return '0'; }, setItem() {}, removeItem() {} },
    XMLHttpRequest: function () { this.open = function () {}; this.send = function () {}; },
    location: { href: 'file:///APPS/channelA/hisenseUI/index.html' },
    addEventListener() {}, removeEventListener() {}, CONST: { KEY: {} }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  env.ctx = ctx; env.UI = UI; env.src = src; env.player = player; env.store = store; env.launcher = launcher;
  env.load = function (file) { vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file }); };
  if (opts.stack) installStack(env);   // vor env.load: flex.js umhüllt dann die Stapel-Version von pushModule
  return env;
}

// ---- Modul-Stapel und App-Lebenszyklus wie im Launcher (nur mit makeEnv({ stack: true })) ----
// UI.js (app.js L9907-10200): Stapel aus { name, type, subs }; Typ "app" für AppModules (L16836),
// sonst "module". popAllModule('app'|'module') entfernt nur diesen Typ, sonst alles (ct, L9988);
// popSubModule(m) wirkt nur, wenn m das oberste Modul ist (L10165); pushSubModule holt ein
// vorhandenes Modul nach oben (L10154). AppControl.vue beforeDestroy -> stopCurrentApp: nur
// currentAMState 'stopping' (OA:29619-29625). AppStatus 'stopped'/'paused' -> ui() vereinfacht nach
// AppControl.js:860-1118 (app.js L8175). APM: ein Quellwechsel (DMP Grund 4, LAST Grund 9) beendet
// die App, die APM vorne hält (vorne oder per HOME unter der Startseite): YouTube/Netflix 'paused',
// sonst 'stopped' (LOG2:2682-2746), nach apm.statusMs.
const APP_TYPE = ['hiMedia', 'DLNA', 'AppControl', 'AccuWeather', 'Miracast', 'PvrMedia'];
function installStack(env) {
  const UI = env.UI, store = env.store, ac = store.state.AppControl, setT = env.ctx.setTimeout;
  const lst = store._modulesNamespaceMap['LauncherHis/'].context.state;
  Object.assign(ac, { currentAppName: '', currentLocalAppName: '', startMethod: 0, stopAppCallBackFun: 0,
    stopMethod: '', appIsOn: false });
  // fg: App, die APM vorne hält; statusMs: Abstand Quellwechsel -> AppStatus; status: fester Status
  // oder 'none' (kommt nie); stopping: false = beforeDestroy setzt kein 'stopping' (dann navigiert
  // der Launcher nach Startweg, z. B. Alle Apps); destroySync: beforeDestroy sofort statt im Takt danach
  const apm = env.apm = { fg: null, statusMs: 1000, status: null, stopping: true, destroySync: false };
  const stack = [];
  function rec() { env.calls.push(Array.prototype.slice.call(arguments)); }
  function type(m) { return APP_TYPE.indexOf(m) < 0 ? 'module' : 'app'; }
  function top() { return stack[stack.length - 1] || null; }
  function find(m) { for (let i = 0; i < stack.length; i++) if (stack[i].name === m) return stack[i]; return null; }
  function acDestroyed() {
    rec('AppControl.beforeDestroy', ac.currentAMState);
    if (apm.stopping && ac.currentAMState !== 'stopped' && UI.isReady && ac.currentAppName != null) ac.currentAMState = 'stopping';
    ac.appIsOn = false;
  }
  function gone(list) {
    list.forEach(function (x) { if (x.name === 'AppControl') { if (apm.destroySync) acDestroyed(); else setT(acDestroyed, 0); } });
  }
  function openLiveTV(why) { rec('openLiveTVModule', why); setT(function () { UI.pushModule('LiveTV'); }, 10); }
  function openLauncher() { store.commit('LauncherHis/setOpenFromNetflix', false); UI.pushSubModule('LauncherHis', 'LauncherHis'); }
  function openLauncherAllApp() { store.commit('LauncherHis/setOpenFromNetflix', false); UI.pushSubModule('LauncherHis', 'AllApps'); }

  UI.pushModule = function (m) {
    rec('pushModule', m);
    const n = find(m);
    if (n) stack.splice(stack.indexOf(n), 1);
    stack.push({ name: m, type: type(m), subs: [m] });
  };
  UI.pushSubModule = function (m, s) {
    s = s || m;
    rec('pushSubModule', m, s);
    const n = find(m);
    if (n) {
      if (top() !== n) { stack.splice(stack.indexOf(n), 1); stack.push(n); }
      n.subs = n.subs.filter(function (x) { return x !== s; });
      n.subs.push(s);
    } else stack.push({ name: m, type: type(m), subs: [s] });
    if (env.onPush) env.onPush(m, s);
  };
  UI.popSubModule = function (m) {
    rec('popSubModule', m);
    const t = top();
    if (!t || (m && m !== t.name)) return;
    if (t.subs.length > 1) t.subs.pop(); else gone(stack.splice(stack.length - 1, 1));
  };
  UI.popAllModule = function (o) {
    rec('popAllModule', o);
    let out;
    if (o === 'app' || o === 'module') {
      out = stack.filter(function (x) { return x.type === o; });
      for (let i = stack.length - 1; i >= 0; i--) if (stack[i].type === o) stack.splice(i, 1);
    } else out = stack.splice(0);
    gone(out);
  };
  UI.getCurrentModuleId = function () { const t = top(); return t ? t.name : null; };
  UI.getCurrentSubModuleId = function () { const t = top(); return t && t.subs.length ? t.subs[t.subs.length - 1] : null; };
  UI.isModuleExist = function (m) { return !!find(m); };
  UI.isSubModuleExist = function (m, s) { const n = find(m); return !!n && n.subs.indexOf(s) >= 0; };
  ['mod', 'sub'].forEach(function (k) {
    Object.defineProperty(UI, k, { configurable: true,
      get() { return k === 'mod' ? UI.getCurrentModuleId() : UI.getCurrentSubModuleId(); },
      set() { throw new Error('stack: UI.' + k + ' nicht setzen, env.stack benutzen'); } });
  });

  const commit0 = store.commit;
  store.commit = function (name, v) {
    commit0.call(store, name, v);
    const val = Array.isArray(v) ? v[0] : v;
    if (name === 'Source/setCurrentSource') {
      if (val === 'LAST' && Array.isArray(v)) env.src.name = 'hdmi1';   // EXIT/BACK des Launchers: ['LAST', 60]
      if ((val === 'DMP' || val === 'LAST') && apm.fg) {
        const e = apm.fg, t = apm.status || (e === 'youtube' || e === 'netflix' ? 'paused' : 'stopped');
        apm.fg = null;
        if (t !== 'none') setT(function () { env.appStatus(e, t); }, apm.statusMs);
      }
    }
    if (name === 'LauncherHis/setOpenFromNetflix') lst.openFromNetflix = v;
    if (name === 'AppControl/setAppCallBackFun') ac.stopAppCallBackFun = v;
  };

  // ui(e, t) für 'stopped'/'paused' (ohne restartFlag, browserFlag, Werksmodus, STR-Merker)
  env.appStatus = function (e, t) {
    rec('AppStatus', e, t);
    if (t === 'paused' && e === 'youtube') ac.runningOnBack = true;              // AppControl.js:860ff
    if (t === 'paused' && e === 'netflix') ac.runningOnBackForNetflix = true;
    if (ac.stopAppCallBackFun) {                                                  // AppControl.js:922
      ac.currentAMState = 'stopped';
      if (!UI.getCurrentSubModuleId()) openLiveTV('AppControl');
      ac.stopAppCallBackFun = 0;
      return;
    }
    const sys = ac.currentAMState !== 'stopping';
    if (e !== 'browser' && e !== ac.currentAppName) return;                      // AppControl.js:940
    ac.currentAMState = 'stopped';
    ac.stopMethod = '';
    if (ac.startMethod !== 20 && ac.startMethod !== 7) UI.popSubModule('AppControl');
    if (!sys) { if (!UI.getCurrentSubModuleId()) openLiveTV('AppControl'); return; }   // AppControl.js:1118
    const n = ac.startMethod;
    if (n === 3 || n === 5) { openLauncherAllApp(); UI.popAllModule('app'); }    // AppControl.js:986/1004
    else if (n === 1 || n === 15) { UI.popAllModule(); openLauncher(); }         // AppControl.js:1036
    else {                                                                        // AppControl.js:1084-1108
      if (ac.runningOnBack && t === 'stopped' && e === 'youtube' && UI.getCurrentSubModuleId()) return;
      if (ac.runningOnBackForNetflix && t === 'stopped' && e === 'netflix' && UI.getCurrentSubModuleId()) return;
      if (UI.getCurrentSubModuleId() !== 'liveTV') UI.popAllModule();
      openLiveTV('AppControl');
    }
  };
  // App vorne (Kachel = Startweg 1, Alle Apps = 3); die Merker löscht der Launcher bei 'started' (OA:29334)
  env.appStart = function (name, o) {
    o = o || {};
    Object.assign(ac, { currentAMState: 'started', currentAppName: name, currentLocalAppName: o.local || '',
      startMethod: o.method || 1, runningOnBack: false, runningOnBackForNetflix: false, appIsOn: true });
    stack.length = 0;
    stack.push({ name: 'AppControl', type: 'app', subs: ['AppControl'] });
    env.src.name = 'app';
    apm.fg = name;
  };
  // HOME in der App: KeyEventDispatcher VK_HOME (app.js L1188-1210)
  env.homeFromApp = function () {
    store.commit('LauncherHis/setOpenFromNetflix', ac.currentAppName === 'netflix' && ac.currentAMState === 'started');
    UI.popAllModule('module');
    UI.pushSubModule('LauncherHis', 'LauncherHis');
  };
  // ZURÜCK auf der Startseite: LauncherHis.vue keydown VK_BACKSPACE (92.js L1938): nach HOME aus
  // Netflix (openFromNetflix) Netflix wieder öffnen (checkIsAppOn ? popAllModule('module') :
  // popAllModule(), startThirdPartyApp(null,'netflix',36,1,...); hier wie env.appStart), sonst
  // popSubModule und ohne Untermodul LAST + Live-TV
  env.launcherBack = function () {
    if (lst.openFromNetflix) {
      if (UI.isSubModuleExist('AppControl', 'AppControl')) UI.popAllModule('module'); else UI.popAllModule();
      rec('startThirdPartyApp', 'netflix');
      env.appStart('netflix');
      return;
    }
    UI.popSubModule();
    if (!UI.getCurrentSubModuleId()) { store.commit('Source/setCurrentSource', ['LAST', 60]); openLiveTV('Launcher BackSpace'); }
  };
  // EXIT auf der Startseite: LauncherHis.vue (92.js L1939-1941), im $nextTick
  env.launcherExit = function () {
    const t = UI.isSubModuleExist('AppControl', 'AppControl');
    store.commit('AppControl/setAppCallBackFun', t ? 1 : 0);
    UI.popAllModule();
    store.commit('Source/setCurrentSource', ['LAST', 60]);
    if (!t) UI.pushModule('LiveTV');
  };
  env.stack = {
    list: stack,
    str() { return stack.map(function (x) { return x.name + '(' + x.subs.join(',') + ')'; }).join(' > '); },
    set(spec) {   // ohne Aufzeichnung und ohne beforeDestroy, z. B. ['hiMedia/deviceBrowser', 'LauncherHis']
      stack.length = 0;
      spec.forEach(function (x) {
        const p = x.split('/'), n = find(p[0]);
        if (n) n.subs.push(p[1] || p[0]); else stack.push({ name: p[0], type: type(p[0]), subs: [p[1] || p[0]] });
      });
    }
  };
  env.stack.set(['LauncherHis/LauncherHis']);
}

function hmac(keyHex, name, json) { return crypto.createHmac('sha256', Buffer.from(keyHex, 'hex')).update(name + '\n' + json).digest('hex'); }
function frame(keyHex, name, obj) { const j = JSON.stringify(obj); return hmac(keyHex, name, j) + ' ' + j + '\n'; }
function unframe(keyHex, name, raw) {
  if (!raw) return null;
  const m = /^([0-9a-f]{64}) (\{.*\})\s*$/.exec(raw); if (!m) return 'BADFRAME';
  if (hmac(keyHex, name, m[2]) !== m[1]) return 'BADMAC';
  return JSON.parse(m[2]);
}
module.exports = { makeEnv, frame, unframe, hmac };
