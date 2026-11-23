#!/bin/sh
# Boot-Animation: eigene Bilder aus /APPS/flexboot/anim per Bind-Mount über das Original
# /usr/local/animation/hisense legen (Original bleibt unverändert auf der Partition).
# Abschalten ohne Deinstallation: touch /APPS/flexboot/anim.off
# Hintergrund-Sets (mods/theme): die Seite "Bilder" im Launcher schreibt die Auswahl nach
# /var/local/applications/UI/flexss/settings.json (ist hier schon eingehängt: rcS mountet
# /var/local vor start-firewall.sh). Hier wird /APPS/flextheme/current darauf umgestellt, bevor
# Boot-Animation und Launcher starten; die Boot-Animation kommt dann aus dem Set.
# Der Ordner ist für alle beschreibbar: nur Namen aus [A-Za-z0-9._-], nicht mit Punkt beginnend,
# und nur, wenn das Set vollständig existiert.
D=/APPS/flexboot
T=/APPS/flextheme
LOG=$D/boot.log
[ -f $LOG ] && [ "$(wc -c < $LOG)" -gt 65536 ] && mv $LOG $LOG.old
{
  echo "=== flexboot $(date) ==="
  ANIM=$D/anim
  if [ -d $T ]; then
    # Ziel der Verknüpfung (BusyBox hat kein readlink)
    cur=$(ls -l $T/current 2>/dev/null | sed -n 's/.*-> //p')
    id=$(sed -n 's/.*"wallpaper"[ ]*:[ ]*"\([A-Za-z0-9._-]*\)".*/\1/p' \
      /var/local/applications/UI/flexss/settings.json 2>/dev/null | head -n 1)
    case "$id" in .*) id="" ;; esac
    if [ -n "$id" ] && [ "$id" != "$cur" ] && [ -f "$T/$id/wallpaper.webp" ] && [ -f "$T/$id/anim/animation.cfg" ]; then
      ln -sfn "$id" $T/current && cur=$id
    fi
    echo "Design: ${cur:--} (Auswahl: ${id:--})"
    [ -f $T/current/anim/animation.cfg ] && ANIM=$T/current/anim
  fi
  if [ -f $ANIM/animation.cfg ] && [ ! -f $D/anim.off ]; then
    if mount -o bind $ANIM /usr/local/animation/hisense; then
      echo "Boot-Animation: FLEX (bind-mount $ANIM)"
    else
      echo "Boot-Animation: bind-mount fehlgeschlagen, Original bleibt"
    fi
  else
    echo "Boot-Animation: Original"
  fi
} >> $LOG 2>&1

# Zeitmesser (Hintergrund, max. 2 min): wann laufen boot_animation und hisenseUI, wie viel CPU
# braucht die Animation (utime+stime in Ticks, 100/s). Ergebnis: $D/timeline.log
(
  T=$D/timeline.log
  echo "=== $(date) (Zeiten = Sekunden seit Kernelstart) ===" > $T
  ba=""; ui=""; cpu=""; n=0
  while [ $n -lt 600 ]; do
    up=$(cut -d' ' -f1 /proc/uptime)
    p=$(pidof boot_animation)
    if [ -n "$p" ] && [ -z "$ba" ]; then ba=$p; echo "$up boot_animation gestartet (pid $p)" >> $T; fi
    [ -n "$p" ] && cpu=$(awk '{print $14+$15}' /proc/${p%% *}/stat 2>/dev/null)
    if [ -n "$ba" ] && [ "$ba" != "fertig" ] && [ -z "$p" ]; then
      echo "$up boot_animation beendet (CPU $cpu Ticks)" >> $T; ba=fertig
    fi
    u=$(pidof hisenseUI)
    if [ -n "$u" ] && [ -z "$ui" ]; then ui=$u; echo "$up hisenseUI gestartet" >> $T; fi
    [ "$ba" = "fertig" ] && [ -n "$ui" ] && break
    usleep 200000
    n=$((n + 1))
  done
  echo "$(cut -d' ' -f1 /proc/uptime) Messung Ende" >> $T
) >/dev/null 2>&1 &
