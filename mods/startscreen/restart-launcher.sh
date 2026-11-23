#!/bin/sh
# Launcher (hisenseUI) neu laden, damit geänderte index.html/flex-Dateien greifen.
# Getestet 2026-10-27: hisenseUI ignoriert SIGTERM, und nach SIGKILL startet der
# App-Manager (bigbang/APPMGR, /etc/vendor/app.cfg) ihn NICHT neu (Bild bleibt ohne UI).
# Zuverlässig ist nur ein Neustart des TVs. Der TV kann danach im Standby sein.
sync
echo "TV wird neu gestartet (Launcher lädt danach die neuen Dateien)"
(sleep 1; reboot) >/dev/null 2>&1 &
