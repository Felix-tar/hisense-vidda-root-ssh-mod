#!/usr/bin/env python3
"""Erzeugt für jeden wählbaren Hintergrund ein komplettes Set (Pillow):

  python mods/theme/gen_themes.py      -> mods/theme/sets/<id>/

Je Set: wallpaper.webp (Startseite, 1920x1080), loading.jpg + loading-blur.jpg (Ladebildschirm
des Launchers beim Kaltstart), anim/animation.cfg + anim/part0/0.jpg (ruhendes Bild der nativen
Boot-Animation) und thumb.jpg (Vorschau auf der Seite "Bilder").
Quellen: "interstellar" = das bisherige Design (Dateien aus mods/startscreen/flex und
mods/bootanim/anim, erzeugt von mods/bootanim/gen_frames.py); dazu jedes Bild aus
mods/screensaver/images/ (id = Dateiname ohne Endung). Ladebild/Boot-Bild der Bilder: Motiv
abgedunkelt, darüber Schriftzug "FLEX·TV" und "System startet" an denselben Stellen wie beim
Interstellar-Bild (die Punkte animiert flex.css dort).
"""
import json
import re
import shutil
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUT = HERE / "sets"
IMAGES = ROOT / "mods" / "screensaver" / "images"
STARTSCREEN = ROOT / "mods" / "startscreen" / "flex"
BOOTANIM = ROOT / "mods" / "bootanim" / "anim"
W, H = 1920, 1080
FONT_WORD = r"C:\Windows\Fonts\consolab.ttf"
FONT_TEXT = r"C:\Windows\Fonts\consola.ttf"
STATUS = "System startet"
TEXT_POS = (120, 712)
BLUE = (122, 162, 247)
FG = (192, 202, 245)
MUTED = (127, 139, 179)
ANIM_CFG = ("#fps\n1\n#type width height isPlay circle startIndex endIndex maxTime partChildPath\n"
            "jpg 1920 1080 1 1 0 0 35000 part0\n")


def label(stem):
    """'01_Erzengel_Michael' -> 'Erzengel Michael'"""
    return re.sub(r"^\d+[_ -]*", "", stem).replace("_", " ").strip() or stem


def text_layers():
    f_word = ImageFont.truetype(FONT_WORD, 124)
    f_text = ImageFont.truetype(FONT_TEXT, 34)
    text = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    td = ImageDraw.Draw(text)
    td.text((112, 560), "FLEX·TV", font=f_word, fill=FG + (255,))
    td.text(TEXT_POS, STATUS, font=f_text, fill=MUTED + (255,))
    td.rectangle([120, 696, 120 + 54, 699], fill=BLUE + (255,))
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(glow).text((112, 560), "FLEX·TV", font=f_word, fill=BLUE + (200,))
    glow = glow.filter(ImageFilter.GaussianBlur(14))
    # dunkler Schatten hinter dem Textblock (Lesbarkeit auf hellen Motiven)
    shade = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shade).rounded_rectangle([60, 540, 700, 790], 60, fill=(4, 5, 12, 170))
    shade = shade.filter(ImageFilter.GaussianBlur(40))
    return shade, glow, text


def save_set(d, wallpaper, loading):
    """wallpaper/loading: PIL-Bilder 1920x1080 RGB"""
    (d / "anim" / "part0").mkdir(parents=True, exist_ok=True)
    wallpaper.save(d / "wallpaper.webp", quality=85, method=6)
    loading.save(d / "loading.jpg", quality=88, progressive=False, subsampling=2)
    loading.resize((192, 108), Image.LANCZOS).filter(ImageFilter.GaussianBlur(1.2)).save(
        d / "loading-blur.jpg", quality=80, progressive=False, subsampling=2)
    shutil.copyfile(d / "loading.jpg", d / "anim" / "part0" / "0.jpg")
    (d / "anim" / "animation.cfg").write_text(ANIM_CFG, newline="\n")
    wallpaper.resize((480, 270), Image.LANCZOS).save(d / "thumb.jpg", quality=85)


def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    themes = []
    # bisheriges Design 1:1 übernehmen (Boot-Animation ggf. animiert -> ganzer anim-Ordner)
    d = OUT / "interstellar"
    d.mkdir(parents=True)
    shutil.copyfile(STARTSCREEN / "wallpaper.webp", d / "wallpaper.webp")
    shutil.copyfile(STARTSCREEN / "loading.jpg", d / "loading.jpg")
    shutil.copyfile(STARTSCREEN / "loading-blur.jpg", d / "loading-blur.jpg")
    shutil.copytree(BOOTANIM, d / "anim")
    Image.open(d / "wallpaper.webp").convert("RGB").resize((480, 270), Image.LANCZOS).save(
        d / "thumb.jpg", quality=85)
    themes.append({"id": "interstellar", "name": "Interstellar"})

    shade, glow, text = text_layers()
    for p in sorted(IMAGES.glob("*")):
        if p.suffix.lower() not in (".jpg", ".jpeg", ".png") or not re.fullmatch(r"[A-Za-z0-9._-]+", p.stem):
            continue
        base = ImageOps.fit(ImageOps.exif_transpose(Image.open(p)).convert("RGB"), (W, H), Image.LANCZOS)
        frame = ImageEnhance.Brightness(base).enhance(0.80).convert("RGBA")
        for layer in (shade, glow, text):
            frame = Image.alpha_composite(frame, layer)
        save_set(OUT / p.stem, base, frame.convert("RGB"))
        themes.append({"id": p.stem, "name": label(p.stem)})
        print("Set", p.stem)
    (OUT / "themes.json").write_text(json.dumps(themes, ensure_ascii=False), encoding="utf-8")
    total = sum(f.stat().st_size for f in OUT.rglob("*") if f.is_file())
    print("%d Sets, %.1f MB" % (len(themes), total / 1e6))


if __name__ == "__main__":
    main()
