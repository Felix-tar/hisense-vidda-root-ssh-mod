# Launcher setup, tests and recovery

## Establish the baseline

Use the exact reference firmware first, with an already authorized shell and a verified SSH host
key for normal transfers. The reference firmware had no usable devpts for this session, so we ran
commands with SSH PTY allocation disabled. Standard-input and standard-output file/tar streams
worked where the optional SCP/SFTP service tools were absent. Check that the stock TV launcher, one native app, one HDMI input and
the USB media player all work. Record firmware, free space, entry-point and asset owners and
permissions. Copy the full launcher tree and current mod files privately and compare the copy
with a manifest. Test that you can restore the original `index.html` from the same session
before changing anything. Stay on the firmware installed by your device.

## Install the launcher on an authorized development TV

1. Use the matching device and authorized shell in the baseline above. The reference
   installer expects `/APPS/channelA/hisenseUI/index.html` with the stock CSS link,
   `<body>` and `</body>`. Check the launcher before starting.
2. Prepare the stage from the repository root. Use a Python environment with Pillow as shown in the [README](../README.md#reproduce-the-launcher). The included PNGs and generated backgrounds make the stage
   independent of any personal images.

   ```sh
   python3 tools/stage-launcher.py build/flexmod
   tar -czf build/flexmod.tar.gz -C build/flexmod .
   ```

3. Back up the full stock launcher privately. Set `TV_SSH_TARGET` to your existing
   authorized SSH connection and use its verified host key. This example archives
   the reference location on the TV through standard output.

   ```sh
   mkdir -p private
   ssh -T "$TV_SSH_TARGET" 'tar -czf - -C /APPS/channelA hisenseUI' > private/hisenseUI.tar.gz
   gzip -t private/hisenseUI.tar.gz
   tar -tzf private/hisenseUI.tar.gz > private/hisenseUI-files.txt
   sha256sum private/hisenseUI.tar.gz > private/hisenseUI.tar.gz.sha256
   ```

   Check the archive contents and original `index.html` before making the backup
   marker. Keep the archive and its checksum separate from this repository.

4. Stage the payload in a new, private device directory and run the installer.
   After the backup is verified, the marker can record the archive checksum. The
   installer validates stock markup before copying the overlay. The first install
   preserves the original entry point as `index.html.flexbak`.

   ```sh
   ssh -T "$TV_SSH_TARGET" 'cat > /APPS/.flexbak-on-pc' < private/hisenseUI.tar.gz.sha256
   ssh -T "$TV_SSH_TARGET" 'mkdir -m 700 /tmp/flexmod && tar -xzf - -C /tmp/flexmod' < build/flexmod.tar.gz
   ssh -T "$TV_SSH_TARGET" 'sh -s' < mods/startscreen/install.sh
   ```

5. Check the installer output, expected CSS/JS links and launcher ownership. Then
   restart the launcher through your existing development setup or use the TV's
   normal restart. Check Home, live TV, one stock app and HDMI, followed by repeated
   Home/Back and suspend/resume.
6. Install Kodi and Denon using the [Kodi build guide](https://github.com/Felix-tar/kodi-for-hisense-/blob/main/docs/01-build.md)
   and the [Denon setup guide](https://github.com/Felix-tar/denon-avr-integration-on-smarttv-/blob/main/docs/01-architecture.md#build-and-install). Use your authorized service
   management to start the Kodi watcher and the configured Denon bridge. Test each
   service separately before testing the combined handoff.

The launcher exposes optional bounded local logging. Weather is disabled until you put
coordinates and a display label in the `WEATHER` setting. Enabling it makes requests to the
configured weather service. The slideshow native path expects photos you supply locally.
It switches to DMP only while it owns the display. The first image/render and recurring
slide transitions need separate timing checks. Theme assets and any custom boot animation
are optional. Theme data and asset generation scripts are under `mods/theme` and `mods/bootanim`.
Keep the existing boot path recoverable before activating custom assets.

## Code and tests

| Control path | Implementation | Expected behavior |
| --- | --- | --- |
| Home lifecycle and stock app list | `attach`, `onKey`, `resetOwnUi` in `flex.js` | Own overlays close and the original service handles its own apps |
| App warm/cold launch | `launcherSig` and existing app-start handler | A context change cancels an old asynchronous action |
| Kodi tile | `kodiTick` and the watcher | Launch, hidden/minimized, restore, service heartbeat |
| DMP playback | `kpGuard`, `kpPlay`, `kpPoll`, `kpEnd` | Session ownership, exact source, stable play and release before returning |
| Denon HDMI and CEC | Embedded Denon blocks, originals in the AVR repository | AVR MAIN and TV input agree, optional targeted CEC wake, newer selection wins |
| Weather and slides | `fetchWeather` and the photos/gallery functions | Opt-in weather, only local pictures in display tests |

From the repository root, use Node to run each `test*.js` in
`mods/startscreen/tests` and run `node --check mods/startscreen/flex/flex.js`. The harnesses
simulate Cobalt, native file I/O, keys, stores and timers. They are regression tests for the
state transitions. The migration cases in test2 and test3 also accept separately supplied historical fixtures
via FLEX_TEST_BASELINE and FLEX_TEST_M2. Validate app launch, media stop, Home/restore and HDMI handoff on the
matching TV separately.

## Roll back

End any active Kodi, photo or television playback normally. Close the Denon helper via the
service management used to launch it. Restore the saved original launcher `index.html`
and assets with their verified mode and owner. `mods/startscreen/uninstall.sh` handles the
normal same-firmware removal with the expected local backup. Review any user assets in the
mod directory before using it. Then restart the normal launcher, check Home, HDMI and native
apps, and compare the restored files to your backup. Use the mechanism documented for your
authorized environment for any optional service you installed.

Keep backups off the public tree. Archive the launcher with modes and links preserved,
the installed runtime, local user state and an inventory of any private configuration.
Do not use a mod-state archive as a firmware image. Prefer restoring files from a separately
verified copy to replaying raw device or boot state.
