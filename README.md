# Flex TV for Hisense VIDAA U4

A Cobalt/Vuex launcher mod with a remote-friendly home screen, native photo screensaver,
Kodi tile and Denon input switching. The reference device is a Hisense 55U8QF with VIDAA U4
`V0000.01.00C.P0219`. The player and graphics ABI are firmware-specific.

## Flex TV projects

- [Hisense VIDAA mod](https://github.com/Felix-tar/hisense-vidda-root-ssh-mod)
- [Kodi for Hisense VIDAA](https://github.com/Felix-tar/kodi-for-hisense-)
- [Denon AVR integration](https://github.com/Felix-tar/denon-avr-integration-on-smarttv-)

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

## License

The original code, artwork and documentation are available under the [MIT License](LICENSE).
The [ARM build notes](prebuilt/README.md#license-notices) list the third-party runtime licenses.
