# ARM decoder probe

`flex_es_probe` is a standalone clear-stream probe built from
[flex_es_probe.c](../tools/native-es/flex_es_probe.c) with Zig 0.16.0. It targets
little-endian ARMv7 with the soft-float calling convention and imports glibc symbols
up to 2.17. The same command reproduced the binary byte for byte.

```sh
sha256sum -c SHA256SUMS
chmod +x flex_es_probe
```

Use the [probe guide](../tools/native-es/README.md) for the compiler invocation and
the [decoder lab](../docs/02-hardware-decoder.md) for the clear sample clip and the
reference firmware environment. The TV supplies the matching vendor libraries.

## License notices

The probe links to the TV's GNU C Library (glibc) at runtime.
The [Zig license](licenses/Zig-LICENSE), [LGPL 2.1 text](licenses/glibc-LGPL-2.1)
and [glibc notices](licenses/glibc-LICENSES) accompany the build.
The [Zig 0.16.0 source release](https://ziglang.org/download/#release-0.16.0)
includes the toolchain's ARM runtime and glibc startup sources.
