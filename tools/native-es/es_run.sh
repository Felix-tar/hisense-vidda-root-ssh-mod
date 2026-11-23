#!/bin/sh
# Run the clear-stream probe with the firmware runtime environment only for the child.
set -eu
probe=${FLEX_ES_PROBE:-/tmp/flex_es_probe}
input=${FLEX_INPUT:-/tmp/es.flxp}
test -x "$probe"
test -s "$input"
LD_LIBRARY_PATH=/tvservice/mslib:/tvservice/conflictlib:/mslib/utopia:/mslib \
LD_PRELOAD='libmi_glibc.so libmdroid.so libmmapinfo.so libiniparser.so libdrvIPAUTH.so liblinux.so libmsrv_mmplayer_ipc.so' \
  "$probe" "$input" "${1:-60}"
