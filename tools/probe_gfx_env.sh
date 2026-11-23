#!/bin/sh
# Read-only: graphics-related environment of the running UI processes and the DirectFB modules
# (run on the TV via tvctl.py runfile). Prints only variables relevant for EGL/DirectFB.
for name in hisense_browser cobalt hisenseUI netflix; do
  for p in $(pidof $name); do
    echo "== $name ($p)"
    sed 's/\x00/\n/g' /proc/$p/environ 2>/dev/null | grep -E '^(EGL|MALI|DFB|DIRECTFB|LD_LIBRARY|LD_PRELOAD|COBALT_|XDG_RUNTIME)'
    grep -E 'directfb|Mali|libEGL|libGLES|fusion' /proc/$p/maps 2>/dev/null | sed 's/.* //' | sort -u 2>/dev/null || \
      grep -E 'directfb|Mali|libEGL|libGLES|fusion' /proc/$p/maps 2>/dev/null | sed 's/.* //'
  done
done
echo "== DirectFB-Module"
find /mslib/directfb-1.4-0 -name '*.so' 2>/dev/null | head -40
echo "== fusion"
ls -la /dev/fusion* 2>/dev/null | head -3
ls /dev/shm/ 2>/dev/null | head -20
