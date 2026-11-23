#!/usr/bin/env python3
"""Erzeugt das FLEX·TV-Startbild aus dem Interstellar-Wallpaper (Pillow).

  python mods/bootanim/gen_frames.py             -> ruhendes Startbild (Standard)
  python mods/bootanim/gen_frames.py --animated  -> animierte 3-s-Schleife (30 Bilder, 10 fps)

Ausgaben: mods/bootanim/anim/{animation.cfg, part0/*.jpg} für /usr/local/bin/boot_animation,
mods/bootanim/preview.gif, sowie für den Ladebildschirm im Launcher
mods/startscreen/flex/loading.jpg (1920x1080) und loading-blur.jpg (winzige Vorschau).

Standard ist ein ruhendes Bild: der Launcher startet zeitgleich mit boot_animation und verdeckt
sie fast sofort; die Animation kostete trotzdem ~65 % eines CPU-Kerns (gemessen) und bremste den
Start. Die Schleife (--animated): das Wallpaper "atmet" (Zoom aufs Schwarze Loch), die
Akkretionsscheibe pulsiert, Sterne funkeln, ein Lichtpunkt umkreist das Loch.
Format: Baseline-JPEG 1920x1080 (nicht progressiv), Dateien 0.jpg..N.jpg, animation.cfg wie im
Original (fps + eine Teil-Zeile).
"""
import math
import random
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
SRC = HERE.parents[1] / "design" / "startmenu-refs" / "interstellar-wallpaper-v2.webp"
OUT = HERE / "anim"
W, H = 1920, 1080
ANIMATED = "--animated" in sys.argv
FPS = 10 if ANIMATED else 1      # ruhend: boot_animation zeichnet das eine Bild 1x/s neu
SECONDS = 3
N = FPS * SECONDS if ANIMATED else 1
CX, CY, R = 1640, 345, 405       # Schwarzes Loch (Photonenring) in 1920x1080-Koordinaten
TILT = math.radians(-15)         # Neigung der Akkretionsscheibe
FONT_WORD = r"C:\Windows\Fonts\consolab.ttf"
FONT_TEXT = r"C:\Windows\Fonts\consola.ttf"
LOADING = HERE.parent / "startscreen" / "flex" / "loading.jpg"
LOADING_BLUR = HERE.parent / "startscreen" / "flex" / "loading-blur.jpg"
STATUS = "System startet"
TEXT_POS = (120, 712)
BLUE = (122, 162, 247)
FG = (192, 202, 245)
MUTED = (127, 139, 179)


def wave(t):
    """0..1..0 über eine Periode (weich, nahtlos)."""
    return (1 - math.cos(2 * math.pi * t)) / 2


def zoom(img, s):
    """Um (CX, CY) mit Faktor s vergrößern, Ausschnitt W x H."""
    w, h = int(W / s), int(H / s)
    x0 = CX - (CX * w / W)
    y0 = CY - (CY * h / H)
    return img.resize((W, H), Image.BICUBIC, box=(x0, y0, x0 + w, y0 + h))


def main():
    random.seed(7)
    base = Image.open(SRC).convert("RGB").resize((W, H), Image.LANCZOS)
    # Leuchtanteil: helle Bereiche (Scheibe/Ring), weichgezeichnet
    lum = base.convert("L").point(lambda v: 0 if v < 170 else (v - 170) * 3)
    glow = Image.composite(base, Image.new("RGB", (W, H)), lum).filter(ImageFilter.GaussianBlur(28))
    glow = ImageEnhance.Brightness(glow).enhance(1.6)
    dark = base.convert("L")

    # Sterne nur in dunklen Bereichen
    stars = []
    while len(stars) < 170:
        x, y = random.randrange(W), random.randrange(H)
        if dark.getpixel((x, y)) < 45 and not (80 < x < 760 and 520 < y < 780):
            stars.append((x, y, random.random(), random.uniform(1.2, 2.8), random.uniform(0.5, 1.0)))

    f_word = ImageFont.truetype(FONT_WORD, 124)
    f_text = ImageFont.truetype(FONT_TEXT, 34)

    # Schriftzug mit weichem blauem Schein (einmal vorbereitet)
    text_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    td = ImageDraw.Draw(text_layer)
    td.text((112, 560), "FLEX·TV", font=f_word, fill=FG + (255,))
    text_glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(text_glow).text((112, 560), "FLEX·TV", font=f_word, fill=BLUE + (200,))
    text_glow = text_glow.filter(ImageFilter.GaussianBlur(14))
    # weicher dunkler Schatten hinter dem Textblock (Lesbarkeit über der hellen Scheibe)
    shade = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shade).rounded_rectangle([60, 540, 700, 790], 60, fill=(4, 5, 12, 150))
    shade = shade.filter(ImageFilter.GaussianBlur(40))

    OUT.mkdir(exist_ok=True)
    part = OUT / "part0"
    part.mkdir(exist_ok=True)
    for old in part.glob("*.jpg"):
        old.unlink()
    preview = []

    def render(t, dots, with_orb=True):
        s = 1.0 + 0.035 * wave(t)
        frame = zoom(base, s)
        frame = ImageEnhance.Brightness(frame).enhance(0.80)
        pulse = 0.18 + 0.32 * wave(t)
        frame = ImageChops.add(frame, ImageEnhance.Brightness(zoom(glow, s)).enhance(pulse))

        # funkelnde Sterne
        fx = Image.new("RGB", (W, H))
        fd = ImageDraw.Draw(fx)
        for (x, y, ph, r, a) in stars:
            k = (0.5 + 0.5 * math.sin(2 * math.pi * (t + ph))) ** 4 * a
            c = int(255 * k)
            fd.ellipse([x - r, y - r, x + r, y + r], fill=(c, c, int(c * 0.95)))
        frame = ImageChops.add(frame, fx.filter(ImageFilter.GaussianBlur(0.8)))

        # Lichtpunkt auf geneigter Ellipse ums Schwarze Loch, mit Schweif (eine Runde pro Schleife)
        if with_orb:
            orb = Image.new("RGB", (W, H))
            od = ImageDraw.Draw(orb)
            steps = 70  # dichte Schritte (~9 px) -> durchgehender Kometenschweif
            for k in range(steps - 1, -1, -1):
                a = 2 * math.pi * (t - k * 0.0025)
                ex, ey = 600 * math.cos(a), 175 * math.sin(a)
                x = CX + ex * math.cos(TILT) - ey * math.sin(TILT)
                y = CY + ex * math.sin(TILT) + ey * math.cos(TILT)
                f = 1 - k / float(steps)
                rr = 1.5 + 6.5 * f
                c = int(255 * f ** 1.6)
                od.ellipse([x - rr, y - rr, x + rr, y + rr], fill=(c, int(c * 0.92), int(c * 0.8)))
            frame = ImageChops.add(frame, orb.filter(ImageFilter.GaussianBlur(3)))
            frame = ImageChops.add(frame, orb)

        # Schriftzug + Status
        fr = frame.convert("RGBA")
        fr = Image.alpha_composite(fr, shade)
        fr = Image.alpha_composite(fr, text_glow)
        fr = Image.alpha_composite(fr, text_layer)
        d = ImageDraw.Draw(fr)
        d.text(TEXT_POS, STATUS + dots, font=f_text, fill=MUTED + (255,))
        d.rectangle([120, 696, 120 + 54, 699], fill=BLUE + (255,))
        return fr.convert("RGB")

    loading = render(0, "", with_orb=False)
    for i in range(N):
        # animiert: wandernder Punkt-Zähler (1..3 Punkte pro Drittel); ruhend: = Ladebild
        frame = render(i / N, "." * (1 + i * 3 // N)) if ANIMATED else loading
        # boot_animation dekodiert jedes Bild neu: bei 12 fps Full-HD ~60 % eines CPU-Kerns
        # (gemessen, bremst den Launcher-Start) -> 10 fps. Größe = Fenstergröße aus animation.cfg,
        # weil unklar ist, ob boot_animation kleinere Bilder skaliert.
        frame.save(part / ("%d.jpg" % i), quality=88, optimize=False, progressive=False, subsampling=2)
        preview.append(frame.resize((640, 360), Image.LANCZOS))
        print("Bild %2d/%d" % (i + 1, N))

    # Ladebild für den Launcher (index.html/flex.css): gleiches Bild ohne Komet und ohne Punkte;
    # die Punkte animiert flex.css an diesen Positionen (px in 1920x1080, 1rem = 30px).
    # Dazu eine winzige Vorschau (192x108), die beim Kaltstart sofort dekodiert ist und gezeigt
    # wird, bis das große Bild fertig ist (statt grauer Fläche).
    loading.save(LOADING, quality=88, progressive=False, subsampling=2)
    loading.resize((192, 108), Image.LANCZOS).filter(ImageFilter.GaussianBlur(1.2)).save(
        LOADING_BLUR, quality=80, progressive=False, subsampling=2)
    print("Vorschau:", LOADING_BLUR, LOADING_BLUR.stat().st_size)
    d = ImageDraw.Draw(Image.new("RGB", (W, H)))
    adv = d.textlength(".", font=f_text)
    x0 = TEXT_POS[0] + d.textlength(STATUS, font=f_text)
    for k in range(3):
        probe = Image.new("L", (W, H))
        ImageDraw.Draw(probe).text((x0 + k * adv, TEXT_POS[1]), ".", font=f_text, fill=255)
        bx = probe.getbbox()  # echte Pixel des Punkts (textbbox ist hier zu breit)
        print("Punkt %d: left %dpx top %dpx size %dx%d px" % (k + 1, bx[0], bx[1], bx[2] - bx[0], bx[3] - bx[1]))
    print("Ladebild:", LOADING, LOADING.stat().st_size)

    (OUT / "animation.cfg").write_text(
        "#fps\n%d\n#type width height isPlay circle startIndex endIndex maxTime partChildPath\n"
        "jpg %d %d 1 1 0 %d 35000 part0\n" % (FPS, W, H, N - 1), newline="\n")
    preview[0].save(HERE / "preview.gif", save_all=True, append_images=preview[1:],
                    duration=int(1000 / FPS), loop=0)
    total = sum(p.stat().st_size for p in part.glob("*.jpg"))
    print("fertig: %d Bilder, %.1f MB" % (N, total / 1e6))


if __name__ == "__main__":
    main()
