#!/bin/sh
# irq24.sh – Interrupt-Raten (5..300/s) über ein Fenster. NUR LESEN. Aufruf: sh /tmp/irq24.sh 120
# (analysis/tvplayer-20261028/24p-plan.md W2; Zeile 51 = Videopfad, 52 = "gop, local dimming")
T=${1:-120}
t0=$(cut -d' ' -f1 /proc/uptime); cat /proc/interrupts > /tmp/i24.a
sleep "$T"
t1=$(cut -d' ' -f1 /proc/uptime); cat /proc/interrupts > /tmp/i24.b
DT=$(awk -v a="$t0" -v b="$t1" 'BEGIN{printf "%.2f", b-a}')
awk -v dt="$DT" '
  function tot(  s,i){ s=0; for (i=2; i<=NF && $i ~ /^[0-9]+$/; i++) s+=$i; ix=i; return s }
  NR==FNR { if ($1 ~ /:$/) a[$1]=tot(); next }
  $1 ~ /:$/ && ($1 in a) { r=(tot()-a[$1])/dt; if (r>=5 && r<=300) {
    n=""; for (j=ix; j<=NF; j++) n=n " " $j; printf "%9.3f/s %s%s\n", r, $1, n } }' /tmp/i24.a /tmp/i24.b
echo "Fenster $DT s"
rm -f /tmp/i24.a /tmp/i24.b
