# VIDAA U4 launcher and media interface reference

These are firmware-specific calls on the 55U8QF P0219 reference system. Read them
alongside [the architecture](01-hisense-architecture.md) and [the hardware decoder lab](02-hardware-decoder.md).
In the tables, **M** means observed on the running device, **S** means extracted from code or
symbols, **U** means used by the mod, and **?** means an unverified interpretation. Several lines
use an abbreviated source case label from the historical notes. Their semantics still follow the
evidence categories. The native media helper and launcher implementation are the executable references.


## 3. The launcher's global objects

The launcher is `/opt/hisenseUI/bin/hisenseUI`, a **Cobalt gold build** running a Vue 2 + Vuex SPA
from `file:///hisenseUI/index.html` at 1920 × 1080 (M, ARCH 5). It has **no DevTools** (the debug
switches are absent from the binary, S). Our mod is injected by two lines in `index.html` (LAUNCH 2).

| Object | What it is | Timing / rules | Status / source |
|---|---|---|---|
| `window.UI` | the launcher's module system and store (`UI.store`) | **does not exist yet** when an injected script runs; trap the assignment with `Object.defineProperty(window, 'UI', { set })` (25 ms polling as fallback) | M, U, LAUNCH |
| `window.modeljs` | getter for the native model APIs (`source`, `mpctrl`, `video`, `sound`, `cec`, `system`, `message`, …) | returns nothing while early scripts run and at the moment `UI` is assigned; usable from the intercepted `startModule()` call on. **Never wrap or replace its functions; never call `create*` factories on it** | M, U, LAUNCH rule 1/7 |
| `guijs` | native GUI service factory | **never call `guijs.createService()`** (§4.3). Our installer refuses a `flex.js` that contains `guijs` or `createService` outside comments | M (incident), LAUNCH rule 1 |
| `hisense.file` | file API below `/var/local/applications/UI/` | §6 | M, U |

---

## 4. `window.UI`: module system, timers, keys, message bus

### 4.1 Functions we call

| Call | What it does | How we use it | Status / source |
|---|---|---|---|
| `UI.pushModule(id)` | pushes a module (e.g. `'LiveTV'`) | wrapped **only** between `INIT_LOADING` and the return of `startModule()` to replace the first `LiveTV` push with the home screen; called directly once to show Live TV after a user's input switch | M, U, LAUNCH 10 |
| `UI.pushSubModule(module, sub, params, route)` | opens a page, e.g. `('LauncherHis','LauncherHis',…)` (home), `('LauncherHis','AllInputs',{caller:'LauncherMain'},{path:'/LauncherHis/Source/AllInputs'})` (input list) | home at power‑on; our "Sources" tile | M, U |
| `UI.popAllModule()` | removes every module including the home screen | only in the user's input switch (as the launcher's input list does); never at the boot interception (forces a rebuild, black flash) | M, U |
| `UI.popAllModule('module')` | removes modules of type `module`; app modules survive | what HOME does; we never call it | S, LBA |
| `UI.popAllModule('app')` | removes only modules of type `app` (here `AppControl`); home screen and its components stay | ends an app lying under the home screen on a direct OK on the Kodi tile, immediately followed by `Source/setCurrentSource('DMP')` (owner's exception, LAUNCH rule 4) | M, U |
| `UI.popSubModule(...)` | closes a submodule | **not used by us**; the launcher's own video player calls it after its stop is confirmed (state 6) | S, LBA |
| `UI.getCurrentModuleId()`, `UI.getCurrentSubModuleId()` | current module / submodule | home idle = submodule `LauncherHis`; input list = `AllInputs`; all apps = `AllApps` | U |
| `UI.isModuleExist(id)`, `UI.isSubModuleExist(module, sub)` | stack queries | "an app exists" = submodule `AppControl/AppControl` or any of the modules `AppControl`, `hiMedia`, `DLNA`, `Miracast`, `PvrMedia`, `AccuWeather`, `Art`, `Free`, `FVP` | M, U, LAUNCH rule 2 |
| `UI.isReady` | launcher ready flag | condition for swallowing keys | U |
| `UI.isDialogShowing()`, `UI.isDialogInQueue('standbyDialog_dialog')` | system dialog up / auto‑standby dialog queued | never swallow a key while a dialog is up (the auto‑standby countdown must get the first key) | M, U |
| `UI.guiService.sendResult(handled, type, keyCode)` | acknowledges one key to the native GUI service; `type` 1 = DOWN, 2 = REPEAT, 8 = UP | exactly once for every keydown/keyup our capture listener swallows (§4.3) | M, U |
| `UI.send_key_to_dfb(code)` | injects a remote key through DirectFB; internally `modeljs.system.setKeyToDfb([code])`, launcher log "send key to dfb : …" | volume up/down/mute (411/412/413) for Kodi, one key per 100 ms tick, both with ARC and with TV speakers | M, U, AVR §4 |
| `UI.refreshGlobalTimer(name)` | re‑arms a launcher timer; does nothing if it does not exist | while Kodi holds the remote: `'setArtScreen'` (VIDAA screen saver) always, `'AutoSleepTimeOut'` only if Kodi saw a key in the last 120 s | U |
| `UI.clearGlobalTimer(name)` | clears a timer | `'setArtScreen'`, `'resetScreendata'` when our screen saver replaces VIDAA's | U |
| `UI.subscribeMessage(name, fn)` / `unsubscribeMessage` | Vue `$on` on the launcher's UI message bus | §4.2 | M, U |
| `UI.showToast(text)` | small launcher toast | Denon module messages | U |
| `UI.showSoftKeyboard({…, callback})`, `UI.isSoftKeyboardShown()` | the launcher's on‑screen keyboard | renaming receiver inputs in the Denon page | U |

### 4.2 Message bus vs. model bus

| Bus | Names | Notes | Status |
|---|---|---|---|
| UI bus (`UI.subscribeMessage`) | `INIT_LOADING`, `INIT_FINISHED`, `STR_SUSPENDING`, `STR_SUSPEND`, `STR_RESUME` | `INIT_LOADING` is published synchronously in `UI.init()`, directly before `startModule()`. On wake from STR, `startModule()` runs **before** `STR_RESUME`. Our mod resets all its own UI on `INIT_LOADING`/`STR_SUSPENDING` | M, U, LAUNCH |
| model bus (internal webpack module `model_service`) | SL2 keys such as `de.loewe.sl2.mpctrl.vstr.state` (§9.6) | registered once by the launcher with `modeljs.add*EventListener`; drops all model events while `!UI.isReady && !UI.isSuspending`. **Not reachable through `UI.subscribeMessage`** (an `$on` for an SL2 key receives nothing). We poll getters instead and never register our own model listeners | S, LBA; A for "receives nothing" |

The SL2 key names (`de.loewe.sl2.…`) point to Loewe‑derived middleware (S, ARCH 4.3).

### 4.3 Keys and the acknowledgement

```
IR → mdrv_ir → /dev/input/event0 ("MStar Smart TV IR Receiver") → systemserver / DirectFB
   → native GUI service → Cobalt keydown/keyup → launcher handler → UI.guiService.sendResult(...)
```

- The native GUI service hands out the **next key only after the previous one was acknowledged.**
  A handler that stops a key before the launcher sees it must call `sendResult(true, …)` itself, or
  every key arrives about **5 s** late (M: keys on our picture page arrived exactly every 5 s while our
  handler needed 3–5 ms).
- After a hot reload the launcher's handler runs first and has already answered; do not acknowledge
  twice (U).
- **A second GUI service object** (`guijs.createService()`) takes over the native events; `AppControl`
  then never receives `appEventMessage` ("app started/resumed") and every app start hangs invisibly
  until the 10 s key lock expires (log `appcontrol has been auto unlocked`). Happened on the TV (M).
- Key codes (launcher constants, M): power 400, volume up/down 411/412, mute 413, Netflix 616,
  Amazon 617, YouTube 619, All apps 615, settings 567, source 505, home 36 and 547, exit 27, back 8,
  OK 13. Always let power, volume, mute and the app/system keys pass (LAUNCH rule 5).
- Linux key codes on `event0` as Kodi sees them: `KEY_MUTE` 113, `KEY_VOLUMEDOWN` 114,
  `KEY_VOLUMEUP` 115, `KEY_HOME`/`KEY_HOMEPAGE` (M, AVR §4, WIN).

---

## 5. The Vuex store

`UI.store` is a standard Vuex store. Read state through `UI.store.state.<namespace>`; commit only
mutations the launcher itself commits, with the values it uses (LAUNCH rule 7).

**Pitfall: two modules named `LauncherHis`.** The home screen is the namespace `LauncherHis/`; a
lazily registered *search* module also appears as `state.modules.LauncherHis`. Look the home state up
via `UI.store._modulesNamespaceMap['LauncherHis/']` (M, U).

### 5.1 State we read

| Path | Meaning | Status |
|---|---|---|
| `LauncherHis.mainTileData` | home tiles, built from `allAppsData` (favourites + all apps + "My Apps", first 14); filter this data, not the DOM, to keep remote focus right | M, U |
| `LauncherHis.allAppsData` | the "All apps" list; our pseudo entries are appended here (the launcher rebuilds it, so re‑append when its length changes) | M, U |
| `LauncherHis.ListTemplateData`, `appRecommendDataFlag`, `currentRowIndex` | recommendation rows, recommendation flag, focused row | M, U |
| `LauncherHis.openFromNetflix` | set after HOME out of Netflix; BACK/HOME on the home screen would restart Netflix while it is set | S, M |
| `AppControl.currentAMState` | `stopped` / `starting` / `started` / `stopping`. **Only the transitions mean something**: a stale `started` without any app in the module stack is normal (the launcher sets it for invisible preloaded apps) | M |
| `AppControl.currentAppName` | name of the app the launcher thinks is current | M |
| `AppControl.runningOnBack` | YouTube paused in the background | M |
| `AppControl.runningOnBackForNetflix` | Netflix paused in the background | M |
| `Source.currSourceId` | current input as the launcher sees it, e.g. `'HDMI1'` | M, U |
| `VolumeBar.volume`, `VolumeBar.mute` | TV volume and mute as shown by the launcher (with ARC only a display value; whether it matches the receiver is open) | M, U, TVP 3.6a |

The `runningOnBack*` flags **stay set after every normal exit** from YouTube/Netflix until the next
app starts (M). After a cold boot all three (`runningOnBack`, `runningOnBackForNetflix`,
`openFromNetflix`) are `false` (M, TVP P7a). The launcher has no call that really ends a paused app (§16).

### 5.2 Mutations we commit

| Mutation | Value(s) | Effect | Where we use it | Status |
|---|---|---|---|---|
| `Source/setCurrentSource` | `'DMP'` | switches to the media‑player input; internally `modeljs.source.sourceSwitch([<session>, 4, 'DMP'])`, reason 4 = UI app start (§7) | screen saver, Kodi TVPlayer and ES path | M, U |
| `Source/setCurrentSource` | `'LAST'` | back to the last source. **This is the launcher's "end the app" command (EXIT)** and can itself **start an app** (§7.2) | only if `GetLastSourceName()` reports `sourceType: physical` | M, U |
| `Source/setCurrentSource` | `['HDMI1', 17]` | user input switch (`SourceSwitchByUser`), as the input list does on OK | console tile; followed by `UI.popAllModule()`, wait ≤ 1 s for `Source.currSourceId`, `LiveTV/setShowFlgArr`, `UI.pushModule('LiveTV')` | M, U, CEC |
| `LiveTV/setShowFlgArr` | `['showPassword', true, 'showInfobar', true]` | Live TV display flags, as `openLiveTVModule` sets them | console tile | U |
| `LauncherHis/clearAllWaterFallData` | – | empties the recommendation rows | home clean‑up | M, U |
| `LauncherHis/setCurrentRowIndex` | `[-1, 2]` | sets the focused row; we use it to move the focus up out of the app row (exact argument semantics ?) | our key wrapper | U |
| `LauncherHis/setOpenFromNetflix` | `false` | clears the flag as the launcher's `openLauncher` does after a tile app ends | after ending Netflix for a Kodi start; at boot | M, U |
| `System/setArtScreenTimes` | `0` | turns VIDAA's screen saver off (stores `0`, clears the timer) | our screen saver replaces it | M, U |
| `VolumeBar/setVolume`, `VolumeBar/setMuteState` | `getMainVolume() ± n`, `0/1` | what the launcher uses without ARC (→ `modeljs.sound.setMainVolume`/`setMainMute`) | **no longer used**: on 2026‑11‑05 the store path set the values but left the TV speakers silent until a real key came; we switched to `send_key_to_dfb` | M |

Mutations we never commit: anything on `AppControl` (the app start/stop path), and anything not in
this table.

---

## 6. `hisense.file`: the launcher's file API

```js
var text = window.hisense.file.read('flexkodi/running', 1);            // string, or not a string = missing
var rc   = window.hisense.file.write('flexkodi/start', String(now), 1);  // 0 = written, else errno
```

| Property | Finding | Status / source |
|---|---|---|
| Second argument | selects a "work root"; **`1` = `/var/local/applications/UI/`**. All our code uses 1 | M, U |
| Path rules | relative to the root. Probes with `../../../../tmp/…` (root 1), absolute `/tmp/…` (roots 0, 1, 2, 3) and `tmp/…` (root 2) all returned an empty string: no way out of the root | M, HWV §7, `probe-fileroots.js` |
| Symlinks | **followed by `read` and `write`**. A symlink `flexkodi/rt → /tmp/flexkodi-rt/b` gives the launcher a RAM channel; it also means a planted symlink redirects writes, so root must validate (our watcher re‑checks owner, mode, inode and link target every round) | M, TVP P5 |
| Return of `write` | an errno: `0` success, `13` (EACCES) when the target folder is root‑owned 0755. Whether it comes as number or string is not certain; parse both | M, TVP P5, code `kpWriteOk` |
| Return of `read` | the content as a string; we treat any non‑string as "missing" (our debug channel switches on only if `flexdbg/enable` reads as a string) | U; exact value for a missing file ? |
| New files | owner `10009:10009`, mode `0666` | M, TVP P5 |
| Atomicity | one call per file; we keep files ≤ 400 bytes and protect them with a signature, so a torn read is detected and re‑read on the next tick | U, TVP 3.9 |
| Flash wear | the root is on eMMC (p29); frequently written state goes through a symlink into `/tmp` | M |

Our channels on this API (all designed so a root process validates what the launcher writes):
`flexkodi/start|stop|running` (Kodi start, stop, heartbeat), `flexkodi/rt/…` (signed Kodi bridge in
RAM), `flexdbg/…` (debug channel with a per‑install token), `flexss/list.json|settings.json`
(screen saver), `flexdenon/request|response` (Denon bridge, symlink into `/tmp/flexdenon/b`).

---

## 7. `modeljs.source` and the app manager

### 7.1 Calls

| Call | Returns | Use and pitfalls | Status / source |
|---|---|---|---|
| `getCurrentAppSource()` | JSON (string or object), e.g. `{"sourceName":"dmp",…}` | `"dmp"` ≈ 0.3 s after `setCurrentSource('DMP')`. **Can stay at `"dmp"` after a CEC switch to HDMI**, because for the app manager HDMI is not an app | M, U, CEC |
| `GetCurrentPath()` | string such as `"HDMI1"` | the real input. Our `dmpActive()`: DMP counts as active only if `getCurrentAppSource()` says `dmp` **and** the path does not start with `HDMI`, `AV`, `COMP`, `YPBPR`, `VGA`, `SCART`, `TV`, `ATV`, `DTV` | M, U |
| `GetLastSourceName()` | JSON with `sourceType` (`physical`, `virtualSource`, `ottChannel`, `ipChannel`) and name/id (e.g. `HDMI1`) | decides what `LAST` does (7.2) | M, S |
| `sourceSwitch([session, reason, name])` | – | what `Source/setCurrentSource` calls; **we never call it directly** | S, LBA |

### 7.2 What `LAST` does

`setCurrentSource('LAST')` → `PubFunc.SourceSwitchLAST` (S, LBA; M for `physical`):

| `sourceType` of the last source | Effect |
|---|---|
| `physical` (or readable without `sourceType`) | switches the input back |
| `virtualSource` | `startApp(…, startMethod 17)`: **starts an app** |
| `ottChannel` | `startVidaaPlus` → `startThirdPartyApp`: **starts an app** |
| `ipChannel` | nothing |

So a `LAST` sent from a timer can start an app. The launcher itself skips `LAST` for an OTT channel on
HOME. Our rule: commit `LAST` only for `physical`; otherwise only stop the player and leave `DMP`.

### 7.3 Reason codes and start methods

| Value | Context | Meaning | Status |
|---|---|---|---|
| reason **4** | source switch | `SOURCE_SWITCH_REASON_UI_START_APP`: `DMP`, `local_app` and `miracast` are **app starts** for the app manager, which replaces the app it holds in front. A paused app under the home screen is lost this way (M once, in a faulty build: `runtask appId(Youtube) action(stop)`, `stopped by apm`) | S + M |
| reason **17** | source switch | user switch from the input list (`SourceSwitchByUser`) | S, U |
| reason **2** | source switch | used by the global EXIT path together with `LAST` (`setCurrentSource(['LAST', 2])`); name not found | S |
| `startMethod` **16** | app start | remote control (VIDAA phone app via MQTT `ui_service/launchapp`; log `start app from: 16`) | M, API |
| `startMethod` **17** | app start | virtual source start (from `LAST`) | S |
| `stopMethod` **10** | app state | app started by DIAL; our Kodi tile refuses to end such an app | S, LAUNCH rule 4 |
| power‑on types 23 / 25 / 26 | launcher `getPowerOnType` | wake by Netflix / YouTube / Amazon key | S |
| wake reason 16 | launcher | wake by CEC; the launcher switches the source after `startModule()` | S, CEC |

### 7.4 App‑manager and launcher log lines worth knowing

Seen in `/var/log/log.txt*` (read with `grep`, never copy the files; they hold tokens):

| Line (excerpt) | Meaning |
|---|---|
| `LauncherHissetCurrentSource NewParam:::<session>,4,DMP` | launcher asks for source `DMP` with reason 4; `<session>` is the first element of `sourceSwitch`, a session id in the launcher's code (S) |
| `runtask appId(Youtube) action(stop)`, `stopped by apm` | app manager stops the app in front |
| `readystart`, `start app from: 16`, `unlock from [appcontrol]` | a normal app start (here by remote control) |
| `appcontrol has been auto unlocked` | **an app start hung** for 10 s; must never appear after a mod change |
| `AppControl.js:423===>`, `AppControl.js:738===>`, `AppControl.js:804===>` | the launcher's app‑start milestones; our test rule requires all three after each app start (LAUNCH rule 9) |
| `youtubeproxy … Requested app (Youtube) registered`, `callAppRunning`, `couldn't wait(Youtube) start message`, `start_fail_timeout` | YouTube cannot be started again after its Cobalt process was SIGKILLed in this boot (open finding, API) |
| `APP TVMAIN crashed` | `tvmain` crashed and is being restarted (§15) |
| `Begin to call Mm_Stop()` … `media player -source out- done` | the TV player's stop and source‑out; once ≈ 100 s apart (§8.6) |
| `get Rect failed for 'BspWindow-MAIN'` | video window torn down mid‑film by a forced source change; broken until reboot (CEC) |
| `send key to dfb : …` | `UI.send_key_to_dfb` |
| `cecDispatchEvent(): Event 0x03 with parameters: 0x01, 0x00` → `onCECActiveSourceNotify(): Tell UI to switch source 1` → `onCecNotifyChangeSource … HDMI1` | a CEC "Active Source" from physical address 1.0.0.0 switching the TV to HDMI1 |
| `deviceSelect(): Device selected, routing change new 0x1300 old 0x1000`, `send opcode = 0x44 <UserCtrlPressed> from SRC:[0] to DEST:[4]`, `deviceSelect(): wake up the device ...` | TV waking a CEC playback device at power‑on ("power on CEC devices with the TV") |
| `send opcode = 0x82 <Active Source> from SRC:[0]` | TV announces itself; happens with every photo of the media player (≈ every 21 s in our slideshow) |

---

## 8. `modeljs.mpctrl`: the TV's file/photo player

The launcher's USB player (`hiMedia`), its DLNA renderer and our TVPlayer stage all use this API.
It goes to `tvmain`, which plays through `libhisplayer.so` as a normal client of the media service
(§10). This is **branch A ("vdplayer")**: 23.976/24p is always output at 59.94 Hz (measured with
the IRQ method of §14; result tables in [the hardware decoder lab](02-hardware-decoder.md)).
Calls take a JavaScript array; the binding converts every element to a string (S, LBA).

### 8.1 `PlayMedia(array)` — eleven elements

```js
mp.PlayMedia([url, null, null, null, null, null, 4, null, null, null, 'Media']);
```

| Index | Meaning | Values seen | Status |
|---|---|---|---|
| 0 | URL | `file:///…` (USB, our photos), `http://…` (DLNA; our loopback feeder `http://127.0.0.1:<port>/<token>/media.<ext>`). A plain path without `file://` **stays idle**. `smb://` is not supported. Max 2048 characters. The launcher never percent‑encodes. **The player evaluates query strings** (`?type=thumbnail&width=160&height=90&pos=1%` makes a thumbnail), so put tokens in the path. A path without extension reached state 2 too | M, S |
| 1–5 | ? | always `null` in every launcher call | S; meaning ? |
| 6 | media type (directory field type) | **4 video**, **8 music**, **16 photo** (also defined: 2 unknown, 64 folder, 92 media) | M (4, 16), S |
| 7–9 | ? | always `null` | S; meaning ? |
| 10 | owner tag | `'Media'` (USB, DLNA, thumbnails), `'FTE'` (first‑time setup), `'setting'` (sound test); missing in one notification‑photo call. **Not a profile name**; it reappears in `getMpCtrlStat()[7]` | S, M |

A new `PlayMedia` during playback switches directly: the session number in `[0]` increments with a
short state 7 in between (M). Photo with background music uses `setBGMusicUrl([url, "16"])` instead
(S, unused). We never pass values the launcher never passes (project rule).

### 8.2 `getMpCtrlStat([])` — the status vector

On this TV it returns a **comma‑separated string**; the launcher's code indexes it like an array.
Parse both (`if (typeof r === 'string') r = r.split(',')`); a URL with a comma would break the split
(our URLs have none). Measured form: `"<session>,<url>,<state>,100,<caps>,<event>,1,Media,0"`.

| Index | Meaning | Values | Status |
|---|---|---|---|
| 0 | session counter | increments with every `PlayMedia` (e.g. 546 → 547) | M |
| 1 | URL the message refers to | **ignore every message whose `[1]` is not exactly your URL** (the launcher does) | M, S |
| 2 | state, also error codes (table below) | `parseInt` | M |
| 3 | speed × 100 | `100`; showed `400` after `setMpctrlFlag([400])` | M |
| 4 | capabilities | bit 0 = seek/speed/resume possible; `5` when prepared, `7` when playing (bit 1 meaning ?) | M; bit 1 ? |
| 5 | flags/event | `1&` buffering (level); `8&` seek done (hiMedia); `== 16` media info ready (read tracks now); `4` at end of file before state 6; `1` briefly on a rejected audio track | M (4, 1), S (8, 16) |
| 6 | ? | `1`; showed `2` during fast forward | M; meaning ? |
| 7 | owner tag | `Media` (= `PlayMedia[10]`) | M, A |
| 8 | detailed error code (DLNA evaluates it) | `0` without error; 1001 probing failed, 1002 unsupported format, 1003 video, 1004 audio, 1006 video decoding, 1007 audio decoding, 2000 network, 600 unknown; defined but unhandled 1009–1012, 4/5/6 | M (0), S |

**State values in `[2]`** (S from launcher constants; M where marked):

| Value | Name | Notes |
|---|---|---|
| 0 / 1 | IDLE / PREPARING | M: 0 → 1 after ≈ 0.3 s |
| **2** | PREPARED | M: reached after ≈ 1.8–2.3 s; **start only here** (`MpCtrl([1])` or `MpCtrl([8,null,s])`) |
| 3 / 4 | PLAYING / PAUSE | M |
| 5 | STOP | we treat 5 before playback as "ended early" |
| **6** | AUTO_STOP | end of file **and** confirmation after `MpCtrl([3…])`. We count it as film end only with `[5]==4` or position ≥ duration − 10 s |
| 7 | RELEASING | M: between two `PlayMedia` |
| 8 | PREPARE_DONE | no launcher player has a case for it (only a duplicate filter); never seen in our 250 ms polling |
| 9 / 10 | PLAY_DONE / REPLAY | – |
| 21 / 22 | PVR channel / rating lock | – |
| 23 / 24 | buffer underflow / ready | DLNA shows/hides its loading circle |
| 200 | ERROR (unknown) | M (photo error) |
| 1202–1208 | invalid arg, not initialised, parser error, memory, engine start fail, decoding error, invalid DRM data | – |
| 1301 / 1302 / 1307 | audio unplayable / video unplayable / file not supported | launcher shows "File not supported" and closes |
| 1303–1306, 1308/1309 | frame rate, resolution, video codec, audio codec not supported; no video / no audio | not handled by the launcher; reaction ? |
| 1401–1404 | photo errors | – |
| 1501–1506 | server disconnected, read error, seek not supported, open failed, network error, media lost | – |
| 1601 | file expired | – |
| 2009 | SEEK_DONE | DLNA uses it |

The launcher's duplicate filter acts on a repeated state only if it is not 2 or 8. With polling,
act on **changes** of `[2]`; short states (23/24/2009, `[5]==8`) can be missed between polls (A).

### 8.3 Control

| Call | Meaning | Status |
|---|---|---|
| `MpCtrl([1])` | PLAY: start from PREPARED, or resume from pause (→ 3 at the same position) | M |
| `MpCtrl([2])` | PAUSE (→ 4) | M |
| `MpCtrl([8, null, s])` | PLAY_AT: start from PREPARED at second `s` (resume point); `MpCtrl([8,null,30])` → position 34 five seconds later | M |
| `MpCtrl([3, -1, 0, 'Media'])` | STOP; state 6 follows. Meaning of `-1` and `0` ? | M, U |
| `MpCtrl([3])` | stop without extras (first‑time setup, notification photo) | S |
| ACTION 4 (RELEASE) | defined, never used | S |
| `setMpCtrlSeekFlag(f)` + `setMpCtrlPlaytimeCurrent(s)` | seek; `f = 100` exact (target 50 reached within ≤ 2.5 s), `f = 0` fast/relative | M |
| `getMpCtrlPlaytimeCurrent()`, `getMpCtrlPlaytimeTotal()` | **whole seconds** (max 360000) | M |
| `setMpctrlFlag([v])` | trick play: 200/400/800/1600 forward, 100200/100400/100800/101600 backward, 100 normal; only if `1&[4]` | S; **M: `[3]` showed 400 but the position rose only 4 s in 3 s → not confirmed**, off by default (`FLEX_KODI_TRICKPLAY=1`) |
| `setMpCtrlSpeed(int)`, `SPEED_FORW_*`/`SPEED_BACK_*` | exist, unused by the launcher | S |

### 8.4 Tracks, subtitles, chapters

| Call | Meaning | Status |
|---|---|---|
| `getHasAudioStreams()`, `getHasSubtitle()`, `getHasChapter()` | 1 = present | M |
| `setAudioTrack(n)` / `getAudioTrack()` | audio track index. In a synthetic test file `n` was the file order (index 3 = the TrueHD track). In a real Blu‑ray rip `setAudioTrack(3)` played a different language than the file order predicts, consistent with the TV skipping the TrueHD track there (A). Our Kodi side therefore counts only TV‑supported tracks by default (`<audioindex>supported</audioindex>`) | M (both observations); the rule ? |
| `getMetadata([])[31]` (and `[29]`) | audio codec text: "Dolby Digital", "Dolby Digital Plus", "DTS", "AAC", TrueHD → "UNKNOWN". FLAC is refused: track stays, `[5]` briefly 1. Read `[31]` directly before `setAudioTrack` and poll it for up to 5 s to detect a refusal | M |
| `setMpCtrlSubtitleNo(n)` | internal subtitle `n` (table row n+1; row 0 is "off"); `-1` off. The launcher passes `[n]` or `n` | S, U |
| `setMusicSubtitlePosition([10, y, 1900, 400, 0, 0])` | subtitle position (y 630 middle, 590 high, 650 low) | S |
| `setMpCtrlSubtitleTextSize([48])` (60 large, 44 small), `setMpCtrlSubtitleEncode([100…])`, `setSubtitleColor([A,R,G,B])`, `setSubtitleBGColor([…])`, `setSubtitleSync([ms])` (±5000, steps 500) | subtitle style as the launcher's menu sets it | S |
| `setExternalTitleUri(uri)` | external subtitle file; **the launcher never uses it**; effect ? | S |
| `createAudiotrackIterator(…)`, `createSubtitleIterator(…)`, `createChapterIterator(…)` | table iterators (columns program id, stream id, name, language, attributes; chapters with start/end in ms) | S. **We never call them** (rule: no `create*`) |
| `setAnimate(effect)` | photo transition: 0 none, 17 checkerboard, 18 stripes, 30 open horizontally, 38 shape, 40 bars, 64 random (values from the launcher's USB player) | S; U for 0 and 64 (screen saver) |

### 8.5 Metadata

`getMetadata([])` returns a vector (M with an MPEG‑2 DVD file and HEVC/VC‑1 files, HWV §7):

| Index | Meaning |
|---|---|
| 3 | URL |
| 22 | session |
| 23 | duration in s |
| 24 | file size in bytes |
| **26 / 27** | width / height **as stored** (720/576 for an anamorphic 16:9 DVD — no aspect ratio) |
| 28 | video codec text (`MPEG1_2`, `HEVC`, `VC1`, …) |
| 29 / 31 | audio codec text (§8.4) |
| 30 | video codec according to the launcher's code (not checked) |
| 38 | bit depth (8) |
| **39** | frame rate × 1000 (23976, 25000, 60000 …), read from the bitstream (VC‑1 sequence header, HEVC VUI), not from timestamps |
| 41 | rotation (`"0"`, `"90"`, …) |

No DAR/SAR field was found (?). Our window is computed from Kodi's aspect ratio.

### 8.6 `setScreenPosition([x, y, w, h, 1, 0])` — the video window

| Property | Finding | Status |
|---|---|---|
| Coordinates | **3840 × 2160** video‑plane pixels; the 5th element `1` is the screen mode constant the launcher uses, the 6th `0` is ? | M, S |
| Larger than the screen | accepted (used for a slow zoom); one call took ≈ 0.7 ms | M |
| Persistence | the window **survives the stop**; the DLNA player never sets one, so reset to `[0,0,3840,2160,1,0]` before leaving | M, S |
| Launcher's "Fit" | from `[26]/[27]`: pillarbox `[(W−H·s)/2, 0, H·s, H]` or letterbox `[0, (H−W/s)/2, W, W/s]` with `s = w/h`. For anamorphic DVDs this is wrong (1.25 instead of 1.78) | S |
| Examples we use | 4:3 `[480, 0, 2880, 2160, 1, 0]`, full `[0, 0, 3840, 2160, 1, 0]` | M, U |

### 8.7 Order of operations that works (TV player path)

1. Preconditions: no app exists (§4.1), source switched by us, not found active.
2. `Source/setCurrentSource('DMP')`; wait until `getCurrentAppSource()` says `dmp` (we allow ≈ 10 s,
   the launcher's players allow 10 s).
3. `PlayMedia([...4...'Media'])`; poll `getMpCtrlStat` every 250 ms; ignore foreign `[1]`.
4. At state 2: window, then `MpCtrl([1])` or `MpCtrl([8,null,resume])`.
5. Stop: reset the window while the original session still owns it, wait for its bounded cleanup, then stop that same session; leave `DMP` only through
   `LAST` with a `physical` last source.

The home screen covers the video plane: make it transparent while video plays (our CSS class
`flex-ss-photo` on `.launcher`), or the film plays invisibly.

---

## 9. TV sound, CEC and video

### 9.1 `modeljs.sound`

| Call | Value / meaning | Use | Status |
|---|---|---|---|
| `getSpeakerArc()` | **1 = TV speakers, 2 = ARC** (audio system) | decides nothing anymore for volume (both paths use `send_key_to_dfb`), reported to Kodi as `arc` | M, U |
| `getDigitalAudioOut()` | 1 bitstream, 2 PCM, 3 auto, 4 Dolby Digital, 5 Dolby Digital Plus | shown on our Denon page; never set by us | M (2), S, U |
| `getArcDevExist()` | 1 = ARC device present | Denon page | M, U |
| `getAudioOut()` | headphone/line‑out setting (1 measured), irrelevant for ARC | – | M, S |
| `getMainVolume()`, `getMainMute()`, `getMainVolumeDev()` | TV volume, mute | logging | M |
| `setMainVolume`, `setMainMute` | behind `VolumeBar/*`; with ARC the launcher refuses absolute volume ("SetVolume do not work in ARC mode") | not used | S |
| `getDolbyAudioCertVersion()` | "Dolby MS12 Multistream Decoder with Atmos (no HE AAC)" | – | M |
| `getTvSpeaker()`, `getDolbyAtmos()`, `getAtmosNotify()`, `getLipsync()` | 0, 0, 1, 3 | read only | M |
| `getDigitalAudioDelay()` | – | listed for a planned lip‑sync test; no recorded value | S |
| `getAudioFormat()` | `[codec, channel mode, atmos]` with `atmos` = `"ATMOS"` or `"NON_ATMOS"`, as the launcher evaluates it | read only | S |

No function contains "earc"; the link is **ARC only** (S). Whether `setMainVolume` works with ARC
was never tested.

### 9.2 `modeljs.cec`

| Call | Meaning | Status |
|---|---|---|
| `getRemoteTv()`, `getHdmiDevicesArcState()`, `getIsDeviceExist()` | CEC settings and ARC state; read once as 1, 0, 0 (receiver probably off at that moment) | M |
| `getFunctionality()`, `GetCecArcActiveMode()` | CEC on/off, ARC mode; part of our diagnostic commands, values not recorded | S |
| `getHdmiDevicesName()`, `getHdmiDevicesType()` | parallel lists of known CEC devices; names may carry a prefix `HDMIn-` | M, U |
| `getCecDevicepoweron()` | "power on CEC devices with the TV" | M |
| **`HdmiDevicesOperate([0, type])`** | the "Start" entry of the TV's CEC device list: sends `<User Control Pressed>` to the device **by type** (4 = playback device). Wakes a sleeping game console; a running one stays on. With two devices of the same type it addresses neither. Never send to type 0 (TV) or 5 (audio system) | M, U (console tile) |
| `HdmiDevicesOperate([1, type])` | the menu's "Standby": only a key press, ignored by the console we tested | M |
| real `<Standby>` to one device | the TV service has it (`cmdGiveStandbySignalToDevice`, `de.loewe.sl2.cec.send.standby.signal`), **the launcher does not expose it** | S |

The launcher registers `onCecNotifyChangeSource` when its bundle loads; any CEC Active Source can
switch the TV to HDMI at any time, our mod cannot intercept it (CEC).

### 9.3 `modeljs.video`

| Call | Finding | Status |
|---|---|---|
| `getVideoInfo()` | e.g. `["720","576","p","25","0","unknown","8","0","MPEG1_2"]`; field meaning assumed (width, height, scan, rate, ?, HDR?, bits, ?, codec); "p" even for interlaced input | M; layout A |
| `getVideoFormatInfo()` | e.g. `"1920*1080p/60Hz"`; **reported "/60Hz" during 50 Hz output: useless for the output rate** | M |
| `getHdrFlag()` | 0 for SDR; other values ? | M (0) |
| `getVideoFrameAspect()` | e.g. `"16:9"`; only used by Live TV | S |
| `getEnumPictureMode()`, `getEnumSmoothMotion()` (4 = "Standard"), `getJudderReduction()`, `getBlurReduction()`, `getApplyMode()` | picture menu getters | M |
| `setEnumSmoothMotion`, `setJudderReduction`, `setBlurReduction`, `setMotionClearness` | picture menu setters. Used once in a probe with the owner's consent (8 combinations, values restored): **no setting changes the output rate**. The getters report a new value only a moment after the setter | M |
| `setEnumZoom(n)` | TV picture format (PVR player and picture menu only) | S |

### 9.6 SL2 event keys of the media player

Delivered only on the launcher's internal model bus (§4.2), listed so you recognise them (S, LBA):

| Key | Payload |
|---|---|
| `de.loewe.sl2.mpctrl.vstr.state` | the `getMpCtrlStat` vector |
| `de.loewe.sl2.mpctrl.i32.playtime.current` / `.total` | seconds |
| `de.loewe.sl2.mpctrl.vstr.metadata` (`.ext`) | metadata vector / duration reply |
| `de.loewe.sl2.str.source.app.current` | JSON, `sourceName: "dmp"` |
| `de.loewe.sl2.mpctrl.i32.dmp.source.state` | −1 uninit, 0 out, 1 in, 2 going out, 3 going in |
| `de.loewe.sl2.str.servicemode.videoinfo.hdrtype` | `hdr_10`, `hdr_hlg`, `hdr_dolbyvision`, `hdr_10plus` |
| `de.loewe.sl2.mpctrl.i32.gui.render` | DLNA renderer request |
| `de.loewe.sl2.mpctrl.str.external.subtitle.uri` | property behind `setExternalTitleUri` |

---

## 10. Native media ABI

### 10.1 Architecture

| Fact | Status / source |
|---|---|
| `MiMwIpcSrv` (uid 2900) is **the one** media service; it loads `libmmsdk.so`, `libmmplayer.so`, `libmmp.so`, `libmsrv_mmplayer_ipc.so` and owns the hardware decoders | M (`/proc/<pid>/maps`), MD §3 |
| Interface: Android‑style **Binder**, service name **`mstar.mmplayer`**, `IMMPlayerClient` / `BnMMPlayerClient` | S |
| Clients: `tvmain` (via `libhisplayer.so` → `libmsrv_mmplayer_ipc.so`), Netflix (`libstplayer.so` → same), our helper | M |
| `libhisplayer.so` initializes without an app argument. Local items use `[app0]`; HTTP/DLNA items use `[app2]` through `mdmp`. See [player profiles](07-player-profiles-and-cadence.md) | S, VERS §5 |
| Netflix's player library `/tvservice/applications/Netflix/lib/libstplayer.so` (105 KB, Thumb‑2) shows the ES sequence in its imports; it served as the template | S, MD §7d |
| An item created from codec attributes runs in **`mstplayer` (branch B, `libmmp.so`)** and outputs the content's frame rate | M (core dump showed the item in `libmmp.so`; IRQ 51), MD §7g |

### 10.2 Functions (all members of `MSrv_MM_PlayerInterface` in `libmsrv_mmplayer_ipc.so`)

The object is constructed by us: `calloc(1, 4096)` then the constructor (the vendor test tool
allocates 0x40 bytes; we are generous). Symbol names are what `dlsym` needs.

| Function (mangled symbol) | Our use | Notes | Status |
|---|---|---|---|
| constructor `_ZN23MSrv_MM_PlayerInterfaceC1Ev` | once | – | M, U |
| `MM_Initialize()` `…13MM_InitializeEv` | once | **enough**; no app type needed | M, U |
| `MM_Initialize_APSelect(EN_MM_PLAYER_AP_TYPE)` `…22MM_Initialize_APSelectE20EN_MM_PLAYER_AP_TYPE` | experiments only | app types 1–12 with the file player: no video; not needed for ES items | M |
| `AddEventRecipient(cb)` / `RemoveEventRecipient(cb)` `…17AddEventRecipientEPFhPvS0_S0_E` | once | callback `unsigned char cb(void *a, void *event, void *data)`; return 1. `data[0]` is the item handle | M, U |
| `MM_CreateMediaItem(const ST_MEDIA_INFO&, unsigned long *item)` `…18MM_CreateMediaItemERK13ST_MEDIA_INFOPm` | per film / audio track change | returns 0 and an item. **Returns 1 silently** when another player holds the service (e.g. the photo player) | M, U |
| `MM_PushPayload(item, ST_MMPLAYER_DATA_INFO*, void *extra, unsigned long extra_size)` `…14MM_PushPayloadEmP21ST_MMPLAYER_DATA_INFOPvm` | per packet | **always `extra = NULL, extra_size = 0`** (§10.8); non‑zero = refused (buffer full), retry | M, U |
| `MM_Play(item)` `…7MM_PlayEm` | once per item | **only after event `INIT_OK`**; run it in its own thread | M, U |
| `MM_Stop(item)` `…7MM_StopEm` | once per item | never from the push thread (a push can wait inside the service until the stop) | M, U |
| `MM_DeleteMediaItem(item)` `…18MM_DeleteMediaItemEm`, `MM_Finalize()` `…11MM_FinalizeEv` | teardown | – | M, U |
| `MM_SetTrickMode(item, const ST_TRICK_INFO&)` `…15MM_SetTrickModeEmRK13ST_TRICK_INFO` | pause/resume | `{1,1}` pause, `{0,1}` normal (as Netflix) | M, U |
| `MM_SetFlushData(item, EN_DATA_TYPE)` `…15MM_SetFlushDataEm12EN_DATA_TYPE` | seek | type 2 = audio and video; confirmed by event 24 (we wait ≤ 3 s) | M, U |
| `MM_SetDataEnd(item)` `…13MM_SetDataEndEm` | end of stream | then event 9 or a still position | M, U |
| `MM_SetDisplayRectangle(item, const ST_RECT_SIGNED_POSITION&, uchar, uchar)` `…22MM_SetDisplayRectangleEmRK23ST_RECT_SIGNED_POSITIONhh` | window for non‑16:9 films | last two args `0, 0` (meaning ?) | M, U |
| `MM_GetVideoPTS()` `…14MM_GetVideoPTSEv` | position (ms) for buffer control | no service calls while `MM_Play` is inside the service (they block) | M, U |
| `MM_GetVideoDataBufferInfo(item, kind, unsigned long *out)` `…25MM_GetVideoDataBufferInfoEm27EN_PLAYER_VIDEO_BUFFER_INFOPm` | buffer level | kind 3 behaves like ms in buffer (jumps 1.5–3 s at a 1.5 s target, fallback only); kind 1 returned 0 | M |
| `MM_GetAudioVolume()`, `MM_GetAudioMuteFlag()`, `MM_SetAudioMute(uchar)` | logging only (optional symbols) | service‑internal volume, not the TV's | S, U (log) |
| `MM_DequeueInputBuffer` / `MM_ReleaseInputBuffer` | **not used** | belong to the secure video path (strings `m_pSvpHandle`, "get security handle twice"); DRM is out of scope | S |
| `MM_PushPayloadPartial` (Binder code `0x5f`), `MMPlayer::MM_PushPayload64` | internal | the client library copies `info.addr` into shared memory in chunks up to 2 MB (`0x200000`) | S; chunking never exercised (no frame > 2 MB) |
| `MI_AOUT_Init(MI_AOUT_InitParams*)` (`libmi_glibc.so`) | once, before `MM_Initialize` | parameter block with `u16SizeofStructure` at offset 0 (we pass a zeroed 256‑byte buffer with its size); otherwise "unknown error". Without it the vendor test tool stops with "init module first, please call MI_AOUT_Init." | M, U |

Connection check (diagnostic): `MMPlayer::connect()` gets the service with
`getService("mstar.mmplayer")` and a per‑client proxy stored at `MMPlayer + 0x154` (global symbols
`_ZN8MMPlayer16mMMPlayerServiceE`, `mmplayer`). A NULL proxy predicts the silent `1` from
`MM_CreateMediaItem` (M, `flex_es_probe.c`).

### 10.3 `ST_MEDIA_INFO` (0x1b0 bytes, `memset` 0 first)

Filled exactly as Netflix's `libstplayer` does (function at `0x8bcc` in that library; S, then M by our
client):

| Offset | Value | Meaning | Status |
|---|---|---|---|
| `+0x00` | `0x00010012` | version (`libmmplayer`: "New interface need to set version !!") | S, U |
| `+0x04` | `0x55aa5a5a` | magic | S, U |
| `+0x08` | `0x1b0` | structure size | S, U |
| `+0x10` | 1 | ? | S, U |
| `+0x20` | `-1` (64 bit) | ? (duration/start?) | S, U |
| `+0x28` / `+0x2c` | 2 / 3 | probably media/source type (ES) | A |
| `+0x48` | `0x802` | ? | S, U |
| **`+0x50`** | **video codec** (§10.4) | – | M |
| **`+0x5c`** | **frame rate in mHz**: `1000 × num / den`, e.g. 23976, 24000, 25000 | how the rate reaches the panel; Kodi accepts 1–121 fps, `round(fps × 1000)` | S, M |
| `+0x62` / `+0x64` / `+0x65` | bytes 1 / 4 / 1 | ? | S, U |
| **`+0xa0`** | **audio codec** (§10.4) | 0 = no audio (protocol) | M |
| `+0xa4` / `+0xa8` | 1 / 9 | ? The static analysis read the store of `1` to `+0xa4` as "app type 1" (A); we set it as Netflix does, and whether it matters for ES items is open | S, U |
| `+0xbc` | control flags (1, possibly +0x40) | Netflix sets them only on the protected path; **we leave 0** | S |

There is no aspect‑ratio field; the window is set with `MM_SetDisplayRectangle`.

### 10.4 Codec values

**Video `+0x50`**, determined on the TV by creating items without `MM_Play`, pushing preroll and
reading `CodecType` from `MApi_VDEC_EX_V2_Init` in the kernel log (13 runs, no crash; MD §7g):

| `+0x50` | VDEC `CodecType` | Decoder | Status |
|---|---|---|---|
| 1 | 1 | MPEG‑2 | M (decoder start); DVD rips play over the ES path in daily use |
| 2 | 3 | MPEG‑4 | M (decoder start only) |
| **7** | 11 | **H.264** | M, U |
| 8 | 12 | AVS | M (decoder start only) |
| 11 | 13 | MJPEG | M (decoder start only) |
| **12** | 7 | **VC‑1 Advanced** | M, U |
| `0x13` | – | HEVC 3D variant | S (Netflix table) |
| **`0x14`** | – | **HEVC** (incl. Main 10) | S + M (played up to 80 Mbit/s) |
| `0x15` | – | VP9 | S only |
| 3, 4, 5, 6, 9, 10, 13 | – | no decoder started (with an H.264 clip) | M |

An early version of our notes took `0x14` for H.264; it is HEVC.

**Audio `+0xa0`:** `5` = `E_AUDIO_CODEC_AC3P`, accepts **E‑AC‑3 and AC‑3** (both M); `6` = AAC (S
only: one native AAC run ended with the TV switching off, not analysed, so our Kodi converts AAC to
AC‑3).

### 10.5 Small structures

```c
struct ST_MMPLAYER_DATA_INFO   { void *addr; uint32_t size; uint32_t pts; uint32_t type; };
                               /* pts in milliseconds; type 1 = video (Annex B with SPS/PPS/VPS), 0 = audio */
struct ST_TRICK_INFO           { uint32_t mode; uint32_t speed; };  /* {0,1} normal, {1,1} pause (A: field names) */
struct ST_RECT_SIGNED_POSITION { int32_t x, y; uint16_t w, h; };    /* 3840x2160 plane */
```

Layouts are as `libstplayer` fills them (S) and work in our helper (M). PTS unit confirmed by a
service message in a core dump: `[OMX]Vdec_Get_first, pts:1800005000` for a 5 ms PTS (µs with a
1800 s base, M). VC‑1 from Matroska carries no PTS, only decode order: display times must be rebuilt
from picture types (M, MD §7g).

### 10.6 Events (`EN_NOTIFY_EVENT`)

Numbering from the name table in `libstplayer` (S); the ones marked were observed (M):

| No. | Name | | No. | Name |
|---|---|---|---|---|
| 0 | FILE_READ | | 18 | NOT_SUPPORT (treated as fatal) |
| 3 | **INIT_OK** (M, ≈ 0.4–0.5 s after preroll) | | 19 | **PLAYING_OK** (M) |
| 4 | INIT_FAIL (fatal) | | 20 | AUDIO_ONLY |
| 5 | INVALID_FILE | | 21 / 22 | SETPLAYPOSITION_ACK / SETTRICKMODE_ACK |
| 8 | DECODE_ERROR (counted) | | 23 | DISPLAY_RDY |
| 9 | DECODE_DONE (film end) | | 24 | **ES_FLUSH_DATA_RDY** (M, after `MM_SetFlushData`) |
| 10 | **DECODE_FIRST_FRAME_DONE** (M, with INIT_OK) | | 25–31 | title/edition/chapter acks, DTCP info, demux reset, next fragment |
| 14 | AUDIO_TRACK_CHANGED | | 32 / 33 | TEXTURE_FRAMEBUFFER_ALLOCATE / RENDER |
| 17 | AUDIO_UNSUPPORTED (fatal) | | 34 | **VIDEO_DECODER_START** (M, shortly after `MM_Play`) |

Not listed: 1 FILE_SEEK, 2 FILE_TELL, 6/7 THUMBNAIL_DONE/ERROR, 11 DECODE_BACKWARD_TO_FILE_START,
12 INTERNAL_SUBTITLE_TYPE_TEXT, 13 PROGRAM_CHANGED, 15/16 DEMUX_HEADER_OK/FAIL (S, never seen on our
ES items). Events of an item that was already deleted can still arrive; filter on `data[0] == item`.

## 13. DirectFB, GPU and input

### 13.1 Joining the DirectFB session

```sh
export DIRECTFB_SESSION=0
# DFBARGS = every non-comment line of /mslib/directfbrc ("name = value" -> "name=value"), comma-joined, plus:
DFBARGS="$DFBARGS,dfbinfo-dir=/mslib/libdfbinfo.so"
```

| Fact | Status / source |
|---|---|
| DirectFB **1.4.2**, MStar fork, multi‑application (fusion world 0, `/dev/fusion0`–`7`); launcher, web engine, Cobalt, Netflix, boot animation and Kodi are clients of one session | M, ARCH 6.2 |
| `dfbinfo-dir` must name the **library** `libdfbinfo.so`, not a directory; it reads `/config/dfbrc.ini` (`video-phys`, `video-length`, GOP options). Without it: "Please supply 'video-phys' …" / "Could not join 'system_core'" | M |
| Frame buffer from `/config/mmap.ini` (`E_DFB_FRAMEBUFFER`, physical `0x1B7DE000`, 117 MB) | S |
| No `/dev/fb*`, no DRM/KMS/GBM, no X11, no Wayland | M |
| Three layers 0–2, identical, each on its own GOP; primary layer 1920 × 1080, pixel format `0x00418c04` (ARGB) | M |
| **Which layer the launcher uses changes between boots.** MStar's `GetWindow()` returns the layer's first window for any id; the layer whose window has opacity > 0 is the launcher's. Put your window there, stacking class `DWSC_UPPER`, then raise it | M |
| **MStar structures are larger than the 1.4.2 headers:** `GetConfiguration()` writes 36 bytes into the 32‑byte `DFBDisplayLayerConfig`, `GetDeviceDescription()` 240 into 236. Wrap every structure in a zeroed buffer with spare room | M |
| Graphics layers are blended per pixel by alpha over the video plane; clear alpha to 1 for opaque output (`glColorMask(0,0,0,1)` + clear), keep alpha 0 where video should show | M |
| A client prints `MApi_GOP_Exit fail` twice at exit; harmless. `dfbdump` and `/usr/local/bin/screenshot` do not work (0‑byte files) | M |
| Graphics planes get no picture processing; the video plane does (a Full‑HD photo copy looks colder than the 4K original on video) | M (eye test) |

### 13.2 EGL / GLES

`libEGL.so`/`libGLESv2.so` → `/mslib/libMali.so` (Mali‑470 MP, Utgard r8p0, **GLES 2.0 only**, EGL
1.4). `EGL_DEFAULT_DISPLAY`; native window = the window's `IDirectFBSurface*`. No high precision in
fragment shaders ("High precision not supported, instead compiling high precision as medium
precision", S): keep scalers bilinear (M for the probe output, ARCH 6.4).

### 13.3 Input

| Fact | Status |
|---|---|
| `/dev/input/event0` "MStar Smart TV IR Receiver"; `systemserver` (and DirectFB) read it as well | M |
| `EVIOCGRAB` takes it exclusively (the whole device; there is no per‑key grab); the kernel releases the grab when the process exits or crashes | M, U |
| No `/dev/uinput` (M). Writing events back into `event0` does not reach other readers, and with a grab only the grabbing process sees them, according to the Linux 4.9 evdev/input code (S). A test tool `native/evinject.c` exists; its result is not recorded | M / S |
| While a program holds the grab, the launcher sees no keys: its screen‑saver and auto‑standby timers must be re‑armed from outside (§4.1 `refreshGlobalTimer`) | M, U |

---

## 14. Read-only timing observables

### 14.1 Interrupt counters (`/proc/interrupts`, read only)

`tools/irq24.sh <seconds>` reads `/proc/interrupts` twice and prints every rate between 5 and 300/s.

| IRQ | Name | Meaning on this TV | Status |
|---|---|---|---|
| **51** | (none) | **the video path**: present only during playback, runs at the **output** rate of the video (59.94, 50, 23.97 …) | M |
| 52 | "gop, local dimming" | ≈ 120/s with 59.94 Hz and with 23.976 Hz output, ≈ 110/s at 50 Hz on the file path: panel/GOP timing, not the video rate | M |
| 42 | "scaler" | ≈ 239/s at 60 Hz file playback, ≈ 167–168/s with 24p ES playback, ≈ 120/s idle | M |

Precision: an 8 s window (±0.125/s) separates 24 from 25/30/60, not 23.976 from 24.000; a 120 s
window (±0.008/s) showed 23.998 for a 24.000 film.

### 14.2 Kernel log lines (`dmesg`, read only; never `dmesg -c`)

| Line | Meaning | Status |
|---|---|---|
| `BW Window … WxH … interlace:N … Vfreq=NNN` | scaler **input** line, `Vfreq` in 0.1 Hz (239 = 23.9, 250 = 25, 300 = 30, 500 = 50 fields, 599 = 59.9); `interlace:1` = fields (a progressive 720×576 rip arrives as 576i). With Netflix and the ES path it matched the content rate. On the file path it is **not** the output rate: a 23.976 test clip showed `Vfreq=239` while IRQ 51 ran at 60/s, a VC‑1 23.976 film showed `Vfreq=599`. Take the output rate from IRQ 51 | M, VERS §5b, HWV §7 |
| `MApi_VDEC_EX_V2_Init … CodecType` | which decoder the service started (§10.4) | M |
| `binder_alloc: … binder_alloc_buf size … failed, no address space`, `transaction failed 29201/-28` | Binder transaction too large (§10.8) | M |
| `_KDrv_XC_GCE_WriteDlcCurveAdl … FAILED` | ≈ once per minute when idle, none during film; harmless | M |
| `Do not repeatedly switch DS!` after a VDEC exit | seen right before the `tvmain` crash (§8.6) | M |
| `Create coredump file to …`, `the core is saved to …` | core dumps; some already during a stock boot | M |
| `Coredump_setup` | `core_pattern` rewritten from the kernel command line | M |
| `[FRC]g_6m70_slaveid_w is 0x240` | external MEMC chip "6m70" (serial boot log) | M |

Ring buffer overflow: in long runs the interesting lines were already gone; read the log close to the
event (M).
