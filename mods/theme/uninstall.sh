#!/bin/sh
# FLEX·TV Hintergrund-Sets entfernen (auf dem TV als root). Startseite und Ladebildschirm
# bekommen wieder feste Dateien (Interstellar), die Boot-Animation nimmt wieder
# /APPS/flexboot/anim. Die Auswahl in flexss/settings.json bleibt liegen (wirkungslos).
T=/APPS/flextheme
U=/APPS/channelA/hisenseUI/static/flex
for f in wallpaper.webp loading.jpg loading-blur.jpg; do
  if [ -L $U/$f ]; then
    rm -f $U/$f
    [ -f $T/interstellar/$f ] && cp $T/interstellar/$f $U/$f && chmod 644 $U/$f
  fi
done
rm -f $U/theme /var/local/applications/UI/flexss/themes.json
rm -rf $T
sync
echo "OK: Hintergrund-Sets entfernt"
ls -la $U | grep -E 'wallpaper|loading'
