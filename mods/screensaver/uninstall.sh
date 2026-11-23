#!/bin/sh
# Bilder des FLEX·TV-Bildschirmschoners entfernen (auf dem TV als root). Ohne Bilder blendet
# flex.js im Leerlauf nur die Oberfläche aus; ganz aus: SCREENSAVER = null in flex.js.
rm -rf /APPS/flexss /var/local/applications/UI/flexss
rm -f /APPS/channelA/hisenseUI/static/flex/ss
sync
echo "OK: Bildschirmschoner-Bilder entfernt"
