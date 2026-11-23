#!/usr/bin/env python3
"""Erzeugt die Grafiken des Startseiten-Mods (Pillow): Kacheln + Wetter-Icons.

  python mods/startscreen/gen_assets.py      -> mods/startscreen/flex/*.png

Stil: Tokyo-Night/Omarchy (dunkles Navy, Akzent #7aa2f7). Alles 4x gezeichnet und
heruntergerechnet (Antialiasing).
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent / "flex"
FONT = r"C:\Windows\Fonts\seguisb.ttf"  # Segoe UI Semibold

BG_TOP = (36, 40, 59)
BG_BOT = (22, 22, 34)
BLUE = (122, 162, 247)
FG = (232, 236, 255)
YELLOW = (224, 175, 104)
CLOUD = (192, 202, 245)
RAIN = (122, 162, 247)


def gradient(w, h, top, bot):
    im = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(im)
    for y in range(h):
        f = y / (h - 1)
        d.line([(0, y), (w, y)], fill=tuple(int(top[i] + (bot[i] - top[i]) * f) for i in range(3)))
    return im


def tile(name, label, glyph):
    """App-Kachel 402x224 (2x von 6.7rem x 3.733rem), Glyph oben, Text unten."""
    s = 4
    w, h = 402 * s, 224 * s
    im = gradient(w, h, BG_TOP, BG_BOT)
    d = ImageDraw.Draw(im)
    # feine Akzentlinie oben
    d.rectangle([0, 0, w, 3 * s], fill=BLUE)
    glyph(d, w / 2, h * 0.40, s)
    font = ImageFont.truetype(FONT, 44 * s)
    tw = d.textlength(label, font=font)
    d.text(((w - tw) / 2, h * 0.64), label, font=font, fill=FG)
    im.resize((402, 224), Image.LANCZOS).save(OUT / name, optimize=True)


def glyph_sources(d, cx, cy, s):
    # Bildschirm mit Pfeil hinein (Eingang)
    W, H, r = 92 * s, 60 * s, 8 * s
    x0, y0 = cx - W / 2 + 14 * s, cy - H / 2
    d.rounded_rectangle([x0, y0, x0 + W, y0 + H], r, outline=BLUE, width=6 * s)
    ax = cx - W / 2 - 22 * s
    d.line([(ax, cy), (cx + 6 * s, cy)], fill=FG, width=7 * s)
    d.polygon([(cx + 22 * s, cy), (cx + 2 * s, cy - 14 * s), (cx + 2 * s, cy + 14 * s)], fill=FG)


def glyph_allapps(d, cx, cy, s):
    # 3x3 Raster
    n, q, g = 3, 20 * s, 9 * s
    tot = n * q + (n - 1) * g
    for i in range(n):
        for j in range(n):
            x = cx - tot / 2 + j * (q + g)
            y = cy - tot / 2 + i * (q + g)
            d.rounded_rectangle([x, y, x + q, y + q], 5 * s, fill=BLUE if (i + j) % 2 == 0 else FG)


def glyph_gallery(d, cx, cy, s):
    # Bilderrahmen mit Bergen und Sonne
    W, H, r = 96 * s, 64 * s, 8 * s
    x0, y0 = cx - W / 2, cy - H / 2
    d.rounded_rectangle([x0, y0, x0 + W, y0 + H], r, outline=BLUE, width=6 * s)
    m = 9 * s
    d.polygon([(x0 + m, y0 + H - m), (x0 + 36 * s, y0 + 26 * s), (x0 + 58 * s, y0 + H - m)], fill=FG)
    d.polygon([(x0 + 44 * s, y0 + H - m), (x0 + 66 * s, y0 + 34 * s), (x0 + W - m, y0 + H - m)], fill=BLUE)
    d.ellipse([x0 + W - 30 * s, y0 + 12 * s, x0 + W - 16 * s, y0 + 26 * s], fill=YELLOW)


def glyph_kodi(d, cx, cy, s):
    # Mediencenter: abgerundetes Quadrat (auf der Spitze) mit Play-Dreieck, kein fremdes Logo
    r = 40 * s
    d.polygon([(cx, cy - r), (cx + r, cy), (cx, cy + r), (cx - r, cy)], outline=BLUE, width=6 * s)
    t = 15 * s
    d.polygon([(cx - t * 0.7, cy - t), (cx + t * 1.1, cy), (cx - t * 0.7, cy + t)], fill=FG)


# ---- Wetter-Icons (128x128, transparent) ----
def icon(name, draw_fn):
    s = 4
    im = Image.new("RGBA", (128 * s, 128 * s), (0, 0, 0, 0))
    draw_fn(ImageDraw.Draw(im), s)
    im.resize((128, 128), Image.LANCZOS).save(OUT / name, optimize=True)


def sun(d, s, cx=64, cy=64, r=22):
    for k in range(8):
        a = k * math.pi / 4
        d.line([(s * (cx + math.cos(a) * (r + 9)), s * (cy + math.sin(a) * (r + 9))),
                (s * (cx + math.cos(a) * (r + 20)), s * (cy + math.sin(a) * (r + 20)))], fill=YELLOW, width=7 * s)
    d.ellipse([s * (cx - r), s * (cy - r), s * (cx + r), s * (cy + r)], fill=YELLOW)


def moon(d, s, cx=64, cy=64, r=28):
    d.ellipse([s * (cx - r), s * (cy - r), s * (cx + r), s * (cy + r)], fill=CLOUD)
    d.ellipse([s * (cx - r + 16), s * (cy - r - 8), s * (cx + r + 16), s * (cy + r - 8)], fill=(0, 0, 0, 0))


def cloud(d, s, dx=0, dy=0, col=CLOUD):
    for (x, y, r) in ((44, 74, 20), (66, 62, 26), (88, 76, 18)):
        d.ellipse([s * (x + dx - r), s * (y + dy - r), s * (x + dx + r), s * (y + dy + r)], fill=col)
    d.rounded_rectangle([s * (26 + dx), s * (72 + dy), s * (104 + dx), s * (94 + dy)], 11 * s, fill=col)


def drops(d, s, col=RAIN):
    for x in (44, 64, 84):
        d.line([(s * x, s * 102), (s * (x - 6), s * 118)], fill=col, width=6 * s)


def flakes(d, s):
    for x in (44, 64, 84):
        d.ellipse([s * (x - 5), s * 104, s * (x + 5), s * 114], fill=(255, 255, 255))


def bolt(d, s):
    d.polygon([(s * 68, s * 92), (s * 54, s * 112), (s * 64, s * 112), (s * 58, s * 126), (s * 78, s * 102),
               (s * 67, s * 102), (s * 74, s * 92)], fill=YELLOW)


def fog(d, s):
    for i, y in enumerate((52, 68, 84)):
        d.rounded_rectangle([s * (22 + 8 * (i % 2)), s * y, s * (106 - 8 * (i % 2)), s * (y + 8)], 4 * s, fill=CLOUD)


def main():
    OUT.mkdir(exist_ok=True)
    tile("tile-sources.png", "Quellen", glyph_sources)
    tile("tile-allapps.png", "Alle Apps", glyph_allapps)
    tile("tile-gallery.png", "Bilder", glyph_gallery)
    tile("tile-kodi.png", "Kodi", glyph_kodi)
    icon("wx-clear-day.png", lambda d, s: sun(d, s))
    icon("wx-clear-night.png", lambda d, s: moon(d, s))
    icon("wx-partly-day.png", lambda d, s: (sun(d, s, 46, 46, 18), cloud(d, s, 6, 8)))
    icon("wx-partly-night.png", lambda d, s: (moon(d, s, 48, 44, 20), cloud(d, s, 6, 8)))
    icon("wx-cloudy.png", lambda d, s: cloud(d, s))
    icon("wx-fog.png", fog)
    icon("wx-rain.png", lambda d, s: (cloud(d, s, 0, -10), drops(d, s)))
    icon("wx-snow.png", lambda d, s: (cloud(d, s, 0, -10), flakes(d, s)))
    icon("wx-thunder.png", lambda d, s: (cloud(d, s, 0, -14), bolt(d, s)))
    for p in sorted(OUT.glob("*.png")):
        print(p.name, p.stat().st_size)


if __name__ == "__main__":
    main()
