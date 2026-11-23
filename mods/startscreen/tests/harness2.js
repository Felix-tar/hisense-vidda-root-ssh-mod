// Static simulation harness for flex.js (stubs only, no TV). Usage: node harness.js <flex.js>
'use strict';
var fs = require('fs');
var vm = require('vm');
var SRC = fs.readFileSync(process.argv[2], 'utf8');

function makeWorld(opts) {
  opts = opts || {};
  var now = 1000000;
  var timers = [];
  var tid = 1;
  var logs = [];
  var calls = [];
  function rec(s) { calls.push(s); }

  function El(tag) {
    this.tagName = tag; this.id = ''; this.className = ''; this.style = {}; this.textContent = '';
    this._children = []; this._q = {}; this.parentNode = null; this.__vue__ = null; this._html = '';
  }
  Object.defineProperty(El.prototype, 'innerHTML', {
    get: function () { return this._html; },
    set: function (v) { this._html = v; this._children = []; this._q = {}; }
  });
  El.prototype.appendChild = function (c) { c.parentNode = this; this._children.push(c); if (c.id) byId[c.id] = c; return c; };
  El.prototype.removeChild = function (c) { var i = this._children.indexOf(c); if (i >= 0) this._children.splice(i, 1); c.parentNode = null; if (c.id && byId[c.id] === c) delete byId[c.id]; return c; };
  El.prototype.querySelector = function (s) { if (!this._q[s]) this._q[s] = new El('div'); return this._q[s]; };
  Object.defineProperty(El.prototype, 'firstChild', { get: function () { if (!this._children.length) { this.appendChild(new El('div')); this.appendChild(new El('div')); this.appendChild(new El('div')); } return this._children[0]; } });
  Object.defineProperty(El.prototype, 'lastChild', { get: function () { this.firstChild; return this._children[this._children.length - 1]; } });
  Object.defineProperty(El.prototype, 'childNodes', { get: function () { this.firstChild; return this._children; } });

  var byId = {};
  var body = new El('body');
  var head = new El('head');
  var launcherEl = new El('div'); launcherEl.className = 'launcher';
  var loading = opts.noLoading ? null : new El('div');
  if (loading) { loading.id = 'flex-loading'; body.appendChild(loading); }
  var showLauncher = true;
  var document = {
    head: head, body: body, documentElement: head,
    createElement: function (t) { return new El(t); },
    getElementById: function (id) { return byId[id] || null; },
    querySelector: function (s) {
      if (s === '.launcher') return showLauncher ? launcherEl : null;
      return null;
    },
    querySelectorAll: function (s) {
      if (s === 'div' && allAppsVm) return [allAppsEl];
      return [];
    }
  };

  // ---- Launcher model ----
  var M = {
    module: null, sub: null, appControl: false, appModule: false, dialog: false, dialogQueued: false,
    ready: false, src: 'tv', mpStat: 0, mods: [],
    last: '{\n    "type": "lastsource",\n    "sourceType": "physical",\n    "url": "",\n    "storeType": "",\n    "name": "HDMI1",\n    "id": "HDMI1"\n}\n'
  };
  var ac = { currentAMState: 'stopped', runningOnBack: false, runningOnBackForNetflix: false, currentAppName: '' };
  var lh = { mainTileData: [], allAppsData: [{ appId: '1', appName: 'Netflix' }], openFromNetflix: false,
    ListTemplateData: [], appRecommendDataFlag: false, currentRowIndex: 0 };
  var bus = {};
  var store = {
    state: { AppControl: ac, LauncherHis: lh, Source: { currSourceHasSignal: true }, System: {} },
    _modulesNamespaceMap: { 'LauncherHis/': { context: { state: lh } } },
    watch: function () { return function () {}; },
    commit: function (name, arg) {
      rec('commit ' + name + ' ' + JSON.stringify(arg));
      if (name === 'Source/setCurrentSource') {
        if (arg === 'DMP') M.src = 'dmp';
        if (arg === 'LAST') M.src = 'tv';
      }
    }
  };
  var acked = [];
  var UI = {
    pushModule: function (id) { rec('ORIG pushModule ' + id); M.module = id; M.sub = id; },
    pushSubModule: function (m, s) { rec('pushSubModule ' + m + '/' + s); M.module = m; M.sub = s; },
    popAllModule: function (o) { rec('popAllModule ' + o); },
    getCurrentModuleId: function () { return M.module; },
    getCurrentSubModuleId: function () { return M.sub; },
    isSubModuleExist: function (m, s) { return m === 'AppControl' && s === 'AppControl' && M.appControl; },
    isModuleExist: function (m) { return m === 'AppControl' ? (M.appControl || M.appModule) : M.mods.indexOf(m) >= 0; },
    getCurrentPageId: function () { return M.dialog ? 'standbyDialog_dialog' : M.sub; },
    isDialogShowing: function () { return M.dialog; },
    isDialogInQueue: function (id) { return M.dialogQueued && id === 'standbyDialog_dialog'; },
    subscribeMessage: function (n, f) { (bus[n] = bus[n] || []).push(f); },
    unsubscribeMessage: function (n, f) { var a = bus[n] || []; var i = a.indexOf(f); if (i >= 0) a.splice(i, 1); },
    clearGlobalTimer: function () {},
    get store() { return store; },
    get isReady() { return M.ready; },
    get guiService() { return { sendResult: function (h, t, k) { acked.push(t + ':' + k); } }; }
  };
  if (opts.noDialogApi) { delete UI.isDialogShowing; }
  function publish(n) { (bus[n] || []).slice().forEach(function (f) { f(); }); }

  // AllApps vm model
  var allAppsVm = null, allAppsEl = new El('div');
  allAppsEl.id = 'AllApps';
  var origStarts = [];
  function AllAppsCtor() {}
  AllAppsCtor.options = { methods: { keydown: function (e) { origStarts.push(e.keyCode + '@' + this.currentFocus); return true; } } };
  function newAllApps(focusIdx) {
    var v = Object.create(null);
    v.constructor = AllAppsCtor;
    v.$options = { name: 'AllApps' };
    v._isDestroyed = false;
    v.EditStatus = 0;
    v.allAppsData = lh.allAppsData;
    v.currentFocus = 'AllAppsTile-' + focusIdx;
    v.keydown = AllAppsCtor.options.methods.keydown.bind(v); // Vue initMethods
    allAppsVm = v;
    allAppsEl.__vue__ = v;
    byId.AllApps = allAppsEl;
    M.module = 'LauncherHis'; M.sub = 'AllApps';
    return v;
  }

  var mpctrl = {
    PlayMedia: function () { rec('PlayMedia'); M.mpStat = 2; },
    MpCtrl: function (a) { rec('MpCtrl ' + JSON.stringify(a)); if (a[0] === 1) M.mpStat = 3; },
    getMpCtrlStat: function () { return 'x,y,' + M.mpStat; },
    setAnimate: function () {},
    setScreenPosition: function () { rec('setScreenPosition'); }
  };
  var listeners = { keydown: [], keyup: [] };
  var ctx = {
    console: console,
    JSON: JSON, Math: Math, String: String, Object: Object, parseInt: parseInt, Array: Array,
    document: document,
    localStorage: { getItem: function () { return '0'; }, setItem: function () {} },
    Image: function () { this.src = ''; },
    XMLHttpRequest: function () { this.open = function () {}; this.send = function () {}; },
    location: { href: 'file:///hisenseUI/index.html' },
    hisense: { file: {
      read: function (p) {
        if (p === 'flexdbg/enable') return '';
        if (p === 'flexss/list.json') return '["/APPS/flexss/a.jpg","/APPS/flexss/b.jpg"]';
        return null;
      },
      write: function (p, t) { if (p === 'flexdbg/log.txt') { var l = t.split('\n'); logs.push(l[l.length - 1]); } }
    } },
    addEventListener: function (t, f) { listeners[t].push(f); },
    removeEventListener: function (t, f) { var i = listeners[t].indexOf(f); if (i >= 0) listeners[t].splice(i, 1); },
    setTimeout: function (f, ms) { var id = tid++; timers.push({ id: id, at: now + (ms || 0), f: f }); return id; },
    clearTimeout: function (id) { timers = timers.filter(function (t) { return t.id !== id; }); },
    setInterval: function (f, ms) { var id = tid++; timers.push({ id: id, at: now + ms, f: f, every: ms }); return id; },
    clearInterval: function (id) { timers = timers.filter(function (t) { return t.id !== id; }); }
  };
  ctx.Date = function () { return new Date(now); };
  ctx.Date.now = function () { return now; };
  ctx.window = ctx;
  vm.createContext(ctx);
  ctx.modeljsReal = { source: { getCurrentAppSource: function () { return JSON.stringify({ sourceName: M.src }); },
    GetLastSourceName: function () { if (M.last === null) throw new Error('nope'); return M.last; } }, mpctrl: mpctrl, message: {} };

  function advance(ms) {
    var end = now + ms;
    for (;;) {
      timers.sort(function (a, b) { return a.at - b.at || a.id - b.id; });
      var t = timers[0];
      if (!t || t.at > end) break;
      now = t.at;
      if (t.every) t.at = now + t.every; else timers.shift();
      t.f();
    }
    now = end;
  }
  // launcher key handler (Se/fe): registered in UI.init, after flex on cold boot
  var launcherKeys = [];
  function launcherHandler(e) {
    launcherKeys.push(e.type + ':' + e.keyCode);
    acked.push('L' + (e.type === 'keydown' ? 1 : 8) + ':' + e.keyCode);
    if (e.type === 'keydown' && M.sub === 'AllApps' && allAppsVm) allAppsVm.keydown({ keyCode: e.keyCode, repeat: e.repeat });
    if (opts.onLauncherKey) opts.onLauncherKey(e);
  }
  function key(code, type, extra) {
    var stopped = false;
    var e = { keyCode: code, type: type || 'keydown', repeat: false, isTrusted: true,
      stopImmediatePropagation: function () { stopped = true; }, preventDefault: function () {} };
    if (extra) for (var k in extra) e[k] = extra[k];
    var ls = listeners[e.type].slice();
    for (var i = 0; i < ls.length && !stopped; i++) ls[i](e);
    return stopped;
  }
  function press(code) { var a = key(code, 'keydown'); var b = key(code, 'keyup'); return [a, b]; }
  return {
    ctx: ctx, M: M, ac: ac, lh: lh, UI: UI, logs: logs, calls: calls, acked: acked, launcherKeys: launcherKeys,
    origStarts: origStarts, advance: advance, key: key, press: press, publish: publish, newAllApps: newAllApps,
    load: function () { vm.runInContext(SRC, ctx, { filename: 'flex.js' }); },
    assignUI: function () { ctx.UI = UI; },
    initUI: function () {
      // UI.init: listeners, INIT_LOADING, startModule, ...
      ctx.addEventListener('keydown', launcherHandler); ctx.addEventListener('keyup', launcherHandler);
      Object.defineProperty(ctx, 'modeljs', { value: ctx.modeljsReal, configurable: true, writable: true });
      M.ready = true;
      publish('INIT_LOADING');
      UI.pushModule('LiveTV'); // startModule default branch (via the possibly hooked property)
    },
    removeLoading: function () { if (loading && loading.parentNode) loading.parentNode.removeChild(loading); },
    now: function () { return now; },
    clear: function () { calls.length = 0; acked.length = 0; launcherKeys.length = 0; origStarts.length = 0; }
  };
}

var fails = 0;
function check(name, cond, extra) {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || !extra ? '' : '  ' + extra));
  if (!cond) fails++;
}
function has(arr, re) { for (var i = 0; i < arr.length; i++) if (re.test(arr[i])) return true; return false; }

// Common: cold boot to home, screensaver up to slideshow
function bootToHome(opts) {
  var w = makeWorld(opts);
  w.load();
  w.assignUI();
  w.initUI();
  w.advance(1);
  w.removeLoading();
  w.advance(15000); // releaseHome Zeitlimit
  return w;
}
function toSlideshow(w) {
  w.clear();
  w.advance(61000);
  w.advance(31000);
  w.advance(3000);
}

// 1. Boot hook
(function () {
  var w = bootToHome();
  check('boot: LiveTV replaced by home', has(w.calls, /^pushSubModule LauncherHis\/LauncherHis/) && !has(w.calls, /ORIG pushModule LiveTV/), w.calls.join(' | '));
  w.clear();
  w.UI.pushModule('LiveTV');
  check('boot: later LiveTV push goes to original (hook disarmed)', has(w.calls, /ORIG pushModule LiveTV/), w.calls.join(' | '));
})();
(function () {
  var w = makeWorld();
  w.load(); w.assignUI();
  w.ac.currentAMState = 'starting';
  w.initUI();
  check('boot: no replacement while app starting', has(w.calls, /ORIG pushModule LiveTV/) && !has(w.calls, /pushSubModule LauncherHis/), w.calls.join(' | '));
})();
(function () {
  // boot without LiveTV (Netflix key): INIT_LOADING, no pushModule; later LiveTV (EXIT) must not be replaced
  var w = makeWorld();
  w.load(); w.assignUI();
  w.ctx.addEventListener('keydown', function () {});
  Object.defineProperty(w.ctx, 'modeljs', { value: w.ctx.modeljsReal, configurable: true, writable: true });
  w.M.ready = true;
  w.publish('INIT_LOADING');
  w.advance(1);
  w.clear();
  w.UI.pushModule('LiveTV');
  check('R6: boot without LiveTV disarms in later(0)', has(w.calls, /ORIG pushModule LiveTV/), w.calls.join(' | '));
  // no 3 s Notnagel after INIT_FINISHED
  w.clear();
  w.M.module = 'AppControl'; w.M.sub = 'AppControl'; w.M.appControl = true;
  w.publish('INIT_FINISHED');
  w.advance(10000);
  check('R2: no home after INIT_FINISHED (Notnagel removed)', !has(w.calls, /pushSubModule|popAllModule/), w.calls.join(' | '));
})();
(function () {
  // STR: suspend arms, resume disarms
  var w = bootToHome();
  w.publish('STR_SUSPENDING');
  w.publish('STR_SUSPEND');
  w.clear();
  w.M.module = null; w.M.sub = null; // he(): ct() empties the stack first
  w.UI.pushModule('LiveTV'); // he() -> pe()
  check('STR: resume LiveTV replaced', has(w.calls, /pushSubModule LauncherHis\/LauncherHis/) && !has(w.calls, /ORIG pushModule/), w.calls.join(' | '));
  w.publish('STR_RESUME');
  w.clear();
  w.UI.pushModule('LiveTV');
  check('R6: after STR_RESUME LiveTV not replaced', has(w.calls, /ORIG pushModule LiveTV/), w.calls.join(' | '));
  // resume without LiveTV push (app key): STR_RESUME disarms
  w.publish('STR_SUSPEND');
  w.publish('STR_RESUME');
  w.clear();
  w.UI.pushModule('LiveTV');
  check('R6: STR_RESUME disarms when startModule pushed no LiveTV', has(w.calls, /ORIG pushModule LiveTV/), w.calls.join(' | '));
})();

// 2. Screensaver normal: key wakes, swallowed, acked once, LAST after 1.6 s
(function () {
  var w = bootToHome();
  toSlideshow(w);
  check('SS: DMP commit and PlayMedia', has(w.calls, /setCurrentSource "DMP"/) && has(w.calls, /PlayMedia/), w.calls.join(' | '));
  w.clear();
  var r = w.press(13);
  check('SS: wake key swallowed (down+up), launcher saw nothing', r[0] && r[1] && w.launcherKeys.length === 0, JSON.stringify(r) + ' ' + w.launcherKeys);
  check('SS: acked exactly once per event', w.acked.join(',') === '1:13,8:13', w.acked.join(','));
  w.advance(1000);
  check('SS: no LAST before fade', !has(w.calls, /LAST/));
  w.advance(1000);
  check('SS: MpCtrl stop + LAST after quiet', has(w.calls, /MpCtrl \[3,-1,0,"Media"\]/) && has(w.calls, /"LAST"/), w.calls.join(' | '));
})();

// 3. R1b: wake, then second key starts app within 1.6 s -> no LAST, no MpCtrl stop
(function () {
  var w = bootToHome({ onLauncherKey: null });
  toSlideshow(w);
  w.press(39);
  w.advance(500);
  w.clear();
  // second key: launcher starts app synchronously
  w.ac.currentAMState = 'starting'; w.ac.currentAppName = 'browser';
  w.press(13);
  w.advance(5000);
  check('R1b: app start after wake -> no LAST/MpCtrl stop', !has(w.calls, /LAST|MpCtrl \[3/), w.calls.join(' | '));
})();

// 4. R1a: cast app comes to front during slideshow -> no LAST, no MpCtrl
(function () {
  var w = bootToHome();
  toSlideshow(w);
  w.clear();
  w.M.module = 'AppControl'; w.M.sub = 'AppControl'; w.M.appControl = true; w.ac.currentAMState = 'started';
  w.advance(10000);
  check('R1a: stack change ends SS without LAST/MpCtrl/PlayMedia', !has(w.calls, /LAST|MpCtrl|PlayMedia/), w.calls.join(' | '));
  check('R1a: logged DMP bleibt', has(w.logs, /DMP bleibt/), w.logs.slice(-5).join(' | '));
})();

// 5. Wake then navigation keys: postponed, LAST after quiet
(function () {
  var w = bootToHome();
  toSlideshow(w);
  w.clear();
  w.press(39);
  for (var i = 0; i < 5; i++) { w.advance(800); w.press(39); }
  check('postpone: no LAST while keys keep coming', !has(w.calls, /LAST/));
  w.advance(2000);
  check('postpone: LAST after quiet', has(w.calls, /"LAST"/), w.calls.join(' | '));
})();

// 6. Wake with app key: passes to launcher, LAST suppressed if app starts
(function () {
  var w = bootToHome();
  toSlideshow(w);
  w.clear();
  var r = w.key(616, 'keydown');
  check('SYS key wakes and passes', !r && w.launcherKeys.indexOf('keydown:616') >= 0, w.launcherKeys.join(','));
  w.ac.currentAMState = 'starting';
  w.key(616, 'keyup');
  w.advance(5000);
  check('SYS key app start -> no LAST', !has(w.calls, /LAST|MpCtrl \[3/), w.calls.join(' | '));
})();

// 7. R3: app in background under home -> no DMP
(function () {
  var w = bootToHome();
  w.M.appControl = true; // AppControl under LauncherHis (HOME from app)
  toSlideshow(w);
  check('R3: no DMP with app in background', !has(w.calls, /DMP|PlayMedia/), w.calls.join(' | '));
  check('R3: logged held', has(w.logs, /keine Diashow/));
  w.M.appControl = false; w.lh.openFromNetflix = true;
  w.clear(); w.press(13); toSlideshow(w);
  check('R3: no DMP with openFromNetflix', !has(w.calls, /DMP|PlayMedia/), w.calls.join(' | '));
  // also key not swallowed with app present
  w.M.appControl = true;
  w.clear();
  var r = w.key(13, 'keydown');
  check('R4-review: wake key swallowed when app only beneath home (home in front)', r && w.launcherKeys.length === 0, w.launcherKeys.join(','));
})();

// 8. R7: dialog showing during SS -> keys pass
(function () {
  var w = bootToHome();
  toSlideshow(w);
  w.M.dialog = true;
  w.clear();
  var r = w.press(13);
  check('R7: key passes while dialog showing', !r[0] && !r[1] && w.launcherKeys.length === 2, w.launcherKeys.join(','));
  check('R7: flex did not ack', w.acked.join(',') === 'L1:13,L8:13', w.acked.join(','));
  w.M.dialog = false;
  w.advance(3000);
  check('R7: LAST still after quiet (home, no app)', has(w.calls, /"LAST"/), w.calls.join(' | '));
})();
(function () {
  var w = bootToHome();
  toSlideshow(w);
  w.M.dialogQueued = true;
  w.clear();
  var r = w.press(40);
  check('R7: key passes while standby dialog queued', !r[0], '');
})();

// 9. R5: OK on gallery entry in AllApps handled synchronously; never orig start
(function () {
  var w = bootToHome();
  w.lh.allAppsData.push({ appId: 'flex-gallery', appName: 'Bilder' }); // ensureGalleryApp normally
  var idx = w.lh.allAppsData.length - 1;
  w.newAllApps(idx); // unpatched instance (before tick)
  w.clear();
  var r = w.press(13);
  check('R5: OK on Bilder swallowed by onKey', r[0] && r[1] && w.launcherKeys.length === 0, w.launcherKeys.join(','));
  check('R5: original keydown not called', w.origStarts.length === 0, w.origStarts.join(','));
  check('R5: gallery opened', has(w.logs, /Seite Bilder geöffnet/), w.logs.slice(-3).join(' | '));
  // gallery keys
  w.clear();
  r = w.press(39);
  check('gallery: arrow swallowed', r[0] && r[1] && w.launcherKeys.length === 0);
  // R4: app comes to front -> key passes, gallery closes
  w.M.module = 'AppControl'; w.M.sub = 'AppControl'; w.M.appControl = true;
  w.clear();
  r = w.press(13);
  check('R4: key passes after app came to front', !r[0] && w.launcherKeys.length === 2, w.launcherKeys.join(','));
  check('R4: gallery closed', has(w.logs, /Seite Bilder geschlossen/));
})();
(function () {
  // R4: tick closes gallery when AllApps no longer current; SYS key passes
  var w = bootToHome();
  w.lh.allAppsData.push({ appId: 'flex-gallery', appName: 'Bilder' });
  var idx = w.lh.allAppsData.length - 1;
  w.newAllApps(idx);
  w.press(13);
  w.clear();
  var r = w.key(616, 'keydown');
  check('R4: Netflix key closes gallery and passes', !r && w.launcherKeys.indexOf('keydown:616') >= 0);
  w.newAllApps(idx); w.press(13);
  w.M.sub = 'LauncherHis';
  w.advance(1100);
  check('R4: tick closes gallery when AllApps gone', has(w.logs, /geschlossen \(Alle Apps nicht mehr vorne\)/), w.logs.slice(-3).join(' | '));
  // STR_SUSPENDING closes
  w.newAllApps(idx); w.press(13);
  w.publish('STR_SUSPENDING');
  check('R4: STR_SUSPENDING closes gallery', has(w.logs, /geschlossen \(STR_SUSPENDING\)/));
})();
(function () {
  // R5 fallback: launcher handler before onKey (hot-reload order) and ctor patch
  var w = bootToHome();
  w.lh.allAppsData.push({ appId: 'flex-gallery', appName: 'Bilder' });
  var idx = w.lh.allAppsData.length - 1;
  w.newAllApps(0);
  w.advance(1100); // tick patches ctor + instance
  check('ctor patched', w.ctx.document && has(w.logs, /Komponente angepasst/));
  var v2 = w.newAllApps(idx); // new instance after ctor patch: protected from creation
  w.clear();
  // call the instance's keydown directly (as the launcher would, bypassing onKey)
  v2.keydown({ keyCode: 13, repeat: false });
  check('R5: new instance never reaches original for Bilder', w.origStarts.length === 0, w.origStarts.join(','));
  check('R5: new instance opened gallery via wrapper', has(w.logs, /Seite Bilder geöffnet/));
  // other entries still go to original
  w.press(8); // close gallery
  v2.currentFocus = 'AllAppsTile-0';
  w.clear();
  v2.keydown({ keyCode: 13, repeat: false });
  check('AllApps: other entry still goes to original', w.origStarts.length === 1, w.origStarts.join(','));
})();
(function () {
  // App in background: OK on Bilder swallowed, gallery not opened, original not called
  var w = bootToHome();
  w.lh.allAppsData.push({ appId: 'flex-gallery', appName: 'Bilder' });
  var idx = w.lh.allAppsData.length - 1;
  w.newAllApps(idx);
  w.M.appControl = true;
  w.clear();
  var r = w.press(13);
  check('Bilder with app in background: swallowed, not opened, no orig', r[0] && w.origStarts.length === 0 && !has(w.logs, /Seite Bilder geöffnet/));
})();

// 10. R8: hot reload -> no ack from flex; open key not re-evaluated
(function () {
  var w = bootToHome();
  // hot reload: run flex.js again (prev = window.__flex)
  w.load();
  w.lh.allAppsData.push({ appId: 'flex-gallery', appName: 'Bilder' });
  var idx = w.lh.allAppsData.length - 1;
  w.newAllApps(idx);
  w.advance(1100); // patch
  w.clear();
  var r = w.press(13); // launcher first now (listener order), wrapper opens gallery, then onKey
  check('R8: hot reload - flex sends no ack', w.acked.join(',') === 'L1:13,L8:13', w.acked.join(','));
  check('R8: gallery opened once, opening OK not toggled', has(w.logs, /Seite Bilder geöffnet/) && !has(w.logs, /Bilder: Taste 13/), w.logs.slice(-4).join(' | '));
})();

// 11. Missing API -> less: no dialog API -> no swallowing
(function () {
  var w = bootToHome({ noDialogApi: true });
  toSlideshow(w);
  w.clear();
  var r = w.press(13);
  check('missing isDialogShowing: key not swallowed', !r[0]);
})();


// ===== Review round 2 =====
// RV1: hiMedia (USB) / DLNA / Miracast / PvrMedia ... under home -> no DMP, no PlayMedia
['hiMedia', 'DLNA', 'Miracast', 'PvrMedia', 'AccuWeather', 'Art', 'Free', 'FVP'].forEach(function (m) {
  var w = bootToHome();
  w.M.mods = [m];
  toSlideshow(w);
  check('RV1: no DMP/PlayMedia with ' + m + ' under home', !has(w.calls, /DMP|PlayMedia/), w.calls.join(' | '));
  w.clear();
  var r = w.press(13);
  w.advance(5000);
  check('RV1: wake with ' + m + ' beneath: swallowed, no MpCtrl/LAST', r[0] && !has(w.calls, /MpCtrl|LAST/), w.calls.join(' | '));
});
(function () {
  // app module appears beneath during the show
  var w = bootToHome();
  toSlideshow(w);
  w.clear();
  w.M.mods = ['hiMedia'];
  w.advance(2000);
  check('RV1: app module appears during show -> ends without MpCtrl/LAST/PlayMedia', !has(w.calls, /MpCtrl|LAST|PlayMedia/), w.calls.join(' | '));
})();
(function () {
  // DMP already active from someone else (no module left) -> no takeover
  var w = bootToHome();
  w.M.src = 'dmp';
  toSlideshow(w);
  check('RV1b: DMP already active (foreign) -> no commit, no PlayMedia', !has(w.calls, /DMP|PlayMedia/), w.calls.join(' | '));
  check('RV1b: logged foreign DMP', has(w.logs, /DMP schon von anderer Seite/), w.logs.slice(-3).join(' | '));
  w.clear();
  var r = w.press(13);
  w.advance(5000);
  check('RV1b: wake -> no MpCtrl/LAST on foreign DMP', r[0] && !has(w.calls, /MpCtrl|LAST/), w.calls.join(' | '));
})();
// RV2: last source virtual / OTT / ip / unreadable -> MpCtrl stop, but no LAST; next slideshow still allowed
[['virtual', '{"type":"lastsource","sourceType":"virtualSource","name":"X","id":"9","url":"u"}'],
  ['ott', '{"type":"lastsource","sourceType":"ottChannel","folderId":1,"uuid":"a","url":"x"}'],
  ['ip', '{"type":"lastsource","sourceType":"ipChannel"}'],
  ['garbage', 'not json'],
  ['throws', null]].forEach(function (c) {
  var w = bootToHome();
  w.M.last = c[1];
  toSlideshow(w);
  w.clear();
  w.press(13);
  w.advance(3000);
  check('RV2 ' + c[0] + ': player stopped, no LAST', has(w.calls, /MpCtrl \[3,-1,0,"Media"\]/) && !has(w.calls, /LAST/), w.calls.join(' | '));
  check('RV2 ' + c[0] + ': logged DMP bleibt', has(w.logs, /letzte Quelle nicht physisch/), w.logs.slice(-3).join(' | '));
  toSlideshow(w);
  check('RV2 ' + c[0] + ': own leftover DMP reused by next slideshow', has(w.calls, /PlayMedia/), w.calls.join(' | '));
});
(function () {
  // readable without sourceType -> launcher physical branch -> LAST allowed
  var w = bootToHome();
  w.M.last = '{"type":"lastsource"}';
  toSlideshow(w);
  w.clear(); w.press(13); w.advance(3000);
  check('RV2: no sourceType -> LAST', has(w.calls, /"LAST"/), w.calls.join(' | '));
  // after LAST DMP is gone -> dmpOwn cleared; foreign DMP later -> refused
  w.advance(2000);
  w.M.src = 'dmp';
  w.clear(); toSlideshow(w);
  check('RV1b: after our LAST, a new foreign DMP is not taken over', !has(w.calls, /PlayMedia/), w.calls.join(' | '));
})();
// RV3: YouTube/Netflix paused in background, stale openFromNetflix -> gallery opens; slideshow still held
[['runningOnBack', function (w) { w.ac.runningOnBack = true; }],
  ['runningOnBackForNetflix', function (w) { w.ac.runningOnBackForNetflix = true; }],
  ['openFromNetflix', function (w) { w.lh.openFromNetflix = true; }]].forEach(function (c) {
  var w = bootToHome();
  c[1](w);
  w.lh.allAppsData.push({ appId: 'flex-gallery', appName: 'Bilder' });
  w.newAllApps(w.lh.allAppsData.length - 1);
  w.clear();
  var r = w.press(13);
  check('RV3 ' + c[0] + ': Bilder opens', r[0] && has(w.logs, /Seite Bilder geöffnet/) && w.origStarts.length === 0, w.logs.slice(-2).join(' | '));
  w.advance(1100);
  check('RV3 ' + c[0] + ': tick keeps gallery open', !has(w.logs, /Seite Bilder geschlossen/), w.logs.slice(-2).join(' | '));
  w.press(8);
  w.M.sub = 'LauncherHis';
  w.clear(); toSlideshow(w);
  check('RV3 ' + c[0] + ': slideshow still held (source rule)', !has(w.calls, /DMP|PlayMedia/), w.calls.join(' | '));
});
// RV4: AppControl beneath home, 62 s idle, keydown 13 -> swallowed; HOME passes; BACK swallowed
(function () {
  var w = bootToHome();
  w.M.appControl = true;
  w.clear();
  w.advance(62000);
  check('RV4: screensaver started with app beneath', has(w.logs, /Oberfläche aus/));
  var r = w.press(13);
  check('RV4: wake OK swallowed (not to hidden home)', r[0] && r[1] && w.launcherKeys.length === 0, w.launcherKeys.join(','));
  check('RV4: acked once', w.acked.join(',') === '1:13,8:13', w.acked.join(','));
  w.advance(62000); w.clear();
  r = w.press(8);
  check('RV4: wake BACK swallowed', r[0] && w.launcherKeys.length === 0, w.launcherKeys.join(','));
  w.advance(62000); w.clear();
  r = w.key(36, 'keydown');
  check('RV4: HOME wakes and passes to launcher', !r && w.launcherKeys.indexOf('keydown:36') >= 0, w.launcherKeys.join(','));
  w.advance(5000);
  check('RV4: no MpCtrl/LAST/DMP anywhere', !has(w.calls, /MpCtrl|LAST|DMP/), w.calls.join(' | '));
})();
(function () {
  // runningOnBack only (no AppControl): wake key swallowed too
  var w = bootToHome();
  w.ac.runningOnBack = true;
  w.advance(62000); w.clear();
  var r = w.press(13);
  check('RV4: wake swallowed with runningOnBack', r[0] && w.launcherKeys.length === 0, w.launcherKeys.join(','));
})();
(function () {
  // Gallery with AppControl beneath: still refused (audit condition)
  var w = bootToHome();
  w.M.appControl = true;
  w.lh.allAppsData.push({ appId: 'flex-gallery', appName: 'Bilder' });
  w.newAllApps(w.lh.allAppsData.length - 1);
  w.clear();
  var r = w.press(13);
  check('RV3: AppControl beneath -> Bilder swallowed, not opened, no orig', r[0] && !has(w.logs, /Seite Bilder geöffnet/) && w.origStarts.length === 0);
})();
(function () {
  // Hot reload keeps own DMP ownership
  var w = bootToHome();
  w.M.last = '{"type":"lastsource","sourceType":"virtualSource"}';
  toSlideshow(w);
  w.press(13); w.advance(3000); // DMP stays (virtual)
  w.load(); // hot reload
  w.advance(1100);
  w.clear(); toSlideshow(w);
  check('RV1b: hot reload inherits own DMP', has(w.calls, /PlayMedia/), w.calls.join(' | '));
})();

console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
process.exit(fails ? 1 : 0);
