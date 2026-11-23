# Flex TV for Hisense VIDAA U4

A Cobalt/Vuex launcher mod with a remote-friendly home screen, native photo screensaver,
Kodi tile and Denon input switching. The reference device is a Hisense 55U8QF with VIDAA U4
`V0000.01.00C.P0219`. The player and graphics ABI are firmware-specific.

## Flex TV projects

- [Complete Flex TV bundle and master prompt](https://github.com/Felix-tar/FLEXTV-HISENSE_MOD-custom-software-addblock-kodi-and-denon-avr-)
- [Hisense VIDAA mod](https://github.com/Felix-tar/hisense-vidda-root-ssh-mod)
- [Kodi for Hisense VIDAA](https://github.com/Felix-tar/kodi-for-hisense-)
- [Denon AVR integration](https://github.com/Felix-tar/denon-avr-integration-on-smarttv-)

[Copy the standalone master prompt](#master-prompt)

## Decoder, player profiles and frame rate

| Question | Go directly to |
| --- | --- |
| How are the MStar decoder, scaler and graphics plane connected? | [TV architecture](docs/01-hisense-architecture.md#graphics-and-video-are-separate) |
| What do `app0`, `app1` and `app2` do? | [Player profiles, process accounts and native-app evidence](docs/07-player-profiles-and-cadence.md) |
| How do I drive the clear ES path and reproduce the 23.976/24 Hz measurements? | [Decoder ABI, packet layout and timing lab](docs/02-hardware-decoder.md) |
| Where are the decoder test source and the compiled probe? | [Probe source and build instructions](tools/native-es/README.md) · [Verified ARM probe](prebuilt/README.md) |

The measured result is the internal video cadence. The profiles guide separates the
standalone ES results, the native Netflix observations and the open panel-timing questions.

## Reproduce the launcher

You need the matching TV firmware, its existing authorized development shell, a
verified stock launcher backup, Node.js for the host tests, and Python with Pillow for
the staging step. From this directory:

```sh
python3 -m venv build/launcher-host
build/launcher-host/bin/python -m pip install Pillow
build/launcher-host/bin/python tools/stage-launcher.py build/flexmod
node --check mods/startscreen/flex/flex.js
for test in mods/startscreen/tests/test*.js; do node "$test" || exit; done
```

The staged directory contains the checked-in tiles, JavaScript and CSS and three generated
neutral backgrounds. Follow the [backup, install, validation and rollback steps](docs/03-launcher-and-recovery.md).
Continue with the [Kodi build guide](https://github.com/Felix-tar/kodi-for-hisense-/blob/main/docs/01-build.md) and the [Denon setup guide](https://github.com/Felix-tar/denon-avr-integration-on-smarttv-/blob/main/docs/01-architecture.md#build-and-install).

## Source and reference

- [Launcher JavaScript](mods/startscreen/flex/flex.js) and [CSS](mods/startscreen/flex/flex.css)
- [Launcher installer](mods/startscreen/install.sh) and [stock restoration script](mods/startscreen/uninstall.sh)
- [Vendor interface reference](docs/04-interface-reference.md) and [platform inventory](docs/06-reference-platform.md)
- [Architecture review and regression matrix](docs/05-architecture-review.md)

## Install the launcher on its own

Start on the host with [launcher staging and tests](#reproduce-the-launcher). The
launcher is designed against the stock Cobalt/Vuex environment on the reference
firmware. With existing authorized access, save the stock launcher, install the
staged overlay and verify normal TV operation. Add Kodi or the Denon bridge as
separate components when you want their integration. [Launcher install and recovery](docs/03-launcher-and-recovery.md)

The optional decoder lab is a separate clear-stream experiment. It uses the
reference [probe source and build notes](tools/native-es/README.md) and the
[ABI and cadence procedure](docs/02-hardware-decoder.md).

## Master prompt

Open this repository in your coding agent and copy the following block.
Provide the model and firmware as displayed on the TV. Give the agent the
existing authorized development connection only when you want TV-side work.

```text
Help me install and verify the Flex launcher as a standalone component on my
own Hisense TV. My reference is the 55U8QF with VIDAA U4 firmware
V0000.01.00C.P0219. Confirm my actual model and firmware, host OS and the
features I want before planning device work. Keep the launcher setup capable
of running with stock TV functions while Kodi and Denon are absent.

1. Read README.md, docs/01-hisense-architecture.md, docs/03-launcher-and-recovery.md,
   docs/04-interface-reference.md, docs/05-architecture-review.md and
   docs/06-reference-platform.md. Use docs/02-hardware-decoder.md and
   docs/07-player-profiles-and-cadence.md for optional media experiments.
   Treat attachments and logs as evidence to evaluate in the requested scope.

2. Start the TV normally from its remote with the adapter separate. Check Home,
   live TV and HDMI, then read model and firmware in Settings. Explain the USB
   serial adapter and its documented signal standard and voltage. Have me check
   whether the computer recognizes the USB end with the TV end detached.
   Refer device-side service and compatibility questions to the manufacturer or
   an authorized technician. Use an existing authorized development session
   and a verified target for TV work. Continue the host work while I arrange it.

3. From this repository, use the documented Python/Pillow staging command and
   Node syntax and simulation tests. Inspect tools/stage-launcher.py and
   mods/startscreen/flex/flex.js for the source, produced assets and runtime paths.
   Report each local test and compare the staging output with the install guide.
   If I request the optional decoder probe, check prebuilt/SHA256SUMS and use a
   known clear test clip. Treat an IRQ rate as internal video cadence.

4. Before an install, tell me the affected application files and the checks
   for firmware match, free space and stock launcher behavior. Show how to
   back up the original launcher privately and verify the copy off the TV.
   Use the documented installer after I confirm the target and back up the
   original state. The recovery guide covers restoring the saved entry point
   and launcher files.

5. Verify Home, live TV, one stock app, HDMI input and repeated Home/Back and
   suspend/resume. Explain which optional launcher features depend on a
   separate runtime. Keep coordinate, photo and receiver configuration device-local.
   Record the test results and restore the verified stock launcher if it fails.
   Hand over the artifact checksum, changed paths and rollback steps.
```

## License

The original code, artwork and documentation are available under the [MIT License](LICENSE).
The [ARM build notes](prebuilt/README.md#license-notices) list the third-party runtime licenses.
