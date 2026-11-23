#!/bin/sh
# Read-only: welche Geräte-Speicherbereiche hat ein laufender DirectFB-Client eingeblendet?
# (für video-phys/video-length der devmem-Systemschicht; via tvctl.py runfile)
for name in hisenseUI cobalt; do
  p=$(pidof $name | cut -d' ' -f1)
  [ -n "$p" ] || continue
  echo "== $name ($p)"
  grep -E '/dev/(mem|msos|mstar|mali|utopia|ion|mma|fusion|MSOS|malloc)' /proc/$p/maps | head -30
  grep -c . /proc/$p/maps
done
echo "== Geräte"
ls -la /dev/msos* /dev/mstar* /dev/utopia* /dev/mem 2>/dev/null | head
echo "== mmap-Konfiguration"
ls /config/*mmap* /tvconfig/*mmap* /config/mmap* 2>/dev/null | head
