# Hardware decoder lab

This procedure uses self-generated, clear media on the matching Hisense TV. It works from an
already authorized development shell. Establish a known-good idle state and finish one player
session before opening the next. Keep the HDMI video source and native apps available as a
control and record which process owns the media session.

## Two routes with one SoC decoder

| Route | Data and caller | Cadence control on the reference firmware |
| --- | --- | --- |
| DMP, also called the TV file player | `modeljs.mpctrl.PlayMedia` from the launcher. URL opens through `tvmain`, `libhisplayer` and file-player lineage | 23.976/24p played at about 59.94 Hz. 25p/50p examples followed the 50 Hz family |
| ES push | Native client opens an item through `MSrv_MM_PlayerInterface` and delivers timestamped codec access units | Item frame-rate field plus input data. The standalone tool measured about 23.976 or 24 Hz at the internal video route |
| Kodi VideoPlayer | FFmpeg software decode draws through the GUI plane where applicable | Useful fallback for supported material. GUI bounds and CPU limits apply |

Choosing a user-facing `PlayMedia` tag, changing picture settings or looking only at the source
metadata did not switch the file player to content cadence. The native Netflix playback
observation and the standalone clear-stream test supported the ES design. Runtime experiments
with media-service configuration did not establish a robust way to turn DMP into ES. Use the
clear client interface for this lab. See [native players and media profiles](07-player-profiles-and-cadence.md) for
the native-app findings and the relation between process accounts and player configuration.

## Vendor ABI implemented by the helper

The Kodi repository contains the [ES helper source](https://github.com/Felix-tar/kodi-for-hisense-/blob/main/source/native/flex_es_helper.c)
and the [Kodi-helper wire protocol](https://github.com/Felix-tar/kodi-for-hisense-/blob/main/source/kodi-port/kodi-tree/xbmc/cores/TVPlayer/TVEsProtocol.h).
The [standalone probe source](../tools/native-es/flex_es_probe.c) implements the measurement program.
These are firmware-specific observations. Unknown fields are marked and should be preserved
exactly for this ABI until independently understood.

The 32-bit helper loads the matching media/IPC libraries on the TV. The files arrive on the TV
with the firmware. Some library dependencies form a cycle, so the standalone runner uses the
same ordered dependency group for its own process. Kodi isolates that environment in the
helper. The status/control stream is separate from the payload stream. Isolating the helper
also keeps vendor libraries and their initialization constraints out of the Kodi process.

| `ST_MEDIA_INFO` offset | Value used | Meaning on this build |
| --- | --- | --- |
| `0x00`, `0x04`, `0x08` | `0x00010012`, `0x55aa5a5a`, `0x1b0` | Version, magic, length |
| `0x10` | `1` | Observed constant |
| `0x20` | 64-bit all ones | Observed sentinel |
| `0x28`, `0x2c` | `2`, `3` | Clear ES item constants observed in the interface |
| `0x48` | `0x802` | Observed constant |
| `0x50` | video codec below | VDEC selection |
| `0x5c` | `23976` or `24000`, for example | Frames per second in millihertz, rounded from stream rational |
| `0x62`, `0x64`, `0x65` | byte values `1`, `4`, `1` | Observed constants |
| `0xa0` | `5` AC-3 / E-AC-3, `6` AAC | Audio codec |
| `0xa4`, `0xa8` | `1`, `9` | Item configuration constants. Exact semantics remain firmware-specific |

The rest of the 0x1b0 buffer is initialized to zero. The portable TVPlayer protocol carries
width, height and presentation geometry separately. The vendor display-rectangle struct is
`int32_t x, y; uint16_t w, h` on this ABI. Use the stream's display aspect ratio including
sample-aspect ratio when computing the fit in a 3840 × 2160 video plane. A 4:3 full-height
image uses `(480, 0, 2880, 2160)`. Apply and reset the display rectangle only while the item is
valid. Avoid concurrent operations during stop and source changes.

| ES video code | Codec | Evidence |
| --- | --- | --- |
| `1` | MPEG-2 | Decoder initialization |
| `2` | MPEG-4 Part 2 | Decoder initialization |
| `7` | H.264 | Decoder initialization and playback |
| `8` | AVS | Decoder initialization |
| `11` | MJPEG | Decoder initialization |
| `12` | VC-1 Advanced | Decoder initialization and clear Blu-ray stream excerpt playback |
| `0x14` | HEVC | Static mapping and 4K playback |
| `0x15` | VP9 | Static mapping. No equivalent playback validation |
| `0x13` | HEVC 3D | Static mapping only |

The data descriptor carries a pointer to one access unit and three 32-bit fields for size,
PTS in milliseconds and type (`1` video, `0` audio). H.264 and HEVC are in Annex B layout with
parameter sets in-band. VC-1 receives the sequence header before the first frame. Preserve decode
order and presentation timestamps, including B-frame reordering. The helper calls
`MM_PushPayload(item, &descriptor, NULL, 0)`. The library marshals data through shared memory.
Passing the same frame as extra parcel data caused delivery failures on larger keyframes.
The sender could report success despite Binder logging a refused transfer. The fix was to send
the access unit only through the intended payload field and validate playback plus kernel counters.

## Correct item lifecycle

1. Construct the interface object, call `MM_Initialize` and register `AddEventRecipient`.
   Initialize the audio output used by the ES helper.
2. Call `MM_CreateMediaItem` with the zeroed and populated descriptor. Check the returned handle.
3. Send an initial ~1.2–1.5 s of video and audio. Wait for event 3, `INIT_OK`, before calling
   `MM_Play`. The first frame initialized in roughly half a second in the H.264 reference test.
4. Keep a bounded lead over the media clock. Use position and buffer status to avoid filling
   the decoder queue. Retry transient refuses within the client's time budget.
   `MM_GetVideoDataBufferInfo(item, 3, ...)` behaved like a millisecond measurement.
5. Pause/resume with the observed trick-mode forms. For a seek, flush audio and video and wait
   for event 24 before supplying the new keyframe, or create a new helper generation as Kodi
   does on applicable changes. An obsolete status or payload must never apply to a new generation.
6. Mark the last packet with `MM_SetDataEnd` and let the decoder drain. End with one `MM_Stop`,
   then `MM_DeleteMediaItem`. Remove the event recipient and finalize the interface.
   Keep UI release tied to the session that still owns the item.

| Event | Number | Role |
| --- | --- | --- |
| `INIT_OK` / `INIT_FAIL` | 3 / 4 | Initialization succeeded or failed |
| Decode error / done | 8 / 9 | Track errors and end of decode |
| Unsupported audio / item | 17 / 18 | Decline the path or use the selected fallback |
| `PLAYING_OK` | 19 | Playback confirmation |
| ES flush ready | 24 | Old generation is drained and new input can start |

## Reproduce the cadence measurement

1. Generate a 23.976p clip using FFmpeg with H.264 video and E-AC-3 sound. Run a second clip at
   exactly 24 fps by replacing `24000/1001` with `24`. Start with 1080p and a moderate bitrate.

   ```sh
   ffmpeg -f lavfi -i 'testsrc2=size=1920x1080:rate=24000/1001'      -f lavfi -i 'sine=frequency=440:sample_rate=48000' -t 60      -c:v libx264 -pix_fmt yuv420p -preset veryfast -bf 0 -g 48      -c:a eac3 -b:a 384k reference-23976.mkv
   python3 tools/native-es/es_pack.py reference-23976.mkv reference-23976.flxp
   ```

2. Play the MKV in the TV's usual local player. Let it settle. Sample the interrupt rates from the
   authorized shell with `sh irq24.sh 8`, or use an excerpt long enough for `sh irq24.sh 120`.
   `tools/irq24.sh` sums counters for all cores and divides by elapsed `/proc/uptime`.
   Record IRQ 51, 42 and 52 and a relevant, sanitized scaler `Vfreq` line.
3. Stop the TV player normally. Select the local media surface while idle. Build
   `tools/native-es/flex_es_probe.c` with the same ARM Linux ABI and linker script as Kodi
   (see [standalone build](../tools/native-es/README.md)). Copy the generated `.flxp`, the
   probe and its runner to an owned scratch directory. Play the same clip through ES. The
   probe logs initialization, accepted packets and teardown.
4. Measure the same interval in steady playback. Compare to the expectation below.
   Capture a matched idle interval. Use local media or a sufficiently fast LAN feed for
   high-bitrate tests. Streaming through SSH from the build PC was only ~4 MB/s in one run,
   which caused artificial late frames.
5. Stop, wait for the session to close, and verify normal native app and HDMI playback.
   Record both picture and sound observations. Use the Kodi log to confirm whether the
   integrated run that you measure selected ES, DMP or software rendering.

| Reference run | IRQ 51 | Additional evidence |
| --- | --- | --- |
| Home/idle | Absent | IRQ 42 and 52 roughly 120/s |
| DMP, 23.976p file | 59.94–60.2/s | Scaler could report 239 or 599 |
| Native Netflix app, 23.976p film | 23.980/s | IRQ 42 ~167.2/s, `Vfreq=239` |
| Standalone ES, 23.976p H.264/E-AC-3 | 23.970/s | IRQ 42 ~167.8/s. 1440/1440 video and 1875/1875 audio packets accepted |
| Standalone ES, true 24p HEVC | 23.998/s over 120 s | `Vfreq=240` |
| Standalone ES, 4K HEVC Main 10 SDR, 80.5 Mbit/s | 23.97 and 24.04/s in 8 s windows | 60 s, 1440/1440, largest access unit 1.54 MB, no observed late packets, retries, Binder failures or jumps |

IRQ numbers and role are specific to the reference kernel. The correlation supports a
video-path timing interpretation of IRQ 51. It does not independently identify the final panel
refresh or prove exactly where rate conversion occurs. An eight-second sample is too short
to reliably distinguish 23.976 from 24.000. The 4K experiment validates a short SDR stream and
does not establish HDR compatibility or an unrestricted bitrate ceiling. The native ES
client and the integrated Kodi build are separate evidence. Capture the final Kodi path
independently before claiming the table's numbers for it.

## Why playback can look wrong

- **Judder on 24p DMP:** the output belongs to the 59.94 family, so the 24p frames have
  unequal display intervals. Verify the chosen route first. Motion settings did not change
  the measured path cadence.
- **4K glitches at fixed points:** compare access-unit size, the buffering log and the rate
  of the input. The historical oversize transfers exposed client double-marshalling.
  HEVC tier and picture settings did not explain those losses.
- **Soft DVD image:** source raster, display-aspect ratio, scaling and deinterlacing are
  independent. The DVD tests showed material reaching the scaler as SD. Use native
  progressive 50p for a controlled comparison and retain the original media.
- **Black or hidden movie:** an opaque GOP window or the wrong live source can cover a
  correctly decoded native image. Verify source state and clear the GUI video region.
- **No audio:** record route, input codec, actual ARC bitstream and AVR audio mode. ES
  conversion to AC-3 and DMP's native codec support are different decisions.
