# Hisense 55U8QF and Flex TV architecture

This report describes one European 55U8QF on VIDAA U4 `V0000.01.00C.P0219` and Linux `4.9.44`.
Firmware strings, board markings, runtime observations and static library analysis are identified
separately in the text. A hardware block named in a vendor library may be present without the
specific rate, format or behavior having been measured.

## Hardware and binary compatibility

| Item | Observation | Evidence |
| --- | --- | --- |
| SoC | MStar MSD6886. Platform `mstar6886`, internal `m7322` and player family `VD6886V_EU` | Platform probe and launcher capabilities |
| Main board, T-CON, PSU | `RSAG7.820.9660`, `RSAG7.820.9602`, `RSAG7.820.8847` respectively | Board markings on the reference set |
| CPU | Four ARM cores. Cortex-A55 identification, 32-bit ARMv7 userland, NEON and VFP | CPU probe and `/proc/cpuinfo` |
| GPU | Mali-470 MP (Utgard), EGL and GLES 2.0, `utgard-r8p0-01rel0` | EGL/GL strings |
| Display | 3840 × 2160. Boot evidence identifies a separate `6m70` frame-rate/MEMC device | Resolution and boot observations. No direct post-6m70 timing capture |
| Memory | Linux sees 897,940 KiB RAM and ~220 MB zram swap. Vendor graphics and decoder reservations sit outside the general-purpose Linux total | `/proc/meminfo` and runtime reservations |
| Storage | ~3.69 GiB eMMC, 37 numbered partitions plus boot devices and RPMB | Partition inventory |
| Ethernet | Negotiated 100 Mbit/s. Plain HTTP reached about 11.7 MB/s | Link report and transfer measurement |
| Wireless/I/O | MT7668 Wi-Fi/Bluetooth, USB 2.0 controllers, IR and evdev | Kernel modules and probes |

The executable ABI is ARM EABI5, little-endian, soft-float argument passing with VFP/NEON available
(`softfp`), ELF interpreter `/lib/ld-linux.so.3`, EGLIBC 2.18 and an old GCC 4.8 era C++ runtime.
Kodi 21.3 brings its own C++ runtime. The port uses a conservative ARM target and the linker
layout in the Kodi repository. The old loader expects dynamic and PLT relocation records in a
layout that needed adjustment. Inspect the target ELF interpreter, dynamic dependencies and
GLIBC symbol versions before assuming a successful link implies a runnable program.

## Filesystem and process roles

The firmware root, system executables and vendor libraries supply the base runtime. The project
uses the existing writable app and user areas. `/mslib` resolves to the TV service library
directory. `/APPS/channelA/hisenseUI` contains the launcher bundle and its `index.html`. `/APPS/kodi`
contains the bundled Kodi runtime and wrappers. `/APPS/kodi-home` is a separate user state area
for settings and Kodi's database. `/OAD/flexkodi` was used for rebuildable artwork cache where that
partition had space. `/tmp` holds requests, heartbeats and playback sessions that expire with a
reboot. The launcher's native file API exposes its application-data directory under
`/var/local/applications/UI`. On this TV the launcher runs under device account 10009.

BusyBox init mounts the TV's runtime and writable volumes before starting the TV services,
app manager and launcher. Manufacturer app lifecycle and source selection are separate from
the UI skin. TV standby/resume and process restart can leave UI state or player status stale,
so a live process or a single store field is insufficient evidence of current activity.

| Component | Role | Communication |
| --- | --- | --- |
| `tvmain` | TV sources, playback front end, UI service and native state | Cobalt bridge for UI commands, media libraries for playing |
| `MiMwIpcSrv` and media libraries | Native media item lifecycle, decoder and audio ownership | Vendor Binder interfaces and shared payload buffers |
| App manager | Launches/suspends apps and emits lifecycle messages | Existing GUI service and native app manager library |
| `hisenseUI` | Cobalt HTML/ES5 launcher and Vuex state | `window.UI`, `modeljs` and `hisense.file` |
| `flex.js` / `flex.css` | Home, tiles, Kodi handoff, slideshow, themes, source UI | Reuses the launcher's existing objects and events |
| Kodi `kodi-directfb` | UI, library, demux, path selection and player control | DirectFB/EGL, evdev, launcher IPC and ES helper |
| `flex_es_helper` | Owns one clear-stream native media item at a time | Local descriptors to Kodi, native service ABI |
| Denon bridge | Receiver settings, labels, HDMI input state | Local request/response files, TCP/HTTP to the configured AVR |

The reference set has a serial service interface. Bring-up found the cable's TX and RX assignment
had to be reversed to match the peer. SSH was later the normal control and transfer channel in
the project, reducing the need for serial round trips. The build and install workflow here begins
with a development account you already have authorization to use. Pin its SSH host key and keep
device credentials and serial logs in a private workspace.

## Launcher and controls

The OEM launcher is a Vue/Vuex application running in Cobalt. The bundle provides `UI` for its
lifecycle and key acknowledgement, `modeljs` for source, audio, CEC and media calls, and
`hisense.file` for application-local files. The mod links its stylesheet and its script around
the existing bundle in `index.html`. Cobalt on the reference firmware needs ES5 JavaScript.
Static CSS works more predictably than repeatedly inserting live style nodes.

Flex TV subscribes to the existing lifecycle and reuses `UI.guiService`. Creating a second service
object disrupted vendor app launch because acknowledgement/event ownership moved away from the
original launcher. Handle a consumed key once and give the normal dispatcher any key unclaimed
by the active Flex overlay. The stock menu, remote keys, native apps, HDMI and Home share
this dispatcher. The mod deliberately guards transitions across those surfaces.

The general playback lifecycle is `request → validate → activate source → wait for state
→ own one session → release → return to requested source`. In particular, the app/window store
and the player vectors can disagree with the current HDMI input after an asynchronous transition.
`dmpActive()` combines the available signals, including a check for a real physical input.
`launcherSig()` helps recheck the launch context after an asynchronous AVR switch.

## Graphics and video are separate

```text
GUI: Cobalt or Kodi → GLES 2 rasterization → DirectFB/Fusion → GOP/OSD → composition
Media: file or codec payload → tvmain/DMP or ES client → native player → VDEC
       → display scheduling / MVOP → XC scaler and picture processing → link → 6m70 → panel
```

- **GOP/OSD** is the graphics plane family. The usable GUI is 1920 × 1080 even though the panel
  is UHD. Scaling the UI window on the graphics side leaves this starting resolution unchanged.
- **DirectFB** is a vendor fork of 1.4.2. Kodi joins the existing Fusion/DirectFB session instead
  of starting a new primary device. EGL and Mali GLES 2 render its GUI into a DirectFB window.
  Buffer format, alpha and commit order matter. The GUI needs an opaque backing for menus and a
  transparent region while the TV video plane occupies the window.
- **VDEC** decodes compressed video. The media players, not the Mali graphics context, talk to it.
  MStar Utopia, DMS, MVOP, XC and display-related libraries and traces support the video-chain
  interpretation. The exact boundary of each driver's rate-conversion responsibilities was inferred.
- **XC** supplies scaler and picture processing for the video path. The logs report its input
  resolution and `Vfreq` in tenths of a hertz. IRQ 51 tracks the video cadence on this firmware.
  IRQ 52 (GOP/local dimming) stayed near 120/s in several tests at different video rates.
  These observations establish the cadence within the SoC and do not establish the panel cadence.
- **DMP/vdplayer** is the file/USB/DLNA lineage. Both DMP and ES can use VDEC, yet DMP chose
  ~59.94 frames/s for a 23.976p file and ~50 for the checked 25p/50p material. Some scaler messages
  reported the content's input cadence even when DMP used a different cadence.
- **ES/mstplayer** accepts clear codec access units and timing metadata. The standalone client
  measured ~23.97–23.98 IRQ/s for 23.976p. An exact 24p test produced 23.998/s across 120 s and
  `Vfreq=240`. The native Netflix app running normally was a comparison oracle for cadence.
  YouTube, Prime, browser and HbbTV references appear in vendor media configuration, which alone
  is insufficient to assign each observed app an exact live decoder route.

See [native players and media profiles](07-player-profiles-and-cadence.md) for the app-by-app comparison and the
process, profile and session roles. The [hardware decoder lab](02-hardware-decoder.md)
covers codec numbers, packet layout, startup order and buffer limits.

## Audio and source selection

The board exposes an MStar-MAD ALSA device. The native media path can feed TV speakers or
HDMI ARC. ARC returns audio to the receiver while HDMI CEC handles control and active-source
signalling. These are separate mechanisms. The AVR input and physical TV input each have their
own state, so a successful HDMI 1 selection does not guarantee that the AVR chose the
desired console connector.

Kodi's ES branch can pass AC-3, E-AC-3 and AAC where supported. Its conversion path decodes
otherwise unsupported audio in software and encodes AC-3 up to 5.1, preserving multichannel
sound over the tested ARC arrangement. This is the limit of the conversion implementation.
Device-specific E-AC-3 support remains a separate capability. ARC volume changes go through
the existing TV/CEC key path. An optional read-only receiver URL makes Kodi's volume graphic
reflect the receiver value.

Starting Kodi or a native app from Flex Home can return AVR MAIN to TV audio. The return-to-TV-audio path leaves ZONE2 alone. Console selection may power off ZONE2 as part of its known receiver sequence. A console request holds transient state until the receiver selection is
confirmed, TV HDMI 1 is selected and any eligible CEC wake is complete. Returning Home,
choosing a different source or an application start can supersede that state. A TV media
session must release its decoder and window before handing the display back to HDMI or an app.

## Verified and still open

The reference unit provided hardware/ABI observations, DMP and standalone ES cadence, brief
HEVC Main 10 SDR high-bitrate playback, ARC with the selected receiver and real launcher
transitions. The Kodi source implements the ES integration. A paired, long IRQ capture for the
final in-Kodi route, direct post-FRC measurement, HDR/DRM behavior, other firmware,
unrestricted bitrate and simultaneous decoder ownership remain unverified.
