#!/bin/sh
# Welche Prozesse sind DirectFB-Clients (/dev/fusion0 offen), und mit welchen DirectFB-Optionen
# (DFBARGS, Ebene) laufen sie? Nur lesen; Umgebung gefiltert auf DirectFB-/Ebenen-Variablen.
for p in /proc/[0-9]*; do
  f=0
  for fd in $p/fd/*; do
    case "$(ls -l "$fd" 2>/dev/null | sed 's/.*-> //')" in /dev/fusion*) f=1; break ;; esac
  done
  [ $f = 1 ] || continue
  echo "== PID ${p#/proc/} $(cat $p/comm 2>/dev/null)"
  sed 's/\x0/\n/g' $p/environ 2>/dev/null | grep -aiE '^(DFBARGS|DIRECTFB|DFB_|.*LAYER|GOP|MST_)' | cut -c1-300
done
