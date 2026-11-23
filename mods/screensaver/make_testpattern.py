#!/usr/bin/env python3
"""4K-Prüfbild: zeigt eindeutig, ob ein Bild in echtem 3840x2160 oder in 1920x1080 ankommt.

  python mods/screensaver/make_testpattern.py   -> mods/screensaver/test4k.jpg

Rechts ein verstecktes "4K": Buchstaben aus senkrechten 1-Pixel-Streifen auf einem Hintergrund
aus waagerechten 1-Pixel-Streifen. In echtem 4K ist das "4K" (aus der Nähe) zu sehen; wird das
Bild auf 1920x1080 verkleinert, werden beide Muster zum selben Grau und das "4K" verschwindet.
Links kleine Schrift (16 und 24 px): in 4K scharf, in Full-HD verschwommen.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent / "test4k.jpg"
W, H = 3840, 2160


def main():
    im = Image.new("L", (W, H), 60)
    d = ImageDraw.Draw(im)
    head = ImageFont.truetype(r"C:\Windows\Fonts\seguisb.ttf", 110)
    d.text((140, 80), "4K-PRUEFBILD  -  aus ca. 50 cm ansehen", font=head, fill=255)

    # rechts: verstecktes "4K" aus Streifen-Orientierung
    x0, y0, x1, y1 = 1960, 360, 3760, 2060
    vert = Image.new("L", (x1 - x0, y1 - y0))
    hori = Image.new("L", (x1 - x0, y1 - y0))
    vd, hd = ImageDraw.Draw(vert), ImageDraw.Draw(hori)
    for x in range(0, x1 - x0, 2):
        vd.line([(x, 0), (x, y1 - y0)], fill=255)
    for y in range(0, y1 - y0, 2):
        hd.line([(0, y), (x1 - x0, y)], fill=255)
    mask = Image.new("L", (x1 - x0, y1 - y0), 0)
    giant = ImageFont.truetype(r"C:\Windows\Fonts\arialbd.ttf", 1250)
    ImageDraw.Draw(mask).text((90, 60), "4K", font=giant, fill=255)
    im.paste(Image.composite(vert, hori, mask), (x0, y0))
    d.rectangle([x0 - 4, y0 - 4, x1 + 3, y1 + 3], outline=255, width=4)

    # links: kleine Schrift
    small = ImageFont.truetype(r"C:\Windows\Fonts\arial.ttf", 24)
    tiny = ImageFont.truetype(r"C:\Windows\Fonts\arial.ttf", 16)
    lab = ImageFont.truetype(r"C:\Windows\Fonts\seguisb.ttf", 56)
    d.text((140, 360), "Schrift 24 px:", font=lab, fill=255)
    for k in range(18):
        d.text((140, 450 + k * 34), "Zeile %02d  Der schnelle braune Fuchs springt ueber den faulen Hund 0123456789" % (k + 1),
               font=small, fill=255)
    d.text((140, 1120), "Schrift 16 px:", font=lab, fill=255)
    for k in range(26):
        d.text((140, 1210 + k * 24), "Zeile %02d  Nur in echtem 4K scharf lesbar - in Full-HD verschwimmt diese Schrift komplett" % (k + 1),
               font=tiny, fill=255)
    im.convert("RGB").save(OUT, quality=96, subsampling=0, progressive=False, optimize=False)
    print(OUT, OUT.stat().st_size)


if __name__ == "__main__":
    main()
