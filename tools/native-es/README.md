# Native clear-stream measurement

Build on Linux using the verified Zig 0.16.0 toolchain. From this directory:

```sh
zig cc -target arm-linux-gnueabi.2.18 -mcpu=cortex_a7 -mfloat-abi=softfp   -O2 -Wall -o flex_es_probe flex_es_probe.c   -ldl -lpthread -Wl,-T,glibc218-relocations.ld
python3 es_pack.py reference.mkv reference.flxp
```

`es_pack.py` uses FFmpeg and ffprobe. The target runner expects `flex_es_probe` and `es.flxp`
under `/tmp` on the reference TV, or a `FLEX_INPUT` path to locally stored clear data. It sets
the library environment only for its own child process. Start `sh es_run.sh 60` in an authorized shell from an idle media surface. Set `FLEX_ES_PROBE` and `FLEX_INPUT` if the files are in an owned scratch directory. Capture the output privately. Use `irq24.sh` from the parent
tools folder separately to measure the playback. Verify the process exits and the TV input
and native player recover. The same binary is specific to this ARM ABI and the vendor library
build. Follow the [measurement procedure](../../docs/02-hardware-decoder.md#reproduce-the-cadence-measurement).
