#!/usr/bin/env python3
"""Prepare the Flex launcher assets for an authorized reference TV installation."""
import argparse
from pathlib import Path
import shutil

from PIL import Image


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path, help="new directory for the launcher assets")
    args = parser.parse_args()
    source = Path(__file__).resolve().parents[1] / "mods" / "startscreen" / "flex"
    required = (
        "flex.css", "flex.js", "tile-allapps.png", "tile-denon-source.png",
        "tile-denon.png", "tile-gallery.png", "tile-kodi.png", "tile-sources.png",
        "wx-clear-day.png", "wx-clear-night.png", "wx-cloudy.png", "wx-fog.png",
        "wx-partly-day.png", "wx-partly-night.png", "wx-rain.png", "wx-snow.png",
        "wx-thunder.png",
    )
    for name in required:
        if not (source / name).is_file():
            parser.error(f"missing shipped launcher asset: {name}")
    args.destination.mkdir(parents=True)
    for name in required:
        shutil.copyfile(source / name, args.destination / name)
    background = Image.new("RGB", (1920, 1080), "#24283b")
    for name in ("wallpaper.webp", "loading.jpg", "loading-blur.jpg"):
        background.save(args.destination / name)
    print(f"Prepared {args.destination}")


if __name__ == "__main__":
    main()
