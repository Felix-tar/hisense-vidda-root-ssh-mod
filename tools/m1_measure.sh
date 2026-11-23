#!/bin/sh
# M1 (docs/kodi/VIDEOCHIP-ANALYSE.md §7): Ausgaberate während einer App-Wiedergabe. NUR LESEN.
# IRQ 51/52 über ${1:-20} s, letzte "BW Window"-Zeilen (XC-Eingangstakt), Thread-Namen von MiMwIpcSrv.
# Der App-Prozess selbst wird nicht gelesen.
T=${1:-20}
[ -f /tmp/irq24.sh ] || { echo "irq24.sh fehlt"; exit 1; }
echo "== IRQ ($T s)"; sh /tmp/irq24.sh "$T" | grep -E ' (51|52):|Fenster'
echo "== BW Window"; dmesg | grep "BW Window" | tail -3
echo "== MiMwIpcSrv-Threads"
for p in /proc/[0-9]*; do
  [ "$(cat $p/comm 2>/dev/null)" = MiMwIpcSrv ] || continue
  for t in $p/task/*; do cat $t/comm 2>/dev/null; done | awk '{c[$0]++} END {for (k in c) printf "%s x%d, ", k, c[k]; print ""}'
done
echo "== läuft Netflix?"; for p in /proc/[0-9]*; do [ "$(cat $p/comm 2>/dev/null)" = netflix ] && echo "ja (pid ${p#/proc/})"; done
