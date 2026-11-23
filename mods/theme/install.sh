#!/bin/sh
# FLEX·TV Hintergrund-Sets installieren (auf dem TV als root; Dateien in /tmp/flextheme/sets/,
# erzeugt von mods/theme/gen_themes.py, hochgeladen von mods/theme/upload.py).
#   /APPS/flextheme/<id>/       wallpaper.webp, loading.jpg, loading-blur.jpg, thumb.jpg, anim/
#   /APPS/flextheme/current     -> gewähltes Set (setzt /APPS/flexboot/boot.sh bei jedem Start
#                                  aus flexss/settings.json, das die Seite "Bilder" schreibt)
#   static/flex/theme           -> /APPS/flextheme (Vorschauen + Sofortwechsel im Launcher)
#   static/flex/{wallpaper.webp,loading.jpg,loading-blur.jpg} -> current/... (Startseite und
#                                  Ladebildschirm zeigen beim Kaltstart das gewählte Set)
# Rückgängig: mods/theme/uninstall.sh
T=/APPS/flextheme
U=/APPS/channelA/hisenseUI/static/flex
SRC=/tmp/flextheme/sets
L=/var/local/applications/UI/flexss

[ -f $SRC/interstellar/wallpaper.webp ] && [ -f $SRC/interstellar/anim/animation.cfg ] && [ -f $SRC/themes.json ] || { echo "FEHLER: Sets in $SRC fehlen"; exit 1; }
[ -d $U ] || { echo "FEHLER: $U fehlt (Startseiten-Mod zuerst installieren)"; exit 1; }

# Ziel einer Verknüpfung (BusyBox auf dem TV hat kein readlink)
link() { ls -l "$1" 2>/dev/null | sed -n 's/.*-> //p'; }
cur=$(link $T/current)
rm -rf $T.new $T.old
cp -r $SRC $T.new || { echo "FEHLER: Kopieren fehlgeschlagen"; exit 1; }
[ -d $T ] && mv $T $T.old
mv $T.new $T
rm -rf $T.old
[ -n "$cur" ] && [ -f "$T/$cur/wallpaper.webp" ] || cur=interstellar
ln -sfn "$cur" $T/current
find $T -type d -exec chmod 755 {} \;
find $T -type f -exec chmod 644 {} \;

mkdir -p $L
cp $SRC/themes.json $L/themes.json
chmod 644 $L/themes.json

ln -sfn $T $U/theme
for f in wallpaper.webp loading.jpg loading-blur.jpg; do
  ln -sfn $T/current/$f $U/$f
done
sync
echo "OK: $(ls $T/*/wallpaper.webp | grep -vc /current/) Sets, aktiv: $(link $T/current)"
ls -la $U | grep -- '->'
du -s $T
