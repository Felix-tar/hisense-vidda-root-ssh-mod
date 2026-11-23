#!/bin/sh
# FLEX·TV Startseiten-Mod entfernen (auf dem TV als root). Danach restart-launcher.sh.
U=/APPS/channelA/hisenseUI
if [ -f $U/index.html.flexbak ]; then
  cp -a $U/index.html.flexbak $U/index.html
else
  echo "WARNUNG: $U/index.html.flexbak fehlt, index.html bleibt unverändert"
fi
rm -rf $U/static/flex
# Debug-Kanal von flex.js (tools/flexdbg.py)
rm -rf /var/local/applications/UI/flexdbg
sync
echo "OK: Mod entfernt"
ls -la $U/index.html
