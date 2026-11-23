#!/bin/sh
# FLEX·TV Startseiten-Mod installieren (in einer autorisierten TV-Entwicklungs-Shell).
# Erwartet flex.css, flex.js, wallpaper.webp und die PNGs (Kacheln, Wetter-Icons) in /tmp/flexmod/.
# Reversibel: uninstall.sh. Idempotent: index.html wird immer aus dem Backup neu erzeugt.
U=/APPS/channelA/hisenseUI
SRC=/tmp/flexmod

[ -f $U/index.html ] || { echo "FEHLER: $U/index.html fehlt"; exit 1; }
# Ein geprüfter vollständiger Launcher-Backup ist Voraussetzung.
[ -d /APPS/.flexbak-hisenseUI-channelA ] || [ -s /APPS/.flexbak-on-pc ] || { echo "FEHLER: Vollbackup des Launchers fehlt (TV-Ordner oder Marker /APPS/.flexbak-on-pc)"; exit 1; }
for f in flex.css flex.js wallpaper.webp loading.jpg loading-blur.jpg tile-kodi.png tile-sources.png tile-allapps.png tile-gallery.png wx-cloudy.png; do
  [ -s $SRC/$f ] || { echo "FEHLER: $SRC/$f fehlt"; exit 1; }
done
# Schutzregel 1 (analysis/audit-app-launch-20261028.md): flex.js darf keine eigenen nativen Objekte
# anlegen. Ein zweites GUI-Service-Objekt hat alle App-Starts blockiert (AppControl bekam kein
# "appEventMessage" mehr). Darum "guijs" und "createService" nur in Kommentaren erlaubt:
# Kommentare (// und /* */, auch mehrzeilig) entfernen, Strings dabei überspringen, dann suchen.
# Treffer -> Abbruch, bevor irgendetwas geändert wird. Scheitert die Prüfung selbst (awk-Fehler,
# leere Ausgabe), wird ebenfalls nicht installiert.
awk -v sq="'" '
{
  line = $0; out = ""; q = ""; i = 1; n = length(line)
  while (i <= n) {
    c = substr(line, i, 1); d = substr(line, i, 2)
    if (inb) { if (d == "*/") { inb = 0; i += 2 } else i++; continue }
    if (q != "") {
      out = out c
      if (c == "\\") { out = out substr(line, i + 1, 1); i += 2; continue }
      if (c == q) q = ""
      i++; continue
    }
    if (d == "/*") { inb = 1; i += 2; continue }
    if (d == "//") break
    if (c == "\"" || c == sq) q = c
    out = out c; i++
  }
  print out
}' $SRC/flex.js > $SRC/flex.js.code || { rm -f $SRC/flex.js.code; echo "FEHLER: Prüfung von flex.js fehlgeschlagen, nichts installiert"; exit 1; }
[ -s $SRC/flex.js.code ] || { rm -f $SRC/flex.js.code; echo "FEHLER: Prüfung von flex.js ergab nichts, nichts installiert"; exit 1; }
if grep -q -E 'guijs|createService' $SRC/flex.js.code; then
  rm -f $SRC/flex.js.code
  echo "FEHLER: flex.js enthält guijs/createService außerhalb von Kommentaren (Schutzregel 1), nichts installiert"
  exit 1
fi
rm -f $SRC/flex.js.code

# Validate the expected stock markup before changing the installation.
index_source="$U/index.html"
[ ! -f "$U/index.html.flexbak" ] || index_source="$U/index.html.flexbak"
index_candidate="$SRC/index.html.flex-ready"
sed -e 's#<link href=./static/css/app.css rel=stylesheet>#&<link href=./static/flex/flex.css rel=stylesheet>#' \
    -e 's#<body>#&<div id=flex-loading><div class=fl-full></div><div class="fl-dot d1"></div><div class="fl-dot d2"></div><div class="fl-dot d3"></div></div>#' \
    -e 's#</body>#<script src=./static/flex/flex.js></script>&#' \
    "$index_source" > "$index_candidate" || exit 1
if ! grep -q 'static/flex/flex.css' "$index_candidate" ||
   ! grep -q 'static/flex/flex.js' "$index_candidate" ||
   ! grep -q 'id=flex-loading' "$index_candidate"; then
  rm -f "$index_candidate"
  echo "FEHLER: Launcher-Markup passt nicht, nichts installiert"
  exit 1
fi

# 1) Original-index.html einmalig sichern (nie überschreiben)
[ -f $U/index.html.flexbak ] || cp -a $U/index.html $U/index.html.flexbak

# 2) Mod-Dateien nach static/flex/; die bisherige Fassung als *.prev behalten (zurück:
#    mv flex.js.prev flex.js usw.; -p behält Leserechte und Besitzer der vorherigen Datei)
mkdir -p $U/static/flex
for f in flex.js flex.css; do
  [ -f $U/static/flex/$f ] && cp -p $U/static/flex/$f $U/static/flex/$f.prev
done
cp $SRC/flex.css $SRC/*.png $U/static/flex/
# Hintergrund + Ladebild: mit den Hintergrund-Sets (mods/theme) sind das Verknüpfungen auf das
# gewählte Set -> dann nicht anfassen (cp würde durch die Verknüpfung ins Set schreiben)
for f in wallpaper.webp loading.jpg loading-blur.jpg; do
  [ -L $U/static/flex/$f ] || { cp $SRC/$f $U/static/flex/$f && chmod 644 $U/static/flex/$f; }
done
cp "$SRC/flex.js" "$U/static/flex/flex.js" || exit 1
chmod 755 $U/static/flex
chmod 644 $U/static/flex/flex.css $U/static/flex/*.png
chown 10009:10009 $U/static/flex/flex.js
chmod 400 $U/static/flex/flex.js

# Install the checked entry point with the reference launcher account.
cp "$index_candidate" "$U/index.html.new" || exit 1
chown 10009:10009 "$U/index.html.new" || exit 1
chmod 555 "$U/index.html.new" || exit 1
mv "$U/index.html.new" "$U/index.html" || exit 1
rm -f "$index_candidate"

sync
echo "OK: Mod installiert"
ls -la $U/index.html $U/index.html.flexbak $U/static/flex
md5sum $U/static/flex/*.*
